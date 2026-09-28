import type { PingJob } from '@jobdeputy/db';
import type { SQSRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { withDeadline } from '../src/deadline.js';
import { processRecord, type RecordDeps, runPingJob } from '../src/ping-worker.js';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function job(over: { fail?: boolean } = {}): PingJob {
  return {
    id: ID,
    type: 'ping',
    userId: 'user-a',
    status: 'running',
    attempts: 1,
    sideEffectCount: 0,
    deliveries: 0,
    createdAt: 't',
    updatedAt: 't',
    schemaVersion: 1,
    ttl: 1,
    ...over,
  };
}

/** An in-memory repository with the same transition rules as the DynamoDB one. */
function memoryRepo(initial: PingJob) {
  const state = { ...initial, status: 'queued' as PingJob['status'], attempts: 0 };
  return {
    state,
    recordDelivery: vi.fn(async () => {
      state.deliveries += 1;
    }),
    markRunning: vi.fn(async () => {
      if (state.status !== 'queued' && state.status !== 'running') return undefined;
      state.status = 'running';
      state.attempts += 1;
      return { ...state };
    }),
    completeWithSideEffect: vi.fn(async () => {
      if (state.status !== 'running') return undefined;
      state.status = 'succeeded';
      state.sideEffectCount += 1;
      return { ...state };
    }),
    recordAttemptError: vi.fn(async (_id: string, reason: string) => {
      state.error = reason;
      return { ...state };
    }),
    markFailed: vi.fn(async (_id: string, reason: string) => {
      if (state.status === 'succeeded' || state.status === 'failed') return undefined;
      state.status = 'failed';
      state.error = reason;
      return { ...state };
    }),
  };
}

function record(receiveCount: number, body = JSON.stringify({ id: ID })): SQSRecord {
  return {
    messageId: 'm1',
    receiptHandle: 'h1',
    body,
    attributes: { ApproximateReceiveCount: String(receiveCount) },
    eventSourceARN: 'arn:aws:sqs:us-east-1:111111111111:q',
  } as unknown as SQSRecord;
}

function deps(repo: ReturnType<typeof memoryRepo>, over: Partial<RecordDeps> = {}): RecordDeps {
  return {
    repo,
    run: (m) => runPingJob(m, repo),
    delayRetry: vi.fn(async () => undefined),
    remainingMs: () => 30_000,
    ...over,
  };
}

describe('ping worker', () => {
  it('marks a job succeeded and applies the side effect once', async () => {
    const repo = memoryRepo(job());
    await expect(processRecord(record(1), deps(repo))).resolves.toEqual({ outcome: 'succeeded' });
    expect(repo.state).toMatchObject({ status: 'succeeded', sideEffectCount: 1, attempts: 1 });
  });

  it('does not repeat the side effect on a duplicate delivery', async () => {
    const repo = memoryRepo(job());
    const d = deps(repo);
    await processRecord(record(1), d);
    await expect(processRecord(record(1), d)).resolves.toEqual({ outcome: 'skipped' });
    expect(repo.state).toMatchObject({ sideEffectCount: 1, deliveries: 2 });
  });

  it('records the error and backs off on early failures', async () => {
    const repo = memoryRepo(job({ fail: true }));
    const d = deps(repo);
    await expect(processRecord(record(1), d)).rejects.toThrow('Forced failure');
    expect(repo.state).toMatchObject({
      status: 'running',
      error: 'Forced failure (dev test flag)',
    });
    expect(d.delayRetry).toHaveBeenCalledWith(expect.anything(), 10);
    await expect(processRecord(record(2), d)).rejects.toThrow();
    expect(d.delayRetry).toHaveBeenLastCalledWith(expect.anything(), 30);
  });

  it('marks the job failed on the 3rd attempt and rethrows so SQS dead-letters it', async () => {
    const repo = memoryRepo(job({ fail: true }));
    const d = deps(repo);
    for (const n of [1, 2]) await processRecord(record(n), d).catch(() => undefined);
    await expect(processRecord(record(3), d)).rejects.toThrow('Forced failure');
    expect(repo.state).toMatchObject({ status: 'failed', attempts: 3 });
    expect(repo.state.error).toContain('Forced failure');
    expect(repo.markFailed).toHaveBeenCalledTimes(1);
    expect(d.delayRetry).toHaveBeenLastCalledWith(expect.anything(), 0);
  });

  it('records a timeout as a failure instead of hanging', async () => {
    const repo = memoryRepo(job());
    const d = deps(repo, {
      run: () => new Promise(() => undefined),
      remainingMs: () => 5_050,
    });
    await expect(processRecord(record(3), d)).rejects.toThrow('time limit');
    expect(repo.state.status).toBe('failed');
  });

  it('rejects malformed messages without touching the table', async () => {
    const repo = memoryRepo(job());
    await expect(processRecord(record(1, 'not json'), deps(repo))).rejects.toThrow('Malformed');
    await expect(processRecord(record(1, '{"id":"x"}'), deps(repo))).rejects.toThrow('Malformed');
    expect(repo.markRunning).not.toHaveBeenCalled();
  });

  it('keeps going when the backoff call itself fails', async () => {
    const repo = memoryRepo(job({ fail: true }));
    const d = deps(repo, { delayRetry: vi.fn(async () => Promise.reject(new Error('sqs down'))) });
    await expect(processRecord(record(1), d)).rejects.toThrow('Forced failure');
  });
});

describe('withDeadline', () => {
  it('returns the result when work finishes in time', async () => {
    await expect(withDeadline(Promise.resolve(1), 1000)).resolves.toBe(1);
  });
});
