import { useEffect, useReducer } from 'react';
import { copy } from '@/copy/index.ts';
import type { JobSummary } from '@/lib/api/jobs.ts';

/**
 * #52 PR E (0013): the one rule for a company's cooldown in the app. A job is cooling down while
 * its `coolingDownUntil` is still ahead; once that time passes, applying is open again (the API
 * agrees), whether or not Matches was read again meanwhile.
 */
export function coolingUntil(
  job: Pick<JobSummary, 'coolingDownUntil'>,
  now = Date.now(),
): string | undefined {
  const until = job.coolingDownUntil;
  if (until === undefined) return undefined;
  const at = Date.parse(until);
  return Number.isNaN(at) || at <= now ? undefined : until;
}

/** The soonest moment one of these jobs stops cooling down, if any is. */
export function nextCoolingEnd(jobs: readonly Pick<JobSummary, 'coolingDownUntil'>[] = []) {
  const now = Date.now();
  let soonest: number | undefined;
  for (const job of jobs) {
    const until = coolingUntil(job, now);
    if (until !== undefined) soonest = Math.min(soonest ?? Infinity, Date.parse(until));
  }
  return soonest;
}

/** The most a browser timer waits (2^31 − 1 ms, about 24.8 days); longer waits fire at once. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;

/**
 * Draws again at `deadline` (a cooldown ending): nothing else changes then. A deadline further
 * away than one timer can wait is reached in steps.
 */
export function useRedrawAt(deadline: number | undefined) {
  const [step, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    void step;
    if (deadline === undefined) return;
    const wait = deadline - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(redraw, Math.min(wait + 1, LONGEST_TIMER_MS));
    return () => clearTimeout(timer);
  }, [deadline, step]);
}

/** The moment, here, to the minute ("Dec 6, 2026, 6:00 PM"): a cooldown ends at a time of day. */
const MOMENT_HERE = new Intl.DateTimeFormat(copy.locale, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function momentHere(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? iso : MOMENT_HERE.format(at);
}
