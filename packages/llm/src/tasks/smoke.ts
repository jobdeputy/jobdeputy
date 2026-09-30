import { z } from 'zod';
import { dataBlock } from '../prompt.js';
import { defineTask } from '../task.js';

// A small, fixed check of the whole path (Strands, the schema tool, the real model): Nightly
// runs it against the platform model, and it is the first eval suite. It is not a product task.

export interface SmokeInput {
  profile: string;
  jobs: { id: string; title: string; description: string }[];
}

const MAX_JOBS = 10;

export const smokeOutput = z
  .object({
    results: z
      .array(z.object({ id: z.string().min(1).max(16), match: z.boolean() }).strict())
      .max(MAX_JOBS),
  })
  .strict();

export type SmokeOutput = z.infer<typeof smokeOutput>;

export const smokeTask = defineTask<SmokeInput, SmokeOutput>({
  name: 'smoke',
  version: 1,
  system: `You decide whether each job fits a candidate's profile.
For every job, return its id and match=true if the candidate is qualified and the job matches what they want, otherwise match=false.
Return every job id exactly once.`,
  schema: smokeOutput,
  limits: { maxTokens: 400, totalTokens: 8_000, timeoutMs: 30_000 },
  prompt: ({ profile, jobs }) => {
    if (jobs.length > MAX_JOBS) throw new Error(`smoke: at most ${MAX_JOBS} jobs`);
    const list = jobs
      .map((job) => `id: ${job.id}\ntitle: ${job.title}\ndescription: ${job.description}`)
      .join('\n\n');
    return `${dataBlock('profile', profile)}\n\n${dataBlock('jobs', list)}`;
  },
});
