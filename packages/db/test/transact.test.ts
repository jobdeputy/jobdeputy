import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import {
  ConcurrentUpdateError,
  isTransactionConflict,
  jitteredDelay,
  TRANSACTION_RETRY,
  transactWrite,
} from '../src/index.js';

const cancelled = (...codes: string[]) =>
  Object.assign(new Error('Transaction cancelled'), {
    name: 'TransactionCanceledException',
    CancellationReasons: codes.map((Code) => ({ Code })),
  });

function client(outcomes: unknown[]) {
  const send = vi.fn(async () => {
    const next = outcomes.shift();
    if (next instanceof Error) throw next;
    return {};
  });
  return { c: { send } as unknown as DynamoDBDocumentClient, send };
}
const input = { TransactItems: [] };

describe('transactWrite', () => {
  it('writes once when there is no conflict', async () => {
    const { c, send } = client([undefined]);
    await transactWrite(c, input, { sleep: async () => {} });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries a pure conflict with jitter, then succeeds', async () => {
    const sleep = vi.fn(async () => {});
    const { c, send } = client([
      cancelled('None', 'TransactionConflict'),
      cancelled('TransactionConflict'),
      undefined,
    ]);
    await transactWrite(c, input, { sleep, random: () => 0.5 });
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      jitteredDelay(1, () => 0.5),
      jitteredDelay(2, () => 0.5),
    ]);
  });

  it('gives up after the maximum attempts with ConcurrentUpdateError (a 409, not a 500)', async () => {
    const conflicts = Array.from({ length: 10 }, () => cancelled('TransactionConflict'));
    const { c, send } = client(conflicts);
    const error = await transactWrite(c, input, { sleep: async () => {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConcurrentUpdateError);
    expect(send).toHaveBeenCalledTimes(TRANSACTION_RETRY.maxAttempts);
    expect((error as Error).cause).toMatchObject({ name: 'TransactionCanceledException' });
  });

  it('never retries a failed condition: that is an answer, returned to the caller at once', async () => {
    const failed = cancelled('ConditionalCheckFailed', 'None');
    const { c, send } = client([failed]);
    await expect(transactWrite(c, input, { sleep: async () => {} })).rejects.toBe(failed);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failed condition even if another item also conflicted', async () => {
    const mixed = cancelled('ConditionalCheckFailed', 'TransactionConflict');
    expect(isTransactionConflict(mixed)).toBe(false);
    const { c, send } = client([mixed]);
    await expect(transactWrite(c, input, { sleep: async () => {} })).rejects.toBe(mixed);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('passes other errors through without retrying', async () => {
    const throttled = Object.assign(new Error('slow down'), {
      name: 'ProvisionedThroughputExceededException',
    });
    const { c, send } = client([throttled]);
    await expect(transactWrite(c, input, { sleep: async () => {} })).rejects.toBe(throttled);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('jitteredDelay', () => {
  it('is random between 0 and base × 2^retry, capped', () => {
    expect(jitteredDelay(1, () => 0)).toBe(0);
    expect(jitteredDelay(1, () => 0.999)).toBeLessThan(TRANSACTION_RETRY.baseMs * 2);
    expect(jitteredDelay(3, () => 0.999)).toBeLessThan(TRANSACTION_RETRY.baseMs * 8);
    expect(jitteredDelay(20, () => 0.999)).toBeLessThanOrEqual(TRANSACTION_RETRY.capMs);
  });

  it('keeps the worst case for a user small (all retries waited in full)', () => {
    let total = 0;
    for (let retry = 1; retry < TRANSACTION_RETRY.maxAttempts; retry += 1)
      total += jitteredDelay(retry, () => 0.999);
    expect(total).toBeLessThan(500);
  });
});
