import { CRAWL_ERRORS, type CrawlErrorCode, parseCrawlUrl } from '@jobdeputy/shared';
import { type Dispatcher, fetch, type Headers, type Response } from 'undici';
import { BlockedAddressError, createSafeDispatcher } from './address.js';
import { hasPasswordField, isLoginUrl } from './detect.js';
import { MAX_ROBOTS_BYTES, robotsAllows } from './robots.js';

/** Per-fetch limits (0007). */
export const FETCH_LIMITS = {
  connectTimeoutMs: 5_000,
  /** Everything for one page: robots.txt, redirects, headers, and body. */
  totalTimeoutMs: 20_000,
  /** Counted after decompression, while streaming. */
  maxBytes: 5 * 1024 * 1024,
  maxRedirects: 5,
  maxRequestBodyBytes: 64 * 1024,
  maxRetryAfterSeconds: 120,
};
export type FetchLimits = typeof FETCH_LIMITS;

/** Honest, with a link explaining who we are (0007). */
export const USER_AGENT = 'JobDeputyBot/0.1 (+https://github.com/jobdeputy/jobdeputy)';

/** Media types worth reading: pages and job-board data feeds. */
export const PAGE_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'application/json',
  'application/ld+json',
  'text/plain',
  'application/xml',
  'text/xml',
  'application/rss+xml',
  'application/atom+xml',
]);

/** Why a fetch failed, and whether trying again later could help. */
export class FetchError extends Error {
  override name = 'FetchError';
  constructor(
    readonly code: CrawlErrorCode,
    readonly retriable: boolean,
    detail?: string,
    /** A `Retry-After` hint, capped. */
    readonly retryAfterSeconds?: number,
  ) {
    super(detail ?? CRAWL_ERRORS[code]);
  }
}

export interface FetchedPage {
  /** The final URL, after redirects. */
  url: string;
  status: number;
  /** Media type only, lowercased (`text/html`). */
  contentType: string;
  charset?: string;
  body: Uint8Array;
  /** Every URL redirected to, in order. */
  redirects: string[];
}

export interface FetchOptions {
  /** A small JSON body makes it a `POST` (job-board data feeds such as Workday's). */
  json?: unknown;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const TIMEOUT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ETIMEDOUT',
]);
const TLS_CODE = /^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_|HOSTNAME_MISMATCH)/;

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let e = error; e !== undefined && e !== null && chain.length < 10; e = (e as Error).cause) {
    chain.push(e);
  }
  return chain;
}

/** Network-level failures: blocked addresses never retry; timeouts and outages do. */
export function classifyNetworkError(error: unknown, deadline: AbortSignal): FetchError {
  if (error instanceof FetchError) return error;
  const chain = errorChain(error);
  if (chain.some((e) => e instanceof BlockedAddressError))
    return new FetchError('blocked_address', false);
  if (deadline.aborted) return new FetchError('timeout', true);
  const codes = chain.map((e) => String((e as NodeJS.ErrnoException).code ?? ''));
  if (codes.some((c) => TIMEOUT_CODES.has(c))) return new FetchError('timeout', true);
  if (codes.some((c) => TLS_CODE.test(c))) return new FetchError('tls_error', false);
  // The name does not exist (an authoritative answer): retrying cannot help. A
  // temporary DNS failure (EAI_AGAIN) or a refused or dropped connection can.
  if (codes.includes('ENOTFOUND')) return new FetchError('unreachable', false, 'ENOTFOUND');
  return new FetchError('unreachable', true, codes.find((c) => c !== '') || undefined);
}

/** `Retry-After` in seconds or as a date, capped; undefined when absent or unreadable. */
export function parseRetryAfter(
  value: string | null,
  now: number,
  cap: number,
): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) : (Date.parse(value) - now) / 1000;
  if (!Number.isFinite(seconds)) return undefined;
  return Math.min(Math.max(Math.ceil(seconds), 0), cap);
}

/** HTTP-level failures. Being blocked is never retried: retrying makes blocking worse. */
export function classifyStatus(
  status: number,
  headers: Headers,
  limits: FetchLimits,
  now: number,
): FetchError | undefined {
  if (headers.get('cf-mitigated') === 'challenge') return new FetchError('blocked', false);
  if (status >= 200 && status < 300) return undefined;
  if (status === 401 || status === 407) return new FetchError('login_required', false);
  if (status === 403 || status === 429) return new FetchError('blocked', false);
  if (status === 404 || status === 410) return new FetchError('not_found', false);
  if (status >= 500 && status < 600) {
    const retryAfter = parseRetryAfter(
      headers.get('retry-after'),
      now,
      limits.maxRetryAfterSeconds,
    );
    return new FetchError('http_error', true, `HTTP ${status}`, retryAfter);
  }
  return new FetchError('http_error', false, `HTTP ${status}`);
}

function mediaType(header: string | null): { type: string; charset?: string } {
  const [type = '', ...params] = (header ?? '').split(';');
  const charset = params
    .map((p) => p.trim().toLowerCase())
    .find((p) => p.startsWith('charset='))
    ?.slice('charset='.length)
    .replace(/^"|"$/g, '');
  return { type: type.trim().toLowerCase(), ...(charset ? { charset } : {}) };
}

/** The body as text, in its declared charset (UTF-8 if none or unknown). */
export function decodeBody(page: Pick<FetchedPage, 'body' | 'charset'>): string {
  try {
    return new TextDecoder(page.charset ?? 'utf-8').decode(page.body);
  } catch {
    return new TextDecoder('utf-8').decode(page.body);
  }
}

/** Reads at most `maxBytes` of the (already decompressed) body; `truncate` keeps the first part instead of failing. */
async function readBody(
  response: Response,
  maxBytes: number,
  truncate: boolean,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (!truncate && Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new FetchError('too_large', false);
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      await reader.cancel();
      if (!truncate) throw new FetchError('too_large', false);
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Checks a URL (first or a redirect target) with the same rules the API uses. */
function checkUrl(raw: string, isRedirect: boolean): URL {
  const checked = parseCrawlUrl(raw);
  if (checked.ok) return checked.url;
  const code = isRedirect && checked.code === 'invalid_url' ? 'unsafe_redirect' : checked.code;
  throw new FetchError(code, false);
}

export interface FetcherOptions {
  /** Tests only: a mock or a dispatcher with a fake DNS. Defaults to the SSRF-safe dispatcher. */
  dispatcher?: Dispatcher;
  limits?: FetchLimits;
  now?: () => number;
}

let sharedDispatcher: Dispatcher | undefined;
function safeDispatcher(limits: FetchLimits): Dispatcher {
  sharedDispatcher ??= createSafeDispatcher({
    connectTimeoutMs: limits.connectTimeoutMs,
    idleTimeoutMs: limits.totalTimeoutMs,
  });
  return sharedDispatcher;
}

/**
 * One fetcher per crawl: it remembers each site's robots.txt for the crawl's duration.
 * Every request goes through the same checks: URL rules, robots.txt, the connect-time
 * address check, redirect re-checks, limits, and login detection.
 */
export function createFetcher(options: FetcherOptions = {}) {
  const limits = options.limits ?? FETCH_LIMITS;
  const dispatcher = options.dispatcher ?? safeDispatcher(limits);
  const now = options.now ?? Date.now;
  const robotsByOrigin = new Map<string, Promise<string>>();

  async function send(url: URL, init: { method: string; body?: string }, deadline: AbortSignal) {
    try {
      return await fetch(url, {
        method: init.method,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5',
          'accept-language': 'en',
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(init.body !== undefined ? { body: init.body } : {}),
        redirect: 'manual',
        dispatcher,
        signal: deadline,
      });
    } catch (error) {
      throw classifyNetworkError(error, deadline);
    }
  }

  /** Follows redirects by hand, re-checking every hop. */
  async function follow(
    start: URL,
    init: { method: string; body?: string },
    deadline: AbortSignal,
    beforeEach: (url: URL) => Promise<void>,
  ) {
    let url = start;
    let request = init;
    const redirects: string[] = [];
    for (;;) {
      await beforeEach(url);
      const response = await send(url, request, deadline);
      if (!REDIRECTS.has(response.status)) return { url, response, redirects };

      await response.body?.cancel();
      if (redirects.length >= limits.maxRedirects)
        throw new FetchError('too_many_redirects', false);
      const location = response.headers.get('location');
      if (location === null)
        throw new FetchError('http_error', false, `HTTP ${response.status} without a location`);
      let target: URL;
      try {
        target = new URL(location, url);
      } catch {
        throw new FetchError('unsafe_redirect', false);
      }
      const next = checkUrl(target.href, true);
      if (url.protocol === 'https:' && next.protocol === 'http:')
        throw new FetchError('unsafe_redirect', false);
      if (isLoginUrl(next)) throw new FetchError('login_required', false);
      // Browsers turn a redirected POST into a GET, except for 307 and 308.
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && request.method === 'POST')
      ) {
        request = { method: 'GET' };
      }
      redirects.push(next.href);
      url = next;
    }
  }

  /**
   * RFC 9309: a 4xx robots.txt (other than 429) allows everything; a 429, a 5xx, or an
   * unreachable site means "not now", which we report as that failure (retriable) rather
   * than as a robots refusal.
   */
  async function loadRobots(origin: string, deadline: AbortSignal): Promise<string> {
    const start = new URL('/robots.txt', origin);
    let response: Response;
    try {
      ({ response } = await follow(start, { method: 'GET' }, deadline, async () => {}));
    } catch (error) {
      // RFC 9309 §2.3.1.2: a robots.txt we cannot follow to the end counts as unavailable
      // (allow). Blocked addresses, timeouts, and outages still fail the fetch.
      if (
        error instanceof FetchError &&
        ['too_many_redirects', 'unsafe_redirect', 'login_required'].includes(error.code)
      ) {
        return '';
      }
      throw error;
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      const retryAfter = parseRetryAfter(
        response.headers.get('retry-after'),
        now(),
        limits.maxRetryAfterSeconds,
      );
      throw new FetchError('http_error', true, `robots.txt: HTTP ${response.status}`, retryAfter);
    }
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel();
      return '';
    }
    const body = await readBody(response, MAX_ROBOTS_BYTES, true).catch((error: unknown) => {
      throw classifyNetworkError(error, deadline);
    });
    // A robots.txt reached through a redirect still governs the site we asked about.
    return new TextDecoder('utf-8').decode(body);
  }

  async function checkRobots(url: URL, deadline: AbortSignal): Promise<void> {
    let robots = robotsByOrigin.get(url.origin);
    if (robots === undefined) {
      robots = loadRobots(url.origin, deadline);
      robotsByOrigin.set(url.origin, robots);
      // A failed load is not cached: the next fetch (a retry) tries again.
      robots.catch(() => robotsByOrigin.delete(url.origin));
    }
    if (!robotsAllows(await robots, url)) throw new FetchError('blocked_by_robots', false);
  }

  /** Fetches one page or data feed. Throws `FetchError` for every failure. */
  async function fetchPage(rawUrl: string, fetchOptions: FetchOptions = {}): Promise<FetchedPage> {
    const deadline = AbortSignal.timeout(limits.totalTimeoutMs);
    const start = checkUrl(rawUrl, false);

    let init: { method: string; body?: string } = { method: 'GET' };
    if (fetchOptions.json !== undefined) {
      const body = JSON.stringify(fetchOptions.json);
      if (Buffer.byteLength(body) > limits.maxRequestBodyBytes) {
        throw new FetchError('internal', false, 'Request body too large');
      }
      init = { method: 'POST', body };
    }

    const { url, response, redirects } = await follow(start, init, deadline, (hop) =>
      checkRobots(hop, deadline),
    );

    const failure = classifyStatus(response.status, response.headers, limits, now());
    if (failure !== undefined) {
      await response.body?.cancel();
      throw failure;
    }
    const { type, charset } = mediaType(response.headers.get('content-type'));
    if (!PAGE_TYPES.has(type)) {
      await response.body?.cancel();
      throw new FetchError('unsupported_content', false, type === '' ? 'No content type' : type);
    }
    const body = await readBody(response, limits.maxBytes, false).catch((error: unknown) => {
      throw classifyNetworkError(error, deadline);
    });
    const page: FetchedPage = {
      url: url.href,
      status: response.status,
      contentType: type,
      ...(charset !== undefined ? { charset } : {}),
      body,
      redirects,
    };
    if (
      (type === 'text/html' || type === 'application/xhtml+xml') &&
      hasPasswordField(decodeBody(page))
    ) {
      throw new FetchError('login_required', false);
    }
    return page;
  }

  return { fetch: fetchPage };
}
export type Fetcher = ReturnType<typeof createFetcher>;
