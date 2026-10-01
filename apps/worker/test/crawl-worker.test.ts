import { readFileSync } from 'node:fs';
import type {
  Crawl,
  CrawlError,
  CrawlExtraction,
  CrawlResult,
  CrawlStats,
  FinishOutcome,
  JobPosting,
  ShownJobs,
  SourceUpdate,
} from '@jobdeputy/db';
import { ShownConflictError } from '@jobdeputy/db';
import { CRAWL_ERRORS, crawlKeys } from '@jobdeputy/shared';
import type { SQSRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import {
  type CrawlWorkerDeps,
  crawlErrorFrom,
  listed,
  MAX_LISTED_JOB_IDS,
  MAX_RECEIVES,
  processRecord,
  RETRY_BACKOFF_SECONDS,
  RetryLaterError,
} from '../src/crawl-worker.js';
import { FetchError, type FetchedPage } from '../src/fetch/fetcher.js';
import type { FetchFn } from '../src/jobs/crawl-jobs.js';
import { type FitInputs, SHOWN_ATTEMPTS } from '../src/relevance/fit.js';

const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const CRAWL = '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2D';
const URL_ = 'https://jobs.example.com/careers';
const NOW = new Date('2026-09-29T12:00:00Z');
/** T08c: hidden jobs expire 7 days after NOW (epoch seconds). */
const EXPIRES_AT = NOW.getTime() / 1000 + 7 * 86_400;

function record(receiveCount = 1, body: unknown = { userId: USER, crawlId: CRAWL }): SQSRecord {
  return {
    messageId: 'm1',
    receiptHandle: 'r1',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    attributes: { ApproximateReceiveCount: String(receiveCount) },
    eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:q',
  } as unknown as SQSRecord;
}

function page(over: Partial<FetchedPage> = {}): FetchedPage {
  return {
    url: URL_,
    status: 200,
    contentType: 'text/html',
    charset: 'utf-8',
    body: new TextEncoder().encode(
      '<html><body><h1>Jobs</h1><ul><li>Engineer, Pune</li></ul></body></html>',
    ),
    redirects: [],
    ...over,
  };
}

/** No roles: every job is a candidate (T08c); the filter itself is tested on its own. */
const NO_ROLES: FitInputs = {
  profile: { roles: [], skills: [] },
  companyLimit: 10,
  expiryDays: 7,
  relevanceMaxJobs: 50,
  relevanceMinScore: 30,
};

/** An in-memory crawl with the same transition rules as the DynamoDB repository. */
function setup(fetchImpl: FetchFn = async () => page(), fitInputs: FitInputs = NO_ROLES) {
  const state: {
    status: Crawl['status'];
    attempts: number;
    result?: CrawlResult;
    stats?: CrawlStats;
    extraction?: CrawlExtraction;
    source?: SourceUpdate;
    error?: CrawlError;
    lastError?: CrawlError;
    audit: string[];
    auditDetail?: unknown;
  } = { status: 'queued', attempts: 0, audit: [] };
  const crawl = (): Crawl =>
    ({ userId: USER, crawlId: CRAWL, sourceId: 'S1', url: URL_, ...state }) as unknown as Crawl;
  const fetch = vi.fn(fetchImpl);
  const shown = new Map<string, ShownJobs>();
  const deps = {
    repo: {
      start: vi.fn(async () => {
        if (state.status !== 'queued' && state.status !== 'running') return undefined;
        state.status = 'running';
        state.attempts += 1;
        return crawl();
      }),
      recordRetry: vi.fn(async (_u: string, _c: string, error: CrawlError) => {
        state.lastError = error;
      }),
      finish: vi.fn(async (_c: unknown, outcome: FinishOutcome, audit: { name: string }) => {
        if (state.status !== 'queued' && state.status !== 'running') return false;
        state.status = outcome.status;
        if (outcome.status === 'succeeded') {
          state.result = outcome.result;
          if (outcome.stats) state.stats = outcome.stats;
          if (outcome.extraction) state.extraction = outcome.extraction;
          if (outcome.source) state.source = outcome.source;
        } else state.error = outcome.error;
        delete state.lastError;
        state.audit.push(audit.name);
        state.auditDetail = (audit as { detail?: unknown }).detail;
        return true;
      }),
    },
    isBeingDeleted: vi.fn(async () => false),
    newFetcher: vi.fn((): FetchFn => fetch),
    storePage: vi.fn(async () => undefined),
    saveJobs: vi.fn(async (_u: string, jobs: JobPosting[]) => ({
      found: jobs.length,
      created: jobs.length,
      updated: 0,
    })),
    now: () => NOW,
    listedJobIds: vi.fn(async (): Promise<string[]> => []),
    closeJobs: vi.fn(async (_u: string, _s: string, ids: string[], _e: number) =>
      ids.map((jobId) => ({ jobId, companyKey: 'site:example.com' })),
    ),
    withDescription: vi.fn(async (_u: string, _ids: string[]) => new Set<string>()),
    closeGone: vi.fn(async (_u: string, ids: string[], _e: number) =>
      ids.map((jobId) => ({ jobId, companyKey: 'greenhouse:acme' })),
    ),
    fitInputs: vi.fn(async (): Promise<FitInputs> => fitInputs),
    shown: {
      get: vi.fn(async (_u: string, key: string) => shown.get(key) ?? { shown: {}, version: 0 }),
      put: vi.fn(async (_u: string, key: string, list: ShownJobs['shown'], version: number) => {
        shown.set(key, { shown: list, version: version + 1 });
      }),
      release: vi.fn(async () => undefined),
    },
    markOverLimit: vi.fn(async () => undefined),
    sleep: vi.fn(async () => undefined),
    delayRetry: vi.fn(async () => undefined),
    newId: () => '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2E',
    remainingMs: () => 60_000,
  } satisfies CrawlWorkerDeps;
  return { state, deps, fetch };
}

describe('crawl worker: success', () => {
  it('fetches the page, stores it under the crawl, and records success with an audit entry', async () => {
    const { state, deps, fetch } = setup();
    expect(await processRecord(record(), deps)).toBe('succeeded');
    const key = crawlKeys(USER, CRAWL).page;
    expect(fetch).toHaveBeenCalledWith(URL_, {});
    expect(deps.storePage).toHaveBeenCalledWith(key, expect.objectContaining({ status: 200 }));
    expect(state).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      result: { finalUrl: URL_, httpStatus: 200, contentType: 'text/html', s3Key: key },
      audit: ['crawl.succeeded'],
    });
    expect(state.result?.bytes).toBeGreaterThan(0);
  });

  it('stores JSON data feeds as they are', async () => {
    const { state, deps } = setup(async () =>
      page({ contentType: 'application/json', body: new TextEncoder().encode('{}') }),
    );
    expect(await processRecord(record(), deps)).toBe('succeeded');
    expect(state.result?.contentType).toBe('application/json');
  });

  it('does nothing for a duplicate delivery of a finished crawl', async () => {
    const { state, deps, fetch } = setup();
    await processRecord(record(), deps);
    expect(await processRecord(record(), deps)).toBe('skipped');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.audit).toEqual(['crawl.succeeded']);
  });

  it('writes nothing for an account being deleted', async () => {
    const { state, deps } = setup();
    deps.isBeingDeleted.mockResolvedValue(true);
    expect(await processRecord(record(), deps)).toBe('skipped');
    expect(deps.repo.start).not.toHaveBeenCalled();
    expect(deps.storePage).not.toHaveBeenCalled();
    expect(state.status).toBe('queued');
  });
});

describe('crawl worker: failures that end the crawl at once', () => {
  it.each([
    ['blocked_address'],
    ['blocked_by_robots'],
    ['login_required'],
    ['blocked'],
    ['not_found'],
    ['unsupported_content'],
    ['too_large'],
    ['tls_error'],
    ['too_many_redirects'],
    ['unsafe_redirect'],
  ] as const)('%s: failed with the reason, audited, not retried', async (code) => {
    const { state, deps } = setup(async () => {
      throw new FetchError(code, false);
    });
    expect(await processRecord(record(), deps)).toBe('failed');
    expect(state).toMatchObject({
      status: 'failed',
      error: { code, message: CRAWL_ERRORS[code] },
      audit: ['crawl.failed'],
    });
    expect(deps.delayRetry).not.toHaveBeenCalled();
    expect(deps.storePage).not.toHaveBeenCalled();
  });

  it('fails a JavaScript shell as needs_browser without storing it', async () => {
    const shell =
      '<html><head><script src="/a.js"></script></head><body><div id="root"></div></body></html>';
    const { state, deps } = setup(async () => page({ body: new TextEncoder().encode(shell) }));
    expect(await processRecord(record(), deps)).toBe('failed');
    expect(state.error?.code).toBe('needs_browser');
    expect(deps.storePage).not.toHaveBeenCalled();
  });

  it('keeps a safe technical detail in the message', () => {
    expect(crawlErrorFrom(new FetchError('http_error', true, 'HTTP 502'))).toEqual({
      code: 'http_error',
      message: `${CRAWL_ERRORS.http_error} (HTTP 502)`,
    });
    expect(crawlErrorFrom(new FetchError('blocked', false))).toEqual({
      code: 'blocked',
      message: CRAWL_ERRORS.blocked,
    });
  });
});

describe('crawl worker: retries', () => {
  const flaky = () => {
    throw new FetchError('timeout', true);
  };

  it('retries a temporary failure after 30 s, then 120 s, noting the error meanwhile', async () => {
    const { state, deps } = setup(async () => flaky());
    await expect(processRecord(record(1), deps)).rejects.toBeInstanceOf(RetryLaterError);
    expect(deps.delayRetry).toHaveBeenLastCalledWith(expect.anything(), RETRY_BACKOFF_SECONDS[0]);
    expect(state).toMatchObject({ status: 'running', lastError: { code: 'timeout' } });

    await expect(processRecord(record(2), deps)).rejects.toBeInstanceOf(RetryLaterError);
    expect(deps.delayRetry).toHaveBeenLastCalledWith(expect.anything(), RETRY_BACKOFF_SECONDS[1]);
    expect(state.attempts).toBe(2);
  });

  it('ends as failed on the last attempt, without dead-lettering (an expected outcome)', async () => {
    const { state, deps } = setup(async () => flaky());
    for (let attempt = 1; attempt < MAX_RECEIVES; attempt += 1) {
      await expect(processRecord(record(attempt), deps)).rejects.toBeInstanceOf(RetryLaterError);
    }
    expect(await processRecord(record(MAX_RECEIVES), deps)).toBe('failed');
    expect(state).toMatchObject({
      status: 'failed',
      attempts: 3,
      error: { code: 'timeout' },
      audit: ['crawl.failed'],
    });
    expect(state.lastError).toBeUndefined();
  });

  it('succeeds on a later attempt', async () => {
    let calls = 0;
    const { state, deps } = setup(async () => {
      calls += 1;
      if (calls === 1) flaky();
      return page();
    });
    await expect(processRecord(record(1), deps)).rejects.toBeInstanceOf(RetryLaterError);
    expect(await processRecord(record(2), deps)).toBe('succeeded');
    expect(state).toMatchObject({ status: 'succeeded', attempts: 2, audit: ['crawl.succeeded'] });
  });

  it('waits for a longer Retry-After', async () => {
    const { deps } = setup(async () => {
      throw new FetchError('http_error', true, 'HTTP 503', 90);
    });
    await expect(processRecord(record(1), deps)).rejects.toBeInstanceOf(RetryLaterError);
    expect(deps.delayRetry).toHaveBeenLastCalledWith(expect.anything(), 90);
  });

  it('still retries if changing the delay fails', async () => {
    const { deps } = setup(async () => flaky());
    deps.delayRetry.mockRejectedValue(new Error('SQS down'));
    await expect(processRecord(record(1), deps)).rejects.toBeInstanceOf(RetryLaterError);
  });
});

describe('crawl worker: our own failures', () => {
  it('retries when storing fails, then ends as internal and dead-letters on the last attempt', async () => {
    const { state, deps } = setup();
    deps.storePage.mockRejectedValue(new Error('S3 unavailable'));
    await expect(processRecord(record(1), deps)).rejects.toThrow('S3 unavailable');
    expect(deps.delayRetry).toHaveBeenLastCalledWith(expect.anything(), RETRY_BACKOFF_SECONDS[0]);
    expect(state.status).toBe('running');

    await expect(processRecord(record(MAX_RECEIVES), deps)).rejects.toThrow('S3 unavailable');
    expect(state).toMatchObject({
      status: 'failed',
      error: { code: 'internal', message: CRAWL_ERRORS.internal },
    });
    // Visible at once, so SQS moves it to the dead-letter queue now and the alarm fires.
    expect(deps.delayRetry).toHaveBeenLastCalledWith(expect.anything(), 0);
  });

  it('stops before the Lambda time limit and treats it as our failure', async () => {
    const { deps } = setup(() => new Promise<FetchedPage>(() => undefined));
    deps.remainingMs = () => 5_050;
    await expect(processRecord(record(1), deps)).rejects.toThrow('time limit');
  });

  it('sends malformed messages to the dead-letter queue', async () => {
    const { deps } = setup();
    await expect(processRecord(record(1, 'not json'), deps)).rejects.toThrow('Malformed');
    await expect(processRecord(record(1, { userId: 'x', crawlId: CRAWL }), deps)).rejects.toThrow(
      'Malformed',
    );
    expect(deps.repo.start).not.toHaveBeenCalled();
  });
});

describe('crawl worker: jobs (T07b)', () => {
  const schemaOrgPage = () =>
    page({
      body: new TextEncoder().encode(
        '<html><head><script type="application/ld+json">[{"@type":"JobPosting","title":"Engineer","url":"/jobs/1"},{"@type":"JobPosting","title":"Designer","url":"/jobs/2"}]</script></head><body>Careers</body></html>',
      ),
    });

  it('saves the jobs read, and records the counts on the crawl, the source, and the audit entry', async () => {
    const { state, deps } = setup(async () => schemaOrgPage());
    deps.saveJobs.mockResolvedValueOnce({ found: 2, created: 1, updated: 1 });
    expect(await processRecord(record(), deps)).toBe('succeeded');
    expect(deps.saveJobs).toHaveBeenCalledWith(
      USER,
      [
        expect.objectContaining({
          title: 'Engineer',
          jobUrl: 'https://jobs.example.com/jobs/1',
          // No roles (T08c): kept, and within the company's limit.
          fit: {
            filter: expect.objectContaining({ state: 'candidate', reasons: ['no_target_roles'] }),
            limitState: 'counted',
          },
        }),
        expect.objectContaining({ title: 'Designer' }),
      ],
      { sourceId: 'S1', crawlId: CRAWL, expiresAt: EXPIRES_AT },
    );
    expect(state).toMatchObject({
      status: 'succeeded',
      stats: {
        jobsFound: 2,
        jobsNew: 1,
        jobsUpdated: 1,
        jobsClosed: 0,
        jobsRelevant: 2,
        jobsOverLimit: 0,
        pagesFetched: 1,
      },
      extraction: { outcome: 'read', method: 'schema_org', skipped: 0 },
      source: { kind: 'unknown', lastFound: 2 },
      audit: ['crawl.succeeded'],
      auditDetail: expect.objectContaining({ jobsFound: 2, jobsNew: 1 }),
    });
  });

  it('a page with nothing readable still succeeds, with 0 jobs and the note', async () => {
    const { state, deps } = setup();
    expect(await processRecord(record(), deps)).toBe('succeeded');
    expect(deps.saveJobs).toHaveBeenCalledWith(USER, [], expect.anything());
    expect(state).toMatchObject({
      stats: { jobsFound: 0, jobsNew: 0, jobsUpdated: 0, jobsClosed: 0, pagesFetched: 1 },
      extraction: { outcome: 'no_readable_jobs', skipped: 0 },
    });
    // Nothing was read: what the page listed before is kept, and nothing is closed.
    expect(deps.listedJobIds).not.toHaveBeenCalled();
    expect(deps.closeJobs).not.toHaveBeenCalled();
    expect(state.source).not.toHaveProperty('listedJobIds');
  });

  it('a job board records its kind on the source', async () => {
    const api = 'https://api.lever.co/v0/postings/acme?mode=json&limit=50&skip=0';
    const { state, deps, fetch } = setup(async () =>
      page({ url: api, contentType: 'application/json', body: new TextEncoder().encode('[]') }),
    );
    const crawlOf = deps.repo.start.getMockImplementation();
    deps.repo.start.mockImplementation(async (...args) => {
      const crawl = await crawlOf?.(...args);
      return crawl && { ...crawl, url: 'https://jobs.lever.co/acme' };
    });
    expect(await processRecord(record(), deps)).toBe('succeeded');
    expect(fetch).toHaveBeenCalledWith(api, {});
    // A complete read of an empty board: it lists nothing now.
    expect(state.source).toEqual({
      kind: 'ats_board',
      ats: 'lever',
      lastFound: 0,
      listedJobIds: [],
    });
    expect(state.extraction).toMatchObject({ method: 'ats_feed', board: 'lever:acme' });
  });

  it('a failed save is our failure: retried, and saving again is safe', async () => {
    const { state, deps } = setup(async () => schemaOrgPage());
    deps.saveJobs.mockRejectedValueOnce(new Error('DynamoDB is down'));
    await expect(processRecord(record(1), deps)).rejects.toBeInstanceOf(RetryLaterError);
    expect(state.status).toBe('running');
    expect(await processRecord(record(2), deps)).toBe('succeeded');
    // The same jobs again: the repository updates the same items (idempotent).
    expect(deps.saveJobs).toHaveBeenCalledTimes(2);
    expect(deps.saveJobs.mock.calls[0]?.[1]).toEqual(deps.saveJobs.mock.calls[1]?.[1]);
  });
});

describe('crawl worker: relevance and the company limit (T08c)', () => {
  const twoJobs = () =>
    page({
      body: new TextEncoder().encode(
        '<html><head><script type="application/ld+json">[{"@type":"JobPosting","title":"Senior Engineer","url":"/jobs/1","datePosted":"2026-09-20"},{"@type":"JobPosting","title":"Designer","url":"/jobs/2","datePosted":"2026-09-21"},{"@type":"JobPosting","title":"Engineer","url":"/jobs/3","datePosted":"2026-09-22"}]</script></head><body>Careers</body></html>',
      ),
    });
  const role = {
    roleId: 'R1',
    title: 'Engineer',
    altTitles: [],
    seniority: [],
    exclude: [],
    priority: 50,
  };
  const saved = (deps: ReturnType<typeof setup>['deps']) =>
    Object.fromEntries((deps.saveJobs.mock.calls[0]?.[1] ?? []).map((j) => [j.title, j.fit]));

  it('marks each job kept or dropped, with why, and counts them', async () => {
    const inputs = {
      profile: { roles: [role], skills: [] },
      companyLimit: 10,
      expiryDays: 7,
      relevanceMaxJobs: 50,
      relevanceMinScore: 30,
    };
    const { state, deps } = setup(async () => twoJobs(), inputs);
    expect(await processRecord(record(), deps)).toBe('succeeded');
    expect(saved(deps)).toEqual({
      'Senior Engineer': {
        filter: {
          state: 'candidate',
          roleIds: ['R1'],
          reasons: ['title_match'],
          priority: 50,
          version: 1,
        },
        limitState: 'counted',
      },
      Designer: {
        filter: {
          state: 'not_relevant',
          roleIds: [],
          reasons: ['title_no_match'],
          priority: 50,
          version: 1,
        },
      },
      Engineer: expect.objectContaining({ limitState: 'counted' }),
    });
    expect(state.stats).toMatchObject({ jobsFound: 3, jobsRelevant: 2, jobsOverLimit: 0 });
    expect(state.auditDetail).toMatchObject({ jobsRelevant: 2, jobsOverLimit: 0 });
  });

  it('shows at most the limit per company, newest first, and hides the rest', async () => {
    const inputs = {
      profile: { roles: [role], skills: [] },
      companyLimit: 1,
      expiryDays: 7,
      relevanceMaxJobs: 50,
      relevanceMinScore: 30,
    };
    const { state, deps } = setup(async () => twoJobs(), inputs);
    expect(await processRecord(record(), deps)).toBe('succeeded');
    const fit = saved(deps);
    expect(fit.Engineer?.limitState).toBe('counted');
    expect(fit['Senior Engineer']?.limitState).toBe('over_limit');
    expect(fit.Designer).not.toHaveProperty('limitState');
    expect(state.stats).toMatchObject({ jobsRelevant: 2, jobsOverLimit: 1 });
    // The company's list now holds the one shown job.
    const [, company, list, version] = deps.shown.put.mock.calls[0] ?? [];
    expect(company).toBe('site:jobs.example.com');
    expect(Object.values(list ?? {})).toEqual([{ p: 50, t: '2026-09-22T00:00:00.000Z' }]);
    expect(version).toBe(0);
  });

  it('T08d: hands the LLM the candidates, shown ones first, up to the admin cap (AI crawls only)', async () => {
    const inputs = {
      profile: { roles: [role], skills: [] },
      companyLimit: 1,
      expiryDays: 7,
      relevanceMaxJobs: 2,
      relevanceMinScore: 30,
    };
    const candidatesOf = async (aiSource: string | undefined, max = 2) => {
      const { deps } = setup(async () => twoJobs(), { ...inputs, relevanceMaxJobs: max });
      const start = deps.repo.start.getMockImplementation();
      deps.repo.start.mockImplementation(async (...args) => {
        const crawl = await start?.(...args);
        return crawl && aiSource ? ({ ...crawl, aiSource } as Crawl) : crawl;
      });
      await processRecord(record(), deps);
      const outcome = deps.repo.finish.mock.calls[0]?.[1];
      const titles = new Map(
        (deps.saveJobs.mock.calls[0]?.[1] ?? []).map((j) => [j.jobId, j.title]),
      );
      return outcome?.status === 'succeeded'
        ? outcome.candidates?.map((id) => titles.get(id))
        : 'failed';
    };
    // Engineer is shown (newest), Senior Engineer is over the limit; Designer was dropped.
    expect(await candidatesOf('platform')).toEqual(['Engineer', 'Senior Engineer']);
    expect(await candidatesOf('openai', 1)).toEqual(['Engineer']);
    expect(await candidatesOf('none')).toBeUndefined();
    expect(await candidatesOf(undefined)).toBeUndefined();
  });

  it('a better job pushes out one another page listed', async () => {
    const inputs = {
      profile: { roles: [{ ...role, priority: 90 }], skills: [] },
      companyLimit: 2,
      expiryDays: 7,
      relevanceMaxJobs: 50,
      relevanceMinScore: 30,
    };
    const { deps } = setup(async () => twoJobs(), inputs);
    deps.shown.get.mockResolvedValueOnce({ shown: { elsewhere: { p: 50 } }, version: 4 });
    expect(await processRecord(record(), deps)).toBe('succeeded');
    expect(deps.markOverLimit).toHaveBeenCalledWith(USER, ['elsewhere'], EXPIRES_AT);
    expect(deps.shown.put).toHaveBeenCalledWith(
      USER,
      'site:jobs.example.com',
      expect.anything(),
      4,
    );
  });

  it('reads the list again when another crawl changed it meanwhile', async () => {
    const { deps } = setup(async () => twoJobs());
    deps.shown.put.mockRejectedValueOnce(new ShownConflictError('site:jobs.example.com'));
    expect(await processRecord(record(), deps)).toBe('succeeded');
    expect(deps.shown.get).toHaveBeenCalledTimes(2);
    expect(deps.shown.put).toHaveBeenCalledTimes(2);
  });

  it('gives up after repeated conflicts, and the crawl retries', async () => {
    const { state, deps } = setup(async () => twoJobs());
    deps.shown.put.mockRejectedValue(new ShownConflictError('site:jobs.example.com'));
    await expect(processRecord(record(1), deps)).rejects.toThrow(RetryLaterError);
    expect(deps.shown.put).toHaveBeenCalledTimes(SHOWN_ATTEMPTS);
    expect(deps.saveJobs).not.toHaveBeenCalled();
    expect(state.status).toBe('running');
  });
});

describe('crawl worker: descriptions (T08d3)', () => {
  const fixture = (name: string) =>
    readFileSync(new URL(`./fixtures/jobs/${name}`, import.meta.url), 'utf8');
  const json = (url: string, body: string) =>
    page({ url, contentType: 'application/json', body: new TextEncoder().encode(body) });
  const LIST = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs';

  /** A Greenhouse board of two jobs: one posting reads, the other is gone. */
  function board(aiSource = 'platform') {
    const ctx = setup(async (url) => {
      if (url === LIST) return json(url, fixture('greenhouse-list.json'));
      if (url === `${LIST}/4001001`) return json(url, fixture('greenhouse-job.json'));
      if (url === `${LIST}/4001002`) throw new FetchError('not_found', false);
      throw new Error(`unexpected ${url}`);
    });
    const start = ctx.deps.repo.start.getMockImplementation();
    ctx.deps.repo.start.mockImplementation(async (...args) => {
      const crawl = await start?.(...args);
      return (
        crawl && ({ ...crawl, url: 'https://job-boards.greenhouse.io/acme', aiSource } as Crawl)
      );
    });
    const saved = () => ctx.deps.saveJobs.mock.calls[0]?.[1] ?? [];
    const idOf = (externalId: string) => saved().find((j) => j.externalId === externalId)?.jobId;
    return { ...ctx, saved, idOf };
  }

  it("reads each candidate's posting, saves its description, and closes a gone one", async () => {
    const { state, deps, fetch, saved, idOf } = board();
    expect(await processRecord(record(), deps)).toBe('succeeded');
    expect(fetch).toHaveBeenCalledWith(`${LIST}/4001001`);
    expect(saved().find((j) => j.externalId === '4001001')?.description).toBeTruthy();
    expect(saved().find((j) => j.externalId === '4001002')?.description).toBeUndefined();
    const gone = idOf('4001002');
    expect(deps.closeGone).toHaveBeenCalledWith(USER, [gone], EXPIRES_AT);
    expect(deps.shown.release).toHaveBeenCalledWith(USER, 'greenhouse:acme', [gone]);
    expect(state.stats?.descriptions).toEqual({ fetched: 1, gone: 1, failed: 0, skipped: 0 });
    // A gone job is never scored.
    const outcome = deps.repo.finish.mock.calls[0]?.[1];
    const candidates = outcome?.status === 'succeeded' ? outcome.candidates : undefined;
    expect(candidates).toEqual([idOf('4001001')]);
  });

  it('skips jobs that already have a stored description, and crawls without AI read them too', async () => {
    const probe = board('none');
    await processRecord(record(), probe.deps);
    const stored = probe.idOf('4001001') as string;
    const { state, deps, fetch } = board('none');
    deps.withDescription.mockResolvedValue(new Set([stored]));
    await processRecord(record(), deps);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([LIST, `${LIST}/4001002`]);
    expect(state.stats?.descriptions).toEqual({ fetched: 0, gone: 1, failed: 0, skipped: 0 });
  });

  it('a page without a board reads nothing more', async () => {
    const { state, deps, fetch } = setup(async () =>
      page({
        body: new TextEncoder().encode(
          '<script type="application/ld+json">{"@type":"JobPosting","title":"Engineer","url":"/jobs/1"}</script>',
        ),
      }),
    );
    await processRecord(record(), deps);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(deps.withDescription).not.toHaveBeenCalled();
    expect(state.stats).toMatchObject({ jobsRelevant: 1 });
    expect(state.stats?.descriptions).toBeUndefined();
  });
});

describe('crawl worker: closed jobs (T07c)', () => {
  const posting = (i: number) => `{"@type":"JobPosting","title":"Role ${i}","url":"/jobs/${i}"}`;
  const pageWith = (...ids: number[]) =>
    page({
      body: new TextEncoder().encode(
        `<html><head><script type="application/ld+json">[${ids.map(posting).join(',')}]</script></head><body>Careers</body></html>`,
      ),
    });

  it('a complete crawl closes what the page no longer lists, and remembers what it lists now', async () => {
    const { state, deps } = setup(async () => pageWith(1, 2));
    const [one, two] = (
      await (async () => {
        const probe = setup(async () => pageWith(1, 2));
        await processRecord(record(), probe.deps);
        return probe.deps.saveJobs.mock.calls[0]?.[1] ?? [];
      })()
    ).map((j) => j.jobId);
    deps.listedJobIds.mockResolvedValue([one as string, 'gone-1', two as string, 'gone-2']);
    expect(await processRecord(record(), deps)).toBe('succeeded');
    expect(deps.closeJobs).toHaveBeenCalledWith(USER, 'S1', ['gone-1', 'gone-2'], EXPIRES_AT);
    expect(state.stats).toMatchObject({ jobsClosed: 2 });
    // T08c: closed jobs free their places in their company's shown list.
    expect(deps.shown.release).toHaveBeenCalledWith(USER, 'site:example.com', ['gone-1', 'gone-2']);
    expect(state.source?.listedJobIds).toEqual([one, two]);
    expect(state.auditDetail).toMatchObject({ jobsClosed: 2 });
  });

  it('a partial crawl closes nothing, and adds what it read to what the page listed', async () => {
    const { state, deps } = setup(async () =>
      page({
        url: 'https://api.lever.co/v0/postings/acme?mode=json&limit=50&skip=0',
        contentType: 'application/json',
        body: new TextEncoder().encode(
          JSON.stringify(
            Array.from({ length: 50 }, (_, i) => ({
              id: `6ed76ce8-4156-4b60-b120-${String(i).padStart(12, '0')}`,
              text: `Role ${i}`,
              hostedUrl: `https://jobs.lever.co/acme/${i}`,
            })),
          ),
        ),
      }),
    );
    // The next page fails: partial.
    let calls = 0;
    const firstPage = deps.newFetcher();
    deps.newFetcher.mockReturnValue(async (url, options) => {
      calls += 1;
      if (calls > 1) throw new FetchError('http_error', true, 'HTTP 503');
      return firstPage(url, options);
    });
    const crawlOf = deps.repo.start.getMockImplementation();
    deps.repo.start.mockImplementation(async (...args) => {
      const crawl = await crawlOf?.(...args);
      return crawl && { ...crawl, url: 'https://jobs.lever.co/acme' };
    });
    deps.listedJobIds.mockResolvedValue(['earlier']);
    expect(await processRecord(record(), deps)).toBe('succeeded');
    expect(state.extraction?.partial).toEqual({ reason: 'page_failed' });
    expect(deps.closeJobs).not.toHaveBeenCalled();
    expect(state.stats).toMatchObject({ jobsFound: 50, jobsClosed: 0, pagesFetched: 2 });
    expect(state.source?.listedJobIds).toHaveLength(51);
    expect(state.source?.listedJobIds).toContain('earlier');
  });

  it('what a page lists is bounded, newest first', () => {
    const previous = Array.from({ length: MAX_LISTED_JOB_IDS }, (_, i) => `old-${i}`);
    const merged = listed(['new-1', 'old-0'], previous);
    expect(merged).toHaveLength(MAX_LISTED_JOB_IDS);
    expect(merged.slice(0, 3)).toEqual(['new-1', 'old-0', 'old-1']);
  });
});
