import { DocumentIcon, PersonIcon } from '@/components/icons.tsx';
import { copy } from '@/copy/index.ts';
import { followLink } from '@/lib/router.ts';
import { cn } from '@/lib/utils.ts';

/** The app's pages, in the sidebar's order. Only pages that exist are listed (#33). */
export const PAGES = [
  { path: '/resumes', label: copy.nav.resumes, icon: <DocumentIcon /> },
  { path: '/profile', label: copy.nav.profile, icon: <PersonIcon /> },
] as const;

/** Where the app opens, and the page shown at an address that is no page (not by list order). */
export const HOME_PAGE = PAGES.find((page) => page.path === '/profile') ?? PAGES[0];

/** The page at this path; Profile at an address that is no page. */
export function pageAt(path: string): (typeof PAGES)[number] {
  return PAGES.find((page) => page.path === path) ?? HOME_PAGE;
}

/**
 * The signed-in app's page list (#33, the round 7 prototype's app shell): the sidebar beside the
 * page from md up; across the top on phones (SignedInLayout places it, beside `main`). The current
 * page is marked (aria-current, and the prototype's 3px green edge, which survives forced colours).
 */
export function AppNav({ path }: { path: string }) {
  return (
    <nav
      aria-label={copy.nav.label}
      className="border-b border-line-soft px-[17px] py-2 md:sticky md:top-0 md:self-start md:border-b-0 md:px-3 md:py-[21px]"
    >
      <ul className="m-0 flex list-none gap-1 p-0 md:grid">
        {PAGES.map((page) => {
          const current = page.path === path;
          return (
            <li key={page.path}>
              <a
                href={page.path}
                aria-current={current ? 'page' : undefined}
                onClick={(event) => followLink(event, page.path)}
                className={cn(
                  'flex min-h-12 items-center gap-[13px] rounded-[11px] border border-transparent px-[13px] text-sm/tight font-[650] text-ink-soft no-underline outline-none hover:border-line hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
                  current &&
                    'border-line border-s-[3px] border-s-green bg-surface ps-[11px] font-[700] text-ink',
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
