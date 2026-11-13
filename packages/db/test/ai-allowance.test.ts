import type {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import {
  aiUsageSk,
  aiUsageUpdate,
  CrawlRepository,
  listAiUsage,
  PlatformAllowanceError,
  platformRunsUsed,
  USAGE_WEEK_TTL_SECONDS,
} from '../src/index.js';

// T08b3 (0009): one free platform run per crawl, counted exactly at submit (week and month),
// given back when the crawl fails; token use per month, key source, provider, model, task.

const NOW = new Date('2026-09-30T12:00:00.000Z'); // ISO week 2026-W40
const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const TABLES = { crawls: 'Crawls', sources: 'Sources', audit: 'Audit', usage: 'Usage' };
type Items = NonNullable<TransactWriteCommand['input']['TransactItems']>;

function client(onTransact: (items: Items) => void = () => {}) {
  const transactions: Items[] = [];
  const send = vi.fn(async (cmd: unknown) => {
    const items = (cmd as TransactWriteCommand).input.TransactItems as Items;
    transactions.push(items);
    onTransact(items);
    return {};
  });
  return { c: { send } as unknown as DynamoDBDocumentClient, transactions };
}
const cancelled = (index: number, length = 7) =>
  Object.assign(new Error('TransactionCanceledException'), {
    name: 'TransactionCanceledException',
    CancellationReasons: Array.from({ length }, (_, i) => ({
      Code: i === index ? 'ConditionalCheckFailed' : 'None',
    })),
  });

const request = {
  userId: USER,
  crawlId: 'C1',
  sourceId: 'S1',
  url: 'https://example.com/jobs',
  normalizedUrl: 'https://example.com/jobs',
  audit: {
    auditId: 'A1',
    name: 'crawl.requested',
    entity: { type: 'crawl', id: 'C1' },
    actor: 'user' as const,
    summary: 'x',
  },
  dailyLimit: 20,
  maxActive: 1,
};
const repo = (c: DynamoDBDocumentClient) => new CrawlRepository(c, TABLES, () => NOW);

describe('a crawl with the platform model', () => {
  it('counts one free run in the week and the month, only while both have room, and records it', async () => {
    const { c, transactions } = client();
    const crawl = await repo(c).request({
      ...request,
      aiSource: 'platform',
      platformRuns: { perWeek: 1, perMonth: 4 },
    });
    expect(crawl.aiRun).toEqual({ week: '2026-W40', month: '2026-09' });
    const items = transactions[0] ?? [];
    expect(items).toHaveLength(7);
    expect(items[4]?.Update).toMatchObject({
      Key: { userId: USER, sk: 'MONTH#2026-09' },
      ConditionExpression:
        'attribute_not_exists(platformRunIds) OR size(platformRunIds) < :perMonth',
      ExpressionAttributeValues: { ':id': new Set(['C1']), ':perMonth': 4 },
    });
    expect(items[4]?.Update?.UpdateExpression).toContain('ADD platformRunIds :id');
    expect(items[6]?.Update).toMatchObject({
      Key: { userId: USER, sk: 'AIWEEK#2026-W40' },
      ConditionExpression:
        'attribute_not_exists(platformRunIds) OR size(platformRunIds) < :perWeek',
      ExpressionAttributeValues: {
        ':perWeek': 1,
        ':ttl': Math.floor(NOW.getTime() / 1000) + USAGE_WEEK_TTL_SECONDS,
      },
    });
  });

  it('refuses when the week or the month is used up (nothing is saved)', async () => {
    for (const index of [4, 6]) {
      const { c } = client(() => {
        throw cancelled(index);
      });
      await expect(
        repo(c).request({
          ...request,
          aiSource: 'platform',
          platformRuns: { perWeek: 1, perMonth: 4 },
        }),
      ).rejects.toBeInstanceOf(PlatformAllowanceError);
    }
  });

  it('counts nothing for own keys or none', async () => {
    const { c, transactions } = client();
    const crawl = await repo(c).request({ ...request, aiSource: 'none' });
    expect(crawl.aiRun).toBeUndefined();
    expect(transactions[0]).toHaveLength(6);
    expect(transactions[0]?.[4]?.Update?.ConditionExpression).toBeUndefined();
  });
});

describe('a crawl that fails', () => {
  const crawl = { userId: USER, crawlId: 'C1', sourceId: 'S1' };
  const failed = {
    status: 'failed' as const,
    error: { code: 'unreachable' as const, message: 'x' },
  };
  const audit = {
    auditId: 'A2',
    name: 'crawl.failed',
    entity: { type: 'crawl', id: 'C1' },
    actor: 'system' as const,
    summary: 'x',
  };

  it('gives its free run back to the week and month it was counted in', async () => {
    const { c, transactions } = client();
    await repo(c).finish(
      { ...crawl, aiRun: { week: '2026-W39', month: '2026-09' } },
      failed,
      audit,
    );
    const refunds = (transactions[0] ?? []).slice(3);
    expect(refunds.map((i) => i.Update?.Key?.sk)).toEqual(['AIWEEK#2026-W39', 'MONTH#2026-09']);
    for (const r of refunds) {
      expect(r.Update?.UpdateExpression).toContain('DELETE platformRunIds :id');
      expect(r.Update?.ExpressionAttributeValues?.[':id']).toEqual(new Set(['C1']));
    }
  });

  it('keeps it when the crawl succeeded (its AI work can start), or used no free run', async () => {
    const ok = client();
    await repo(ok.c).finish(
      { ...crawl, aiRun: { week: '2026-W40', month: '2026-09' } },
      {
        status: 'succeeded',
        result: { finalUrl: 'u', httpStatus: 200, contentType: 'text/html', bytes: 1, s3Key: 'k' },
      },
      audit,
    );
    expect(ok.transactions[0]).toHaveLength(3);
    const noRun = client();
    await repo(noRun.c).finish(crawl, failed, audit);
    expect(noRun.transactions[0]).toHaveLength(3);
  });
});

describe('platformRunsUsed', () => {
  it('reads this week’s and month’s runs', async () => {
    const send = vi.fn(async (cmd: GetCommand) => ({
      Item:
        cmd.input.Key?.sk === 'AIWEEK#2026-W40'
          ? { platformRunIds: new Set(['C1']) }
          : { platformRunIds: new Set(['C1', 'C0']) },
    }));
    const used = await platformRunsUsed(
      { send } as unknown as DynamoDBDocumentClient,
      'Usage',
      USER,
      NOW,
    );
    expect(used).toEqual({ week: 1, month: 2 });
    const none = await platformRunsUsed(
      { send: vi.fn(async () => ({})) } as unknown as DynamoDBDocumentClient,
      'Usage',
      USER,
      NOW,
    );
    expect(none).toEqual({ week: 0, month: 0 });
  });
});

describe('AI token usage', () => {
  const record = {
    keySource: 'platform' as const,
    provider: 'bedrock',
    modelId: 'mistral.ministral-3-14b-instruct',
    task: 'relevance',
    calls: 2,
    inputTokens: 1200,
    outputTokens: 90,
    runs: 1,
  };

  it('adds a task call to the month’s item for this model, with its per-task counts', () => {
    const update = aiUsageUpdate('Usage', USER, NOW, record).Update;
    expect(update.Key).toEqual({
      userId: USER,
      sk: 'AI#2026-09#platform#bedrock#mistral.ministral-3-14b-instruct',
    });
    expect(update.UpdateExpression).toMatch(/^ADD #runs :runs, #calls :calls, #task_calls :calls/);
    expect(update.ExpressionAttributeNames).toMatchObject({
      '#calls': 'calls',
      '#task_calls': 'task_relevance_calls',
      '#task_inputTokens': 'task_relevance_inputTokens',
    });
    expect(update.ExpressionAttributeValues).toMatchObject({
      ':calls': 2,
      ':inputTokens': 1200,
      ':outputTokens': 90,
      ':runs': 1,
    });
    expect(() => aiUsageUpdate('Usage', USER, NOW, { ...record, task: 'Bad Task' })).toThrow(
      'invalid task',
    );
  });

  it('lists a month per model, with each task separately', async () => {
    const send = vi.fn(async (cmd: QueryCommand) => {
      expect(cmd.input.ExpressionAttributeValues).toEqual({
        ':userId': USER,
        ':prefix': 'AI#2026-09#',
      });
      return {
        Items: [
          {
            sk: aiUsageSk('2026-09', record),
            keySource: 'platform',
            provider: 'bedrock',
            modelId: record.modelId,
            calls: 3,
            inputTokens: 1500,
            outputTokens: 120,
            runs: 1,
            task_relevance_calls: 2,
            task_relevance_inputTokens: 1200,
            task_relevance_outputTokens: 90,
            task_llm_extraction_calls: 1,
          },
        ],
      };
    });
    const entries = await listAiUsage(
      { send } as unknown as DynamoDBDocumentClient,
      'Usage',
      USER,
      '2026-09',
    );
    expect(entries).toEqual([
      {
        keySource: 'platform',
        provider: 'bedrock',
        modelId: record.modelId,
        calls: 3,
        inputTokens: 1500,
        outputTokens: 120,
        runs: 1,
        byTask: {
          relevance: { calls: 2, inputTokens: 1200, outputTokens: 90 },
          'llm-extraction': { calls: 1, inputTokens: 0, outputTokens: 0 },
        },
      },
    ]);
  });
});
