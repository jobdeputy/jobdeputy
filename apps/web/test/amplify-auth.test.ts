import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
}));
vi.mock('aws-amplify', () => ({ Amplify: { configure: amplify.configure } }));
vi.mock('aws-amplify/auth', () => amplify);

const CONFIG = { userPoolId: 'us-east-1_abc', userPoolClientId: 'client' };

/** A fresh adapter (it keeps its configuration for the page), with /config.json answering `body`. */
async function load(body: unknown = CONFIG, status = 200) {
  vi.resetModules();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
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

  it('calls a broken config (sent as JSON, but not JSON) not set up', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"userPoolId": ', { headers: { 'content-type': 'application/json' } }),
      ),
    );
    const { amplifyAuth } = await import('../src/lib/auth/amplify.ts');
    await expect(amplifyAuth.signIn('a@example.com', 'pw')).rejects.toMatchObject({
      kind: 'not-set-up',
    });
  });
});
