import {
  AccountRepository,
  type AppliedCursor,
  CompanyApplicationsRepository,
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
  applicationsCursor,
  applicationsPageQuery,
  type CrawlLimitsConfig,
  callerFromEvent,
  companiesPageQuery,
  compareRank,
  cooldownUntil,
  createLogger,
  type HttpResponse,
  jobId as jobIdSchema,
  jobStageBody,
  jobsPageQuery,
  json,
  MATCH_SCORE_VERSION,
  MATCHES_MAX,
  MATCHES_WINDOW_DAYS,
  parseJsonBody,
  problem,
  type RankedJob,
  rankedJobSchema,
  rankShown,
  toRankedJob,
  validationProblem,
} from '@jobdeputy/shared';
import { EXTENSION_STAGE_CHANGE } from '@jobdeputy/shared/extension';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import { ulid } from 'ulid';
import { refuseWritesWhileDeleting } from './account-guard.js';
import { type UserAudit, userAudit } from './audited.js';
import { companyJobsLimit } from './company-jobs-limit.js';
import { concurrentUpdateProblem } from './errors.js';

const logger = createLogger('api-jobs');

export interface JobsDeps {
  repo: Pick<JobRepository, 'list' | 'get' | 'getSummaries' | 'setStage' | 'listApplied'>;
  /** #49: each company's shown jobs (`usage` `COMPANY#` items), read-only. */
  companies: Pick<CompanyLimitRepository, 'listShown'>;
  /** #52 PR E: each company's applications in the last 365 days (`usage` `APPLIED#`). */
  applications: Pick<CompanyApplicationsRepository, 'list' | 'guard'>;
  /** #49: the admin's limits (jobs shown per company), and the user's own choice. */
  limits: () => Promise<CrawlLimitsConfig>;
  settings: Pick<CrawlSettingsRepository, 'get'>;
  /** #52: a stage change is the user's write: refused while their account is being deleted. */
  isBeingDeleted: (userId: string) => Promise<boolean>;
  audit: UserAudit;
  now: () => Date;
}

function defaultDeps(): JobsDeps {
  const {
    JOBS_TABLE_NAME,
    USAGE_TABLE_NAME,
    PREFERENCES_TABLE_NAME,
    CRAWL_LIMITS_PARAMETER,
    USERS_TABLE_NAME,
    AUDIT_TABLE_NAME,
  } = process.env;
  if (
    !JOBS_TABLE_NAME ||
    !USAGE_TABLE_NAME ||
    !PREFERENCES_TABLE_NAME ||
    !CRAWL_LIMITS_PARAMETER ||
    !USERS_TABLE_NAME ||
    !AUDIT_TABLE_NAME
  ) {
    throw new Error(
      'JOBS_TABLE_NAME, USAGE_TABLE_NAME, PREFERENCES_TABLE_NAME, CRAWL_LIMITS_PARAMETER, USERS_TABLE_NAME and AUDIT_TABLE_NAME must be set',
    );
  }
  const client = documentClient();
  const account = new AccountRepository(client, USERS_TABLE_NAME);
  return {
    isBeingDeleted: (userId) => account.isBeingDeleted(userId),
    audit: userAudit(AUDIT_TABLE_NAME, ulid),
    now: () => new Date(),
    repo: new JobRepository(client, JOBS_TABLE_NAME),
    companies: new CompanyLimitRepository(client, USAGE_TABLE_NAME),
    applications: new CompanyApplicationsRepository(client, USAGE_TABLE_NAME),
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
    ...(j.appliedAt ? { appliedAt: j.appliedAt } : {}),
    ...(j.stageAt ? { stageAt: j.stageAt } : {}),
    ...(j.appliedResumeId ? { appliedResumeId: j.appliedResumeId } : {}),
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
    // #51 PR C: the tailored résumé's score and the base one's, when made by today's score code
    // (scores from other code are never compared, MATCH_SCORE_VERSION).
    ...(j.match && j.match.version === MATCH_SCORE_VERSION
      ? {
          match: {
            score: j.match.score,
            base: j.match.base,
            resumeDocumentId: j.match.resumeDocumentId,
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

/**
 * #54 PR D (decision 0020): what an extension token sees of a job, enough for the confirmation
 * page's "Mark as applied?" (is it in the user's jobs, at stage New) and nothing else of it.
 */
export function extensionJobView(j: Job) {
  return {
    jobId: j.jobId,
    title: j.title,
    ...(j.companyName !== undefined ? { companyName: j.companyName } : {}),
    status: j.status,
    ...(j.stageAt !== undefined ? { stageAt: j.stageAt } : {}),
  };
}

const encodeCursor = (value: RankedJob | AppliedCursor): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

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

/** #52: when a job the user stops acting on (an undone apply) expires, if closed or hidden. */
async function expiresAt(deps: JobsDeps): Promise<number> {
  const { jobExpiryDays } = await deps.limits();
  return Math.floor(deps.now().getTime() / 1000) + jobExpiryDays * 86_400;
}

/** Job summaries read per batch while filling Matches (DynamoDB's BatchGetItem limit)… */
const MATCHES_READ = 100;
/** …and batches read at once. */
const MATCHES_PARALLEL = 4;

/**
 * #52: Matches, every job not applied to yet that is shown now and was seen in the last
 * `MATCHES_WINDOW_DAYS` days, best first (the crawl's rank: score, then role priority, then
 * newest), at most `MATCHES_MAX`. All rows come at once, so the browser can sort any column
 * over all of them. Each company's places are counted as `GET /me/companies` counts them
 * (open, shown jobs, at most the user's jobs per company), and a job applied to keeps its
 * place while its posting is open: it leaves a gap rather than letting the next job in. `truncated` says
 * more than `MATCHES_MAX` jobs qualified. #52 PR E: a company's jobs say `coolingDownUntil`
 * while it cools down (applying is refused until then), and `cooldown` is the rule.
 */
async function matches(userId: string, deps: JobsDeps) {
  const [shown, perCompany, applied, limits] = await Promise.all([
    deps.companies.listShown(userId),
    companyJobsLimitFor(userId, deps),
    deps.applications.list(userId),
    deps.limits(),
  ]);
  const now = deps.now();
  // As the stage change counts: a job's own entry (undone after a later stage) never counts
  // against applying to it again.
  const cooling = (job: JobSummaryItem) => {
    const byJob = applied.get(job.companyKey);
    if (!byJob) return undefined;
    const others = Object.entries(byJob).flatMap(([id, at]) => (id === job.jobId ? [] : [at]));
    return cooldownUntil(others, now, limits.applyCompanyLimit, limits.applyCooldownDays);
  };
  const companies = shown.map((c) => rankShown(c.shown));
  const ids = companies.flat().map((r) => r.jobId);
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += MATCHES_READ) batches.push(ids.slice(i, i + MATCHES_READ));
  const found = new Map<string, JobSummaryItem>();
  for (let i = 0; i < batches.length; i += MATCHES_PARALLEL) {
    const read = await Promise.all(
      batches.slice(i, i + MATCHES_PARALLEL).map((b) => deps.repo.getSummaries(userId, b)),
    );
    for (const j of read.flat()) found.set(j.jobId, j);
  }
  const since = now.getTime() - MATCHES_WINDOW_DAYS * 86_400_000;
  const rows: {
    rank: RankedJob;
    view: ReturnType<typeof jobSummary> & { coolingDownUntil?: string };
  }[] = [];
  for (const ranked of companies) {
    const places = ranked
      .map((rank) => ({ rank, job: found.get(rank.jobId) }))
      // A job applied to keeps its place while its posting is open, even if a later crawl hid
      // it (no refill). Once closed, the crawl frees its place (T08c), as for any job.
      .filter(
        (p): p is { rank: RankedJob; job: JobSummaryItem } =>
          p.job !== undefined &&
          p.job.closedAt === undefined &&
          (p.job.status !== 'new' || !isHidden(p.job)),
      )
      .slice(0, perCompany);
    for (const { rank, job } of places) {
      if (job.status === 'new' && Date.parse(job.lastSeenAt) >= since) {
        const until = cooling(job);
        rows.push({
          rank,
          view: { ...jobSummary(job), ...(until ? { coolingDownUntil: until } : {}) },
        });
      }
    }
  }
  rows.sort((a, b) => compareRank(a.rank, b.rank));
  return {
    jobs: rows.slice(0, MATCHES_MAX).map((r) => r.view),
    truncated: rows.length > MATCHES_MAX,
    cooldown: { limit: limits.applyCompanyLimit, days: limits.applyCooldownDays },
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
 * The caller's jobs (T07b). T08c: the list shows only jobs not hidden by the filter or the
 * company limit, unless `view=all`; a page can then be short and still have a next one.
 * #52: Matches, Applications, and the one change the user makes to a job: its stage.
 */
export async function route(event: Event, deps: JobsDeps): Promise<HttpResponse> {
  const requestId = event.requestContext.requestId;
  const caller = callerFromEvent(event);
  if (!caller) return problem(401, 'Unauthorized', { requestId });
  // Extension tokens reach only two of these routes (EXTENSION_API_ROUTES) and see less of a job.
  const toView = caller.webScope ? jobView : extensionJobView;
  const blocked = await refuseWritesWhileDeleting(
    event.routeKey,
    caller.userId,
    deps.isBeingDeleted,
    requestId,
  );
  if (blocked) return blocked;

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
      return json(200, toView(job));
    }
    case 'GET /me/matches': {
      if (Object.keys(event.queryStringParameters ?? {}).length > 0) {
        return problem(400, 'Invalid request', { detail: 'No query parameters', requestId });
      }
      return json(200, await matches(caller.userId, deps));
    }
    case 'GET /me/applications': {
      const query = applicationsPageQuery.safeParse(event.queryStringParameters ?? {});
      if (!query.success) return validationProblem(query.error, requestId);
      const { limit, cursor } = query.data;
      let after: AppliedCursor | undefined;
      if (cursor !== undefined) {
        const decoded = applicationsCursor.safeParse(decodeCursor(cursor));
        if (!decoded.success) return validationProblem(decoded.error, requestId);
        after = decoded.data;
      }
      const page = await deps.repo.listApplied(caller.userId, limit, after);
      return json(200, {
        jobs: page.items.map(jobSummary),
        ...(page.next !== undefined ? { nextCursor: encodeCursor(page.next) } : {}),
      });
    }
    case 'PUT /me/jobs/{jobId}/stage': {
      const id = jobIdSchema.safeParse(event.pathParameters?.jobId);
      if (!id.success) return validationProblem(id.error, requestId);
      const raw = parseJsonBody(event.body, event.isBase64Encoded);
      if (raw === undefined) return problem(400, 'Invalid JSON', { requestId });
      const body = jobStageBody.safeParse(raw);
      if (!body.success) return validationProblem(body.error, requestId);
      const { stage, from } = body.data;
      // Decision 0020: an extension token only records an application to a job at stage New (hidden
      // or closed too: the user really applied on the employer's site).
      if (
        !caller.webScope &&
        (stage !== EXTENSION_STAGE_CHANGE.stage || from !== EXTENSION_STAGE_CHANGE.from)
      ) {
        return problem(403, 'Forbidden', {
          detail: 'The extension can only mark a new job as applied. Change it in JobDeputy.',
          code: 'extension-stage',
          requestId,
        });
      }
      try {
        const result = await deps.repo.setStage(
          caller.userId,
          id.data,
          { stage, from },
          deps.audit(
            'job.stage_changed',
            { type: 'job', id: id.data },
            `Stage ${from} → ${stage}`,
            // Which client moved it: the extension records applications too (#54 PR D).
            { from, stage, client: caller.webScope ? 'web' : 'extension' },
          ),
          () => expiresAt(deps),
          // Read only when applying or undoing: later stages never need the admin's limits.
          deps.applications.guard(caller.userId, async () => {
            const limits = await deps.limits();
            return { limit: limits.applyCompanyLimit, days: limits.applyCooldownDays };
          }),
        );
        if (result.kind === 'cooling-down') {
          return problem(409, 'Cooling down', {
            detail: `You reached the limit of ${plural(result.limit, 'application')} to this company in ${plural(result.days, 'day')}.`,
            code: 'cooling-down',
            until: result.until,
            requestId,
            job: toView(result.job),
          });
        }
        if (result.kind === 'not-found') return problem(404, 'Not found', { requestId });
        if (result.kind === 'conflict') {
          // With the job as it is now, so the app can show its real stage without asking again.
          return problem(409, 'Conflict', {
            detail: 'This job was changed elsewhere. Reload, then try again.',
            code: 'stage-changed',
            requestId,
            job: toView(result.job),
          });
        }
        return json(200, toView(result.job));
      } catch (error) {
        const busy = concurrentUpdateProblem(error, requestId);
        if (busy) return busy;
        throw error;
      }
    }
    default:
      return problem(404, 'Not found', { requestId });
  }
}

/** "1 day", "30 days". */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
