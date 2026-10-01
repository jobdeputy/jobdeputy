import type { Crawl, Job, JobRelevance } from '@jobdeputy/db';
import { promptVersion, relevanceTask } from '@jobdeputy/llm';
import { type StubReply, stubSource } from '@jobdeputy/llm/testing';
import type { SQSRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import type { FitInputs } from '../src/relevance/fit.js';
import { inputsHash, modelProfile } from '../src/relevance/llm-inputs.js';
import {
  processRecord,
  type RelevanceWorkerDeps,
  STALE_AFTER_MS,
} from '../src/relevance-worker.js';

const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const CRAWL = '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2D';
const NOW = new Date('2026-10-01T06:00:00.000Z');

const record = (body: unknown = { userId: USER, crawlId: CRAWL }, receiveCount = 1) =>
  ({
    messageId: 'm1',
    body: JSON.stringify(body),
    attributes: { ApproximateReceiveCount: String(receiveCount) },
  }) as unknown as SQSRecord;

const INPUTS: FitInputs = {
  profile: {
    roles: [
      {
        roleId: 'role-backend',
        title: 'Backend Engineer',
        altTitles: [],
        seniority: [],
        exclude: [],
        priority: 60,
      },
    ],
    headline: 'Backend developer',
    skills: ['TypeScript'],
  },
  companyLimit: 10,
  expiryDays: 7,
  relevanceMaxJobs: 50,
  relevanceMinScore: 30,
};

function job(jobId: string, over: Partial<Job> = {}): Job {
  return {
    userId: USER,
    jobId,
    type: 'job',
    dedupeKey: jobId,
    title: 'Backend Engineer',
    jobUrl: `https://example.com/${jobId}`,
    companyKey: 'greenhouse:acme',
    locations: [{ text: 'Pune' }],
    contentHash: `c-${jobId}`,
    extraction: { method: 'ats_feed', version: 1 },
    filter: {
      state: 'candidate',
      roleIds: ['role-backend'],
      reasons: ['title_match'],
      priority: 60,
      version: 1,
    },
    limitState: 'counted',
    firstCrawlId: CRAWL,
    lastCrawlId: CRAWL,
    firstSeenAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    status: 'new',
    starred: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    schemaVersion: 1,
    ...over,
  };
}

function crawlItem(over: Partial<Crawl> = {}): Crawl {
  return {
    userId: USER,
    crawlId: CRAWL,
    type: 'crawl',
    sourceId: 's1',
    url: 'https://example.com/jobs',
    trigger: 'user',
    aiSource: 'platform',
    status: 'succeeded',
    attempts: 1,
    finishedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    candidates: ['good', 'weak'],
    ttl: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    schemaVersion: 1,
    ...over,
  };
}

const RUNNING = { status: 'running' as const, startedAt: NOW.toISOString(), calls: 0, sent: [] };

/** Scores by title: "Backend" 90 for role r1, anything else 10. */
function scorer(): (call: number, messages: unknown) => StubReply {
  return (_, messages) => {
    const text = JSON.stringify(messages);
    const results = [...text.matchAll(/id: (j\d+)\\ntitle: ([^\\]+)/g)].map((m) => ({
      id: m[1],
      score: m[2]?.startsWith('Backend') ? 90 : 10,
      bestRoleId: m[2]?.startsWith('Backend') ? 'r1' : null,
      reasons: ['why'],
    }));
    return { tool: { results } };
  };
}

function setup(
  options: {
    crawl?: Partial<Crawl>;
    jobs?: Job[];
    script?: (call: number, messages: unknown) => StubReply;
    model?: 'key_missing';
  } = {},
) {
  let stored: Crawl | undefined = crawlItem(options.crawl);
  const source = stubSource(options.script ?? scorer());
  const deps = {
    isBeingDeleted: vi.fn(async () => false),
    getCrawl: vi.fn(async () => stored),
    runs: {
      begin: vi.fn(async () => {
        if (stored && !stored.relevance) stored = { ...stored, relevance: RUNNING };
        return true;
      }),
      saveCall: vi.fn<RelevanceWorkerDeps['runs']['saveCall']>(async () => undefined),
      finish: vi.fn<RelevanceWorkerDeps['runs']['finish']>(async () => true),
    },
    model: vi.fn(async () => options.model ?? source),
    fitInputs: vi.fn(async () => INPUTS),
    resume: vi.fn(async () => 'Résumé text'),
    jobs: {
      getMany: vi.fn(
        async () => options.jobs ?? [job('weak', { title: 'Data Engineer' }), job('good')],
      ),
      applyRelevance: vi.fn<RelevanceWorkerDeps['jobs']['applyRelevance']>(async () => undefined),
      markOverLimit: vi.fn(async () => undefined),
    },
    shown: {
      get: vi.fn(async () => ({ shown: {}, version: 0 })),
      put: vi.fn(async () => undefined),
    },
    recordMetrics: vi.fn(),
    auditTable: 'audit',
    newId: () => 'audit-1',
    now: () => NOW,
    remainingMs: () => 300_000,
  } satisfies RelevanceWorkerDeps;
  return { deps, source };
}

describe('relevance worker: what it skips', () => {
  it('fails a malformed message through to the dead-letter queue', async () => {
    const { deps } = setup();
    await expect(processRecord(record({ userId: 'x' }), deps)).rejects.toThrow('Malformed');
  });

  it.each([
    ['an account being deleted', {}, true],
    ['a failed crawl', { status: 'failed' as const }, false],
    ['a crawl without AI', { aiSource: 'none' as const }, false],
    ['a crawl whose run ended', { relevance: { ...RUNNING, status: 'done' as const } }, false],
    [
      'a crawl that finished long ago (a replayed stream record)',
      { finishedAt: new Date(NOW.getTime() - STALE_AFTER_MS - 1).toISOString() },
      false,
    ],
  ])('skips %s without starting a run', async (_, crawl, deleting) => {
    const { deps } = setup({ crawl });
    deps.isBeingDeleted.mockResolvedValue(deleting);
    expect(await processRecord(record(), deps)).toBe('skipped');
    expect(deps.runs.begin).not.toHaveBeenCalled();
    expect(deps.runs.finish).not.toHaveBeenCalled();
  });
});

describe('relevance worker: a run', () => {
  it('scores the candidates, stores the call with its usage, hides low scores, and ranks by score', async () => {
    const { deps } = setup();
    expect(await processRecord(record(), deps)).toBe('done');
    expect(deps.runs.begin).toHaveBeenCalledWith(USER, CRAWL);

    // Sent best first (the crawl's order), with the résumé; one call for both jobs.
    const saved = deps.runs.saveCall.mock.calls[0]?.[0];
    expect(deps.runs.saveCall).toHaveBeenCalledTimes(1);
    expect(saved).toMatchObject({
      callsBefore: 0,
      sent: ['good', 'weak'],
      usage: { keySource: 'platform', provider: 'stub', task: 'relevance', calls: 1, runs: 1 },
      llm: { keySource: 'platform', provider: 'stub', model: 'stub', calls: 1 },
    });
    expect(saved?.scores).toEqual([
      {
        jobId: 'good',
        relevance: expect.objectContaining({
          score: 90,
          bestRoleId: 'role-backend',
          reasons: ['why'],
          promptVersion: 'relevance@v1',
          scoredAt: NOW.toISOString(),
        }),
      },
      { jobId: 'weak', relevance: expect.not.objectContaining({ bestRoleId: expect.anything() }) },
    ]);
    expect(deps.recordMetrics).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok' }), {
      groundingRejections: 0,
      scoreSpread: 80,
    });

    // The company's shown list ranks by score; the low one leaves it and is hidden.
    expect(deps.shown.put).toHaveBeenCalledWith(
      USER,
      'greenhouse:acme',
      { good: { p: 60, s: 90 } },
      0,
    );
    const [, decisions, expiresAt] = deps.jobs.applyRelevance.mock.calls[0] ?? [];
    expect(decisions).toEqual(
      expect.arrayContaining([
        { jobId: 'weak', hide: { reasons: ['title_match', 'llm_low_score'] } },
        { jobId: 'good', limitState: 'counted' },
      ]),
    );
    expect(expiresAt).toBe(NOW.getTime() / 1000 + 7 * 86_400);

    expect(deps.runs.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'done',
        stats: { candidates: 2, scored: 2, reused: 0, unscored: 0, hidden: 1, overLimit: 0 },
        audit: expect.objectContaining({
          entry: expect.objectContaining({ name: 'crawl.scored', actor: 'system' }),
        }),
      }),
    );
  });

  it('leaves out jobs no longer candidates or closed meanwhile', async () => {
    const closed = job('closed', { closedAt: NOW.toISOString() });
    const dropped = job('dropped', {
      filter: { state: 'not_relevant', roleIds: [], reasons: ['place'], priority: 0, version: 1 },
    });
    const { deps } = setup({ jobs: [job('good'), closed, dropped] });
    await processRecord(record(), deps);
    expect(deps.runs.saveCall.mock.calls[0]?.[0].sent).toEqual(['good']);
  });

  it('uses a score again while its inputs are unchanged, without calling the model', async () => {
    const version = promptVersion(relevanceTask);
    const user = modelProfile(INPUTS.profile, 'Résumé text');
    const good = job('good');
    const relevance: JobRelevance = {
      score: 20,
      reasons: ['old'],
      model: 'm',
      promptVersion: version,
      inputsHash: inputsHash(good, user.hash, version),
      scoredAt: NOW.toISOString(),
    };
    const { deps } = setup({ jobs: [{ ...good, relevance }], crawl: { candidates: ['good'] } });
    expect(await processRecord(record(), deps)).toBe('done');
    expect(deps.model).not.toHaveBeenCalled();
    expect(deps.runs.saveCall).not.toHaveBeenCalled();
    // The stored low score still hides it after this crawl showed it again.
    expect(deps.jobs.applyRelevance.mock.calls[0]?.[1]).toEqual([
      { jobId: 'good', hide: { reasons: ['title_match', 'llm_low_score'] } },
    ]);
    expect(deps.runs.finish.mock.calls[0]?.[0].stats).toMatchObject({ scored: 0, reused: 1 });
  });

  it('a changed profile scores the job again', async () => {
    const good = job('good');
    const relevance: JobRelevance = {
      score: 20,
      reasons: [],
      model: 'm',
      promptVersion: 'relevance@v1',
      inputsHash: 'from-an-older-profile',
      scoredAt: NOW.toISOString(),
    };
    const { deps } = setup({ jobs: [{ ...good, relevance }], crawl: { candidates: ['good'] } });
    await processRecord(record(), deps);
    expect(deps.runs.saveCall.mock.calls[0]?.[0].scores[0]?.relevance.score).toBe(90);
  });

  it('a missing or unusable key ends the run with the reason; jobs keep their verdict', async () => {
    const { deps } = setup({ model: 'key_missing', crawl: { aiSource: 'openai' } });
    expect(await processRecord(record(), deps)).toBe('failed');
    expect(deps.runs.saveCall).not.toHaveBeenCalled();
    expect(deps.jobs.applyRelevance).toHaveBeenCalledWith(USER, [], expect.any(Number));
    expect(deps.runs.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        reason: 'key_missing',
        stats: expect.objectContaining({ unscored: 2 }),
      }),
    );
  });
});

describe('relevance worker: retries and the fixed worst case', () => {
  it('a retried message never sends a job again, and counts the run once', async () => {
    const { deps } = setup({
      crawl: { relevance: { ...RUNNING, calls: 2, sent: ['weak'] } },
    });
    await processRecord(record(undefined, 2), deps);
    expect(deps.runs.begin).not.toHaveBeenCalled();
    expect(deps.runs.saveCall.mock.calls[0]?.[0]).toMatchObject({
      callsBefore: 2,
      sent: ['good'],
      usage: { runs: 0 },
    });
    expect(deps.runs.finish.mock.calls[0]?.[0].stats).toMatchObject({ scored: 1, unscored: 1 });
  });

  it('makes no call once the crawl has used its 6 task calls', async () => {
    const { deps } = setup({ crawl: { relevance: { ...RUNNING, calls: 6 } } });
    expect(await processRecord(record(), deps)).toBe('done');
    expect(deps.runs.saveCall).not.toHaveBeenCalled();
    expect(deps.runs.finish.mock.calls[0]?.[0].stats).toMatchObject({ unscored: 2 });
  });

  it('starts no call without time for one to finish', async () => {
    const { deps } = setup();
    const timed = { ...deps, remainingMs: () => 60_000 };
    await processRecord(record(), timed);
    expect(deps.runs.saveCall).not.toHaveBeenCalled();
  });

  it('a provider error is retried by the queue, and on the last attempt ends the run', async () => {
    const throttled = () => {
      throw Object.assign(new Error('Too many requests'), { name: 'ThrottlingException' });
    };
    const first = setup({ script: throttled });
    await expect(processRecord(record(undefined, 1), first.deps)).rejects.toThrow('Too many');
    expect(first.deps.runs.finish).not.toHaveBeenCalled();

    const last = setup({ script: throttled });
    expect(await processRecord(record(undefined, 3), last.deps)).toBe('failed');
    expect(last.deps.runs.finish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', reason: 'model_unavailable' }),
    );
  });

  it('an error while storing a call is never blamed on the model: it goes to the queue', async () => {
    const { deps } = setup();
    deps.runs.saveCall.mockRejectedValue(new Error('DynamoDB unavailable'));
    await expect(processRecord(record(undefined, 3), deps)).rejects.toThrow('DynamoDB');
    expect(deps.runs.finish).not.toHaveBeenCalled();
  });

  it('an own key the provider rejects ends the run at once', async () => {
    const { deps, source } = setup({
      crawl: { aiSource: 'openai' },
      script: () => {
        throw Object.assign(new Error('Incorrect API key'), { status: 401 });
      },
    });
    deps.model.mockResolvedValue({ ...source, keySource: 'own' as const });
    expect(await processRecord(record(undefined, 1), deps)).toBe('failed');
    expect(deps.runs.finish).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'key_rejected' }),
    );
  });
});
