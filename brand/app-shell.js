// JobDeputy app shell, a classic script loaded first on every internal page (before
// app-components.js, sample-store.js, deputy.js, feedback.js, app-panels.js, and the page's inline
// script). app-chrome.css lays out everything named here.
//
// - The phone Menu (720px and narrower). The sidebar's list becomes a disclosure that opens as an
//   overlay under the app bar, over a scrim, so it never moves the page. Escape, a click outside
//   it (the scrim included), focus leaving the app bar, following a link, crossing the
//   breakpoint, and a return from the back-forward cache close it; Escape, and any close while
//   focus was in the list, return focus to the Menu button. Opening it closes the deputy's
//   Activity. While the sidebar is the phone bar it carries data-sticky-top, so the tooltip and
//   the tour keep clear of it. Without this script the Menu button stays hidden, the bar stays in
//   the page, and the list stays visible.
// - The account menu. Escape closes it and returns focus to its chip; a click outside it or focus
//   leaving it closes it. (Its rows that open something close it themselves: Send feedback in
//   feedback.js, Show me around in the tour engine, prompts and top-ups in app-panels.js.) On
//   phones it is a sheet over a scrim drawn by the chip itself, so a tap on the scrim closes it
//   natively, and the page behind is inert while it is open, so Tab stays in the sheet. Its credits line ([data-account-credits]) follows JobDeputyStore.credits() (round 5:
//   AI credits, shown as tokens on the account's model) when the store has it; otherwise the
//   markup's seed text stays.
// - The pause banner (round 5): while the updated agreement is overdue, a one-line warning with
//   Review and sign at the top of the page (JobDeputyComponents.agreementBanner).
//
// It adds no global.
(() => {
  const isElement = (value) => typeof Element !== 'undefined' && value instanceof Element;

  // While the phone Menu or the account sheet is open, a scrim covers the page and blocks the
  // pointer, so the keyboard must agree: the page behind becomes inert, and Tab stays in the open
  // panel (round 5, UAT-A-5). A page that set inert itself (the Dashboard's loader) keeps it: we
  // mark only what we add, and remove only that.
  const blockers = new Set();
  const behindPanel = () =>
    [document.querySelector('main.app-main'), document.querySelector('#deputy-dock')].filter(
      (part) =>
        part &&
        typeof part.setAttribute === 'function' &&
        typeof part.removeAttribute === 'function' &&
        typeof part.hasAttribute === 'function' &&
        part.dataset,
    );
  const blockPage = (key, block) => {
    if (block) blockers.add(key);
    else blockers.delete(key);
    const hold = blockers.size > 0;
    for (const part of behindPanel()) {
      if (hold && !part.hasAttribute('inert')) {
        part.setAttribute('inert', '');
        part.dataset.panelInert = '';
      } else if (!hold && part.dataset.panelInert !== undefined) {
        part.removeAttribute('inert');
        delete part.dataset.panelInert;
      }
    }
  };

  // ---------------------------------------------------------------- phone Menu

  const sidebar = document.querySelector('.app-sidebar');
  const toggle = sidebar?.querySelector('.app-menu-toggle');
  const list = toggle ? document.getElementById(toggle.getAttribute('aria-controls') || '') : null;

  if (sidebar && toggle && list) {
    const phone = window.matchMedia('(max-width: 720px)');
    const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';

    // The scrim behind the open overlay; app-chrome.css shows it only while the phone Menu is
    // open. A click on it is a click outside the Menu.
    const scrim = document.createElement('div');
    scrim.className = 'app-menu-scrim';
    scrim.setAttribute('aria-hidden', 'true');
    sidebar.append(scrim);

    // The state lives on the sidebar; app-chrome.css hides the list only when it is "closed" on
    // phones. Focus that was in the list (now hidden) goes back to the Menu button.
    const setOpen = (open, { focus = false } = {}) => {
      const focusWasInList = list.contains(document.activeElement);
      sidebar.dataset.menu = open ? 'open' : 'closed';
      toggle.setAttribute('aria-expanded', String(open));
      blockPage('menu', open && phone.matches);
      if (open) {
        for (const panel of sidebar.querySelectorAll('details[open]')) panel.open = false;
      } else if (focus || focusWasInList) {
        toggle.focus();
      }
    };

    // Only the phone bar is top chrome; the wider sidebar runs down the side.
    const markBar = () => {
      if (phone.matches) sidebar.setAttribute('data-sticky-top', '');
      else sidebar.removeAttribute('data-sticky-top');
      blockPage('menu', isOpen() && phone.matches);
    };

    setOpen(false);
    markBar();
    toggle.hidden = false;

    toggle.addEventListener('click', () => setOpen(!isOpen()));

    // Escape closes the open menu while focus is on its button, inside it, or nowhere, and
    // returns focus to the button. Escape from another control (the deputy's Activity) is that
    // control's own.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !phone.matches || !isOpen()) return;
      const active = document.activeElement;
      const nowhere = !active || active === document.body;
      if (!nowhere && active !== toggle && !list.contains(active)) return;
      setOpen(false, { focus: true });
    });

    // Choosing a destination closes the menu, including a link to a place on the same page.
    list.addEventListener('click', (event) => {
      if (phone.matches && isElement(event.target) && event.target.closest('a[href]')) {
        setOpen(false);
      }
    });

    // A click anywhere else (the scrim, the deputy chip, the header) closes it.
    document.addEventListener('click', (event) => {
      if (!phone.matches || !isOpen() || !isElement(event.target)) return;
      if (toggle.contains(event.target) || list.contains(event.target)) return;
      setOpen(false);
    });

    // So does focus moving out of the app bar, so focus never lands under the overlay.
    sidebar.addEventListener('focusout', (event) => {
      if (!phone.matches || !isOpen()) return;
      if (isElement(event.relatedTarget) && !sidebar.contains(event.relatedTarget)) setOpen(false);
    });

    // Crossing the breakpoint, or coming back from the back-forward cache, starts collapsed.
    phone.addEventListener('change', () => {
      setOpen(false);
      markBar();
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) setOpen(false);
    });
  }

  // ---------------------------------------------------------------- account menu

  const sheet = window.matchMedia('(max-width: 720px)');
  for (const [index, menu] of [...document.querySelectorAll('details.account-menu')].entries()) {
    const chip = menu.querySelector('summary');
    const key = `account-${index}`;
    // On phones the chip draws a scrim over the page, so the page behind is inert while it is open.
    const follow = () => blockPage(key, menu.open && sheet.matches);
    const close = ({ focus = false } = {}) => {
      const focusWasInMenu = menu.contains(document.activeElement);
      menu.open = false;
      follow();
      if (chip && (focus || focusWasInMenu)) chip.focus();
    };
    menu.addEventListener('toggle', follow);
    sheet.addEventListener('change', follow);
    follow();

    menu.addEventListener('focusout', (event) => {
      if (menu.open && isElement(event.relatedTarget) && !menu.contains(event.relatedTarget)) {
        close();
      }
    });

    document.addEventListener('click', (event) => {
      if (menu.open && isElement(event.target) && !menu.contains(event.target)) {
        menu.open = false;
        follow();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menu.open) close({ focus: true });
    });
  }

  // The account menu's credits line, from the store's AI credits, kept in step with changes.
  const lines = [...document.querySelectorAll('[data-account-credits]')];
  const syncAllowance = () => {
    const store = window.JobDeputyStore;
    const credits = typeof store?.credits === 'function' ? store.credits() : null;
    if (!credits || !Number.isFinite(credits.left)) return;
    const tokens =
      typeof store.format?.tokens === 'function'
        ? store.format.tokens(credits.left)
        : Number(credits.left).toLocaleString('en-US');
    const text = `${tokens} tokens of AI credits left`;
    for (const line of lines) {
      if (line.textContent !== text) line.textContent = text;
    }
  };
  // The pause banner (round 5, G1): while the updated agreement is overdue, one line at the top of
  // the page says your deputy is paused, with Review and sign (JobDeputyComponents.agreementBanner
  // follows the store). Signing, reading, export, delete, and Help keep working. The public Help
  // is signed out, so it never shows account state.
  const mountBanner = () => {
    if (document.documentElement?.dataset?.helpView === 'public') return;
    const banner = window.JobDeputyComponents?.agreementBanner;
    const host = document.querySelector('main .page-shell') ?? document.querySelector('main');
    if (typeof banner === 'function' && host) banner(host);
  };
  const followStore = () => {
    mountBanner();
    if (!lines.length) return;
    syncAllowance();
    window.JobDeputyStore?.subscribe?.(syncAllowance);
  };
  // The store loads after this script, so the first read waits for the page's scripts to run.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', followStore, { once: true });
  } else {
    followStore();
  }
})();
