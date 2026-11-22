import { useEffect, useRef } from 'react';
import { BriefcaseIcon, DocumentIcon, PersonIcon } from '@/components/icons.tsx';
import { copy } from '@/copy/index.ts';
import { followLink } from '@/lib/router.ts';
import { cn } from '@/lib/utils.ts';

/** The app's pages, in the sidebar's order. Only pages that exist are listed (#33). */
export const PAGES = [
  { path: '/jobs', label: copy.nav.jobs, icon: <BriefcaseIcon /> },
  { path: '/resumes', label: copy.nav.resumes, icon: <DocumentIcon /> },
  { path: '/profile', label: copy.nav.profile, icon: <PersonIcon /> },
] as const;

/** Where the app opens, and the page shown at an address that is no page: Job matches (#49). */
export const HOME_PAGE = PAGES.find((page) => page.path === '/jobs') ?? PAGES[0];

/** The page at this path; Job matches at an address that is no page. */
export function pageAt(path: string): (typeof PAGES)[number] {
  return PAGES.find((page) => page.path === path) ?? HOME_PAGE;
}

/**
 * The signed-in app's page list (#33, the round 7 prototype's app shell): the sidebar beside the
 * page from md up; across the top on phones (SignedInLayout places it, beside `main`). The current
 * page is marked (aria-current, and the prototype's 3px green edge, which survives forced colours).
 */
export function AppNav({ path }: { path: string }) {
  // On a phone row too narrow for every name, the row scrolls to show the current page. Only the
  // row moves (its scrollLeft), never the page, wherever the page is scrolled to.
  const current = useRef<HTMLAnchorElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the link marked changes with the path.
  useEffect(() => {
    const link = current.current;
    const row = link?.closest('ul');
    if (link && row) row.scrollLeft = scrollToShow(row, link);
  }, [path]);
  return (
    <nav
      aria-label={copy.nav.label}
      className="border-b border-line-soft px-[17px] py-2 md:sticky md:top-0 md:self-start md:border-b-0 md:px-3 md:py-[21px]"
    >
      {/* Phones: one row; if the names don't fit (320px, large text), the row scrolls on its own,
          never the page, and a name never breaks inside a word. Its 4px padding (taken back by
          the margin) holds a link's focus ring, which a scrolling box would clip. */}
      <ul className="relative -m-1 flex list-none gap-1 overflow-x-auto p-1 md:m-0 md:grid md:overflow-visible md:p-0">
        {PAGES.map((page) => {
          const isCurrent = page.path === path;
          return (
            <li key={page.path} className="shrink-0">
              <a
                ref={isCurrent ? current : undefined}
                href={page.path}
                aria-current={isCurrent ? 'page' : undefined}
                onClick={(event) => followLink(event, page.path)}
                className={cn(
                  'flex min-h-12 items-center gap-2 rounded-[11px] border border-transparent px-[11px] text-sm/tight font-[650] whitespace-nowrap md:gap-[13px] md:px-[13px] text-ink-soft no-underline outline-none hover:border-line hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
                  isCurrent &&
                    'border-line border-s-[3px] border-s-green bg-surface ps-[9px] font-[700] text-ink md:ps-[11px]',
                )}
              >
                {page.icon}
                {page.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Where a scrolled row should be for `item` to show whole: as it is when the item already shows,
 * else just far enough. `item`'s offsets are within the row (the row is its offset parent).
 */
export function scrollToShow(
  row: Pick<HTMLElement, 'scrollLeft' | 'clientWidth'>,
  item: Pick<HTMLElement, 'offsetLeft' | 'offsetWidth'>,
): number {
  if (item.offsetLeft < row.scrollLeft) return item.offsetLeft;
  const end = item.offsetLeft + item.offsetWidth;
  return end > row.scrollLeft + row.clientWidth ? end - row.clientWidth : row.scrollLeft;
}
