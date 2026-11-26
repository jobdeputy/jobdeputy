import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  coolingUntil,
  momentHere,
  nextCoolingEnd,
  useRedrawAt,
} from '../src/components/jobs/cooldown.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('the cooldown in the app (#52 PR E)', () => {
  const NOW = Date.parse('2026-11-26T12:00:00.000Z');

  it('cools down only while its end is ahead', () => {
    expect(coolingUntil({}, NOW)).toBeUndefined();
    expect(coolingUntil({ coolingDownUntil: '2026-11-26T12:00:00.000Z' }, NOW)).toBeUndefined();
    expect(coolingUntil({ coolingDownUntil: 'soon' }, NOW)).toBeUndefined();
    expect(coolingUntil({ coolingDownUntil: '2026-11-26T12:00:01.000Z' }, NOW)).toBe(
      '2026-11-26T12:00:01.000Z',
    );
  });

  it('finds the soonest end still ahead', () => {
    vi.useFakeTimers({ now: NOW });
    expect(nextCoolingEnd()).toBeUndefined();
    expect(
      nextCoolingEnd([
        { coolingDownUntil: '2026-11-20T00:00:00.000Z' },
        { coolingDownUntil: '2026-12-06T18:00:00.000Z' },
        {},
        { coolingDownUntil: '2026-12-01T09:00:00.000Z' },
      ]),
    ).toBe(Date.parse('2026-12-01T09:00:00.000Z'));
  });

  it('draws again at the end, even 30 days away (past what one timer can wait)', () => {
    vi.useFakeTimers({ now: NOW });
    let draws = 0;
    const end = NOW + 30 * 86_400_000;
    renderHook(() => {
      draws += 1;
      useRedrawAt(end);
    });
    const first = draws;
    // One timer waits at most about 24.8 days: it must not fire at once.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(draws).toBe(first);
    act(() => {
      vi.advanceTimersByTime(25 * 86_400_000);
    });
    const stepped = draws;
    act(() => {
      vi.advanceTimersByTime(end - Date.now() + 1);
    });
    expect(draws).toBeGreaterThan(stepped);
  });

  it('says the moment to the minute', () => {
    expect(momentHere('2026-12-06T23:00:00.000Z')).toMatch(/^Dec 6, 2026, \d{1,2}:00\s?[AP]M$/);
    expect(momentHere('not a date')).toBe('not a date');
  });
});
