import { CompanyLimitRepository, documentClient, type Job, JobRepository } from '@jobdeputy/db';
import {
  callerFromEvent,
  companiesCursor,
  companiesPageQuery,
  compareRank,
  createLogger,
  type HttpResponse,
  jobId as jobIdSchema,
  jobsPageQuery,
  json,
  problem,
  type RankedJob,
  validationProblem,
} from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';

const logger = createLogger('api-jobs');

export interface JobsDeps {
  repo: Pick<JobRepository, 'list' | 'get' | 'getMany'>;
  /** #49: each company's shown jobs (`usage` `COMPANY#` items), read-only. */
  companies: Pick<CompanyLimitRepository, 'listShown'>;
}

function defaultDeps(): JobsDeps {
  const { JOBS_TABLE_NAME, USAGE_TABLE_NAME } = process.env;
  if (!JOBS_TABLE_NAME) throw new Error('JOBS_TABLE_NAME must be set');
  if (!USAGE_TABLE_NAME) throw new Error('USAGE_TABLE_NAME must be set');
  const client = documentClient();
  return {
    repo: new JobRepository(client, JOBS_TABLE_NAME),
    companies: new CompanyLimitRepository(client, USAGE_TABLE_NAME),
  };
}

/** What a list shows: everything but the description (which can be long) and internal fields. */
export function jobSummary(j: Job) {
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
    hasDescription: j.description !== undefined,
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
    hidden: j.filter?.state === 'not_relevant' || j.limitState === 'over_limit',
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
 * #49: the caller's companies, the one with the best job first, each with its shown jobs
 * (at most the per-company limit) ranked as the crawl ranked them. Read from the companies'
 * `COMPANY#` items, then one batch read of the page's jobs. Jobs hidden or closed since are
 * left out, so a page can be short and still have a next one.
 */
async function companiesPage(
  userId: string,
  limit: number,
  after: RankedJob | undefined,
  deps: JobsDeps,
) {
  const ranked = (await deps.companies.listShown(userId))
    .map((c) => {
      const jobs = Object.entries(c.shown)
        .map(([jobId, entry]) => ({ jobId, ...entry }))
        .sort(compareRank);
      return { companyKey: c.companyKey, jobs, best: jobs[0] as RankedJob };
    })
    .sort((a, b) => compareRank(a.best, b.best));
  const rest = after ? ranked.filter((c) => compareRank(after, c.best) < 0) : ranked;
  const page = rest.slice(0, limit);
  const found = new Map(
    (
      await deps.repo.getMany(
        userId,
        page.flatMap((c) => c.jobs.map((j) => j.jobId)),
      )
    ).map((j) => [j.jobId, j]),
  );
  const companies = page.flatMap((c) => {
    const jobs = c.jobs
      .map((r) => found.get(r.jobId))
      .filter((j): j is Job => j !== undefined && j.closedAt === undefined)
      .map(jobSummary)
      .filter((j) => !j.hidden);
    if (jobs.length === 0) return [];
    const companyName = jobs.find((j) => j.companyName)?.companyName;
    return [{ companyKey: c.companyKey, ...(companyName ? { companyName } : {}), jobs }];
  });
  const last = page.at(-1);
  return {
    companies,
    ...(rest.length > limit && last ? { nextCursor: encodeCursor(last.best) } : {}),
  };
}

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
        const decoded = companiesCursor.safeParse(decodeCursor(cursor));
        if (!decoded.success) return validationProblem(decoded.error, requestId);
        const { jobId, p, t, s } = decoded.data;
        after = { jobId, p, ...(t !== undefined ? { t } : {}), ...(s !== undefined ? { s } : {}) };
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
