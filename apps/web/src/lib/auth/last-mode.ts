import type { SignInMode } from './types.ts';

/** Where the drawer's mode waits while the person is on the sign-in page (#111). */
const KEY = 'jobdeputy.sign-in-mode';

/** Kept for the tab, so a sign-in that comes back unfinished reopens the drawer as it was left. */
export function rememberSignInMode(mode: SignInMode): void {
  try {
    sessionStorage.setItem(KEY, mode);
  } catch {
    // Storage unavailable: the drawer reopens for signing in.
  }
}

/** The mode the person last left with; signing in when there is none. */
export function lastSignInMode(): SignInMode {
  try {
    return sessionStorage.getItem(KEY) === 'sign-up' ? 'sign-up' : 'sign-in';
  } catch {
    return 'sign-in';
  }
}
