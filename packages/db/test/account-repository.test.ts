import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { BatchWriteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { AccountRepository, eraseUserItems } from '../src/index.js';

const NOW = new Date('2026-09-28T00:00:00.000Z');
const conditionFailed = () =>
  Object.assign(new Error('no'), { name: 'ConditionalCheckFailedException' });

function client(handler: (cmd: unknown) => unknown) {
  const send = vi.fn(async (cmd: unknown) => handler(cmd));
  return { c: { send } as unknown as DynamoDBDocumentClient, send };
}

describe('AccountRepository', () => {
  it('records a deletion request that expires after 2 hours', async () => {
    const { c, send } = client(() => ({}));
    const req = await new AccountRepository(c, 'users', () => NOW).requestDeletion('u1', 'name1');
    expect(req).toMatchObject({ sk: 'DELETION', status: 'queued', username: 'name1' });
    expect(req.ttl).toBe(NOW.getTime() / 1000 + 7200);
    const put = send.mock.calls[0]?.[0] as PutCommand;
    expect(put.input.ConditionExpression).toBe('attribute_not_exists(userId)');
  });

  it('is idempotent: a repeated request returns the first one', async () => {
    const first = { userId: 'u1', sk: 'DELETION', requestedAt: 'earlier' };
    const { c } = client((cmd) => {
      if (cmd instanceof PutCommand) throw conditionFailed();
      if (cmd instanceof GetCommand) return { Item: first };
      return {};
    });
    await expect(
      new AccountRepository(c, 'users').requestDeletion('u1', 'n'),
    ).resolves.toMatchObject({
      requestedAt: 'earlier',
    });
  });

  it('answers whether an account is being deleted', async () => {
    const { c } = client((cmd) =>
      (cmd as GetCommand).input.Key?.userId === 'u1' ? { Item: {} } : {},
    );
    const repo = new AccountRepository(c, 'users');
    await expect(repo.isBeingDeleted('u1')).resolves.toBe(true);
    await expect(repo.isBeingDeleted('u2')).resolves.toBe(false);
  });
});

describe('eraseUserItems', () => {
  it('deletes every page in 25-item batches, keeping the deletion request', async () => {
    const pages: Record<string, unknown>[][] = [
      [
        ...Array.from({ length: 30 }, (_, i) => ({ userId: 'u1', sk: `ROLE#${i}` })),
        { userId: 'u1', sk: 'DELETION' },
      ],
      Array.from({ length: 5 }, (_, i) => ({ userId: 'u1', sk: `X#${i}` })),
    ];
    let page = 0;
    const { c, send } = client((cmd) => {
      if (cmd instanceof QueryCommand) {
        const items = pages[page] ?? [];
        page += 1;
        return {
          Items: items,
          ...(page < pages.length ? { LastEvaluatedKey: { userId: 'u1', sk: 'x' } } : {}),
        };
      }
      return {};
    });
    const count = await eraseUserItems(c, [{ name: 'users', sortKey: 'sk' }], 'u1');
    expect(count).toBe(35);
    const batches = send.mock.calls
      .map(([cmd]) => cmd)
      .filter((cmd) => cmd instanceof BatchWriteCommand) as BatchWriteCommand[];
    expect(batches.map((b) => b.input.RequestItems?.users?.length)).toEqual([25, 5, 5]);
    const deletedKeys = batches
      .flatMap((b) => b.input.RequestItems?.users ?? [])
      .map((r) => r.DeleteRequest?.Key?.sk);
    expect(deletedKeys).not.toContain('DELETION');
  });

  it('retries unprocessed items with backoff, and gives up loudly', async () => {
    let calls = 0;
    const { c } = client((cmd) => {
      if (cmd instanceof QueryCommand) return { Items: [{ userId: 'u1', documentId: 'D1' }] };
      calls += 1;
      return calls === 1
        ? {
            UnprocessedItems: {
              docs: [{ DeleteRequest: { Key: { userId: 'u1', documentId: 'D1' } } }],
            },
          }
        : {};
    });
    const sleep = vi.fn(async () => undefined);
    await expect(
      eraseUserItems(c, [{ name: 'docs', sortKey: 'documentId' }], 'u1', sleep),
    ).resolves.toBe(1);
    expect(sleep).toHaveBeenCalledTimes(1);

    const stuck = client((cmd) =>
      cmd instanceof QueryCommand
        ? { Items: [{ userId: 'u1', documentId: 'D1' }] }
        : { UnprocessedItems: { docs: [{ DeleteRequest: { Key: {} } }] } },
    );
    await expect(
      eraseUserItems(stuck.c, [{ name: 'docs', sortKey: 'documentId' }], 'u1', sleep),
    ).rejects.toThrow('Could not delete all items');
  });

  it('only ever queries the given user', async () => {
    const { c, send } = client(() => ({ Items: [] }));
    await eraseUserItems(
      c,
      [
        { name: 'a', sortKey: 'sk' },
        { name: 'b', sortKey: 'documentId' },
      ],
      'u1',
    );
    for (const [cmd] of send.mock.calls) {
      expect((cmd as QueryCommand).input.ExpressionAttributeValues).toEqual({ ':u': 'u1' });
    }
    expect(send).toHaveBeenCalledTimes(2);
  });
});
