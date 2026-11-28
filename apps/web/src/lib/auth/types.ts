/**
 * What the app needs from authentication, in our words: screens never see Cognito or Amplify.
 * Since #111 (decision 0021) people sign in, sign up, confirm their email and reset a password on
 * Cognito's managed login page (auth.<site>), shared with the extension; the app only leaves for
 * it and finishes the sign-in it returns with. `amplify.ts` implements it against Cognito;
 * `fake.ts` is the test build's stand-in.
 */
export type Auth = {
  /** The signed-in person's email, or null. */
  currentUser(): Promise<string | null>;
  /**
   * The signed-in person's access token for the API (refreshed when it has run out), or null when
   * nobody is signed in or Cognito has ended the session. Fails `offline` when the refresh may
   * work on another try (no network, an answer cut off, a busy or failing Cognito, no answer in
   * time), and `not-set-up` where sign-in is not configured.
   */
  accessToken(): Promise<string | null>;
  /**
   * Leaves for managed login: its sign-in form, or its create-account form (`sign-up`). Resolves
   * once the browser is on its way; fails (`offline`, `not-set-up`, `unknown`) when it cannot.
   */
  signIn(mode: SignInMode): Promise<void>;
  /**
   * On the return address (`/auth/callback`): finishes the sign-in managed login came back with,
   * and gives the person's email. Fails `sign-in-failed` when there is none to finish (cancelled,
   * refused, or the page opened by itself), `offline` when the exchange could not be made.
   */
  finishSignIn(): Promise<string>;
  /**
   * Signs out here, then of managed login too (its `/logout`, which comes back to the site), so
   * the next sign-in asks again. The extension's own sign-in is not touched.
   */
  signOut(): Promise<void>;
};

export type SignInMode = 'sign-in' | 'sign-up';

/** Why an auth step failed, in the terms the app explains to people. */
export type AuthErrorKind =
  /** The network failed, or Cognito did not answer in time. */
  | 'offline'
  /** Sign-in is not configured where the app runs. */
  | 'not-set-up'
  /** Managed login came back without a sign-in to finish (cancelled, or refused). */
  | 'sign-in-failed'
  | 'unknown';

export class AuthError extends Error {
  constructor(
    readonly kind: AuthErrorKind,
    options?: ErrorOptions,
  ) {
    super(kind, options);
    this.name = 'AuthError';
  }
}
