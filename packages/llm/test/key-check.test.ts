import { ModelThrottledError } from '@strands-agents/sdk';
import { AnthropicModel } from '@strands-agents/sdk/models/anthropic';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import { describe, expect, it } from 'vitest';
import {
  checkKey,
  invalidReason,
  KEY_CHECK_MAX_TOKENS,
  type KeyCheckInput,
  KeyCheckRetryError,
} from '../src/key-check.js';
import { redact } from '../src/logging.js';
import { resolveModel } from '../src/models.js';

const openai: KeyCheckInput = {
  provider: 'openai',
  modelId: 'gpt-test',
  apiKey: `sk-test-${'x'.repeat(16)}`,
};
const anthropic: KeyCheckInput = {
  provider: 'anthropic',
  modelId: 'claude-test',
  apiKey: `sk-ant-test-${'x'.repeat(16)}`,
};

/** A fake network: every request gets this status and JSON body; records what was sent. */
function fakeFetch(
  status: number,
  body: unknown,
  seen: { url?: string; body?: string; auth?: string }[] = [],
) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: String(url),
      body: String(init?.body ?? ''),
      auth: headers.get('authorization') ?? headers.get('x-api-key') ?? '',
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

/** The real Strands and SDK code for each provider, with only the network faked. */
function realModel(input: KeyCheckInput, fetch: ReturnType<typeof fakeFetch>) {
  const clientConfig = { maxRetries: 0, fetch };
  return input.provider === 'openai'
    ? new OpenAIModel({
        api: 'chat',
        modelId: input.modelId,
        apiKey: input.apiKey,
        maxTokens: KEY_CHECK_MAX_TOKENS,
        clientConfig,
      })
    : new AnthropicModel({
        modelId: input.modelId,
        apiKey: input.apiKey,
        maxTokens: KEY_CHECK_MAX_TOKENS,
        clientConfig,
      });
}

describe('checkKey through the real provider SDKs', () => {
  const cases: [KeyCheckInput, number, unknown, string][] = [
    [
      openai,
      401,
      {
        error: {
          message: 'Incorrect API key',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      },
      'rejected',
    ],
    [
      openai,
      404,
      { error: { message: 'The model does not exist', code: 'model_not_found' } },
      'model-not-found',
    ],
    [
      openai,
      429,
      {
        error: {
          message: 'You exceeded your current quota',
          type: 'insufficient_quota',
          code: 'insufficient_quota',
        },
      },
      'no-credit',
    ],
    [
      anthropic,
      401,
      { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      'rejected',
    ],
    [
      anthropic,
      403,
      { type: 'error', error: { type: 'permission_error', message: 'no access' } },
      'rejected',
    ],
    [
      anthropic,
      404,
      { type: 'error', error: { type: 'not_found_error', message: 'model: claude-test' } },
      'model-not-found',
    ],
    [
      anthropic,
      400,
      {
        type: 'error',
        error: { type: 'invalid_request_error', message: 'Your credit balance is too low' },
      },
      'no-credit',
    ],
  ];
  it.each(cases)('%# %s %i → invalid (%s)', async (input, status, body, reason) => {
    const seen: { url?: string; body?: string; auth?: string }[] = [];
    const result = await checkKey(input, () => realModel(input, fakeFetch(status, body, seen)));
    expect(result).toEqual({ status: 'invalid', reason });
    // One request, no retries, with the user's key and the output cap.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.auth).toContain(input.apiKey);
    expect(seen[0]?.body).toContain(String(KEY_CHECK_MAX_TOKENS));
  });

  it.each([
    [
      openai,
      429,
      { error: { message: 'Rate limit reached', type: 'requests', code: 'rate_limit_exceeded' } },
    ],
    [openai, 500, { error: { message: 'server error' } }],
    [anthropic, 529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }],
  ] as const)('%# %s %i → try again later, after one request', async (input, status, body) => {
    const seen: { url?: string }[] = [];
    await expect(
      checkKey(input, () => realModel(input, fakeFetch(status, body, seen))),
    ).rejects.toBeInstanceOf(KeyCheckRetryError);
    expect(seen).toHaveLength(1);
  });

  it('never puts the key in the retry error', async () => {
    const error = await checkKey(openai, () =>
      realModel(openai, fakeFetch(500, { error: { message: `bad key ${openai.apiKey}` } })),
    ).catch((e: Error) => e);
    expect(String((error as Error).message)).not.toContain(openai.apiKey);
  });
});

describe('checkKey', () => {
  it('is valid when the call succeeds', async () => {
    const model = realModel(anthropic, async () => {
      const events = [
        {
          type: 'message_start',
          message: {
            id: 'm',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-test',
            usage: { input_tokens: 5, output_tokens: 0 },
          },
        },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ];
      const sse = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    await expect(checkKey(anthropic, () => model)).resolves.toEqual({ status: 'valid' });
  });

  it('checks the dev-only stub provider without any call', async () => {
    const never = () => {
      throw new Error('no model for the stub');
    };
    await expect(
      checkKey({ provider: 'stub', modelId: 'm', apiKey: 'stub-key-valid' }, never),
    ).resolves.toEqual({ status: 'valid' });
    await expect(
      checkKey({ provider: 'stub', modelId: 'm', apiKey: 'stub-key-nope' }, never),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'rejected',
    });
  });
});

describe('invalidReason', () => {
  it('reads a wrapped throttling error', () => {
    const throttled = new ModelThrottledError('slow', {
      cause: { status: 429, code: 'rate_limit_exceeded' },
    });
    expect(invalidReason(throttled)).toBeUndefined();
    const noQuota = new ModelThrottledError('quota', {
      cause: { status: 429, code: 'insufficient_quota' },
    });
    expect(invalidReason(noQuota)).toBe('no-credit');
  });

  it('treats network errors and unknown statuses as temporary', () => {
    expect(invalidReason(new TypeError('fetch failed'))).toBeUndefined();
    expect(invalidReason({ status: 503 })).toBeUndefined();
  });
});

describe("resolveModel with the user's own key", () => {
  it('builds each provider without client retries', () => {
    for (const input of [openai, anthropic] as const) {
      const source = resolveModel({
        source: 'own',
        provider: input.provider as 'openai' | 'anthropic',
        modelId: input.modelId,
        apiKey: input.apiKey,
      });
      expect(source).toMatchObject({
        keySource: 'own',
        provider: input.provider,
        modelId: input.modelId,
      });
      const model = source.create({ maxTokens: 99 });
      expect(model.getConfig()).toMatchObject({ modelId: input.modelId, maxTokens: 99 });
      const client = (model as unknown as { _client: { maxRetries: number } })._client;
      expect(client.maxRetries).toBe(0);
    }
  });
});

describe('redact', () => {
  it('masks anything shaped like a key in log arguments', () => {
    expect(redact(`key ${openai.apiKey} failed`)).toBe('key sk-[redacted] failed');
    expect(redact(new Error(`bad ${anthropic.apiKey}`))).toBe('Error: bad sk-[redacted]');
    expect(redact({ headers: { authorization: `Bearer ${openai.apiKey}` } })).not.toContain(
      openai.apiKey,
    );
    expect(redact('stub-key-valid')).toBe('stub-[redacted]');
  });
});
