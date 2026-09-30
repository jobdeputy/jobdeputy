import {
  AccountRepository,
  ActiveCrawlError,
  AiKeyRepository,
  type Crawl,
  CrawlRepository,
  CrawlSettingsRepository,
  crawlsToday,
  DailyLimitError,
  documentClient,
  PlatformAllowanceError,
  platformRunsUsed,
  sourceIdFor,
  TooManyActiveCrawlsError,
  VersionConflictError,
} from '@jobdeputy/db';
import {
  ACTIVE_CRAWL_STATUSES,
  type AiKeyStatus,
  type AiProvider,
  type AiSource,
  activeLimitMessage,
  aiProvider,
  CRAWL_ERRORS,
  type CrawlLimitsConfig,
  callerFromEvent,
  crawlId as crawlIdSchema,
  createCrawlInput,
  createLogger,
  dailyLimitMessage,
  effectiveDailyLimit,
  type HttpResponse,
  json,
  nextPlatformRunAt,
  nextUtcMidnight,
  pageQuery,
  parseCrawlUrl,
  parseJsonBody,
  problem,
  updateCrawlSettingsInput,
  validationProblem,
} from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import { ulid } from 'ulid';
import { refuseWritesWhileDeleting } from './account-guard.js';
import { ssmCrawlLimits } from './crawl-limits.js';
import { concurrentUpdateProblem } from './errors.js';

const logger = createLogger('api-crawls');

/**
 * An active crawl older than this has stopped (3 attempts with backoff finish well
 * within it), so a new submit replaces it instead of waiting for it forever.
 */
export const STALE_CRAWL_MS = 15 * 60 * 1000;

export interface CrawlsDeps {
  repo: Pick<
    CrawlRepository,
    | 'request'
    | 'getSource'
    | 'getCrawl'
    | 'listCrawls'
    | 'finish'
    | 'getActiveCrawlIds'
    | 'releaseActive'
  >;
  settings: Pick<CrawlSettingsRepository, 'get' | 'save'>;
  /** The admin's default and maximum (T06c), cached for at most 5 minutes. */
  limits: () => Promise<CrawlLimitsConfig>;
  usedToday: (userId: string) => Promise<number>;
  /** T08b3: the free platform runs used this week and month. */
  platformRunsUsed: (userId: string) => Promise<{ week: number; month: number }>;
  auditTable: string;
  newId: () => string;
  now: () => number;
  isBeingDeleted: (userId: string) => Promise<boolean>;
  /** T08b2: the user's default AI model source, and the status of one of their keys. */
  aiDefault: (userId: string) => Promise<AiSource>;
  aiKeyStatus: (userId: string, provider: AiProvider) => Promise<AiKeyStatus | undefined>;
  /** Dev stacks only: the `stub` provider for integration tests. */
  allowTestProvider: boolean;
}

function defaultDeps(): CrawlsDeps {
  const {
    CRAWLS_TABLE_NAME,
    SOURCES_TABLE_NAME,
    AUDIT_TABLE_NAME,
    USERS_TABLE_NAME,
    USAGE_TABLE_NAME,
    PREFERENCES_TABLE_NAME,
    CRAWL_LIMITS_PARAMETER,
    AI_KEYS_TABLE_NAME,
    ALLOW_TEST_AI_PROVIDER,
  } = process.env;
  if (
    !CRAWLS_TABLE_NAME ||
    !SOURCES_TABLE_NAME ||
    !AUDIT_TABLE_NAME ||
    !USERS_TABLE_NAME ||
    !USAGE_TABLE_NAME ||
    !PREFERENCES_TABLE_NAME ||
    !CRAWL_LIMITS_PARAMETER ||
    !AI_KEYS_TABLE_NAME
  ) {
    throw new Error('Table and parameter names must be set');
  }
  const client = documentClient();
  const account = new AccountRepository(client, USERS_TABLE_NAME);
  const aiKeys = new AiKeyRepository(client, {
    aiKeys: AI_KEYS_TABLE_NAME,
    usage: USAGE_TABLE_NAME,
    preferences: PREFERENCES_TABLE_NAME,
  });
  return {
    repo: new CrawlRepository(client, {
      crawls: CRAWLS_TABLE_NAME,
      sources: SOURCES_TABLE_NAME,
      audit: AUDIT_TABLE_NAME,
      usage: USAGE_TABLE_NAME,
    }),
    settings: new CrawlSettingsRepository(client, PREFERENCES_TABLE_NAME),
    auditTable: AUDIT_TABLE_NAME,
    limits: ssmCrawlLimits(CRAWL_LIMITS_PARAMETER),
    usedToday: (userId) => crawlsToday(client, USAGE_TABLE_NAME, userId, new Date()),
    platformRunsUsed: (userId) => platformRunsUsed(client, USAGE_TABLE_NAME, userId, new Date()),
    newId: ulid,
    now: Date.now,
    isBeingDeleted: (userId) => account.isBeingDeleted(userId),
    aiDefault: async (userId) => (await aiKeys.getSettings(userId))?.defaultSource ?? 'platform',
    aiKeyStatus: async (userId, provider) => (await aiKeys.get(userId, provider))?.status,
    allowTestProvider: ALLOW_TEST_AI_PROVIDER === 'true',
  };
}

/**
 * T08b2 (decision 0009): the model source for this crawl's AI work. A source the user chose
 * for this crawl must be the platform or a saved key that is not invalid; the default is
 * stored as it is, and T08d stops the AI work with a reason if its key no longer works
 * (never falling back to the platform model silently). The crawl itself never needs AI.
 */
async function resolveAiSource(
  userId: string,
  requested: string | undefined,
  deps: CrawlsDeps,
  requestId: string,
): Promise<AiSource | HttpResponse> {
  if (requested === undefined) return deps.aiDefault(userId);
  if (requested === 'platform' || requested === 'none') return requested;
  const provider = aiProvider(requested, deps.allowTestProvider);
  if (!provider) {
    return problem(400, 'Invalid request', {
      errors: [{ path: 'aiSource', message: 'Use platform or a provider you saved a key for' }],
      requestId,
    });
  }
  const status = await deps.aiKeyStatus(userId, provider);
  if (status === undefined || status === 'invalid') {
    return problem(422, 'Key not usable', {
      detail: `Save a working ${provider} key first, or use the platform model.`,
      code: 'ai-key-not-usable',
      requestId,
    });
  }
  return provider;
}

/** The limit that applies and why, plus today's use (`GET /me/crawl-settings`). */
async function settingsView(userId: string, deps: CrawlsDeps) {
  const [config, settings, usedToday, active] = await Promise.all([
    deps.limits(),
    deps.settings.get(userId),
    deps.usedToday(userId),
    deps.repo.getActiveCrawlIds(userId),
  ]);
  return {
    dailyLimit: effectiveDailyLimit(config, settings?.dailyLimit),
    customLimit: settings?.dailyLimit ?? null,
    defaultLimit: config.dailyDefault,
    maxAllowed: config.dailyMax,
    usedToday,
    resetsAt: nextUtcMidnight(new Date(deps.now())).toISOString(),
    maxActive: config.maxActive,
    activeNow: active.length,
    version: settings?.version ?? 0,
  };
}

/** What the API shows: no storage keys or internal fields. */
export function crawlView(c: Crawl) {
  return {
    crawlId: c.crawlId,
    sourceId: c.sourceId,
    url: c.url,
    status: c.status,
    ...(c.aiSource ? { aiSource: c.aiSource } : {}),
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
    // T07b: what the crawl read and saved.
    ...(c.stats ? { stats: c.stats } : {}),
    ...(c.extraction ? { extraction: c.extraction } : {}),
    createdAt: c.createdAt,
    ...(c.startedAt ? { startedAt: c.startedAt } : {}),
    ...(c.finishedAt ? { finishedAt: c.finishedAt } : {}),
  };
}

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

/** How long a client should wait before submitting again when its active crawls are full. */
export const ACTIVE_RETRY_AFTER_SECONDS = 30;

const isActive = (c: Crawl | undefined, now: number) =>
  c !== undefined &&
  ACTIVE_CRAWL_STATUSES.includes(c.status) &&
  now - Date.parse(c.createdAt) <= STALE_CRAWL_MS;

/**
 * Ends a crawl that stopped without finishing (for example its message was lost):
 * clearly failed, audited, and its active slot freed.
 */
async function endStale(deps: CrawlsDeps, crawl: Crawl) {
  logger.warn('Ending a stale crawl', { crawlId: crawl.crawlId });
  await deps.repo.finish(
    crawl,
    { status: 'failed', error: { code: 'internal', message: CRAWL_ERRORS.internal } },
    {
      auditId: deps.newId(),
      name: 'crawl.failed',
      entity: { type: 'crawl', id: crawl.crawlId },
      actor: 'system',
      summary: `Crawl failed: ${new URL(crawl.url).hostname} (internal)`,
      detail: { code: 'internal' },
    },
  );
}

/**
 * Frees active slots held by crawls that are finished, gone, or stale. Returns how many
 * were freed. Keeps a user from being blocked forever by a crawl that never finished.
 */
async function healActiveSlots(userId: string, deps: CrawlsDeps): Promise<number> {
  const ids = await deps.repo.getActiveCrawlIds(userId);
  const crawls = await Promise.all(ids.map((id) => deps.repo.getCrawl(userId, id)));
  const now = deps.now();
  let freed = 0;
  const gone: string[] = [];
  for (const [i, crawl] of crawls.entries()) {
    if (isActive(crawl, now)) continue;
    if (crawl && ACTIVE_CRAWL_STATUSES.includes(crawl.status)) await endStale(deps, crawl);
    else gone.push(ids[i] as string);
    freed += 1;
  }
  await deps.repo.releaseActive(userId, gone);
  return freed;
}

/** This page's crawl, if one is queued or running (and not stale). */
async function activeCrawlOf(userId: string, sourceId: string, deps: CrawlsDeps) {
  const activeId = (await deps.repo.getSource(userId, sourceId))?.activeCrawlId;
  if (activeId === undefined) return undefined;
  const crawl = await deps.repo.getCrawl(userId, activeId);
  return isActive(crawl, deps.now()) ? crawl : undefined;
}

/**
 * T08b3 (0009): the free platform AI runs are used up. The crawl is refused; the user can
 * choose their own key or no AI, or wait until the next free run.
 */
async function platformAllowanceProblem(
  userId: string,
  config: CrawlLimitsConfig,
  deps: CrawlsDeps,
  requestId: string,
): Promise<HttpResponse> {
  const used = await deps.platformRunsUsed(userId);
  const at = new Date(deps.now());
  const nextAt = nextPlatformRunAt(
    at,
    used.week >= config.platformRunsPerWeek,
    used.month >= config.platformRunsPerMonth,
  );
  const res = problem(429, 'Free AI runs used up', {
    detail: `You've used your free AI runs (${config.platformRunsPerWeek} a week, ${config.platformRunsPerMonth} a month). The next one is available at ${nextAt.toISOString()}. Until then, crawl with your own key, or with aiSource "none" (keyword filter only).`,
    code: 'platform-ai-limit-reached',
    requestId,
  });
  const seconds = Math.max(1, Math.ceil((nextAt.getTime() - at.getTime()) / 1000));
  return { ...res, headers: { ...res.headers, 'retry-after': String(seconds) } };
}

async function submit(
  userId: string,
  rawUrl: string,
  aiSource: AiSource,
  deps: CrawlsDeps,
  requestId: string,
) {
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
  const [config, settings] = await Promise.all([deps.limits(), deps.settings.get(userId)]);
  const dailyLimit = effectiveDailyLimit(config, settings?.dailyLimit);
  let replacing: string | undefined;
  let healed = false;

  // Bounded: at most one replacement of this page's crawl and one clean-up of stale slots.
  for (let round = 0; round < 3; round += 1) {
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
        dailyLimit,
        maxActive: config.maxActive,
        ...(replacing !== undefined ? { replacing } : {}),
        aiSource,
        ...(aiSource === 'platform'
          ? {
              platformRuns: {
                perWeek: config.platformRunsPerWeek,
                perMonth: config.platformRunsPerMonth,
              },
            }
          : {}),
      });
      logger.info('Crawl queued', { crawlId, sourceId });
      return json(202, crawlView(crawl));
    } catch (error) {
      if (
        error instanceof DailyLimitError ||
        error instanceof TooManyActiveCrawlsError ||
        error instanceof PlatformAllowanceError
      ) {
        // DynamoDB does not always report every failed condition of a transaction, so a
        // duplicate of a page already in progress can surface as a limit. The same page
        // always gets its running crawl (200), and is never counted (seen on real AWS).
        const running = await activeCrawlOf(userId, sourceId, deps);
        if (running) return json(200, crawlView(running));
      }
      if (error instanceof PlatformAllowanceError) {
        return platformAllowanceProblem(userId, config, deps, requestId);
      }
      if (error instanceof DailyLimitError) {
        const used = await deps.usedToday(userId);
        return problem(429, 'Daily crawl limit reached', {
          detail: dailyLimitMessage(used, dailyLimit),
          code: 'daily-limit-reached',
          requestId,
        });
      }
      if (error instanceof TooManyActiveCrawlsError) {
        if (!healed && (await healActiveSlots(userId, deps)) > 0) {
          healed = true;
          continue;
        }
        const res = problem(429, 'Too many crawls in progress', {
          detail: activeLimitMessage(config.maxActive),
          code: 'too-many-active-crawls',
          requestId,
        });
        return {
          ...res,
          headers: { ...res.headers, 'retry-after': String(ACTIVE_RETRY_AFTER_SECONDS) },
        };
      }
      if (!(error instanceof ActiveCrawlError)) throw error;
    }

    const activeId = (await deps.repo.getSource(userId, sourceId))?.activeCrawlId;
    if (activeId === undefined) continue; // Freed meanwhile: try again.
    const active = await deps.repo.getCrawl(userId, activeId);
    if (isActive(active, deps.now())) return json(200, crawlView(active as Crawl));
    if (active !== undefined && ACTIVE_CRAWL_STATUSES.includes(active.status)) {
      await endStale(deps, active);
    }
    replacing = activeId;
  }
  return problem(409, 'Conflict', {
    detail: 'This page is being submitted at the same moment. Try again.',
    code: 'try-again',
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
      const aiSource = await resolveAiSource(userId, input.data.aiSource, deps, requestId);
      if (typeof aiSource === 'object') return aiSource;
      return submit(userId, input.data.url, aiSource, deps, requestId);
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
    case 'GET /me/crawl-settings':
      return json(200, await settingsView(userId, deps));
    case 'PUT /me/crawl-settings': {
      const body = parseJsonBody(event.body, event.isBase64Encoded);
      if (body === undefined) return problem(400, 'Body must be valid JSON', { requestId });
      const input = updateCrawlSettingsInput.safeParse(body);
      if (!input.success) return validationProblem(input.error, requestId);
      const config = await deps.limits();
      const { dailyLimit, version } = input.data;
      if (dailyLimit !== null && dailyLimit > config.dailyMax) {
        return problem(422, 'Limit too high', {
          detail: `The most you can choose is ${config.dailyMax} crawls a day.`,
          code: 'limit-above-maximum',
          requestId,
        });
      }
      const previous = (await deps.settings.get(userId))?.dailyLimit;
      try {
        await deps.settings.save(userId, dailyLimit, version, {
          table: deps.auditTable,
          entry: {
            auditId: deps.newId(),
            name: 'crawl_limit.changed',
            entity: { type: 'crawl_settings', id: 'CRAWL_SETTINGS' },
            actor: 'user',
            summary:
              dailyLimit === null
                ? `Daily crawl limit set back to the default (${config.dailyDefault})`
                : `Daily crawl limit set to ${dailyLimit}`,
            detail: { from: previous ?? 'default', to: dailyLimit ?? 'default' },
          },
        });
      } catch (error) {
        if (error instanceof VersionConflictError) {
          return problem(409, 'Conflict', {
            detail: 'This was changed elsewhere. Reload, then try again.',
            requestId,
          });
        }
        throw error;
      }
      return json(200, await settingsView(userId, deps));
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
    const busy = concurrentUpdateProblem(error, event.requestContext.requestId);
    if (busy) {
      logger.warn('Concurrent update after retries', { error: error as Error });
      return busy;
    }
    logger.error('Unhandled error', { error: error as Error });
    return problem(500, 'Internal error', { requestId: event.requestContext.requestId });
  }
}
