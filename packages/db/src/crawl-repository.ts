import { createHash } from 'node:crypto';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { type CrawlErrorCode, type CrawlStatus, utcDay, utcMonth } from '@jobdeputy/shared';
import { type AuditInput, auditItem, type Page, queryNewestFirst } from './audit-repository.js';
import { cancelledAt, isConditionFailure } from './client.js';

/** `sources` (docs/data-model.md): a page the user saved. Keys: `userId`, `sourceId`. */
export interface Source {
  userId: string;
  sourceId: string;
  type: 'source';
  url: string;
  normalizedUrl: string;
  kind: 'unknown';
  companyConfirmed: boolean;
  active: boolean;
  schedule: { type: 'manual' };
  lastCrawlId: string;
  lastCrawledAt?: string;
  /** Set while a crawl of this page is queued or running: a second submit returns it. */
  activeCrawlId?: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
}

/** `crawls` (docs/data-model.md): one crawl run. Keys: `userId`, `crawlId`. */
export interface Crawl {
  userId: string;
  crawlId: string;
  type: 'crawl';
  sourceId: string;
  /** The normalized URL at crawl time. */
  url: string;
  trigger: 'user';
  status: CrawlStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  result?: CrawlResult;
  error?: CrawlError;
  /** The last retriable failure, while a retry is pending. */
  lastError?: CrawlError;
  ttl: number;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
}

export interface CrawlResult {
  finalUrl: string;
  httpStatus: number;
  contentType: string;
  bytes: number;
  s3Key: string;
}

export interface CrawlError {
  code: CrawlErrorCode;
  message: string;
}

export const CRAWL_TTL_SECONDS = 180 * 24 * 60 * 60;
const MAX_MESSAGE_LENGTH = 300;

/** A crawl of this page is already queued or running (see `Source.activeCrawlId`). */
export class ActiveCrawlError extends Error {
  override name = 'ActiveCrawlError';
}

/** Today's crawls have reached the user's daily limit (T06c). */
export class DailyLimitError extends Error {
  override name = 'DailyLimitError';
}

/** Deterministic, so the same page is one source per user (0007). 128 bits of SHA-256. */
export function sourceIdFor(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 32);
}

export interface CrawlTables {
  crawls: string;
  sources: string;
  audit: string;
  usage: string;
}

/** `usage` `DAY#` items expire a week after the day (0006). */
export const USAGE_DAY_TTL_SECONDS = 7 * 24 * 60 * 60;

export type FinishOutcome =
  | { status: 'succeeded'; result: CrawlResult }
  | { status: 'failed'; error: CrawlError };

export class CrawlRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tables: CrawlTables,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Saves the source, queues the crawl, records `crawl.requested`, and counts it for
   * today and this month, in one transaction. Throws ActiveCrawlError if the page
   * already has an active crawl (unless it is `replacing` that stale or finished crawl),
   * and DailyLimitError if today's count has reached `dailyLimit`. Exact even when two
   * submits race: the day counter's condition decides.
   */
  async request(input: {
    userId: string;
    crawlId: string;
    sourceId: string;
    url: string;
    normalizedUrl: string;
    audit: Omit<AuditInput, 'userId'>;
    dailyLimit: number;
    replacing?: string;
  }): Promise<Crawl> {
    const at = this.now();
    const now = at.toISOString();
    const crawl: Crawl = {
      userId: input.userId,
      crawlId: input.crawlId,
      type: 'crawl',
      sourceId: input.sourceId,
      url: input.normalizedUrl,
      trigger: 'user',
      status: 'queued',
      attempts: 0,
      ttl: Math.floor(at.getTime() / 1000) + CRAWL_TTL_SECONDS,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    };
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tables.sources,
                Key: { userId: input.userId, sourceId: input.sourceId },
                UpdateExpression: [
                  'SET #type = :source, #url = :url, normalizedUrl = :normalized',
                  '#kind = if_not_exists(#kind, :unknown)',
                  'companyConfirmed = if_not_exists(companyConfirmed, :false)',
                  'active = :true, schedule = if_not_exists(schedule, :manual)',
                  'lastCrawlId = :crawlId, activeCrawlId = :crawlId',
                  'createdAt = if_not_exists(createdAt, :now), updatedAt = :now, schemaVersion = :one',
                ].join(', '),
                ConditionExpression:
                  input.replacing === undefined
                    ? 'attribute_not_exists(activeCrawlId)'
                    : 'attribute_not_exists(activeCrawlId) OR activeCrawlId = :replacing',
                ExpressionAttributeNames: { '#type': 'type', '#url': 'url', '#kind': 'kind' },
                ExpressionAttributeValues: {
                  ':source': 'source',
                  ':url': input.url,
                  ':normalized': input.normalizedUrl,
                  ':unknown': 'unknown',
                  ':false': false,
                  ':true': true,
                  ':manual': { type: 'manual' },
                  ':crawlId': input.crawlId,
                  ':now': now,
                  ':one': 1,
                  ...(input.replacing !== undefined ? { ':replacing': input.replacing } : {}),
                },
              },
            },
            {
              Put: {
                TableName: this.tables.crawls,
                Item: crawl,
                ConditionExpression: 'attribute_not_exists(userId)',
              },
            },
            {
              Put: {
                TableName: this.tables.audit,
                Item: auditItem({ ...input.audit, userId: input.userId }, at),
                ConditionExpression: 'attribute_not_exists(userId)',
              },
            },
            {
              Update: {
                TableName: this.tables.usage,
                Key: { userId: input.userId, sk: `DAY#${utcDay(at)}` },
                UpdateExpression:
                  'SET crawls = if_not_exists(crawls, :zero) + :one, #type = :day, #ttl = :ttl, createdAt = if_not_exists(createdAt, :now), updatedAt = :now, schemaVersion = :one',
                ConditionExpression: 'attribute_not_exists(crawls) OR crawls < :limit',
                ExpressionAttributeNames: { '#type': 'type', '#ttl': 'ttl' },
                ExpressionAttributeValues: {
                  ':zero': 0,
                  ':one': 1,
                  ':day': 'usage_day',
                  ':ttl': Math.floor(at.getTime() / 1000) + USAGE_DAY_TTL_SECONDS,
                  ':now': now,
                  ':limit': input.dailyLimit,
                },
              },
            },
            {
              Update: {
                TableName: this.tables.usage,
                Key: { userId: input.userId, sk: `MONTH#${utcMonth(at)}` },
                UpdateExpression:
                  'SET crawls = if_not_exists(crawls, :zero) + :one, #type = :month, createdAt = if_not_exists(createdAt, :now), updatedAt = :now, schemaVersion = :one',
                ExpressionAttributeNames: { '#type': 'type' },
                ExpressionAttributeValues: {
                  ':zero': 0,
                  ':one': 1,
                  ':month': 'usage_month',
                  ':now': now,
                },
              },
            },
          ],
        }),
      );
    } catch (error) {
      // An active crawl wins: a duplicate submit returns it and is not counted.
      if (cancelledAt(error, SOURCE_ITEM)) throw new ActiveCrawlError();
      if (cancelledAt(error, DAY_ITEM)) throw new DailyLimitError();
      throw error;
    }
    return crawl;
  }

  async getSource(userId: string, sourceId: string): Promise<Source | undefined> {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.tables.sources,
        Key: { userId, sourceId },
        ConsistentRead: true,
      }),
    );
    return res.Item as Source | undefined;
  }

  async getCrawl(userId: string, crawlId: string): Promise<Crawl | undefined> {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.tables.crawls,
        Key: { userId, crawlId },
        ConsistentRead: true,
      }),
    );
    return res.Item as Crawl | undefined;
  }

  listCrawls(userId: string, limit: number, after?: string): Promise<Page<Crawl>> {
    return queryNewestFirst(this.client, this.tables.crawls, 'crawlId', userId, limit, after);
  }

  /**
   * The worker claims an attempt: `queued` or `running` (a retry) → `running`, counting
   * the attempt. Undefined when the crawl is missing or already finished (a duplicate).
   */
  async start(userId: string, crawlId: string): Promise<Crawl | undefined> {
    try {
      const res = await this.client.send(
        new UpdateCommand({
          TableName: this.tables.crawls,
          Key: { userId, crawlId },
          UpdateExpression:
            'SET #status = :running, attempts = attempts + :one, startedAt = if_not_exists(startedAt, :now), updatedAt = :now',
          ConditionExpression: '#status IN (:queued, :running)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':running': 'running',
            ':queued': 'queued',
            ':one': 1,
            ':now': this.now().toISOString(),
          },
          ReturnValues: 'ALL_NEW',
        }),
      );
      return res.Attributes as Crawl;
    } catch (error) {
      if (isConditionFailure(error)) return undefined;
      throw error;
    }
  }

  /** Notes a retriable failure while a retry is pending. */
  async recordRetry(userId: string, crawlId: string, error: CrawlError): Promise<void> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tables.crawls,
          Key: { userId, crawlId },
          UpdateExpression: 'SET lastError = :error, updatedAt = :now',
          ConditionExpression: '#status = :running',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':error': trimError(error),
            ':running': 'running',
            ':now': this.now().toISOString(),
          },
        }),
      );
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
    }
  }

  /**
   * Ends a crawl and records it in the audit history, in one transaction; then frees
   * the source for the next crawl. False when the crawl was already finished.
   */
  async finish(
    crawl: Pick<Crawl, 'userId' | 'crawlId' | 'sourceId'>,
    outcome: FinishOutcome,
    audit: Omit<AuditInput, 'userId'>,
  ): Promise<boolean> {
    const { userId, crawlId, sourceId } = crawl;
    const at = this.now();
    const now = at.toISOString();
    // Both `result` and `error` are DynamoDB reserved words: always use placeholders.
    const field = outcome.status === 'succeeded' ? '#result' : '#error';
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tables.crawls,
                Key: { userId, crawlId },
                UpdateExpression: `SET #status = :status, ${field} = :outcome, finishedAt = :now, updatedAt = :now REMOVE lastError`,
                ConditionExpression: '#status IN (:queued, :running)',
                ExpressionAttributeNames: {
                  '#status': 'status',
                  ...(outcome.status === 'failed'
                    ? { '#error': 'error' }
                    : { '#result': 'result' }),
                },
                ExpressionAttributeValues: {
                  ':status': outcome.status,
                  ':outcome':
                    outcome.status === 'succeeded' ? outcome.result : trimError(outcome.error),
                  ':queued': 'queued',
                  ':running': 'running',
                  ':now': now,
                },
              },
            },
            {
              Put: {
                TableName: this.tables.audit,
                Item: auditItem({ ...audit, userId }, at),
                ConditionExpression: 'attribute_not_exists(userId)',
              },
            },
          ],
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'TransactionCanceledException') return false;
      throw error;
    }
    // Separate on purpose: if this page has moved on to a newer crawl, the condition
    // fails and nothing changes. If it never runs, the next submit sees a finished
    // active crawl and replaces it.
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tables.sources,
          Key: { userId, sourceId },
          UpdateExpression: 'SET lastCrawledAt = :now, updatedAt = :now REMOVE activeCrawlId',
          ConditionExpression: 'activeCrawlId = :crawlId',
          ExpressionAttributeValues: { ':now': now, ':crawlId': crawlId },
        }),
      );
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
    }
    return true;
  }
}

function trimError(error: CrawlError): CrawlError {
  return { code: error.code, message: error.message.slice(0, MAX_MESSAGE_LENGTH) };
}

/** Positions in `request`'s transaction. */
const SOURCE_ITEM = 0;
const DAY_ITEM = 3;

/** How many crawls the user has started today (UTC). */
export async function crawlsToday(
  client: DynamoDBDocumentClient,
  usageTable: string,
  userId: string,
  at: Date,
): Promise<number> {
  const res = await client.send(
    new GetCommand({
      TableName: usageTable,
      Key: { userId, sk: `DAY#${utcDay(at)}` },
      ConsistentRead: true,
    }),
  );
  return Number(res.Item?.crawls ?? 0);
}
