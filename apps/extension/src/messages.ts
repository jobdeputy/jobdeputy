import type { AutoApplyAnswer, ExtensionHello } from '@jobdeputy/shared/extension';
import type { ApiResult } from './api.ts';
import type { AuthStatus, SignInOutcome } from './auth/session.ts';
import type { FillData } from './fill/data.ts';
import { greenhouseConfirmation, greenhousePosting, type Posting } from './fill/posting.ts';
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
export type ContentRequest =
  | { type: 'fill-data' }
  /** #54 PR D: was this tab opened by Auto apply for this job? Asked once; the answer is used up. */
  | { type: 'auto-fill' }
  /** #54 PR D, on a confirmation page: is there an application to record? */
  | { type: 'application' }
  /** #54 PR D, on a confirmation page: record it (`new` → `applied`). */
  | { type: 'record-application' };
export type FillDataResponse = ApiResult<FillData> | null;

const CONTENT_TYPES = new Set(['fill-data', 'auto-fill', 'application', 'record-application']);

export function isContentRequest(value: unknown): value is ContentRequest {
  const type = (value as { type?: unknown } | null)?.type;
  return typeof type === 'string' && CONTENT_TYPES.has(type);
}

/** The requests a confirmation page makes; every other one comes from an application form. */
export const isConfirmationRequest = (request: ContentRequest) =>
  request.type === 'application' || request.type === 'record-application';

/**
 * #54 PR D (decision 0020): what the web app may ask, from the origins in the manifest's
 * `externally_connectable` only: `hello` (installed? signed in?) and `auto-apply`, which opens the
 * job's Greenhouse form in a new tab and fills it there.
 */
export type ExternalRequest =
  | { type: 'hello' }
  | { type: 'auto-apply'; jobId: string; url: string };

/** Shared with the web app (`@jobdeputy/shared/extension`): one shape on both sides. */
export type HelloResponse = ExtensionHello;
export type AutoApplyResponse = AutoApplyAnswer;

const JOB_ID = /^[0-9a-f]{32}$/;

export function isExternalRequest(value: unknown): value is ExternalRequest {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  if (message.type === 'hello') return Object.keys(message).length === 1;
  return (
    message.type === 'auto-apply' &&
    Object.keys(message).length === 3 &&
    typeof message.jobId === 'string' &&
    JOB_ID.test(message.jobId) &&
    typeof message.url === 'string' &&
    message.url.length <= 2048
  );
}

/**
 * The web app's page, from the origin Chrome sets for the sender (never from the message), in a
 * tab's top frame. Chrome already refuses origins outside `externally_connectable`; this checks
 * again, so a wider manifest by mistake still lets no other site in.
 */
export function fromSite(
  sender: { origin?: string | undefined; frameId?: number | undefined; tab?: unknown },
  origins: readonly string[],
): boolean {
  return (
    typeof sender.origin === 'string' &&
    origins.includes(sender.origin) &&
    sender.frameId === 0 &&
    Boolean(sender.tab)
  );
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

/**
 * #54 PR D: the posting a Greenhouse confirmation page confirms, or null. The tab's own address
 * in its top frame only (Chrome sets it; the forms' host permission lets the worker see it).
 */
export function confirmationPosting(
  sender: {
    id?: string | undefined;
    frameId?: number | undefined;
    tab?: { url?: string | undefined } | undefined;
  },
  extensionId: string,
): Posting | null {
  if (sender.id !== extensionId || !sender.tab || sender.frameId !== 0) return null;
  return greenhouseConfirmation(sender.tab.url);
}
