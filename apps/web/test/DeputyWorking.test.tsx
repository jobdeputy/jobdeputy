import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeputyWorking } from '../src/components/deputy/deputy-working.tsx';
import { Panda } from '../src/components/deputy/panda.tsx';
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

describe('Panda', () => {
  it('holds the pencil to set up and the hourglass while pending', () => {
    const { container, rerender } = render(<Panda />);
    // The hourglass's glass is the only path drawn with a line-strong stroke and a paper fill.
    const glass = () => container.querySelector('path.fill-paper.stroke-line-strong[d^="M2 -84"]');
    const pencil = () => container.querySelector('path.stroke-orange[d="M-8 9L34 -33"]');
    expect(pencil()).not.toBeNull();
    expect(glass()).toBeNull();
    rerender(<Panda pose="pending" />);
    expect(glass()).not.toBeNull();
    expect(pencil()).toBeNull();
    expect(container.querySelector('g[transform="rotate(-34 257.3 261.16)"]')).not.toBeNull();
    expect(container.querySelectorAll('g[transform="translate(0 -3)"]')).toHaveLength(2);
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
  /** What the long-wait region reads out (its visible line is aria-hidden). */
  const longRead = () => regions()[2]?.querySelector('.sr-only')?.textContent ?? '';
  /** What the long-wait region shows. */
  const longSeen = () => regions()[2]?.querySelector('[aria-hidden="true"]')?.textContent ?? '';

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
    expect(longRead()).toBe('Searching. Still working…');
    expect(screen.getByText('On it.')).toBeTruthy();
    expect(document.querySelector('svg')).not.toBeNull();
  });

  it('reads out the step the job reports, on its own', () => {
    const { rerender } = render(<Working active step="Reading page 1 of 12" />);
    // React applies each timer's update as its act ends: show first, then run on.
    act(() => vi.advanceTimersByTime(300));
    act(() => vi.advanceTimersByTime(LONG_WAIT_MS));
    rerender(<Working active step="Reading page 2 of 12" />);
    // Its own region: the pill and the long-wait line are not read again with it.
    expect(stepRegion()).toBe('Reading page 2 of 12');
    expect(pill()).toBe('Searching');
  });

  it('adds "Still working…" after 8 s', () => {
    render(<Working active />);
    act(() => vi.advanceTimersByTime(300));
    act(() => vi.advanceTimersByTime(LONG_WAIT_MS - 301));
    expect(longRegion()).toBe('');
    act(() => vi.advanceTimersByTime(1));
    expect(longSeen()).toBe('Still working…');
    // Read with what is still working, not as a bare "Still working…".
    expect(longRead()).toBe('Searching. Still working…');
    expect(regions()[2]?.className).not.toContain('sr-only');
  });

  it('says a background job carries on if the user leaves', () => {
    render(<Working active background />);
    act(() => vi.advanceTimersByTime(300));
    act(() => vi.advanceTimersByTime(LONG_WAIT_MS));
    expect(longSeen()).toBe('This keeps going in the background. You can leave this page.');
    expect(longRead()).toBe(
      'Searching. This keeps going in the background. You can leave this page.',
    );
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
