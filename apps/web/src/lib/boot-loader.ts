import { useEffect, useSyncExternalStore } from 'react';
import { copy } from '@/copy';
import { PENDING_DELAY_MS, PENDING_MIN_MS } from '@/lib/use-delayed-pending.ts';

/** The loader's fade-out: the prototype's 618 ms secondary motion (index.html's duration-[618ms]). */
export const BOOT_EXIT_MS = 618;

/** Fired on window when the page shows from under the boot loader (or at once, if it never did). */
const REVEALED = 'jobdeputy:revealed';

/** Whether the page can be seen: no boot loader over it, or one already fading. */
export function isRevealed(): boolean {
  const loader = document.getElementById('boot-loader');
  return !loader || loader.dataset.state === 'done';
}

/** Calls `onChange` when the page is revealed; returns the unsubscribe (useSyncExternalStore). */
export function onRevealed(onChange: () => void): () => void {
  window.addEventListener(REVEALED, onChange);
  return () => window.removeEventListener(REVEALED, onChange);
}

/**
 * How long the boot loader must stay before it ends, given how far its reveal animation has run
 * (`null`: unknown). It follows useDelayedPending's rules: before the 300 ms delay it was never
 * seen, so it goes at once (`'never-shown'`); once seen it stays at least 500 ms.
 */
export function bootHoldMs(revealElapsed: number | null): number | 'never-shown' {
  if (revealElapsed === null || revealElapsed < PENDING_DELAY_MS) return 'never-shown';
  return Math.max(0, PENDING_DELAY_MS + PENDING_MIN_MS - revealElapsed);
}

/**
 * How long ago the loader's CSS reveal (`boot-reveal`) started, delay included, or null. Measured
 * from its start time, not its `currentTime`, which stops at the animation's end (680 ms).
 */
function revealElapsed(loader: HTMLElement): number | null {
  const reveal = loader
    .getAnimations?.({ subtree: true })
    .find((animation) => (animation as CSSAnimation).animationName === 'boot-reveal');
  const start = reveal?.startTime;
  // The document timeline and performance.now() share the page's time origin.
  return typeof start === 'number' ? performance.now() - start : null;
}

/**
 * Ends the boot loader (index.html) once the app has rendered. Never seen: it is removed at once.
 * Seen: the app stays inert under it for the rest of its 500 ms, then the logo jumps to its
 * settled frame, the track fills, and it fades out, inert (the app usable at once), with a polite
 * "ready", while the page rises in under it on the same timing.
 * We never wait for the story to finish. Safe to call more than once.
 */
export function finishBoot(): void {
  const loader = document.getElementById('boot-loader');
  if (!loader || loader.dataset.state) return;
  loader.dataset.state = 'ending';

  const hold = bootHoldMs(revealElapsed(loader));
  if (hold === 'never-shown') {
    loader.remove();
    window.dispatchEvent(new Event(REVEALED));
    return;
  }
  const root = document.getElementById('root');
  if (root) root.inert = true;
  setTimeout(() => {
    // Usable at once, as the page rises in under the fade (index.html's #root, a CSS animation).
    if (root) root.inert = false;
    loader.dataset.state = 'done';
    window.dispatchEvent(new Event(REVEALED));
    // Inert while it fades: out of the accessibility tree, and its Reload link (shown after 8 s)
    // gives up focus, which goes back to the page as on any fresh load.
    if (loader.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    loader.inert = true;
    const status = document.getElementById('boot-status');
    if (status) status.textContent = copy.boot.ready;
    removeWhenSettled(loader, root);
  }, hold);
}

/**
 * Removes the loader once its fade and the page's rise (keyed to the loader, so removing it would
 * cut the rise short) have both finished or been cancelled; at once when there are none (reduced
 * motion). getAnimations() settles styles first, so both exist the moment the fade starts. No
 * timer: in a hidden tab they wait and run when it is back, and a cancelled one settles too.
 */
function removeWhenSettled(loader: HTMLElement, root: HTMLElement | null) {
  const moving = [...(loader.getAnimations?.() ?? []), ...(root?.getAnimations?.() ?? [])];
  if (moving.length === 0) {
    loader.remove();
    return;
  }
  void Promise.allSettled(moving.map((animation) => animation.finished)).then(() =>
    loader.remove(),
  );
}

/** Whether the page can be seen yet: what starts motion the visitor should watch (the story). */
export function useRevealed(): boolean {
  return useSyncExternalStore(onRevealed, isRevealed, () => true);
}

/** Ends the boot loader once `ready` (the app's first screen can show). Today: on first render. */
export function useFinishBoot(ready = true): void {
  useEffect(() => {
    if (ready) finishBoot();
  }, [ready]);
}
