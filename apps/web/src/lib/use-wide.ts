import { useSyncExternalStore } from 'react';

/** Tailwind's `xl` (80rem): wide enough for the job list and the job's preview side by side. */
const QUERY = '(min-width: 80rem)';

let list: MediaQueryList | undefined;
let madeBy: typeof window.matchMedia | undefined;
/** One list for the page, made on first use (again if `matchMedia` itself is replaced). */
function query(): MediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
  if (!list || madeBy !== window.matchMedia) {
    madeBy = window.matchMedia;
    list = window.matchMedia(QUERY);
  }
  return list;
}

/** Any width change (resize covers it, whichever list `query` makes now). */
function subscribe(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

/** Whether the screen is wide enough for a list and its preview side by side (#49 PR D). */
export function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? false,
    () => false,
  );
}
