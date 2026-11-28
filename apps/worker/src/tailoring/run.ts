import type {
  Document,
  DocumentRepository,
  GeneratedDocument,
  Generation,
  JobRepository,
  StructuredCache,
  TailoringRepository,
} from '@jobdeputy/db';
import { runLock } from '@jobdeputy/db';
import {
  extractJobKeywords,
  jobKeywordsTask,
  type ModelSource,
  promptVersion,
  type recordTaskMetrics,
  structureResume,
  structureResumeTask,
  type TaskResult,
} from '@jobdeputy/llm';
import {
  COVER_LETTER_ERRORS,
  createLogger,
  type JobKeyword,
  type StructuredResume,
  structuredKey,
  structuredResume,
  TAILORING_ERRORS,
  type TailoringError,
} from '@jobdeputy/shared';
import type { SQSRecord } from 'aws-lambda';
import type { ModelProblem } from '../ai-source.js';
import type { renderLetterDocx, renderResumeDocx } from './render-docx.js';
import type { renderLetterPdf, renderResumePdf } from './render-pdf.js';

// #51: what both kinds of generated version share in the tailoring worker: the run's
// bookkeeping (each task call stored before the next, decision 0002), how a run ends, and the
// cached steps (the base résumé structured once per file, a job's keywords once per
// description). The résumé path is tailoring-worker.ts; the cover letter's is letter.ts.

export const logger = createLogger('tailoring-worker');

/** Structure 1 + keywords 1 + tailoring (or the letter) 3 (decision 0015). */
export const TAILORING_MAX_CALLS = 5;
/** Stop starting task calls this long before Lambda's own timeout. */
export const SAFETY_MARGIN_MS = 10_000;

export const PDF = 'application/pdf';
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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
    | 'get'
    | 'saveCall'
    | 'saveDraft'
    | 'saveLetterDraft'
    | 'finish'
    | 'saveKeywords'
    | 'saveMatches'
    | 'saveCoverLetter'
    | 'list'
    | 'listLetters'
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
  render: {
    pdf: typeof renderResumePdf;
    docx: typeof renderResumeDocx;
    letterPdf: typeof renderLetterPdf;
    letterDocx: typeof renderLetterDocx;
  };
  recordMetrics: typeof recordTaskMetrics;
  auditTable: string;
  newId: () => string;
  now: () => Date;
  remainingMs: () => number;
}

export type TailoringOutcome = 'skipped' | 'ready' | 'failed';

export interface Run {
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

const letter = (run: Run) => run.doc.kind === 'cover_letter';

/**
 * Added to the "Run ended" log line (#117): issue kinds and counts only, never an issue's
 * message, which names résumé and job terms.
 */
type RunEndedExtra = { issueKinds?: Record<string, number>[] };

/** Ends the run; false when it had ended already (another delivery ended it). */
export async function finish(
  run: Run,
  deps: TailoringWorkerDeps,
  outcome: FinishOutcome,
  summary: string,
  logged: RunEndedExtra = {},
): Promise<boolean> {
  const { doc } = run;
  const prefix = letter(run) ? 'cover_letter' : 'tailoring';
  const ended = await deps.runs.finish({
    userId: doc.userId,
    documentId: doc.documentId,
    lock: runLock(doc),
    outcome,
    audit: {
      table: deps.auditTable,
      entry: {
        auditId: deps.newId(),
        name: `${prefix}.${outcome.status === 'ready' ? 'ready' : 'failed'}`,
        entity: { type: 'document', id: doc.documentId },
        actor: 'system',
        summary,
        detail: {
          companyKey: doc.companyKey,
          ...(letter(run) ? { jobId: doc.jobIds[0] } : {}),
          calls: run.calls,
          ...(outcome.status === 'failed' ? { error: outcome.error } : {}),
        },
      },
    },
  });
  logger.info('Run ended', {
    // Extras first: they never replace the run's own fields below.
    ...logged,
    documentId: doc.documentId,
    kind: doc.kind,
    status: outcome.status,
    // #117: why a run failed, so it can be told from the logs alone.
    ...(outcome.status === 'failed' ? { error: outcome.error } : {}),
    calls: run.calls,
    ended,
  });
  return ended;
}

/**
 * Each draft's issue kinds and how many of each ({ "unsupported-keyword": 2 }), for the log of a
 * run that kept no draft (#117). Kinds only: an issue's message names résumé and job terms.
 */
export function issueKinds(attempts: readonly { issues: readonly { kind: string }[] }[]) {
  return attempts.map((a) => {
    const counts: Record<string, number> = {};
    for (const { kind } of a.issues) counts[kind] = (counts[kind] ?? 0) + 1;
    return counts;
  });
}

/** A free platform run is given back only when no model call was made. */
export async function fail(
  run: Run,
  deps: TailoringWorkerDeps,
  error: TailoringError,
  logged?: RunEndedExtra,
): Promise<TailoringOutcome> {
  const summary = letter(run)
    ? `Cover letter not written: ${COVER_LETTER_ERRORS[error]}`
    : `Tailored résumé not made: ${TAILORING_ERRORS[error]}`;
  const ended = await finish(
    run,
    deps,
    { status: 'failed', error, giveBack: run.doc.platformRun && run.calls === 0 },
    summary,
    logged,
  );
  return ended ? 'failed' : 'skipped';
}

/** How a run makes its task calls: each stored with its tokens before the next starts. */
export function modelCalls(run: Run, deps: TailoringWorkerDeps, model: ModelSource) {
  const { userId, documentId } = run.doc;
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
  return { asking, canStart, store };
}

export type ModelCalls = ReturnType<typeof modelCalls>;

/**
 * Step 1: the base résumé as structured data, once per uploaded file (its ETag) and prompt.
 * A TailoringError when the run must end.
 */
export async function structuredBase(
  run: Run,
  deps: TailoringWorkerDeps,
  base: Document & { parsed: NonNullable<Document['parsed']> },
  profileName: string,
  model: ModelSource,
  calls: ModelCalls,
): Promise<{ resume: StructuredResume; coverage?: number } | TailoringError> {
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
      return {
        resume: read.data,
        ...(cache.coverage !== undefined ? { coverage: cache.coverage } : {}),
      };
    }
  }
  if (!calls.canStart(structureResumeTask.limits.timeoutMs)) return 'stopped';
  const text = await deps.files.readText(base.parsed.textS3Key);
  const call = await calls.asking(() => structureResume(text, profileName, model));
  await calls.store(call.result, call.grounded?.rejections ?? 0);
  if (!call.grounded) return 'model_unavailable';
  if (call.grounded.empty) return 'resume_unreadable';
  await cacheStructured(run.doc.userId, base, call.grounded, deps);
  return { resume: call.grounded.resume, coverage: call.grounded.coverage };
}

type KeywordJob = {
  jobId: string;
  title: string;
  description?: string;
  descriptionHash?: string;
  keywords?: { descriptionHash: string; promptVersion: string; terms: JobKeyword[] };
};

/**
 * Step 2: each job's keywords, once per description and prompt; the missing ones in one call.
 * A TailoringError when the run must end.
 */
export async function jobKeywords(
  run: Run,
  deps: TailoringWorkerDeps,
  jobs: KeywordJob[],
  model: ModelSource,
  calls: ModelCalls,
): Promise<Map<string, JobKeyword[]> | TailoringError> {
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
  if (missing.length === 0) return keywords;
  if (!calls.canStart(jobKeywordsTask.limits.timeoutMs)) return 'stopped';
  const call = await calls.asking(() =>
    extractJobKeywords(
      missing.map((j) => ({ title: j.title, description: j.description ?? '' })),
      model,
    ),
  );
  await calls.store(call.result, call.groundingRejections);
  if (call.result.status !== 'ok') return 'model_unavailable';
  for (const [i, job] of missing.entries()) {
    const terms = call.keywords[i];
    keywords.set(job.jobId, terms ?? []);
    // A job the model listed nothing for is asked again next run (extractJobKeywords).
    if (terms) {
      await deps.runs.saveKeywords(run.doc.userId, job.jobId, {
        descriptionHash: job.descriptionHash ?? '',
        promptVersion: keywordsVersion,
        terms,
      });
    }
  }
  return keywords;
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

/** The uploaded base résumé, when it can be tailored from (ready, with text, an ETag). */
export function usableBase(
  base: Document | undefined,
): (Document & { parsed: NonNullable<Document['parsed']> }) | undefined {
  if (base?.status !== 'ready' || !base.parsed || base.parsed.noText || !base.eTag)
    return undefined;
  return base as Document & { parsed: NonNullable<Document['parsed']> };
}

/** "Sam Example – Example Cloud.pdf", safe as a download name. */
export function versionFileName(name: string, company: string, what?: string): string {
  const title = what ? `${name} – ${what} – ${company}` : `${name} – ${company}`;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point.
  const safe = title.replace(/[/\\"\u0000-\u001f]/g, '_').replace(/\s+/g, ' ');
  return `${safe.slice(0, 190).trim()}.pdf`;
}
