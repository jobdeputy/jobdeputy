import { createRoot, type Root } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { GREENHOUSE_MATCHES, greenhousePosting } from '../../src/fill/posting.ts';
import { Panel } from '../../src/greenhouse/panel.tsx';
import { runFill } from '../../src/greenhouse/run.ts';
// Built into the script and set in the shadow root: no file the page could load (no
// web_accessible_resources, which the manifest check refuses).
import css from './style.css?inline';

/** How long a form may take to appear after the page loads. */
const FORM_WAIT_MS = 10_000;

/** The application form, once the page shows it (null if it never does: not an application). */
function waitForForm(): Promise<HTMLFormElement | null> {
  const find = () => document.querySelector<HTMLFormElement>('form#application-form');
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
 * service worker for the answers, which takes the job from this frame's address.
 */
export default defineContentScript({
  matches: [...GREENHOUSE_MATCHES],
  allFrames: true,
  runAt: 'document_idle',
  cssInjectionMode: 'manual',
  async main(ctx) {
    if (!greenhousePosting(location.href)) return;
    const form = await waitForForm();
    if (!form || ctx.isInvalid) return;
    const embedded = window.top !== window;
    const goTo = (id: string) => {
      const field = document.getElementById(id);
      field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      field?.focus({ preventScroll: true });
    };
    const ui = await createShadowRootUi<Root>(ctx, {
      name: 'jobdeputy-panel',
      css,
      mode: 'open',
      position: 'inline',
      anchor: embedded ? form : 'body',
      append: embedded ? 'before' : 'last',
      onMount(container) {
        const root = createRoot(container);
        root.render(
          <Panel
            embedded={embedded}
            goTo={goTo}
            fillForm={() => runFill(form, (request) => browser.runtime.sendMessage(request))}
          />,
        );
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
