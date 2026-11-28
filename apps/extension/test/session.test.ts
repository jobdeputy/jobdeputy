import { describe, expect, it, vi } from 'vitest';
import { challengeFor } from '../src/auth/pkce.ts';
import {
  AuthError,
  createAuth,
  emailFromIdToken,
  REFRESH_EARLY_MS,
  type Session,
} from '../src/auth/session.ts';

const settings = {
  apiUrl: 'https://api.jobdeputy.test',
  authDomain: 'https://auth.jobdeputy.test',
  clientId: 'e2etestclient0000000000000',
  filesOrigin: 'https://files.jobdeputy.test',
};
const REDIRECT = 'https://pkdigeiognmabnigddaekkkmecnaiadf.chromiumapp.org/';

function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${part({ alg: 'none' })}.${part(claims)}.sig`;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A managed login, its token endpoint, session storage, and a clock, all in memory. */
function setup() {
  const stored = new Map<string, unknown>();
  /** `chrome.storage.local`: outlasts the browser. */
  const marked = new Map<string, unknown>();
  /** Keys whose removal fails (storage torn down). */
  const failRemove = new Set<string>();
  let clock = 1_000_000;
  const forms: URLSearchParams[] = [];
  let tokenAnswer: () => Response | Promise<Response> = () =>
    json(200, {
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      id_token: idToken({ email: 'ada@example.com' }),
      expires_in: 3600,
    });
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body ?? ''));
    forms.push(form);
    if (String(url).endsWith('/oauth2/revoke')) return new Response('', { status: 200 });
    return tokenAnswer();
  });
  const launch = vi.fn(async (url: string, _interactive?: boolean) => {
    const state = new URL(url).searchParams.get('state');
    return `${REDIRECT}?code=the-code&state=${state}`;
  });
  const auth = createAuth({
    settings,
    redirectUrl: REDIRECT,
    launch,
    storage: {
      get: async (key) => stored.get(key),
      set: async (key, value) => void stored.set(key, value),
      remove: async (key) => {
        if (failRemove.has(key)) throw new Error('storage gone');
        stored.delete(key);
      },
    },
    marks: {
      get: async (key) => marked.get(key),
      set: async (key, value) => void marked.set(key, value),
      remove: async (key) => void marked.delete(key),
    },
    fetch: fetch as typeof globalThis.fetch,
    now: () => clock,
  });
  return {
    auth,
    stored,
    marked,
    failRemove,
    fetch,
    forms,
    launch,
    tick: (ms: number) => {
      clock += ms;
    },
    answerTokens: (answer: typeof tokenAnswer) => {
      tokenAnswer = answer;
    },
  };
}

describe('sign-in (#54, decision 0020)', () => {
  it('signs in with a code and PKCE, back to the extension, and keeps the tokens in the session', async () => {
    const { auth, launch, forms, stored } = setup();
    expect(await auth.signIn()).toBe('signed-in');

    const url = new URL(launch.mock.calls[0]?.[0] ?? '');
    expect(`${url.origin}${url.pathname}`).toBe('https://auth.jobdeputy.test/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: settings.clientId,
      response_type: 'code',
      scope: 'openid email',
      redirect_uri: REDIRECT,
      code_challenge_method: 'S256',
    });
    const exchange = forms[0];
    expect(Object.fromEntries(exchange ?? [])).toMatchObject({
      grant_type: 'authorization_code',
      client_id: settings.clientId,
      code: 'the-code',
      redirect_uri: REDIRECT,
    });
    // The verifier sent with the code is the one behind the challenge sent with the sign-in.
    expect(await challengeFor(exchange?.get('code_verifier') ?? '')).toBe(
      url.searchParams.get('code_challenge'),
    );
    expect(stored.get('session')).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1_000_000 + 3_600_000,
      email: 'ada@example.com',
    });
    expect(await auth.status()).toEqual({ state: 'signed-in', email: 'ada@example.com' });
  });

  it('ends the remembered sign-in first when using a different account', async () => {
    const { auth, launch } = setup();
    await auth.signIn({ different: true });
    const url = new URL(launch.mock.calls[0]?.[0] ?? '');
    expect(url.pathname).toBe('/logout');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
  });

  it('opens one sign-in window however many times Sign in is clicked', async () => {
    const { auth, launch } = setup();
    let finish: (url: string) => void = () => {};
    launch.mockImplementationOnce(
      (url) =>
        new Promise((resolve) => {
          finish = () =>
            resolve(`${REDIRECT}?code=c&state=${new URL(url).searchParams.get('state')}`);
        }),
    );
    const first = auth.signIn();
    const second = auth.signIn();
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    expect(auth.signingIn).toBe(true);
    // Waiting joins it without opening anything.
    const waited = auth.waitForSignIn();
    finish('');
    expect(await waited).toBe('signed-in');
    expect(await first).toBe('signed-in');
    expect(await second).toBe('signed-in');
    expect(launch).toHaveBeenCalledTimes(1);
    expect(auth.signingIn).toBe(false);
    expect(auth.waitForSignIn()).toBeNull();
  });

  it('runs a different-account sign-in after one at work, never as part of it', async () => {
    const { auth, launch } = setup();
    let finish: (url: string) => void = () => {};
    launch.mockImplementationOnce(
      (url) =>
        new Promise((resolve) => {
          finish = () =>
            resolve(`${REDIRECT}?code=c&state=${new URL(url).searchParams.get('state')}`);
        }),
    );
    const plain = auth.signIn();
    const different = auth.signIn({ different: true });
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    finish('');
    expect(await plain).toBe('signed-in');
    expect(await different).toBe('signed-in');
    expect(launch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/oauth2/authorize',
      '/logout',
    ]);
  });

  it('frees the sign-in even when clearing its mark fails', async () => {
    const { auth, stored, failRemove } = setup();
    failRemove.add('signInPending');
    expect(await auth.signIn()).toBe('signed-in');
    expect(auth.signingIn).toBe(false);
    expect(auth.waitForSignIn()).toBeNull();
    expect(stored.has('session')).toBe(true);
  });

  it('says why a sign-in did not finish, and keeps nothing', async () => {
    const cases: [() => Promise<string>, string][] = [
      [() => Promise.reject(new Error('The user did not approve access.')), 'cancelled'],
      [() => Promise.reject(new Error('Authorization page could not be loaded.')), 'offline'],
      [() => Promise.reject(new Error('Something else')), 'failed'],
      [async () => `${REDIRECT}?code=c&state=someone-elses`, 'failed'],
      [async () => `${REDIRECT}?error=access_denied`, 'cancelled'],
    ];
    for (const [answer, outcome] of cases) {
      const { auth, launch, stored } = setup();
      launch.mockImplementationOnce(answer);
      expect(await auth.signIn(), outcome).toBe(outcome);
      expect(stored.has('session')).toBe(false);
    }
  });

  it('says offline or failed when the code exchange does not work', async () => {
    const offline = setup();
    offline.answerTokens(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await offline.auth.signIn()).toBe('offline');

    const refused = setup();
    refused.answerTokens(() => json(400, { error: 'invalid_grant' }));
    expect(await refused.auth.signIn()).toBe('failed');
    expect(refused.stored.has('session')).toBe(false);
  });
});

describe('access tokens (#54)', () => {
  it('uses the token while it has more than a minute left, then refreshes it once for every caller', async () => {
    const { auth, fetch, tick, answerTokens, stored, forms } = setup();
    await auth.signIn();
    fetch.mockClear();
    expect(await auth.accessToken()).toBe('access-1');
    expect(fetch).not.toHaveBeenCalled();

    tick(3_600_000 - REFRESH_EARLY_MS);
    answerTokens(() => json(200, { access_token: 'access-2', expires_in: 3600 }));
    const tokens = await Promise.all([auth.accessToken(), auth.accessToken(), auth.accessToken()]);
    expect(tokens).toEqual(['access-2', 'access-2', 'access-2']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(forms.at(-1) ?? [])).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-1',
      client_id: settings.clientId,
    });
    // The refresh token and who it is stay.
    expect(stored.get('session')).toMatchObject({
      accessToken: 'access-2',
      refreshToken: 'refresh-1',
      email: 'ada@example.com',
    });
  });

  it('refreshes at once when the API refused the token, but not when a newer one is already here', async () => {
    const { auth, fetch, answerTokens } = setup();
    await auth.signIn();
    answerTokens(() => json(200, { access_token: 'access-2', expires_in: 3600 }));
    expect(await auth.accessToken({ refused: 'access-1' })).toBe('access-2');
    expect(fetch).toHaveBeenCalledTimes(2);
    // A later 401 for the same old token: the new one is used, no second refresh.
    expect(await auth.accessToken({ refused: 'access-1' })).toBe('access-2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps a new refresh token when Cognito sends one, and an hour when it leaves out the lifetime', async () => {
    const { auth, tick, answerTokens, stored } = setup();
    await auth.signIn();
    tick(3_600_000);
    answerTokens(() => json(200, { access_token: 'access-2', refresh_token: 'refresh-2' }));
    expect(await auth.accessToken()).toBe('access-2');
    expect(stored.get('session')).toMatchObject({
      refreshToken: 'refresh-2',
      expiresAt: 1_000_000 + 3_600_000 + 3_600_000,
    });
  });

  it('is signed out when the refresh token is refused, remembering who it was', async () => {
    const { auth, tick, answerTokens } = setup();
    await auth.signIn();
    tick(3_600_000);
    answerTokens(() => json(400, { error: 'invalid_grant' }));
    expect(await auth.accessToken()).toBeNull();
    expect(await auth.status()).toEqual({ state: 'signed-out', lastEmail: 'ada@example.com' });
  });

  it('keeps the session when managed login cannot be reached, and says so', async () => {
    const { auth, tick, answerTokens, stored } = setup();
    await auth.signIn();
    tick(3_600_000);
    answerTokens(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(auth.accessToken()).rejects.toEqual(new AuthError('offline'));
    answerTokens(() => json(500, {}));
    await expect(auth.accessToken()).rejects.toEqual(new AuthError('failed'));
    expect(stored.has('session')).toBe(true);
  });

  it('does not bring a session back that was signed out while it refreshed', async () => {
    const { auth, tick, answerTokens, stored } = setup();
    await auth.signIn();
    tick(3_600_000);
    let finish: (res: Response) => void = () => {};
    answerTokens(() => new Promise((resolve) => (finish = resolve)));
    const pending = auth.accessToken();
    await auth.signOut();
    finish(json(200, { access_token: 'access-2', expires_in: 3600 }));
    expect(await pending).toBeNull();
    expect(stored.has('session')).toBe(false);
  });

  it("never signs out, or hands null to, a session made while an older one's refresh was refused", async () => {
    const { auth, tick, answerTokens, stored } = setup();
    await auth.signIn();
    tick(3_600_000);
    let finish: (res: Response) => void = () => {};
    answerTokens(() => new Promise((resolve) => (finish = resolve)));
    const old = auth.accessToken();
    // Signed out and in again (as someone else) while the old refresh waits.
    await auth.signOut();
    answerTokens(() =>
      json(200, {
        access_token: 'access-b',
        refresh_token: 'refresh-b',
        id_token: idToken({ email: 'bea@example.com' }),
        expires_in: 3600,
      }),
    );
    await auth.signIn();
    // The new session doesn't join the old refresh.
    expect(await auth.accessToken()).toBe('access-b');
    finish(json(400, { error: 'invalid_grant' }));
    expect(await old).toBe('access-b');
    expect(stored.get('session')).toMatchObject({ refreshToken: 'refresh-b' });
    expect(await auth.status()).toEqual({ state: 'signed-in', email: 'bea@example.com' });
  });

  it('is null when signed out', async () => {
    expect(await setup().auth.accessToken()).toBeNull();
  });
});

describe('a sign-in Chrome cut short (#54)', () => {
  it('says once that it was interrupted, when the worker restarted during it', async () => {
    const first = setup();
    first.launch.mockImplementationOnce(() => new Promise(() => {}));
    void first.auth.signIn();
    await vi.waitFor(() => expect(first.stored.get('signInPending')).toBe(true));
    // While this worker waits on it, it isn't interrupted.
    expect(await first.auth.status()).toEqual({ state: 'signed-out' });

    // Chrome stops the worker; a new one starts with the same session storage.
    const restarted = setup();
    restarted.stored.set('signInPending', true);
    expect(await restarted.auth.status()).toEqual({ state: 'signed-out', interrupted: true });
    expect(await restarted.auth.status()).toEqual({ state: 'signed-out' });
  });

  it('clears the mark whenever a sign-in ends', async () => {
    const { auth, launch, stored } = setup();
    launch.mockRejectedValueOnce(new Error('The user did not approve access.'));
    await auth.signIn();
    expect(stored.has('signInPending')).toBe(false);
    await auth.signIn();
    expect(stored.has('signInPending')).toBe(false);
  });
});

describe('sign-out (#54)', () => {
  it('forgets the tokens at once, revokes the refresh token, and offers the person back', async () => {
    const { auth, fetch, stored } = setup();
    await auth.signIn();
    await auth.signOut();
    expect(stored.has('session')).toBe(false);
    const [url, init] = fetch.mock.calls.at(-1) ?? [];
    expect(String(url)).toBe('https://auth.jobdeputy.test/oauth2/revoke');
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      client_id: settings.clientId,
      token: 'refresh-1',
    });
    expect(await auth.status()).toEqual({ state: 'signed-out', lastEmail: 'ada@example.com' });

    // Signing in again forgets the offer.
    await auth.signIn();
    expect(stored.has('lastEmail')).toBe(false);
  });

  it('signs out even when revoking fails', async () => {
    const { auth, fetch, stored } = setup();
    await auth.signIn();
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await auth.signOut();
    expect(stored.has('session')).toBe(false);
  });

  it('ignores a malformed stored session', async () => {
    const { auth, stored } = setup();
    stored.set('session', { accessToken: 1 } as unknown as Session);
    expect(await auth.status()).toEqual({ state: 'signed-out' });
    expect(await auth.accessToken()).toBeNull();
  });
});

describe('emailFromIdToken', () => {
  it('reads the email claim, or nothing', () => {
    expect(emailFromIdToken(idToken({ email: 'ada@example.com' }))).toBe('ada@example.com');
    expect(emailFromIdToken(idToken({ email: 7 }))).toBeUndefined();
    // UTF-8 in the token's JSON (base64url of its bytes), not one character per byte.
    const utf8 = btoa(
      String.fromCharCode(...new TextEncoder().encode('{"email":"josé@example.com"}')),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(emailFromIdToken(`h.${utf8}.s`)).toBe('josé@example.com');
    expect(emailFromIdToken('not.a-token')).toBeUndefined();
    expect(emailFromIdToken(undefined)).toBeUndefined();
  });
});

describe('signing in without a window (#111, decision 0021)', () => {
  /** Managed login doesn't know the person: no code, `login_required`. */
  const unknownPerson = async (url: string) =>
    `${REDIRECT}?error=login_required&state=${new URL(url).searchParams.get('state')}`;

  it('signs in silently when managed login knows the person (signed in on the site)', async () => {
    const { auth, launch, stored } = setup();
    expect(await auth.signInSilently()).toBe('signed-in');
    const [url, interactive] = launch.mock.calls[0] ?? [];
    expect(interactive).toBe(false);
    expect(Object.fromEntries(new URL(url ?? '').searchParams)).toMatchObject({
      prompt: 'none',
      code_challenge_method: 'S256',
      redirect_uri: REDIRECT,
    });
    expect((stored.get('session') as Session).email).toBe('ada@example.com');
    // No "sign-in at work" mark: there was no window to wait for.
    expect(stored.has('signInPending')).toBe(false);
  });

  it('says none when managed login does not know the person, or Chrome would need them', async () => {
    const { auth, launch, stored } = setup();
    launch.mockImplementationOnce(unknownPerson);
    expect(await auth.signInSilently()).toBe('none');
    launch.mockRejectedValueOnce(new Error('User interaction required.'));
    expect(await auth.signInSilently()).toBe('none');
    launch.mockRejectedValueOnce(new Error('Authorization page could not be loaded.'));
    expect(await auth.signInSilently()).toBe('offline');
    expect(stored.has('session')).toBe(false);
  });

  it('never signs back in silently after a Sign out here, even after a restart, until the person signs in again', async () => {
    const { auth, launch, stored, marked } = setup();
    await auth.signIn();
    await auth.signOut();
    // The mark outlasts the browser (storage.local); the session store does not.
    expect(marked.get('signedOutHere')).toBe(true);
    stored.clear();
    launch.mockClear();
    expect(await auth.signInSilently()).toBe('none');
    expect(launch).not.toHaveBeenCalled();
    // Their own sign-in (a window) lifts it.
    await auth.signIn();
    expect(marked.has('signedOutHere')).toBe(false);
    await auth.signedOutByApi();
    // Refused by the API: no silent sign-in either, until the person signs in.
    expect(await auth.signInSilently()).toBe('none');
  });

  it('does nothing when already signed in, and runs one at a time', async () => {
    const { auth, launch } = setup();
    const [first, second] = await Promise.all([auth.signInSilently(), auth.signInSilently()]);
    expect([first, second]).toEqual(['signed-in', 'signed-in']);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(await auth.signInSilently()).toBe('signed-in');
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('lets a sign-in the person starts wait for a silent one at work, then open its window', async () => {
    const { auth, launch } = setup();
    let answer = () => {};
    launch.mockImplementationOnce(
      (url) =>
        new Promise((resolve) => {
          answer = () =>
            resolve(
              `${REDIRECT}?error=login_required&state=${new URL(url).searchParams.get('state')}`,
            );
        }),
    );
    const silent = auth.signInSilently();
    // Its window-less flow has reached managed login (after storage and PKCE).
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    const own = auth.signIn();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(launch).toHaveBeenCalledTimes(1);
    answer();
    expect(await silent).toBe('none');
    expect(await own).toBe('signed-in');
    expect(launch.mock.calls[1]?.[1]).toBe(true);
  });

  it('opens no window when the silent sign-in it waited for signed the person in', async () => {
    const { auth, launch } = setup();
    const silent = auth.signInSilently();
    // Already at managed login when the person presses Sign in.
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    const own = auth.signIn();
    expect(await silent).toBe('signed-in');
    expect(await own).toBe('signed-in');
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0]?.[1]).toBe(false);
  });

  it('starts no silent sign-in while one the person started is at work, and never waits for it', async () => {
    const { auth, launch } = setup();
    let close = () => {};
    launch.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          close = () => reject(new Error('The user did not approve access.'));
        }),
    );
    const own = auth.signIn();
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    // Answered at once, while the person's window stays open.
    expect(await auth.signInSilently()).toBe('none');
    expect(launch).toHaveBeenCalledTimes(1);
    close();
    expect(await own).toBe('cancelled');
  });
});
