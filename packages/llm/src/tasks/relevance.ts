import { z } from 'zod';
import { groundResults } from '../grounding.js';
import type { ModelSource } from '../models.js';
import { dataBlock } from '../prompt.js';
import { defineTask, runTask, type TaskResult } from '../task.js';

// T08d: scores how well each candidate job fits the user, 0 to 100, with short reasons. The
// caller sends short IDs (`j1`, `r1`) and maps them back, so the model never sees our keys,
// and checks every ID that comes back (decision 0010 rule 4).

/** Jobs per task call (decision in docs/tasks/t08d-llm-relevance.md). */
export const RELEVANCE_BATCH = 10;
/** Characters of a job's description sent to the model. */
export const RELEVANCE_DESCRIPTION_CHARS = 1_500;
/** Characters of the default résumé's text sent to the model. */
export const RELEVANCE_RESUME_CHARS = 6_000;

export interface RelevanceRole {
  /** Short ID, for example `r1`. */
  id: string;
  title: string;
  altTitles: string[];
  seniority: string[];
  places: string[];
  exclude: string[];
  /** 1–100: how much the user wants this role. */
  priority: number;
}

export interface RelevanceProfile {
  roles: RelevanceRole[];
  /** Search settings, one line each (places, workplace, types, salary, level, excluded words). */
  search: string[];
  headline?: string | undefined;
  skills: string[];
  /** The start of the default résumé's text. */
  resume?: string | undefined;
}

export interface RelevanceJob {
  /** Short ID, for example `j1`. */
  id: string;
  title: string;
  company?: string | undefined;
  places: string[];
  workplace?: string | undefined;
  employmentType?: string | undefined;
  salary?: string | undefined;
  description?: string | undefined;
  /** The keyword filter's hints (T08c), for example `matched r1 (title_match)`. */
  hints: string[];
}

export interface RelevanceInput {
  profile: RelevanceProfile;
  jobs: RelevanceJob[];
}

export const relevanceOutput = z
  .object({
    results: z
      .array(
        z
          .object({
            id: z.string().min(1).max(16),
            score: z.number().int().min(0).max(100),
            // Models tend to leave a field out rather than send null: either means no role.
            bestRoleId: z.string().min(1).max(16).nullish(),
            reasons: z.array(z.string().min(1).max(160)).max(3),
          })
          .strict(),
      )
      .max(RELEVANCE_BATCH),
  })
  .strict();

export type RelevanceOutput = z.infer<typeof relevanceOutput>;

const line = (name: string, value: string | undefined) =>
  value === undefined || value === '' ? [] : [`${name}: ${value}`];

function profileText(profile: RelevanceProfile): string {
  const roles = profile.roles.map((r) =>
    [
      `${r.id}: ${r.title}`,
      ...line('  also called', r.altTitles.join('; ')),
      ...line('  level', r.seniority.join(', ')),
      ...line('  places', r.places.join('; ')),
      ...line('  not wanted', r.exclude.join(', ')),
      `  priority: ${r.priority}`,
    ].join('\n'),
  );
  return [
    ...line('headline', profile.headline),
    ...line('skills', profile.skills.join(', ')),
    roles.length > 0 ? `target roles:\n${roles.join('\n')}` : 'target roles: none given',
    ...(profile.search.length > 0 ? [`search settings:\n${profile.search.join('\n')}`] : []),
  ].join('\n');
}

function jobText(job: RelevanceJob): string {
  return [
    `id: ${job.id}`,
    `title: ${job.title}`,
    ...line('company', job.company),
    ...line('places', job.places.join('; ')),
    ...line('workplace', job.workplace),
    ...line('type', job.employmentType),
    ...line('salary', job.salary),
    ...line('keyword filter', job.hints.join('; ')),
    ...line('description', job.description?.slice(0, RELEVANCE_DESCRIPTION_CHARS)),
  ].join('\n');
}

export const relevanceTask = defineTask<RelevanceInput, RelevanceOutput>({
  name: 'relevance',
  version: 1,
  system: `You score how well each job fits a job seeker, from 0 to 100.
- 80-100: the kind of role they want, at their level, somewhere and in a way they can work, and they have most of the skills it asks for.
- 50-79: a good fit with some gaps.
- 30-49: possible, but a weak fit.
- 0-29: not a fit: a different kind of role, the wrong level, a place or way of working they cannot do, or skills far from theirs.
Judge only from the profile, target roles, search settings, and résumé given, and from what the job says. Details a job does not give are not evidence against it.
The keyword filter's notes are hints from a simple word match, not the answer.
For every job return its id, its score, bestRoleId (the id of the target role it fits best; leave it out when none fits), and up to 3 short reasons (at most 15 words each) about this job and this person.
Return every job id exactly once.`,
  schema: relevanceOutput,
  limits: { maxTokens: 1_500, totalTokens: 40_000, timeoutMs: 60_000 },
  prompt: ({ profile, jobs }) => {
    if (jobs.length < 1 || jobs.length > RELEVANCE_BATCH) {
      throw new Error(`relevance: 1 to ${RELEVANCE_BATCH} jobs`);
    }
    return [
      dataBlock('profile', profileText(profile)),
      ...(profile.resume
        ? [dataBlock('resume', profile.resume.slice(0, RELEVANCE_RESUME_CHARS))]
        : []),
      dataBlock('jobs', jobs.map(jobText).join('\n\n')),
      // Our own IDs, outside the data: small models otherwise sometimes stop early.
      `Score all ${jobs.length} jobs: ${jobs.map((j) => j.id).join(', ')}. Return ${jobs.length} results, one per id, in this order.`,
    ].join('\n\n');
  },
});

/** At most this many candidates per crawl are scored (the admin setting's upper bound). */
export const RELEVANCE_MAX_JOBS = 50;
/** Task calls per run: one per batch, plus one follow-up for jobs the model left out. */
export const RELEVANCE_MAX_CALLS = Math.ceil(RELEVANCE_MAX_JOBS / RELEVANCE_BATCH) + 1;

export interface ScoredJob {
  id: string;
  score: number;
  bestRoleId?: string;
  reasons: string[];
}

/** One finished task call, handed to the caller to store before the next one starts. */
export interface RelevanceCall {
  result: TaskResult<RelevanceOutput>;
  /** The job IDs sent. */
  sent: string[];
  /** Grounded results: IDs that were sent, each once, with a known role or none. */
  scored: ScoredJob[];
  /** Results dropped (unknown or repeated IDs) plus roles that were not given. */
  groundingRejections: number;
}

export interface RelevanceRunOptions {
  /** Stores the call (results and usage) before the next starts; may throw to stop the run. */
  onCall: (call: RelevanceCall) => Promise<void>;
  /** Asked before each call: false stops the run (for example, too little time left). */
  canStart?: () => boolean;
}

/**
 * Scores up to RELEVANCE_MAX_JOBS jobs in batches of RELEVANCE_BATCH, then sends the jobs
 * the model left out (or whose batch ended partial) once more in one follow-up call: small
 * models sometimes stop early, for example after a job with an injection attempt. So a run
 * makes at most RELEVANCE_MAX_CALLS task calls. Returns the IDs left unscored.
 */
export async function scoreRelevance(
  profile: RelevanceProfile,
  jobs: RelevanceJob[],
  source: ModelSource,
  options: RelevanceRunOptions,
): Promise<{ unscored: string[] }> {
  if (jobs.length > RELEVANCE_MAX_JOBS)
    throw new Error(`relevance: at most ${RELEVANCE_MAX_JOBS} jobs`);
  const roleIds = new Set(profile.roles.map((r) => r.id));
  const scored = new Set<string>();
  const call = async (batch: RelevanceJob[]) => {
    const sent = batch.map((j) => j.id);
    const result = await runTask(relevanceTask, { profile, jobs: batch }, source);
    let groundingRejections = 0;
    const kept: ScoredJob[] = [];
    if (result.status === 'ok') {
      const grounded = groundResults(sent, result.output.results);
      groundingRejections = grounded.dropped;
      for (const r of grounded.kept) {
        const known = r.bestRoleId != null && roleIds.has(r.bestRoleId);
        if (r.bestRoleId != null && !known) groundingRejections += 1;
        kept.push({
          id: r.id,
          score: r.score,
          ...(known ? { bestRoleId: r.bestRoleId as string } : {}),
          reasons: r.reasons,
        });
      }
    }
    await options.onCall({ result, sent, scored: kept, groundingRejections });
    for (const s of kept) scored.add(s.id);
  };
  for (let i = 0; i < jobs.length; i += RELEVANCE_BATCH) {
    if (options.canStart && !options.canStart()) break;
    await call(jobs.slice(i, i + RELEVANCE_BATCH));
  }
  const missing = jobs.filter((j) => !scored.has(j.id));
  if (missing.length > 0 && (!options.canStart || options.canStart())) {
    await call(missing.slice(0, RELEVANCE_BATCH));
  }
  return { unscored: jobs.filter((j) => !scored.has(j.id)).map((j) => j.id) };
}
