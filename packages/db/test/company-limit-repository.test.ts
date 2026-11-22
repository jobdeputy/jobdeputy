import type { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetCommand, type QueryCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { CompanyLimitRepository, ShownConflictError } from '../src/index.js';
import { fakeTable } from './fake-ddb.js';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const named = (name: string) => Object.assign(new Error(name), { name });

describe('CompanyLimitRepository (T08c)', () => {
  it('reads nothing as an empty list at version 0, then replaces it only at the version read', async () => {
    const t = fakeTable();
    const repo = new CompanyLimitRepository(t.client, 'Usage', () => NOW);
    expect(await repo.get(USER, 'greenhouse:acme')).toEqual({ shown: {}, version: 0 });

    await repo.put(USER, 'greenhouse:acme', { j1: { p: 50 } }, 0);
    expect(await repo.get(USER, 'greenhouse:acme')).toEqual({
      shown: { j1: { p: 50 } },
      version: 1,
    });
    expect(t.items.get(`${USER}|COMPANY#greenhouse:acme`)).toMatchObject({
      type: 'company_shown',
      companyKey: 'greenhouse:acme',
      updatedAt: NOW.toISOString(),
    });

    // Another crawl wrote first: this one must read again.
    await expect(repo.put(USER, 'greenhouse:acme', {}, 0)).rejects.toBeInstanceOf(
      ShownConflictError,
    );
    await repo.put(USER, 'greenhouse:acme', { j2: { p: 60, t: '2026-09-29' } }, 1);
    expect((await repo.get(USER, 'greenhouse:acme')).version).toBe(2);
  });

  it('reads strongly consistently (a crawl must see the last write)', async () => {
    const send = vi.fn(async (_cmd: unknown) => ({}));
    await new CompanyLimitRepository({ send } as unknown as DynamoDBDocumentClient, 'Usage').get(
      USER,
      'k',
    );
    const cmd = send.mock.calls[0]?.[0] as unknown as GetCommand;
    expect(cmd).toBeInstanceOf(GetCommand);
    expect(cmd.input).toMatchObject({
      Key: { userId: USER, sk: 'COMPANY#k' },
      ConsistentRead: true,
    });
  });

  it('release frees places and moves the version on, so a crawl ranking meanwhile starts again', async () => {
    const send = vi.fn(async (_cmd: unknown) => ({}));
    const repo = new CompanyLimitRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'Usage',
      () => NOW,
    );
    await repo.release(USER, 'greenhouse:acme', ['j1', 'j2']);
    const input = (send.mock.calls[0]?.[0] as UpdateCommand | undefined)?.input;
    expect(input).toMatchObject({
      Key: { userId: USER, sk: 'COMPANY#greenhouse:acme' },
      UpdateExpression:
        'REMOVE #shown.#j0, #shown.#j1 SET version = version + :one, updatedAt = :now',
      ConditionExpression: 'attribute_exists(#shown)',
      ExpressionAttributeNames: { '#shown': 'shown', '#j0': 'j1', '#j1': 'j2' },
    });
  });

  it('release: nothing shown yet is fine; nothing to release sends nothing; other errors surface', async () => {
    const failing = (error: Error) =>
      new CompanyLimitRepository(
        { send: async () => Promise.reject(error) } as unknown as DynamoDBDocumentClient,
        'Usage',
      );
    await expect(
      failing(named('ConditionalCheckFailedException')).release(USER, 'k', ['j1']),
    ).resolves.toBeUndefined();
    await expect(
      failing(new Error('InternalServerError')).release(USER, 'k', ['j1']),
    ).rejects.toThrow('InternalServerError');
    const send = vi.fn();
    await new CompanyLimitRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'Usage',
    ).release(USER, 'k', []);
    expect(send).not.toHaveBeenCalled();
  });

  it('listShown (#49) lists every company with shown jobs, and skips empty ones', async () => {
    const t = fakeTable();
    const repo = new CompanyLimitRepository(t.client, 'Usage', () => NOW);
    expect(await repo.listShown(USER)).toEqual([]);
    await repo.put(USER, 'greenhouse:acme', { j1: { p: 50, s: 80 } }, 0);
    await repo.put(USER, 'lever:globex', { j2: { p: 60 } }, 0);
    await repo.put(USER, 'lever:empty', {}, 0);
    await repo.put('someone-else', 'greenhouse:initech', { j3: { p: 1 } }, 0);
    expect(
      (await repo.listShown(USER)).sort((a, b) => a.companyKey.localeCompare(b.companyKey)),
    ).toEqual([
      { companyKey: 'greenhouse:acme', shown: { j1: { p: 50, s: 80 } } },
      { companyKey: 'lever:globex', shown: { j2: { p: 60 } } },
    ]);
  });

  it('listShown reads every page of a long list, only the fields it needs', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Items: [{ sk: 'COMPANY#a', shown: { j1: { p: 1 } } }],
        LastEvaluatedKey: { userId: USER, sk: 'COMPANY#a' },
      })
      .mockResolvedValueOnce({ Items: [{ sk: 'COMPANY#b', shown: { j2: { p: 2 } } }] });
    const repo = new CompanyLimitRepository({ send } as unknown as DynamoDBDocumentClient, 'Usage');
    expect((await repo.listShown(USER)).map((c) => c.companyKey)).toEqual(['a', 'b']);
    const [first, second] = send.mock.calls.map((c) => (c[0] as QueryCommand).input);
    expect(first).toMatchObject({
      KeyConditionExpression: 'userId = :u AND begins_with(sk, :p)',
      ExpressionAttributeValues: { ':u': USER, ':p': 'COMPANY#' },
      ProjectionExpression: 'sk, shown',
    });
    expect(first).not.toHaveProperty('ExclusiveStartKey');
    expect(second).toMatchObject({ ExclusiveStartKey: { userId: USER, sk: 'COMPANY#a' } });
  });
});
