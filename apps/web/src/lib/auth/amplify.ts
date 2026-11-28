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
      return await within(
        configure().then(({ fetchAuthSession }) => sessionEmail(fetchAuthSession)),
      );
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
    const { signInWithRedirect, signOut } = await configure();
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
      // A session left from before (stored, but not readable at boot) blocks a new sign-in: sign
      // it out, which goes through managed login's /logout and back home, clean.
      if ((error as { name?: string } | null)?.name === 'UserAlreadyAuthenticatedException') {
        await signOut();
        return;
      }
      throw error instanceof AuthError ? error : new AuthError('unknown', { cause: error });
    }
  },
  async finishSignIn() {
    // Amplify finishes the code exchange as it is configured; the session waits for it.
    try {
      const email = await within(
        configure().then(({ fetchAuthSession }) => sessionEmail(fetchAuthSession)),
      );
      if (email) return email;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('offline', { cause: error });
    }
    throw new AuthError('sign-in-failed');
  },
  async signOut() {
    const { signOut } = await configure();
    try {
      // Forgets the tokens (revoking the refresh token), then goes through managed login's
      // /logout, which comes back to the site's home.
      await signOut();
    } catch (error) {
      throw new AuthError('offline', { cause: error });
    }
  },
};

/** The signed-in person's email from their ID token (managed login gives no login ID), or null. */
async function sessionEmail(
  fetchAuthSession: Amplified['fetchAuthSession'],
): Promise<string | null> {
  const session = await fetchAuthSession();
  const email = session.tokens?.idToken?.payload.email;
  return typeof email === 'string' ? email : null;
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
