import { EXTENSION_SCOPES } from '@jobdeputy/shared/extension';
import type { Settings } from '../settings.ts';
import { challengeFor, randomToken } from './pkce.ts';

/**
 * #54 (decision 0020): the extension's sign-in, owned by its service worker. Managed login in a
 * window of its own (`launch`, `chrome.identity.launchWebAuthFlow`), the code exchanged with PKCE,
 * the tokens kept only in `storage` (`chrome.storage.session`: the extension's own pages and
 * worker only, gone when the browser closes), refreshed before they run out. Sign-out revokes and
 * forgets them; the person stays remembered by managed login (and by email here, until the browser
 * closes) so the popup can offer to continue as them or to use a different account.
 */
export interface Session {
  accessToken: string;
  refreshToken: string;
  /** When the access token runs out (ms since the epoch). */
  expiresAt: number;
  /** From the ID token, to say who is signed in. */
  email?: string;
}

/** `chrome.storage.session`, or a fake in tests. */
export interface Storage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface AuthDeps {
  settings: Settings;
  /** `chrome.identity.getRedirectURL()`: `https://<id>.chromiumapp.org/`. */
  redirectUrl: string;
  /**
   * Opens managed login; resolves with the address it returned to (rejects when closed). Not
   * `interactive` (#111): no window at all, and a rejection when the page would need the person.
   */
  launch(url: string, interactive: boolean): Promise<string | undefined>;
  storage: Storage;
  fetch: typeof fetch;
  now(): number;
}

export type SignInOutcome = 'signed-in' | 'cancelled' | 'offline' | 'failed';

/** #111: a sign-in without a window: done, not possible now (`none`), or managed login unreachable. */
export type SilentOutcome = 'signed-in' | 'none' | 'offline';

export type AuthStatus =
  | { state: 'signed-in'; email?: string }
  | { state: 'signed-out'; lastEmail?: string; interrupted?: boolean };

/** Refresh this long before the access token runs out, so a call never carries a dying one. */
export const REFRESH_EARLY_MS = 60_000;

/** Cognito's access tokens last an hour; used when an answer leaves `expires_in` out. */
const DEFAULT_LIFETIME_S = 3600;

function lifetimeMs(value: unknown): number {
  const seconds = Number(value);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_LIFETIME_S) * 1000;
}

const SESSION = 'session';
/** Set while a sign-in waits on managed login: a worker Chrome restarted finds it, and says so. */
const PENDING = 'signInPending';
const LAST_EMAIL = 'lastEmail';
/**
 * #111: set by Sign out here, cleared by the next sign-in the person starts. Until then the
 * extension never signs in silently: managed login still remembers them, and signing out must stick.
 */
const SIGNED_OUT_HERE = 'signedOutHere';

/** A sign-in or refresh that couldn't reach managed login, or that it refused. */
export class AuthError extends Error {
  constructor(readonly kind: 'offline' | 'failed') {
    super(kind);
  }
}

function isSession(value: unknown): value is Session {
  const s = value as Session | undefined;
  return (
    typeof s?.accessToken === 'string' &&
    typeof s.refreshToken === 'string' &&
    typeof s.expiresAt === 'number'
  );
}

/** The ID token's email, for display only (the API checks the access token itself). */
export function emailFromIdToken(idToken: unknown): string | undefined {
  if (typeof idToken !== 'string') return undefined;
  try {
    const payload = idToken.split('.')[1] ?? '';
    const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const json = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    const email = (JSON.parse(json) as { email?: unknown }).email;
    return typeof email === 'string' ? email : undefined;
  } catch {
    return undefined;
  }
}

/** Chrome rejects `launchWebAuthFlow` with a message only: closed by the person, or no page. */
function launchFailure(error: unknown): SignInOutcome {
  const message = error instanceof Error ? error.message : String(error);
  if (/did not approve|cancel/i.test(message)) return 'cancelled';
  if (/could not be loaded/i.test(message)) return 'offline';
  return 'failed';
}

export function createAuth(deps: AuthDeps) {
  const { settings, storage } = deps;
  /** The refresh at work, for the refresh token it uses (a newer session never joins it). */
  let refreshing: { refreshToken: string; done: Promise<string | null> } | null = null;
  let signingIn: Promise<SignInOutcome> | null = null;
  let signingInDifferent = false;
  /** The silent sign-in at work (#111): one at a time, shared. */
  let silently: Promise<SilentOutcome> | null = null;

  async function session(): Promise<Session | null> {
    const value = await storage.get(SESSION);
    return isSession(value) ? value : null;
  }

  /** Managed login's token endpoint (it answers the extension's origin: no host permission). */
  async function token(body: Record<string, string>): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await deps.fetch(`${settings.authDomain}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: settings.clientId, ...body }),
      });
    } catch {
      throw new AuthError('offline');
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw Object.assign(new AuthError('failed'), { code: json.error });
    return json;
  }

  async function signInOnce(different: boolean, silent = false): Promise<SignInOutcome> {
    const verifier = randomToken();
    const state = randomToken();
    const params = new URLSearchParams({
      client_id: settings.clientId,
      response_type: 'code',
      scope: EXTENSION_SCOPES.join(' '),
      redirect_uri: deps.redirectUrl,
      state,
      code_challenge: await challengeFor(verifier),
      code_challenge_method: 'S256',
      // #111: without a window, managed login answers at once: a code when it knows the person
      // (they signed in on the site, say), else `login_required`.
      ...(silent ? { prompt: 'none' } : {}),
    });
    // A different account: /logout ends managed login's remembered sign-in, then shows sign-in
    // with these same parameters, PKCE included (checked on a real stack: a wrong verifier is
    // refused; the integration test checks the challenge reaches the sign-in page).
    const url = `${settings.authDomain}/${different ? 'logout' : 'oauth2/authorize'}?${params}`;
    let returned: string | undefined;
    try {
      returned = await deps.launch(url, !silent);
    } catch (error) {
      return launchFailure(error);
    }
    const back = new URL(returned ?? deps.redirectUrl);
    const code = back.searchParams.get('code');
    if (back.searchParams.get('state') !== state || !code) {
      return back.searchParams.get('error') === 'access_denied' ? 'cancelled' : 'failed';
    }
    try {
      const tokens = await token({
        grant_type: 'authorization_code',
        code,
        redirect_uri: deps.redirectUrl,
        code_verifier: verifier,
      });
      if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') {
        return 'failed';
      }
      const email = emailFromIdToken(tokens.id_token);
      await storage.set(SESSION, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: deps.now() + lifetimeMs(tokens.expires_in),
        ...(email ? { email } : {}),
      } satisfies Session);
      await storage.remove(LAST_EMAIL);
      if (!silent) await storage.remove(SIGNED_OUT_HERE);
      return 'signed-in';
    } catch (error) {
      return error instanceof AuthError ? error.kind : 'failed';
    }
  }

  async function refresh(current: Session): Promise<string | null> {
    let tokens: Record<string, unknown>;
    try {
      tokens = await token({ grant_type: 'refresh_token', refresh_token: current.refreshToken });
    } catch (error) {
      // Revoked, expired, or the account is gone: signed out. Anything else may pass.
      if ((error as { code?: unknown }).code !== 'invalid_grant') throw error;
      const now = await session();
      // Signed out, or in again, meanwhile: leave that be, and use the new session's token.
      if (now?.refreshToken !== current.refreshToken) return now?.accessToken ?? null;
      await forget(current);
      return null;
    }
    if (typeof tokens.access_token !== 'string') throw new AuthError('failed');
    const now = await session();
    // Signed out (or in again) meanwhile: don't bring the old session back.
    if (now?.refreshToken !== current.refreshToken) return now?.accessToken ?? null;
    const email = emailFromIdToken(tokens.id_token) ?? current.email;
    await storage.set(SESSION, {
      ...current,
      // Kept unless Cognito sends a new one (refresh-token rotation, if it is ever turned on).
      ...(typeof tokens.refresh_token === 'string' ? { refreshToken: tokens.refresh_token } : {}),
      accessToken: tokens.access_token,
      expiresAt: deps.now() + lifetimeMs(tokens.expires_in),
      ...(email ? { email } : {}),
    } satisfies Session);
    return tokens.access_token;
  }

  /** Forgets the tokens, remembering who it was (until the browser closes) to offer them back. */
  async function forget(current: Session): Promise<void> {
    await storage.remove(SESSION);
    if (current.email) await storage.set(LAST_EMAIL, current.email);
  }

  return {
    async status(): Promise<AuthStatus> {
      const current = await session();
      if (current)
        return { state: 'signed-in', ...(current.email ? { email: current.email } : {}) };
      const last = await storage.get(LAST_EMAIL);
      // A sign-in this worker doesn't know about: Chrome stopped the worker while it waited
      // (its one-time PKCE values went with it). Said once. The mark is read first: a sign-in
      // starting meanwhile sets `signingIn` before its mark, so it is never taken for lost.
      const pending = (await storage.get(PENDING)) === true;
      const interrupted = pending && signingIn === null;
      if (interrupted) await storage.remove(PENDING);
      return {
        state: 'signed-out',
        ...(typeof last === 'string' ? { lastEmail: last } : {}),
        ...(interrupted ? { interrupted: true } : {}),
      };
    },

    /**
     * One sign-in at a time: a second click while the window is open waits for the first. Asking
     * for the other kind (a different account) meanwhile waits for it, then starts its own.
     */
    signIn({ different = false }: { different?: boolean } = {}): Promise<SignInOutcome> {
      if (signingIn && signingInDifferent !== different) {
        return signingIn.then(() => this.signIn({ different }));
      }
      if (!signingIn) {
        signingInDifferent = different;
        signingIn = (async () => {
          // A silent sign-in at work finishes first (its window-less flow would race this one).
          await silently;
          await storage.set(PENDING, true);
          try {
            return await signInOnce(different);
          } finally {
            // Freed first: a failing storage call must never leave "Signing in…" for good.
            signingIn = null;
            await storage.remove(PENDING).catch(() => undefined);
          }
        })();
      }
      return signingIn;
    },

    /**
     * #111: signs in without a window when managed login already knows the person, so signing in
     * on the site signs the extension in too. Never after a Sign out here until the person signs in
     * again themselves, never while a sign-in they started is at work, one at a time.
     */
    async signInSilently(): Promise<SilentOutcome> {
      if (await session()) return 'signed-in';
      if (signingIn) return (await signingIn) === 'signed-in' ? 'signed-in' : 'none';
      if ((await storage.get(SIGNED_OUT_HERE)) === true) return 'none';
      silently ??= (async () => {
        try {
          const outcome = await signInOnce(false, true);
          return outcome === 'signed-in' ? 'signed-in' : outcome === 'offline' ? 'offline' : 'none';
        } finally {
          silently = null;
        }
      })();
      return silently;
    },

    /** The sign-in at work, joined without ever opening a window; null when none is. */
    waitForSignIn(): Promise<SignInOutcome> | null {
      return signingIn;
    },

    get signingIn(): boolean {
      return signingIn !== null;
    },

    /**
     * A usable access token, refreshed when it runs out within a minute (or when the API refused
     * it: `refused`, unless the session already holds a newer one); null when signed out. Calls at
     * once share one refresh. Throws `AuthError`
     * when managed login can't be reached.
     */
    async accessToken({ refused }: { refused?: string } = {}): Promise<string | null> {
      const current = await session();
      if (!current) return null;
      const stale = refused !== undefined && refused === current.accessToken;
      if (!stale && current.expiresAt - deps.now() > REFRESH_EARLY_MS) return current.accessToken;
      if (refreshing?.refreshToken !== current.refreshToken) {
        const run = {
          refreshToken: current.refreshToken,
          done: refresh(current).finally(() => {
            if (refreshing === run) refreshing = null;
          }),
        };
        refreshing = run;
      }
      return refreshing.done;
    },

    /**
     * Signs out here at once; revoking the refresh token is best effort. Silent sign-in waits for
     * the next sign-in the person starts (#111); the site's own sign-in is not touched.
     */
    async signOut(): Promise<void> {
      const current = await session();
      if (!current) return;
      await storage.set(SIGNED_OUT_HERE, true);
      await forget(current);
      await deps
        .fetch(`${settings.authDomain}/oauth2/revoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: settings.clientId, token: current.refreshToken }),
        })
        .catch(() => undefined);
    },

    /** The API refused even a fresh token (the account is gone): signed out. */
    async signedOutByApi(): Promise<void> {
      const current = await session();
      if (current) await forget(current);
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
