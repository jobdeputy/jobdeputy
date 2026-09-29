import { ActiveCrawlError, type Crawl, type Source, sourceIdFor } from '@jobdeputy/db';
import type { APIGatewayProxyEventV2, APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { route as auditRoute } from '../src/audit.js';
import { type CrawlsDeps, route, STALE_CRAWL_MS } from '../src/crawls.js';
import { PAGES, handler as testSite } from '../src/test-site.js';

const NOW = Date.parse('2026-09-28T12:00:00.000Z');
const C1 = '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2D';
const C0 = '01J8ZQ4Y3N5W6X7Y8Z9A0B1C20';
const URL_ = 'https://jobs.example.com/careers';
const SOURCE = sourceIdFor(URL_);

function event(
  routeKey: string,
  extra: Record<string, unknown> = {},
  sub: string | null = 'user-a',
) {
  return {
    routeKey,
    requestContext: {
      requestId: 'req-1',
      ...(sub ? { authorizer: { jwt: { claims: { sub, username: `${sub}-n` } } } } : {}),
    },
    isBase64Encoded: false,
    ...extra,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}
const post = (url: unknown) => event('POST /me/crawls', { body: JSON.stringify({ url }) });

const crawl = (over: Partial<Crawl> = {}): Crawl => ({
  userId: 'user-a',
  crawlId: C1,
  type: 'crawl',
  sourceId: SOURCE,
  url: URL_,
  trigger: 'user',
  status: 'queued',
  attempts: 0,
  ttl: 1,
  createdAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
  schemaVersion: 1,
  ...over,
});

function deps(over: Partial<CrawlsDeps['repo']> = {}) {
  let n = 0;
  const repo = {
    request: vi.fn(async (input: Parameters<CrawlsDeps['repo']['request']>[0]) =>
      crawl({ crawlId: input.crawlId, sourceId: input.sourceId, url: input.normalizedUrl }),
    ),
    getSource: vi.fn(async (): Promise<Source | undefined> => undefined),
    getCrawl: vi.fn(async (): Promise<Crawl | undefined> => undefined),
    listCrawls: vi.fn(async () => ({ items: [crawl()] })),
    finish: vi.fn(async () => true),
    ...over,
  };
  const d: CrawlsDeps = {
    repo,
    newId: () => `01J8ZQ4Y3N5W6X7Y8Z9A0B1C${String(10 + (n++ % 90))}`,
    now: () => NOW,
    isBeingDeleted: vi.fn(async () => false),
  };
  return { d, repo };
}
const body = (res: { body: string }) => JSON.parse(res.body);

describe('POST /me/crawls', () => {
  it('queues a crawl and answers at once with its ID (202)', async () => {
    const { d, repo } = deps();
    const res = await route(post(' https://Jobs.Example.com/careers?utm_source=x#top '), d);
    expect(res.statusCode).toBe(202);
    expect(body(res)).toMatchObject({ status: 'queued', url: URL_, sourceId: SOURCE, attempts: 0 });
    const input = vi.mocked(repo.request).mock.calls[0]?.[0];
    expect(input).toMatchObject({
      userId: 'user-a',
      sourceId: SOURCE,
      normalizedUrl: URL_,
      url: 'https://Jobs.Example.com/careers?utm_source=x#top',
      audit: {
        name: 'crawl.requested',
        actor: 'user',
        summary: 'Crawl requested: jobs.example.com',
        entity: { type: 'crawl', id: input?.crawlId },
      },
    });
    expect(input?.replacing).toBeUndefined();
  });

  it('never shows storage keys', async () => {
    const { d } = deps({
      getCrawl: vi.fn(async () =>
        crawl({
          status: 'succeeded',
          result: {
            finalUrl: URL_,
            httpStatus: 200,
            contentType: 'text/html',
            bytes: 5,
            s3Key: 'derived/users/x',
          },
        }),
      ),
    });
    const res = await route(
      event('GET /me/crawls/{crawlId}', { pathParameters: { crawlId: C1 } }),
      d,
    );
    expect(res.body).not.toContain('s3Key');
    expect(res.body).not.toContain('derived/');
    expect(body(res).result).toEqual({
      finalUrl: URL_,
      httpStatus: 200,
      contentType: 'text/html',
      bytes: 5,
    });
  });

  it.each([
    ['a private address', 'http://169.254.169.254/latest/meta-data/', 'blocked_address'],
    ['loopback', 'http://127.0.0.1/', 'blocked_address'],
    ['localhost', 'http://localhost:80/', 'blocked_address'],
    ['LinkedIn', 'https://www.linkedin.com/jobs', 'login_required'],
    ['another scheme', 'file:///etc/passwd', 'invalid_url'],
  ])('refuses %s with a clear reason (400)', async (_, url, code) => {
    const { d, repo } = deps();
    const res = await route(post(url), d);
    expect(res.statusCode).toBe(400);
    expect(body(res)).toMatchObject({ code, title: 'This address cannot be crawled' });
    expect(repo.request).not.toHaveBeenCalled();
  });

  it.each([
    ['no URL', {}],
    ['extra fields', { url: URL_, userId: 'someone-else' }],
    ['a number', { url: 5 }],
  ])('rejects a body with %s', async (_, payload) => {
    const { d } = deps();
    const res = await route(event('POST /me/crawls', { body: JSON.stringify(payload) }), d);
    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const { d } = deps();
    expect((await route(event('POST /me/crawls', { body: '{' }), d)).statusCode).toBe(400);
  });

  it('returns the crawl already queued or running for the same page (200)', async () => {
    const running = crawl({ crawlId: C0, status: 'running', attempts: 1 });
    const { d, repo } = deps({
      request: vi.fn(async () => {
        throw new ActiveCrawlError();
      }),
      getSource: vi.fn(async () => ({ activeCrawlId: C0 }) as Source),
      getCrawl: vi.fn(async () => running),
    });
    const res = await route(post(URL_), d);
    expect(res.statusCode).toBe(200);
    expect(body(res)).toMatchObject({ crawlId: C0, status: 'running' });
    expect(repo.request).toHaveBeenCalledTimes(1);
    expect(repo.finish).not.toHaveBeenCalled();
  });

  it('replaces an active crawl that finished without freeing its page', async () => {
    let first = true;
    const { d, repo } = deps({
      request: vi.fn(async (input: Parameters<CrawlsDeps['repo']['request']>[0]) => {
        if (first) {
          first = false;
          throw new ActiveCrawlError();
        }
        return crawl({ crawlId: input.crawlId });
      }),
      getSource: vi.fn(async () => ({ activeCrawlId: C0 }) as Source),
      getCrawl: vi.fn(async () => crawl({ crawlId: C0, status: 'succeeded' })),
    });
    const res = await route(post(URL_), d);
    expect(res.statusCode).toBe(202);
    expect(vi.mocked(repo.request).mock.calls[1]?.[0].replacing).toBe(C0);
    expect(repo.finish).not.toHaveBeenCalled();
  });

  it('ends a stale active crawl clearly, then replaces it', async () => {
    let first = true;
    const stale = crawl({
      crawlId: C0,
      status: 'running',
      createdAt: new Date(NOW - STALE_CRAWL_MS - 1).toISOString(),
    });
    const { d, repo } = deps({
      request: vi.fn(async (input: Parameters<CrawlsDeps['repo']['request']>[0]) => {
        if (first) {
          first = false;
          throw new ActiveCrawlError();
        }
        return crawl({ crawlId: input.crawlId });
      }),
      getSource: vi.fn(async () => ({ activeCrawlId: C0 }) as Source),
      getCrawl: vi.fn(async () => stale),
    });
    const res = await route(post(URL_), d);
    expect(res.statusCode).toBe(202);
    expect(repo.finish).toHaveBeenCalledWith(
      stale,
      { status: 'failed', error: { code: 'internal', message: expect.any(String) } },
      expect.objectContaining({ name: 'crawl.failed', actor: 'system' }),
    );
    expect(vi.mocked(repo.request).mock.calls[1]?.[0].replacing).toBe(C0);
  });

  it('replaces an active crawl that no longer exists', async () => {
    let first = true;
    const { d, repo } = deps({
      request: vi.fn(async (input: Parameters<CrawlsDeps['repo']['request']>[0]) => {
        if (first) {
          first = false;
          throw new ActiveCrawlError();
        }
        return crawl({ crawlId: input.crawlId });
      }),
      getSource: vi.fn(async () => ({ activeCrawlId: C0 }) as Source),
    });
    expect((await route(post(URL_), d)).statusCode).toBe(202);
    expect(vi.mocked(repo.request).mock.calls[1]?.[0].replacing).toBe(C0);
  });

  it('gives up with 409 when another submit keeps winning the race', async () => {
    const { d, repo } = deps({
      request: vi.fn(async () => {
        throw new ActiveCrawlError();
      }),
      getSource: vi.fn(async () => ({ activeCrawlId: C0 }) as Source),
      getCrawl: vi.fn(async () => crawl({ crawlId: C0, status: 'failed' })),
    });
    expect((await route(post(URL_), d)).statusCode).toBe(409);
    expect(repo.request).toHaveBeenCalledTimes(2);
  });

  it('is refused while the account is being deleted (410)', async () => {
    const { d, repo } = deps();
    vi.mocked(d.isBeingDeleted).mockResolvedValue(true);
    const res = await route(post(URL_), d);
    expect(res.statusCode).toBe(410);
    expect(repo.request).not.toHaveBeenCalled();
  });

  it('requires a signed-in caller', async () => {
    const { d } = deps();
    expect((await route(event('POST /me/crawls', { body: '{}' }, null), d)).statusCode).toBe(401);
  });
});

describe('GET /me/crawls and /me/crawls/{crawlId}', () => {
  it('reads only the caller’s own crawl (404 otherwise)', async () => {
    const { d, repo } = deps();
    const res = await route(
      event('GET /me/crawls/{crawlId}', { pathParameters: { crawlId: C1 } }, 'user-b'),
      d,
    );
    expect(res.statusCode).toBe(404);
    expect(repo.getCrawl).toHaveBeenCalledWith('user-b', C1);
  });

  it('validates the crawl ID', async () => {
    const { d } = deps();
    const res = await route(
      event('GET /me/crawls/{crawlId}', { pathParameters: { crawlId: '../x' } }),
      d,
    );
    expect(res.statusCode).toBe(400);
  });

  it('lists newest first, a page at a time', async () => {
    const { d, repo } = deps({ listCrawls: vi.fn(async () => ({ items: [crawl()], next: C1 })) });
    const res = await route(
      event('GET /me/crawls', { queryStringParameters: { limit: '5', cursor: C0 } }),
      d,
    );
    expect(res.statusCode).toBe(200);
    expect(body(res)).toMatchObject({ crawls: [{ crawlId: C1 }], nextCursor: C1 });
    expect(repo.listCrawls).toHaveBeenCalledWith('user-a', 5, C0);
  });

  it.each([{ limit: '0' }, { limit: '51' }, { limit: 'x' }, { cursor: 'nope' }, { other: '1' }])(
    'rejects paging %o',
    async (query) => {
      const { d } = deps();
      expect(
        (await route(event('GET /me/crawls', { queryStringParameters: query }), d)).statusCode,
      ).toBe(400);
    },
  );

  it('uses 20 per page by default, and still reads while the account is being deleted', async () => {
    const { d, repo } = deps();
    vi.mocked(d.isBeingDeleted).mockResolvedValue(true);
    expect((await route(event('GET /me/crawls'), d)).statusCode).toBe(200);
    expect(repo.listCrawls).toHaveBeenCalledWith('user-a', 20, undefined);
  });
});

describe('GET /me/audit', () => {
  const entry = {
    userId: 'user-a',
    auditId: C1,
    type: 'audit' as const,
    name: 'crawl.requested',
    entity: { type: 'crawl', id: C0 },
    actor: 'user' as const,
    summary: 'Crawl requested: jobs.example.com',
    ttl: 1,
    createdAt: '2026-09-28T12:00:00.000Z',
    updatedAt: '2026-09-28T12:00:00.000Z',
    schemaVersion: 1 as const,
  };

  it('lists the caller’s entries newest first, without internal fields', async () => {
    const list = vi.fn(async () => ({ items: [entry], next: C1 }));
    const res = await auditRoute(
      event('GET /me/audit', { queryStringParameters: { limit: '10' } }),
      { repo: { list } },
    );
    expect(list).toHaveBeenCalledWith('user-a', 10, undefined);
    expect(body(res)).toEqual({
      entries: [
        {
          auditId: C1,
          name: 'crawl.requested',
          entity: { type: 'crawl', id: C0 },
          actor: 'user',
          summary: 'Crawl requested: jobs.example.com',
          at: '2026-09-28T12:00:00.000Z',
        },
      ],
      nextCursor: C1,
    });
  });

  it('requires a caller and valid paging', async () => {
    const list = vi.fn(async () => ({ items: [] }));
    expect(
      (await auditRoute(event('GET /me/audit', {}, null), { repo: { list } })).statusCode,
    ).toBe(401);
    expect(
      (
        await auditRoute(event('GET /me/audit', { queryStringParameters: { cursor: 'x' } }), {
          repo: { list },
        })
      ).statusCode,
    ).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });
});

describe('dev test site', () => {
  const visit = (page: string) =>
    testSite({ pathParameters: { page } } as unknown as APIGatewayProxyEventV2);

  it('serves each fixed page in dev', async () => {
    process.env.STAGE = 'dev';
    expect((await visit('jobs')).statusCode).toBe(200);
    expect((await visit('redirect-metadata')).headers.location).toBe(
      'http://169.254.169.254/latest/meta-data/',
    );
    expect((await visit('login')).body).toContain('type="password"');
    expect((await visit('shell')).body).toContain('id="root"');
    expect((await visit('blocked')).statusCode).toBe(403);
    expect((await visit('unavailable')).statusCode).toBe(503);
    expect(Object.keys(PAGES).sort()).toEqual([
      'blocked',
      'jobs',
      'login',
      'redirect-metadata',
      'shell',
      'unavailable',
    ]);
  });

  it('answers 404 for anything else, including object built-ins', async () => {
    process.env.STAGE = 'dev';
    for (const page of ['nope', 'constructor', '__proto__', 'toString']) {
      expect((await visit(page)).statusCode).toBe(404);
    }
  });

  it('serves nothing outside dev', async () => {
    process.env.STAGE = 'prod';
    expect((await visit('jobs')).statusCode).toBe(404);
    delete process.env.STAGE;
  });
});
