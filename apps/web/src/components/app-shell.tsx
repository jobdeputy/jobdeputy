import type { ReactNode } from 'react';
import { copy } from '@/copy/index.ts';
import { followLink } from '@/lib/router.ts';
import { cn } from '@/lib/utils.ts';

/** The app's pages, in the sidebar's order. Only pages that exist are listed (#33). */
export const PAGES = [
  { path: '/profile', label: copy.nav.profile, icon: <ProfileIcon /> },
] as const;

/**
 * A signed-in page's frame below the header (#33, the round 7 prototype's app shell): the
 * sidebar's page list beside the page from md up; on phones, the list runs across the top. The
 * current page is marked (aria-current, and the prototype's 3px green edge, which survives forced
 * colours).
 */
export function AppShell({ path, children }: { path: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[233px_minmax(0,1fr)]">
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
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ProfileIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5 shrink-0"
    >
      <circle cx="12" cy="8.25" r="3.75" />
      <path d="M4.75 20c.6-3.75 3.4-6 7.25-6s6.65 2.25 7.25 6" />
    </svg>
  );
}
