import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callApi, createTestUser, stackOutputs, type TestUser } from './stack.js';

/**
 * #74, deployed: the Cognito group `premium` reaches the API through the token, and the
 * API then applies the premium limits. Which values apply is unit-tested; here a
 * premium user and a free user are only compared (the dev parameter keeps them apart:
 * docs/runbooks/crawl-limits.md).
 */
let api: string;
let free: TestUser;
let premium: TestUser;

beforeAll(async () => {
  const outputs = await stackOutputs();
  api = outputs.ApiUrl ?? '';
  [free, premium] = await Promise.all([
    createTestUser(outputs),
    createTestUser(outputs, { premium: true }),
  ]);
}, 60_000);

afterAll(async () => {
  await Promise.all([free?.delete(), premium?.delete()]);
});

describe('premium tier (deployed)', () => {
  // The AI runs come from ai.ts, the crawl limits from crawls.ts (each unit-tested per tier).
  it('gives a member of the premium group the premium limits', async () => {
    const [freeRuns, premiumRuns, freeCrawls, premiumCrawls] = await Promise.all([
      callApi(api, 'GET', 'me/ai-usage', free.accessToken),
      callApi(api, 'GET', 'me/ai-usage', premium.accessToken),
      callApi(api, 'GET', 'me/crawl-settings', free.accessToken),
      callApi(api, 'GET', 'me/crawl-settings', premium.accessToken),
    ]);
    for (const res of [freeRuns, premiumRuns, freeCrawls, premiumCrawls]) {
      expect(res.status).toBe(200);
    }
    // Premium never gets less, and more somewhere (the values are the dev parameter's,
    // so only the comparison is fixed: docs/runbooks/crawl-limits.md).
    const pairs: [number, number][] = [
      [premiumRuns.body.platformRuns.perWeek, freeRuns.body.platformRuns.perWeek],
      [premiumRuns.body.platformRuns.perMonth, freeRuns.body.platformRuns.perMonth],
      [premiumCrawls.body.defaultLimit, freeCrawls.body.defaultLimit],
      [premiumCrawls.body.maxAllowed, freeCrawls.body.maxAllowed],
    ];
    for (const [premiumValue, freeValue] of pairs) {
      expect(premiumValue).toBeGreaterThanOrEqual(freeValue);
    }
    expect(pairs.some(([premiumValue, freeValue]) => premiumValue > freeValue)).toBe(true);
  });
});
