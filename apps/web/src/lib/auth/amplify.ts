import { readConfig } from '../config.ts';
import { type Auth, AuthError, type AuthErrorKind } from './types.ts';

/**
 * Amplify, loaded only when needed (someone opens the forms, or a session is stored), so the
 * landing page does not carry it for everyone.
 */
const amplify = () => Promise.all([import('aws-amplify'), import('aws-amplify/auth')]);

/** Where Amplify keeps a signed-in session in localStorage (its key prefix). */
const SESSION_KEYS = 'CognitoIdentityServiceProvider.';

/** Where the deployed app finds its Cognito pool (written by the web stack: #14 slice 2b). */

type Amplified = Awaited<ReturnType<typeof amplify>>[1];

let configured: Promise<Amplified> | undefined;
/** Which set-up is the live one: one given up on must not configure Amplify late. */
let setUps = 0;

/** Loads Amplify, reads the app's config once and sets it up; `not-set-up` where there is none. */
function configure(): Promise<Amplified> {
  // Limited inside, so a set-up given up on is dropped and the next try reads the config afresh.
  // (A stalled download of Amplify's own code is one the browser shares until it ends; a reload
  // starts it over.)
  configured ??= within(
    (async (setUp: number) => {
      // Amplify's code and the config load side by side; the config is read whole within 8 s.
      const [[{ Amplify }, auth], config] = await Promise.all([amplify(), readConfig()]);
      if (!config?.userPoolId || !config.userPoolClientId) throw new AuthError('not-set-up');
      if (setUp !== setUps) throw new AuthError('offline');
      Amplify.configure({
        Auth: {
          Cognito: {
            userPoolId: config.userPoolId,
            userPoolClientId: config.userPoolClientId,
            loginWith: { email: true },
          },
        },
      });
      return auth;
    })(++setUps),
  ).catch((error: unknown) => {
    // Let a later try read the config again (a network blip, say).
    configured = undefined;
    throw error instanceof AuthError ? error : new AuthError('offline', { cause: error });
  });
  return configured;
}

/** Cognito's error names, in the forms' terms. */
const KINDS: Record<string, AuthErrorKind> = {
  NotAuthorizedException: 'wrong-details',
  UserNotFoundException: 'wrong-details',
  UsernameExistsException: 'account-exists',
  AliasExistsException: 'account-exists',
  CodeMismatchException: 'wrong-code',
  ExpiredCodeException: 'expired-code',
  LimitExceededException: 'too-many-tries',
  TooManyRequestsException: 'too-many-tries',
  TooManyFailedAttemptsException: 'too-many-tries',
  CodeDeliveryFailureException: 'too-many-tries',
  InvalidPasswordException: 'weak-password',
  NetworkError: 'offline',
};

/**
 * Runs one Amplify call, configured first, with its failure in our terms. Amplify's requests have
 * no time limit of their own, so loading it and its config gets one; so does the call, with
 * `limited`, where a late answer does no harm: a new sign-up code, which the code step already
 * waits for. Every other call waits for its real answer: given up on, it could still succeed and
 * leave the form telling the person something untrue (an account made, a password changed, a
 * reset code sent after the form said it had not been).
 */
async function call<T>(
  work: (auth: Amplified) => Promise<T>,
  { limited = false } = {},
): Promise<T> {
  const auth = await configure();
  try {
    return await (limited ? within(work(auth), 'no-answer') : work(auth));
  } catch (error) {
    if (error instanceof AuthError) throw error;
    const name = (error as { name?: string } | null)?.name ?? '';
    throw new AuthError(KINDS[name] ?? 'unknown', { cause: error });
  }
}

/** How long a limited step may take: the set-up then fails as `offline`, a call as `no-answer`. */
export const CALL_LIMIT_MS = 20_000;

/** `work`'s answer, or a failure of `kind` after the limit (the work runs on, unheeded). */
async function within<T>(work: Promise<T>, kind: AuthErrorKind = 'offline'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AuthError(kind)), CALL_LIMIT_MS);
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

/** The app's authentication against Cognito, through Amplify (decision on #14: Amplify Auth v6). */
export const amplifyAuth: Auth = {
  async currentUser() {
    // No session stored: nobody is signed in, and Amplify need not load.
    if (!hasStoredSession()) return null;
    try {
      // One limit for the whole check, so a stall (a token refresh on bad wifi) cannot hold the
      // page up.
      const user = await within(configure().then(({ getCurrentUser }) => getCurrentUser()));
      return user.signInDetails?.loginId ?? user.username;
    } catch {
      return null;
    }
  },
  async accessToken() {
    if (!hasStoredSession()) return null;
    // Amplify refreshes a token that has run out; a session it cannot refresh has none.
    const session = await within(
      configure().then(({ fetchAuthSession }) => fetchAuthSession()),
    ).catch(() => null);
    return session?.tokens?.accessToken.toString() ?? null;
  },
  signUp: (email, password) =>
    call(async ({ signUp }) => {
      await signUp({
        username: email,
        password,
        options: { userAttributes: { email }, autoSignIn: true },
      });
    }),
  confirmSignUp: (email, password, code) =>
    call(async ({ autoSignIn, confirmSignUp, signIn }) => {
      const { nextStep } = await confirmSignUp({ username: email, confirmationCode: code });
      // Signed straight in after the code; where Amplify cannot (a new tab), sign in afresh.
      if (nextStep.signUpStep === 'COMPLETE_AUTO_SIGN_IN') {
        const result = await autoSignIn().catch(() => null);
        if (result?.isSignedIn) return;
      }
      // The account is confirmed now (the code cannot be used again): if this sign-in does not
      // finish (it fails, or asks for more), send them to sign in.
      const result = await signIn({ username: email, password }).catch((error: unknown) => {
        throw new AuthError('confirmed', { cause: error });
      });
      if (!result.isSignedIn) throw new AuthError('confirmed');
    }),
  resendSignUpCode: (email) =>
    call(
      async ({ resendSignUpCode }) => {
        await resendSignUpCode({ username: email });
      },
      { limited: true },
    ),
  signIn: (email, password) =>
    call(async ({ signIn, signOut }) => {
      // A session left from before (stored, but not readable at boot) would block a new sign-in:
      // clear it and sign in once more.
      const attempt = () => signIn({ username: email, password });
      const { isSignedIn, nextStep } = await attempt().catch(async (error: { name?: string }) => {
        if (error?.name !== 'UserAlreadyAuthenticatedException') throw error;
        await signOut();
        return attempt();
      });
      if (nextStep.signInStep === 'CONFIRM_SIGN_UP') return 'confirm';
      if (!isSignedIn) throw new AuthError('unknown');
      return 'done';
    }),
  resetPassword: (email) =>
    call(async ({ resetPassword }) => {
      await resetPassword({ username: email });
    }),
  confirmResetPassword: (email, code, newPassword) =>
    call(async ({ confirmResetPassword }) => {
      await confirmResetPassword({ username: email, confirmationCode: code, newPassword });
    }),
  signOut: () =>
    call(async ({ signOut }) => {
      await signOut();
    }),
};

/** Whether this browser holds a Cognito session (Amplify's localStorage keys). */
function hasStoredSession(): boolean {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      if (localStorage.key(index)?.startsWith(SESSION_KEYS)) return true;
    }
  } catch {
    // Storage unavailable: no stored session.
  }
  return false;
}
