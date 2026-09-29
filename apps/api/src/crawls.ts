import {
  AccountRepository,
  ActiveCrawlError,
  type Crawl,
  CrawlRepository,
  documentClient,
  sourceIdFor,
} from '@jobdeputy/db';
import {
  ACTIVE_CRAWL_STATUSES,
  CRAWL_ERRORS,
  callerFromEvent,
  crawlId as crawlIdSchema,
  createCrawlInput,
  createLogger,
  type HttpResponse,
  json,
  pageQuery,
  parseCrawlUrl,
  parseJsonBody,
  problem,
  validationProblem,
} from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import { ulid } from 'ulid';
import { refuseWritesWhileDeleting } from './account-guard.js';

const logger = createLogger('api-crawls');

/**
 * An active crawl older than this has stopped (3 attempts with backoff finish well
 * within it), so a new submit replaces it instead of waiting for it forever.
 */
export const STALE_CRAWL_MS = 15 * 60 * 1000;

export interface CrawlsDeps {
  repo: Pick<CrawlRepository, 'request' | 'getSource' | 'getCrawl' | 'listCrawls' | 'finish'>;
  newId: () => string;
  now: () => number;
  isBeingDeleted: (userId: string) => Promise<boolean>;
}

function defaultDeps(): CrawlsDeps {
  const { CRAWLS_TABLE_NAME, SOURCES_TABLE_NAME, AUDIT_TABLE_NAME, USERS_TABLE_NAME } = process.env;
  if (!CRAWLS_TABLE_NAME || !SOURCES_TABLE_NAME || !AUDIT_TABLE_NAME || !USERS_TABLE_NAME) {
    throw new Error('Table names must be set');
  }
  const client = documentClient();
  const account = new AccountRepository(client, USERS_TABLE_NAME);
  return {
    repo: new CrawlRepository(client, {
      crawls: CRAWLS_TABLE_NAME,
      sources: SOURCES_TABLE_NAME,
      audit: AUDIT_TABLE_NAME,
    }),
    newId: ulid,
    now: Date.now,
    isBeingDeleted: (userId) => account.isBeingDeleted(userId),
  };
}

/** What the API shows: no storage keys or internal fields. */
export function crawlView(c: Crawl) {
  return {
    crawlId: c.crawlId,
    sourceId: c.sourceId,
    url: c.url,
    status: c.status,
    attempts: c.attempts,
    ...(c.error ? { error: c.error } : {}),
    ...(c.lastError ? { lastError: c.lastError } : {}),
    ...(c.result
      ? {
          result: {
            finalUrl: c.result.finalUrl,
            httpStatus: c.result.httpStatus,
            contentType: c.result.contentType,
            bytes: c.result.bytes,
          },
        }
      : {}),
    createdAt: c.createdAt,
    ...(c.startedAt ? { startedAt: c.startedAt } : {}),
    ...(c.finishedAt ? { finishedAt: c.finishedAt } : {}),
  };
}

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

async function submit(userId: string, rawUrl: string, deps: CrawlsDeps, requestId: string) {
  const checked = parseCrawlUrl(rawUrl);
  if (!checked.ok) {
    return problem(400, 'This address cannot be crawled', {
      detail: checked.message,
      code: checked.code,
      requestId,
    });
  }
  const { normalizedUrl, url } = checked;
  const sourceId = sourceIdFor(normalizedUrl);
  let replacing: string | undefined;

  // At most one replacement: a second conflict means another submit won the race.
  for (let round = 0; round < 2; round += 1) {
    const crawlId = deps.newId();
    try {
      const crawl = await deps.repo.request({
        userId,
        crawlId,
        sourceId,
        url: rawUrl.trim(),
        normalizedUrl,
        audit: {
          auditId: deps.newId(),
          name: 'crawl.requested',
          entity: { type: 'crawl', id: crawlId },
          actor: 'user',
          summary: `Crawl requested: ${url.hostname}`,
          detail: { sourceId },
        },
        ...(replacing !== undefined ? { replacing } : {}),
      });
      logger.info('Crawl queued', { crawlId, sourceId });
      return json(202, crawlView(crawl));
    } catch (error) {
      if (!(error instanceof ActiveCrawlError)) throw error;
    }

    const activeId = (await deps.repo.getSource(userId, sourceId))?.activeCrawlId;
    if (activeId === undefined) continue; // Freed meanwhile: try again.
    const active = await deps.repo.getCrawl(userId, activeId);
    const stale =
      active !== undefined && deps.now() - Date.parse(active.createdAt) > STALE_CRAWL_MS;
    if (active !== undefined && ACTIVE_CRAWL_STATUSES.includes(active.status) && !stale) {
      return json(200, crawlView(active));
    }
    if (active !== undefined && ACTIVE_CRAWL_STATUSES.includes(active.status)) {
      // It stopped without finishing (for example its message was lost): end it clearly.
      logger.warn('Replacing a stale crawl', { crawlId: activeId });
      await deps.repo.finish(
        active,
        { status: 'failed', error: { code: 'internal', message: CRAWL_ERRORS.internal } },
        {
          auditId: deps.newId(),
          name: 'crawl.failed',
          entity: { type: 'crawl', id: activeId },
          actor: 'system',
          summary: `Crawl failed: ${url.hostname} (internal)`,
          detail: { code: 'internal' },
        },
      );
    }
    replacing = activeId;
  }
  return problem(409, 'Conflict', {
    detail: 'This page is being submitted at the same moment. Try again.',
    requestId,
  });
}

/** The caller's crawls (T06b). The user is always the token's `sub`. */
export async function route(event: Event, deps: CrawlsDeps): Promise<HttpResponse> {
  const requestId = event.requestContext.requestId;
  const caller = callerFromEvent(event);
  if (!caller) return problem(401, 'Unauthorized', { requestId });
  const { userId } = caller;
  const blocked = await refuseWritesWhileDeleting(
    event.routeKey,
    userId,
    deps.isBeingDeleted,
    requestId,
  );
  if (blocked) return blocked;

  switch (event.routeKey) {
    case 'POST /me/crawls': {
      const body = parseJsonBody(event.body, event.isBase64Encoded);
      if (body === undefined) return problem(400, 'Body must be valid JSON', { requestId });
      const input = createCrawlInput.safeParse(body);
      if (!input.success) return validationProblem(input.error, requestId);
      return submit(userId, input.data.url, deps, requestId);
    }
    case 'GET /me/crawls': {
      const query = pageQuery.safeParse(event.queryStringParameters ?? {});
      if (!query.success) return validationProblem(query.error, requestId);
      const page = await deps.repo.listCrawls(userId, query.data.limit, query.data.cursor);
      return json(200, {
        crawls: page.items.map(crawlView),
        ...(page.next !== undefined ? { nextCursor: page.next } : {}),
      });
    }
    case 'GET /me/crawls/{crawlId}': {
      const id = crawlIdSchema.safeParse(event.pathParameters?.crawlId);
      if (!id.success) return validationProblem(id.error, requestId);
      const crawl = await deps.repo.getCrawl(userId, id.data);
      if (!crawl) return problem(404, 'Not found', { requestId });
      return json(200, crawlView(crawl));
    }
    default:
      return problem(404, 'Not found', { requestId });
  }
}

let deps: CrawlsDeps | undefined;

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
