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
  // One after another: six at once can exceed the dev API's throttle (see cleanup.ts).
  for (const user of users) await user.delete();
}, 180_000);

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
          aiSource: 'none',
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
      [1, 2, 3, 4].map(() =>
        callApi(api, 'POST', 'me/crawls', user.accessToken, { url, aiSource: 'none' }),
      ),
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

  const startUpload = (user: TestUser, name: string) =>
    callApi(api, 'POST', 'me/documents', user.accessToken, {
      fileName: `${name}.pdf`,
      contentType: 'application/pdf',
    });
  const defaults = async (user: TestUser) =>
    (await callApi(api, 'GET', 'me/documents', user.accessToken)).body.documents.filter(
      (d: { isDefault: boolean }) => d.isDefault,
    );

  it('makes exactly one of two first résumé uploads at the same moment the default', async () => {
    const user = await newUser();
    const results = await Promise.all([startUpload(user, 'a'), startUpload(user, 'b')]);
    noServerErrors(results.map((r) => r.status));
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(await defaults(user)).toHaveLength(1);
  });

  it('never has two defaults after two default switches at the same moment', async () => {
    const user = await newUser();
    const created = [];
    for (const name of ['a', 'b', 'c']) created.push((await startUpload(user, name)).body.document);
    const [, b, c] = created;
    const results = await Promise.all(
      [b, c].map((d) =>
        callApi(api, 'PUT', `me/documents/${d.documentId}`, user.accessToken, {
          version: d.version,
          isDefault: true,
        }),
      ),
    );
    const statuses = results.map((r) => r.status);
    noServerErrors(statuses);
    expect(statuses.filter((s) => s === 200).length, statuses.join()).toBeGreaterThanOrEqual(1);
    expect(await defaults(user)).toHaveLength(1);
  });

  it('never exceeds the role and résumé caps with creates at the same moment', async () => {
    const user = await newUser();
    for (let i = 0; i < 9; i += 1)
      await callApi(api, 'POST', 'me/roles', user.accessToken, { title: `Role ${i}` });
    for (let i = 0; i < 9; i += 1) await startUpload(user, `cv${i}`);
    const [roles, docs] = await Promise.all([
      Promise.all(
        [1, 2, 3].map((n) =>
          callApi(api, 'POST', 'me/roles', user.accessToken, { title: `Race ${n}` }),
        ),
      ),
      Promise.all([1, 2, 3].map((n) => startUpload(user, `race${n}`))),
    ]);
    noServerErrors([...roles, ...docs].map((r) => r.status));
    expect(roles.map((r) => r.status).sort()).toEqual([201, 422, 422]);
    expect(docs.map((r) => r.status).sort()).toEqual([201, 422, 422]);
    expect((await callApi(api, 'GET', 'me/roles', user.accessToken)).body.roles).toHaveLength(10);
    expect(
      (await callApi(api, 'GET', 'me/documents', user.accessToken)).body.documents,
    ).toHaveLength(10);
  });
});
