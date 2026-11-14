import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stepDuration, useStory } from '../src/components/landing/use-story.ts';
import { finishBoot } from '../src/lib/boot-loader.ts';

let reduced = false;

beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  // Read live: the hook keeps one media query list for the page.
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('reduce') && reduced;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // Leave the page as found, even when a test fails part-way.
  document.body.innerHTML = '';
  Reflect.deleteProperty(document, 'hidden');
});

describe('stepDuration', () => {
  it('gives 1 s plus 240 ms a word, at least 3.4 s, to the nearest 100 ms', () => {
    // 13 words: 1000 + 3120 = 4120 → 4100 (the prototype's "Set it up").
    expect(
      stepDuration({
        title: 'Set it up',
        line: 'Your roles, résumé, and rules.',
        speech: 'Tell me what you want.',
      }),
    ).toBe(4100);
    expect(stepDuration({ title: 'Go', line: '', speech: '' })).toBe(3400);
  });
});

describe('useStory', () => {
  it('plays each step once, then holds the last with Replay', () => {
    const { result } = renderHook(() => useStory());
    expect(result.current).toMatchObject({ index: 0, mode: 'pause' });
    act(() => vi.advanceTimersByTime(4099));
    expect(result.current.index).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.index).toBe(1);
    act(() => vi.advanceTimersByTime(4400));
    expect(result.current).toMatchObject({ index: 2, mode: 'replay' });
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.index).toBe(2);
    // Autoplay says nothing.
    expect(result.current.announcement).toBe('');
  });

  it('pauses and plays on from where it was', () => {
    const { result } = renderHook(() => useStory());
    act(() => result.current.toggle());
    expect(result.current.mode).toBe('play');
    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current.index).toBe(0);
    act(() => result.current.toggle());
    expect(result.current.mode).toBe('pause');
    act(() => vi.advanceTimersByTime(4100));
    expect(result.current.index).toBe(1);
  });

  it('replays from the start', () => {
    const { result } = renderHook(() => useStory());
    act(() => vi.advanceTimersByTime(4100));
    act(() => vi.advanceTimersByTime(4400));
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ index: 0, mode: 'pause' });
  });

  it('shows a chosen step, pauses, and says where it is', () => {
    const { result } = renderHook(() => useStory());
    act(() => result.current.goTo(1));
    expect(result.current).toMatchObject({
      index: 1,
      mode: 'play',
      announcement: 'Step 2 of 3: It finds',
    });
    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current.index).toBe(1);
  });

  it('keeps a chosen step on the story', () => {
    const { result } = renderHook(() => useStory());
    act(() => result.current.goTo(7));
    expect(result.current.index).toBe(2);
    act(() => result.current.goTo(-1));
    expect(result.current.index).toBe(0);
  });

  it('never plays by itself under reduced motion: the button advances a step', () => {
    reduced = true;
    const { result } = renderHook(() => useStory());
    expect(result.current.mode).toBe('advance');
    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current.index).toBe(0);
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ index: 1, announcement: 'Step 2 of 3: It finds' });
    act(() => result.current.toggle());
    expect(result.current.mode).toBe('replay');
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({
      index: 0,
      mode: 'advance',
      announcement: 'Step 1 of 3: Set it up',
    });
    // Replay under reduced motion goes back to the start; it still never plays by itself.
    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current.index).toBe(0);
  });

  it('stays still for good once reduced motion is turned on, even if turned off again', () => {
    const { result, rerender } = renderHook(() => useStory());
    reduced = true;
    rerender();
    reduced = false;
    rerender();
    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current).toMatchObject({ index: 0, mode: 'play' });
  });

  it('clears what it said once the story plays on', () => {
    const { result } = renderHook(() => useStory());
    act(() => result.current.goTo(0));
    expect(result.current.announcement).toBe('Step 1 of 3: Set it up');
    act(() => result.current.toggle());
    expect(result.current.announcement).toBe('');
  });

  it('waits while the tab is hidden, and plays the step from its start when it is back', () => {
    const { result } = renderHook(() => useStory());
    act(() => vi.advanceTimersByTime(3000));
    setHidden(true);
    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current.index).toBe(0);
    setHidden(false);
    act(() => vi.advanceTimersByTime(4099));
    expect(result.current.index).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.index).toBe(1);
  });

  it('waits for the page to show from under the boot loader', () => {
    document.body.innerHTML = '<div id="boot-loader"></div><div id="root"></div>';
    const loader = document.getElementById('boot-loader') as HTMLElement;
    const reveal = { animationName: 'boot-reveal', startTime: performance.now() - 2000 };
    loader.getAnimations = () => [reveal] as unknown as Animation[];
    const { result } = renderHook(() => useStory());
    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current.index).toBe(0);
    act(() => finishBoot());
    // The loader was up past its minimum: it hands over on the next tick.
    act(() => vi.advanceTimersByTime(0));
    act(() => vi.advanceTimersByTime(4099));
    expect(result.current.index).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.index).toBe(1);
  });

  it('holds the flourish only when paused by the Pause button', () => {
    const { result } = renderHook(() => useStory());
    expect(result.current).toMatchObject({ playing: true, held: false });
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ playing: false, held: true });
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ playing: true, held: false });
    act(() => result.current.toggle());
    act(() => result.current.goTo(2));
    expect(result.current.held).toBe(false);
  });
});

function setHidden(hidden: boolean) {
  act(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}
