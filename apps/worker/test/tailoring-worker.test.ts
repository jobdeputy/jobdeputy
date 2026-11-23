import {
  type Document,
  type GeneratedDocument,
  type Job,
  TailoringConflictError,
} from '@jobdeputy/db';
import { jobKeywordsTask, promptVersion, stubTailoringSource } from '@jobdeputy/llm';
import { stubSource } from '@jobdeputy/llm/testing';
import {
  MATCH_SCORE_VERSION,
  structuredKey,
  TAILORING_STALE_MS,
  tailoringKeys,
} from '@jobdeputy/shared';
import type { SQSRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import {
  processRecord,
  RETRY_DELAY_SECONDS,
  TAILORING_MAX_CALLS,
  type TailoringWorkerDeps,
  versionFileName,
} from '../src/tailoring-worker.js';

const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const DOC = '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2D';
const BASE = '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2E';
const NOW = new Date('2026-11-22T06:00:00.000Z');

const RESUME_TEXT = [
  'Sam Example',
  'Backend developer',
  'Software Engineer, Example Logistics',
  '• Built REST APIs in TypeScript.',
  'Skills: TypeScript, Node.js',
  'Education: University of Example',
].join('\n');

const record = (body: unknown = { userId: USER, documentId: DOC }, receiveCount = 1) =>
  ({
    messageId: 'm1',
    body: JSON.stringify(body),
    attributes: { ApproximateReceiveCount: String(receiveCount) },
  }) as unknown as SQSRecord;

function version(over: Partial<GeneratedDocument> = {}): GeneratedDocument {
  return {
    userId: USER,
    documentId: DOC,
    type: 'document',
    kind: 'resume',
    origin: 'generated',
    status: 'processing',
    title: 'Résumé for Example Test Co',
    companyKey: 'schema:example-test-co',
    companyName: 'Example Test Co',
    jobIds: ['job-1'],
    baseDocumentId: BASE,
    aiSource: 'stub',
    platformRun: false,
    tailoring: { calls: 0, attempts: 1 },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    schemaVersion: 1,
    ...over,
  };
}

function base(over: Partial<Document> = {}): Document {
  return {
    userId: USER,
    documentId: BASE,
    type: 'document',
    kind: 'resume',
    origin: 'uploaded',
    title: 'CV',
    fileName: 'cv.pdf',
    mimeType: 'application/pdf',
    format: 'pdf',
    s3Key: 'users/x/original',
    status: 'ready',
    isDefault: true,
    version: 1,
    eTag: 'etag-1',
    parsed: { textS3Key: 'text-key', charCount: 100, noText: false, truncated: false },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    schemaVersion: 1,
    ...over,
  };
}

function job(over: Partial<Job> = {}): Job {
  return {
    userId: USER,
    jobId: 'job-1',
    type: 'job',
    dedupeKey: 'job-1',
    title: 'Backend Engineer',
    description: 'Build the APIs of Example Test Co.\nTypeScript\nAWS',
    descriptionHash: 'dh-1',
    jobUrl: 'https://example.com/job-1',
    companyKey: 'schema:example-test-co',
    companyName: 'Example Test Co',
    locations: [],
    contentHash: 'c1',
    extraction: { method: 'schema_org', version: 1 },
    firstCrawlId: 'c',
    lastCrawlId: 'c',
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

function setup(over: Partial<TailoringWorkerDeps> = {}, doc = version()) {
  const files = new Map<string, unknown>([['text-key', RESUME_TEXT]]);
  const runs = {
    claim: vi.fn(async () => doc),
    saveCall: vi.fn(async () => {}),
    saveDraft: vi.fn(async () => true),
    finish: vi.fn(async () => true),
    saveKeywords: vi.fn(async () => {}),
    saveMatches: vi.fn(async () => {}),
    list: vi.fn(async (): Promise<GeneratedDocument[]> => []),
    deleteVersions: vi.fn(async () => {}),
  };
  const documents = {
    get: vi.fn(async (): Promise<Document | undefined> => base()),
    saveStructured: vi.fn(async () => true),
  };
  const deps: TailoringWorkerDeps = {
    isBeingDeleted: async () => false,
    runs,
    documents,
    jobs: { getMany: vi.fn(async () => [job()]) },
    profile: async () => ({ name: 'Profile Name', skills: [] }),
    model: vi.fn(async () => stubTailoringSource('stub-model')),
    files: {
      readText: vi.fn(async (key: string) => files.get(key) as string),
      readJson: vi.fn(async (key: string) => JSON.parse(files.get(key) as string)),
      put: vi.fn(async (key: string, body: Uint8Array | string) => {
        files.set(key, body);
      }),
      remove: vi.fn(async () => {}),
    },
    render: {
      pdf: vi.fn(async () => Buffer.from('%PDF-fake')),
      docx: vi.fn(async () => Buffer.from('PK-fake')),
    },
    delayRetry: vi.fn(async () => {}),
    recordMetrics: vi.fn(),
    auditTable: 'audit',
    newId: () => 'audit-1',
    now: () => NOW,
    remainingMs: () => 600_000,
    ...over,
  };
  return { deps, runs, documents, files };
}

const finished = (runs: ReturnType<typeof setup>['runs']) =>
  // biome-ignore lint/suspicious/noExplicitAny: reading the mock's argument.
  (runs.finish.mock.calls[0] as any[] | undefined)?.[0];

describe('tailoring worker', () => {
  it('structures, lists keywords, tailors, renders, and ends ready (3 calls, each stored)', async () => {
    const { deps, runs, documents, files } = setup();
    expect(await processRecord(record(), deps)).toBe('ready');
    expect(
      runs.saveCall.mock.calls.map(
        (c) => (c as unknown as [{ callsBefore: number }])[0].callsBefore,
      ),
    ).toEqual([0, 1, 2]);
    expect(
      runs.saveCall.mock.calls.map(
        (c) => (c as unknown as [{ usage: { task: string; runs: number } }])[0].usage,
      ),
    ).toEqual([
      expect.objectContaining({ task: 'structure-resume', runs: 1 }),
      expect.objectContaining({ task: 'job-keywords', runs: 0 }),
      expect.objectContaining({ task: 'tailor-resume', runs: 0 }),
    ]);
    // The structured copy is cached beside the uploaded file, for its ETag.
    expect(documents.saveStructured).toHaveBeenCalledWith(
      USER,
      BASE,
      expect.objectContaining({ eTag: 'etag-1', s3Key: structuredKey(USER, BASE, 'etag-1') }),
    );
    expect(runs.saveKeywords).toHaveBeenCalledWith(USER, 'job-1', {
      descriptionHash: 'dh-1',
      promptVersion: promptVersion(jobKeywordsTask),
      terms: expect.arrayContaining([expect.objectContaining({ term: 'TypeScript' })]),
    });
    const keys = tailoringKeys(USER, DOC);
    for (const key of [keys.json, keys.pdf, keys.docx]) expect(files.has(key)).toBe(true);
    expect(finished(runs)).toMatchObject({
      companyKey: 'schema:example-test-co',
      outcome: {
        status: 'ready',
        s3Key: keys.pdf,
        fileName: 'Sam Example – Example Test Co.pdf',
        tailoring: {
          result: 'partial',
          scores: [{ jobId: 'job-1', base: 55, tailored: 55, missingProven: [] }],
          scoreVersion: MATCH_SCORE_VERSION,
        },
      },
    });
    expect(runs.saveMatches).toHaveBeenCalledWith(
      USER,
      DOC,
      expect.any(Array),
      MATCH_SCORE_VERSION,
    );
  });

  it('reuses the cached structure and keywords: one call, the tailoring draft', async () => {
    const first = setup();
    await processRecord(record(), first.deps);
    // biome-ignore lint/suspicious/noExplicitAny: reading the mock's argument.
    const cache = (first.documents.saveStructured.mock.calls[0] as any[])[2];
    // biome-ignore lint/suspicious/noExplicitAny: reading the mock's argument.
    const terms = (first.runs.saveKeywords.mock.calls[0] as any[])[2];
    const { deps, runs, files } = setup({
      documents: { get: async () => base({ structured: cache }), saveStructured: vi.fn() },
      jobs: { getMany: async () => [job({ keywords: terms })] },
    });
    files.set(cache.s3Key, first.files.get(cache.s3Key));
    expect(await processRecord(record(), deps)).toBe('ready');
    expect(runs.saveCall).toHaveBeenCalledTimes(1);
  });

  it('structures again when the file changed (another ETag)', async () => {
    const first = setup();
    await processRecord(record(), first.deps);
    // biome-ignore lint/suspicious/noExplicitAny: reading the mock's argument.
    const cache = (first.documents.saveStructured.mock.calls[0] as any[])[2];
    const { deps, runs } = setup({
      documents: {
        get: async () => base({ eTag: 'etag-2', structured: cache }),
        saveStructured: vi.fn(async () => true),
      },
    });
    await processRecord(record(), deps);
    expect(runs.saveCall).toHaveBeenCalledTimes(3);
  });

  it.each([
    [
      'no ready base résumé',
      { documents: { get: async () => undefined, saveStructured: vi.fn() } },
      'no_resume',
    ],
    [
      'a base résumé without text',
      {
        documents: {
          get: async () =>
            base({ parsed: { textS3Key: 'k', charCount: 0, noText: true, truncated: false } }),
          saveStructured: vi.fn(),
        },
      },
      'no_resume',
    ],
    [
      'no open job',
      { jobs: { getMany: async () => [job({ closedAt: NOW.toISOString() })] } },
      'no_jobs',
    ],
    ['a deleted key', { model: async () => 'key_missing' as const }, 'key_missing'],
  ] as [string, Partial<TailoringWorkerDeps>, string][])(
    'fails with nothing to call for %s, giving the free run back',
    async (_, over, error) => {
      const { deps, runs } = setup(over, version({ aiSource: 'platform', platformRun: true }));
      expect(await processRecord(record(), deps)).toBe('failed');
      expect(finished(runs).outcome).toEqual({ status: 'failed', error, giveBack: true });
      expect(runs.saveCall).not.toHaveBeenCalled();
    },
  );

  it('stops a run that used its calls', async () => {
    const { deps, runs } = setup(
      {},
      version({ tailoring: { calls: TAILORING_MAX_CALLS, attempts: 3 } }),
    );
    expect(await processRecord(record(), deps)).toBe('failed');
    expect(finished(runs).outcome).toEqual({ status: 'failed', error: 'stopped', giveBack: false });
  });

  it('gives a free run back only for a platform run', async () => {
    const { deps, runs } = setup({ jobs: { getMany: async () => [] } });
    await processRecord(record(), deps);
    expect(finished(runs).outcome.giveBack).toBe(false);
  });

  it('starts no call without the time to finish it', async () => {
    const { deps, runs } = setup({ remainingMs: () => 20_000 });
    expect(await processRecord(record(), deps)).toBe('failed');
    expect(finished(runs).outcome).toEqual({ status: 'failed', error: 'stopped', giveBack: false });
  });

  it('fails a résumé with no entries left after grounding (no tailoring call)', async () => {
    const { deps, runs, files } = setup();
    files.set('text-key', 'Sam Example\nNothing else here.');
    expect(await processRecord(record(), deps)).toBe('failed');
    expect(finished(runs).outcome).toEqual({
      status: 'failed',
      error: 'resume_unreadable',
      giveBack: false,
    });
    expect(runs.saveCall).toHaveBeenCalledTimes(1);
  });

  it('sends a provider error back to the queue, and fails it on the last try', async () => {
    const failing = stubSource(() => {
      throw Object.assign(new Error('Throttled'), { status: 429 });
    });
    const first = setup({ model: async () => failing });
    await expect(processRecord(record(), first.deps)).rejects.toThrow('Throttled');
    expect(first.runs.finish).not.toHaveBeenCalled();
    // Soon, not after the queue's 72-minute visibility timeout.
    expect(first.deps.delayRetry).toHaveBeenCalledWith(expect.anything(), RETRY_DELAY_SECONDS[0]);
    const second = setup({ model: async () => failing });
    await expect(processRecord(record(undefined, 2), second.deps)).rejects.toThrow('Throttled');
    expect(second.deps.delayRetry).toHaveBeenCalledWith(expect.anything(), RETRY_DELAY_SECONDS[1]);
    const last = setup(
      { model: async () => failing },
      version({ aiSource: 'platform', platformRun: true }),
    );
    expect(await processRecord(record(undefined, 3), last.deps)).toBe('failed');
    expect(finished(last.runs).outcome).toEqual({
      status: 'failed',
      error: 'model_unavailable',
      giveBack: true,
    });
  });

  it('fails at once when the provider rejects the user’s own key', async () => {
    const rejected = {
      ...stubSource(() => {
        throw Object.assign(new Error('Unauthorized'), { status: 401 });
      }),
      keySource: 'own' as const,
    };
    const { deps, runs } = setup({ model: async () => rejected });
    expect(await processRecord(record(), deps)).toBe('failed');
    expect(finished(runs).outcome.error).toBe('key_rejected');
  });

  it('ends the run on the last try whatever failed, so it never stays processing', async () => {
    const { deps, runs } = setup({
      documents: {
        get: async () => {
          throw new Error('Throttled');
        },
        saveStructured: vi.fn(),
      },
    });
    expect(await processRecord(record(undefined, 3), deps)).toBe('failed');
    // Before any model call: our failure, not the model's.
    expect(finished(runs).outcome.error).toBe('stopped');
  });

  it('keeps the draft before rendering: a retry renders it with no model call', async () => {
    const first = setup({
      render: {
        pdf: vi.fn(async () => {
          throw new Error('S3 blip');
        }),
        docx: vi.fn(async () => Buffer.from('PK')),
      },
    });
    await expect(processRecord(record(), first.deps)).rejects.toThrow('S3 blip');
    // biome-ignore lint/suspicious/noExplicitAny: reading the mock's arguments.
    const [, , draft, draftResume, company] = first.runs.saveDraft.mock.calls[0] as any[];
    expect(company).toBe('Example Test Co');
    expect(draft).toMatchObject({
      result: 'partial',
      scores: [expect.objectContaining({ jobId: 'job-1' })],
    });
    const keys = tailoringKeys(USER, DOC);
    const retry = setup(
      { model: vi.fn(async () => stubTailoringSource('stub-model')) },
      version({ tailoring: { calls: 3, attempts: 2, drafted: true, draftResume, ...draft } }),
    );
    expect(await processRecord(record(undefined, 2), retry.deps)).toBe('ready');
    expect(retry.deps.model).not.toHaveBeenCalled();
    expect(retry.runs.saveCall).not.toHaveBeenCalled();
    expect(finished(retry.runs).outcome.tailoring).toMatchObject(draft);
    expect(JSON.parse(retry.files.get(keys.json) as string)).toEqual(draftResume);
  });

  it('prunes only when this delivery ended the run', async () => {
    const { deps, runs } = setup();
    runs.finish.mockResolvedValueOnce(false);
    expect(await processRecord(record(), deps)).toBe('skipped');
    // Linked before the end (idempotent; read only once ready), but nothing pruned after it.
    expect(runs.list).not.toHaveBeenCalled();
  });

  it('says the model was unavailable when no draft came back, not that drafts were dishonest', async () => {
    const first = setup();
    await processRecord(record(), first.deps);
    // biome-ignore lint/suspicious/noExplicitAny: reading the mock's argument.
    const cache = (first.documents.saveStructured.mock.calls[0] as any[])[2];
    // biome-ignore lint/suspicious/noExplicitAny: reading the mock's argument.
    const terms = (first.runs.saveKeywords.mock.calls[0] as any[])[2];
    const { deps, runs, files } = setup({
      documents: { get: async () => base({ structured: cache }), saveStructured: vi.fn() },
      jobs: { getMany: async () => [job({ keywords: terms })] },
      model: async () => stubSource(() => ({ text: 'no tool call' })),
    });
    files.set(cache.s3Key, first.files.get(cache.s3Key));
    expect(await processRecord(record(), deps)).toBe('failed');
    expect(finished(runs).outcome.error).toBe('model_unavailable');
  });

  it('removes a structured copy made for a résumé replaced or deleted meanwhile', async () => {
    const { deps } = setup({
      documents: { get: async () => base(), saveStructured: vi.fn(async () => false) },
    });
    await processRecord(record(), deps);
    expect(deps.files.remove).toHaveBeenCalledWith([structuredKey(USER, BASE, 'etag-1')]);
  });

  it('ends a run back after it went stale, with no model call', async () => {
    const { deps, runs } = setup(
      { model: vi.fn(async () => stubTailoringSource('stub-model')) },
      version({ createdAt: new Date(NOW.getTime() - TAILORING_STALE_MS - 1).toISOString() }),
    );
    expect(await processRecord(record(undefined, 2), deps)).toBe('failed');
    expect(finished(runs).outcome.error).toBe('stopped');
    expect(deps.model).not.toHaveBeenCalled();
  });

  it('never ends a run another delivery is working on, even on its last try', async () => {
    const conflict = setup();
    conflict.runs.saveCall.mockRejectedValueOnce(new TailoringConflictError());
    // The message is kept (thrown), so the other delivery never loses its retry.
    await expect(processRecord(record(undefined, 3), conflict.deps)).rejects.toBeInstanceOf(
      TailoringConflictError,
    );
    expect(conflict.runs.finish).not.toHaveBeenCalled();
    const ended = setup();
    ended.runs.saveDraft.mockResolvedValueOnce(false);
    expect(await processRecord(record(), ended.deps)).toBe('skipped');
    expect(ended.runs.finish).not.toHaveBeenCalled();
  });

  it('says stopped, not model unavailable, when its files fail on the last try', async () => {
    const { deps, runs } = setup({
      render: {
        pdf: vi.fn(async () => {
          throw new Error('font');
        }),
        docx: vi.fn(async () => Buffer.from('PK')),
      },
    });
    expect(await processRecord(record(undefined, 3), deps)).toBe('failed');
    expect(finished(runs).outcome.error).toBe('stopped');
  });

  it('links the jobs before ending the run, so a failure there is retried', async () => {
    const { deps, runs } = setup();
    runs.saveMatches.mockRejectedValueOnce(new Error('Throttled'));
    await expect(processRecord(record(), deps)).rejects.toThrow('Throttled');
    expect(runs.finish).not.toHaveBeenCalled();
    expect(deps.delayRetry).toHaveBeenCalled();
  });

  it('stays ready when pruning old versions fails afterwards (logged)', async () => {
    const { deps, runs } = setup();
    runs.list.mockRejectedValueOnce(new Error('Throttled'));
    expect(await processRecord(record(), deps)).toBe('ready');
  });

  it('says stopped when our storage fails on the last try, not that the model did', async () => {
    const { deps, runs, files } = setup();
    files.delete('text-key');
    deps.files.readText = vi.fn(async () => {
      throw new Error('NoSuchKey');
    });
    expect(await processRecord(record(undefined, 3), deps)).toBe('failed');
    expect(finished(runs).outcome.error).toBe('stopped');
  });

  it('deletes the copy of an earlier upload once a new one is recorded', async () => {
    const old = {
      s3Key: structuredKey(USER, BASE, 'etag-0'),
      eTag: 'etag-0',
      promptVersion: 'p',
      coverage: 1,
      rejections: 0,
      createdAt: NOW.toISOString(),
    };
    const { deps } = setup({
      documents: {
        get: async () => base({ structured: old }),
        saveStructured: vi.fn(async () => true),
      },
    });
    await processRecord(record(), deps);
    expect(deps.files.remove).toHaveBeenCalledWith([old.s3Key]);
  });

  it('makes the structure again when its cached copy cannot be read', async () => {
    const first = setup();
    await processRecord(record(), first.deps);
    // biome-ignore lint/suspicious/noExplicitAny: reading the mock's argument.
    const cache = (first.documents.saveStructured.mock.calls[0] as any[])[2];
    const { deps, runs } = setup({
      documents: {
        get: async () => base({ structured: cache }),
        saveStructured: vi.fn(async () => true),
      },
    });
    // The copy's file is missing: reading it throws.
    expect(await processRecord(record(), deps)).toBe('ready');
    expect(runs.saveCall).toHaveBeenCalledTimes(3);
  });

  it('names the company from its jobs when the version has no name', async () => {
    const { companyName: _, ...unnamed } = version();
    const { deps, runs } = setup({}, unnamed as GeneratedDocument);
    await processRecord(record(), deps);
    expect(finished(runs).outcome.fileName).toBe('Sam Example – Example Test Co.pdf');
  });

  it('lets an error while storing a call go to the queue', async () => {
    const { deps, runs } = setup();
    runs.saveCall.mockRejectedValueOnce(new Error('TransactionConflict'));
    await expect(processRecord(record(), deps)).rejects.toThrow('TransactionConflict');
    expect(runs.finish).not.toHaveBeenCalled();
  });

  it('skips a malformed message (thrown), a deleted account, and an ended run', async () => {
    await expect(processRecord(record({ nope: 1 }), setup().deps)).rejects.toThrow('Malformed');
    expect(await processRecord(record(), setup({ isBeingDeleted: async () => true }).deps)).toBe(
      'skipped',
    );
    const ended = setup();
    ended.runs.claim.mockResolvedValueOnce(undefined as unknown as GeneratedDocument);
    expect(await processRecord(record(), ended.deps)).toBe('skipped');
  });

  it('keeps the newest 10 ended versions of the company, deleting the rest and their files', async () => {
    const { deps, runs, files } = setup();
    const versions = Array.from({ length: 13 }, (_, i) =>
      version({
        documentId: `V${String(20 - i).padStart(25, '0')}`,
        status: i === 0 ? 'processing' : 'ready',
      }),
    );
    runs.list.mockResolvedValueOnce(versions);
    await processRecord(record(), deps);
    const old = versions.slice(11).map((v) => v.documentId);
    expect(runs.deleteVersions).toHaveBeenCalledWith(USER, old);
    expect(deps.files.remove).toHaveBeenCalledWith(
      old.flatMap((id) => Object.values(tailoringKeys(USER, id))),
    );
    expect(files.size).toBeGreaterThan(0);
  });
});

describe('versionFileName', () => {
  it('is the name and company, safe as a download name', () => {
    expect(versionFileName('Sam Example', 'Acme')).toBe('Sam Example – Acme.pdf');
    expect(versionFileName('Sam "x"/y', 'A\u0001B')).toBe('Sam _x__y – A_B.pdf');
    expect(versionFileName('n'.repeat(300), 'c').length).toBeLessThanOrEqual(194);
  });
});
