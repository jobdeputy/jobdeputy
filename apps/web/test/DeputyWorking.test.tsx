import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeputyWorking } from '../src/components/deputy/deputy-working.tsx';
import { LONG_WAIT_MS, useLongWait } from '../src/lib/use-delayed-pending.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useLongWait', () => {
  it('turns true once the wait has lasted 8 s, and false as soon as it ends', () => {
    const { result, rerender } = renderHook(({ active }) => useLongWait(active), {
      initialProps: { active: true },
    });
    act(() => vi.advanceTimersByTime(LONG_WAIT_MS - 1));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
    rerender({ active: false });
    expect(result.current).toBe(false);
  });

  it('never reports a long wait for a render after the wait has ended', () => {
    const seen: [boolean, boolean][] = [];
    const { rerender } = renderHook(
      ({ active }) => {
        const long = useLongWait(active);
        seen.push([active, long]);
        return long;
      },
      { initialProps: { active: true } },
    );
    act(() => vi.advanceTimersByTime(LONG_WAIT_MS));
    rerender({ active: false });
    expect(seen.filter(([active, long]) => !active && long)).toEqual([]);
  });

  it('starts counting again for a new wait', () => {
    const { result, rerender } = renderHook(({ active }) => useLongWait(active), {
      initialProps: { active: true },
    });
    act(() => vi.advanceTimersByTime(5000));
    rerender({ active: false });
    rerender({ active: true });
    act(() => vi.advanceTimersByTime(LONG_WAIT_MS - 1));
    expect(result.current).toBe(false);
  });
});

describe('DeputyWorking', () => {
  function Working(props: {
    active: boolean;
    background?: boolean;
    step?: string;
    longWaitAfter?: number;
  }) {
    return <DeputyWorking status="Searching" speech="On it." {...props} />;
  }
  /** The three live regions, in order: the pill, the step, the long-wait line. */
  const regions = () => screen.getAllByRole('status');
  const pill = () => regions()[0]?.textContent;
  const stepRegion = () => regions()[1]?.textContent;
  const longRegion = () => regions()[2]?.textContent;

  it('shows nothing for 300 ms, with its live regions already there and empty', () => {
    render(<Working active />);
    expect(regions()).toHaveLength(3);
    expect(regions().map((region) => region.textContent)).toEqual(['', '', '']);
    // Empty regions stay in the accessibility tree: visually hidden, never display:none.
    expect(regions()[1]?.className).toContain('sr-only');
    expect(regions()[2]?.className).toContain('sr-only');
    expect(document.querySelector('svg')).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(pill()).toBe('Searching');
  });

  it('fills its regions a beat apart when it shows, so each is read', () => {
    render(<Working active step="Reading page 1 of 12" longWaitAfter={0} />);
    act(() => vi.advanceTimersByTime(300));
    expect([pill(), stepRegion(), longRegion()]).toEqual(['Searching', '', '']);
    act(() => vi.advanceTimersByTime(100));
    expect([stepRegion(), longRegion()]).toEqual(['Reading page 1 of 12', '']);
    act(() => vi.advanceTimersByTime(100));
    expect(longRegion()).toBe('Still working…');
    expect(screen.getByText('On it.')).toBeTruthy();
    expect(document.querySelector('svg')).not.toBeNull();
  });

  it('reads out the step the job reports, on its own', () => {
    const { rerender } = render(<Working active step="Reading page 1 of 12" />);
    // React applies each timer's update as its act ends: show first, then run on.
    act(() => vi.advanceTimersByTime(300));
    act(() => vi.advanceTimersByTime(LONG_WAIT_MS));
    const longBefore = longRegion();
    rerender(<Working active step="Reading page 2 of 12" />);
    // Its own region: the pill and the long-wait line are not read again with it.
    expect(stepRegion()).toBe('Reading page 2 of 12');
    expect(pill()).toBe('Searching');
    expect(longRegion()).toBe(longBefore);
  });

  it('reads a new status once, by the pill, during a long wait', () => {
    const { rerender } = render(<DeputyWorking active status="Searching" speech="On it." />);
    act(() => vi.advanceTimersByTime(300));
    act(() => vi.advanceTimersByTime(LONG_WAIT_MS));
    const longBefore = longRegion();
    rerender(<DeputyWorking active status="Ranking" speech="On it." />);
    expect(pill()).toBe('Ranking');
    expect(longRegion()).toBe(longBefore);
  });

  it('paces its regions again each time it shows', () => {
    const { rerender } = render(<Working active step="Reading page 1 of 12" />);
    act(() => vi.advanceTimersByTime(300));
    act(() => vi.advanceTimersByTime(200));
    rerender(<Working active={false} step="Reading page 1 of 12" />);
    act(() => vi.advanceTimersByTime(500));
    rerender(<Working active step="Reading page 1 of 12" />);
    act(() => vi.advanceTimersByTime(300));
    // Shown again: the pill first, the step a beat later, as the first time.
    expect([pill(), stepRegion()]).toEqual(['Searching', '']);
    act(() => vi.advanceTimersByTime(100));
    expect(stepRegion()).toBe('Reading page 1 of 12');
  });

  it('adds "Still working…" after 8 s', () => {
    render(<Working active />);
    act(() => vi.advanceTimersByTime(300));
    act(() => vi.advanceTimersByTime(LONG_WAIT_MS - 301));
    expect(longRegion()).toBe('');
    act(() => vi.advanceTimersByTime(1));
    expect(longRegion()).toBe('Still working…');
    expect(regions()[2]?.className).not.toContain('sr-only');
  });

  it('says a background job carries on if the user leaves', () => {
    render(<Working active background />);
    act(() => vi.advanceTimersByTime(300));
    act(() => vi.advanceTimersByTime(LONG_WAIT_MS));
    expect(longRegion()).toBe('This keeps going in the background. You can leave this page.');
  });

  it('stays its 500 ms once shown, then goes when the job ends', () => {
    const { rerender } = render(<Working active />);
    act(() => vi.advanceTimersByTime(300));
    rerender(<Working active={false} />);
    act(() => vi.advanceTimersByTime(499));
    expect(screen.queryByText('On it.')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('On it.')).toBeNull();
    expect(regions().map((region) => region.textContent)).toEqual(['', '', '']);
  });
});
