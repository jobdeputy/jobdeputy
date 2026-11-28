import { atsJobKey, jobIdOf } from '@jobdeputy/shared/job-id';

/**
 * #54 PR C: the Greenhouse posting a page is the application form of, from its address alone, as
 * the crawl names it (apps/worker/src/jobs/boards.ts): `/acme/jobs/123`, or the form a company
 * site embeds, `/embed/job_app?for=acme&token=123`. Only `job-boards.greenhouse.io`: the older
 * `boards.greenhouse.io` addresses redirect there (decision 0020).
 */
export const GREENHOUSE_HOST = 'job-boards.greenhouse.io';

/**
 * The forms the filler's content script runs on (its matches), so granted at install in every
 * build: a static content script's hosts always are (decision 0020).
 */
export const GREENHOUSE_MATCHES: readonly string[] = [`https://${GREENHOUSE_HOST}/*`];

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const POSTING_ID = /^\d{1,20}$/;

export interface Posting {
  /** `greenhouse:acme`: the crawl's board key, lowercase. */
  companyKey: string;
  /** The board's own ID for the posting. */
  postingId: string;
}

export function greenhousePosting(address: string | undefined): Posting | null {
  let url: URL;
  try {
    url = new URL(address ?? '');
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== GREENHOUSE_HOST || url.port !== '') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const [board, postingId] =
    parts[0] === 'embed' && parts[1] === 'job_app' && parts.length === 2
      ? [url.searchParams.get('for'), url.searchParams.get('token')]
      : parts[1] === 'jobs' && parts.length === 3
        ? [parts[0], parts[2]]
        : [null, null];
  if (!board || !postingId || !SLUG.test(board) || !POSTING_ID.test(postingId)) return null;
  return { companyKey: `greenhouse:${board.toLowerCase()}`, postingId };
}

/** The job's ID in the jobs table, as the crawl made it (0006). */
export function jobIdFor(posting: Posting): Promise<string> {
  return jobIdOf(atsJobKey(posting.companyKey, posting.postingId));
}
