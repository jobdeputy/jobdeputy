import { useLayoutEffect, useRef } from 'react';
import { BrandMark } from '@/components/brand-mark.tsx';
import { copy } from '@/copy/index.ts';
import { AuthButton, type AuthControl } from './auth-drawer.tsx';

/**
 * The sticky top bar: the brand on the left, sign-in and sign-up on the right. Phones keep only
 * "Sign in" here; the hero right below offers "Get started free". At least --header-height tall,
 * it grows and wraps to a second row when enlarged text no longer fits on one.
 */
export function SiteHeader({ auth }: { auth: AuthControl }) {
  const header = useRef<HTMLElement>(null);
  useHeaderOffset(header);
  return (
    <header
      ref={header}
      className="sticky top-0 z-20 flex min-h-(--header-height) flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line-soft bg-header-surface px-[17px] backdrop-blur-[20px] backdrop-saturate-180 py-1.5 sm:px-[clamp(21px,4vw,55px)]"
    >
      <a
        href="/"
        className="group inline-flex min-h-11 min-w-0 items-center gap-2 rounded-[15px] py-0.5 pe-2.5 transition-colors duration-180 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring focus-visible:outline-solid"
      >
        <BrandMark />
      </a>
      <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end-safe gap-2 md:gap-3.5">
        <AuthButton control={auth} mode="sign-in" variant="outline">
          {copy.landing.signIn}
        </AuthButton>
        <AuthButton control={auth} mode="sign-up" className="hidden md:inline-flex">
          {copy.landing.getStarted}
        </AuthButton>
      </div>
    </header>
  );
}

/**
 * Publishes the header's real height as `--header-offset` on the page root, so the scroll padding
 * follows it when enlarged text makes the header grow or wrap. CSS falls back to
 * `--header-height`, the minimum, before this runs.
 */
function useHeaderOffset(header: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = header.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    let published = -1;
    // The observed border box, unrounded; written only when the height changes (a width-only
    // resize leaves the page's styles alone).
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.borderBoxSize[0]?.blockSize;
      if (height === undefined || height === published) return;
      published = height;
      root.style.setProperty('--header-offset', `${height}px`);
    });
    observer.observe(element, { box: 'border-box' });
    return () => {
      observer.disconnect();
      root.style.removeProperty('--header-offset');
    };
  }, [header]);
}
