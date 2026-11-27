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
  'GET /me/profile',
  'GET /me/documents',
  'GET /me/applicant',
];

/** The scope Cognito gives tokens from a direct (SRP or admin) sign-in: the web app and tests. */
export const WEB_SCOPE = 'aws.cognito.signin.user.admin';
