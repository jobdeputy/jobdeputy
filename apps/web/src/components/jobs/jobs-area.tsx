import type { ReactNode } from 'react';
import { ApplicationsPage } from '@/components/jobs/applications-page.tsx';
import { MatchesPage } from '@/components/jobs/matches-page.tsx';
import { SearchPage } from '@/components/jobs/search-page.tsx';
import { JOBS_TABS, type JobsTabPath } from '@/components/jobs/tabs.ts';
import { copy } from '@/copy/index.ts';
import { followLink } from '@/lib/router.ts';
import { cn } from '@/lib/utils.ts';

/** Each tab's page, by its path: a tab added without one is a type error. */
const TAB_PAGES: Record<JobsTabPath, () => ReactNode> = {
  '/search': () => <SearchPage />,
  '/matches': () => <MatchesPage />,
  '/applications': () => <ApplicationsPage />,
};

/** The jobs area: its tab row, then the tab at `path`. */
export function JobsArea({ path }: { path: JobsTabPath }) {
  return (
    <div className="grid w-full max-w-[1120px] content-start gap-8">
      <JobsTabs path={path} />
      {TAB_PAGES[path]()}
    </div>
  );
}

/**
 * The tab row (the round 7 prototype's `.tabs`). A tab is a page at its own address, so it is a
 * link (marked `aria-current`), not an ARIA tab: the tab shown sits on the surface with a green
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
