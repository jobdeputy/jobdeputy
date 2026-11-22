import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { type AuditInput, auditItem } from './audit-repository.js';
import { cancelledAt, isConditionFailure } from './client.js';
import {
  CRAWL_TTL_SECONDS,
  type Crawl,
  type CrawlList,
  type CrawlResult,
  type CrawlTables,
  claimSource,
} from './crawl-repository.js';
import { transactWrite } from './transact.js';

/** A company crawl to queue for a list run. */
export interface CompanyCrawl {
  crawlId: string;
  sourceId: string;
  url: string;
  normalizedUrl: string;
  listShare: number;
  audit: Omit<AuditInput, 'userId'>;
  /** The board's earlier crawl, finished or gone, that this one replaces as its active crawl. */
  replacing?: string;
}

/**
 * `queued`: the company crawl is in the queue. `moved`: the list changed meanwhile (another
 * worker queued this company, or the list ended); read it again. `busy`: the board already has
 * a crawl in progress.
 */
export type QueueOutcome = 'queued' | 'moved' | 'busy';

/** Positions in `queueCompany`'s transaction. */
const LIST_ITEM = 0;
const SOURCE_ITEM = 2;

/**
 * #50: a list run's own writes on its `crawls` item. The list's state lives on that item:
 * `list` (what it read and chose), `queuedCount` (companies handed on, in order),
 * `runningIds` (company crawls in progress), `childIds`, and `childrenEnded` (written by each
 * company crawl's `finish`). Every step is conditional on the state it read, so two workers
 * moving the same list on can never queue a company twice or exceed the concurrency.
 */
export class ListRunRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tables: Pick<CrawlTables, 'crawls' | 'sources' | 'audit'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Records what the list run read and chose, once: a retried list keeps its first choice.
   * False when the list already chose, or is no longer running.
   */
  async choose(
    userId: string,
    crawlId: string,
    list: CrawlList,
    result: CrawlResult,
  ): Promise<boolean> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tables.crawls,
          Key: { userId, crawlId },
          UpdateExpression:
            'SET #list = :list, #result = :result, queuedCount = :zero, updatedAt = :now',
          ConditionExpression: '#status = :running AND attribute_not_exists(#list)',
          ExpressionAttributeNames: { '#list': 'list', '#result': 'result', '#status': 'status' },
          ExpressionAttributeValues: {
            ':list': list,
            ':result': result,
            ':zero': 0,
            ':running': 'running',
            ':now': this.now().toISOString(),
          },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  /**
   * Queues the list's next company (`list.queuedCount`) as a company crawl, while fewer than
   * `maxRunning` are in progress: the list moves on, the crawl is written `queued` (the crawls
   * stream hands it to the crawl worker), and the board's source names it as its active crawl,
   * all in one transaction.
   */
  async queueCompany(
    list: Crawl,
    maxRunning: number,
    company: CompanyCrawl,
  ): Promise<QueueOutcome> {
    const { userId } = list;
    const at = this.now();
    const now = at.toISOString();
    const position = list.queuedCount ?? 0;
    const crawl: Crawl = {
      userId,
      crawlId: company.crawlId,
      type: 'crawl',
      sourceId: company.sourceId,
      url: company.normalizedUrl,
      trigger: 'list',
      parentCrawlId: list.crawlId,
      // The list's one AI run scores its companies' candidates together: none of its own.
      aiSource: 'none',
      listShare: company.listShare,
      status: 'queued',
      attempts: 0,
      ttl: Math.floor(at.getTime() / 1000) + CRAWL_TTL_SECONDS,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    };
    try {
      await transactWrite(this.client, {
        TransactItems: [
          {
            Update: {
              TableName: this.tables.crawls,
              Key: { userId, crawlId: list.crawlId },
              UpdateExpression:
                'SET queuedCount = :next, childIds = list_append(if_not_exists(childIds, :empty), :ids), updatedAt = :now ADD runningIds :id',
              ConditionExpression:
                '#status = :running AND queuedCount = :position AND (attribute_not_exists(runningIds) OR size(runningIds) < :max)',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':next': position + 1,
                ':position': position,
                ':empty': [],
                ':ids': [company.crawlId],
                ':id': new Set([company.crawlId]),
                ':running': 'running',
                ':max': maxRunning,
                ':now': now,
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
          claimSource(this.tables.sources, {
            userId,
            sourceId: company.sourceId,
            url: company.url,
            normalizedUrl: company.normalizedUrl,
            crawlId: company.crawlId,
            now,
            ...(company.replacing !== undefined ? { replacing: company.replacing } : {}),
          }),
          {
            Put: {
              TableName: this.tables.audit,
              Item: auditItem({ ...company.audit, userId }, at),
              ConditionExpression: 'attribute_not_exists(userId)',
            },
          },
        ],
      });
      return 'queued';
    } catch (error) {
      if (cancelledAt(error, LIST_ITEM)) return 'moved';
      if (cancelledAt(error, SOURCE_ITEM)) return 'busy';
      throw error;
    }
  }

  /** Passes over the list's next company (its board is busy), counting it. False when the list moved on. */
  async skipCompany(list: Crawl): Promise<boolean> {
    const position = list.queuedCount ?? 0;
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tables.crawls,
          Key: { userId: list.userId, crawlId: list.crawlId },
          UpdateExpression:
            'SET queuedCount = :next, #list.busy = if_not_exists(#list.busy, :zero) + :one, updatedAt = :now',
          ConditionExpression: '#status = :running AND queuedCount = :position',
          ExpressionAttributeNames: { '#list': 'list', '#status': 'status' },
          ExpressionAttributeValues: {
            ':next': position + 1,
            ':position': position,
            ':zero': 0,
            ':one': 1,
            ':running': 'running',
            ':now': this.now().toISOString(),
          },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }
}
