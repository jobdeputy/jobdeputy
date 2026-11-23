import {
  CompanyLimitRepository,
  CrawlSettingsRepository,
  documentClient,
  isHidden,
  type Job,
  JobRepository,
  type JobSummaryItem,
  ssmCrawlLimits,
} from '@jobdeputy/db';
import {
  type CrawlLimitsConfig,
  callerFromEvent,
  companiesPageQuery,
  compareRank,
  createLogger,
  type HttpResponse,
  jobId as jobIdSchema,
  jobsPageQuery,
  json,
  problem,
  type RankedJob,
  rankedJobSchema,
  rankShown,
  toRankedJob,
  validationProblem,
} from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import { companyJobsLimit } from './company-jobs-limit.js';

const logger = createLogger('api-jobs');

export interface JobsDeps {
  repo: Pick<JobRepository, 'list' | 'get' | 'getSummaries'>;
  /** #49: each company's shown jobs (`usage` `COMPANY#` items), read-only. */
  companies: Pick<CompanyLimitRepository, 'listShown'>;
  /** #49: the admin's limits (jobs shown per company), and the user's own choice. */
  limits: () => Promise<CrawlLimitsConfig>;
  settings: Pick<CrawlSettingsRepository, 'get'>;
}

function defaultDeps(): JobsDeps {
  const { JOBS_TABLE_NAME, USAGE_TABLE_NAME, PREFERENCES_TABLE_NAME, CRAWL_LIMITS_PARAMETER } =
    process.env;
  if (!JOBS_TABLE_NAME || !USAGE_TABLE_NAME || !PREFERENCES_TABLE_NAME || !CRAWL_LIMITS_PARAMETER) {
    throw new Error(
      'JOBS_TABLE_NAME, USAGE_TABLE_NAME, PREFERENCES_TABLE_NAME and CRAWL_LIMITS_PARAMETER must be set',
    );
  }
  const client = documentClient();
  return {
    repo: new JobRepository(client, JOBS_TABLE_NAME),
    companies: new CompanyLimitRepository(client, USAGE_TABLE_NAME),
    limits: ssmCrawlLimits(CRAWL_LIMITS_PARAMETER),
    settings: new CrawlSettingsRepository(client, PREFERENCES_TABLE_NAME),
  };
}

/** What a list shows: everything but the description (which can be long) and internal fields. */
export function jobSummary(j: JobSummaryItem) {
  return {
    jobId: j.jobId,
    title: j.title,
    ...(j.companyName ? { companyName: j.companyName } : {}),
    companyKey: j.companyKey,
    locations: j.locations,
    ...(j.workplace ? { workplace: j.workplace } : {}),
    ...(j.employmentType ? { employmentType: j.employmentType } : {}),
    ...(j.salary ? { salary: j.salary } : {}),
    jobUrl: j.jobUrl,
    ...(j.applyUrl ? { applyUrl: j.applyUrl } : {}),
    ...(j.ats ? { ats: j.ats } : {}),
    ...(j.postedAt ? { postedAt: j.postedAt } : {}),
    hasDescription: j.description !== undefined || j.descriptionHash !== undefined,
    firstSeenAt: j.firstSeenAt,
    lastSeenAt: j.lastSeenAt,
    ...(j.closedAt ? { closedAt: j.closedAt } : {}),
    status: j.status,
    starred: j.starred,
    // T08c: whether it is shown, and why it was kept or dropped (absent before its first filter).
    ...(j.filter
      ? {
          fit: {
            state: j.filter.state,
            roleIds: j.filter.roleIds,
            reasons: j.filter.reasons,
            ...(j.limitState ? { limitState: j.limitState } : {}),
          },
        }
      : {}),
    // T08d: the LLM's score and why (absent until it has scored the job).
    ...(j.relevance
      ? {
          relevance: {
            score: j.relevance.score,
            ...(j.relevance.bestRoleId ? { bestRoleId: j.relevance.bestRoleId } : {}),
            reasons: j.relevance.reasons,
            scoredAt: j.relevance.scoredAt,
          },
        }
      : {}),
    hidden: isHidden(j),
    ...(j.ttl !== undefined ? { expiresAt: new Date(j.ttl * 1000).toISOString() } : {}),
  };
}

/** One job in full. Descriptions are plain text; clients must still render them as text. */
export function jobView(j: Job) {
  return {
    ...jobSummary(j),
    ...(j.externalId ? { externalId: j.externalId } : {}),
    ...(j.description !== undefined
      ? { description: j.description, descriptionTruncated: j.descriptionTruncated === true }
      : {}),
    sourceIds: [...(j.sourceIds ?? [])].sort(),
    firstCrawlId: j.firstCrawlId,
    lastCrawlId: j.lastCrawlId,
    ...(j.notes !== undefined ? { notes: j.notes } : {}),
  };
}

const encodeCursor = (best: RankedJob): string =>
  Buffer.from(JSON.stringify(best)).toString('base64url');

function decodeCursor(cursor: string): unknown {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    return undefined;
  }
}

/**
 * At most this many slices of companies are read to fill one page when jobs hidden or closed
 * since leave companies empty; past it, the page is short and has a next one.
 */
export const COMPANY_PAGE_READS = 3;

/**
 * #49: the caller's companies, the one with the best job first, each with its shown jobs ranked
 * as the crawl ranked them, at most the user's per-company limit now (a lower limit than the one a
 * company was last ranked under applies at once, not only from its next crawl). Read from the
 * companies' `COMPANY#` items (all of them, a few bytes each: the ranking is in memory), then the
 * page's job summaries in a batch. Jobs hidden or closed since are left out; a company left with
 * none is skipped and the next one read in its place (at most `COMPANY_PAGE_READS` slices).
 *
 * The cursor is the last company's best job. A crawl that re-ranks companies between two pages
 * can move one across it, so a later page can repeat or miss a company: clients drop repeats and
 * read from the start again when a crawl finishes.
 */
async function companiesPage(
  userId: string,
  limit: number,
  after: RankedJob | undefined,
  deps: JobsDeps,
) {
  const [shown, perCompany] = await Promise.all([
    deps.companies.listShown(userId),
    companyJobsLimitFor(userId, deps),
  ]);
  const ranked = shown
    .map((c) => {
      const jobs = rankShown(c.shown);
      return { companyKey: c.companyKey, jobs, best: jobs[0] as RankedJob };
    })
    .sort((a, b) => compareRank(a.best, b.best));
  let rest = after ? ranked.filter((c) => compareRank(after, c.best) < 0) : ranked;
  const companies: CompanyView[] = [];
  let last: RankedJob | undefined;
  for (let read = 0; read < COMPANY_PAGE_READS && companies.length < limit && rest.length; read++) {
    const slice = rest.slice(0, limit - companies.length);
    rest = rest.slice(slice.length);
    const found = new Map(
      (
        await deps.repo.getSummaries(
          userId,
          slice.flatMap((c) => c.jobs.map((j) => j.jobId)),
        )
      ).map((j) => [j.jobId, j]),
    );
    for (const c of slice) {
      last = c.best;
      const jobs = c.jobs
        .map((r) => found.get(r.jobId))
        .filter((j): j is JobSummaryItem => j !== undefined && j.closedAt === undefined)
        .map(jobSummary)
        .filter((j) => !j.hidden)
        .slice(0, perCompany);
      if (jobs.length === 0) continue;
      const companyName = jobs.find((j) => j.companyName)?.companyName;
      companies.push({ companyKey: c.companyKey, ...(companyName ? { companyName } : {}), jobs });
    }
  }
  return {
    companies,
    ...(rest.length > 0 && last ? { nextCursor: encodeCursor(last) } : {}),
  };
}

type CompanyView = {
  companyKey: string;
  companyName?: string;
  jobs: ReturnType<typeof jobSummary>[];
};

/** The jobs shown per company for this user now (company-jobs-limit.ts). */
const companyJobsLimitFor = (userId: string, deps: JobsDeps) => companyJobsLimit(deps)(userId);

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

/**
 * The caller's jobs (T07b). Read-only for now: the user's own changes come with the
 * interface (T09). T08c: the list shows only jobs not hidden by the filter or the
 * company limit, unless `view=all`; a page can then be short and still have a next one.
 */
export async function route(event: Event, deps: JobsDeps): Promise<HttpResponse> {
  const requestId = event.requestContext.requestId;
  const caller = callerFromEvent(event);
  if (!caller) return problem(401, 'Unauthorized', { requestId });

  switch (event.routeKey) {
    case 'GET /me/jobs': {
      const query = jobsPageQuery.safeParse(event.queryStringParameters ?? {});
      if (!query.success) return validationProblem(query.error, requestId);
      const { limit, cursor, view } = query.data;
      const page = await deps.repo.list(caller.userId, limit, cursor, view);
      return json(200, {
        jobs: page.items.map(jobSummary),
        ...(page.next !== undefined ? { nextCursor: page.next } : {}),
      });
    }
    case 'GET /me/companies': {
      const query = companiesPageQuery.safeParse(event.queryStringParameters ?? {});
      if (!query.success) return validationProblem(query.error, requestId);
      const { limit, cursor } = query.data;
      let after: RankedJob | undefined;
      if (cursor !== undefined) {
        const decoded = rankedJobSchema.safeParse(decodeCursor(cursor));
        if (!decoded.success) return validationProblem(decoded.error, requestId);
        after = toRankedJob(decoded.data);
      }
      return json(200, await companiesPage(caller.userId, limit, after, deps));
    }
    case 'GET /me/jobs/{jobId}': {
      const id = jobIdSchema.safeParse(event.pathParameters?.jobId);
      if (!id.success) return validationProblem(id.error, requestId);
      const job = await deps.repo.get(caller.userId, id.data);
      if (!job) return problem(404, 'Not found', { requestId });
      return json(200, jobView(job));
    }
    default:
      return problem(404, 'Not found', { requestId });
  }
}

let deps: JobsDeps | undefined;

export async function handler(event: Event, context: Context): Promise<HttpResponse> {
  logger.addContext(context);
  try {
    deps ??= defaultDeps();
    return await route(event, deps);
  } catch (error) {
    logger.error('Unhandled error', { error: error as Error });
    return problem(500, 'Internal error', { requestId: event.requestContext.requestId });
  }
}
