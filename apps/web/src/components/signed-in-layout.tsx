import type { ReactNode } from 'react';
import { SignOutButton } from '@/components/auth/sign-out-button.tsx';
import { BrandMark } from '@/components/brand-mark.tsx';

/**
 * The frame of every signed-in page (#33): a plain header (the brand, what the page puts beside
 * it, Sign out) over the page's `main`. Sign out is always there, while the profile loads, waits
 * for a connection, or fails too, so nobody is ever stuck on a page.
 */
export function SignedInLayout({
  aside,
  onSignedOut,
  children,
}: {
  /** What the page shows in the header, before Sign out (the set-up's step bar). */
  aside?: ReactNode;
  onSignedOut: () => void;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] bg-background">
      <header className="flex min-h-(--header-height) flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line-soft bg-header-surface px-[17px] py-1.5 sm:px-[clamp(21px,4vw,55px)]">
        <span className="inline-flex min-h-11 min-w-0 items-center gap-2 py-0.5 pe-2.5">
          <BrandMark />
        </span>
        <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end-safe gap-x-4 gap-y-1">
          {aside}
          <SignOutButton onSignedOut={onSignedOut} messageClassName="basis-full text-end" />
        </div>
      </header>
      <main className="grid grid-cols-[minmax(0,1fr)]">{children}</main>
    </div>
  );
}
