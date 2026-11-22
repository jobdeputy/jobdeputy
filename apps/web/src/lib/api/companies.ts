import { type InfiniteData, keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { type ApiClient, ApiError, useApi } from './index.ts';

/**
 * A job as `GET /me/companies` lists it (apps/api/src/jobs.ts `jobSummary`, the parts the screens
 * use). `relevance` is the AI's score (0–100) and its reasons, absent until it has scored the job.
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
  /** Whether the board shared the posting's text (read with the job itself). */
  hasDescription?: boolean;
  relevance?: { score: number; reasons: string[] };
}

/** A company and its best jobs, ranked (at most the person's jobs per company). */
export interface Company {
  companyKey: string;
  companyName?: string;
  jobs: JobSummary[];
}

interface CompaniesPage {
  companies: Company[];
  nextCursor?: string;
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

/** The page size asked for: the API's most. */
export const COMPANIES_PAGE = 10;

/** The companies' query key, before the list's version (the newest ended crawl). */
export const companiesKey = ['companies'] as const;

export function companiesQuery(api: ApiClient, version: string) {
  return {
    queryKey: [...companiesKey, version],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.request<CompaniesPage>(
        'GET',
        `/me/companies?limit=${COMPANIES_PAGE}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last: CompaniesPage) => last.nextCursor,
  };
}

/**
 * The pages as one list. A crawl that re-ranks between two pages can move a company across the
 * cursor, so a company seen on an earlier page is not listed again.
 */
function onePerCompany(data: InfiniteData<CompaniesPage>): Company[] {
  const seen = new Set<string>();
  const companies: Company[] = [];
  for (const page of data.pages) {
    for (const company of page.companies) {
      if (seen.has(company.companyKey)) continue;
      seen.add(company.companyKey);
      companies.push(company);
    }
  }
  return companies;
}

/**
 * The person's companies, the one with the best job first, a page at a time (More companies).
 * `version` names what the list reflects (the newest crawl whose work ended, and how it ended,
 * from the Jobs page): a new one reads the list again from the first page, showing the one before
 * meanwhile (no blank skeleton). Undefined while that isn't known yet: nothing is read, so the
 * list is never read before a crawl that is about to be seen as ended.
 */
export function useCompanies(version: string | undefined) {
  const api = useApi();
  return useInfiniteQuery({
    ...companiesQuery(api, version ?? ''),
    enabled: version !== undefined,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: (failures, error) =>
      failures < 1 && error instanceof ApiError && error.kind === 'offline',
    select: onePerCompany,
  });
}

/** A company's name as people say it: its own, else its board's slug ("greenhouse:acme" → "acme"). */
export function companyName(company: Pick<Company, 'companyKey' | 'companyName'>): string {
  return company.companyName ?? company.companyKey.split(':').pop() ?? company.companyKey;
}
