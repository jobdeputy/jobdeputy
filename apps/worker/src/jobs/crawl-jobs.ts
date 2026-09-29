import type { CrawlExtraction, JobPosting, PartialReason } from '@jobdeputy/db';
import { looksLikeJavaScriptShell } from '../fetch/detect.js';
import {
  decodeBody,
  FETCH_LIMITS,
  FetchError,
  type FetchedPage,
  type FetchOptions,
} from '../fetch/fetcher.js';
import { type Board, boardKey, feedRequest } from './boards.js';
import { FeedFormatError, type FeedPage, parseFeed } from './feeds.js';
import { contentHash, descriptionHash, type ExtractedJob } from './job.js';
import { boardForUrl, readPage } from './read-page.js';

/** 0008: limits for reading one crawl's jobs. */
export const CRAWL_LIMITS = {
  /** Jobs saved per crawl. */
  maxJobs: 500,
  /** Requests after the first (more feed pages, or the board a page embeds). */
  maxExtraRequests: 10,
  /** Between two requests to the same host (Lever asks for `Crawl-delay: 1`). */
  hostGapMs: 1_000,
  /** From the first request; a new request starts only if it can finish within it. */
  budgetMs: 150_000,
} as const;
/** Bumped when extraction changes in a way worth re-reading jobs for. */
export const EXTRACTION_VERSION = 1;

export type FetchFn = (url: string, options?: FetchOptions) => Promise<FetchedPage>;

export interface ReadOptions {
  now: Date;
  /** Milliseconds, for the gap and the budget. Tests pass a fake clock. */
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** The longest one request can take (the fetcher's total timeout). */
  requestMs?: number;
}

export interface CrawlReading {
  /** The first response: the page, or the feed for a board link. Stored for 30 days. */
  page: FetchedPage;
  jobs: JobPosting[];
  extraction: CrawlExtraction;
  /** The job board read, if any. */
  board?: Board;
  /** Requests made (robots.txt not counted). */
  requests: number;
  /**
   * Everything the source lists was read: a job board or schema.org data, not partial.
   * Only then may jobs it no longer lists be closed (T07c).
   */
  complete: boolean;
}

const isHtml = (page: FetchedPage) =>
  page.contentType === 'text/html' || page.contentType === 'application/xhtml+xml';

/** Stops the reading early; what was read so far is kept. */
class Stop extends Error {
  constructor(readonly reason: PartialReason) {
    super(reason);
  }
}

/**
 * Every request of one crawl: counted, within the time budget, and at least `hostGapMs`
 * after the previous request to the same host.
 */
function pacer(fetch: FetchFn, options: ReadOptions) {
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const requestMs = options.requestMs ?? FETCH_LIMITS.totalTimeoutMs;
  const started = clock();
  const lastByHost = new Map<string, number>();
  let requests = 0;
  return {
    get requests() {
      return requests;
    },
    async fetch(url: string, fetchOptions: FetchOptions = {}): Promise<FetchedPage> {
      if (requests > CRAWL_LIMITS.maxExtraRequests) throw new Stop('max_pages');
      const host = new URL(url).host;
      const last = lastByHost.get(host);
      const wait = last === undefined ? 0 : Math.max(0, last + CRAWL_LIMITS.hostGapMs - clock());
      if (requests > 0 && clock() + wait + requestMs - started > CRAWL_LIMITS.budgetMs) {
        throw new Stop('time_budget');
      }
      if (wait > 0) await sleep(wait);
      requests += 1;
      try {
        return await fetch(url, fetchOptions);
      } finally {
        lastByHost.set(host, clock());
      }
    },
  };
}
type Pacer = ReturnType<typeof pacer>;

function unreadable(board: Board, error: FeedFormatError): FetchError {
  // The board changed its format: the same answer comes back, so no retry.
  return new FetchError('unreadable_feed', false, `${boardKey(board)}: ${error.message}`);
}

/**
 * Reads a board's feed, following its pages (Lever, Workday) within the limits. The first
 * page must succeed; a later one that fails or stops only makes the crawl partial.
 */
async function readBoard(board: Board, paced: Pacer, now: Date) {
  const byId = new Map<string, ExtractedJob>();
  let first: FetchedPage | undefined;
  let skipped = 0;
  let partial: PartialReason | undefined;
  let offset = 0;
  for (;;) {
    const request = feedRequest(board, offset);
    let page: FetchedPage;
    let feed: FeedPage;
    try {
      page = await paced.fetch(
        request.url,
        request.json !== undefined ? { json: request.json } : {},
      );
      feed = parseFeed(board, decodeBody(page), offset, now);
    } catch (error) {
      if (first === undefined) {
        throw error instanceof FeedFormatError ? unreadable(board, error) : error;
      }
      if (error instanceof Stop) partial = error.reason;
      else if (error instanceof FetchError || error instanceof FeedFormatError)
        partial = 'page_failed';
      else throw error;
      break;
    }
    first ??= page;
    skipped += feed.skipped;
    for (const job of feed.jobs) if (!byId.has(job.jobId)) byId.set(job.jobId, job);
    // Stop paging at a full crawl, a last page, or a feed that does not move forward.
    if (byId.size >= CRAWL_LIMITS.maxJobs) {
      if (byId.size > CRAWL_LIMITS.maxJobs || feed.nextOffset !== undefined) partial = 'max_jobs';
      break;
    }
    if (feed.nextOffset === undefined || feed.nextOffset <= offset) break;
    offset = feed.nextOffset;
  }
  return { page: first, jobs: [...byId.values()], skipped, partial };
}

/**
 * Reads the jobs a submitted link leads to, in 0008's order: a job-board link goes to
 * the board's feed without fetching the page; otherwise the page, then a board it
 * redirected to, its schema.org data, or the one board it embeds. Every request goes
 * through `fetch` (one fetcher per crawl: the SSRF checks, robots.txt, and limits).
 */
export async function readJobs(
  url: string,
  fetch: FetchFn,
  options: ReadOptions,
): Promise<CrawlReading> {
  const paced = pacer(fetch, options);
  const { now } = options;
  const linked = boardForUrl(url);
  if (linked) {
    const read = await readBoard(linked, paced, now);
    return result(
      read.page,
      read.jobs,
      read.skipped,
      'ats_feed',
      paced.requests,
      read.partial,
      linked,
    );
  }

  const page = await paced.fetch(url);
  const text = isHtml(page) ? decodeBody(page) : '';
  const reading = readPage({ url: page.url, contentType: page.contentType, text }, now);
  switch (reading.kind) {
    case 'board': {
      const read = await readBoard(reading.board, paced, now);
      return result(
        page,
        read.jobs,
        read.skipped,
        'ats_feed',
        paced.requests,
        read.partial,
        reading.board,
      );
    }
    case 'jobs':
      return result(page, reading.jobs, reading.skipped, 'schema_org', paced.requests);
    case 'none':
      // Only now: a script-built page can still embed a board or carry schema.org data.
      if (isHtml(page) && looksLikeJavaScriptShell(text)) {
        throw new FetchError('needs_browser', false);
      }
      return {
        page,
        jobs: [],
        extraction: { outcome: 'no_readable_jobs', skipped: 0 },
        requests: paced.requests,
        // Nothing was read, so nothing can be known to have gone.
        complete: false,
      };
  }
}

function result(
  page: FetchedPage,
  jobs: ExtractedJob[],
  skipped: number,
  method: 'ats_feed' | 'schema_org',
  requests: number,
  stopped?: PartialReason,
  board?: Board,
): CrawlReading {
  const kept = jobs.slice(0, CRAWL_LIMITS.maxJobs);
  const partial = jobs.length > kept.length ? 'max_jobs' : stopped;
  return {
    page,
    jobs: kept.map(toPosting),
    extraction: {
      outcome: 'read',
      method,
      ...(board ? { board: boardKey(board) } : {}),
      skipped,
      ...(partial ? { partial: { reason: partial } } : {}),
    },
    ...(board ? { board } : {}),
    requests,
    complete: partial === undefined,
  };
}

/** The posting group of a `jobs` item. */
export function toPosting(job: ExtractedJob): JobPosting {
  const { method, ...fields } = job;
  return {
    ...fields,
    contentHash: contentHash(job),
    // Set together with the description, so a later full description clears the flag.
    ...(job.description !== undefined
      ? {
          descriptionHash: descriptionHash(job.description),
          descriptionTruncated: job.descriptionTruncated ?? false,
        }
      : {}),
    extraction: { method, version: EXTRACTION_VERSION },
  };
}
