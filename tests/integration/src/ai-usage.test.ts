import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callApi, createTestUser, stackOutputs, type TestUser, waitFor } from './stack.js';

/**
 * Deployed wiring of T08b3 (decision 0009): the free platform AI run is counted when a crawl
 * with the platform model is submitted (ISO week and month, exact caps), refused once used
 * up, and given back when the crawl fails. Token counters are unit-tested (no LLM runs yet:
 * T08d is the first). Assumes the default of 1 free run a week; read from the API.
 */
let api: string;
let testSite: string;
let users: TestUser[] = [];

beforeAll(async () => {
  const outputs = await stackOutputs();
  api = outputs.ApiUrl ?? '';
  testSite = outputs.TestSiteUrl ?? '';
  users = await Promise.all([
    createTestUser(outputs),
    createTestUser(outputs),
    createTestUser(outputs),
  ]);
}, 90_000);

afterAll(async () => {
  await Promise.all(users.map((u) => u.delete()));
});

const site = (page: string) => new URL(`test-site/${page}`, testSite).href;
const usage = async (token: string) => (await callApi(api, 'GET', 'me/ai-usage', token)).body;
const finished = (token: string, crawlId: string) =>
  waitFor(
    async () => {
      const c = await callApi(api, 'GET', `me/crawls/${crawlId}`, token);
      return ['succeeded', 'failed'].includes(c.body.status) ? c.body : undefined;
    },
    { timeoutMs: 120_000 },
  );

describe('free platform AI runs (deployed)', () => {
  it('uses the week’s run with a platform crawl, then refuses the next; none still works', async () => {
    const token = (users[0] as TestUser).accessToken;
    const start = await usage(token);
    expect(start.models).toEqual([]);
    expect(start.platformRuns).toMatchObject({
      usedThisWeek: 0,
      usedThisMonth: 0,
      available: true,
    });
    expect(start.platformRuns.perWeek).toBe(1);

    const first = await callApi(api, 'POST', 'me/crawls', token, {
      url: site('jobs?page=41'),
      aiSource: 'platform',
    });
    expect(first.status).toBe(202);
    await finished(token, first.body.crawlId);
    const used = await usage(token);
    expect(used.platformRuns).toMatchObject({
      usedThisWeek: 1,
      usedThisMonth: 1,
      available: false,
    });
    expect(Date.parse(used.platformRuns.nextAvailableAt)).toBeGreaterThan(Date.now());

    const refused = await callApi(api, 'POST', 'me/crawls', token, {
      url: site('jobs?page=42'),
      aiSource: 'platform',
    });
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('platform-ai-limit-reached');
    // The default source is the platform model too, so a crawl that does not choose is refused.
    expect(
      (await callApi(api, 'POST', 'me/crawls', token, { url: site('jobs?page=42') })).status,
    ).toBe(429);

    const none = await callApi(api, 'POST', 'me/crawls', token, {
      url: site('jobs?page=42'),
      aiSource: 'none',
    });
    expect(none.status).toBe(202);
    expect(none.body.aiSource).toBe('none');
  });

  it('gives the run back when the crawl fails before any AI work', async () => {
    const token = (users[1] as TestUser).accessToken;
    const blocked = await callApi(api, 'POST', 'me/crawls', token, {
      url: site('blocked'),
      aiSource: 'platform',
    });
    expect(blocked.status).toBe(202);
    expect((await finished(token, blocked.body.crawlId)).status).toBe('failed');
    expect((await usage(token)).platformRuns).toMatchObject({
      usedThisWeek: 0,
      usedThisMonth: 0,
      available: true,
    });
    const again = await callApi(api, 'POST', 'me/crawls', token, {
      url: site('jobs?page=43'),
      aiSource: 'platform',
    });
    expect(again.status).toBe(202);
  });

  it('never gives more runs than the limit, even to submits at the same moment', async () => {
    const token = (users[2] as TestUser).accessToken;
    const results = await Promise.all(
      [51, 52, 53, 54].map((n) =>
        callApi(api, 'POST', 'me/crawls', token, {
          url: site(`jobs?page=${n}`),
          aiSource: 'platform',
        }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    // Exactly one gets through; the others hit the free-run or in-progress limit (both 429).
    expect(statuses).toEqual([202, 429, 429, 429]);
    expect((await usage(token)).platformRuns).toMatchObject({ usedThisWeek: 1 });
  });
});
