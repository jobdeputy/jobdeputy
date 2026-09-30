import { describe, expect, it } from 'vitest';
import {
  aiSource,
  crawlLimitsConfig,
  isoWeek,
  nextIsoWeekStart,
  nextPlatformRunAt,
  nextUtcMonthStart,
} from '../src/index.js';

const at = (iso: string) => new Date(iso);

describe('isoWeek', () => {
  it.each([
    ['2026-09-30T12:00:00Z', '2026-W40'],
    ['2026-01-01T00:00:00Z', '2026-W01'], // a Thursday: week 1 of its own year
    ['2024-12-30T00:00:00Z', '2025-W01'], // a Monday in December belongs to next year
    ['2027-01-01T00:00:00Z', '2026-W53'], // a Friday in January belongs to last year
    ['2026-10-04T23:59:59Z', '2026-W40'], // Sunday: still the same week
    ['2026-10-05T00:00:00Z', '2026-W41'], // Monday 00:00 UTC starts the next
  ])('%s is %s', (moment, week) => {
    expect(isoWeek(at(moment))).toBe(week);
  });
});

describe('when the next free run is available', () => {
  it('starts weeks on Monday and months on the 1st, at 00:00 UTC', () => {
    expect(nextIsoWeekStart(at('2026-09-30T12:00:00Z')).toISOString()).toBe(
      '2026-10-05T00:00:00.000Z',
    );
    expect(nextIsoWeekStart(at('2026-10-04T23:00:00Z')).toISOString()).toBe(
      '2026-10-05T00:00:00.000Z',
    );
    expect(nextIsoWeekStart(at('2026-10-05T00:00:00Z')).toISOString()).toBe(
      '2026-10-12T00:00:00.000Z',
    );
    expect(nextUtcMonthStart(at('2026-12-31T23:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  it('waits for whichever limit is used up, or the later of both', () => {
    const now = at('2026-09-30T12:00:00Z');
    expect(nextPlatformRunAt(now, true, false).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(nextPlatformRunAt(now, false, true).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(nextPlatformRunAt(now, true, true).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    const endOfMonth = at('2026-10-27T12:00:00Z'); // both used up: Nov 1 (a Sunday), then Monday Nov 2
    expect(nextPlatformRunAt(endOfMonth, true, true).toISOString()).toBe(
      '2026-11-02T00:00:00.000Z',
    );
  });
});

describe('platform run limits in the crawl limits setting', () => {
  it('default to 1 a week and 4 a month, so older settings still read', () => {
    const parsed = crawlLimitsConfig.parse({ dailyDefault: 20, dailyMax: 50 });
    expect(parsed).toMatchObject({ platformRunsPerWeek: 1, platformRunsPerMonth: 4 });
  });
});

describe('aiSource', () => {
  it('accepts platform, none, and real providers; the test provider only when allowed', () => {
    for (const value of ['platform', 'none', 'openai', 'anthropic']) {
      expect(aiSource(false).safeParse(value).success, value).toBe(true);
    }
    expect(aiSource(false).safeParse('stub').success).toBe(false);
    expect(aiSource(true).safeParse('stub').success).toBe(true);
    expect(aiSource(true).safeParse('gemini').success).toBe(false);
  });
});
