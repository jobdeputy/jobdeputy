import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { DocumentRepository, VersionConflictError } from '../src/index.js';

const NOW = new Date('2026-09-28T00:00:00.000Z');
/** A cancelled transaction whose first item's condition failed. */
const cancelled = () =>
  Object.assign(new Error('no'), {
    name: 'TransactionCanceledException',
    CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
  });
const audit = (name: string) => ({
  table: 'Audit',
  entry: {
    auditId: '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2E',
    name,
    entity: { type: 'document', id: 'D1' },
    actor: 'system' as const,
    summary: name,
  },
});
const parsed = { textS3Key: 'k', charCount: 1, noText: false, truncated: false };
/** The transaction sent in call `n`. */
function tx(send: { mock: { calls: unknown[][] } }, n = 0) {
  const cmd = send.mock.calls[n]?.[0];
  expect(cmd).toBeInstanceOf(TransactWriteCommand);
  return (cmd as TransactWriteCommand).input.TransactItems ?? [];
}

function client(handler: (cmd: unknown) => unknown) {
  const send = vi.fn(async (cmd: unknown) => handler(cmd));
  return { c: { send } as unknown as DynamoDBDocumentClient, send };
}

const doc = (over: Record<string, unknown> = {}) => ({
  userId: 'u1',
  documentId: 'D1',
  version: 1,
  isDefault: false,
  status: 'ready',
  ...over,
});

describe('DocumentRepository', () => {
  it('creates a pending document that expires after a day, audited in the same transaction', async () => {
    const { c, send } = client(() => ({}));
    const created = await new DocumentRepository(c, 'T', () => NOW).create(
      {
        userId: 'u1',
        documentId: 'D1',
        title: 'CV',
        fileName: 'cv.pdf',
        mimeType: 'application/pdf',
        format: 'pdf',
        s3Key: 'users/u1/documents/D1/original',
        isDefault: true,
      },
      audit('document.upload_started'),
    );
    expect(created).toMatchObject({
      status: 'pending',
      version: 1,
      kind: 'resume',
      origin: 'uploaded',
    });
    expect(created.ttl).toBe(NOW.getTime() / 1000 + 86400);
    const [put, entry] = tx(send);
    expect(put?.Put?.ConditionExpression).toBe('attribute_not_exists(userId)');
    expect(entry?.Put).toMatchObject({
      TableName: 'Audit',
      Item: { userId: 'u1', name: 'document.upload_started' },
    });
  });

  it('claims a pending file or a re-upload, clearing the expiry, without an audit entry (an internal step)', async () => {
    const { c, send } = client((cmd) =>
      cmd instanceof GetCommand ? { Item: doc({ status: 'processing' }) } : {},
    );
    expect(
      await new DocumentRepository(c, 'T').startProcessing('u1', 'D1', '"e1"', 100),
    ).toMatchObject({
      status: 'processing',
    });
    const items = tx(send);
    expect(items).toHaveLength(1);
    expect(items[0]?.Update?.ConditionExpression).toBe(
      'attribute_exists(userId) AND (#status = :pending OR eTag <> :etag)',
    );
    expect(items[0]?.Update?.UpdateExpression).toContain('REMOVE #ttl');
    // Transactions return nothing: the result is read back, consistently.
    const read = send.mock.calls[1]?.[0];
    expect(read).toBeInstanceOf(GetCommand);
    expect((read as GetCommand).input.ConsistentRead).toBe(true);
  });

  it('returns undefined, and records nothing, for duplicates or stale events', async () => {
    const { c, send } = client((cmd) => {
      if (cmd instanceof TransactWriteCommand) throw cancelled();
      return {};
    });
    const repo = new DocumentRepository(c, 'T');
    await expect(repo.startProcessing('u1', 'D1', '"e1"', 1)).resolves.toBeUndefined();
    await expect(
      repo.markReady('u1', 'D1', '"e1"', parsed, audit('document.ready')),
    ).resolves.toBeUndefined();
    expect(send.mock.calls.every(([cmd]) => cmd instanceof TransactWriteCommand)).toBe(true);
  });

  it('only marks the processed file ready, audited, sending only the placeholders it uses', async () => {
    const { c, send } = client((cmd) => (cmd instanceof GetCommand ? { Item: doc() } : {}));
    await new DocumentRepository(c, 'T').markReady(
      'u1',
      'D1',
      '"e1"',
      parsed,
      audit('document.ready'),
    );
    const [update, entry] = tx(send);
    expect(update?.Update?.ConditionExpression).toBe('attribute_exists(userId) AND eTag = :etag');
    expect(update?.Update?.ExpressionAttributeNames).toEqual({ '#status': 'status' });
    expect(entry?.Put?.Item).toMatchObject({ name: 'document.ready' });
  });

  it('rejects whatever the status (threats always win), audited', async () => {
    const { c, send } = client(() => ({}));
    await new DocumentRepository(c, 'T').markRejected(
      'u1',
      'D1',
      'x'.repeat(1000),
      audit('document.rejected'),
    );
    const [update, entry] = tx(send);
    expect(update?.Update?.ConditionExpression).toBe('attribute_exists(userId)');
    expect(String(update?.Update?.ExpressionAttributeValues?.[':error']).length).toBe(300);
    expect(entry?.Put?.Item).toMatchObject({ name: 'document.rejected' });
  });

  it('fails a document, audited, optionally only for the file it processed', async () => {
    const { c, send } = client(() => ({}));
    const repo = new DocumentRepository(c, 'T');
    await repo.markFailed('u1', 'D1', 'bad', audit('document.failed'), '"e1"');
    await repo.markFailed('u1', 'D1', 'bad', audit('document.failed'));
    expect(tx(send, 0)[0]?.Update?.ConditionExpression).toBe(
      'attribute_exists(userId) AND eTag = :etag',
    );
    expect(tx(send, 2)[0]?.Update?.ConditionExpression).toBe('attribute_exists(userId)');
    expect(tx(send, 2)[1]?.Put?.Item).toMatchObject({ name: 'document.failed' });
  });

  it('renames with the right version, audited, and conflicts on a stale one', async () => {
    let version = 2;
    const { c, send } = client((cmd) => {
      if (cmd instanceof GetCommand)
        return { Item: doc({ version, title: version === 3 ? 'New' : 'cv' }) };
      version = 3;
      return {};
    });
    const repo = new DocumentRepository(c, 'T');
    await expect(
      repo.rename('u1', 'D1', 'New', 2, audit('document.renamed')),
    ).resolves.toMatchObject({
      version: 3,
      title: 'New',
    });
    expect(tx(send, 1)[1]?.Put?.Item).toMatchObject({ name: 'document.renamed' });
    // Found on real DynamoDB: an empty ExpressionAttributeNames map is rejected.
    expect(tx(send, 1)[0]?.Update).not.toHaveProperty('ExpressionAttributeNames');
    await expect(
      repo.rename('u1', 'D1', 'New', 1, audit('document.renamed')),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('switches the default atomically, clearing the old one, audited in the same transaction', async () => {
    const { c, send } = client((cmd) => {
      if (cmd instanceof QueryCommand) {
        return { Items: [doc({ documentId: 'OLD', isDefault: true }), doc({ documentId: 'D1' })] };
      }
      return {};
    });
    const result = await new DocumentRepository(c, 'T').setDefault(
      'u1',
      'D1',
      1,
      audit('document.default_changed'),
    );
    expect(result).toMatchObject({ isDefault: true, version: 2 });
    const items = tx(send, 1);
    expect(items.map((t) => t.Update?.Key?.documentId ?? t.Put?.Item?.name)).toEqual([
      'D1',
      'OLD',
      'document.default_changed',
    ]);
  });

  it('turns a cancelled default switch into a conflict', async () => {
    const { c } = client((cmd) => {
      if (cmd instanceof QueryCommand) return { Items: [doc()] };
      throw Object.assign(new Error('x'), { name: 'TransactionCanceledException' });
    });
    await expect(
      new DocumentRepository(c, 'T').setDefault('u1', 'D1', 1, audit('document.default_changed')),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('deletes and returns the document, audited in the same transaction', async () => {
    const { c, send } = client((cmd) => (cmd instanceof GetCommand ? { Item: doc() } : {}));
    expect(
      await new DocumentRepository(c, 'T').delete('u1', 'D1', audit('document.deleted')),
    ).toMatchObject({
      documentId: 'D1',
    });
    const [del, entry] = tx(send, 1);
    expect(del?.Delete?.ConditionExpression).toBe('attribute_exists(userId)');
    expect(entry?.Put?.Item).toMatchObject({ name: 'document.deleted' });
  });

  it('returns undefined, and records nothing, when it vanished between the read and the delete', async () => {
    const { c } = client((cmd) => {
      if (cmd instanceof GetCommand) return { Item: doc() };
      throw cancelled();
    });
    await expect(
      new DocumentRepository(c, 'T').delete('u1', 'D1', audit('document.deleted')),
    ).resolves.toBeUndefined();
  });

  it("returns undefined, writing nothing, for another user's or a missing document", async () => {
    const { c, send } = client((cmd) => {
      if (cmd instanceof QueryCommand) return { Items: [] };
      return {};
    });
    const repo = new DocumentRepository(c, 'T');
    await expect(repo.setDefault('u2', 'D1', 1, audit('x'))).resolves.toBeUndefined();
    await expect(repo.rename('u2', 'D1', 'x', 1, audit('x'))).resolves.toBeUndefined();
    await expect(repo.delete('u2', 'D1', audit('x'))).resolves.toBeUndefined();
    expect(send.mock.calls.some(([cmd]) => cmd instanceof TransactWriteCommand)).toBe(false);
  });
});
