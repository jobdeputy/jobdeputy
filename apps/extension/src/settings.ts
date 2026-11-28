/**
 * #54: where this build signs in and what it calls, set when it is built (`WXT_*` variables, from
 * `.env.local` written by `scripts/extension-config.mjs`, or the CI environment). A build without
 * them still runs and says it can't sign in.
 */
export interface Settings {
  /** The API's base address, no trailing slash. The manifest asks for this origin only. */
  apiUrl: string;
  /**
   * Managed login's address: `https://auth.<site>` on the site's cell (#111), else the stack's
   * `https://jobdeputy-<id>.auth.<region>.amazoncognito.com`.
   */
  authDomain: string;
  /** The extension's Cognito app client. */
  clientId: string;
  /** The web app, for links to finish the profile there (shared stacks have one). */
  siteUrl?: string;
  /**
   * #54 PR C: where the documents' download links point (the stack's `DocumentsOrigin`). The
   * manifest asks for this origin, and files are fetched from it only. Required: a build without
   * it would fail every file quietly.
   */
  filesOrigin: string;
}

type Env = Record<string, string | boolean | undefined>;

/** An https address (a path is kept) without credentials, query, hash or trailing slash. */
function origin(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.search || url.hash || url.username || url.password) {
      return null;
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

export function readSettings(env: Env): Settings | null {
  const apiUrl = origin(env.WXT_API_URL);
  const authDomain = origin(env.WXT_AUTH_DOMAIN);
  const clientId = typeof env.WXT_CLIENT_ID === 'string' ? env.WXT_CLIENT_ID : '';
  // An origin only: the host permission is the whole origin, so a path would mislead.
  const files = origin(env.WXT_FILES_ORIGIN);
  const filesOrigin = files && new URL(files).origin === files ? files : null;
  if (!apiUrl || !authDomain || !filesOrigin || !/^[a-z0-9]{20,40}$/.test(clientId)) return null;
  const siteUrl = origin(env.WXT_SITE_URL);
  return { apiUrl, authDomain, clientId, filesOrigin, ...(siteUrl ? { siteUrl } : {}) };
}
