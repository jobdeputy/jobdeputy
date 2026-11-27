import { z } from 'zod';
import { type AiSource, aiSource } from './ai.js';
import { DERIVED_PREFIX, documentId } from './documents.js';

// #51 (decision 0015): tailored résumés. One run per Tailor click makes one version for a
// company: a `documents` item (`origin: generated`) whose files the tailoring worker writes.

/** Versions kept per company; older ones are deleted when a new one is ready. */
export const TAILORING_VERSIONS_KEPT = 10;
/**
 * Below this share of the résumé's text covered by its structured copy, the version says
 * part of the résumé could not be read (the model stopped early or skipped entries).
 */
export const COVERAGE_WARNING = 0.85;
/**
 * How long a run may stay queued or running before another Tailor click may take its company's
 * lock, and the app shows it as stopped: longer than its slowest normal path (3 attempts of up
 * to 12 minutes, with the worker's 1 and 2 minute waits between them).
 */
export const TAILORING_STALE_MS = 60 * 60 * 1000;

/** A run asked for longer ago than TAILORING_STALE_MS: the app shows it stopped, and the worker ends it. */
export function isTailoringStale(createdAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(createdAt) > TAILORING_STALE_MS;
}

/** The longest company key we accept (`workday:<host>/<site>` is the longest kind). */
const MAX_COMPANY_KEY = 300;

export const createTailoringInput = (allowTestProvider: boolean) =>
  z.strictObject({
    /** The company whose shown jobs (at most 3) the résumé is for. */
    companyKey: z.string().trim().min(1).max(MAX_COMPANY_KEY),
    /** Default: the user's AI setting. `none` is refused: tailoring needs a model. */
    aiSource: aiSource(allowTestProvider).optional(),
  });
export type CreateTailoringInput = { companyKey: string; aiSource?: AiSource };

export const tailoringsQuery = z.strictObject({
  companyKey: z.string().trim().min(1).max(MAX_COMPANY_KEY),
});

export const tailoringId = documentId;

/** The queue message: IDs only. */
export const tailoringMessage = z.object({
  userId: z.string().min(1).max(128),
  documentId,
});

/** Why a run made no version, as shown to the user. */
export const TAILORING_ERRORS = {
  no_resume: 'Upload a résumé (PDF or DOCX with text) and make it your default first.',
  resume_unreadable: 'We could not read the entries of your default résumé. Try another file.',
  no_jobs: 'This company has no jobs shown for you now.',
  key_missing: 'The key for this AI source was deleted.',
  key_invalid: 'The key for this AI source does not work. Check it, then try again.',
  key_rejected: 'The provider rejected the key. Check it, then try again.',
  model_unavailable: 'The AI model was unavailable. Try again later.',
  no_honest_draft:
    'Every draft added something your résumé does not show, so none was kept. Try again.',
  stopped: 'The run stopped before it finished. Try again.',
  /** PR D: a letter names the company, and the crawl found no name for it (never its key). */
  no_company: 'We could not find this company’s name, so a letter could not be written for it.',
} as const;
export type TailoringError = keyof typeof TAILORING_ERRORS;

/** S3 keys (docs/data-model.md) of a version's files, under DERIVED_PREFIX. */
export function tailoringKeys(userId: string, documentId: string) {
  const base = `${DERIVED_PREFIX}${userId}/documents/${documentId}`;
  return {
    json: `${base}/resume.json`,
    pdf: `${base}/resume.pdf`,
    docx: `${base}/resume.docx`,
  };
}

/**
 * The S3 key of an uploaded résumé's structured copy, for the file with this ETag: a copy made
 * for one upload never overwrites, or is deleted as, the copy of a re-upload.
 */
export function structuredKey(userId: string, documentId: string, eTag: string): string {
  const tag = eTag.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64) || 'none';
  return `${DERIVED_PREFIX}${userId}/documents/${documentId}/structured-${tag}.json`;
}
