import { type Auth, AuthError, type AuthErrorKind } from './types.ts';

/**
 * Amplify, loaded only when needed (someone opens the forms, or a session is stored), so the
 * landing page does not carry it for everyone.
 */
const amplify = () => Promise.all([import('aws-amplify'), import('aws-amplify/auth')]);

/** Where Amplify keeps a signed-in session in localStorage (its key prefix). */
const SESSION_KEYS = 'CognitoIdentityServiceProvider.';

/** Where the deployed app finds its Cognito pool (written by the web stack: #14 slice 2b). */
const CONFIG_URL = '/config.json';

type Config = { userPoolId: string; userPoolClientId: string };

type Amplified = Awaited<ReturnType<typeof amplify>>[1];

let configured: Promise<Amplified> | undefined;

/** Loads Amplify, reads the app's config once and sets it up; `not-set-up` where there is none. */
function configure(): Promise<Amplified> {
  configured ??= (async () => {
    const [{ Amplify }, auth] = await amplify();
    const response = await fetch(CONFIG_URL, { cache: 'no-store' });
    const config = (
      response.ok ? await response.json().catch(() => null) : null
    ) as Partial<Config> | null;
    if (!config?.userPoolId || !config.userPoolClientId) throw new AuthError('not-set-up');
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
  })().catch((error: unknown) => {
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

/** Runs one Amplify call, configured first, with its failure in our terms. */
async function call<T>(work: (auth: Amplified) => Promise<T>): Promise<T> {
  const auth = await configure();
  try {
    return await work(auth);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    const name = (error as { name?: string } | null)?.name ?? '';
    throw new AuthError(KINDS[name] ?? 'unknown', { cause: error });
  }
}

/** The app's authentication against Cognito, through Amplify (decision on #14: Amplify Auth v6). */
export const amplifyAuth: Auth = {
  async currentUser() {
    // No session stored: nobody is signed in, and Amplify need not load.
    if (!hasStoredSession()) return null;
    try {
      const { getCurrentUser } = await configure();
      const user = await getCurrentUser();
      return user.signInDetails?.loginId ?? user.username;
    } catch {
      return null;
    }
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
      await signIn({ username: email, password });
    }),
  resendSignUpCode: (email) =>
    call(async ({ resendSignUpCode }) => {
      await resendSignUpCode({ username: email });
    }),
  signIn: (email, password) =>
    call(async ({ signIn }) => {
      const { isSignedIn, nextStep } = await signIn({ username: email, password });
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
