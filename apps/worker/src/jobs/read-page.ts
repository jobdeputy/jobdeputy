import { type Board, boardFromHtml, boardFromUrl } from './boards.js';
import type { ExtractedJob } from './job.js';
import { jobsFromSchemaOrg } from './schema-org.js';

/**
 * What to do with a submitted link (T07a, decision 0008: code first, LLM last).
 *
 * 1. A link into a known job board: read the board's feed (or the one posting), without
 *    fetching the page at all (`boardForUrl`).
 * 2. Otherwise fetch the page, then (`readPage`):
 *    a. it redirected into a board: read that board;
 *    b. it describes jobs with schema.org data: those jobs;
 *    c. it embeds or links to exactly one board: read that board;
 *    d. nothing we can read: 0 jobs, `no_readable_jobs` (an LLM may read it later, #41).
 */
export type PageReading =
  | { kind: 'board'; board: Board }
  | { kind: 'jobs'; jobs: ExtractedJob[]; skipped: number; expired: number }
  | { kind: 'none' };

export function boardForUrl(url: string): Board | undefined {
  try {
    return boardFromUrl(new URL(url));
  } catch {
    return undefined;
  }
}

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

export function readPage(
  page: { url: string; contentType: string; text: string },
  now: Date,
): PageReading {
  const redirected = boardForUrl(page.url);
  if (redirected) return { kind: 'board', board: redirected };
  if (!HTML_TYPES.has(page.contentType)) return { kind: 'none' };

  const described = jobsFromSchemaOrg(page.text, page.url, now);
  if (described.jobs.length > 0) return { kind: 'jobs', ...described };

  const embedded = boardFromHtml(page.text);
  if (embedded) return { kind: 'board', board: embedded };
  return { kind: 'none' };
}
