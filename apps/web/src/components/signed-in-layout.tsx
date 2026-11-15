import { type ReactNode, useState } from 'react';
import { SignOutButton } from '@/components/auth/sign-out-button.tsx';
import { BrandMark } from '@/components/brand-mark.tsx';
import { HeaderAsideSlot } from '@/components/header-aside.tsx';

/**
 * The frame of every signed-in page (#33): a plain header (the brand, what the page puts there
 * with HeaderAside, Sign out) over the page's `main`. Sign out is always there, while the profile loads, waits
 * for a connection, or fails too, so nobody is ever stuck on a page.
 */
export function SignedInLayout({
  onSignedOut,
  children,
}: {
  onSignedOut: () => void;
  children: ReactNode;
}) {
  // Pages put their header extras here with HeaderAside (the set-up's step bar).
  const [aside, setAside] = useState<HTMLElement | null>(null);
  return (
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] bg-background">
      <header className="flex min-h-(--header-height) flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line-soft bg-header-surface px-[17px] py-1.5 sm:px-[clamp(21px,4vw,55px)]">
        <span className="inline-flex min-h-11 min-w-0 items-center gap-2 py-0.5 pe-2.5">
          <BrandMark />
        </span>
        <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end-safe gap-x-4 gap-y-1">
          <span ref={setAside} className="contents" />
          <SignOutButton onSignedOut={onSignedOut} messageClassName="basis-full text-end" />
        </div>
      </header>
      <main className="grid grid-cols-[minmax(0,1fr)]">
        <HeaderAsideSlot.Provider value={aside}>{children}</HeaderAsideSlot.Provider>
      </main>
    </div>
  );
}
