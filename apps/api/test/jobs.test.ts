import type { Job } from '@jobdeputy/db';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { type JobsDeps, route } from '../src/jobs.js';

const J1 = 'a'.repeat(32);

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

const job = (over: Partial<Job> = {}): Job => ({
  userId: 'user-a',
  jobId: J1,
  type: 'job',
  dedupeKey: 'ats:greenhouse:acme:1',
  title: 'Backend Engineer',
  jobUrl: 'https://job-boards.greenhouse.io/acme/jobs/1',
  companyKey: 'greenhouse:acme',
  companyName: 'Acme',
  locations: [{ text: 'Dublin' }],
  contentHash: 'h',
  extraction: { method: 'ats_feed', version: 1 },
  ats: 'greenhouse',
  externalId: '1',
  description: 'Build things.',
  descriptionTruncated: false,
  descriptionHash: 'd',
  sourceIds: new Set(['S2', 'S1']),
  firstCrawlId: 'C1',
  lastCrawlId: 'C2',
  firstSeenAt: '2026-09-29T10:00:00.000Z',
  lastSeenAt: '2026-09-29T11:00:00.000Z',
  status: 'new',
  starred: false,
  createdAt: '2026-09-29T10:00:00.000Z',
  updatedAt: '2026-09-29T11:00:00.000Z',
  schemaVersion: 1,
  ...over,
});

function deps(over: Partial<JobsDeps['repo']> = {}) {
  const repo = {
    list: vi.fn(async () => ({ items: [job()], next: J1 })),
    get: vi.fn(async (): Promise<Job | undefined> => job()),
    ...over,
  };
  return { repo } satisfies JobsDeps;
}

describe('GET /me/jobs', () => {
  it("lists the caller's jobs without descriptions or internal fields", async () => {
    const d = deps();
    const res = await route(event('GET /me/jobs', { queryStringParameters: { limit: '5' } }), d);
    expect(res.statusCode).toBe(200);
    // Hidden jobs are left out unless asked for (T08c).
    expect(d.repo.list).toHaveBeenCalledWith('user-a', 5, undefined, 'shown');
    const body = JSON.parse(res.body as string);
    expect(body.nextCursor).toBe(J1);
    expect(body.jobs[0]).toMatchObject({
      jobId: J1,
      title: 'Backend Engineer',
      companyName: 'Acme',
      hasDescription: true,
      status: 'new',
      hidden: false,
    });
    // Not filtered yet (found before T08c): no verdict to show.
    expect(body.jobs[0]).not.toHaveProperty('fit');
    for (const hidden of ['description', 'userId', 'contentHash', 'descriptionHash', 'dedupeKey']) {
      expect(body.jobs[0], hidden).not.toHaveProperty(hidden);
    }
  });

  it('pages with a job-ID cursor, and refuses a bad one (400)', async () => {
    const d = deps();
    await route(event('GET /me/jobs', { queryStringParameters: { cursor: J1 } }), d);
    expect(d.repo.list).toHaveBeenCalledWith('user-a', 20, J1, 'shown');
    for (const query of [
      { cursor: 'not-a-job' },
      { limit: '51' },
      { other: 'x' },
      { view: 'hidden' },
    ]) {
      const res = await route(event('GET /me/jobs', { queryStringParameters: query }), d);
      expect(res.statusCode, JSON.stringify(query)).toBe(400);
    }
  });
});

describe('GET /me/jobs: fit (T08c)', () => {
  const filter = (state: 'candidate' | 'not_relevant', reasons: string[]) => ({
    state,
    roleIds: state === 'candidate' ? ['R1'] : [],
    reasons,
    priority: 50,
    version: 1,
  });

  it('view=all also lists hidden jobs, each saying why, and when it expires', async () => {
    const d = deps({
      list: vi.fn(async () => ({
        items: [
          job({ filter: filter('candidate', ['title_match']), limitState: 'counted' }),
          job({ filter: filter('not_relevant', ['place', 'seniority']), ttl: 1_790_000_000 }),
          job({
            filter: filter('candidate', ['title_match']),
            limitState: 'over_limit',
            ttl: 1_790_000_000,
          }),
        ],
      })),
    });
    const res = await route(event('GET /me/jobs', { queryStringParameters: { view: 'all' } }), d);
    expect(d.repo.list).toHaveBeenCalledWith('user-a', 20, undefined, 'all');
    const [shown, dropped, over] = JSON.parse(res.body as string).jobs;
    expect(shown).toMatchObject({
      hidden: false,
      fit: { state: 'candidate', roleIds: ['R1'], reasons: ['title_match'], limitState: 'counted' },
    });
    expect(shown).not.toHaveProperty('expiresAt');
    expect(dropped).toMatchObject({
      hidden: true,
      fit: { state: 'not_relevant', reasons: ['place', 'seniority'] },
      expiresAt: '2026-09-21T14:13:20.000Z',
    });
    expect(dropped.fit).not.toHaveProperty('limitState');
    expect(dropped.fit).not.toHaveProperty('priority');
    expect(over).toMatchObject({ hidden: true, fit: { limitState: 'over_limit' } });
  });
});

describe('GET /me/jobs/{jobId}', () => {
  it('shows one job in full, only to its owner', async () => {
    const d = deps();
    const res = await route(event('GET /me/jobs/{jobId}', { pathParameters: { jobId: J1 } }), d);
    expect(res.statusCode).toBe(200);
    expect(d.repo.get).toHaveBeenCalledWith('user-a', J1);
    expect(JSON.parse(res.body as string)).toMatchObject({
      description: 'Build things.',
      descriptionTruncated: false,
      sourceIds: ['S1', 'S2'],
      firstCrawlId: 'C1',
      lastCrawlId: 'C2',
    });
  });

  it('404 for a job the caller does not have; 400 for a bad ID', async () => {
    const d = deps({ get: vi.fn(async () => undefined) });
    expect(
      (await route(event('GET /me/jobs/{jobId}', { pathParameters: { jobId: J1 } }), d)).statusCode,
    ).toBe(404);
    expect(
      (await route(event('GET /me/jobs/{jobId}', { pathParameters: { jobId: '../x' } }), d))
        .statusCode,
    ).toBe(400);
  });
});

describe('access', () => {
  it('401 without a caller; 404 for an unknown route', async () => {
    expect((await route(event('GET /me/jobs', {}, null), deps())).statusCode).toBe(401);
    expect((await route(event('DELETE /me/jobs/{jobId}'), deps())).statusCode).toBe(404);
  });
});
