import { type Auth, AuthError } from './types.ts';

/** The code the fake accepts. */
export const FAKE_CODE = '123456';

type Account = { password: string; confirmed: boolean };

/**
 * The test build's authentication (`--mode e2e`), in memory, so browser tests can walk every form
 * without Cognito. Accounts start empty; `exists@example.com` is taken, to show that error; an
 * email with "slow" in it answers slowly.
 */
export function createFakeAuth({ delay = 400 }: { delay?: number } = {}): Auth {
  const accounts = new Map<string, Account>([
    ['exists@example.com', { password: 'correct horse battery', confirmed: true }],
  ]);
  let signedIn: string | null = null;
  // As long as a real call takes, so the pending states show in the test build; an email with
  // "slow" in it takes 1.5 s, long enough for a test to see the pending state for sure.
  const settle = (email = '') =>
    new Promise((resolve) => setTimeout(resolve, email.includes('slow') ? 1500 : delay));

  return {
    async currentUser() {
      return signedIn;
    },
    async signUp(email, password) {
      await settle(email);
      if (accounts.has(email)) throw new AuthError('account-exists');
      accounts.set(email, { password, confirmed: false });
    },
    async confirmSignUp(email, _password, code) {
      await settle();
      const account = accounts.get(email);
      if (!account || code !== FAKE_CODE) throw new AuthError('wrong-code');
      account.confirmed = true;
      signedIn = email;
    },
    async resendSignUpCode() {
      await settle();
    },
    async signIn(email, password) {
      await settle();
      const account = accounts.get(email);
      if (!account || account.password !== password) throw new AuthError('wrong-details');
      if (!account.confirmed) return 'confirm';
      signedIn = email;
      return 'done';
    },
    async resetPassword() {
      await settle();
    },
    async confirmResetPassword(email, code, newPassword) {
      await settle();
      const account = accounts.get(email);
      if (code !== FAKE_CODE || !account) throw new AuthError('wrong-code');
      account.password = newPassword;
    },
    async signOut() {
      signedIn = null;
    },
  };
}
