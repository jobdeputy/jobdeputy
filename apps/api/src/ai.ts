import { EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import {
  AccountRepository,
  AiKeyNotFoundError,
  AiKeyNotUsableError,
  type AiKeyRepository,
  AiKeyRepository as AiKeys,
  documentClient,
  KeyCheckLimitError,
  VersionConflictError,
} from '@jobdeputy/db';
import {
  type AiProvider,
  aiProvider,
  callerFromEvent,
  createLogger,
  type HttpResponse,
  json,
  KEY_CHECKS_PER_DAY,
  nextUtcMidnight,
  parseJsonBody,
  problem,
  saveAiKeyInput,
  updateAiSettingsInput,
  validationProblem,
} from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import { ulid } from 'ulid';
import { refuseWritesWhileDeleting } from './account-guard.js';
import { type UserAudit, userAudit } from './audited.js';
import { concurrentUpdateProblem } from './errors.js';

// T08b2 (decision 0009): the user's own AI keys and AI settings. The key is encrypted here
// with the cell's KMS key and never returned, logged, or audited; the key-check worker
// decrypts it to check it (status `checking` → `valid` or `invalid`).

const logger = createLogger('api-ai');

export interface AiDeps {
  keys: Pick<
    AiKeyRepository,
    'save' | 'requestCheck' | 'delete' | 'list' | 'get' | 'getSettings' | 'saveSettings'
  >;
  encrypt: (userId: string, provider: AiProvider, apiKey: string) => Promise<Uint8Array>;
  audit: UserAudit;
  /** Dev stacks only: the `stub` provider for integration tests. */
  allowTestProvider: boolean;
  newId: () => string;
  now: () => number;
  isBeingDeleted: (userId: string) => Promise<boolean>;
}

function defaultDeps(): AiDeps {
  const {
    AI_KEYS_TABLE_NAME,
    USAGE_TABLE_NAME,
    PREFERENCES_TABLE_NAME,
    AUDIT_TABLE_NAME,
    USERS_TABLE_NAME,
    AI_KEYS_KMS_KEY_ARN,
    ALLOW_TEST_AI_PROVIDER,
  } = process.env;
  if (
    !AI_KEYS_TABLE_NAME ||
    !USAGE_TABLE_NAME ||
    !PREFERENCES_TABLE_NAME ||
    !AUDIT_TABLE_NAME ||
    !USERS_TABLE_NAME ||
    !AI_KEYS_KMS_KEY_ARN
  ) {
    throw new Error('Table names and the KMS key must be set');
  }
  const client = documentClient();
  const kms = new KMSClient({});
  const account = new AccountRepository(client, USERS_TABLE_NAME);
  return {
    keys: new AiKeys(client, {
      aiKeys: AI_KEYS_TABLE_NAME,
      usage: USAGE_TABLE_NAME,
      preferences: PREFERENCES_TABLE_NAME,
    }),
    encrypt: async (userId, provider, apiKey) => {
      const res = await kms.send(
        new EncryptCommand({
          KeyId: AI_KEYS_KMS_KEY_ARN,
          Plaintext: new TextEncoder().encode(apiKey),
          // Ties the ciphertext to this user and provider: it decrypts for no one else.
          EncryptionContext: { userId, provider },
        }),
      );
      if (!res.CiphertextBlob) throw new Error('KMS returned no ciphertext');
      return res.CiphertextBlob;
    },
    audit: userAudit(AUDIT_TABLE_NAME, ulid),
    allowTestProvider: ALLOW_TEST_AI_PROVIDER === 'true',
    newId: ulid,
    now: Date.now,
    isBeingDeleted: (userId) => account.isBeingDeleted(userId),
  };
}

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

function checkLimitProblem(deps: AiDeps, requestId: string): HttpResponse {
  const resetsAt = nextUtcMidnight(new Date(deps.now()));
  const res = problem(429, 'Daily key check limit reached', {
    detail: `You can save or check keys ${KEY_CHECKS_PER_DAY} times a day. Try again after ${resetsAt.toISOString()}.`,
    code: 'key-check-limit-reached',
    requestId,
  });
  const seconds = Math.max(1, Math.ceil((resetsAt.getTime() - deps.now()) / 1000));
  return { ...res, headers: { ...res.headers, 'retry-after': String(seconds) } };
}

const noKey = (requestId: string) =>
  problem(404, 'Not found', { detail: 'There is no key for this provider.', requestId });

async function keyRoute(
  event: Event,
  userId: string,
  provider: AiProvider,
  deps: AiDeps,
  requestId: string,
): Promise<HttpResponse> {
  switch (event.routeKey) {
    case 'PUT /me/ai-keys/{provider}': {
      const body = parseJsonBody(event.body, event.isBase64Encoded);
      if (body === undefined) return problem(400, 'Body must be valid JSON', { requestId });
      const input = saveAiKeyInput(provider).safeParse(body);
      if (!input.success) return validationProblem(input.error, requestId);
      const { apiKey, modelId } = input.data;
      const ciphertext = await deps.encrypt(userId, provider, apiKey);
      try {
        const saved = await deps.keys.save({
          userId,
          provider,
          ciphertext,
          last4: apiKey.slice(-4),
          modelId,
          checkId: deps.newId(),
          maxChecksPerDay: KEY_CHECKS_PER_DAY,
          audit: deps.audit(
            'ai_key.saved',
            { type: 'ai_key', id: provider },
            `Own ${provider} key saved for ${modelId}, with consent to send job data to ${provider}`,
            { provider, modelId },
          ),
        });
        logger.info('AI key saved', { provider });
        return json(202, saved);
      } catch (error) {
        if (error instanceof KeyCheckLimitError) return checkLimitProblem(deps, requestId);
        throw error;
      }
    }
    case 'POST /me/ai-keys/{provider}/check': {
      try {
        await deps.keys.requestCheck({
          userId,
          provider,
          checkId: deps.newId(),
          maxChecksPerDay: KEY_CHECKS_PER_DAY,
          audit: deps.audit(
            'ai_key.check_requested',
            { type: 'ai_key', id: provider },
            `Own ${provider} key check requested`,
          ),
        });
      } catch (error) {
        if (error instanceof AiKeyNotFoundError) return noKey(requestId);
        if (error instanceof KeyCheckLimitError) return checkLimitProblem(deps, requestId);
        throw error;
      }
      const keys = await deps.keys.list(userId);
      return json(
        202,
        keys.find((k) => k.provider === provider),
      );
    }
    case 'DELETE /me/ai-keys/{provider}': {
      try {
        const { defaultReset } = await deps.keys.delete({
          userId,
          provider,
          audit: deps.audit(
            'ai_key.deleted',
            { type: 'ai_key', id: provider },
            `Own ${provider} key deleted`,
          ),
        });
        logger.info('AI key deleted', { provider, defaultReset });
      } catch (error) {
        if (error instanceof AiKeyNotFoundError) return noKey(requestId);
        throw error;
      }
      return { statusCode: 204, headers: {}, body: '' };
    }
    default:
      return problem(404, 'Not found', { requestId });
  }
}

async function settingsView(userId: string, deps: AiDeps) {
  const settings = await deps.keys.getSettings(userId);
  return { defaultSource: settings?.defaultSource ?? 'platform', version: settings?.version ?? 0 };
}

/** The caller's AI keys and settings. The user is always the token's `sub`. */
export async function route(event: Event, deps: AiDeps): Promise<HttpResponse> {
  const requestId = event.requestContext.requestId;
  const caller = callerFromEvent(event);
  if (!caller) return problem(401, 'Unauthorized', { requestId });
  const { userId } = caller;
  const blocked = await refuseWritesWhileDeleting(
    event.routeKey,
    userId,
    deps.isBeingDeleted,
    requestId,
  );
  if (blocked) return blocked;

  if (event.routeKey.includes('{provider}')) {
    const provider = aiProvider(event.pathParameters?.provider, deps.allowTestProvider);
    if (!provider) return problem(404, 'Not found', { detail: 'Unknown AI provider.', requestId });
    return keyRoute(event, userId, provider, deps, requestId);
  }

  switch (event.routeKey) {
    case 'GET /me/ai-keys':
      return json(200, { keys: await deps.keys.list(userId), checksPerDay: KEY_CHECKS_PER_DAY });
    case 'GET /me/ai-settings':
      return json(200, await settingsView(userId, deps));
    case 'PUT /me/ai-settings': {
      const body = parseJsonBody(event.body, event.isBase64Encoded);
      if (body === undefined) return problem(400, 'Body must be valid JSON', { requestId });
      const input = updateAiSettingsInput(deps.allowTestProvider).safeParse(body);
      if (!input.success) return validationProblem(input.error, requestId);
      const { defaultSource, version } = input.data;
      const previous = (await deps.keys.getSettings(userId))?.defaultSource ?? 'platform';
      try {
        await deps.keys.saveSettings(
          userId,
          defaultSource,
          version,
          deps.audit(
            'ai_settings.changed',
            { type: 'ai_settings', id: 'AI_SETTINGS' },
            `Default AI model source set to ${defaultSource}`,
            { from: previous, to: defaultSource },
          ),
        );
      } catch (error) {
        if (error instanceof VersionConflictError) {
          return problem(409, 'Conflict', {
            detail: 'This was changed elsewhere. Reload, then try again.',
            requestId,
          });
        }
        if (error instanceof AiKeyNotUsableError) {
          return problem(422, 'Key not usable', {
            detail: `Save a working ${defaultSource} key first.`,
            code: 'ai-key-not-usable',
            requestId,
          });
        }
        throw error;
      }
      return json(200, await settingsView(userId, deps));
    }
    default:
      return problem(404, 'Not found', { requestId });
  }
}

let deps: AiDeps | undefined;

export async function handler(event: Event, context: Context): Promise<HttpResponse> {
  logger.addContext(context);
  try {
    deps ??= defaultDeps();
    return await route(event, deps);
  } catch (error) {
    const busy = concurrentUpdateProblem(error, event.requestContext.requestId);
    if (busy) {
      logger.warn('Concurrent update after retries', { error: error as Error });
      return busy;
    }
    // The error only: never the event, which holds the key in its body.
    logger.error('Unhandled error', { error: error as Error });
    return problem(500, 'Internal error', { requestId: event.requestContext.requestId });
  }
}
