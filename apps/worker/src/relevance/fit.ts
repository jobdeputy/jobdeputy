import type {
  CrawlSettingsRepository,
  JobPosting,
  PreferencesRepository,
  ProfileRepository,
  ShownJobs,
} from '@jobdeputy/db';
import { ShownConflictError } from '@jobdeputy/db';
import { type CrawlLimitsConfig, effectiveCompanyJobsLimit } from '@jobdeputy/shared';
import { type FilterProfile, filterJob } from './code-filter.js';
import {
  applyCompanyLimit,
  compareRank,
  type LimitResult,
  type RankedJob,
} from './company-limit.js';

/** What the crawl needs to decide which jobs to show (read once per crawl). */
export interface FitInputs {
  profile: FilterProfile;
  /** Jobs shown per company (the user's own limit, or the admin default). */
  companyLimit: number;
  /** Days before a hidden job is deleted. */
  expiryDays: number;
  /** T08d: candidates the LLM scores per crawl. */
  relevanceMaxJobs: number;
  /** T08d: a score below this hides the job. */
  relevanceMinScore: number;
}

/** Reads what the filter and the ranking need: active roles, search, profile, limits. */
export function fitInputsLoader(repos: {
  preferences: Pick<PreferencesRepository, 'listRoles' | 'getSearch'>;
  profiles: Pick<ProfileRepository, 'get'>;
  crawlSettings: Pick<CrawlSettingsRepository, 'get'>;
  limits: () => Promise<CrawlLimitsConfig>;
}): (userId: string) => Promise<FitInputs> {
  return async (userId) => {
    const [roles, search, profile, settings, config] = await Promise.all([
      repos.preferences.listRoles(userId),
      repos.preferences.getSearch(userId),
      repos.profiles.get(userId),
      repos.crawlSettings.get(userId),
      repos.limits(),
    ]);
    return {
      profile: {
        roles: roles.filter((r) => r.active),
        ...(search ? { search } : {}),
        ...(profile?.headline ? { headline: profile.headline } : {}),
        skills: profile?.skills ?? [],
      },
      companyLimit: effectiveCompanyJobsLimit(config, settings?.companyJobsLimit),
      expiryDays: config.jobExpiryDays,
      relevanceMaxJobs: config.relevanceMaxJobs,
      relevanceMinScore: config.relevanceMinScore,
    };
  };
}

export interface ShownStore {
  get(userId: string, companyKey: string): Promise<ShownJobs>;
  put(
    userId: string,
    companyKey: string,
    shown: ShownJobs['shown'],
    expectedVersion: number,
  ): Promise<void>;
}

export interface FitResult {
  jobs: JobPosting[];
  /** Jobs other pages listed that this crawl pushed out of their company's shown list. */
  pushedOut: string[];
  relevant: number;
  overLimit: number;
  /** T08d: this crawl's candidates, best first: shown ones, then the rest. */
  ranked: string[];
}

/** Companies ranked at the same time (each is a read and a write). */
export const COMPANY_CONCURRENCY = 10;
/** Another crawl changed the company's list meanwhile: read it again, at most this often. */
export const SHOWN_ATTEMPTS = 4;

/**
 * T08c: filters each job, then ranks each company's candidates against what is already
 * shown for it. Returns the jobs with their `fit`, ready to save.
 */
export async function fitJobs(
  userId: string,
  jobs: JobPosting[],
  inputs: FitInputs,
  store: ShownStore,
): Promise<FitResult> {
  const filters = new Map(jobs.map((j) => [j.jobId, filterJob(j, inputs.profile)]));
  const byCompany = new Map<string, JobPosting[]>();
  for (const job of jobs) {
    const list = byCompany.get(job.companyKey) ?? [];
    list.push(job);
    byCompany.set(job.companyKey, list);
  }

  const limitState = new Map<string, 'counted' | 'over_limit'>();
  const pushedOut: string[] = [];
  const companies = [...byCompany.entries()];
  let next = 0;
  const lane = async () => {
    while (next < companies.length) {
      const [companyKey, companyJobs] = companies[next++] as [string, JobPosting[]];
      const read = new Set(companyJobs.map((j) => j.jobId));
      const candidates: RankedJob[] = companyJobs.flatMap((j) => {
        const f = filters.get(j.jobId);
        if (f?.state !== 'candidate') return [];
        return [{ jobId: j.jobId, p: f.priority, ...(j.postedAt ? { t: j.postedAt } : {}) }];
      });
      const result = await rankCompany(
        store,
        userId,
        companyKey,
        read,
        candidates,
        inputs.companyLimit,
      );
      for (const id of result.counted) limitState.set(id, 'counted');
      for (const id of result.overLimit) limitState.set(id, 'over_limit');
      pushedOut.push(...result.pushedOut);
    }
  };
  await Promise.all(Array.from({ length: Math.min(COMPANY_CONCURRENCY, companies.length) }, lane));

  let relevant = 0;
  let overLimit = 0;
  const ranked: (RankedJob & { shown: boolean })[] = [];
  const fitted = jobs.map((job) => {
    const filter = filters.get(job.jobId) as NonNullable<ReturnType<typeof filters.get>>;
    const state = limitState.get(job.jobId);
    if (filter.state === 'candidate') {
      relevant += 1;
      ranked.push({
        jobId: job.jobId,
        p: filter.priority,
        ...(job.postedAt ? { t: job.postedAt } : {}),
        shown: state === 'counted',
      });
    }
    if (state === 'over_limit') overLimit += 1;
    return { ...job, fit: { filter, ...(state ? { limitState: state } : {}) } };
  });
  ranked.sort((a, b) => (a.shown !== b.shown ? (a.shown ? -1 : 1) : compareRank(a, b)));
  return { jobs: fitted, pushedOut, relevant, overLimit, ranked: ranked.map((j) => j.jobId) };
}

/**
 * Ranks one company's jobs and saves its shown list, reading it again when another crawl
 * or scoring run changed it meanwhile (at most SHOWN_ATTEMPTS times).
 */
export async function rankCompany(
  store: ShownStore,
  userId: string,
  companyKey: string,
  read: Set<string>,
  candidates: RankedJob[],
  limit: number,
): Promise<LimitResult> {
  for (let attempt = 1; ; attempt++) {
    const current = await store.get(userId, companyKey);
    const result = applyCompanyLimit(current.shown, read, candidates, limit);
    try {
      await store.put(userId, companyKey, result.shown, current.version);
      return result;
    } catch (error) {
      if (error instanceof ShownConflictError && attempt < SHOWN_ATTEMPTS) continue;
      throw error;
    }
  }
}
