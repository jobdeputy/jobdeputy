/**
 * What the sign-in and sign-up forms need from authentication (#14), in our words: the forms never
 * see Cognito or Amplify. `amplify.ts` implements it against Cognito; `fake.ts` is the test
 * build's stand-in (browser tests cannot run Cognito's secure-password exchange).
 */
export type Auth = {
  /** The signed-in person's email, or null. */
  currentUser(): Promise<string | null>;
  /** Creates the account; a 6-digit code goes to the email next. */
  signUp(email: string, password: string): Promise<void>;
  /** Confirms the account with its code, and signs the person in. */
  confirmSignUp(email: string, password: string, code: string): Promise<void>;
  /** Sends a new sign-up code. */
  resendSignUpCode(email: string): Promise<void>;
  /** Signs in; `confirm` when the account still needs its emailed code. */
  signIn(email: string, password: string): Promise<'done' | 'confirm'>;
  /** Sends a reset code to the email, if an account uses it (it does not say). */
  resetPassword(email: string): Promise<void>;
  /** Sets the new password with the emailed code. */
  confirmResetPassword(email: string, code: string, newPassword: string): Promise<void>;
  signOut(): Promise<void>;
};

/** Why an auth step failed, in the terms the forms explain to people. */
export type AuthErrorKind =
  /** Sign-in: the email or password is wrong (never which one, nor whether the account exists). */
  | 'wrong-details'
  /** Sign-up: an account already uses this email. */
  | 'account-exists'
  | 'wrong-code'
  | 'expired-code'
  /** Too many tries for now. */
  | 'too-many-tries'
  /** The password does not meet the rules. */
  | 'weak-password'
  /** The network failed. */
  | 'offline'
  /** Sign-in is not configured where the app runs. */
  | 'not-set-up'
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
