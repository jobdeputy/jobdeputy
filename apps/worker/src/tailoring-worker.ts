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
  DocumentRepository,
  documentClient,
  isHidden,
  JobRepository,
  ProfileRepository,
  TailoringConflictError,
  TailoringRepository,
} from '@jobdeputy/db';
import {
  invalidReason,
  promptVersion,
  recordTaskMetrics,
  stubTailoringSource,
  tailorResume,
  tailorResumeTask,
} from '@jobdeputy/llm';
import {
  isTailoringStale,
  MATCH_SCORE_VERSION,
  type StructuredResume,
  structuredResume,
  TAILORING_VERSIONS_KEPT,
  tailoringKeys,
  tailoringMessage,
} from '@jobdeputy/shared';
import type { Context, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { ulid } from 'ulid';
import { modelLoader } from './ai-source.js';
import { writeLetter } from './tailoring/letter.js';
import { renderLetterDocx, renderResumeDocx } from './tailoring/render-docx.js';
import { renderLetterPdf, renderResumePdf } from './tailoring/render-pdf.js';
import {
  DOCX,
  fail,
  finish,
  issueKinds,
  jobKeywords,
  logger,
  modelCalls,
  PDF,
  type Run,
  structuredBase,
  TAILORING_MAX_CALLS,
  type TailoringOutcome,
  type TailoringWorkerDeps,
  usableBase,
  versionFileName,
} from './tailoring/run.js';

export {
  SAFETY_MARGIN_MS,
  TAILORING_MAX_CALLS,
  type TailoringFiles,
  type TailoringOutcome,
  type TailoringWorkerDeps,
  versionFileName,
} from './tailoring/run.js';

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
//
// PR D: a cover letter for one job (`kind: cover_letter`) comes the same way and runs in
// tailoring/letter.ts, with the same bookkeeping and cached steps (tailoring/run.ts).

/** Same as the queue's maxReceiveCount: the last attempt ends the run instead of throwing. */
export const MAX_RECEIVES = 3;
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
    return doc.kind === 'cover_letter' ? await writeLetter(run, deps) : await tailor(run, deps);
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

async function tailor(run: Run, deps: TailoringWorkerDeps): Promise<TailoringOutcome> {
  const { doc } = run;
  const { userId, documentId } = doc;

  // A message back after the run went stale (the app shows it stopped, and a new Tailor click
  // may hold the company's lock): it ends here, without another model call.
  if (isTailoringStale(doc.createdAt, deps.now())) return fail(run, deps, 'stopped');

  // A retry after the draft was kept: render it, with no model call.
  if (doc.tailoring.drafted) {
    const kept = structuredResume.safeParse(doc.tailoring.draftResume);
    // A kept draft that no longer reads (or lost its scores) cannot be written again: a second
    // draft is refused, so the run ends here rather than calling the model for nothing.
    if (!kept.success || !doc.tailoring.scores || !doc.tailoring.result) {
      return fail(run, deps, 'stopped');
    }
    return render(run, deps, kept.data, doc.companyName ?? doc.companyKey, {
      result: doc.tailoring.result,
      scores: doc.tailoring.scores,
      ...(doc.tailoring.coverage !== undefined ? { coverage: doc.tailoring.coverage } : {}),
      promptVersion: doc.tailoring.promptVersion ?? promptVersion(tailorResumeTask),
      // A draft kept before scores carried a version was scored by version 1.
      scoreVersion: doc.tailoring.scoreVersion ?? 1,
      ...(doc.tailoring.baseETag !== undefined ? { baseETag: doc.tailoring.baseETag } : {}),
    });
  }
  if (run.calls >= TAILORING_MAX_CALLS) return fail(run, deps, 'stopped');

  const base = usableBase(await deps.documents.get(userId, doc.baseDocumentId));
  if (!base) return fail(run, deps, 'no_resume');
  const order = new Map(doc.jobIds.map((id, i) => [id, i]));
  // Open and shown: a job hidden since the request is left out, as the API would now.
  const jobs = (await deps.jobs.getMany(userId, doc.jobIds))
    .filter((j) => j.closedAt === undefined && !isHidden(j))
    .sort((a, b) => (order.get(a.jobId) ?? 0) - (order.get(b.jobId) ?? 0));
  if (jobs.length === 0) return fail(run, deps, 'no_jobs');
  const companyName = doc.companyName ?? jobs.find((j) => j.companyName)?.companyName;
  const company = companyName ?? doc.companyKey;
  const model = await deps.model(userId, doc.aiSource);
  if (typeof model === 'string') return fail(run, deps, model);
  const profile = await deps.profile(userId);
  const calls = modelCalls(run, deps, model);
  const { asking, canStart, store } = calls;

  // 1. The base résumé as structured data: once per uploaded file (its ETag) and prompt.
  const structuring = await structuredBase(run, deps, base, profile.name, model, calls);
  if (typeof structuring === 'string') return fail(run, deps, structuring);
  const { resume: structured, coverage } = structuring;

  // 2. Each job's keywords: once per description and prompt; the missing ones in one call.
  const keywords = await jobKeywords(run, deps, jobs, model, calls);
  if (typeof keywords === 'string') return fail(run, deps, keywords);

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
    return fail(run, deps, reason, { issueKinds: issueKinds(tailored.attempts) });
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
    baseETag: base.eTag as string,
  };
  run.stage = 'files';
  // Kept once: a duplicate delivery whose draft comes second stops here (the run is the
  // other's); a retry of this one renders exactly this draft.
  if (!(await deps.runs.saveDraft(userId, documentId, draft, best.resume, companyName))) {
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
  // The draft's own score version: a draft kept by older score code is never saved as today's
  // (#117 raised it; the API shows only today's, decision 0015).
  await deps.runs.saveMatches(userId, documentId, draft.scores ?? [], draft.scoreVersion ?? 1);
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
    render: {
      pdf: renderResumePdf,
      docx: renderResumeDocx,
      letterPdf: renderLetterPdf,
      letterDocx: renderLetterDocx,
    },
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
