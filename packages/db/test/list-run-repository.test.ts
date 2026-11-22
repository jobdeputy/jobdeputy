import type {
  DynamoDBDocumentClient,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { CRAWL_TTL_SECONDS, type Crawl, ListRunRepository } from '../src/index.js';

const NOW = new Date('2026-11-22T12:00:00.000Z');
const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const TABLES = { crawls: 'Crawls', sources: 'Sources', audit: 'Audit' };
const named = (name: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(name), { name, ...extra });
const cancelled = (...codes: string[]) =>
  named('TransactionCanceledException', { CancellationReasons: codes.map((Code) => ({ Code })) });

function client(handler: (cmd: unknown) => unknown = () => ({})) {
  const send = vi.fn(async (cmd: unknown) => handler(cmd));
  return { c: { send } as unknown as DynamoDBDocumentClient, send };
}
/** The input of the first command sent (fails the test if none was). */
function first<T extends { input: object }>(send: { mock: { calls: unknown[][] } }): T['input'] {
  const call = send.mock.calls[0];
  if (!call) throw new Error('Nothing sent');
  return (call[0] as T).input;
}
const repo = (c: DynamoDBDocumentClient) => new ListRunRepository(c, TABLES, () => NOW);
const list = (over: Partial<Crawl> = {}) =>
  ({ userId: USER, crawlId: 'L1', queuedCount: 2, ...over }) as Crawl;
const company = {
  crawlId: 'C9',
  sourceId: 'S9',
  url: 'https://job-boards.greenhouse.io/acme',
  normalizedUrl: 'https://job-boards.greenhouse.io/acme',
  listShare: 3,
  audit: {
    auditId: '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2E',
    name: 'crawl.requested',
    entity: { type: 'crawl', id: 'C9' },
    actor: 'system' as const,
    summary: 'x',
  },
};

describe('ListRunRepository (#50)', () => {
  it("records the list's choice once, while it runs", async () => {
    const { c, send } = client();
    const result = {
      finalUrl: 'u',
      httpStatus: 200,
      contentType: 'text/plain',
      bytes: 1,
      s3Key: 'k',
    };
    const chosen = { rows: 3, matched: 2, companiesMatched: 1, companies: [], skipped: 0 };
    expect(await repo(c).choose(USER, 'L1', chosen, result)).toBe(true);
    const update = first<UpdateCommand>(send);
    expect(update.ConditionExpression).toBe('#status = :running AND attribute_not_exists(#list)');
    expect(update.ExpressionAttributeValues).toMatchObject({ ':list': chosen, ':zero': 0 });

    const { c: again } = client(() => {
      throw named('ConditionalCheckFailedException');
    });
    expect(await repo(again).choose(USER, 'L1', chosen, result)).toBe(false);
  });

  it('queues the next company: the list moves on, the crawl is queued, its board is claimed, all at once', async () => {
    const { c, send } = client();
    expect(await repo(c).queueCompany(list(), 3, company)).toBe('queued');
    const items = first<TransactWriteCommand>(send).TransactItems ?? [];
    expect(items[0]?.Update).toMatchObject({
      Key: { userId: USER, crawlId: 'L1' },
      ConditionExpression:
        '#status = :running AND queuedCount = :position AND (attribute_not_exists(runningIds) OR size(runningIds) < :max)',
      ExpressionAttributeValues: expect.objectContaining({
        ':position': 2,
        ':next': 3,
        ':max': 3,
        ':ids': ['C9'],
        ':id': new Set(['C9']),
      }),
    });
    expect(items[1]?.Put?.Item).toMatchObject({
      crawlId: 'C9',
      status: 'queued',
      trigger: 'list',
      parentCrawlId: 'L1',
      aiSource: 'none',
      listShare: 3,
      url: company.normalizedUrl,
      ttl: NOW.getTime() / 1000 + CRAWL_TTL_SECONDS,
    });
    expect(items[2]?.Update).toMatchObject({
      TableName: 'Sources',
      Key: { userId: USER, sourceId: 'S9' },
      ConditionExpression: 'attribute_not_exists(activeCrawlId)',
    });
    expect(items[3]?.Put?.TableName).toBe('Audit');
  });

  it('takes over a board whose earlier crawl has ended', async () => {
    const { c, send } = client();
    await repo(c).queueCompany(list(), 3, { ...company, replacing: 'OLD' });
    const items = first<TransactWriteCommand>(send).TransactItems ?? [];
    expect(items[2]?.Update?.ConditionExpression).toBe(
      'attribute_not_exists(activeCrawlId) OR activeCrawlId = :replacing',
    );
  });

  it('says when the list moved on meanwhile, or the board is busy', async () => {
    const moved = client(() => {
      throw cancelled('ConditionalCheckFailed', 'None', 'None', 'None');
    });
    expect(await repo(moved.c).queueCompany(list(), 3, company)).toBe('moved');
    const busy = client(() => {
      throw cancelled('None', 'None', 'ConditionalCheckFailed', 'None');
    });
    expect(await repo(busy.c).queueCompany(list(), 3, company)).toBe('busy');
  });

  it('marks a running list as still moving, and ignores one that ended', async () => {
    const { c, send } = client();
    await repo(c).touch(USER, 'L1');
    const update = first<UpdateCommand>(send);
    expect(update.UpdateExpression).toBe('SET updatedAt = :now');
    expect(update.ConditionExpression).toBe('#status = :running');
    const { c: ended } = client(() => {
      throw named('ConditionalCheckFailedException');
    });
    await expect(repo(ended).touch(USER, 'L1')).resolves.toBeUndefined();
  });

  it('passes over a company, counting it, only from the position it read', async () => {
    const { c, send } = client();
    expect(await repo(c).skipCompany(list(), 'busy')).toBe(true);
    const update = first<UpdateCommand>(send);
    expect(update.UpdateExpression).toContain(
      '#list.#reason = if_not_exists(#list.#reason, :zero) + :one',
    );
    expect(update.ExpressionAttributeNames).toMatchObject({ '#reason': 'busy' });
    expect(update.ConditionExpression).toBe('#status = :running AND queuedCount = :position');
    expect(update.ExpressionAttributeValues).toMatchObject({ ':position': 2, ':next': 3 });

    const { c: late } = client(() => {
      throw named('ConditionalCheckFailedException');
    });
    expect(await repo(late).skipCompany(list(), 'skipped')).toBe(false);
  });
});
