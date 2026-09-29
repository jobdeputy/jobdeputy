/**
 * How a test user is removed (T13). The account is deleted through `DELETE /me`, so all
 * its data goes. If that fails, the login is still removed (never leave a test user
 * behind), and the run fails loudly, because data may now be orphaned.
 */
export interface CleanupSteps {
  /** Signs in and calls `DELETE /me`; returns the HTTP status. Throws if sign-in fails. */
  deleteViaApi: () => Promise<number>;
  /** Deletes the Cognito user; returns false if it did not exist. */
  adminDelete: () => Promise<boolean>;
}

export class OrphanedDataError extends Error {
  override name = 'OrphanedDataError';
}

export async function cleanUpTestUser(steps: CleanupSteps): Promise<'deleted' | 'already-gone'> {
  let status: number | undefined;
  try {
    status = await steps.deleteViaApi();
  } catch {
    // Sign-in failed: either the user is already gone (fine), or something is wrong.
  }
  if (status === 202) return 'deleted';

  const existed = await steps.adminDelete();
  if (status === undefined && !existed) return 'already-gone';
  throw new OrphanedDataError(
    `DELETE /me did not succeed (${status ?? 'sign-in failed'}); the login was removed, but its data may be orphaned.`,
  );
}
