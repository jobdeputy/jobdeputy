import { WEB_SIGN_IN_CALLBACK_PATH } from '@jobdeputy/shared/auth';
import { type Auth, AuthError, type SignInMode } from './types.ts';

/** Who the fake's managed login signs in: an existing account, or a new one (`sign-up`). */
export const FAKE_USERS: Record<SignInMode, string> = {
  'sign-in': 'you@example.com',
  'sign-up': 'new@example.com',
};

/** Where the fake keeps its session and its sign-in under way, as Amplify keeps its own. */
const SESSION_KEY = 'jobdeputy.fake-auth.user';
const PENDING_KEY = 'jobdeputy.fake-auth.pending';

/**
 * The test build's authentication (`--mode e2e`), so browser tests can sign in without Cognito.
 * Like managed login it leaves the page and comes back to `/auth/callback`, at once (there is no
 * page to fill in): signing in gives `you@example.com`, creating an account `new@example.com`.
 * Its session lives in sessionStorage, so it outlasts those page loads, and ends with the tab.
 * An address with `?error=` comes back refused, as managed login does when someone cancels.
 */
export function createFakeAuth({
  delay = 400,
  storage = memoryStorage(),
  go = (url: string) => window.location.assign(url),
  signedInAs,
}: {
  delay?: number;
  /** The test build passes sessionStorage; unit tests keep each fake's own. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Leaves the page (tests watch it). */
  go?: (url: string) => void;
  /** Starts signed in as this person (unit tests). */
  signedInAs?: string;
} = {}): Auth {
  if (signedInAs) storage.setItem(SESSION_KEY, signedInAs);
  const settle = () => new Promise((resolve) => setTimeout(resolve, delay));
  const read = (key: string) => {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };

  return {
    async currentUser() {
      return read(SESSION_KEY);
    },
    async accessToken() {
      const user = read(SESSION_KEY);
      return user ? `fake-token:${user}` : null;
    },
    async signIn(mode) {
      await settle();
      storage.setItem(PENDING_KEY, mode);
      go(`${WEB_SIGN_IN_CALLBACK_PATH}?code=fake&state=${mode}`);
    },
    async finishSignIn() {
      await settle();
      const params = new URLSearchParams(window.location.search);
      // Kept: React's strict mode finishes twice in development (the next sign-in overwrites it).
      const pending = read(PENDING_KEY);
      if (params.get('error') || params.get('code') !== 'fake') {
        throw new AuthError('sign-in-failed');
      }
      if (pending !== 'sign-in' && pending !== 'sign-up') throw new AuthError('sign-in-failed');
      const email = FAKE_USERS[pending];
      storage.setItem(SESSION_KEY, email);
      return email;
    },
    async signOut() {
      storage.removeItem(SESSION_KEY);
      go('/');
    },
  };
}

/** A storage of the fake's own. */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}
