import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  type PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { DocumentRepository, VersionConflictError } from '../src/index.js';

const NOW = new Date('2026-09-28T00:00:00.000Z');
const conditionFailed = () =>
  Object.assign(new Error('no'), { name: 'ConditionalCheckFailedException' });

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
  it('creates a pending document that expires after a day unless the upload arrives', async () => {
    const { c, send } = client(() => ({}));
    const created = await new DocumentRepository(c, 'T', () => NOW).create({
      userId: 'u1',
      documentId: 'D1',
      title: 'CV',
      fileName: 'cv.pdf',
      mimeType: 'application/pdf',
      format: 'pdf',
      s3Key: 'users/u1/documents/D1/original',
      isDefault: true,
    });
    expect(created).toMatchObject({
      status: 'pending',
      version: 1,
      kind: 'resume',
      origin: 'uploaded',
    });
    expect(created.ttl).toBe(NOW.getTime() / 1000 + 86400);
    const cmd = send.mock.calls[0]?.[0] as PutCommand;
    expect(cmd.input.ConditionExpression).toBe('attribute_not_exists(userId)');
  });

  it('claims a pending file or a re-upload, and clears the expiry', async () => {
    const { c, send } = client(() => ({ Attributes: doc({ status: 'processing' }) }));
    await new DocumentRepository(c, 'T').startProcessing('u1', 'D1', '"e1"', 100);
    const cmd = send.mock.calls[0]?.[0] as UpdateCommand;
    expect(cmd.input.ConditionExpression).toBe(
      'attribute_exists(userId) AND (#status = :pending OR eTag <> :etag)',
    );
    expect(cmd.input.UpdateExpression).toContain('REMOVE #ttl');
  });

  it('returns undefined for duplicates or stale events', async () => {
    const { c } = client(() => {
      throw conditionFailed();
    });
    const repo = new DocumentRepository(c, 'T');
    await expect(repo.startProcessing('u1', 'D1', '"e1"', 1)).resolves.toBeUndefined();
    await expect(
      repo.markReady('u1', 'D1', '"e1"', {
        textS3Key: 'k',
        charCount: 1,
        noText: false,
        truncated: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('only marks the processed file ready, and sends only the placeholders it uses', async () => {
    const { c, send } = client(() => ({ Attributes: doc() }));
    await new DocumentRepository(c, 'T').markReady('u1', 'D1', '"e1"', {
      textS3Key: 'k',
      charCount: 1,
      noText: false,
      truncated: false,
    });
    const cmd = send.mock.calls[0]?.[0] as UpdateCommand;
    expect(cmd.input.ConditionExpression).toBe('attribute_exists(userId) AND eTag = :etag');
    expect(cmd.input.ExpressionAttributeNames).toEqual({ '#status': 'status' });
  });

  it('rejects whatever the status (threats always win)', async () => {
    const { c, send } = client(() => ({ Attributes: doc({ status: 'rejected' }) }));
    await new DocumentRepository(c, 'T').markRejected('u1', 'D1', 'x'.repeat(1000));
    const cmd = send.mock.calls[0]?.[0] as UpdateCommand;
    expect(cmd.input.ConditionExpression).toBe('attribute_exists(userId)');
    expect(String(cmd.input.ExpressionAttributeValues?.[':error']).length).toBe(300);
  });

  it('renames with the right version, and conflicts on a stale one', async () => {
    const { c } = client((cmd) => {
      if (cmd instanceof GetCommand) return { Item: doc({ version: 2 }) };
      return { Attributes: doc({ version: 3, title: 'New' }) };
    });
    const repo = new DocumentRepository(c, 'T');
    await expect(repo.rename('u1', 'D1', 'New', 2)).resolves.toMatchObject({ version: 3 });
    await expect(repo.rename('u1', 'D1', 'New', 1)).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('switches the default atomically, clearing the old one', async () => {
    const { c, send } = client((cmd) => {
      if (cmd instanceof QueryCommand) {
        return { Items: [doc({ documentId: 'OLD', isDefault: true }), doc({ documentId: 'D1' })] };
      }
      return {};
    });
    const result = await new DocumentRepository(c, 'T').setDefault('u1', 'D1', 1);
    expect(result).toMatchObject({ isDefault: true, version: 2 });
    const tx = send.mock.calls.find(
      ([cmd]) => cmd instanceof TransactWriteCommand,
    )?.[0] as TransactWriteCommand;
    const keys = tx.input.TransactItems?.map((t) => t.Update?.Key?.documentId);
    expect(keys).toEqual(['D1', 'OLD']);
  });

  it('turns a cancelled default switch into a conflict', async () => {
    const { c } = client((cmd) => {
      if (cmd instanceof QueryCommand) return { Items: [doc()] };
      throw Object.assign(new Error('x'), { name: 'TransactionCanceledException' });
    });
    await expect(new DocumentRepository(c, 'T').setDefault('u1', 'D1', 1)).rejects.toBeInstanceOf(
      VersionConflictError,
    );
  });

  it("returns undefined for another user's or a missing document", async () => {
    const { c } = client((cmd) => {
      if (cmd instanceof QueryCommand) return { Items: [] };
      if (cmd instanceof GetCommand) return {};
      if (cmd instanceof DeleteCommand) throw conditionFailed();
      return {};
    });
    const repo = new DocumentRepository(c, 'T');
    await expect(repo.setDefault('u2', 'D1', 1)).resolves.toBeUndefined();
    await expect(repo.rename('u2', 'D1', 'x', 1)).resolves.toBeUndefined();
    await expect(repo.delete('u2', 'D1')).resolves.toBeUndefined();
  });
});
