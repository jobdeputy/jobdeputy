import { copy } from '@/copy/index.ts';

/**
 * The jobs area's tabs (#52, locked on the issue): Search (links given, and their runs) and
 * Matches (the jobs found, where the app opens), Applications (the jobs applied to). Each is a
 * page of its own, at its own address. Kept apart from the components, so any of them can link to a tab.
 */
export const JOBS_TABS = [
  { path: '/search', label: copy.jobsTabs.search },
  { path: '/matches', label: copy.jobsTabs.matches },
  { path: '/applications', label: copy.jobsTabs.applications },
] as const;

export type JobsTab = (typeof JOBS_TABS)[number];
export type JobsTabPath = JobsTab['path'];

export const SEARCH_TAB = JOBS_TABS[0];

/** The tab the app opens on (#52): Matches. */
export const HOME_TAB = JOBS_TABS[1];

export const APPLICATIONS_TAB = JOBS_TABS[2];

/** The jobs tab at `path`; Matches at any other address. */
export function tabAt(path: string): JobsTab {
  return JOBS_TABS.find((tab) => tab.path === path) ?? HOME_TAB;
}
