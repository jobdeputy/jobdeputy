/**
 * T08c: at most N jobs shown per company (`companyKey` until the shared company list
 * exists, #40). A snapshot, ranked again on every crawl and every scoring run: the best
 * candidates are `counted`, the rest `over_limit`. "Best" is the LLM's score (T08d) when
 * there is one, then the matching role's priority, then the newest posting.
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

export interface LimitResult {
  /** The company's shown jobs after this crawl. */
  shown: Record<string, ShownEntry>;
  /** This crawl's candidates that are shown. */
  counted: string[];
  /** This crawl's candidates that are not. */
  overLimit: string[];
  /** Jobs other pages listed that were shown and now are not. */
  pushedOut: string[];
}

/**
 * Ranks one company's jobs after a crawl. `read` holds every job this crawl read for
 * the company (whatever the filter said), `candidates` the ones it kept. Jobs shown
 * before that this crawl did not read (other pages list them) keep competing; jobs it
 * read and dropped leave the list.
 */
export function applyCompanyLimit(
  previous: Record<string, ShownEntry>,
  read: Set<string>,
  candidates: RankedJob[],
  limit: number,
): LimitResult {
  const others: RankedJob[] = Object.entries(previous)
    .filter(([jobId]) => !read.has(jobId))
    .map(([jobId, e]) => ({ jobId, ...e }));
  const ranked = [...others, ...candidates].sort(compareRank);
  const kept = ranked.slice(0, limit);
  const keptIds = new Set(kept.map((j) => j.jobId));
  const shown: Record<string, ShownEntry> = {};
  for (const j of kept) {
    shown[j.jobId] = {
      p: j.p,
      ...(j.t !== undefined ? { t: j.t } : {}),
      ...(j.s !== undefined ? { s: j.s } : {}),
    };
  }
  return {
    shown,
    counted: candidates.filter((j) => keptIds.has(j.jobId)).map((j) => j.jobId),
    overLimit: candidates.filter((j) => !keptIds.has(j.jobId)).map((j) => j.jobId),
    pushedOut: others.filter((j) => !keptIds.has(j.jobId)).map((j) => j.jobId),
  };
}
