import type {
  AppliedCursor,
  CompanyShown,
  CrawlSettings,
  Job,
  StageGuard,
  StageResult,
} from '@jobdeputy/db';
import { DEFAULT_CRAWL_LIMITS, MATCH_SCORE_VERSION } from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { COMPANY_PAGE_READS, type JobsDeps, route } from '../src/jobs.js';

const J1 = 'a'.repeat(32);
const NOW = new Date('2026-10-10T12:00:00.000Z');

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

function deps(
  over: Partial<JobsDeps['repo']> = {},
  shown: CompanyShown[] = [],
  companyJobsLimit?: number,
) {
  const repo = {
    list: vi.fn(async () => ({ items: [job()], next: J1 })),
    get: vi.fn(async (): Promise<Job | undefined> => job()),
    getSummaries: vi.fn(async (): Promise<Job[]> => []),
    setStage: vi.fn(async (): Promise<StageResult> => ({ kind: 'ok', job: job() })),
    listApplied: vi.fn(
      async (): Promise<{ items: Job[]; next?: AppliedCursor }> => ({
        items: [],
      }),
    ),
    ...over,
  };
  const companies = { listShown: vi.fn(async () => shown) };
  const applications = {
    list: vi.fn(async () => new Map<string, Record<string, string>>()),
    guard: vi.fn(
      (_userId: string, _rule: () => Promise<unknown>): StageGuard => ({ check: async () => ({}) }),
    ),
  };
  const limits = vi.fn(async () => ({ ...DEFAULT_CRAWL_LIMITS }));
  const settings = {
    get: vi.fn(
      async (): Promise<CrawlSettings | undefined> =>
        companyJobsLimit === undefined
          ? undefined
          : ({ version: 1, companyJobsLimit } as CrawlSettings),
    ),
  };
  return {
    repo,
    companies,
    applications,
    limits,
    settings,
    isBeingDeleted: vi.fn(async () => false),
    audit: (name, entity, summary, detail) => ({
      table: 'audit',
      entry: { auditId: 'A1', name, entity, actor: 'user', summary, ...(detail ? { detail } : {}) },
    }),
    now: () => NOW,
  } satisfies JobsDeps;
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
  // As the projected read returns them: no description, only its hash (D has none).
  const getSummaries = vi.fn(async (_u: string, ids: string[]) =>
    stored
      .filter((j) => ids.includes(j.jobId))
      .map(({ description: _, ...j }) =>
        j.jobId === id('d') ? (({ descriptionHash: __, ...rest }) => rest)(j) : j,
      ),
  );
  const call = async (query?: Record<string, string>, d = deps({ getSummaries }, shown)) => {
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
    expect(body.companies[0].jobs[0].hasDescription).toBe(true);
    expect(body.companies[2].jobs[0].hasDescription).toBe(false);
    expect(body.companies[0].jobs[0]).not.toHaveProperty('dedupeKey');
    expect(d.companies.listShown).toHaveBeenCalledWith('user-a');
    expect(getSummaries).toHaveBeenCalledWith('user-a', [id('c'), id('b'), id('a'), id('d')]);
  });

  it("pages with an opaque cursor, reading only the page's jobs", async () => {
    const first = await call({ limit: '2' });
    expect(view(first.body)).toEqual(['lever:globex Globex: C', 'greenhouse:acme Acme: B,A']);
    expect(typeof first.body.nextCursor).toBe('string');
    getSummaries.mockClear();
    const second = await call({ limit: '2', cursor: first.body.nextCursor });
    expect(view(second.body)).toEqual(['ashby:initech -: D']);
    expect(second.body).not.toHaveProperty('nextCursor');
    expect(getSummaries).toHaveBeenCalledWith('user-a', [id('d')]);
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
    const { body } = await call({}, deps({ getSummaries: gone }, shown));
    expect(body.companies).toEqual([]);
  });

  it("caps each company at the user's jobs per company now, after leaving out hidden ones", async () => {
    const { body } = await call({}, deps({ getSummaries }, shown, 1));
    expect(view(body)).toEqual([
      'lever:globex Globex: C',
      'greenhouse:acme Acme: B',
      'ashby:initech -: D',
    ]);
    // A hidden best job lets the next one in.
    const hiddenBest = vi.fn(async (_u: string, ids: string[]) =>
      stored
        .filter((j) => ids.includes(j.jobId))
        .map((j) => (j.jobId === id('b') ? { ...j, limitState: 'over_limit' as const } : j)),
    );
    const capped = await call({}, deps({ getSummaries: hiddenBest }, shown, 1));
    expect(view(capped.body)).toContain('greenhouse:acme Acme: A');
  });

  it("uses the admin's default when the user chose none, or their setting can't be read", async () => {
    // A company ranked under the old default (10) still has 4 shown: 3 are listed.
    const four: CompanyShown[] = [
      {
        companyKey: 'greenhouse:acme',
        shown: Object.fromEntries(
          ['1', '2', '3', '4'].map((c, i) => [id(c), { p: 50, s: 90 - i }]),
        ),
      },
    ];
    const all = vi.fn(async (_u: string, ids: string[]) =>
      ids.map((jobId) => job({ jobId, title: jobId[0] ?? '' })),
    );
    const titles = async (d: ReturnType<typeof deps>) =>
      view((await call({}, d)).body as Parameters<typeof view>[0]);
    expect(await titles(deps({ getSummaries: all }, four))).toEqual([
      'greenhouse:acme Acme: 1,2,3',
    ]);
    const broken = deps({ getSummaries: all }, four, 1);
    broken.settings.get.mockRejectedValue(new Error('throttled'));
    expect(await titles(broken)).toEqual(['greenhouse:acme Acme: 1,2,3']);
  });

  it('fills a page with the next companies when hidden jobs leave some empty', async () => {
    // Globex (the best) and Acme have nothing shown any more: Initech fills the page of 1.
    const onlyD = vi.fn(async (_u: string, ids: string[]) =>
      stored.filter((j) => ids.includes(j.jobId) && j.jobId === id('d')),
    );
    const { body } = await call({ limit: '1' }, deps({ getSummaries: onlyD }, shown));
    expect(view(body)).toEqual(['ashby:initech -: D']);
    expect(body).not.toHaveProperty('nextCursor');
    expect(onlyD).toHaveBeenCalledTimes(3); // one per company, all within COMPANY_PAGE_READS
  });

  it('stops filling after a few reads, with a cursor past what it read', async () => {
    const many: CompanyShown[] = Array.from({ length: 5 }, (_, i) => ({
      companyKey: `co:${i}`,
      shown: { [String(i).repeat(32)]: { p: 50, s: 90 - i } },
    }));
    const none = vi.fn(async () => []);
    const first = await call({ limit: '1' }, deps({ getSummaries: none }, many));
    expect(first.body.companies).toEqual([]);
    expect(none).toHaveBeenCalledTimes(COMPANY_PAGE_READS);
    // The next page starts after the last company read.
    const fourth = vi.fn(async (_u: string, ids: string[]) =>
      ids.map((jobId) => job({ jobId, title: jobId[0] ?? '', companyKey: `co:${jobId[0]}` })),
    );
    const next = await call(
      { limit: '1', cursor: first.body.nextCursor },
      deps({ getSummaries: fourth }, many),
    );
    const n = COMPANY_PAGE_READS;
    expect(view(next.body)).toEqual([`co:${n} Acme: ${n}`]);
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

describe('GET /me/matches (#52)', () => {
  const id = (c: string) => c.repeat(32);
  const recent = '2026-10-05T00:00:00.000Z';
  // Acme ranks a (90) over b (70) over e (50); Globex has c (95); Initech d, unscored.
  const shown: CompanyShown[] = [
    {
      companyKey: 'greenhouse:acme',
      shown: {
        [id('a')]: { p: 50, s: 90 },
        [id('b')]: { p: 50, s: 70 },
        [id('e')]: { p: 50, s: 50 },
      },
    },
    { companyKey: 'lever:globex', shown: { [id('c')]: { p: 10, s: 95 } } },
    { companyKey: 'ashby:initech', shown: { [id('d')]: { p: 100 } } },
  ];
  const stored = (over: Record<string, Partial<Job>> = {}) =>
    ['a', 'b', 'c', 'd', 'e'].map((c) =>
      job({ jobId: id(c), title: c.toUpperCase(), lastSeenAt: recent, ...over[c] }),
    );
  const call = async (jobs: Job[], perCompany?: number, query?: Record<string, string>) => {
    const getSummaries = vi.fn(async (_u: string, ids: string[]) =>
      jobs.filter((j) => ids.includes(j.jobId)),
    );
    const d = deps({ getSummaries }, shown, perCompany);
    const res = await route(event('GET /me/matches', { queryStringParameters: query }), d);
    const body = res.statusCode === 200 ? JSON.parse(res.body as string) : undefined;
    return {
      status: res.statusCode,
      titles: body?.jobs.map((j: { title: string }) => j.title),
      truncated: body?.truncated,
      getSummaries,
    };
  };

  it('lists every shown job across companies, best first, in one answer', async () => {
    const r = await call(stored());
    expect(r.titles).toEqual(['C', 'A', 'B', 'E', 'D']);
    expect(r.truncated).toBe(false);
  });

  it("gives each job its tailored résumé's score, only when made by today's score code (#51)", async () => {
    const match = (version: number) => ({
      resumeDocumentId: 'R'.repeat(26),
      score: 82,
      base: 61,
      missing: ['Kafka'],
      version,
      scoredAt: recent,
    });
    const jobs = stored({ a: { match: match(MATCH_SCORE_VERSION) }, b: { match: match(-1) } });
    const getSummaries = vi.fn(async (_u: string, ids: string[]) =>
      jobs.filter((j) => ids.includes(j.jobId)),
    );
    const res = await route(event('GET /me/matches'), deps({ getSummaries }, shown));
    const byTitle = Object.fromEntries(
      JSON.parse(res.body as string).jobs.map((j: { title: string }) => [j.title, j]),
    );
    expect(byTitle.A.match).toEqual({ score: 82, base: 61, resumeDocumentId: 'R'.repeat(26) });
    expect(byTitle.B).not.toHaveProperty('match');
    expect(byTitle.C).not.toHaveProperty('match');
  });

  it('leaves out jobs applied to, closed, hidden, or not seen in 30 days; no refill', async () => {
    const r = await call(
      stored({
        a: { status: 'applied', appliedAt: recent },
        c: { closedAt: recent },
        d: { lastSeenAt: '2026-09-09T11:59:59.000Z' },
        e: { limitState: 'over_limit' },
      }),
      2,
    );
    // Acme's places are a and b (2 per company): a was applied to, so only b is left; e
    // (third, and hidden) does not take a's place.
    expect(r.titles).toEqual(['B']);
  });

  it('marks every job of a company cooling down, until its oldest counted application ages out (PR E)', async () => {
    const getSummaries = vi.fn(async (_u: string, ids: string[]) =>
      stored({ c: { companyKey: 'lever:globex' }, d: { companyKey: 'ashby:initech' } }).filter(
        (j) => ids.includes(j.jobId),
      ),
    );
    const d = deps({ getSummaries }, shown);
    d.applications.list.mockResolvedValue(
      new Map([
        // Acme: 3 within 30 days (the oldest ends the cooldown); one older does not count.
        [
          'greenhouse:acme',
          {
            x1: '2026-09-01T00:00:00.000Z',
            x2: '2026-09-20T08:00:00.000Z',
            x3: '2026-10-01T00:00:00.000Z',
            x4: '2026-10-09T00:00:00.000Z',
          },
        ],
        // Globex: 3, but one is job C's own (undone after a later stage): it never counts
        // against applying to C again, as the stage change counts.
        [
          'lever:globex',
          {
            [id('c')]: '2026-10-03T00:00:00.000Z',
            x5: '2026-10-01T00:00:00.000Z',
            x6: '2026-10-02T00:00:00.000Z',
          },
        ],
      ]),
    );
    const res = await route(event('GET /me/matches'), d);
    const body = JSON.parse(res.body as string);
    const until = Object.fromEntries(
      body.jobs.map((j: { title: string; coolingDownUntil?: string }) => [
        j.title,
        j.coolingDownUntil,
      ]),
    );
    expect(until).toEqual({
      A: '2026-10-20T08:00:00.000Z',
      B: '2026-10-20T08:00:00.000Z',
      E: '2026-10-20T08:00:00.000Z',
      C: undefined,
      D: undefined,
    });
    expect(body.cooldown).toEqual({ limit: 3, days: 30 });
    expect(d.applications.list).toHaveBeenCalledWith('user-a');
  });

  it('keeps a job last seen exactly 30 days ago', async () => {
    const r = await call(stored({ d: { lastSeenAt: '2026-09-10T12:00:00.000Z' } }));
    expect(r.titles).toContain('D');
  });

  it('returns the best 500 and says more qualified', async () => {
    const many: CompanyShown[] = Array.from({ length: 260 }, (_, i) => ({
      companyKey: `greenhouse:c${i}`,
      shown: {
        [`${i}`.padStart(16, '0').padEnd(32, '1')]: { p: 1 },
        [`${i}`.padStart(16, '0').padEnd(32, '2')]: { p: 1 },
      },
    }));
    const getSummaries = vi.fn(async (_u: string, ids: string[]) =>
      ids.map((jobId) => job({ jobId, lastSeenAt: recent })),
    );
    const res = await route(event('GET /me/matches'), deps({ getSummaries }, many));
    const body = JSON.parse(res.body as string);
    expect(body.jobs).toHaveLength(500);
    expect(body.truncated).toBe(true);
    // Read in batches of at most 100 (DynamoDB's limit for one BatchGetItem).
    expect(getSummaries.mock.calls.map((c) => c[1].length)).toEqual([100, 100, 100, 100, 100, 20]);
  });

  it('an applied job keeps its place even when a later crawl hid it', async () => {
    const r = await call(
      stored({ a: { status: 'applied', appliedAt: recent, limitState: 'over_limit' } }),
      2,
    );
    // Acme's places: a (applied, hidden since) and b; e stays out.
    expect(r.titles).toEqual(['C', 'B', 'D']);
  });

  it('a closed or hidden job takes no place in its company; an applied one does', async () => {
    // Acme's places with 2 per company: a is closed, so b and e; b was applied to: only E.
    const r = await call(
      stored({ a: { closedAt: recent }, b: { status: 'offer', appliedAt: recent } }),
      2,
    );
    expect(r.titles).toEqual(['C', 'E', 'D']);
  });

  it('400 for any query parameter', async () => {
    expect((await call(stored(), undefined, { limit: '10' })).status).toBe(400);
  });
});

describe('GET /me/applications (#52)', () => {
  const applied = job({ status: 'interviewing', appliedAt: '2026-10-01T00:00:00.000Z' });
  const cursorOf = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

  it('pages the applied jobs newest first, with an opaque cursor', async () => {
    const next = { jobId: J1, appliedAt: '2026-10-01T00:00:00.000Z' };
    const listApplied = vi.fn(async () => ({ items: [applied], next }));
    const d = deps({ listApplied });
    const res = await route(
      event('GET /me/applications', { queryStringParameters: { limit: '2' } }),
      d,
    );
    const body = JSON.parse(res.body as string);
    expect(body.jobs[0]).toMatchObject({ status: 'interviewing', appliedAt: next.appliedAt });
    expect(body.jobs[0].description).toBeUndefined();
    expect(body.nextCursor).toBe(cursorOf(next));
    expect(listApplied).toHaveBeenCalledWith('user-a', 2, undefined);

    await route(
      event('GET /me/applications', { queryStringParameters: { cursor: body.nextCursor } }),
      d,
    );
    expect(listApplied).toHaveBeenLastCalledWith('user-a', 50, next);
  });

  it('400 for a bad limit or cursor', async () => {
    for (const query of [
      { limit: '51' },
      { cursor: 'not-json' },
      { cursor: cursorOf({ jobId: 'x', appliedAt: '2026-10-01T00:00:00.000Z' }) },
      { cursor: cursorOf({ jobId: J1 }) },
      { other: '1' },
    ]) {
      const res = await route(
        event('GET /me/applications', { queryStringParameters: query }),
        deps(),
      );
      expect(res.statusCode, JSON.stringify(query)).toBe(400);
    }
  });
});

describe('PUT /me/jobs/{jobId}/stage (#52)', () => {
  const put = (body: unknown, d = deps(), jobId = J1) =>
    route(
      event('PUT /me/jobs/{jobId}/stage', {
        pathParameters: { jobId },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      d,
    );

  it('moves the job and records who did what in the audit entry', async () => {
    const d = deps({
      setStage: vi.fn(async () => ({
        kind: 'ok' as const,
        job: job({ status: 'applied', appliedAt: NOW.toISOString(), stageAt: NOW.toISOString() }),
      })),
    });
    const res = await put({ stage: 'applied', from: 'new' }, d);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string)).toMatchObject({
      status: 'applied',
      appliedAt: NOW.toISOString(),
    });
    expect(d.repo.setStage).toHaveBeenCalledWith(
      'user-a',
      J1,
      { stage: 'applied', from: 'new' },
      {
        table: 'audit',
        entry: expect.objectContaining({
          name: 'job.stage_changed',
          entity: { type: 'job', id: J1 },
          detail: { from: 'new', stage: 'applied' },
        }),
      },
      expect.any(Function),
      d.applications.guard.mock.results[0]?.value,
    );
    // The admin's limits are read only when needed: the expiry (7 days from now, an undo on a
    // hidden job) and #52 PR E's cooldown rule (3 in 30 days by default; applying or undoing).
    expect(d.limits).not.toHaveBeenCalled();
    const expiry = vi.mocked(d.repo.setStage).mock.calls[0]?.[4] as () => Promise<number>;
    expect(await expiry()).toBe(NOW.getTime() / 1000 + 7 * 86_400);
    const rule = d.applications.guard.mock.calls[0]?.[1] as () => Promise<unknown>;
    expect(d.applications.guard.mock.calls[0]?.[0]).toBe('user-a');
    expect(await rule()).toEqual({ limit: 3, days: 30 });
  });

  it('409 stage-changed when the job moved meanwhile; 404 when it is gone', async () => {
    const conflict = await put(
      { stage: 'offer', from: 'applied' },
      deps({ setStage: vi.fn(async () => ({ kind: 'conflict' as const, job: job() })) }),
    );
    expect(conflict.statusCode).toBe(409);
    expect(JSON.parse(conflict.body as string)).toMatchObject({
      code: 'stage-changed',
      job: { jobId: J1, status: 'new' },
    });
    const gone = await put(
      { stage: 'offer', from: 'applied' },
      deps({ setStage: vi.fn(async () => ({ kind: 'not-found' as const })) }),
    );
    expect(gone.statusCode).toBe(404);
  });

  it('409 cooling-down with when it ends and the job, when the company cools down (PR E)', async () => {
    const until = '2026-10-20T09:00:00.000Z';
    const d = deps({
      setStage: vi.fn(async () => ({
        kind: 'cooling-down' as const,
        job: job(),
        until,
        limit: 2,
        days: 14,
      })),
    });
    const res = await put({ stage: 'applied', from: 'new' }, d);
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body as string);
    expect(body).toMatchObject({ code: 'cooling-down', until, job: { jobId: J1, status: 'new' } });
    expect(body.detail).toBe('You reached the limit of 2 applications to this company in 14 days.');
    const one = await put(
      { stage: 'applied', from: 'new' },
      deps({
        setStage: vi.fn(async () => ({
          kind: 'cooling-down' as const,
          job: job(),
          until,
          limit: 1,
          days: 1,
        })),
      }),
    );
    expect(JSON.parse(one.body as string).detail).toBe(
      'You reached the limit of 1 application to this company in 1 day.',
    );
  });

  it('409 try-again when the write kept colliding', async () => {
    const { ConcurrentUpdateError } = await import('@jobdeputy/db');
    const res = await put(
      { stage: 'applied', from: 'new' },
      deps({ setStage: vi.fn(async () => Promise.reject(new ConcurrentUpdateError('busy'))) }),
    );
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body as string).code).toBe('try-again');
  });

  it('400 for a bad body or job ID, before any write', async () => {
    const d = deps();
    for (const body of [
      '{not json',
      {},
      { stage: 'applied' },
      { stage: 'shortlisted', from: 'new' },
      // Nothing but applied has an applied date: a new job cannot skip to a later stage.
      { stage: 'withdrawn', from: 'new' },
      { stage: 'interviewing', from: 'new' },
      // Undo only from applied: a later stage is history.
      { stage: 'new', from: 'offer' },
      { stage: 'new', from: 'withdrawn' },
      { stage: 'applied', from: 'new', extra: 1 },
    ]) {
      expect((await put(body, d)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await put({ stage: 'applied', from: 'new' }, d, '../x')).statusCode).toBe(400);
    expect(d.repo.setStage).not.toHaveBeenCalled();
  });

  it('410 while the account is being deleted; reads still work', async () => {
    const d = { ...deps(), isBeingDeleted: vi.fn(async () => true) };
    expect((await put({ stage: 'applied', from: 'new' }, d)).statusCode).toBe(410);
    expect(d.repo.setStage).not.toHaveBeenCalled();
    expect((await route(event('GET /me/matches'), d)).statusCode).toBe(200);
  });
});

describe('access', () => {
  it('401 without a caller; 404 for an unknown route', async () => {
    expect((await route(event('GET /me/jobs', {}, null), deps())).statusCode).toBe(401);
    expect((await route(event('GET /me/companies', {}, null), deps())).statusCode).toBe(401);
    expect((await route(event('GET /me/matches', {}, null), deps())).statusCode).toBe(401);
    expect((await route(event('GET /me/applications', {}, null), deps())).statusCode).toBe(401);
    expect((await route(event('PUT /me/jobs/{jobId}/stage', {}, null), deps())).statusCode).toBe(
      401,
    );
    expect((await route(event('DELETE /me/jobs/{jobId}'), deps())).statusCode).toBe(404);
  });
});
