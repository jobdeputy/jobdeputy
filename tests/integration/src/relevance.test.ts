import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callApi, createTestUser, stackOutputs, type TestUser, waitFor } from './stack.js';

/**
 * Deployed wiring of T08d: a crawl with an AI source → the second Pipe on the crawls stream
 * → the relevance worker → scores on the jobs, low scores hidden, tokens counted. Uses the
 * dev-only `stub` provider, which answers by a fixed rule (packages/llm relevance-stub.ts:
 * 90 when the title's first word is in the headline, else 10), so no call leaves AWS and
 * the result is the same every run. Prompts, limits, and failures are unit-tested.
 */
let api: string;
let testSite: string;
let user: TestUser;

// Built from repeated letters, so no secret scanner mistakes it for a real key.
const STUB_KEY = `stub-relevance-${'x'.repeat(8)}-valid`;

beforeAll(async () => {
  const outputs = await stackOutputs();
  api = outputs.ApiUrl ?? '';
  testSite = outputs.TestSiteUrl ?? '';
  user = await createTestUser(outputs);
}, 60_000);

afterAll(async () => {
  await user?.delete();
});

describe('AI relevance scoring (deployed)', () => {
  it('scores the candidates, hides the low score, says why, and counts the tokens', async () => {
    const token = user.accessToken;
    const profile = await callApi(api, 'PUT', 'me/profile', token, {
      version: 0,
      firstName: 'Score',
      lastName: 'Me',
      headline: 'Backend developer',
    });
    expect(profile.status).toBe(200);
    const roles: Record<string, string> = {};
    for (const title of ['Backend Engineer', 'Data Engineer']) {
      const role = await callApi(api, 'POST', 'me/roles', token, { title });
      expect(role.status).toBe(201);
      roles[title] = role.body.roleId;
    }
    expect(
      (
        await callApi(api, 'PUT', 'me/ai-keys/stub', token, {
          apiKey: STUB_KEY,
          modelId: 'stub-model',
          consent: true,
        })
      ).status,
    ).toBe(202);
    await waitFor(
      async () => {
        const res = await callApi(api, 'GET', 'me/ai-keys', token);
        return res.body.keys?.[0]?.status === 'valid' ? true : undefined;
      },
      { timeoutMs: 90_000, intervalMs: 2_000 },
    );

    // The page has two jobs; both titles match a role, so both are candidates.
    const submitted = await callApi(api, 'POST', 'me/crawls', token, {
      url: new URL('test-site/jobs-schema-org', testSite).href,
      aiSource: 'stub',
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(202);
    const crawlId = submitted.body.crawlId as string;
    const crawl = await waitFor(
      async () => {
        const res = await callApi(api, 'GET', `me/crawls/${crawlId}`, token);
        const status = res.body.relevance?.status;
        return status === 'done' || status === 'failed' || res.body.status === 'failed'
          ? res.body
          : undefined;
      },
      { timeoutMs: 180_000, intervalMs: 3_000 },
    );
    expect(crawl).toMatchObject({
      status: 'succeeded',
      stats: { jobsRelevant: 2 },
      relevance: {
        status: 'done',
        stats: { candidates: 2, scored: 2, reused: 0, unscored: 0, hidden: 1, overLimit: 0 },
      },
      llm: { keySource: 'own', provider: 'stub', model: 'stub-model', calls: 1 },
    });

    const all = await callApi(api, 'GET', 'me/jobs?view=all', token);
    // biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary JSON responses.
    const byTitle = new Map<string, any>(all.body.jobs.map((j: any) => [j.title, j]));
    expect(byTitle.get('Backend Engineer')).toMatchObject({
      hidden: false,
      relevance: {
        score: 90,
        bestRoleId: roles['Backend Engineer'],
        reasons: ['Stub: the title matches the headline'],
      },
      fit: { state: 'candidate', limitState: 'counted' },
    });
    const low = byTitle.get('Data Engineer');
    expect(low).toMatchObject({
      hidden: true,
      relevance: { score: 10, bestRoleId: roles['Data Engineer'], reasons: ['Stub: no match'] },
      fit: { state: 'not_relevant', reasons: ['title_match', 'llm_low_score'] },
    });
    expect(low.expiresAt).toBeDefined();

    // The default list shows only the job that fits.
    const shown = await callApi(api, 'GET', 'me/jobs', token);
    expect(shown.body.jobs.map((j: { title: string }) => j.title)).toEqual(['Backend Engineer']);

    // The stub's tokens, on the user's own key, for the relevance task; one run.
    const usage = await callApi(api, 'GET', 'me/ai-usage', token);
    expect(usage.body.models).toEqual([
      expect.objectContaining({
        keySource: 'own',
        provider: 'stub',
        modelId: 'stub-model',
        calls: 1,
        runs: 1,
        byTask: { relevance: expect.objectContaining({ calls: 1 }) },
      }),
    ]);
  });
});
