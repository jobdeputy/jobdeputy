import { useEffect, useRef, useState } from 'react';

/** Waits shorter than this show nothing: most calls finish before a loader would even register. */
export const PENDING_DELAY_MS = 300;
/** Once a loader shows, it stays at least this long, so it never flashes on and off. */
export const PENDING_MIN_MS = 500;

/**
 * Whether a wait should show its loading state yet (#17). It turns true only once `isPending` has
 * lasted `delay` ms, then stays true for at least `minDuration` ms, even if the work ends sooner.
 * Every loading state in the app goes through this hook, so they all time the same way. Pass a
 * TanStack Query flag straight in: `mutation.isPending`, or `query.isLoading` for a query (its
 * `isPending` stays true while a disabled query waits, so the loader would never leave).
 * `hideNow` ends the loading state at once, skipping the hold: for a success state that replaces it.
 */
export function useDelayedPending(
  isPending: boolean,
  { delay = PENDING_DELAY_MS, minDuration = PENDING_MIN_MS, hideNow = false } = {},
): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (hideNow) {
      setShown(false);
      return;
    }
    if (isPending) {
      // Already showing (the work restarted during the hold): keep showing, no new delay.
      if (shown) return;
      const timer = setTimeout(() => {
        shownAt.current = performance.now();
        setShown(true);
      }, delay);
      return () => clearTimeout(timer);
    }
    if (!shown) return;
    const timer = setTimeout(
      () => setShown(false),
      Math.max(0, shownAt.current + minDuration - performance.now()),
    );
    return () => clearTimeout(timer);
  }, [isPending, shown, delay, minDuration, hideNow]);

  return shown && !hideNow;
}
