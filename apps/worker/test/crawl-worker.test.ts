import type { Crawl, CrawlError, CrawlResult, FinishOutcome } from '@jobdeputy/db';
import { CRAWL_ERRORS, crawlKeys } from '@jobdeputy/shared';
import type { SQSRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import {
  type CrawlWorkerDeps,
  crawlErrorFrom,
  MAX_RECEIVES,
  processRecord,
  RETRY_BACKOFF_SECONDS,
  RetryLaterError,
} from '../src/crawl-worker.js';
import { FetchError, type FetchedPage } from '../src/fetch/fetcher.js';

const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const CRAWL = '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2D';
const URL_ = 'https://jobs.example.com/careers';

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

/** An in-memory crawl with the same transition rules as the DynamoDB repository. */
function setup(fetchPage: CrawlWorkerDeps['fetchPage'] = async () => page()) {
  const state: {
    status: Crawl['status'];
    attempts: number;
    result?: CrawlResult;
    error?: CrawlError;
    lastError?: CrawlError;
    audit: string[];
  } = { status: 'queued', attempts: 0, audit: [] };
  const crawl = (): Crawl =>
    ({ userId: USER, crawlId: CRAWL, sourceId: 'S1', url: URL_, ...state }) as unknown as Crawl;
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
        if (outcome.status === 'succeeded') state.result = outcome.result;
        else state.error = outcome.error;
        delete state.lastError;
        state.audit.push(audit.name);
        return true;
      }),
    },
    isBeingDeleted: vi.fn(async () => false),
    fetchPage: vi.fn(fetchPage),
    storePage: vi.fn(async () => undefined),
    delayRetry: vi.fn(async () => undefined),
    newId: () => '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2E',
    remainingMs: () => 60_000,
  } satisfies CrawlWorkerDeps;
  return { state, deps };
}

describe('crawl worker: success', () => {
  it('fetches the page, stores it under the crawl, and records success with an audit entry', async () => {
    const { state, deps } = setup();
    expect(await processRecord(record(), deps)).toBe('succeeded');
    const key = crawlKeys(USER, CRAWL).page;
    expect(deps.fetchPage).toHaveBeenCalledWith(URL_);
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
    const { state, deps } = setup();
    await processRecord(record(), deps);
    expect(await processRecord(record(), deps)).toBe('skipped');
    expect(deps.fetchPage).toHaveBeenCalledTimes(1);
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
