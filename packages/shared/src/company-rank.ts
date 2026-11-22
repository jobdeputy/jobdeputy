/**
 * T08c: how one company's shown jobs are ranked, shared by the crawl worker (which keeps the
 * best N per company) and the API (#49, which lists companies by their best job).
 */

import { z } from 'zod';
import { jobId } from './crawl.js';

/** What the company's `usage` item remembers about each shown job, to rank it again later. */
export interface ShownEntry {
  /** Priority of the role it matched (1–100). */
  p: number;
  /** `postedAt`, when known. */
  t?: string;
  /** T08d: the LLM's score (0–100), when it has scored the job. */
  s?: number;
}

export interface RankedJob extends ShownEntry {
  jobId: string;
}

/**
 * #49: a `RankedJob` read back from a client (`GET /me/companies`' cursor). Kept beside the
 * interfaces so a new rank field is added to both; the type check below fails if they part.
 */
export const rankedJobSchema = z.strictObject({
  jobId,
  p: z.number().int(),
  t: z.string().max(64).optional(),
  s: z.number().int().optional(),
});
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : never
  : never;
const _rankFieldsMatch: SameKeys<z.infer<typeof rankedJobSchema>, RankedJob> = true;
void _rankFieldsMatch;

/** A parsed cursor as a `RankedJob` (optional fields left out rather than undefined). */
export function toRankedJob({ jobId, p, t, s }: z.infer<typeof rankedJobSchema>): RankedJob {
  return { jobId, p, ...(t !== undefined ? { t } : {}), ...(s !== undefined ? { s } : {}) };
}

/**
 * Scored jobs first, higher score first (evidence beats none); then higher priority,
 * then newer, then by ID so the order is always the same.
 */
export function compareRank(a: RankedJob, b: RankedJob): number {
  if ((a.s === undefined) !== (b.s === undefined)) return a.s === undefined ? 1 : -1;
  if (a.s !== undefined && b.s !== undefined && a.s !== b.s) return b.s - a.s;
  if (a.p !== b.p) return b.p - a.p;
  if ((a.t ?? '') !== (b.t ?? '')) return (b.t ?? '') < (a.t ?? '') ? -1 : 1;
  return a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0;
}
