import { WEB_SCOPES, WEB_SIGN_IN_CALLBACK_PATH } from '@jobdeputy/shared/auth';
import { readConfig } from '../config.ts';
import { type Auth, AuthError, type SignInMode } from './types.ts';

/**
 * Amplify, loaded only when needed (someone signs in, comes back from managed login, or a session
 * is stored), so the landing page does not carry it for everyone. The OAuth listener finishes a
 * sign-in managed login came back with as soon as Amplify is configured.
 */
const amplify = () =>
  Promise.all([
    import('aws-amplify'),
    import('aws-amplify/auth'),
    import('aws-amplify/auth/enable-oauth-listener'),
  ]);

/** Where Amplify keeps a signed-in session in localStorage (its key prefix). */
const SESSION_KEYS = 'CognitoIdentityServiceProvider.';

type Amplified = Awaited<ReturnType<typeof amplify>>[1];

let configured: Promise<Amplified> | undefined;
/** Which set-up is the live one: one given up on must not configure Amplify late. */
let setUps = 0;

/**
 * Loads Amplify, reads the app's config once and sets it up for managed login (#111, code + PKCE,
 * back to this origin's callback); `not-set-up` where there is none.
 */
function configure(): Promise<Amplified> {
  // Limited inside, so a set-up given up on is dropped and the next try reads the config afresh.
  // (A stalled download of Amplify's own code is one the browser shares until it ends; a reload
  // starts it over.)
  configured ??= within(
    (async (setUp: number) => {
      // Amplify's code and the config load side by side; the config is read whole within 8 s.
      const [[{ Amplify }, auth], config] = await Promise.all([amplify(), readConfig()]);
      if (!config?.userPoolId || !config.userPoolClientId || !config.authDomain) {
        throw new AuthError('not-set-up');
      }
      if (setUp !== setUps) throw new AuthError('offline');
      const origin = window.location.origin;
      Amplify.configure({
        Auth: {
          Cognito: {
            userPoolId: config.userPoolId,
            userPoolClientId: config.userPoolClientId,
            loginWith: {
              oauth: {
                domain: config.authDomain,
                scopes: [...WEB_SCOPES],
                redirectSignIn: [origin + WEB_SIGN_IN_CALLBACK_PATH],
                redirectSignOut: [`${origin}/`],
                responseType: 'code',
              },
            },
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

/**
 * Cognito's refusals that end a session: Amplify clears the stored tokens for these (its
 * isAuthenticationError, which matches names by prefix, as here), so nobody is signed in any more.
 */
const SESSION_ENDED = [
  'NotAuthorizedException',
  'TokenRevokedException',
  'UserNotFoundException',
  'PasswordResetRequiredException',
  'UserNotConfirmedException',
  'RefreshTokenReuseException',
];

/**
 * Managed login's create-account form: Cognito's `/signup` takes the same parameters as
 * `/oauth2/authorize` (code, PKCE, state, return address), and returns the same way.
 */
export function signUpUrl(authorizeUrl: string): string {
  const url = new URL(authorizeUrl);
  url.pathname = '/signup';
  return url.toString();
}

/** How long the set-up, a session check or finishing a sign-in may take: then `offline`. */
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

/** The app's authentication against Cognito's managed login, through Amplify (#14, #111). */
export const amplifyAuth: Auth = {
  async currentUser() {
    // No session stored: nobody is signed in, and Amplify need not load.
    if (!hasStoredSession()) return null;
    try {
      // One limit for the whole check, so a stall (a token refresh on bad wifi) cannot hold the
      // page up.
      return await within(configure().then(whoIs));
    } catch {
      return null;
    }
  },
  async accessToken() {
    if (!hasStoredSession()) return null;
    // Amplify refreshes a token that has run out. The session is gone only when Cognito refuses
    // it for good (and Amplify clears it); anything else (no network, an answer cut off, a busy
    // or failing Cognito, no answer in time) is a connection problem, and asking again can work.
    try {
      const session = await within(configure().then(({ fetchAuthSession }) => fetchAuthSession()));
      return session.tokens?.accessToken.toString() ?? null;
    } catch (error) {
      const name = (error as { name?: string } | null)?.name ?? '';
      if (SESSION_ENDED.some((ended) => name.startsWith(ended)) || !hasStoredSession()) return null;
      throw error instanceof AuthError ? error : new AuthError('offline', { cause: error });
    }
  },
  async signIn(mode: SignInMode) {
    const auth = await configure();
    const { signInWithRedirect } = auth;
    const leave = () =>
      signInWithRedirect(
        mode === 'sign-up'
          ? {
              options: {
                authSessionOpener: async (url) => {
                  window.location.assign(signUpUrl(url));
                },
              },
            }
          : undefined,
      );
    try {
      await leave();
    } catch (error) {
      // A session left from before blocks a new sign-in. A readable one is someone's: go home. One
      // that cannot be read is forgotten here (no trip to managed login, whose /logout would race
      // this page's own leaving), then the page leaves once more.
      if ((error as { name?: string } | null)?.name === 'UserAlreadyAuthenticatedException') {
        // Someone is signed in after all (in another tab, say): go home to them, never wipe it.
        if (await whoIs(auth).catch(() => null)) {
          window.location.assign('/');
          return;
        }
        clearStoredSession();
        try {
          await leave();
          return;
        } catch (again) {
          throw inOurTerms(again);
        }
      }
      throw inOurTerms(error);
    }
  },
  finishSignIn() {
    // Once per page load (React's strict mode runs the app's effect twice in development).
    finishing ??= finish();
    return finishing;
  },
  async signOut() {
    const { signOut } = await configure();
    try {
      // Forgets the tokens (revoking the refresh token), then goes through managed login's
      // /logout, which comes back to the site's home.
      await signOut();
    } catch (error) {
      throw inOurTerms(error);
    }
  },
};

let finishing: Promise<string> | undefined;

/** How long finishing waits for Amplify's code exchange before checking the session itself. */
export const FINISH_LIMIT_MS = 30_000;

/**
 * Finishes the sign-in managed login came back with. Amplify's OAuth listener exchanges the code as
 * Amplify is configured, and says when it is done on its Hub (a session read waits for it only for
 * 5 minutes after leaving, too short for a new account's email code). An address with neither a
 * code nor an error has nothing to finish.
 */
async function finish(): Promise<string> {
  const params = new URLSearchParams(window.location.search);
  // Refused or cancelled on managed login, or nothing came back: nothing to finish.
  if (!params.has('code')) throw new AuthError('sign-in-failed');
  // Nothing under way here (Back or Forward to an old return address, or after the browser's
  // back-forward cache cancelled it): no word will come, so the session says at once.
  if (!exchangeUnderWay()) {
    const email = await within(configure().then(whoIs)).catch((error: unknown) => {
      throw error instanceof AuthError ? error : new AuthError('offline', { cause: error });
    });
    if (email) return email;
    throw new AuthError('sign-in-failed');
  }
  let stop = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { Hub } = await import('aws-amplify/utils');
    const outcome = new Promise<'done' | 'failed'>((resolve) => {
      stop = Hub.listen('auth', ({ payload }) => {
        if (payload.event === 'signInWithRedirect') resolve('done');
        if (payload.event === 'signInWithRedirect_failure') resolve('failed');
      });
    });
    const auth = await configure();
    // No word in time (a slow exchange, or none under way here): the session says.
    const said = await Promise.race([
      outcome,
      new Promise<'unsure'>((resolve) => {
        timer = setTimeout(() => resolve('unsure'), FINISH_LIMIT_MS);
      }),
    ]);
    if (said === 'failed') throw new AuthError('sign-in-failed');
    const email = await within(whoIs(auth));
    if (email) return email;
    throw new AuthError('sign-in-failed');
  } catch (error) {
    throw error instanceof AuthError ? error : new AuthError('offline', { cause: error });
  } finally {
    clearTimeout(timer);
    stop();
  }
}

/**
 * Who is signed in: the email from the ID token (managed login gives no login ID), else the
 * session's login ID or username; null with no session.
 */
async function whoIs(auth: Amplified): Promise<string | null> {
  const session = await auth.fetchAuthSession();
  if (!session.tokens) return null;
  const email = session.tokens.idToken?.payload.email;
  if (typeof email === 'string') return email;
  // A session without the claim (one made before #111, say) is still someone's.
  const user = await auth.getCurrentUser();
  return user.signInDetails?.loginId ?? user.username;
}

/**
 * Whether Amplify has a sign-in with managed login under way in this browser: its mark,
 * `CognitoIdentityServiceProvider.<client>.inflightOAuth` (Amplify 6's key, set when leaving and
 * cleared once the code is exchanged or the sign-in is cancelled). Read before Amplify is set up.
 */
export function exchangeUnderWay(): boolean {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) ?? '';
      if (key.startsWith(SESSION_KEYS) && key.endsWith('.inflightOAuth')) {
        return localStorage.getItem(key) === 'true';
      }
    }
  } catch {
    // Storage unavailable: nothing under way.
  }
  return false;
}

/** Forgets a stored session here only (its keys), so a new sign-in can start. */
function clearStoredSession(): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
    for (const key of keys) {
      if (key?.startsWith(SESSION_KEYS) && !/\.(inflightOAuth|oauthPKCE|oauthState)/.test(key)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage unavailable: nothing stored to forget.
  }
}

/** A failure to leave, in our terms: a network failure is `offline`. */
function inOurTerms(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  const name = (error as { name?: string } | null)?.name ?? '';
  return new AuthError(name === 'NetworkError' ? 'offline' : 'unknown', { cause: error });
}

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
