import type { Task } from '../task.js';
import { jobKeywordsTask } from './job-keywords.js';
import { relevanceTask } from './relevance.js';
import { smokeTask } from './smoke.js';
import { tailorResumeTask } from './tailor-resume.js';

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
        hints: ['matches target role "Sample role" (title_match)'],
      },
    ],
  }),
  entry(jobKeywordsTask, {
    jobs: [{ title: 'Sample title', description: 'Sample description with Sample skill.' }],
  }),
  entry(tailorResumeTask, {
    company: 'Sample company',
    base: {
      contact: { name: 'Sample Person', headline: 'Sample headline', links: [] },
      summary: 'Sample summary.',
      skills: [{ group: 'Sample group', items: ['Sample skill'] }],
      experience: [
        {
          id: 'e1',
          employer: 'Sample employer',
          title: 'Sample title',
          start: '2020',
          end: 'Present',
          bullets: ['Sample bullet with Sample skill.'],
        },
      ],
      education: [{ id: 'd1', school: 'Sample school', degree: 'Sample degree', details: [] }],
      certifications: [{ id: 'c1', name: 'Sample certification' }],
      projects: [{ id: 'p1', name: 'Sample project', bullets: ['Sample project bullet.'] }],
    },
    evidence: ['Sample confirmed skill'],
    jobs: [
      {
        id: 'j1',
        title: 'Sample title',
        keywords: [
          { term: 'Sample skill', kind: 'hard_skill', required: true },
          { term: 'Sample missing skill', kind: 'hard_skill', required: false },
        ],
      },
    ],
    repair: {
      draft: { summary: 'Sample draft.', skills: [], experience: [], projects: [] },
      fixes: ['Sample fix.'],
    },
  }),
];
