import { TermIndex } from '@jobdeputy/shared';
import { z } from 'zod';
import {
  checkLetter,
  claimable,
  type LetterContext,
  type LetterIssue,
  plainLetter,
} from '../letter-checks.js';
import type { ModelSource } from '../models.js';
import { dataBlock } from '../prompt.js';
import { evidenceText } from '../resume-checks.js';
import { defineTask, runTask, type TaskResult } from '../task.js';
import { resumePromptText, splitByEvidence } from './tailor-resume.js';

// #51 PR D (decision 0015): a cover letter on demand, for one job. The model writes only the
// body's paragraphs; code adds the greeting, the sign-off, and the contact header when it
// renders the file, and checks honesty (letter-checks.ts). 1 call plus at most 2 repairs.

/** Letter calls per run (decision 0002): a draft, then at most two repairs. */
export const COVER_LETTER_MAX_ITERATIONS = 3;
/** Characters of the job's description sent to the model (as job-keywords). */
export const LETTER_DESCRIPTION_CHARS = 6_000;

/** Partial reasons that end the run rather than trying again. */
const STOPPING = new Set(['cancelled', 'timeout']);

export interface CoverLetterInput extends LetterContext {
  /** A repair: the previous draft and what was wrong with it. */
  repair?: { draft: string[]; fixes: string[] };
}

export const coverLetterOutput = z
  .object({ paragraphs: z.array(z.string().trim().min(1).max(1_500)).min(1).max(6) })
  .strict();

export type CoverLetterOutput = z.infer<typeof coverLetterOutput>;

const keywordList = (list: { term: string; required: boolean }[]) =>
  list.map((k) => `${k.term}${k.required ? ' (required)' : ''}`).join('; ') || 'none';

export const coverLetterTask = defineTask<CoverLetterInput, CoverLetterOutput>({
  name: 'cover-letter',
  version: 1,
  system: `You write the body of a cover letter (a letter to the hiring manager) for one job, from a person's résumé, keeping every word true.
Return 3 to 5 paragraphs, 250 to 350 words in all. Only the body: no greeting ("Dear …"), no sign-off, no name, no date, no contact details. They are added for you.
Rules:
- Write in the first person, plainly and specifically: why this role at this company, then the 2 or 3 things in the résumé most relevant to the job, with the résumé's own numbers, then a short close.
- Name the company at least once. Never name a hiring manager or any other person.
- Use the job's "use where true" keywords in their exact wording where the résumé supports them, the required ones first.
- Never write a "never claim" keyword at all, not even as something to learn. Never invent employers, schools, titles, tools, achievements, or numbers. Use only numbers the résumé already has.
- Name only employers, schools, titles, and tools that the résumé, the confirmed skills, or the job name.
- Never add qualities, impact, or scale the résumé does not state (for example "expert", "scalable", "robust", "high-performance").
- Say a confirmed skill only as a skill the person has: never invent where, when, or how they used it.
- Say about the company only what the job's description says; never praise it with claims of your own.
- Write numbers as the résumé writes them (digits), never rounded or as words.
- No placeholders such as [Company] or [Your name]. No links, emails, or phone numbers.
- Plain text only: no Markdown, headings, or bullet points.`,
  schema: coverLetterOutput,
  limits: { maxTokens: 1_500, totalTokens: 30_000, timeoutMs: 120_000 },
  prompt: (input) => {
    const { company, resume, evidence, job, repair } = input;
    const index = new TermIndex(evidenceText(resume, evidence));
    const { proven } = splitByEvidence(
      job.keywords.filter((k) => k.kind !== 'title'),
      index,
    );
    // Only what the checks refuse: the company's own name may always be written.
    const { unproven } = splitByEvidence(claimable(input), index);
    return [
      dataBlock('company', company),
      dataBlock(
        'job',
        [
          `title: ${job.title}`,
          `use where true: ${keywordList(proven)}`,
          `never claim: ${keywordList(unproven)}`,
          `description: ${job.description.slice(0, LETTER_DESCRIPTION_CHARS)}`,
        ].join('\n'),
      ),
      dataBlock('resume', resumePromptText(resume)),
      dataBlock('confirmed_skills', evidence.join('; ') || 'none'),
      ...(repair
        ? [
            dataBlock('previous_draft', JSON.stringify({ paragraphs: repair.draft })),
            dataBlock('fixes', repair.fixes.map((f) => `- ${f}`).join('\n')),
            'Your previous draft is above. Return a corrected letter that fixes every item in fixes and keeps the rest.',
          ]
        : []),
      'Write the cover letter body for this job.',
    ].join('\n\n');
  },
});

export interface LetterAttempt {
  iteration: number;
  result: TaskResult<CoverLetterOutput>;
  /** Present when the call gave valid output: the paragraphs as plain text. */
  paragraphs?: string[];
  issues: LetterIssue[];
}

export interface LetterRun {
  /** ok: a letter passed every check; failed: none did. */
  status: 'ok' | 'failed';
  /** The first letter that passed every check. */
  best?: LetterAttempt;
  attempts: LetterAttempt[];
}

export interface LetterRunOptions {
  /** Stores the call (usage) before the next one starts; may throw to stop the run. */
  onCall?: (attempt: LetterAttempt) => Promise<void>;
  /** Asked before each call: false stops the run (for example, too little time left). */
  canStart?: () => boolean;
  signal?: AbortSignal;
}

/** The same issue in two drafts ("410 words", then "190 words") has one key. */
const issueKey = (message: string) => message.replace(/has \d+ words/, 'has the wrong length');

/**
 * One cover-letter run (decision 0002): a draft, then a repair naming every issue while a check
 * fails; at most COVER_LETTER_MAX_ITERATIONS task calls. Ends at the first letter that passes.
 */
export async function writeCoverLetter(
  input: Omit<CoverLetterInput, 'repair'>,
  source: ModelSource,
  options: LetterRunOptions = {},
): Promise<LetterRun> {
  const attempts: LetterAttempt[] = [];
  let repair: CoverLetterInput['repair'];
  /** Issues of earlier drafts: a repair names them too, so a fixed one does not come back. */
  const earlier = new Map<string, string>();
  for (let iteration = 1; iteration <= COVER_LETTER_MAX_ITERATIONS; iteration++) {
    if (options.canStart && !options.canStart()) break;
    let result: TaskResult<CoverLetterOutput>;
    try {
      result = await runTask(coverLetterTask, repair ? { ...input, repair } : input, source, {
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      // As tailoring: a provider error on the first call goes to the queue; after that the run
      // ends with what it has, so a retry never repeats finished calls (decision 0002).
      if (attempts.length === 0) throw error;
      break;
    }
    const attempt: LetterAttempt = { iteration, result, issues: [] };
    attempts.push(attempt);
    if (result.status === 'ok') {
      const paragraphs = plainLetter(result.output.paragraphs, input.resume.contact.name);
      attempt.paragraphs = paragraphs;
      attempt.issues = checkLetter(input, paragraphs);
      const fixes = attempt.issues.map((i) => i.message);
      const now = new Set(fixes.map(issueKey));
      const before = [...earlier.entries()].filter(([key]) => !now.has(key)).map(([, m]) => m);
      repair = {
        draft: paragraphs,
        fixes: [...fixes, ...before.map((f) => `keep fixed from an earlier draft: ${f}`)],
      };
      for (const issue of attempt.issues) earlier.set(issueKey(issue.message), issue.message);
    }
    await options.onCall?.(attempt);
    if (attempt.paragraphs && attempt.issues.length === 0)
      return { status: 'ok', best: attempt, attempts };
    // Cancelled or too slow, or a second call in a row without valid output: another call
    // would most likely end the same way.
    const previous = attempts[attempts.length - 2];
    if (
      result.status === 'partial' &&
      (STOPPING.has(result.reason) || previous?.result.status === 'partial')
    )
      break;
  }
  return { status: 'failed', attempts };
}
