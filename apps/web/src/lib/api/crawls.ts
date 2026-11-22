import { useQuery } from '@tanstack/react-query';
import { type ApiClient, ApiError, isFinal, useApi } from './index.ts';

/**
 * A crawl as the API shows it (apps/api/src/crawls.ts `crawlView`, the parts the screens use): the
 * link is `queued`, then `running`, then `succeeded` or `failed` (with the reason in the person's
 * words). After it succeeds, the AI scores its jobs (`relevance`, when the crawl uses AI), and the
 * jobs shown can change until that is `done`.
 */
export interface Crawl {
  crawlId: string;
  url: string;
  /** #50: `list` for a list of roles (a GitHub repository): its best companies are crawled. */
  kind?: 'list';
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  /** The AI that scores its jobs: `platform`, a provider (the person's own key), or `none`. */
  aiSource?: string;
  error?: { code: string; message: string };
  stats?: {
    jobsFound: number;
    jobsRelevant?: number;
    /** #50: a list run's company crawls that succeeded and failed. */
    companies?: { succeeded: number; failed: number };
  };
  /** #50: a list run, once its list is read: the companies chosen and how far it is. */
  list?: CrawlList;
  relevance?: { status: 'running' | 'done' | 'failed'; error?: { code: string; message: string } };
  createdAt: string;
  /** When it last moved on (a list run: a company queued, started, or ended). */
  updatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

/** #50: what a list run chose, and how far its company crawls are. */
export interface CrawlList {
  /** The companies chosen, best first (at most 20). */
  companies: { name: string; url: string }[];
  /** Companies with matching roles on sites the deputy can't read yet. */
  skipped: number;
  /** Chosen companies whose board was already being read. */
  busy: number;
  /** Company crawls not started yet, at work now, and ended. */
  waiting: number;
  running: number;
  ended: number;
  crawlIds: string[];
}

/** How often a crawl at work is asked about again. */
export const CRAWL_CHECK_EVERY_MS = 3000;

/**
 * How long after a crawl ends its AI scoring may take to start (a separate worker, through a
 * queue: seconds, normally). Past it, a crawl with no scoring is taken as done, so the page never
 * waits forever on a scoring that was never queued.
 */
export const SCORING_START_MS = 5 * 60 * 1000;

/**
 * How long a crawl may stay at one stage before the page takes it as stalled: reading (the API
 * ends a crawl this old, STALE_CRAWL_MS, when the next link is sent) or scoring (6 model calls at
 * most, each with its own timeout).
 */
export const STALLED_MS = 15 * 60 * 1000;

/**
 * #50: how long a list run may go without moving on (a company queued, started, or ended) once it
 * crawls its companies: the API's STALE_LIST_MS. Its companies share the crawl queue with others.
 */
export const LIST_STALLED_MS = 60 * 60 * 1000;

type Followed = Pick<
  Crawl,
  | 'status'
  | 'relevance'
  | 'aiSource'
  | 'stats'
  | 'createdAt'
  | 'startedAt'
  | 'finishedAt'
  | 'kind'
  | 'list'
  | 'updatedAt'
>;

/** Whether the deputy is still reading the link. */
export function isReading(crawl: Pick<Crawl, 'status'>): boolean {
  return crawl.status === 'queued' || crawl.status === 'running';
}

/**
 * When the deputy's current stage stops counting as work (epoch ms): reading from when the crawl
 * started; scoring, or waiting for it to start, from when the crawl ended. Null once it is done.
 * The AI scores a crawl's jobs in a separate step after the crawl succeeds, only when it used AI
 * and kept some jobs, so a crawl like that with no scoring yet is still at work.
 */
export function workDeadline(crawl: Followed): number | null {
  if (isReading(crawl)) {
    // A list run crawling its companies is stalled only once it stops moving on (as the API sees it).
    if (crawl.kind === 'list' && (crawl.list?.crawlIds.length ?? 0) > 0) {
      return Date.parse(crawl.updatedAt ?? crawl.createdAt) + LIST_STALLED_MS;
    }
    return Date.parse(crawl.startedAt ?? crawl.createdAt) + STALLED_MS;
  }
  if (crawl.status !== 'succeeded') return null;
  const ended = Date.parse(crawl.finishedAt ?? '');
  if (crawl.relevance) return crawl.relevance.status === 'running' ? ended + STALLED_MS : null;
  const scores = crawl.aiSource !== undefined && crawl.aiSource !== 'none';
  const kept = (crawl.stats?.jobsRelevant ?? 0) > 0;
  return scores && kept ? ended + SCORING_START_MS : null;
}

/** Whether the deputy is still at work on it: reading the link, or scoring what it found. */
export function isCrawling(crawl: Followed, now = Date.now()): boolean {
  const deadline = workDeadline(crawl);
  // An unreadable date (an old item) never holds the page: NaN compares false.
  return deadline !== null && now < deadline;
}

/** At work too long without moving on: shown as stalled, not as done. */
export function isStalled(crawl: Followed, now = Date.now()): boolean {
  const deadline = workDeadline(crawl);
  return (
    deadline !== null &&
    !(now < deadline) &&
    (isReading(crawl) || crawl.relevance?.status === 'running')
  );
}

/**
 * Which stage a crawl at work is at, for the deputy's step line. #50: a list run reads its list,
 * then its companies.
 */
export function crawlStage(
  crawl: Pick<Crawl, 'status' | 'kind' | 'list'>,
): 'waiting' | 'reading' | 'readingList' | 'companies' | 'scoring' {
  if (crawl.status === 'queued') return 'waiting';
  if (crawl.status === 'running') {
    if (crawl.kind !== 'list') return 'reading';
    return crawl.list ? 'companies' : 'readingList';
  }
  return 'scoring';
}

/** What a crawl reads, as people say it: a site ("boards.greenhouse.io"), or a list ("owner/repo"). */
export function crawlName(crawl: Pick<Crawl, 'url' | 'kind'>): string {
  try {
    const url = new URL(crawl.url);
    if (crawl.kind === 'list' && url.hostname === 'github.com') {
      return url.pathname.split('/').filter(Boolean).slice(0, 2).join('/') || url.hostname;
    }
    return url.hostname.replace(/^www\./, '');
  } catch {
    return crawl.url;
  }
}

/**
 * When to ask about the latest crawl again: while the deputy is at work on it, unless asking again
 * can't help (signed out, account closed). False: not again.
 */
export function nextCrawlCheck(
  { data, error }: { data: Crawl | null | undefined; error: unknown },
  every: number,
): number | false {
  if (isFinal(error)) return false;
  return data && isCrawling(data) ? every : false;
}

export function latestCrawlQuery(api: ApiClient) {
  return {
    queryKey: ['crawls', 'latest'],
    queryFn: async () =>
      (await api.request<{ crawls: Crawl[] }>('GET', '/me/crawls?limit=1')).crawls[0] ?? null,
  };
}

/**
 * The person's newest crawl (null before their first), asked about again every 3 s while the deputy
 * is at work on it, and on coming back to the tab, so a crawl started earlier (another tab, before
 * a reload) is followed too. A failed read keeps the last answer on screen and is asked again on
 * the next beat; a first read that fails is shown, with a way to try again.
 */
export function useLatestCrawl(checkEvery = CRAWL_CHECK_EVERY_MS) {
  const api = useApi();
  return useQuery({
    ...latestCrawlQuery(api),
    refetchInterval: ({ state }) => nextCrawlCheck(state, checkEvery),
    // Back from another tab (where a link may have been sent), it is read again.
    refetchOnWindowFocus: true,
    retry: (failures, error) =>
      failures < 1 && error instanceof ApiError && error.kind === 'offline',
  });
}

/**
 * Starts a crawl of `url` (the API checks the address and the limits); resolves with it queued.
 * `withoutAi`: rank by keywords only (`aiSource: none`), when the person's AI can't be used now.
 */
export function startCrawl(
  api: ApiClient,
  url: string,
  { withoutAi = false }: { withoutAi?: boolean } = {},
): Promise<Crawl> {
  return api.request<Crawl>('POST', '/me/crawls', {
    url,
    ...(withoutAi ? { aiSource: 'none' } : {}),
  });
}
