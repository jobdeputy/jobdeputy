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
  it('plays each step as its bar fills, then holds the last with Replay', () => {
    const { result } = renderHook(() => useStory());
    expect(result.current).toMatchObject({ index: 0, mode: 'pause', progress: 'filling' });
    expect(result.current.duration).toBe(4100);
    act(() => result.current.onStepEnd());
    expect(result.current).toMatchObject({ index: 1, duration: 4400, progress: 'filling' });
    act(() => result.current.onStepEnd());
    // The last step plays its time out too, then the story offers Replay.
    expect(result.current).toMatchObject({ index: 2, mode: 'pause', progress: 'filling' });
    act(() => result.current.onStepEnd());
    expect(result.current).toMatchObject({ index: 2, mode: 'replay', progress: 'full' });
    // Autoplay says nothing.
    expect(result.current.announcement).toBe('');
  });

  it('pauses with the bar held part-way, and plays on from there', () => {
    const { result } = renderHook(() => useStory());
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ mode: 'play', progress: 'held', held: true });
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ mode: 'pause', progress: 'filling', held: false });
  });

  it('offers Play, not Replay, when the last step is paused part-way', () => {
    const { result } = renderHook(() => useStory());
    act(() => result.current.onStepEnd());
    act(() => result.current.onStepEnd());
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ index: 2, mode: 'play', progress: 'held' });
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ index: 2, mode: 'pause', progress: 'filling' });
  });

  it('replays from the start', () => {
    const { result } = renderHook(() => useStory());
    for (const _ of [0, 1, 2]) act(() => result.current.onStepEnd());
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ index: 0, mode: 'pause', progress: 'filling' });
  });

  it('shows a chosen step with its bar full, pauses, and says where it is', () => {
    const { result } = renderHook(() => useStory());
    act(() => result.current.goTo(1));
    expect(result.current).toMatchObject({
      index: 1,
      mode: 'play',
      progress: 'full',
      held: false,
      announcement: 'Step 2 of 3: It finds',
    });
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
    expect(result.current).toMatchObject({ mode: 'advance', progress: 'full', animating: false });
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ index: 1, announcement: 'Step 2 of 3: It finds' });
    act(() => result.current.toggle());
    expect(result.current.mode).toBe('replay');
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({
      index: 0,
      mode: 'advance',
      progress: 'full',
      announcement: 'Step 1 of 3: Set it up',
    });
  });

  it('stays still for good once reduced motion is turned on, even if turned off again', () => {
    const { result, rerender } = renderHook(() => useStory());
    reduced = true;
    rerender();
    reduced = false;
    rerender();
    expect(result.current).toMatchObject({ index: 0, mode: 'play', progress: 'full' });
  });

  it('clears what it said once the story plays on', () => {
    const { result } = renderHook(() => useStory());
    act(() => result.current.goTo(0));
    expect(result.current.announcement).toBe('Step 1 of 3: Set it up');
    act(() => result.current.toggle());
    expect(result.current.announcement).toBe('');
  });

  it('waits, its bar empty, while the tab is hidden, and starts the bar over when it is back', () => {
    const { result } = renderHook(() => useStory());
    const { run } = result.current;
    setHidden(true);
    // Nobody can watch: the deputy and the bar hold still.
    expect(result.current).toMatchObject({ animating: false, progress: 'waiting' });
    setHidden(false);
    expect(result.current).toMatchObject({ animating: true, progress: 'filling', run: run + 1 });
  });

  it('keeps the run across a Pause, so the bar goes on from where it stopped', () => {
    const { result } = renderHook(() => useStory());
    const { run } = result.current;
    act(() => result.current.toggle());
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ progress: 'filling', run });
  });

  it('lets go of a hold when reduced motion comes on', () => {
    const { result, rerender } = renderHook(() => useStory());
    act(() => result.current.toggle());
    expect(result.current.progress).toBe('held');
    reduced = true;
    rerender();
    expect(result.current).toMatchObject({ held: false, progress: 'full' });
  });

  it('waits for the page to show from under the boot loader', () => {
    document.body.innerHTML = '<div id="boot-loader"></div><div id="root"></div>';
    const loader = document.getElementById('boot-loader') as HTMLElement;
    const reveal = { animationName: 'boot-reveal', startTime: performance.now() - 2000 };
    loader.getAnimations = () => [reveal] as unknown as Animation[];
    const { result } = renderHook(() => useStory());
    expect(result.current.progress).toBe('waiting');
    act(() => finishBoot());
    // The loader was up past its minimum: it hands over on the next tick.
    act(() => vi.advanceTimersByTime(0));
    expect(result.current.progress).toBe('filling');
  });

  it('holds the flourish only when paused by the Pause button', () => {
    const { result } = renderHook(() => useStory());
    expect(result.current).toMatchObject({ animating: true, held: false });
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ animating: false, held: true });
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ animating: true, held: false });
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
