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
async function load(body: unknown = CONFIG, ok = true) {
  vi.resetModules();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, json: async () => body })),
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
    const auth = await load(null, false);
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
});
