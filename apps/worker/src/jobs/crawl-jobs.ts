import type { CrawlExtraction, JobPosting } from '@jobdeputy/db';
import { looksLikeJavaScriptShell } from '../fetch/detect.js';
import { decodeBody, FetchError, type FetchedPage, type FetchOptions } from '../fetch/fetcher.js';
import { type Board, boardKey, feedRequest } from './boards.js';
import { FeedFormatError, parseFeed } from './feeds.js';
import { contentHash, descriptionHash, type ExtractedJob } from './job.js';
import { boardForUrl, readPage } from './read-page.js';

/** 0008: jobs saved per crawl. Past it the crawl is partial (T07c adds more limits). */
export const MAX_JOBS_PER_CRAWL = 500;
/** Bumped when extraction changes in a way worth re-reading jobs for. */
export const EXTRACTION_VERSION = 1;

export type FetchFn = (url: string, options?: FetchOptions) => Promise<FetchedPage>;

export interface CrawlReading {
  /** The first response: the page, or the feed for a board link. Stored for 30 days. */
  page: FetchedPage;
  jobs: JobPosting[];
  extraction: CrawlExtraction;
  /** The job board read, if any. */
  board?: Board;
}

const isHtml = (page: FetchedPage) =>
  page.contentType === 'text/html' || page.contentType === 'application/xhtml+xml';

async function readBoard(board: Board, fetch: FetchFn, now: Date) {
  const request = feedRequest(board);
  const page = await fetch(request.url, request.json !== undefined ? { json: request.json } : {});
  try {
    return { page, ...parseFeed(board, decodeBody(page), 0, now) };
  } catch (error) {
    // The board changed its format: the same answer comes back, so no retry.
    if (error instanceof FeedFormatError) {
      throw new FetchError('unreadable_feed', false, `${boardKey(board)}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Reads the jobs a submitted link leads to, in 0008's order: a job-board link goes to
 * the board's feed without fetching the page; otherwise the page, then a board it
 * redirected to, its schema.org data, or the one board it embeds. Every request goes
 * through `fetch` (one fetcher per crawl: the SSRF checks, robots.txt, and limits).
 */
export async function readJobs(url: string, fetch: FetchFn, now: Date): Promise<CrawlReading> {
  const linked = boardForUrl(url);
  if (linked) {
    const read = await readBoard(linked, fetch, now);
    return result(read.page, read.jobs, read.skipped, 'ats_feed', linked);
  }

  const page = await fetch(url);
  const text = isHtml(page) ? decodeBody(page) : '';
  const reading = readPage({ url: page.url, contentType: page.contentType, text }, now);
  switch (reading.kind) {
    case 'board': {
      const read = await readBoard(reading.board, fetch, now);
      return result(page, read.jobs, read.skipped, 'ats_feed', reading.board);
    }
    case 'jobs':
      return result(page, reading.jobs, reading.skipped, 'schema_org');
    case 'none':
      // Only now: a script-built page can still embed a board or carry schema.org data.
      if (isHtml(page) && looksLikeJavaScriptShell(text)) {
        throw new FetchError('needs_browser', false);
      }
      return { page, jobs: [], extraction: { outcome: 'no_readable_jobs', skipped: 0 } };
  }
}

function result(
  page: FetchedPage,
  jobs: ExtractedJob[],
  skipped: number,
  method: 'ats_feed' | 'schema_org',
  board?: Board,
): CrawlReading {
  const kept = jobs.slice(0, MAX_JOBS_PER_CRAWL);
  return {
    page,
    jobs: kept.map(toPosting),
    extraction: {
      outcome: 'read',
      method,
      ...(board ? { board: boardKey(board) } : {}),
      skipped,
      ...(jobs.length > kept.length ? { partial: { reason: 'max_jobs' as const } } : {}),
    },
    ...(board ? { board } : {}),
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
