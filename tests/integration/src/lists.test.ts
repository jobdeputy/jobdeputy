import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callApi, createTestUser, stackOutputs, type TestUser, waitFor } from './stack.js';

/**
 * Deployed wiring of #50, list runs: POST /me/crawls with a list → crawl worker reads the list
 * and chooses its companies → each company crawl is written `queued` (crawls stream → Pipe →
 * queue → crawl worker) → the last one to end ends the list. The list is the stack's own
 * dev-only test site (`list-simplify`), never GitHub; its readable companies are test-site
 * pages too. The list's one AI run uses the dev-only `stub` provider (packages/llm
 * relevance-stub.ts: 90 when a title's first word is in the headline, else 10). Choosing,
 * ranking, the 3-at-a-time hand-off, and the merge are unit-tested.
 */
const STUB_KEY = `stub-relevance-${'x'.repeat(8)}-valid`;
let api: string;
let testSite: string;
let user: TestUser;

beforeAll(async () => {
  const outputs = await stackOutputs();
  api = outputs.ApiUrl ?? '';
  testSite = outputs.TestSiteUrl ?? '';
  user = await createTestUser(outputs);
}, 60_000);

afterAll(async () => {
  await user?.delete();
});

const site = (page: string) => new URL(`test-site/${page}`, testSite).href;

describe('list runs (deployed)', () => {
  it('crawls the companies a list names, ends the list with their totals, and scores them in one AI run', async () => {
    const token = user.accessToken;
    const profile = await callApi(api, 'PUT', 'me/profile', token, {
      version: 0,
      firstName: 'List',
      lastName: 'Run',
      headline: 'Platform engineer',
    });
    expect(profile.status).toBe(200);
    // Every engineer role matches, so the list's companies are chosen by it; the headline only
    // steers the stub's scores.
    expect((await callApi(api, 'POST', 'me/roles', token, { title: 'Engineer' })).status).toBe(201);
    const key = await callApi(api, 'PUT', 'me/ai-keys/stub', token, {
      apiKey: STUB_KEY,
      modelId: 'stub-model',
      consent: true,
    });
    expect(key.status).toBe(202);
    await waitFor(
      async () => {
        const keys = await callApi(api, 'GET', 'me/ai-keys', token);
        return keys.body.keys?.[0]?.status === 'valid' ? true : undefined;
      },
      { timeoutMs: 90_000, intervalMs: 2_000 },
    );

    const res = await callApi(api, 'POST', 'me/crawls', token, {
      url: site('list-simplify'),
      aiSource: 'stub',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({ kind: 'list', status: 'queued' });
    const listId = res.body.crawlId as string;

    const list = await waitFor(
      async () => {
        const one = await callApi(api, 'GET', `me/crawls/${listId}`, token);
        const scored = ['done', 'failed'].includes(one.body.relevance?.status);
        return scored || one.body.status === 'failed' ? one.body : undefined;
      },
      { timeoutMs: 300_000, intervalMs: 5_000 },
    );
    expect(list, JSON.stringify(list)).toMatchObject({
      kind: 'list',
      status: 'succeeded',
      list: {
        // Six rows, one closed; Canada Co is outside the US.
        rows: 5,
        matched: 4,
        companiesMatched: 3,
        companies: [
          { name: 'Example Test Co', url: site('jobs-schema-org') },
          { name: 'Example Second Co', url: site('jobs-second') },
        ],
        skipped: 1,
        waiting: 0,
        running: 0,
        ended: 2,
      },
      // Two postings on the first company's page, one on the second's.
      stats: { jobsFound: 3, jobsRelevant: 3, companies: { succeeded: 2, failed: 0 } },
      // One run for the whole list: its companies' candidates, scored together.
      aiSource: 'stub',
      relevance: {
        status: 'done',
        stats: { candidates: 3, scored: 3, reused: 0, unscored: 0, hidden: 2 },
      },
      llm: { provider: 'stub', calls: 1 },
    });

    // Each company crawl names its list, and ended on its own.
    const children = await Promise.all(
      (list.list.crawlIds as string[]).map(
        async (id) => (await callApi(api, 'GET', `me/crawls/${id}`, user.accessToken)).body,
      ),
    );
    expect(children.map((c) => [c.parentCrawlId, c.status, c.aiSource])).toEqual([
      [listId, 'succeeded', 'none'],
      [listId, 'succeeded', 'none'],
    ]);

    // The crawl list shows the list run, not its company crawls (they are newer than it).
    const latest = await callApi(api, 'GET', 'me/crawls?limit=1', user.accessToken);
    expect(latest.body.crawls.map((c: { crawlId: string }) => c.crawlId)).toEqual([listId]);

    const jobs = await callApi(api, 'GET', 'me/jobs?view=all', user.accessToken);
    expect(jobs.body.jobs.map((j: { title: string }) => j.title).sort()).toEqual([
      'Backend Engineer',
      'Data Engineer',
      'Platform Engineer',
    ]);
    const shown = await callApi(api, 'GET', 'me/jobs', user.accessToken);
    expect(shown.body.jobs.map((j: { title: string }) => j.title)).toEqual(['Platform Engineer']);
  }, 330_000);

  it('crawls any other test-site page as a page, not a list', async () => {
    const res = await callApi(api, 'POST', 'me/crawls', user.accessToken, {
      url: site('jobs-second'),
      aiSource: 'none',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).not.toHaveProperty('kind');
  });
});
