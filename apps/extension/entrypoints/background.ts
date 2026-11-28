import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createApi } from '../src/api.ts';
import { createAuth } from '../src/auth/session.ts';
import { DEV_BUILD } from '../src/build.ts';
import { copy } from '../src/copy.ts';
import { readFillData } from '../src/fill/data.ts';
import { createFiles } from '../src/fill/files.ts';
import {
  contentPosting,
  type FillDataResponse,
  fromOwnPage,
  isContentRequest,
  isRequest,
  type Request,
  type Responses,
} from '../src/messages.ts';
import { readReadiness } from '../src/readiness.ts';
import { readSettings } from '../src/settings.ts';

/**
 * #54 (decision 0020): the service worker owns sign-in and every token. The popup asks it through
 * messages (it can't sign in itself: Chrome closes it when managed login's window takes focus).
 */
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
        launch: (url) => browser.identity.launchWebAuthFlow({ url, interactive: true }),
        storage: {
          get: async (key) => (await browser.storage.session.get(key))[key],
          set: (key, value) => browser.storage.session.set({ [key]: value }),
          remove: (key) => browser.storage.session.remove(key),
        },
        fetch: (...args) => fetch(...args),
        now: () => Date.now(),
      })
    : null;
  const api = settings && auth ? createApi({ settings, auth, fetch: (...a) => fetch(...a) }) : null;
  const files = settings ? createFiles({ settings, fetch: (...a) => fetch(...a) }) : null;

  async function answer(request: Request): Promise<Responses[Request['type']]> {
    if (!auth || !api) return request.type === 'status' ? { state: 'unconfigured' } : null;
    switch (request.type) {
      case 'status':
        return { ...(await auth.status()), signingIn: auth.signingIn };
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
    // #54 PR C: a Greenhouse form asks for its answers; nothing else is answered for a page.
    const posting = contentPosting(sender, browser.runtime.id);
    if (!posting || !isContentRequest(message)) return false;
    const reply = (value: FillDataResponse) => sendResponse(value);
    if (!api || !files) reply(null);
    else readFillData(api, files, posting).then(reply, () => reply(null));
    return true;
  });
});
