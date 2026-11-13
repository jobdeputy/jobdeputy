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

/**
 * Temporary answers worth waiting out: the dev API's throttle (429, 5 requests a second)
 * and server errors. Seen in a Nightly run on 2026-09-29: six users deleted at once got a
 * 429, and the fallback orphaned that user's data.
 */
export const CLEANUP_RETRY = { maxAttempts: 4, baseMs: 500 } as const;
const retriable = (status: number) => status === 429 || status >= 500;

export interface RetryTiming {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export async function cleanUpTestUser(
  steps: CleanupSteps,
  timing: RetryTiming = {},
): Promise<'deleted' | 'already-gone'> {
  const sleep = timing.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const random = timing.random ?? Math.random;
  let status: number | undefined;
  for (let attempt = 1; attempt <= CLEANUP_RETRY.maxAttempts; attempt += 1) {
    status = undefined;
    try {
      status = await steps.deleteViaApi();
    } catch {
      // Sign-in failed: either the user is already gone (fine), or something is wrong.
    }
    if (status === undefined || !retriable(status)) break;
    // Jittered, growing waits (0.5 s, 1 s, 2 s at most on average), so parallel clean-ups spread out.
    if (attempt < CLEANUP_RETRY.maxAttempts)
      await sleep(Math.floor(random() * CLEANUP_RETRY.baseMs * 2 ** attempt));
  }
  if (status === 202) return 'deleted';

  const existed = await steps.adminDelete();
  if (status === undefined && !existed) return 'already-gone';
  throw new OrphanedDataError(
    `DELETE /me did not succeed (${status ?? 'sign-in failed'}); the login was removed, but its data may be orphaned.`,
  );
}
