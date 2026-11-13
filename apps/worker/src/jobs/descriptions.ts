import type { DescriptionStats, JobPosting } from '@jobdeputy/db';
import { decodeBody, FETCH_LIMITS, FetchError } from '../fetch/fetcher.js';
import { type Board, boardFromUrl, feedRequest } from './boards.js';
import type { FetchFn } from './crawl-jobs.js';
import { CRAWL_LIMITS, toPosting } from './crawl-jobs.js';
import { FeedFormatError, parseFeed } from './feeds.js';

/**
 * T08d3: Greenhouse and Workday lists have no descriptions. A crawl reads the posting of
 * each top candidate that has none yet, through the board's single-posting endpoint, so
 * the LLM scores it with its description. A posting that answers 404 or 410 is gone.
 */
export const DESCRIPTION_LIMITS = {
  /** Postings read per crawl (as many as a scoring run takes). */
  maxRequests: 50,
  /** Left for saving the jobs and finishing the crawl once reading stops. */
  reserveMs: 30_000,
} as const;

export type Description = Required<
  Pick<JobPosting, 'description' | 'descriptionTruncated' | 'descriptionHash'>
>;

export interface DescriptionReading {
  descriptions: Map<string, Description>;
  /** Jobs whose posting answered 404 or 410. */
  gone: string[];
  stats: DescriptionStats;
}

export interface DescriptionOptions {
  now: Date;
  /** Milliseconds left before the worker must stop. */
  remainingMs: () => number;
  sleep: (ms: number) => Promise<void>;
  /** The longest one request can take (the fetcher's total timeout). */
  requestMs?: number;
}

/** The board's endpoint for one job's posting, when it has one. */
export function postingBoard(board: Board, job: JobPosting): Board | undefined {
  switch (board.ats) {
    case 'greenhouse':
    case 'lever':
      return job.externalId ? { ...board, job: job.externalId } : undefined;
    case 'workday': {
      // The list's link is the posting's page: `https://<host>/<site>/job/<path>`.
      let url: URL;
      try {
        url = new URL(job.jobUrl);
      } catch {
        return undefined;
      }
      const found = boardFromUrl(url);
      return found?.ats === 'workday' &&
        found.job !== undefined &&
        found.host.toLowerCase() === board.host.toLowerCase()
        ? { ...board, job: found.job }
        : undefined;
    }
    case 'ashby':
      // Its list has descriptions; it has no endpoint for one posting.
      return undefined;
  }
}

/**
 * Reads the postings of `jobs` (best first) one by one, at least `hostGapMs` apart, while
 * the limits allow. Only a posting that is gone or blocks us changes what happens next:
 * a gone job is reported, and a block (403, 429) stops the reading. Nothing here fails
 * the crawl.
 */
export async function readDescriptions(
  board: Board,
  jobs: JobPosting[],
  fetch: FetchFn,
  options: DescriptionOptions,
): Promise<DescriptionReading> {
  const requestMs = options.requestMs ?? FETCH_LIMITS.totalTimeoutMs;
  const descriptions = new Map<string, Description>();
  const gone: string[] = [];
  const stats: DescriptionStats = { fetched: 0, gone: 0, failed: 0, skipped: 0 };
  let requests = 0;
  for (const [i, job] of jobs.entries()) {
    const target = postingBoard(board, job);
    if (target === undefined) {
      stats.failed += 1;
      continue;
    }
    const wait = CRAWL_LIMITS.hostGapMs;
    if (
      requests >= DESCRIPTION_LIMITS.maxRequests ||
      options.remainingMs() - DESCRIPTION_LIMITS.reserveMs < wait + requestMs
    ) {
      stats.skipped += jobs.length - i;
      break;
    }
    // The list (or the previous posting) came from the same host just before.
    await options.sleep(wait);
    requests += 1;
    try {
      const request = feedRequest(target);
      const page = await fetch(request.url);
      const posting = parseFeed(target, decodeBody(page), 0, options.now).jobs[0];
      const read = posting && toPosting(posting);
      if (read?.description === undefined || read.descriptionHash === undefined) {
        stats.failed += 1;
        continue;
      }
      descriptions.set(job.jobId, {
        description: read.description,
        descriptionTruncated: read.descriptionTruncated ?? false,
        descriptionHash: read.descriptionHash,
      });
      stats.fetched += 1;
    } catch (error) {
      if (error instanceof FetchError && error.code === 'not_found') {
        gone.push(job.jobId);
        stats.gone += 1;
      } else if (error instanceof FetchError && error.code === 'blocked') {
        stats.failed += 1;
        stats.skipped += jobs.length - i - 1;
        break;
      } else if (error instanceof FetchError || error instanceof FeedFormatError) {
        stats.failed += 1;
      } else {
        throw error;
      }
    }
  }
  return { descriptions, gone, stats };
}
