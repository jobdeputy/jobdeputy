import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { type AiUsageRecord, aiUsageUpdate } from './ai-usage-repository.js';
import { type AuditWrite, auditPut } from './audit-repository.js';
import { isConditionFailure } from './client.js';
import type {
  CrawlLlm,
  CrawlRelevance,
  RelevanceFailure,
  RelevanceStats,
} from './crawl-repository.js';
import type { JobRelevance } from './job-repository.js';
import { cancellationCodes, transactWrite } from './transact.js';

/**
 * T08d: a crawl's scoring run, kept on the crawl item (`relevance`, `llm`). Each task call
 * is stored in one transaction with its token usage and its scores, so a retried message
 * neither counts tokens twice nor sends a job again.
 */
export interface RelevanceTables {
  crawls: string;
  jobs: string;
  usage: string;
  audit: string;
}

/** Another delivery of the same crawl stored a call meanwhile: the queue tries again. */
export class RelevanceConflictError extends Error {
  override name = 'RelevanceConflictError';
}

const CRAWL_ITEM = 0;
const FIRST_JOB_ITEM = 2;

export class RelevanceRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tables: RelevanceTables,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Starts the run on a succeeded crawl. False if it has started already (a retried
   * message: the caller reads the crawl and goes on) or the crawl did not succeed. The
   * Pipe passes only crawls without `relevance`, so this write never starts a run again.
   */
  async begin(userId: string, crawlId: string): Promise<boolean> {
    const now = this.now().toISOString();
    const relevance: CrawlRelevance = { status: 'running', startedAt: now, calls: 0, sent: [] };
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tables.crawls,
          Key: { userId, crawlId },
          UpdateExpression: 'SET relevance = :relevance, updatedAt = :now',
          ConditionExpression: 'attribute_not_exists(relevance) AND #status = :succeeded',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':relevance': relevance,
            ':now': now,
            ':succeeded': 'succeeded',
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
   * Stores one task call: the crawl's progress and `llm` totals, the tokens in `usage`,
   * and each score on its job, in one transaction. Only if the crawl is still at
   * `callsBefore` calls (else RelevanceConflictError). Jobs deleted meanwhile are left out.
   */
  async saveCall(input: {
    userId: string;
    crawlId: string;
    callsBefore: number;
    sent: string[];
    llm: CrawlLlm;
    usage: AiUsageRecord;
    scores: { jobId: string; relevance: JobRelevance }[];
  }): Promise<void> {
    const { userId, crawlId } = input;
    const at = this.now();
    const now = at.toISOString();
    let scores = input.scores;
    // DynamoDB may report only some failed conditions: drop those jobs and try again.
    for (let attempt = 0; attempt <= input.scores.length; attempt++) {
      try {
        await transactWrite(this.client, {
          TransactItems: [
            {
              Update: {
                TableName: this.tables.crawls,
                Key: { userId, crawlId },
                UpdateExpression:
                  'SET relevance.calls = :calls, relevance.sent = list_append(relevance.sent, :sent), llm = :llm, updatedAt = :now',
                ConditionExpression: 'relevance.#status = :running AND relevance.calls = :before',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                  ':calls': input.callsBefore + 1,
                  ':sent': input.sent,
                  ':llm': input.llm,
                  ':now': now,
                  ':running': 'running',
                  ':before': input.callsBefore,
                },
              },
            },
            aiUsageUpdate(this.tables.usage, userId, at, input.usage),
            ...scores.map((s) => ({
              Update: {
                TableName: this.tables.jobs,
                Key: { userId, jobId: s.jobId },
                UpdateExpression: 'SET relevance = :relevance, updatedAt = :now',
                ConditionExpression: 'attribute_exists(userId)',
                ExpressionAttributeValues: { ':relevance': s.relevance, ':now': now },
              },
            })),
          ],
        });
        return;
      } catch (error) {
        const codes = cancellationCodes(error);
        if (!codes) throw error;
        if (codes[CRAWL_ITEM] === 'ConditionalCheckFailed') {
          throw new RelevanceConflictError('The crawl moved on meanwhile', { cause: error });
        }
        const gone = new Set(
          scores
            .filter((_, i) => codes[FIRST_JOB_ITEM + i] === 'ConditionalCheckFailed')
            .map((s) => s.jobId),
        );
        if (gone.size === 0) throw error;
        scores = scores.filter((s) => !gone.has(s.jobId));
      }
    }
    throw new Error('scores not stored');
  }

  /**
   * Ends the run with its outcome and an audit entry. False if it was already ended (a
   * retried message after the end).
   */
  async finish(input: {
    userId: string;
    crawlId: string;
    status: 'done' | 'failed';
    reason?: RelevanceFailure;
    stats: RelevanceStats;
    audit: AuditWrite;
  }): Promise<boolean> {
    const { userId, crawlId } = input;
    const at = this.now();
    const now = at.toISOString();
    try {
      await transactWrite(this.client, {
        TransactItems: [
          {
            Update: {
              TableName: this.tables.crawls,
              Key: { userId, crawlId },
              UpdateExpression: `SET relevance.#status = :status, relevance.finishedAt = :now, relevance.stats = :stats, updatedAt = :now${input.reason ? ', relevance.reason = :reason' : ''}`,
              ConditionExpression: 'relevance.#status = :running',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':status': input.status,
                ':now': now,
                ':stats': input.stats,
                ':running': 'running',
                ...(input.reason ? { ':reason': input.reason } : {}),
              },
            },
          },
          auditPut(input.audit, userId, at),
        ],
      });
      return true;
    } catch (error) {
      if (cancellationCodes(error)?.[CRAWL_ITEM] === 'ConditionalCheckFailed') return false;
      throw error;
    }
  }
}
