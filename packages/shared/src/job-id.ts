/**
 * A job's ID (decision 0006): the first 32 hex digits of the SHA-256 of its dedupe key. The crawl
 * worker makes it (apps/worker/src/jobs/job.ts); #54's extension works it out from the posting's
 * address, to find the job's cover letter without asking the web app.
 */

/** The dedupe key of a posting the board names by its own ID: `ats:greenhouse:acme:123`. */
export function atsJobKey(companyKey: string, externalId: string): string {
  return `ats:${companyKey}:${externalId}`;
}

/** The job ID for a dedupe key, with WebCrypto (browsers, service workers and Node). */
export async function jobIdOf(dedupeKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dedupeKey));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}
