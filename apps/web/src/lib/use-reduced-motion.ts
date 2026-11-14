import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

let list: MediaQueryList | undefined;
/** One list for the page, made on first use. */
function query(): MediaQueryList {
  list ??= window.matchMedia(QUERY);
  return list;
}

function subscribe(onChange: () => void) {
  const current = query();
  current.addEventListener('change', onChange);
  return () => current.removeEventListener('change', onChange);
}

/** Whether the person asked for reduced motion; follows a change while the page is open. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => query().matches,
    () => false,
  );
}
