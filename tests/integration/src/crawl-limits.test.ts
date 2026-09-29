import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callApi, createTestUser, stackOutputs, type TestUser } from './stack.js';

/**
 * Deployed wiring of T06c: the admin limits parameter, the user's own limit, and the
 * day counter in the crawl request transaction. The limit rules are unit-tested.
 * Nothing here assumes the admin's values: they are read from the API.
 */
let api: string;
let testSite: string;
let user: TestUser;

beforeAll(async () => {
  const outputs = await stackOutputs();
  api = outputs.ApiUrl ?? '';
  testSite = outputs.TestSiteUrl ?? '';
  user = await createTestUser(outputs);
}, 60_000);

afterAll(async () => {
  await user?.delete();
});

describe('daily crawl limits (deployed)', () => {
  it("applies the admin default, then the user's own limit, and refuses past it with 429", async () => {
    const token = user.accessToken;
    const start = await callApi(api, 'GET', 'me/crawl-settings', token);
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ customLimit: null, usedToday: 0, version: 0 });
    expect(start.body.dailyLimit).toBe(start.body.defaultLimit);
    expect(start.body.maxAllowed).toBeGreaterThanOrEqual(start.body.defaultLimit);
    expect(Date.parse(start.body.resetsAt)).toBeGreaterThan(Date.now());

    if (start.body.maxAllowed < 1000) {
      const tooHigh = await callApi(api, 'PUT', 'me/crawl-settings', token, {
        version: 0,
        dailyLimit: start.body.maxAllowed + 1,
      });
      expect(tooHigh.status).toBe(422);
      expect(tooHigh.body.code).toBe('limit-above-maximum');
    }

    const saved = await callApi(api, 'PUT', 'me/crawl-settings', token, {
      version: 0,
      dailyLimit: 2,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ dailyLimit: 2, customLimit: 2, version: 1 });
    const stale = await callApi(api, 'PUT', 'me/crawl-settings', token, {
      version: 0,
      dailyLimit: 3,
    });
    expect(stale.status).toBe(409);

    // Two different pages fit; a third does not.
    for (const n of [1, 2]) {
      const ok = await callApi(api, 'POST', 'me/crawls', token, {
        url: new URL(`test-site/jobs?page=${n}`, testSite).href,
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(202);
    }
    const refused = await callApi(api, 'POST', 'me/crawls', token, {
      url: new URL('test-site/jobs?page=3', testSite).href,
    });
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({
      code: 'daily-limit-reached',
      detail: "You've used 2 of 2 crawls today. Resets at 00:00 UTC.",
    });

    const after = await callApi(api, 'GET', 'me/crawl-settings', token);
    expect(after.body).toMatchObject({ usedToday: 2, dailyLimit: 2 });

    // Back to the default; the change is in the audit history.
    const reset = await callApi(api, 'PUT', 'me/crawl-settings', token, {
      version: 1,
      dailyLimit: null,
    });
    expect(reset.body).toMatchObject({
      customLimit: null,
      dailyLimit: start.body.defaultLimit,
      version: 2,
    });
    const audit = await callApi(api, 'GET', 'me/audit', token);
    const changes = audit.body.entries.filter(
      (e: { name: string }) => e.name === 'crawl_limit.changed',
    );
    expect(changes.map((e: { summary: string }) => e.summary)).toEqual([
      `Daily crawl limit set back to the default (${start.body.defaultLimit})`,
      'Daily crawl limit set to 2',
    ]);
  });
});
