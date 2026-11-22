import {
  type JobKeyword,
  MATCH_THRESHOLD,
  matchScore,
  resumeSkillGroup,
  resumeText,
  type StructuredResume,
  TermIndex,
} from '@jobdeputy/shared';
import { z } from 'zod';
import type { ModelSource } from '../models.js';
import { dataBlock } from '../prompt.js';
import {
  assembleResume,
  checkTailored,
  evidenceText,
  type Issue,
  plainParts,
  type TailoredParts,
} from '../resume-checks.js';
import { defineTask, runTask, type TaskResult } from '../task.js';

// #51 (decision 0015): one tailored résumé per company (decision 0013), for its top jobs.
// The model rewrites only the summary, the skills list, and the bullets, referring to the
// base résumé's entries by ID; code puts them back into the base (so employers, titles, and
// dates cannot change), checks honesty (resume-checks.ts), and scores each job (matchScore).

/** The same issue in two drafts ("AWS" appears 7 times, then 5 times) has one key. */
const issueKey = (message: string) =>
  message.replace(/appears \d+ times: at most \d+/, 'appears too often');

/** Partial reasons that end the run rather than trying again. */
const STOPPING = new Set(['cancelled', 'timeout']);

/** Tailoring iterations per run (decision 0002): a draft, then at most two repairs. */
export const TAILOR_MAX_ITERATIONS = 3;

export interface TailorJob {
  /** Short ID, for example `j1`. */
  id: string;
  title: string;
  /** Grounded keywords (extractJobKeywords). */
  keywords: JobKeyword[];
}

export interface TailorInput {
  company: string;
  /** The structured base résumé, with entry IDs (`e1`, `p1`). */
  base: StructuredResume;
  /** Skills the user confirmed that the résumé does not show (profile skills, "I have this"). */
  evidence: string[];
  jobs: TailorJob[];
  /** A repair: the previous draft and what was wrong with it. */
  repair?: { draft: TailoredParts; fixes: string[] };
}

const bullets = (max: number) =>
  z
    .object({
      id: z.string().regex(/^[a-z]\d{1,2}$/),
      bullets: z.array(z.string().trim().min(1).max(400)).max(max),
    })
    .strict();

export const tailorResumeOutput = z
  .object({
    summary: z.string().trim().min(1).max(800),
    skills: z.array(resumeSkillGroup).max(8),
    experience: z.array(bullets(10)).max(12),
    projects: z.array(bullets(6)).max(8),
  })
  .strict();

export type TailorResumeOutput = z.infer<typeof tailorResumeOutput>;

const line = (name: string, value: string | undefined) => (value ? [`${name}: ${value}`] : []);
const span = (start?: string, end?: string) =>
  start || end ? ` (${[start, end].filter(Boolean).join(' – ')})` : '';

/** The base résumé as the model reads it: entries with their IDs, contact left out. */
export function resumePromptText(base: StructuredResume): string {
  return [
    ...line('headline', base.contact.headline),
    ...line('summary', base.summary),
    ...(base.skills.length > 0
      ? [`skills:\n${base.skills.map((g) => `  ${g.group}: ${g.items.join(', ')}`).join('\n')}`]
      : []),
    ...base.experience.map((e) =>
      [
        `${e.id}: ${e.title}, ${e.employer}${span(e.start, e.end)}`,
        ...e.bullets.map((b) => `  - ${b}`),
      ].join('\n'),
    ),
    ...base.projects.map((p) =>
      [`${p.id}: project ${p.name}`, ...p.bullets.map((b) => `  - ${b}`)].join('\n'),
    ),
    ...base.education.map(
      (d) =>
        `education: ${[d.degree, d.field].filter(Boolean).join(', ')}${d.degree || d.field ? ', ' : ''}${d.school}${span(d.start, d.end)}`,
    ),
    ...base.certifications.map((c) => `certification: ${c.name}${c.issuer ? `, ${c.issuer}` : ''}`),
  ].join('\n');
}

/** Splits a job's keywords into those the user has shown to be true and those they have not. */
export function splitByEvidence(keywords: readonly JobKeyword[], evidence: TermIndex) {
  const proven: JobKeyword[] = [];
  const unproven: JobKeyword[] = [];
  for (const k of keywords) (evidence.has(k.term) ? proven : unproven).push(k);
  return { proven, unproven };
}

const keywordList = (list: JobKeyword[]) =>
  list.map((k) => `${k.term}${k.required ? ' (required)' : ''}`).join('; ') || 'none';

function evidenceIndex(input: Pick<TailorInput, 'base' | 'evidence'>): TermIndex {
  return new TermIndex(evidenceText(input.base, input.evidence));
}

export const tailorResumeTask = defineTask<TailorInput, TailorResumeOutput>({
  name: 'tailor-resume',
  version: 1,
  system: `You tailor a person's résumé to a company's jobs, keeping every word true.
You rewrite only the summary, the skills list, and the bullets of the experience and project entries. Refer to entries by their id (e1, p1). Return every experience and project entry of the résumé, in the résumé's order. Never add, remove, or rename an entry; employers, titles, dates, and education stay as they are.
Rules:
- Rephrase, reorder, and emphasise what the résumé says. Never invent achievements, responsibilities, tools, team sizes, or numbers. Use only numbers the résumé already has.
- Use the jobs' "use where true" keywords in their exact wording wherever the résumé supports them, the required ones first. Each keyword at most 3 times in the whole résumé.
- Confirmed skills go in the skills list (and may go in the summary), never into an entry's bullets unless that entry already mentions them.
- Never write a "never claim" keyword or anything else the résumé does not show.
- The summary is 2 to 4 sentences, without "I", without naming the company, and without contact details or links.
- Group the skills list under short headings, for example Languages, Cloud, Tools. List only skills from the résumé or the confirmed skills.
- Never add qualities, impact, or scale the résumé does not state (for example "scalable", "high performance", "expert").
- Keep each bullet to one or two lines, starting with a strong verb. Plain text only: no Markdown, bold, or bullet marks.`,
  schema: tailorResumeOutput,
  limits: { maxTokens: 3_000, totalTokens: 45_000, timeoutMs: 120_000 },
  prompt: (input) => {
    const { company, base, evidence, jobs, repair } = input;
    if (jobs.length < 1 || jobs.length > 3) throw new Error('tailor-resume: 1 to 3 jobs');
    const index = evidenceIndex(input);
    const jobText = jobs
      .map((j) => {
        const { proven, unproven } = splitByEvidence(j.keywords, index);
        return [
          `${j.id}: ${j.title}`,
          `  use where true: ${keywordList(proven)}`,
          `  never claim: ${keywordList(unproven)}`,
        ].join('\n');
      })
      .join('\n');
    return [
      dataBlock('company', company),
      dataBlock('resume', resumePromptText(base)),
      dataBlock('confirmed_skills', evidence.join('; ') || 'none'),
      dataBlock('jobs', jobText),
      ...(repair
        ? [
            dataBlock('previous_draft', JSON.stringify(repair.draft)),
            dataBlock('fixes', repair.fixes.map((f) => `- ${f}`).join('\n')),
            'Your previous draft is above. Return a corrected draft that fixes every item in fixes and keeps the rest.',
          ]
        : []),
      `Tailor the résumé for these ${jobs.length} jobs. Return every entry: ${[
        ...base.experience,
        ...base.projects,
      ]
        .map((e) => e.id)
        .join(', ')}.`,
    ].join('\n\n');
  },
});

export interface JobScore {
  id: string;
  /** The base résumé's score, and the tailored one's (null: no keyword that counts). */
  base: number | null;
  tailored: number | null;
  /** Keywords still missing that the user has shown to be true: a repair can add them. */
  missingProven: string[];
  /** Keywords still missing that the user has not shown to be true ("Add only if true"). */
  missingUnproven: string[];
}

export interface TailorAttempt {
  iteration: number;
  result: TaskResult<TailorResumeOutput>;
  /** Present when the call gave valid output. */
  resume?: StructuredResume;
  issues: Issue[];
  scores: JobScore[];
}

export interface TailorRun {
  /** ok: every job reaches MATCH_THRESHOLD; partial: kept, but some job is below it; failed: nothing passed the checks. */
  status: 'ok' | 'partial' | 'failed';
  /** The best draft that passed every check (none when failed). */
  best?: TailorAttempt;
  attempts: TailorAttempt[];
}

export interface TailorRunOptions {
  /** Stores the call (usage) before the next one starts; may throw to stop the run. */
  onCall?: (attempt: TailorAttempt) => Promise<void>;
  /** Asked before each call: false stops the run (for example, too little time left). */
  canStart?: () => boolean;
  signal?: AbortSignal;
}

/** The lowest job score, then the mean: higher is better. Unscored jobs don't count. */
function rank(attempt: TailorAttempt): [number, number] {
  const values = attempt.scores.map((s) => s.tailored).filter((v): v is number => v !== null);
  if (values.length === 0) return [100, 100];
  return [Math.min(...values), values.reduce((a, b) => a + b, 0) / values.length];
}

const better = (a: TailorAttempt, b: TailorAttempt | undefined) => {
  if (!b) return true;
  const [minA, meanA] = rank(a);
  const [minB, meanB] = rank(b);
  return minA > minB || (minA === minB && meanA > meanB);
};

const reachesThreshold = (s: JobScore) => s.tailored === null || s.tailored >= MATCH_THRESHOLD;

/**
 * One tailoring run (decision 0002): a draft, then a repair while a check fails or a job is
 * below MATCH_THRESHOLD with keywords the user has shown to be true still missing; at most
 * TAILOR_MAX_ITERATIONS task calls. Returns the best draft that passed every check.
 */
export async function tailorResume(
  input: Omit<TailorInput, 'repair'>,
  source: ModelSource,
  options: TailorRunOptions = {},
): Promise<TailorRun> {
  const index = evidenceIndex(input);
  const baseIndex = new TermIndex(resumeText(input.base));
  const baseScores = input.jobs.map((job) => matchScore(job.keywords, baseIndex).score);
  const attempts: TailorAttempt[] = [];
  let best: TailorAttempt | undefined;
  let repair: TailorInput['repair'];
  /** Issues of earlier drafts: a repair names them too, so a fixed one does not come back. */
  const earlier = new Map<string, string>();
  for (let iteration = 1; iteration <= TAILOR_MAX_ITERATIONS; iteration++) {
    if (options.canStart && !options.canStart()) break;
    let result: TaskResult<TailorResumeOutput>;
    try {
      result = await runTask(tailorResumeTask, repair ? { ...input, repair } : input, source, {
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      // A provider error (throttling, access) on the first call goes to the queue. After
      // that the run ends with what it has (its best honest draft, or none), so a retry never
      // repeats finished calls (decision 0002).
      if (attempts.length === 0) throw error;
      break;
    }
    const attempt: TailorAttempt = { iteration, result, issues: [], scores: [] };
    attempts.push(attempt);
    let done = false;
    if (result.status === 'ok') {
      const parts = plainParts(result.output);
      const resume = assembleResume(input.base, parts);
      const tailoredIndex = new TermIndex(resumeText(resume));
      attempt.resume = resume;
      attempt.issues = checkTailored(
        input.base,
        parts,
        input.evidence,
        input.jobs.flatMap((j) => j.keywords),
      );
      attempt.scores = input.jobs.map((job, i) => {
        const now = matchScore(job.keywords, tailoredIndex);
        const missing = splitByEvidence(now.missing, index);
        return {
          id: job.id,
          base: baseScores[i] ?? null,
          tailored: now.score,
          missingProven: missing.proven.map((k) => k.term),
          missingUnproven: missing.unproven.map((k) => k.term),
        };
      });
      if (attempt.issues.length === 0 && better(attempt, best)) best = attempt;
      const fixes = [
        ...attempt.issues.map((i) => i.message),
        ...attempt.scores
          .filter((s) => !reachesThreshold(s) && s.missingProven.length > 0)
          .map(
            (s) =>
              `${s.id} still misses: ${s.missingProven.join('; ')}. Work them in where the résumé supports them.`,
          ),
      ];
      done = fixes.length === 0;
      const now = new Set(fixes.map(issueKey));
      const before = [...earlier.entries()].filter(([key]) => !now.has(key)).map(([, m]) => m);
      repair = {
        draft: parts,
        fixes: [...fixes, ...before.map((f) => `keep fixed from an earlier draft: ${f}`)],
      };
      for (const issue of attempt.issues) earlier.set(issueKey(issue.message), issue.message);
    }
    await options.onCall?.(attempt);
    // Nothing left to fix; cancelled or too slow; or a second call in a row without valid
    // output: another call would most likely end the same way.
    const previous = attempts[attempts.length - 2];
    if (
      done ||
      (result.status === 'partial' &&
        (STOPPING.has(result.reason) || previous?.result.status === 'partial'))
    )
      break;
  }
  if (!best) return { status: 'failed', attempts };
  return { status: best.scores.every(reachesThreshold) ? 'ok' : 'partial', best, attempts };
}
