import { copy } from '@/copy/index.ts';
import type { JobSummary } from '@/lib/api/jobs.ts';

/** A job's facts in words, shared by Matches' table and the job pane (#49, #52). */

/** Where a job is worked, in words: its places, then on-site, hybrid or remote (#49). */
export function whereText(job: Pick<JobSummary, 'locations' | 'workplace'>): string {
  const workplace = job.workplace
    ? ((copy.jobsPage.job.workplace as Record<string, string>)[job.workplace] ?? null)
    : null;
  return [job.locations.map((place) => place.text).join(' · '), workplace]
    .filter(Boolean)
    .join(' · ');
}

/** Dates in the copy's language: one for a date-only posting (kept as midnight UTC), one local. */
const DAY_UTC = new Intl.DateTimeFormat(copy.locale, { dateStyle: 'medium', timeZone: 'UTC' });
const DAY_HERE = new Intl.DateTimeFormat(copy.locale, { dateStyle: 'medium' });

/**
 * The day a job was posted ("Nov 3, 2026"), when the board said. A board that gives only a day
 * is kept as midnight UTC, so that is read in UTC (else it would be the day before here); a real
 * time is read here.
 */
export function postedDay(job: Pick<JobSummary, 'postedAt'>): string | null {
  const at = postedTime(job);
  if (at === undefined) return null;
  const date = new Date(at);
  const dateOnly =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  return (dateOnly ? DAY_UTC : DAY_HERE).format(date);
}

/** When a job was posted, as a time to sort by; undefined when the board didn't say. */
export function postedTime(job: Pick<JobSummary, 'postedAt'>): number | undefined {
  const at = job.postedAt ? Date.parse(job.postedAt) : Number.NaN;
  return Number.isNaN(at) ? undefined : at;
}

/** A moment's day here ("Nov 3, 2026"), such as when a job was applied to; null if unreadable. */
export function dayHere(iso: string | undefined): string | null {
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(at) ? null : DAY_HERE.format(at);
}
