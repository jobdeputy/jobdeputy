import { copy } from '@/copy/index.ts';
import type { JobSummary } from '@/lib/api/companies.ts';

/** Where a job is worked, in words: its places, then on-site, hybrid or remote (#49). */
export function whereText(job: Pick<JobSummary, 'locations' | 'workplace'>): string {
  const workplace = job.workplace
    ? ((copy.jobsPage.companies.workplace as Record<string, string>)[job.workplace] ?? null)
    : null;
  return [job.locations.map((place) => place.text).join(' · '), workplace]
    .filter(Boolean)
    .join(' · ');
}
