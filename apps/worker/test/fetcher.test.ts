import { gzipSync } from 'node:zlib';
import { Headers, MockAgent } from 'undici';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockedAddressError, createSafeDispatcher } from '../src/fetch/address.js';
import {
  classifyNetworkError,
  classifyStatus,
  createFetcher,
  decodeBody,
  FETCH_LIMITS,
  FetchError,
  type FetchLimits,
  parseRetryAfter,
  USER_AGENT,
} from '../src/fetch/fetcher.js';

const SITE = 'https://jobs.example.com';
const NOW = Date.parse('2026-09-28T12:00:00Z');
const HTML = { 'content-type': 'text/html; charset=utf-8' };
const PAGE = '<html><body><h1>Open roles</h1><ul><li>Engineer</li></ul></body></html>';

let agent: MockAgent;
const agents: MockAgent[] = [];

function newAgent(): MockAgent {
  agent = new MockAgent();
  agents.push(agent);
  return agent;
}

function setup(limits: Partial<FetchLimits> = {}, robots: string | number = 404) {
  newAgent();
  agent.disableNetConnect();
  const site = agent.get(SITE);
  if (typeof robots === 'number') site.intercept({ path: '/robots.txt' }).reply(robots, '');
  else
    site
      .intercept({ path: '/robots.txt' })
      .reply(200, robots, { headers: { 'content-type': 'text/plain' } });
  const fetcher = createFetcher({
    dispatcher: agent,
    limits: { ...FETCH_LIMITS, ...limits },
    now: () => NOW,
  });
  return { fetcher, site };
}

async function failureOf(promise: Promise<unknown>): Promise<FetchError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FetchError);
  return error as FetchError;
}

afterEach(async () => {
  await Promise.all(agents.splice(0).map((a) => a.close()));
});

describe('createFetcher: success', () => {
  it('fetches a page with an honest user agent and reports what it got', async () => {
    const { fetcher, site } = setup();
    site
      .intercept({ path: '/careers', headers: { 'user-agent': USER_AGENT } })
      .reply(200, PAGE, { headers: HTML });

    const page = await fetcher.fetch(`${SITE}/careers`);
    expect(page).toMatchObject({
      url: `${SITE}/careers`,
      status: 200,
      contentType: 'text/html',
      charset: 'utf-8',
      redirects: [],
    });
    expect(decodeBody(page)).toBe(PAGE);
    agent.assertNoPendingInterceptors();
  });

  it('reads JSON data feeds', async () => {
    const { fetcher, site } = setup();
    site.intercept({ path: '/v1/boards/acme/jobs' }).reply(200, '{"jobs":[]}', {
      headers: { 'content-type': 'application/json' },
    });
    const page = await fetcher.fetch(`${SITE}/v1/boards/acme/jobs`);
    expect(page.contentType).toBe('application/json');
  });

  it('sends a JSON POST for data feeds that need one', async () => {
    const { fetcher, site } = setup();
    site
      .intercept({
        path: '/wday/cxs/acme/careers/jobs',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"limit":20,"offset":0}',
      })
      .reply(200, '{"total":0}', { headers: { 'content-type': 'application/json' } });
    const page = await fetcher.fetch(`${SITE}/wday/cxs/acme/careers/jobs`, {
      json: { limit: 20, offset: 0 },
    });
    expect(decodeBody(page)).toBe('{"total":0}');
  });

  it('refuses an oversized request body without sending it', async () => {
    const { fetcher } = setup({ maxRequestBodyBytes: 10 });
    const error = await failureOf(
      fetcher.fetch(`${SITE}/api`, { json: { query: 'x'.repeat(20) } }),
    );
    expect(error.code).toBe('internal');
  });

  it('decodes the declared charset', async () => {
    const { fetcher, site } = setup();
    site.intercept({ path: '/' }).reply(200, Buffer.from([0x63, 0x61, 0x66, 0xe9]), {
      headers: { 'content-type': 'text/plain; charset="ISO-8859-1"' },
    });
    expect(decodeBody(await fetcher.fetch(`${SITE}/`))).toBe('café');
  });

  it('falls back to UTF-8 for an unknown charset', () => {
    expect(decodeBody({ body: Buffer.from('ok'), charset: 'x-made-up' })).toBe('ok');
  });
});

describe('createFetcher: URL rules', () => {
  it.each([
    ['http://127.0.0.1/', 'blocked_address'],
    ['http://169.254.169.254/latest/meta-data/', 'blocked_address'],
    ['http://localhost/', 'blocked_address'],
    ['file:///etc/passwd', 'invalid_url'],
    ['https://www.linkedin.com/jobs', 'login_required'],
  ])('refuses %s before any request', async (url, code) => {
    const { fetcher } = setup();
    const error = await failureOf(fetcher.fetch(url));
    expect(error).toMatchObject({ code, retriable: false });
  });

  it('refuses at connect a name that resolves to loopback (real safe dispatcher)', async () => {
    const dispatcher = createSafeDispatcher({
      connectTimeoutMs: 2_000,
      idleTimeoutMs: 2_000,
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    });
    const fetcher = createFetcher({ dispatcher });
    const error = await failureOf(fetcher.fetch('http://internal.example.com/'));
    expect(error).toMatchObject({ code: 'blocked_address', retriable: false });
    await dispatcher.close();
  });
});

describe('createFetcher: robots.txt', () => {
  it('refuses a disallowed page without requesting it', async () => {
    const { fetcher } = setup({}, 'User-agent: *\nDisallow: /careers\n');
    const error = await failureOf(fetcher.fetch(`${SITE}/careers`));
    expect(error).toMatchObject({ code: 'blocked_by_robots', retriable: false });
    agent.assertNoPendingInterceptors();
  });

  it.each([404, 403, 410])('treats a %i robots.txt as allowing everything', async (status) => {
    const { fetcher, site } = setup({}, status);
    site.intercept({ path: '/careers' }).reply(200, PAGE, { headers: HTML });
    await expect(fetcher.fetch(`${SITE}/careers`)).resolves.toMatchObject({ status: 200 });
  });

  it.each([500, 503, 429])('retries later when robots.txt answers %i', async (status) => {
    const { fetcher } = setup({}, status);
    const error = await failureOf(fetcher.fetch(`${SITE}/careers`));
    expect(error).toMatchObject({ code: 'http_error', retriable: true });
  });

  it('reads robots.txt once per site within a crawl', async () => {
    const { fetcher, site } = setup({}, 'User-agent: *\nDisallow: /private\n');
    site.intercept({ path: '/a' }).reply(200, PAGE, { headers: HTML });
    site.intercept({ path: '/b' }).reply(200, PAGE, { headers: HTML });
    await fetcher.fetch(`${SITE}/a`);
    await fetcher.fetch(`${SITE}/b`);
    agent.assertNoPendingInterceptors();
  });

  it('asks again after a failed robots.txt (a retry is not stuck on the old failure)', async () => {
    const { fetcher, site } = setup({}, 503);
    await failureOf(fetcher.fetch(`${SITE}/a`));
    site.intercept({ path: '/robots.txt' }).reply(404, '');
    site.intercept({ path: '/a' }).reply(200, PAGE, { headers: HTML });
    await expect(fetcher.fetch(`${SITE}/a`)).resolves.toMatchObject({ status: 200 });
  });

  it('treats a robots.txt redirect loop as allowing everything', async () => {
    newAgent();
    agent.disableNetConnect();
    const site = agent.get(SITE);
    site
      .intercept({ path: '/robots.txt' })
      .reply(301, '', { headers: { location: '/robots.txt' } })
      .times(6);
    site.intercept({ path: '/careers' }).reply(200, PAGE, { headers: HTML });
    const fetcher = createFetcher({ dispatcher: agent });
    await expect(fetcher.fetch(`${SITE}/careers`)).resolves.toMatchObject({ status: 200 });
  });

  it('checks robots.txt of every site a redirect leads to', async () => {
    const { fetcher, site } = setup();
    site
      .intercept({ path: '/careers' })
      .reply(302, '', { headers: { location: 'https://boards.example.org/acme' } });
    const board = agent.get('https://boards.example.org');
    board.intercept({ path: '/robots.txt' }).reply(200, 'User-agent: *\nDisallow: /\n');
    const error = await failureOf(fetcher.fetch(`${SITE}/careers`));
    expect(error.code).toBe('blocked_by_robots');
  });
});

describe('createFetcher: redirects', () => {
  it('follows relative and absolute redirects and reports them', async () => {
    const { fetcher, site } = setup();
    site.intercept({ path: '/jobs' }).reply(301, '', { headers: { location: '/careers' } });
    site
      .intercept({ path: '/careers' })
      .reply(302, '', { headers: { location: 'https://boards.example.org/acme' } });
    const board = agent.get('https://boards.example.org');
    board.intercept({ path: '/robots.txt' }).reply(404, '');
    board.intercept({ path: '/acme' }).reply(200, PAGE, { headers: HTML });

    const page = await fetcher.fetch(`${SITE}/jobs`);
    expect(page.url).toBe('https://boards.example.org/acme');
    expect(page.redirects).toEqual([`${SITE}/careers`, 'https://boards.example.org/acme']);
  });

  it.each([
    ['a private address', 'http://10.0.0.1/', 'blocked_address'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/', 'blocked_address'],
    ['localhost', 'http://localhost/admin', 'blocked_address'],
    ['another scheme', 'file:///etc/passwd', 'unsafe_redirect'],
    ['a non-standard port', 'https://jobs.example.com:8443/', 'unsafe_redirect'],
    ['http (downgrade from https)', 'http://jobs.example.com/careers', 'unsafe_redirect'],
    ['LinkedIn', 'https://www.linkedin.com/company/acme/jobs', 'login_required'],
    ['a sign-in page', '/users/sign_in?return=/careers', 'login_required'],
    ['an identity provider', 'https://login.microsoftonline.com/common/oauth2', 'login_required'],
  ])('refuses a redirect to %s', async (_, location, code) => {
    const { fetcher, site } = setup();
    site.intercept({ path: '/careers' }).reply(302, '', { headers: { location } });
    const error = await failureOf(fetcher.fetch(`${SITE}/careers`));
    expect(error).toMatchObject({ code, retriable: false });
  });

  it('allows an upgrade from http to https', async () => {
    newAgent();
    agent.disableNetConnect();
    const plain = agent.get('http://jobs.example.com');
    plain.intercept({ path: '/robots.txt' }).reply(404, '');
    plain
      .intercept({ path: '/careers' })
      .reply(301, '', { headers: { location: `${SITE}/careers` } });
    const secure = agent.get(SITE);
    secure.intercept({ path: '/robots.txt' }).reply(404, '');
    secure.intercept({ path: '/careers' }).reply(200, PAGE, { headers: HTML });
    const fetcher = createFetcher({ dispatcher: agent });
    await expect(fetcher.fetch('http://jobs.example.com/careers')).resolves.toMatchObject({
      url: `${SITE}/careers`,
    });
  });

  it('stops after 5 redirects', async () => {
    const { fetcher, site } = setup();
    for (let i = 0; i < 6; i += 1) {
      site.intercept({ path: `/r${i}` }).reply(302, '', { headers: { location: `/r${i + 1}` } });
    }
    const error = await failureOf(fetcher.fetch(`${SITE}/r0`));
    expect(error).toMatchObject({ code: 'too_many_redirects', retriable: false });
  });

  it('fails a redirect without a location', async () => {
    const { fetcher, site } = setup();
    site.intercept({ path: '/careers' }).reply(302, '');
    const error = await failureOf(fetcher.fetch(`${SITE}/careers`));
    expect(error).toMatchObject({ code: 'http_error', retriable: false });
  });

  it('turns a POST into a GET after a 303', async () => {
    const { fetcher, site } = setup();
    site
      .intercept({ path: '/search', method: 'POST' })
      .reply(303, '', { headers: { location: '/results' } });
    site
      .intercept({ path: '/results', method: 'GET' })
      .reply(200, '{}', { headers: { 'content-type': 'application/json' } });
    await expect(fetcher.fetch(`${SITE}/search`, { json: { q: 'x' } })).resolves.toMatchObject({
      status: 200,
    });
  });

  it('keeps the POST and its body after a 307', async () => {
    const { fetcher, site } = setup();
    site
      .intercept({ path: '/search', method: 'POST' })
      .reply(307, '', { headers: { location: '/v2/search' } });
    site
      .intercept({ path: '/v2/search', method: 'POST', body: '{"q":"x"}' })
      .reply(200, '{}', { headers: { 'content-type': 'application/json' } });
    await expect(fetcher.fetch(`${SITE}/search`, { json: { q: 'x' } })).resolves.toMatchObject({
      status: 200,
    });
  });
});

describe('createFetcher: responses', () => {
  it.each([
    [401, 'login_required', false],
    [403, 'blocked', false],
    [429, 'blocked', false],
    [404, 'not_found', false],
    [410, 'not_found', false],
    [400, 'http_error', false],
    [500, 'http_error', true],
    [502, 'http_error', true],
    [503, 'http_error', true],
  ])('maps HTTP %i to %s (retry: %s)', async (status, code, retriable) => {
    const { fetcher, site } = setup();
    site.intercept({ path: '/careers' }).reply(status, 'nope', { headers: HTML });
    const error = await failureOf(fetcher.fetch(`${SITE}/careers`));
    expect(error).toMatchObject({ code, retriable });
  });

  it('recognizes a bot challenge even with a 200 or 503', async () => {
    for (const status of [200, 403, 503]) {
      const { fetcher, site } = setup();
      site.intercept({ path: '/careers' }).reply(status, 'Just a moment...', {
        headers: { ...HTML, 'cf-mitigated': 'challenge' },
      });
      const error = await failureOf(fetcher.fetch(`${SITE}/careers`));
      expect(error).toMatchObject({ code: 'blocked', retriable: false });
    }
  });

  it('passes on a capped Retry-After', async () => {
    const { fetcher, site } = setup();
    site.intercept({ path: '/careers' }).reply(503, '', { headers: { 'retry-after': '9999' } });
    const error = await failureOf(fetcher.fetch(`${SITE}/careers`));
    expect(error.retryAfterSeconds).toBe(FETCH_LIMITS.maxRetryAfterSeconds);
  });

  it('refuses a sign-in form', async () => {
    const { fetcher, site } = setup();
    site
      .intercept({ path: '/careers' })
      .reply(200, '<form><input name="u"><input type="password" name="p"></form>', {
        headers: HTML,
      });
    const error = await failureOf(fetcher.fetch(`${SITE}/careers`));
    expect(error).toMatchObject({ code: 'login_required', retriable: false });
  });

  it.each([['application/pdf'], ['image/png'], ['application/octet-stream'], ['video/mp4']])(
    'refuses %s',
    async (type) => {
      const { fetcher, site } = setup();
      site.intercept({ path: '/file' }).reply(200, 'x', { headers: { 'content-type': type } });
      const error = await failureOf(fetcher.fetch(`${SITE}/file`));
      expect(error).toMatchObject({ code: 'unsupported_content', retriable: false });
    },
  );

  it('refuses a response without a content type', async () => {
    const { fetcher, site } = setup();
    site.intercept({ path: '/file' }).reply(200, 'x');
    const error = await failureOf(fetcher.fetch(`${SITE}/file`));
    expect(error.code).toBe('unsupported_content');
  });
});

describe('createFetcher: limits', () => {
  it('refuses a declared size over the limit without reading it', async () => {
    const { fetcher, site } = setup({ maxBytes: 1_000 });
    site.intercept({ path: '/big' }).reply(200, 'x'.repeat(2_000), {
      headers: { ...HTML, 'content-length': '2000' },
    });
    const error = await failureOf(fetcher.fetch(`${SITE}/big`));
    expect(error).toMatchObject({ code: 'too_large', retriable: false });
  });

  it('stops reading an undeclared body at the limit', async () => {
    const { fetcher, site } = setup({ maxBytes: 1_000 });
    site.intercept({ path: '/big' }).reply(200, 'x'.repeat(5_000), { headers: HTML });
    const error = await failureOf(fetcher.fetch(`${SITE}/big`));
    expect(error.code).toBe('too_large');
  });

  it('accepts a body exactly at the limit', async () => {
    const { fetcher, site } = setup({ maxBytes: 1_000 });
    site
      .intercept({ path: '/edge' })
      .reply(200, 'x'.repeat(1_000), { headers: { 'content-type': 'text/plain' } });
    expect((await fetcher.fetch(`${SITE}/edge`)).body.byteLength).toBe(1_000);
  });

  it('counts decompressed bytes, so a gzip bomb is stopped', async () => {
    const { fetcher, site } = setup({ maxBytes: 1024 * 1024 });
    const bomb = gzipSync(Buffer.alloc(20 * 1024 * 1024));
    expect(bomb.byteLength).toBeLessThan(100 * 1024);
    site.intercept({ path: '/bomb' }).reply(200, bomb, {
      headers: { ...HTML, 'content-encoding': 'gzip', 'content-length': String(bomb.byteLength) },
    });
    const error = await failureOf(fetcher.fetch(`${SITE}/bomb`));
    expect(error.code).toBe('too_large');
  });

  it('reads a normal gzip page', async () => {
    const { fetcher, site } = setup();
    site
      .intercept({ path: '/gz' })
      .reply(200, gzipSync(PAGE), { headers: { ...HTML, 'content-encoding': 'gzip' } });
    expect(decodeBody(await fetcher.fetch(`${SITE}/gz`))).toBe(PAGE);
  });

  it('gives up at the overall deadline and allows a retry', async () => {
    const { fetcher, site } = setup({ totalTimeoutMs: 200 });
    site.intercept({ path: '/slow' }).reply(200, PAGE, { headers: HTML }).delay(5_000);
    const error = await failureOf(fetcher.fetch(`${SITE}/slow`));
    expect(error).toMatchObject({ code: 'timeout', retriable: true });
  });

  it('reports a dropped connection as unreachable and retriable', async () => {
    const { fetcher, site } = setup();
    const reset: NodeJS.ErrnoException = new Error('socket hang up');
    reset.code = 'ECONNRESET';
    site.intercept({ path: '/careers' }).replyWithError(reset);
    const error = await failureOf(fetcher.fetch(`${SITE}/careers`));
    expect(error).toMatchObject({ code: 'unreachable', retriable: true });
  });
});

describe('classifyNetworkError', () => {
  const live = new AbortController().signal;
  const withCode = (code: string) => {
    const cause: NodeJS.ErrnoException = new Error(code);
    cause.code = code;
    return new TypeError('fetch failed', { cause });
  };

  it.each([
    ['ENOTFOUND', 'unreachable', true],
    ['EAI_AGAIN', 'unreachable', true],
    ['ECONNREFUSED', 'unreachable', true],
    ['ECONNRESET', 'unreachable', true],
    ['EHOSTUNREACH', 'unreachable', true],
    ['UND_ERR_SOCKET', 'unreachable', true],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout', true],
    ['UND_ERR_HEADERS_TIMEOUT', 'timeout', true],
    ['UND_ERR_BODY_TIMEOUT', 'timeout', true],
    ['ETIMEDOUT', 'timeout', true],
    ['CERT_HAS_EXPIRED', 'tls_error', false],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls_error', false],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls_error', false],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_error', false],
    ['ERR_SSL_WRONG_VERSION_NUMBER', 'tls_error', false],
  ])('%s → %s (retry: %s)', (errno, code, retriable) => {
    expect(classifyNetworkError(withCode(errno), live)).toMatchObject({ code, retriable });
  });

  it('finds a blocked address anywhere in the cause chain', () => {
    const error = new TypeError('fetch failed', {
      cause: new Error('connect', { cause: new BlockedAddressError('x') }),
    });
    expect(classifyNetworkError(error, live)).toMatchObject({
      code: 'blocked_address',
      retriable: false,
    });
  });

  it('treats anything after the deadline as a timeout', () => {
    expect(classifyNetworkError(new Error('aborted'), AbortSignal.abort())).toMatchObject({
      code: 'timeout',
    });
  });

  it('treats an unknown error as unreachable and retriable', () => {
    expect(classifyNetworkError(new Error('?'), live)).toMatchObject({
      code: 'unreachable',
      retriable: true,
    });
  });
});

describe('classifyStatus and parseRetryAfter', () => {
  it('accepts every 2xx', () => {
    for (const status of [200, 201, 203, 204, 206]) {
      expect(classifyStatus(status, new Headers(), FETCH_LIMITS, NOW)).toBeUndefined();
    }
  });

  it('refuses other 4xx without retry and proxy auth as a login', () => {
    expect(classifyStatus(418, new Headers(), FETCH_LIMITS, NOW)).toMatchObject({
      code: 'http_error',
      retriable: false,
    });
    expect(classifyStatus(407, new Headers(), FETCH_LIMITS, NOW)).toMatchObject({
      code: 'login_required',
    });
  });

  it.each([
    [null, undefined],
    ['', undefined],
    ['30', 30],
    ['0', 0],
    ['9999', 120],
    ['Mon, 28 Sep 2026 12:01:00 GMT', 60],
    ['Mon, 28 Sep 2026 11:00:00 GMT', 0],
    ['soon', undefined],
  ])('Retry-After %s → %s', (value, expected) => {
    expect(parseRetryAfter(value, NOW, 120)).toBe(expected);
  });
});
