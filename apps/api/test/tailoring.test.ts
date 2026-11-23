import {
  type Document,
  type GeneratedDocument,
  type JobSummaryItem,
  TailoringAllowanceError,
  TailoringBusyError,
} from '@jobdeputy/db';
import {
  PLATFORM_TAILORINGS_PER_MONTH,
  type StructuredResume,
  TAILORING_STALE_MS,
  tailoringKeys,
} from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { route, TAILORING_JOBS, type TailoringDeps, tailoringView } from '../src/tailoring.js';

const NOW = new Date('2026-11-22T06:00:00.000Z');
const DOC = '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2D';
const BASE = '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2E';
const job = (n: number) => `${String(n).repeat(32)}`.slice(0, 32);

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

const post = (body: unknown) => event('POST /me/tailorings', { body: JSON.stringify(body) });

function version(over: Partial<GeneratedDocument> = {}): GeneratedDocument {
  return {
    userId: 'user-a',
    documentId: DOC,
    type: 'document',
    kind: 'resume',
    origin: 'generated',
    status: 'queued',
    title: 'Résumé for Acme',
    companyKey: 'greenhouse:acme',
    companyName: 'Acme',
    jobIds: [job(1)],
    baseDocumentId: BASE,
    aiSource: 'platform',
    platformRun: true,
    tailoring: { calls: 0, attempts: 0 },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    schemaVersion: 1,
    ...over,
  };
}

const uploaded = (over: Partial<Document> = {}) =>
  ({
    documentId: BASE,
    isDefault: true,
    status: 'ready',
    parsed: { textS3Key: 'k', charCount: 10, noText: false, truncated: false },
    ...over,
  }) as Document;

const summary = (id: string, over: Partial<JobSummaryItem> = {}) =>
  ({ jobId: id, title: 'Engineer', companyName: 'Acme', ...over }) as JobSummaryItem;

const RESUME: StructuredResume = {
  contact: { name: 'Sam Example', links: [] },
  skills: [],
  experience: [{ id: 'e1', employer: 'Acme', title: 'Dev', bullets: [] }],
  education: [],
  certifications: [],
  projects: [],
};

function setup(over: Partial<TailoringDeps> = {}) {
  const runs = {
    request: vi.fn(async (doc: Parameters<TailoringDeps['runs']['request']>[0]) =>
      version({ ...doc, status: 'queued' }),
    ),
    list: vi.fn(async (): Promise<GeneratedDocument[]> => []),
    get: vi.fn(async (): Promise<GeneratedDocument | undefined> => undefined),
    platformRunsUsed: vi.fn(async () => 2),
  };
  const deps: TailoringDeps = {
    runs,
    documents: { list: vi.fn(async () => [uploaded()]) },
    shown: {
      get: vi.fn(async () => ({
        version: 1,
        shown: { [job(2)]: { p: 50, s: 60 }, [job(1)]: { p: 50, s: 90 }, [job(3)]: { p: 50 } },
      })),
    },
    companyJobsLimit: vi.fn(async () => 10),
    jobs: {
      getSummaries: vi.fn(async (_: string, ids: string[]) => ids.map((id) => summary(id))),
    },
    keys: { get: vi.fn(async () => undefined), getSettings: vi.fn(async () => undefined) },
    readFile: vi.fn(async () => JSON.stringify(RESUME)),
    presignDownload: vi.fn(async (key: string, name: string) => `https://s3/${key}?name=${name}`),
    allowTestProvider: true,
    newId: () => DOC,
    now: () => NOW,
    isBeingDeleted: async () => false,
    audit: (name, entity, summaryText) => ({
      table: 'audit',
      entry: { auditId: 'a1', name, entity, actor: 'user', summary: summaryText },
    }),
    ...over,
  };
  return { deps, runs };
}

const body = (res: { body: string }) => JSON.parse(res.body);

describe('POST /me/tailorings', () => {
  it('queues a version for the company’s best shown jobs on the default résumé (202)', async () => {
    const { deps, runs } = setup();
    const res = await route(post({ companyKey: 'greenhouse:acme' }), deps);
    expect(res.statusCode).toBe(202);
    expect(runs.request).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-a',
        documentId: DOC,
        companyKey: 'greenhouse:acme',
        companyName: 'Acme',
        // Scored first, best score first.
        jobIds: [job(1), job(2), job(3)],
        baseDocumentId: BASE,
        aiSource: 'platform',
        platformRun: true,
      }),
      expect.objectContaining({ entry: expect.objectContaining({ name: 'tailoring.requested' }) }),
      { perMonth: PLATFORM_TAILORINGS_PER_MONTH, staleMs: TAILORING_STALE_MS },
    );
    expect(body(res).tailoring).toMatchObject({ documentId: DOC, status: 'queued' });
  });

  it(`takes at most ${TAILORING_JOBS} jobs, leaving out closed and hidden ones`, async () => {
    const shown = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [job(n), { p: 100 - n }]));
    const { deps, runs } = setup({
      shown: { get: async () => ({ version: 1, shown }) },
      jobs: {
        getSummaries: async (_, ids) =>
          ids.map((id) =>
            summary(id, {
              ...(id === job(1) ? { closedAt: NOW.toISOString() } : {}),
              ...(id === job(2)
                ? {
                    filter: {
                      state: 'not_relevant',
                      roleIds: [],
                      reasons: [],
                      priority: 0,
                      version: 1,
                    },
                  }
                : {}),
              ...(id === job(3) ? { limitState: 'over_limit' } : {}),
            }),
          ),
      },
    });
    await route(post({ companyKey: 'greenhouse:acme' }), deps);
    expect(runs.request.mock.calls[0]?.[0].jobIds).toEqual([job(4), job(5), job(6)]);
  });

  it('never takes more jobs than the user sees per company', async () => {
    const { deps, runs } = setup({ companyJobsLimit: async () => 1 });
    await route(post({ companyKey: 'greenhouse:acme' }), deps);
    expect(runs.request.mock.calls[0]?.[0].jobIds).toEqual([job(1)]);
  });

  it('uses the user’s default AI source, and refuses none or a key that does not work', async () => {
    const own = setup({
      keys: {
        get: async () => ({ status: 'valid' }) as never,
        getSettings: async () => ({ defaultSource: 'stub' }) as never,
      },
    });
    await route(post({ companyKey: 'greenhouse:acme' }), own.deps);
    expect(own.runs.request.mock.calls[0]?.[0]).toMatchObject({
      aiSource: 'stub',
      platformRun: false,
    });

    const none = await route(
      post({ companyKey: 'greenhouse:acme', aiSource: 'none' }),
      setup().deps,
    );
    expect(none.statusCode).toBe(422);
    expect(body(none).code).toBe('model_needed');

    const broken = setup({
      keys: {
        get: async () => ({ status: 'invalid' }) as never,
        getSettings: async () => undefined,
      },
    });
    expect(
      (await route(post({ companyKey: 'greenhouse:acme', aiSource: 'stub' }), broken.deps))
        .statusCode,
    ).toBe(422);
    const missing = await route(
      post({ companyKey: 'greenhouse:acme', aiSource: 'stub' }),
      setup().deps,
    );
    expect(missing.statusCode).toBe(422);
  });

  it('refuses without a usable default résumé, or without shown jobs (422, with a code)', async () => {
    for (const docs of [
      [],
      [uploaded({ isDefault: false })],
      [uploaded({ status: 'processing' })],
      [uploaded({ parsed: { textS3Key: 'k', charCount: 0, noText: true, truncated: false } })],
    ]) {
      const res = await route(
        post({ companyKey: 'x' }),
        setup({ documents: { list: async () => docs } }).deps,
      );
      expect(res.statusCode).toBe(422);
      expect(body(res).code).toBe('no_resume');
    }
    const empty = setup({ shown: { get: async () => ({ version: 0, shown: {} }) } });
    const res = await route(post({ companyKey: 'x' }), empty.deps);
    expect(body(res).code).toBe('no_jobs');
    expect(empty.runs.request).not.toHaveBeenCalled();
  });

  it('answers 429 with retry-after when the free allowance is used up, 409 while one runs', async () => {
    const used = setup();
    used.runs.request.mockRejectedValueOnce(new TailoringAllowanceError());
    const res = await route(post({ companyKey: 'greenhouse:acme' }), used.deps);
    expect(res.statusCode).toBe(429);
    expect(body(res).code).toBe('tailoring_allowance');
    // 2026-12-01T00:00Z is 8 days and 18 hours after NOW.
    expect(res.headers['retry-after']).toBe(String(8 * 86_400 + 18 * 3_600));

    const busy = setup();
    busy.runs.request.mockRejectedValueOnce(new TailoringBusyError(DOC));
    const conflict = await route(post({ companyKey: 'greenhouse:acme' }), busy.deps);
    expect(conflict.statusCode).toBe(409);
    expect(body(conflict).code).toBe('tailoring_busy');
  });

  it('validates the body', async () => {
    const { deps } = setup();
    expect((await route(post({}), deps)).statusCode).toBe(400);
    expect((await route(post({ companyKey: 'a', extra: 1 }), deps)).statusCode).toBe(400);
    expect((await route(event('POST /me/tailorings', { body: 'not json' }), deps)).statusCode).toBe(
      400,
    );
  });

  it('refuses writes while the account is being deleted, and callers without a token', async () => {
    const { deps } = setup({ isBeingDeleted: async () => true });
    expect((await route(post({ companyKey: 'a' }), deps)).statusCode).toBe(410);
    expect((await route(event('GET /me/tailorings', {}, null), deps)).statusCode).toBe(401);
  });
});

describe('GET /me/tailorings', () => {
  it('lists a company’s versions with the free allowance', async () => {
    const { deps, runs } = setup();
    runs.list.mockResolvedValueOnce([version()]);
    const res = await route(
      event('GET /me/tailorings', { queryStringParameters: { companyKey: 'greenhouse:acme' } }),
      deps,
    );
    expect(res.statusCode).toBe(200);
    expect(runs.list).toHaveBeenCalledWith('user-a', 'greenhouse:acme');
    expect(body(res)).toEqual({
      tailorings: [expect.objectContaining({ documentId: DOC, status: 'queued' })],
      allowance: {
        used: 2,
        perMonth: PLATFORM_TAILORINGS_PER_MONTH,
        nextAt: '2026-12-01T00:00:00.000Z',
      },
    });
    expect((await route(event('GET /me/tailorings'), deps)).statusCode).toBe(400);
  });
});

describe('GET /me/tailorings/{documentId}', () => {
  const get = () =>
    event('GET /me/tailorings/{documentId}', { pathParameters: { documentId: DOC } });

  it('shows a ready version with its résumé and both downloads, no storage keys', async () => {
    const { deps, runs } = setup();
    runs.get.mockResolvedValueOnce(
      version({
        status: 'ready',
        s3Key: tailoringKeys('user-a', DOC).pdf,
        fileName: 'Sam Example – Acme.pdf',
        sizeBytes: 1000,
        tailoring: {
          calls: 3,
          attempts: 1,
          result: 'partial',
          coverage: 0.95,
          scores: [
            { jobId: job(1), base: 55, tailored: 70, missingProven: [], missingUnproven: ['AWS'] },
          ],
          finishedAt: NOW.toISOString(),
        },
      }),
    );
    const res = await route(get(), deps);
    const view = body(res);
    expect(view).toMatchObject({
      status: 'ready',
      result: 'partial',
      coverage: 0.95,
      fileName: 'Sam Example – Acme.pdf',
      resume: RESUME,
      downloads: {
        pdf: `https://s3/${tailoringKeys('user-a', DOC).pdf}?name=Sam Example – Acme.pdf`,
        docx: `https://s3/${tailoringKeys('user-a', DOC).docx}?name=Sam Example – Acme.docx`,
      },
    });
    // Storage keys appear only inside the signed links.
    const { downloads: _, ...rest } = view;
    expect(JSON.stringify(rest)).not.toContain('derived/');
  });

  it('is 404 for a missing version, 400 for a bad ID', async () => {
    const { deps } = setup();
    expect((await route(get(), deps)).statusCode).toBe(404);
    expect(
      (
        await route(
          event('GET /me/tailorings/{documentId}', { pathParameters: { documentId: 'x' } }),
          deps,
        )
      ).statusCode,
    ).toBe(400);
  });
});

describe('tailoringView', () => {
  it('shows scores only once a version is ready (a kept draft has them earlier)', () => {
    const drafted = version({
      status: 'processing',
      tailoring: { calls: 3, attempts: 1, drafted: true, result: 'ok', scores: [], coverage: 1 },
    });
    expect(tailoringView(drafted, NOW)).not.toHaveProperty('scores');
    expect(tailoringView(drafted, NOW)).not.toHaveProperty('result');
    expect(
      tailoringView({ ...drafted, status: 'failed', error: 'stopped' }, NOW),
    ).not.toHaveProperty('scores');
  });

  it('shows a run past its time as stopped, and a failure with its message', () => {
    const old = version({
      createdAt: new Date(NOW.getTime() - TAILORING_STALE_MS - 1).toISOString(),
    });
    expect(tailoringView(old, NOW)).toMatchObject({ status: 'failed', error: 'stopped' });
    expect(tailoringView(version({ status: 'failed', error: 'no_jobs' }), NOW)).toMatchObject({
      error: 'no_jobs',
      message: expect.stringContaining('no jobs'),
    });
  });
});
