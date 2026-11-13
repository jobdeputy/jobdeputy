import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callApi, createTestUser, stackOutputs, type TestUser } from './stack.js';

/**
 * Deployed wiring of T05b: real tables, conditional writes, Cognito email, and
 * user isolation. Validation permutations are unit-tested. See docs/testing.md.
 */
let api: string;
let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  const outputs = await stackOutputs();
  api = outputs.ApiUrl ?? '';
  [alice, bob] = await Promise.all([createTestUser(outputs), createTestUser(outputs)]);
});

afterAll(async () => {
  await Promise.allSettled([alice?.delete(), bob?.delete()]);
});

describe('profile, search settings, and roles (deployed)', () => {
  it('saves the profile, and a stale save gets a conflict', async () => {
    const empty = await callApi(api, 'GET', 'me/profile', alice.accessToken);
    expect(empty.body).toMatchObject({ version: 0, email: alice.email, homeCell: 'iad' });

    const saved = await callApi(api, 'PUT', 'me/profile', alice.accessToken, {
      version: 0,
      firstName: 'Ada',
      lastName: 'Lovelace',
      skills: ['TypeScript'],
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ version: 1, firstName: 'Ada', email: alice.email });

    const stale = await callApi(api, 'PUT', 'me/profile', alice.accessToken, {
      version: 0,
      firstName: 'Other',
      lastName: 'Tab',
    });
    expect(stale.status).toBe(409);
    const after = await callApi(api, 'GET', 'me/profile', alice.accessToken);
    expect(after.body).toMatchObject({ version: 1, firstName: 'Ada' });

    // Bob's profile is untouched by Alice's save.
    expect((await callApi(api, 'GET', 'me/profile', bob.accessToken)).body.version).toBe(0);
  });

  it('saves search settings', async () => {
    const res = await callApi(api, 'PUT', 'me/preferences/search', alice.accessToken, {
      version: 0,
      workplace: ['remote'],
      minSalary: { amount: 4500000, currency: 'INR', period: 'year' },
    });
    expect(res.status).toBe(200);
    const got = await callApi(api, 'GET', 'me/preferences/search', alice.accessToken);
    expect(got.body).toMatchObject({ version: 1, workplace: ['remote'] });
  });

  it('manages roles, and nobody else can change them', async () => {
    const created = await callApi(api, 'POST', 'me/roles', alice.accessToken, {
      title: 'Backend Engineer',
    });
    expect(created.status).toBe(201);
    const { roleId } = created.body;

    const asBob = { title: 'Hijacked', version: 1 };
    expect((await callApi(api, 'PUT', `me/roles/${roleId}`, bob.accessToken, asBob)).status).toBe(
      404,
    );
    expect((await callApi(api, 'DELETE', `me/roles/${roleId}`, bob.accessToken)).status).toBe(404);
    expect((await callApi(api, 'GET', 'me/roles', bob.accessToken)).body.roles).toEqual([]);

    const updated = await callApi(api, 'PUT', `me/roles/${roleId}`, alice.accessToken, {
      title: 'Staff Engineer',
      version: 1,
    });
    expect(updated.body).toMatchObject({ roleId, title: 'Staff Engineer', version: 2 });
    expect((await callApi(api, 'DELETE', `me/roles/${roleId}`, alice.accessToken)).status).toBe(
      204,
    );
    expect((await callApi(api, 'GET', 'me/roles', alice.accessToken)).body.roles).toEqual([]);
  });
});
