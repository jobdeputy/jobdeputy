import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createApi } from '../src/api.ts';
import { createAuth } from '../src/auth/session.ts';
import { DEV_BUILD } from '../src/build.ts';
import { copy } from '../src/copy.ts';
import { readFillDataSigningIn } from '../src/fill/data.ts';
import { createFiles } from '../src/fill/files.ts';
import { AUTO_APPLY_KEY, createHandoff, type Opened } from '../src/handoff.ts';
import {
  type AutoApplyResponse,
  confirmationPosting,
  contentPosting,
  type ExternalRequest,
  type FillDataResponse,
  fromOwnPage,
  fromSite,
  type HelloResponse,
  isConfirmationRequest,
  isContentRequest,
  isExternalRequest,
  isRequest,
  type Request,
  type Responses,
} from '../src/messages.ts';
import { readReadiness } from '../src/readiness.ts';
import { readApplication, recordApplication } from '../src/record.ts';
import { readSettings } from '../src/settings.ts';
import { siteOrigins } from '../src/site.ts';

/**
 * #54 (decision 0020): the service worker owns sign-in and every token. The popup asks it through
 * messages (it can't sign in itself: Chrome closes it when managed login's window takes focus).
 */
/** How long the popup's status waits for a sign-in without a window (#111). */
const SILENT_WAIT_MS = 3000;
/** How long Chrome gives a sign-in without a window at most (#111). */
const SILENT_LIMIT_MS = 5000;

export default defineBackground(() => {
  // A dev build says so on its toolbar button too (src/build.ts): set when the worker starts,
  // and again when Chrome starts or the extension is (re)installed, as Chrome forgets it.
  const badge = () => {
    if (DEV_BUILD) void browser.action.setBadgeText({ text: copy.popup.devBadge });
  };
  badge();
  browser.runtime.onStartup.addListener(badge);
  browser.runtime.onInstalled.addListener(badge);
  const settings = readSettings(import.meta.env);
  const auth = settings
    ? createAuth({
        settings,
        redirectUrl: browser.identity.getRedirectURL(),
        // `interactive` false for the silent sign-in (#111): no window; Chrome gives up when the
        // page would need the person. True for the sign-in the person starts.
        launch: (url, interactive) =>
          browser.identity.launchWebAuthFlow({
            url,
            interactive,
            // Never held up for long: a sign-in the person starts waits for this one.
            ...(interactive ? {} : { timeoutMsForNonInteractive: SILENT_LIMIT_MS }),
          }),
        storage: {
          get: async (key) => (await browser.storage.session.get(key))[key],
          set: (key, value) => browser.storage.session.set({ [key]: value }),
          remove: (key) => browser.storage.session.remove(key),
        },
        // One flag that must outlast the browser (#111), never a token.
        marks: {
          get: async (key) => (await browser.storage.local.get(key))[key],
          set: (key, value) => browser.storage.local.set({ [key]: value }),
          remove: (key) => browser.storage.local.remove(key),
        },
        fetch: (...args) => fetch(...args),
        now: () => Date.now(),
      })
    : null;
  const api = settings && auth ? createApi({ settings, auth, fetch: (...a) => fetch(...a) }) : null;
  const files = settings ? createFiles({ settings, fetch: (...a) => fetch(...a) }) : null;

  /** #111: signed out here, but maybe signed in on the site: tries without a window first. */
  async function currentStatus(signIn: NonNullable<typeof auth>) {
    const status = await signIn.status();
    if (status.state === 'signed-out' && !status.interrupted && !signIn.signingIn) {
      // At most a short wait (the popup shows nothing until it hears): past it, or whatever
      // goes wrong, the signed-out status, and the sign-in carries on; the next ask finds it.
      const silent = await Promise.race([
        signIn.signInSilently().catch(() => 'none' as const),
        new Promise<'later'>((resolve) => setTimeout(() => resolve('later'), SILENT_WAIT_MS)),
      ]);
      if (silent === 'signed-in') return signIn.status();
    }
    return status;
  }

  // #54 PR D: Auto apply's tabs, kept where only the extension's own contexts can read them.
  const handoff = auth
    ? createHandoff({
        openTab: async (url) => (await browser.tabs.create({ url })).id,
        read: async () =>
          ((await browser.storage.session.get(AUTO_APPLY_KEY))[AUTO_APPLY_KEY] as Opened) ?? {},
        write: (opened) => browser.storage.session.set({ [AUTO_APPLY_KEY]: opened }),
        // The person asked for this: wait for a sign-in without a window to end (Chrome gives
        // it SILENT_LIMIT_MS at most), rather than the popup's shorter wait.
        signedIn: async () => {
          const status = await auth.status();
          if (status.state === 'signed-in') return true;
          if (status.interrupted || auth.signingIn) return false;
          return (await auth.signInSilently().catch(() => 'none')) === 'signed-in';
        },
        now: () => Date.now(),
      })
    : null;
  browser.tabs.onRemoved.addListener((tabId) => void handoff?.closed(tabId));
  browser.tabs.onReplaced.addListener((added, removed) => void handoff?.replaced(added, removed));
  /** The web app's origins (the manifest's `externally_connectable`, from the same settings). */
  const origins = siteOrigins(settings, { store: !DEV_BUILD });

  async function answer(request: Request): Promise<Responses[Request['type']]> {
    if (!auth || !api) return request.type === 'status' ? { state: 'unconfigured' } : null;
    switch (request.type) {
      case 'status':
        return { ...(await currentStatus(auth)), signingIn: auth.signingIn };
      case 'sign-in':
        return auth.signIn({ different: request.different === true });
      case 'sign-in-wait':
        return (await auth.waitForSignIn()) ?? null;
      case 'sign-out':
        await auth.signOut();
        return null;
      case 'readiness':
        return readReadiness(api);
    }
  }

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (fromOwnPage(sender, browser.runtime.id)) {
      if (!isRequest(message)) return false;
      answer(message).then(sendResponse, () => sendResponse(null));
      return true;
    }
    if (!isContentRequest(message)) return false;
    // #54 PR D: a confirmation page asks about the application it confirms.
    if (isConfirmationRequest(message)) {
      const confirmed = confirmationPosting(sender, browser.runtime.id);
      if (!confirmed) return false;
      if (!api) sendResponse({ state: 'unconfigured' });
      else
        (message.type === 'application' ? readApplication : recordApplication)(api, confirmed).then(
          sendResponse,
          () => sendResponse(null),
        );
      return true;
    }
    // #54 PR C: a Greenhouse form asks for its answers; nothing else is answered for a page.
    const posting = contentPosting(sender, browser.runtime.id);
    if (!posting) return false;
    if (message.type === 'auto-fill') {
      // #54 PR D: only the tab Auto apply opened, for this job, and once.
      const tabId = sender.tab?.id;
      if (!handoff || tabId === undefined || sender.frameId !== 0) sendResponse(false);
      else handoff.autoFill(tabId, posting).then(sendResponse, () => sendResponse(false));
      return true;
    }
    const reply = (value: FillDataResponse) => sendResponse(value);
    if (!api || !files || !auth) reply(null);
    else
      readFillDataSigningIn(api, files, posting, () => auth.signInSilently()).then(reply, () =>
        reply(null),
      );
    return true;
  });

  // #54 PR D (decision 0020): the web app, from its own origins only (the manifest's
  // `externally_connectable`, checked again here). Nothing it sends is trusted: the worker checks
  // the form is the job's own and opens the tab itself.
  async function answerSite(request: ExternalRequest): Promise<HelloResponse | AutoApplyResponse> {
    if (request.type === 'hello') {
      // Only what is known now: a site asking on each page never starts a sign-in. Auto apply
      // tries a sign-in without a window first.
      const signedIn = auth ? (await auth.status()).state === 'signed-in' : false;
      return { version: browser.runtime.getManifest().version, signedIn };
    }
    // A build without sign-in settings: nothing to sign in to, so not "signed out".
    if (!handoff) return { ok: false, reason: 'failed' };
    return handoff.autoApply(request.jobId, request.url);
  }
  browser.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (!fromSite(sender, origins) || !isExternalRequest(message)) return false;
    // A failure is said as one: null would read as "no answer", as if a tab might have opened.
    const failed = message.type === 'auto-apply' ? { ok: false, reason: 'failed' } : null;
    answerSite(message).then(sendResponse, () => sendResponse(failed));
    return true;
  });
});
