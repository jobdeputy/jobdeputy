import {
  AiKeyNotFoundError,
  AiKeyNotUsableError,
  type AiKeySummary,
  type AiSettings,
  KeyCheckLimitError,
  VersionConflictError,
} from '@jobdeputy/db';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { type AiDeps, route } from '../src/ai.js';
import { userAudit } from '../src/audited.js';

const NOW = Date.parse('2026-09-30T20:00:00.000Z');
// Fake keys are built from repeated letters: nothing that a secret scanner could mistake for a real key.
const KEY = `sk-proj-${'x'.repeat(16)}WXYZ`;

function event(
  routeKey: string,
  extra: Record<string, unknown> = {},
  sub: string | null = 'user-a',
) {
  return {
    routeKey,
    requestContext: {
      requestId: 'req-1',
      ...(sub ? { authorizer: { jwt: { claims: { sub, username: `${sub}-n` } } } } : {}),
    },
    isBase64Encoded: false,
    ...extra,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}
const put = (provider: string, body: unknown) =>
  event('PUT /me/ai-keys/{provider}', { pathParameters: { provider }, body: JSON.stringify(body) });
const body = (res: { body: string }) => JSON.parse(res.body);

const SUMMARY: AiKeySummary = {
  provider: 'openai',
  last4: 'WXYZ',
  modelId: 'gpt-test',
  status: 'checking',
  consentAt: 'a',
  updatedAt: 'a',
};

function deps(allowTestProvider = false) {
  let n = 0;
  type Keys = AiDeps['keys'];
  const keys = {
    save: vi.fn<Keys['save']>(async () => SUMMARY),
    requestCheck: vi.fn<Keys['requestCheck']>(async () => undefined),
    delete: vi.fn<Keys['delete']>(async () => ({ defaultReset: false })),
    list: vi.fn<Keys['list']>(async () => [SUMMARY]),
    get: vi.fn<Keys['get']>(async () => undefined),
    getSettings: vi.fn<Keys['getSettings']>(async (): Promise<AiSettings | undefined> => undefined),
    saveSettings: vi.fn<Keys['saveSettings']>(async () => ({}) as AiSettings),
  };
  const d: AiDeps = {
    keys,
    encrypt: vi.fn(async () => new Uint8Array([7, 7])),
    audit: userAudit('Audit', () => `A${n++}`),
    allowTestProvider,
    newId: () => `01J8ZQ4Y3N5W6X7Y8Z9A0B1C${String(10 + (n++ % 90))}`,
    now: () => NOW,
    isBeingDeleted: vi.fn(async () => false),
    usage: vi.fn<AiDeps['usage']>(async () => []),
    platformRunsUsed: vi.fn<AiDeps['platformRunsUsed']>(async () => ({ week: 0, month: 0 })),
    limits: vi.fn<AiDeps['limits']>(async () => ({
      dailyDefault: 20,
      dailyMax: 50,
      maxActive: 1,
      platformRunsPerWeek: 1,
      platformRunsPerMonth: 4,
    })),
  };
  return { d, keys };
}

describe('PUT /me/ai-keys/{provider}', () => {
  it('encrypts the key for this user and provider, saves it as checking (202)', async () => {
    const { d, keys } = deps();
    const res = await route(put('openai', { apiKey: KEY, modelId: 'gpt-test', consent: true }), d);
    expect(res.statusCode).toBe(202);
    expect(body(res)).toEqual(SUMMARY);
    expect(d.encrypt).toHaveBeenCalledWith('user-a', 'openai', KEY);
    const saved = vi.mocked(keys.save).mock.calls[0]?.[0];
    expect(saved).toMatchObject({
      userId: 'user-a',
      provider: 'openai',
      ciphertext: new Uint8Array([7, 7]),
      last4: 'WXYZ',
      modelId: 'gpt-test',
      maxChecksPerDay: 5,
    });
    // The audit entry never holds the key, nor any part of it.
    const audit = JSON.stringify(saved?.audit);
    expect(audit).toContain('ai_key.saved');
    expect(audit).not.toContain(KEY);
    expect(audit).not.toContain('WXYZ');
  });

  it('never returns or echoes the key, even when refusing it', async () => {
    const { d } = deps();
    for (const bad of [
      { apiKey: KEY, modelId: 'gpt-test' },
      { apiKey: KEY, modelId: 'gpt-test', consent: false },
      { apiKey: `${KEY} `, modelId: 'gpt-test', consent: true },
      { apiKey: KEY, modelId: 'gpt test', consent: true, extra: 1 },
    ]) {
      const res = await route(put('openai', bad), d);
      expect(res.statusCode).toBe(400);
      expect(res.body).not.toContain(KEY.slice(3));
    }
    expect(d.encrypt).not.toHaveBeenCalled();
  });

  it('requires consent to send job data to the provider', async () => {
    const { d } = deps();
    const res = await route(put('openai', { apiKey: KEY, modelId: 'gpt-test' }), d);
    expect(body(res).errors[0]).toMatchObject({ path: 'consent' });
  });

  it('checks the key looks like the provider’s', async () => {
    const { d } = deps();
    const res = await route(
      put('anthropic', { apiKey: KEY, modelId: 'claude-test', consent: true }),
      d,
    );
    expect(res.statusCode).toBe(400);
    expect(body(res).errors[0].message).toContain('sk-ant-');
  });

  it('answers 429 with Retry-After when today’s checks are used up', async () => {
    const { d, keys } = deps();
    keys.save.mockRejectedValue(new KeyCheckLimitError());
    const res = await route(put('openai', { apiKey: KEY, modelId: 'gpt-test', consent: true }), d);
    expect(res.statusCode).toBe(429);
    expect(body(res).code).toBe('key-check-limit-reached');
    expect(res.headers['retry-after']).toBe(String(4 * 60 * 60));
  });

  it('knows only real providers, and the test provider only in dev', async () => {
    const valid = { apiKey: `stub-${'x'.repeat(16)}-valid`, modelId: 'm', consent: true };
    for (const provider of ['google', 'stub', '..']) {
      const res = await route(put(provider, valid), deps().d);
      expect(res.statusCode).toBe(404);
    }
    expect((await route(put('stub', valid), deps(true).d)).statusCode).toBe(202);
  });

  it('refuses writes while the account is being deleted', async () => {
    const { d, keys } = deps();
    vi.mocked(d.isBeingDeleted).mockResolvedValue(true);
    const res = await route(put('openai', { apiKey: KEY, modelId: 'gpt-test', consent: true }), d);
    expect(res.statusCode).toBe(410);
    expect(keys.save).not.toHaveBeenCalled();
  });
});

describe('the other key routes', () => {
  const on = (routeKey: string, provider = 'openai') =>
    event(routeKey, { pathParameters: { provider } });

  it('lists keys without secrets, with the daily check limit', async () => {
    const res = await route(on('GET /me/ai-keys'), deps().d);
    expect(body(res)).toEqual({ keys: [SUMMARY], checksPerDay: 5 });
  });

  it('starts a new check (202), or answers 404 and 429', async () => {
    const { d, keys } = deps();
    expect((await route(on('POST /me/ai-keys/{provider}/check'), d)).statusCode).toBe(202);
    keys.requestCheck.mockRejectedValueOnce(new AiKeyNotFoundError());
    expect((await route(on('POST /me/ai-keys/{provider}/check'), d)).statusCode).toBe(404);
    keys.requestCheck.mockRejectedValueOnce(new KeyCheckLimitError());
    expect((await route(on('POST /me/ai-keys/{provider}/check'), d)).statusCode).toBe(429);
  });

  it('deletes a key (204), or answers 404', async () => {
    const { d, keys } = deps();
    expect((await route(on('DELETE /me/ai-keys/{provider}'), d)).statusCode).toBe(204);
    expect(keys.delete).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-a', provider: 'openai' }),
    );
    keys.delete.mockRejectedValueOnce(new AiKeyNotFoundError());
    expect((await route(on('DELETE /me/ai-keys/{provider}'), d)).statusCode).toBe(404);
  });

  it('needs a signed-in user', async () => {
    const res = await route(event('GET /me/ai-keys', {}, null), deps().d);
    expect(res.statusCode).toBe(401);
  });
});

describe('/me/ai-settings', () => {
  const putSettings = (b: unknown) => event('PUT /me/ai-settings', { body: JSON.stringify(b) });

  it('defaults to the platform model', async () => {
    const res = await route(event('GET /me/ai-settings'), deps().d);
    expect(body(res)).toEqual({ defaultSource: 'platform', version: 0 });
  });

  it('saves a new default with its audit entry', async () => {
    const { d, keys } = deps();
    const res = await route(putSettings({ defaultSource: 'anthropic', version: 0 }), d);
    expect(res.statusCode).toBe(200);
    const [userId, source, version, audit] = vi.mocked(keys.saveSettings).mock.calls[0] ?? [];
    expect([userId, source, version]).toEqual(['user-a', 'anthropic', 0]);
    expect(audit?.entry).toMatchObject({
      name: 'ai_settings.changed',
      detail: { from: 'platform', to: 'anthropic' },
    });
  });

  it('answers 422 for a key that is missing or invalid, 409 for a stale version, 400 for unknown sources', async () => {
    const { d, keys } = deps();
    keys.saveSettings.mockRejectedValueOnce(new AiKeyNotUsableError());
    expect((await route(putSettings({ defaultSource: 'openai', version: 0 }), d)).statusCode).toBe(
      422,
    );
    keys.saveSettings.mockRejectedValueOnce(new VersionConflictError(3));
    expect((await route(putSettings({ defaultSource: 'openai', version: 0 }), d)).statusCode).toBe(
      409,
    );
    expect((await route(putSettings({ defaultSource: 'gemini', version: 0 }), d)).statusCode).toBe(
      400,
    );
    expect((await route(putSettings({ defaultSource: 'stub', version: 0 }), d)).statusCode).toBe(
      400,
    );
  });
});

describe('GET /me/ai-usage (T08b3)', () => {
  const get = (month?: string) =>
    event('GET /me/ai-usage', month ? { queryStringParameters: { month } } : {});
  const ENTRY = {
    keySource: 'platform' as const,
    provider: 'bedrock',
    modelId: 'mistral.ministral-3-14b-instruct',
    calls: 3,
    inputTokens: 1500,
    outputTokens: 120,
    runs: 1,
    byTask: { relevance: { calls: 3, inputTokens: 1500, outputTokens: 120 } },
  };

  it('shows each model for this month, and the free runs left', async () => {
    const { d } = deps();
    vi.mocked(d.usage).mockResolvedValue([ENTRY]);
    const res = await route(get(), d);
    expect(res.statusCode).toBe(200);
    expect(d.usage).toHaveBeenCalledWith('user-a', '2026-09');
    expect(body(res)).toEqual({
      month: '2026-09',
      models: [ENTRY],
      platformRuns: { perWeek: 1, perMonth: 4, usedThisWeek: 0, usedThisMonth: 0, available: true },
    });
  });

  it('says when the next free run comes once they are used up', async () => {
    const { d } = deps();
    vi.mocked(d.platformRunsUsed).mockResolvedValue({ week: 1, month: 2 });
    const res = await route(get('2026-08'), d);
    expect(d.usage).toHaveBeenCalledWith('user-a', '2026-08');
    // 2026-09-30 is a Wednesday: the next week starts on Monday 2026-10-05.
    expect(body(res).platformRuns).toMatchObject({
      available: false,
      nextAvailableAt: '2026-10-05T00:00:00.000Z',
    });
  });

  it('refuses a malformed month', async () => {
    for (const month of ['2026-13', '2026-9', 'latest']) {
      expect((await route(get(month), deps().d)).statusCode).toBe(400);
    }
  });
});
