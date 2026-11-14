import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stepDuration, useStory } from '../src/components/landing/use-story.ts';

let reduced = false;

beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') && reduced,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
});
