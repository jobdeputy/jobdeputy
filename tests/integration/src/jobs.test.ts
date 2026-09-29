import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callApi, createTestUser, stackOutputs, type TestUser, waitFor } from './stack.js';

/**
 * Deployed wiring of T07b: a crawl reads the jobs on a page and saves them in the jobs
 * table, once each; GET /me/jobs lists them. Pages come from the stack's own dev-only test
 * site. Which sources are read, and how, is unit-tested (apps/worker/test/jobs-*.test.ts).
 */
let api: string;
let testSite: string;
let user: TestUser;
let other: TestUser;

beforeAll(async () => {
  const outputs = await stackOutputs();
  api = outputs.ApiUrl ?? '';
  testSite = outputs.TestSiteUrl ?? '';
  [user, other] = await Promise.all([createTestUser(outputs), createTestUser(outputs)]);
}, 60_000);

afterAll(async () => {
  await Promise.all([user?.delete(), other?.delete()]);
});

const site = (page: string) => new URL(`test-site/${page}`, testSite).href;

/** Submits a page and waits for its crawl to finish (the user has one crawl at a time). */
// biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary JSON responses.
async function crawl(url: string): Promise<any> {
  const res = await callApi(api, 'POST', 'me/crawls', user.accessToken, { url });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  const crawlId = res.body.crawlId as string;
  return waitFor(
    async () => {
      const one = await callApi(api, 'GET', `me/crawls/${crawlId}`, user.accessToken);
      return ['succeeded', 'failed'].includes(one.body.status) ? one.body : undefined;
    },
    { timeoutMs: 180_000, intervalMs: 3_000 },
  );
}

describe('jobs (deployed)', () => {
  it('saves the jobs a page describes, once each, however often it is crawled', async () => {
    const url = site('jobs-schema-org');
    const first = await crawl(url);
    expect(first).toMatchObject({
      status: 'succeeded',
      stats: { jobsFound: 2, jobsNew: 2, jobsUpdated: 0 },
      extraction: { outcome: 'read', method: 'schema_org', skipped: 0 },
    });

    const list = await callApi(api, 'GET', 'me/jobs', user.accessToken);
    expect(list.status).toBe(200);
    expect(list.body.jobs.map((j: { title: string }) => j.title).sort()).toEqual([
      'Backend Engineer',
      'Data Engineer',
    ]);
    const backend = list.body.jobs.find((j: { title: string }) => j.title === 'Backend Engineer');
    expect(backend).toMatchObject({
      companyName: 'Example Test Co',
      locations: [{ text: 'Pune, IN', city: 'Pune', country: 'IN' }],
      employmentType: 'full_time',
      jobUrl: site('jobs-schema-org/backend-engineer'),
      hasDescription: true,
      status: 'new',
      starred: false,
    });
    expect(backend).not.toHaveProperty('description');

    const one = await callApi(api, 'GET', `me/jobs/${backend.jobId}`, user.accessToken);
    expect(one.body).toMatchObject({
      description: 'Build the APIs of Example Test Co.\n\n- TypeScript\n- AWS',
      descriptionTruncated: false,
      firstCrawlId: first.crawlId,
      lastCrawlId: first.crawlId,
    });

    // Again: the same two jobs, updated in place (0008 deduplication).
    const second = await crawl(url);
    expect(second.stats).toEqual({ jobsFound: 2, jobsNew: 0, jobsUpdated: 0 });
    const again = await callApi(api, 'GET', 'me/jobs', user.accessToken);
    expect(again.body.jobs).toHaveLength(2);
    const updated = await callApi(api, 'GET', `me/jobs/${backend.jobId}`, user.accessToken);
    expect(updated.body).toMatchObject({
      firstCrawlId: first.crawlId,
      lastCrawlId: second.crawlId,
      firstSeenAt: one.body.firstSeenAt,
    });
    expect(updated.body.lastSeenAt > one.body.lastSeenAt).toBe(true);
  });

  it('a page with jobs only in plain HTML succeeds with none, and says why', async () => {
    const result = await crawl(site('jobs'));
    expect(result).toMatchObject({
      status: 'succeeded',
      stats: { jobsFound: 0, jobsNew: 0, jobsUpdated: 0 },
      extraction: { outcome: 'no_readable_jobs' },
    });
  });

  it("keeps each user's jobs private", async () => {
    const mine = await callApi(api, 'GET', 'me/jobs', user.accessToken);
    const jobId = mine.body.jobs[0]?.jobId as string;
    expect(jobId).toMatch(/^[0-9a-f]{32}$/);
    const [peek, theirs] = await Promise.all([
      callApi(api, 'GET', `me/jobs/${jobId}`, other.accessToken),
      callApi(api, 'GET', 'me/jobs', other.accessToken),
    ]);
    expect(peek.status).toBe(404);
    expect(theirs.body.jobs).toEqual([]);
    expect((await callApi(api, 'GET', 'me/jobs', undefined)).status).toBe(401);
  });
});
