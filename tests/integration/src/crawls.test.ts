import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callApi, createTestUser, stackOutputs, type TestUser, waitFor } from './stack.js';

/**
 * Deployed wiring of T06b: POST /me/crawls → crawls table → stream → Pipe → queue →
 * crawl worker → S3 and the audit history. Pages come from the stack's own dev-only
 * test site, never someone else's site. Fetch rules, retries, and every failure code
 * are unit-tested. See docs/testing.md.
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

async function submit(url: string): Promise<string> {
  const res = await callApi(api, 'POST', 'me/crawls', user.accessToken, { url });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  expect(res.body.status).toBe('queued');
  return res.body.crawlId as string;
}

/** Waits until every crawl has finished, polling one list call (gentle on the dev API's throttle). */
// biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary JSON responses.
async function finished(crawlIds: string[]): Promise<Map<string, any>> {
  return waitFor(
    async () => {
      const res = await callApi(api, 'GET', 'me/crawls?limit=50', user.accessToken);
      // biome-ignore lint/suspicious/noExplicitAny: as above.
      const byId = new Map<string, any>(res.body.crawls?.map((c: any) => [c.crawlId, c]) ?? []);
      const done = crawlIds.every((id) => ['succeeded', 'failed'].includes(byId.get(id)?.status));
      return done ? byId : undefined;
    },
    { timeoutMs: 180_000, intervalMs: 3_000 },
  );
}

describe('crawls (deployed)', () => {
  it('fetches a page in the background, stores it, and records it in the audit history', async () => {
    const url = site('jobs');
    const crawlId = await submit(url);
    const crawl = (await finished([crawlId])).get(crawlId);
    expect(crawl).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      url,
      result: { finalUrl: url, httpStatus: 200, contentType: 'text/html' },
    });
    expect(crawl.result.bytes).toBeGreaterThan(300);
    expect(crawl.result).not.toHaveProperty('s3Key');

    const one = await callApi(api, 'GET', `me/crawls/${crawlId}`, user.accessToken);
    expect(one.body).toMatchObject({ crawlId, status: 'succeeded' });

    const audit = await callApi(api, 'GET', 'me/audit', user.accessToken);
    const names = audit.body.entries
      .filter((e: { entity: { id: string } }) => e.entity.id === crawlId)
      .map((e: { name: string }) => e.name);
    // Newest first.
    expect(names).toEqual(['crawl.succeeded', 'crawl.requested']);
  });

  it('refuses internal addresses and login-only sites when submitted', async () => {
    for (const [url, code] of [
      ['http://169.254.169.254/latest/meta-data/', 'blocked_address'],
      ['http://127.0.0.1/', 'blocked_address'],
      ['https://www.linkedin.com/jobs', 'login_required'],
    ]) {
      const res = await callApi(api, 'POST', 'me/crawls', user.accessToken, { url });
      expect(res.status, url).toBe(400);
      expect(res.body.code, url).toBe(code);
    }
  });

  it('ends each kind of failure as failed with its reason, without retrying', async () => {
    const cases: [string, string][] = [
      [site('redirect-metadata'), 'blocked_address'],
      [site('login'), 'login_required'],
      [site('shell'), 'needs_browser'],
      [site('blocked'), 'blocked'],
      [site('no-such-page'), 'not_found'],
      // RFC 6761: never resolves.
      ['https://jobdeputy-integration-test.invalid/careers', 'unreachable'],
    ];
    // Submitted in batches no larger than the stack's limit of crawls in progress at once.
    const { maxActive } = (await callApi(api, 'GET', 'me/crawl-settings', user.accessToken)).body;
    const ids: string[] = [];
    const crawls = new Map<string, unknown>();
    for (let i = 0; i < cases.length; i += maxActive) {
      const batch: string[] = [];
      for (const [url] of cases.slice(i, i + maxActive)) batch.push(await submit(url));
      for (const [id, crawl] of await finished(batch)) crawls.set(id, crawl);
      ids.push(...batch);
    }
    cases.forEach(([url, code], i) => {
      expect(crawls.get(ids[i] as string), url).toMatchObject({
        status: 'failed',
        attempts: 1,
        error: { code },
      });
    });
  });

  it('returns the active crawl when the same page is submitted again, and retries a site that is down', async () => {
    // The page answers 503, so the crawl stays active for minutes (retries after 30 s and 120 s).
    const url = site('unavailable');
    const crawlId = await submit(url);
    const again = await callApi(api, 'POST', 'me/crawls', user.accessToken, {
      url: `${url}#same-page`,
    });
    expect(again.status).toBe(200);
    expect(again.body.crawlId).toBe(crawlId);

    const retrying = await waitFor(
      async () => {
        const res = await callApi(api, 'GET', `me/crawls/${crawlId}`, user.accessToken);
        return res.body.lastError ? res.body : undefined;
      },
      { timeoutMs: 120_000, intervalMs: 3_000 },
    );
    expect(retrying).toMatchObject({ status: 'running', lastError: { code: 'http_error' } });
    // Left running on purpose: deleting the account afterwards stops it (T12).
  });

  it("keeps each user's crawls and audit history private", async () => {
    const crawlId = await submit(site('jobs'));
    const peek = await callApi(api, 'GET', `me/crawls/${crawlId}`, other.accessToken);
    expect(peek.status).toBe(404);
    const [crawls, audit] = await Promise.all([
      callApi(api, 'GET', 'me/crawls', other.accessToken),
      callApi(api, 'GET', 'me/audit', other.accessToken),
    ]);
    expect(crawls.body.crawls).toEqual([]);
    expect(audit.body.entries).toEqual([]);
    await finished([crawlId]);
  });
});
