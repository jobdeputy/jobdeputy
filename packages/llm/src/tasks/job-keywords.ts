import { groundKeywords, type JobKeyword, KEYWORD_KINDS } from '@jobdeputy/shared';
import { z } from 'zod';
import type { ModelSource } from '../models.js';
import { dataBlock } from '../prompt.js';
import { defineTask, runTask, type TaskResult } from '../task.js';

// #51 (decision 0015): lists the keywords an ATS would look for in each of a company's top
// jobs. The model only lists them; code keeps the ones the posting really contains
// (groundKeywords) and computes the score (matchScore, packages/shared). The caller caches
// the result per job by its description hash, so a job is read once.
//
// The output has one named field per job (j1, j2, j3), not a list of results: with a list,
// Ministral 3 14B answered only the first job of every company (tested 2026-11-22).

/** A company's top jobs, all in one call (decision 0013: at most 3 shown per company). */
export const KEYWORDS_BATCH = 3;
/** Characters of a job's description sent to the model. */
export const KEYWORDS_DESCRIPTION_CHARS = 6_000;
/** Keywords the model may return per job; grounding keeps at most MAX_JOB_KEYWORDS. */
const KEYWORDS_PER_JOB = 40;

const JOB_IDS = ['j1', 'j2', 'j3'] as const;

export interface KeywordsJob {
  title: string;
  description: string;
}

export interface KeywordsInput {
  jobs: KeywordsJob[];
}

const keywordList = (id: string) =>
  z
    .array(
      z
        .object({
          term: z.string().trim().min(1).max(60),
          kind: z.enum(KEYWORD_KINDS),
          required: z.boolean(),
        })
        .strict(),
    )
    .max(KEYWORDS_PER_JOB)
    .describe(`the keywords of job ${id}; an empty list when there is no job ${id}`);

export const jobKeywordsOutput = z
  .object({ j1: keywordList('j1'), j2: keywordList('j2'), j3: keywordList('j3') })
  .strict();

export type JobKeywordsOutput = z.infer<typeof jobKeywordsOutput>;

/** The text keywords are grounded in: what the model saw of the job. */
export function keywordsPosting(job: KeywordsJob): string {
  return `${job.title}\n${job.description.slice(0, KEYWORDS_DESCRIPTION_CHARS)}`;
}

export const jobKeywordsTask = defineTask<KeywordsInput, JobKeywordsOutput>({
  name: 'job-keywords',
  version: 1,
  system: `You list the keywords an applicant tracking system would look for in a résumé for each job posting.
Return the keywords of job j1 in j1, of job j2 in j2, and of job j3 in j3 (an empty list for a job that is not given). Each keyword is:
- term: copied exactly as the posting writes it, 1 to 4 words, for example "TypeScript", "AWS Lambda", "Product Manager", "Bachelor's degree", "stakeholder management". One skill per keyword: split lists such as "Python or Go" into separate keywords.
- kind: hard_skill (a technology, tool, language, method, or domain skill), title (the job title or a role name the posting asks for), certification, education (a degree or field of study), or soft_skill (for example communication or leadership).
- required: true when the posting asks for it (must, required, you have, minimum); false when it is preferred, a bonus, or nice to have.
Include the job title itself as a title keyword. Leave out benefits, company values, locations, salaries, and generic words such as "team", "experience", or "fast-paced".
List at most ${KEYWORDS_PER_JOB} keywords per job, the most important first.`,
  schema: jobKeywordsOutput,
  limits: { maxTokens: 2_500, totalTokens: 30_000, timeoutMs: 90_000 },
  prompt: ({ jobs }) => {
    if (jobs.length < 1 || jobs.length > KEYWORDS_BATCH) {
      throw new Error(`job-keywords: 1 to ${KEYWORDS_BATCH} jobs`);
    }
    const ids = JOB_IDS.slice(0, jobs.length);
    return [
      dataBlock(
        'jobs',
        jobs
          .map(
            (j, i) =>
              `id: ${ids[i]}\ntitle: ${j.title}\ndescription: ${j.description.slice(0, KEYWORDS_DESCRIPTION_CHARS)}`,
          )
          .join('\n\n'),
      ),
      `List the keywords of all ${jobs.length} jobs: ${ids.join(', ')}.`,
    ].join('\n\n');
  },
});

export interface JobKeywordsCall {
  result: TaskResult<JobKeywordsOutput>;
  /**
   * Grounded keywords per job, in the order sent, to cache by the job's description hash.
   * Undefined (cache nothing; ask again next run) for a job the model listed nothing for,
   * which may be a skipped job; and for every job when the call is not `ok`. A job whose
   * listed terms were all dropped gets an empty list: asking again would not help.
   */
  keywords: (JobKeyword[] | undefined)[];
  /** Keywords not in their posting or too long, plus any for a job that was not sent. */
  groundingRejections: number;
}

/** One task call for up to KEYWORDS_BATCH jobs, grounded (decision 0010 rule 4). */
export async function extractJobKeywords(
  jobs: KeywordsJob[],
  source: ModelSource,
  options: { signal?: AbortSignal } = {},
): Promise<JobKeywordsCall> {
  const result = await runTask(jobKeywordsTask, { jobs }, source, options);
  const keywords: (JobKeyword[] | undefined)[] = jobs.map(() => undefined);
  let groundingRejections = 0;
  if (result.status === 'ok') {
    JOB_IDS.forEach((id, i) => {
      const listed = result.output[id];
      const job = jobs[i];
      if (!job) {
        groundingRejections += listed.length;
        return;
      }
      if (listed.length === 0) return;
      const { kept, dropped } = groundKeywords(listed, keywordsPosting(job));
      groundingRejections += dropped;
      keywords[i] = kept;
    });
  }
  return { result, keywords, groundingRejections };
}
