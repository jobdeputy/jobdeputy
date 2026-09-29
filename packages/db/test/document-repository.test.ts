import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import {
  ConcurrentUpdateError,
  DocumentLimitError,
  DocumentRepository,
  VersionConflictError,
} from '../src/index.js';

const NOW = new Date('2026-09-28T00:00:00.000Z');
/** A transaction cancelled by the counter's condition (item 2: the cap or the default). */
const cancelledAt2 = () =>
  Object.assign(new Error('no'), {
    name: 'TransactionCanceledException',
    CancellationReasons: [{ Code: 'None' }, { Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
  });

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
  const fields = {
    userId: 'u1',
    documentId: 'D1',
    title: 'CV',
    fileName: 'cv.pdf',
    mimeType: 'application/pdf',
    format: 'pdf' as const,
    s3Key: 'users/u1/documents/D1/original',
  };
  /** Answers each command type from a queue (the last answer repeats). */
  function scripted(answers: { query?: unknown[][]; tx?: unknown[]; get?: unknown[] }) {
    const next = <T>(list: T[] | undefined, fallback: T): T =>
      list && list.length > 1 ? (list.shift() as T) : (list?.[0] ?? fallback);
    return client((cmd) => {
      if (cmd instanceof QueryCommand) return { Items: next(answers.query, []) };
      if (cmd instanceof GetCommand) return { Item: next(answers.get, undefined) };
      if (cmd instanceof TransactWriteCommand) {
        const outcome = next(answers.tx, 'ok');
        if (outcome instanceof Error) throw outcome;
        return {};
      }
      return {};
    });
  }
  const cap = 10;
  const repoWithUsage = (c: DynamoDBDocumentClient) =>
    new DocumentRepository(c, 'T', () => NOW, 'U');
  const txAt = (send: { mock: { calls: unknown[][] } }) =>
    send.mock.calls
      .map(([c]) => c)
      .filter((c) => c instanceof TransactWriteCommand) as TransactWriteCommand[];

  it('creates the first document as the default: counted and the default claimed in the same transaction', async () => {
    const { c, send } = scripted({ query: [[]] });
    const created = await repoWithUsage(c).create(fields, audit('document.upload_started'), cap);
    expect(created).toMatchObject({
      status: 'pending',
      version: 1,
      isDefault: true,
      kind: 'resume',
      origin: 'uploaded',
    });
    expect(created.ttl).toBe(NOW.getTime() / 1000 + 86400);
    const [put, entry, counter] = txAt(send)[0]?.input.TransactItems ?? [];
    expect(put?.Put?.ConditionExpression).toBe('attribute_not_exists(userId)');
    expect(entry?.Put).toMatchObject({
      TableName: 'Audit',
      Item: { userId: 'u1', name: 'document.upload_started' },
    });
    expect(counter?.Update).toMatchObject({
      TableName: 'U',
      Key: { userId: 'u1', sk: 'DOCUMENTS' },
      ConditionExpression:
        '(attribute_not_exists(itemCount) OR itemCount < :max) AND attribute_not_exists(defaultDocumentId)',
    });
    expect(counter?.Update?.ExpressionAttributeValues).toMatchObject({
      ':max': cap,
      ':default': 'D1',
    });
  });

  it('creates later documents as not the default, without touching the marker', async () => {
    const { c, send } = scripted({ query: [[doc({ documentId: 'OLD', isDefault: true })]] });
    const created = await repoWithUsage(c).create(fields, audit('document.upload_started'), cap);
    expect(created.isDefault).toBe(false);
    const counter = txAt(send)[0]?.input.TransactItems?.[2]?.Update;
    expect(counter?.ConditionExpression).toBe(
      '(attribute_not_exists(itemCount) OR itemCount < :max)',
    );
    expect(counter?.ExpressionAttributeValues).not.toHaveProperty(':default');
  });

  it('refuses at the cap without writing', async () => {
    const { c, send } = scripted({
      query: [Array.from({ length: cap }, (_, i) => doc({ documentId: `D${i}` }))],
    });
    await expect(repoWithUsage(c).create(fields, audit('x'), cap)).rejects.toBeInstanceOf(
      DocumentLimitError,
    );
    expect(txAt(send)).toHaveLength(0);
  });

  it('becomes an ordinary document when another first upload won the default at the same moment', async () => {
    const winner = doc({ documentId: 'WIN', isDefault: true });
    const { c, send } = scripted({
      query: [[], [winner], [winner]],
      tx: [cancelledAt2(), 'ok'],
      get: [{ itemCount: 1, defaultDocumentId: 'WIN' }],
    });
    const created = await repoWithUsage(c).create(fields, audit('document.upload_started'), cap);
    expect(created.isDefault).toBe(false);
    const attempts = txAt(send);
    expect(attempts).toHaveLength(2);
    expect(
      attempts[1]?.input.TransactItems?.[2]?.Update?.ExpressionAttributeValues,
    ).not.toHaveProperty(':default');
  });

  it('corrects a counter that drifted (expired pending uploads), then creates', async () => {
    const three = [1, 2, 3].map((i) => doc({ documentId: `D${i}`, isDefault: i === 1 }));
    const { c, send } = scripted({
      query: [three, three, three],
      tx: [cancelledAt2(), 'ok'],
      get: [{ itemCount: cap, defaultDocumentId: 'D1' }],
    });
    await expect(repoWithUsage(c).create(fields, audit('x'), cap)).resolves.toMatchObject({
      isDefault: false,
    });
    const repair = send.mock.calls
      .map(([cmd]) => cmd)
      .find((cmd) => cmd instanceof UpdateCommand) as UpdateCommand;
    expect(repair.input).toMatchObject({
      TableName: 'U',
      ConditionExpression: 'itemCount = :seenCount AND defaultDocumentId = :seenDefault',
      ExpressionAttributeValues: { ':count': 3, ':seenCount': cap, ':default': 'D1' },
    });
  });

  it('frees a default marker left by an expired upload, so the next upload becomes the default', async () => {
    const { c, send } = scripted({
      query: [[], [], []],
      tx: [cancelledAt2(), 'ok'],
      get: [{ itemCount: 1, defaultDocumentId: 'EXPIRED' }],
    });
    await expect(repoWithUsage(c).create(fields, audit('x'), cap)).resolves.toMatchObject({
      isDefault: true,
    });
    const repair = send.mock.calls
      .map(([cmd]) => cmd)
      .find((cmd) => cmd instanceof UpdateCommand) as UpdateCommand;
    expect(repair.input.UpdateExpression).toContain('REMOVE defaultDocumentId');
    expect(repair.input.ExpressionAttributeValues).toMatchObject({ ':count': 0 });
  });

  it('gives up with a conflict (409) when it keeps losing a race', async () => {
    const { c } = scripted({ query: [[]], tx: [cancelledAt2()], get: [{ itemCount: 0 }] });
    await expect(repoWithUsage(c).create(fields, audit('x'), cap)).rejects.toBeInstanceOf(
      ConcurrentUpdateError,
    );
  });

  it('needs the usage table to create', async () => {
    const { c } = scripted({ query: [[]] });
    await expect(new DocumentRepository(c, 'T').create(fields, audit('x'), cap)).rejects.toThrow(
      'usage table',
    );
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
    const result = await new DocumentRepository(c, 'T', undefined, 'U').setDefault(
      'u1',
      'D1',
      1,
      audit('document.default_changed'),
    );
    expect(result).toMatchObject({ isDefault: true, version: 2 });
    // Calls: the list, the marker read, then one transaction.
    const items = tx(send, 2);
    expect(
      items.map((t) => t.Update?.Key?.documentId ?? t.Put?.Item?.name ?? t.Update?.Key?.sk),
    ).toEqual(['D1', 'OLD', 'document.default_changed', 'DOCUMENTS']);
    // Of two switches at once, one wins: the marker must still be what this one read.
    expect(items[3]?.Update).toMatchObject({
      ConditionExpression: 'attribute_not_exists(defaultDocumentId)',
      ExpressionAttributeValues: { ':id': 'D1' },
    });
  });

  it('reads the default marker before the list (so a switch in between is a conflict, not a second default)', async () => {
    const { c, send } = client((cmd) => {
      if (cmd instanceof QueryCommand) return { Items: [doc({ documentId: 'D1' })] };
      return {};
    });
    await new DocumentRepository(c, 'T', undefined, 'U').setDefault('u1', 'D1', 1, audit('x'));
    const order = send.mock.calls.map(([cmd]) => (cmd as object).constructor.name);
    expect(order.slice(0, 3)).toEqual(['GetCommand', 'QueryCommand', 'TransactWriteCommand']);
  });

  it('requires the marker it read when one exists', async () => {
    const { c, send } = client((cmd) => {
      if (cmd instanceof QueryCommand)
        return { Items: [doc({ documentId: 'OLD', isDefault: true }), doc({ documentId: 'D1' })] };
      if (cmd instanceof GetCommand) return { Item: { itemCount: 2, defaultDocumentId: 'OLD' } };
      return {};
    });
    await new DocumentRepository(c, 'T', undefined, 'U').setDefault('u1', 'D1', 1, audit('x'));
    expect(tx(send, 2)[3]?.Update).toMatchObject({
      ConditionExpression: 'defaultDocumentId = :seen',
      ExpressionAttributeValues: { ':seen': 'OLD' },
    });
  });

  it('turns a cancelled default switch into a conflict', async () => {
    const { c } = client((cmd) => {
      if (cmd instanceof QueryCommand) return { Items: [doc()] };
      if (cmd instanceof GetCommand) return {};
      throw Object.assign(new Error('x'), {
        name: 'TransactionCanceledException',
        CancellationReasons: [
          { Code: 'None' },
          { Code: 'None' },
          { Code: 'ConditionalCheckFailed' },
        ],
      });
    });
    await expect(
      new DocumentRepository(c, 'T', undefined, 'U').setDefault(
        'u1',
        'D1',
        1,
        audit('document.default_changed'),
      ),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('deletes and returns the document, audited in the same transaction', async () => {
    const { c, send } = client((cmd) => (cmd instanceof GetCommand ? { Item: doc() } : {}));
    expect(
      await new DocumentRepository(c, 'T', undefined, 'U').delete(
        'u1',
        'D1',
        audit('document.deleted'),
      ),
    ).toMatchObject({
      documentId: 'D1',
    });
    const [del, entry, counter] = tx(send, 1);
    expect(counter?.Update).toMatchObject({
      TableName: 'U',
      Key: { userId: 'u1', sk: 'DOCUMENTS' },
      UpdateExpression: 'SET itemCount = if_not_exists(itemCount, :one) - :one, updatedAt = :now',
    });
    expect(del?.Delete?.ConditionExpression).toBe('attribute_exists(userId)');
    expect(entry?.Put?.Item).toMatchObject({ name: 'document.deleted' });
  });

  it('frees the default marker when the default document is deleted', async () => {
    const { c, send } = client((cmd) =>
      cmd instanceof GetCommand ? { Item: doc({ isDefault: true }) } : {},
    );
    await new DocumentRepository(c, 'T', undefined, 'U').delete(
      'u1',
      'D1',
      audit('document.deleted'),
    );
    expect(tx(send, 1)[2]?.Update?.UpdateExpression).toBe(
      'SET itemCount = if_not_exists(itemCount, :one) - :one, updatedAt = :now REMOVE defaultDocumentId',
    );
  });

  it('returns undefined, and records nothing, when it vanished between the read and the delete', async () => {
    const { c } = client((cmd) => {
      if (cmd instanceof GetCommand) return { Item: doc() };
      throw cancelled();
    });
    await expect(
      new DocumentRepository(c, 'T', undefined, 'U').delete('u1', 'D1', audit('document.deleted')),
    ).resolves.toBeUndefined();
  });

  it("returns undefined, writing nothing, for another user's or a missing document", async () => {
    const { c, send } = client((cmd) => {
      if (cmd instanceof QueryCommand) return { Items: [] };
      return {};
    });
    const repo = new DocumentRepository(c, 'T', undefined, 'U');
    await expect(repo.setDefault('u2', 'D1', 1, audit('x'))).resolves.toBeUndefined();
    await expect(repo.rename('u2', 'D1', 'x', 1, audit('x'))).resolves.toBeUndefined();
    await expect(repo.delete('u2', 'D1', audit('x'))).resolves.toBeUndefined();
    expect(send.mock.calls.some(([cmd]) => cmd instanceof TransactWriteCommand)).toBe(false);
  });
});
