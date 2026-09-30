import type { Task } from '../task.js';
import { smokeTask } from './smoke.js';

export interface TaskEntry {
  task: Task<unknown, unknown>;
  sample: unknown;
}

/** Pairs a task with a sample input of its own input type. */
function entry<I, O>(task: Task<I, O>, sample: I): TaskEntry {
  return { task: task as Task<unknown, unknown>, sample };
}

/**
 * Every task, with a fixed sample input for its fingerprint (src/fingerprint.ts). Never edit a
 * sample: that changes the fingerprint without changing the prompt.
 */
export const TASKS: TaskEntry[] = [
  entry(smokeTask, {
    profile: 'Sample profile.',
    jobs: [{ id: 's1', title: 'Sample title', description: 'Sample description.' }],
  }),
];
