import { readFileSync } from 'node:fs';
import type { JobPosting } from '@jobdeputy/db';
import { describe, expect, it, vi } from 'vitest';
import { FetchError, type FetchedPage } from '../src/fetch/fetcher.js';
import type { Board } from '../src/jobs/boards.js';
import { DESCRIPTION_LIMITS, postingBoard, readDescriptions } from '../src/jobs/descriptions.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/jobs/${name}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-01T12:00:00Z');
const greenhouse: Board = { ats: 'greenhouse', slug: 'acme' };
const workday: Board = {
  ats: 'workday',
  host: 'acme.wd5.myworkdayjobs.com',
  tenant: 'acme',
  site: 'External',
};

const job = (jobId: string, over: { [K in keyof JobPosting]?: JobPosting[K] | undefined } = {}) =>
  ({
    jobId,
    title: 'Engineer',
    jobUrl: 'https://job-boards.greenhouse.io/acme/jobs/1',
    externalId: jobId,
    ...over,
  }) as JobPosting;

const json = (body: string): FetchedPage => ({
  url: 'https://boards-api.greenhouse.io/',
  status: 200,
  contentType: 'application/json',
  body: new TextEncoder().encode(body),
  redirects: [],
});

const options = (remainingMs = 120_000) => ({
  now: NOW,
  remainingMs: () => remainingMs,
  sleep: vi.fn(async () => undefined),
});

describe('postingBoard', () => {
  it('Greenhouse and Lever: the posting by its ID', () => {
    expect(postingBoard(greenhouse, job('4001001'))).toEqual({ ...greenhouse, job: '4001001' });
    expect(postingBoard(greenhouse, job('x', { externalId: undefined }))).toBeUndefined();
  });

  it("Workday: the path in the job's link, on the same host only", () => {
    const path = 'IN-Bengaluru/Firmware-Engineer_JR2000002';
    expect(
      postingBoard(
        workday,
        job('w', { jobUrl: `https://acme.wd5.myworkdayjobs.com/External/job/${path}` }),
      ),
    ).toEqual({ ...workday, job: path });
    expect(
      postingBoard(
        workday,
        job('w', { jobUrl: `https://other.wd5.myworkdayjobs.com/External/job/${path}` }),
      ),
    ).toBeUndefined();
    expect(postingBoard(workday, job('w', { jobUrl: 'not a url' }))).toBeUndefined();
  });

  it('Ashby: none (its list has descriptions)', () => {
    expect(postingBoard({ ats: 'ashby', slug: 'acme' }, job('a'))).toBeUndefined();
  });
});

describe('readDescriptions', () => {
  it('reads each posting from its endpoint, a host gap apart', async () => {
    const fetch = vi.fn(async () => json(fixture('greenhouse-job.json')));
    const opts = options();
    const result = await readDescriptions(greenhouse, [job('4001001')], fetch, opts);
    expect(fetch).toHaveBeenCalledWith(
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs/4001001',
    );
    expect(opts.sleep).toHaveBeenCalledWith(1_000);
    expect(result.stats).toEqual({ fetched: 1, gone: 0, failed: 0, skipped: 0 });
    const read = result.descriptions.get('4001001');
    expect(read?.description).toBeTruthy();
    expect(read?.descriptionHash).toMatch(/^[0-9a-f]+$/);
    expect(read?.descriptionTruncated).toBe(false);
  });

  it('reads a Workday posting', async () => {
    const fetch = vi.fn(async () => json(fixture('workday-job.json')));
    const path = 'IN-Bengaluru/Firmware-Engineer_JR2000002';
    const result = await readDescriptions(
      workday,
      [job('w', { jobUrl: `https://acme.wd5.myworkdayjobs.com/External/job/${path}` })],
      fetch,
      options(),
    );
    expect(fetch).toHaveBeenCalledWith(
      `https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/job/${path}`,
    );
    expect(result.descriptions.get('w')?.description).toBeTruthy();
  });

  it('404 or 410: the job is gone; other failures leave it without a description', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/gone')) throw new FetchError('not_found', false);
      if (url.endsWith('/down')) throw new FetchError('http_error', true, 'HTTP 503');
      if (url.endsWith('/odd')) return json('[]');
      if (url.endsWith('/empty')) return json('{"id": 1}');
      return json(fixture('greenhouse-job.json'));
    });
    const result = await readDescriptions(
      greenhouse,
      ['gone', 'down', 'odd', 'empty', 'ok', 'none'].map((id) =>
        job(id, id === 'none' ? { externalId: undefined } : {}),
      ),
      fetch,
      options(),
    );
    expect(result.gone).toEqual(['gone']);
    expect([...result.descriptions.keys()]).toEqual(['ok']);
    expect(result.stats).toEqual({ fetched: 1, gone: 1, failed: 4, skipped: 0 });
  });

  it('a block (403, 429) stops the reading', async () => {
    const fetch = vi.fn(async () => {
      throw new FetchError('blocked', false);
    });
    const result = await readDescriptions(
      greenhouse,
      [job('a'), job('b'), job('c')],
      fetch,
      options(),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.stats).toEqual({ fetched: 0, gone: 0, failed: 1, skipped: 2 });
  });

  it('stops at the request limit, or when time runs short', async () => {
    const fetch = vi.fn(async () => json(fixture('greenhouse-job.json')));
    const many = Array.from({ length: DESCRIPTION_LIMITS.maxRequests + 3 }, (_, i) => job(`${i}`));
    const capped = await readDescriptions(greenhouse, many, fetch, options());
    expect(capped.stats).toMatchObject({ fetched: DESCRIPTION_LIMITS.maxRequests, skipped: 3 });

    fetch.mockClear();
    // Exactly enough for the reserve, the gap, and a whole request: reads; a millisecond less: stops.
    let left = DESCRIPTION_LIMITS.reserveMs + 1_000 + 20_000;
    const late = await readDescriptions(greenhouse, [job('a'), job('b')], fetch, {
      ...options(),
      remainingMs: () => left,
    });
    expect(late.stats).toEqual({ fetched: 2, gone: 0, failed: 0, skipped: 0 });
    left -= 1;
    const short = await readDescriptions(greenhouse, [job('a'), job('b')], fetch, {
      ...options(),
      remainingMs: () => left,
    });
    expect(short.stats).toEqual({ fetched: 0, gone: 0, failed: 0, skipped: 2 });
  });

  it('a bug is not hidden', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('boom');
    });
    await expect(readDescriptions(greenhouse, [job('a')], fetch, options())).rejects.toThrow(
      'boom',
    );
  });
});
