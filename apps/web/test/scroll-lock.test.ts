import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepScrollLock } from '../src/lib/scroll-lock.ts';

let stop = () => {};
afterEach(() => {
  stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.removeAttribute('data-scroll-locked');
  document.body.removeAttribute('data-scroll-gap');
  document.body.removeAttribute('style');
});

/**
 * Resolves once a body attribute change has been seen by every observer created before this one:
 * observers hear of a change in the order they were made, so keepScrollLock's has run.
 */
function observed() {
  return new Promise<void>((done) => {
    const after = new MutationObserver(() => {
      after.disconnect();
      done();
    });
    after.observe(document.body, { attributes: true, attributeFilter: ['data-scroll-locked'] });
  });
}

/** A 1024px window whose page has a 15px scrollbar. */
function scrollbar() {
  vi.stubGlobal('innerWidth', 1024);
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1009);
}

describe('keepScrollLock', () => {
  it('measures the scrollbar when Radix locks, and lets go when it unlocks', async () => {
    scrollbar();
    stop = keepScrollLock();
    document.body.setAttribute('data-scroll-locked', '1');
    await vi.waitFor(() => expect(document.body.hasAttribute('data-scroll-gap')).toBe(true));
    expect(document.body.style.getPropertyValue('--scroll-gap')).toBe('15px');
    // A second dialog on top only bumps Radix's counter: nothing is measured again.
    document.body.style.setProperty('--scroll-gap', '7px');
    const bumped = observed();
    document.body.setAttribute('data-scroll-locked', '2');
    await bumped;
    expect(document.body.style.getPropertyValue('--scroll-gap')).toBe('7px');
    document.body.removeAttribute('data-scroll-locked');
    await vi.waitFor(() => expect(document.body.hasAttribute('data-scroll-gap')).toBe(false));
    expect(document.body.style.getPropertyValue('--scroll-gap')).toBe('');
  });

  it('stands aside where Radix’s own style has already locked the page', async () => {
    scrollbar();
    stop = keepScrollLock();
    // What Radix's own <style> sets when it applies.
    document.body.style.setProperty('--removed-body-scroll-bar-size', '15px');
    const seen = observed();
    document.body.setAttribute('data-scroll-locked', '1');
    await seen;
    expect(document.body.hasAttribute('data-scroll-gap')).toBe(false);
    expect(document.body.style.getPropertyValue('--scroll-gap')).toBe('');
  });
});
