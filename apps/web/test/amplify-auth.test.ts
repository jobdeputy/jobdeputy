import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CALL_LIMIT_MS, signUpUrl } from '../src/lib/auth/amplify.ts';

const amplify = vi.hoisted(() => ({
  configure: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
  fetchAuthSession: vi.fn(),
}));
vi.mock('aws-amplify', () => ({ Amplify: { configure: amplify.configure } }));
vi.mock('aws-amplify/auth', () => amplify);
vi.mock('aws-amplify/auth/enable-oauth-listener', () => ({}));

const CONFIG = {
  userPoolId: 'us-east-1_abc',
  userPoolClientId: 'client',
  authDomain: 'auth.dev.example.com',
};

/** A fresh adapter (it keeps its configuration for the page), with /config.json answering `body`. */
async function load(
  body: unknown = CONFIG,
  status = 200,
  fetch = vi.fn(async () => new Response(JSON.stringify(body), { status })),
) {
  vi.resetModules();
  vi.stubGlobal('fetch', fetch);
  return (await import('../src/lib/auth/amplify.ts')).amplifyAuth;
}

/** A session whose ID token says `email`. */
const sessionOf = (email: unknown) => ({ tokens: { idToken: { payload: { email } } } });

beforeEach(() => {
  for (const mock of Object.values(amplify)) mock.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('amplifyAuth', () => {
  it('sets Amplify up for managed login from the app config: code + PKCE, back to this origin', async () => {
    const auth = await load();
    amplify.signInWithRedirect.mockResolvedValue(undefined);
    await expect(auth.signIn('sign-in')).resolves.toBeUndefined();
    expect(amplify.configure).toHaveBeenCalledWith({
      Auth: {
        Cognito: {
          userPoolId: 'us-east-1_abc',
          userPoolClientId: 'client',
          loginWith: {
            oauth: {
              domain: 'auth.dev.example.com',
              scopes: ['openid', 'email', 'aws.cognito.signin.user.admin'],
              redirectSignIn: [`${window.location.origin}/auth/callback`],
              redirectSignOut: [`${window.location.origin}/`],
              responseType: 'code',
            },
          },
        },
      },
    });
    // Signing in: managed login's own page, as Amplify opens it.
    expect(amplify.signInWithRedirect).toHaveBeenCalledWith(undefined);
  });

  it('opens managed login’s create-account form for a new account, with the same sign-in', async () => {
    const auth = await load();
    const open = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    try {
      amplify.signInWithRedirect.mockImplementation(async (input) => {
        await input.options.authSessionOpener(
          'https://auth.dev.example.com/oauth2/authorize?client_id=client&code_challenge=x&state=s',
        );
      });
      await auth.signIn('sign-up');
      expect(open).toHaveBeenCalledWith(
        'https://auth.dev.example.com/signup?client_id=client&code_challenge=x&state=s',
      );
    } finally {
      open.mockRestore();
    }
    expect(signUpUrl('https://a.example/oauth2/authorize?x=1')).toBe('https://a.example/signup?x=1');
  });

  it.each([
    [null, 404],
    [{ userPoolId: 'us-east-1_abc', userPoolClientId: 'client' }, 200],
  ])('is not set up where the app has no config, or no sign-in address (%j)', async (body, status) => {
    const auth = await load(body, status);
    await expect(auth.signIn('sign-in')).rejects.toMatchObject({ kind: 'not-set-up' });
    expect(amplify.signInWithRedirect).not.toHaveBeenCalled();
  });

  it('signs out an unreadable session left from before instead of leaving, through managed login', async () => {
    const auth = await load();
    amplify.signInWithRedirect.mockRejectedValue(
      Object.assign(new Error('signed in'), { name: 'UserAlreadyAuthenticatedException' }),
    );
    await auth.signIn('sign-in');
    expect(amplify.signOut).toHaveBeenCalledTimes(1);
  });

  it('finishes the sign-in managed login came back with, and gives its email', async () => {
    const auth = await load();
    amplify.fetchAuthSession.mockResolvedValue(sessionOf('a@example.com'));
    await expect(auth.finishSignIn()).resolves.toBe('a@example.com');
    expect(amplify.configure).toHaveBeenCalledTimes(1);
  });

  it('says a sign-in that came back unfinished did not finish, and a stalled one offline', async () => {
    const auth = await load();
    amplify.fetchAuthSession.mockResolvedValue({ tokens: undefined });
    await expect(auth.finishSignIn()).rejects.toMatchObject({ kind: 'sign-in-failed' });
    amplify.fetchAuthSession.mockRejectedValue(new Error('NetworkError'));
    await expect(auth.finishSignIn()).rejects.toMatchObject({ kind: 'offline' });
    vi.useFakeTimers();
    try {
      amplify.fetchAuthSession.mockReturnValue(new Promise(() => {}));
      const result = expect(auth.finishSignIn()).rejects.toMatchObject({ kind: 'offline' });
      await vi.advanceTimersByTimeAsync(CALL_LIMIT_MS);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });

  it('finds nobody signed in without loading Amplify when no session is stored', async () => {
    const auth = await load();
    await expect(auth.currentUser()).resolves.toBeNull();
    expect(amplify.configure).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the signed-in email from a stored session’s ID token', async () => {
    localStorage.setItem('CognitoIdentityServiceProvider.client.LastAuthUser', 'abc');
    const auth = await load();
    amplify.fetchAuthSession.mockResolvedValue(sessionOf('a@example.com'));
    await expect(auth.currentUser()).resolves.toBe('a@example.com');
    amplify.fetchAuthSession.mockResolvedValue(sessionOf(undefined));
    await expect(auth.currentUser()).resolves.toBeNull();
  });

  it('signs out through Amplify (which goes on to managed login’s /logout), or says it could not', async () => {
    const auth = await load();
    amplify.signOut.mockResolvedValue(undefined);
    await expect(auth.signOut()).resolves.toBeUndefined();
    amplify.signOut.mockRejectedValue(new Error('NetworkError'));
    await expect(auth.signOut()).rejects.toMatchObject({ kind: 'offline' });
  });

  it('gives up on a config that does not come in 8 s', async () => {
    const auth = await load();
    amplify.signInWithRedirect.mockResolvedValue(undefined);
    await auth.signIn('sign-in');
    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('calls a config that fails to read a network problem, not a missing set-up', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => {
          throw new DOMException('The operation was aborted.', 'AbortError');
        },
      })),
    );
    const { amplifyAuth } = await import('../src/lib/auth/amplify.ts');
    await expect(amplifyAuth.signIn('sign-in')).rejects.toMatchObject({
      kind: 'offline',
    });
  });

  it('calls a server error on the config a network problem', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    const { amplifyAuth } = await import('../src/lib/auth/amplify.ts');
    await expect(amplifyAuth.signIn('sign-in')).rejects.toMatchObject({
      kind: 'offline',
    });
  });

  it('calls a page that is not JSON (the site’s answer to an unknown path) not set up', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<!doctype html><title>JobDeputy</title><div id="boot-loader"></div>', {
            status: 200,
          }),
      ),
    );
    const { amplifyAuth } = await import('../src/lib/auth/amplify.ts');
    await expect(amplifyAuth.signIn('sign-in')).rejects.toMatchObject({
      kind: 'not-set-up',
    });
  });

  it('calls a page from someone else (wifi that wants a sign-in first) a network problem', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<!doctype html><title>Hotel wifi</title>', { status: 200 })),
    );
    const { amplifyAuth } = await import('../src/lib/auth/amplify.ts');
    await expect(amplifyAuth.signIn('sign-in')).rejects.toMatchObject({
      kind: 'offline',
    });
  });

  it('calls a rate limit on the config a network problem', async () => {
    const auth = await load(null, 429);
    await expect(auth.signIn('sign-in')).rejects.toMatchObject({ kind: 'offline' });
  });

  it('recognises the app’s own page by its boot loader, which index.html has', () => {
    expect(readFileSync('index.html', 'utf8')).toContain('id="boot-loader"');
  });

  it('calls a config from someone else that parses (a proxy’s JSON) a network problem', async () => {
    const auth = await load({ error: 'login required' });
    await expect(auth.signIn('sign-in')).rejects.toMatchObject({ kind: 'offline' });
  });

  it('shows the page signed out when the session check never answers', async () => {
    const auth = await load();
    localStorage.setItem('CognitoIdentityServiceProvider.client.LastAuthUser', 'abc');
    amplify.fetchAuthSession.mockReturnValue(new Promise(() => {}));
    // Set up first (its fetch is real time), then the check that hangs.
    amplify.signInWithRedirect.mockResolvedValue(undefined);
    await auth.signIn('sign-in');
    vi.useFakeTimers();
    try {
      const user = auth.currentUser();
      await vi.advanceTimersByTimeAsync(CALL_LIMIT_MS);
      await expect(user).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts the set-up afresh after one that stalled was given up on', async () => {
    const amplifyAuth = await load(
      CONFIG,
      200,
      vi
        .fn()
        .mockReturnValueOnce(new Promise(() => {}))
        .mockResolvedValueOnce(new Response(JSON.stringify(CONFIG))),
    );
    amplify.signInWithRedirect.mockResolvedValue(undefined);
    vi.useFakeTimers();
    try {
      const first = expect(amplifyAuth.signIn('sign-in')).rejects.toMatchObject({
        kind: 'offline',
      });
      await vi.advanceTimersByTimeAsync(CALL_LIMIT_MS);
      await first;
    } finally {
      vi.useRealTimers();
    }
    await expect(amplifyAuth.signIn('sign-in')).resolves.toBeUndefined();
  });

  it('never lets a set-up given up on configure Amplify late', async () => {
    let arrive = (_: Response) => {};
    const auth = await load(
      CONFIG,
      200,
      vi
        .fn()
        .mockReturnValueOnce(
          new Promise<Response>((resolve) => {
            arrive = resolve;
          }),
        )
        .mockResolvedValue(new Response(JSON.stringify(CONFIG))),
    );
    amplify.signInWithRedirect.mockResolvedValue(undefined);
    vi.useFakeTimers();
    try {
      const first = expect(auth.signIn('sign-in')).rejects.toMatchObject({
        kind: 'offline',
      });
      await vi.advanceTimersByTimeAsync(CALL_LIMIT_MS);
      await first;
    } finally {
      vi.useRealTimers();
    }
    await auth.signIn('sign-in');
    expect(amplify.configure).toHaveBeenCalledTimes(1);
    // The first one's config comes in at last: it is dropped, not applied. (Its body is ready at
    // once, so one task is enough for that set-up to run to its end.)
    arrive({ ok: true, status: 200, text: async () => JSON.stringify(CONFIG) } as Response);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(amplify.configure).toHaveBeenCalledTimes(1);
  });

  it('hands over the access token of a stored session, and none without one', async () => {
    const auth = await load();
    await expect(auth.accessToken()).resolves.toBeNull();
    expect(amplify.fetchAuthSession).not.toHaveBeenCalled();
    localStorage.setItem('CognitoIdentityServiceProvider.client.LastAuthUser', 'abc');
    amplify.fetchAuthSession.mockResolvedValue({
      tokens: { accessToken: { toString: () => 'header.payload.signature' } },
    });
    await expect(auth.accessToken()).resolves.toBe('header.payload.signature');
    // A session Cognito refuses to refresh has no token…
    amplify.fetchAuthSession.mockRejectedValue(
      Object.assign(new Error('Refresh Token has expired'), { name: 'NotAuthorizedException' }),
    );
    await expect(auth.accessToken()).resolves.toBeNull();
    // Recognised by prefix, as Amplify does.
    amplify.fetchAuthSession.mockRejectedValue(
      Object.assign(new Error('reset'), { name: 'PasswordResetRequiredExceptionV2' }),
    );
    await expect(auth.accessToken()).resolves.toBeNull();
    // So does any other session-ending refusal from Cognito…
    amplify.fetchAuthSession.mockRejectedValue(
      Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' }),
    );
    await expect(auth.accessToken()).resolves.toBeNull();
    // …but a refresh that could not reach Cognito, or found it busy or failing, or lost its
    // answer, is a connection problem (the session is still stored).
    for (const name of [
      'NetworkError',
      'TooManyRequestsException',
      'InternalErrorException',
      'Unknown',
    ]) {
      amplify.fetchAuthSession.mockRejectedValue(Object.assign(new Error(name), { name }));
      await expect(auth.accessToken()).rejects.toMatchObject({ kind: 'offline' });
    }
    // Once Amplify has cleared the session, whatever the refusal, nobody is signed in.
    amplify.fetchAuthSession.mockImplementation(async () => {
      localStorage.clear();
      throw Object.assign(new Error('gone'), { name: 'SomethingNew' });
    });
    await expect(auth.accessToken()).resolves.toBeNull();
  });
});
