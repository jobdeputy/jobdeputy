import { EXTENSION_API_ROUTES } from '@jobdeputy/shared/extension';
import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../src/api.ts';
import { type Auth, AuthError } from '../src/auth/session.ts';
import { readReadiness } from '../src/readiness.ts';

const settings = {
  apiUrl: 'https://api.jobdeputy.test',
  authDomain: 'https://auth.jobdeputy.test',
  clientId: 'e2etestclient0000000000000',
  filesOrigin: 'https://files.jobdeputy.test',
};

function fakeAuth(tokens: (string | null | Error)[]) {
  const accessToken = vi.fn(async (_?: { refused?: string }) => {
    const next = tokens.shift() ?? null;
    if (next instanceof Error) throw next;
    return next;
  });
  const signedOutByApi = vi.fn(async () => {});
  return { auth: { accessToken, signedOutByApi } as unknown as Auth, accessToken, signedOutByApi };
}

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe('API reads (#54)', () => {
  it('reads with the bearer token, from the API only', async () => {
    const { auth } = fakeAuth(['t1']);
    const fetch = vi.fn(async () => json(200, { version: 3 }));
    const api = createApi({ settings, auth, fetch: fetch as typeof globalThis.fetch });
    expect(await api.get('/me/applicant')).toEqual({ ok: true, body: { version: 3 } });
    expect(fetch).toHaveBeenCalledWith('https://api.jobdeputy.test/me/applicant', {
      headers: { authorization: 'Bearer t1' },
    });
  });

  it('renews a refused token once, then reads with the new one', async () => {
    const { auth, accessToken } = fakeAuth(['old', 'new']);
    const fetch = vi.fn(async (_: string, init: RequestInit) =>
      (init.headers as Record<string, string>).authorization === 'Bearer new'
        ? json(200)
        : json(401),
    );
    const api = createApi({ settings, auth, fetch: fetch as unknown as typeof globalThis.fetch });
    expect((await api.get('/me/profile')).ok).toBe(true);
    expect(accessToken.mock.calls.map(([options]) => options)).toEqual([{}, { refused: 'old' }]);
  });

  it('is signed out when even a renewed token is refused', async () => {
    const { auth, signedOutByApi } = fakeAuth(['old', 'new']);
    const api = createApi({
      settings,
      auth,
      fetch: (async () => json(401)) as typeof globalThis.fetch,
    });
    expect(await api.get('/me/profile')).toEqual({ ok: false, reason: 'signed-out' });
    expect(signedOutByApi).toHaveBeenCalledOnce();
  });

  it('says why a read failed', async () => {
    const cases: [ReturnType<typeof fakeAuth>, () => Promise<Response>, string][] = [
      [fakeAuth([null]), async () => json(200), 'signed-out'],
      [fakeAuth([new AuthError('offline')]), async () => json(200), 'offline'],
      [fakeAuth([new Error('boom')]), async () => json(200), 'failed'],
      [fakeAuth(['t']), () => Promise.reject(new TypeError('Failed to fetch')), 'offline'],
      [fakeAuth(['t']), async () => json(500), 'failed'],
      [fakeAuth(['t']), async () => new Response('not json', { status: 200 }), 'failed'],
    ];
    for (const [{ auth }, answer, reason] of cases) {
      const api = createApi({ settings, auth, fetch: answer as typeof globalThis.fetch });
      expect(await api.get('/me/profile'), reason).toEqual({ ok: false, reason });
    }
  });
});

describe('readReadiness (#54)', () => {
  function apiAnswering(bodies: Record<string, unknown>) {
    const { auth } = fakeAuth(['t', 't', 't']);
    const fetch = async (url: string) => {
      const path = new URL(url).pathname;
      return path in bodies ? json(200, bodies[path]) : json(500);
    };
    return createApi({ settings, auth, fetch: fetch as unknown as typeof globalThis.fetch });
  }

  it('says what the deputy can fill in', async () => {
    const api = apiAnswering({
      '/me/profile': {
        version: 2,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
      },
      '/me/documents': {
        documents: [
          { documentId: 'd1', fileName: 'new.pdf', status: 'scanning' },
          { documentId: 'd2', fileName: 'cv.pdf', status: 'ready', isDefault: true },
        ],
      },
      '/me/applicant': { version: 1 },
    });
    expect(await readReadiness(api)).toEqual({
      ok: true,
      body: {
        details: { answered: 3, total: 6, ready: true },
        resume: true,
        answers: { answered: 0, total: 10, ready: false },
      },
    });
  });

  it('counts the details and answers forms ask for, each once saved', async () => {
    const api = apiAnswering({
      '/me/profile': {
        version: 3,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        phone: { countryCode: '+1', number: '555 0100' },
        location: { country: 'US' },
        links: { linkedin: 'https://www.linkedin.com/in/ada', other: [] },
      },
      '/me/documents': { documents: [] },
      '/me/applicant': {
        version: 2,
        workAuthorization: [{ country: 'US', authorized: true, needsSponsorship: false }],
        workSetups: [],
        willingToRelocate: false,
        over18: true,
        pronouns: '  ',
      },
    });
    // false is an answer; an empty list or blank text isn't. Ready once the essentials are
    // there (name and email; work authorization), though pronouns and the rest are optional.
    expect(await readReadiness(api)).toMatchObject({
      ok: true,
      body: {
        details: { answered: 6, total: 6, ready: true },
        answers: { answered: 3, total: 10, ready: true },
      },
    });
  });

  it('is ready for US forms only with a US work authorization, and fails on an unreadable profile', async () => {
    const ukOnly = apiAnswering({
      '/me/profile': { version: 1, firstName: 'Ada', lastName: 'L', email: 'a@example.com' },
      '/me/documents': { documents: [] },
      '/me/applicant': {
        version: 1,
        workAuthorization: [{ country: 'GB', authorized: true, needsSponsorship: false }],
      },
    });
    expect(await readReadiness(ukOnly)).toMatchObject({
      ok: true,
      body: { answers: { answered: 1, ready: false } },
    });
    const unreadable = apiAnswering({
      '/me/profile': ['not', 'a', 'profile'],
      '/me/documents': { documents: [] },
      '/me/applicant': { version: 0 },
    });
    expect(await readReadiness(unreadable)).toEqual({ ok: false, reason: 'failed' });
  });

  it('counts only what the filler can use: a half phone or an option this build lacks is not saved', async () => {
    const api = apiAnswering({
      '/me/profile': {
        version: 3,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        phone: { countryCode: '+1', number: '' },
      },
      '/me/documents': { documents: [] },
      '/me/applicant': {
        version: 2,
        workAuthorization: [],
        heardAbout: 'a-new-option',
        over18: true,
      },
    });
    expect(await readReadiness(api)).toMatchObject({
      ok: true,
      body: {
        details: { answered: 3, total: 6, ready: true },
        answers: { answered: 1, total: 10, ready: false },
      },
    });
  });

  it('marks what is missing: no name, no ready résumé, no answers saved', async () => {
    const api = apiAnswering({
      '/me/profile': { version: 0, email: 'ada@example.com' },
      // Only the default counts (the filler attaches nothing else): a ready one that isn't the
      // default, and a default that isn't ready, are no résumé to fill with.
      '/me/documents': {
        documents: [
          { documentId: 'd1', fileName: 'a.pdf', status: 'ready', isDefault: false },
          { documentId: 'd2', fileName: 'b.pdf', status: 'rejected', isDefault: true },
        ],
      },
      '/me/applicant': { version: 0 },
    });
    expect(await readReadiness(api)).toEqual({
      ok: true,
      body: {
        details: { answered: 1, total: 6, ready: false },
        resume: false,
        answers: { answered: 0, total: 10, ready: false },
      },
    });
  });

  it('calls only routes the API lets extension tokens reach (EXTENSION_API_ROUTES)', async () => {
    const called: string[] = [];
    const { auth } = fakeAuth(['t', 't', 't']);
    const fetch = async (url: string) => {
      called.push(`GET ${new URL(url).pathname}`);
      return json(200, { version: 0, documents: [] });
    };
    await readReadiness(
      createApi({ settings, auth, fetch: fetch as unknown as typeof globalThis.fetch }),
    );
    expect(called.length).toBe(3);
    for (const route of called) expect(EXTENSION_API_ROUTES).toContain(route);
  });

  it('counts an unexpected answer as not there, never a crash', async () => {
    const api = apiAnswering({
      '/me/profile': {},
      '/me/documents': { documents: 'none' },
      '/me/applicant': {},
    });
    expect(await readReadiness(api)).toEqual({
      ok: true,
      body: {
        details: { answered: 0, total: 6, ready: false },
        resume: false,
        answers: { answered: 0, total: 10, ready: false },
      },
    });
  });

  it('says signed out when any read found the session gone, whatever else failed', async () => {
    const { auth } = fakeAuth(['t', null, 't']);
    const fetch = async (url: string) =>
      new URL(url).pathname === '/me/profile'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : json(200, { version: 1, documents: [] });
    const api = createApi({ settings, auth, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await readReadiness(api)).toEqual({ ok: false, reason: 'signed-out' });
  });

  it('fails as a whole when one read fails', async () => {
    const api = apiAnswering({ '/me/profile': { version: 1 }, '/me/applicant': { version: 1 } });
    expect(await readReadiness(api)).toEqual({ ok: false, reason: 'failed' });
  });
});
