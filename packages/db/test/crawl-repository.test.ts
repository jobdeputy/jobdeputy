import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  type GetCommand,
  type QueryCommand,
  TransactWriteCommand,
  type UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import {
  ActiveCrawlError,
  AUDIT_TTL_SECONDS,
  AuditRepository,
  auditItem,
  CRAWL_TTL_SECONDS,
  CrawlRepository,
  sourceIdFor,
} from '../src/index.js';

const NOW = new Date('2026-09-28T12:00:00.000Z');
const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const TABLES = { crawls: 'Crawls', sources: 'Sources', audit: 'Audit' };
const named = (name: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(name), { name, ...extra });

function client(handler: (cmd: unknown) => unknown = () => ({})) {
  const send = vi.fn(async (cmd: unknown) => handler(cmd));
  return { c: { send } as unknown as DynamoDBDocumentClient, send };
}
/** The command sent in call `n` (fails the test if there was none). */
function sent<T>(send: { mock: { calls: unknown[][] } }, n: number): T {
  const call = send.mock.calls[n];
  if (!call) throw new Error(`No call ${n}`);
  return call[0] as T;
}
const repo = (c: DynamoDBDocumentClient) => new CrawlRepository(c, TABLES, () => NOW);
const audit = (name: string) => ({
  auditId: '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2E',
  name,
  entity: { type: 'crawl', id: 'C1' },
  actor: 'user' as const,
  summary: 'x',
});

describe('sourceIdFor', () => {
  it('is deterministic, 32 hex characters, and differs per URL', () => {
    const a = sourceIdFor('https://example.com/jobs');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(sourceIdFor('https://example.com/jobs')).toBe(a);
    expect(sourceIdFor('https://example.com/jobs?page=2')).not.toBe(a);
  });
});

describe('auditItem', () => {
  it('adds the type, times, schema version, and a one-year expiry', () => {
    const item = auditItem({ ...audit('crawl.requested'), userId: USER }, NOW);
    expect(item).toMatchObject({
      type: 'audit',
      userId: USER,
      createdAt: NOW.toISOString(),
      schemaVersion: 1,
      ttl: NOW.getTime() / 1000 + AUDIT_TTL_SECONDS,
    });
  });
});

describe('CrawlRepository.request', () => {
  const input = {
    userId: USER,
    crawlId: 'C1',
    sourceId: 'S1',
    url: 'https://Example.com/jobs#x',
    normalizedUrl: 'https://example.com/jobs',
    audit: audit('crawl.requested'),
  };

  it('saves the source, queues the crawl, and audits it in one transaction', async () => {
    const { c, send } = client();
    const crawl = await repo(c).request(input);
    expect(crawl).toMatchObject({
      status: 'queued',
      attempts: 0,
      url: 'https://example.com/jobs',
      sourceId: 'S1',
      ttl: NOW.getTime() / 1000 + CRAWL_TTL_SECONDS,
    });
    const tx = sent<TransactWriteCommand>(send, 0);
    expect(tx).toBeInstanceOf(TransactWriteCommand);
    const [source, put, entry] = tx.input.TransactItems ?? [];
    expect(source?.Update?.TableName).toBe('Sources');
    expect(source?.Update?.ConditionExpression).toBe('attribute_not_exists(activeCrawlId)');
    expect(source?.Update?.UpdateExpression).toContain('activeCrawlId = :crawlId');
    expect(put?.Put).toMatchObject({
      TableName: 'Crawls',
      Item: { crawlId: 'C1', status: 'queued' },
    });
    expect(entry?.Put).toMatchObject({
      TableName: 'Audit',
      Item: { name: 'crawl.requested', userId: USER },
    });
  });

  it('may replace a named stale crawl, and only that one', async () => {
    const { c, send } = client();
    await repo(c).request({ ...input, replacing: 'OLD' });
    const source = sent<TransactWriteCommand>(send, 0).input.TransactItems?.[0]?.Update;
    expect(source?.ConditionExpression).toBe(
      'attribute_not_exists(activeCrawlId) OR activeCrawlId = :replacing',
    );
    expect(source?.ExpressionAttributeValues?.[':replacing']).toBe('OLD');
  });

  it('reports an active crawl on the same page', async () => {
    const { c } = client(() => {
      throw named('TransactionCanceledException', {
        CancellationReasons: [
          { Code: 'ConditionalCheckFailed' },
          { Code: 'None' },
          { Code: 'None' },
        ],
      });
    });
    await expect(repo(c).request(input)).rejects.toBeInstanceOf(ActiveCrawlError);
  });

  it('passes other failures through', async () => {
    const { c } = client(() => {
      throw named('TransactionCanceledException', {
        CancellationReasons: [
          { Code: 'None' },
          { Code: 'ConditionalCheckFailed' },
          { Code: 'None' },
        ],
      });
    });
    await expect(repo(c).request(input)).rejects.toThrow('TransactionCanceledException');
  });
});

describe('CrawlRepository.start', () => {
  it('claims a queued or retried crawl and counts the attempt', async () => {
    const { c, send } = client(() => ({
      Attributes: { crawlId: 'C1', status: 'running', attempts: 1 },
    }));
    const crawl = await repo(c).start(USER, 'C1');
    expect(crawl?.attempts).toBe(1);
    const cmd = sent<UpdateCommand>(send, 0);
    expect(cmd.input.ConditionExpression).toBe('#status IN (:queued, :running)');
    expect(cmd.input.UpdateExpression).toContain('attempts = attempts + :one');
    expect(cmd.input.UpdateExpression).toContain('startedAt = if_not_exists(startedAt, :now)');
  });

  it('returns undefined for a finished or missing crawl (a duplicate delivery)', async () => {
    const { c } = client(() => {
      throw named('ConditionalCheckFailedException');
    });
    expect(await repo(c).start(USER, 'C1')).toBeUndefined();
  });
});

describe('CrawlRepository.recordRetry', () => {
  it('notes the error only on a running crawl, trimmed', async () => {
    const { c, send } = client();
    await repo(c).recordRetry(USER, 'C1', { code: 'timeout', message: 'x'.repeat(1000) });
    const cmd = sent<UpdateCommand>(send, 0);
    expect(cmd.input.ConditionExpression).toBe('#status = :running');
    expect(cmd.input.ExpressionAttributeValues).toMatchObject({
      ':error': { code: 'timeout', message: 'x'.repeat(300) },
    });
  });

  it('ignores a crawl that has meanwhile finished', async () => {
    const { c } = client(() => {
      throw named('ConditionalCheckFailedException');
    });
    await expect(
      repo(c).recordRetry(USER, 'C1', { code: 'timeout', message: 'x' }),
    ).resolves.toBeUndefined();
  });
});

describe('CrawlRepository.finish', () => {
  const crawl = { userId: USER, crawlId: 'C1', sourceId: 'S1' };
  const result = {
    finalUrl: 'https://example.com/jobs',
    httpStatus: 200,
    contentType: 'text/html',
    bytes: 10,
    s3Key: 'k',
  };

  it('succeeds and audits in one transaction, then frees the source', async () => {
    const { c, send } = client();
    expect(
      await repo(c).finish(crawl, { status: 'succeeded', result }, audit('crawl.succeeded')),
    ).toBe(true);
    const tx = sent<TransactWriteCommand>(send, 0).input.TransactItems ?? [];
    expect(tx[0]?.Update?.ConditionExpression).toBe('#status IN (:queued, :running)');
    expect(tx[0]?.Update?.UpdateExpression).toContain('#result = :outcome');
    expect(tx[0]?.Update?.ExpressionAttributeNames).toEqual({
      '#status': 'status',
      '#result': 'result',
    });
    expect(tx[1]?.Put?.Item).toMatchObject({ name: 'crawl.succeeded' });
    const source = sent<UpdateCommand>(send, 1);
    expect(source.input).toMatchObject({
      TableName: 'Sources',
      ConditionExpression: 'activeCrawlId = :crawlId',
      UpdateExpression: 'SET lastCrawledAt = :now, updatedAt = :now REMOVE activeCrawlId',
    });
  });

  it('fails with a trimmed error', async () => {
    const { c, send } = client();
    await repo(c).finish(
      crawl,
      { status: 'failed', error: { code: 'blocked', message: 'y'.repeat(999) } },
      audit('crawl.failed'),
    );
    const update = sent<TransactWriteCommand>(send, 0).input.TransactItems?.[0]?.Update;
    expect(update?.UpdateExpression).toContain('#error = :outcome');
    expect(update?.ExpressionAttributeNames).toEqual({ '#status': 'status', '#error': 'error' });
    expect(update?.ExpressionAttributeValues).toMatchObject({
      ':outcome': { code: 'blocked', message: 'y'.repeat(300) },
    });
  });

  it('does nothing (no audit, no source change) for a crawl already finished', async () => {
    const { c, send } = client(() => {
      throw named('TransactionCanceledException');
    });
    expect(
      await repo(c).finish(crawl, { status: 'succeeded', result }, audit('crawl.succeeded')),
    ).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('leaves a source that has moved on to a newer crawl alone', async () => {
    let calls = 0;
    const { c } = client(() => {
      calls += 1;
      if (calls === 2) throw named('ConditionalCheckFailedException');
      return {};
    });
    expect(
      await repo(c).finish(crawl, { status: 'succeeded', result }, audit('crawl.succeeded')),
    ).toBe(true);
  });
});

describe('reads', () => {
  it('gets sources and crawls with consistent reads', async () => {
    const { c, send } = client(() => ({ Item: { crawlId: 'C1' } }));
    await repo(c).getCrawl(USER, 'C1');
    await repo(c).getSource(USER, 'S1');
    const [crawl, source] = send.mock.calls.map((call) => call[0] as GetCommand);
    expect(crawl?.input).toMatchObject({
      TableName: 'Crawls',
      Key: { userId: USER, crawlId: 'C1' },
      ConsistentRead: true,
    });
    expect(source?.input).toMatchObject({
      TableName: 'Sources',
      Key: { userId: USER, sourceId: 'S1' },
    });
  });

  it('lists crawls and audit entries newest first, one page at a time', async () => {
    const { c, send } = client(() => ({
      Items: [{ crawlId: 'C2' }],
      LastEvaluatedKey: { userId: USER, crawlId: 'C2' },
    }));
    const page = await repo(c).listCrawls(USER, 1, 'C3');
    expect(page).toEqual({ items: [{ crawlId: 'C2' }], next: 'C2' });
    const query = sent<QueryCommand>(send, 0);
    expect(query.input).toMatchObject({
      TableName: 'Crawls',
      ScanIndexForward: false,
      Limit: 1,
      ExclusiveStartKey: { userId: USER, crawlId: 'C3' },
    });

    const { c: c2, send: send2 } = client(() => ({ Items: [] }));
    expect(await new AuditRepository(c2, 'Audit').list(USER, 20)).toEqual({ items: [] });
    expect(sent<QueryCommand>(send2, 0).input.ExclusiveStartKey).toBeUndefined();
  });
});

describe('DynamoDB reserved words', () => {
  // Found on a real table: `result` is reserved, and a mocked client cannot tell. Every
  // expression the repository sends is checked for these words used without a placeholder.
  const RESERVED = ['result', 'error', 'status', 'type', 'url', 'kind', 'name', 'source'];

  it('are never used bare in any expression', async () => {
    const { c, send } = client(() => ({ Attributes: {} }));
    const r = repo(c);
    const crawl = { userId: USER, crawlId: 'C1', sourceId: 'S1' };
    await r.request({
      userId: USER,
      crawlId: 'C1',
      sourceId: 'S1',
      url: 'u',
      normalizedUrl: 'u',
      audit: audit('crawl.requested'),
      replacing: 'OLD',
    });
    await r.start(USER, 'C1');
    await r.recordRetry(USER, 'C1', { code: 'timeout', message: 'x' });
    const result = {
      finalUrl: 'u',
      httpStatus: 200,
      contentType: 'text/html',
      bytes: 1,
      s3Key: 'k',
    };
    await r.finish(crawl, { status: 'succeeded', result }, audit('crawl.succeeded'));
    await r.finish(
      crawl,
      { status: 'failed', error: { code: 'blocked', message: 'x' } },
      audit('crawl.failed'),
    );

    const expressions = send.mock.calls.flatMap(([cmd]) => {
      const input = (cmd as { input: Record<string, unknown> }).input;
      const updates = (input.TransactItems as { Update?: Record<string, unknown> }[] | undefined)
        ?.map((i) => i.Update)
        .filter((u) => u !== undefined) ?? [input];
      return updates.flatMap(
        (u) => [u.UpdateExpression, u.ConditionExpression].filter(Boolean) as string[],
      );
    });
    expect(expressions.length).toBeGreaterThan(8);
    for (const expression of expressions) {
      for (const word of RESERVED) {
        expect(expression, expression).not.toMatch(new RegExp(`(^|[^#:\\w])${word}\\b`));
      }
    }
  });
});
