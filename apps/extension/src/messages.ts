import type { ApiResult } from './api.ts';
import type { AuthStatus, SignInOutcome } from './auth/session.ts';
import type { Readiness } from './readiness.ts';

/**
 * #54 (decision 0020): what the extension's own pages ask its service worker, which alone holds
 * the tokens. Content scripts (PR C) get a separate, smaller set of their own.
 */
export type Request =
  | { type: 'status' }
  | { type: 'sign-in'; different?: boolean }
  /** Waits for the sign-in at work (null when none is); never opens a window. */
  | { type: 'sign-in-wait' }
  | { type: 'sign-out' }
  | { type: 'readiness' };

/** `unconfigured`: a build without sign-in settings (CI, or a dev build without .env.local). */
export type Status = (AuthStatus & { signingIn: boolean }) | { state: 'unconfigured' };

/** What each request is answered with. Any answer may also be null: the worker failed. */
export interface Responses {
  status: Status;
  'sign-in': SignInOutcome;
  'sign-in-wait': SignInOutcome | null;
  'sign-out': null;
  readiness: ApiResult<Readiness>;
}

/**
 * The sender is one of this extension's own pages (the popup, as a popup or opened in a tab), not
 * a content script or a site. Chrome sets `sender.url`: a content script's is the web page's.
 */
export function fromOwnPage(sender: { id?: string; url?: string }, extensionId: string): boolean {
  return (
    sender.id === extensionId &&
    typeof sender.url === 'string' &&
    sender.url.startsWith(`chrome-extension://${extensionId}/`)
  );
}

export function isRequest(value: unknown): value is Request {
  const type = (value as { type?: unknown } | null)?.type;
  return (
    type === 'status' ||
    type === 'sign-in' ||
    type === 'sign-in-wait' ||
    type === 'sign-out' ||
    type === 'readiness'
  );
}
