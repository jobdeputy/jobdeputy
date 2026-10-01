import type { Task } from '../task.js';
import { relevanceTask } from './relevance.js';
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
  entry(relevanceTask, {
    profile: {
      roles: [
        {
          id: 'r1',
          title: 'Sample role',
          altTitles: ['Sample alt'],
          seniority: ['mid'],
          places: ['Sample city, GB'],
          exclude: ['sample'],
          priority: 50,
        },
      ],
      search: ['workplace: remote'],
      headline: 'Sample headline',
      skills: ['Sample skill'],
      resume: 'Sample résumé.',
    },
    jobs: [
      {
        id: 'j1',
        title: 'Sample title',
        company: 'Sample company',
        places: ['Sample city'],
        workplace: 'remote',
        employmentType: 'full_time',
        salary: '50000-60000 GBP per year',
        description: 'Sample description.',
        hints: ['matched r1 (title_match)'],
      },
    ],
  }),
];
