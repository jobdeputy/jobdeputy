import { z } from 'zod';
import { aiSource } from './ai.js';
import { jobId } from './crawl.js';
import { DERIVED_PREFIX } from './documents.js';
import { FALLBACK_RESUME_NAME, printable, resumeContact } from './resume.js';
import { TAILORING_ERRORS, type TailoringError } from './tailoring.js';

// #51 PR D (decision 0015): a cover letter on demand, for one job. One run per click makes one
// version: a `documents` item (`origin: generated`, `kind: cover_letter`) whose files the
// tailoring worker writes. It shares the tailoring allowance (1 letter = 1 run).

/** Versions kept per job; older ones are deleted when a new one is ready. */
export const COVER_LETTER_VERSIONS_KEPT = 3;

/** Code adds these around the model's paragraphs (the model writes the body only). */
export const LETTER_GREETING = 'Dear Hiring Manager,';
export const LETTER_SIGN_OFF = 'Sincerely,';

export const createCoverLetterInput = (allowTestProvider: boolean) =>
  z.strictObject({
    jobId,
    /** Default: the user's AI setting. `none` is refused: a letter needs a model. */
    aiSource: aiSource(allowTestProvider).optional(),
  });

export const coverLettersQuery = z.strictObject({ jobId });

/** The longest company name and job title a letter's header holds. */
export const LETTER_NAME_CHARS = 200;
export const LETTER_TITLE_CHARS = 300;

/**
 * A ready letter, as stored in `letter.json` and shown in the preview: the contact header
 * (from the résumé it was written from), and the body's paragraphs (checked for honesty).
 */
export const coverLetter = z
  .object({
    contact: resumeContact,
    company: z.string().trim().min(1).max(LETTER_NAME_CHARS),
    jobTitle: z.string().trim().min(1).max(LETTER_TITLE_CHARS),
    paragraphs: z.array(z.string().trim().min(1).max(1_500)).min(1).max(6),
  })
  .strict();
export type CoverLetter = z.infer<typeof coverLetter>;

/** Why a run wrote no letter, as shown to the user (the codes are tailoring's). */
export const COVER_LETTER_ERRORS: Record<TailoringError, string> = {
  ...TAILORING_ERRORS,
  no_jobs: 'This job has closed or is no longer shown, so no letter was written.',
  no_honest_draft:
    'Every draft said something your résumé does not show, so none was kept. Try again.',
};

/** S3 keys (docs/data-model.md) of a letter version's files, under DERIVED_PREFIX. */
export function coverLetterKeys(userId: string, documentId: string) {
  const base = `${DERIVED_PREFIX}${userId}/documents/${documentId}`;
  return {
    json: `${base}/letter.json`,
    pdf: `${base}/letter.pdf`,
    docx: `${base}/letter.docx`,
  };
}

export type LetterBlock =
  | { kind: 'name'; text: string }
  | { kind: 'line'; text: string }
  | { kind: 'greeting'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'signoff'; text: string }
  | { kind: 'signature'; text: string };

const clean = (text: string | undefined) => (text === undefined ? '' : printable(text).trim());

/**
 * The letter as the template's blocks, for the PDF, the DOCX, and the preview alike: the name
 * and contact line (as the résumé shows them), the greeting, the body, the sign-off, the name.
 * No date: the worker cannot know the user's day, and the DOCX can be edited.
 */
export function letterBlocks(letter: CoverLetter): LetterBlock[] {
  const c = letter.contact;
  const name = clean(c.name) || FALLBACK_RESUME_NAME;
  const contact = [c.email, c.phone, c.location, ...c.links].map(clean).filter(Boolean);
  return [
    { kind: 'name', text: name },
    ...(contact.length > 0 ? [{ kind: 'line' as const, text: contact.join(' | ') }] : []),
    { kind: 'greeting', text: LETTER_GREETING },
    ...letter.paragraphs
      .map(clean)
      .filter(Boolean)
      .map((text) => ({ kind: 'paragraph' as const, text })),
    { kind: 'signoff', text: LETTER_SIGN_OFF },
    { kind: 'signature', text: name },
  ];
}

/**
 * The letter as plain text, for Copy (forms that take the letter in a box have their own
 * fields for contact details, so the header is left out).
 */
export function letterText(letter: CoverLetter): string {
  const blocks = letterBlocks(letter).filter((b) => b.kind !== 'name' && b.kind !== 'line');
  const body = blocks.filter((b) => b.kind === 'greeting' || b.kind === 'paragraph');
  const close = blocks.filter((b) => b.kind === 'signoff' || b.kind === 'signature');
  // A blank line between paragraphs; the sign-off and the name on lines of their own.
  return [...body.map((b) => b.text), close.map((b) => b.text).join('\n')].join('\n\n');
}
