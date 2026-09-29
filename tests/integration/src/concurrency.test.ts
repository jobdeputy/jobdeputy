import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callApi, createTestUser, stackOutputs, type TestUser } from './stack.js';

/**
 * Requests at the same moment (found on real AWS on 2026-09-29: they failed with 500).
 * Only real DynamoDB shows transaction conflicts, so this runs on the deployed stack.
 * Each scenario uses its own user: the users' limits must not interfere.
 */
let api: string;
let testSite: string;
const users: TestUser[] = [];
let outputs: Record<string, string>;

beforeAll(async () => {
  outputs = await stackOutputs();
  api = outputs.ApiUrl ?? '';
  testSite = outputs.TestSiteUrl ?? '';
}, 60_000);

afterAll(async () => {
  await Promise.all(users.map((u) => u.delete()));
});

async function newUser(): Promise<TestUser> {
  const user = await createTestUser(outputs);
  users.push(user);
  return user;
}

const noServerErrors = (statuses: number[]) => expect(statuses.filter((s) => s >= 500)).toEqual([]);

describe('concurrent requests (deployed)', () => {
  it('accepts parallel submits of different pages up to exactly the active limit, and refuses the rest with 429', async () => {
    const user = await newUser();
    const { maxActive } = (await callApi(api, 'GET', 'me/crawl-settings', user.accessToken)).body;
    // Pages of a site that is down (503): each crawl stays in progress for minutes (it
    // waits to retry), so no slot frees up during the test. A fast page would finish in
    // about a second and free its slot while the others are still being submitted.
    // 6 at once stays under the dev API's burst limit (10), so every 429 here is ours.
    const results = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) =>
        callApi(api, 'POST', 'me/crawls', user.accessToken, {
          url: new URL(`test-site/unavailable?parallel=${n}`, testSite).href,
        }),
      ),
    );
    const statuses = results.map((r) => r.status);
    noServerErrors(statuses);
    const expected = Math.min(maxActive, 6);
    expect(statuses.filter((s) => s === 202).length, statuses.join()).toBe(expected);
    const refused = results.filter((r) => r.status === 429);
    expect(refused).toHaveLength(6 - expected);
    for (const r of refused) expect(r.body.code).toBe('too-many-active-crawls');
    const settings = (await callApi(api, 'GET', 'me/crawl-settings', user.accessToken)).body;
    expect(settings.activeNow).toBe(expected);
    // Left in progress on purpose: deleting the account afterwards stops them (T12).
  });

  it('starts one crawl for the same page submitted in parallel, and returns it to the others', async () => {
    const user = await newUser();
    const url = new URL('test-site/jobs?same=1', testSite).href;
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => callApi(api, 'POST', 'me/crawls', user.accessToken, { url })),
    );
    const statuses = results.map((r) => r.status);
    noServerErrors(statuses);
    expect(statuses.filter((s) => s === 202)).toHaveLength(1);
    // The rest see the same crawl (200), or at worst are asked to try again (409).
    expect(
      statuses.every((s) => [200, 202, 409].includes(s)),
      statuses.join(),
    ).toBe(true);
    const ids = new Set(results.filter((r) => r.status !== 409).map((r) => r.body.crawlId));
    expect(ids.size).toBe(1);
  });

  it('saves one of several simultaneous saves and answers the others with 409 (a double-click)', async () => {
    const user = await newUser();
    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        callApi(api, 'PUT', 'me/profile', user.accessToken, {
          version: 0,
          firstName: `Click${n}`,
          lastName: 'Twice',
        }),
      ),
    );
    const statuses = results.map((r) => r.status);
    noServerErrors(statuses);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(2);
    const profile = await callApi(api, 'GET', 'me/profile', user.accessToken);
    expect(profile.body.version).toBe(1);
  });
});
