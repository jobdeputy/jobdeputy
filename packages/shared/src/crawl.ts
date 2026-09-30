import { z } from 'zod';
import { DERIVED_PREFIX, ulidId } from './documents.js';

/** T06: crawl requests. Decisions: docs/decisions/0007-crawler.md. */
export const MAX_URL_LENGTH = 2048;

/**
 * Why a crawl failed. Stored on the crawl as `error.code`; the message is shown to the user.
 * Retries are decided by the fetcher, not by the code.
 */
export const CRAWL_ERRORS = {
  invalid_url: 'This is not a web address we can crawl.',
  blocked_address: 'This address points to a private or internal network, which we never crawl.',
  unsafe_redirect: 'The page redirected somewhere we do not follow.',
  too_many_redirects: 'The page redirected too many times.',
  blocked_by_robots: "The site's robots.txt does not allow automated visits to this page.",
  login_required: 'This page needs a login. JobDeputy only crawls public pages.',
  blocked: 'The site refused automated access.',
  not_found: 'The page does not exist (anymore).',
  http_error: 'The site answered with an error.',
  unsupported_content: 'This is not a web page (for example a PDF or an image).',
  too_large: 'The page is too large.',
  needs_browser: 'This page only shows its content with JavaScript, which we cannot run yet.',
  unreadable_feed: "We could not read this job board's listing. Its format may have changed.",
  tls_error: "The site's secure connection is broken (for example an expired certificate).",
  timeout: 'The site took too long to answer.',
  unreachable: 'The site could not be reached.',
  internal: 'Something went wrong on our side.',
} as const;
export type CrawlErrorCode = keyof typeof CRAWL_ERRORS;

/**
 * Sites that show nothing useful without a login. Refused when submitted, and when a
 * redirect leads there. LinkedIn also forbids automated access (0007).
 */
export const LOGIN_ONLY_DOMAINS = ['linkedin.com', 'lnkd.in'] as const;

/** Names that can only mean this machine or a private network. DNS names are checked again at connect. */
const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'home.arpa', 'lan', 'intranet'];

/** Query parameters that only track the click; dropped so the same page is saved once. */
const TRACKING_PARAMS = /^(utm_[a-z_]+|gclid|fbclid|msclkid|mc_cid|mc_eid)$/i;

export type CrawlUrlResult =
  | { ok: true; url: URL; normalizedUrl: string }
  | { ok: false; code: CrawlErrorCode; message: string };

function fail(code: CrawlErrorCode): CrawlUrlResult {
  return { ok: false, code, message: CRAWL_ERRORS[code] };
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Checks a URL before anything is fetched: at `POST` and for every redirect hop.
 * Pure (no network), so the API and the worker apply exactly the same rules. The
 * address a name resolves to is checked separately, at connect time, by the worker.
 */
export function parseCrawlUrl(raw: string): CrawlUrlResult {
  const input = raw.trim();
  if (input.length === 0 || input.length > MAX_URL_LENGTH) return fail('invalid_url');

  let url: URL;
  try {
    // The WHATWG parser lowercases the host, converts it to punycode, and rewrites odd
    // IPv4 forms (0x7f.1, 2130706433, 127.1) to dotted decimal, so the checks below see them.
    url = new URL(input);
  } catch {
    return fail('invalid_url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail('invalid_url');
  if (url.username !== '' || url.password !== '') return fail('invalid_url');
  // The parser drops the scheme's default port, so an explicit one here is non-standard,
  // except the other scheme's default (http://host:443 is unusual but harmless).
  if (url.port !== '' && url.port !== '80' && url.port !== '443') return fail('invalid_url');

  const host = url.hostname.replace(/\.$/, '');
  if (host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return fail('blocked_address');
  if (!host.includes('.') || LOCAL_SUFFIXES.some((s) => hostMatches(host, s))) {
    return fail('blocked_address');
  }
  if (
    host.length > 253 ||
    host.split('.').some((label) => label.length === 0 || label.length > 63)
  ) {
    return fail('invalid_url');
  }
  if (LOGIN_ONLY_DOMAINS.some((d) => hostMatches(host, d))) return fail('login_required');

  url.hostname = host;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  if (url.search === '?') url.search = '';

  return { ok: true, url, normalizedUrl: url.href };
}

/** queued → running → succeeded | failed (0006; `cancelled` is reserved for later). */
export type CrawlStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** A crawl is `queued` or `running`: a second submit of the same page returns it. */
export const ACTIVE_CRAWL_STATUSES: readonly CrawlStatus[] = ['queued', 'running'];

/**
 * The fetched page. Under `derived/`: we fetched it, the user did not upload it, so it
 * is not malware-scanned, never served to a browser, and goes with account deletion.
 * Expires after 30 days (S3 lifecycle rule on the `retention` tag).
 */
export function crawlKeys(userId: string, crawlId: string) {
  return { page: `${DERIVED_PREFIX}${userId}/crawls/${crawlId}/page` };
}
export const CRAWL_PAGE_RETENTION_TAG = { key: 'retention', value: 'crawl-page' } as const;
export const CRAWL_PAGE_RETENTION_DAYS = 30;

/** `POST /me/crawls`. */
export const createCrawlInput = z.strictObject({
  url: z.string().max(MAX_URL_LENGTH),
  /** T08b2: the model for this crawl's AI work (`platform` or a provider); the API checks it. */
  aiSource: z.string().max(20).optional(),
});

export const crawlId = ulidId;

/** Paging for lists ordered newest first: `?limit=20&cursor=<id of the last item seen>`. */
export const pageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: ulidId.optional(),
});

/** T07b: a job's key (a hash, 0008). */
export const jobId = z.string().regex(/^[0-9a-f]{32}$/, 'Not a job ID');

/** Paging for jobs, in key order: `?limit=20&cursor=<jobId of the last job seen>`. */
export const jobsPageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: jobId.optional(),
});

/** Queue message from the crawls Pipe: the crawl's key only. */
export const crawlMessage = z.object({
  userId: z.string().regex(/^[0-9a-f-]{36}$/),
  crawlId: ulidId,
});
export type CrawlMessage = z.infer<typeof crawlMessage>;

/**
 * T06c: daily crawl limits (0007). The admin sets a default and a maximum per stage (SSM
 * Parameter Store, JSON like this); a user may choose their own limit up to the maximum.
 */
export const crawlLimitsConfig = z
  .strictObject({
    dailyDefault: z.number().int().min(1).max(1000),
    dailyMax: z.number().int().min(1).max(1000),
    /** Crawls one user may have queued or running at the same time (fix after T06d). */
    maxActive: z.number().int().min(1).max(20).default(1),
    /** T08b3 (0009): free platform AI runs per user (one run = one crawl's AI work). */
    platformRunsPerWeek: z.number().int().min(0).max(100).default(1),
    platformRunsPerMonth: z.number().int().min(0).max(400).default(4),
  })
  .refine((c) => c.dailyDefault <= c.dailyMax, 'dailyDefault must not exceed dailyMax');
export type CrawlLimitsConfig = z.infer<typeof crawlLimitsConfig>;

/** Used when the admin setting is missing or invalid (and as the initial setting). */
export const DEFAULT_CRAWL_LIMITS: CrawlLimitsConfig = {
  dailyDefault: 20,
  dailyMax: 50,
  maxActive: 1,
  platformRunsPerWeek: 1,
  platformRunsPerMonth: 4,
};

/** `PUT /me/crawl-settings`: `dailyLimit: null` goes back to the admin default. */
export const updateCrawlSettingsInput = z.strictObject({
  version: z.number().int().min(0),
  dailyLimit: z.number().int().min(1).max(1000).nullable(),
});

/** The limit that applies: the user's own (if any) or the default, never above the maximum. */
export function effectiveDailyLimit(
  config: Pick<CrawlLimitsConfig, 'dailyDefault' | 'dailyMax'>,
  userLimit?: number | null,
): number {
  return Math.min(userLimit ?? config.dailyDefault, config.dailyMax);
}

/** Days reset at 00:00 UTC. */
export const utcDay = (at: Date) => at.toISOString().slice(0, 10);
export const utcMonth = (at: Date) => at.toISOString().slice(0, 7);
export function nextUtcMidnight(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1));
}

export function activeLimitMessage(active: number): string {
  return `You have ${active} crawls in progress, the most at one time. Try again when one finishes.`;
}

export function dailyLimitMessage(used: number, limit: number): string {
  return `You've used ${used} of ${limit} crawls today. Resets at 00:00 UTC.`;
}
