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
];

/**
 * The scope the web app's and the tests' tokens carry: Cognito gives it to the web client's managed
 * login sign-in, which asks for it (#111, `WEB_SCOPES`), and to a direct (admin) sign-in.
 */
export const WEB_SCOPE = 'aws.cognito.signin.user.admin';
