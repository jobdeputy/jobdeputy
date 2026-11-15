import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CALL_LIMIT_MS } from '../src/lib/auth/amplify.ts';

const amplify = vi.hoisted(() => ({
  configure: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  autoSignIn: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
  resendSignUpCode: vi.fn(),
  getCurrentUser: vi.fn(),
  fetchAuthSession: vi.fn(),
}));
vi.mock('aws-amplify', () => ({ Amplify: { configure: amplify.configure } }));
vi.mock('aws-amplify/auth', () => amplify);

const CONFIG = { userPoolId: 'us-east-1_abc', userPoolClientId: 'client' };

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

beforeEach(() => {
  for (const mock of Object.values(amplify)) mock.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('amplifyAuth', () => {
  it('sets Amplify up from the app config, signing in by email', async () => {
    const auth = await load();
    amplify.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    await expect(auth.signIn('a@example.com', 'pw')).resolves.toBe('done');
    expect(amplify.configure).toHaveBeenCalledWith({
      Auth: {
        Cognito: {
          userPoolId: 'us-east-1_abc',
          userPoolClientId: 'client',
          loginWith: { email: true },
        },
      },
    });
  });

  it('is not set up where the app has no config', async () => {
    const auth = await load(null, 404);
    await expect(auth.signIn('a@example.com', 'pw')).rejects.toMatchObject({ kind: 'not-set-up' });
    expect(amplify.signIn).not.toHaveBeenCalled();
  });

  it.each([
    ['NotAuthorizedException', 'wrong-details'],
    ['UserNotFoundException', 'wrong-details'],
    ['UsernameExistsException', 'account-exists'],
    ['CodeMismatchException', 'wrong-code'],
    ['ExpiredCodeException', 'expired-code'],
    ['LimitExceededException', 'too-many-tries'],
    ['InvalidPasswordException', 'weak-password'],
    ['NetworkError', 'offline'],
    ['SomethingNew', 'unknown'],
  ])('turns Cognito’s %s into %s', async (name, kind) => {
    const auth = await load();
    amplify.signUp.mockRejectedValue(Object.assign(new Error(name), { name }));
    await expect(auth.signUp('a@example.com', 'pw')).rejects.toMatchObject({ kind });
  });

  it('sends an unconfirmed account to its code', async () => {
    const auth = await load();
    amplify.signIn.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_UP' },
    });
    await expect(auth.signIn('a@example.com', 'pw')).resolves.toBe('confirm');
  });

  it('signs in after the code: automatically, or with the password where it cannot', async () => {
    const auth = await load();
    amplify.confirmSignUp.mockResolvedValue({ nextStep: { signUpStep: 'COMPLETE_AUTO_SIGN_IN' } });
    amplify.autoSignIn.mockResolvedValue({ isSignedIn: true });
    await auth.confirmSignUp('a@example.com', 'pw', '123456');
    expect(amplify.signIn).not.toHaveBeenCalled();

    amplify.autoSignIn.mockRejectedValue(new Error('no auto sign-in in this tab'));
    amplify.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    await auth.confirmSignUp('a@example.com', 'pw', '123456');
    expect(amplify.signIn).toHaveBeenCalledWith({ username: 'a@example.com', password: 'pw' });
  });

  it('finds nobody signed in without loading Amplify when no session is stored', async () => {
    const auth = await load();
    await expect(auth.currentUser()).resolves.toBeNull();
    expect(amplify.configure).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the signed-in email from a stored session', async () => {
    localStorage.setItem('CognitoIdentityServiceProvider.client.LastAuthUser', 'abc');
    const auth = await load();
    amplify.getCurrentUser.mockResolvedValue({
      username: 'abc',
      signInDetails: { loginId: 'a@example.com' },
    });
    await expect(auth.currentUser()).resolves.toBe('a@example.com');
  });

  it('clears a stale session that blocks a new sign-in, and signs in once more', async () => {
    const auth = await load();
    const blocked = Object.assign(new Error('already'), {
      name: 'UserAlreadyAuthenticatedException',
    });
    amplify.signIn
      .mockRejectedValueOnce(blocked)
      .mockResolvedValueOnce({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    await expect(auth.signIn('a@example.com', 'pw')).resolves.toBe('done');
    expect(amplify.signOut).toHaveBeenCalledTimes(1);
  });

  it('says the account is confirmed when signing in straight after the code fails', async () => {
    const auth = await load();
    amplify.confirmSignUp.mockResolvedValue({ nextStep: { signUpStep: 'DONE' } });
    amplify.signIn.mockRejectedValue(Object.assign(new Error('net'), { name: 'NetworkError' }));
    await expect(auth.confirmSignUp('a@example.com', 'pw', '123456')).rejects.toMatchObject({
      kind: 'confirmed',
    });
  });

  it('sends someone on to sign in when the sign-in after the code asks for more', async () => {
    const auth = await load();
    amplify.confirmSignUp.mockResolvedValue({ nextStep: { signUpStep: 'DONE' } });
    amplify.signIn.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' },
    });
    await expect(auth.confirmSignUp('a@example.com', 'pw', '123456')).rejects.toMatchObject({
      kind: 'confirmed',
    });
  });

  it('gives up on a config that does not come in 8 s', async () => {
    const auth = await load();
    amplify.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    await auth.signIn('a@example.com', 'pw');
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
    await expect(amplifyAuth.signIn('a@example.com', 'pw')).rejects.toMatchObject({
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
    await expect(amplifyAuth.signIn('a@example.com', 'pw')).rejects.toMatchObject({
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
    await expect(amplifyAuth.signIn('a@example.com', 'pw')).rejects.toMatchObject({
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
    await expect(amplifyAuth.signIn('a@example.com', 'pw')).rejects.toMatchObject({
      kind: 'offline',
    });
  });

  it('calls a rate limit on the config a network problem', async () => {
    const auth = await load(null, 429);
    await expect(auth.signIn('a@example.com', 'pw')).rejects.toMatchObject({ kind: 'offline' });
  });

  it('recognises the app’s own page by its boot loader, which index.html has', () => {
    expect(readFileSync('index.html', 'utf8')).toContain('id="boot-loader"');
  });

  it('calls a config from someone else that parses (a proxy’s JSON) a network problem', async () => {
    const auth = await load({ error: 'login required' });
    await expect(auth.signIn('a@example.com', 'pw')).rejects.toMatchObject({ kind: 'offline' });
  });

  it('gives up on a new code that never comes back, as a network problem', async () => {
    const auth = await load();
    // Set up first (its fetch is real time), then a resend that hangs.
    amplify.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    await auth.signIn('a@example.com', 'pw');
    vi.useFakeTimers();
    try {
      amplify.resendSignUpCode.mockReturnValue(new Promise(() => {}));
      const result = expect(auth.resendSignUpCode('a@example.com')).rejects.toMatchObject({
        kind: 'no-answer',
      });
      await vi.advanceTimersByTimeAsync(CALL_LIMIT_MS);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for a confirm’s real answer, however long (it may yet succeed)', async () => {
    const auth = await load();
    amplify.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    await auth.signIn('a@example.com', 'pw');
    vi.useFakeTimers();
    try {
      let settled = false;
      amplify.confirmSignUp.mockReturnValue(new Promise(() => {}));
      auth.confirmSignUp('a@example.com', 'pw', '123456').then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await vi.advanceTimersByTimeAsync(CALL_LIMIT_MS * 3);
      expect(settled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the page signed out when the session check never answers', async () => {
    const auth = await load();
    localStorage.setItem('CognitoIdentityServiceProvider.client.LastAuthUser', 'abc');
    amplify.getCurrentUser.mockReturnValue(new Promise(() => {}));
    // Set up first (its fetch is real time), then the check that hangs.
    amplify.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    await auth.signIn('a@example.com', 'pw');
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
    amplify.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    vi.useFakeTimers();
    try {
      const first = expect(amplifyAuth.signIn('a@example.com', 'pw')).rejects.toMatchObject({
        kind: 'offline',
      });
      await vi.advanceTimersByTimeAsync(CALL_LIMIT_MS);
      await first;
    } finally {
      vi.useRealTimers();
    }
    await expect(amplifyAuth.signIn('a@example.com', 'pw')).resolves.toBe('done');
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
    amplify.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    vi.useFakeTimers();
    try {
      const first = expect(auth.signIn('a@example.com', 'pw')).rejects.toMatchObject({
        kind: 'offline',
      });
      await vi.advanceTimersByTimeAsync(CALL_LIMIT_MS);
      await first;
    } finally {
      vi.useRealTimers();
    }
    await auth.signIn('a@example.com', 'pw');
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
    // So does any other refusal from Cognito…
    amplify.fetchAuthSession.mockRejectedValue(
      Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' }),
    );
    await expect(auth.accessToken()).resolves.toBeNull();
    // …but a refresh that could not reach Cognito is a connection problem.
    amplify.fetchAuthSession.mockRejectedValue(
      Object.assign(new Error('Network error'), { name: 'NetworkError' }),
    );
    await expect(auth.accessToken()).rejects.toMatchObject({ kind: 'offline' });
  });
});
