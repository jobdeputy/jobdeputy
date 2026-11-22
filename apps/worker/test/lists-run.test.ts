import type { CompanyCrawl, Crawl, FinishOutcome, Source } from '@jobdeputy/db';
import { DEFAULT_CRAWL_LIMITS, LIST_CONCURRENCY } from '@jobdeputy/shared';
import { describe, expect, it, vi } from 'vitest';
import { FetchError, type FetchedPage } from '../src/fetch/fetcher.js';
import {
  advanceList,
  type ListRunDeps,
  listShare,
  listStats,
  mergeCandidates,
  runList,
} from '../src/lists/list-run.js';
import { LISTINGS_PATH } from '../src/lists/read-list.js';
import type { FitInputs } from '../src/relevance/fit.js';

const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const LIST = '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2D';
const RAW = 'https://raw.githubusercontent.com/acme/list/HEAD/';
const INPUTS: FitInputs = {
  profile: { roles: [], skills: [] },
  companyLimit: 3,
  expiryDays: 7,
  relevanceMaxJobs: 50,
  relevanceMinScore: 30,
};

/** `n` companies, each one role on its own Greenhouse board. */
const listings = (n: number) =>
  JSON.stringify(
    Array.from({ length: n }, (_, i) => ({
      company_name: `Co${i}`,
      title: 'Software Engineer',
      locations: ['Austin, TX'],
      url: `https://job-boards.greenhouse.io/co${i}/jobs/1`,
      // Newer first, so the companies rank Co0, Co1, …
      date_posted: 1000 - i,
    })),
  );

/**
 * The crawls and sources tables in memory, with the repositories' conditions: `queueCompany`
 * only from the position read and below the concurrency, a board claimed only when free (or
 * the ended crawl named), `finish` once.
 */
function setup(options: { companies?: number; aiSource?: Crawl['aiSource'] } = {}) {
  const crawls = new Map<string, Crawl>();
  const sources = new Map<string, Source>();
  crawls.set(LIST, {
    userId: USER,
    crawlId: LIST,
    type: 'crawl',
    sourceId: 'LS',
    url: 'https://github.com/acme/list',
    trigger: 'user',
    kind: 'list',
    listSource: { kind: 'github', owner: 'acme', repo: 'list' },
    aiSource: options.aiSource ?? 'platform',
    status: 'running',
    attempts: 1,
    ttl: 1,
    createdAt: 'c',
    updatedAt: 'u',
    schemaVersion: 1,
  });
  let ids = 0;
  const fetch = vi.fn(async (url: string): Promise<FetchedPage> => {
    if (url !== `${RAW}${LISTINGS_PATH}`) throw new FetchError('not_found', false);
    return {
      url,
      status: 200,
      contentType: 'text/plain',
      body: new TextEncoder().encode(listings(options.companies ?? 5)),
      redirects: [],
    };
  });
  const list = () => crawls.get(LIST) as Crawl;
  const finish = vi.fn(
    async (
      c: Pick<Crawl, 'crawlId'>,
      outcome: FinishOutcome,
      _audit: { name: string; summary: string },
    ) => {
      const crawl = crawls.get(c.crawlId) as Crawl;
      if (crawl.status !== 'running' && crawl.status !== 'queued') return false;
      Object.assign(crawl, outcome.status === 'succeeded' ? outcome : { status: 'failed' });
      return true;
    },
  );
  const deps = {
    lists: {
      choose: vi.fn(async (_u: string, _c: string, chosen, result) => {
        if (list().list || list().status !== 'running') return false;
        Object.assign(list(), { list: chosen, result, queuedCount: 0 });
        return true;
      }),
      queueCompany: vi.fn(async (read: Crawl, max: number, company: CompanyCrawl) => {
        const now = list();
        const running = now.runningIds?.size ?? 0;
        if (now.status !== 'running' || now.queuedCount !== read.queuedCount || running >= max) {
          return 'moved' as const;
        }
        const source = sources.get(company.sourceId);
        if (source?.activeCrawlId && source.activeCrawlId !== company.replacing)
          return 'busy' as const;
        sources.set(company.sourceId, { activeCrawlId: company.crawlId } as Source);
        crawls.set(company.crawlId, {
          crawlId: company.crawlId,
          parentCrawlId: LIST,
          status: 'queued',
          listShare: company.listShare,
          url: company.normalizedUrl,
        } as Crawl);
        now.queuedCount = (now.queuedCount ?? 0) + 1;
        now.runningIds = new Set([...(now.runningIds ?? []), company.crawlId]);
        now.childIds = [...(now.childIds ?? []), company.crawlId];
        return 'queued' as const;
      }),
      skipCompany: vi.fn(async (read: Crawl) => {
        const now = list();
        if (now.queuedCount !== read.queuedCount) return false;
        now.queuedCount = (now.queuedCount ?? 0) + 1;
        if (now.list) now.list.busy = (now.list.busy ?? 0) + 1;
        return true;
      }),
    },
    getCrawl: vi.fn(async (_u: string, id: string) =>
      crawls.has(id) ? structuredClone(crawls.get(id)) : undefined,
    ),
    getSource: vi.fn(async (_u: string, id: string) => sources.get(id)),
    finish,
    newListFetcher: () => fetch,
    storePage: vi.fn(async () => undefined),
    fitInputs: vi.fn(async () => INPUTS),
    limits: vi.fn(async () => DEFAULT_CRAWL_LIMITS),
    newId: () => `01J8ZQ4Y3N5W6X7Y8Z9A0B${String(1000 + ids++)}`,
  } satisfies ListRunDeps;

  /** A company crawl ends, as `finish` records it on the list (then the worker moves it on). */
  const end = (crawlId: string, status: 'succeeded' | 'failed', over: Partial<Crawl> = {}) => {
    Object.assign(crawls.get(crawlId) as Crawl, { status, ...over });
    const l = list();
    l.runningIds = new Set([...(l.runningIds ?? [])].filter((id) => id !== crawlId));
    if (l.runningIds.size === 0) delete l.runningIds;
    l.childrenEnded = (l.childrenEnded ?? 0) + 1;
    const source = [...sources.values()].find((s) => s.activeCrawlId === crawlId);
    if (source) delete source.activeCrawlId;
  };
  return { deps, crawls, sources, list, end, fetch, finish };
}

describe('runList (#50)', () => {
  it('reads the list, chooses its companies, and starts the first three company crawls', async () => {
    const { deps, list, fetch } = setup({ companies: 5 });
    const summary = await runList(list(), deps);
    expect(summary).toEqual({ rows: 5, matched: 5, companies: 5, skipped: 0 });
    expect(deps.storePage).toHaveBeenCalledWith(
      `derived/users/${USER}/crawls/${LIST}/page`,
      expect.objectContaining({ url: `${RAW}${LISTINGS_PATH}` }),
    );
    expect(list().list?.companies.map((c) => c.name)).toEqual(['Co0', 'Co1', 'Co2', 'Co3', 'Co4']);
    expect(list().list?.companies[0]?.url).toBe('https://job-boards.greenhouse.io/co0');
    expect(list().result).toMatchObject({ httpStatus: 200, contentType: 'text/plain' });
    expect(list().queuedCount).toBe(LIST_CONCURRENCY);
    expect(list().runningIds?.size).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('gives each company crawl an even share of the AI run (at least its shown jobs)', async () => {
    const { deps, list, crawls } = setup({ companies: 5 });
    await runList(list(), deps);
    const first = crawls.get(list().childIds?.[0] as string);
    expect(first).toMatchObject({ listShare: 10, parentCrawlId: LIST, status: 'queued' });
    expect(listShare(20, 50)).toBe(3);
    expect(listShare(5, 50)).toBe(10);
    expect(listShare(0, 50)).toBe(50);
    expect(listShare(40, 50)).toBe(3);
  });

  it('keeps its first choice when retried: the list is not read again', async () => {
    const { deps, list, fetch } = setup({ companies: 5 });
    await runList(list(), deps);
    expect(await runList(list(), deps)).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(list().queuedCount).toBe(3);
  });

  it('caps the companies at the admin setting', async () => {
    const { deps, list } = setup({ companies: 30 });
    await runList(list(), deps);
    expect(list().list?.companies).toHaveLength(DEFAULT_CRAWL_LIMITS.listCompanies);
  });

  it('ends at once, with nothing found, when no company can be crawled', async () => {
    const { deps, list, finish } = setup({ companies: 0 });
    // An empty array is not the format; one closed role is a list with nothing open.
    deps.newListFetcher = () =>
      vi.fn(async (url: string) => ({
        url,
        status: 200,
        contentType: 'text/plain',
        body: new TextEncoder().encode(
          JSON.stringify([
            { company_name: 'A', title: 'T', url: 'https://x.example', active: false },
          ]),
        ),
        redirects: [],
      }));
    await runList(list(), deps);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(list()).toMatchObject({
      status: 'succeeded',
      stats: { jobsFound: 0, companies: { succeeded: 0, failed: 0 } },
    });
    expect(list().candidates).toBeUndefined();
  });
});

describe('advanceList (#50)', () => {
  it('queues the next company as one ends, never more than three at once', async () => {
    const { deps, list, end } = setup({ companies: 5 });
    await runList(list(), deps);
    const [a] = list().childIds ?? [];
    await advanceList(USER, LIST, deps);
    expect(list().queuedCount).toBe(3);
    end(a as string, 'succeeded');
    await advanceList(USER, LIST, deps);
    expect(list().queuedCount).toBe(4);
    expect(list().runningIds?.size).toBe(3);
  });

  it('ends the list when the last company crawl ends: totals added up, candidates merged', async () => {
    const { deps, list, end, finish } = setup({ companies: 4 });
    await runList(list(), deps);
    const stats = (found: number) => ({
      jobsFound: found,
      jobsNew: found,
      jobsUpdated: 0,
      jobsRelevant: 2,
    });
    const [a, b, c] = list().childIds as string[];
    end(a as string, 'succeeded', { stats: stats(5), candidates: ['a1', 'a2'] });
    await advanceList(USER, LIST, deps);
    const d = list().childIds?.[3] as string;
    end(b as string, 'failed');
    end(c as string, 'succeeded', { stats: stats(1), candidates: ['c1'] });
    await advanceList(USER, LIST, deps);
    expect(finish).not.toHaveBeenCalled();
    end(d, 'succeeded', { stats: stats(2), candidates: ['d1', 'd2', 'd3'] });
    await advanceList(USER, LIST, deps);
    await advanceList(USER, LIST, deps);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(list()).toMatchObject({
      status: 'succeeded',
      stats: {
        jobsFound: 8,
        jobsNew: 8,
        jobsUpdated: 0,
        jobsRelevant: 6,
        companies: { succeeded: 3, failed: 1 },
      },
      candidates: ['a1', 'c1', 'd1', 'a2', 'd2', 'd3'],
    });
    const audit = finish.mock.calls[0]?.[2];
    expect(audit?.name).toBe('crawl.succeeded');
    expect(audit?.summary).toBe('List run succeeded: acme/list, 3 companies, 8 jobs');
  });

  it('hands no candidates on when the list runs without AI', async () => {
    const { deps, list, end } = setup({ companies: 1, aiSource: 'none' });
    await runList(list(), deps);
    end(list().childIds?.[0] as string, 'succeeded', { candidates: ['a1'] });
    await advanceList(USER, LIST, deps);
    expect(list().status).toBe('succeeded');
    expect(list().candidates).toBeUndefined();
  });

  it('passes over a board with a crawl in progress, and takes over one whose crawl has ended', async () => {
    const { deps, list, crawls, sources } = setup({ companies: 3 });
    const { sourceIdFor } = await import('@jobdeputy/db');
    const busy = sourceIdFor('https://job-boards.greenhouse.io/co0');
    const free = sourceIdFor('https://job-boards.greenhouse.io/co1');
    sources.set(busy, { activeCrawlId: 'RUNNING' } as Source);
    crawls.set('RUNNING', { crawlId: 'RUNNING', status: 'running' } as Crawl);
    sources.set(free, { activeCrawlId: 'DONE' } as Source);
    crawls.set('DONE', { crawlId: 'DONE', status: 'succeeded' } as Crawl);
    await runList(list(), deps);
    expect(list().list?.busy).toBe(1);
    expect(list().queuedCount).toBe(3);
    expect(list().childIds).toHaveLength(2);
    expect(sources.get(free)?.activeCrawlId).toBe(list().childIds?.[0]);
  });

  it('does nothing for a list that ended (stale) or is not a list', async () => {
    const { deps, list, end } = setup({ companies: 4 });
    await runList(list(), deps);
    list().status = 'failed';
    end(list().childIds?.[0] as string, 'succeeded');
    await advanceList(USER, LIST, deps);
    expect(list().queuedCount).toBe(3);
    await advanceList(USER, 'MISSING', deps);
    expect(deps.lists.queueCompany).toHaveBeenCalledTimes(3);
  });

  it('reads the list again when another worker moved it on first', async () => {
    const { deps, list, end } = setup({ companies: 5 });
    await runList(list(), deps);
    end(list().childIds?.[0] as string, 'succeeded');
    end(list().childIds?.[1] as string, 'succeeded');
    // Both ends move the list on at once: each queues one, and neither twice.
    await Promise.all([advanceList(USER, LIST, deps), advanceList(USER, LIST, deps)]);
    expect(list().queuedCount).toBe(5);
    expect(new Set(list().childIds).size).toBe(5);
    expect(list().runningIds?.size).toBe(3);
  });
});

describe('list totals (#50)', () => {
  it("merges each company's best first, in the list's order, up to the maximum, once each", () => {
    expect(mergeCandidates([['a1', 'a2', 'a3'], [], ['c1', 'a1'], ['d1']], 4)).toEqual([
      'a1',
      'c1',
      'd1',
      'a2',
    ]);
    expect(mergeCandidates([], 50)).toEqual([]);
  });

  it('adds up succeeded crawls only, and counts the failed', () => {
    expect(
      listStats([
        {
          status: 'succeeded',
          stats: { jobsFound: 2, jobsNew: 1, jobsUpdated: 1, pagesFetched: 3 },
        },
        { status: 'failed', stats: { jobsFound: 9, jobsNew: 9, jobsUpdated: 0 } },
        { status: 'running' },
      ] as Crawl[]),
    ).toEqual({
      jobsFound: 2,
      jobsNew: 1,
      jobsUpdated: 1,
      pagesFetched: 3,
      companies: { succeeded: 1, failed: 1 },
    });
  });
});
