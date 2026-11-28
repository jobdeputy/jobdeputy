import type { ApiResult } from './api.ts';
import type { AuthStatus, SignInOutcome } from './auth/session.ts';
import type { FillData } from './fill/data.ts';
import { greenhousePosting, type Posting } from './fill/posting.ts';
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

/**
 * #54 PR C: what a content script may ask, and only from a Greenhouse application form: the
 * answers to fill it with. The job is taken from the sender's own address (Chrome sets it, for
 * the frame that sent it), never from the message, so a page can't ask for another job's files.
 */
export type ContentRequest = { type: 'fill-data' };
export type FillDataResponse = ApiResult<FillData> | null;

export function isContentRequest(value: unknown): value is ContentRequest {
  return (value as { type?: unknown } | null)?.type === 'fill-data';
}

/**
 * The Greenhouse posting a content script runs on, or null: not ours, not a tab, not a form.
 * Both addresses come from Chrome, never from the message. In the top frame it's the tab's
 * address, which follows the board's in-page navigation (`sender.url` stays the one the page
 * loaded at); the host permission for the forms lets the worker see it. In a frame (a company
 * site's embed), it's the frame's own address.
 */
export function contentPosting(
  sender: {
    id?: string | undefined;
    url?: string | undefined;
    frameId?: number | undefined;
    tab?: { url?: string | undefined } | undefined;
  },
  extensionId: string,
): Posting | null {
  if (sender.id !== extensionId || !sender.tab) return null;
  // The top frame's own sender.url may be a job it navigated away from: without the tab's
  // address, nothing.
  return greenhousePosting(sender.frameId === 0 ? sender.tab.url : sender.url);
}
