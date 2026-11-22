import {
  type AuditInput,
  type Crawl,
  type CrawlList,
  type CrawlRepository,
  type CrawlStats,
  type ListRunRepository,
  type Source,
  sourceIdFor,
} from '@jobdeputy/db';
import {
  ACTIVE_CRAWL_STATUSES,
  type CrawlLimitsConfig,
  crawlKeys,
  createLogger,
  LIST_CONCURRENCY,
  parseCrawlUrl,
} from '@jobdeputy/shared';
import type { FetchedPage } from '../fetch/fetcher.js';
import type { FetchFn } from '../jobs/crawl-jobs.js';
import type { FitInputs } from '../relevance/fit.js';
import { pickCompanies } from './pick-companies.js';
import { readList } from './read-list.js';

const logger = createLogger('list-run');

/** Candidates each company crawl keeps for the list's AI run, at least (its shown jobs). */
export const MIN_LIST_SHARE = 3;
/** Steps one `advanceList` call takes at most: each queues, skips, or finishes once. */
const MAX_STEPS = 120;

export interface ListRunDeps {
  lists: Pick<ListRunRepository, 'choose' | 'queueCompany' | 'skipCompany'>;
  getCrawl: (userId: string, crawlId: string) => Promise<Crawl | undefined>;
  getSource: (userId: string, sourceId: string) => Promise<Source | undefined>;
  finish: CrawlRepository['finish'];
  /** A fetcher with the list's limits (`LIST_FETCH_LIMITS`). */
  newListFetcher: () => FetchFn;
  storePage: (key: string, page: FetchedPage) => Promise<void>;
  fitInputs: (userId: string) => Promise<FitInputs>;
  limits: () => Promise<CrawlLimitsConfig>;
  newId: () => string;
}

/**
 * Candidates each company crawl keeps (and reads descriptions for): an even share of the AI
 * run's `maxJobs`, never fewer than the jobs a company shows.
 */
export function listShare(companies: number, maxJobs: number): number {
  return Math.max(MIN_LIST_SHARE, Math.ceil(maxJobs / Math.max(1, companies)));
}

/**
 * The list's AI run takes the best of every company in turn: each company's first candidate
 * (in the list's company order), then each one's second, and so on, until `max`. So the jobs
 * shown (each company's first ones) are scored first.
 */
export function mergeCandidates(perCompany: string[][], max: number): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...perCompany.map((c) => c.length));
  for (let i = 0; i < depth && merged.length < max; i += 1) {
    for (const ids of perCompany) {
      const id = ids[i];
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
      if (merged.length === max) break;
    }
  }
  return merged;
}

const STAT_KEYS = [
  'jobsFound',
  'jobsNew',
  'jobsUpdated',
  'jobsClosed',
  'jobsRelevant',
  'jobsOverLimit',
  'pagesFetched',
] as const;

/** The list's totals: its company crawls' stats added up. */
export function listStats(children: Crawl[]): CrawlStats {
  const stats: CrawlStats = { jobsFound: 0, jobsNew: 0, jobsUpdated: 0 };
  let succeeded = 0;
  let failed = 0;
  for (const child of children) {
    if (child.status === 'failed') failed += 1;
    if (child.status !== 'succeeded') continue;
    succeeded += 1;
    for (const key of STAT_KEYS) {
      const value = child.stats?.[key];
      if (value !== undefined) stats[key] = (stats[key] ?? 0) + value;
    }
  }
  return { ...stats, companies: { succeeded, failed } };
}

function audit(
  deps: ListRunDeps,
  crawlId: string,
  name: string,
  summary: string,
  detail?: AuditInput['detail'],
): Omit<AuditInput, 'userId'> {
  return {
    auditId: deps.newId(),
    name,
    entity: { type: 'crawl', id: crawlId },
    actor: 'system',
    summary,
    ...(detail ? { detail } : {}),
  };
}

/** Ends the list once every company crawl has ended: totals, the merged candidates, the slot freed. */
async function finishList(list: Crawl, deps: ListRunDeps): Promise<void> {
  const { userId } = list;
  const [children, config] = await Promise.all([
    Promise.all((list.childIds ?? []).map((id) => deps.getCrawl(userId, id))),
    deps.limits(),
  ]);
  const ended = children.filter((c): c is Crawl => c !== undefined);
  const stats = listStats(ended);
  const withAi = list.aiSource !== undefined && list.aiSource !== 'none';
  const candidates = withAi
    ? mergeCandidates(
        ended.map((c) => (c.status === 'succeeded' ? (c.candidates ?? []) : [])),
        config.relevanceMaxJobs,
      )
    : [];
  const host = new URL(list.url).pathname.slice(1) || list.url;
  const finished = await deps.finish(
    list,
    {
      status: 'succeeded',
      result: list.result ?? {
        finalUrl: list.url,
        httpStatus: 200,
        contentType: 'application/json',
        bytes: 0,
        s3Key: crawlKeys(userId, list.crawlId).page,
      },
      stats,
      ...(candidates.length > 0 ? { candidates } : {}),
    },
    audit(
      deps,
      list.crawlId,
      'crawl.succeeded',
      `List run succeeded: ${host}, ${stats.companies?.succeeded ?? 0} companies, ${stats.jobsFound} jobs`,
      {
        companies: list.list?.companies.length ?? 0,
        companiesFailed: stats.companies?.failed ?? 0,
        skipped: list.list?.skipped ?? 0,
        jobsFound: stats.jobsFound,
        jobsRelevant: stats.jobsRelevant ?? 0,
      },
    ),
  );
  if (finished) logger.info('List run succeeded', { crawlId: list.crawlId, ...stats });
}

/**
 * Queues the list's next company. Its board busy with a crawl that has ended (or is gone)
 * is taken over; busy with one in progress, the company is passed over and counted.
 */
async function queueNext(list: Crawl, deps: ListRunDeps, config: CrawlLimitsConfig): Promise<void> {
  const companies = list.list?.companies ?? [];
  const company = companies[list.queuedCount ?? 0];
  if (!company) return;
  const checked = parseCrawlUrl(company.url);
  if (!checked.ok) {
    await deps.lists.skipCompany(list);
    return;
  }
  const sourceId = sourceIdFor(checked.normalizedUrl);
  const crawlId = deps.newId();
  const queue = (replacing?: string) =>
    deps.lists.queueCompany(list, LIST_CONCURRENCY, {
      crawlId,
      sourceId,
      url: company.url,
      normalizedUrl: checked.normalizedUrl,
      listShare: listShare(companies.length, config.relevanceMaxJobs),
      audit: audit(
        deps,
        crawlId,
        'crawl.requested',
        `Crawl requested: ${checked.url.hostname} (${company.name}, from a list)`,
        { sourceId, listCrawlId: list.crawlId },
      ),
      ...(replacing !== undefined ? { replacing } : {}),
    });
  if ((await queue()) !== 'busy') return;
  const activeId = (await deps.getSource(list.userId, sourceId))?.activeCrawlId;
  const active = activeId ? await deps.getCrawl(list.userId, activeId) : undefined;
  if (activeId !== undefined && (!active || !ACTIVE_CRAWL_STATUSES.includes(active.status))) {
    if ((await queue(activeId)) !== 'busy') return;
  }
  logger.info('Company board busy; passing over it', { crawlId: list.crawlId, sourceId });
  await deps.lists.skipCompany(list);
}

/**
 * Moves a list run on: queues its next companies while fewer than `LIST_CONCURRENCY` are in
 * progress, and ends it when every company crawl has ended. Called when the list is read and
 * whenever one of its company crawls ends. Idempotent, and safe when two run at once: every
 * write is conditional on the state it read, and a lost race reads the list again.
 */
export async function advanceList(
  userId: string,
  listId: string,
  deps: ListRunDeps,
): Promise<void> {
  const config = await deps.limits();
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const list = await deps.getCrawl(userId, listId);
    if (list?.kind !== 'list' || !list.list) return;
    if (!ACTIVE_CRAWL_STATUSES.includes(list.status)) return;
    const position = list.queuedCount ?? 0;
    const running = list.runningIds?.size ?? 0;
    if (position < list.list.companies.length) {
      if (running >= LIST_CONCURRENCY) return;
      await queueNext(list, deps, config);
      continue;
    }
    if (running > 0) return;
    await finishList(list, deps);
    return;
  }
  logger.warn('List run did not settle within its steps', { crawlId: listId });
}

export interface ListRunSummary {
  rows: number;
  matched: number;
  companies: number;
  skipped: number;
}

/**
 * #50: a list run's own step, in the crawl worker: reads the list (once: a retry keeps the
 * first choice), chooses its companies, then starts the first company crawls. The rest is
 * moved on by each company crawl as it ends (`advanceList`).
 */
export async function runList(
  crawl: Crawl,
  deps: ListRunDeps,
): Promise<ListRunSummary | undefined> {
  const { userId, crawlId } = crawl;
  let summary: ListRunSummary | undefined;
  if (!crawl.list) {
    if (!crawl.listSource) throw new Error('A list run without its list source');
    const reading = await readList(crawl.listSource, deps.newListFetcher());
    const key = crawlKeys(userId, crawlId).page;
    await deps.storePage(key, reading.page);
    const [inputs, config] = await Promise.all([deps.fitInputs(userId), deps.limits()]);
    const source = crawl.listSource;
    const picked = pickCompanies(reading.rows, inputs.profile, config.listCompanies, {
      ...(source.kind === 'test' ? { testHost: new URL(source.url).hostname } : {}),
    });
    const list: CrawlList = {
      rows: picked.rows,
      matched: picked.matched,
      companiesMatched: picked.companiesMatched,
      companies: picked.companies.map(({ name, url, matches }) => ({ name, url, matches })),
      skipped: picked.skipped,
    };
    await deps.lists.choose(userId, crawlId, list, {
      finalUrl: reading.page.url,
      httpStatus: reading.page.status,
      contentType: reading.page.contentType,
      bytes: reading.page.body.byteLength,
      s3Key: key,
    });
    summary = {
      rows: list.rows,
      matched: list.matched,
      companies: list.companies.length,
      skipped: list.skipped,
    };
    logger.info('List read', { crawlId, format: reading.format, ...summary });
  }
  await advanceList(userId, crawlId, deps);
  return summary;
}
