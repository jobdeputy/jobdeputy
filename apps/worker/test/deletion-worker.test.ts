import type { DeletionRequest } from '@jobdeputy/db';
import type { SQSRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import {
  type DeletionDeps,
  FINAL_SWEEP_DELAY_SECONDS,
  handleDeletion,
  processRecord,
} from '../src/deletion-worker.js';

const USER = '14e85498-1111-2222-3333-444455556666';

function deps(request?: Partial<DeletionRequest>) {
  const order: string[] = [];
  const d = {
    order,
    account: {
      getDeletion: vi.fn(async () =>
        request
          ? ({
              userId: USER,
              sk: 'DELETION',
              username: 'name-1',
              status: 'queued',
              ...request,
            } as DeletionRequest)
          : undefined,
      ),
      setDeletionStatus: vi.fn(async (_u: string, s: string) => void order.push(`status:${s}`)),
    },
    eraseItems: vi.fn(async () => {
      order.push('items');
      return 3;
    }),
    eraseFiles: vi.fn(async () => {
      order.push('files');
      return 2;
    }),
    signOutAndDeleteLogin: vi.fn(async (u: string) => void order.push(`login:${u}`)),
    scheduleFinalSweep: vi.fn(async () => void order.push('sweep')),
  };
  return d as typeof d & DeletionDeps;
}

describe('deletion worker', () => {
  it('deletes the login first, then all data, then schedules one final sweep', async () => {
    const d = deps({});
    await expect(handleDeletion({ id: USER }, d)).resolves.toBe('erased');
    expect(d.order).toEqual(['status:deleting', 'login:name-1', 'items', 'files', 'sweep']);
  });

  it('runs the final sweep and marks the request done, without touching the login again', async () => {
    const d = deps({ status: 'deleting' });
    await expect(handleDeletion({ id: USER, sweep: true }, d)).resolves.toBe('swept');
    expect(d.order).toEqual(['items', 'files', 'status:done']);
    expect(d.signOutAndDeleteLogin).not.toHaveBeenCalled();
    expect(d.scheduleFinalSweep).not.toHaveBeenCalled();
  });

  it('deletes nothing without a deletion request', async () => {
    const d = deps(undefined);
    await expect(handleDeletion({ id: USER }, d)).resolves.toBe('nothing-to-do');
    await expect(handleDeletion({ id: USER, sweep: true }, d)).resolves.toBe('nothing-to-do');
    expect(d.eraseItems).not.toHaveBeenCalled();
  });

  it('ignores a repeated first pass once the account is done', async () => {
    const d = deps({ status: 'done' });
    await expect(handleDeletion({ id: USER }, d)).resolves.toBe('nothing-to-do');
    expect(d.eraseItems).not.toHaveBeenCalled();
  });

  it('can be re-run after a partial failure', async () => {
    const d = deps({});
    d.eraseFiles.mockRejectedValueOnce(new Error('S3 unavailable'));
    const record = {
      body: JSON.stringify({ id: USER }),
      attributes: { ApproximateReceiveCount: '1' },
    } as unknown as SQSRecord;
    await expect(processRecord(record, d)).rejects.toThrow('S3 unavailable');
    await expect(processRecord(record, d)).resolves.toBe('erased');
    expect(d.scheduleFinalSweep).toHaveBeenCalledTimes(1);
  });

  it.each([['{"id":"not-a-user"}'], ['not json'], ['{}']])(
    'rejects malformed message %s',
    async (body) => {
      const d = deps({});
      const record = { body, attributes: { ApproximateReceiveCount: '1' } } as unknown as SQSRecord;
      await expect(processRecord(record, d)).rejects.toThrow('Malformed');
      expect(d.eraseItems).not.toHaveBeenCalled();
    },
  );

  it('sweeps once, 15 minutes later (the longest native SQS delay)', () => {
    expect(FINAL_SWEEP_DELAY_SECONDS).toBe(900);
  });
});
