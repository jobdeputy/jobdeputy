import { useEffect } from 'react';
import { copy } from '@/copy';
import { PENDING_DELAY_MS, PENDING_MIN_MS } from '@/lib/use-delayed-pending.ts';

/** The loader's fade-out: the prototype's 618 ms secondary motion (index.html's duration-[618ms]). */
export const BOOT_EXIT_MS = 618;

/**
 * How long the boot loader must stay before it ends, given how far its reveal animation has run
 * (`null`: unknown). It follows useDelayedPending's rules: before the 300 ms delay it was never
 * seen, so it goes at once (`'never-shown'`); once seen it stays at least 500 ms.
 */
export function bootHoldMs(revealElapsed: number | null): number | 'never-shown' {
  if (revealElapsed === null || revealElapsed < PENDING_DELAY_MS) return 'never-shown';
  return Math.max(0, PENDING_DELAY_MS + PENDING_MIN_MS - revealElapsed);
}

/** How far the loader's CSS reveal (`boot-reveal`, delay included) has run, or null. */
function revealElapsed(loader: HTMLElement): number | null {
  const reveal = loader
    .getAnimations?.({ subtree: true })
    .find((animation) => (animation as CSSAnimation).animationName === 'boot-reveal');
  const time = reveal?.currentTime;
  return typeof time === 'number' ? time : null;
}

/**
 * Ends the boot loader (index.html) once the app has rendered. Never seen: it is removed at once.
 * Seen: the app stays inert under it for the rest of its 500 ms, then the logo jumps to its
 * settled frame, the track fills, and it fades out (the app usable at once) with a polite "ready".
 * We never wait for the story to finish. Safe to call more than once.
 */
export function finishBoot(): void {
  const loader = document.getElementById('boot-loader');
  if (!loader || loader.dataset.state) return;
  loader.dataset.state = 'ending';

  const hold = bootHoldMs(revealElapsed(loader));
  if (hold === 'never-shown') {
    loader.remove();
    return;
  }
  const root = document.getElementById('root');
  if (root) root.inert = true;
  setTimeout(() => {
    if (root) root.inert = false;
    loader.dataset.state = 'done';
    loader.setAttribute('aria-hidden', 'true');
    const status = document.getElementById('boot-status');
    if (status) status.textContent = copy.boot.ready;
    setTimeout(() => loader.remove(), BOOT_EXIT_MS);
  }, hold);
}

/** Ends the boot loader once `ready` (the app's first screen can show). Today: on first render. */
export function useFinishBoot(ready = true): void {
  useEffect(() => {
    if (ready) finishBoot();
  }, [ready]);
}
