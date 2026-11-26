import { MatchesPage } from '@/components/jobs/matches-page.tsx';
import { SearchPage } from '@/components/jobs/search-page.tsx';
import { copy } from '@/copy/index.ts';
import { followLink } from '@/lib/router.ts';
import { cn } from '@/lib/utils.ts';

/**
 * The jobs area's tabs (#52, locked on the issue): Search (links given, and their runs) and
 * Matches (the jobs found, where the app opens); Applications joins in PR D. Each is a page of
 * its own, at its own address, so a tab is a link (marked `aria-current`), not an ARIA tab.
 */
export const JOBS_TABS = [
  { path: '/search', label: copy.jobsTabs.search },
  { path: '/matches', label: copy.jobsTabs.matches },
] as const;

export type JobsTabPath = (typeof JOBS_TABS)[number]['path'];

/** The tab the app opens on (#52): Matches. */
export const HOME_TAB = JOBS_TABS[1];

/** The jobs tab at `path`; Matches at any other address. */
export function tabAt(path: string): (typeof JOBS_TABS)[number] {
  return JOBS_TABS.find((tab) => tab.path === path) ?? HOME_TAB;
}

/** The jobs area: its tab row, then the tab at `path`. */
export function JobsArea({ path }: { path: JobsTabPath }) {
  return (
    <div className="grid w-full max-w-[1120px] content-start gap-8">
      <JobsTabs path={path} />
      {path === '/search' ? <SearchPage /> : <MatchesPage />}
    </div>
  );
}

/**
 * The tab row (the round 7 prototype's `.tabs`): the tab shown sits on the surface with a green
 * bottom edge (a border, so it survives forced colours); the row wraps on a narrow phone.
 */
export function JobsTabs({ path }: { path: JobsTabPath }) {
  return (
    <nav aria-label={copy.jobsTabs.label}>
      <ul className="m-0 flex min-w-0 list-none flex-wrap gap-1 p-0">
        {JOBS_TABS.map((tab) => {
          const isCurrent = tab.path === path;
          return (
            <li key={tab.path}>
              <a
                href={tab.path}
                aria-current={isCurrent ? 'page' : undefined}
                onClick={(event) => followLink(event, tab.path)}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-[11px] border border-b-3 border-transparent px-[13px] text-sm font-[650] whitespace-nowrap text-muted-foreground no-underline transition-colors duration-180 outline-none hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green focus-visible:outline-solid',
                  isCurrent && 'border-line border-b-green bg-surface font-[700] text-ink',
                )}
              >
                {tab.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
