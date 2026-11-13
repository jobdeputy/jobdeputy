import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callApi, createTestUser, stackOutputs, type TestUser, waitFor } from './stack.js';

/**
 * Deployed wiring of T08b2 (decision 0009): KMS encryption with the shared key, the table
 * stream → key-check worker → status, AI settings, a key chosen for a crawl, and the daily
 * check limit. Uses the dev-only `stub` provider, so no call leaves AWS. The rules
 * (validation, error mapping, the real providers) are unit-tested.
 */
let api: string;
let testSite: string;
let user: TestUser;

// Built from repeated letters, so no secret scanner mistakes them for real keys.
const VALID = `stub-integration-${'x'.repeat(8)}-valid`;
const INVALID = `stub-integration-${'y'.repeat(8)}-wrong`;

beforeAll(async () => {
  const outputs = await stackOutputs();
  api = outputs.ApiUrl ?? '';
  testSite = outputs.TestSiteUrl ?? '';
  user = await createTestUser(outputs);
}, 60_000);

afterAll(async () => {
  await user?.delete();
});

async function waitForStatus(token: string, status: 'valid' | 'invalid') {
  return waitFor(
    async () => {
      const res = await callApi(api, 'GET', 'me/ai-keys', token);
      const key = res.body.keys?.find((k: { provider: string }) => k.provider === 'stub');
      return key?.status === status ? key : undefined;
    },
    { timeoutMs: 90_000, intervalMs: 2_000 },
  );
}

describe('own AI keys (deployed)', () => {
  it('saves, checks, uses, and deletes a key, within the daily check limit', async () => {
    const token = user.accessToken;
    const save = (apiKey: string) =>
      callApi(api, 'PUT', 'me/ai-keys/stub', token, {
        apiKey,
        modelId: 'stub-model',
        consent: true,
      });

    // Check 1: a working key.
    const saved = await save(VALID);
    expect(saved.status).toBe(202);
    expect(saved.body).toMatchObject({
      provider: 'stub',
      last4: 'alid',
      modelId: 'stub-model',
      status: 'checking',
    });
    const valid = await waitForStatus(token, 'valid');
    expect(valid.checkedAt).toBeDefined();
    expect(valid.ciphertext).toBeUndefined();

    // The default can point to it, and a crawl can choose it or inherit it.
    const settings = await callApi(api, 'PUT', 'me/ai-settings', token, {
      defaultSource: 'stub',
      version: 0,
    });
    expect(settings.status).toBe(200);
    expect(settings.body).toEqual({ defaultSource: 'stub', version: 1 });
    const chosen = await callApi(api, 'POST', 'me/crawls', token, {
      url: new URL('test-site/jobs?page=31', testSite).href,
      aiSource: 'platform',
    });
    expect(chosen.status).toBe(202);
    expect(chosen.body.aiSource).toBe('platform');
    await waitFor(
      async () => {
        const c = await callApi(api, 'GET', `me/crawls/${chosen.body.crawlId}`, token);
        return ['succeeded', 'failed'].includes(c.body.status) ? true : undefined;
      },
      { timeoutMs: 120_000 },
    );
    const inherited = await callApi(api, 'POST', 'me/crawls', token, {
      url: new URL('test-site/jobs?page=32', testSite).href,
    });
    expect(inherited.status).toBe(202);
    expect(inherited.body.aiSource).toBe('stub');

    // Check 2: a key the provider rejects replaces it; it can no longer be chosen.
    expect((await save(INVALID)).status).toBe(202);
    const invalid = await waitForStatus(token, 'invalid');
    expect(invalid.reason).toBe('rejected');
    const refused = await callApi(api, 'POST', 'me/crawls', token, {
      url: new URL('test-site/jobs?page=33', testSite).href,
      aiSource: 'stub',
    });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('ai-key-not-usable');

    // Check 3: a re-check.
    const recheck = await callApi(api, 'POST', 'me/ai-keys/stub/check', token);
    expect(recheck.status).toBe(202);
    expect(recheck.body.status).toBe('checking');
    await waitForStatus(token, 'invalid');

    // Deleting the default key sets the default back to the platform model.
    expect((await callApi(api, 'DELETE', 'me/ai-keys/stub', token)).status).toBe(204);
    expect((await callApi(api, 'GET', 'me/ai-keys', token)).body.keys).toEqual([]);
    expect((await callApi(api, 'GET', 'me/ai-settings', token)).body).toEqual({
      defaultSource: 'platform',
      version: 2,
    });
    expect((await callApi(api, 'DELETE', 'me/ai-keys/stub', token)).status).toBe(404);

    // Checks 4 and 5, then the sixth is refused (the limit is 5 a day).
    expect((await save(VALID)).status).toBe(202);
    await waitForStatus(token, 'valid');
    expect((await callApi(api, 'POST', 'me/ai-keys/stub/check', token)).status).toBe(202);
    const over = await callApi(api, 'POST', 'me/ai-keys/stub/check', token);
    expect(over.status).toBe(429);
    expect(over.body.code).toBe('key-check-limit-reached');

    // The audit history has every step, and never the key.
    const audit = await callApi(api, 'GET', 'me/audit?limit=50', token);
    const names = audit.body.entries.map((e: { name: string }) => e.name);
    for (const name of [
      'ai_key.saved',
      'ai_key.checked',
      'ai_key.check_requested',
      'ai_key.deleted',
      'ai_settings.changed',
    ]) {
      expect(names).toContain(name);
    }
    const text = JSON.stringify(audit.body);
    expect(text).not.toContain(VALID);
    expect(text).not.toContain(INVALID);
  });

  it('refuses unknown providers and keys that do not look like the provider’s, before any check', async () => {
    const token = user.accessToken;
    expect((await callApi(api, 'PUT', 'me/ai-keys/gemini', token, {})).status).toBe(404);
    const wrong = await callApi(api, 'PUT', 'me/ai-keys/openai', token, {
      apiKey: 'not-an-openai-key-000000',
      modelId: 'gpt-test',
      consent: true,
    });
    expect(wrong.status).toBe(400);
    const noConsent = await callApi(api, 'PUT', 'me/ai-keys/openai', token, {
      apiKey: 'sk-test-000000000000000000',
      modelId: 'gpt-test',
    });
    expect(noConsent.status).toBe(400);
  });
});
