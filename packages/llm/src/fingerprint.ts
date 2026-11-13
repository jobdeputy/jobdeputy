import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Task } from './task.js';

/**
 * A hash of everything that shapes a task's output: the system prompt, the prompt built from
 * a fixed sample input (not the builder's source, which build tools may rewrite), the output
 * schema, and the limits. A change to any of them needs a new version (test/versions.test.ts),
 * so results and baselines of one version always mean one prompt.
 */
export function fingerprint<I>(task: Task<I, unknown>, sample: I): string {
  const parts = {
    system: task.system,
    prompt: task.prompt(sample),
    schema: z.toJSONSchema(task.schema),
    limits: task.limits,
  };
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}
