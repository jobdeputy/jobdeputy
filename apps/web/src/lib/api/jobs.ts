import { JOB_STAGES, type JobStage } from '@jobdeputy/shared/applications';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { type ApiClient, ApiError, useApi } from './index.ts';

/** #52: a job's stage, as the API has them (packages/shared `JOB_STAGES`). */
export type { JobStage };

export type AppliedStage = Exclude<JobStage, 'new'>;

/** The stages Applications shows and sets (#52, locked): every one but `new`, in the API's order. */
export const APPLIED_STAGES = JOB_STAGES.filter((stage): stage is AppliedStage => stage !== 'new');

/**
 * A job as a list gives it (`GET /me/matches`; apps/api/src/jobs.ts `jobSummary`, the parts the
 * screens use). `relevance` is the AI's score (0–100) and its reasons, absent until it has scored
 * the job. `status` is its stage (#52): Matches lists `new` jobs only.
 */
export interface JobSummary {
  jobId: string;
  title: string;
  companyName?: string;
  companyKey: string;
  locations: { text: string }[];
  workplace?: string;
  employmentType?: string;
  jobUrl: string;
  applyUrl?: string;
  postedAt?: string;
  firstSeenAt: string;
  status?: JobStage;
  /** When it was marked applied, and when its stage last changed (#52: applied jobs only). */
  appliedAt?: string;
  stageAt?: string;
  /** Whether the board shared the posting's text (read with the job itself). */
  hasDescription?: boolean;
  relevance?: { score: number; reasons: string[] };
  /**
   * #52 PR E: Matches only. The company had the most applications for now (`Matches.cooldown`):
   * applying there is refused until this time.
   */
  coolingDownUntil?: string;
  /**
   * #51 PR C: the company's tailored résumé's ATS match for this job, and the base résumé's
   * (null: no keyword that counts); absent until a version has scored it.
   */
  match?: { score: number | null; base: number | null; resumeDocumentId: string };
}

/**
 * How well a job fits (#49, agreed on the issue): from the AI's score, Strong 70+, Good 50–69,
 * Stretch 30–49 (below 30 is hidden by the server); `unscored` before the AI has scored it, or
 * when the crawl ran without AI.
 */
export type Fit = 'strong' | 'good' | 'stretch' | 'unscored';

export function fitOf(job: Pick<JobSummary, 'relevance'>): Fit {
  const score = job.relevance?.score;
  if (score === undefined) return 'unscored';
  if (score >= 70) return 'strong';
  if (score >= 50) return 'good';
  return 'stretch';
}

/**
 * One job in full (`GET /me/jobs/{jobId}`, apps/api/src/jobs.ts `jobView`): the summary, and the
 * posting's own description as plain text (rendered as text, never as markup), cut at 32,000
 * characters (`descriptionTruncated`). Absent when the board shared none.
 */
export interface Job extends JobSummary {
  /** The board's own ID for the posting (#54 PR D: Auto apply builds a Greenhouse form from it). */
  externalId?: string;
  description?: string;
  descriptionTruncated?: boolean;
}

/** The job open in the preview, read when it opens (its description is long, so lists leave it out). */
export function useJob(jobId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ['jobs', jobId],
    queryFn: () => api.request<Job>('GET', `/me/jobs/${jobId}`),
    enabled: jobId !== null,
    // A posting doesn't change while it is looked at: going back to a job doesn't read it again.
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: (failures, error) =>
      failures < 1 && error instanceof ApiError && error.kind === 'offline',
  });
}

/** A company's name as people say it: its own, else its board's slug ("greenhouse:acme" → "acme"). */
export function companyName(company: Pick<JobSummary, 'companyKey' | 'companyName'>): string {
  return company.companyName ?? company.companyKey.split(':').pop() ?? company.companyKey;
}

/** `GET /me/matches` (#52): every shown, not-applied job, best first; `truncated` past 500. */
export interface Matches {
  jobs: JobSummary[];
  truncated: boolean;
  /** #52 PR E: the cooldown rule, `limit` applications to one company in `days` rolling days. */
  cooldown?: Cooldown;
}

export interface Cooldown {
  limit: number;
  days: number;
}

/** The Matches query's key, before what it reflects (the newest ended crawl). */
export const matchesKey = ['matches'] as const;

/**
 * The jobs in Matches (#52), all at once (the table sorts them in the browser). `version` names
 * what they reflect (the newest crawl whose work ended, `useListVersion`): a new one reads them
 * again, showing the ones before meanwhile (no blank skeleton). Undefined while that isn't known
 * yet: nothing is read, so they are never read just before a crawl is seen as ended.
 */
export function useMatches(version: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...matchesKey, version ?? ''],
    queryFn: () => api.request<Matches>('GET', '/me/matches'),
    enabled: version !== undefined,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: (failures, error) =>
      failures < 1 && error instanceof ApiError && error.kind === 'offline',
  });
}

/**
 * `PUT /me/jobs/{jobId}/stage` (#52): moves a job from the stage the user saw (`from`) to
 * `stage`. A job changed meanwhile (another tab or device) is refused: `conflict`.
 */
export function setStage(api: ApiClient, jobId: string, stage: JobStage, from: JobStage) {
  return api.request<JobSummary>('PUT', `/me/jobs/${jobId}/stage`, { stage, from });
}

/** #52 PR E: applying was refused because the company cools down (409 `cooling-down`). */
export function coolingDown(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'conflict' && error.code === 'cooling-down';
}

/**
 * Whether a stage change was refused because the job is not at the stage seen any more (409
 * `stage-changed`: moved on in another tab or device) or is gone (404). Another 409 (a write
 * that collided, `try-again`) changed nothing: it can be tried again.
 */
export function stageGone(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.kind === 'not-found' || (error.kind === 'conflict' && error.code === 'stage-changed'))
  );
}

/** `GET /me/applications` (#52): a page of applied jobs, newest applied first. */
interface ApplicationsPage {
  jobs: JobSummary[];
  nextCursor?: string;
}

export const applicationsKey = ['applications'] as const;

/** Applied jobs read at a time: the API's most. */
export const APPLICATIONS_PAGE = 50;

/**
 * The jobs in Applications (#52): every job applied to, newest applied first, a page (50, the
 * API's most) at a time. Read again each time the tab opens (a job applied to in Matches joins).
 */
export function useApplications(pageSize: number = APPLICATIONS_PAGE) {
  const api = useApi();
  return useInfiniteQuery({
    // Its page size in the key (a test's small pages never mix with the real ones).
    queryKey: [...applicationsKey, pageSize],
    queryFn: ({ pageParam }) =>
      api.request<ApplicationsPage>(
        'GET',
        `/me/applications?limit=${pageSize}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: '',
    // An empty cursor is the end too (else page 1 would be read again and again).
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchOnWindowFocus: false,
    retry: (failures, error) =>
      failures < 1 && error instanceof ApiError && error.kind === 'offline',
    select: (data) => data.pages.flatMap((page) => page.jobs),
  });
}
