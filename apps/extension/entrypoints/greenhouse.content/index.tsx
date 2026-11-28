import { createRoot, type Root } from 'react-dom/client';
import { browser } from 'wxt/browser';
import {
  createShadowRootUi,
  type ShadowRootContentScriptUi,
} from 'wxt/utils/content-script-ui/shadow-root';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { GREENHOUSE_MATCHES, greenhousePosting } from '../../src/fill/posting.ts';
import { Panel } from '../../src/greenhouse/panel.tsx';
import { runFill } from '../../src/greenhouse/run.ts';
// Built into the script and set in the shadow root: no file the page could load (no
// web_accessible_resources, which the manifest check refuses).
import css from './style.css?inline';

/** How long a form may take to appear after the page loads. */
const FORM_WAIT_MS = 10_000;

const findForm = () => document.querySelector<HTMLFormElement>('form#application-form');

/** The application form, once the page shows it (null if it never does: not an application). */
function waitForForm(): Promise<HTMLFormElement | null> {
  const now = findForm();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const form = findForm();
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

    /** `address`: the page's new one (it can arrive before `location` shows it). */
    async function show(address: string) {
      const at = ++shown;
      ui?.remove();
      ui = null;
      if (!greenhousePosting(address)) return;
      const form = await waitForForm();
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
              goTo={goTo}
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
      ui = next;
      ui.mount();
    }

    ctx.addEventListener(window, 'wxt:locationchange', (event) => void show(event.newUrl.href));
    await show(location.href);
  },
});
