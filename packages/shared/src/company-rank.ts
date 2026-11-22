/**
 * T08c: how one company's shown jobs are ranked, shared by the crawl worker (which keeps the
 * best N per company) and the API (#49, which lists companies by their best job).
 */

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
