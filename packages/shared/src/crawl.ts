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
