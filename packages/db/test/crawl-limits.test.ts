import { DEFAULT_CRAWL_LIMITS, DEFAULT_PREMIUM_LIMITS } from '@jobdeputy/shared';
import { describe, expect, it, vi } from 'vitest';
import { cachedCrawlLimits, LIMITS_CACHE_MS, tieredLimits } from '../src/crawl-limits.js';

describe('cachedCrawlLimits', () => {
  it('reads the admin setting once, then serves it from memory for 5 minutes', async () => {
    let now = 0;
    const read = vi.fn(async () => '{"dailyDefault":10,"dailyMax":40}');
    const limits = cachedCrawlLimits(read, () => now);
    expect(await limits()).toEqual({
      dailyDefault: 10,
      dailyMax: 40,
      maxActive: 1,
      platformRunsPerWeek: 1,
      platformRunsPerMonth: 4,
      companyJobsDefault: 3,
      companyJobsMax: 10,
      jobExpiryDays: 7,
      relevanceMaxJobs: 50,
      relevanceMinScore: 30,
      listsPerDay: 2,
      listCompanies: 20,
      platformTailoringsPerMonth: 10,
      premium: DEFAULT_PREMIUM_LIMITS,
    });
    now = LIMITS_CACHE_MS - 1;
    await limits();
    expect(read).toHaveBeenCalledTimes(1);

    // An admin change is picked up once the cache expires, without a deploy.
    read.mockResolvedValue('{"dailyDefault":5,"dailyMax":8}');
    // (maxActive is optional in the setting: the default 1 applies.)
    now = LIMITS_CACHE_MS;
    expect(await limits()).toEqual({
      dailyDefault: 5,
      dailyMax: 8,
      maxActive: 1,
      platformRunsPerWeek: 1,
      platformRunsPerMonth: 4,
      companyJobsDefault: 3,
      companyJobsMax: 10,
      jobExpiryDays: 7,
      relevanceMaxJobs: 50,
      relevanceMinScore: 30,
      listsPerDay: 2,
      listCompanies: 20,
      platformTailoringsPerMonth: 10,
      premium: DEFAULT_PREMIUM_LIMITS,
    });
  });

  it.each([
    ['not JSON', 'twenty'],
    ['missing', undefined],
    ['a default above the maximum', '{"dailyDefault":60,"dailyMax":50}'],
    ['zero', '{"dailyDefault":0,"dailyMax":50}'],
    ['huge', '{"dailyDefault":20,"dailyMax":100000}'],
    ['unknown fields', '{"dailyDefault":20,"dailyMax":50,"x":1}'],
  ])('falls back to the built-in defaults for a setting that is %s', async (_, raw) => {
    const limits = cachedCrawlLimits(async () => raw);
    expect(await limits()).toEqual(DEFAULT_CRAWL_LIMITS);
  });

  it('uses the defaults when the read fails, and tries again next time', async () => {
    const read = vi
      .fn<() => Promise<string | undefined>>()
      .mockRejectedValueOnce(new Error('throttled'))
      .mockResolvedValue('{"dailyDefault":7,"dailyMax":9}');
    const limits = cachedCrawlLimits(read);
    expect(await limits()).toEqual(DEFAULT_CRAWL_LIMITS);
    expect(await limits()).toEqual({
      dailyDefault: 7,
      dailyMax: 9,
      maxActive: 1,
      platformRunsPerWeek: 1,
      platformRunsPerMonth: 4,
      companyJobsDefault: 3,
      companyJobsMax: 10,
      jobExpiryDays: 7,
      relevanceMaxJobs: 50,
      relevanceMinScore: 30,
      listsPerDay: 2,
      listCompanies: 20,
      platformTailoringsPerMonth: 10,
      premium: DEFAULT_PREMIUM_LIMITS,
    });
  });

  it('drops only the premium block when it alone is invalid (#74)', async () => {
    const setting = (premium: object) =>
      cachedCrawlLimits(async () => JSON.stringify({ dailyDefault: 7, dailyMax: 9, premium }))();
    for (const premium of [{ listPerDay: 5 }, { platformRunsPerWeek: 150 }]) {
      expect(await setting(premium)).toMatchObject({
        dailyDefault: 7,
        dailyMax: 9,
        premium: DEFAULT_PREMIUM_LIMITS,
      });
    }
    // A mistake outside the premium block still means the built-in defaults.
    const both = cachedCrawlLimits(async () =>
      JSON.stringify({ dailyDefault: 70, dailyMax: 9, premium: { listPerDay: 5 } }),
    );
    expect(await both()).toEqual(DEFAULT_CRAWL_LIMITS);
  });
});

describe('tieredLimits (#74)', () => {
  it('gives each tier its limits from the same admin setting', async () => {
    const limits = async () => ({
      ...DEFAULT_CRAWL_LIMITS,
      premium: { ...DEFAULT_PREMIUM_LIMITS, listsPerDay: 6 },
    });
    expect((await tieredLimits(limits, 'free')()).listsPerDay).toBe(
      DEFAULT_CRAWL_LIMITS.listsPerDay,
    );
    expect(await tieredLimits(limits, 'premium')()).toMatchObject({
      ...DEFAULT_PREMIUM_LIMITS,
      listsPerDay: 6,
    });
  });
});
