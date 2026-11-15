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
    // Amplify's code and the config load side by side; the config is read whole within 8 s.
    const [[{ Amplify }, auth], config] = await Promise.all([amplify(), readConfig()]);
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

/**
 * Runs one Amplify call, configured first, with its failure in our terms. Amplify's requests have
 * no time limit of their own, so loading it and its config gets one; so does the call, with
 * `limited`, where a late answer does no harm (a new code that arrives anyway). A call that changes
 * the account (confirming, signing in, a new password) waits for its real answer: given up on, it
 * could still succeed and leave the form telling the person something untrue.
 */
async function call<T>(
  work: (auth: Amplified) => Promise<T>,
  { limited = false } = {},
): Promise<T> {
  const auth = await within(configure());
  try {
    return await (limited ? within(work(auth)) : work(auth));
  } catch (error) {
    if (error instanceof AuthError) throw error;
    const name = (error as { name?: string } | null)?.name ?? '';
    throw new AuthError(KINDS[name] ?? 'unknown', { cause: error });
  }
}

/** How long a limited step may take before it counts as a connection problem. */
export const CALL_LIMIT_MS = 20_000;

/** `work`'s answer, or `offline` after the limit (the work runs on, unheeded). */
async function within<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AuthError('offline')), CALL_LIMIT_MS);
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
      // Limited, so a stalled check (a token refresh on bad wifi) cannot hold the page up.
      const { getCurrentUser } = await within(configure());
      const user = await within(getCurrentUser());
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

/**
 * The deployed app's sign-in config, or null where there is none: a 404, or the app's own page,
 * which the site sends for any unknown path (CloudFront, Vite). Anything else that is not the
 * config is a connection problem (`offline`): a server or rate-limit error, or a page from wifi
 * that asks you to sign in to it first.
 */
async function readConfig(): Promise<Config | null> {
  const response = await fetch(CONFIG_URL, {
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new AuthError('offline');
  const body = await response.text();
  const config = parseJson(body) as Partial<Config> | null;
  if (typeof config?.userPoolId === 'string' && typeof config.userPoolClientId === 'string') {
    return { userPoolId: config.userPoolId, userPoolClientId: config.userPoolClientId };
  }
  // The deploy writes the config whole, so anything else is not ours: the app's own page means
  // there is none here; another answer came from something on the way.
  if (body.includes(APP_PAGE_MARK)) return null;
  throw new AuthError('offline');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Only the app's own page (index.html) has the boot loader. */
const APP_PAGE_MARK = 'id="boot-loader"';
