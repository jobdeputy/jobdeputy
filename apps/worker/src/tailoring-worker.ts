import { BatchProcessor, EventType, processPartialResponse } from '@aws-lambda-powertools/batch';
import { KMSClient } from '@aws-sdk/client-kms';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ChangeMessageVisibilityCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  AccountRepository,
  AiKeyRepository,
  type Document,
  DocumentRepository,
  documentClient,
  type GeneratedDocument,
  type Generation,
  JobRepository,
  ProfileRepository,
  type StructuredCache,
  TailoringConflictError,
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
  isTailoringStale,
  type JobKeyword,
  MATCH_SCORE_VERSION,
  type StructuredResume,
  structuredKey,
  structuredResume,
  TAILORING_ERRORS,
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
// retries. Every finished call is cached (the structured résumé, the keywords, the kept draft)
// or counted before the next starts, so a retried message never repeats a finished call;
// tailoring itself ends with its best draft rather than throwing after its first call. A
// retry comes 1 or 2 minutes later; the last attempt ends the run failed.

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
    | 'claim'
    | 'saveCall'
    | 'saveDraft'
    | 'finish'
    | 'saveKeywords'
    | 'saveMatches'
    | 'list'
    | 'deleteVersions'
  >;
  /** Shows the message again after `seconds` (instead of the queue's visibility timeout). */
  delayRetry: (record: SQSRecord, seconds: number) => Promise<void>;
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
  // Only a queued or processing version is claimed: a replayed or duplicate message for an
  // ended one stops here.
  const doc = await deps.runs.claim(userId, documentId);
  if (!doc) {
    logger.info('Run already ended', { documentId });
    return 'skipped';
  }
  const receives = Number(record.attributes.ApproximateReceiveCount);
  const run: Run = {
    doc,
    calls: doc.tailoring.calls,
    generation: doc.generation,
    storing: false,
    stage: 'setup',
  };
  try {
    return await tailor(run, deps);
  } catch (error) {
    const { calls } = run;
    // Another delivery of this message stored a call first: this one never ends the run. Its
    // message is kept for a retry (deleting it could cost the other delivery its own retry);
    // by then the run has moved on, or ended and the retry is skipped.
    const conflict = error instanceof TailoringConflictError;
    // The user's key stopped working: no retry helps.
    if (!run.storing && doc.aiSource !== 'platform' && invalidReason(error)) {
      return fail(run, deps, 'key_rejected');
    }
    if (receives >= MAX_RECEIVES && !conflict) {
      // The last attempt ends the run, so it never stays processing (or holds its lock).
      logger.error('Tailoring failed on its last attempt', {
        documentId,
        calls,
        error: (error as Error).name,
      });
      try {
        // The model's own failure, or ours (storing, files): each says what to try.
        return await fail(
          run,
          deps,
          run.stage === 'model' && !run.storing ? 'model_unavailable' : 'stopped',
        );
      } catch {
        throw error;
      }
    }
    // Try again soon, not after the queue's visibility timeout (6 × the worker's).
    await deps.delayRetry(record, RETRY_DELAY_SECONDS[receives - 1] ?? 60).catch((e: unknown) => {
      // The retry then waits out the visibility timeout; the stale check ends it then.
      logger.warn('Could not shorten the retry wait', { documentId, error: (e as Error).name });
    });
    logger.warn('Tailoring failed; the queue tries again', {
      documentId,
      calls,
      error: (error as Error).name,
    });
    throw error;
  }
}

/** Seconds before the queue tries a failed attempt again (after the 1st, then the 2nd). */
export const RETRY_DELAY_SECONDS = [60, 120];

interface Run {
  doc: GeneratedDocument;
  /** Task calls stored so far (on the version, across retries). */
  calls: number;
  generation: Generation | undefined;
  /** True while a call is being stored: an error then is ours, not the model's. */
  storing: boolean;
  /** What the run is doing: an error while the model works is the model's. */
  stage: 'setup' | 'model' | 'files';
}

type FinishOutcome = Parameters<TailoringWorkerDeps['runs']['finish']>[0]['outcome'];

/** Ends the run; false when it had ended already (another delivery ended it). */
async function finish(
  run: Run,
  deps: TailoringWorkerDeps,
  outcome: FinishOutcome,
  summary: string,
): Promise<boolean> {
  const { doc } = run;
  const ended = await deps.runs.finish({
    userId: doc.userId,
    documentId: doc.documentId,
    companyKey: doc.companyKey,
    outcome,
    audit: {
      table: deps.auditTable,
      entry: {
        auditId: deps.newId(),
        name: outcome.status === 'ready' ? 'tailoring.ready' : 'tailoring.failed',
        entity: { type: 'document', id: doc.documentId },
        actor: 'system',
        summary,
        detail: {
          companyKey: doc.companyKey,
          calls: run.calls,
          ...(outcome.status === 'failed' ? { error: outcome.error } : {}),
        },
      },
    },
  });
  logger.info('Tailoring ended', {
    documentId: doc.documentId,
    status: outcome.status,
    calls: run.calls,
    ended,
  });
  return ended;
}

/** A free platform run is given back only when no model call was made. */
async function fail(
  run: Run,
  deps: TailoringWorkerDeps,
  error: TailoringError,
): Promise<TailoringOutcome> {
  const ended = await finish(
    run,
    deps,
    { status: 'failed', error, giveBack: run.doc.platformRun && run.calls === 0 },
    `Tailored résumé not made: ${TAILORING_ERRORS[error]}`,
  );
  return ended ? 'failed' : 'skipped';
}

async function tailor(run: Run, deps: TailoringWorkerDeps): Promise<TailoringOutcome> {
  const { doc } = run;
  const { userId, documentId } = doc;

  // A message back after the run went stale (the app shows it stopped, and a new Tailor click
  // may hold the company's lock): it ends here, without another model call.
  if (isTailoringStale(doc.createdAt, deps.now())) return fail(run, deps, 'stopped');

  // A retry after the draft was kept: render it, with no model call.
  if (doc.tailoring.drafted && doc.tailoring.scores && doc.tailoring.result) {
    const kept = structuredResume.safeParse(doc.tailoring.draftResume);
    if (kept.success) {
      return render(run, deps, kept.data, doc.companyName ?? doc.companyKey, {
        result: doc.tailoring.result,
        scores: doc.tailoring.scores,
        ...(doc.tailoring.coverage !== undefined ? { coverage: doc.tailoring.coverage } : {}),
        promptVersion: doc.tailoring.promptVersion ?? promptVersion(tailorResumeTask),
        scoreVersion: doc.tailoring.scoreVersion ?? MATCH_SCORE_VERSION,
      });
    }
  }
  if (run.calls >= TAILORING_MAX_CALLS) return fail(run, deps, 'stopped');

  const base = await deps.documents.get(userId, doc.baseDocumentId);
  if (base?.status !== 'ready' || !base.parsed || base.parsed.noText || !base.eTag) {
    return fail(run, deps, 'no_resume');
  }
  const order = new Map(doc.jobIds.map((id, i) => [id, i]));
  const jobs = (await deps.jobs.getMany(userId, doc.jobIds))
    .filter((j) => j.closedAt === undefined)
    .sort((a, b) => (order.get(a.jobId) ?? 0) - (order.get(b.jobId) ?? 0));
  if (jobs.length === 0) return fail(run, deps, 'no_jobs');
  const company = doc.companyName ?? jobs.find((j) => j.companyName)?.companyName ?? doc.companyKey;
  const model = await deps.model(userId, doc.aiSource);
  if (typeof model === 'string') return fail(run, deps, model);
  const profile = await deps.profile(userId);
  /** A model call: an error inside it is the model's (storing a call sets `storing`). */
  const asking = async <T>(work: () => Promise<T>): Promise<T> => {
    run.stage = 'model';
    // Left at `model` when it throws: the handler then knows whose failure it was.
    const result = await work();
    run.stage = 'setup';
    return result;
  };

  const canStart = (timeoutMs: number) =>
    run.calls < TAILORING_MAX_CALLS && deps.remainingMs() > timeoutMs + SAFETY_MARGIN_MS;
  /** Stores a task call (its tokens) before anything else happens. */
  const store = async (result: TaskResult<unknown>, groundingRejections: number) => {
    deps.recordMetrics(result, { groundingRejections });
    const { usage } = result;
    run.generation = {
      keySource: model.keySource,
      provider: model.provider,
      model: model.modelId,
      calls: (run.generation?.calls ?? 0) + usage.calls,
      inputTokens: (run.generation?.inputTokens ?? 0) + usage.inputTokens,
      outputTokens: (run.generation?.outputTokens ?? 0) + usage.outputTokens,
    };
    run.storing = true;
    await deps.runs.saveCall({
      userId,
      documentId,
      callsBefore: run.calls,
      generation: run.generation,
      usage: {
        keySource: model.keySource,
        provider: model.provider,
        modelId: model.modelId,
        task: result.task,
        ...usage,
        runs: run.calls === 0 ? 1 : 0,
      },
    });
    run.storing = false;
    run.calls += 1;
  };

  // 1. The base résumé as structured data: once per uploaded file (its ETag) and prompt.
  let structured: StructuredResume | undefined;
  let coverage: number | undefined;
  const cache = base.structured;
  if (
    cache &&
    cache.eTag === base.eTag &&
    cache.promptVersion === promptVersion(structureResumeTask)
  ) {
    const read = structuredResume.safeParse(
      await deps.files.readJson(cache.s3Key).catch(() => undefined),
    );
    if (read.success) {
      structured = read.data;
      coverage = cache.coverage;
    }
  }
  if (!structured) {
    if (!canStart(structureResumeTask.limits.timeoutMs)) return fail(run, deps, 'stopped');
    const text = await deps.files.readText(base.parsed.textS3Key);
    const call = await asking(() => structureResume(text, profile.name, model));
    await store(call.result, call.grounded?.rejections ?? 0);
    if (!call.grounded) return fail(run, deps, 'model_unavailable');
    if (call.grounded.empty) return fail(run, deps, 'resume_unreadable');
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
    if (!canStart(jobKeywordsTask.limits.timeoutMs)) return fail(run, deps, 'stopped');
    const call = await asking(() =>
      extractJobKeywords(
        missing.map((j) => ({ title: j.title, description: j.description ?? '' })),
        model,
      ),
    );
    await store(call.result, call.groundingRejections);
    if (call.result.status !== 'ok') return fail(run, deps, 'model_unavailable');
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
  const tailored = await asking(() =>
    tailorResume(
      {
        company,
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
    ),
  );
  const best = tailored.best;
  if (!best?.resume) {
    // Drafts came back but none was honest; or no draft came back at all (the model's
    // output was invalid, it was too slow, or it failed after the first call).
    const drafted = tailored.attempts.some((a) => a.result.status === 'ok');
    const reason = drafted
      ? 'no_honest_draft'
      : tailored.attempts.length === 0
        ? 'stopped'
        : 'model_unavailable';
    return fail(run, deps, reason);
  }

  // 4. Keep the draft before rendering: a retry from here makes no model call.
  const byShort = new Map(short.map(({ id, job }) => [id, job.jobId]));
  const draft = {
    result: tailored.status === 'ok' ? ('ok' as const) : ('partial' as const),
    scores: best.scores.map((s) => ({
      jobId: byShort.get(s.id) as string,
      base: s.base,
      tailored: s.tailored,
      missingProven: s.missingProven,
      missingUnproven: s.missingUnproven,
    })),
    ...(coverage !== undefined ? { coverage } : {}),
    promptVersion: promptVersion(tailorResumeTask),
    scoreVersion: MATCH_SCORE_VERSION,
  };
  run.stage = 'files';
  // Kept once: a duplicate delivery whose draft comes second stops here (the run is the
  // other's); a retry of this one renders exactly this draft.
  if (!(await deps.runs.saveDraft(userId, documentId, draft, best.resume, company))) {
    return 'skipped';
  }
  return render(run, deps, best.resume, company, draft);
}

/** The files and each job's link to the version, then the version ready (only if this ended it). */
async function render(
  run: Run,
  deps: TailoringWorkerDeps,
  resume: StructuredResume,
  company: string,
  draft: Parameters<TailoringWorkerDeps['runs']['saveDraft']>[2],
): Promise<TailoringOutcome> {
  run.stage = 'files';
  const { doc } = run;
  const { userId, documentId } = doc;
  const keys = tailoringKeys(userId, documentId);
  const [pdf, docx] = await Promise.all([deps.render.pdf(resume), deps.render.docx(resume)]);
  await Promise.all([
    deps.files.put(keys.json, JSON.stringify(resume), 'application/json'),
    deps.files.put(keys.pdf, pdf, PDF),
    deps.files.put(keys.docx, docx, DOCX),
  ]);
  // Before the end, so a failure is retried (the links are idempotent; the app reads a job's
  // version only once it is ready).
  await deps.runs.saveMatches(userId, documentId, draft.scores ?? [], MATCH_SCORE_VERSION);
  const ended = await finish(
    run,
    deps,
    {
      status: 'ready',
      s3Key: keys.pdf,
      sizeBytes: pdf.length,
      fileName: versionFileName(resume.contact.name, company),
      tailoring: draft,
    },
    `Tailored résumé ready for ${company}`,
  );
  if (!ended) return 'skipped';
  // The version is ready: pruning is best effort (a retry would find the run ended).
  try {
    await prune(userId, doc.companyKey, deps);
  } catch (error) {
    logger.error('Version ready, but old versions were not pruned', {
      documentId,
      error: (error as Error).name,
    });
  }
  return 'ready';
}

/** Stores the structured copy beside the uploaded file and records it on the document. */
async function cacheStructured(
  userId: string,
  base: Document,
  grounded: { resume: StructuredResume; coverage: number; rejections: number },
  deps: TailoringWorkerDeps,
): Promise<void> {
  const key = structuredKey(userId, base.documentId, base.eTag as string);
  await deps.files.put(key, JSON.stringify(grounded.resume), 'application/json');
  const cache: StructuredCache = {
    s3Key: key,
    eTag: base.eTag as string,
    promptVersion: promptVersion(structureResumeTask),
    coverage: grounded.coverage,
    rejections: grounded.rejections,
    createdAt: deps.now().toISOString(),
  };
  // False when the file was replaced or deleted meanwhile: this copy (of this file version
  // only) goes too, so a deleted résumé leaves nothing behind. Recorded, it replaces the copy
  // of an earlier upload, which goes.
  if (!(await deps.documents.saveStructured(userId, base.documentId, cache))) {
    await deps.files.remove([key]);
  } else if (base.structured && base.structured.s3Key !== key) {
    await deps.files.remove([base.structured.s3Key]);
  }
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

function queueUrlFromArn(arn: string): string {
  const [, , , region, account, name] = arn.split(':');
  return `https://sqs.${region}.amazonaws.com/${account}/${name}`;
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
  const sqs = new SQSClient({});
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
    delayRetry: async (record, seconds) => {
      await sqs.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrlFromArn(record.eventSourceARN),
          ReceiptHandle: record.receiptHandle,
          VisibilityTimeout: seconds,
        }),
      );
    },
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
