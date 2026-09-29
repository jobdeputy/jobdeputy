import { decodeEntities } from './text.js';

/**
 * Job boards (applicant-tracking systems) with public data feeds (T07a, decision 0008).
 * A careers page on one of them is read from its feed, not its HTML: complete, structured,
 * and small. SmartRecruiters is left out on purpose: its robots.txt forbids its API to us.
 *
 * `job` is set when a link points at one posting: then only that posting is read (its
 * own endpoint where the board has one), not the whole board. T08 reuses these endpoints
 * to fetch the descriptions a list leaves out.
 */
export type Board =
  | { ats: 'greenhouse'; slug: string; job?: string }
  | { ats: 'lever'; slug: string; eu: boolean; job?: string }
  | { ats: 'ashby'; slug: string; job?: string }
  /** `job` is the path after `/job/`, for example `US-CA-Santa-Clara/Engineer_JR123`. */
  | { ats: 'workday'; host: string; tenant: string; site: string; job?: string };

/**
 * The board's identity (the company, for now): `greenhouse:acme`,
 * `workday:acme.wd5.myworkdayjobs.com/external`. Lowercase, so `Acme` and `acme` are one
 * board and its jobs are not saved twice (requests keep the case as given).
 */
export function boardKey(board: Board): string {
  switch (board.ats) {
    case 'workday':
      return `workday:${board.host}/${board.site}`.toLowerCase();
    case 'lever':
      return `lever:${board.eu ? 'eu:' : ''}${board.slug}`.toLowerCase();
    default:
      return `${board.ats}:${board.slug}`.toLowerCase();
  }
}

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const NUMERIC_ID = /^\d{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCALE = /^[a-z]{2}(-[A-Za-z]{2})?$/;
const WORKDAY_HOST = /^([a-z0-9-]{1,63})\.wd\d{1,3}\.myworkdayjobs\.com$/;
const WORKDAY_SITE_HOST = /^wd\d{1,3}\.myworkdaysite\.com$/;
const WORKDAY_JOB_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._~,()'-]{0,199}$/;

const match = (pattern: RegExp, value: string | undefined | null) =>
  value !== undefined && value !== null && pattern.test(value) ? value : undefined;
const slug = (value: string | undefined | null) => match(SLUG, value);

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function segments(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean).map(safeDecode);
}

const withJob = <T extends Board>(board: T, job: string | undefined): T =>
  job === undefined ? board : { ...board, job };

function greenhouse(url: URL, parts: string[]): Board | undefined {
  // Embedded boards name themselves in `?for=`: /embed/job_board?for=acme, /embed/job_app?for=acme&token=123.
  if (parts[0] === 'embed') {
    const found = slug(url.searchParams.get('for'));
    const job = match(NUMERIC_ID, url.searchParams.get('token'));
    return found ? withJob({ ats: 'greenhouse', slug: found }, job) : undefined;
  }
  // /acme, /acme/jobs/123
  const found = slug(parts[0]);
  const job = parts[1] === 'jobs' ? match(NUMERIC_ID, parts[2]) : undefined;
  return found ? withJob({ ats: 'greenhouse', slug: found }, job) : undefined;
}

function workdayJob(rest: string[]): string | undefined {
  // [site, 'job', ...path]: a posting. [site] or [site, 'anything else']: the board.
  if (rest[1] !== 'job') return undefined;
  const path = rest.slice(2);
  if (path.length === 0 || path.length > 5 || !path.every((s) => WORKDAY_JOB_SEGMENT.test(s))) {
    return undefined;
  }
  return path.join('/');
}

function workday(host: string, tenant: string | undefined, rest: string[]): Board | undefined {
  const site = slug(rest[0]);
  if (!tenant || !site || site === 'wday') return undefined;
  return withJob({ ats: 'workday', host, tenant, site }, workdayJob(rest));
}

/** The board (and posting) a link points at, from its host and path alone. */
export function boardFromUrl(url: URL): Board | undefined {
  const host = url.hostname.toLowerCase();
  const parts = segments(url);
  switch (host) {
    case 'boards.greenhouse.io':
    case 'job-boards.greenhouse.io':
      return greenhouse(url, parts);
    case 'boards-api.greenhouse.io': {
      // /v1/boards/acme/jobs[/123]
      const found = parts[1] === 'boards' ? slug(parts[2]) : undefined;
      const job = parts[3] === 'jobs' ? match(NUMERIC_ID, parts[4]) : undefined;
      return found ? withJob({ ats: 'greenhouse', slug: found }, job) : undefined;
    }
    case 'jobs.lever.co':
    case 'jobs.eu.lever.co': {
      // /acme[/<uuid>[/apply]]
      const found = slug(parts[0]);
      const eu = host === 'jobs.eu.lever.co';
      return found ? withJob({ ats: 'lever', slug: found, eu }, match(UUID, parts[1])) : undefined;
    }
    case 'api.lever.co':
    case 'api.eu.lever.co': {
      // /v0/postings/acme[/<uuid>]
      const found = parts[1] === 'postings' ? slug(parts[2]) : undefined;
      const eu = host === 'api.eu.lever.co';
      return found ? withJob({ ats: 'lever', slug: found, eu }, match(UUID, parts[3])) : undefined;
    }
    case 'jobs.ashbyhq.com': {
      // /acme[/<uuid>[/application]]
      const found = slug(parts[0]);
      return found ? withJob({ ats: 'ashby', slug: found }, match(UUID, parts[1])) : undefined;
    }
    case 'api.ashbyhq.com': {
      const found =
        parts[0] === 'posting-api' && parts[1] === 'job-board' ? slug(parts[2]) : undefined;
      return found ? { ats: 'ashby', slug: found } : undefined;
    }
  }
  const tenantHost = WORKDAY_HOST.exec(host);
  if (tenantHost) {
    // https://acme.wd5.myworkdayjobs.com/[en-US/]External[/job/<path>]
    const rest = parts[0] !== undefined && LOCALE.test(parts[0]) ? parts.slice(1) : parts;
    return workday(host, tenantHost[1], rest);
  }
  if (WORKDAY_SITE_HOST.test(host)) {
    // https://wd3.myworkdaysite.com/[en-US/]recruiting/acme/External[/job/<path>]
    const rest = parts[0] !== undefined && LOCALE.test(parts[0]) ? parts.slice(1) : parts;
    return rest[0] === 'recruiting' ? workday(host, slug(rest[1]), rest.slice(2)) : undefined;
  }
  return undefined;
}

/** Links to a board host, in attributes or scripts. Bounded: the page is at most 5 MB. */
const BOARD_LINK =
  /https?:\/\/[a-z0-9.-]{1,200}\.(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com)(?:[/?][^\s"'<>\\)]{0,500})?/gi;
const MAX_LINKS = 2000;

/**
 * The one board a company's own careers page embeds or links to (for example
 * `boards.greenhouse.io/embed/job_board?for=acme`), read whole. None when the page names
 * several boards: which one the user meant is not ours to guess.
 */
export function boardFromHtml(html: string): Board | undefined {
  const boards = new Map<string, Board>();
  let count = 0;
  for (const link of html.matchAll(BOARD_LINK)) {
    if (++count > MAX_LINKS) break;
    let url: URL;
    try {
      url = new URL(decodeEntities(link[0]));
    } catch {
      continue;
    }
    const found = boardFromUrl(url);
    if (found === undefined) continue;
    // Links to single postings still name the board; the page lists the board's jobs.
    const { job: _job, ...board } = found;
    boards.set(boardKey(board), board);
    if (boards.size > 1) return undefined;
  }
  return boards.values().next().value;
}

/** Jobs per request where the feed pages (Lever: about 1 MB per 50 jobs with descriptions). */
export const FEED_PAGE_SIZE = { lever: 50, workday: 20 } as const;

export interface FeedRequest {
  url: string;
  /** Sent as a JSON `POST` (Workday's list). */
  json?: unknown;
}

/** The request for one page of a board's feed (`offset` counts jobs already read), or for one posting. */
export function feedRequest(board: Board, offset = 0): FeedRequest {
  const name = encodeURIComponent;
  switch (board.ats) {
    case 'greenhouse': {
      const base = `https://boards-api.greenhouse.io/v1/boards/${name(board.slug)}/jobs`;
      // The list goes without `content=true`: large boards pass 5 MB with descriptions, and
      // it has no paging. One posting comes with its description.
      return { url: board.job ? `${base}/${name(board.job)}` : base };
    }
    case 'lever': {
      const base = `https://api${board.eu ? '.eu' : ''}.lever.co/v0/postings/${name(board.slug)}`;
      return {
        url: board.job
          ? `${base}/${name(board.job)}?mode=json`
          : `${base}?mode=json&limit=${FEED_PAGE_SIZE.lever}&skip=${offset}`,
      };
    }
    case 'ashby':
      // No endpoint for one posting: the whole board is read and filtered.
      return {
        url: `https://api.ashbyhq.com/posting-api/job-board/${name(board.slug)}?includeCompensation=true`,
      };
    case 'workday': {
      const base = `https://${board.host}/wday/cxs/${name(board.tenant)}/${name(board.site)}`;
      if (board.job) return { url: `${base}/job/${board.job.split('/').map(name).join('/')}` };
      return {
        url: `${base}/jobs`,
        json: { appliedFacets: {}, limit: FEED_PAGE_SIZE.workday, offset, searchText: '' },
      };
    }
  }
}
