import type { Document, LetterDraft } from '@jobdeputy/db';
import { coverLetterTask, promptVersion, writeCoverLetter } from '@jobdeputy/llm';
import {
  COVER_LETTER_VERSIONS_KEPT,
  type CoverLetter,
  coverLetter,
  coverLetterKeys,
  cutAtWord,
  FALLBACK_RESUME_NAME,
  isTailoringStale,
  LETTER_NAME_CHARS,
  LETTER_TITLE_CHARS,
  type StructuredResume,
  structuredResume,
  tailoringKeys,
} from '@jobdeputy/shared';
import {
  DOCX,
  fail,
  finish,
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
} from './run.js';

// #51 PR D (decision 0015): one cover-letter run, for one job (`kind: cover_letter`). Written
// from the company's newest ready tailored résumé the API chose (`resumeDocumentId`), or the
// base résumé (structured once per file); the job's keywords (once per description); then
// the letter: a draft and at most two repairs, the first honest one kept (writeCoverLetter).
// At most TAILORING_MAX_CALLS task calls, as tailoring: structure 1, keywords 1, letter 3.

/**
 * The résumé a letter is written from: the tailored version's, while it is ready and made from
 * the base's file as it is now (a re-upload keeps the document's ID, not its ETag); else none,
 * and the base is used.
 */
async function letterResume(
  run: Run,
  deps: TailoringWorkerDeps,
  base: Document | undefined,
): Promise<{ resume: StructuredResume; from: LetterDraft['from'] } | undefined> {
  const { userId, resumeDocumentId } = run.doc;
  if (!resumeDocumentId) return undefined;
  const version = await deps.runs.get(userId, resumeDocumentId);
  if (version?.kind !== 'resume' || version.status !== 'ready') return undefined;
  const made = version.tailoring.baseETag;
  if (made === undefined || base?.eTag !== made || version.baseDocumentId !== base.documentId) {
    return undefined;
  }
  const read = structuredResume.safeParse(
    await deps.files.readJson(tailoringKeys(userId, resumeDocumentId).json).catch(() => undefined),
  );
  return read.success ? { resume: read.data, from: 'tailored' } : undefined;
}

export async function writeLetter(run: Run, deps: TailoringWorkerDeps): Promise<TailoringOutcome> {
  const { doc } = run;
  const { userId } = doc;
  const jobId = doc.jobIds[0] as string;

  // A message back after the run went stale: it ends here, without another model call.
  if (isTailoringStale(doc.createdAt, deps.now())) return fail(run, deps, 'stopped');

  const [job] = (await deps.jobs.getMany(userId, [jobId])).filter((j) => j.closedAt === undefined);

  // A retry after the letter was kept: render exactly it, with no model call. One that no longer
  // reads cannot be kept again (a second letter is refused), so the run ends here.
  if (doc.tailoring.drafted) {
    const kept = coverLetter.safeParse(stripFrom(doc.tailoring.draftLetter));
    return kept.success ? render(run, deps, kept.data) : fail(run, deps, 'stopped');
  }
  if (run.calls >= TAILORING_MAX_CALLS) return fail(run, deps, 'stopped');
  if (!job) return fail(run, deps, 'no_jobs');
  const companyName = doc.companyName ?? job.companyName;
  // Within the letter's own limits before any call, so a kept letter always reads.
  const company = cutAtWord(companyName ?? doc.companyKey, LETTER_NAME_CHARS);
  const jobTitle = cutAtWord(job.title, LETTER_TITLE_CHARS);

  const model = await deps.model(userId, doc.aiSource);
  if (typeof model === 'string') return fail(run, deps, model);
  const profile = await deps.profile(userId);
  const calls = modelCalls(run, deps, model);

  // 1. The résumé: the tailored version's, else the base structured (cached per file).
  const base = usableBase(await deps.documents.get(userId, doc.baseDocumentId));
  let source = await letterResume(run, deps, base);
  if (!source) {
    if (!base) return fail(run, deps, 'no_resume');
    const structuring = await structuredBase(run, deps, base, profile.name, model, calls);
    if (typeof structuring === 'string') return fail(run, deps, structuring);
    source = { resume: structuring.resume, from: 'base' };
  }
  const resume = source.resume;

  // 2. The job's keywords: once per description and prompt.
  const keywords = await jobKeywords(run, deps, [job], model, calls);
  if (typeof keywords === 'string') return fail(run, deps, keywords);

  // 3. The letter: a draft and at most two repairs; the first honest one kept.
  const written = await calls.asking(() =>
    writeCoverLetter(
      {
        company,
        resume,
        evidence: profile.skills,
        job: {
          title: jobTitle,
          description: job.description ?? '',
          keywords: keywords.get(jobId) ?? [],
        },
      },
      model,
      {
        canStart: () => calls.canStart(coverLetterTask.limits.timeoutMs),
        onCall: (attempt) => calls.store(attempt.result, attempt.issues.length),
      },
    ),
  );
  const paragraphs = written.best?.paragraphs;
  if (!paragraphs) {
    const drafted = written.attempts.some((a) => a.paragraphs !== undefined);
    const reason = drafted
      ? 'no_honest_draft'
      : written.attempts.length === 0
        ? 'stopped'
        : 'model_unavailable';
    return fail(run, deps, reason);
  }

  // 4. Keep the letter before rendering: a retry from here makes no model call. Kept once: a
  // duplicate delivery whose letter comes second stops here (the run is the other's).
  run.stage = 'files';
  const read = coverLetter.safeParse({
    contact: contactOf(resume),
    company,
    jobTitle,
    paragraphs,
  });
  // The header is within its limits and the body is the task's checked output: this never
  // fails, and if it did, a retry could only spend the calls left on the same letter.
  if (!read.success) return fail(run, deps, 'stopped');
  const letter = read.data;
  const draft = { ...letter, from: source.from, promptVersion: promptVersion(coverLetterTask) };
  if (!(await deps.runs.saveLetterDraft(userId, doc.documentId, draft, companyName))) {
    return 'skipped';
  }
  return render(run, deps, letter);
}

/** The kept draft without its `from`: the letter itself. */
function stripFrom(draft: LetterDraft | undefined): unknown {
  if (!draft) return undefined;
  const { from: _from, ...letter } = draft;
  return letter;
}

/** The letter's header: the résumé's own contact details (its name, else a fallback). */
function contactOf(resume: StructuredResume): CoverLetter['contact'] {
  return { ...resume.contact, name: resume.contact.name || FALLBACK_RESUME_NAME };
}

/** The files and the job's link to the letter, then the version ready (only if this ended it). */
async function render(
  run: Run,
  deps: TailoringWorkerDeps,
  letter: CoverLetter,
): Promise<TailoringOutcome> {
  run.stage = 'files';
  const { doc } = run;
  const { userId, documentId } = doc;
  const jobId = doc.jobIds[0] as string;
  const keys = coverLetterKeys(userId, documentId);
  const [pdf, docx] = await Promise.all([
    deps.render.letterPdf(letter),
    deps.render.letterDocx(letter),
  ]);
  await Promise.all([
    deps.files.put(keys.json, JSON.stringify(letter), 'application/json'),
    deps.files.put(keys.pdf, pdf, PDF),
    deps.files.put(keys.docx, docx, DOCX),
  ]);
  // Before the end, so a failure is retried (idempotent).
  await deps.runs.saveCoverLetter(userId, jobId, documentId);
  const ended = await finish(
    run,
    deps,
    {
      status: 'ready',
      s3Key: keys.pdf,
      sizeBytes: pdf.length,
      fileName: versionFileName(letter.contact.name, letter.company, 'Cover letter'),
    },
    `Cover letter ready for ${letter.jobTitle} at ${letter.company}`,
  );
  if (!ended) return 'skipped';
  try {
    await prune(userId, jobId, deps);
  } catch (error) {
    logger.error('Letter ready, but old letters were not pruned', {
      documentId,
      error: (error as Error).name,
    });
  }
  return 'ready';
}

/** Keeps the newest COVER_LETTER_VERSIONS_KEPT ended letters of a job; deletes the rest. */
async function prune(userId: string, jobId: string, deps: TailoringWorkerDeps) {
  const ended = (await deps.runs.listLetters(userId, jobId)).filter(
    (v) => v.status === 'ready' || v.status === 'failed',
  );
  const old = ended.slice(COVER_LETTER_VERSIONS_KEPT);
  if (old.length === 0) return;
  await deps.files.remove(
    old.flatMap((v) => {
      const keys = coverLetterKeys(userId, v.documentId);
      return [keys.json, keys.pdf, keys.docx];
    }),
  );
  await deps.runs.deleteVersions(
    userId,
    old.map((v) => v.documentId),
  );
  logger.info('Old letters deleted', { jobId, count: old.length });
}
