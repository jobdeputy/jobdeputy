import { BatchProcessor, EventType, processPartialResponse } from '@aws-lambda-powertools/batch';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ChangeMessageVisibilityCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  AccountRepository,
  type AuditInput,
  type CrawlError,
  CrawlRepository,
  documentClient,
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
import { looksLikeJavaScriptShell } from './fetch/detect.js';
import { createFetcher, decodeBody, FetchError, type FetchedPage } from './fetch/fetcher.js';

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
  /** One fetch with a fresh fetcher (its robots.txt memory lasts one crawl). */
  fetchPage: (url: string) => Promise<FetchedPage>;
  storePage: (key: string, page: FetchedPage) => Promise<void>;
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

const isHtml = (page: FetchedPage) =>
  page.contentType === 'text/html' || page.contentType === 'application/xhtml+xml';

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
    const page = await withDeadline(
      deps.fetchPage(crawl.url),
      deps.remainingMs() - SAFETY_MARGIN_MS,
    );
    if (isHtml(page) && looksLikeJavaScriptShell(decodeBody(page))) {
      return await fail({ code: 'needs_browser', message: CRAWL_ERRORS.needs_browser });
    }
    const key = crawlKeys(userId, crawlId).page;
    await deps.storePage(key, page);
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
      },
      audit('crawl.succeeded', `Crawl succeeded: ${host}`, { bytes: page.body.byteLength }),
    );
    logger.info('Crawl succeeded', {
      crawlId,
      bytes: page.body.byteLength,
      attempts: crawl.attempts,
    });
    return 'succeeded';
  } catch (error) {
    if (error instanceof RetryLaterError) throw error;
    const lastAttempt = receiveCount >= MAX_RECEIVES;
    const backoff = RETRY_BACKOFF_SECONDS[receiveCount - 1] ?? 0;

    if (error instanceof FetchError) {
      const crawlError = crawlErrorFrom(error);
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
    DOCUMENTS_BUCKET_NAME,
  } = process.env;
  if (
    !CRAWLS_TABLE_NAME ||
    !SOURCES_TABLE_NAME ||
    !AUDIT_TABLE_NAME ||
    !USERS_TABLE_NAME ||
    !DOCUMENTS_BUCKET_NAME
  ) {
    throw new Error('Table and bucket names must be set');
  }
  const client = documentClient();
  const account = new AccountRepository(client, USERS_TABLE_NAME);
  const s3 = new S3Client({});
  const sqs = new SQSClient({});
  return {
    repo: new CrawlRepository(client, {
      crawls: CRAWLS_TABLE_NAME,
      sources: SOURCES_TABLE_NAME,
      audit: AUDIT_TABLE_NAME,
    }),
    isBeingDeleted: (userId) => account.isBeingDeleted(userId),
    fetchPage: (url) => createFetcher().fetch(url),
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
