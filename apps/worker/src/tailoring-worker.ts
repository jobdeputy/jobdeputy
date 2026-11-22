import { BatchProcessor, EventType, processPartialResponse } from '@aws-lambda-powertools/batch';
import { KMSClient } from '@aws-sdk/client-kms';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  AccountRepository,
  AiKeyRepository,
  type Document,
  DocumentRepository,
  documentClient,
  type GeneratedDocument,
  type Generation,
  type Job,
  JobRepository,
  ProfileRepository,
  type StructuredCache,
  TailoringRepository,
} from '@jobdeputy/db';
import {
  extractJobKeywords,
  invalidReason,
  jobKeywordsTask,
  type ModelSource,
  promptVersion,
  recordTaskMetrics,
  structureResume,
  structureResumeTask,
  stubTailoringSource,
  type TaskResult,
  tailorResume,
  tailorResumeTask,
} from '@jobdeputy/llm';
import {
  createLogger,
  type JobKeyword,
  MATCH_SCORE_VERSION,
  type StructuredResume,
  structuredResume,
  TAILORING_ERRORS,
  TAILORING_STALE_MS,
  TAILORING_VERSIONS_KEPT,
  type TailoringError,
  tailoringKeys,
  tailoringMessage,
} from '@jobdeputy/shared';
import type { Context, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { ulid } from 'ulid';
import { type ModelProblem, modelLoader } from './ai-source.js';
import { renderResumeDocx } from './tailoring/render-docx.js';
import { renderResumePdf } from './tailoring/render-pdf.js';

// #51 (decision 0015): one tailoring run. documents (a generated version inserted `queued` by
// POST /me/tailorings) → stream → Pipe → queue → this worker: structure the base résumé
// (cached per uploaded file), the jobs' keywords (cached per description), tailor (at most 3
// calls), render the PDF and DOCX, and end the version `ready` or `failed`.
//
// Decision 0002: at most TAILORING_MAX_CALLS task calls per run, counted on the item across
// retries. Every finished call is cached (the structured résumé, the keywords) or counted
// before the next starts, and only an error before any tailoring draft goes back to the
// queue, so a retried message never repeats a finished call.

const logger = createLogger('tailoring-worker');

/** Same as the queue's maxReceiveCount: the last attempt ends the run instead of throwing. */
export const MAX_RECEIVES = 3;
/** Structure 1 + keywords 1 + tailoring 3 (decision 0015). */
export const TAILORING_MAX_CALLS = 5;
/** Stop starting task calls this long before Lambda's own timeout. */
export const SAFETY_MARGIN_MS = 10_000;

export interface TailoringFiles {
  /** A text file (the résumé's extracted text). */
  readText(key: string): Promise<string>;
  readJson(key: string): Promise<unknown>;
  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface TailoringWorkerDeps {
  isBeingDeleted: (userId: string) => Promise<boolean>;
  runs: Pick<
    TailoringRepository,
    'claim' | 'saveCall' | 'finish' | 'saveKeywords' | 'saveMatches' | 'list' | 'deleteVersions'
  >;
  documents: Pick<DocumentRepository, 'get' | 'saveStructured'>;
  jobs: Pick<JobRepository, 'getMany'>;
  /** The profile's name (the résumé's fallback) and skills (evidence the user confirmed). */
  profile: (userId: string) => Promise<{ name: string; skills: string[] }>;
  model: (
    userId: string,
    source: GeneratedDocument['aiSource'],
  ) => Promise<ModelSource | ModelProblem>;
  files: TailoringFiles;
  render: { pdf: typeof renderResumePdf; docx: typeof renderResumeDocx };
  recordMetrics: typeof recordTaskMetrics;
  auditTable: string;
  newId: () => string;
  now: () => Date;
  remainingMs: () => number;
}

export type TailoringOutcome = 'skipped' | 'ready' | 'failed';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** "Sam Example – Example Cloud.pdf", safe as a download name. */
export function versionFileName(name: string, company: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point.
  const safe = `${name} – ${company}`.replace(/[/\\"\u0000-\u001f]/g, '_').replace(/\s+/g, ' ');
  return `${safe.slice(0, 190).trim()}.pdf`;
}

export async function processRecord(
  record: SQSRecord,
  deps: TailoringWorkerDeps,
): Promise<TailoringOutcome> {
  const parsed = tailoringMessage.safeParse(safeJson(record.body));
  if (!parsed.success) {
    logger.error('Malformed message', { messageId: record.messageId });
    throw new Error('Malformed message');
  }
  const { userId, documentId } = parsed.data;
  if (await deps.isBeingDeleted(userId)) {
    logger.info('Account is being deleted; skipping', { documentId });
    return 'skipped';
  }
  const doc = await deps.runs.claim(userId, documentId);
  if (!doc) {
    logger.info('Run already ended', { documentId });
    return 'skipped';
  }
  const lastTry = Number(record.attributes.ApproximateReceiveCount) >= MAX_RECEIVES;
  let calls = doc.tailoring.calls;
  let generation: Generation | undefined = doc.generation;

  const finish = async (
    outcome: Parameters<TailoringWorkerDeps['runs']['finish']>[0]['outcome'],
    summary: string,
  ): Promise<TailoringOutcome> => {
    await deps.runs.finish({
      userId,
      documentId,
      companyKey: doc.companyKey,
      outcome,
      audit: {
        table: deps.auditTable,
        entry: {
          auditId: deps.newId(),
          name: outcome.status === 'ready' ? 'tailoring.ready' : 'tailoring.failed',
          entity: { type: 'document', id: documentId },
          actor: 'system',
          summary,
          detail: {
            companyKey: doc.companyKey,
            calls,
            ...(outcome.status === 'failed' ? { error: outcome.error } : {}),
          },
        },
      },
    });
    logger.info('Tailoring ended', { documentId, status: outcome.status, calls });
    return outcome.status;
  };
  /** A free platform run is given back only when no model call was made. */
  const fail = (error: TailoringError) =>
    finish(
      { status: 'failed', error, giveBack: calls === 0 },
      `Tailored résumé not made: ${TAILORING_ERRORS[error]}`,
    );

  // A version queued long ago (a replayed stream record, or a run whose lock was taken over).
  if (deps.now().getTime() - Date.parse(doc.createdAt) > TAILORING_STALE_MS) return fail('stopped');
  if (calls >= TAILORING_MAX_CALLS) return fail('stopped');

  const base = await deps.documents.get(userId, doc.baseDocumentId);
  if (!base || base.status !== 'ready' || !base.parsed || base.parsed.noText || !base.eTag) {
    return fail('no_resume');
  }
  const order = new Map(doc.jobIds.map((id, i) => [id, i]));
  const jobs = (await deps.jobs.getMany(userId, doc.jobIds))
    .filter((j) => j.closedAt === undefined)
    .sort((a, b) => (order.get(a.jobId) ?? 0) - (order.get(b.jobId) ?? 0));
  if (jobs.length === 0) return fail('no_jobs');
  const model = await deps.model(userId, doc.aiSource);
  if (typeof model === 'string') return fail(model);
  const profile = await deps.profile(userId);

  const canStart = (timeoutMs: number) =>
    calls < TAILORING_MAX_CALLS && deps.remainingMs() > timeoutMs + SAFETY_MARGIN_MS;
  let storing = false;
  /** Stores a task call (its tokens) before anything else happens. */
  const store = async (result: TaskResult<unknown>, groundingRejections: number) => {
    deps.recordMetrics(result, { groundingRejections });
    const { usage } = result;
    generation = {
      keySource: model.keySource,
      provider: model.provider,
      model: model.modelId,
      calls: (generation?.calls ?? 0) + usage.calls,
      inputTokens: (generation?.inputTokens ?? 0) + usage.inputTokens,
      outputTokens: (generation?.outputTokens ?? 0) + usage.outputTokens,
    };
    storing = true;
    await deps.runs.saveCall({
      userId,
      documentId,
      callsBefore: calls,
      generation,
      usage: {
        keySource: model.keySource,
        provider: model.provider,
        modelId: model.modelId,
        task: result.task,
        ...usage,
        runs: calls === 0 ? 1 : 0,
      },
    });
    storing = false;
    calls += 1;
  };

  try {
    // 1. The base résumé as structured data: once per uploaded file (its ETag) and prompt.
    let structured: StructuredResume | undefined;
    let coverage: number | undefined;
    const cache = base.structured;
    if (
      cache &&
      cache.eTag === base.eTag &&
      cache.promptVersion === promptVersion(structureResumeTask)
    ) {
      const read = structuredResume.safeParse(await deps.files.readJson(cache.s3Key));
      if (read.success) {
        structured = read.data;
        coverage = cache.coverage;
      }
    }
    if (!structured) {
      if (!canStart(structureResumeTask.limits.timeoutMs)) return fail('stopped');
      const text = await deps.files.readText(base.parsed.textS3Key);
      const call = await structureResume(text, profile.name, model);
      await store(call.result, call.grounded?.rejections ?? 0);
      if (!call.grounded) return fail('stopped');
      if (call.grounded.empty) return fail('resume_unreadable');
      structured = call.grounded.resume;
      coverage = call.grounded.coverage;
      await cacheStructured(userId, base, call.grounded, deps);
    }

    // 2. Each job's keywords: once per description and prompt; the missing ones in one call.
    const keywordsVersion = promptVersion(jobKeywordsTask);
    const keywords = new Map<string, JobKeyword[]>();
    for (const job of jobs) {
      const cached = job.keywords;
      if (
        cached &&
        cached.descriptionHash === (job.descriptionHash ?? '') &&
        cached.promptVersion === keywordsVersion
      ) {
        keywords.set(job.jobId, cached.terms);
      }
    }
    const missing = jobs.filter((j) => !keywords.has(j.jobId));
    if (missing.length > 0) {
      if (!canStart(jobKeywordsTask.limits.timeoutMs)) return fail('stopped');
      const call = await extractJobKeywords(
        missing.map((j) => ({ title: j.title, description: j.description ?? '' })),
        model,
      );
      await store(call.result, call.groundingRejections);
      if (call.result.status !== 'ok') return fail('stopped');
      for (const [i, job] of missing.entries()) {
        const terms = call.keywords[i];
        keywords.set(job.jobId, terms ?? []);
        // A job the model listed nothing for is asked again next run (extractJobKeywords).
        if (terms) {
          await deps.runs.saveKeywords(userId, job.jobId, {
            descriptionHash: job.descriptionHash ?? '',
            promptVersion: keywordsVersion,
            terms,
          });
        }
      }
    }

    // 3. Tailor: a draft and at most two repairs, the best honest draft kept.
    const short = jobs.map((job, i) => ({ id: `j${i + 1}`, job }));
    const run = await tailorResume(
      {
        company: doc.companyName ?? jobs[0]?.companyName ?? doc.companyKey,
        base: structured,
        evidence: profile.skills,
        jobs: short.map(({ id, job }) => ({
          id,
          title: job.title,
          keywords: keywords.get(job.jobId) ?? [],
        })),
      },
      model,
      {
        canStart: () => canStart(tailorResumeTask.limits.timeoutMs),
        onCall: (attempt) => store(attempt.result, attempt.issues.length),
      },
    );
    if (!run.best?.resume) return fail(run.attempts.length === 0 ? 'stopped' : 'no_honest_draft');
    const best = run.best;
    const resume = best.resume as StructuredResume;

    // 4. The files, then the version ready, then each job's link to it.
    const keys = tailoringKeys(userId, documentId);
    const [pdf, docx] = await Promise.all([deps.render.pdf(resume), deps.render.docx(resume)]);
    await Promise.all([
      deps.files.put(keys.json, JSON.stringify(resume), 'application/json'),
      deps.files.put(keys.pdf, pdf, PDF),
      deps.files.put(keys.docx, docx, DOCX),
    ]);
    const byShort = new Map(short.map(({ id, job }) => [id, job.jobId]));
    const scores = best.scores.map((s) => ({
      jobId: byShort.get(s.id) as string,
      base: s.base,
      tailored: s.tailored,
      missingProven: s.missingProven,
      missingUnproven: s.missingUnproven,
    }));
    const company = doc.companyName ?? jobs[0]?.companyName ?? doc.companyKey;
    const ended = await finish(
      {
        status: 'ready',
        s3Key: keys.pdf,
        sizeBytes: pdf.length,
        fileName: versionFileName(resume.contact.name, company),
        tailoring: {
          result: run.status === 'ok' ? 'ok' : 'partial',
          scores,
          ...(coverage !== undefined ? { coverage } : {}),
          promptVersion: promptVersion(tailorResumeTask),
          scoreVersion: MATCH_SCORE_VERSION,
        },
      },
      `Tailored résumé ready for ${company}`,
    );
    await deps.runs.saveMatches(userId, documentId, scores, MATCH_SCORE_VERSION);
    await prune(userId, doc.companyKey, deps);
    return ended;
  } catch (error) {
    // Errors while storing a call are ours: the queue tries again (the call is not stored,
    // and the count's condition keeps a duplicate delivery from storing it twice).
    if (storing) throw error;
    // The user's key stopped working: no retry helps.
    if (model.keySource === 'own' && invalidReason(error)) return fail('key_rejected');
    if (!lastTry) {
      logger.warn('Tailoring failed; the queue tries again', {
        documentId,
        error: (error as Error).name,
      });
      throw error;
    }
    return fail('model_unavailable');
  }
}

/** Stores the structured copy beside the uploaded file and records it on the document. */
async function cacheStructured(
  userId: string,
  base: Document,
  grounded: { resume: StructuredResume; coverage: number; rejections: number },
  deps: TailoringWorkerDeps,
): Promise<void> {
  const key = tailoringKeys(userId, base.documentId).structured;
  await deps.files.put(key, JSON.stringify(grounded.resume), 'application/json');
  const cache: StructuredCache = {
    s3Key: key,
    eTag: base.eTag as string,
    promptVersion: promptVersion(structureResumeTask),
    coverage: grounded.coverage,
    rejections: grounded.rejections,
    createdAt: deps.now().toISOString(),
  };
  // False when the file was replaced meanwhile: the next run structures the new one.
  await deps.documents.saveStructured(userId, base.documentId, cache);
}

/** Keeps the newest TAILORING_VERSIONS_KEPT ended versions of a company; deletes the rest. */
async function prune(userId: string, companyKey: string, deps: TailoringWorkerDeps) {
  const ended = (await deps.runs.list(userId, companyKey)).filter(
    (v) => v.status === 'ready' || v.status === 'failed',
  );
  const old = ended.slice(TAILORING_VERSIONS_KEPT);
  if (old.length === 0) return;
  await deps.files.remove(
    old.flatMap((v) => {
      const keys = tailoringKeys(userId, v.documentId);
      return [keys.json, keys.pdf, keys.docx];
    }),
  );
  await deps.runs.deleteVersions(
    userId,
    old.map((v) => v.documentId),
  );
  logger.info('Old versions deleted', { companyKey, count: old.length });
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function defaultDeps(): TailoringWorkerDeps {
  const {
    DOCUMENTS_TABLE_NAME,
    JOBS_TABLE_NAME,
    USAGE_TABLE_NAME,
    AUDIT_TABLE_NAME,
    USERS_TABLE_NAME,
    PREFERENCES_TABLE_NAME,
    DOCUMENTS_BUCKET_NAME,
    AI_KEYS_TABLE_NAME,
    ALLOW_TEST_AI_PROVIDER,
    AWS_REGION,
  } = process.env;
  if (
    !DOCUMENTS_TABLE_NAME ||
    !JOBS_TABLE_NAME ||
    !USAGE_TABLE_NAME ||
    !AUDIT_TABLE_NAME ||
    !USERS_TABLE_NAME ||
    !PREFERENCES_TABLE_NAME ||
    !DOCUMENTS_BUCKET_NAME ||
    !AI_KEYS_TABLE_NAME ||
    !AWS_REGION
  ) {
    throw new Error('Table, bucket, and Region names must be set');
  }
  const client = documentClient();
  const account = new AccountRepository(client, USERS_TABLE_NAME);
  const profiles = new ProfileRepository(client, USERS_TABLE_NAME);
  const keys = new AiKeyRepository(client, {
    aiKeys: AI_KEYS_TABLE_NAME,
    usage: USAGE_TABLE_NAME,
    preferences: PREFERENCES_TABLE_NAME,
  });
  const s3 = new S3Client({});
  const Bucket = DOCUMENTS_BUCKET_NAME;
  const body = async (key: string) => {
    const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
    return (await res.Body?.transformToString('utf8')) ?? '';
  };
  return {
    isBeingDeleted: (userId) => account.isBeingDeleted(userId),
    runs: new TailoringRepository(client, {
      documents: DOCUMENTS_TABLE_NAME,
      usage: USAGE_TABLE_NAME,
      audit: AUDIT_TABLE_NAME,
      jobs: JOBS_TABLE_NAME,
    }),
    documents: new DocumentRepository(client, DOCUMENTS_TABLE_NAME),
    jobs: new JobRepository(client, JOBS_TABLE_NAME),
    profile: async (userId) => {
      const p = await profiles.get(userId);
      return {
        name: p ? `${p.preferredName ?? p.firstName} ${p.lastName}`.trim() : '',
        skills: p?.skills ?? [],
      };
    },
    model: modelLoader({
      keys,
      kms: new KMSClient({}),
      region: AWS_REGION,
      allowTestProvider: ALLOW_TEST_AI_PROVIDER === 'true',
      stub: stubTailoringSource,
    }),
    files: {
      readText: body,
      readJson: async (key) => JSON.parse(await body(key)),
      put: async (key, content, contentType) => {
        await s3.send(
          new PutObjectCommand({ Bucket, Key: key, Body: content, ContentType: contentType }),
        );
      },
      remove: async (keys) => {
        for (let i = 0; i < keys.length; i += 1000) {
          await s3.send(
            new DeleteObjectsCommand({
              Bucket,
              Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
            }),
          );
        }
      },
    },
    render: { pdf: renderResumePdf, docx: renderResumeDocx },
    recordMetrics: recordTaskMetrics,
    auditTable: AUDIT_TABLE_NAME,
    newId: ulid,
    now: () => new Date(),
    remainingMs: () => currentContext?.getRemainingTimeInMillis() ?? 60_000,
  };
}

const processor = new BatchProcessor(EventType.SQS);
let deps: TailoringWorkerDeps | undefined;
let currentContext: Context | undefined;

export async function handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse> {
  logger.addContext(context);
  currentContext = context;
  deps ??= defaultDeps();
  const current = deps;
  return processPartialResponse(
    event,
    (record: SQSRecord) => processRecord(record, current),
    processor,
    { context },
  );
}
