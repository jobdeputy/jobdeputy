import { BatchProcessor, EventType, processPartialResponse } from '@aws-lambda-powertools/batch';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ChangeMessageVisibilityCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  AccountRepository,
  type AuditInput,
  type ClosedJob,
  CompanyLimitRepository,
  type CrawlError,
  CrawlRepository,
  CrawlSettingsRepository,
  documentClient,
  type JobPosting,
  JobRepository,
  PreferencesRepository,
  ProfileRepository,
  type SaveContext,
  type SaveStats,
  ssmCrawlLimits,
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
import type { Board } from './jobs/boards.js';
import { type FetchFn, readJobs } from './jobs/crawl-jobs.js';
import { type DescriptionReading, readDescriptions } from './jobs/descriptions.js';
import {
  type FitInputs,
  type FitResult,
  fitInputsLoader,
  fitJobs,
  type ShownStore,
} from './relevance/fit.js';

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
  /** T07c: the jobs the source listed as of its earlier crawls. */
  listedJobIds: (userId: string, sourceId: string) => Promise<string[]>;
  /**
   * T07c: the source no longer lists these; closes the ones no page lists, which expire
   * at `expiresAt` if untouched (T08c). Returns the jobs closed.
   */
  closeJobs: (
    userId: string,
    sourceId: string,
    jobIds: string[],
    expiresAt: number,
  ) => Promise<ClosedJob[]>;
  /** T08d3: which of these jobs already have a description. */
  withDescription: (userId: string, jobIds: string[]) => Promise<Set<string>>;
  /** T08d3: closes jobs whose posting is gone (404 or 410). Returns the jobs closed. */
  closeGone: (userId: string, jobIds: string[], expiresAt: number) => Promise<ClosedJob[]>;
  /** T08c: the user's roles, search settings, and limits, for the code filter. */
  fitInputs: (userId: string) => Promise<FitInputs>;
  /** T08c: each company's shown jobs (`usage` `COMPANY#`). */
  shown: ShownStore & {
    release: (userId: string, companyKey: string, jobIds: string[]) => Promise<void>;
  };
  /** T08c: jobs pushed out of their company's shown list by this crawl. */
  markOverLimit: (userId: string, jobIds: string[], expiresAt: number) => Promise<void>;
  /** Waits between requests to one host. */
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  delayRetry: (record: SQSRecord, seconds: number) => Promise<void>;
  newId: () => string;
  remainingMs: () => number;
}

export type CrawlOutcome = 'succeeded' | 'failed' | 'skipped';

/**
 * The most job IDs a source remembers: a partial crawl adds to what it knew. Newest
 * first, so a page that keeps being partial keeps what it lists now.
 */
export const MAX_LISTED_JOB_IDS = 2_000;

export function listed(seen: string[], previous: string[]): string[] {
  return [...new Set([...seen, ...previous])].slice(0, MAX_LISTED_JOB_IDS);
}

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

/**
 * T08d3: reads the postings of the top `max` candidates that have no description, in the
 * list or stored from an earlier crawl. Nothing to read: undefined.
 */
async function describeCandidates(
  userId: string,
  board: Board,
  fit: FitResult,
  max: number,
  fetch: FetchFn,
  deps: CrawlWorkerDeps,
): Promise<DescriptionReading | undefined> {
  const byId = new Map(fit.jobs.map((j) => [j.jobId, j]));
  const missing = fit.ranked.slice(0, max).flatMap((id) => {
    const job = byId.get(id);
    return job && job.description === undefined ? [job] : [];
  });
  if (missing.length === 0) return undefined;
  const stored = await deps.withDescription(
    userId,
    missing.map((j) => j.jobId),
  );
  const todo = missing.filter((j) => !stored.has(j.jobId));
  if (todo.length === 0) return undefined;
  return readDescriptions(board, todo, fetch, {
    now: deps.now(),
    remainingMs: deps.remainingMs,
    sleep: deps.sleep,
  });
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

  // One fetcher for the crawl: it remembers robots.txt for the descriptions too.
  const fetch = deps.newFetcher();
  try {
    const { page, jobs, extraction, board, requests, complete } = await withDeadline(
      (async () => {
        const reading = await readJobs(crawl.url, fetch, {
          now: deps.now(),
          sleep: deps.sleep,
        });
        await deps.storePage(crawlKeys(userId, crawlId).page, reading.page);
        return reading;
      })(),
      deps.remainingMs() - SAFETY_MARGIN_MS,
    );
    const key = crawlKeys(userId, crawlId).page;
    const { saved, closed, listedJobIds, fit, inputs, described } = await withDeadline(
      (async () => {
        // T08c: filter every job, rank each company's candidates, then save with the result.
        const inputs = await deps.fitInputs(userId);
        const expiresAt = Math.floor(deps.now().getTime() / 1000) + inputs.expiryDays * 86_400;
        const fit = await fitJobs(userId, jobs, inputs, deps.shown);
        // T08d3: the top candidates' descriptions, where the board's list has none.
        const described = board
          ? await describeCandidates(userId, board, fit, inputs.relevanceMaxJobs, fetch, deps)
          : undefined;
        const found = described
          ? fit.jobs.map((j) => ({ ...j, ...described.descriptions.get(j.jobId) }))
          : fit.jobs;
        const context = { sourceId: crawl.sourceId, crawlId, expiresAt };
        const saved = await deps.saveJobs(userId, found, context);
        await deps.markOverLimit(userId, fit.pushedOut, expiresAt);
        // Closed jobs free their places in their company's shown list.
        const release = async (closedJobs: ClosedJob[]) => {
          const byCompany = new Map<string, string[]>();
          for (const j of closedJobs)
            byCompany.set(j.companyKey, [...(byCompany.get(j.companyKey) ?? []), j.jobId]);
          for (const [companyKey, ids] of byCompany)
            await deps.shown.release(userId, companyKey, ids);
        };
        if (described && described.gone.length > 0) {
          await release(await deps.closeGone(userId, described.gone, expiresAt));
        }
        const done = {
          saved,
          fit,
          inputs,
          described,
          listedJobIds: undefined as string[] | undefined,
        };
        if (extraction.outcome !== 'read') return { ...done, closed: 0 };
        // T07c: what this page lists now. Only a complete crawl can tell a job is gone;
        // a partial one keeps what it knew and adds what it read.
        const seen = jobs.map((j) => j.jobId);
        const previous = await deps.listedJobIds(userId, crawl.sourceId);
        if (!complete) return { ...done, closed: 0, listedJobIds: listed(seen, previous) };
        const current = new Set(seen);
        const missing = previous.filter((id) => !current.has(id));
        const closedJobs = await deps.closeJobs(userId, crawl.sourceId, missing, expiresAt);
        await release(closedJobs);
        return { ...done, closed: closedJobs.length, listedJobIds: seen };
      })(),
      deps.remainingMs() - SAFETY_MARGIN_MS,
    );
    const stats = {
      jobsFound: saved.found,
      jobsNew: saved.created,
      jobsUpdated: saved.updated,
      jobsClosed: closed,
      jobsRelevant: fit.relevant,
      jobsOverLimit: fit.overLimit,
      pagesFetched: requests,
      ...(described ? { descriptions: described.stats } : {}),
    };
    const gone = new Set(described?.gone);
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
        // T08d: what the LLM scores next, when this crawl has an AI source.
        ...(crawl.aiSource && crawl.aiSource !== 'none'
          ? {
              candidates: fit.ranked
                .filter((id) => !gone.has(id))
                .slice(0, inputs.relevanceMaxJobs),
            }
          : {}),
        extraction,
        source: {
          kind: board ? 'ats_board' : 'unknown',
          ...(board ? { ats: board.ats } : {}),
          lastFound: saved.found,
          ...(listedJobIds !== undefined ? { listedJobIds } : {}),
        },
      },
      audit('crawl.succeeded', `Crawl succeeded: ${host}, ${saved.found} jobs`, {
        bytes: page.body.byteLength,
        jobsFound: saved.found,
        jobsNew: saved.created,
        jobsClosed: closed,
        jobsRelevant: fit.relevant,
        jobsOverLimit: fit.overLimit,
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
    PREFERENCES_TABLE_NAME,
    USAGE_TABLE_NAME,
    CRAWL_LIMITS_PARAMETER,
  } = process.env;
  if (
    !CRAWLS_TABLE_NAME ||
    !SOURCES_TABLE_NAME ||
    !AUDIT_TABLE_NAME ||
    !USERS_TABLE_NAME ||
    !JOBS_TABLE_NAME ||
    !DOCUMENTS_BUCKET_NAME ||
    !PREFERENCES_TABLE_NAME ||
    !USAGE_TABLE_NAME ||
    !CRAWL_LIMITS_PARAMETER
  ) {
    throw new Error('Table, bucket, and parameter names must be set');
  }
  const client = documentClient();
  const account = new AccountRepository(client, USERS_TABLE_NAME);
  const jobs = new JobRepository(client, JOBS_TABLE_NAME);
  const crawls = new CrawlRepository(client, {
    crawls: CRAWLS_TABLE_NAME,
    sources: SOURCES_TABLE_NAME,
    audit: AUDIT_TABLE_NAME,
    // Counting happens at submit; the worker only frees the crawl's active slot when it ends.
    usage: USAGE_TABLE_NAME,
  });
  const preferences = new PreferencesRepository(client, PREFERENCES_TABLE_NAME);
  const profiles = new ProfileRepository(client, USERS_TABLE_NAME);
  const crawlSettings = new CrawlSettingsRepository(client, PREFERENCES_TABLE_NAME);
  const shown = new CompanyLimitRepository(client, USAGE_TABLE_NAME);
  const limits = ssmCrawlLimits(CRAWL_LIMITS_PARAMETER);
  const s3 = new S3Client({});
  const sqs = new SQSClient({});
  return {
    repo: crawls,
    isBeingDeleted: (userId) => account.isBeingDeleted(userId),
    newFetcher: () => {
      const fetcher = createFetcher();
      return (url, options) => fetcher.fetch(url, options);
    },
    saveJobs: (userId, found, context) => jobs.save(userId, found, context),
    listedJobIds: async (userId, sourceId) => {
      const source = await crawls.getSource(userId, sourceId);
      return [...(source?.listedJobIds ?? [])];
    },
    closeJobs: (userId, sourceId, jobIds, expiresAt) =>
      jobs.closeMissing(userId, sourceId, jobIds, expiresAt),
    withDescription: (userId, jobIds) => jobs.withDescription(userId, jobIds),
    closeGone: (userId, jobIds, expiresAt) => jobs.closeGone(userId, jobIds, expiresAt),
    fitInputs: fitInputsLoader({ preferences, profiles, crawlSettings, limits }),
    shown,
    markOverLimit: (userId, jobIds, expiresAt) => jobs.markOverLimit(userId, jobIds, expiresAt),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
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
