/**
 * #54 (decision 0020): the browser extension's fixed identity, shared by the extension's manifest
 * and the infrastructure (the client's sign-in return addresses).
 *
 * The dev ID comes from a public key, `extension-dev-key.pub` (read by `extension-key.ts`, Node
 * only), set as the manifest's `key` in dev builds. Only the public half exists: unpacked loads
 * need no private key. As the key is public, anyone can load an unpacked extension with this ID,
 * so only dev stacks trust it. The Chrome Web Store gives the store item its own ID, which no one
 * else can take; prod trusts only that, once the item exists.
 */
/** The dev builds' ID, from the dev public key (`extension-key.ts`). Dev stacks only. */
export const EXTENSION_DEV_IDS: readonly string[] = ['pkdigeiognmabnigddaekkkmecnaiadf'];

/** Where `chrome.identity.launchWebAuthFlow` returns for an extension ID (Chrome intercepts it). */
export function extensionRedirectUrl(id: string): string {
  return `https://${id}.chromiumapp.org/`;
}

/** The store item's ID, added when the item exists (#54, before the listing). Every stack. */
export const EXTENSION_STORE_IDS: readonly string[] = [];

/** The `Origin` the extension's own pages and service worker send (managed login answers it). */
export function extensionOrigin(id: string): string {
  return `chrome-extension://${id}`;
}

/** OAuth scopes the extension asks for: who you are, and your email for the popup. */
export const EXTENSION_SCOPES: readonly string[] = ['openid', 'email'];

/**
 * The only API routes the extension's tokens may call (decision 0020, least privilege); each later
 * PR adds the ones it uses. Every other route asks for `WEB_SCOPE`, which the web app's sign-in
 * gives its tokens and managed login never gives the extension's.
 */
export const EXTENSION_API_ROUTES: readonly string[] = [
  // PR B: the popup's "ready to fill" lines.
  'GET /me/profile',
  'GET /me/documents',
  'GET /me/applicant',
  // PR C, the Greenhouse filler: the self-ID answers (decrypted for the user's own client, never
  // stored by it), the résumé file (the default's, or the company's tailored one) and the job's
  // cover letter. Reads only: every write stays the web app's.
  'GET /me/voluntary',
  'GET /me/documents/{documentId}',
  'GET /me/tailorings',
  'GET /me/tailorings/{documentId}',
  'GET /me/cover-letters',
  'GET /me/cover-letters/{documentId}',
  // PR D: on a Greenhouse confirmation page, the panel asks "Mark as applied?" only for a job in
  // the user's list with stage New, and records it. Its one write, and the API takes from an
  // extension token only `EXTENSION_STAGE_CHANGE` (the web app's tokens move a job anywhere).
  'GET /me/jobs/{jobId}',
  'PUT /me/jobs/{jobId}/stage',
];

/**
 * PR D (decision 0020): the only stage change the API accepts from an extension token, recording
 * an application to a job at stage New (also one hidden or closed: the user really applied).
 * Every other change (undo, later stages) stays the web app's.
 */
export const EXTENSION_STAGE_CHANGE = { stage: 'applied', from: 'new' } as const;

/**
 * The scope the web app's and the tests' tokens carry: Cognito gives it to the web client's managed
 * login sign-in, which asks for it (#111, `WEB_SCOPES`), and to a direct (admin) sign-in.
 */
export const WEB_SCOPE = 'aws.cognito.signin.user.admin';

/**
 * #54 PR D (decision 0020): what the web app and the extension say to each other, through the
 * extension's `externally_connectable` (the site's origin only). The web app asks `hello`, then
 * `auto-apply` with a job and its Greenhouse form; the extension checks both and opens the form.
 */
export interface ExtensionHello {
  /** The extension's version. */
  version: string;
  /** Signed in now (the extension may still sign in without a window when asked to apply). */
  signedIn: boolean;
}

export type AutoApplyAnswer =
  | { ok: true }
  | { ok: false; reason: 'signed-out' | 'not-greenhouse' | 'wrong-job' | 'failed' };

const GREENHOUSE_BOARD = /^greenhouse:([a-z0-9][a-z0-9._-]{0,99})$/;
const GREENHOUSE_POSTING = /^\d{1,20}$/;

/**
 * A Greenhouse job's own application form on the board's host, which Auto apply opens: built from
 * the job's board (`greenhouse:acme`) and its posting ID, never from its stored address, which is
 * often the company's careers page. Null for any other job.
 */
export function greenhouseFormUrl(
  companyKey: string,
  externalId: string | undefined,
): string | null {
  const board = GREENHOUSE_BOARD.exec(companyKey)?.[1];
  if (!board || externalId === undefined || !GREENHOUSE_POSTING.test(externalId)) return null;
  return `https://job-boards.greenhouse.io/${board}/jobs/${externalId}`;
}
