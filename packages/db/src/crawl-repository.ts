import { createHash } from 'node:crypto';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  type AiSource,
  type CrawlErrorCode,
  type CrawlStatus,
  isoWeek,
  type RelevanceError,
  utcDay,
  utcMonth,
} from '@jobdeputy/shared';
import { type AuditInput, auditItem, type Page, queryNewestFirst } from './audit-repository.js';
import { cancelledAt, isConditionFailure } from './client.js';
import { transactWrite } from './transact.js';

/** `sources` (docs/data-model.md): a page the user saved. Keys: `userId`, `sourceId`. */
export interface Source {
  userId: string;
  sourceId: string;
  type: 'source';
  url: string;
  normalizedUrl: string;
  /** `ats_board` once a crawl read it as a job board (T07b); otherwise `unknown`. */
  kind: 'unknown' | 'ats_board';
  /** The job board, for example `greenhouse` (T07b). */
  ats?: string;
  /** From the last successful crawl (T07b). */
  stats?: { lastFound: number };
  /**
   * T07c: the jobs this page lists, as far as its crawls know (after a complete crawl,
   * exactly what it listed). A later complete crawl closes the ones no longer listed.
   */
  listedJobIds?: Set<string>;
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
  /** T08b2: where this crawl's AI work gets its model (used from T08d). */
  aiSource?: AiSource;
  /**
   * T08b3 (0009): the free platform run this crawl used, and the week and month it was
   * counted in (a failed crawl gives it back to them).
   */
  aiRun?: PlatformRun;
  status: CrawlStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  result?: CrawlResult;
  /** T07b: what the crawl read and saved. */
  stats?: CrawlStats;
  /**
   * T08d: the candidates the LLM scores, best first (shown ones, then the rest), at most
   * the admin's `relevanceMaxJobs`.
   */
  candidates?: string[];
  /** T08d: the scoring of the candidates (only crawls with an AI source and candidates). */
  relevance?: CrawlRelevance;
  /** T08d: the model and tokens this crawl's AI work used. */
  llm?: CrawlLlm;
  extraction?: CrawlExtraction;
  error?: CrawlError;
  /** The last retriable failure, while a retry is pending. */
  lastError?: CrawlError;
  ttl: number;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
}

/** T08d: why a scoring run stopped without scoring (shown to the user). */
export type RelevanceFailure = 'key_missing' | 'key_invalid' | 'key_rejected' | 'model_unavailable';

export interface RelevanceStats {
  /** Candidates still open and kept by the filter when the run started. */
  candidates: number;
  /** Scored by the model in this run. */
  scored: number;
  /** Scored before with the same inputs: that score was used again. */
  reused: number;
  /** Not scored (the model left them out, or the run stopped early): T08c's verdict stays. */
  unscored: number;
  /** Scored below the admin's `relevanceMinScore`: hidden. */
  hidden: number;
  /** Scored, but over the company's limit. */
  overLimit: number;
}

export interface CrawlRelevance {
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  /** Task calls stored so far; a run makes at most a fixed number, across retries too. */
  calls: number;
  /** Jobs sent to the model in this run: a retried message never sends them again. */
  sent: string[];
  reason?: RelevanceFailure;
  stats?: RelevanceStats;
}

export interface CrawlLlm {
  keySource: 'platform' | 'own';
  provider: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface PlatformRun {
  week: string;
  month: string;
}

export interface CrawlResult {
  finalUrl: string;
  httpStatus: number;
  contentType: string;
  bytes: number;
  s3Key: string;
}

export interface CrawlStats {
  jobsFound: number;
  jobsNew: number;
  jobsUpdated: number;
  /** T07c: requests made (robots.txt not counted). */
  pagesFetched?: number;
  /** T07c: jobs closed because this complete crawl no longer listed them. */
  jobsClosed?: number;
  /** T08c: jobs the code filter kept (`candidate`), shown or not. */
  jobsRelevant?: number;
  /** T08c: kept jobs hidden by the per-company limit. */
  jobsOverLimit?: number;
  /** T08d3: candidates' descriptions read from their own posting. */
  descriptions?: DescriptionStats;
}

/** T08d3: postings read for candidates whose board list has no description. */
export interface DescriptionStats {
  /** Read, with a description. */
  fetched: number;
  /** Answered 404 or 410: the job was closed. */
  gone: number;
  /** Any other answer: the job keeps no description until a later crawl. */
  failed: number;
  /** Not tried: the crawl's request limit or time ran out. */
  skipped: number;
}

/** Why a crawl saved only part of what it could have read (0008). */
export type PartialReason = 'max_jobs' | 'max_pages' | 'time_budget' | 'page_failed';

/** How jobs were read (0008). */
export interface CrawlExtraction {
  /** `read`: a job board or schema.org data was read (possibly with no jobs). */
  outcome: 'read' | 'no_readable_jobs';
  method?: 'ats_feed' | 'schema_org';
  /** The board read, for example `greenhouse:acme`. */
  board?: string;
  /** Listings without a title or a usable link. */
  skipped: number;
  /** Set when the crawl stopped at a limit and saved only part of what it read. */
  partial?: { reason: PartialReason };
}

/** What a successful crawl learned about its source (T07b). */
export interface SourceUpdate {
  kind: Source['kind'];
  ats?: string;
  lastFound: number;
  /** T07c: the new `listedJobIds`; empty removes it; absent leaves it as it was. */
  listedJobIds?: string[];
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

/** The user already has the most crawls allowed in progress at one time. */
export class TooManyActiveCrawlsError extends Error {
  override name = 'TooManyActiveCrawlsError';
}

/** The `usage` item holding the IDs of the user's queued or running crawls. */
export const ACTIVE_SK = 'ACTIVE';

/** Today's crawls have reached the user's daily limit (T06c). */
export class DailyLimitError extends Error {
  override name = 'DailyLimitError';
}

/** T08b3: the free platform runs of this week or month are used up. */
export class PlatformAllowanceError extends Error {
  override name = 'PlatformAllowanceError';
}

/** `usage` `AIWEEK#` items expire 8 weeks after they start (the week is all that matters). */
export const USAGE_WEEK_TTL_SECONDS = 8 * 7 * 24 * 60 * 60;

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
  | {
      status: 'succeeded';
      result: CrawlResult;
      stats?: CrawlStats;
      candidates?: string[];
      extraction?: CrawlExtraction;
      source?: SourceUpdate;
    }
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
   * DailyLimitError if today's count has reached `dailyLimit`, and
   * TooManyActiveCrawlsError if `maxActive` crawls are already queued or running. Exact
   * even when submits race: the counters' conditions decide (and conflicts are retried).
   */
  async request(input: {
    userId: string;
    crawlId: string;
    sourceId: string;
    url: string;
    normalizedUrl: string;
    audit: Omit<AuditInput, 'userId'>;
    dailyLimit: number;
    maxActive: number;
    replacing?: string;
    aiSource?: AiSource;
    /** T08b3: with the platform model, one free run is counted (exactly) against these. */
    platformRuns?: { perWeek: number; perMonth: number };
  }): Promise<Crawl> {
    const at = this.now();
    const now = at.toISOString();
    const aiRun: PlatformRun | undefined = input.platformRuns
      ? { week: isoWeek(at), month: utcMonth(at) }
      : undefined;
    const crawl: Crawl = {
      userId: input.userId,
      crawlId: input.crawlId,
      type: 'crawl',
      sourceId: input.sourceId,
      url: input.normalizedUrl,
      trigger: 'user',
      ...(input.aiSource ? { aiSource: input.aiSource } : {}),
      ...(aiRun ? { aiRun } : {}),
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
              // T08b3: a platform run is also counted here (a string set of crawl IDs, so a
              // failed crawl can give its run back), only while the month has room.
              UpdateExpression: `SET crawls = if_not_exists(crawls, :zero) + :one, #type = :month, createdAt = if_not_exists(createdAt, :now), updatedAt = :now, schemaVersion = :one${aiRun ? ' ADD platformRunIds :id' : ''}`,
              ...(input.platformRuns
                ? {
                    ConditionExpression:
                      'attribute_not_exists(platformRunIds) OR size(platformRunIds) < :perMonth',
                  }
                : {}),
              ExpressionAttributeNames: { '#type': 'type' },
              ExpressionAttributeValues: {
                ':zero': 0,
                ':one': 1,
                ':month': 'usage_month',
                ':now': now,
                ...(input.platformRuns
                  ? { ':id': new Set([input.crawlId]), ':perMonth': input.platformRuns.perMonth }
                  : {}),
              },
            },
          },
          {
            Update: {
              TableName: this.tables.usage,
              Key: { userId: input.userId, sk: ACTIVE_SK },
              // A string set: adding and removing the same ID is idempotent.
              UpdateExpression:
                'ADD crawlIds :id SET #type = :active, createdAt = if_not_exists(createdAt, :now), updatedAt = :now, schemaVersion = :one',
              ConditionExpression: 'attribute_not_exists(crawlIds) OR size(crawlIds) < :maxActive',
              ExpressionAttributeNames: { '#type': 'type' },
              ExpressionAttributeValues: {
                ':id': new Set([input.crawlId]),
                ':active': 'usage_active',
                ':now': now,
                ':one': 1,
                ':maxActive': input.maxActive,
              },
            },
          },
          ...(aiRun && input.platformRuns
            ? [
                {
                  Update: {
                    TableName: this.tables.usage,
                    Key: { userId: input.userId, sk: `AIWEEK#${aiRun.week}` },
                    UpdateExpression:
                      'ADD platformRunIds :id SET #type = :week, #ttl = :ttl, createdAt = if_not_exists(createdAt, :now), updatedAt = :now, schemaVersion = :one',
                    ConditionExpression:
                      'attribute_not_exists(platformRunIds) OR size(platformRunIds) < :perWeek',
                    ExpressionAttributeNames: { '#type': 'type', '#ttl': 'ttl' },
                    ExpressionAttributeValues: {
                      ':id': new Set([input.crawlId]),
                      ':week': 'usage_week',
                      ':ttl': Math.floor(at.getTime() / 1000) + USAGE_WEEK_TTL_SECONDS,
                      ':now': now,
                      ':one': 1,
                      ':perWeek': input.platformRuns.perWeek,
                    },
                  },
                },
              ]
            : []),
        ],
      });
    } catch (error) {
      // An active crawl of the same page wins: a duplicate submit returns it and is not
      // counted. A full day is final; a full active set clears as crawls finish.
      if (cancelledAt(error, SOURCE_ITEM)) throw new ActiveCrawlError();
      if (cancelledAt(error, DAY_ITEM)) throw new DailyLimitError();
      if (cancelledAt(error, ACTIVE_ITEM)) throw new TooManyActiveCrawlsError();
      if (cancelledAt(error, MONTH_ITEM) || cancelledAt(error, WEEK_ITEM)) {
        throw new PlatformAllowanceError();
      }
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

  /** The IDs in the user's active set (queued or running crawls, possibly stale). */
  async getActiveCrawlIds(userId: string): Promise<string[]> {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.tables.usage,
        Key: { userId, sk: ACTIVE_SK },
        ConsistentRead: true,
      }),
    );
    const ids = res.Item?.crawlIds as Set<string> | undefined;
    return ids ? [...ids] : [];
  }

  /** Frees slots held by crawls that are finished or gone (self-healing; idempotent). */
  async releaseActive(userId: string, crawlIds: string[]): Promise<void> {
    if (crawlIds.length === 0) return;
    const { Update } = releaseActive(this.tables.usage, userId, crawlIds, this.now().toISOString());
    await this.client.send(new UpdateCommand(Update));
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
    crawl: Pick<Crawl, 'userId' | 'crawlId' | 'sourceId' | 'aiRun'>,
    outcome: FinishOutcome,
    audit: Omit<AuditInput, 'userId'>,
  ): Promise<boolean> {
    const { userId, crawlId, sourceId } = crawl;
    const at = this.now();
    const now = at.toISOString();
    // Both `result` and `error` are DynamoDB reserved words: always use placeholders.
    const field = outcome.status === 'succeeded' ? '#result' : '#error';
    const extra =
      outcome.status === 'succeeded'
        ? {
            ...(outcome.stats ? { ':stats': outcome.stats } : {}),
            ...(outcome.candidates?.length ? { ':candidates': outcome.candidates } : {}),
            ...(outcome.extraction ? { ':extraction': outcome.extraction } : {}),
          }
        : {};
    const extraSet = Object.keys(extra)
      .map((placeholder) => `, #${placeholder.slice(1)} = ${placeholder}`)
      .join('');
    const extraNames = Object.fromEntries(
      Object.keys(extra).map((placeholder) => [`#${placeholder.slice(1)}`, placeholder.slice(1)]),
    );
    try {
      await transactWrite(this.client, {
        TransactItems: [
          {
            Update: {
              TableName: this.tables.crawls,
              Key: { userId, crawlId },
              UpdateExpression: `SET #status = :status, ${field} = :outcome${extraSet}, finishedAt = :now, updatedAt = :now REMOVE lastError`,
              ConditionExpression: '#status IN (:queued, :running)',
              ExpressionAttributeNames: {
                '#status': 'status',
                ...(outcome.status === 'failed' ? { '#error': 'error' } : { '#result': 'result' }),
                ...extraNames,
              },
              ExpressionAttributeValues: {
                ':status': outcome.status,
                ':outcome':
                  outcome.status === 'succeeded' ? outcome.result : trimError(outcome.error),
                ':queued': 'queued',
                ':running': 'running',
                ':now': now,
                ...extra,
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
          releaseActive(this.tables.usage, userId, [crawlId], now),
          // T08b3: a crawl that failed never reached its AI work: its free run is given back.
          ...(outcome.status === 'failed' && crawl.aiRun
            ? refundPlatformRun(this.tables.usage, userId, crawlId, crawl.aiRun, now)
            : []),
        ],
      });
    } catch (error) {
      if (cancelledAt(error, 0)) return false;
      throw error;
    }
    // Separate on purpose: if this page has moved on to a newer crawl, the condition
    // fails and nothing changes. If it never runs, the next submit sees a finished
    // active crawl and replaces it.
    const learned = outcome.status === 'succeeded' ? outcome.source : undefined;
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tables.sources,
          Key: { userId, sourceId },
          UpdateExpression: sourceUpdateExpression(learned),
          ConditionExpression: 'activeCrawlId = :crawlId',
          ...(learned
            ? {
                ExpressionAttributeNames: {
                  '#kind': 'kind',
                  '#stats': 'stats',
                  ...(learned.listedJobIds !== undefined ? { '#listed': 'listedJobIds' } : {}),
                },
              }
            : {}),
          ExpressionAttributeValues: {
            ':now': now,
            ':crawlId': crawlId,
            ...(learned
              ? {
                  ':kind': learned.kind,
                  ':stats': { lastFound: learned.lastFound },
                  ...(learned.ats ? { ':ats': learned.ats } : {}),
                  ...(learned.listedJobIds?.length
                    ? { ':listed': new Set(learned.listedJobIds) }
                    : {}),
                }
              : {}),
          },
        }),
      );
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
    }
    return true;
  }
}

/** The source's update after a crawl ends. DynamoDB cannot store an empty set: it is removed. */
function sourceUpdateExpression(learned: SourceUpdate | undefined): string {
  const set = ['lastCrawledAt = :now', 'updatedAt = :now'];
  const remove = ['activeCrawlId'];
  if (learned) {
    set.push('#kind = :kind', '#stats = :stats');
    if (learned.ats) set.push('ats = :ats');
    if (learned.listedJobIds?.length) set.push('#listed = :listed');
    else if (learned.listedJobIds !== undefined) remove.push('#listed');
  }
  return `SET ${set.join(', ')} REMOVE ${remove.join(', ')}`;
}

function trimError(error: CrawlError): CrawlError {
  return { code: error.code, message: error.message.slice(0, MAX_MESSAGE_LENGTH) };
}

/** Positions in `request`'s transaction. */
const SOURCE_ITEM = 0;
const DAY_ITEM = 3;
const MONTH_ITEM = 4;
const ACTIVE_ITEM = 5;
const WEEK_ITEM = 6;

/** Removes crawls from the user's active set (idempotent; the set disappears when empty). */
function releaseActive(table: string, userId: string, crawlIds: string[], now: string) {
  return {
    Update: {
      TableName: table,
      Key: { userId, sk: ACTIVE_SK },
      UpdateExpression: 'DELETE crawlIds :ids SET updatedAt = :now',
      ExpressionAttributeValues: { ':ids': new Set(crawlIds), ':now': now },
    },
  };
}

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

/** Takes the crawl's ID out of the week's and month's platform runs (idempotent). */
function refundPlatformRun(
  usage: string,
  userId: string,
  crawlId: string,
  run: PlatformRun,
  now: string,
) {
  return [`AIWEEK#${run.week}`, `MONTH#${run.month}`].map((sk) => ({
    Update: {
      TableName: usage,
      Key: { userId, sk },
      UpdateExpression: 'DELETE platformRunIds :id SET updatedAt = :now',
      ExpressionAttributeValues: { ':id': new Set([crawlId]), ':now': now },
    },
  }));
}

/** The free platform runs used this week and month (T08b3), for limits and `GET /me/ai-usage`. */
export async function platformRunsUsed(
  client: DynamoDBDocumentClient,
  usageTable: string,
  userId: string,
  at: Date,
): Promise<{ week: number; month: number }> {
  const [week, month] = await Promise.all(
    [`AIWEEK#${isoWeek(at)}`, `MONTH#${utcMonth(at)}`].map((sk) =>
      client.send(
        new GetCommand({ TableName: usageTable, Key: { userId, sk }, ConsistentRead: true }),
      ),
    ),
  );
  const size = (item: Record<string, unknown> | undefined) =>
    item?.platformRunIds instanceof Set ? item.platformRunIds.size : 0;
  return { week: size(week?.Item), month: size(month?.Item) };
}
