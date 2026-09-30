import type { AiKeyError, AiProvider } from '@jobdeputy/shared';
import { Message, type Model, ModelThrottledError, TextBlock } from '@strands-agents/sdk';
import { resolveModel } from './models.js';

// T08b2 (decision 0009): one small call tells whether a user's key works with their model.

/** Output cap of the check call (OpenAI's Responses API needs at least 16). */
export const KEY_CHECK_MAX_TOKENS = 16;
export const KEY_CHECK_TIMEOUT_MS = 20_000;

export type KeyCheck = { status: 'valid' } | { status: 'invalid'; reason: AiKeyError };

/** The provider is busy or unreachable: the queue tries again later. */
export class KeyCheckRetryError extends Error {
  override name = 'KeyCheckRetryError';
}

export interface KeyCheckInput {
  provider: AiProvider;
  modelId: string;
  apiKey: string;
}

/**
 * Makes one call of at most KEY_CHECK_MAX_TOKENS output tokens with the user's key, with no
 * retries. A rejected key, an unknown model, or no credit is `invalid`; throttling, timeouts,
 * and provider errors throw KeyCheckRetryError. The dev-only `stub` provider makes no call.
 */
export async function checkKey(
  input: KeyCheckInput,
  createModel: (input: KeyCheckInput) => Model = defaultModel,
): Promise<KeyCheck> {
  if (input.provider === 'stub') {
    return input.apiKey.endsWith('-valid')
      ? { status: 'valid' }
      : { status: 'invalid', reason: 'rejected' };
  }
  const model = createModel(input);
  const messages = [new Message({ role: 'user', content: [new TextBlock('Reply with: OK')] })];
  try {
    for await (const _ of model.stream(messages, {
      cancelSignal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
    })) {
      // Only whether the call succeeds matters, not what the model says.
    }
    return { status: 'valid' };
  } catch (error) {
    const reason = invalidReason(error);
    if (reason) return { status: 'invalid', reason };
    throw new KeyCheckRetryError(`key check failed: ${describe(error)}`);
  }
}

function defaultModel(input: KeyCheckInput): Model {
  if (input.provider === 'stub') throw new Error('the stub provider has no model');
  return resolveModel({ source: 'own', ...input, provider: input.provider }).create({
    maxTokens: KEY_CHECK_MAX_TOKENS,
  });
}

interface ProviderError {
  status?: number;
  code?: string;
  message?: string;
  error?: { code?: string; type?: string; message?: string };
  cause?: unknown;
}

/** The provider's error, whether Strands passed it through or wrapped it (throttling). */
function providerError(error: unknown): ProviderError {
  const err = (error ?? {}) as ProviderError;
  if (err.status === undefined && err.cause && typeof err.cause === 'object') {
    return err.cause as ProviderError;
  }
  return err;
}

const NO_CREDIT = /insufficient_quota|credit balance|billing/i;

/** Why the key is invalid, or undefined when trying again later might succeed. */
export function invalidReason(error: unknown): AiKeyError | undefined {
  const err = providerError(error);
  const text = `${err.code ?? ''} ${err.error?.code ?? ''} ${err.error?.type ?? ''} ${err.message ?? ''}`;
  switch (err.status) {
    case 401:
    case 403:
      return 'rejected';
    case 404:
      return 'model-not-found';
    case 400:
    case 402:
      return NO_CREDIT.test(text) ? 'no-credit' : 'model-refused';
    case 429:
      // OpenAI answers 429 both for "slow down" and for "no quota left".
      return NO_CREDIT.test(text) ? 'no-credit' : undefined;
    default:
      return undefined;
  }
}

/** A short description for logs: the status and the error's class, never its message (it may echo input). */
function describe(error: unknown): string {
  const err = providerError(error);
  const name =
    error instanceof ModelThrottledError ? 'throttled' : ((error as Error)?.name ?? 'error');
  return err.status === undefined ? name : `${name} (${err.status})`;
}
