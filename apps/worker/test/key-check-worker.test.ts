import type { AiKey } from '@jobdeputy/db';
import { KeyCheckRetryError } from '@jobdeputy/llm';
import type { SQSRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { type KeyCheckWorkerDeps, processRecord } from '../src/key-check-worker.js';

const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
/** A fake decrypted key, built from repeated letters so no scanner mistakes it for a real one. */
const PLAIN = `sk-plain-${'x'.repeat(12)}`;
const KEY: AiKey = {
  userId: USER,
  provider: 'openai',
  type: 'ai_key',
  ciphertext: new Uint8Array([1, 2]),
  last4: 'WXYZ',
  modelId: 'gpt-test',
  status: 'checking',
  checkId: 'C1',
  consentAt: 'a',
  createdAt: 'a',
  updatedAt: 'a',
  schemaVersion: 1,
};

const record = (body: unknown, receiveCount = 1) =>
  ({
    messageId: 'm1',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    attributes: { ApproximateReceiveCount: String(receiveCount) },
  }) as unknown as SQSRecord;

function deps(key: AiKey | null = KEY) {
  type D = KeyCheckWorkerDeps;
  const d = {
    keys: {
      get: vi.fn<D['keys']['get']>(async () => key ?? undefined),
      recordCheck: vi.fn<D['keys']['recordCheck']>(async () => true),
    },
    decrypt: vi.fn<D['decrypt']>(async () => PLAIN),
    check: vi.fn<D['check']>(async () => ({ status: 'valid' })),
    isBeingDeleted: vi.fn<D['isBeingDeleted']>(async () => false),
    auditTable: 'Audit',
    allowTestProvider: false,
    newId: () => 'A1',
  } satisfies KeyCheckWorkerDeps;
  return d;
}

describe('key-check worker', () => {
  it('decrypts with this user and provider, checks, and records the result for this check', async () => {
    const d = deps();
    expect(await processRecord(record({ userId: USER, provider: 'openai' }), d)).toBe('valid');
    expect(d.decrypt).toHaveBeenCalledWith(USER, 'openai', KEY.ciphertext);
    expect(d.check).toHaveBeenCalledWith({
      provider: 'openai',
      modelId: 'gpt-test',
      apiKey: PLAIN,
    });
    const recorded = d.keys.recordCheck.mock.calls[0]?.[0];
    expect(recorded).toMatchObject({
      userId: USER,
      provider: 'openai',
      checkId: 'C1',
      result: { status: 'valid' },
    });
    expect(recorded?.audit.entry).toMatchObject({ name: 'ai_key.checked', actor: 'system' });
    expect(JSON.stringify(recorded)).not.toContain(PLAIN);
  });

  it('records an invalid key with its reason', async () => {
    const d = deps();
    d.check.mockResolvedValue({ status: 'invalid', reason: 'rejected' });
    expect(await processRecord(record({ userId: USER, provider: 'openai' }), d)).toBe('invalid');
    expect(d.keys.recordCheck.mock.calls[0]?.[0].audit.entry.detail).toEqual({
      status: 'invalid',
      reason: 'rejected',
    });
  });

  it('lets the queue retry a busy provider, and records check-failed on the last attempt', async () => {
    const d = deps();
    d.check.mockRejectedValue(new KeyCheckRetryError('busy'));
    await expect(
      processRecord(record({ userId: USER, provider: 'openai' }, 1), d),
    ).rejects.toBeInstanceOf(KeyCheckRetryError);
    expect(d.keys.recordCheck).not.toHaveBeenCalled();
    expect(await processRecord(record({ userId: USER, provider: 'openai' }, 3), d)).toBe('invalid');
    expect(d.keys.recordCheck.mock.calls[0]?.[0].result).toEqual({
      status: 'invalid',
      reason: 'check-failed',
    });
  });

  it('skips keys that are gone or already checked, and accounts being deleted', async () => {
    for (const d of [deps(null), deps({ ...KEY, status: 'valid' })]) {
      expect(await processRecord(record({ userId: USER, provider: 'openai' }), d)).toBe('skipped');
      expect(d.decrypt).not.toHaveBeenCalled();
    }
    const deleting = deps();
    deleting.isBeingDeleted.mockResolvedValue(true);
    expect(await processRecord(record({ userId: USER, provider: 'openai' }), deleting)).toBe(
      'skipped',
    );
    expect(deleting.keys.get).not.toHaveBeenCalled();
  });

  it('reports a check that was superseded meanwhile', async () => {
    const d = deps();
    d.keys.recordCheck.mockResolvedValue(false);
    expect(await processRecord(record({ userId: USER, provider: 'openai' }), d)).toBe('superseded');
  });

  it('fails malformed messages and the test provider outside dev to the dead-letter queue', async () => {
    for (const body of [
      'not json',
      { userId: 'x', provider: 'openai' },
      { userId: USER, provider: 'stub' },
    ]) {
      await expect(processRecord(record(body), deps())).rejects.toThrow('Malformed message');
    }
  });

  it('never retries other errors silently: a KMS failure goes to the queue', async () => {
    const d = deps();
    d.decrypt.mockRejectedValue(
      Object.assign(new Error('denied'), { name: 'AccessDeniedException' }),
    );
    await expect(processRecord(record({ userId: USER, provider: 'openai' }, 3), d)).rejects.toThrow(
      'denied',
    );
    expect(d.keys.recordCheck).not.toHaveBeenCalled();
  });
});
