import type { CompanyShown, Job } from '@jobdeputy/db';
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

function deps(over: Partial<JobsDeps['repo']> = {}, shown: CompanyShown[] = []) {
  const repo = {
    list: vi.fn(async () => ({ items: [job()], next: J1 })),
    get: vi.fn(async (): Promise<Job | undefined> => job()),
    getMany: vi.fn(async (): Promise<Job[]> => []),
    ...over,
  };
  const companies = { listShown: vi.fn(async () => shown) };
  return { repo, companies } satisfies JobsDeps;
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

describe('GET /me/jobs: relevance (T08d)', () => {
  it("shows the LLM's score and reasons, never what it was computed from", async () => {
    const relevance = {
      score: 82,
      bestRoleId: 'R1',
      reasons: ['Same role and stack'],
      model: 'mistral.ministral-3-14b-instruct',
      promptVersion: 'relevance@v1',
      inputsHash: 'h'.repeat(32),
      scoredAt: '2026-10-01T06:00:00.000Z',
    };
    const d = deps({ list: vi.fn(async () => ({ items: [job({ relevance }), job()] })) });
    const [scored, unscored] = JSON.parse(
      (await route(event('GET /me/jobs'), d)).body as string,
    ).jobs;
    expect(scored.relevance).toEqual({
      score: 82,
      bestRoleId: 'R1',
      reasons: ['Same role and stack'],
      scoredAt: '2026-10-01T06:00:00.000Z',
    });
    expect(unscored).not.toHaveProperty('relevance');
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

describe('GET /me/companies (#49)', () => {
  const id = (c: string) => c.repeat(32);
  // Acme's best is scored 90; Globex's best 95; Initech has no score (scored jobs first).
  const shown: CompanyShown[] = [
    {
      companyKey: 'greenhouse:acme',
      shown: { [id('a')]: { p: 50, s: 70 }, [id('b')]: { p: 50, s: 90 } },
    },
    { companyKey: 'lever:globex', shown: { [id('c')]: { p: 10, s: 95 } } },
    { companyKey: 'ashby:initech', shown: { [id('d')]: { p: 100, t: '2026-11-01' } } },
  ];
  const stored = [
    job({ jobId: id('a'), title: 'A', companyKey: 'greenhouse:acme' }),
    job({ jobId: id('b'), title: 'B', companyKey: 'greenhouse:acme' }),
    job({ jobId: id('c'), title: 'C', companyKey: 'lever:globex', companyName: 'Globex' }),
    (({ companyName: _, ...rest }) => rest)(
      job({ jobId: id('d'), title: 'D', companyKey: 'ashby:initech' }),
    ),
  ];
  const getMany = vi.fn(async (_u: string, ids: string[]) =>
    stored.filter((j) => ids.includes(j.jobId)),
  );
  const call = async (query?: Record<string, string>, d = deps({ getMany }, shown)) => {
    const res = await route(event('GET /me/companies', { queryStringParameters: query }), d);
    return { status: res.statusCode, body: JSON.parse(res.body as string), d };
  };
  const view = (body: {
    companies: { companyKey: string; companyName?: string; jobs: { title: string }[] }[];
  }) =>
    body.companies.map(
      (c) => `${c.companyKey} ${c.companyName ?? '-'}: ${c.jobs.map((j) => j.title).join(',')}`,
    );

  it("lists the caller's companies by their best job, each with its jobs ranked", async () => {
    const { status, body, d } = await call();
    expect(status).toBe(200);
    expect(view(body)).toEqual([
      'lever:globex Globex: C',
      'greenhouse:acme Acme: B,A',
      'ashby:initech -: D',
    ]);
    expect(body).not.toHaveProperty('nextCursor');
    // Summaries only: no descriptions or internal fields.
    expect(body.companies[0].jobs[0]).not.toHaveProperty('description');
    expect(body.companies[0].jobs[0]).not.toHaveProperty('dedupeKey');
    expect(d.companies.listShown).toHaveBeenCalledWith('user-a');
    expect(getMany).toHaveBeenCalledWith('user-a', [id('c'), id('b'), id('a'), id('d')]);
  });

  it("pages with an opaque cursor, reading only the page's jobs", async () => {
    const first = await call({ limit: '2' });
    expect(view(first.body)).toEqual(['lever:globex Globex: C', 'greenhouse:acme Acme: B,A']);
    expect(typeof first.body.nextCursor).toBe('string');
    getMany.mockClear();
    const second = await call({ limit: '2', cursor: first.body.nextCursor });
    expect(view(second.body)).toEqual(['ashby:initech -: D']);
    expect(second.body).not.toHaveProperty('nextCursor');
    expect(getMany).toHaveBeenCalledWith('user-a', [id('d')]);
  });

  it('leaves out jobs hidden, closed or deleted since, and companies left with none', async () => {
    const gone = vi.fn(async () => [
      job({
        jobId: id('a'),
        title: 'A',
        filter: {
          state: 'not_relevant',
          roleIds: [],
          reasons: ['llm_low_score'],
          priority: 0,
          version: 1,
        },
      }),
      job({ jobId: id('b'), title: 'B', closedAt: '2026-11-20T00:00:00.000Z' }),
      job({
        jobId: id('c'),
        title: 'C',
        companyKey: 'lever:globex',
        limitState: 'over_limit',
      }),
    ]);
    const { body } = await call({}, deps({ getMany: gone }, shown));
    expect(body.companies).toEqual([]);
  });

  it('is empty before any crawl', async () => {
    const { body } = await call({}, deps({}, []));
    expect(body).toEqual({ companies: [] });
  });

  it('refuses a bad limit or cursor (400)', async () => {
    for (const query of [
      { limit: '0' },
      { limit: '11' },
      { cursor: 'not-base64-json' },
      { cursor: Buffer.from('{"jobId":"x","p":1}').toString('base64url') },
      { other: '1' },
    ]) {
      expect((await call(query)).status, JSON.stringify(query)).toBe(400);
    }
  });
});

describe('access', () => {
  it('401 without a caller; 404 for an unknown route', async () => {
    expect((await route(event('GET /me/jobs', {}, null), deps())).statusCode).toBe(401);
    expect((await route(event('GET /me/companies', {}, null), deps())).statusCode).toBe(401);
    expect((await route(event('DELETE /me/jobs/{jobId}'), deps())).statusCode).toBe(404);
  });
});
