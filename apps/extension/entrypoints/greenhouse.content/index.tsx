import { createRoot, type Root } from 'react-dom/client';
import { browser } from 'wxt/browser';
import {
  createShadowRootUi,
  type ShadowRootContentScriptUi,
} from 'wxt/utils/content-script-ui/shadow-root';
import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  GREENHOUSE_MATCHES,
  greenhouseConfirmation,
  greenhousePosting,
} from '../../src/fill/posting.ts';
import { ConfirmPanel } from '../../src/greenhouse/confirm.tsx';
import { watchProgress } from '../../src/greenhouse/fill.ts';
import { Panel } from '../../src/greenhouse/panel.tsx';
import { runFill } from '../../src/greenhouse/run.ts';
import type { ContentRequest } from '../../src/messages.ts';
import type { Application } from '../../src/record.ts';
// Built into the script and set in the shadow root: no file the page could load (no
// web_accessible_resources, which the manifest check refuses).
import css from './style.css?inline';

/** How long a form may take to appear after the page loads. */
const FORM_WAIT_MS = 10_000;
/** How long an announced navigation may take to change the address before it's ignored. */
const NAVIGATION_WAIT_MS = 5_000;

const findForm = () => document.querySelector<HTMLFormElement>('form#application-form');

/**
 * The application form, once the page shows it (null if it never does: not an application).
 * After a move from one job to another, not the previous job's form, which the board may not
 * have replaced yet.
 */
function waitForForm(previous: HTMLFormElement | null = null): Promise<HTMLFormElement | null> {
  const find = () => {
    const form = findForm();
    return form && form !== previous ? form : null;
  };
  const now = find();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const form = find();
      if (form) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(form);
      }
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, FORM_WAIT_MS);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

/**
 * #54 PR C (decision 0020): on a Greenhouse application form, including one a company site
 * embeds in a frame, the panel that fills it. The page script never sees a token: it asks the
 * service worker for the answers, which takes the job from this frame's address. Greenhouse's
 * board moves between pages without loading them, so the panel follows each address: it goes
 * away on a page that isn't an application and comes back with the next form.
 */
export default defineContentScript({
  matches: [...GREENHOUSE_MATCHES],
  allFrames: true,
  runAt: 'document_idle',
  cssInjectionMode: 'manual',
  async main(ctx) {
    const embedded = window.top !== window;
    let ui: ShadowRootContentScriptUi<Root> | null = null;
    /** Counts each address shown, so a slower earlier one never mounts over a later one. */
    let shown = 0;
    const goTo = (id: string) => {
      const field =
        document.getElementById(id) ?? document.getElementsByName(id.replace(/^name:/, ''))[0];
      field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      field?.focus({ preventScroll: true });
    };

    /** The posting the panel is on (`companyKey/postingId`), or null, and its form. */
    let on: string | null = null;
    let onForm: HTMLFormElement | null = null;

    const ask = async (request: ContentRequest) => {
      try {
        return await browser.runtime.sendMessage(request);
      } catch {
        return null;
      }
    };
    const readApplication = () => ask({ type: 'application' }) as Promise<Application | null>;
    const recordApplication = () =>
      ask({ type: 'record-application' }) as Promise<Application | null>;
    const autoFill = async () => (await ask({ type: 'auto-fill' })) === true;

    /** #54 PR D: Greenhouse's confirmation page, in the board's own tab: "Mark as applied?". */
    async function showConfirmation(at: number) {
      const next = await createShadowRootUi<Root>(ctx, {
        name: 'jobdeputy-panel',
        css,
        mode: 'open',
        position: 'inline',
        anchor: 'body',
        append: 'last',
        onMount(container) {
          const root = createRoot(container);
          root.render(<ConfirmPanel read={readApplication} record={recordApplication} />);
          return root;
        },
        onRemove(root) {
          root?.unmount();
        },
      });
      if (at !== shown || ctx.isInvalid) return;
      ui = next;
      ui.mount();
    }

    /** `address`: the page's new one (it can arrive before `location` shows it). */
    async function show(address: string) {
      const confirmed = embedded ? null : greenhouseConfirmation(address);
      if (confirmed) {
        const key = `confirm:${confirmed.companyKey}/${confirmed.postingId}`;
        if (key === on && ui) return;
        const at = ++shown;
        on = key;
        onForm = null;
        ui?.remove();
        ui = null;
        await showConfirmation(at);
        return;
      }
      const posting = greenhousePosting(address);
      const key = posting ? `${posting.companyKey}/${posting.postingId}` : null;
      // The same job (only its #hash or ?query changed): the panel, and what it says, stay.
      if (key !== null && key === on && ui) return;
      const at = ++shown;
      const previous = on !== null && key !== on ? onForm : null;
      on = key;
      onForm = null;
      ui?.remove();
      ui = null;
      if (!posting) return;
      const form = await waitForForm(previous);
      if (!form || ctx.isInvalid || at !== shown) return;
      const next = await createShadowRootUi<Root>(ctx, {
        name: 'jobdeputy-panel',
        css,
        mode: 'open',
        position: 'inline',
        anchor: embedded ? form : 'body',
        append: embedded ? 'before' : 'last',
        onMount(container, _shadow, host) {
          const root = createRoot(container);
          root.render(
            <Panel
              embedded={embedded}
              // Only the tab's own form: an embed's top frame is the company's page.
              {...(embedded ? {} : { autoFill })}
              goTo={goTo}
              watchProgress={(onChange) => watchProgress(() => findForm() ?? form, onChange)}
              // The form on the page now (the page may have drawn it again), and the outline in
              // the panel's own token colour.
              fillForm={() =>
                runFill(
                  findForm() ?? form,
                  (request) => browser.runtime.sendMessage(request),
                  getComputedStyle(host).getPropertyValue('--color-orange').trim(),
                )
              }
            />,
          );
          return root;
        },
        onRemove(root) {
          root?.unmount();
        },
      });
      if (at !== shown) return;
      onForm = form;
      ui = next;
      ui.mount();
    }

    // The board's navigation is announced before it happens, and some never do (a download
    // link, a stopped load): acted on only once the page's address is the new one.
    ctx.addEventListener(window, 'wxt:locationchange', (event) => {
      const target = event.newUrl.href;
      const until = Date.now() + NAVIGATION_WAIT_MS;
      const check = () => {
        if (ctx.isInvalid) return;
        if (location.href === target) void show(target);
        else if (Date.now() < until) requestAnimationFrame(check);
      };
      check();
    });
    await show(location.href);
  },
});
