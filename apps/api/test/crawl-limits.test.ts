import { DEFAULT_CRAWL_LIMITS } from '@jobdeputy/shared';
import { describe, expect, it, vi } from 'vitest';
import { cachedCrawlLimits, LIMITS_CACHE_MS } from '../src/crawl-limits.js';

describe('cachedCrawlLimits', () => {
  it('reads the admin setting once, then serves it from memory for 5 minutes', async () => {
    let now = 0;
    const read = vi.fn(async () => '{"dailyDefault":10,"dailyMax":40}');
    const limits = cachedCrawlLimits(read, () => now);
    expect(await limits()).toEqual({ dailyDefault: 10, dailyMax: 40, maxActive: 3 });
    now = LIMITS_CACHE_MS - 1;
    await limits();
    expect(read).toHaveBeenCalledTimes(1);

    // An admin change is picked up once the cache expires, without a deploy.
    read.mockResolvedValue('{"dailyDefault":5,"dailyMax":8}');
    // (maxActive is optional in the setting: the default 3 applies.)
    now = LIMITS_CACHE_MS;
    expect(await limits()).toEqual({ dailyDefault: 5, dailyMax: 8, maxActive: 3 });
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
    expect(await limits()).toEqual({ dailyDefault: 7, dailyMax: 9, maxActive: 3 });
  });
});
