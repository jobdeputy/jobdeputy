import type {
  DynamoDBDocumentClient,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { RelevanceConflictError, RelevanceRepository } from '../src/index.js';

const NOW = new Date('2026-10-01T06:00:00.000Z');
const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const CRAWL = '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2D';
const TABLES = { crawls: 'crawls', jobs: 'jobs', usage: 'usage', audit: 'audit' };

const named = (name: string, extra: object = {}) =>
  Object.assign(new Error(name), { name, ...extra });
const cancelled = (...codes: string[]) =>
  named('TransactionCanceledException', { CancellationReasons: codes.map((Code) => ({ Code })) });

function setup(handler: (cmd: unknown) => unknown = () => ({})) {
  const send = vi.fn(async (cmd: unknown) => handler(cmd));
  const repo = new RelevanceRepository(
    { send } as unknown as DynamoDBDocumentClient,
    TABLES,
    () => NOW,
  );
  return { repo, send };
}

const relevance = (score: number) => ({
  score,
  reasons: ['r'],
  model: 'm',
  promptVersion: 'relevance@v1',
  inputsHash: 'h',
  scoredAt: NOW.toISOString(),
});

const call = (jobIds: string[]) => ({
  userId: USER,
  crawlId: CRAWL,
  callsBefore: 0,
  sent: jobIds,
  llm: {
    keySource: 'platform' as const,
    provider: 'bedrock',
    model: 'm',
    calls: 1,
    inputTokens: 10,
    outputTokens: 5,
  },
  usage: {
    keySource: 'platform' as const,
    provider: 'bedrock',
    modelId: 'm',
    task: 'relevance',
    calls: 1,
    inputTokens: 10,
    outputTokens: 5,
    runs: 1,
  },
  scores: jobIds.map((jobId) => ({ jobId, relevance: relevance(50) })),
});

const items = (cmd: unknown) => (cmd as TransactWriteCommand).input.TransactItems ?? [];

describe('RelevanceRepository.begin', () => {
  it('starts a run only on a succeeded crawl that has none', async () => {
    const { repo, send } = setup();
    expect(await repo.begin(USER, CRAWL)).toBe(true);
    const update = send.mock.calls[0]?.[0] as UpdateCommand;
    expect(update.input).toMatchObject({
      ConditionExpression: 'attribute_not_exists(relevance) AND #status = :succeeded',
      ExpressionAttributeValues: expect.objectContaining({
        ':relevance': { status: 'running', startedAt: NOW.toISOString(), calls: 0, sent: [] },
      }),
    });
  });

  it('false when it already started (a retried message)', async () => {
    const { repo } = setup(() => {
      throw named('ConditionalCheckFailedException');
    });
    expect(await repo.begin(USER, CRAWL)).toBe(false);
  });
});

describe('RelevanceRepository.saveCall', () => {
  it('stores progress, usage, and every score in one transaction', async () => {
    const { repo, send } = setup();
    await repo.saveCall(call(['j1', 'j2']));
    const list = items(send.mock.calls[0]?.[0]);
    expect(list).toHaveLength(4);
    expect(list[0]?.Update).toMatchObject({
      TableName: 'crawls',
      ConditionExpression: 'relevance.#status = :running AND relevance.calls = :before',
      ExpressionAttributeValues: expect.objectContaining({
        ':calls': 1,
        ':before': 0,
        ':sent': ['j1', 'j2'],
      }),
    });
    expect(list[1]?.Update?.TableName).toBe('usage');
    expect(list[1]?.Update?.ExpressionAttributeValues?.[':runs']).toBe(1);
    expect(list.slice(2).map((i) => i.Update?.Key?.jobId)).toEqual(['j1', 'j2']);
    expect(list[2]?.Update?.ConditionExpression).toBe('attribute_exists(userId)');
  });

  it('leaves out jobs deleted meanwhile and stores the rest', async () => {
    const { repo, send } = setup((cmd) => {
      const jobs = items(cmd)
        .slice(2)
        .map((i) => i.Update?.Key?.jobId);
      if (jobs.includes('gone')) {
        throw cancelled(
          'None',
          'None',
          ...jobs.map((j) => (j === 'gone' ? 'ConditionalCheckFailed' : 'None')),
        );
      }
      return {};
    });
    await repo.saveCall(call(['j1', 'gone', 'j2']));
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      items(send.mock.calls[1]?.[0])
        .slice(2)
        .map((i) => i.Update?.Key?.jobId),
    ).toEqual(['j1', 'j2']);
    // The crawl still records every job sent.
    expect(items(send.mock.calls[1]?.[0])[0]?.Update?.ExpressionAttributeValues?.[':sent']).toEqual(
      ['j1', 'gone', 'j2'],
    );
  });

  it('another delivery stored a call meanwhile: conflict, nothing stored', async () => {
    const { repo } = setup(() => {
      throw cancelled('ConditionalCheckFailed', 'None', 'None');
    });
    await expect(repo.saveCall(call(['j1']))).rejects.toBeInstanceOf(RelevanceConflictError);
  });

  it('other errors are thrown as they are', async () => {
    const { repo } = setup(() => {
      throw named('ProvisionedThroughputExceededException');
    });
    await expect(repo.saveCall(call(['j1']))).rejects.toThrow('ProvisionedThroughputExceeded');
  });
});

describe('RelevanceRepository.finish', () => {
  const stats = { candidates: 2, scored: 2, reused: 0, unscored: 0, hidden: 1, overLimit: 0 };
  const audit = {
    table: 'audit',
    entry: {
      auditId: 'a1',
      name: 'crawl.scored',
      entity: { type: 'crawl', id: CRAWL },
      actor: 'system' as const,
      summary: 's',
    },
  };

  it('ends a running run with its stats and an audit entry', async () => {
    const { repo, send } = setup();
    expect(
      await repo.finish({
        userId: USER,
        crawlId: CRAWL,
        status: 'failed',
        reason: 'key_invalid',
        stats,
        audit,
      }),
    ).toBe(true);
    const list = items(send.mock.calls[0]?.[0]);
    expect(list[0]?.Update?.UpdateExpression).toContain('relevance.reason = :reason');
    expect(list[1]?.Put?.TableName).toBe('audit');
  });

  it('false when it already ended', async () => {
    const { repo } = setup(() => {
      throw cancelled('ConditionalCheckFailed', 'None');
    });
    expect(await repo.finish({ userId: USER, crawlId: CRAWL, status: 'done', stats, audit })).toBe(
      false,
    );
  });
});
