import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { FetchError, type FetchedPage } from '../src/fetch/fetcher.js';
import {
  CRAWL_LIMITS,
  EXTRACTION_VERSION,
  type FetchFn,
  readJobs,
} from '../src/jobs/crawl-jobs.js';

const NOW = new Date('2026-09-29T12:00:00Z');
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/jobs/${name}`, import.meta.url), 'utf8');

function response(url: string, body: string, contentType = 'text/html'): FetchedPage {
  return {
    url,
    status: 200,
    contentType,
    charset: 'utf-8',
    body: new TextEncoder().encode(body),
    redirects: [],
  };
}

/** A fetch that serves fixed responses by URL and fails on anything else. */
function serve(pages: Record<string, FetchedPage>) {
  return vi.fn<FetchFn>(async (url) => {
    const page = pages[url];
    if (!page) throw new FetchError('not_found', false, url);
    return page;
  });
}

const GREENHOUSE_API = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs';

describe('readJobs', () => {
  it('a job-board link reads the feed without fetching the page', async () => {
    const feed = response(GREENHOUSE_API, fixture('greenhouse-list.json'), 'application/json');
    const fetch = serve({ [GREENHOUSE_API]: feed });
    const reading = await readJobs('https://job-boards.greenhouse.io/acme', fetch, { now: NOW });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(GREENHOUSE_API, {});
    expect(reading.page).toBe(feed);
    expect(reading.board).toEqual({ ats: 'greenhouse', slug: 'acme' });
    expect(reading.extraction).toEqual({
      outcome: 'read',
      method: 'ats_feed',
      board: 'greenhouse:acme',
      skipped: 2,
    });
    expect(reading).toMatchObject({ requests: 1, complete: true });
    expect(reading.jobs).toHaveLength(2);
    expect(reading.jobs[0]).toMatchObject({
      title: 'Backend Engineer',
      extraction: { method: 'ats_feed', version: EXTRACTION_VERSION },
    });
    expect(reading.jobs[0]?.contentHash).toMatch(/^[0-9a-f]{32}$/);
    // The list has no descriptions: nothing to hash, nothing to overwrite.
    expect(reading.jobs[0]).not.toHaveProperty('descriptionHash');
    expect(reading.jobs[0]).not.toHaveProperty('method');
  });

  it("Workday's list is a JSON POST", async () => {
    const api = 'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs';
    const fetch = serve({ [api]: response(api, fixture('workday-list.json'), 'application/json') });
    const reading = await readJobs('https://acme.wd5.myworkdayjobs.com/en-US/External', fetch, {
      now: NOW,
    });
    expect(fetch).toHaveBeenCalledWith(api, {
      json: { appliedFacets: {}, limit: 20, offset: 0, searchText: '' },
    });
    expect(reading.jobs).toHaveLength(3);
  });

  it('a careers page embedding a board: the page, then the board (two requests)', async () => {
    const pageUrl = 'https://acme.example/careers';
    const html =
      '<html><body><h1>Careers</h1><div id="grnhse_app"></div><script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script></body></html>';
    const fetch = serve({
      [pageUrl]: response(pageUrl, html),
      [GREENHOUSE_API]: response(
        GREENHOUSE_API,
        fixture('greenhouse-list.json'),
        'application/json',
      ),
    });
    const reading = await readJobs(pageUrl, fetch, { now: NOW });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([pageUrl, GREENHOUSE_API]);
    // The page is what is stored; the jobs come from the board.
    expect(reading.page.url).toBe(pageUrl);
    expect(reading.extraction.board).toBe('greenhouse:acme');
    expect(reading.jobs).toHaveLength(2);
  });

  it('a script-built page that embeds a board is read, not failed as needs_browser', async () => {
    const pageUrl = 'https://acme.example/careers';
    const shell =
      '<html><head><script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script></head><body><div id="root"></div></body></html>';
    const fetch = serve({
      [pageUrl]: response(pageUrl, shell),
      [GREENHOUSE_API]: response(
        GREENHOUSE_API,
        fixture('greenhouse-list.json'),
        'application/json',
      ),
    });
    expect((await readJobs(pageUrl, fetch, { now: NOW })).jobs).toHaveLength(2);
  });

  it('a page with schema.org jobs', async () => {
    const pageUrl = 'https://acme.example/careers';
    const fetch = serve({ [pageUrl]: response(pageUrl, fixture('schema-org-page.html')) });
    const reading = await readJobs(pageUrl, fetch, { now: NOW });
    expect(reading.extraction).toEqual({ outcome: 'read', method: 'schema_org', skipped: 0 });
    expect(reading.board).toBeUndefined();
    expect(reading.jobs.map((j) => j.title)).toEqual([
      'Site Reliability Engineer',
      'Remote Writer',
    ]);
    expect(reading.jobs[0]).toMatchObject({ descriptionTruncated: false });
    expect(reading.jobs[0]?.descriptionHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('a page with nothing readable: no jobs, and a note saying so', async () => {
    const pageUrl = 'https://acme.example/careers';
    const fetch = serve({
      [pageUrl]: response(pageUrl, '<html><body><ul><li>Engineer, Pune</li></ul></body></html>'),
    });
    expect(await readJobs(pageUrl, fetch, { now: NOW })).toMatchObject({
      jobs: [],
      extraction: { outcome: 'no_readable_jobs', skipped: 0 },
      // Nothing read: nothing can be known to have closed.
      complete: false,
    });
  });

  it('a script-built page with nothing readable fails as needs_browser', async () => {
    const pageUrl = 'https://acme.example/careers';
    const shell =
      '<html><head><script src="/a.js"></script></head><body><div id="root"></div></body></html>';
    const fetch = serve({ [pageUrl]: response(pageUrl, shell) });
    await expect(readJobs(pageUrl, fetch, { now: NOW })).rejects.toMatchObject({
      code: 'needs_browser',
      retriable: false,
    });
  });

  it('a feed in an unknown format fails as unreadable_feed, not retried', async () => {
    const fetch = serve({
      [GREENHOUSE_API]: response(GREENHOUSE_API, '{"postings":[]}', 'application/json'),
    });
    await expect(
      readJobs('https://boards.greenhouse.io/acme', fetch, { now: NOW }),
    ).rejects.toMatchObject({
      code: 'unreadable_feed',
      retriable: false,
    });
  });

  it('failures of the feed request are the crawl failures (robots.txt, blocks, retries)', async () => {
    const fetch = vi.fn<FetchFn>(async () => {
      throw new FetchError('http_error', true, 'HTTP 503');
    });
    await expect(readJobs('https://jobs.lever.co/acme', fetch, { now: NOW })).rejects.toMatchObject(
      {
        code: 'http_error',
        retriable: true,
      },
    );
  });

  it(`saves at most ${CRAWL_LIMITS.maxJobs} jobs, and says the crawl was partial`, async () => {
    const jobs = Array.from({ length: CRAWL_LIMITS.maxJobs + 20 }, (_, i) => ({
      id: i + 1,
      title: `Role ${i}`,
      absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${i + 1}`,
    }));
    const fetch = serve({
      [GREENHOUSE_API]: response(GREENHOUSE_API, JSON.stringify({ jobs }), 'application/json'),
    });
    const reading = await readJobs('https://boards.greenhouse.io/acme', fetch, { now: NOW });
    expect(reading.jobs).toHaveLength(CRAWL_LIMITS.maxJobs);
    expect(reading.extraction.partial).toEqual({ reason: 'max_jobs' });
    expect(reading.complete).toBe(false);
  });
});

describe('paging within one crawl (T07c)', () => {
  const LEVER = 'https://api.lever.co/v0/postings/acme?mode=json';
  const leverPage = (skip: number, count: number) =>
    JSON.stringify(
      Array.from({ length: count }, (_, i) => ({
        id: `6ed76ce8-4156-4b60-b120-${String(skip + i).padStart(12, '0')}`,
        text: `Role ${skip + i}`,
        hostedUrl: `https://jobs.lever.co/acme/${skip + i}`,
      })),
    );

  /**
   * A fake clock: each request takes `requestMs`, and sleeping moves time on, so the
   * gap and the budget are tested without real waiting.
   */
  function world(pages: (skip: number) => string | Error, requestMs = 200) {
    let t = 0;
    const log: { url: string; at: number }[] = [];
    const sleep = vi.fn(async (ms: number) => {
      t += ms;
    });
    const fetch = vi.fn<FetchFn>(async (url) => {
      log.push({ url, at: t });
      t += requestMs;
      const skip = Number(new URL(url).searchParams.get('skip'));
      const body = pages(skip);
      if (body instanceof Error) throw body;
      return response(url, body, 'application/json');
    });
    return { fetch, sleep, log, options: { now: NOW, clock: () => t, sleep } };
  }

  it('follows next pages, at least a second apart on one host, until the last page', async () => {
    const w = world((skip) => leverPage(skip, skip < 100 ? 50 : 7));
    const reading = await readJobs('https://jobs.lever.co/acme', w.fetch, w.options);
    expect(w.log.map((r) => new URL(r.url).searchParams.get('skip'))).toEqual(['0', '50', '100']);
    for (let i = 1; i < w.log.length; i++) {
      expect((w.log[i]?.at ?? 0) - (w.log[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(
        CRAWL_LIMITS.hostGapMs,
      );
    }
    expect(reading.jobs).toHaveLength(107);
    expect(reading).toMatchObject({ requests: 3, complete: true });
    expect(reading.extraction.partial).toBeUndefined();
    // The stored page is the first response.
    expect(reading.page.url).toBe(`${LEVER}&limit=50&skip=0`);
  });

  it(`stops after ${CRAWL_LIMITS.maxExtraRequests} more requests (partial: max_pages)`, async () => {
    // Workday: 20 a page and a large total, so jobs never reach the job limit first.
    const api = 'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs';
    let n = 0;
    const fetch = vi.fn<FetchFn>(async (url) => {
      const postings = Array.from({ length: 20 }, (_, i) => ({
        title: `Role ${n * 20 + i}`,
        externalPath: `/job/X/Role_JR${n * 20 + i}`,
      }));
      n += 1;
      return response(
        url,
        JSON.stringify({ total: 5000, jobPostings: postings }),
        'application/json',
      );
    });
    const reading = await readJobs('https://acme.wd5.myworkdayjobs.com/External', fetch, {
      now: NOW,
      clock: () => 0,
      sleep: async () => undefined,
    });
    expect(fetch).toHaveBeenCalledTimes(1 + CRAWL_LIMITS.maxExtraRequests);
    expect(fetch.mock.calls.every(([url]) => url === api)).toBe(true);
    expect(reading.jobs).toHaveLength(20 * (1 + CRAWL_LIMITS.maxExtraRequests));
    expect(reading.extraction.partial).toEqual({ reason: 'max_pages' });
    expect(reading.complete).toBe(false);
  });

  it(`stops at ${CRAWL_LIMITS.maxJobs} jobs (partial: max_jobs)`, async () => {
    const w = world((skip) => leverPage(skip, 50));
    const reading = await readJobs('https://jobs.lever.co/acme', w.fetch, w.options);
    expect(reading.jobs).toHaveLength(CRAWL_LIMITS.maxJobs);
    expect(w.fetch).toHaveBeenCalledTimes(CRAWL_LIMITS.maxJobs / 50);
    expect(reading.extraction.partial).toEqual({ reason: 'max_jobs' });
  });

  it('never starts a request that could not finish within the time budget (partial: time_budget)', async () => {
    // Requests take 40 s here, and may take up to 20 s: the fifth would start at 164 s.
    const w = world((skip) => leverPage(skip, 50), 40_000);
    const reading = await readJobs('https://jobs.lever.co/acme', w.fetch, {
      ...w.options,
      requestMs: 20_000,
    });
    expect(w.fetch).toHaveBeenCalledTimes(4);
    expect(reading.jobs).toHaveLength(200);
    expect(reading.extraction.partial).toEqual({ reason: 'time_budget' });
  });

  it('a later page that fails keeps what was read (partial: page_failed)', async () => {
    const w = world((skip) =>
      skip === 0 ? leverPage(0, 50) : new FetchError('http_error', true, 'HTTP 503'),
    );
    const reading = await readJobs('https://jobs.lever.co/acme', w.fetch, w.options);
    expect(reading.jobs).toHaveLength(50);
    expect(reading.extraction.partial).toEqual({ reason: 'page_failed' });
    expect(reading.complete).toBe(false);
  });

  it('a later page in an unknown format also keeps what was read', async () => {
    const w = world((skip) => (skip === 0 ? leverPage(0, 50) : '{"not":"a list"}'));
    const reading = await readJobs('https://jobs.lever.co/acme', w.fetch, w.options);
    expect(reading.jobs).toHaveLength(50);
    expect(reading.extraction.partial).toEqual({ reason: 'page_failed' });
  });

  it('a bug on a later page is not hidden as partial', async () => {
    const w = world((skip) => (skip === 0 ? leverPage(0, 50) : new TypeError('bug')));
    await expect(readJobs('https://jobs.lever.co/acme', w.fetch, w.options)).rejects.toThrow(
      TypeError,
    );
  });

  it('the same job on two pages (the list moved while paging) is kept once', async () => {
    const w = world((skip) => (skip === 0 ? leverPage(0, 50) : leverPage(40, 10)));
    const reading = await readJobs('https://jobs.lever.co/acme', w.fetch, w.options);
    expect(reading.jobs).toHaveLength(50);
    expect(reading.complete).toBe(true);
  });

  it('no gap is waited between different hosts (a careers page, then its board)', async () => {
    const pageUrl = 'https://acme.example/careers';
    const sleep = vi.fn(async () => undefined);
    const fetch = serve({
      [pageUrl]: response(pageUrl, '<a href="https://jobs.lever.co/acme">Jobs</a>'),
      [`${LEVER}&limit=50&skip=0`]: response(LEVER, leverPage(0, 3), 'application/json'),
    });
    const reading = await readJobs(pageUrl, fetch, { now: NOW, clock: () => 0, sleep });
    expect(sleep).not.toHaveBeenCalled();
    expect(reading).toMatchObject({ requests: 2, complete: true });
  });
});
