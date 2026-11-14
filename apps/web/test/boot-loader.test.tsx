import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fillHtmlCopy } from '../html-copy.ts';
import { App } from '../src/App.tsx';
import { en } from '../src/copy/en.ts';
import { BOOT_EXIT_MS, bootHoldMs, finishBoot, useFinishBoot } from '../src/lib/boot-loader.ts';
import { PENDING_DELAY_MS, PENDING_MIN_MS } from '../src/lib/use-delayed-pending.ts';

// Read from disk (Vitest runs in apps/web): Vitest does not load CSS, and the page is not a module.
const indexHtml = fillHtmlCopy(readFileSync('index.html', 'utf8'));
const animationsCss = readFileSync('src/styles/animations.css', 'utf8');

/** The real page body (loader, status, root) as built, without its script. */
function mountIndexBody() {
  const body = /<body>([\s\S]*)<\/body>/.exec(indexHtml)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
}

/**
 * Makes the loader's CSS reveal report it started `elapsed` ms ago (delay included). Its
 * currentTime is what a browser reports: stopped at the end (680 ms) once it has finished.
 */
function revealAt(elapsed: number) {
  const loader = document.getElementById('boot-loader') as HTMLElement;
  const reveal = {
    animationName: 'boot-reveal',
    startTime: performance.now() - elapsed,
    currentTime: Math.min(elapsed, 680),
  };
  loader.getAnimations = () => [reveal] as unknown as Animation[];
}

const loader = () => document.getElementById('boot-loader');
const root = () => document.getElementById('root') as HTMLElement;
const status = () => document.getElementById('boot-status')?.textContent;

beforeEach(() => {
  vi.useFakeTimers();
  mountIndexBody();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('bootHoldMs', () => {
  it('counts a loader as never seen before the delay ends, or when its reveal is unknown', () => {
    expect(bootHoldMs(null)).toBe('never-shown');
    expect(bootHoldMs(0)).toBe('never-shown');
    expect(bootHoldMs(PENDING_DELAY_MS - 1)).toBe('never-shown');
  });

  it('keeps a seen loader up for the rest of its minimum, and no longer', () => {
    expect(bootHoldMs(PENDING_DELAY_MS)).toBe(PENDING_MIN_MS);
    expect(bootHoldMs(PENDING_DELAY_MS + 350)).toBe(PENDING_MIN_MS - 350);
    expect(bootHoldMs(PENDING_DELAY_MS + PENDING_MIN_MS)).toBe(0);
    expect(bootHoldMs(5000)).toBe(0);
  });
});

describe('finishBoot', () => {
  it('removes a loader that was never seen at once, without a word or an inert app', () => {
    revealAt(PENDING_DELAY_MS - 1);
    finishBoot();
    expect(loader()).toBeNull();
    expect(root().inert).toBe(false);
    expect(status()).toBe('');
  });

  it('removes the loader at once when the browser cannot report its reveal', () => {
    finishBoot();
    expect(loader()).toBeNull();
  });

  it('removes the loader at once while its reveal has not started yet', () => {
    revealAt(0);
    (loader() as HTMLElement).getAnimations = () =>
      [{ animationName: 'boot-reveal', startTime: null }] as unknown as Animation[];
    finishBoot();
    expect(loader()).toBeNull();
  });

  it('holds a seen loader for its minimum over an inert app, then settles, announces, and fades', () => {
    revealAt(PENDING_DELAY_MS + 100);
    finishBoot();
    expect(root().inert).toBe(true);
    expect(loader()?.dataset.state).toBe('ending');

    vi.advanceTimersByTime(PENDING_MIN_MS - 101);
    expect(root().inert).toBe(true);
    expect(loader()?.dataset.state).toBe('ending');
    expect(status()).toBe('');

    vi.advanceTimersByTime(1);
    expect(root().inert).toBe(false);
    expect(loader()?.dataset.state).toBe('done');
    expect(loader()?.getAttribute('aria-hidden')).toBe('true');
    expect(status()).toBe(en.boot.ready);

    vi.advanceTimersByTime(BOOT_EXIT_MS - 1);
    expect(loader()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(loader()).toBeNull();
  });

  it('ends a loader seen past its minimum without a hold, long after its reveal finished', () => {
    revealAt(PENDING_DELAY_MS + PENDING_MIN_MS + 2000);
    finishBoot();
    vi.advanceTimersByTime(0);
    expect(loader()?.dataset.state).toBe('done');
  });

  it('runs once, however often it is called', () => {
    revealAt(PENDING_DELAY_MS + 100);
    finishBoot();
    vi.advanceTimersByTime(PENDING_MIN_MS);
    // A second call during the fade must not end it again (or restart the hold).
    revealAt(PENDING_DELAY_MS);
    finishBoot();
    expect(root().inert).toBe(false);
    vi.advanceTimersByTime(BOOT_EXIT_MS);
    expect(loader()).toBeNull();
    expect(() => finishBoot()).not.toThrow();
  });
});

describe('useFinishBoot', () => {
  function Screen({ ready }: { ready: boolean }) {
    useFinishBoot(ready);
    return null;
  }

  it('waits until the app is ready', () => {
    const view = render(<Screen ready={false} />, { container: root() });
    expect(loader()).not.toBeNull();
    view.rerender(<Screen ready />);
    expect(loader()).toBeNull();
  });

  it('is what the landing page ends the boot with', () => {
    render(<App />, { container: root() });
    expect(loader()).toBeNull();
  });
});

describe('boot loader markup (index.html)', () => {
  it('says what en.ts says', () => {
    expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe(
      en.boot.progressLabel,
    );
    // happy-dom parses <noscript> as markup; a browser running scripts does not show it.
    const lines = [...document.querySelectorAll('#boot-loader p')]
      .filter((line) => !line.closest('noscript'))
      .map((line) => line.textContent?.replace(/\s+/g, ' ').trim());
    expect(lines).toEqual([en.boot.status, `${en.boot.slow} ${en.boot.reload}`]);
    expect(document.querySelector('#boot-loader noscript')?.textContent?.trim()).toBe(
      en.boot.noScript,
    );
  });

  it('fades out over BOOT_EXIT_MS', () => {
    expect(loader()?.className).toContain(`duration-[${BOOT_EXIT_MS}ms]`);
  });

  it('reveals after the shared loading delay, with or without motion', () => {
    const delays = [
      ...animationsCss.matchAll(/--animate-boot-reveal[\w-]*: boot-reveal .* (\d+)ms both;/g),
    ];
    expect(delays.map((match) => Number(match[1]))).toEqual([PENDING_DELAY_MS, PENDING_DELAY_MS]);
  });
});
