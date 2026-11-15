import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fillHtmlCopy } from '../html-copy.ts';
import { en } from '../src/copy/en.ts';
import { BOOT_EXIT_MS, bootHoldMs, finishBoot, useFinishBoot } from '../src/lib/boot-loader.ts';
import { PENDING_DELAY_MS, PENDING_MIN_MS } from '../src/lib/use-delayed-pending.ts';
import { renderApp } from './render-app.tsx';

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
  vi.restoreAllMocks();
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
    (loader() as HTMLElement).getAnimations = () =>
      [{ animationName: 'boot-reveal', startTime: null }] as unknown as Animation[];
    finishBoot();
    expect(loader()).toBeNull();
  });

  it('holds a seen loader for its minimum over an inert app, then settles, announces, and fades', async () => {
    revealAt(PENDING_DELAY_MS + 100);
    finishBoot();
    expect(root().inert).toBe(true);
    expect(loader()?.dataset.state).toBe('ending');

    vi.advanceTimersByTime(PENDING_MIN_MS - 101);
    expect(root().inert).toBe(true);
    expect(loader()?.dataset.state).toBe('ending');
    expect(status()).toBe('');

    const element = loader() as HTMLElement;
    vi.advanceTimersByTime(1);
    expect(root().inert).toBe(false);
    expect(element.dataset.state).toBe('done');
    expect(element.inert).toBe(true);
    expect(status()).toBe(en.boot.ready);
    // Its only animation (the stubbed reveal) has settled: it goes.
    await vi.waitFor(() => expect(loader()).toBeNull());
  });

  it('takes focus off its Reload link as it hands over', () => {
    const reload = document.querySelector<HTMLAnchorElement>('#boot-loader a') as HTMLAnchorElement;
    reload.focus();
    expect(document.activeElement).toBe(reload);
    revealAt(PENDING_DELAY_MS + PENDING_MIN_MS);
    finishBoot();
    vi.advanceTimersByTime(0);
    expect(document.activeElement).not.toBe(reload);
  });

  it('ends a loader seen past its minimum without a hold, long after its reveal finished', () => {
    revealAt(PENDING_DELAY_MS + PENDING_MIN_MS + 2000);
    finishBoot();
    vi.advanceTimersByTime(0);
    expect(loader()?.dataset.state).toBe('done');
  });

  it("goes once its fade and the page's rise have both settled", async () => {
    const settle = { fade: () => {}, rise: () => {} };
    const fade = new Promise<void>((resolve) => {
      settle.fade = resolve;
    });
    const rise = new Promise<void>((resolve) => {
      settle.rise = resolve;
    });
    // The loader's reveal (seen long enough) and its fade, both reported by getAnimations.
    const seen = { animationName: 'boot-reveal', startTime: performance.now() - 2000 };
    (loader() as HTMLElement).getAnimations = () =>
      [{ ...seen, finished: fade }] as unknown as Animation[];
    root().getAnimations = () => [{ finished: rise }] as unknown as Animation[];
    finishBoot();
    vi.advanceTimersByTime(0);
    settle.fade();
    // Every pending promise run: the fade alone has settled, the rise has not.
    await vi.advanceTimersByTimeAsync(0);
    expect(loader()).not.toBeNull();
    settle.rise();
    await vi.waitFor(() => expect(loader()).toBeNull());
  });

  it("goes on the elements' own end events when an engine never settles `finished`", async () => {
    const never = new Promise<void>(() => {});
    const seen = { animationName: 'boot-reveal', startTime: performance.now() - 2000 };
    // The reveal (seen long enough, already over) and the fade, a transition of opacity.
    (loader() as HTMLElement).getAnimations = () =>
      [seen, { transitionProperty: 'opacity', finished: never }] as unknown as Animation[];
    root().getAnimations = () =>
      [{ animationName: 'boot-rise', finished: never }] as unknown as Animation[];
    finishBoot();
    vi.advanceTimersByTime(0);
    root().dispatchEvent(Object.assign(new Event('animationend'), { animationName: 'boot-rise' }));
    // An end event from inside the loader, or for another property, is not its fade: it stays.
    const inner = loader()?.querySelector('p');
    inner?.dispatchEvent(new Event('transitionend', { bubbles: true }));
    loader()?.dispatchEvent(
      Object.assign(new Event('transitionend'), { propertyName: 'transform' }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(loader()).not.toBeNull();
    loader()?.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'opacity' }));
    await vi.waitFor(() => expect(loader()).toBeNull());
  });

  it('goes at the latest at twice its fade, where an engine settles nothing (Linux WebKit)', () => {
    const never = new Promise<void>(() => {});
    const seen = { animationName: 'boot-reveal', startTime: performance.now() - 2000 };
    (loader() as HTMLElement).getAnimations = () =>
      [seen, { transitionProperty: 'opacity', finished: never }] as unknown as Animation[];
    finishBoot();
    vi.advanceTimersByTime(BOOT_EXIT_MS * 2 - 1);
    expect(loader()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(loader()).toBeNull();
  });

  it('goes when its animations are cancelled too', async () => {
    const seen = { animationName: 'boot-reveal', startTime: performance.now() - 2000 };
    const cancelled = Promise.reject(new DOMException('cancelled', 'AbortError'));
    cancelled.catch(() => {});
    (loader() as HTMLElement).getAnimations = () =>
      [{ ...seen, finished: cancelled }] as unknown as Animation[];
    finishBoot();
    vi.advanceTimersByTime(0);
    await vi.waitFor(() => expect(loader()).toBeNull());
  });

  it('runs once, however often it is called', async () => {
    revealAt(PENDING_DELAY_MS + 100);
    finishBoot();
    vi.advanceTimersByTime(PENDING_MIN_MS);
    // A second call during the fade must not end it again (or restart the hold).
    revealAt(PENDING_DELAY_MS);
    finishBoot();
    expect(root().inert).toBe(false);
    await vi.waitFor(() => expect(loader()).toBeNull());
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

  it('is what the landing page ends the boot with', async () => {
    // Real timers: the page waits for its session check before it can end the boot.
    vi.useRealTimers();
    await renderApp(undefined, { container: root() });
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

  it('rises the page in as it fades, on its timing, unless motion is reduced', () => {
    expect(loader()?.classList.contains('peer')).toBe(true);
    expect(root().className).toBe('peer-data-[state=done]:motion-safe:animate-boot-rise');
    expect(animationsCss).toContain(`--animate-boot-rise: boot-rise ${BOOT_EXIT_MS}ms`);
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
