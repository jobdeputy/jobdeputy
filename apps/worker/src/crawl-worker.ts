import { BatchProcessor, EventType, processPartialResponse } from '@aws-lambda-powertools/batch';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ChangeMessageVisibilityCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  AccountRepository,
  type AuditInput,
  type CrawlError,
  CrawlRepository,
  documentClient,
  type JobPosting,
  JobRepository,
  type SaveContext,
  type SaveStats,
} from '@jobdeputy/db';
import {
  CRAWL_ERRORS,
  CRAWL_PAGE_RETENTION_TAG,
  crawlKeys,
  crawlMessage,
  createLogger,
} from '@jobdeputy/shared';
import type { Context, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { ulid } from 'ulid';
import { withDeadline } from './deadline.js';
import { createFetcher, FetchError, type FetchedPage } from './fetch/fetcher.js';
import { type FetchFn, readJobs } from './jobs/crawl-jobs.js';

const logger = createLogger('crawl-worker');

/** Matches the queue's maxReceiveCount: 3 attempts, then the dead-letter queue. */
export const MAX_RECEIVES = 3;
/** Seconds before attempt 2 and attempt 3 (a longer `Retry-After`, capped at 120 s, wins). */
export const RETRY_BACKOFF_SECONDS = [30, 120] as const;
/** Stop work this long before Lambda's own timeout. */
export const SAFETY_MARGIN_MS = 5_000;

export interface CrawlWorkerDeps {
  repo: Pick<CrawlRepository, 'start' | 'recordRetry' | 'finish'>;
  isBeingDeleted: (userId: string) => Promise<boolean>;
  /** A fresh fetcher for one crawl attempt (its robots.txt memory lasts that attempt). */
  newFetcher: () => FetchFn;
  storePage: (key: string, page: FetchedPage) => Promise<void>;
  /** T07b: creates or updates the jobs (idempotent, so a retried crawl is safe). */
  saveJobs: (userId: string, jobs: JobPosting[], context: SaveContext) => Promise<SaveStats>;
  now: () => Date;
  delayRetry: (record: SQSRecord, seconds: number) => Promise<void>;
  newId: () => string;
  remainingMs: () => number;
}

export type CrawlOutcome = 'succeeded' | 'failed' | 'skipped';

/** Asks SQS for another attempt (the message is not deleted). */
export class RetryLaterError extends Error {
  override name = 'RetryLaterError';
}

/** The user-facing message, with a safe technical detail (for example "HTTP 502") when there is one. */
export function crawlErrorFrom(error: FetchError): CrawlError {
  const base = CRAWL_ERRORS[error.code];
  return {
    code: error.code,
    message: error.message === base ? base : `${base} (${error.message})`,
  };
}

export async function processRecord(
  record: SQSRecord,
  deps: CrawlWorkerDeps,
): Promise<CrawlOutcome> {
  const parsed = crawlMessage.safeParse(safeJson(record.body));
  if (!parsed.success) {
    // Nothing to retry: let it fail through to the dead-letter queue for inspection.
    logger.error('Malformed message', { messageId: record.messageId });
    throw new Error('Malformed message');
  }
  const { userId, crawlId } = parsed.data;
  const receiveCount = Number(record.attributes.ApproximateReceiveCount);

  // T12: nothing new is written for an account being deleted; its final sweep removes the rest.
  if (await deps.isBeingDeleted(userId)) {
    logger.info('Account is being deleted; skipping', { crawlId });
    return 'skipped';
  }
  const crawl = await deps.repo.start(userId, crawlId);
  if (!crawl) {
    logger.info('Crawl missing or already finished; skipping', { crawlId });
    return 'skipped';
  }
  const host = new URL(crawl.url).hostname;
  const audit = (
    name: string,
    summary: string,
    detail: AuditInput['detail'],
  ): Omit<AuditInput, 'userId'> => ({
    auditId: deps.newId(),
    name,
    entity: { type: 'crawl', id: crawlId },
    actor: 'system',
    summary,
    ...(detail ? { detail } : {}),
  });
  const fail = async (error: CrawlError) => {
    await deps.repo.finish(
      crawl,
      { status: 'failed', error },
      audit('crawl.failed', `Crawl failed: ${host} (${error.code})`, { code: error.code }),
    );
    logger.info('Crawl failed', {
      crawlId,
      code: error.code,
      reason: error.message,
      attempts: crawl.attempts,
    });
    return 'failed' as const;
  };
  const retryLater = async (seconds: number, reason: string) => {
    await deps.delayRetry(record, seconds).catch(() => undefined);
    logger.warn('Attempt failed; will retry', { crawlId, receiveCount, seconds, reason });
    throw new RetryLaterError(reason);
  };

  try {
    const { page, jobs, extraction, board } = await withDeadline(
      (async () => {
        const reading = await readJobs(crawl.url, deps.newFetcher(), deps.now());
        await deps.storePage(crawlKeys(userId, crawlId).page, reading.page);
        return reading;
      })(),
      deps.remainingMs() - SAFETY_MARGIN_MS,
    );
    const key = crawlKeys(userId, crawlId).page;
    const saved = await withDeadline(
      deps.saveJobs(userId, jobs, { sourceId: crawl.sourceId, crawlId }),
      deps.remainingMs() - SAFETY_MARGIN_MS,
    );
    const stats = { jobsFound: saved.found, jobsNew: saved.created, jobsUpdated: saved.updated };
    await deps.repo.finish(
      crawl,
      {
        status: 'succeeded',
        result: {
          finalUrl: page.url,
          httpStatus: page.status,
          contentType: page.contentType,
          bytes: page.body.byteLength,
          s3Key: key,
        },
        stats,
        extraction,
        source: {
          kind: board ? 'ats_board' : 'unknown',
          ...(board ? { ats: board.ats } : {}),
          lastFound: saved.found,
        },
      },
      audit('crawl.succeeded', `Crawl succeeded: ${host}, ${saved.found} jobs`, {
        bytes: page.body.byteLength,
        jobsFound: saved.found,
        jobsNew: saved.created,
      }),
    );
    logger.info('Crawl succeeded', {
      crawlId,
      bytes: page.body.byteLength,
      attempts: crawl.attempts,
      ...stats,
      outcome: extraction.outcome,
      method: extraction.method,
      board: extraction.board,
      skipped: extraction.skipped,
      partial: extraction.partial?.reason,
    });
    return 'succeeded';
  } catch (error) {
    if (error instanceof RetryLaterError) throw error;
    const lastAttempt = receiveCount >= MAX_RECEIVES;
    const backoff = RETRY_BACKOFF_SECONDS[receiveCount - 1] ?? 0;

    if (error instanceof FetchError) {
      const crawlError = crawlErrorFrom(error);
      // A board's format changed under us: worth a look, not an alarm.
      if (error.code === 'unreadable_feed')
        logger.error('Job board feed unreadable', { crawlId, reason: error.message });
      // Expected outcomes of crawling the web: recorded on the crawl, never dead-lettered.
      if (!error.retriable || lastAttempt) return await fail(crawlError);
      await deps.repo.recordRetry(userId, crawlId, crawlError);
      return await retryLater(Math.max(backoff, error.retryAfterSeconds ?? 0), crawlError.message);
    }

    // Our own failure (a bug, an AWS outage, the time limit): retry; on the last attempt,
    // end the crawl clearly, then dead-letter the message so the alarm fires.
    const reason = error instanceof Error ? error.message : String(error);
    if (!lastAttempt) return await retryLater(backoff, reason);
    logger.error('Crawl failed on its last attempt', { crawlId, reason });
    await fail({ code: 'internal', message: CRAWL_ERRORS.internal }).catch(() => undefined);
    await deps.delayRetry(record, 0).catch(() => undefined);
    throw error;
  }
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function queueUrlFromArn(arn: string): string {
  const [, , , region, account, name] = arn.split(':');
  return `https://sqs.${region}.amazonaws.com/${account}/${name}`;
}

let deps: CrawlWorkerDeps | undefined;
let currentContext: Context | undefined;
const processor = new BatchProcessor(EventType.SQS);

function defaultDeps(): CrawlWorkerDeps {
  const {
    CRAWLS_TABLE_NAME,
    SOURCES_TABLE_NAME,
    AUDIT_TABLE_NAME,
    USERS_TABLE_NAME,
    JOBS_TABLE_NAME,
    DOCUMENTS_BUCKET_NAME,
  } = process.env;
  if (
    !CRAWLS_TABLE_NAME ||
    !SOURCES_TABLE_NAME ||
    !AUDIT_TABLE_NAME ||
    !USERS_TABLE_NAME ||
    !JOBS_TABLE_NAME ||
    !DOCUMENTS_BUCKET_NAME
  ) {
    throw new Error('Table and bucket names must be set');
  }
  const client = documentClient();
  const account = new AccountRepository(client, USERS_TABLE_NAME);
  const jobs = new JobRepository(client, JOBS_TABLE_NAME);
  const s3 = new S3Client({});
  const sqs = new SQSClient({});
  return {
    repo: new CrawlRepository(client, {
      crawls: CRAWLS_TABLE_NAME,
      sources: SOURCES_TABLE_NAME,
      audit: AUDIT_TABLE_NAME,
      // Counting happens at submit; the worker never touches usage (and has no grant).
      usage: process.env.USAGE_TABLE_NAME ?? '',
    }),
    isBeingDeleted: (userId) => account.isBeingDeleted(userId),
    newFetcher: () => {
      const fetcher = createFetcher();
      return (url, options) => fetcher.fetch(url, options);
    },
    saveJobs: (userId, found, context) => jobs.save(userId, found, context),
    now: () => new Date(),
    storePage: async (key, page) => {
      await s3.send(
        new PutObjectCommand({
          Bucket: DOCUMENTS_BUCKET_NAME,
          Key: key,
          Body: page.body,
          ContentType: page.charset
            ? `${page.contentType}; charset=${page.charset}`
            : page.contentType,
          // Expired by the bucket's lifecycle rule after 30 days.
          Tagging: `${CRAWL_PAGE_RETENTION_TAG.key}=${CRAWL_PAGE_RETENTION_TAG.value}`,
        }),
      );
    },
    delayRetry: async (record, seconds) => {
      await sqs.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrlFromArn(record.eventSourceARN),
          ReceiptHandle: record.receiptHandle,
          VisibilityTimeout: seconds,
        }),
      );
    },
    newId: ulid,
    remainingMs: () => currentContext?.getRemainingTimeInMillis() ?? 60_000,
  };
}

export async function handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse> {
  logger.addContext(context);
  currentContext = context;
  deps ??= defaultDeps();
  const current = deps;
  return processPartialResponse(
    event,
    (record: SQSRecord) => processRecord(record, current),
    processor,
    {
      context,
    },
  );
}
