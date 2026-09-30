import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  callApi,
  createTestUser,
  region,
  stackName,
  stackOutputs,
  type TestUser,
  waitFor,
} from './stack.js';

/** Queue- and table-level tests (as in ping-jobs): CI and nightly runs set it. */
const full = process.env.JD_FULL === '1';

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

/** The user's ID: the `sub` of their access token (what the API keys their data by). */
const userIdOf = (token: string): string =>
  JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()).sub;

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
    expect(second.stats).toEqual({
      jobsFound: 2,
      jobsNew: 0,
      jobsUpdated: 0,
      jobsClosed: 0,
      pagesFetched: 1,
    });
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

  // T07c. The test site holds no state, so the page cannot drop a job between crawls:
  // instead a job the page "listed before" is seeded, and must be closed by the next
  // complete crawl, while the jobs the page still lists stay open.
  it.runIf(full)('closes a job the page no longer lists, and only that one', async () => {
    const url = site('jobs-schema-org');
    const first = await crawl(url);
    expect(first.status).toBe('succeeded');
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
    const gone = 'f'.repeat(32);
    const now = new Date().toISOString();
    await db.send(
      new PutCommand({
        TableName: `${stackName()}-jobs`,
        Item: {
          userId: userIdOf(user.accessToken),
          jobId: gone,
          type: 'job',
          dedupeKey: 'url:https://example.com/closed-role',
          title: 'Closed Role',
          jobUrl: 'https://example.com/closed-role',
          companyKey: 'site:example.com',
          locations: [],
          contentHash: 'seeded',
          extraction: { method: 'schema_org', version: 1 },
          sourceIds: new Set([first.sourceId]),
          firstCrawlId: first.crawlId,
          lastCrawlId: first.crawlId,
          firstSeenAt: now,
          lastSeenAt: now,
          status: 'new',
          starred: false,
          createdAt: now,
          updatedAt: now,
          schemaVersion: 1,
        },
      }),
    );
    await db.send(
      new UpdateCommand({
        TableName: `${stackName()}-sources`,
        Key: { userId: userIdOf(user.accessToken), sourceId: first.sourceId },
        UpdateExpression: 'ADD listedJobIds :gone',
        ExpressionAttributeValues: { ':gone': new Set([gone]) },
      }),
    );

    const second = await crawl(url);
    expect(second.stats).toMatchObject({
      jobsFound: 2,
      jobsNew: 0,
      jobsClosed: 1,
      pagesFetched: 1,
    });
    const closed = await callApi(api, 'GET', `me/jobs/${gone}`, user.accessToken);
    expect(closed.body.closedAt).toBeDefined();
    expect(closed.body.sourceIds).toEqual([]);
    const list = await callApi(api, 'GET', 'me/jobs', user.accessToken);
    const open = list.body.jobs.filter((j: { closedAt?: string }) => j.closedAt === undefined);
    expect(open.map((j: { title: string }) => j.title).sort()).toEqual([
      'Backend Engineer',
      'Data Engineer',
    ]);
  });
});
