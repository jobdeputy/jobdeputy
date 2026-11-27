import {
  type GeneratedDocument,
  isHidden,
  TailoringAllowanceError,
  TailoringBusyError,
} from '@jobdeputy/db';
import {
  type AiSource,
  COVER_LETTER_ERRORS,
  coverLetter,
  coverLetterKeys,
  coverLettersQuery,
  createCoverLetterInput,
  createLogger,
  type HttpResponse,
  isTailoringStale,
  json,
  letterText,
  nextUtcMonthStart,
  parseJsonBody,
  problem,
  TAILORING_STALE_MS,
  tailoringId,
  validationProblem,
} from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { allowanceProblem, defaultResume, sourceFor } from './generation.js';
import type { TailoringDeps } from './tailoring.js';

// #51 PR D (decision 0015): cover letters on demand, one job at a time. Routed by the tailoring
// function (tailoring.ts), with its dependencies; the work is the tailoring worker's.
//   POST /me/cover-letters                 ask for a letter for one job (202)
//   GET  /me/cover-letters?jobId=…         the job's letters, newest first, and the allowance
//   GET  /me/cover-letters/{documentId}    one letter: its text (to preview and copy), downloads

const logger = createLogger('api-cover-letters');

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

/** A letter as the app sees it: no storage keys. A run past its time shows as stopped. */
export function coverLetterView(v: GeneratedDocument, now: Date) {
  const stale =
    (v.status === 'queued' || v.status === 'processing') && isTailoringStale(v.createdAt, now);
  const status = stale ? 'failed' : v.status;
  const error = stale ? 'stopped' : v.error;
  return {
    documentId: v.documentId,
    jobId: v.jobIds[0],
    companyKey: v.companyKey,
    ...(v.companyName ? { companyName: v.companyName } : {}),
    baseDocumentId: v.baseDocumentId,
    ...(v.resumeDocumentId ? { resumeDocumentId: v.resumeDocumentId } : {}),
    aiSource: v.aiSource,
    status,
    ...(error ? { error, message: COVER_LETTER_ERRORS[error] } : {}),
    // Which résumé it was written from: known once its letter is kept.
    ...(status === 'ready' && v.tailoring.draftLetter
      ? { from: v.tailoring.draftLetter.from }
      : {}),
    ...(v.fileName ? { fileName: v.fileName } : {}),
    ...(v.sizeBytes !== undefined ? { sizeBytes: v.sizeBytes } : {}),
    createdAt: v.createdAt,
    ...(v.tailoring.finishedAt ? { finishedAt: v.tailoring.finishedAt } : {}),
  };
}

async function request(
  userId: string,
  body: unknown,
  deps: TailoringDeps,
  requestId: string,
): Promise<HttpResponse> {
  const input = createCoverLetterInput(deps.allowTestProvider).safeParse(body);
  if (!input.success) return validationProblem(input.error, requestId);
  const { jobId } = input.data;
  const [job] = await deps.jobs.getSummaries(userId, [jobId]);
  if (!job) return problem(404, 'Not found', { requestId });
  // A letter for a job the user can see: open and shown.
  if (job.closedAt !== undefined || isHidden(job)) {
    return problem(422, 'No job to write for', {
      detail: COVER_LETTER_ERRORS.no_jobs,
      code: 'no_jobs',
      requestId,
    });
  }
  const source = await sourceFor(
    userId,
    input.data.aiSource as AiSource | undefined,
    deps,
    requestId,
    'Cover letters are written',
  );
  if (typeof source !== 'string') return source;
  const base = await defaultResume(userId, deps);
  if (!base) {
    return problem(422, 'No résumé to write from', {
      detail: COVER_LETTER_ERRORS.no_resume,
      code: 'no_resume',
      requestId,
    });
  }
  // Written from the company's newest ready tailored résumé made from today's default, as its
  // file is now (a re-upload keeps the document's ID, not its ETag); else from the default
  // itself (tailoring first is not required).
  const [tailored, limits] = await Promise.all([
    deps.runs.list(userId, job.companyKey),
    deps.limits(),
  ]);
  const from = tailored.find(
    (v) =>
      v.status === 'ready' &&
      v.baseDocumentId === base.documentId &&
      v.tailoring.baseETag !== undefined &&
      v.tailoring.baseETag === base.eTag,
  );
  const perMonth = limits.platformTailoringsPerMonth;
  const documentId = deps.newId();
  const company = job.companyName ?? job.companyKey;
  try {
    const doc = await deps.runs.request(
      {
        userId,
        documentId,
        kind: 'cover_letter',
        title: `Cover letter for ${job.title} at ${company}`,
        companyKey: job.companyKey,
        ...(job.companyName ? { companyName: job.companyName } : {}),
        jobIds: [jobId],
        baseDocumentId: base.documentId,
        ...(from ? { resumeDocumentId: from.documentId } : {}),
        aiSource: source,
        platformRun: source === 'platform',
      },
      deps.audit(
        'cover_letter.requested',
        { type: 'document', id: documentId },
        `Cover letter asked for ${job.title} at ${company}`,
      ),
      { perMonth, staleMs: TAILORING_STALE_MS },
    );
    logger.info('Cover letter requested', { documentId, aiSource: source, tailored: !!from });
    return json(202, { coverLetter: coverLetterView(doc, deps.now()) });
  } catch (error) {
    if (error instanceof TailoringAllowanceError) {
      return allowanceProblem(perMonth, deps.now(), requestId);
    }
    if (error instanceof TailoringBusyError) {
      return problem(409, 'Already writing', {
        detail: 'A cover letter for this job is being written. Wait for it to finish.',
        code: 'cover_letter_busy',
        requestId,
      });
    }
    throw error;
  }
}

/** The cover-letter routes; undefined for any other route. */
export async function coverLetterRoute(
  event: Event,
  userId: string,
  deps: TailoringDeps,
  requestId: string,
): Promise<HttpResponse | undefined> {
  switch (event.routeKey) {
    case 'POST /me/cover-letters': {
      const body = parseJsonBody(event.body, event.isBase64Encoded);
      if (body === undefined) return problem(400, 'Body must be valid JSON', { requestId });
      return request(userId, body, deps, requestId);
    }
    case 'GET /me/cover-letters': {
      const query = coverLettersQuery.safeParse(event.queryStringParameters ?? {});
      if (!query.success) return validationProblem(query.error, requestId);
      const now = deps.now();
      const [letters, used, limits] = await Promise.all([
        deps.runs.listLetters(userId, query.data.jobId),
        deps.runs.platformRunsUsed(userId, now),
        deps.limits(),
      ]);
      return json(200, {
        coverLetters: letters.map((v) => coverLetterView(v, now)),
        allowance: {
          used,
          perMonth: limits.platformTailoringsPerMonth,
          nextAt: nextUtcMonthStart(now).toISOString(),
        },
      });
    }
    case 'GET /me/cover-letters/{documentId}': {
      const id = tailoringId.safeParse(event.pathParameters?.documentId);
      if (!id.success) return validationProblem(id.error, requestId);
      const v = await deps.runs.get(userId, id.data);
      if (v?.kind !== 'cover_letter') return problem(404, 'Not found', { requestId });
      const view = coverLetterView(v, deps.now());
      if (v.status !== 'ready' || !v.fileName) return json(200, view);
      const keys = coverLetterKeys(userId, v.documentId);
      const [letter, pdf, docx] = await Promise.all([
        deps.readFile(keys.json).then((text) => coverLetter.parse(JSON.parse(text))),
        deps.presignDownload(keys.pdf, v.fileName),
        deps.presignDownload(keys.docx, v.fileName.replace(/\.pdf$/, '.docx')),
      ]);
      return json(200, { ...view, letter, text: letterText(letter), downloads: { pdf, docx } });
    }
    default:
      return undefined;
  }
}
