import { describe, expect, it } from 'vitest';
import { cooldownUntil, crawlLimitsConfig, DEFAULT_CRAWL_LIMITS } from '../src/index.js';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const plus30 = (iso: string) => new Date(Date.parse(iso) + 30 * 86_400_000).toISOString();

describe('cooldownUntil (#52 PR E, 0013)', () => {
  it('none below the limit; at the limit, until the oldest counted one is 30 days old', () => {
    expect(cooldownUntil([ago(1), ago(2)], NOW, 3, 30)).toBeUndefined();
    expect(cooldownUntil([ago(1), ago(20), ago(2)], NOW, 3, 30)).toBe(plus30(ago(20)));
  });

  it('past the limit (the admin lowered it): until enough age out to leave fewer', () => {
    // 4 counted, limit 3: one aging out still leaves 3, so the second oldest decides.
    expect(cooldownUntil([ago(25), ago(20), ago(5), ago(1)], NOW, 3, 30)).toBe(plus30(ago(20)));
    expect(cooldownUntil([ago(25), ago(20), ago(5), ago(1)], NOW, 1, 30)).toBe(plus30(ago(1)));
  });

  it('an application counts for exactly the window, and bad dates never count', () => {
    expect(cooldownUntil([ago(30), ago(1), ago(2)], NOW, 3, 30)).toBeUndefined();
    expect(cooldownUntil([ago(29.99), ago(1), ago(2)], NOW, 3, 30)).toBeDefined();
    expect(cooldownUntil(['not a date', ago(1), ago(2)], NOW, 3, 30)).toBeUndefined();
    expect(cooldownUntil([ago(1), ago(2), ago(3)], NOW, 3, 1)).toBeUndefined();
  });
});

describe('the cooldown rule in the admin limits', () => {
  it('a setting without it gets 3 applications in 30 days', () => {
    expect(crawlLimitsConfig.parse({ dailyDefault: 20, dailyMax: 50 })).toMatchObject({
      applyCompanyLimit: 3,
      applyCooldownDays: 30,
    });
  });

  it('validates the admin values', () => {
    const with_ = (over: object) =>
      crawlLimitsConfig.safeParse({ ...DEFAULT_CRAWL_LIMITS, ...over }).success;
    expect(with_({ applyCompanyLimit: 0 })).toBe(false);
    expect(with_({ applyCompanyLimit: 101 })).toBe(false);
    expect(with_({ applyCooldownDays: 0 })).toBe(false);
    expect(with_({ applyCooldownDays: 366 })).toBe(false);
    expect(with_({ applyCompanyLimit: 1, applyCooldownDays: 365 })).toBe(true);
  });
});
