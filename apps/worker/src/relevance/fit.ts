import type { JobPosting, ShownJobs } from '@jobdeputy/db';
import { ShownConflictError } from '@jobdeputy/db';
import { type FilterProfile, filterJob } from './code-filter.js';
import { applyCompanyLimit, type RankedJob } from './company-limit.js';

/** What the crawl needs to decide which jobs to show (read once per crawl). */
export interface FitInputs {
  profile: FilterProfile;
  /** Jobs shown per company (the user's own limit, or the admin default). */
  companyLimit: number;
  /** Days before a hidden job is deleted. */
  expiryDays: number;
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
      for (let attempt = 1; ; attempt++) {
        const current = await store.get(userId, companyKey);
        const result = applyCompanyLimit(current.shown, read, candidates, inputs.companyLimit);
        try {
          await store.put(userId, companyKey, result.shown, current.version);
        } catch (error) {
          if (error instanceof ShownConflictError && attempt < SHOWN_ATTEMPTS) continue;
          throw error;
        }
        for (const id of result.counted) limitState.set(id, 'counted');
        for (const id of result.overLimit) limitState.set(id, 'over_limit');
        pushedOut.push(...result.pushedOut);
        break;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(COMPANY_CONCURRENCY, companies.length) }, lane));

  let relevant = 0;
  let overLimit = 0;
  const fitted = jobs.map((job) => {
    const filter = filters.get(job.jobId) as NonNullable<ReturnType<typeof filters.get>>;
    const state = limitState.get(job.jobId);
    if (filter.state === 'candidate') relevant += 1;
    if (state === 'over_limit') overLimit += 1;
    return { ...job, fit: { filter, ...(state ? { limitState: state } : {}) } };
  });
  return { jobs: fitted, pushedOut, relevant, overLimit };
}
