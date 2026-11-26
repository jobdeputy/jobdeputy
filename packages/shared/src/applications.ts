import { z } from 'zod';

/**
 * #52: a job's stage (`jobs.status`). Matches shows `new` jobs; Applications shows the rest.
 * A job moves stage in place: it is never copied.
 */
export const JOB_STAGES = [
  'new',
  'applied',
  'interviewing',
  'offer',
  'rejected',
  'withdrawn',
] as const;
export type JobStage = (typeof JOB_STAGES)[number];
export const jobStage = z.enum(JOB_STAGES);

/**
 * `PUT /me/jobs/{jobId}/stage`. `from` is the stage the user saw: a job changed meanwhile
 * (another tab, another device) is refused with 409 instead of being overwritten. Back to
 * `new` undoes an apply (a "Yes" given by mistake): the job returns to Matches. From `new`,
 * only `applied`: nothing else has an applied date. Back to `new` only from `applied`.
 */
export const jobStageBody = z
  .strictObject({
    stage: jobStage,
    from: jobStage,
  })
  .refine((b) => b.from !== 'new' || b.stage === 'new' || b.stage === 'applied', {
    // A job is applied to before it can be interviewing, rejected, or withdrawn.
    message: 'A new job can only move to applied',
    path: ['stage'],
  })
  .refine((b) => b.stage !== 'new' || b.from === 'new' || b.from === 'applied', {
    // Undo is for a "Yes" given by mistake; a later stage is history, never erased.
    message: 'Only an applied job can go back to new',
    path: ['stage'],
  });

/** Matches lists the shown, not-applied jobs seen in this many days. */
export const MATCHES_WINDOW_DAYS = 30;
/** At most this many rows in Matches; past it, the answer says `truncated`. */
export const MATCHES_MAX = 500;

/**
 * `GET /me/applications`: newest applied first. The cursor is opaque to clients
 * (base64url JSON of the last row's index key).
 */
export const applicationsPageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(50),
  cursor: z.string().min(1).max(400).optional(),
});

/** The applications index's key, read back from a client's cursor. */
export const applicationsCursor = z.strictObject({
  jobId: z.string().regex(/^[0-9a-f]{32}$/),
  appliedAt: z.string().datetime(),
});

/**
 * #49: the fields a list of jobs shows (`descriptionHash` stands for "has a description");
 * #52 adds the stage fields. The applications index projects exactly these, so the table
 * (infra) and the repository (packages/db, `SUMMARY_FIELDS`) read the same list.
 */
export const JOB_SUMMARY_FIELDS = [
  'jobId',
  'title',
  'companyName',
  'companyKey',
  'locations',
  'workplace',
  'employmentType',
  'salary',
  'jobUrl',
  'applyUrl',
  'ats',
  'postedAt',
  'descriptionHash',
  'firstSeenAt',
  'lastSeenAt',
  'closedAt',
  'status',
  'appliedAt',
  'stageAt',
  'appliedResumeId',
  'starred',
  'filter',
  'limitState',
  'relevance',
  'ttl',
] as const;

/** #52: the jobs table's sparse index of applied jobs (key `userId`, `appliedAt`). */
export const APPLIED_INDEX = 'applied';
