import { BatchProcessor, EventType, processPartialResponse } from '@aws-lambda-powertools/batch';
import { DecryptCommand, KMSClient } from '@aws-sdk/client-kms';
import {
  AccountRepository,
  type AiKeyRepository,
  AiKeyRepository as AiKeys,
  documentClient,
} from '@jobdeputy/db';
import { checkKey, type KeyCheck, KeyCheckRetryError } from '@jobdeputy/llm';
import { AI_KEY_ERRORS, type AiProvider, aiProvider, createLogger } from '@jobdeputy/shared';
import type { Context, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { ulid } from 'ulid';
import { z } from 'zod';

// T08b2 (decision 0009): checks a user's saved key with one small call to its provider.
// ai-keys (status `checking`) → stream → Pipe → queue → this worker → `valid` or `invalid`.
// The decrypted key exists only in memory for the call; it is never logged or stored.

const logger = createLogger('key-check-worker');

/** Same as the queue's maxReceiveCount: the last attempt records `check-failed`. */
export const MAX_RECEIVES = 3;

const keyCheckMessage = z.object({
  userId: z.string().regex(/^[0-9a-f-]{36}$/),
  provider: z.string().max(20),
});

export interface KeyCheckWorkerDeps {
  keys: Pick<AiKeyRepository, 'get' | 'recordCheck'>;
  decrypt: (userId: string, provider: AiProvider, ciphertext: Uint8Array) => Promise<string>;
  check: typeof checkKey;
  isBeingDeleted: (userId: string) => Promise<boolean>;
  auditTable: string;
  allowTestProvider: boolean;
  newId: () => string;
}

export type KeyCheckOutcome = 'skipped' | 'valid' | 'invalid' | 'superseded';

export async function processRecord(
  record: SQSRecord,
  deps: KeyCheckWorkerDeps,
): Promise<KeyCheckOutcome> {
  const parsed = keyCheckMessage.safeParse(safeJson(record.body));
  const provider = parsed.success
    ? aiProvider(parsed.data.provider, deps.allowTestProvider)
    : undefined;
  if (!parsed.success || !provider) {
    // Nothing to retry: let it fail through to the dead-letter queue for inspection.
    logger.error('Malformed message', { messageId: record.messageId });
    throw new Error('Malformed message');
  }
  const { userId } = parsed.data;
  if (await deps.isBeingDeleted(userId)) {
    logger.info('Account is being deleted; skipping', { provider });
    return 'skipped';
  }
  const key = await deps.keys.get(userId, provider);
  if (key?.status !== 'checking') {
    logger.info('Key missing or already checked; skipping', { provider });
    return 'skipped';
  }

  const lastAttempt = Number(record.attributes.ApproximateReceiveCount) >= MAX_RECEIVES;
  let result: KeyCheck;
  try {
    const apiKey = await deps.decrypt(userId, provider, key.ciphertext);
    result = await deps.check({ provider, modelId: key.modelId, apiKey });
  } catch (error) {
    if (!(error instanceof KeyCheckRetryError)) throw error;
    if (!lastAttempt) {
      logger.warn('Provider unavailable; the queue tries again', {
        provider,
        error: error.message,
      });
      throw error;
    }
    result = { status: 'invalid', reason: 'check-failed' };
  }

  const recorded = await deps.keys.recordCheck({
    userId,
    provider,
    checkId: key.checkId,
    result,
    audit: {
      table: deps.auditTable,
      entry: {
        auditId: deps.newId(),
        name: 'ai_key.checked',
        entity: { type: 'ai_key', id: provider },
        actor: 'system',
        summary:
          result.status === 'valid'
            ? `Own ${provider} key works with ${key.modelId}`
            : `Own ${provider} key does not work: ${AI_KEY_ERRORS[result.reason]}`,
        detail: {
          status: result.status,
          ...(result.status === 'invalid' ? { reason: result.reason } : {}),
        },
      },
    },
  });
  if (!recorded) {
    logger.info('Key deleted, replaced, or checked again meanwhile', { provider });
    return 'superseded';
  }
  logger.info('Key checked', { provider, status: result.status });
  return result.status;
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function defaultDeps(): KeyCheckWorkerDeps {
  const {
    AI_KEYS_TABLE_NAME,
    USAGE_TABLE_NAME,
    PREFERENCES_TABLE_NAME,
    AUDIT_TABLE_NAME,
    USERS_TABLE_NAME,
    ALLOW_TEST_AI_PROVIDER,
  } = process.env;
  if (
    !AI_KEYS_TABLE_NAME ||
    !USAGE_TABLE_NAME ||
    !PREFERENCES_TABLE_NAME ||
    !AUDIT_TABLE_NAME ||
    !USERS_TABLE_NAME
  ) {
    throw new Error('Table names must be set');
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
    decrypt: async (userId, provider, ciphertext) => {
      // KMS refuses unless the context matches the one used to encrypt: this user, this provider.
      const res = await kms.send(
        new DecryptCommand({ CiphertextBlob: ciphertext, EncryptionContext: { userId, provider } }),
      );
      if (!res.Plaintext) throw new Error('KMS returned no plaintext');
      return new TextDecoder().decode(res.Plaintext);
    },
    check: checkKey,
    isBeingDeleted: (userId) => account.isBeingDeleted(userId),
    auditTable: AUDIT_TABLE_NAME,
    allowTestProvider: ALLOW_TEST_AI_PROVIDER === 'true',
    newId: ulid,
  };
}

const processor = new BatchProcessor(EventType.SQS);
let deps: KeyCheckWorkerDeps | undefined;

export async function handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse> {
  logger.addContext(context);
  deps ??= defaultDeps();
  const current = deps;
  return processPartialResponse(
    event,
    (record: SQSRecord) => processRecord(record, current),
    processor,
    {
      context,
    },
  );
}
