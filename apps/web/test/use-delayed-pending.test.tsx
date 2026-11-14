import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDelayedPending } from '../src/lib/use-delayed-pending.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(initial = false, options?: Parameters<typeof useDelayedPending>[1]) {
  return renderHook(({ pending }) => useDelayedPending(pending, options), {
    initialProps: { pending: initial },
  });
}

describe('useDelayedPending', () => {
  it('shows nothing for a wait that ends within the delay', () => {
    const { result, rerender } = setup(true);
    act(() => vi.advanceTimersByTime(299));
    expect(result.current).toBe(false);
    rerender({ pending: false });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
  });

  it('shows once the wait reaches 300 ms', () => {
    const { result } = setup(true);
    act(() => vi.advanceTimersByTime(299));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it('keeps showing until 500 ms after it appeared, even when the work ends just after', () => {
    const { result, rerender } = setup(true);
    act(() => vi.advanceTimersByTime(310));
    rerender({ pending: false });
    // Appeared at 300 ms, so it hides at 800 ms: 490 ms after the work ended.
    act(() => vi.advanceTimersByTime(489));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it('hides at once when the work ends after the minimum has passed', () => {
    const { result, rerender } = setup(true);
    act(() => vi.advanceTimersByTime(300 + 2000));
    rerender({ pending: false });
    act(() => vi.advanceTimersByTime(0));
    expect(result.current).toBe(false);
  });

  it('stays shown, with no new delay, when the work restarts during the hold', () => {
    const { result, rerender } = setup(true);
    act(() => vi.advanceTimersByTime(300));
    rerender({ pending: false });
    act(() => vi.advanceTimersByTime(200));
    rerender({ pending: true });
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(true);
  });

  it('hides at once, skipping the hold, when told to', () => {
    // Every rendered value, so a single render still showing the loader is caught.
    const seen: boolean[] = [];
    const { result, rerender } = renderHook(
      ({ pending, hideNow }) => {
        const shown = useDelayedPending(pending, { hideNow });
        seen.push(shown);
        return shown;
      },
      { initialProps: { pending: true, hideNow: false } },
    );
    act(() => vi.advanceTimersByTime(350));
    expect(result.current).toBe(true);
    seen.length = 0;
    rerender({ pending: false, hideNow: true });
    expect(seen).not.toContain(true);
    // Still hidden once the reason to hide clears during what would have been the hold.
    rerender({ pending: false, hideNow: false });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
  });

  it('keeps the hold to 500 ms when the system clock jumps back', () => {
    const { result, rerender } = setup(true);
    act(() => vi.advanceTimersByTime(300));
    // An NTP sync moves the wall clock back an hour; the hold must not stretch with it.
    vi.setSystemTime(Date.now() - 3_600_000);
    rerender({ pending: false });
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBe(false);
  });

  it('takes its own delay and minimum', () => {
    const { result, rerender } = setup(true, { delay: 50, minDuration: 100 });
    act(() => vi.advanceTimersByTime(50));
    expect(result.current).toBe(true);
    rerender({ pending: false });
    act(() => vi.advanceTimersByTime(99));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });
});
