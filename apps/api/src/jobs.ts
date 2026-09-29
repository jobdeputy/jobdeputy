import { documentClient, type Job, JobRepository } from '@jobdeputy/db';
import {
  callerFromEvent,
  createLogger,
  type HttpResponse,
  jobId as jobIdSchema,
  jobsPageQuery,
  json,
  problem,
  validationProblem,
} from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';

const logger = createLogger('api-jobs');

export interface JobsDeps {
  repo: Pick<JobRepository, 'list' | 'get'>;
}

function defaultDeps(): JobsDeps {
  const { JOBS_TABLE_NAME } = process.env;
  if (!JOBS_TABLE_NAME) throw new Error('JOBS_TABLE_NAME must be set');
  return { repo: new JobRepository(documentClient(), JOBS_TABLE_NAME) };
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

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

/** The caller's jobs (T07b). Read-only for now: the user's own changes come with the interface (T09). */
export async function route(event: Event, deps: JobsDeps): Promise<HttpResponse> {
  const requestId = event.requestContext.requestId;
  const caller = callerFromEvent(event);
  if (!caller) return problem(401, 'Unauthorized', { requestId });

  switch (event.routeKey) {
    case 'GET /me/jobs': {
      const query = jobsPageQuery.safeParse(event.queryStringParameters ?? {});
      if (!query.success) return validationProblem(query.error, requestId);
      const page = await deps.repo.list(caller.userId, query.data.limit, query.data.cursor);
      return json(200, {
        jobs: page.items.map(jobSummary),
        ...(page.next !== undefined ? { nextCursor: page.next } : {}),
      });
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
