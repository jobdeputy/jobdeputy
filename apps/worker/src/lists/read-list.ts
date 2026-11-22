import type { ListSource } from '@jobdeputy/shared';
import {
  decodeBody,
  FETCH_LIMITS,
  FetchError,
  type FetchedPage,
  type FetchLimits,
} from '../fetch/fetcher.js';
import type { FetchFn } from '../jobs/crawl-jobs.js';
import { type ListRow, parseListings, parseReadme } from './parse.js';

/**
 * Limits for reading a list: a list is one large file (Simplify New-Grad's `listings.json` is
 * about 13 MB, 2 MB compressed), read once per run. Everything else is as for any page.
 */
export const LIST_FETCH_LIMITS: FetchLimits = {
  ...FETCH_LIMITS,
  maxBytes: 25 * 1024 * 1024,
  totalTimeoutMs: 60_000,
};

export interface ListReading {
  page: FetchedPage;
  rows: ListRow[];
  format: 'listings' | 'readme';
}

/** The files of a GitHub repository, from its default branch (`HEAD`), as GitHub serves them. */
function rawUrl(source: Extract<ListSource, { kind: 'github' }>, path: string): string {
  const name = encodeURIComponent;
  return `https://raw.githubusercontent.com/${name(source.owner)}/${name(source.repo)}/HEAD/${path}`;
}

/** The Simplify format's file, in lists that keep it (Simplify's own, and lists made from them). */
export const LISTINGS_PATH = '.github/scripts/listings.json';

function json(page: FetchedPage): unknown {
  try {
    return JSON.parse(decodeBody(page));
  } catch {
    return undefined;
  }
}

/** A missing file: the next place to look. Any other failure is the crawl's failure. */
async function optional(fetch: FetchFn, url: string): Promise<FetchedPage | undefined> {
  try {
    return await fetch(url);
  } catch (error) {
    if (error instanceof FetchError && error.code === 'not_found') return undefined;
    throw error;
  }
}

/**
 * #50: a list's open roles. A GitHub list is read from its repository's files (decision on
 * #50: GitHub's terms allow reading through its services; the list holds no personal data):
 * the Simplify `listings.json` where there is one (complete), else the README's tables (some
 * lists show only part of their roles there). Fails with `not_a_list` when neither holds roles.
 */
export async function readList(source: ListSource, fetch: FetchFn): Promise<ListReading> {
  if (source.kind === 'test') {
    const page = await fetch(source.url);
    const rows = parseListings(json(page));
    if (!rows) throw new FetchError('not_a_list', false);
    return { page, rows, format: 'listings' };
  }
  const listings = await optional(fetch, rawUrl(source, LISTINGS_PATH));
  if (listings) {
    const rows = parseListings(json(listings));
    if (rows) return { page: listings, rows, format: 'listings' };
  }
  const readme = await optional(fetch, rawUrl(source, 'README.md'));
  if (!readme) throw new FetchError('not_a_list', false);
  const rows = parseReadme(decodeBody(readme));
  if (rows.length === 0) throw new FetchError('not_a_list', false);
  return { page: readme, rows, format: 'readme' };
}
