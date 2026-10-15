// JobDeputy shared component behaviour, loaded before each page's inline script:
// - the ARIA tabs pattern for [role="tablist"][data-tabs];
// - drawers: [data-drawer-open="<dialog id>"] opens a <dialog class="drawer"> with showModal(),
//   [data-drawer-close] closes it, Escape closes it natively, a backdrop click closes it, focus
//   returns to the opener, and keyboard focus inside stays clear of the sticky header and footer;
// - the flow ribbon: [data-flow-count] text from JobDeputyStore.flowCounts(), kept in step with
//   every store change; without the store (or the function) the markup's seed text stays;
// - charts: span.sparkline[data-values] lines and .donut segments (drawn from the legend) in
//   aria-hidden SVGs; a legend or key item and its part of the chart light up together; and the
//   one-time grow is settled (data-component-motion on the root: "paused" at once while Pause motion
//   is on, "settled" after the first render, so charts a page draws later appear still);
// - thumbs (fieldset.thumbs): a bubbling jobdeputy:thumbs event, and the context its Tell us more
//   button passes to Feedback;
// - quick picks: matchQuickPick(fieldset, address) selects the pick that matches an address;
// - round 3: the shared tooltip for [data-tip] triggers, allowance meters (allowance.set), the
//   new-row highlight of live tables (flagNew), list toolbars (search, filter chips, sort, and the
//   result count), paper pages (Markdown laid into US letter pages, and printing only those pages),
//   the document preview dialog, and the tour engine ([data-tour-step] targets, [data-tour-open]
//   buttons, ?tour=1, tour.start and tour.maybeStart);
// - round 4: the ring meter (the allowance meter as a ring, drawn from the same parts that
//   allowance.set fills), the donut tile (a donut drawn from a split tile's chart key, with a linked
//   centre), the run tracker (runTracker: one search run counting up, its stages as steps), the
//   shared status channel (announce), and the document preview's Pages and Text switch.
// Motion the script runs itself stops under reduced motion and while Pause motion is on
// (html[data-motion="paused"], or the deputy's saved choice). Pages announce their own events;
// the list toolbar, the preview, and the tour speak through their own visually hidden channels.
// The only global is window.JobDeputyComponents; the only storage read is Pause motion's choice.
(() => {
  const TABLIST = '[role="tablist"][data-tabs]';
  const readyTablists = new WeakSet();
  const openers = new WeakMap();

  // ---------------------------------------------------------------- tabs

  const tabsOf = (tablist) =>
    [...tablist.querySelectorAll('[role="tab"]')].filter(
      (tab) => tab.closest('[role="tablist"]') === tablist,
    );

  const panelFor = (tab) => {
    const id = tab.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  };

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

  // A panel is a tab stop only while nothing inside it can take focus (the ARIA tabs pattern), so
  // panels with controls add no extra stop. A tabindex the page set itself is left alone.
  function syncPanelStop(panel) {
    if (!panel) return;
    if (panel.hasAttribute('tabindex') && !panel.hasAttribute('data-tab-stop')) return;
    if (panel.querySelector(FOCUSABLE)) {
      panel.removeAttribute('tabindex');
      panel.removeAttribute('data-tab-stop');
    } else {
      panel.tabIndex = 0;
      panel.setAttribute('data-tab-stop', '');
    }
  }

  // Selects one tab: aria-selected, a roving tabindex, and only its panel shown. Pages hear about
  // the change through a bubbling jobdeputy:tabchange event on the tablist.
  function selectTab(tab, { focus = false, silent = false } = {}) {
    const tablist = tab?.closest(TABLIST);
    if (!tablist) return;
    const tabs = tabsOf(tablist);
    const previous = tabs.find((item) => item.getAttribute('aria-selected') === 'true');
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      const panel = panelFor(item);
      if (panel) panel.hidden = !selected;
      if (selected) syncPanelStop(panel);
    }
    if (focus) tab.focus();
    if (!silent && previous !== tab) {
      tablist.dispatchEvent(
        new CustomEvent('jobdeputy:tabchange', {
          bubbles: true,
          detail: { tab, panel: panelFor(tab) },
        }),
      );
    }
  }

  // Arrow keys follow the reading direction; vertical tablists use Up and Down.
  function keyTarget(tablist, tabs, index, key) {
    const vertical = tablist.getAttribute('aria-orientation') === 'vertical';
    const rtl = getComputedStyle(tablist).direction === 'rtl';
    const forward = vertical ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = vertical ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
    if (key === forward) return tabs[(index + 1) % tabs.length];
    if (key === backward) return tabs[(index - 1 + tabs.length) % tabs.length];
    if (key === 'Home') return tabs[0];
    if (key === 'End') return tabs[tabs.length - 1];
    return null;
  }

  function initTablist(tablist) {
    if (readyTablists.has(tablist)) return;
    const tabs = tabsOf(tablist);
    if (!tabs.length) return;
    readyTablists.add(tablist);
    for (const tab of tabs) syncPanelStop(panelFor(tab));
    const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') || tabs[0];
    selectTab(selected, { silent: true });

    tablist.addEventListener('click', (event) => {
      const tab = event.target.closest('[role="tab"]');
      if (tab && tabsOf(tablist).includes(tab)) selectTab(tab);
    });

    // Automatic activation: moving focus selects the tab.
    tablist.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const list = tabsOf(tablist);
      const index = list.indexOf(event.target.closest('[role="tab"]'));
      if (index < 0) return;
      const target = keyTarget(tablist, list, index, event.key);
      if (!target) return;
      event.preventDefault();
      selectTab(target, { focus: true });
    });
  }

  // ---------------------------------------------------------------- drawers

  const isDrawer = (element) =>
    element instanceof HTMLDialogElement && element.classList.contains('drawer');

  // Keyboard focus inside a drawer stays clear of its sticky header and footer (WCAG 2.4.11). The
  // drawer's scroll padding is each one's full height plus 13px of room, kept current as either
  // changes size, and a control that lands under either (its focus ring included) scrolls clear.
  // A pointer press on a button, a link, or a box is left where it is, so one partly under the
  // footer does not move away before the release (which would lose the click); a field you type
  // into always scrolls clear, as its focus is the point of the press. app-panels.js pads its own
  // drawers the same way (JobDeputyPanels.keepFocusClear), so a drawer that gets both is unchanged.
  const DRAWER_ROOM = 13;
  const FOCUS_RING = 5; // the 2px focus outline and its 3px offset
  const PRESSED_INPUTS = new Set([
    'button',
    'checkbox',
    'color',
    'file',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
  ]);
  const clearDrawers = new WeakSet();

  // The drawer's header or footer while it takes up room (not hidden, not display none) and sticks (on a short screen the header
  // scrolls with the content while you type, T5-5, so it covers nothing then).
  function drawerPart(dialog, name) {
    const part = dialog.querySelector(`.drawer-${name}`);
    if (!part || !(part.offsetHeight > 0)) return null;
    try {
      return getComputedStyle(part).position === 'static' ? null : part;
    } catch {
      return part;
    }
  }

  function padDrawer(dialog) {
    const room = (part) => `${(part?.offsetHeight ?? 0) + DRAWER_ROOM}px`;
    dialog.style.scrollPaddingTop = room(drawerPart(dialog, 'header'));
    dialog.style.scrollPaddingBottom = room(drawerPart(dialog, 'footer'));
  }

  // A field you type into: a text, date, or number input, a textarea, a select, or editable text.
  // (A date or month input's own parts take focus inside it, so it may not match :focus-visible.)
  function typedInto(element) {
    const tag = String(element.tagName).toLowerCase();
    if (tag === 'textarea' || tag === 'select' || element.isContentEditable) return true;
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    return tag === 'input' && !PRESSED_INPUTS.has(type);
  }

  // :focus-visible tells keyboard focus from a pointer press; without it, both scroll clear.
  function keyboardFocus(element) {
    if (typedInto(element)) return true;
    try {
      return element.matches(':focus-visible');
    } catch {
      return true;
    }
  }

  function clearOfDrawerParts(dialog, target) {
    if (!(target instanceof HTMLElement) || target === dialog) return;
    if (typeof target.scrollIntoView !== 'function' || !keyboardFocus(target)) return;
    const header = drawerPart(dialog, 'header');
    const footer = drawerPart(dialog, 'footer');
    if (header?.contains(target) || footer?.contains(target)) return;
    const box = target.getBoundingClientRect();
    const frame = dialog.getBoundingClientRect();
    const top = header ? header.getBoundingClientRect().bottom : frame.top;
    const bottom = footer ? footer.getBoundingClientRect().top : frame.bottom;
    if (box.top - FOCUS_RING < top || box.bottom + FOCUS_RING > bottom) {
      target.scrollIntoView({ block: 'nearest' });
    }
  }

  // Once per drawer: the focus check and the observer that keeps the padding current.
  function keepFocusClear(dialog) {
    if (clearDrawers.has(dialog)) return;
    clearDrawers.add(dialog);
    // The padding follows the parts as focus moves (a header that stops sticking while you type).
    dialog.addEventListener('focusin', (event) => {
      padDrawer(dialog);
      clearOfDrawerParts(dialog, event.target);
    });
    dialog.addEventListener('focusout', () => window.setTimeout(() => padDrawer(dialog), 0));
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => padDrawer(dialog));
    observer.observe(dialog);
    for (const part of dialog.querySelectorAll('.drawer-header, .drawer-footer')) {
      observer.observe(part);
    }
  }

  function openDrawer(dialog, opener = document.activeElement) {
    if (!isDrawer(dialog)) return;
    keepFocusClear(dialog);
    if (dialog.open) return;
    openers.set(dialog, opener instanceof HTMLElement ? opener : null);
    dialog.showModal();
    padDrawer(dialog);
  }

  function closeDrawer(dialog) {
    if (isDrawer(dialog) && dialog.open) dialog.close();
  }

  document.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-drawer-open]');
    if (opener) {
      const dialog = document.getElementById(opener.getAttribute('data-drawer-open'));
      if (!isDrawer(dialog)) return;
      event.preventDefault();
      openDrawer(dialog, opener);
      return;
    }

    const closer = event.target.closest('[data-drawer-close]');
    if (closer) {
      const dialog = closer.closest('dialog');
      if (!isDrawer(dialog)) return;
      event.preventDefault();
      closeDrawer(dialog);
      return;
    }

    // A pointer click on the backdrop reaches the dialog itself, outside its box.
    const dialog = event.target;
    if (!isDrawer(dialog) || !dialog.open || event.detail === 0) return;
    const box = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) closeDrawer(dialog);
  });

  // The opener, or the control a page drew in its place while the drawer was open (R9-3, T5-4: a
  // purchase redraws the Dashboard's Get more runs): the same data-focus-key, else the same id,
  // outside the drawer.
  function openerAgain(dialog, opener) {
    if (!opener || opener.isConnected) return opener;
    const key = opener.getAttribute('data-focus-key');
    const outside = (element) => element && element !== dialog && !dialog.contains(element);
    if (key) {
      return (
        [...document.querySelectorAll('[data-focus-key]')].find(
          (element) => element.getAttribute('data-focus-key') === key && outside(element),
        ) ?? null
      );
    }
    const again = opener.id ? document.getElementById(opener.id) : null;
    return outside(again) ? again : null;
  }

  // Every way of closing (Close, Escape, the backdrop, or a page's own dialog.close()) returns
  // focus to the control that opened the drawer. The close event does not bubble, so listen in
  // the capture phase.
  document.addEventListener(
    'close',
    (event) => {
      const dialog = event.target;
      if (!isDrawer(dialog)) return;
      const opener = openerAgain(dialog, openers.get(dialog));
      openers.delete(dialog);
      if (opener?.isConnected) opener.focus();
    },
    true,
  );

  // ---------------------------------------------------------------- motion

  // Pause motion belongs to the deputy. deputy.js loads after this file, so its saved choice is
  // read here as well, and the charts' grow never starts while motion is paused.
  const MOTION_KEY = 'jobdeputy.deputyMotion';
  const SETTLE_MS = 1618;
  const LOADER_FAILSAFE_MS = 4500;
  let settling = false;

  function motionPaused() {
    const deputy = window.JobDeputyDeputy;
    if (deputy && typeof deputy.paused === 'boolean') return deputy.paused;
    try {
      return window.localStorage.getItem(MOTION_KEY) === 'paused';
    } catch {
      return false;
    }
  }

  function markMotion(state) {
    const root = document.documentElement;
    if (root && !root.hasAttribute('data-component-motion')) {
      root.setAttribute('data-component-motion', state);
    }
  }

  // The grow plays while the page first renders. The Dashboard's opening loader
  // (body.loader-active) holds it until the page is revealed; 1.618s later it is settled.
  function settleMotion() {
    if (settling) return;
    settling = true;
    if (motionPaused()) {
      markMotion('paused');
      return;
    }
    const settle = () => window.setTimeout(() => markMotion('settled'), SETTLE_MS);
    const { body } = document;
    if (!body?.classList.contains('loader-active') || typeof MutationObserver !== 'function') {
      settle();
      return;
    }
    let failsafe = 0;
    const observer = new MutationObserver(() => {
      if (body.classList.contains('loader-active')) return;
      observer.disconnect();
      window.clearTimeout(failsafe);
      settle();
    });
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    failsafe = window.setTimeout(() => {
      observer.disconnect();
      settle();
    }, LOADER_FAILSAFE_MS);
  }

  // ---------------------------------------------------------------- shared helpers

  // Elements built here set every attribute through setAttribute, so the same code runs in the
  // browser and in the tests' small DOM.
  function make(tag, attributes = {}, text) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === false || value === null || value === undefined) continue;
      element.setAttribute(name, value === true ? '' : String(value));
    }
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function setHidden(element, hide) {
    if (!element) return;
    if (hide && !element.hasAttribute('hidden')) element.setAttribute('hidden', '');
    else if (!hide && element.hasAttribute('hidden')) element.removeAttribute('hidden');
  }

  function setStyle(element, property, value) {
    if (!element?.style) return;
    if (property.startsWith('--')) element.style.setProperty(property, value);
    else element.style[property] = value;
  }

  const NO_BOX = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 });
  const boxOf = (element) =>
    typeof element?.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : NO_BOX;

  // The layout viewport: the root's client size, which on a touch phone stays the screen's when
  // something is wider than it (window.innerWidth grows with the zoomed-out view there, so a
  // popover measured against it ran off the edge, T2-3); the window's where there is none.
  const viewportSize = () => {
    const root = document.documentElement;
    return {
      width: root?.clientWidth || window.innerWidth || 0,
      height: root?.clientHeight || window.innerHeight || 0,
    };
  };

  // A popover under its control (absolute, in its control's relative root) stays inside the
  // layout viewport sideways (round 7, T2-3 and T2-4, on touch phones too): it moves toward the
  // start by what crosses the end edge, never past the start edge. Measured each time it opens.
  const POPOVER_EDGE = 13;
  function fitPopover(popover, root) {
    setStyle(popover, 'left', '');
    setStyle(popover, 'right', '');
    const box = boxOf(popover);
    if (!box.width) return;
    const view = viewportSize();
    if (!view.width) return;
    let shift = 0;
    const over = box.right - (view.width - POPOVER_EDGE);
    if (over > 0) shift = -over;
    if (box.left + shift < POPOVER_EDGE) shift = POPOVER_EDGE - box.left;
    if (!shift) return;
    setStyle(popover, 'left', `${Math.round(box.left - boxOf(root).left + shift)}px`);
    setStyle(popover, 'right', 'auto');
  }

  const nextFrame = (run) =>
    typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame(run)
      : window.setTimeout(run, 16);

  function mediaMatches(query) {
    try {
      return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
    } catch {
      return false;
    }
  }

  // Motion the script runs itself (the new-row highlight, the tour's glide and scrolling) stops
  // under reduced motion and while Pause motion is on.
  function motionStill() {
    return (
      mediaMatches('(prefers-reduced-motion: reduce)') ||
      document.documentElement?.getAttribute('data-motion') === 'paused' ||
      motionPaused()
    );
  }

  // Shown means rendered: not hidden, not inside display: none, and not in a closed details.
  function isShown(element) {
    if (!element?.isConnected) return false;
    if (typeof element.checkVisibility === 'function') {
      return element.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    }
    for (let node = element; node; node = node.parentElement) {
      if (node.hasAttribute?.('hidden')) return false;
    }
    return typeof element.getClientRects !== 'function' || element.getClientRects().length > 0;
  }

  // Whether the element is in the tab order by itself (links with an address, enabled controls,
  // or a tabindex of 0 or more).
  function takesFocus(element) {
    if (!element || typeof element.getAttribute !== 'function') return false;
    const index = element.getAttribute('tabindex');
    if (index !== null) return Number(index) >= 0;
    if (element.hasAttribute('disabled')) return false;
    const tag = String(element.tagName).toLowerCase();
    if (tag === 'a') return element.hasAttribute('href');
    return ['button', 'input', 'select', 'textarea', 'summary'].includes(tag);
  }

  // The sticky chrome at the top of the viewport: the header, the phone app bar, and anything
  // marked data-sticky-top, chained where one bar starts at the foot of the one above it.
  const TOP_CHROME = '.app-header, .app-menu, [data-sticky-top]';

  // Focus an element and make sure it is in view, clear of the fixed chrome (round 4: focus that
  // returns to an opener or a heading must never land off screen).
  function focusInView(element) {
    if (!element || typeof element.focus !== 'function') return;
    element.focus({ preventScroll: true });
    const box = boxOf(element);
    const view = viewportSize();
    const top = chromeInset();
    if (box.top >= top && box.bottom <= view.height) return;
    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'center', behavior: motionStill() ? 'instant' : 'smooth' });
    }
  }

  function chromeInset() {
    const view = viewportSize();
    const bars = [...document.querySelectorAll(TOP_CHROME)]
      .filter((bar) => ['fixed', 'sticky'].includes(getComputedStyle(bar).position))
      .map(boxOf)
      .filter((box) => box.height > 0 && box.height < view.height / 2)
      .sort((a, b) => a.top - b.top);
    let inset = 0;
    for (const box of bars) if (box.top <= inset + 1 && box.bottom > inset) inset = box.bottom;
    return inset;
  }

  // A visually hidden polite channel that belongs to a component. Clearing it first lets the same
  // words be heard again.
  const speakTimers = new WeakMap();

  function speak(channel, words) {
    if (!channel) return;
    channel.textContent = '';
    window.clearTimeout(speakTimers.get(channel));
    speakTimers.set(
      channel,
      window.setTimeout(() => {
        channel.textContent = words;
      }, 60),
    );
  }

  function channelIn(host) {
    const found = [...host.children].find((child) =>
      child.classList.contains('jd-component-status'),
    );
    if (found) return found;
    const channel = make('p', {
      class: 'sr-only jd-component-status',
      role: 'status',
      'aria-live': 'polite',
    });
    host.append(channel);
    return channel;
  }

  // ---------------------------------------------------------------- flow ribbon

  // Counts are grouped en-US ("1,008 found" on the large demo), as the store's metric text writes
  // them (round 6, R6-4).
  const flowNumber = (count) => String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const FLOW_TEXT = {
    sources: (count) => (count === 1 ? '1 source' : `${flowNumber(count)} sources`),
    matches: (count) => `${flowNumber(count)} found`,
    tracked: (count) => `${flowNumber(count)} tracked`,
  };
  let followingStore = false;

  function flowCounts() {
    const store = window.JobDeputyStore;
    if (!store || typeof store.flowCounts !== 'function') return null;
    try {
      const counts = store.flowCounts();
      return counts && typeof counts === 'object' ? counts : null;
    } catch {
      return null;
    }
  }

  // Anything that is not a document or an element (a store listener's arguments, for example) means
  // the whole page.
  const rootOf = (scope) => (typeof scope?.querySelectorAll === 'function' ? scope : document);

  // A count that is missing, negative, or not a whole number keeps the text already shown.
  function syncFlowCounts(scope) {
    const counts = flowCounts();
    if (!counts) return;
    for (const element of rootOf(scope).querySelectorAll('[data-flow-count]')) {
      const key = element.getAttribute('data-flow-count');
      if (!Object.hasOwn(FLOW_TEXT, key)) continue;
      const count = counts[key];
      if (!Number.isInteger(count) || count < 0) continue;
      const text = FLOW_TEXT[key](count);
      if (element.textContent !== text) element.textContent = text;
    }
  }

  // After a store change the page writes its new counts first (its listener came first); a frame
  // later every donut and ring meter is drawn again from them, which changes only what changed.
  let chartsFrame = 0;
  function redrawCharts() {
    chartsFrame = 0;
    for (const donut of document.querySelectorAll('.donut')) drawDonut(donut);
    for (const ring of document.querySelectorAll('.allowance-ring')) drawRing(ring);
  }

  function followStore() {
    const store = window.JobDeputyStore;
    if (followingStore || !store || typeof store.subscribe !== 'function') return;
    followingStore = true;
    store.subscribe(() => {
      syncFlowCounts();
      syncHomeRegion();
      if (!chartsFrame) chartsFrame = nextFrame(redrawCharts);
    });
  }

  // ---------------------------------------------------------------- the home Region

  // The footer's "<Region> home Region" line, one way on every page (R9-6): the account's home
  // Region from its latest signed agreement record (JobDeputyStore.homeRegion(), feature-detected,
  // so the markup's United States stands until the store has it). The public Help page shows no
  // account state and keeps the markup's words.
  const REGION_NAMES = { US: 'United States', IN: 'India', UK: 'United Kingdom' };
  const HOME_REGION_LINE = /\bhome Region$/;

  function homeRegionName() {
    if (document.documentElement?.dataset?.helpView === 'public') return '';
    try {
      const store = window.JobDeputyStore;
      const region = typeof store?.homeRegion === 'function' ? store.homeRegion() : null;
      const code = String(region?.code ?? '').toUpperCase();
      return REGION_NAMES[code] ?? String(region?.name ?? '').trim();
    } catch {
      return '';
    }
  }

  function syncHomeRegion() {
    const name = homeRegionName();
    if (!name) return;
    for (const line of document.querySelectorAll('.footer-secondary strong')) {
      const words = String(line.textContent ?? '').trim();
      if (!HOME_REGION_LINE.test(words)) continue;
      const said = `${name} home Region`;
      if (words !== said) line.textContent = said;
    }
  }

  // ---------------------------------------------------------------- charts

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // The chart tones (round 5: each reads its --viz-* colour in app-components.css): the five the
  // store's FITS and STAGES name, then four for longer series.
  const TONES = ['green', 'blue', 'orange', 'ink', 'quiet', 'teal', 'indigo', 'gold', 'wine'];
  // A stacked chart's groups take the tones in this order unless the page names them: the first
  // five stay apart in every colour vision. Teal and gold stay with the meters (Deputy Assist's
  // left and the bonus), so a chart of AI work never borrows them.
  const SERIES_TONES = ['blue', 'green', 'orange', 'wine', 'quiet', 'ink', 'indigo'];
  // Other (round 6, R6-4): the parts beyond a chart's top N, together, drawn as a hatched grey.
  // Every tone rule, the donut, swatches, key and legend items, and tone labels accept it.
  const OTHER = 'other';
  const isTone = (tone) => TONES.includes(tone) || tone === OTHER;
  // The words for each data colour, so a page's tooltips and tours name them as they look (round
  // 5): JobDeputyComponents.palette.tones.ink is "charcoal", parts.used "hatched grey", and the
  // left part's word follows the meter's kind.
  const PALETTE = Object.freeze({
    tones: Object.freeze({
      green: 'green',
      blue: 'blue',
      orange: 'orange',
      ink: 'charcoal',
      quiet: 'grey',
      teal: 'teal',
      indigo: 'indigo',
      gold: 'gold',
      wine: 'wine',
    }),
    parts: Object.freeze({ used: 'hatched grey', left: 'green', bonus: 'gold', bought: 'wine' }),
    left: Object.freeze({ watch: 'indigo', assist: 'teal', none: 'green' }),
    series: Object.freeze([...SERIES_TONES]),
  });
  // The donut's ring in a 100-unit box; the outer radius leaves room for the hover lift.
  const OUTER = 48;
  const INNER = 33;
  let donutSerial = 0;

  const svg = (name, attributes = {}) => {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  };
  const fixed = (value) => Math.round(value * 100) / 100;
  const childrenWith = (parent, className) =>
    parent ? [...parent.children].filter((child) => child.classList.contains(className)) : [];
  const legendItems = (legend) =>
    legend ? [...legend.children].filter((child) => child.tagName === 'LI') : [];
  // A legend (name and value) and a chart key (name, count, and meaning) pair with a chart alike.
  const LEGENDS = '.chart-legend, .chart-key';
  const isLegend = (element) =>
    Boolean(
      element?.classList?.contains('chart-legend') || element?.classList?.contains('chart-key'),
    );

  const numbersIn = (text) =>
    String(text ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite);

  // A sparkline draws in its host's own pixel box (89 by 34 unless it is hidden), so the line keeps
  // its 2px weight and the end dot stays round. The same values draw nothing new.
  function drawSparkline(host) {
    const values = numbersIn(host.getAttribute('data-values'));
    const signature = values.join(',');
    const [previous] = childrenWith(host, 'sparkline-art');
    if (previous && host.getAttribute('data-sparkline-drawn') === signature) return;
    previous?.remove();
    host.setAttribute('data-sparkline-drawn', signature);
    if (!values.length) return;
    const width = host.clientWidth || 89;
    const height = host.clientHeight || 34;
    // The 4px dot and its 1px ring stay inside the box.
    const inset = 5;
    const low = Math.min(...values);
    const high = Math.max(...values);
    const x = (index) =>
      values.length === 1
        ? width - inset
        : inset + (index * (width - inset * 2)) / (values.length - 1);
    // A flat series lies on the baseline when it is all zero, and at mid-height otherwise.
    const y = (value) => {
      if (high === low) return high === 0 ? height - inset : height / 2;
      return height - inset - ((value - low) / (high - low)) * (height - inset * 2);
    };
    const points = values.map((value, index) => [fixed(x(index)), fixed(y(value))]);
    const art = svg('svg', {
      class: 'sparkline-art',
      viewBox: `0 0 ${width} ${height}`,
      'aria-hidden': 'true',
      focusable: 'false',
    });
    if (points.length > 1) {
      const d = points.map(([px, py], index) => `${index ? 'L' : 'M'}${px} ${py}`).join(' ');
      art.append(svg('path', { class: 'sparkline-line', d }));
    }
    const [lastX, lastY] = points[points.length - 1];
    art.append(svg('circle', { class: 'sparkline-dot', cx: lastX, cy: lastY, r: 4 }));
    host.append(art);
  }

  const polar = (radius, angle) => [
    fixed(50 + radius * Math.sin(angle)),
    fixed(50 - radius * Math.cos(angle)),
  ];

  // One ring segment, clockwise from the start angle (radians, 0 at the top).
  function segmentPath(start, end) {
    const large = end - start > Math.PI ? 1 : 0;
    const [ax, ay] = polar(OUTER, start);
    const [bx, by] = polar(OUTER, end);
    const [cx, cy] = polar(INNER, end);
    const [dx, dy] = polar(INNER, start);
    return `M${ax} ${ay}A${OUTER} ${OUTER} 0 ${large} 1 ${bx} ${by}L${cx} ${cy}A${INNER} ${INNER} 0 ${large} 0 ${dx} ${dy}Z`;
  }

  // The whole ring as two circles; the even-odd rule cuts the hole.
  const RING_PATH = [
    `M50 ${50 - OUTER}A${OUTER} ${OUTER} 0 1 1 50 ${50 + OUTER}A${OUTER} ${OUTER} 0 1 1 50 ${50 - OUTER}Z`,
    `M50 ${50 - INNER}A${INNER} ${INNER} 0 1 0 50 ${50 + INNER}A${INNER} ${INNER} 0 1 0 50 ${50 - INNER}Z`,
  ].join('');

  // A part's value: the li's data-value, or else the number its count shows (a chart key's
  // .chart-key-count or a legend's .chart-legend-value, "1,204" read as 1204). Reading the count
  // keeps a donut tile in step with the data-metric text the page writes.
  function itemValue(item) {
    const given = item.getAttribute('data-value');
    if (given !== null && given !== '') return Number(given);
    const count = item.querySelector('.chart-key-count, .chart-legend-value');
    const digits = String(count?.textContent ?? '').replace(/[,\s]/g, '');
    return /^\d+(?:\.\d+)?$/.test(digits) ? Number(digits) : Number.NaN;
  }

  // The segments follow the legend or the chart key (the first .chart-legend or .chart-key inside
  // the donut): each li's value and data-tone, in order, clockwise from the top. A segment whose
  // item links is a pointer link to the same place (tabindex -1); the item's link stays the
  // keyboard and screen-reader path. A segment shows the tooltip of its item (data-tip and
  // data-tip-title on the item's link or on the li). Values of 0 draw nothing, and a donut with
  // nothing to draw shows its track. A donut tile (.donut.is-tile inside a split tile) is the same
  // donut with a linked centre (a.donut-total) and a chart key.
  function drawDonut(donut) {
    const parts = legendItems(donut.querySelector(LEGENDS)).map((item, index) => {
      const tone = item.getAttribute('data-tone');
      const link = item.querySelector('a[href]');
      const tipped = [link, item].find(
        (element) => element?.hasAttribute('data-tip') || element?.hasAttribute('data-tip-title'),
      );
      return {
        index,
        value: itemValue(item),
        tone: isTone(tone) ? tone : 'quiet',
        href: link?.getAttribute('href') ?? '',
        tip: tipped?.getAttribute('data-tip') ?? '',
        tipTitle: tipped?.getAttribute('data-tip-title') ?? '',
      };
    });
    const signature = parts
      .map((part) => `${part.value}:${part.tone}:${part.href}:${part.tipTitle}:${part.tip}`)
      .join('|');
    const ring = donut.querySelector('.donut-ring') ?? donut;
    const [previous] = childrenWith(ring, 'donut-art');
    if (previous && donut.getAttribute('data-donut-drawn') === signature) return;
    previous?.remove();
    donut.setAttribute('data-donut-drawn', signature);

    const drawn = parts.filter((part) => Number.isFinite(part.value) && part.value > 0);
    const total = drawn.reduce((sum, part) => sum + part.value, 0);
    donutSerial += 1;
    const maskId = `jd-donut-sweep-${donutSerial}`;
    const art = svg('svg', {
      class: 'donut-art',
      viewBox: '0 0 100 100',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    const defs = svg('defs');
    const mask = svg('mask', {
      id: maskId,
      'mask-type': 'alpha',
      maskUnits: 'userSpaceOnUse',
      x: -10,
      y: -10,
      width: 120,
      height: 120,
    });
    mask.append(
      svg('circle', {
        class: 'donut-sweep',
        cx: 50,
        cy: 50,
        r: (OUTER + INNER) / 2,
        pathLength: 100,
        transform: 'rotate(-90 50 50)',
      }),
    );
    defs.append(mask);
    // Other's hatch (round 6): 2px quiet grey stripes 3px apart, at 45 degrees, as on the bars.
    // The stripes are measured in screen pixels, as on the ring meter, so every donut size reads
    // the same.
    const hatchId = `jd-donut-hatch-${donutSerial}`;
    if (drawn.some((part) => part.tone === OTHER)) {
      const size = boxOf(ring).width || 88;
      const period = fixed((5 * 100) / size);
      const hatch = svg('pattern', {
        id: hatchId,
        patternUnits: 'userSpaceOnUse',
        width: period,
        height: period,
        patternTransform: 'rotate(45)',
      });
      hatch.append(
        svg('rect', { class: 'donut-hatch-ground', width: period, height: period }),
        svg('rect', { class: 'donut-hatch-line', width: fixed((2 * 100) / size), height: period }),
      );
      defs.append(hatch);
    }
    const group = svg('g', { mask: `url(#${maskId})` });
    if (!total)
      group.append(svg('path', { class: 'donut-track', d: RING_PATH, 'fill-rule': 'evenodd' }));
    let angle = 0;
    for (const part of drawn) {
      const sweep = (part.value / total) * Math.PI * 2;
      const whole = drawn.length === 1;
      const shape = svg('path', {
        class: 'donut-seg',
        d: whole ? RING_PATH : segmentPath(angle, angle + sweep),
        'data-index': part.index,
        'data-tone': part.tone,
      });
      if (part.tone === OTHER) setStyle(shape, '--hatch', `url(#${hatchId})`);
      if (whole) shape.setAttribute('fill-rule', 'evenodd');
      angle += sweep;
      const holder = part.href
        ? svg('a', { class: 'donut-link', href: part.href, tabindex: -1 })
        : null;
      const tipHost = holder ?? shape;
      if (part.tip) tipHost.setAttribute('data-tip', part.tip);
      if (part.tipTitle) tipHost.setAttribute('data-tip-title', part.tipTitle);
      if (holder) {
        holder.append(shape);
        group.append(holder);
      } else {
        group.append(shape);
      }
    }
    art.append(defs, group);
    ring.prepend(art);
  }

  // ---------------------------------------------------------------- ring meters

  // The ring meter (round 4, R4-1) is the allowance meter as a ring: div.allowance.is-ring holds a
  // .allowance-ring (88px with .is-compact, 120px otherwise) whose span.allowance-part[data-part]
  // children carry the counts (--count, set by allowance.set as for the bar) and their tips. The
  // ring is drawn from them into an aria-hidden svg.allowance-ring-art: used (a quiet grey
  // hatching), left (the meter's kind: data-meter-kind="watch" indigo, "assist" teal, green
  // otherwise), bonus (gold), and bought (wine, round 5), clockwise from the top in the order they
  // are spent, with 2px gaps of the track between them. Each drawn segment carries its part's tip,
  // so a pointer gets the same words the key gives. The centre and the key are the page's own
  // text. The same counts draw nothing new.
  const RING_OUTER = 48;
  const RING_INNER = 38;
  const RING_GAP_PX = 2;
  const RING_MIN_PX = 4;
  const RING_SIZE = { compact: 88, regular: 120 };
  let ringSerial = 0;

  // A part's count: its --count, read from the inline style (or the style attribute as written).
  const ringCount = (part) => {
    if (part.hasAttribute('hidden')) return 0;
    const inline = String(part.style?.getPropertyValue?.('--count') ?? '').trim();
    const written = String(part.getAttribute('style') ?? '').match(/--count:\s*([\d.]+)/)?.[1];
    const count = Number(inline || written || 0);
    return Number.isFinite(count) && count > 0 ? count : 0;
  };

  // A segment between two angles (radians, clockwise from the top), cut back at each end so the
  // gap beside it is a band of even width, and inset by `inset` units all round.
  function ringSegment(start, end, gap, inset = 0) {
    const outer = fixed(RING_OUTER - inset);
    const inner = fixed(RING_INNER + inset);
    const half = gap / 2 + inset;
    const cut = (radius) => Math.asin(Math.min(1, half / radius));
    const a0 = start + cut(outer);
    const a1 = end - cut(outer);
    const b0 = start + cut(inner);
    const b1 = end - cut(inner);
    if (a1 <= a0 || b1 <= b0) return '';
    const large = (from, to) => (to - from > Math.PI ? 1 : 0);
    const [ax, ay] = polar(outer, a0);
    const [bx, by] = polar(outer, a1);
    const [cx, cy] = polar(inner, b1);
    const [dx, dy] = polar(inner, b0);
    return `M${ax} ${ay}A${outer} ${outer} 0 ${large(a0, a1)} 1 ${bx} ${by}L${cx} ${cy}A${inner} ${inner} 0 ${large(b0, b1)} 0 ${dx} ${dy}Z`;
  }

  // The whole ring between two radii, as two circles cut by the even-odd rule.
  const ringPath = (outer, inner) =>
    [
      `M50 ${50 - outer}A${outer} ${outer} 0 1 1 50 ${50 + outer}A${outer} ${outer} 0 1 1 50 ${50 - outer}Z`,
      `M50 ${50 - inner}A${inner} ${inner} 0 1 0 50 ${50 + inner}A${inner} ${inner} 0 1 0 50 ${50 - inner}Z`,
    ].join('');

  // Shares of the circle, each part at least RING_MIN_PX long at the middle of the ring, the room
  // taken from the larger parts.
  function ringSweeps(counts, unitsPerPx) {
    const total = counts.reduce((sum, count) => sum + count, 0);
    const middle = (RING_OUTER + RING_INNER) / 2;
    const least = Math.min((RING_MIN_PX * unitsPerPx) / middle, (Math.PI * 2) / counts.length);
    let sweeps = counts.map((count) => (count / total) * Math.PI * 2);
    const small = sweeps.map((sweep) => sweep < least);
    if (small.some(Boolean)) {
      const fixedRoom = small.filter(Boolean).length * least;
      const rest = sweeps.reduce((sum, sweep, index) => (small[index] ? sum : sum + sweep), 0);
      const scale = rest > 0 ? (Math.PI * 2 - fixedRoom) / rest : 0;
      sweeps = sweeps.map((sweep, index) => (small[index] ? least : sweep * scale));
    }
    return sweeps;
  }

  // A ring meter explains its own marks (round 4: UAT-M-6, UAT-D-8, UAT-D-14). The attention dot
  // and the reached mark give the label a tip and words for screen readers, and each key item
  // borrows its part's tip, so hovering the key reads like hovering the ring. A page's own tip
  // (one without data-tip-auto) always wins.
  const METER_STATES = {
    'is-attention': {
      title: 'Running low',
      tip: 'The orange dot: these run out before they renew. The line below says when.',
      words: ' (running low)',
    },
    'is-reached': {
      title: 'None left',
      tip: 'The red mark: none are left until they renew. The line below says when.',
      words: ' (none left)',
    },
  };

  function explainMeter(meter) {
    if (!meter?.classList || typeof meter.querySelector !== 'function') return;
    const label = meter.querySelector('.allowance-label');
    const state = Object.keys(METER_STATES).find((name) => meter.classList.contains(name));
    if (label) {
      const own = label.hasAttribute('data-tip') && !label.hasAttribute('data-tip-auto');
      if (!own && state) {
        label.setAttribute('data-tip-title', METER_STATES[state].title);
        label.setAttribute('data-tip', METER_STATES[state].tip);
        label.setAttribute('data-tip-auto', '');
      } else if (!own && label.hasAttribute('data-tip-auto')) {
        for (const name of ['data-tip-title', 'data-tip', 'data-tip-auto'])
          label.removeAttribute(name);
      }
      let words = [...label.children].find((child) =>
        child.classList?.contains('allowance-state-words'),
      );
      if (state) {
        if (!words) {
          words = make('span', { class: 'sr-only allowance-state-words' });
          label.append(words);
        }
        if (words.textContent !== METER_STATES[state].words) {
          words.textContent = METER_STATES[state].words;
        }
      } else if (words) words.remove();
    }
    for (const item of meter.querySelectorAll('.allowance-key-item[data-part]')) {
      if (item.hasAttribute('data-tip') && !item.hasAttribute('data-tip-auto')) continue;
      const part = meter.querySelector(
        `.allowance-part[data-part="${item.getAttribute('data-part')}"]`,
      );
      const tip = part?.getAttribute('data-tip');
      if (!tip) continue;
      item.setAttribute('data-tip-title', part.getAttribute('data-tip-title') ?? '');
      item.setAttribute('data-tip', tip);
      item.setAttribute('data-tip-auto', '');
    }
  }

  // A ring's drawn size without a layout on every draw (T3 retest: Purchases spent about 150ms
  // in forced layouts redrawing its rings): its size class at first, then the real width from a
  // ResizeObserver (which reports before the first paint, and draws it again if it differs).
  const ringSizes = new WeakMap();
  let ringWatch = null;
  function ringSize(ring) {
    const fallback = ring.classList?.contains('is-compact') ? RING_SIZE.compact : RING_SIZE.regular;
    if (typeof ResizeObserver !== 'function') return ring.clientWidth || fallback;
    ringWatch ??= new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.round(entry.target.clientWidth || 0);
        if (!width || ringSizes.get(entry.target) === width) continue;
        ringSizes.set(entry.target, width);
        drawRing(entry.target);
      }
    });
    if (!ringSizes.has(ring)) {
      ringSizes.set(ring, fallback);
      ringWatch.observe(ring);
    }
    return ringSizes.get(ring);
  }

  function drawRing(ring) {
    if (!ring || typeof ring.querySelectorAll !== 'function') return;
    explainMeter(ring.closest?.('.allowance') ?? null);
    const parts = [...ring.querySelectorAll('.allowance-part[data-part]')]
      .map((part) => ({
        part: part.getAttribute('data-part'),
        count: ringCount(part),
        tipTitle: part.getAttribute('data-tip-title') ?? '',
        tip: part.getAttribute('data-tip') ?? '',
      }))
      .filter((part) => ALLOWANCE_PARTS.includes(part.part));
    parts.sort((a, b) => ALLOWANCE_PARTS.indexOf(a.part) - ALLOWANCE_PARTS.indexOf(b.part));
    const size = ringSize(ring);
    const signature = `${size}|${parts.map((p) => `${p.part}:${p.count}:${p.tipTitle}:${p.tip}`).join('|')}`;
    const [previous] = childrenWith(ring, 'allowance-ring-art');
    if (previous && ring.getAttribute('data-ring-drawn') === signature) return;
    previous?.remove();
    ring.setAttribute('data-ring-drawn', signature);

    const unitsPerPx = 100 / size;
    const drawn = parts.filter((part) => part.count > 0);
    ringSerial += 1;
    const maskId = `jd-ring-sweep-${ringSerial}`;
    const hatchId = `jd-ring-hatch-${ringSerial}`;
    const art = svg('svg', {
      class: 'allowance-ring-art',
      viewBox: '0 0 100 100',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    const defs = svg('defs');
    const mask = svg('mask', {
      id: maskId,
      'mask-type': 'alpha',
      maskUnits: 'userSpaceOnUse',
      x: -10,
      y: -10,
      width: 120,
      height: 120,
    });
    mask.append(
      svg('circle', {
        class: 'donut-sweep',
        cx: 50,
        cy: 50,
        r: (RING_OUTER + RING_INNER) / 2,
        pathLength: 100,
        transform: 'rotate(-90 50 50)',
      }),
    );
    // Used is hatched like the bar: 2px quiet grey stripes 3px apart, at 45 degrees.
    const period = fixed(5 * unitsPerPx);
    const hatch = svg('pattern', {
      id: hatchId,
      patternUnits: 'userSpaceOnUse',
      width: period,
      height: period,
      patternTransform: 'rotate(45)',
    });
    hatch.append(
      svg('rect', { class: 'allowance-ring-hatch-ground', width: period, height: period }),
      svg('rect', {
        class: 'allowance-ring-hatch-line',
        width: fixed(2 * unitsPerPx),
        height: period,
      }),
    );
    defs.append(mask, hatch);
    const group = svg('g', { mask: `url(#${maskId})` });
    group.append(
      svg('path', {
        class: 'allowance-ring-track',
        d: ringPath(RING_OUTER, RING_INNER),
        'fill-rule': 'evenodd',
      }),
    );
    const gap = drawn.length > 1 ? RING_GAP_PX * unitsPerPx : 0;
    const sweeps = ringSweeps(
      drawn.map((part) => part.count),
      unitsPerPx,
    );
    let angle = 0;
    drawn.forEach((part, index) => {
      const sweep = sweeps[index];
      const whole = drawn.length === 1;
      const d = whole ? ringPath(RING_OUTER, RING_INNER) : ringSegment(angle, angle + sweep, gap);
      angle += sweep;
      if (!d) return;
      const shape = svg('path', {
        class: 'allowance-ring-seg',
        d,
        'data-part': part.part,
      });
      if (whole) shape.setAttribute('fill-rule', 'evenodd');
      if (part.part === 'used') shape.setAttribute('fill', `url(#${hatchId})`);
      if (part.tip) shape.setAttribute('data-tip', part.tip);
      if (part.tipTitle) shape.setAttribute('data-tip-title', part.tipTitle);
      group.append(shape);
    });
    art.append(defs, group);
    ring.prepend(art);
  }

  // A ring segment and the key item of the same part light up together, on hover and on focus.
  function highlightRing(target, on) {
    const part = target.closest?.('.allowance-ring-seg, .allowance-key-item');
    const meter = part?.closest('.allowance');
    if (!meter?.querySelector('.allowance-ring')) return;
    const name = part.getAttribute('data-part');
    for (const item of meter.querySelectorAll('.allowance-ring-seg, .allowance-key-item')) {
      item.classList.toggle('is-active', on && item.getAttribute('data-part') === name);
    }
  }

  // A chart part and its legend or key item share a position: a donut segment carries its
  // data-index, and a stacked bar's segment its place in the bar. The scope is the nearest donut,
  // chart frame, or split tile.
  function chartPair(target) {
    if (typeof target?.closest !== 'function') return null;
    const item = target.closest('li');
    const fromLegend = isLegend(item?.parentElement);
    const part = fromLegend ? null : target.closest('.donut-seg, .stack-bar-seg');
    const scope = (fromLegend ? item : part)?.closest('.donut, .chart, .kpi-split');
    if (!scope) return null;
    const items = legendItems(scope.querySelector(LEGENDS));
    const isDonut = scope.classList.contains('donut');
    const parts = isDonut
      ? [...scope.querySelectorAll('.donut-seg')]
      : childrenWith(scope.querySelector('.stack-bar'), 'stack-bar-seg');
    const positionOf = (segment) =>
      isDonut ? Number(segment.getAttribute('data-index')) : parts.indexOf(segment);
    const index = fromLegend ? items.indexOf(item) : positionOf(part);
    if (index < 0) return null;
    return { items, parts, positionOf, index, item: items[index] ?? null };
  }

  // A legend item and its part of the chart light up together (.is-active), on hover and on focus.
  function highlight(event, on) {
    const { target } = event;
    if (!(target instanceof Element)) return;
    highlightRing(target, on);
    const pair = chartPair(target);
    if (!pair) return;
    for (const segment of pair.parts)
      segment.classList.toggle('is-active', on && pair.positionOf(segment) === pair.index);
    for (const [position, entry] of pair.items.entries()) {
      entry.classList.toggle('is-active', on && position === pair.index);
    }
  }

  document.addEventListener('pointerover', (event) => highlight(event, true));
  document.addEventListener('pointerout', (event) => highlight(event, false));
  document.addEventListener('focusin', (event) => highlight(event, true));
  document.addEventListener('focusout', (event) => highlight(event, false));

  // ---------------------------------------------------------------- tooltip

  // One shared tooltip for every [data-tip] trigger (data-tip-title is its bold first line). A
  // stacked-bar segment without a tip of its own borrows its legend item's. It shows on hover with
  // a mouse or pen and on focus (not after a touch), stays while the pointer is over the trigger or
  // the tooltip, hides on Escape, and sits above the trigger (below when there is no room), inside
  // the viewport and clear of the sticky chrome. A focusable trigger has aria-describedby while it
  // shows. Inside an open modal dialog the tooltip moves into the dialog, so it stays on top.
  const TIP_TRIGGER = '[data-tip], [data-tip-title], a.stack-bar-seg';
  const TIP_ID = 'jd-tooltip';
  const TIP_GAP = 8;
  const TIP_EDGE = 8;
  const TIP_LINGER_MS = 120;
  const TOUCH_MS = 800;
  const tip = {
    node: null,
    title: null,
    text: null,
    trigger: null,
    described: null,
    timer: 0,
    touchAt: 0,
    frame: 0,
  };

  function tipNode() {
    if (tip.node) return tip.node;
    tip.node = make('div', { class: 'tooltip', id: TIP_ID, role: 'tooltip', hidden: true });
    tip.title = make('span', { class: 'tooltip-title' });
    tip.text = make('span', { class: 'tooltip-text' });
    tip.node.append(tip.title, tip.text);
    return tip.node;
  }

  const tipWords = (element) => ({
    title: element?.getAttribute('data-tip-title') ?? '',
    text: element?.getAttribute('data-tip') ?? '',
  });

  function tipFor(trigger) {
    const own = tipWords(trigger);
    if (own.title || own.text) return own;
    const item = chartPair(trigger)?.item;
    if (!item) return null;
    const source = [item.querySelector('[data-tip], [data-tip-title]'), item].find(
      (element) => element && (tipWords(element).title || tipWords(element).text),
    );
    return source ? tipWords(source) : null;
  }

  // Active means it belongs to a trigger; shown means active and in view. A tooltip whose trigger
  // is still scrolling into view (keyboard focus can start a smooth scroll) is active, not shown.
  const tipActive = () => Boolean(tip.node && tip.trigger && !tip.node.hasAttribute('hidden'));
  const tipShown = () => tipActive() && tip.node.style?.visibility !== 'hidden';

  function linkTip(element) {
    const ids = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    if (!ids.includes(TIP_ID)) element.setAttribute('aria-describedby', [...ids, TIP_ID].join(' '));
    tip.described = element;
  }

  function unlinkTip() {
    const element = tip.described;
    tip.described = null;
    if (!element) return;
    const ids = (element.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((id) => id && id !== TIP_ID);
    if (ids.length) element.setAttribute('aria-describedby', ids.join(' '));
    else element.removeAttribute('aria-describedby');
  }

  function hideTip() {
    window.clearTimeout(tip.timer);
    unlinkTip();
    tip.trigger = null;
    setHidden(tip.node, true);
  }

  function hideTipSoon() {
    window.clearTimeout(tip.timer);
    tip.timer = window.setTimeout(hideTip, TIP_LINGER_MS);
  }

  function showTip(trigger) {
    if (!trigger) return false;
    const words = tipFor(trigger);
    if (!words) return false;
    window.clearTimeout(tip.timer);
    const node = tipNode();
    const host = trigger.closest('dialog[open]') ?? document.body;
    if (node.parentElement !== host) host.append(node);
    if (tip.trigger !== trigger) unlinkTip();
    tip.trigger = trigger;
    // A visually hidden full stop ends the title, so the description reads as two sentences
    // ("Strong fit · 4 roles. A target role, with most of what it asks.").
    tip.title.textContent = '';
    if (words.title) {
      tip.title.append(document.createTextNode(words.title));
      if (!/[.!?]$/.test(words.title)) tip.title.append(make('span', { class: 'sr-only' }, '.'));
    }
    setHidden(tip.title, !words.title);
    tip.text.textContent = words.text;
    setHidden(tip.text, !words.text);
    setHidden(node, false);
    if (takesFocus(trigger)) linkTip(trigger);
    placeTip();
    return true;
  }

  function placeTip() {
    const { node, trigger } = tip;
    if (!node || !trigger || node.hasAttribute('hidden')) return;
    const anchor = boxOf(trigger);
    if (!anchor.width && !anchor.height) return;
    const view = viewportSize();
    // Out of view (scrolling there, or scrolled away): wait unseen, and follow it when it returns.
    const away = anchor.bottom < 0 || anchor.top > view.height;
    setStyle(node, 'visibility', away ? 'hidden' : '');
    if (away) return;
    setStyle(node, 'left', '0px');
    setStyle(node, 'top', '0px');
    const size = boxOf(node);
    const ceiling = chromeInset() + TIP_EDGE;
    let top = anchor.top - TIP_GAP - size.height;
    let placement = 'top';
    if (top < ceiling) {
      const below = anchor.bottom + TIP_GAP;
      const roomBelow = view.height - TIP_EDGE - below;
      const roomAbove = anchor.top - TIP_GAP - ceiling;
      if (size.height <= roomBelow || roomBelow >= roomAbove) {
        top = below;
        placement = 'bottom';
      } else {
        top = ceiling;
      }
    }
    const centre = anchor.left + anchor.width / 2;
    let left = Math.min(
      Math.max(centre - size.width / 2, TIP_EDGE),
      Math.max(TIP_EDGE, view.width - TIP_EDGE - size.width),
    );
    // A short viewport (200% zoom) can leave room neither above nor below, and a tooltip over its
    // own trigger hides the focus ring (WCAG 2.2 SC 2.4.11, round 5, UAT-A-2). Then it goes beside
    // the trigger, on the side with more room, and the caret is dropped.
    const covers = () =>
      left < anchor.right &&
      left + size.width > anchor.left &&
      top < anchor.bottom &&
      top + size.height > anchor.top;
    if (covers()) {
      const roomRight = view.width - TIP_EDGE - (anchor.right + TIP_GAP);
      const roomLeft = anchor.left - TIP_GAP - TIP_EDGE;
      const side = roomRight >= roomLeft ? 'right' : 'left';
      const room = side === 'right' ? roomRight : roomLeft;
      if (size.width <= room) {
        left = side === 'right' ? anchor.right + TIP_GAP : anchor.left - TIP_GAP - size.width;
        top = Math.min(
          Math.max(anchor.top + anchor.height / 2 - size.height / 2, ceiling),
          Math.max(ceiling, view.height - TIP_EDGE - size.height),
        );
        placement = side;
      }
    }
    node.setAttribute('data-placement', placement);
    setStyle(node, 'left', `${Math.round(left)}px`);
    setStyle(node, 'top', `${Math.round(top)}px`);
    // A transformed ancestor (a dialog as it opens) moves a fixed box; correct by what landed.
    const landed = boxOf(node);
    const dx = landed.left - Math.round(left);
    const dy = landed.top - Math.round(top);
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      setStyle(node, 'left', `${Math.round(left - dx)}px`);
      setStyle(node, 'top', `${Math.round(top - dy)}px`);
    }
    const arrow = Math.min(Math.max(centre - left, 13), Math.max(13, size.width - 13));
    setStyle(node, '--tooltip-arrow', `${Math.round(arrow)}px`);
  }

  const fromTouch = () => Date.now() - tip.touchAt < TOUCH_MS;

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType === 'touch') tip.touchAt = Date.now();
      const { target } = event;
      if (!tipActive() || !(target instanceof Element)) return;
      if (!tip.trigger.contains(target) && !tip.node.contains(target)) hideTip();
    },
    true,
  );

  document.addEventListener('pointerover', (event) => {
    const { target } = event;
    if (!(target instanceof Element)) return;
    if (tip.node?.contains(target)) {
      window.clearTimeout(tip.timer);
      return;
    }
    if (event.pointerType === 'touch') return;
    const trigger = target.closest(TIP_TRIGGER);
    if (trigger) showTip(trigger);
  });

  document.addEventListener('pointerout', (event) => {
    if (!tipActive()) return;
    const next = event.relatedTarget;
    if (next instanceof Element && (tip.trigger.contains(next) || tip.node.contains(next))) return;
    // A trigger that has the keyboard's focus keeps its tooltip.
    if (tip.described && tip.described === document.activeElement) return;
    hideTipSoon();
  });

  document.addEventListener('focusin', (event) => {
    const { target } = event;
    if (!(target instanceof Element)) return;
    const trigger = target.closest(TIP_TRIGGER);
    if (trigger && !fromTouch()) showTip(trigger);
    else if (tipActive() && !tip.trigger.contains(target)) hideTip();
  });

  document.addEventListener('focusout', (event) => {
    if (!tipActive()) return;
    const next = event.relatedTarget;
    if (next instanceof Element && tip.trigger.contains(next)) return;
    hideTip();
  });

  // Escape dismisses the tooltip first; a second Escape reaches the dialog or menu behind it.
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !tipShown()) return;
      hideTip();
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );

  // ---------------------------------------------------------------- allowance meters

  // allowance.set(meter, { used, left, bonus, bought, limit, state, kind }) sizes the bar's parts
  // (--count), hides a part of zero (and the bonus or bought key item at zero), and writes each
  // number into the [data-allowance-value="used|left|bonus|bought|limit"] elements, keeping their
  // data-metric. A value it is not given stays as it is. The limit defaults to used plus left. A
  // ring meter (.is-ring) takes the same values: its parts are the same spans, and its ring is
  // drawn again from them. Numbers are written with en-US grouping (49810 reads 49,810), as the
  // store writes them. kind ('watch' or 'assist', round 5) sets data-meter-kind, which picks the
  // left part's colour; null removes it (green).
  const ALLOWANCE_PARTS = ['used', 'left', 'bonus', 'bought'];
  const METER_KINDS = ['watch', 'assist'];
  const grouped = (count) => String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  function wholeOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
  }

  function setAllowance(meter, values = {}) {
    if (!meter || typeof meter.querySelectorAll !== 'function') return null;
    const counts = {};
    for (const part of ALLOWANCE_PARTS) counts[part] = wholeOrNull(values?.[part]);
    counts.limit =
      wholeOrNull(values?.limit) ??
      (counts.used !== null && counts.left !== null ? counts.used + counts.left : null);
    for (const part of ALLOWANCE_PARTS) {
      const count = counts[part];
      if (count === null) continue;
      for (const segment of meter.querySelectorAll(`.allowance-part[data-part="${part}"]`)) {
        setStyle(segment, '--count', String(count));
        setHidden(segment, count === 0);
      }
      if (part === 'bonus' || part === 'bought') {
        for (const item of meter.querySelectorAll(`.allowance-key-item[data-part="${part}"]`)) {
          setHidden(item, count === 0);
        }
      }
    }
    for (const output of meter.querySelectorAll('[data-allowance-value]')) {
      const count = counts[output.getAttribute('data-allowance-value')];
      if (count === null || count === undefined) continue;
      if (output.textContent !== grouped(count)) output.textContent = grouped(count);
    }
    // state: 'attention' (running low) or 'reached' (nothing left) marks the meter; 'ok' clears
    // both. Without a state the classes stay as the markup set them.
    if (values?.state !== undefined && meter.classList) {
      meter.classList.toggle('is-attention', values.state === 'attention');
      meter.classList.toggle('is-reached', values.state === 'reached');
    }
    if (METER_KINDS.includes(values?.kind)) meter.setAttribute('data-meter-kind', values.kind);
    else if (values?.kind === null) meter.removeAttribute('data-meter-kind');
    const rings = meter.classList?.contains('allowance-ring')
      ? [meter]
      : [...meter.querySelectorAll('.allowance-ring')];
    for (const ring of rings) drawRing(ring);
    return counts;
  }

  // ---------------------------------------------------------------- the shared status channel

  // One visually hidden polite channel (StatusAnnouncement) that components speak through: a
  // p.sr-only.jd-status[role="status"] in the body, or in the open modal dialog that holds the
  // component, so the words are heard while the dialog makes the page inert.
  function statusChannel(near) {
    const host =
      (typeof near?.closest === 'function' ? near.closest('dialog[open]') : null) ?? document.body;
    const found = [...host.children].find((child) => child.classList.contains('jd-status'));
    if (found) return found;
    const channel = make('p', {
      class: 'sr-only jd-status',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    });
    host.append(channel);
    return channel;
  }

  // announce(words, near?) says the words once (the same words again are heard again). near is an
  // element the words belong to (the channel is the one of its open dialog, or the page's), or a
  // page's own [role="status"] channel to speak through instead.
  function announce(words, near) {
    const text = String(words ?? '').trim();
    if (!text) return false;
    const own = typeof near?.getAttribute === 'function' && near.getAttribute('role') === 'status';
    speak(own ? near : statusChannel(near), text);
    return true;
  }

  // ---------------------------------------------------------------- run tracker

  // runTracker(host, runId?, { channel, watchHref, metrics, store, compact, quiet }) shows one run
  // from JobDeputyStore (or the store-shaped object passed in, for references and tests) and keeps
  // it current on store.onTick and store.subscribe, until the host leaves the page (or stop()).
  // Without a runId it follows the newest live run, and keeps the last one it showed once that
  // finishes. Round 5 (S2, tracker v2): no time bar, because nobody knows how long a crawl takes.
  // It writes the source, the state pill (Queued, Live, Finished, Stopped), the four stages as
  // steps (done, current, upcoming), each with its own real counter (from run().stages: pages read
  // of the plan, roles read, roles scored and new found; from a store without stages, the run's
  // own pagesRead, checked, and kept), the time counting up ("Queued for 8 s", "Running for 1 min
  // 12 s"), and Watch live while the run is live or queued. A finished run reads "Finished in 1
  // min 40 s · 44 checked · 2 new". The compact variant (.run-tracker.is-compact, or { compact:
  // true }) is one row for a tile: the source, "Stage 2 of 4: Reading listings", the time, the new
  // roles so far, and Watch live. Every figure carries its data-metric (runs.<id>.pagesRead,
  // .checked, .kept) once. The ticking time is never a live region: stage changes and the finish
  // are said once through the shared status channel (or the channel passed in).
  const TRACKER_STAGES = [
    { id: 'fetching', label: 'Fetching pages' },
    { id: 'reading', label: 'Reading listings' },
    { id: 'matching', label: 'Matching your roles' },
    { id: 'saving', label: 'Saving' },
  ];
  const TRACKER_STATES = {
    queued: 'Queued',
    live: 'Live',
    complete: 'Finished',
    stopped: 'Stopped',
  };

  function elapsedText(seconds, words = false, store = window.JobDeputyStore) {
    const format = store?.format;
    const name = words ? 'elapsedWords' : 'elapsed';
    if (typeof format?.[name] === 'function') {
      try {
        const text = format[name](seconds);
        if (typeof text === 'string' && text) return text;
      } catch {
        // The fallback below says the same.
      }
    }
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    const unit = (count, short, long) =>
      words ? `${count} ${long}${count === 1 ? '' : 's'}` : `${count} ${short}`;
    if (hours)
      return [unit(hours, 'h', 'hour'), minutes ? unit(minutes, 'min', 'minute') : '']
        .filter(Boolean)
        .join(' ');
    if (minutes)
      return [unit(minutes, 'min', 'minute'), rest ? unit(rest, 's', 'second') : '']
        .filter(Boolean)
        .join(' ');
    return unit(rest, 's', 'second');
  }

  const stageList = (store = window.JobDeputyStore) => {
    const stages = store?.RUN_STAGES;
    if (!Array.isArray(stages)) return TRACKER_STAGES;
    const named = stages.filter(
      (stage) => stage && !['queued', 'complete', 'stopped'].includes(stage.id),
    );
    return named.length ? named.map(({ id, label }) => ({ id, label })) : TRACKER_STAGES;
  };

  // Seconds since the run was asked for: the store's elapsedSeconds, or else from its start.
  function runSeconds(run, seen, store = window.JobDeputyStore) {
    if (Number.isFinite(run?.elapsedSeconds)) return run.elapsedSeconds;
    const started = Date.parse(run?.startedAt ?? run?.requestedAt ?? '');
    const now = typeof store?.now === 'function' ? Number(store.now()) : Number.NaN;
    if (Number.isFinite(started) && Number.isFinite(now)) {
      return Math.max(0, Math.round((now - started) / 1000));
    }
    return seen ?? 0;
  }

  // Seconds from the run's start to now, by the store's clock, or null when it cannot tell.
  function sinceStart(run, store) {
    const started = Date.parse(run?.startedAt ?? run?.requestedAt ?? '');
    const now = typeof store?.now === 'function' ? Number(store.now()) : Number.NaN;
    return Number.isFinite(started) && Number.isFinite(now) ? (now - started) / 1000 : null;
  }

  // How long a finished run took, on the clock the counter used while it ran: from its start to
  // its finish when the live time counted from its start, else its full duration (seen while it
  // ran, or given), else from its start and finish times.
  function finishedSeconds(run, memory) {
    const started = Date.parse(run?.startedAt ?? run?.requestedAt ?? '');
    const finished = Date.parse(run?.finishedAt ?? '');
    const span =
      Number.isFinite(started) && Number.isFinite(finished) && finished >= started
        ? Math.round((finished - started) / 1000)
        : null;
    if (memory.fromStart && span !== null) return span;
    if (Number.isFinite(memory.duration)) return memory.duration;
    if (Number.isFinite(run?.durationSeconds)) return run.durationSeconds;
    if (span !== null) return span;
    return Number.isFinite(run?.elapsedSeconds) ? run.elapsedSeconds : (memory.seconds ?? 0);
  }

  const runPhase = (run) => {
    if (!run) return null;
    if (run.status === 'stopped') return 'stopped';
    if (run.status === 'complete') return 'complete';
    return run.stage === 'queued' ? 'queued' : 'live';
  };

  function metricOr(key, fallback, store = window.JobDeputyStore) {
    if (typeof store?.metricText === 'function') {
      try {
        const text = store.metricText(key);
        if (typeof text === 'string' && text !== '') return text;
      } catch {
        // The run's own number is shown instead.
      }
    }
    return grouped(Math.max(0, Math.round(Number(fallback) || 0)));
  }

  // The tracker's parts, built when the host does not carry the markup already: the stepper with a
  // counter in each step, or (compact) one row of the source, the stage, the time, and the new
  // roles so far.
  function trackerNode(host, store, compact) {
    const own = host.classList?.contains('run-tracker') ? host : host.querySelector('.run-tracker');
    if (own) return own;
    const tracker = make('div', {
      class: compact ? 'run-tracker is-compact' : 'run-tracker',
      'data-state': 'queued',
    });
    const watch = make(
      'a',
      { class: 'chart-action run-tracker-watch', 'data-run-watch': true, href: '#' },
      'Watch live',
    );
    if (compact) {
      const stage = make('p', { class: 'run-tracker-stage' });
      const pips = make('span', { class: 'run-tracker-pips', 'aria-hidden': 'true' });
      for (const item of stageList(store)) {
        pips.append(make('span', { class: 'run-tracker-pip', 'data-stage': item.id }));
      }
      stage.append(pips, make('span', { 'data-run-stage': true }));
      const fresh = make('p', { class: 'run-tracker-new' });
      fresh.append(
        make('span', { 'data-run-count': 'kept' }, '0'),
        make('span', { 'data-run-new-words': true }, ' new so far'),
      );
      tracker.append(
        make('p', { class: 'run-tracker-source', 'data-run-source': true }),
        stage,
        make('p', { class: 'run-tracker-time', 'data-run-time': true }),
        fresh,
        watch,
      );
    } else {
      const head = make('div', { class: 'run-tracker-head' });
      head.append(
        make('p', { class: 'run-tracker-source', 'data-run-source': true }),
        make('span', { class: 'run-tracker-state', 'data-run-state': true }),
      );
      const steps = make('ol', { class: 'run-tracker-steps', 'aria-label': 'Stages' });
      for (const item of stageList(store)) {
        const step = make('li', { class: 'run-tracker-step', 'data-stage': item.id });
        step.append(
          make('span', { class: 'run-tracker-step-name' }, item.label),
          make('span', { class: 'run-tracker-step-count', 'data-run-step-count': true }),
          make('span', { class: 'sr-only', 'data-run-step-state': true }),
        );
        steps.append(step);
      }
      tracker.append(
        head,
        steps,
        make('p', { class: 'run-tracker-time', 'data-run-time': true }),
        watch,
      );
    }
    host.append(tracker);
    return tracker;
  }

  function stepState(index, current, phase) {
    if (phase === 'complete') return 'done';
    if (phase === 'queued' || current < 0) return 'next';
    if (index < current) return 'done';
    if (index === current) return phase === 'stopped' ? 'stopped' : 'current';
    return 'next';
  }

  const STEP_WORDS = { done: ', done', current: ', now', stopped: ', stopped here', next: '' };
  // The store's stage states (round 5: 'done', 'current', 'upcoming', 'stopped'), as the tracker
  // names them.
  const STAGE_STATES = {
    done: 'done',
    current: 'current',
    upcoming: 'next',
    next: 'next',
    stopped: 'stopped',
  };
  // Which of the run's own counters a stage counts, for its data-metric (runs.<id>.<field>).
  const STAGE_FIELDS = { fetching: 'pagesRead', reading: 'checked', matching: 'kept' };

  const wholeOr = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
  };

  // The run's four stages with their states and counters. A store with run().stages (round 5)
  // gives each stage's real counter, { label, value, of }; without them, the counters come from
  // the run's own figures: pages read of the plan, roles read, and new roles found. Never from the
  // time.
  function runStages(run, stages, phase, stoppedAt) {
    const own = Array.isArray(run?.stages)
      ? run.stages.filter((stage) => stage && !['queued', 'complete', 'stopped'].includes(stage.id))
      : [];
    const current = stages.findIndex(
      (stage) => stage.id === (phase === 'stopped' ? stoppedAt : run?.stage),
    );
    if (own.length) {
      const marked = own.findIndex((stage) => ['current', 'stopped'].includes(stage.state));
      return own.map((stage, index) => {
        let state = STAGE_STATES[stage.state] ?? 'next';
        if (phase === 'complete') state = 'done';
        else if (phase === 'queued') state = 'next';
        else if (phase === 'stopped' && marked < 0 && current >= 0) {
          // A store that does not mark where a run stopped: the stage this tracker saw it on.
          state = index < current ? 'done' : index === current ? 'stopped' : 'next';
        } else if (phase === 'stopped' && state === 'current') state = 'stopped';
        return {
          id: String(stage.id),
          label: String(stage.label ?? stages[index]?.label ?? ''),
          state,
          count: stage.count && typeof stage.count === 'object' ? stage.count : null,
        };
      });
    }
    const plan = run?.expected ?? {};
    const derived = {
      fetching:
        wholeOr(run?.pagesRead) === null
          ? null
          : { label: 'pages read', value: run.pagesRead, of: wholeOr(plan.pages) },
      reading:
        wholeOr(run?.checked) === null
          ? null
          : { label: 'roles read', value: run.checked, of: null },
      matching: wholeOr(run?.kept) === null ? null : { label: 'new', value: run.kept, of: null },
    };
    return stages.map((stage, index) => ({
      id: stage.id,
      label: stage.label,
      state: stepState(index, current, phase),
      count: derived[stage.id] ?? null,
    }));
  }

  // A stage counter as parts of text, each figure with the data-metric that equals it (once per
  // tracker): "9 of 9 pages read", "18 roles read", "20 roles scored · 1 new". The store's own
  // words (count.text) are used when it gives them, with its keys (count.metric, ofMetric, and
  // foundMetric); without them the counter is said from its value, of, and label, and each figure
  // takes the run's key it equals (runs.<id>.pagesRead, .checked, .kept).
  function countParts(run, stage, used, store, metrics) {
    const { count } = stage;
    if (!count || wholeOr(count.value) === null) return [];
    const take = (key) => {
      if (!metrics || !key || used.has(key)) return null;
      used.add(key);
      return key;
    };
    const keyFor = (value, field) => {
      if (!metrics || !run?.id) return null;
      const fields = [field, ...Object.values(STAGE_FIELDS)].filter(Boolean);
      for (const name of fields) {
        const key = `runs.${run.id}.${name}`;
        if (used.has(key) || wholeOr(run[name]) !== wholeOr(value)) continue;
        if (metricOr(key, value, store) !== grouped(wholeOr(value))) continue;
        return take(key);
      }
      return null;
    };
    const figures = [
      {
        value: wholeOr(count.value),
        key: count.metric
          ? take(String(count.metric))
          : keyFor(count.value, STAGE_FIELDS[stage.id]),
      },
    ];
    if (wholeOr(count.of) !== null) {
      figures.push({
        value: wholeOr(count.of),
        key: count.ofMetric ? take(String(count.ofMetric)) : null,
      });
    }
    // Matching also says how many new roles it has found so far.
    const fresh = wholeOr(count.found ?? (stage.id === 'matching' ? run?.kept : null));
    const sayNew = fresh !== null && !/\bnew\b/i.test(String(count.label ?? ''));
    if (sayNew) {
      figures.push({
        value: fresh,
        key: count.foundMetric ? take(String(count.foundMetric)) : keyFor(fresh, 'kept'),
      });
    }
    // The words: the store's, or worked out the same way.
    let words = typeof count.text === 'string' && count.text.trim() ? count.text.trim() : '';
    if (!words) {
      words = grouped(figures[0].value);
      if (wholeOr(count.of) !== null) words += ` of ${grouped(wholeOr(count.of))}`;
      if (count.label) words += ` ${count.label}`;
      if (sayNew) words += ` · ${grouped(fresh)} new`;
    }
    // Each figure, in order, becomes its own part with its key.
    const parts = [];
    let rest = words;
    for (const figure of figures) {
      const text = grouped(figure.value);
      const at = rest.search(new RegExp(`(^|[^\\d,])${text}(?![\\d,])`));
      if (at < 0) continue;
      const start = rest.indexOf(text, at);
      if (start > 0) parts.push({ text: rest.slice(0, start) });
      parts.push({ text, metric: figure.key });
      rest = rest.slice(start + text.length);
    }
    if (rest) parts.push({ text: rest });
    return parts;
  }

  // Writes parts of text into an element, rebuilding it only when the words or keys change.
  function fillParts(element, parts) {
    if (!element) return;
    const signature = JSON.stringify(parts);
    if (element.getAttribute('data-run-parts') === signature) return;
    element.setAttribute('data-run-parts', signature);
    element.textContent = '';
    for (const part of parts) {
      if (part.metric) element.append(make('span', { 'data-metric': part.metric }, part.text));
      else element.append(document.createTextNode(part.text));
    }
  }

  function runTracker(host, runId, options = {}) {
    const store = options.store ?? window.JobDeputyStore;
    if (
      !host ||
      typeof host.querySelector !== 'function' ||
      !store ||
      typeof store.run !== 'function'
    ) {
      return null;
    }
    const wantsCompact =
      options.compact === true || Boolean(host.classList?.contains('is-compact'));
    const tracker = trackerNode(host, store, wantsCompact);
    const compact = tracker.classList.contains('is-compact');
    const memory = {
      id: runId ? String(runId) : '',
      follow: !runId,
      phase: null,
      stage: null,
      seconds: null,
      duration: null,
      fromStart: false,
      stopped: false,
      offTick: null,
      offChange: null,
    };
    const part = (selector) => tracker.querySelector(selector);
    // { quiet: true } for a second view of a run another tracker already speaks for.
    const say = (words) => {
      if (options.quiet) return;
      const channel =
        typeof options.channel === 'string'
          ? document.querySelector(options.channel)
          : options.channel;
      announce(words, channel?.getAttribute?.('role') === 'status' ? channel : tracker);
    };

    const lookUp = () => {
      if (memory.follow) {
        const live = typeof store.liveRun === 'function' ? store.liveRun() : null;
        if (live?.id) memory.id = live.id;
      }
      if (!memory.id) return null;
      try {
        return store.run(memory.id);
      } catch {
        return null;
      }
    };

    function render() {
      if (memory.stopped) return null;
      if (!tracker.isConnected) {
        stop();
        return null;
      }
      const run = lookUp();
      const phase = runPhase(run);
      setHidden(tracker, !run);
      if (!run) return null;
      const stages = stageList(store);
      const steps = runStages(run, stages, phase, memory.stage);
      const currentIndex = steps.findIndex((step) => ['current', 'stopped'].includes(step.state));
      tracker.setAttribute('data-state', phase);
      tracker.setAttribute('data-run', run.id);
      const metrics = options.metrics !== false;
      const used = new Set();

      const source = part('[data-run-source]');
      if (source && source.textContent !== (run.sourceName ?? ''))
        source.textContent = run.sourceName ?? '';
      const pill = part('[data-run-state]');
      if (pill) {
        pill.setAttribute('data-state', phase);
        if (pill.textContent !== TRACKER_STATES[phase]) pill.textContent = TRACKER_STATES[phase];
      }

      // The stepper: each stage's state, and its counter while the run is going (a finished run
      // says its figures once, in the summary line).
      for (const element of tracker.querySelectorAll('.run-tracker-step, .run-tracker-pip')) {
        const id = element.getAttribute('data-stage');
        const step = steps.find((item) => item.id === id);
        const state = step?.state ?? 'next';
        for (const name of ['done', 'current', 'stopped']) {
          element.classList.toggle(`is-${name}`, state === name);
        }
        if (!element.classList.contains('run-tracker-step')) continue;
        if (state === 'current') element.setAttribute('aria-current', 'step');
        else element.removeAttribute('aria-current');
        const words = element.querySelector('[data-run-step-state]');
        if (words && words.textContent !== STEP_WORDS[state]) words.textContent = STEP_WORDS[state];
        let counter = element.querySelector('[data-run-step-count]');
        if (!counter) {
          // A round 4 step gains its counter after the name (appending keeps the order: the name,
          // the counter, then the hidden state words).
          counter = make('span', { class: 'run-tracker-step-count', 'data-run-step-count': true });
          element.append(counter);
          if (words) element.append(words);
        }
        const showCount = phase !== 'complete' && state !== 'next' && step;
        fillParts(counter, showCount ? countParts(run, step, used, store, metrics) : []);
        setHidden(counter, !showCount || !counter.textContent);
      }
      const stageWords = part('[data-run-stage]');
      if (stageWords) {
        const at = currentIndex >= 0 ? currentIndex : 0;
        const text =
          phase === 'live'
            ? `Stage ${at + 1} of ${steps.length}: ${steps[at]?.label ?? ''}`
            : phase === 'stopped'
              ? `Stopped at stage ${at + 1} of ${steps.length}`
              : '';
        if (stageWords.textContent !== text) stageWords.textContent = text;
        setHidden(stageWords.closest('.run-tracker-stage') ?? stageWords, !text);
      }

      const live = phase === 'live' || phase === 'queued';
      if (live) {
        memory.seconds = runSeconds(run, memory.seconds, store);
        if (Number.isFinite(run.durationSeconds)) memory.duration = run.durationSeconds;
        // Does the store's elapsedSeconds count from the run's start (its request)? Then the
        // finish is told on that clock too, so it never reads shorter than the count before it.
        const fromStart = sinceStart(run, store);
        memory.fromStart =
          !Number.isFinite(run.elapsedSeconds) ||
          (fromStart !== null && Math.abs(fromStart - run.elapsedSeconds) <= 2);
      }
      const seconds = live ? memory.seconds : finishedSeconds(run, memory);
      const figures = {};
      for (const name of ['checked', 'kept']) {
        figures[name] = metricOr(`runs.${run.id}.${name}`, run[name], store);
      }
      const key = (name) =>
        metrics && !used.has(name) && !compact ? `runs.${run.id}.${name}` : null;
      const timeParts = {
        queued: [{ text: `Queued for ${elapsedText(seconds, false, store)}` }],
        live: [{ text: `Running for ${elapsedText(seconds, false, store)}` }],
        complete: compact
          ? [{ text: `Finished in ${elapsedText(seconds, false, store)}` }]
          : [
              { text: `Finished in ${elapsedText(seconds, false, store)} · ` },
              { text: figures.checked, metric: key('checked') },
              { text: ' checked · ' },
              { text: figures.kept, metric: key('kept') },
              { text: ' new' },
            ],
        stopped: [{ text: run.error?.message ? `Stopped: ${run.error.message}` : 'Stopped' }],
      }[phase];
      fillParts(part('[data-run-time]'), timeParts);

      // The round 4 Checked and New figures, and the compact row's new roles so far: a page that
      // still carries the round 4 list keeps it current, out of sight (the steps say it now).
      for (const output of tracker.querySelectorAll('[data-run-count]')) {
        const name = output.getAttribute('data-run-count');
        if (!['checked', 'kept'].includes(name)) continue;
        const shown = compact && name === 'kept';
        const metricKey = `runs.${run.id}.${name}`;
        if (metrics && shown) {
          if (output.getAttribute('data-metric') !== metricKey)
            output.setAttribute('data-metric', metricKey);
        } else output.removeAttribute('data-metric');
        if (output.textContent !== figures[name]) output.textContent = figures[name];
      }
      const newWords = part('[data-run-new-words]');
      if (newWords) {
        const text = phase === 'complete' ? ' new' : ' new so far';
        if (newWords.textContent !== text) newWords.textContent = text;
      }
      // Watch live while it is queued or live; { watchHref: null } leaves it out.
      const watch = part('[data-run-watch]');
      if (watch) {
        setHidden(watch, !live || options.watchHref === null);
        const href =
          options.watchHref ??
          `./searches-preview.html?source=${encodeURIComponent(run.sourceId ?? '')}&live=1`;
        if (watch.getAttribute('href') !== href) watch.setAttribute('href', href);
      }

      // Said once: a new stage while it runs, and how it ended. The first look says nothing.
      const name = run.sourceName ?? 'Your search';
      if (memory.phase !== null && memory.phase !== phase && !live) {
        say(
          phase === 'complete'
            ? `${name} finished in ${elapsedText(seconds, true, store)}: ${figures.checked} checked, ${figures.kept} new.`
            : `${name} stopped.`,
        );
      } else if (memory.stage !== null && live && memory.stage !== run.stage) {
        say(`${name}: ${run.stageLabel ?? steps[currentIndex]?.label ?? 'Queued'}.`);
      }
      memory.phase = phase;
      if (live) memory.stage = run.stage;
      return { id: run.id, phase, stage: run.stage, seconds, stages: steps };
    }

    function stop() {
      memory.stopped = true;
      memory.offTick?.();
      memory.offChange?.();
      memory.offTick = null;
      memory.offChange = null;
    }

    if (typeof store.onTick === 'function') memory.offTick = store.onTick(() => render());
    if (typeof store.subscribe === 'function') memory.offChange = store.subscribe(() => render());
    render();
    return Object.freeze({
      render,
      stop,
      get runId() {
        return memory.id || null;
      },
      get active() {
        return !memory.stopped;
      },
    });
  }

  // ---------------------------------------------------------------- live rows

  // flagNew(row or rows) gives rows a finished run just added one 1.618s green-wash highlight
  // (.is-new), and none while motion is paused or reduced. It returns how many it flagged.
  const NEW_MS = 1618;
  const newTimers = new WeakMap();

  function flagNew(rows) {
    if (motionStill()) return 0;
    const list = (rows instanceof Element ? [rows] : [...(rows ?? [])]).filter(
      (row) => row instanceof Element,
    );
    for (const row of list) {
      row.classList.add('is-new');
      window.clearTimeout(newTimers.get(row));
      newTimers.set(
        row,
        window.setTimeout(() => row.classList.remove('is-new'), NEW_MS),
      );
    }
    return list.length;
  }

  // ---------------------------------------------------------------- list toolbar

  // [data-list-toolbar][data-list-target="<list id>"] filters the list's [data-list-item] children
  // by its search field ([data-list-search], matched against data-search or the item's text,
  // ignoring case and accents) and its chip groups ([data-list-filter="<key>"]: radios choose one
  // value, checkboxes any of several; "all" or none chosen means no filter; items carry
  // data-filter-<key> with one or more values). [data-list-sort] orders the items by
  // data-sort-<key> ("<key>:asc" or "<key>:desc"; numbers as numbers). Each chip's
  // .list-toolbar-count shows how many items it would show, [data-list-count] the result in words
  // (data-list-noun and data-list-nouns name the items), [data-list-empty="<id>"] on the toolbar
  // names the empty state, and the toolbar announces the result once after a change.
  const readyLists = new WeakSet();
  const LIST_TYPING_MS = 400;
  const listTimers = new WeakMap();

  const wordsOf = (value) =>
    String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\s+/)
      .filter(Boolean);

  const tokensOf = (item, key) =>
    String(item.getAttribute(`data-filter-${key}`) ?? '')
      .split(/\s+/)
      .filter(Boolean);

  const chosenIn = (group) =>
    [...group.querySelectorAll('input')]
      .filter((input) => input.checked && input.value && input.value !== 'all')
      .map((input) => input.value);

  function itemMatches(item, terms, filters, skipKey) {
    if (terms.length) {
      const haystack = wordsOf(item.getAttribute('data-search') ?? item.textContent).join(' ');
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return filters.every(
      ({ key, values }) =>
        key === skipKey ||
        !values.length ||
        tokensOf(item, key).some((token) => values.includes(token)),
    );
  }

  function compareValues(a, b) {
    const x = Number(a);
    const y = Number(b);
    if (a !== '' && b !== '' && Number.isFinite(x) && Number.isFinite(y)) return x - y;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  function listResult(toolbar, shown, total) {
    const one = toolbar.getAttribute('data-list-noun') || 'item';
    const many = toolbar.getAttribute('data-list-nouns') || `${one}s`;
    if (!shown) return `No ${many} match`;
    if (shown === total) return `${shown} ${shown === 1 ? one : many}`;
    return `${shown} of ${total} ${many}`;
  }

  function refreshList(toolbar, { announce = false } = {}) {
    if (!toolbar || typeof toolbar.getAttribute !== 'function') return null;
    const list = document.getElementById(toolbar.getAttribute('data-list-target') ?? '');
    if (!list) return null;
    const items = [...list.children].filter((child) => child.hasAttribute('data-list-item'));
    const terms = wordsOf(toolbar.querySelector('[data-list-search]')?.value);
    const filters = [...toolbar.querySelectorAll('[data-list-filter]')].map((group) => ({
      group,
      key: group.getAttribute('data-list-filter'),
      values: chosenIn(group),
    }));
    const shown = items.filter((item) => itemMatches(item, terms, filters));
    for (const item of items) setHidden(item, !shown.includes(item));

    const [key, direction] = String(toolbar.querySelector('[data-list-sort]')?.value ?? '').split(
      ':',
    );
    if (key) {
      const order = direction === 'desc' ? -1 : 1;
      const sortValue = (item) => item.getAttribute(`data-sort-${key}`) ?? '';
      const sorted = [...items].sort(
        (a, b) =>
          order * compareValues(sortValue(a), sortValue(b)) || items.indexOf(a) - items.indexOf(b),
      );
      if (sorted.some((item, index) => item !== items[index])) list.append(...sorted);
    }

    for (const { group, key: groupKey } of filters) {
      const pool = items.filter((item) => itemMatches(item, terms, filters, groupKey));
      for (const input of group.querySelectorAll('input')) {
        const counter = input.closest('label')?.querySelector('.list-toolbar-count');
        if (!counter) continue;
        const count =
          !input.value || input.value === 'all'
            ? pool.length
            : pool.filter((item) => tokensOf(item, groupKey).includes(input.value)).length;
        if (counter.textContent !== String(count)) counter.textContent = String(count);
      }
    }

    const text = listResult(toolbar, shown.length, items.length);
    const count = toolbar.querySelector('[data-list-count]');
    if (count && count.textContent !== text) count.textContent = text;
    setHidden(
      document.getElementById(toolbar.getAttribute('data-list-empty') ?? ''),
      shown.length > 0,
    );
    if (announce) speak(channelIn(toolbar), `${text}.`);
    toolbar.dispatchEvent(
      new CustomEvent('jobdeputy:listchange', {
        bubbles: true,
        detail: { shown: shown.length, total: items.length },
      }),
    );
    return { shown: shown.length, total: items.length, text };
  }

  function initList(toolbar) {
    if (!toolbar || readyLists.has(toolbar)) {
      refreshList(toolbar);
      return;
    }
    readyLists.add(toolbar);
    // Typing filters at once and speaks when it pauses; a chip or the sort speaks at once.
    toolbar.addEventListener('input', (event) => {
      if (!event.target?.matches?.('[data-list-search]')) return;
      refreshList(toolbar);
      window.clearTimeout(listTimers.get(toolbar));
      listTimers.set(
        toolbar,
        window.setTimeout(() => refreshList(toolbar, { announce: true }), LIST_TYPING_MS),
      );
    });
    toolbar.addEventListener('change', (event) => {
      if (event.target?.matches?.('[data-list-search]')) return;
      refreshList(toolbar, { announce: true });
    });
    toolbar.addEventListener('submit', (event) => event.preventDefault());
    refreshList(toolbar);
  }

  // ---------------------------------------------------------------- paper

  // paper.markdown(text) reads a small, safe Markdown: # the name (the next line is the contact
  // line), ## sections, ### entries, paragraphs, - and 1. lists, ---, **bold**, *italic*, `code`,
  // and [text](address) as its text. It builds elements with text nodes only, so nothing in the text
  // can become markup. paper.render(stack, markdown or blocks, { template, limit }) lays the blocks
  // into US letter pages measured at true size (a list splits between items; a heading moves on
  // with what follows it), fills the stack's .paper-pages, sets its [data-paper-count] text, and
  // returns { pages, limit, over, overflowLines, text }. paper.print(stack) prints only those pages.
  const PAGE_WIDTH = 816;
  const LINE_FALLBACK = 20;
  const isList = (block) => /^(?:ul|ol)$/i.test(String(block?.tagName));
  const isHeading = (block) => /^h[1-3]$/i.test(String(block?.tagName));

  const INLINE = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]*)\)/g;

  function inlineInto(parent, text) {
    let last = 0;
    for (const match of String(text).matchAll(INLINE)) {
      if (match.index > last) parent.append(document.createTextNode(text.slice(last, match.index)));
      const [, strong, em, code, linkText] = match;
      if (strong) parent.append(make('strong', {}, strong));
      else if (em) parent.append(make('em', {}, em));
      else if (code) parent.append(make('code', {}, code));
      else parent.append(make('span', { class: 'paper-link' }, linkText));
      last = match.index + match[0].length;
    }
    if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
    return parent;
  }

  function markdownBlocks(source, shift = 0) {
    const blocks = [];
    let paragraph = null;
    let list = null;
    for (const raw of String(source ?? '')
      .replace(/\r\n?/g, '\n')
      .split('\n')) {
      const line = raw.trim();
      if (!line) {
        paragraph = null;
        list = null;
        continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        paragraph = null;
        list = null;
        blocks.push(inlineInto(make(`h${Math.min(6, heading[1].length + shift)}`), heading[2]));
        continue;
      }
      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
        paragraph = null;
        list = null;
        blocks.push(make('hr'));
        continue;
      }
      const item = line.match(/^(?:([-*+])|\d+[.)])\s+(.+)$/);
      if (item) {
        const tag = item[1] ? 'ul' : 'ol';
        if (!list || String(list.tagName).toLowerCase() !== tag) {
          list = make(tag);
          blocks.push(list);
        }
        paragraph = null;
        list.append(inlineInto(make('li'), item[2]));
        continue;
      }
      list = null;
      if (paragraph) {
        paragraph.append(document.createTextNode(' '));
        inlineInto(paragraph, line);
      } else {
        paragraph = inlineInto(make('p'), line);
        blocks.push(paragraph);
      }
    }
    const [first, second] = blocks;
    if (/^h1$/i.test(String(first?.tagName)) && /^p$/i.test(String(second?.tagName))) {
      second.classList.add('paper-contact');
    }
    return blocks;
  }

  // The preview's Text view: the document's headings (one level under the dialog's title), lists,
  // and paragraphs, so a screen reader can move by heading and list (round 4, UAT-A-14). Plain
  // words a page passes in, or ready-made blocks, become paragraphs.
  function fillWords(host, words, markdown, blocks) {
    host.textContent = '';
    if (typeof words !== 'string' && typeof markdown === 'string') {
      for (const block of markdownBlocks(markdown, 2)) {
        const tag = String(block?.tagName ?? '').toLowerCase();
        if (tag === 'hr') continue;
        if (/^h[3-6]$/.test(tag)) block.classList?.add('doc-preview-words-heading');
        host.append(block);
      }
      return;
    }
    const text = typeof words === 'string' ? words : plainText(blocks);
    for (const part of String(text).split(/\n\s*\n/)) {
      const line = part.trim();
      if (line) host.append(make('p', {}, line));
    }
  }

  // The words of the blocks as plain text, for the preview's text view.
  const plainText = (blocks) =>
    blocks
      .map((block) =>
        isList(block)
          ? [...block.children].map((item) => `• ${item.textContent}`).join('\n')
          : block.textContent,
      )
      .filter(Boolean)
      .join('\n\n');

  // A sheet at true size, out of sight, to measure pages in.
  function measurer(template) {
    const sheet = make('div', {
      class: 'paper-sheet paper-measure',
      'aria-hidden': 'true',
      'data-template': template || null,
    });
    const content = make('div', { class: 'paper-content' });
    const flow = make('div', { class: 'paper-flow' });
    content.append(flow);
    sheet.append(content);
    document.body.append(sheet);
    const style = getComputedStyle(content);
    const padding =
      (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
    const room = (content.clientHeight || 0) - padding;
    const line = Number.parseFloat(getComputedStyle(flow).lineHeight) || LINE_FALLBACK;
    return { sheet, flow, room: room > 0 ? room : Number.POSITIVE_INFINITY, line };
  }

  // Moves as many of a list's items as fit into a new list in the flow; the rest stay behind.
  function splitList(list, flow, fits) {
    const tag = String(list.tagName).toLowerCase();
    const head = make(tag);
    flow.append(head);
    const items = [...list.children];
    let placed = 0;
    for (const item of items) {
      head.append(item);
      if (!fits()) {
        item.remove();
        break;
      }
      placed += 1;
    }
    if (placed === 0 || placed === items.length) {
      head.remove();
      for (const item of items) list.append(item);
      return null;
    }
    const tail = make(tag);
    for (const item of items.slice(placed)) tail.append(item);
    return { head, tail };
  }

  function paginate(blocks, template, limit) {
    const { sheet, flow, room, line } = measurer(template);
    const fits = () => flow.offsetHeight <= room + 0.5;
    let page = [];
    const pages = [page];
    const startPage = (carried) => {
      page = carried;
      pages.push(page);
      flow.textContent = '';
      for (const block of page) flow.append(block);
    };
    const queue = [...blocks];
    try {
      while (queue.length) {
        const block = queue.shift();
        flow.append(block);
        if (fits()) {
          page.push(block);
          continue;
        }
        block.remove();
        const split = isList(block) ? splitList(block, flow, fits) : null;
        if (split) {
          page.push(split.head);
          queue.unshift(split.tail);
          startPage([]);
          continue;
        }
        if (!page.length) {
          // Alone and still too tall: it keeps the page, cut at the foot.
          flow.append(block);
          page.push(block);
          startPage([]);
          continue;
        }
        // A heading at the foot of a page goes on with what follows it.
        const carried = [];
        while (page.length > 1 && isHeading(page[page.length - 1])) carried.unshift(page.pop());
        startPage(carried);
        queue.unshift(block);
      }
      if (!page.length && pages.length > 1) pages.pop();
      // Lines past the page setting: each extra page's flow in body lines.
      let overflowLines = 0;
      for (const extra of pages.slice(limit)) {
        flow.textContent = '';
        for (const block of extra) flow.append(block);
        overflowLines += Math.ceil(flow.offsetHeight / line);
      }
      return { pages, overflowLines };
    } finally {
      sheet.remove();
    }
  }

  function pageSheet(blocks, template) {
    const sheet = make('div', {
      class: 'paper-sheet',
      'aria-hidden': 'true',
      'data-template': template || null,
    });
    const content = make('div', { class: 'paper-content' });
    const flow = make('div', { class: 'paper-flow' });
    for (const block of blocks) flow.append(block.cloneNode(true));
    content.append(flow);
    sheet.append(content);
    return sheet;
  }

  function pageFigure(blocks, index, limit, template) {
    const over = index >= limit;
    const figure = make('figure', { class: over ? 'paper is-over' : 'paper' });
    figure.append(
      pageSheet(blocks, template),
      make(
        'figcaption',
        { class: 'paper-number' },
        over ? `Page ${index + 1} · past your ${limit}-page setting` : `Page ${index + 1}`,
      ),
    );
    return figure;
  }

  function renderPaper(stack, source, options = {}) {
    if (!stack || typeof stack.querySelector !== 'function') return null;
    const template = options.template || stack.getAttribute('data-template') || 'classic';
    const limit = Math.max(
      1,
      wholeOrNull(options.limit ?? stack.getAttribute('data-page-limit')) ?? 1,
    );
    stack.setAttribute('data-template', template);
    stack.setAttribute('data-page-limit', String(limit));
    const blocks = Array.isArray(source) ? source : markdownBlocks(source);
    const { pages, overflowLines } = paginate(blocks, template, limit);
    let holder = stack.querySelector('.paper-pages');
    if (!holder) {
      holder = make('div', { class: 'paper-pages' });
      stack.append(holder);
    }
    holder.textContent = '';
    pages.forEach((page, index) => {
      holder.append(pageFigure(page, index, limit, template));
    });
    const over = pages.length > limit;
    const text = over
      ? `Runs to ${pages.length} pages`
      : `${pages.length} of ${limit} ${limit === 1 ? 'page' : 'pages'}`;
    const count = stack.querySelector('[data-paper-count]');
    if (count) {
      count.textContent = text;
      count.classList.toggle('is-over', over);
    }
    const result = {
      pages: pages.length,
      limit,
      over,
      overflowLines: over ? overflowLines : 0,
      text,
    };
    stack.dispatchEvent(new CustomEvent('jobdeputy:paper', { bubbles: true, detail: result }));
    return result;
  }

  // Prints only this stack's pages: it marks the stack for the print stylesheet, prints, and puts
  // back whatever was marked before.
  function printPaper(stack) {
    if (!stack || typeof window.print !== 'function') return false;
    const marked = stack.hasAttribute('data-paper-print');
    const others = [...document.querySelectorAll('[data-paper-print]')].filter(
      (other) => other !== stack,
    );
    for (const other of others) other.removeAttribute('data-paper-print');
    stack.setAttribute('data-paper-print', '');
    const restore = () => {
      if (!marked) stack.removeAttribute('data-paper-print');
      for (const other of others) other.setAttribute('data-paper-print', '');
    };
    window.addEventListener?.('afterprint', restore, { once: true });
    window.print();
    return true;
  }

  // ---------------------------------------------------------------- download

  // download({ title, markdown, words }, 'pdf' | 'md') saves a document from this browser (round 5,
  // R1): the Markdown as written (.md), or a simple PDF made here from its text (.pdf: PDF 1.4,
  // US Letter, Helvetica, with its headings, paragraphs, bullets and numbered lists, rules,
  // wrapping, and page breaks). The file is named for the document's title. Nothing is sent
  // anywhere. download.build(document, format) returns the file without saving it: { ok, name,
  // type, bytes, text, pages }. downloadMenu(host, document, { channel }) puts the shared small
  // Download menu (PDF and Markdown, with what each holds) in host, or wires the one already there.
  const PDF_PAGE = { width: 612, height: 792, margin: 72 };
  const PDF_NOTE = 'A simple PDF of this text; the product’s PDF matches the template.';
  const INK_RGB = '0.106 0.102 0.094 rg';
  const MUTED_RGB = '0.439 0.427 0.4 rg';

  // Adobe's Helvetica and Helvetica-Bold widths (per 1000 units of the font size) for the
  // WinAnsi codes 32 to 255, in order (codes WinAnsi leaves undefined are 0); the oblique faces
  // share them, and Courier is 600 throughout.
  const fontWidths = (values) => [...new Array(32).fill(0), ...values];
  const HELVETICA = fontWidths([
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
    611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
    667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
    222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
    0, 556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222,
    333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556,
    260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333,
    333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667,
    278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667,
    611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556,
    556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
  ]);
  const HELVETICA_BOLD = fontWidths([
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
    611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
    667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
    278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
    0, 556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278,
    500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556,
    280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333,
    333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667,
    278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667,
    611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611,
    611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
  ]);
  const PDF_FONTS = {
    regular: { name: 'F1', base: 'Helvetica', widths: HELVETICA },
    bold: { name: 'F2', base: 'Helvetica-Bold', widths: HELVETICA_BOLD },
    italic: { name: 'F3', base: 'Helvetica-Oblique', widths: HELVETICA },
    boldItalic: { name: 'F4', base: 'Helvetica-BoldOblique', widths: HELVETICA_BOLD },
    code: { name: 'F5', base: 'Courier', widths: new Array(256).fill(600) },
  };

  // Unicode to WinAnsi: Latin-1 as itself, the Windows extras from 0x80 to 0x9F, and anything
  // else as a question mark (the Text view and the .md keep every character).
  const WIN_ANSI = new Map(
    [
      [0x20ac, 128],
      [0x201a, 130],
      [0x0192, 131],
      [0x201e, 132],
      [0x2026, 133],
      [0x2020, 134],
      [0x2021, 135],
      [0x02c6, 136],
      [0x2030, 137],
      [0x0160, 138],
      [0x2039, 139],
      [0x0152, 140],
      [0x017d, 142],
      [0x2018, 145],
      [0x2019, 146],
      [0x201c, 147],
      [0x201d, 148],
      [0x2022, 149],
      [0x2013, 150],
      [0x2014, 151],
      [0x02dc, 152],
      [0x2122, 153],
      [0x0161, 154],
      [0x203a, 155],
      [0x0153, 156],
      [0x017e, 158],
      [0x0178, 159],
    ].map(([unicode, code]) => [unicode, code]),
  );
  function winAnsi(text) {
    const codes = [];
    for (const character of String(text).normalize('NFC')) {
      const point = character.codePointAt(0) ?? 63;
      if (point === 0x09) codes.push(32);
      else if (point >= 32 && point < 127) codes.push(point);
      else if (point >= 160 && point <= 255) codes.push(point);
      else codes.push(WIN_ANSI.get(point) ?? 63);
    }
    return codes;
  }
  const widthOf = (codes, font, size) =>
    (codes.reduce((sum, code) => sum + (font.widths[code] || 556), 0) * size) / 1000;

  // A PDF string: the WinAnsi codes, with \, (, ), and every code outside printable ASCII
  // escaped, so the content stream stays plain ASCII.
  const pdfString = (codes) =>
    `(${codes
      .map((code) => {
        if (code === 92 || code === 40 || code === 41) return `\\${String.fromCharCode(code)}`;
        if (code < 32 || code > 126) return `\\${code.toString(8).padStart(3, '0')}`;
        return String.fromCharCode(code);
      })
      .join('')})`;
  // A text string outside the content (the title): UTF-16BE with its byte-order mark, in hex.
  const pdfText = (text) =>
    `<FEFF${[...String(text)]
      .flatMap((character) => {
        const point = character.codePointAt(0) ?? 63;
        if (point <= 0xffff) return [point];
        const high = Math.floor((point - 0x10000) / 0x400) + 0xd800;
        return [high, ((point - 0x10000) % 0x400) + 0xdc00];
      })
      .map((unit) => unit.toString(16).toUpperCase().padStart(4, '0'))
      .join('')}>`;

  // The document as data, with the rules paper.markdown reads it by: # the name (the next line is
  // the contact line), ## and ### headings, paragraphs, - and 1. lists, ---, **bold**, *italic*,
  // `code`, and [text](address) as its text.
  function markdownModel(source) {
    const runsOf = (text) => {
      const runs = [];
      let last = 0;
      for (const match of String(text).matchAll(INLINE)) {
        if (match.index > last) runs.push({ text: text.slice(last, match.index) });
        const [, strong, em, code, linkText] = match;
        if (strong) runs.push({ text: strong, bold: true });
        else if (em) runs.push({ text: em, italic: true });
        else if (code) runs.push({ text: code, code: true });
        else runs.push({ text: linkText });
        last = match.index + match[0].length;
      }
      if (last < text.length) runs.push({ text: text.slice(last) });
      return runs;
    };
    const blocks = [];
    let paragraph = null;
    let list = null;
    for (const raw of String(source ?? '')
      .replace(/\r\n?/g, '\n')
      .split('\n')) {
      const line = raw.trim();
      if (!line) {
        paragraph = null;
        list = null;
        continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        paragraph = null;
        list = null;
        blocks.push({ type: `h${heading[1].length}`, runs: runsOf(heading[2]) });
        continue;
      }
      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
        paragraph = null;
        list = null;
        blocks.push({ type: 'hr' });
        continue;
      }
      const item = line.match(/^(?:([-*+])|\d+[.)])\s+(.+)$/);
      if (item) {
        const type = item[1] ? 'ul' : 'ol';
        if (!list || list.type !== type) {
          list = { type, items: [] };
          blocks.push(list);
        }
        paragraph = null;
        list.items.push(runsOf(item[2]));
        continue;
      }
      list = null;
      if (paragraph) paragraph.runs.push({ text: ' ' }, ...runsOf(line));
      else {
        paragraph = { type: 'p', runs: runsOf(line) };
        blocks.push(paragraph);
      }
    }
    if (blocks[0]?.type === 'h1' && blocks[1]?.type === 'p') blocks[1].contact = true;
    return blocks;
  }

  // Plain words (a page's own text) as Markdown: each paragraph as written.
  const wordsAsMarkdown = (words) =>
    String(words ?? '')
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n\n');

  const PDF_STYLES = {
    h1: { size: 20, leading: 24, before: 0, after: 4, font: 'bold' },
    contact: { size: 10, leading: 13, before: 0, after: 14, font: 'regular', muted: true },
    h2: { size: 13, leading: 16, before: 12, after: 6, font: 'bold', rule: true },
    h3: { size: 11, leading: 14, before: 8, after: 2, font: 'bold' },
    p: { size: 10.5, leading: 14, before: 0, after: 6, font: 'regular' },
    li: { size: 10.5, leading: 14, before: 0, after: 2, font: 'regular' },
  };

  const faceOf = (run, base) => {
    if (run.code) return PDF_FONTS.code;
    const bold = run.bold || base === 'bold';
    if (bold && run.italic) return PDF_FONTS.boldItalic;
    if (bold) return PDF_FONTS.bold;
    if (run.italic) return PDF_FONTS.italic;
    return PDF_FONTS.regular;
  };

  // Lays runs into lines no wider than width: each line a list of { font, codes } pieces. A word
  // longer than a line breaks between letters.
  function wrapRuns(runs, style, width) {
    const words = [];
    for (const run of runs) {
      const font = faceOf(run, style.font);
      for (const piece of String(run.text).split(/(\s+)/)) {
        if (!piece) continue;
        words.push({
          font,
          codes: winAnsi(/^\s+$/.test(piece) ? ' ' : piece),
          space: /^\s+$/.test(piece),
        });
      }
    }
    const lines = [];
    let line = [];
    let used = 0;
    const flush = () => {
      while (line.length && line.at(-1).space) line.pop();
      if (line.length) lines.push(line);
      line = [];
      used = 0;
    };
    for (const word of words) {
      if (word.space && !line.length) continue;
      const wide = widthOf(word.codes, word.font, style.size);
      if (used + wide <= width || word.space) {
        line.push(word);
        used += wide;
        continue;
      }
      if (!word.space && wide > width) {
        // Too long for any line: break it between letters.
        flush();
        let codes = [];
        for (const code of word.codes) {
          if (codes.length && widthOf([...codes, code], word.font, style.size) > width) {
            lines.push([{ font: word.font, codes }]);
            codes = [];
          }
          codes.push(code);
        }
        line = [{ font: word.font, codes }];
        used = widthOf(codes, word.font, style.size);
        continue;
      }
      flush();
      line.push(word);
      used = wide;
    }
    flush();
    return lines;
  }

  // The pages' drawing: each page a list of content-stream lines, from the document's blocks.
  function layoutPdf(blocks) {
    const { width: pageWidth, height: pageHeight, margin } = PDF_PAGE;
    const textWidth = pageWidth - margin * 2;
    const bottom = margin;
    const pages = [];
    let ops = [];
    let y = pageHeight - margin;
    const newPage = () => {
      if (ops.length) pages.push(ops);
      ops = [];
      y = pageHeight - margin;
    };
    const room = (height) => y - height >= bottom;
    // One line of text: a run of each face in turn, each shown with one Tj.
    const drawLine = (pieces, x, size, muted) => {
      const runs = [];
      for (const piece of pieces) {
        const last = runs.at(-1);
        if (last && last.font === piece.font) last.codes.push(...piece.codes);
        else runs.push({ font: piece.font, codes: [...piece.codes] });
      }
      const parts = [
        muted ? MUTED_RGB : INK_RGB,
        'BT',
        `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`,
      ];
      for (const run of runs) parts.push(`/${run.font.name} ${size} Tf ${pdfString(run.codes)} Tj`);
      parts.push('ET');
      ops.push(parts.join(' '));
    };
    blocks.forEach((block, index) => {
      if (block.type === 'hr') {
        if (!room(14)) newPage();
        y -= 7;
        ops.push(
          `0.6 w 0.75 0.73 0.7 RG ${margin} ${y.toFixed(2)} m ${pageWidth - margin} ${y.toFixed(2)} l S`,
        );
        y -= 7;
        return;
      }
      const style =
        PDF_STYLES[
          block.contact ? 'contact' : block.type === 'ul' || block.type === 'ol' ? 'li' : block.type
        ] ?? PDF_STYLES.p;
      if (block.type === 'ul' || block.type === 'ol') {
        block.items.forEach((runs, itemIndex) => {
          const marker = block.type === 'ul' ? '•' : `${itemIndex + 1}.`;
          const lines = wrapRuns(runs, style, textWidth - 18);
          lines.forEach((pieces, lineIndex) => {
            if (!room(style.leading)) newPage();
            y -= style.leading;
            if (lineIndex === 0) {
              const markerCodes = winAnsi(marker);
              const markerWidth = widthOf(markerCodes, PDF_FONTS.regular, style.size);
              drawLine(
                [{ font: PDF_FONTS.regular, codes: markerCodes }],
                margin + 12 - markerWidth,
                style.size,
              );
            }
            drawLine(pieces, margin + 18, style.size);
          });
          y -= style.after;
        });
        y -= PDF_STYLES.p.after;
        return;
      }
      const lines = wrapRuns(block.runs, style, textWidth);
      if (!lines.length) return;
      // A heading moves on with the first lines of what follows it.
      const next = blocks[index + 1];
      const keep =
        /^h[1-3]$/.test(block.type) && next && next.type !== 'hr' ? 2 * PDF_STYLES.p.leading : 0;
      const firstHeight = style.before + style.leading + keep;
      if (y < pageHeight - margin && !room(firstHeight)) newPage();
      if (y < pageHeight - margin) y -= style.before;
      for (const pieces of lines) {
        if (!room(style.leading)) newPage();
        y -= style.leading;
        drawLine(pieces, margin, style.size, style.muted);
      }
      if (style.rule) {
        ops.push(
          `0.6 w 0.75 0.73 0.7 RG ${margin} ${(y - 4).toFixed(2)} m ${pageWidth - margin} ${(y - 4).toFixed(2)} l S`,
        );
        y -= 4;
      }
      y -= style.after;
    });
    if (ops.length || !pages.length) pages.push(ops);
    return pages;
  }

  // A valid PDF 1.4 file: the catalog, the page tree, the five standard fonts, a page and its
  // content stream for each page (with "Page 2 of 3" under the text when there is more than one),
  // and the document information, with a cross-reference table of exact byte offsets.
  function pdfFile(blocks, { title, date = new Date() } = {}) {
    const pages = layoutPdf(blocks);
    const count = pages.length;
    const objects = [];
    const add = (body) => {
      objects.push(body);
      return objects.length;
    };
    const catalog = add('');
    const tree = add('');
    const fontRefs = Object.values(PDF_FONTS).map((font) => ({
      font,
      ref: add(
        `<< /Type /Font /Subtype /Type1 /BaseFont /${font.base} /Encoding /WinAnsiEncoding >>`,
      ),
    }));
    const resources = `<< /Font << ${fontRefs.map(({ font, ref }) => `/${font.name} ${ref} 0 R`).join(' ')} >> >>`;
    const kids = pages.map((ops, index) => {
      const footer = [];
      if (count > 1) {
        const words = winAnsi(`Page ${index + 1} of ${count}`);
        const size = 8;
        const x = (PDF_PAGE.width - widthOf(words, PDF_FONTS.regular, size)) / 2;
        footer.push(
          `${MUTED_RGB} BT /F1 ${size} Tf 1 0 0 1 ${x.toFixed(2)} 40 Tm ${pdfString(words)} Tj ET`,
        );
      }
      const stream = [...ops, ...footer].join('\n');
      const contents = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      return add(
        `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${PDF_PAGE.width} ${PDF_PAGE.height}] /Resources ${resources} /Contents ${contents} 0 R >>`,
      );
    });
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R /Lang (en-US) >>`;
    objects[tree - 1] =
      `<< /Type /Pages /Kids [${kids.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${count} >>`;
    const stamp = (value) => String(value).padStart(2, '0');
    const created = `D:${date.getUTCFullYear()}${stamp(date.getUTCMonth() + 1)}${stamp(date.getUTCDate())}${stamp(date.getUTCHours())}${stamp(date.getUTCMinutes())}${stamp(date.getUTCSeconds())}Z`;
    const info = add(
      `<< /Title ${pdfText(title)} /Creator (JobDeputy prototype) /Producer (JobDeputy prototype) /CreationDate (${created}) >>`,
    );
    // The file is ASCII but for the four bytes of the binary comment, so offsets count characters.
    let file = '%PDF-1.4\n%âãÏÓ\n';
    const offsets = [];
    objects.forEach((body, index) => {
      offsets.push(file.length);
      file += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = file.length;
    file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) file += `${String(offset).padStart(10, '0')} 00000 n \n`;
    file += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(file.length);
    for (let index = 0; index < file.length; index += 1)
      bytes[index] = file.charCodeAt(index) & 0xff;
    return { bytes, text: file, pages: count };
  }

  // The file name: the document's title, without characters a file name cannot hold, and without
  // an extension of its own ("Alex_Morgan_Resume.pdf" saves as Alex_Morgan_Resume.md, not .pdf.md).
  function fileName(title, extension) {
    const base =
      String(title ?? '')
        .normalize('NFC')
        .replace(/\.(?:pdf|docx?|md|markdown|txt|rtf|odt|csv)$/i, '')
        .split('')
        .map((character) => (character.charCodeAt(0) < 32 ? ' ' : character))
        .join('')
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+/, '')
        .slice(0, 80)
        .trim() || 'Document';
    return `${base}.${extension}`;
  }

  function utf8Bytes(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text);
    const escaped = unescape(encodeURIComponent(text));
    const bytes = new Uint8Array(escaped.length);
    for (let index = 0; index < escaped.length; index += 1)
      bytes[index] = escaped.charCodeAt(index);
    return bytes;
  }

  const DOWNLOAD_FORMATS = ['pdf', 'md', 'csv'];

  function buildDownload(doc = {}, format = 'pdf') {
    if (!DOWNLOAD_FORMATS.includes(format)) return { ok: false, reason: 'unknown-format' };
    const title = String(doc?.title ?? '').trim() || 'Document';
    // Round 7 (SE1, SA's request 2): a table as CSV text the store made ({ title, csv }), saved as
    // text/csv in UTF-8 with a byte order mark so a spreadsheet reads its accents.
    if (format === 'csv') {
      const csv = typeof doc?.csv === 'string' ? doc.csv : '';
      if (!csv.trim()) return { ok: false, reason: 'empty' };
      const text = csv.endsWith('\n') ? csv : `${csv}\n`;
      return {
        ok: true,
        name: fileName(title, 'csv'),
        type: 'text/csv;charset=utf-8',
        bytes: utf8Bytes(`\ufeff${text}`),
        text,
        pages: null,
      };
    }
    const markdown =
      typeof doc?.markdown === 'string' && doc.markdown.trim()
        ? doc.markdown
        : wordsAsMarkdown(doc?.words);
    if (!markdown.trim()) return { ok: false, reason: 'empty' };
    if (format === 'md') {
      const text = markdown.endsWith('\n') ? markdown : `${markdown}\n`;
      return {
        ok: true,
        name: fileName(title, 'md'),
        type: 'text/markdown;charset=utf-8',
        bytes: utf8Bytes(text),
        text,
        pages: null,
      };
    }
    const pdf = pdfFile(markdownModel(markdown), { title, date: doc?.date ?? new Date() });
    return { ok: true, name: fileName(title, 'pdf'), type: 'application/pdf', ...pdf };
  }

  // Saves the file through a link with the download attribute, as a browser saves any download.
  function saveDownload(doc, format = 'pdf') {
    const file = buildDownload(doc, format);
    if (!file.ok) return file;
    if (typeof Blob !== 'function' || typeof URL?.createObjectURL !== 'function') {
      return { ...file, ok: false, reason: 'unsupported' };
    }
    const url = URL.createObjectURL(new Blob([file.bytes], { type: file.type }));
    const link = make('a', { href: url, download: file.name, hidden: true });
    document.body.append(link);
    link.click?.();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    return {
      ok: true,
      name: file.name,
      type: file.type,
      pages: file.pages,
      size: file.bytes.length,
    };
  }

  // The shared Download menu: a button that opens two choices, PDF and Markdown (.md), each with
  // what it holds, and the note that the PDF is a simple one. Escape and a click elsewhere close
  // it, focus returns to the button, and each download is said once.
  const menus = new WeakMap();
  let menuSerial = 0;
  function downloadMenu(host, source, options = {}) {
    if (!host || typeof host.querySelector !== 'function') return null;
    let menu = host.classList?.contains('download-menu')
      ? host
      : host.querySelector('.download-menu');
    if (!menu) {
      menuSerial += 1;
      const id = `jd-download-${menuSerial}`;
      menu = make('div', { class: 'download-menu', 'data-download-menu': true });
      const toggle = make('button', {
        type: 'button',
        class: 'secondary-action download-menu-toggle',
        'aria-expanded': 'false',
        'aria-controls': id,
        'data-download-toggle': true,
      });
      toggle.append(document.createTextNode('Download'));
      const list = make('div', { class: 'download-menu-list', id, hidden: true });
      const choice = (format, label, meta) => {
        const button = make('button', {
          type: 'button',
          class: 'download-menu-choice',
          'data-download-format': format,
        });
        button.append(
          make('span', { class: 'download-menu-name' }, label),
          make('span', { class: 'download-menu-meta' }, meta),
        );
        return button;
      };
      list.append(
        choice('pdf', 'PDF', 'US Letter, with its headings and lists'),
        choice('md', 'Markdown (.md)', 'The text as written, to edit anywhere'),
        make('p', { class: 'download-menu-note' }, PDF_NOTE),
      );
      menu.append(toggle, list);
      host.append(menu);
    }
    const state = menus.get(menu) ?? { source: null, options: {} };
    state.source = source;
    state.options = options;
    if (!menus.has(menu)) {
      menus.set(menu, state);
      const toggle = menu.querySelector('[data-download-toggle]');
      const list = menu.querySelector('.download-menu-list');
      const setOpen = (open, { focus = false } = {}) => {
        setHidden(list, !open);
        toggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (!open && focus) toggle?.focus();
      };
      toggle?.addEventListener('click', () => setOpen(list.hasAttribute('hidden')));
      menu.addEventListener('click', (event) => {
        const button = event.target?.closest?.('[data-download-format]');
        if (!button) return;
        const current = menus.get(menu);
        const doc = typeof current.source === 'function' ? current.source() : current.source;
        const result = saveDownload(doc ?? {}, button.getAttribute('data-download-format'));
        setOpen(false, { focus: true });
        const words = result.ok
          ? `Downloaded ${result.name}.`
          : 'We couldn’t make the file. Copy the text from the Text view instead.';
        announce(words, current.options.channel ?? menu);
        current.options.onDownload?.(result);
      });
      menu.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || list.hasAttribute('hidden')) return;
        event.stopPropagation();
        event.preventDefault?.();
        setOpen(false, { focus: true });
      });
      document.addEventListener('click', (event) => {
        if (list.hasAttribute('hidden') || menu.contains(event.target)) return;
        setOpen(false);
      });
      menu.addEventListener('focusout', (event) => {
        if (
          list.hasAttribute('hidden') ||
          (event.relatedTarget && menu.contains(event.relatedTarget))
        )
          return;
        if (event.relatedTarget) setOpen(false);
      });
    }
    return {
      menu,
      close: () => {
        setHidden(menu.querySelector('.download-menu-list'), true);
        menu.querySelector('[data-download-toggle]')?.setAttribute('aria-expanded', 'false');
      },
    };
  }

  // ---------------------------------------------------------------- document preview

  // preview.open({ title, meta, source, template, words, page, view }, opener) shows a document in
  // one shared modal dialog: a Pages and Text switch (an ARIA tablist) above one labelled scroll
  // region that holds either the page, large, or the words at a reading measure; "Page 1 of 2"
  // with Previous and Next page and a thumbnail for each page while Pages shows; and Download
  // (round 5, R1), the shared small menu with PDF and Markdown (.md), named for the title. The
  // dialog and its footer never change size or move. view: 'text' opens on the words (Pages
  // otherwise); download: false leaves Download out. Escape (a first Escape closes an open
  // Download menu), Close, and a click on the backdrop close it; focus returns to the opener.
  const preview = {
    dialog: null,
    parts: null,
    pages: [],
    template: 'classic',
    index: 0,
    opener: null,
    view: 'pages',
    document: null,
  };
  const PREVIEW_VIEWS = ['pages', 'text'];

  function previewNode() {
    if (preview.dialog) return preview.dialog;
    const dialog = make('dialog', {
      class: 'doc-preview',
      'aria-labelledby': 'jd-preview-title',
      'aria-describedby': 'jd-preview-meta',
    });
    const header = make('div', { class: 'doc-preview-header' });
    const eyebrow = make('p', { class: 'eyebrow' }, 'Preview');
    const title = make('h2', { class: 'doc-preview-title', id: 'jd-preview-title' });
    const meta = make('p', { class: 'doc-preview-meta', id: 'jd-preview-meta' });
    const close = make(
      'button',
      { type: 'button', class: 'compact-action doc-preview-close', 'data-preview-close': true },
      'Close',
    );
    header.append(eyebrow, title, meta, close);

    const body = make('div', { class: 'doc-preview-body', 'data-view': 'pages' });
    // Pages or Text: the shared tabs pattern, each tab's panel inside the one scroll region.
    const tabs = make('div', {
      class: 'tabs doc-preview-tabs',
      role: 'tablist',
      'aria-label': 'Show the document as',
      'data-tabs': true,
    });
    const pagesTab = make(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: 'jd-preview-tab-pages',
        'aria-controls': 'jd-preview-pages',
        'aria-selected': 'true',
        'data-preview-view': 'pages',
      },
      'Pages',
    );
    const textTab = make(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: 'jd-preview-tab-text',
        'aria-controls': 'jd-preview-text',
        'aria-selected': 'false',
        tabindex: '-1',
        'data-preview-view': 'text',
      },
      'Text',
    );
    tabs.append(pagesTab, textTab);
    const thumbs = make('ol', { class: 'doc-preview-thumbs', 'aria-label': 'Pages' });
    const main = make('div', { class: 'doc-preview-main' });
    const stage = make('section', { class: 'doc-preview-stage', tabindex: '0' });
    const pagesPanel = make('div', {
      class: 'doc-preview-pages',
      id: 'jd-preview-pages',
      role: 'tabpanel',
      'aria-labelledby': 'jd-preview-tab-pages',
      tabindex: '-1',
    });
    const text = make('div', {
      class: 'doc-preview-text',
      id: 'jd-preview-text',
      role: 'tabpanel',
      'aria-labelledby': 'jd-preview-tab-text',
      tabindex: '-1',
      hidden: true,
    });
    const words = make('div', { class: 'doc-preview-words' });
    text.append(words);
    stage.append(pagesPanel, text);
    const pager = make('div', { class: 'doc-preview-pager' });
    // "Previous" and "Next" in sight, "page" for assistive technology, so the pager keeps one row
    // on a 320px phone.
    const previous = make('button', {
      type: 'button',
      class: 'compact-action',
      'data-preview-step': '-1',
    });
    previous.append(
      document.createTextNode('Previous'),
      make('span', { class: 'sr-only' }, ' page'),
    );
    const count = make('p', { class: 'doc-preview-count' });
    const next = make('button', {
      type: 'button',
      class: 'compact-action',
      'data-preview-step': '1',
    });
    next.append(document.createTextNode('Next'), make('span', { class: 'sr-only' }, ' page'));
    pager.append(previous, count, next);
    main.append(stage, pager);
    body.append(tabs, thumbs, main);

    const footer = make('div', { class: 'doc-preview-footer' });
    const download = make('div', { class: 'doc-preview-download' });
    footer.append(download, make('p', { class: 'sample-note' }, 'Sample data · not connected'));
    const status = make('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    dialog.append(header, body, footer, status);
    downloadMenu(download, () => preview.document, { channel: status });

    dialog.addEventListener('click', (event) => {
      const { target } = event;
      if (target.closest?.('[data-preview-close]')) {
        closePreview();
        return;
      }
      const step = target.closest?.('[data-preview-step]');
      if (step) {
        showPreviewPage(preview.index + Number(step.getAttribute('data-preview-step')));
        return;
      }
      const thumb = target.closest?.('[data-preview-page]');
      if (thumb) {
        showPreviewPage(Number(thumb.getAttribute('data-preview-page')));
        return;
      }
      // A pointer click on the backdrop reaches the dialog itself, outside its box.
      if (target !== dialog || event.detail === 0) return;
      const box = boxOf(dialog);
      const inside =
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom;
      if (!inside) closePreview();
    });
    dialog.addEventListener('close', () => {
      const opener = preview.opener;
      preview.opener = null;
      lockPage(false);
      if (opener?.isConnected) focusInView(opener);
    });
    tabs.addEventListener('jobdeputy:tabchange', (event) => {
      showPreviewView(event.detail?.tab?.getAttribute('data-preview-view'));
    });

    document.body.append(dialog);
    preview.dialog = dialog;
    preview.parts = {
      title,
      meta,
      body,
      tabs,
      pagesTab,
      textTab,
      thumbs,
      stage,
      pagesPanel,
      text,
      pager,
      previous,
      next,
      count,
      words,
      status,
    };
    initTablist(tabs);
    return dialog;
  }

  // Pages or Text, in the same scroll region: the pager and the thumbnails show with the pages
  // only, and the region is named for what it shows. The region starts at the top of either.
  function showPreviewView(view, { select = false } = {}) {
    const { parts } = preview;
    if (!parts) return;
    const next = PREVIEW_VIEWS.includes(view) ? view : 'pages';
    preview.view = next;
    if (select) selectTab(next === 'text' ? parts.textTab : parts.pagesTab, { silent: true });
    parts.body.setAttribute('data-view', next);
    // A one-page document has nothing to page through, so its pager stays out of the way.
    setHidden(parts.pager, next !== 'pages' || preview.pages.length < 2);
    setHidden(parts.thumbs, next !== 'pages');
    parts.stage.setAttribute(
      'aria-label',
      next === 'text'
        ? 'Text of the document'
        : `Page ${preview.index + 1} of ${Math.max(1, preview.pages.length)}`,
    );
    if (typeof parts.stage.scrollTo === 'function') parts.stage.scrollTo({ top: 0 });
    else parts.stage.scrollTop = 0;
  }

  function showPreviewPage(index, { quiet = false } = {}) {
    const { parts, pages } = preview;
    if (!parts || !pages.length) return;
    const page = Math.min(Math.max(Number(index) || 0, 0), pages.length - 1);
    preview.index = page;
    const label = `Page ${page + 1} of ${pages.length}`;
    parts.pagesPanel.textContent = '';
    parts.pagesPanel.append(
      pageFigure(pages[page], page, Number.POSITIVE_INFINITY, preview.template),
    );
    if (preview.view === 'pages') parts.stage.setAttribute('aria-label', label);
    parts.count.textContent = label;
    if (page === 0) parts.previous.setAttribute('disabled', '');
    else parts.previous.removeAttribute('disabled');
    if (page === pages.length - 1) parts.next.setAttribute('disabled', '');
    else parts.next.removeAttribute('disabled');
    for (const thumb of parts.thumbs.querySelectorAll('[data-preview-page]')) {
      if (Number(thumb.getAttribute('data-preview-page')) === page)
        thumb.setAttribute('aria-current', 'true');
      else thumb.removeAttribute('aria-current');
    }
    if (!quiet) speak(parts.status, `${label}.`);
  }

  function openPreview(options = {}, opener = document.activeElement) {
    const dialog = previewNode();
    const { parts } = preview;
    const template = options.template || 'classic';
    const blocks = Array.isArray(options.source) ? options.source : markdownBlocks(options.source);
    preview.template = template;
    preview.pages = paginate(blocks, template, Number.POSITIVE_INFINITY).pages;
    parts.body.setAttribute('data-pages', String(preview.pages.length));
    parts.title.textContent = options.title || 'Document';
    parts.meta.textContent = options.meta || '';
    setHidden(parts.meta, !options.meta);
    fillWords(
      parts.words,
      options.words ?? null,
      Array.isArray(options.source) ? null : options.source,
      blocks,
    );
    parts.thumbs.textContent = '';
    preview.pages.forEach((page, index) => {
      const button = make('button', {
        type: 'button',
        class: 'doc-preview-thumb',
        'data-preview-page': String(index),
      });
      button.append(pageSheet(page, template), make('span', {}, `Page ${index + 1}`));
      const item = make('li');
      item.append(button);
      parts.thumbs.append(item);
    });
    preview.opener = opener instanceof Element && opener !== document.body ? opener : null;
    preview.view = options.view === 'text' ? 'text' : 'pages';
    // Download takes the document as the preview shows it: its Markdown, or its words.
    preview.document = {
      title: options.title || 'Document',
      markdown: typeof options.source === 'string' ? options.source : null,
      words: typeof options.words === 'string' ? options.words : plainText(blocks),
    };
    const downloadHost = dialog.querySelector('.doc-preview-download');
    setHidden(downloadHost, options.download === false);
    downloadHost?.querySelector('.download-menu-list')?.setAttribute('hidden', '');
    downloadHost?.querySelector('[data-download-toggle]')?.setAttribute('aria-expanded', 'false');
    showPreviewPage(options.page ?? 0, { quiet: true });
    showPreviewView(preview.view, { select: true });
    if (!dialog.hasAttribute('open')) {
      lockPage(true);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    return { pages: preview.pages.length };
  }

  // While the preview is open the page behind it does not scroll (a wheel over the dialog's header
  // used to scroll it away); the scrollbar's width is kept so nothing shifts.
  function lockPage(on) {
    const root = document.documentElement;
    if (!root?.classList) return;
    if (on) {
      // Only a scrollbar's width: on a touch phone innerWidth can be far wider than the screen.
      const gap = Math.max(0, (window.innerWidth || 0) - (root.clientWidth || 0));
      if (gap && gap <= 24 && root.style) root.style.paddingInlineEnd = `${gap}px`;
      root.classList.add('jd-page-locked');
    } else {
      root.classList.remove('jd-page-locked');
      if (root.style) root.style.paddingInlineEnd = '';
    }
  }

  function closePreview() {
    const { dialog } = preview;
    if (!dialog?.hasAttribute('open')) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  // ---------------------------------------------------------------- tour

  // A page's tour is its [data-tour-step="n"] targets (with data-tour-title and data-tour-text), in
  // number order, skipping targets that are not shown. Steps inside [data-tour="<name>"] belong to
  // that named tour (the Dashboard's first run, for example); the others to the page's own, whose
  // name is [data-tour-page] or the DeputyDock's data-deputy-page. [data-tour-open] buttons show only
  // while their tour has a step to show, and start it; ?tour=1 starts it once the page is ready.
  // tour.maybeStart(page, { from: 'onboarding' }) starts a tour not yet seen. Each step brings its
  // target's top to just below the chrome, with the card below or beside it (a bottom sheet on
  // phones), and a target taller than the room keeps its top part ringed. When it ends the store
  // marks it seen, and focus returns to the control that opened it, or to the main heading when
  // nothing did.
  // Round 6 (G6, R6-2): the deputy gives the tour. The card is his speech: the tour panda at the
  // card's start (JobDeputyDeputy.guide, A1's API, drawn in span.tour-card-guide), the step's
  // title as his speech line (first person, six words at most), the body below, then Skip the
  // tour, Back, and Next or Done. His pointer aims at the target, from where it sits seen from the
  // card (data-tour-point on a step chooses it), and the dock's panda steps out while the tour
  // runs. The tour ends with guide.release({ finished: true }) after Done, release() otherwise.
  // Without the guide API the card keeps its round 5 look and the dock holds the guide pose.
  const TOUR_STEP = '[data-tour-step]';
  const TOUR_OPEN = '[data-tour-open]';
  const SKIP_LINK = '.skip-link';
  const SPOT_PAD = 8;
  const CARD_GAP = 21;
  const CARD_EDGE = 13;
  // A tour's page glide: how far it may go (in screens), how long it may take, how long it may
  // stand still before the page jumps the rest, how often it is checked, and the inputs that mean
  // a person is scrolling.
  const GLIDE_SCREENS = 1.5;
  const GLIDE_MS = 1200;
  const GLIDE_STALL_MS = 250;
  const GLIDE_POLL_MS = 40;
  const GLIDE_INPUTS = ['wheel', 'touchstart'];
  const REST_MS = 800;
  const POINTS = ['left', 'right', 'up', 'down'];
  const tour = {
    active: false,
    page: '',
    steps: [],
    index: 0,
    opener: null,
    card: null,
    spot: null,
    parts: null,
    serial: 0,
    frame: 0,
    pending: '',
    syncFrame: 0,
    guide: null,
    point: '',
    settled: false,
  };

  function tourPage() {
    const marked = document.querySelector('[data-tour-page]');
    if (marked) return marked.getAttribute('data-tour-page');
    const dock = document.querySelector('[data-deputy-page]');
    if (dock) return dock.getAttribute('data-deputy-page');
    const file = String(window.location?.pathname ?? '')
      .split('/')
      .pop();
    return (
      String(file ?? '')
        .replace(/\.html?$/, '')
        .replace(/-preview$/, '') || 'page'
    );
  }

  // Steps inside [data-tour="<name>"] belong to that tour; the others to the page's own tour, so a
  // name with no steps of its own has none.
  function tourSteps(name) {
    const page = tourPage();
    const wanted = name || page;
    const tourOf = (element) => element.closest('[data-tour]')?.getAttribute('data-tour') ?? '';
    const pool = [...document.querySelectorAll(TOUR_STEP)].filter((element) => {
      const own = tourOf(element);
      return own ? own === wanted : wanted === page;
    });
    return pool
      .map((element, order) => ({
        element,
        order,
        number: Number.parseFloat(element.getAttribute('data-tour-step')),
      }))
      .filter((step) => Number.isFinite(step.number) && isShown(step.element))
      .sort((a, b) => a.number - b.number || a.order - b.order)
      .map((step) => step.element);
  }

  function tourSeen(page) {
    const store = window.JobDeputyStore;
    try {
      if (typeof store?.tourSeen === 'function') return Boolean(store.tourSeen(page));
      return Boolean(store?.get?.()?.tours?.seen?.[page]);
    } catch {
      return false;
    }
  }

  function tourNodes() {
    if (tour.card) return tour.card;
    const spot = make('div', { class: 'tour-spotlight', 'aria-hidden': 'true', hidden: true });
    const card = make('dialog', {
      class: 'tour-card',
      'aria-labelledby': 'jd-tour-title',
      'aria-describedby': 'jd-tour-count jd-tour-text',
    });
    const progress = make('div', { class: 'step-progress' });
    const count = make('p', { class: 'step-progress-label', id: 'jd-tour-count' });
    const bar = make('ol', { class: 'step-progress-bar', 'aria-hidden': 'true' });
    progress.append(count, bar);
    const title = make('h2', { class: 'tour-card-title', id: 'jd-tour-title' });
    const text = make('p', { class: 'tour-card-text', id: 'jd-tour-text' });
    const actions = make('div', { class: 'tour-card-actions' });
    const skip = make(
      'button',
      { type: 'button', class: 'compact-action', 'data-tour-action': 'skip' },
      'Skip the tour',
    );
    const moves = make('span', { class: 'tour-card-moves' });
    const back = make(
      'button',
      { type: 'button', class: 'compact-action', 'data-tour-action': 'back' },
      'Back',
    );
    const next = make(
      'button',
      { type: 'button', class: 'primary-action', 'data-tour-action': 'next' },
      'Next',
    );
    const done = make(
      'button',
      { type: 'button', class: 'primary-action', 'data-tour-action': 'done' },
      'Done',
    );
    moves.append(back, next, done);
    actions.append(skip, moves);
    const status = make('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    // The tour panda's place (round 6): the deputy's guide API draws him here; the art is
    // aria-hidden, so the card's name and description stay the step's words.
    const guide = make('span', { class: 'tour-card-guide', 'aria-hidden': 'true' });
    card.append(guide, progress, title, text, actions, status);

    card.addEventListener('click', (event) => {
      const action = event.target.closest?.('[data-tour-action]')?.getAttribute('data-tour-action');
      if (action) tourAction(action);
    });
    // The arrow keys step through the tour, as they would through a carousel.
    card.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !tour.active) return;
      if (event.key === 'ArrowRight' && tour.index < tour.steps.length - 1) {
        event.preventDefault();
        goToStep(tour.index + 1);
      } else if (event.key === 'ArrowLeft' && tour.index > 0) {
        event.preventDefault();
        goToStep(tour.index - 1);
      }
    });
    // Escape asks the dialog to cancel; the tour ends instead, through one path.
    card.addEventListener('cancel', (event) => {
      event.preventDefault();
      endTour('escape');
    });
    card.addEventListener('close', () => {
      if (tour.active) endTour('escape');
    });
    document.body.append(spot, card);
    tour.card = card;
    tour.spot = spot;
    tour.parts = { count, bar, title, text, skip, back, next, done, status, guide };
    return card;
  }

  // Where the target sits, seen from the card (the visible part of a tall target). A target in
  // the card's column (they share some width) is up or down by where it sits; one in the card's
  // row (they share some height) is left or right; one off to a corner takes the side with the
  // wider gap. The pose aimed left reads weaker than the others (A1), so a target off to the
  // left that is not level with the card (its middle outside the card's middle third) and reaches
  // more than 21px past the card's top or bottom is up or down, the way it reaches; from a corner,
  // one more than 21px higher or lower is up or down too.
  // data-tour-point on the step chooses it instead.
  function pointFor(target) {
    const forced = target?.getAttribute?.('data-tour-point');
    if (POINTS.includes(forced)) return forced;
    const card = boxOf(tour.card);
    const box = boxOf(target);
    const view = viewportSize();
    const top = Math.max(box.top, chromeInset());
    const bottom = Math.max(top, Math.min(box.bottom, view.height));
    const middle = (top + bottom) / 2;
    const vertical = () => {
      if (bottom <= card.top) return 'up';
      if (top >= card.bottom) return 'down';
      return middle < (card.top + card.bottom) / 2 ? 'up' : 'down';
    };
    const sideways = () =>
      (box.left + box.right) / 2 < (card.left + card.right) / 2 ? 'left' : 'right';
    const third = (card.bottom - card.top) / 3;
    const level = middle >= card.top + third && middle <= card.bottom - third;
    const sharesWidth = box.left < card.right && box.right > card.left;
    const sharesHeight = top < card.bottom && bottom > card.top;
    if (sharesWidth) return vertical();
    if (sharesHeight) {
      const side = sideways();
      if (side !== 'left' || level) return side;
      // Off to the left and reaching past the card's top or bottom: point the way it reaches.
      const below = bottom - card.bottom;
      const above = card.top - top;
      if (Math.max(below, above) < CARD_GAP) return side;
      return below > above ? 'down' : 'up';
    }
    const gapX = box.right <= card.left ? card.left - box.right : box.left - card.right;
    const gapY = bottom <= card.top ? card.top - bottom : top - card.bottom;
    const side = gapX > gapY ? sideways() : vertical();
    return side === 'left' && gapY >= CARD_GAP ? vertical() : side;
  }

  // Aims the tour panda's pointer at the step's target, and names the direction on the card.
  function aimGuide(target) {
    if (!tour.guide || !target) return;
    const point = pointFor(target);
    if (point === tour.point) return;
    tour.point = point;
    tour.card.setAttribute('data-point', point);
    try {
      tour.guide.update({ point });
    } catch {
      // The panda is a courtesy; the tour runs without him.
    }
  }

  // Brings the deputy into the card (A1's guide API), or holds his guide pose on the dock with an
  // older deputy.js. The card takes its narrated layout first and is placed, so his first pointer
  // already aims from where the card will be. Returns the guide handle, or null.
  function inviteGuide(target, speech) {
    const deputy = window.JobDeputyDeputy;
    tour.point = '';
    if (typeof deputy?.guide === 'function') {
      try {
        tour.card.setAttribute('data-guide', '');
        placeTour();
        const point = pointFor(target);
        const guide = deputy.guide(tour.parts.guide, { point, speech });
        if (guide?.active !== false) {
          tour.guide = guide;
          tour.point = point;
          tour.card.setAttribute('data-point', point);
          return guide;
        }
      } catch {
        // Fall back to the dock's pose below.
      }
    }
    tour.guide = null;
    tour.card.removeAttribute('data-guide');
    tour.card.removeAttribute('data-point');
    try {
      deputy?.hold?.('guide');
    } catch {
      // The deputy's pose is a courtesy; the tour runs without it.
    }
    return null;
  }

  // Sends the deputy back to the dock: with one celebrate when the tour was finished.
  function dismissGuide(finished) {
    const guide = tour.guide;
    tour.guide = null;
    tour.point = '';
    tour.card?.removeAttribute('data-guide');
    tour.card?.removeAttribute('data-point');
    try {
      if (guide) guide.release(finished ? { finished: true } : undefined);
      else window.JobDeputyDeputy?.release?.();
    } catch {
      // The tour ends whatever the deputy does.
    }
  }

  // The step's target, found again by its number if the page drew it anew.
  function stepTarget(index) {
    const known = tour.steps[index];
    if (known?.isConnected) return known;
    const number = known?.getAttribute('data-tour-step');
    const again = tourSteps(tour.page).find(
      (element) => element.getAttribute('data-tour-step') === number,
    );
    if (again) tour.steps[index] = again;
    return again ?? known ?? null;
  }

  function fillStep(index) {
    const { count, bar, title, text, skip, back, next, done } = tour.parts;
    const target = stepTarget(index);
    const total = tour.steps.length;
    const last = index === total - 1;
    count.textContent = `Step ${index + 1} of ${total}`;
    bar.textContent = '';
    for (let step = 0; step < total; step += 1) {
      const kind = step < index ? ' is-done' : step === index ? ' is-current' : '';
      bar.append(make('li', { class: `step-progress-step${kind}` }));
    }
    title.textContent = target?.getAttribute('data-tour-title') || `Step ${index + 1}`;
    text.textContent = target?.getAttribute('data-tour-text') || '';
    // His speech line follows the step at once; the pointer turns once the card is placed.
    if (tour.guide) {
      try {
        tour.guide.update({ speech: title.textContent });
      } catch {
        // The panda is a courtesy; the tour runs without him.
      }
    }
    setHidden(back, index === 0);
    setHidden(next, last);
    setHidden(done, !last);
    setHidden(skip, last);
    if (last) {
      next.removeAttribute('autofocus');
      done.setAttribute('autofocus', '');
    } else {
      done.removeAttribute('autofocus');
      next.setAttribute('autofocus', '');
    }
    return target;
  }

  const phoneLayout = () => mediaMatches('(max-width: 720px)');

  // Waits for a glide to reach its top, by the clock rather than by frames (a hidden page draws
  // none, and a glide may start a few frames late). A glide that never starts, stops short, or
  // runs long ends with a jump to the top, so the step always lands; a person who scrolls
  // meanwhile keeps the page where they put it (UAT-RD RD-1).
  function glideTo(top) {
    return new Promise((resolve) => {
      const started = Date.now();
      let last = window.scrollY || 0;
      let moved = started;
      let timer = 0;
      const person = () => finish(false);
      const ended = () => check();
      const finish = (jump) => {
        window.clearTimeout(timer);
        for (const type of GLIDE_INPUTS) window.removeEventListener?.(type, person);
        window.removeEventListener?.('scrollend', ended);
        if (jump && Math.abs((window.scrollY || 0) - top) >= 1) {
          window.scrollTo({ top, behavior: 'instant' });
        }
        resolve();
      };
      function check() {
        const now = Date.now();
        const y = window.scrollY || 0;
        if (Math.abs(y - top) < 1) return finish(false);
        if (y !== last) {
          last = y;
          moved = now;
        }
        if (document.hidden || now - moved >= GLIDE_STALL_MS || now - started >= GLIDE_MS) {
          return finish(true);
        }
        window.clearTimeout(timer);
        timer = window.setTimeout(check, GLIDE_POLL_MS);
      }
      for (const type of GLIDE_INPUTS) {
        window.addEventListener?.(type, person, { passive: true, once: true });
      }
      window.addEventListener?.('scrollend', ended, { passive: true });
      check();
    });
  }

  // Waits for finite animations on the target or a box that holds it (a page's entrance, for
  // example) to finish, so the step measures the target at rest; resolves true if it waited. A
  // hidden page runs no animations, so there is nothing to wait for (UAT-RD RD-1).
  function targetAtRest(target) {
    if (!target || document.hidden || typeof document.getAnimations !== 'function') {
      return Promise.resolve(false);
    }
    const moving = document.getAnimations().filter((animation) => {
      const node = animation.effect?.target;
      const end = animation.effect?.getComputedTiming?.().endTime;
      return (
        animation.playState === 'running' &&
        node instanceof Element &&
        node.contains(target) &&
        Number.isFinite(end)
      );
    });
    if (!moving.length) return Promise.resolve(false);
    return new Promise((resolve) => {
      const done = () => resolve(true);
      window.setTimeout(done, REST_MS);
      Promise.all(moving.map((animation) => animation.finished.catch(() => null))).then(done);
    });
  }

  // A target in a fixed layer (the header, the deputy's dock) does not move with the page.
  function inFixedLayer(element) {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      if (getComputedStyle(node).position === 'fixed') return true;
    }
    return false;
  }

  // Brings the target's top to just below the sticky chrome (not merely into view), so what it
  // explains reads down from there; the page stops where it can scroll no further.
  // The top is held within what the page can scroll, so a glide toward the page's end knows
  // where it stops. A target more than a screen and a half away is jumped to, as is any under
  // reduced motion, Pause motion, or on a hidden page; a nearer one glides.
  async function revealTarget(target) {
    if (!target || typeof window.scrollTo !== 'function' || inFixedLayer(target)) return;
    const from = window.scrollY || 0;
    const wanted = Math.max(0, from + boxOf(target).top - SPOT_PAD - (chromeInset() + CARD_EDGE));
    const height = document.documentElement?.scrollHeight;
    const room =
      typeof height === 'number' && height > 0
        ? Math.max(0, height - viewportSize().height)
        : Number.POSITIVE_INFINITY;
    const top = Math.min(wanted, room);
    if (Math.abs(top - from) < 1) return;
    const far = Math.abs(top - from) > viewportSize().height * GLIDE_SCREENS;
    const glide = !motionStill() && !document.hidden && !far;
    window.scrollTo({ top, behavior: glide ? 'smooth' : 'instant' });
    if (glide) await glideTo(top);
  }

  // The ring and the card for a target's box. On wide screens the card sits below the target,
  // else beside it, else above it, inside the viewport and clear of the chrome; when none has
  // room (a target taller than the room) the ring keeps the target's top part, and the card sits
  // under that part. On phones the stylesheet makes the card a bottom sheet, and the ring stops
  // above it. The ring never reaches under the chrome.
  function tourLayout(box) {
    const view = viewportSize();
    const chrome = chromeInset();
    const ceiling = chrome + CARD_EDGE;
    const size = boxOf(tour.card);
    const ring = {
      left: box.left - SPOT_PAD,
      right: box.right + SPOT_PAD,
      top: Math.max(box.top - SPOT_PAD, chrome),
      bottom: box.bottom + SPOT_PAD,
    };
    if (phoneLayout()) {
      const sheetTop = size.height > 0 ? size.top : view.height;
      return { ring: { ...ring, bottom: Math.min(ring.bottom, sheetTop - CARD_EDGE) }, card: null };
    }
    const floor = view.height - CARD_EDGE;
    const maxLeft = Math.max(CARD_EDGE, view.width - CARD_EDGE - size.width);
    const startLeft = Math.min(Math.max(box.left, CARD_EDGE), maxLeft);
    const besideTop = Math.min(Math.max(ring.top, ceiling), Math.max(ceiling, floor - size.height));
    const shown = { ...ring, bottom: Math.min(ring.bottom, floor) };
    if (ring.bottom + CARD_GAP + size.height <= floor) {
      return { ring, card: [startLeft, ring.bottom + CARD_GAP] };
    }
    if (ring.right + CARD_GAP + size.width <= view.width - CARD_EDGE) {
      return { ring: shown, card: [ring.right + CARD_GAP, besideTop] };
    }
    if (ring.left - CARD_GAP - size.width >= CARD_EDGE) {
      return { ring: shown, card: [ring.left - CARD_GAP - size.width, besideTop] };
    }
    if (ring.top - CARD_GAP - size.height >= ceiling) {
      return { ring: shown, card: [startLeft, ring.top - CARD_GAP - size.height] };
    }
    const cardTop = Math.max(ceiling, floor - size.height);
    return {
      ring: { ...ring, bottom: Math.min(ring.bottom, cardTop - CARD_GAP) },
      card: [startLeft, cardTop],
    };
  }

  function placeTour({ glide = false } = {}) {
    if (!tour.active) return;
    const target = stepTarget(tour.index);
    if (!target) return;
    const { spot, card } = tour;
    const { ring, card: at } = tourLayout(boxOf(target));
    setHidden(spot, false);
    spot.classList.toggle('is-moving', glide);
    const radius = Number.parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
    setStyle(spot, 'transform', `translate(${Math.round(ring.left)}px, ${Math.round(ring.top)}px)`);
    setStyle(spot, 'width', `${Math.round(ring.right - ring.left)}px`);
    setStyle(spot, 'height', `${Math.round(Math.max(0, ring.bottom - ring.top))}px`);
    setStyle(spot, 'borderRadius', `${Math.round(Math.max(13, radius + SPOT_PAD))}px`);
    setStyle(card, 'left', at ? `${Math.round(at[0])}px` : '');
    setStyle(card, 'top', at ? `${Math.round(at[1])}px` : '');
    // The pointer turns once a step has come to rest, so it never swings while the page scrolls.
    if (tour.settled) aimGuide(target);
  }

  async function showStep(index, { first = false } = {}) {
    tour.serial += 1;
    const serial = tour.serial;
    tour.index = index;
    tour.settled = false;
    const target = fillStep(index);
    const { next, done, status, title, text, count } = tour.parts;
    // Focus stays in the card: on the button just used while it shows, else Next or Done. The
    // move never scrolls the page, so it cannot cut short the glide to the step.
    const focused = document.activeElement;
    if (!(focused && tour.card.contains(focused) && isShown(focused) && focused !== tour.card)) {
      (index === tour.steps.length - 1 ? done : next).focus({ preventScroll: true });
    }
    // Said as sentences: a speech line that ends in its own full stop keeps just the one
    // (round 6: "I keep your interviews in view." is a sentence already).
    const sentence = (words) => {
      const line = String(words ?? '').trim();
      return line && !/[.!?…]$/.test(line) ? `${line}.` : line;
    };
    if (!first) {
      speak(
        status,
        [count.textContent, title.textContent, text.textContent]
          .map(sentence)
          .filter(Boolean)
          .join(' '),
      );
    }
    // The ring moves to the target at once and stays on it while the page brings the target's top
    // below the chrome. Anything still moving the target (a page's entrance, or motion the scroll
    // set off) comes to rest first, so the top lands where it should.
    const stale = () => serial !== tour.serial || !tour.active;
    placeTour({ glide: !first && !motionStill() && !document.hidden });
    await targetAtRest(target);
    if (stale()) return;
    await revealTarget(target);
    if (stale()) return;
    if (await targetAtRest(target)) {
      if (stale()) return;
      await revealTarget(target);
      if (stale()) return;
    }
    tour.settled = true;
    placeTour();
  }

  function goToStep(index) {
    if (!tour.active) return;
    if (index >= tour.steps.length) {
      endTour('done');
      return;
    }
    showStep(Math.max(0, index));
  }

  function tourAction(action) {
    if (action === 'next') goToStep(tour.index + 1);
    else if (action === 'back') goToStep(tour.index - 1);
    else if (action === 'done') endTour('done');
    else if (action === 'skip') endTour('skip');
  }

  // A tour that starts by itself (?tour=1, or after setup) has no opener; nor does one whose
  // focus was on the page itself or its skip link.
  function startTour(name, { opener, auto = false } = {}) {
    if (tour.active) return false;
    const page = name || tourPage();
    const steps = tourSteps(page);
    if (!steps.length) return false;
    hideTip();
    const from = auto ? null : (opener ?? document.activeElement);
    // A menu that holds the opener closes, so the page is in view.
    from?.closest?.('details[open]')?.removeAttribute('open');
    tourNodes();
    tour.active = true;
    tour.page = page;
    tour.steps = steps;
    tour.index = 0;
    tour.opener =
      from instanceof Element && from !== document.body && !from.matches(SKIP_LINK) ? from : null;
    const target = fillStep(0);
    if (typeof tour.card.showModal === 'function') tour.card.showModal();
    else tour.card.setAttribute('open', '');
    inviteGuide(target, tour.parts.title.textContent);
    showStep(0, { first: true });
    document.dispatchEvent(
      new CustomEvent('jobdeputy:tour', {
        bubbles: true,
        detail: { type: 'start', page, steps: steps.length },
      }),
    );
    return true;
  }

  // Focus goes back to the opener, else to the summary of the menu that holds it, else to the
  // page's main heading (focusable for this, without a tab stop, and without scrolling the page
  // away from where the tour left it), so a keyboard keeps its place rather than restarting at
  // the skip link.
  function returnFocus(opener) {
    if (opener?.isConnected && isShown(opener) && takesFocus(opener)) {
      focusInView(opener);
      return;
    }
    const summary = opener?.closest?.('details')?.querySelector('summary');
    if (summary && isShown(summary)) {
      focusInView(summary);
      return;
    }
    const main = document.querySelector('main');
    const heading = main?.querySelector('h1') ?? null;
    const place = heading && isShown(heading) ? heading : main;
    if (!place || !isShown(place)) return;
    if (!place.hasAttribute('tabindex')) place.setAttribute('tabindex', '-1');
    focusInView(place);
  }

  function endTour(reason = 'done') {
    if (!tour.active) return false;
    tour.active = false;
    tour.serial += 1;
    const { card, spot, page, opener } = tour;
    setHidden(spot, true);
    spot.classList.remove('is-moving');
    if (card.hasAttribute('open')) {
      if (typeof card.close === 'function') card.close();
      else card.removeAttribute('open');
    }
    // Done on the last step finishes the tour; Skip, Escape, or anything else ends it quietly.
    dismissGuide(reason === 'done');
    try {
      window.JobDeputyStore?.markTourSeen?.(page);
    } catch {
      // Storage may be unavailable; the tour still ends.
    }
    tour.opener = null;
    returnFocus(opener);
    document.dispatchEvent(
      new CustomEvent('jobdeputy:tour', {
        bubbles: true,
        detail: { type: 'end', page, reason, step: tour.index + 1, steps: tour.steps.length },
      }),
    );
    return true;
  }

  // Shows every [data-tour-open] whose tour has a step to show, and hides the others.
  // Take the tour keeps its room from the first paint (app-chrome.css, round 7, R10-1): a hidden
  // button is laid out but invisible until this finds the page's steps. Only once the page has
  // booted and loaded does a page without a tour let it go (data-tour-none), so steps a page draws
  // as it starts never make the intro jump.
  function tourSettled() {
    return boot.state === 'ready' && boot.tourChecked;
  }

  function syncTourOpeners() {
    const buttons = [...document.querySelectorAll(TOUR_OPEN)];
    const ready = new Map();
    const settled = tourSettled();
    for (const button of buttons) {
      const name = button.getAttribute('data-tour-open') || tourPage();
      if (!ready.has(name)) ready.set(name, tourSteps(name).length > 0);
      setHidden(button, !ready.get(name));
      if (ready.get(name)) button.removeAttribute('data-tour-none');
      else if (settled && !button.hasAttribute('data-tour-none')) {
        button.setAttribute('data-tour-none', '');
      }
    }
  }

  // Once the page has booted (its first render done, the held regions shown), one more check
  // decides the pages without a tour.
  function settleTourOpeners() {
    whenBooted(() =>
      nextFrame(() => {
        boot.tourChecked = true;
        syncTourOpeners();
      }),
    );
  }

  function scheduleTourSync() {
    if (tour.syncFrame) return;
    tour.syncFrame = nextFrame(() => {
      tour.syncFrame = 0;
      syncTourOpeners();
    });
  }

  // Steps and buttons a page (or deputy.js) adds later show their buttons too.
  function watchTourTargets() {
    if (typeof MutationObserver !== 'function' || !document.body) return;
    const ours = (node) =>
      node === tip.node ||
      node === tour.spot ||
      Boolean(tip.node?.contains(node) || tour.card?.contains(node));
    new MutationObserver((records) => {
      if (records.some((record) => !ours(record.target))) scheduleTourSync();
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'open', 'data-tour-step', 'data-tour-open'],
    });
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.(TOUR_OPEN);
    if (!button) return;
    event.preventDefault();
    startTour(button.getAttribute('data-tour-open') || undefined, { opener: button });
  });

  // Runs once the page has loaded and the opening loader, if any, has revealed it.
  function whenReady(run) {
    const go = () => {
      const { body } = document;
      if (!body?.classList.contains('loader-active') || typeof MutationObserver !== 'function') {
        nextFrame(() => nextFrame(run));
        return;
      }
      let failsafe = 0;
      const observer = new MutationObserver(() => {
        if (body.classList.contains('loader-active')) return;
        observer.disconnect();
        window.clearTimeout(failsafe);
        nextFrame(() => nextFrame(run));
      });
      observer.observe(body, { attributes: true, attributeFilter: ['class'] });
      failsafe = window.setTimeout(() => {
        observer.disconnect();
        run();
      }, LOADER_FAILSAFE_MS);
    };
    if (document.readyState === 'complete') go();
    else window.addEventListener?.('load', go, { once: true });
  }

  const tourAsked = () => /[?&]tour=1(?:[&#]|$)/.test(String(window.location?.search ?? ''));

  // Starts the page's tour when ?tour=1 asks for it, or after first-time setup when the tour has
  // not been seen. Never on a plain load. Returns whether a start is on its way.
  function maybeStartTour(name, { from } = {}) {
    if (tour.active) return false;
    const page = name || tourPage();
    if (!tourAsked() && !(from === 'onboarding' && !tourSeen(page))) return false;
    tour.pending = page;
    whenReady(() => startTour(tour.pending || page, { auto: true }));
    return true;
  }

  function onViewportChange() {
    if (tipActive() && !tip.frame) {
      tip.frame = nextFrame(() => {
        tip.frame = 0;
        placeTip();
      });
    }
    if (tour.active && !tour.frame) {
      tour.frame = nextFrame(() => {
        tour.frame = 0;
        placeTour();
      });
    }
    scheduleToastPlace();
  }

  window.addEventListener?.('scroll', onViewportChange, { capture: true, passive: true });
  window.addEventListener?.('resize', onViewportChange, { passive: true });

  // ---------------------------------------------------------------- thumbs

  function thumbsState(fieldset) {
    const answer = [...fieldset.querySelectorAll('.thumbs-option input')].find(
      (input) => input.checked,
    );
    const reasons = [...fieldset.querySelectorAll('.thumbs-reasons input')]
      .filter((input) => input.checked)
      .map((input) => input.value);
    return {
      value: answer ? answer.value : null,
      reasons,
      context: fieldset.getAttribute('data-thumbs-context') ?? '',
    };
  }

  // Tell us more opens Feedback (feedback.js reads data-feedback-context when it is pressed) with
  // the role and any reasons chosen, for example
  // "Job match: Software Engineer, Internal Platforms · Wrong place".
  function syncThumbs(fieldset) {
    const { reasons, context } = thumbsState(fieldset);
    if (!context) return;
    const text = reasons.length ? `${context} · ${reasons.join(', ')}` : context;
    for (const button of fieldset.querySelectorAll('.thumbs-more')) {
      button.setAttribute('data-feedback-context', text);
    }
  }

  // Changing the answer or a reason fires jobdeputy:thumbs from the fieldset. A Yes clears the
  // reasons, which belong to a No. The page saves the answer and says thanks.
  document.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof Element)) return;
    const fieldset = input.closest('fieldset.thumbs');
    if (!fieldset) return;
    const answered = input.closest('.thumbs-option') !== null;
    if (answered && input.value !== 'no') {
      for (const reason of fieldset.querySelectorAll('.thumbs-reasons input'))
        reason.checked = false;
    }
    syncThumbs(fieldset);
    fieldset.dispatchEvent(
      new CustomEvent('jobdeputy:thumbs', {
        bubbles: true,
        detail: { ...thumbsState(fieldset), change: answered ? 'answer' : 'reason' },
      }),
    );
  });

  // ---------------------------------------------------------------- quick picks

  // Addresses compare without the scheme, a leading www., a query or fragment, or a trailing slash.
  const addressKey = (value) =>
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');

  // Selects the quick pick whose radio value matches the address and returns that input, or clears
  // every pick and returns null. Pages call it as the person types.
  function matchQuickPick(group, address) {
    const key = addressKey(address);
    const inputs = group ? [...group.querySelectorAll('.quick-pick input')] : [];
    const match = (key && inputs.find((input) => addressKey(input.value) === key)) || null;
    for (const input of inputs) input.checked = input === match;
    return match;
  }

  // ---------------------------------------------------------------- usage chart

  // usageChart(host, { series, groups, title, measure, unit, keyLabel, total, empty }) draws AI
  // usage as stacked bars (round 5, C1): one bar a day (or a month), each split into its groups
  // (models, tasks, or key sources) in the data palette, a key with each group's total over the
  // bars, a tooltip on every segment, and Show the numbers (a table of the same values). series is
  // the store's aiUsageSeries() or aiUsageMonths() list ([{ date, label, total, cost, groups:
  // [{ id, label, tokens, cost }] }]); groups ([{ id, label, tone, metric }], optional) fixes the
  // order, the tones, and a data-metric for a group's total. measure is 'tokens' (default) or
  // 'cost' (micro dollars, platform credits only). The plot is a picture for the pointer
  // (aria-hidden); the key and the table carry every number. It draws still: nothing animates.
  // Round 6 (D4, R6-4): cap (top N groups by total, the rest one hatched grey Other part named
  // otherLabel), columns (a whole month: days still to come are empty columns, not in the
  // table), marks ([{ date, label, tip }]: a marker over that day's bar, a key item, and a Note
  // column; days with fallback: true are marked too), and totalLabel with totalMetric (the
  // chart's total in its head: "60,710 tokens in October").
  let chartSerial = 0;

  // "60,710" under a million tokens, "22.7 million" from a million (R5-2), as the store's
  // format.tokens says it when the store has one.
  function tokenWords(value, store = window.JobDeputyStore) {
    const number = Math.max(0, Math.round(Number(value) || 0));
    const own = store?.format?.tokens;
    if (typeof own === 'function') {
      try {
        const text = own(number);
        if (typeof text === 'string' && text) return text;
      } catch {
        // The words below say the same.
      }
    }
    if (number < 1000000) return grouped(number);
    const millions = Math.round(number / 100000) / 10;
    return `${millions % 1 ? millions.toFixed(1) : millions} million`;
  }

  // Micro dollars as money: "$0.0024" under a cent, "$1.25" from a cent.
  function moneyWords(micros, store = window.JobDeputyStore) {
    const own = store?.format?.money;
    if (typeof own === 'function') {
      try {
        const text = own(micros);
        if (typeof text === 'string' && text) return text;
      } catch {
        // The words below say the same.
      }
    }
    const dollars = Math.max(0, Number(micros) || 0) / 1000000;
    if (dollars === 0) return '$0.00';
    return dollars < 0.01 ? `$${dollars.toFixed(4)}` : `$${dollars.toFixed(2)}`;
  }

  // A scale's top: the next round number at or above the largest bar (1, 1.5, 2, 2.5, 3, 4, 5, 6,
  // or 8 times a power of ten), so its half is a round number too.
  // The usage axis says its top, its middle, and 0, in whole counts (tokens, runs, micros), so the
  // top always halves to a whole number: a top of 1 read "0, 1, 1" (T6-14); it is now 2.
  function niceMax(value) {
    if (!(value > 0)) return 1;
    if (value <= 2) return 2;
    const power = 10 ** Math.floor(Math.log10(value));
    for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
      const top = step * power;
      if (top >= value && Number.isInteger(top / 2)) return top;
    }
    return 10 * power;
  }

  // The short label under a bar: "Oct 1" from "Thu, Oct 1".
  const shortLabel = (label) => String(label ?? '').replace(/^[A-Z][a-z]{2},\s*/, '');

  // Round 7 (D9, D10): usageChart(host, { usage: JobDeputyStore.usage({...}) }) or { ledger:
  // JobDeputyStore.runsLedger({...}) } draws any range at the store's step: the buckets become the
  // bars, stacked by the store's groups (top 5 plus Other), a dated setting change inside the range
  // marks its bar with its own words, a fallback marks the bar as one, and the table's first
  // column says Time for hours and minutes. measure: 'tokens' (default) or 'calls' for usage; a
  // ledger counts runs by what used them.
  function fromUsage(options) {
    const usage = options.usage;
    const calls = options.measure === 'calls';
    const buckets = Array.isArray(usage.buckets) ? usage.buckets : [];
    const groupsOf = Array.isArray(usage.groups) ? usage.groups : [];
    const from = Number(new Date(usage.from));
    const to = Number(new Date(usage.to));
    const bucketAt = (at) => {
      const ms = Number(new Date(at));
      return buckets.find(
        (bucket) => ms >= Number(new Date(bucket.at)) && ms < Number(new Date(bucket.to)),
      );
    };
    const marks = [];
    const fallbacks = new Set();
    for (const setting of Array.isArray(usage.settings) ? usage.settings : []) {
      const ms = Number(new Date(setting?.at));
      if (!(ms >= from && ms <= to)) continue;
      const bucket = bucketAt(setting.at);
      if (!bucket) continue;
      if (setting.kind === 'fallback') fallbacks.add(bucket.at);
      else
        marks.push({
          date: bucket.at,
          label: String(setting.text ?? 'A setting changed'),
          setting: true,
        });
    }
    // Hours and minutes (DB's request 9): the time only ("06:00"), the date at midnight ("Oct 2"),
    // and a label only every so many hours (or minutes) so at most eight show, on round times.
    const fine = usage.step === 'hour' || usage.step === '5m';
    const every =
      (usage.step === '5m' ? [1, 2, 3, 6, 12] : [1, 2, 3, 4, 6, 12, 24]).find(
        (n) => buckets.length / n <= 8,
      ) ?? (usage.step === '5m' ? 12 : 24);
    const clockOf = (at) => {
      const text = String(at ?? '');
      const match = text.match(/T(\d\d):(\d\d)/);
      return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
    };
    const timeShort = (bucket) => {
      const time = clockOf(bucket.at);
      const label = String(bucket.label ?? '');
      if (!time) return shortLabel(label);
      if (time.hour === 0 && time.minute === 0) return shortLabel(label).replace(/,\s*00:00$/, '');
      return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
    };
    const onRound = (bucket) => {
      const time = clockOf(bucket.at);
      if (!time) return false;
      const units = usage.step === '5m' ? time.minute / 5 : time.hour;
      return units % every === 0 && (usage.step !== 'hour' || time.minute === 0);
    };
    const series = buckets.map((bucket) => ({
      date: bucket.at,
      label: bucket.label,
      ...(fine ? { short: timeShort(bucket), labelled: onRound(bucket) } : {}),
      fallback: fallbacks.has(bucket.at) || Boolean(bucket.fallback),
      groups: (Array.isArray(bucket.parts) ? bucket.parts : []).map((part) => ({
        id: String(part.id),
        label: part.label,
        tokens: Math.max(0, Number(calls ? part.calls : part.tokens) || 0),
        cost: Math.max(0, Number(part.cost) || 0),
      })),
    }));
    // The store already took the top 5 and folded the rest into its Other (R6-4), so its groups
    // are drawn as they are, Other hatched, with no second cap.
    return {
      ...options,
      series,
      groups:
        options.groups ??
        groupsOf.map((group) => ({
          id: String(group.id),
          label: group.label,
          tone: group.other || String(group.id) === 'other' ? OTHER : group.tone,
        })),
      marks: [...(Array.isArray(options.marks) ? options.marks : []), ...marks],
      columns: options.columns ?? series.length,
      unit: options.unit ?? (calls ? 'calls' : 'tokens'),
      rowLabel: options.rowLabel ?? (fine ? 'Time' : 'Day'),
      measure: 'tokens',
      otherLabel: options.otherLabel ?? usage.otherLabel ?? 'Other',
      cap: options.cap ?? 6,
    };
  }

  function fromLedger(options) {
    const ledger = options.ledger;
    const features = Array.isArray(ledger.features) ? ledger.features : [];
    // The range's own step when the store gives it (buckets with parts of runs), else its days.
    const buckets = Array.isArray(ledger.buckets) ? ledger.buckets : null;
    const series = buckets
      ? buckets.map((bucket) => ({
          date: bucket.at,
          label: bucket.label,
          groups: (Array.isArray(bucket.parts) ? bucket.parts : []).map((part) => ({
            id: String(part.id),
            label: part.label,
            tokens: Math.max(0, Number(part.runs ?? part.count ?? part.value) || 0),
          })),
        }))
      : (Array.isArray(ledger.days) ? ledger.days : []).map((day) => ({
          date: day.date,
          label: day.label,
          groups: features.map((feature) => ({
            id: String(feature.id),
            label: feature.label,
            tokens: Math.max(0, Number(day.parts?.[feature.id]) || 0),
          })),
        }));
    const fine = ledger.step === 'hour' || ledger.step === '5m';
    return {
      ...options,
      series,
      groups:
        options.groups ??
        features.map((feature) => ({ id: String(feature.id), label: feature.label })),
      columns: options.columns ?? series.length,
      unit: options.unit ?? 'runs',
      rowLabel: options.rowLabel ?? (fine ? 'Time' : 'Day'),
      measure: 'tokens',
    };
  }

  function usageChart(host, given = {}) {
    if (!host || typeof host.querySelector !== 'function') return null;
    const options =
      given.usage && Array.isArray(given.usage.buckets)
        ? fromUsage(given)
        : given.ledger && (Array.isArray(given.ledger.days) || Array.isArray(given.ledger.buckets))
          ? fromLedger(given)
          : given;
    const store = options.store ?? window.JobDeputyStore;
    const series = Array.isArray(options.series) ? options.series : [];
    const cost = options.measure === 'cost';
    const amountOf = (group) => Math.max(0, Number(cost ? group?.cost : group?.tokens) || 0);
    const words = (value) => (cost ? moneyWords(value, store) : tokenWords(value, store));
    const unit = options.unit ?? (cost ? '' : 'tokens');
    const withUnit = (value) => (unit ? `${words(value)} ${unit}` : words(value));

    // The groups in order: the page's list, then any the bars hold that it did not name.
    const named = Array.isArray(options.groups) ? options.groups : [];
    const groups = named.map((group) => ({ ...group, id: String(group.id) }));
    for (const day of series) {
      for (const group of day?.groups ?? []) {
        if (!groups.some((item) => item.id === String(group.id))) {
          groups.push({ id: String(group.id), label: String(group.label ?? group.id) });
        }
      }
    }
    groups.forEach((group, index) => {
      group.tone = isTone(group.tone) ? group.tone : SERIES_TONES[index % SERIES_TONES.length];
      group.label = String(group.label ?? group.id);
      group.total = series.reduce(
        (sum, day) =>
          sum + amountOf((day?.groups ?? []).find((item) => String(item.id) === group.id)),
        0,
      );
    });
    // Beyond the cap, the smaller groups become one Other part (hatched grey), so the key never
    // grows with the account (seven models on the large demo show as five and Other).
    const cap = Number.isFinite(Number(options.cap)) ? Math.max(1, Math.floor(options.cap)) : 0;
    const kept = new Set(
      cap && groups.length > cap
        ? topWithOther(groups, { n: cap, value: 'total', label: 'label', key: 'id' }).top.map(
            (entry) => entry.key,
          )
        : groups.map((group) => group.id),
    );
    const folds = groups.filter((group) => !kept.has(group.id));
    if (folds.length) {
      const other = {
        id: 'other',
        label: String(options.otherLabel ?? 'Other'),
        tone: OTHER,
        other: true,
        members: folds.map((group) => group.id),
        total: folds.reduce((sum, group) => sum + group.total, 0),
        tip: `${folds.map((group) => group.label).join(', ')}, together.`,
      };
      for (let at = groups.length - 1; at >= 0; at -= 1) {
        if (!kept.has(groups[at].id)) groups.splice(at, 1);
      }
      groups.push(other);
    }
    const amountIn = (day, group) =>
      group.other
        ? (day?.groups ?? [])
            .filter((item) => group.members.includes(String(item.id)))
            .reduce((sum, item) => sum + amountOf(item), 0)
        : amountOf((day?.groups ?? []).find((item) => String(item.id) === group.id));
    const markFor = new Map();
    for (const mark of Array.isArray(options.marks) ? options.marks : []) {
      if (mark?.date) markFor.set(String(mark.date), mark);
    }
    for (const day of series) {
      if (day?.fallback && day?.date && !markFor.has(String(day.date))) {
        markFor.set(String(day.date), {
          date: day.date,
          label: options.fallbackLabel ?? 'Fell back to platform credits',
        });
      }
    }
    const bars = series.map((day) => {
      const parts = groups
        .map((group) => ({ group, value: amountIn(day, group) }))
        .filter((part) => part.value > 0);
      const total = parts.reduce((sum, part) => sum + part.value, 0);
      const label = String(day?.label ?? day?.date ?? '');
      return {
        label,
        short: String(day?.short ?? shortLabel(label)),
        date: day?.date ?? '',
        parts,
        total,
        mark: markFor.get(String(day?.date ?? '')) ?? null,
        // Round 7: a series at an hour or 5-minute step says which bars carry a label.
        labelled: typeof day?.labelled === 'boolean' ? day.labelled : null,
      };
    });
    // A whole month: the days still to come are empty columns after the last day shown.
    const columns = Math.max(bars.length, Math.floor(Number(options.columns) || 0));
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];
    MONTHS.push('Dec');
    const lastDate = Date.parse(`${bars.at(-1)?.date ?? ''}T00:00:00Z`);
    const future = [];
    for (let at = bars.length; at < columns; at += 1) {
      const date = Number.isFinite(lastDate)
        ? new Date(lastDate + (at - bars.length + 1) * 86400000)
        : null;
      future.push({
        label: '',
        short: date ? `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}` : '',
        date: date ? date.toISOString().slice(0, 10) : '',
        parts: [],
        total: 0,
        future: true,
      });
    }
    const top = niceMax(Math.max(0, ...bars.map((bar) => bar.total)));
    const grand = bars.reduce((sum, bar) => sum + bar.total, 0);

    const signature = JSON.stringify([
      options.title,
      unit,
      cost,
      columns,
      options.totalLabel,
      options.totalMetric,
      groups.map((group) => [group.id, group.label, group.tone, group.total, group.metric]),
      bars.map((bar) => [bar.label, bar.parts.map((part) => part.value), bar.mark?.label]),
    ]);
    let chart = [...host.children].find((child) => child.classList?.contains('usage-chart'));
    if (chart && chart.getAttribute('data-usage-drawn') === signature) {
      return { chart, groups, total: grand, top };
    }
    chart?.remove();
    chartSerial += 1;
    const id = `jd-usage-${chartSerial}`;
    // caption: false (or labelledBy: the id of the page's own heading) leaves the title out, for
    // a card whose heading already names the chart; the total, when asked for, stays.
    const titled = options.caption !== false && !options.labelledBy;
    chart = make('figure', {
      class: 'usage-chart',
      'aria-labelledby': options.labelledBy || (titled ? `${id}-title` : null),
      'aria-label': titled || options.labelledBy ? null : (options.title ?? 'AI usage'),
      'data-usage-drawn': signature,
    });
    const caption = make('figcaption', { class: 'usage-chart-head' });
    if (titled) {
      caption.append(
        make(
          'span',
          { class: 'usage-chart-title', id: `${id}-title` },
          options.title ?? 'AI usage',
        ),
      );
    }
    if (options.totalLabel) {
      const total = make('span', { class: 'usage-chart-total' });
      const figure = make('strong', {}, words(grand));
      if (options.totalMetric) figure.setAttribute('data-metric', options.totalMetric);
      total.append(figure, document.createTextNode(` ${options.totalLabel}`));
      caption.append(total);
    }
    if (titled || options.totalLabel) chart.append(caption);

    // The key: each group's colour, name, and total over the bars shown. A group with href is a
    // link; one with instead says those words where its count would be (the count stays in its
    // tip), for a figure the page shows elsewhere (R3-4).
    const key = make('ul', {
      class: 'chart-key is-compact is-inline usage-chart-key',
      'aria-label': options.keyLabel ?? `${options.title ?? 'AI usage'}: totals`,
    });
    for (const group of groups) {
      const item = make('li', { 'data-tone': group.tone });
      const entry = make(group.href ? 'a' : 'span', {
        class: 'chart-key-item',
        href: group.href || null,
        'data-tip-title': `${group.label} · ${withUnit(group.total)}`,
        'data-tip':
          group.tip ??
          `${group.label}: ${withUnit(group.total)} over these ${bars.length === 1 ? 'bar' : `${bars.length} bars`}.`,
      });
      const instead = group.instead ? String(group.instead) : '';
      const count = make(
        'span',
        { class: instead ? 'chart-key-count usage-chart-instead' : 'chart-key-count' },
        instead || words(group.total),
      );
      if (group.metric && !instead) count.setAttribute('data-metric', group.metric);
      entry.append(
        make('span', { class: 'chart-key-name' }, group.label),
        document.createTextNode(' '),
        count,
      );
      if (unit && !instead) entry.append(make('span', { class: 'sr-only' }, ` ${unit}`));
      item.append(entry);
      key.append(item);
    }
    // A marked day (your key's limit reached, platform credits ran the rest) has its key item.
    const marked = bars.filter((bar) => bar.mark);
    const markLabels = [...new Set(marked.map((bar) => String(bar.mark.label ?? 'Marked')))];
    for (const words of markLabels) {
      const days = marked.filter((bar) => String(bar.mark.label ?? 'Marked') === words);
      const item = make('li', { class: 'usage-chart-mark-key' });
      const entry = make('span', {
        class: 'chart-key-item',
        'data-tip-title': words,
        'data-tip': `${days.map((bar) => bar.short || bar.label).join(', ')}.`,
      });
      entry.append(
        make('span', { class: 'usage-chart-mark-swatch', 'aria-hidden': 'true' }),
        make('span', { class: 'chart-key-name' }, words),
        document.createTextNode(' '),
        // The unit is visible (UAT-M M-16): "1 day", "3 days". A dated setting change (round 7)
        // names when it happened instead.
        make(
          'span',
          { class: 'chart-key-count' },
          days.every((bar) => bar.mark.setting)
            ? days.map((bar) => shortLabel(bar.label) || bar.short).join(', ')
            : `${days.length} ${days.length === 1 ? 'day' : 'days'}`,
        ),
      );
      item.append(entry);
      key.append(item);
    }
    chart.append(key);

    const plot = make('div', { class: 'usage-chart-plot', 'aria-hidden': 'true' });
    const axis = make('ol', { class: 'usage-chart-axis' });
    for (const share of [1, 0.5, 0]) axis.append(make('li', {}, words(top * share)));
    // Rows named, not dated (the by-task view): their names wrap between words under the bars,
    // thinned only where a word does not fit (UAT-M M-18), and the table heads them Task. A page
    // may name the rows itself (rowLabel).
    const byName =
      options.period !== 'month' && series.length > 0 && series.every((day) => !day?.date);
    const rowLabel =
      options.rowLabel ?? (options.period === 'month' ? 'Month' : byName ? 'Task' : 'Day');
    const columnList = make('ol', { class: 'usage-chart-bars' });
    const drawn = [...bars, ...future];
    setStyle(columnList, '--bars', String(Math.max(1, drawn.length)));
    const step = drawn.length <= 7 ? 1 : drawn.length <= 14 ? 2 : 7;
    // The last bar is labelled when it stands clear of the one before it, otherwise the last
    // whole step is. Both ends are the edges a narrow plot keeps.
    const end = drawn.length - 1;
    const lastLabelled =
      end > 0 && end % step !== 0 && end % step >= Math.ceil(step / 2)
        ? end
        : Math.floor(end / step) * step;
    drawn.forEach((bar, index) => {
      const column = make('li', {
        class: `usage-chart-column${bar.future ? ' is-future' : ''}${bar.mark ? ' is-marked' : ''}`,
      });
      const stack = make('span', { class: 'usage-chart-bar' });
      setStyle(stack, '--value', String(Math.round((bar.total / top) * 1000) / 10));
      for (const part of bar.parts) {
        const segment = make('span', {
          class: 'usage-chart-seg',
          'data-tone': part.group.tone,
          'data-group': part.group.id,
          'data-tip-title': `${bar.short || bar.label} · ${part.group.label}`,
          'data-tip': `${withUnit(part.value)}${bar.parts.length > 1 ? `, of ${words(bar.total)} that ${options.period === 'month' ? 'month' : 'day'}` : ''}.`,
        });
        setStyle(segment, '--share', String(Math.round((part.value / bar.total) * 10000) / 10000));
        stack.append(segment);
      }
      if (bar.mark) {
        const mark = make('span', {
          class: 'usage-chart-mark',
          'data-tip-title': `${bar.short || bar.label} · ${bar.mark.label ?? 'Marked'}`,
          'data-tip': bar.mark.tip ?? `${withUnit(bar.total)} that day.`,
        });
        setStyle(mark, '--value', String(Math.round((bar.total / top) * 1000) / 10));
        column.append(mark);
      }
      // A label every step bars (a week of days), and the last one; a narrow plot keeps the first
      // and the last only (data-rank="edge"), so no two labels touch.
      const weekly = index % step === 0;
      const labelled = bar.labelled ?? (weekly || index === lastLabelled);
      const label = make(
        'span',
        {
          class: 'usage-chart-label',
          'data-rank': !labelled ? null : index === 0 || index === lastLabelled ? 'edge' : 'week',
          'data-words': byName ? true : null,
          'data-from-end': String(drawn.length - 1 - index),
        },
        labelled ? bar.short : '',
      );
      column.append(stack, label);
      columnList.append(column);
    });
    plot.append(axis, columnList);
    chart.append(plot);
    // Nothing to scale: the axis says no numbers (round 7: an empty range).
    if (!grand) axis.textContent = '';
    if (!grand) {
      chart.append(
        make('p', { class: 'usage-chart-empty' }, options.empty ?? 'No AI work in these days.'),
      );
    }

    // Show the numbers: every bar's groups and total, the same values as the bars.
    const details = make('details', { class: 'bar-chart-data usage-chart-data' });
    details.append(numbersSummary());
    const wrap = make('section', {
      class: 'data-table-wrap',
      tabindex: '0',
      'aria-label': `${options.title ?? 'AI usage'}, as a table`,
    });
    const table = make('table', { class: 'data-table', role: 'table' });
    const head = make('thead', { role: 'rowgroup' });
    const headRow = make('tr', { role: 'row' });
    const body = make('tbody', { role: 'rowgroup' });
    const header = (words, kind = '') =>
      make('th', { role: 'columnheader', scope: 'col', class: kind || null }, words);
    const number = (value, label, total = false) =>
      make(
        'td',
        { role: 'cell', class: total ? 'is-number is-total' : 'is-number', 'data-label': label },
        words(value),
      );
    // A few days of several groups (two days of six models, say): the days are the columns and
    // the groups the rows, so the long group names wrap as row names and the table fits its card
    // without scrolling sideways (UAT-RD RD-8). Many days, or rows of tasks, keep a row a bar.
    const across = !byName && groups.length >= 2 && bars.length <= groups.length;
    if (across) {
      table.classList.add('is-across');
      const totalColumn = bars.length > 1;
      headRow.append(header(options.groupLabel ?? 'Model'));
      for (const bar of bars) headRow.append(header(bar.label, 'is-number'));
      if (totalColumn) headRow.append(header('Total', 'is-number is-total'));
      for (const group of groups) {
        const row = make('tr', { role: 'row' });
        row.append(make('th', { role: 'rowheader', scope: 'row' }, group.label));
        let sum = 0;
        for (const bar of bars) {
          const value = bar.parts.find((item) => item.group === group)?.value ?? 0;
          sum += value;
          row.append(number(value, bar.label));
        }
        if (totalColumn) row.append(number(sum, 'Total', true));
        body.append(row);
      }
      if (marked.length) {
        const notes = make('tr', { role: 'row' });
        notes.append(make('th', { role: 'rowheader', scope: 'row' }, 'Note'));
        for (const bar of bars) {
          notes.append(
            make(
              'td',
              { role: 'cell', class: 'is-note', 'data-label': bar.label },
              bar.mark?.label ?? '',
            ),
          );
        }
        if (totalColumn) notes.append(make('td', { role: 'cell', class: 'is-total' }));
        body.append(notes);
      }
      // Each day's total, and the whole, close the table.
      const foot = make('tfoot', { role: 'rowgroup' });
      const totals = make('tr', { role: 'row' });
      totals.append(make('th', { role: 'rowheader', scope: 'row' }, 'Total'));
      for (const bar of bars) totals.append(number(bar.total, bar.label));
      if (totalColumn) totals.append(number(grand, 'Total', true));
      foot.append(totals);
      table.append(foot);
      head.append(headRow);
    } else {
      // The Note before the Total (T7-R1, DB 15): the Total ends the row, after every column.
      headRow.append(header(rowLabel));
      for (const group of groups) headRow.append(header(group.label, 'is-number'));
      if (marked.length) headRow.append(header('Note'));
      headRow.append(header('Total', 'is-number is-total'));
      head.append(headRow);
      for (const bar of bars) {
        const row = make('tr', { role: 'row' });
        row.append(make('th', { role: 'rowheader', scope: 'row' }, bar.label));
        for (const group of groups) {
          const part = bar.parts.find((item) => item.group === group);
          row.append(number(part?.value ?? 0, group.label));
        }
        if (marked.length) {
          row.append(
            make(
              'td',
              { role: 'cell', class: 'is-note', 'data-label': 'Note' },
              bar.mark?.label ?? '',
            ),
          );
        }
        row.append(number(bar.total, 'Total', true));
        body.append(row);
      }
    }
    table.prepend(head, body);
    wrap.append(table);
    details.append(make('p', { class: 'data-table-hint' }, 'Scroll sideways for more'), wrap);
    chart.append(details);
    host.append(chart);
    if (byName) {
      fitUsageLabels(chart);
      nextFrame(() => fitUsageLabels(chart));
      if (typeof ResizeObserver === 'function') {
        const watch = new ResizeObserver(() => {
          if (!chart.isConnected) watch.disconnect();
          else fitUsageLabels(chart);
        });
        watch.observe(plot);
      }
    }
    return { chart, groups, total: grand, top };
  }

  // ---------------------------------------------------------------- form scan

  // formScan(host, fields, { site, title, stepMs, channel, onStage, autoplay }) shows how your
  // deputy reads an employer's form (round 5, A1): a schematic of the form whose fields are found
  // one by one, then matched (from Profile, from your résumé, from your answers, or missing), then
  // filled, and then it waits for your review. The stage is said in words above the form, and
  // once, politely, as each stage starts. Under reduced motion or Pause motion the final state
  // shows at once and is said once. fields: [{ id, label, source: 'profile' | 'resume' | 'answers'
  // | 'missing', value, need: 'required' | 'optional' }]. Returns { play(), finish(), stop(),
  // stage }.
  const SCAN_SOURCES = {
    profile: { label: 'From Profile', tone: 'green' },
    resume: { label: 'From your résumé', tone: 'blue' },
    answers: { label: 'From your answers', tone: 'gold' },
    missing: { label: 'Missing', tone: null },
  };
  const SCAN_STAGES = ['open', 'find', 'match', 'fill', 'review'];

  function scanStageWords(stage, counts) {
    const { found, total, matched, filled, missing } = counts;
    return {
      open: 'Opening the page',
      find: `Finding the fields: ${found} of ${total}`,
      match: `Matching the fields to your details: ${matched} of ${total}`,
      fill: `Filling the form: ${filled} of ${total - missing}`,
      review: missing
        ? `Waiting for your review: ${filled} filled, ${missing} ${missing === 1 ? 'needs' : 'need'} you`
        : `Waiting for your review: all ${filled} filled`,
    }[stage];
  }

  function formScan(host, fields = [], options = {}) {
    if (!host || typeof host.querySelector !== 'function') return null;
    const list = (Array.isArray(fields) ? fields : []).map((field, index) => ({
      id: String(field.id ?? `field-${index + 1}`),
      label: String(field.label ?? `Field ${index + 1}`),
      source: Object.hasOwn(SCAN_SOURCES, field.source) ? field.source : 'missing',
      value: field.source === 'missing' ? '' : String(field.value ?? ''),
      need: field.need === 'optional' ? 'optional' : 'required',
    }));
    const total = list.length;
    const state = { stage: 'open', found: 0, matched: 0, filled: 0, timer: 0, stopped: false };
    const missing = list.filter((field) => field.source === 'missing').length;

    host.textContent = '';
    const scan = make('div', { class: 'form-scan', 'data-stage': 'open' });
    const stageLine = make('p', { class: 'form-scan-stage', 'data-scan-stage': true });
    const form = make('div', { class: 'form-scan-form' });
    const bar = make('div', { class: 'form-scan-bar', 'aria-hidden': 'true' });
    bar.append(
      make('span', { class: 'form-scan-dots' }),
      make('span', { class: 'form-scan-site' }, options.site ?? 'careers.example.com'),
    );
    const formTitle = make('p', { class: 'form-scan-title' }, options.title ?? 'Application form');
    const rows = make('ol', { class: 'form-scan-fields', 'aria-label': 'Fields on the form' });
    for (const field of list) {
      const row = make('li', {
        class: 'form-scan-field',
        'data-field': field.id,
        'data-source': field.source,
        'data-need': field.source === 'missing' ? field.need : null,
      });
      const label = make('span', { class: 'form-scan-label' }, field.label);
      const box = make('span', { class: 'form-scan-box' });
      const value = make('span', { class: 'form-scan-value' });
      box.append(value);
      const tag = make('span', { class: 'form-scan-tag' });
      if (field.source === 'missing') {
        tag.classList.add('need-pill');
        tag.setAttribute('data-need', field.need);
        tag.textContent = field.need === 'required' ? 'Missing · Required' : 'Missing · Optional';
      } else {
        tag.classList.add('tone-label');
        tag.setAttribute('data-tone', SCAN_SOURCES[field.source].tone);
        tag.textContent = SCAN_SOURCES[field.source].label;
      }
      const words = make('span', { class: 'sr-only', 'data-scan-words': true });
      row.append(label, box, tag, words);
      rows.append(row);
    }
    form.append(bar, formTitle, rows);
    const key = make('ul', {
      class: 'form-scan-key',
      'aria-label': 'Where each answer comes from',
    });
    for (const [source, info] of Object.entries(SCAN_SOURCES)) {
      if (!list.some((field) => field.source === source)) continue;
      const item = make('li');
      const chip = make(
        'span',
        info.tone
          ? { class: 'tone-label', 'data-tone': info.tone }
          : { class: 'need-pill', 'data-need': 'required' },
        info.tone ? info.label : 'Missing',
      );
      item.append(chip);
      key.append(item);
    }
    scan.append(stageLine, form, key);
    host.append(scan);

    const counts = () => ({
      found: state.found,
      total,
      matched: state.matched,
      filled: state.filled,
      missing,
    });
    const say = (words) => {
      const channel =
        typeof options.channel === 'string'
          ? document.querySelector(options.channel)
          : options.channel;
      announce(words, channel?.getAttribute?.('role') === 'status' ? channel : scan);
    };
    const SAID = {
      open: `Opening ${options.site ?? 'the employer’s page'}.`,
      find: `Finding the fields on the form.`,
      match: `Matching ${total} fields to your Profile, résumé, and answers.`,
      fill: 'Filling the form.',
      review: missing
        ? `Filled ${total - missing} of ${total} fields. ${missing} ${missing === 1 ? 'needs' : 'need'} you. Nothing is sent until you check it.`
        : `Filled all ${total} fields. Nothing is sent until you check it.`,
    };

    function draw() {
      scan.setAttribute('data-stage', state.stage);
      const text = scanStageWords(state.stage, counts());
      if (stageLine.textContent !== text) stageLine.textContent = text;
      list.forEach((field, index) => {
        const row = rows.children[index];
        if (!row) return;
        const found = index < state.found || SCAN_STAGES.indexOf(state.stage) > 1;
        const matched = index < state.matched || SCAN_STAGES.indexOf(state.stage) > 2;
        const filled =
          field.source !== 'missing' &&
          (state.stage === 'review' ||
            (state.stage === 'fill' &&
              list.slice(0, index + 1).filter((item) => item.source !== 'missing').length <=
                state.filled));
        row.classList.toggle('is-found', found);
        row.classList.toggle('is-matched', matched);
        row.classList.toggle('is-filled', filled);
        const value = row.querySelector('.form-scan-value');
        const shown = filled ? field.value : '';
        if (value && value.textContent !== shown) value.textContent = shown;
        const words = row.querySelector('[data-scan-words]');
        const said = !found
          ? ', not found yet'
          : !matched
            ? ', found'
            : field.source === 'missing'
              ? `, missing, ${field.need}`
              : filled
                ? `, filled ${SCAN_SOURCES[field.source].label.toLowerCase()}`
                : `, ${SCAN_SOURCES[field.source].label.toLowerCase()}`;
        if (words && words.textContent !== said) words.textContent = said;
      });
    }

    const stepMs = Math.max(60, Number(options.stepMs) || 380);
    const enter = (stage) => {
      state.stage = stage;
      draw();
      say(SAID[stage]);
      options.onStage?.(stage);
    };
    function finish({ quiet = false } = {}) {
      window.clearTimeout(state.timer);
      state.found = total;
      state.matched = total;
      state.filled = total - missing;
      state.stage = 'review';
      draw();
      if (!quiet) say(SAID.review);
      options.onStage?.('review');
      return 'review';
    }
    function tick() {
      if (state.stopped) return;
      if (motionStill()) {
        finish();
        return;
      }
      if (state.stage === 'open') enter('find');
      else if (state.stage === 'find') {
        state.found += 1;
        draw();
        if (state.found >= total) enter('match');
      } else if (state.stage === 'match') {
        state.matched += 1;
        draw();
        if (state.matched >= total) enter('fill');
      } else if (state.stage === 'fill') {
        state.filled += 1;
        draw();
        if (state.filled >= total - missing) {
          finish();
          return;
        }
      }
      state.timer = window.setTimeout(tick, stepMs);
    }
    function play() {
      state.stopped = false;
      window.clearTimeout(state.timer);
      state.found = 0;
      state.matched = 0;
      state.filled = 0;
      if (motionStill() || !total) return finish();
      enter('open');
      state.timer = window.setTimeout(tick, stepMs);
      return 'open';
    }
    function stop() {
      state.stopped = true;
      window.clearTimeout(state.timer);
    }
    draw();
    if (options.autoplay !== false) play();
    return Object.freeze({
      play,
      finish,
      stop,
      get stage() {
        return state.stage;
      },
    });
  }

  // ---------------------------------------------------------------- secret field

  // secretField(host, { label, reveal, onReveal, onCopy }) shows a secret masked (round 5, R5-6):
  // the label, a fixed run of dots (never the secret's length), Show, and Copy, which copies
  // without showing. Show is a plain button whose words say what it does next: "Show" while the
  // secret is masked and "Hide" while it shows, with no aria-pressed, since a button whose name
  // changes is not also a pressed toggle (round 5 acceptance, D-2 and M-2); the change is said once.
  // reveal() returns the secret (or a promise of it): it runs on every Show and every Copy, so the
  // page's store can log each reveal, and onReveal({ action: 'show' | 'copy' }) runs after it.
  // Hide clears the secret from the page. Returns { hide(), shown }.
  const SECRET_MASK = '••••••••••••';
  // span.secret-field-value holds the mask (hidden from screen readers) and the word "Hidden" for
  // them; Show writes the secret into the mask span, lets screen readers read it, and empties the
  // word.
  function secretValue(id) {
    const wrap = make('span', { class: 'secret-field-value', id: `${id}-value` });
    wrap.append(
      make('span', { 'aria-hidden': 'true', 'data-secret-value': true }, SECRET_MASK),
      make('span', { class: 'sr-only', 'data-secret-state': true }, 'Hidden'),
    );
    return wrap;
  }
  const secretFields = new WeakMap();
  let secretSerial = 0;

  function secretField(host, options = {}) {
    if (!host || typeof host.querySelector !== 'function') return null;
    const wired = host.classList?.contains('secret-field')
      ? host
      : host.querySelector('.secret-field');
    if (wired && secretFields.has(wired)) {
      Object.assign(secretFields.get(wired).options, options);
      return secretFields.get(wired).api;
    }
    secretSerial += 1;
    const id = `jd-secret-${secretSerial}`;
    let field = host.classList?.contains('secret-field')
      ? host
      : host.querySelector('.secret-field');
    if (!field) {
      field = make('div', { class: 'secret-field' });
      field.append(
        make(
          'span',
          { class: 'secret-field-label', id: `${id}-label` },
          options.label ?? 'Password',
        ),
        // The mask is decoration, so screen readers hear "Hidden" instead of the bullet characters
        // (round 5, UAT-A-8). Showing the secret puts it in the same span and clears the word.
        secretValue(id),
        make(
          'button',
          {
            type: 'button',
            class: 'compact-action secret-field-show',
            'aria-describedby': `${id}-label`,
            'data-secret-show': true,
          },
          'Show',
        ),
        make(
          'button',
          {
            type: 'button',
            class: 'compact-action secret-field-copy',
            'aria-describedby': `${id}-label`,
            'data-secret-copy': true,
          },
          'Copy',
        ),
      );
      host.append(field);
    }
    const settings = { ...options };
    const value = field.querySelector('[data-secret-value]');
    const state = field.querySelector('[data-secret-state]');
    const show = field.querySelector('[data-secret-show]');
    show?.removeAttribute('aria-pressed');
    const copy = field.querySelector('[data-secret-copy]');
    const memory = { shown: false };
    const say = (words) => announce(words, settings.channel ?? field);
    const read = async (action) => {
      if (typeof settings.reveal !== 'function') return null;
      try {
        const secret = await settings.reveal({ action });
        return typeof secret === 'string' && secret ? secret : null;
      } catch {
        return null;
      }
    };
    const hide = () => {
      memory.shown = false;
      field.classList.remove('is-shown');
      if (show) show.textContent = 'Show';
      if (value) {
        value.textContent = SECRET_MASK;
        value.setAttribute('aria-hidden', 'true');
      }
      if (state) state.textContent = 'Hidden';
    };
    show?.addEventListener('click', async () => {
      if (memory.shown) {
        hide();
        say(`${settings.label ?? 'Password'} hidden.`);
        return;
      }
      const secret = await read('show');
      if (!secret) {
        say('We couldn’t show it. Try again.');
        return;
      }
      memory.shown = true;
      field.classList.add('is-shown');
      show.textContent = 'Hide';
      if (value) {
        value.textContent = secret;
        value.removeAttribute('aria-hidden');
      }
      if (state) state.textContent = '';
      settings.onReveal?.({ action: 'show' });
      say(`${settings.label ?? 'Password'} shown.`);
    });
    copy?.addEventListener('click', async () => {
      // No clipboard, no read: a reveal is logged only when one really happens.
      const clipboard = window.navigator?.clipboard;
      const secret = typeof clipboard?.writeText === 'function' ? await read('copy') : null;
      if (!secret) {
        say('We couldn’t copy it. Choose Show and copy it yourself.');
        return;
      }
      try {
        await clipboard.writeText(secret);
        settings.onReveal?.({ action: 'copy' });
        settings.onCopy?.();
        say(`${settings.label ?? 'Password'} copied. It isn’t shown.`);
      } catch {
        say('We couldn’t copy it. Choose Show and copy it yourself.');
      }
    });
    const api = Object.freeze({
      hide,
      get shown() {
        return memory.shown;
      },
    });
    secretFields.set(field, { api, options: settings });
    return api;
  }

  // ---------------------------------------------------------------- morph in place

  // morphChildren(target, fresh) makes target's children read as the fresh elements do, keeping
  // its own elements (round 7, T7-1 and T3-19, R9-3): a child with the same shape as its fresh
  // one (the same tags, classes, and keys, element by element, and the same words between
  // elements) keeps its elements, with only the attributes and the words that differ set, so the
  // focused control, an open select, and what a screen reader is on all stay; a child of another
  // shape is swapped for the fresh one, and focus that was in it goes to the control with the same
  // key (data-morph-key, data-page-step, data-page, or id). morphInto(target, fresh) is the one
  // child form. Returns true when every child was kept.
  const kidsOf = (element) => [...(element?.children ?? [])];
  const attributeNames = (element) => {
    if (typeof element.getAttributeNames === 'function') return element.getAttributeNames();
    const list = element.attributes;
    if (typeof list?.keys === 'function' && typeof list?.get === 'function')
      return [...list.keys()];
    return [...(list ?? [])].map((attribute) => attribute.name);
  };
  const morphKey = (element) =>
    element.getAttribute?.('data-morph-key') ??
    element.getAttribute?.('data-page-step') ??
    element.getAttribute?.('data-page') ??
    element.getAttribute?.('id') ??
    '';
  // An element marked data-morph-keep (a chart's slot) keeps its own children: only its
  // attributes are compared and set.
  const keeps = (element) => Boolean(element.hasAttribute?.('data-morph-keep'));
  const shapeOf = (element) => {
    const kids = keeps(element) ? [] : kidsOf(element);
    // Words beside elements are part of the shape; a leaf's words are set in place.
    const words =
      kids.length && element.childNodes
        ? [...element.childNodes]
            .filter((node) => node.nodeType === 3)
            .map((node) => node.nodeValue)
            .join('|')
        : '';
    return `${element.tagName}.${element.getAttribute?.('class') ?? ''}#${morphKey(element)}[${words}](${kids.map(shapeOf).join(',')})`;
  };
  function syncElement(have, want) {
    for (const name of attributeNames(have)) {
      if (!want.hasAttribute(name)) have.removeAttribute(name);
    }
    for (const name of attributeNames(want)) {
      const value = want.getAttribute(name);
      if (have.getAttribute(name) !== value) have.setAttribute(name, value);
    }
    if (keeps(have) && keeps(want)) return;
    const haveKids = kidsOf(have);
    const wantKids = kidsOf(want);
    if (!wantKids.length) {
      if (have.textContent !== want.textContent) have.textContent = want.textContent;
    } else {
      for (const [index, kid] of wantKids.entries()) syncElement(haveKids[index], kid);
    }
    if (have.tagName === 'SELECT' && have.value !== want.value) have.value = want.value;
  }
  function morphChildren(target, fresh) {
    const active = document.activeElement;
    const inside = Boolean(active && target.contains?.(active));
    const key = inside ? morphKey(active) || (active.tagName === 'SELECT' ? 'select' : '') : '';
    const have = kidsOf(target);
    let kept = have.length === fresh.length;
    const final = fresh.map((want, index) => {
      const old = have[index];
      if (old && shapeOf(old) === shapeOf(want)) {
        syncElement(old, want);
        return old;
      }
      kept = false;
      if (old && typeof old.replaceWith === 'function') old.replaceWith(want);
      else old?.remove();
      return want;
    });
    for (const old of have.slice(fresh.length)) old.remove();
    // Where replaceWith is missing, the children go in order (the kept ones keep themselves).
    if (!kept && final.some((node, index) => kidsOf(target)[index] !== node)) {
      for (const node of final) target.append(node);
    }
    if (inside && key && !(document.activeElement && target.contains?.(document.activeElement))) {
      const all = (element) => kidsOf(element).flatMap((kid) => [kid, ...all(kid)]);
      const again = all(target).find(
        (element) =>
          morphKey(element) === key || (key === 'select' && element.tagName === 'SELECT'),
      );
      again?.focus?.({ preventScroll: true });
    }
    return kept;
  }
  const morphInto = (target, fresh) => morphChildren(target, [fresh]);

  // ---------------------------------------------------------------- pagination

  // pagination(host, { total, pageSize, page, onChange, label, href, noun }) is Job matches'
  // pages made shared (round 5, S3): nav[aria-label] after the list with "Page 2 of 3" in words,
  // Previous, the numbered pages (aria-current="page" on the one shown, the one selected style),
  // and Next, each a 44px compact action; the ends stay in place, unavailable (aria-disabled). With
  // more than seven pages the numbers keep the first, the last, and the pages around this one.
  // href(page) makes them links (for ?page=); otherwise they are buttons. A change calls
  // onChange(page) and is said once ("Page 2 of 3."); focus stays on the control pressed, as on
  // Job matches.
  // Returns { render(next), page, pages }.
  function pageItems(page, pages) {
    if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
    const near = new Set([1, pages, page - 1, page, page + 1]);
    if (page <= 3) for (const item of [2, 3, 4]) near.add(item);
    if (page >= pages - 2) for (const item of [pages - 3, pages - 2, pages - 1]) near.add(item);
    const kept = [...near].filter((item) => item >= 1 && item <= pages).sort((a, b) => a - b);
    const items = [];
    for (const item of kept) {
      const last = items.at(-1);
      if (typeof last === 'number' && item - last === 2) items.push(last + 1);
      else if (typeof last === 'number' && item - last > 2) items.push('gap');
      items.push(item);
    }
    return items;
  }

  // Round 7 (R10-6, lists keep your place), every part opt in, so a call without these options
  // draws exactly what it drew: noun: ['role', 'roles'] says the range ("13 to 24 of 40 roles")
  // in place of "Page 2 of 4"; top: a host for a compact pager at the top of the list (the range,
  // Previous, Next; only with more than one page), the same state; sizes: [12, 24, 48] adds the
  // native "Per page" choice at the bottom (onSize(size, page), else onChange(page, size)); a new
  // size keeps the first item you were reading on the page you land on; list: after a change its
  // top comes into view just under the sticky chrome, only when it is above the viewport;
  // heading: focus moves to it (tabindex="-1") and the change is said once ("Page 2 of 4. Roles
  // 13 to 24 of 40."); address: true keeps ?page= (and ?size= when not the first size) in the
  // address with history.replaceState (param and sizeParam rename them).
  const rangeOf = (page, size, total) => ({
    first: total ? (page - 1) * size + 1 : 0,
    last: Math.min(total, page * size),
  });
  const nounOf = (noun, count) => {
    const [one, many] = Array.isArray(noun) ? noun : [noun, noun];
    return count === 1 ? String(one ?? '') : String(many ?? one ?? '');
  };

  let pagerCount = 0;

  function pagination(host, options = {}) {
    if (!host || typeof host.querySelector !== 'function') return null;
    let settings = { ...options };
    let nav = host.matches?.('nav.pagination') ? host : host.querySelector('nav.pagination');
    if (!nav) {
      nav = make('nav', { class: 'pagination', 'aria-label': options.label ?? 'Pages' });
      host.append(nav);
    }
    pagerCount += 1;
    const pagerId = nav.getAttribute('id') || `pagination-${pagerCount}`;
    let topNav = null;
    if (options.top && typeof options.top.querySelector === 'function') {
      topNav = options.top.matches?.('nav.pagination')
        ? options.top
        : options.top.querySelector('nav.pagination');
      if (!topNav) {
        topNav = make('nav', { class: 'pagination is-top' });
        options.top.append(topNav);
      }
      topNav.classList.add('is-top');
    }
    const sizesOf = () =>
      (Array.isArray(settings.sizes) ? settings.sizes : [])
        .map((size) => Math.round(Number(size)))
        .filter((size) => size > 0);
    const counts = () => {
      const size = Math.max(1, Math.round(Number(settings.pageSize) || 10));
      const total = Math.max(0, Math.round(Number(settings.total) || 0));
      const pages = Math.max(1, Math.ceil(total / size));
      const page = Math.min(Math.max(1, Math.trunc(Number(settings.page)) || 1), pages);
      return { size, total, pages, page };
    };
    // "13 to 24 of 40 roles" with a noun, else "Page 2 of 4".
    const countWords = () => {
      const { size, total, pages, page } = counts();
      if (!settings.noun) return `Page ${page} of ${pages}`;
      const { first, last } = rangeOf(page, size, total);
      const noun = nounOf(settings.noun, total);
      if (!total) return `No ${nounOf(settings.noun, 2)}`;
      return `${grouped(first)} to ${grouped(last)} of ${grouped(total)}${noun ? ` ${noun}` : ''}`;
    };
    const control = (page, text, { current = false, disabled = false, step = '' } = {}) => {
      const link = typeof settings.href === 'function';
      const element = make(link && !disabled ? 'a' : 'button', {
        class: `compact-action pagination-${step ? 'step' : 'number'}`,
        'data-page': String(page),
        'data-page-step': step || null,
        type: link && !disabled ? null : 'button',
        href: link && !disabled ? settings.href(page) : null,
        'aria-current': current ? 'page' : null,
        'aria-disabled': disabled ? 'true' : null,
      });
      element.append(document.createTextNode(text));
      if (step) element.append(make('span', { class: 'sr-only' }, ' page'));
      else element.prepend(make('span', { class: 'sr-only' }, 'Page '));
      return element;
    };
    const sizeChoice = () => {
      const sizes = sizesOf();
      if (sizes.length < 2) return null;
      const { size } = counts();
      const id = `${pagerId}-size`;
      const wrap = make('div', { class: 'pagination-size' });
      const label = make('label', { class: 'pagination-size-label', for: id }, 'Per page');
      const select = make('select', { class: 'field-control pagination-size-select', id });
      for (const option of sizes) {
        const item = make('option', { value: String(option) }, String(option));
        if (option === size) item.setAttribute('selected', '');
        select.append(item);
      }
      wrap.append(label, select);
      return wrap;
    };
    function render(next = {}) {
      settings = { ...settings, ...next };
      const { pages, page, total } = counts();
      if (settings.label) nav.setAttribute('aria-label', settings.label);
      setHidden(nav, pages < 2 && settings.hideSingle !== false && !settings.noun);
      const count = make(
        'p',
        { class: settings.noun ? 'pagination-count pagination-range' : 'pagination-count' },
        countWords(),
      );
      const numbers = make('ol', { class: 'pagination-numbers' });
      for (const item of pageItems(page, pages)) {
        const li = make('li');
        if (item === 'gap')
          li.append(make('span', { class: 'pagination-gap', 'aria-hidden': 'true' }, '…'));
        else li.append(control(item, String(item), { current: item === page }));
        numbers.append(li);
      }
      // One row inside the nav, so the nav can size it by its own width (a container query).
      const row = make('div', { class: 'pagination-row' });
      const steps = pages > 1 || !settings.noun;
      row.append(count);
      if (steps) {
        row.append(
          control(Math.max(1, page - 1), 'Previous', { step: 'previous', disabled: page <= 1 }),
          numbers,
          control(Math.min(pages, page + 1), 'Next', { step: 'next', disabled: page >= pages }),
        );
      }
      const choice = sizeChoice();
      if (choice && total > (sizesOf()[0] ?? 0)) row.append(choice);
      // In place (T7-1): a list that grows only changes the words and the ends, never the
      // controls, so focus on Next stays on Next.
      morphInto(nav, row);
      nav.setAttribute('data-pages', String(pages));
      nav.setAttribute('data-total', String(total));
      if (topNav) {
        topNav.setAttribute('aria-label', `${settings.label ?? 'Pages'}, at the top of the list`);
        setHidden(topNav, pages < 2);
        const top = make('div', { class: 'pagination-row' });
        top.append(
          make('p', { class: 'pagination-count pagination-range' }, countWords()),
          control(Math.max(1, page - 1), 'Previous', { step: 'previous', disabled: page <= 1 }),
          control(Math.min(pages, page + 1), 'Next', { step: 'next', disabled: page >= pages }),
        );
        morphInto(topNav, top);
        topNav.setAttribute('data-pages', String(pages));
        topNav.setAttribute('data-total', String(total));
      }
      return { page, pages };
    }
    // The page (and size) in the address, replacing the entry (R10-6).
    const writeAddress = () => {
      if (!settings.address || typeof window.history?.replaceState !== 'function') return;
      const param = settings.param ?? 'page';
      const sizeParam = settings.sizeParam ?? 'size';
      const query = new URLSearchParams(String(window.location?.search ?? ''));
      const { page, size } = counts();
      if (page > 1) query.set(param, String(page));
      else query.delete(param);
      const sizes = sizesOf();
      if (sizes.length && size !== sizes[0]) query.set(sizeParam, String(size));
      else query.delete(sizeParam);
      const search = queryText(query);
      try {
        window.history.replaceState(
          window.history.state,
          '',
          `${window.location?.pathname ?? ''}${search ? `?${search}` : ''}${window.location?.hash ?? ''}`,
        );
      } catch {
        // A file: page in some browsers refuses; the list still changes.
      }
    };
    // After a change: the list's top under the sticky chrome when it is above the viewport, then
    // focus on its heading, and the change said once.
    // T3-6: the heading and the top pager come into view with the list, so the focused heading is
    // never under the sticky header.
    const keepPlace = (words) => {
      const list = settings.list;
      if (list && typeof list.getBoundingClientRect === 'function') {
        const inset = chromeInset();
        const tops = [list, settings.heading, topNav]
          .filter((element) => element && typeof element.getBoundingClientRect === 'function')
          .map(boxOf)
          .filter((box, index) => index === 0 || box.height > 0)
          .map((box) => box.top);
        const top = Math.min(...tops);
        if (top < inset && typeof window.scrollTo === 'function') {
          window.scrollTo({
            top: Math.max(0, (Number(window.scrollY) || 0) + top - inset - 13),
            behavior: motionStill() ? 'instant' : 'smooth',
          });
        }
      }
      const heading = settings.heading;
      if (heading && typeof heading.focus === 'function') {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
      announce(words, settings.channel ?? nav);
    };
    const changeWords = () => {
      const { page, pages, size, total } = counts();
      if (!settings.noun) return `Page ${page} of ${pages}.`;
      const { first, last } = rangeOf(page, size, total);
      const many = nounOf(settings.noun, 2);
      return `Page ${page} of ${pages}. ${many.charAt(0).toUpperCase()}${many.slice(1)} ${grouped(first)} to ${grouped(last)} of ${grouped(total)}.`;
    };
    const onPress = (event, pressed) => {
      const target = event.target?.closest?.('[data-page]');
      if (!target || !pressed?.contains?.(target)) return;
      const handled = typeof settings.onChange === 'function';
      if (target.getAttribute('aria-disabled') === 'true' || handled) event.preventDefault?.();
      if (target.getAttribute('aria-disabled') === 'true' || !handled) return;
      const { page } = counts();
      const asked = Number(target.getAttribute('data-page'));
      if (!Number.isInteger(asked) || asked === page) return;
      const step = target.getAttribute('data-page-step');
      settings.page = asked;
      render();
      writeAddress();
      const { pages } = counts();
      if (settings.heading || settings.list) {
        settings.onChange(asked, counts().size);
        keepPlace(changeWords());
        return;
      }
      // The control pressed was drawn again: focus its new self (or the page shown, when Next or
      // Previous has just become unavailable), so focus is never lost. The page may move it on.
      const same = step ? pressed.querySelector(`[data-page-step="${step}"]`) : null;
      const again =
        same && same.getAttribute('aria-disabled') !== 'true'
          ? same
          : (pressed.querySelector('[aria-current="page"]') ??
            nav.querySelector('[aria-current="page"]'));
      again?.focus?.();
      announce(
        settings.noun ? changeWords() : `Page ${asked} of ${pages}.`,
        settings.channel ?? nav,
      );
      settings.onChange(asked);
    };
    nav.addEventListener('click', (event) => onPress(event, nav));
    topNav?.addEventListener('click', (event) => onPress(event, topNav));
    nav.addEventListener('change', (event) => {
      if (!event.target?.matches?.('.pagination-size-select')) return;
      const size = Math.round(Number(event.target.value));
      const { page, size: before } = counts();
      if (!(size > 0) || size === before) return;
      const firstShown = (page - 1) * before;
      settings.pageSize = size;
      settings.page = Math.floor(firstShown / size) + 1;
      render();
      writeAddress();
      nav.querySelector('.pagination-size-select')?.focus?.();
      if (typeof settings.onSize === 'function') settings.onSize(size, counts().page);
      else settings.onChange?.(counts().page, size);
      announce(changeWords(), settings.channel ?? nav);
    });
    render();
    return Object.freeze({
      render,
      get page() {
        return counts().page;
      },
      get pages() {
        return counts().pages;
      },
      get size() {
        return counts().size;
      },
    });
  }

  // The page and size an address asks for: ?page= (a whole number, at least 1) and ?size= (one of
  // the sizes, else the first).
  pagination.fromAddress = ({ param = 'page', sizeParam = 'size', sizes = [] } = {}) => {
    const query = new URLSearchParams(String(window.location?.search ?? ''));
    const page = Math.max(1, Math.trunc(Number(query.get(param))) || 1);
    const list = (Array.isArray(sizes) ? sizes : []).map(Number).filter((size) => size > 0);
    const asked = Math.round(Number(query.get(sizeParam)));
    return { page, size: list.includes(asked) ? asked : (list[0] ?? null) };
  };

  // ---------------------------------------------------------------- pause banner

  // agreementBanner(host, { returnTo }) is one line at the top of a signed-in page while your
  // deputy is paused for an unsigned agreement (round 5, G1): JobDeputyStore.agreements().paused.
  // It is the shared warning FeedbackPanel ("Your deputy is paused until you sign the updated
  // agreement") and Review and sign, which opens
  // agreement-preview.html?mode=update&return=<this page>. It follows the store, hides when the
  // account is not paused (or the store has no agreements), and says itself once when it appears
  // after the page has loaded. Returns { render(), paused }.
  function agreementBanner(host, options = {}) {
    if (!host || typeof host.querySelector !== 'function') return null;
    const store = options.store ?? window.JobDeputyStore;
    let banner = host.classList?.contains('agreement-banner')
      ? host
      : host.querySelector('.agreement-banner');
    if (!banner) {
      banner = make('div', {
        class: 'agreement-banner',
        'data-agreement-banner': true,
        hidden: true,
      });
      host.prepend(banner);
    }
    // Where signing returns to: this page, with its query and anchor (A4's ?return= contract).
    const page = () => {
      if (options.returnTo) return options.returnTo;
      const path =
        String(window.location?.pathname ?? '')
          .split('/')
          .pop() || 'home-preview.html';
      return `${path}${window.location?.search ?? ''}${window.location?.hash ?? ''}`;
    };
    const memory = { shown: null };
    function render() {
      let paused = false;
      try {
        paused = Boolean(typeof store?.agreements === 'function' && store.agreements()?.paused);
      } catch {
        paused = false;
      }
      if (paused && !banner.querySelector('.feedback-panel')) {
        const panel = make('div', { class: 'feedback-panel has-action', 'data-kind': 'warning' });
        const icon = make('span', { class: 'feedback-panel-icon', 'aria-hidden': 'true' }, '!');
        const copy = make('div', { class: 'feedback-panel-copy' });
        copy.append(
          make(
            'p',
            { class: 'feedback-panel-title' },
            'Your deputy is paused until you sign the updated agreement',
          ),
        );
        const action = make(
          'a',
          {
            class: 'feedback-panel-action',
            href: `./agreement-preview.html?mode=update&return=${encodeURIComponent(page())}`,
          },
          'Review and sign',
        );
        panel.append(icon, copy, action);
        banner.append(panel);
      }
      setHidden(banner, !paused);
      if (memory.shown === false && paused) {
        announce('Your deputy is paused until you sign the updated agreement.', banner);
      }
      memory.shown = paused;
      return paused;
    }
    if (typeof store?.subscribe === 'function') store.subscribe(() => render());
    render();
    return Object.freeze({
      render,
      get paused() {
        return Boolean(memory.shown);
      },
    });
  }

  // ---------------------------------------------------------------- growing lists (round 6)

  // R6-4: a list whose length depends on the person's data never shows one chip, label, bar, or
  // key item per value without a cap. topWithOther picks the top N and sums the rest; seeAll
  // lists every item in a drawer; multiSelect filters over many values; stackedBars draws bars
  // stacked by series with the top 5 named and the rest as Other.

  const pickOf = (item, how, fallback) => {
    if (typeof how === 'function') return how(item);
    if (typeof how === 'string') return item?.[how];
    return fallback(item);
  };

  // topWithOther(list, { n = 5, value, key, label, otherLabel = 'Other' }): the n largest items by
  // value (ties by label, then their order) and one Other part summing the rest, the same contract
  // and the same order as JobDeputyStore.topWithOther. value, key, and label are a function of the
  // item or the name of its field.
  function topWithOther(list, { n = 5, value, key, label, otherLabel = 'Other' } = {}) {
    const items = (Array.isArray(list) ? list : []).map((item, index) => {
      const amount = Number(
        pickOf(item, value, (entry) => entry?.value ?? entry?.count ?? entry?.tokens ?? 0),
      );
      const name = String(
        pickOf(item, label, (entry) => entry?.label ?? entry?.name ?? entry?.id ?? '') ?? '',
      );
      return {
        item,
        value: Number.isFinite(amount) ? amount : 0,
        label: name,
        key: String(pickOf(item, key, (entry) => entry?.id ?? entry?.key ?? name) ?? name),
        index,
      };
    });
    const all = items
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label) || a.index - b.index)
      .map(({ index: _index, ...rest }) => rest);
    const count = Math.max(0, Math.floor(Number(n) || 0));
    const top = all.slice(0, count);
    const rest = all.slice(count);
    const add = (entries) => entries.reduce((total, entry) => total + entry.value, 0);
    return {
      top,
      other: rest.length
        ? {
            label: otherLabel,
            value: add(rest),
            count: rest.length,
            items: rest.map((entry) => entry.item),
          }
        : null,
      total: add(all),
      all,
    };
  }

  // "1 source" or "124 sources", from a [one, many] pair (or one word used for both).
  function counted(count, words, fallback = ['item', 'items']) {
    const [one, many] = Array.isArray(words) ? words : words ? [words, words] : fallback;
    return `${grouped(count)} ${count === 1 ? one : (many ?? one)}`;
  }

  // Lower case without accents, so "resume" finds "Résumé".
  const folded = (text) =>
    String(text ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();

  // A 16px line icon on the nav icons' 24-unit grid (the chip's cross, the button's chevron).
  function lineIcon(className, path) {
    const icon = svg('svg', {
      class: className,
      viewBox: '0 0 24 24',
      width: 16,
      height: 16,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.75,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    icon.append(svg('path', { d: path }));
    return icon;
  }
  const crossIcon = () => lineIcon('multi-select-chip-icon', 'm7.5 7.5 9 9M16.5 7.5l-9 9');
  const chevronIcon = () => lineIcon('multi-select-chevron', 'm7 10 5 5 5-5');

  // A scale's top for counts: four even quarters of a whole number (4, 8, 12, 16, 20, ...).
  function countTop(value) {
    if (!(value > 4)) return 4;
    const power = 10 ** Math.floor(Math.log10(value / 4));
    for (const step of [1, 2, 3, 4, 5, 6, 8, 10]) {
      if (4 * step * power >= value) return 4 * step * power;
    }
    return 40 * power;
  }

  // ---------------------------------------------------------------- see all

  // seeAll.open({ title, items, noun, countLabel, searchLabel, sorts, key, note, eyebrow },
  // opener) lists every item in one drawer (dialog.drawer.see-all-drawer): a search box, a sort,
  // the result count, and each item as a row (its colour swatch when key is on, its name and
  // meta, its count, and its link). The shared drawer brings Escape, the backdrop, the scroll
  // lock, and focus back to the opener. The result count is said once, politely, after typing
  // settles. Items: [{ id, label, count, href, tone, other, meta }].
  const seeAllState = { drawer: null, parts: null, options: null, timer: 0, serial: 0 };
  const SEE_ALL_SORTS = [
    { id: 'count', label: 'Most first' },
    { id: 'name', label: 'Name, A to Z' },
  ];

  function seeAllDrawer() {
    if (seeAllState.drawer?.isConnected) return seeAllState.drawer;
    const drawer = make('dialog', {
      class: 'drawer see-all-drawer',
      'aria-labelledby': 'jd-see-all-title',
      'aria-describedby': 'jd-see-all-meta',
    });
    const header = make('div', { class: 'drawer-header' });
    const eyebrow = make('p', { class: 'eyebrow' }, 'See all');
    const title = make('h2', { class: 'drawer-title', id: 'jd-see-all-title' });
    const meta = make('p', { class: 'drawer-meta', id: 'jd-see-all-meta' });
    const close = make(
      'button',
      { type: 'button', class: 'compact-action drawer-close', 'data-drawer-close': true },
      'Close',
    );
    header.append(eyebrow, title, meta, close);
    const body = make('div', { class: 'drawer-body see-all-body' });
    const tools = make('div', { class: 'see-all-tools' });
    const find = make('div', { class: 'see-all-find' });
    const findLabel = make('label', { class: 'field-label', for: 'jd-see-all-find' }, 'Find');
    const input = make('input', {
      class: 'field-control',
      id: 'jd-see-all-find',
      type: 'search',
      autocomplete: 'off',
      'aria-describedby': 'jd-see-all-result',
      autofocus: true,
    });
    find.append(findLabel, input);
    const order = make('div', { class: 'see-all-sort' });
    const sortLabel = make('label', { class: 'field-label', for: 'jd-see-all-sort' }, 'Sort');
    const select = make('select', { class: 'field-control', id: 'jd-see-all-sort' });
    order.append(sortLabel, select);
    tools.append(find, order);
    const result = make('p', { class: 'see-all-result', id: 'jd-see-all-result' });
    const list = make('ol', { class: 'see-all-list', 'aria-labelledby': 'jd-see-all-title' });
    const empty = make('p', { class: 'see-all-empty', hidden: true });
    const note = make('p', { class: 'sample-note see-all-note', hidden: true });
    const status = make('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    body.append(tools, result, list, empty, note);
    drawer.append(header, body, status);
    input.addEventListener('input', () => renderSeeAll({ announce: true }));
    select.addEventListener('change', () => renderSeeAll({ announce: true }));
    drawer.addEventListener('close', () => window.clearTimeout(seeAllState.timer));
    document.body.append(drawer);
    seeAllState.drawer = drawer;
    seeAllState.parts = { eyebrow, title, meta, input, findLabel, select, result, list, empty };
    Object.assign(seeAllState.parts, { note, status });
    return drawer;
  }

  function renderSeeAll({ announce: say = false } = {}) {
    const { options, parts } = seeAllState;
    if (!options || !parts) return;
    const query = folded(parts.input.value);
    const sort = options.sorts.find((item) => item.id === parts.select.value) ?? options.sorts[0];
    const byName = (a, b) => a.label.localeCompare(b.label);
    // No sort, or a sort named "given", keeps the page's own order (most urgent or newest first).
    const compare =
      typeof sort?.compare === 'function'
        ? sort.compare
        : sort?.id === 'name'
          ? byName
          : !sort || sort.id === 'given'
            ? (a, b) => a.order - b.order
            : (a, b) => (b.count ?? 0) - (a.count ?? 0) || byName(a, b);
    const shown = options.items
      .filter((item) => !query || folded(`${item.label} ${item.meta ?? ''}`).includes(query))
      .sort(compare);
    const total = options.items.length;
    parts.result.textContent =
      shown.length === total
        ? sort && options.sorts.length > 1
          ? `${counted(total, options.noun)}, ${sort.label.toLowerCase()}`
          : counted(total, options.noun)
        : `Showing ${grouped(shown.length)} of ${counted(total, options.noun)}`;
    parts.list.textContent = '';
    for (const item of shown) {
      const row = make('li', { class: 'see-all-item' });
      const link = make(item.href ? 'a' : 'div', {
        class: 'see-all-link',
        href: item.href || null,
      });
      if (options.key) {
        const swatch = make('span', {
          class: 'viz-swatch see-all-swatch',
          'data-tone': item.other ? OTHER : item.tone || 'quiet',
          'aria-hidden': 'true',
        });
        link.append(swatch);
      }
      const name = make('span', { class: 'see-all-name' });
      name.append(make('span', { class: 'see-all-label' }, item.label));
      const metaWords = [item.meta, options.key && item.other ? 'In Other' : ''].filter(Boolean);
      if (metaWords.length) {
        name.append(make('span', { class: 'see-all-meta' }, metaWords.join(' · ')));
      }
      link.append(name);
      // An item without a count (a To-do row, a What's new item) has no count column.
      if (item.count !== null) {
        const count = make('span', { class: 'see-all-count' });
        count.append(
          make('strong', {}, grouped(item.count)),
          document.createTextNode(
            ` ${counted(item.count, options.countLabel).replace(/^[\d,]+ /, '')}`,
          ),
        );
        link.append(count);
      }
      row.append(link);
      parts.list.append(row);
    }
    const typed = parts.input.value.trim();
    parts.empty.textContent = typed ? `Nothing matches “${typed}”.` : 'Nothing to show yet.';
    setHidden(parts.empty, shown.length > 0);
    if (say) {
      window.clearTimeout(seeAllState.timer);
      seeAllState.timer = window.setTimeout(() => {
        speak(
          parts.status,
          shown.length
            ? `${parts.result.textContent}.`
            : `${parts.empty.textContent} ${counted(total, options.noun)} in all.`,
        );
      }, 500);
    }
  }

  function openSeeAll(options = {}, opener = document.activeElement) {
    const drawer = seeAllDrawer();
    const parts = seeAllState.parts;
    const noun = options.noun ?? ['item', 'items'];
    // sorts: the choices (the first is the default); [] or one entry draws no sort control.
    const sorts = Array.isArray(options.sorts) ? options.sorts : SEE_ALL_SORTS;
    const items = (Array.isArray(options.items) ? options.items : []).map((item, index) => {
      const given = item?.count === null ? null : (item?.count ?? item?.value);
      return {
        id: String(item?.id ?? index),
        order: index,
        label: String(item?.label ?? item?.name ?? item?.id ?? ''),
        count: given === null ? null : Math.max(0, Number(given ?? 0) || 0),
        href: item?.href ? String(item.href) : '',
        tone: TONES.includes(item?.tone) ? item.tone : '',
        other: Boolean(item?.other) || item?.tone === OTHER,
        meta: item?.meta ? String(item.meta) : '',
      };
    });
    seeAllState.options = { ...options, noun, sorts, items, key: Boolean(options.key) };
    parts.eyebrow.textContent = options.eyebrow ?? 'See all';
    parts.title.textContent = options.title ?? 'Everything';
    parts.meta.textContent = options.meta ?? counted(items.length, noun);
    const many = Array.isArray(noun) ? (noun[1] ?? noun[0]) : noun;
    parts.findLabel.textContent = options.searchLabel ?? `Find ${many}`;
    parts.select.textContent = '';
    for (const sort of sorts) parts.select.append(make('option', { value: sort.id }, sort.label));
    if (sorts.length) parts.select.value = sorts[0].id;
    setHidden(parts.select.parentElement, sorts.length < 2);
    parts.input.value = '';
    parts.note.textContent = options.note ?? '';
    setHidden(parts.note, !options.note);
    renderSeeAll();
    openDrawer(drawer, opener);
    return { drawer, close: () => closeDrawer(drawer) };
  }

  // ---------------------------------------------------------------- multi-select filter

  // multiSelect(host, { name, label, anyLabel, plural, searchLabel, options, selected,
  // countLabel, maxChips = 3, selectedWord = 'selected', onChange }) builds a searchable
  // multi-select filter in host: the
  // WAI-ARIA disclosure (a button with aria-expanded) opening a non-modal popover with a labelled
  // search box and a group of checkboxes, each with its count (selected first, then by count, then
  // by name, as it opens), Clear, and Done; and under it at most maxChips removable chips plus
  // "+N more", which opens the popover again. Escape and Done close it and return focus to the
  // button; a click outside or focus leaving closes it. Each change fires onChange(values) and
  // one bubbling `change` CustomEvent on the root ({ name, values }); the checkboxes' own change
  // events stay inside. The selection is said once, politely.
  let multiSerial = 0;

  // "a" or "an" by the sound that starts the word: "Find an area", "Find a source", "Find a
  // university" (T4-15).
  const withArticle = (word) => {
    const said = String(word ?? '').trim();
    const vowel = /^[aeiou]/i.test(said) && !/^(uni|use|usu|eu|one\b)/i.test(said);
    return `${vowel || /^(hour|honest)/i.test(said) ? 'an' : 'a'} ${said}`;
  };

  function multiSelect(host, settings = {}) {
    if (!host || typeof host.append !== 'function') return null;
    multiSerial += 1;
    const name = String(settings.name ?? `filter-${multiSerial}`);
    const id = `jd-ms-${name.replace(/[^\w-]/g, '-')}-${multiSerial}`;
    const label = String(settings.label ?? 'Filter');
    const anyLabel = String(settings.anyLabel ?? 'Any');
    const plural = String(settings.plural ?? `${label.toLowerCase()}s`);
    const singular = String(settings.singular ?? label.toLowerCase());
    const maxChips = Math.max(0, Math.floor(Number(settings.maxChips ?? 3)));
    const countLabel = settings.countLabel ?? null;
    let options = [];
    const selected = new Set();
    let order = [];
    let open = false;

    const root = make('div', { class: 'multi-select', 'data-multi-select': name });
    const trigger = make('button', {
      type: 'button',
      class: 'multi-select-trigger',
      id: `${id}-trigger`,
      'aria-expanded': 'false',
      'aria-controls': `${id}-popover`,
    });
    const triggerName = make('span', { class: 'multi-select-name' }, `${label}:`);
    const triggerValue = make('span', { class: 'multi-select-value' });
    trigger.append(triggerName, document.createTextNode(' '), triggerValue, chevronIcon());
    const popover = make('div', {
      class: 'multi-select-popover',
      id: `${id}-popover`,
      role: 'group',
      'aria-label': `${label} filter`,
      hidden: true,
    });
    const find = make('div', { class: 'multi-select-find' });
    const findLabel = make(
      'label',
      { class: 'field-label', for: `${id}-find` },
      settings.searchLabel ?? `Find ${withArticle(singular)}`,
    );
    const input = make('input', {
      class: 'field-control',
      id: `${id}-find`,
      type: 'search',
      autocomplete: 'off',
      'aria-describedby': `${id}-result`,
    });
    find.append(findLabel, input);
    const result = make('p', { class: 'multi-select-result', id: `${id}-result` });
    const group = make('fieldset', { class: 'multi-select-options' });
    const legend = make(
      'legend',
      { class: 'sr-only' },
      `${plural.charAt(0).toUpperCase()}${plural.slice(1)}`,
    );
    const list = make('ul', { class: 'multi-select-list' });
    group.append(legend, list);
    const empty = make('p', { class: 'multi-select-empty', hidden: true });
    const foot = make('div', { class: 'multi-select-foot' });
    const clear = make(
      'button',
      { type: 'button', class: 'compact-action multi-select-clear' },
      'Clear',
    );
    const done = make(
      'button',
      { type: 'button', class: 'compact-action multi-select-done' },
      'Done',
    );
    foot.append(clear, done);
    popover.append(find, result, group, empty, foot);
    const chips = make('ul', {
      class: 'multi-select-chips',
      'aria-label': `Selected ${plural}`,
      hidden: true,
    });
    const status = make('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    root.append(trigger, popover, chips, status);
    host.append(root);

    const labelOf = (value) => options.find((option) => option.value === value)?.label ?? value;
    const values = () => order.filter((value) => selected.has(value));
    // One place for the names (round 6, B6's report): while the chips show them, the button says
    // how many ("Company: 3 selected", or selectedWord: "Sources: 30 watched"); with maxChips: 0
    // it names the first two and the rest as +N.
    const selectedWord = String(settings.selectedWord ?? 'selected');
    const summary = () => {
      const picked = values();
      if (!picked.length) return anyLabel;
      if (maxChips > 0) return `${grouped(picked.length)} ${selectedWord}`;
      const names = picked.slice(0, 2).map(labelOf).join(', ');
      return picked.length > 2 ? `${names} +${picked.length - 2}` : names;
    };
    const selectionWords = () => {
      const count = values().length;
      return count ? `${counted(count, [singular, plural])} selected.` : `${label}: ${anyLabel}.`;
    };

    function drawTrigger() {
      triggerValue.textContent = summary();
      if (selected.size) root.setAttribute('data-selected', '');
      else root.removeAttribute('data-selected');
    }

    // Focus that was on a box, a chip, or "+N more" survives a redraw (a page drawing again on a
    // store tick calls setOptions or set while the filter is open; UAT-A A-1): it returns to the
    // same value's box or chip, else the search box while open, else the button.
    function keepFocus(redraw) {
      const active = document.activeElement;
      const inList = Boolean(active && list.contains(active));
      const inChips = Boolean(active && chips.contains(active));
      const key = inList
        ? active.getAttribute('value')
        : inChips
          ? (active.getAttribute('data-value') ??
            (active.classList.contains('multi-select-more') ? '+more' : null))
          : null;
      redraw();
      if (inList && !list.contains(document.activeElement)) {
        const again = [...list.querySelectorAll('input')].find(
          (box) => box.getAttribute('value') === key,
        );
        (again ?? input).focus({ preventScroll: true });
      } else if (inChips && !chips.contains(document.activeElement)) {
        const again =
          key === '+more'
            ? chips.querySelector('.multi-select-more')
            : [...chips.querySelectorAll('.multi-select-chip')].find(
                (chip) => chip.getAttribute('data-value') === key,
              );
        (again ?? (open ? input : trigger)).focus({ preventScroll: true });
      }
    }

    let chipsDrawn = '';
    function drawChips() {
      const picked = values();
      const signature = JSON.stringify([picked, picked.map(labelOf), maxChips]);
      if (signature === chipsDrawn) return;
      chipsDrawn = signature;
      keepFocus(() => drawChipsNow(picked));
    }

    function drawChipsNow(picked) {
      chips.textContent = '';
      // maxChips: 0 shows no chips at all (the button names the selection instead).
      if (maxChips === 0) {
        setHidden(chips, true);
        return;
      }
      for (const value of picked.slice(0, maxChips)) {
        const item = make('li');
        const chip = make('button', {
          type: 'button',
          class: 'compact-action multi-select-chip',
          'data-value': value,
          'aria-label': `Remove ${labelOf(value)}`,
          'data-tip': `Remove ${labelOf(value)} from this filter.`,
        });
        chip.append(make('span', { class: 'multi-select-chip-name' }, labelOf(value)));
        chip.append(crossIcon());
        item.append(chip);
        chips.append(item);
      }
      const more = picked.length - maxChips;
      if (more > 0) {
        const item = make('li');
        // One clean name, starting with the words it shows (T2-13): a visually hidden part inside
        // the button would add a break to its text and a space before the colon to its name.
        const button = make('button', {
          type: 'button',
          class: 'compact-action multi-select-more',
          'aria-controls': `${id}-popover`,
          'aria-expanded': open ? 'true' : 'false',
          'aria-label': `+${grouped(more)} more: show all ${grouped(picked.length)} selected`,
        });
        button.append(document.createTextNode(`+${grouped(more)} more`));
        item.append(button);
        chips.append(item);
      }
      setHidden(chips, picked.length === 0);
    }

    // Selected first, then by count, then by name: the order the list takes as it opens. It
    // stays put while open, so a box never moves under the pointer.
    function sortOptions() {
      order = [...options]
        .sort(
          (a, b) =>
            Number(selected.has(b.value)) - Number(selected.has(a.value)) ||
            b.count - a.count ||
            a.label.localeCompare(b.label),
        )
        .map((option) => option.value);
    }

    // The count under the search box: how many match, or how many there are and are selected.
    let shownCount = 0;
    function drawResult() {
      const total = options.length;
      result.textContent = folded(input.value)
        ? `${grouped(shownCount)} of ${counted(total, [singular, plural])} match`
        : `${counted(total, [singular, plural])}${selected.size ? `, ${grouped(selected.size)} selected` : ''}`;
    }

    // Ticks each box as the selection says, without drawing the list again (focus stays put).
    function syncBoxes() {
      for (const box of list.querySelectorAll('input')) {
        const on = selected.has(box.getAttribute('value') ?? box.value);
        box.checked = on;
        if (on) box.setAttribute('checked', '');
        else box.removeAttribute('checked');
      }
      drawResult();
    }

    function drawList() {
      const query = folded(input.value);
      list.textContent = '';
      let shown = 0;
      for (const value of order) {
        const option = options.find((item) => item.value === value);
        if (!option) continue;
        if (query && !folded(option.label).includes(query)) continue;
        shown += 1;
        const item = make('li');
        const row = make('label', { class: 'multi-select-option' });
        const box = make('input', { type: 'checkbox', value: option.value });
        box.checked = selected.has(option.value);
        if (box.checked) box.setAttribute('checked', '');
        const words = make('span', { class: 'multi-select-option-name' });
        // A source's chart colour, when the page gives one.
        if (option.tone) {
          words.append(
            make('span', {
              class: 'viz-swatch multi-select-swatch',
              'data-tone': option.tone,
              'aria-hidden': 'true',
            }),
          );
        }
        words.append(document.createTextNode(option.label));
        row.append(box, words);
        if (Number.isFinite(option.count)) {
          const count = make('span', { class: 'multi-select-option-count' }, grouped(option.count));
          row.append(count);
          if (countLabel) {
            row.append(
              make(
                'span',
                { class: 'sr-only' },
                ` ${counted(option.count, countLabel).replace(/^[\d,]+ /, '')}`,
              ),
            );
          }
        }
        item.append(row);
        list.append(item);
      }
      shownCount = shown;
      drawResult();
      const typed = input.value.trim();
      empty.textContent = `No ${singular} matches “${typed}”.`;
      setHidden(empty, shown > 0 || !typed);
    }

    let resultTimer = 0;
    function sayResult() {
      window.clearTimeout(resultTimer);
      resultTimer = window.setTimeout(() => speak(status, `${result.textContent}.`), 500);
    }

    function changed() {
      drawTrigger();
      drawChips();
      const picked = values();
      speak(status, selectionWords());
      if (typeof settings.onChange === 'function') {
        try {
          settings.onChange(picked);
        } catch (error) {
          window.setTimeout(() => {
            throw error;
          });
        }
      }
      root.dispatchEvent(
        new CustomEvent('change', { bubbles: true, detail: { name, values: picked } }),
      );
    }

    // The popover opens under the button and stays inside the viewport sideways.
    function placePopover() {
      fitPopover(popover, root);
    }

    function openPopover({ focus = true } = {}) {
      if (open) return;
      open = true;
      sortOptions();
      input.value = '';
      drawList();
      setHidden(popover, false);
      trigger.setAttribute('aria-expanded', 'true');
      for (const more of chips.querySelectorAll('.multi-select-more')) {
        more.setAttribute('aria-expanded', 'true');
      }
      placePopover();
      if (focus) input.focus();
    }

    // Escape and Done return focus to what opened the popover: the button, or "+N more" (UAT-A
    // A-6) while it is still there.
    let openedBy = 'trigger';
    function closePopover({ focus = false } = {}) {
      if (!open) return;
      open = false;
      setHidden(popover, true);
      trigger.setAttribute('aria-expanded', 'false');
      for (const more of chips.querySelectorAll('.multi-select-more')) {
        more.setAttribute('aria-expanded', 'false');
      }
      window.clearTimeout(resultTimer);
      clearSearch();
      const back = openedBy === 'more' ? chips.querySelector('.multi-select-more') : null;
      openedBy = 'trigger';
      if (focus) (back ?? trigger).focus();
    }

    // The search box empties as the popover closes and with Clear (T2-9), so no typed words stay
    // behind unseen, and the list is whole again.
    function clearSearch() {
      if (!input.value) return;
      input.value = '';
      drawList();
    }

    trigger.addEventListener('click', () => {
      if (open) closePopover();
      else {
        openedBy = 'trigger';
        openPopover();
      }
    });
    input.addEventListener('input', () => {
      drawList();
      sayResult();
    });
    // Enter in the search box does not submit a form around the filter.
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') event.preventDefault();
    });
    list.addEventListener('change', (event) => {
      event.stopPropagation();
      const box = event.target;
      if (box?.getAttribute?.('type') !== 'checkbox') return;
      const value = box.getAttribute('value') ?? box.value;
      if (box.checked) selected.add(value);
      else selected.delete(value);
      syncBoxes();
      changed();
      // A box chosen by its words keeps the keyboard's place on it.
      if (document.activeElement !== box) box.focus({ preventScroll: true });
    });
    clear.addEventListener('click', () => {
      clearSearch();
      if (!selected.size) {
        speak(status, selectionWords());
        return;
      }
      selected.clear();
      syncBoxes();
      changed();
    });
    done.addEventListener('click', () => closePopover({ focus: true }));
    chips.addEventListener('click', (event) => {
      const more = event.target.closest?.('.multi-select-more');
      if (more) {
        if (open) {
          input.focus();
          return;
        }
        openedBy = 'more';
        openPopover();
        return;
      }
      const chip = event.target.closest?.('.multi-select-chip');
      if (!chip) return;
      const value = chip.getAttribute('data-value');
      const buttons = [...chips.querySelectorAll('button')];
      const at = buttons.indexOf(chip);
      selected.delete(value);
      if (open) syncBoxes();
      changed();
      // Focus moves to the chip that took its place, else the one before, else the button.
      const after = [...chips.querySelectorAll('button')];
      (after[at] ?? after[at - 1] ?? trigger).focus();
    });
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !open) return;
      // The filter closes; a dialog around it stays open.
      event.preventDefault();
      event.stopPropagation();
      closePopover({ focus: true });
    });
    // A press inside the filter never closes it (UAT-M M-1): a page whose card or sheet takes focus
    // itself (aside#keep-watch, dialog.jobs-sheet) would otherwise move focus to it on the press
    // and close the popover before the click chose the box. A press on the popover's words keeps
    // focus where it was; focus moving to an ancestor of the filter is not focus leaving it. A
    // press outside closes it (the document listener below).
    let pressing = false;
    root.addEventListener(
      'pointerdown',
      () => {
        pressing = true;
      },
      true,
    );
    const released = () => {
      if (pressing) window.setTimeout(() => (pressing = false), 0);
    };
    document.addEventListener('pointerup', released, true);
    document.addEventListener('pointercancel', released, true);
    popover.addEventListener('mousedown', (event) => {
      const target = event.target;
      if (!target?.closest?.('input, button, select, textarea, a[href]')) event.preventDefault();
    });
    root.addEventListener('focusout', (event) => {
      const next = event.relatedTarget;
      if (!open || pressing || !next || typeof next !== 'object') return;
      if (root.contains(next) || next.contains?.(root)) return;
      closePopover();
    });
    const outside = (event) => {
      if (!root.isConnected) {
        document.removeEventListener('pointerdown', outside, true);
        return;
      }
      if (open && event.target && !root.contains(event.target)) closePopover();
    };
    document.addEventListener('pointerdown', outside, true);

    function setOptions(next) {
      options = (Array.isArray(next) ? next : []).map((option) => ({
        value: String(option?.value ?? option?.id ?? ''),
        label: String(option?.label ?? option?.name ?? option?.value ?? option?.id ?? ''),
        count: Number.isFinite(Number(option?.count)) ? Number(option.count) : Number.NaN,
        tone: isTone(option?.tone) ? option.tone : '',
      }));
      for (const value of [...selected]) {
        if (!options.some((option) => option.value === value)) selected.delete(value);
      }
      if (!open) sortOptions();
      else {
        // Open: the list keeps its order and its boxes. The same values update their counts in
        // place; new ones join the end, and the list is drawn again with focus kept.
        const known = new Set(order);
        const added = options.map((option) => option.value).filter((v) => !known.has(v));
        const drawn = [...list.querySelectorAll('input')].map((box) => box.getAttribute('value'));
        const gone = drawn.some((value) => !options.some((option) => option.value === value));
        order = [...order.filter((value) => options.some((o) => o.value === value)), ...added];
        if (added.length || gone) keepFocus(drawList);
        else {
          updateCounts();
          syncBoxes();
        }
      }
      drawTrigger();
      drawChips();
    }

    // The counts beside the boxes, written in place.
    function updateCounts() {
      for (const row of list.querySelectorAll('.multi-select-option')) {
        const value = row.querySelector('input')?.getAttribute('value');
        const option = options.find((item) => item.value === value);
        const count = row.querySelector('.multi-select-option-count');
        if (!option || !count || !Number.isFinite(option.count)) continue;
        const text = grouped(option.count);
        if (count.textContent !== text) count.textContent = text;
        const words = count.nextElementSibling;
        if (countLabel && words?.classList.contains('sr-only')) {
          const said = ` ${counted(option.count, countLabel).replace(/^[\d,]+ /, '')}`;
          if (words.textContent !== said) words.textContent = said;
        }
      }
    }

    function setValues(next) {
      selected.clear();
      for (const value of Array.isArray(next) ? next : []) {
        if (options.some((option) => option.value === String(value))) selected.add(String(value));
      }
      if (!open) sortOptions();
      else syncBoxes();
      drawTrigger();
      drawChips();
    }

    setOptions(settings.options);
    setValues(settings.selected);

    return Object.freeze({
      root,
      get values() {
        return values();
      },
      get isOpen() {
        return open;
      },
      set: setValues,
      setOptions,
      open: () => openPopover(),
      close: () => closePopover({ focus: true }),
      destroy() {
        document.removeEventListener('pointerdown', outside, true);
        root.remove();
      },
    });
  }

  // ---------------------------------------------------------------- stacked bars

  // stackedBars(host, { title, bars, series, cap = 5, otherLabel, unit, keyLabel, empty, store })
  // draws figure.bar-chart.is-stacked in host: one bar per entry, stacked by series in each
  // series' data colour, the bar's total on top, a tip on every part, the key under the chart
  // (the top cap series by total, the rest as one hatched grey Other), and Show the numbers. bars:
  // [{ id, label, short, href, metric, tip, parts: [{ series | sourceId | id, value, metric }] }]
  // (JobDeputyStore.newRolesSeries().bars as they come); series: [{ id, label, tone, href }].
  // The plot is aria-hidden and its bars are pointer shortcuts; the key and the table carry every
  // number. The same data draws nothing new.
  let stackSerial = 0;

  function stackedBars(host, options = {}) {
    if (!host || typeof host.querySelector !== 'function') return null;
    const cap = Math.max(1, Math.floor(Number(options.cap ?? 5)));
    const unit = options.unit ?? ['', ''];
    const partSeries = (part) => String(part?.series ?? part?.sourceId ?? part?.id ?? '');
    const named = (Array.isArray(options.series) ? options.series : []).map((item) => ({
      id: String(item.id),
      label: String(item.label ?? item.id),
      tone: item.tone,
      href: item.href ?? '',
    }));
    const bars = (Array.isArray(options.bars) ? options.bars : []).map((bar) => ({
      id: String(bar?.id ?? ''),
      label: String(bar?.label ?? ''),
      short: String(bar?.short ?? shortLabel(bar?.label)),
      href: bar?.href ?? '',
      metric: bar?.metric ?? '',
      tip: bar?.tip ?? '',
      sublabel: bar?.sublabel ? String(bar.sublabel) : '',
      parts: (bar?.parts ?? [])
        .map((part) => ({
          series: partSeries(part),
          label: part?.label,
          tone: part?.tone,
          href: part?.href ? String(part.href) : '',
          value: Math.max(0, Number(part?.value) || 0),
        }))
        .filter((part) => part.value > 0),
    }));
    // Every series the bars use, named or not, with its total over the bars.
    const all = [...named];
    for (const bar of bars) {
      for (const part of bar.parts) {
        if (!all.some((item) => item.id === part.series)) {
          all.push({ id: part.series, label: String(part.label ?? part.series), tone: part.tone });
        }
      }
    }
    for (const item of all) {
      item.total = bars.reduce(
        (sum, bar) =>
          sum +
          bar.parts
            .filter((part) => part.series === item.id)
            .reduce((total, part) => total + part.value, 0),
        0,
      );
    }
    const ranked = topWithOther(
      all.filter((item) => item.total > 0 && item.tone !== OTHER),
      { n: cap, value: 'total', label: 'label', key: 'id' },
    );
    const shownIds = new Set(ranked.top.map((entry) => entry.key));
    const shown = all
      .filter((item) => shownIds.has(item.id))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
    shown.forEach((item, index) => {
      item.tone = TONES.includes(item.tone) ? item.tone : SERIES_TONES[index % SERIES_TONES.length];
    });
    const otherTotal = all
      .filter((item) => !shownIds.has(item.id))
      .reduce((sum, item) => sum + item.total, 0);
    const otherCount = all.filter((item) => !shownIds.has(item.id) && item.total > 0).length;
    const other = otherTotal
      ? {
          id: 'other',
          label: options.otherLabel ?? 'Other',
          tone: OTHER,
          other: true,
          total: otherTotal,
          count: otherCount,
        }
      : null;
    const keyed = other ? [...shown, other] : shown;
    const groupOf = (id) => (shownIds.has(id) ? shown.find((item) => item.id === id) : other);
    for (const bar of bars) {
      const merged = new Map();
      const links = new Map();
      for (const part of bar.parts) {
        const target = groupOf(part.series);
        if (!target) continue;
        merged.set(target, (merged.get(target) ?? 0) + part.value);
        // A part keeps its link while it stands for one series (Other's parts have none).
        if (!target.other && part.href) links.set(target, part.href);
      }
      bar.stack = keyed
        .filter((item) => merged.has(item))
        .map((item) => ({ group: item, value: merged.get(item), href: links.get(item) ?? '' }));
      // A bar whose parts link needs no link of its own (and a link holds no link).
      bar.partLinks = bar.stack.some((part) => part.href);
      bar.total = bar.stack.reduce((sum, part) => sum + part.value, 0);
    }
    const top = countTop(Math.max(0, ...bars.map((bar) => bar.total)));
    const grand = bars.reduce((sum, bar) => sum + bar.total, 0);
    const units = (count) => counted(count, unit).replace(/^[\d,]+ ?/, '');
    const withUnit = (count) => `${grouped(count)}${units(count) ? ` ${units(count)}` : ''}`;

    const signature = JSON.stringify([
      options.title,
      unit,
      keyed.map((item) => [item.id, item.label, item.tone, item.total]),
      bars.map((bar) => [
        bar.id,
        bar.label,
        bar.sublabel,
        bar.metric,
        bar.href,
        bar.stack.map((part) => [part.value, part.href]),
      ]),
      options.caption,
      options.labelledBy,
      options.keyCounts,
    ]);
    let chart = [...host.children].find((child) => child.classList?.contains('bar-chart'));
    if (chart && chart.getAttribute('data-stack-drawn') === signature) {
      return { chart, series: keyed, total: grand, top };
    }
    chart?.remove();
    stackSerial += 1;
    const id = `jd-stack-${stackSerial}`;
    // caption: false (or labelledBy: the id of the page's own heading) leaves the title out.
    const titled = options.caption !== false && !options.labelledBy;
    chart = make('figure', {
      class: 'bar-chart is-stacked',
      'aria-labelledby': options.labelledBy || (titled ? `${id}-title` : null),
      'aria-label': titled || options.labelledBy ? null : (options.title ?? 'Bars'),
      'data-stack-drawn': signature,
    });
    if (titled) {
      const caption = make('figcaption', { class: 'bar-chart-caption' });
      caption.append(
        make('span', { class: 'bar-chart-title', id: `${id}-title` }, options.title ?? 'Bars'),
      );
      chart.append(caption);
    }

    const plot = make('div', { class: 'bar-chart-plot', 'aria-hidden': 'true' });
    setStyle(plot, '--max', String(top));
    const axis = make('ol', { class: 'bar-chart-axis' });
    for (const share of [1, 0.75, 0.5, 0.25, 0]) {
      axis.append(make('li', {}, grouped(top * share)));
    }
    const groups = make('div', { class: 'bar-chart-groups' });
    // Every bar carries its date (and its sublabel, for example "Keep watch"); fitStackLabels
    // thins them only where they do not fit their columns (measured once drawn and on resize).
    for (const [index, bar] of bars.entries()) {
      const column = make('div', { class: 'bar-chart-group' });
      const holder = make('div', { class: 'bar-chart-bars' });
      const barLink = bar.href && !bar.partLinks;
      const stack = make(barLink ? 'a' : 'span', {
        class: 'bar-chart-bar is-stack',
        href: barLink ? bar.href : null,
        tabindex: barLink ? '-1' : null,
      });
      setStyle(stack, '--value', String(bar.total));
      const pile = make('span', { class: 'bar-chart-stack' });
      stack.append(pile);
      for (const part of bar.stack) {
        const piece = make(part.href ? 'a' : 'span', {
          class: 'bar-chart-part',
          href: part.href || null,
          tabindex: part.href ? '-1' : null,
          'data-tone': part.group.tone,
          'data-series': part.group.id,
          'data-tip-title': `${bar.short || bar.label} · ${part.group.label}`,
          'data-tip': `${withUnit(part.value)}${bar.stack.length > 1 ? ` of ${grouped(bar.total)}` : ''}.${bar.tip ? ` ${bar.tip}` : ''}`,
        });
        setStyle(
          piece,
          '--share',
          String(Math.round((part.value / (bar.total || 1)) * 10000) / 10000),
        );
        pile.append(piece);
      }
      // A narrow plot (a phone) keeps every second date of these, and with many bars only those
      // bars' totals, so no two words touch; the tips and the table keep every figure.
      const fromEnd = String(bars.length - 1 - index);
      const value = make(
        'span',
        { class: 'bar-chart-value', 'data-from-end': fromEnd },
        grouped(bar.total),
      );
      if (bar.metric) value.setAttribute('data-metric', bar.metric);
      stack.append(value);
      holder.append(stack);
      column.append(holder, document.createTextNode(' '));
      column.append(
        make(
          'span',
          // data-day is the bar's full date, so two days that share a letter ("S" for Saturday
          // and Sunday) are never taken for one date said twice (T6-5).
          {
            class: 'bar-chart-label',
            'data-from-end': fromEnd,
            'data-day': bar.label || bar.short,
          },
          bar.short || bar.label,
        ),
      );
      if (bar.sublabel) {
        column.append(make('span', { class: 'bar-chart-sublabel' }, String(bar.sublabel)));
      }
      groups.append(column);
    }
    if (!grand) {
      groups.append(make('p', { class: 'bar-chart-empty' }, options.empty ?? 'Nothing yet.'));
    }
    plot.append(axis, groups);
    chart.append(plot);

    // The key under the chart: each shown series and Other, with its total over these bars.
    const key = make('ul', {
      class: 'chart-key is-compact is-inline bar-chart-stack-key',
      'aria-label': options.keyLabel ?? `${options.title ?? 'Bars'}: the colours`,
    });
    for (const item of keyed) {
      const row = make('li', { 'data-tone': item.tone });
      const entry = make(item.href ? 'a' : 'span', {
        class: 'chart-key-item',
        href: item.href || null,
        'data-tip-title': `${item.label} · ${withUnit(item.total)}`,
        'data-tip': item.other
          ? `${counted(item.count, ['other one', 'others'])} together, beyond the top ${cap}.`
          : `${withUnit(item.total)} over these ${counted(bars.length, ['bar', 'bars']).replace(/^[\d,]+ /, '')}.`,
      });
      entry.append(make('span', { class: 'chart-key-name' }, item.label));
      // keyCounts: false names each series by colour only (its count stays in the tip and the
      // table), for a page that shows the same totals elsewhere (R3-4).
      if (options.keyCounts !== false) {
        entry.append(
          document.createTextNode(' '),
          make('span', { class: 'chart-key-count' }, grouped(item.total)),
        );
        if (units(item.total))
          entry.append(make('span', { class: 'sr-only' }, ` ${units(item.total)}`));
      }
      row.append(entry);
      key.append(row);
    }
    if (keyed.length) chart.append(key);

    // Show the numbers (round 6, N2): one row a bar, its parts in one cell ("Google 2,
    // Microsoft 1", each a link when its part links: the keyboard path), and its total, so the
    // table reads in any card width.
    const details = make('details', { class: 'bar-chart-data' });
    details.append(numbersSummary());
    const wrap = make('section', {
      class: 'data-table-wrap',
      tabindex: '0',
      'aria-label': `${options.title ?? 'Bars'}, as a table`,
    });
    const table = make('table', { class: 'data-table', role: 'table' });
    const head = make('thead', { role: 'rowgroup' });
    const headRow = make('tr', { role: 'row' });
    const totalWord = units(2)
      ? `${units(2).charAt(0).toUpperCase()}${units(2).slice(1)}`
      : 'Total';
    headRow.append(
      make('th', { role: 'columnheader', scope: 'col' }, options.barLabel ?? 'Bar'),
      make('th', { role: 'columnheader', scope: 'col' }, options.partsLabel ?? 'Parts'),
      make('th', { role: 'columnheader', scope: 'col', class: 'is-number is-total' }, totalWord),
    );
    head.append(headRow);
    const body = make('tbody', { role: 'rowgroup' });
    for (const bar of bars) {
      const row = make('tr', { role: 'row' });
      const name = make('th', { role: 'rowheader', scope: 'row' });
      if (bar.href) name.append(make('a', { href: bar.href }, bar.label));
      else name.append(document.createTextNode(bar.label));
      if (bar.sublabel) name.append(make('span', { class: 'data-table-meta' }, bar.sublabel));
      row.append(name);
      const cell = make('td', { role: 'cell', class: 'is-parts', 'data-label': 'Parts' });
      // Each part is one unit with its comma, so a line never starts with ", ".
      bar.stack.forEach((part, at) => {
        const unit = make('span', { class: 'data-table-part' });
        const words = `${part.group.label} ${grouped(part.value)}`;
        if (part.href) unit.append(make('a', { href: part.href }, words));
        else unit.append(document.createTextNode(words));
        if (at < bar.stack.length - 1) unit.append(document.createTextNode(','));
        if (at) cell.append(document.createTextNode(' '));
        cell.append(unit);
      });
      if (!bar.stack.length) cell.textContent = 'None';
      row.append(
        cell,
        make(
          'td',
          { role: 'cell', class: 'is-number is-total', 'data-label': totalWord },
          grouped(bar.total),
        ),
      );
      body.append(row);
    }
    table.append(head, body);
    wrap.append(table);
    details.append(make('p', { class: 'data-table-hint' }, 'Scroll sideways for more'), wrap);
    chart.append(details);
    host.append(chart);
    fitStackLabels(chart);
    nextFrame(() => fitStackLabels(chart));
    if (typeof ResizeObserver === 'function') {
      const watch = new ResizeObserver(() => {
        if (!chart.isConnected) watch.disconnect();
        else fitStackLabels(chart);
      });
      watch.observe(plot);
    }
    return { chart, series: keyed, total: grand, top };
  }

  // The by-task view's names under the bars: each wraps between its words; where a word is still
  // wider than the room from one bar to the next, every second (third, ...) name shows, counted
  // back from the last, and every name stays in the tips and the table.
  function fitUsageLabels(chart) {
    const columns = [...chart.querySelectorAll('.usage-chart-column')];
    if (columns.length < 2) return;
    const room = boxOf(columns[1]).left - boxOf(columns[0]).left;
    if (!(room > 0)) return;
    const items = [...chart.querySelectorAll('.usage-chart-label[data-words]')];
    for (const item of items) item.removeAttribute('data-thinned');
    const words = items.flatMap((item) => String(item.textContent ?? '').split(/\s+/));
    const probe = make('span', { class: 'usage-chart-label', 'aria-hidden': 'true' });
    setStyle(probe, 'position', 'absolute');
    setStyle(probe, 'visibility', 'hidden');
    chart.append(probe);
    let widest = 0;
    for (const word of words) {
      probe.textContent = word;
      widest = Math.max(widest, textWidth(probe));
    }
    probe.remove();
    // Three names or fewer always show (UAT-RM RM-11): they wrap and hyphenate instead.
    let step = 1;
    while (items.length > 3 && step < items.length && widest + 6 > room * step) step += 1;
    for (const item of items) {
      const fromEnd = Number(item.getAttribute('data-from-end')) || 0;
      if (fromEnd % step !== 0) item.setAttribute('data-thinned', '');
    }
  }

  // Thins a stacked chart's dates only where they do not fit (round 6, I-1): every date shows
  // while each fits the room from one bar to the next; else every second, third, and so on,
  // counted back from the last (always dated), and the totals over the bars the same way. A
  // sublabel shows on a bar whose room holds it. Measured from the words themselves, so a wide
  // card keeps every date and a phone thins them.
  // Show the numbers' summary: its words in a span, so the hover underline never reaches the
  // chevron (UAT-RM RM-9).
  function numbersSummary() {
    const summary = make('summary');
    summary.append(make('span', { class: 'bar-chart-data-label' }, 'Show the numbers'));
    return summary;
  }

  // A chart's table wider than its card says so (UAT-RM RM-8): "Scroll sideways for more" over
  // it, while it scrolls; its total column stays in view at the end (the stylesheet).
  function markScrolling(details) {
    const wrap = details?.querySelector?.('.data-table-wrap');
    if (!wrap) return;
    const scrolls = wrap.scrollWidth > wrap.clientWidth + 1;
    if (scrolls) details.setAttribute('data-scrolls', '');
    else details.removeAttribute('data-scrolls');
  }

  document.addEventListener(
    'toggle',
    (event) => {
      const details = event.target;
      if (!details?.classList?.contains('bar-chart-data') || !details.open) return;
      markScrolling(details);
      if (typeof ResizeObserver === 'function' && !details.hasAttribute('data-scroll-watch')) {
        details.setAttribute('data-scroll-watch', '');
        new ResizeObserver(() => markScrolling(details)).observe(details);
      }
    },
    true,
  );

  function textWidth(element) {
    if (typeof document.createRange !== 'function') return 0;
    try {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().width;
    } catch {
      return 0;
    }
  }

  function fitStackLabels(chart) {
    const columns = [...chart.querySelectorAll('.bar-chart-group')];
    if (!columns.length) return;
    const first = boxOf(columns[0]);
    const second = columns[1] ? boxOf(columns[1]) : null;
    // The room from one bar's middle to the next (the column and the gap after it).
    const room = second ? second.left - first.left : first.width;
    if (!(room > 0)) return;
    const thin = (selector) => {
      const items = [...chart.querySelectorAll(selector)];
      for (const item of items) item.removeAttribute('data-thinned');
      const widest = Math.max(0, ...items.map(textWidth));
      let step = 1;
      while (step < items.length && widest + 8 > room * step) step += 1;
      for (const item of items) {
        const fromEnd = Number(item.getAttribute('data-from-end')) || 0;
        if (fromEnd % step !== 0) item.setAttribute('data-thinned', '');
      }
    };
    thin('.bar-chart-label');
    thin('.bar-chart-value');
    // A date and the time under it are thinned together (T1-4): no time under a date that is not
    // there, and where two shown dates read the same, their times tell them apart; where the time
    // does not fit, the repeated date goes instead of reading twice.
    let said = '';
    for (const column of columns) {
      const label = column.querySelector('.bar-chart-label');
      const sub = column.querySelector('.bar-chart-sublabel');
      const dropped = !label || label.hasAttribute('data-thinned');
      if (sub) {
        sub.removeAttribute('data-thinned');
        if (dropped || textWidth(sub) + 8 > room) sub.setAttribute('data-thinned', '');
      }
      if (dropped) continue;
      const words = String(label.getAttribute('data-day') || label.textContent || '').trim();
      const told = Boolean(sub) && !sub.hasAttribute('data-thinned');
      if (words && words === said && !told) {
        label.setAttribute('data-thinned', '');
        continue;
      }
      said = words;
    }
  }

  // ---------------------------------------------------------------- background notices

  // notice({ id, text, detail, kind, href, action, toast, record, pill }) says that a background job
  // finished or needs the person (a prompt test, background applying), one way on every page:
  // - Activity: recorded through JobDeputyStore.addNotice({ id, text, kind, href }) when the store
  //   has it, so the deputy's Activity lists it on every page (record: false leaves it out, for a
  //   notice the store has already recorded itself);
  // - a quiet toast (toast: false leaves it out): div.bg-toast at the bottom end of the viewport,
  //   one at a time, with the words, one action (action: { label, href } or { label, onClick }),
  //   and Dismiss. It stays while hovered or focused and leaves after 21 seconds otherwise (the
  //   Activity keeps it); Escape inside it dismisses it. Where it would cover an action it folds into
  //   a pill ("Done in the background", or pill: the page's words, "Signed"). It is said once, politely, through the
  //   shared status channel; the toast itself has no live role. The same id shows once a page.
  // Returns { element, close() }.
  const TOAST_MS = 21000;
  const toastState = { node: null, timer: 0, held: 0, shown: new Set(), close: null, frame: 0 };
  const NOTICE_KINDS = ['done', 'needs-you', 'stopped'];
  const TOAST_EDGE = 21;
  const INTERACTIVE =
    'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [role="button"]';

  // The controls a box would cover (shown ones, outside the toast).
  function controlsUnder(box) {
    const found = [];
    for (const element of document.querySelectorAll(INTERACTIVE)) {
      if (toastState.node?.contains(element)) continue;
      const r = boxOf(element);
      if (!r.width || !r.height) continue;
      if (r.right <= box.left || r.left >= box.right || r.bottom <= box.top) continue;
      if (r.top >= box.bottom || !isShown(element)) continue;
      found.push(element);
    }
    return found;
  }

  // A toast never covers an action (B4's report). It takes the first corner of the page's
  // content (bottom right, top right under the chrome, bottom left, top left) where it covers no
  // control. Where every corner would cover one, it folds into a 44px pill ("Your deputy needs
  // you") at the corner that covers least, never over the focused control; the pill opens the
  // whole notice on request. It moves again as the page scrolls or resizes and as focus moves,
  // but never while the pointer rests on it.
  function bestToastSpot(node) {
    const view = viewportSize();
    const main = boxOf(document.querySelector('main') ?? document.body);
    const size = boxOf(node);
    if (!size.width) return null;
    const left = Math.max(TOAST_EDGE / 2, Math.max(main.left, 0) + TOAST_EDGE);
    const right = Math.min(main.right || view.width, view.width) - TOAST_EDGE;
    const top = chromeInset() + TOAST_EDGE;
    const bottom = view.height - TOAST_EDGE;
    const x = Math.max(TOAST_EDGE / 2, right - size.width);
    const spots = [
      [x, bottom - size.height],
      [x, top],
      [left, bottom - size.height],
      [left, top],
    ];
    const focused = document.activeElement;
    let best = null;
    for (const [spotLeft, spotTop] of spots) {
      const covered = controlsUnder({
        left: spotLeft,
        top: spotTop,
        right: spotLeft + size.width,
        bottom: spotTop + size.height,
      });
      const score = covered.includes(focused) ? Number.POSITIVE_INFINITY : covered.length;
      if (!best || score < best.score) best = { spotLeft, spotTop, score };
      if (score === 0) break;
    }
    return best;
  }

  function placeToast() {
    const node = toastState.node;
    if (!node || toastState.held > 0) return;
    const opened = node.hasAttribute('data-opened');
    node.classList.remove('is-compact');
    let best = bestToastSpot(node);
    if (!best) return;
    if (best.score > 0 && !opened) {
      node.classList.add('is-compact');
      best = bestToastSpot(node) ?? best;
    }
    setStyle(node, 'left', `${Math.round(best.spotLeft)}px`);
    setStyle(node, 'top', `${Math.round(best.spotTop)}px`);
    setStyle(node, 'right', 'auto');
    setStyle(node, 'bottom', 'auto');
  }

  function scheduleToastPlace() {
    if (!toastState.node || toastState.frame) return;
    toastState.frame = nextFrame(() => {
      toastState.frame = 0;
      placeToast();
    });
  }

  // Focus moving under the toast moves the toast.
  document.addEventListener('focusin', (event) => {
    if (toastState.node && !toastState.node.contains(event.target)) scheduleToastPlace();
  });

  function closeToast({ restore = true } = {}) {
    const node = toastState.node;
    if (!node) return;
    window.clearTimeout(toastState.timer);
    const hadFocus = node.contains(document.activeElement);
    toastState.node = null;
    toastState.held = 0;
    node.remove();
    // Focus that was in the toast goes to the page's main heading, never lost.
    if (hadFocus && restore) returnFocus(null);
  }

  function armToast() {
    window.clearTimeout(toastState.timer);
    if (toastState.held > 0) return;
    toastState.timer = window.setTimeout(() => closeToast(), TOAST_MS);
  }

  function showNotice(options = {}) {
    const text = String(options.text ?? '').trim();
    const inert = { element: null, close: () => undefined };
    if (!text) return inert;
    const id = options.id ? String(options.id) : '';
    const kind = NOTICE_KINDS.includes(options.kind) ? options.kind : 'done';
    const action = options.action?.label ? options.action : null;
    const href = String(options.href ?? action?.href ?? '');
    const store = window.JobDeputyStore;
    if (options.record !== false && typeof store?.addNotice === 'function') {
      try {
        store.addNotice({ id, text, kind, href });
      } catch {
        // The toast still says it.
      }
    }
    if (options.toast === false) return inert;
    if (id && toastState.shown.has(id)) return inert;
    if (id) toastState.shown.add(id);
    // Phones (UAT-M M-19, A1's request 5): the deputy's chip in the app bar carries the notice
    // (its duty and an attention dot until Activity, which lists it, is opened), so nothing
    // floats over the page. The words are still said once.
    const deputy = window.JobDeputyDeputy;
    if (
      // Tablets too (A1, UAT-RM RM-3): the rail medallion carries it from 1100px down, where a
      // floating toast would sit over the page heading.
      mediaMatches('(max-width: 1100px)') &&
      typeof deputy?.notice === 'function' &&
      document.querySelector('.app-sidebar-deputy [data-deputy]')
    ) {
      // Every notice goes to the chip, whatever record says (UAT-RM RM-3: the store writes apply
      // jobs' Activity itself); source tells the deputy a page handed it over.
      try {
        deputy.notice({ id, kind, text, href, source: 'page' });
      } catch {
        // The announcement below still says it.
      }
      const said = (part) => {
        const words = String(part ?? '').trim();
        return words && !/[.!?…]$/.test(words) ? `${words}.` : words;
      };
      announce([said(text), said(options.detail)].filter(Boolean).join(' '), openModal());
      // Closing the notice (the job moved on) clears the chip, when the deputy can.
      return {
        element: null,
        close: () => {
          try {
            deputy.clearNotice?.(id);
          } catch {
            // Opening Activity clears it too.
          }
        },
      };
    }
    // A modal dialog open (a role's panel, the tour) leaves the page inert under its backdrop, so
    // a toast there could be neither reached nor heard (UAT-RD RD-7). The words are said inside
    // the dialog now, and the toast waits until no dialog is open; Activity has it meanwhile.
    const sentence = (part) => {
      const words = String(part ?? '').trim();
      return words && !/[.!?]$/.test(words) ? `${words}.` : words;
    };
    const words = [sentence(text), sentence(options.detail)].filter(Boolean).join(' ');
    const modal = openModal();
    if (modal) {
      announce(words, modal);
      return toastAfterModal(modal, () => mountToast(options, { id, kind, text, action }));
    }
    const shown = mountToast(options, { id, kind, text, action });
    // Said once: the words and the detail (the action is in the toast and in Activity).
    announce(words);
    return shown;
  }

  // The open modal dialog, if any.
  function openModal() {
    try {
      return document.querySelector(':modal');
    } catch {
      return null;
    }
  }

  // Shows the toast once the modal dialog closes and no other is open (it waits for that one in
  // turn); close() before then means it never shows.
  function toastAfterModal(modal, mount) {
    let cancelled = false;
    let shown = null;
    const wait = (dialog) => {
      dialog.addEventListener(
        'close',
        () =>
          nextFrame(() => {
            if (cancelled) return;
            const next = openModal();
            if (next) wait(next);
            else shown = mount();
          }),
        { once: true },
      );
    };
    wait(modal);
    return {
      element: null,
      close: () => {
        cancelled = true;
        shown?.close();
      },
    };
  }

  function mountToast(options, { id, kind, text, action }) {
    closeToast({ restore: false });

    const node = make('div', { class: 'bg-toast', 'data-kind': kind, 'data-notice': id || null });
    // The pill it folds into where it would cover an action: one button that opens the notice.
    const PILL_WORDS = {
      done: 'Done in the background',
      'needs-you': 'Your deputy needs you',
      stopped: 'A job stopped',
    };
    const pill = make('button', { type: 'button', class: 'compact-action bg-toast-open' });
    pill.append(
      make('span', { class: 'bg-toast-icon', 'aria-hidden': 'true' }),
      // pill: the page's own folded words for this notice (AP-8: "Signed"), else the kind's.
      document.createTextNode(
        typeof options.pill === 'string' && options.pill.trim()
          ? options.pill.trim()
          : PILL_WORDS[kind],
      ),
      // One full stop after the words (UAT-D D-8: "...stays in use.. Show the notice").
      make('span', { class: 'sr-only' }, `: ${text.replace(/[.!?…]+$/, '')}. Show the notice`),
    );
    pill.addEventListener('click', () => {
      node.setAttribute('data-opened', '');
      node.classList.remove('is-compact');
      placeToast();
      node.querySelector('.bg-toast-action, .bg-toast-close')?.focus();
    });
    node.append(pill);
    const icon = make('span', { class: 'bg-toast-icon', 'aria-hidden': 'true' });
    const words = make('p', { class: 'bg-toast-text' });
    words.append(make('strong', { class: 'bg-toast-title' }, text));
    if (options.detail) {
      words.append(make('span', { class: 'bg-toast-detail' }, String(options.detail)));
    }
    node.append(icon, words);
    if (action) {
      const control = action.href
        ? make('a', { class: 'compact-action bg-toast-action', href: action.href }, action.label)
        : make('button', { type: 'button', class: 'compact-action bg-toast-action' }, action.label);
      control.addEventListener('click', (event) => {
        if (typeof action.onClick === 'function') {
          try {
            action.onClick(event);
          } catch (error) {
            window.setTimeout(() => {
              throw error;
            });
          }
        }
        closeToast({ restore: !action.href });
      });
      node.append(control);
    }
    const dismiss = make('button', {
      type: 'button',
      class: 'compact-action bg-toast-close',
      'aria-label': 'Dismiss this notice',
    });
    dismiss.append(lineIcon('bg-toast-close-icon', 'm7.5 7.5 9 9M16.5 7.5l-9 9'));
    dismiss.addEventListener('click', () => closeToast());
    node.append(dismiss);
    // It stays while a pointer rests on it or focus is in it.
    const hold = () => {
      toastState.held += 1;
      window.clearTimeout(toastState.timer);
    };
    const letGo = () => {
      toastState.held = Math.max(0, toastState.held - 1);
      armToast();
      scheduleToastPlace();
    };
    node.addEventListener('pointerenter', hold);
    node.addEventListener('pointerleave', letGo);
    node.addEventListener('focusin', (event) => {
      if (!node.contains(event.relatedTarget)) hold();
    });
    node.addEventListener('focusout', (event) => {
      if (!node.contains(event.relatedTarget)) letGo();
    });
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeToast();
    });
    document.body.append(node);
    toastState.node = node;
    placeToast();
    armToast();
    return { element: node, close: () => (toastState.node === node ? closeToast() : undefined) };
  }

  // ---------------------------------------------------------------- score trend (round 6, N1)

  // scoreTrend(host, { title, points, minimum, size, caption, labelledBy, empty, key, numbers })
  // draws how a prompt's test score moved across its versions: figure.score-trend with a point per
  // version in order joined by a line, the minimum as a dashed line, each point's shape and words
  // saying how its test went (a filled circle Passed, a hollow diamond Did not pass, a dashed
  // circle Testing now; a ring marks the version in use, a dashed ring the one on trial), the
  // score over each point and the version under it (thinned only where they do not fit), a key
  // naming every shape shown, and Show the numbers. size: 'compact' (a 300px column: the drawer,
  // Searches), 'large', 'medium' (round 6 part 3: about 100px tall and 240 to 320px wide, every
  // score labelled where it fits, for a list row with room, as on Settings, Prompts), or 'row'
  // (round 6 part 3: about 48px tall, for a row
  // of a list such as the Dashboard's Prompt tests, whose card says the key and the numbers once:
  // scoreTrend.key and scoreTrend.numbers). The plot's width follows the number of versions
  // (--trend-points), so two points never stretch over a wide card. key and numbers (default:
  // on, off for 'row') show or leave out the key and Show the numbers. points: [{ id, label,
  // short, score (0 to 100), result: 'passed' | 'failed' | 'testing', inUse, trial, date, note,
  // href, metric }]; metric puts that key on the score over the point (data-metric), for a page
  // that shows each score once. It draws still: nothing animates.
  let trendSerial = 0;
  const TREND_RESULTS = ['passed', 'failed', 'testing'];
  const TREND_WORDS = { passed: 'Passed', failed: 'Did not pass', testing: 'Testing now' };
  // 'medium' (round 6 part 3): a list row with room for the trend, as on Settings, Prompts.
  const TREND_SIZES = ['compact', 'large', 'row', 'medium'];

  // The key under a trend, or once for a list of row trends (scoreTrend.key): each shape shown,
  // in words, and the minimum's dashed line.
  function trendKey({ title, results = [], inUse = false, trial = false, minimum = null } = {}) {
    const key = make('ul', {
      class: 'score-trend-key',
      'aria-label': `${title ?? 'Test score by version'}: what the marks mean`,
    });
    const add = (kind, words) => {
      const item = make('li', { class: 'score-trend-key-item', 'data-key': kind });
      item.append(
        make('span', { class: 'score-trend-swatch', 'aria-hidden': 'true' }),
        document.createTextNode(words),
      );
      key.append(item);
    };
    for (const result of TREND_RESULTS) {
      if (results.includes(result)) add(result, TREND_WORDS[result]);
    }
    if (inUse) add('in-use', 'In use');
    if (trial) add('trial', 'On trial');
    const floor = Number.isFinite(Number(minimum)) && minimum !== null ? Number(minimum) : null;
    if (floor !== null) add('minimum', `Minimum ${floor}%`);
    return key;
  }

  // scoreTrend.key(host, { title, results, inUse, trial, minimum }): the key once, for a card
  // of row trends. Drawn again only when it changes.
  function drawTrendKey(host, options = {}) {
    if (!host || typeof host.querySelector !== 'function') return null;
    const signature = JSON.stringify([
      options.title,
      options.results,
      Boolean(options.inUse),
      Boolean(options.trial),
      options.minimum,
    ]);
    const current = [...host.children].find((child) =>
      child.classList?.contains('score-trend-key'),
    );
    if (current && current.getAttribute('data-key-drawn') === signature) return current;
    current?.remove();
    const key = trendKey(options);
    key.setAttribute('data-key-drawn', signature);
    host.append(key);
    return key;
  }

  // scoreTrend.numbers(host, { title, rows }): one Show the numbers for a card of row trends, the
  // compact chart table (N2): a row a test, with its prompt, version, date, Test score, and
  // result. rows: [{ prompt, href, version, date, score, result, state }] (state: "In use",
  // "On trial", "Rolled back in its trial", said under the version).
  function drawTrendNumbers(host, options = {}) {
    if (!host || typeof host.querySelector !== 'function') return null;
    const rows = (Array.isArray(options.rows) ? options.rows : []).map((row) => ({
      prompt: String(row?.prompt ?? ''),
      href: row?.href ? String(row.href) : '',
      version: String(row?.version ?? ''),
      date: String(row?.date ?? ''),
      score: Number.isFinite(Number(row?.score)) && row?.score !== null ? Number(row.score) : null,
      result: TREND_RESULTS.includes(row?.result) ? row.result : 'passed',
      state: row?.state ? String(row.state) : '',
    }));
    const signature = JSON.stringify([options.title, rows]);
    const current = [...host.children].find((child) =>
      child.classList?.contains('score-trend-data'),
    );
    if (current && current.getAttribute('data-numbers-drawn') === signature) return current;
    const open = Boolean(current?.open);
    current?.remove();
    const details = make('details', {
      class: 'bar-chart-data score-trend-data',
      'data-numbers-drawn': signature,
    });
    if (open) details.open = true;
    details.append(numbersSummary());
    const wrap = make('section', {
      class: 'data-table-wrap',
      tabindex: '0',
      'aria-label': `${options.title ?? 'Test scores'}, as a table`,
    });
    const table = make('table', { class: 'data-table', role: 'table' });
    const head = make('thead', { role: 'rowgroup' });
    const headRow = make('tr', { role: 'row' });
    headRow.append(
      make('th', { role: 'columnheader', scope: 'col' }, 'Prompt'),
      make('th', { role: 'columnheader', scope: 'col' }, 'Version'),
      make('th', { role: 'columnheader', scope: 'col' }, 'Date'),
      make('th', { role: 'columnheader', scope: 'col', class: 'is-number' }, 'Test score'),
      make('th', { role: 'columnheader', scope: 'col' }, 'Result'),
    );
    head.append(headRow);
    const body = make('tbody', { role: 'rowgroup' });
    for (const row of rows) {
      const line = make('tr', { role: 'row' });
      const name = make('th', { role: 'rowheader', scope: 'row' });
      if (row.href) name.append(make('a', { href: row.href }, row.prompt));
      else name.append(document.createTextNode(row.prompt));
      const version = make('td', { role: 'cell', 'data-label': 'Version' }, row.version);
      if (row.state) version.append(make('span', { class: 'data-table-meta' }, row.state));
      line.append(
        name,
        version,
        make('td', { role: 'cell', 'data-label': 'Date' }, row.date),
        make(
          'td',
          { role: 'cell', class: 'is-number', 'data-label': 'Test score' },
          row.score === null ? 'Testing' : `${row.score}%`,
        ),
        make('td', { role: 'cell', 'data-label': 'Result' }, TREND_WORDS[row.result]),
      );
      body.append(line);
    }
    table.append(head, body);
    wrap.append(table);
    details.append(make('p', { class: 'data-table-hint' }, 'Scroll sideways for more'), wrap);
    host.append(details);
    return details;
  }

  function scoreTrend(host, options = {}) {
    if (!host || typeof host.querySelector !== 'function') return null;
    const minimum = Number.isFinite(Number(options.minimum)) ? Number(options.minimum) : null;
    const points = (Array.isArray(options.points) ? options.points : [])
      .map((point, index) => {
        // A test still running has no score yet (null): Number(null) is 0, so check for it first.
        const raw = point?.score;
        const score =
          raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw))
            ? Math.max(0, Math.min(100, Math.round(Number(raw))))
            : null;
        const given = TREND_RESULTS.includes(point?.result) ? point.result : null;
        const result =
          given ??
          (score === null ? 'testing' : minimum === null || score >= minimum ? 'passed' : 'failed');
        return {
          id: String(point?.id ?? index),
          label: String(point?.label ?? `Version ${index + 1}`),
          short: String(point?.short ?? `v${index + 1}`),
          score,
          result,
          inUse: Boolean(point?.inUse),
          trial: Boolean(point?.trial),
          date: point?.date ? String(point.date) : '',
          note: point?.note ? String(point.note) : '',
          // T7-5: why a failed point didn't pass, in the store's words (a drop has its own).
          reason: point?.reason ? String(point.reason) : '',
          href: point?.href ? String(point.href) : '',
          metric: point?.metric ? String(point.metric) : '',
        };
      })
      .filter((point) => point.score !== null || point.result === 'testing');
    const scored = points.filter((point) => point.score !== null);
    const floor = Math.min(minimum ?? 100, ...scored.map((point) => point.score), 100);
    // A score under the minimum keeps its value under it, so the scale leaves room below.
    const below = minimum !== null && scored.some((point) => point.score < minimum);
    const lo = Math.max(0, Math.floor((floor - (below ? 15 : 5)) / 10) * 10);
    const hi = 100;
    const yOf = (score) => Math.round((1 - (score - lo) / (hi - lo)) * 1000) / 10;
    const size = TREND_SIZES.includes(options.size) ? options.size : 'compact';
    // T6-R4: a score under the minimum draws clearly under its dashed line, at least 5px however
    // short the plot (the stylesheet's plot heights), so a 78 against an 80 never sits on it.
    const plotPx = { compact: 96, large: 132, medium: 56, row: 18 }[size];
    const yAt = (score) => {
      const y = yOf(score);
      if (minimum === null || score >= minimum) return y;
      return Math.min(100, Math.max(y, Math.round((yOf(minimum) + 500 / plotPx) * 10) / 10));
    };
    const large = size === 'large';
    const row = size === 'row';
    const medium = size === 'medium';
    const showKey = options.key ?? !(row || medium);
    const showNumbers = options.numbers ?? !(row || medium);
    const pad = large ? 6 : row ? 16 : medium ? 12 : 9;
    const xOf = (index) =>
      points.length === 1
        ? 50
        : Math.round((pad + (index * (100 - 2 * pad)) / (points.length - 1)) * 10) / 10;

    const signature = JSON.stringify([
      options.title,
      size,
      minimum,
      options.caption,
      options.labelledBy,
      showKey,
      showNumbers,
      points.map((point) => [
        point.id,
        point.label,
        point.short,
        point.score,
        point.result,
        point.inUse,
        point.trial,
        point.note,
        point.reason,
        point.href,
        point.metric,
        point.date,
      ]),
    ]);
    let chart = [...host.children].find((child) => child.classList?.contains('score-trend'));
    if (chart && chart.getAttribute('data-trend-drawn') === signature) {
      return { chart, points, minimum, lo };
    }
    chart?.remove();
    trendSerial += 1;
    const id = `jd-trend-${trendSerial}`;
    const titled = options.caption !== false && !options.labelledBy;
    chart = make('figure', {
      class: `score-trend${large ? ' is-large' : row ? ' is-row' : medium ? ' is-medium' : ''}`,
      'aria-labelledby': options.labelledBy || (titled ? `${id}-title` : null),
      'aria-label':
        titled || options.labelledBy ? null : (options.title ?? 'Test score by version'),
      'data-trend-drawn': signature,
      'data-trend-points': String(points.length),
    });
    // The plot's width follows its versions (the stylesheet: a share of room per point).
    setStyle(chart, '--trend-points', String(Math.max(1, points.length)));
    if (titled) {
      const caption = make('figcaption', { class: 'score-trend-head' });
      caption.append(
        make(
          'span',
          { class: 'score-trend-title', id: `${id}-title` },
          options.title ?? 'Test score by version',
        ),
      );
      chart.append(caption);
    }

    const tipFor = (point) => {
      const parts = [
        point.score === null
          ? 'Being tested now.'
          : point.result === 'failed' && point.reason
            ? `${TREND_WORDS.failed}: ${point.reason.replace(/[.]$/, '')}.`
            : `${TREND_WORDS[point.result]}${minimum === null ? '' : point.result === 'failed' ? (point.score < minimum ? `: below your ${minimum}% minimum` : '') : point.result === 'passed' ? `: at or above your ${minimum}% minimum` : ''}.`,
      ];
      if (point.inUse) parts.push('In use now.');
      if (point.trial) parts.push('On trial.');
      if (point.note) parts.push(point.note);
      return parts.join(' ');
    };

    const plot = make('div', { class: 'score-trend-plot', 'aria-hidden': 'true' });
    if (points.length) {
      const line = svg('svg', {
        class: 'score-trend-line',
        viewBox: '0 0 100 100',
        preserveAspectRatio: 'none',
        focusable: 'false',
      });
      const path = scored.map((point) => `${xOf(points.indexOf(point))},${yAt(point.score)}`);
      if (path.length > 1) {
        line.append(
          svg('polyline', {
            class: 'score-trend-path',
            points: path.join(' '),
            'vector-effect': 'non-scaling-stroke',
          }),
        );
      }
      plot.append(line);
      if (minimum !== null) {
        const rule = make('span', { class: 'score-trend-min' });
        setStyle(rule, '--y', `${yOf(minimum)}%`);
        rule.append(make('span', { class: 'score-trend-min-label' }, `Minimum ${minimum}%`));
        plot.append(rule);
      }
      points.forEach((point, index) => {
        const mark = make(point.href ? 'a' : 'span', {
          class: 'score-trend-point',
          href: point.href || null,
          tabindex: point.href ? '-1' : null,
          'data-result': point.result,
          'data-in-use': point.inUse ? true : null,
          'data-trial': point.trial ? true : null,
          'data-from-end': String(points.length - 1 - index),
          'data-tip-title': `${point.label} · ${point.score === null ? 'testing now' : `${point.score}%`}`,
          'data-tip': tipFor(point),
        });
        const y = `${point.score === null ? 100 : yAt(point.score)}%`;
        setStyle(mark, '--x', `${xOf(index)}%`);
        setStyle(mark, '--y', y);
        // The score sits over its point, outside the mark, so a turned diamond leaves it upright.
        // A score under the minimum sits under its point, so the dashed line never runs through
        // it (UAT-RM RM-1).
        const value = make(
          'span',
          {
            class: 'score-trend-value',
            'data-from-end': String(points.length - 1 - index),
            'data-below':
              minimum !== null && point.score !== null && point.score < minimum ? true : null,
          },
          point.score === null ? '…' : `${point.score}%`,
        );
        // A page that shows each score once keys it here (the figure is the store's, and reads
        // the same way: "88%").
        if (point.metric && point.score !== null) value.setAttribute('data-metric', point.metric);
        setStyle(value, '--x', `${xOf(index)}%`);
        setStyle(value, '--y', y);
        plot.append(mark, value);
        const version = make(
          'span',
          { class: 'score-trend-version', 'data-from-end': String(points.length - 1 - index) },
          point.short,
        );
        setStyle(version, '--x', `${xOf(index)}%`);
        plot.append(version);
      });
    } else {
      plot.append(make('p', { class: 'score-trend-empty' }, options.empty ?? 'Not tested yet.'));
      plot.removeAttribute('aria-hidden');
    }
    chart.append(plot);

    // The key: every shape and line the chart shows, in words.
    if (points.length && showKey) {
      chart.append(
        trendKey({
          title: options.title,
          results: TREND_RESULTS.filter((result) =>
            points.some((point) => point.result === result),
          ),
          inUse: points.some((point) => point.inUse),
          trial: points.some((point) => point.trial),
          minimum,
        }),
      );
    }
    if (points.length && showNumbers) {
      const details = make('details', { class: 'bar-chart-data score-trend-data' });
      details.append(numbersSummary());
      const wrap = make('section', {
        class: 'data-table-wrap',
        tabindex: '0',
        'aria-label': `${options.title ?? 'Test score by version'}, as a table`,
      });
      const table = make('table', { class: 'data-table', role: 'table' });
      const head = make('thead', { role: 'rowgroup' });
      const headRow = make('tr', { role: 'row' });
      headRow.append(
        make('th', { role: 'columnheader', scope: 'col' }, 'Version'),
        make('th', { role: 'columnheader', scope: 'col', class: 'is-number' }, 'Test score'),
        make('th', { role: 'columnheader', scope: 'col' }, 'Result'),
      );
      head.append(headRow);
      const body = make('tbody', { role: 'rowgroup' });
      for (const point of points) {
        const row = make('tr', { role: 'row' });
        const name = make('th', { role: 'rowheader', scope: 'row' });
        if (point.href) name.append(make('a', { href: point.href }, point.label));
        else name.append(document.createTextNode(point.label));
        const state = [point.inUse ? 'In use' : '', point.trial ? 'On trial' : '', point.date]
          .filter(Boolean)
          .join(' · ');
        if (state) name.append(make('span', { class: 'data-table-meta' }, state));
        row.append(
          name,
          make(
            'td',
            { role: 'cell', class: 'is-number', 'data-label': 'Test score' },
            point.score === null ? 'Testing' : `${point.score}%`,
          ),
          make('td', { role: 'cell', 'data-label': 'Result' }, TREND_WORDS[point.result]),
        );
        body.append(row);
      }
      table.append(head, body);
      wrap.append(table);
      details.append(make('p', { class: 'data-table-hint' }, 'Scroll sideways for more'), wrap);
      chart.append(details);
    }
    host.append(chart);
    // Measured once every trend drawn in this task is in (T3-5): eight summaries drawn together
    // share one layout instead of forcing one each; the ResizeObserver keeps them fitted after.
    queueTrendFit(chart);
    if (typeof ResizeObserver === 'function') {
      const watch = new ResizeObserver(() => {
        if (!chart.isConnected) watch.disconnect();
        else fitTrendLabels(chart);
      });
      watch.observe(plot);
    } else nextFrame(() => fitTrendLabels(chart));
    return { chart, points, minimum, lo };
  }

  // The trends drawn in one task are fitted together just after it (a microtask, so still before
  // the page paints): the first measure lays out all of them at once.
  const trendFits = new Set();
  function queueTrendFit(chart) {
    trendFits.add(chart);
    if (trendFits.size > 1) return;
    const run = () => {
      const charts = [...trendFits];
      trendFits.clear();
      for (const each of charts) if (each.isConnected !== false) fitTrendLabels(each);
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
  }

  // The minimum's label keeps clear of every point and score (UAT-RM RM-1): at the end of its
  // line, else at the start, else it leaves the plot (the key under the chart says it).
  function placeTrendMinimum(chart) {
    const label = chart.querySelector('.score-trend-min-label');
    if (!label) return;
    const others = [...chart.querySelectorAll('.score-trend-point, .score-trend-value')]
      .filter((item) => !item.hasAttribute('data-thinned'))
      .map(boxOf);
    const clear = () => {
      const box = boxOf(label);
      if (!box.width) return true;
      return !others.some(
        (other) =>
          other.right + 4 > box.left &&
          other.left - 4 < box.right &&
          other.bottom + 2 > box.top &&
          other.top - 2 < box.bottom,
      );
    };
    label.removeAttribute('data-place');
    if (clear()) return;
    label.setAttribute('data-place', 'start');
    if (clear()) return;
    label.setAttribute('data-place', 'none');
  }

  // The scores over the points and the versions under them show while they fit the room from one
  // point to the next; else every second, third, and so on, counted back from the newest (always
  // labelled). Measured from the words, as the stacked bars' dates.
  function fitTrendLabels(chart) {
    placeTrendMinimum(chart);
    const marks = [...chart.querySelectorAll('.score-trend-point')];
    if (marks.length < 2) return;
    const room = boxOf(marks[1]).left - boxOf(marks[0]).left;
    if (!(room > 0)) return;
    for (const selector of ['.score-trend-value', '.score-trend-version']) {
      const items = [...chart.querySelectorAll(selector)];
      for (const item of items) item.removeAttribute('data-thinned');
      const widest = Math.max(0, ...items.map(textWidth));
      let step = 1;
      while (step < items.length && widest + 8 > room * step) step += 1;
      for (const item of items) {
        const fromEnd = Number(item.getAttribute('data-from-end')) || 0;
        if (fromEnd % step !== 0) item.setAttribute('data-thinned', '');
      }
    }
  }

  // ---------------------------------------------------------------- boot (round 7, R10-1)

  // Boot without flicker. A page paints its static markup first, then its script redraws parts of
  // it from the store. Each region the script redraws carries data-skeleton: app-components.css
  // holds it (its box kept, at least --skeleton-min tall; its content hidden, so its shifts never
  // count; a calm shimmer over it) until html[data-boot="ready"]. The page calls boot.ready() at
  // the end of its first render and every held region shows in that one frame. A page that never
  // calls it is revealed by the failsafe (2.5s here, 5s in the CSS for a page whose scripts never
  // ran); a page without data-skeleton regions is ready at once. While a hold lasts past 400ms the
  // deputy says "Gathering your numbers." until the reveal. boot.split, boot.chunks, and
  // boot.yield break a heavy first render into tasks under the 200ms budget.
  const BOOT_FAILSAFE_MS = 2500;
  const BOOT_GATHER_MS = 400;
  const BOOT_BUDGET_MS = 40;
  const GATHER = Object.freeze({ speech: 'Gathering your numbers.', duty: 'Gathering' });
  const boot = {
    state: 'hold',
    started: 0,
    failsafe: 0,
    gather: 0,
    gathering: false,
    waiting: [],
    tourChecked: false,
  };
  const clock = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const heldRegions = () =>
    typeof document.querySelectorAll === 'function'
      ? [...document.querySelectorAll('[data-skeleton]')]
      : [];

  function gatherStart() {
    boot.gather = 0;
    const deputy = window.JobDeputyDeputy;
    if (boot.state === 'ready' || typeof deputy?.hold !== 'function' || deputy.held) return;
    deputy.hold('pending', { ...GATHER, working: true });
    boot.gathering = true;
  }

  function gatherEnd() {
    if (boot.gather) window.clearTimeout(boot.gather);
    boot.gather = 0;
    if (!boot.gathering) return;
    boot.gathering = false;
    const deputy = window.JobDeputyDeputy;
    if (deputy?.held === 'pending' && typeof deputy.release === 'function') deputy.release();
  }

  function bootReady({ failsafe = false } = {}) {
    if (boot.state === 'ready') return false;
    boot.state = 'ready';
    if (boot.failsafe) window.clearTimeout(boot.failsafe);
    boot.failsafe = 0;
    const root = document.documentElement;
    // One synchronous step: the attribute that reveals every held region, and their busy states.
    root?.setAttribute?.('data-boot', 'ready');
    for (const region of heldRegions()) {
      if (region.hasAttribute('data-skeleton-busy')) {
        region.removeAttribute('aria-busy');
        region.removeAttribute('data-skeleton-busy');
      }
    }
    gatherEnd();
    const ms = Math.round(clock() - boot.started);
    if (failsafe && typeof console !== 'undefined') {
      console.warn(
        `JobDeputy boot: ${
          String(window.location?.pathname ?? '')
            .split('/')
            .pop() || 'this page'
        } never called JobDeputyComponents.boot.ready(); revealed after ${ms}ms.`,
      );
    }
    if (typeof CustomEvent === 'function' && typeof document.dispatchEvent === 'function') {
      document.dispatchEvent(new CustomEvent('jobdeputy:boot', { detail: { ms, failsafe } }));
    }
    const waiting = boot.waiting.splice(0);
    for (const run of waiting) {
      try {
        run();
      } catch (error) {
        if (typeof console !== 'undefined') console.error(error);
      }
    }
    scheduleTourSync();
    return true;
  }

  function bootStart() {
    boot.started = clock();
    const root = document.documentElement;
    if (root?.getAttribute?.('data-boot') === 'ready') {
      boot.state = 'ready';
      return;
    }
    const regions = heldRegions();
    if (!regions.length) {
      // Nothing to hold: ready at once (and no failsafe timer).
      boot.state = 'ready';
      root?.setAttribute?.('data-boot', 'ready');
      return;
    }
    root?.setAttribute?.('data-boot', 'hold');
    for (const region of regions) {
      if (region.hasAttribute('aria-busy')) continue;
      region.setAttribute('aria-busy', 'true');
      region.setAttribute('data-skeleton-busy', '');
    }
    boot.failsafe = window.setTimeout(() => bootReady({ failsafe: true }), BOOT_FAILSAFE_MS);
    boot.gather = window.setTimeout(gatherStart, BOOT_GATHER_MS);
  }

  function whenBooted(run) {
    if (typeof run !== 'function') return;
    if (boot.state === 'ready') run();
    else boot.waiting.push(run);
  }

  // One yield to the browser, so it can paint and take input: scheduler.yield where it exists,
  // else a message (no 4ms clamp), else a timer.
  function yieldNow() {
    const scheduler = typeof window.scheduler === 'object' ? window.scheduler : null;
    if (typeof scheduler?.yield === 'function') return scheduler.yield();
    if (typeof MessageChannel === 'function') {
      return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve();
        channel.port2.postMessage(0);
      });
    }
    return new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  // Runs the steps in order; the first at once, and each later one after a yield once the task has
  // used its budget, so no task runs much past it. Resolves when the last step has run.
  async function bootSplit(steps, { budget = BOOT_BUDGET_MS } = {}) {
    const list = (Array.isArray(steps) ? steps : [steps]).filter(
      (step) => typeof step === 'function',
    );
    let since = clock();
    for (const [index, step] of list.entries()) {
      if (index > 0 && clock() - since >= budget) {
        await yieldNow();
        since = clock();
      }
      step();
    }
  }

  // Renders the first items at once, then the rest in chunks between yields.
  async function bootChunks(items, render, { first = 24, budget = BOOT_BUDGET_MS } = {}) {
    const list = Array.isArray(items) ? items : [...(items ?? [])];
    if (typeof render !== 'function') return;
    let since = clock();
    for (const [index, item] of list.entries()) {
      if (index >= first && clock() - since >= budget) {
        await yieldNow();
        since = clock();
      }
      render(item, index);
    }
  }

  // The JS skeleton, for a later load: a .skeleton-block of the kind inside the host, the host
  // busy and its other content hidden, said once if it is still showing after a second.
  const SKELETON_KINDS = ['block', 'lines', 'rows', 'cards', 'chart'];
  const skeletons = new WeakMap();

  function hideSkeleton(host) {
    const entry = host ? skeletons.get(host) : null;
    if (!entry) return false;
    skeletons.delete(host);
    if (entry.timer) window.clearTimeout(entry.timer);
    entry.block.remove();
    host.removeAttribute('data-skeleton-shown');
    if (entry.busy) host.removeAttribute('aria-busy');
    return true;
  }

  function showSkeleton(host, options = {}) {
    if (!host || typeof host.append !== 'function') return null;
    hideSkeleton(host);
    const kind = SKELETON_KINDS.includes(options.kind) ? options.kind : 'block';
    const block = make('div', {
      class: 'skeleton-block',
      'data-skeleton-kind': kind,
      'aria-hidden': 'true',
    });
    const rows = Math.max(1, Math.min(48, Math.round(Number(options.rows) || 0)));
    if (Number(options.rows) > 0) setStyle(block, '--skeleton-rows', String(rows));
    if (Number(options.height) > 0) setStyle(block, 'minHeight', `${Math.round(options.height)}px`);
    const busy = !host.hasAttribute('aria-busy');
    if (busy) host.setAttribute('aria-busy', 'true');
    host.setAttribute('data-skeleton-shown', '');
    host.prepend(block);
    const entry = { block, busy, timer: 0 };
    if (options.label) {
      entry.timer = window.setTimeout(() => {
        entry.timer = 0;
        if (skeletons.get(host) === entry) announce(String(options.label), host);
      }, 1000);
    }
    skeletons.set(host, entry);
    return Object.freeze({ block, hide: () => hideSkeleton(host) });
  }

  // ---------------------------------------------------------------- return to where you were (round 7, R10-3)

  // One home per thing: a link to a home carries return= (the page you are on, with its state),
  // the home shows Back to <page name> at the start of its intro's eyebrow line, and coming back
  // through it restores your place: the scroll, what was open, the control you left from, and what
  // the page itself asked to keep (place.remember), handed back to place.restore. The place is
  // saved per page in sessionStorage when you press a data-return-link (or a place.href link) and
  // when the page is left; it is restored only on a return through Back, within 30 minutes. A
  // return= is accepted only as a page of this prototype in the same folder.
  const PLACE_PREFIX = 'jobdeputy.place.';
  const PLACE_RETURNING = 'jobdeputy.place.returning';
  const PLACE_MAX_AGE_MS = 30 * 60 * 1000;
  const PAGE_NAMES = Object.freeze({
    'home-preview.html': 'Dashboard',
    'searches-preview.html': 'Searches',
    'jobs-preview.html': 'Job matches',
    'applications-preview.html': 'Applications',
    'documents-preview.html': 'Résumés',
    'materials-preview.html': 'Materials',
    'autofill-preview.html': 'Autofill',
    'profile-preview.html': 'Profile',
    'account-preview.html': 'Account',
    'connections-preview.html': 'Connections',
    'prompts-preview.html': 'Prompts',
    'ai-preview.html': 'AI & credits',
    'usage-preview.html': 'Usage',
    'shop-preview.html': 'Purchases',
    'activity-preview.html': 'Activity',
    'invite-preview.html': 'Invite friends',
    'trust-preview.html': 'Help',
    'summary-email-preview.html': 'the sample email',
  });
  const placeState = { remember: null, restore: null, saved: null, restored: false };

  const session = () => {
    try {
      return window.sessionStorage ?? null;
    } catch {
      return null;
    }
  };
  const fileOf = (path) =>
    String(path ?? '')
      .split(/[?#]/)[0]
      .split('/')
      .pop() ?? '';
  const pageFile = () => fileOf(window.location?.pathname);
  // This page's address, relative, without a return= of its own (a Back link never chains).
  function hereAddress() {
    const query = new URLSearchParams(String(window.location?.search ?? ''));
    query.delete('return');
    const search = queryText(query);
    return `./${pageFile()}${search ? `?${search}` : ''}${String(window.location?.hash ?? '')}`;
  }

  // A return= value, only as a page of this prototype in this folder ("./name-preview.html" with
  // a query and an anchor), or null.
  function safeReturn(value) {
    let address = String(value ?? '').trim();
    if (!address) return null;
    if (!address.startsWith('./')) address = `./${address.replace(/^\/+/, '')}`;
    const match = address.match(/^\.\/([a-z0-9-]+\.html)(\?[^#\s]*)?(#[\w-]*)?$/i);
    if (!match || !Object.hasOwn(PAGE_NAMES, match[1] ?? '')) return null;
    const query = new URLSearchParams((match[2] ?? '').slice(1));
    query.delete('return');
    const search = queryText(query);
    return {
      href: `./${match[1]}${search ? `?${search}` : ''}${match[3] ?? ''}`,
      file: match[1],
      name: PAGE_NAMES[match[1]],
    };
  }

  function backTarget() {
    const asked = new URLSearchParams(String(window.location?.search ?? '')).get('return');
    const target = safeReturn(asked);
    return target && target.file !== pageFile() ? target : null;
  }

  // The link to a home, with return= this page (its query and anchor included).
  function placeHref(target) {
    const raw = String(target ?? '');
    const [beforeHash, hash = ''] = raw.split('#');
    const [path, search = ''] = beforeHash.split('?');
    const query = new URLSearchParams(search);
    query.set('return', hereAddress());
    return `${path}?${queryText(query)}${hash ? `#${hash}` : ''}`;
  }

  function placeKeyOf(element) {
    if (!element || element === document.body) return '';
    const key = element.getAttribute?.('data-focus-key');
    if (key) return `key:${key}`;
    const id = element.getAttribute?.('id');
    return id ? `id:${id}` : '';
  }

  // Where to land if the control you left from is gone when you come back (T4-24, EN 8: signing
  // removes the To-do item you pressed): its neighbours in the same list, nearest first, then the
  // other controls of its region, then the region's heading. Keys only (data-focus-key or id).
  const PLACE_FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';
  function nearPlaces(element) {
    if (!element || element === document.body || typeof element.closest !== 'function') {
      return { near: [], heading: '' };
    }
    const keyed = (scope) =>
      [...(scope?.querySelectorAll?.(PLACE_FOCUSABLE) ?? [])]
        .filter(
          (control) =>
            control !== element &&
            !control.hasAttribute('disabled') &&
            control.getAttribute('tabindex') !== '-1' &&
            control.getAttribute('type') !== 'hidden',
        )
        .map(placeKeyOf)
        .filter(Boolean);
    const near = [];
    const item = element.closest('li, tr, [role="listitem"], article');
    const siblings = item?.parentElement ? [...item.parentElement.children] : [];
    const at = siblings.indexOf(item);
    if (at >= 0) {
      for (let step = 1; step < siblings.length; step += 1) {
        for (const index of [at + step, at - step]) {
          if (index >= 0 && index < siblings.length) near.push(...keyed(siblings[index]));
        }
      }
    }
    const region = element.closest('section, [role="region"], aside, form, details, dialog');
    near.push(...keyed(region));
    const heading = region?.querySelector?.('h2, h3, h4');
    return { near: [...new Set(near)].slice(0, 24), heading: placeKeyOf(heading) };
  }

  function savePlace() {
    const store = session();
    if (!store) return null;
    const main = document.querySelector('main') ?? document.body;
    const open = main
      ? [...main.querySelectorAll('details[open][id], dialog[open][id]')].map((item) =>
          item.getAttribute('id'),
        )
      : [];
    let extra = null;
    try {
      extra = typeof placeState.remember === 'function' ? placeState.remember() : null;
    } catch {
      extra = null;
    }
    // What scrolled inside an open dialog or drawer (T4-8): the dialog and any part of it with an
    // id that scrolled.
    const scrolled = {};
    for (const dialog of document.querySelectorAll('dialog[open]')) {
      for (const part of [dialog, ...dialog.querySelectorAll('[id]')]) {
        const id = part.getAttribute?.('id');
        const top = Math.round(Number(part.scrollTop) || 0);
        if (id && top > 0) scrolled[id] = top;
      }
    }
    const saved = {
      at: Date.now(),
      address: hereAddress(),
      scroll: Math.round(Number(window.scrollY) || 0),
      open,
      scrolled,
      focus: placeKeyOf(document.activeElement),
      ...nearPlaces(document.activeElement),
      extra,
    };
    try {
      store.setItem(`${PLACE_PREFIX}${pageFile()}`, JSON.stringify(saved));
    } catch {
      return null;
    }
    return saved;
  }

  function readPlace(file) {
    const store = session();
    if (!store) return null;
    try {
      const saved = JSON.parse(store.getItem(`${PLACE_PREFIX}${file}`) ?? 'null');
      return saved && Date.now() - Number(saved.at) <= PLACE_MAX_AGE_MS ? saved : null;
    } catch {
      return null;
    }
  }

  // The Back link: at the start of the intro's eyebrow line, so nothing on the page moves (its
  // 44px target reaches over the line's own height).
  function mountBack() {
    const intro = document.querySelector('main .page-intro[data-page-back]');
    const target = backTarget();
    if (!intro || !target || intro.querySelector('.page-back')) return null;
    const link = make('a', { class: 'page-back', href: target.href, 'data-page-back-link': '' });
    link.append(
      lineIcon('page-back-icon', 'm14.5 6.5-5.5 5.5 5.5 5.5'),
      make('span', { class: 'page-back-label' }, `Back to ${target.name}`),
    );
    // The same way back as a skip link (T6-17): when a home opens on its item further down the
    // page (Prompts' prompt), Back is the second Tab from the top, after Skip to content.
    const skip = document.querySelector('body > .skip-link');
    if (skip && !document.querySelector('.page-back-skip')) {
      const again = make(
        'a',
        { class: 'skip-link page-back-skip', href: target.href, 'data-page-back-link': '' },
        `Back to ${target.name}`,
      );
      skip.after(again);
    }
    const eyebrow = intro.querySelector('.page-intro-copy > .eyebrow');
    if (eyebrow) eyebrow.prepend(link);
    else {
      const line = make('p', { class: 'page-back-line' });
      line.append(link);
      intro.querySelector('.page-intro-copy')?.prepend(line);
    }
    return link;
  }

  // A press on any Back link to a page of this prototype ([data-page-back-link], the components'
  // own or a page's, such as Materials' header Back) marks the return, so that page restores.
  function markReturn(href) {
    const target = safeReturn(href);
    if (!target) return false;
    try {
      session()?.setItem(
        PLACE_RETURNING,
        JSON.stringify({ file: target.file, at: Date.now(), keyboard: inputModality.keyboard }),
      );
      return true;
    } catch {
      // Without storage the origin opens as usual.
      return false;
    }
  }

  // Coming back through Back: the page's own restore first, then what was open, the scroll, and
  // focus on the control you left from (else the h1).
  const isPlainPlace = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

  // Whether the last press was a key or a pointer (T4-21), so focus that comes back after a page
  // change shows its ring only where the person was on the keyboard.
  const inputModality = { keyboard: false };
  if (typeof document.addEventListener === 'function') {
    document.addEventListener(
      'keydown',
      (event) => {
        if (!event.metaKey && !event.ctrlKey && !event.altKey) inputModality.keyboard = true;
      },
      true,
    );
    document.addEventListener(
      'pointerdown',
      () => {
        inputModality.keyboard = false;
      },
      true,
    );
  }

  // Focus with the visible ring when asked: the browser's own (focusVisible) where it has it, else
  // data-focus-ring (the same green ring in the stylesheet) until the element loses focus.
  function focusWithRing(target, ring) {
    try {
      target.focus?.({ preventScroll: true, focusVisible: ring });
    } catch {
      target.focus?.();
    }
    if (!ring) return;
    let shown = false;
    try {
      shown = Boolean(target.matches?.(':focus-visible'));
    } catch {
      shown = false;
    }
    if (shown) return;
    target.setAttribute?.('data-focus-ring', '');
    target.addEventListener?.('blur', () => target.removeAttribute?.('data-focus-ring'), {
      once: true,
    });
  }

  function restorePlace() {
    if (placeState.restored) return;
    const store = session();
    let marker = null;
    try {
      marker = JSON.parse(store?.getItem(PLACE_RETURNING) ?? 'null');
    } catch {
      marker = null;
    }
    if (!marker || marker.file !== pageFile()) return;
    if (Date.now() - Number(marker.at) > PLACE_MAX_AGE_MS) return;
    const saved = readPlace(pageFile());
    if (!saved) return;
    placeState.restored = true;
    placeState.saved = saved;
    try {
      store?.removeItem(PLACE_RETURNING);
    } catch {}
    try {
      if (typeof placeState.restore === 'function') placeState.restore(saved.extra ?? {}, saved);
    } catch (error) {
      if (typeof console !== 'undefined') console.error(error);
    }
    for (const id of Array.isArray(saved.open) ? saved.open : []) {
      const part = document.getElementById(String(id));
      if (part?.tagName === 'DETAILS' && !part.open) part.open = true;
    }
    nextFrame(() => {
      if (typeof window.scrollTo === 'function') {
        window.scrollTo({ top: Number(saved.scroll) || 0, behavior: 'instant' });
      }
      for (const [id, top] of Object.entries(isPlainPlace(saved.scrolled) ? saved.scrolled : {})) {
        const part = document.getElementById(String(id));
        if (part && Number.isFinite(Number(top))) part.scrollTop = Number(top);
      }
      const found = (place) => {
        const [kind, value] = String(place ?? '').split(/:(.*)/s);
        const element =
          kind === 'key'
            ? document.querySelector(`[data-focus-key="${String(value).replace(/["\\]/g, '')}"]`)
            : kind === 'id'
              ? document.getElementById(value)
              : null;
        return element && isShown(element) ? element : null;
      };
      const control = found(saved.focus);
      // Gone (T4-24): the nearest surviving neighbour, then the region's heading, the h1 last.
      const neighbour = control
        ? null
        : (Array.isArray(saved.near) ? saved.near : []).map(found).find(Boolean);
      const heading = control || neighbour ? null : found(saved.heading);
      if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      const target = control ?? neighbour ?? heading ?? document.querySelector('main h1');
      if (target) {
        if (target.matches?.('h1') && !target.hasAttribute('tabindex')) {
          target.setAttribute('tabindex', '-1');
        }
        // A Back pressed from the keyboard brings its ring back with the focus (T4-21).
        focusWithRing(target, Boolean(marker.keyboard));
        // The control you land on stays in view (inside a dialog that scrolls, too).
        if (
          target !== document.querySelector('main h1') &&
          typeof target.scrollIntoView === 'function'
        ) {
          target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        }
      }
    });
  }

  function startPlace() {
    mountBack();
    document.addEventListener('click', (event) => {
      const back = event.target?.closest?.('a[data-page-back-link]');
      if (back) markReturn(back.getAttribute('href'));
    });
    document.addEventListener('click', (event) => {
      const link = event.target?.closest?.('a[data-return-link]');
      if (!link || event.defaultPrevented) return;
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      link.setAttribute(
        'href',
        placeHref(href.replace(/([?&])return=[^&#]*&?/, '$1').replace(/[?&]$/, '')),
      );
      savePlace();
    });
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', () => savePlace());
    }
    whenBooted(() => nextFrame(restorePlace));
  }

  // ---------------------------------------------------------------- time range (round 7, D10)

  // timeRange(host, { value, param, label, presets, earliest, onChange }): a range picker like
  // CloudWatch's. A 44px button names the range in words ("Last 7 days", "This month", "Sep 20 to
  // Sep 27") and opens a non-modal popover: the presets as a radio group and Custom, with From and
  // To (native date and time fields) checked as you change them. A choice applies at once (a
  // pointer choice also closes it); Escape and Done close it and return focus to the button.
  // Resolved against the sample clock; the step is the store's own for the span (usage()), else
  // 5 minutes up to 3 hours, an hour up to 3 days, a day beyond. The value is kept in the address
  // (?range=1w, or ?range=<from>..<to> for custom) when param is given. Each change fires one
  // bubbling rangechange event ({ preset, from, to, step, label }) and calls onChange.
  const RANGE_PRESETS = Object.freeze([
    ['1h', 'Last hour', 3600000],
    ['3h', 'Last 3 hours', 10800000],
    ['12h', 'Last 12 hours', 43200000],
    ['1d', 'Last day', 86400000],
    ['3d', 'Last 3 days', 259200000],
    ['1w', 'Last 7 days', 604800000],
    ['2w', 'Last 14 days', 1209600000],
    ['30d', 'Last 30 days', 2592000000],
    ['month', 'This month', null],
    ['90d', 'Last 90 days', 7776000000],
    // Round 7 (SA's request 9): receipts and the activity log reach back further.
    ['year', 'Last 12 months', 31536000000],
    ['all', 'All time', null],
  ]);
  const DEFAULT_PRESETS = ['1h', '3h', '12h', '1d', '3d', '1w', '2w', '30d', 'month'];
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  let rangeCount = 0;

  const clockNow = (store) => {
    try {
      const now = store?.now?.();
      const ms = now instanceof Date ? now.getTime() : Number(new Date(now));
      if (Number.isFinite(ms)) return ms;
    } catch {}
    return Date.now();
  };
  const stepFor = (span) => (span <= 3 * 3600000 ? '5m' : span <= 3 * 86400000 ? 'hour' : 'day');
  // "Sep 20", or "Oct 12, 2025" when the year needs saying (SA's request 10).
  const dayWords = (ms, year = false) => {
    const date = new Date(ms);
    return `${MONTHS[date.getMonth()]} ${date.getDate()}${year ? `, ${date.getFullYear()}` : ''}`;
  };
  // A datetime-local value ("2026-09-20T09:30") for a moment, in this browser's time.
  const localValue = (ms) => {
    const date = new Date(ms);
    const two = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
  };

  // The store's own resolution of a range when it has one (so the picker and usage() agree).
  function resolveRange(value, store = window.JobDeputyStore) {
    const now = clockNow(store);
    const custom = typeof value === 'object' && value !== null;
    const preset = custom ? 'custom' : String(value);
    let from;
    let to = now;
    if (custom) {
      from = Number(new Date(value.from));
      to = Number(new Date(value.to));
    } else if (preset === 'month') {
      const date = new Date(now);
      from = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    } else if (preset === 'all') {
      // The store's first record when it says (its usage() for 'all'), else ten years back.
      from = now - 10 * 31536000000;
    } else {
      const entry = RANGE_PRESETS.find(([id]) => id === preset) ?? RANGE_PRESETS[5];
      from = now - entry[2];
    }
    let step = stepFor(to - from);
    if (typeof store?.usage === 'function') {
      try {
        const answer = custom
          ? store.usage({ from: new Date(from).toISOString(), to: new Date(to).toISOString() })
          : store.usage({ range: preset });
        if (answer?.step) step = answer.step;
        if (!custom && answer?.from && answer?.to) {
          from = Number(new Date(answer.from));
          to = Number(new Date(answer.to));
        }
      } catch {}
    }
    // A custom range names the years when it spans two, or is not this year.
    const nowYear = new Date(now).getFullYear();
    const years =
      new Date(from).getFullYear() !== new Date(to).getFullYear() ||
      new Date(to).getFullYear() !== nowYear;
    const label = custom
      ? `${dayWords(from, years)} to ${dayWords(to, years)}`
      : (RANGE_PRESETS.find(([id]) => id === preset)?.[1] ?? 'Last 7 days');
    return {
      preset,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      step,
      label,
    };
  }

  // ?range=1w, or ?range=2026-09-20T00:00..2026-09-27T00:00.
  function rangeFromAddress(param, presets) {
    if (!param) return null;
    const asked = new URLSearchParams(String(window.location?.search ?? '')).get(param);
    if (!asked) return null;
    if (presets.includes(asked)) return asked;
    const [from, to] = asked.split('..');
    if (
      from &&
      to &&
      Number.isFinite(Number(new Date(from))) &&
      Number.isFinite(Number(new Date(to)))
    ) {
      return { from, to };
    }
    return null;
  }

  // An address's query, a key without a value kept bare (?skipLoader, never ?skipLoader=).
  function queryText(query) {
    return [...query.entries()]
      .map(([key, value]) =>
        value === ''
          ? encodeURIComponent(key)
          : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      )
      .join('&');
  }

  function writeParams(entries) {
    if (typeof window.history?.replaceState !== 'function') return;
    const query = new URLSearchParams(String(window.location?.search ?? ''));
    for (const [name, value] of entries) {
      if (
        value === null ||
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && !value.length)
      )
        query.delete(name);
      else query.set(name, Array.isArray(value) ? value.join(',') : String(value));
    }
    query.delete('page');
    const search = queryText(query);
    try {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location?.pathname ?? ''}${search ? `?${search}` : ''}${window.location?.hash ?? ''}`,
      );
    } catch {}
  }

  function timeRange(host, settings = {}) {
    if (!host || typeof host.append !== 'function') return null;
    rangeCount += 1;
    const prefix = `tr-${rangeCount}`;
    const store = settings.store ?? window.JobDeputyStore;
    const presets = (Array.isArray(settings.presets) ? settings.presets : DEFAULT_PRESETS).filter(
      (id) => RANGE_PRESETS.some(([known]) => known === id),
    );
    const label = String(settings.label ?? 'Time range');
    let value = rangeFromAddress(settings.param, presets) ?? settings.value ?? '1w';
    let resolved = resolveRange(value, store);
    const earliest = () => {
      const given = Number(new Date(settings.earliest));
      if (Number.isFinite(given)) return given;
      try {
        const all = store?.usage?.({ range: '90d' });
        if (all?.from) return Number(new Date(all.from));
      } catch {}
      return clockNow(store) - 90 * 86400000;
    };

    const root = make('div', { class: 'time-range', 'data-time-range': '' });
    const trigger = make('button', {
      type: 'button',
      class: 'time-range-trigger',
      'aria-expanded': 'false',
      'aria-controls': `${prefix}-popover`,
    });
    const name = make('span', { class: 'time-range-name' }, label);
    const valueText = make('span', { class: 'time-range-value' }, resolved.label);
    trigger.append(
      lineIcon('time-range-icon', 'M7 3v3M17 3v3M4 9h16M5 5h14v15H5z'),
      name,
      valueText,
      chevronIcon(),
    );
    const popover = make('div', {
      class: 'time-range-popover',
      id: `${prefix}-popover`,
      role: 'group',
      'aria-label': label,
    });
    setHidden(popover, true);
    const fieldset = make('fieldset', { class: 'time-range-presets' });
    fieldset.append(make('legend', { class: 'sr-only' }, `${label}: show`));
    const radios = [];
    for (const id of [...presets, 'custom']) {
      const words = id === 'custom' ? 'Custom' : RANGE_PRESETS.find(([known]) => known === id)[1];
      const option = make('label', { class: 'choice-chip time-range-preset' });
      const radio = make('input', { type: 'radio', name: `${prefix}-preset`, value: id });
      option.append(radio, make('span', {}, words));
      fieldset.append(option);
      radios.push(radio);
    }
    const custom = make('div', { class: 'time-range-custom' });
    const field = (key, words) => {
      const wrap = make('div', { class: 'time-range-field' });
      const input = make('input', {
        type: 'datetime-local',
        class: 'field-control time-range-input',
        id: `${prefix}-${key}`,
        'aria-describedby': `${prefix}-error`,
      });
      wrap.append(make('label', { class: 'field-label', for: `${prefix}-${key}` }, words), input);
      custom.append(wrap);
      return input;
    };
    const fromInput = field('from', 'From');
    const toInput = field('to', 'To');
    const error = make('p', { class: 'field-feedback time-range-error', id: `${prefix}-error` });
    setHidden(error, true);
    custom.append(error);
    const done = make(
      'button',
      { type: 'button', class: 'compact-action time-range-done' },
      'Done',
    );
    popover.append(fieldset, custom, done);
    root.append(trigger, popover);
    host.append(root);
    // Where the name and the range do not both fit (T2b-2: "Usage range:" wrapped and cut "Last
    // 30 days" on a 320px card), the name goes from view and stays in the button's name for screen
    // readers (data-compact); measured again as the place it sits in changes width.
    function fitTrigger() {
      if (typeof trigger.scrollWidth !== 'number') return;
      root.removeAttribute('data-compact');
      const tight =
        valueText.scrollWidth > valueText.clientWidth + 1 ||
        trigger.scrollWidth > trigger.clientWidth + 1 ||
        name.getClientRects?.().length > 1;
      if (tight) root.setAttribute('data-compact', '');
    }
    fitTrigger();
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => fitTrigger()).observe(host);

    const isOpen = () => trigger.getAttribute('aria-expanded') === 'true';
    const syncInputs = () => {
      const preset = resolved.preset;
      for (const radio of radios) radio.checked = radio.value === preset;
      setHidden(custom, preset !== 'custom');
      fromInput.value = localValue(Number(new Date(resolved.from)));
      toInput.value = localValue(Number(new Date(resolved.to)));
      fromInput.setAttribute('min', localValue(earliest()));
      fromInput.setAttribute('max', localValue(clockNow(store)));
      toInput.setAttribute('min', localValue(earliest()));
      toInput.setAttribute('max', localValue(clockNow(store)));
    };
    const fire = () => {
      valueText.textContent = resolved.label;
      fitTrigger();
      if (settings.param) {
        writeParams([
          [
            settings.param,
            resolved.preset === 'custom' ? `${fromInput.value}..${toInput.value}` : resolved.preset,
          ],
        ]);
      }
      const detail = { ...resolved };
      if (typeof CustomEvent === 'function') {
        host.dispatchEvent?.(new CustomEvent('rangechange', { bubbles: true, detail }));
      }
      settings.onChange?.(detail);
    };
    const showError = (words) => {
      error.textContent = words;
      setHidden(error, !words);
      for (const input of [fromInput, toInput]) {
        if (words) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      }
    };
    const set = (next, { quiet = false } = {}) => {
      value = next;
      resolved = resolveRange(next, store);
      syncInputs();
      showError('');
      if (!quiet) fire();
      return resolved;
    };
    const close = ({ focus = true } = {}) => {
      if (!isOpen()) return;
      trigger.setAttribute('aria-expanded', 'false');
      setHidden(popover, true);
      if (focus) trigger.focus?.();
    };
    const open = () => {
      syncInputs();
      trigger.setAttribute('aria-expanded', 'true');
      setHidden(popover, false);
      fitPopover(popover, root);
      (radios.find((radio) => radio.checked) ?? radios[0])?.focus?.();
    };
    // Custom applies once both are valid: From before To, from the first day there is data, and
    // not in the future.
    const applyCustom = () => {
      const from = Number(new Date(fromInput.value));
      const to = Number(new Date(toInput.value));
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        showError('Choose a From and a To.');
        return;
      }
      if (from < earliest() - 60000) {
        showError(`Choose dates from ${dayWords(earliest())} on.`);
        return;
      }
      if (to > clockNow(store) + 60000) {
        showError('Choose a To that isn’t in the future.');
        return;
      }
      if (to <= from) {
        showError('Choose a To after the From.');
        return;
      }
      showError('');
      value = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
      resolved = resolveRange(value, store);
      fire();
    };

    trigger.addEventListener('click', () => (isOpen() ? close() : open()));
    fieldset.addEventListener('change', (event) => {
      const chosen = event.target?.value;
      if (!chosen) return;
      // Custom shows its From and To; focus stays on the choice (an arrow key goes on choosing,
      // T4-4), and Tab reaches the dates next.
      if (chosen === 'custom') {
        setHidden(custom, false);
        return;
      }
      set(chosen);
    });
    // A pointer choice also closes the popover (keyboard arrows keep it open to keep choosing).
    fieldset.addEventListener('click', (event) => {
      const radio = event.target?.closest?.('label')?.querySelector?.('input');
      if (event.detail > 0 && radio && radio.value !== 'custom') {
        window.setTimeout(() => close(), 0);
      }
    });
    for (const input of [fromInput, toInput]) input.addEventListener('change', applyCustom);
    done.addEventListener('click', () => close());
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !isOpen()) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      close();
    });
    document.addEventListener('click', (event) => {
      if (isOpen() && !root.contains(event.target)) close({ focus: false });
    });
    root.addEventListener('focusout', (event) => {
      if (isOpen() && event.relatedTarget && !root.contains(event.relatedTarget)) {
        close({ focus: false });
      }
    });
    syncInputs();
    return Object.freeze({
      root,
      get value() {
        return { ...resolved };
      },
      get isOpen() {
        return isOpen();
      },
      set: (next) => set(next),
      open,
      close: () => close(),
    });
  }

  // ---------------------------------------------------------------- filter bar (round 7, R10-7)

  // filterBar(host, { label, search, facets, sort, range, noun, onChange }): big lists filter
  // live, in one compact row (the owner's S5: less to scroll past). The search (debounced
  // 250ms), then each facet as a menu button in the multi-select style ("Fit: Any", its options
  // with counts inside the menu; kind: 'choice' is one of, kind: 'multi' the shared multi-select),
  // a sort as the same menu ("Order: Best fit first"), an optional time range (timeRange), Clear
  // while anything is set, and the result line at the row's end ("42 of 3,120 entries"), quiet
  // while nothing narrows the list and said once 500ms after the last change. A choice facet a
  // page marks primary: true with at most 4 options shows as chips instead. At 720px and narrower
  // the row folds: the search stays, and one 44px Filters button ("Filters · 2" while two are set)
  // opens the facets under it. Every change applies at once, never an Apply button; the state is
  // in the address (each part's param, history.replaceState, a page= dropped) and read back on
  // load. setCounts takes the store's facet counts; setOptions(name, options) a multi facet's
  // options, in place; setResult(shown, total), or setResult(null) for no line at all. range takes
  // timeRange's options and default: the preset Clear returns to (else its value). A facet (or the
  // sort) with compact: true shows only its value on its button, its name for screen readers.
  let filterCount = 0;
  const FILTER_DEBOUNCE_MS = 250;
  const FILTER_SAY_MS = 500;

  // One of a few, as a menu button (the multi-select's look and behaviour, one choice): a press
  // on an option applies it and closes the menu; the arrow keys choose and apply in place;
  // Escape and Done close it and return focus to the button; a press outside or Tab past the end
  // closes it.
  function choiceMenu(host, settings) {
    const id = String(settings.id);
    const options = (Array.isArray(settings.options) ? settings.options : []).map((option) => ({
      ...option,
      value: String(option.value),
    }));
    let value = options.some((option) => option.value === settings.value)
      ? settings.value
      : (options[0]?.value ?? '');
    const root = make('div', { class: 'filter-menu', 'data-facet': settings.name });
    const trigger = make('button', {
      type: 'button',
      class: 'filter-menu-trigger',
      'aria-expanded': 'false',
      'aria-controls': `${id}-menu`,
    });
    const shown = make('span', { class: 'filter-menu-value' });
    trigger.append(
      // compact: true (SJ's request 8) shows the value only; the name stays in the button's
      // accessible name ("Order: Running first").
      settings.compact
        ? make('span', { class: 'filter-menu-name sr-only' }, `${String(settings.label)}: `)
        : make('span', { class: 'filter-menu-name' }, String(settings.label)),
      shown,
      chevronIcon(),
    );
    const popover = make('div', {
      class: 'filter-menu-popover',
      id: `${id}-menu`,
      role: 'group',
      'aria-label': String(settings.label),
    });
    setHidden(popover, true);
    const fieldset = make('fieldset', { class: 'filter-menu-options' });
    fieldset.append(make('legend', { class: 'sr-only' }, String(settings.label)));
    for (const option of options) {
      const row = make('label', { class: 'filter-menu-option' });
      const radio = make('input', { type: 'radio', name: `${id}-choice`, value: option.value });
      radio.checked = option.value === value;
      const count = make('span', {
        class: 'filter-bar-count',
        'data-count-for': option.value,
        'data-count-metric': option.metric ? String(option.metric) : null,
      });
      if (Number.isFinite(Number(option.count))) count.textContent = grouped(option.count);
      row.append(radio, make('span', { class: 'filter-menu-label' }, String(option.label)), count);
      fieldset.append(row);
    }
    const done = make(
      'button',
      { type: 'button', class: 'compact-action filter-menu-done' },
      'Done',
    );
    popover.append(fieldset, done);
    root.append(trigger, popover);
    host.append(root);
    const labelOf = (wanted) => options.find((option) => option.value === wanted)?.label ?? '';
    const sync = () => {
      shown.textContent = String(labelOf(value));
      root.toggleAttribute?.('data-selected', value !== (options[0]?.value ?? ''));
      for (const radio of fieldset.querySelectorAll('input[type="radio"]')) {
        radio.checked = radio.getAttribute('value') === value;
      }
    };
    const isOpen = () => trigger.getAttribute('aria-expanded') === 'true';
    const close = ({ focus = true } = {}) => {
      if (!isOpen()) return;
      trigger.setAttribute('aria-expanded', 'false');
      setHidden(popover, true);
      if (focus) trigger.focus?.();
    };
    const open = () => {
      trigger.setAttribute('aria-expanded', 'true');
      setHidden(popover, false);
      fitPopover(popover, root);
      const radios = [...fieldset.querySelectorAll('input[type="radio"]')];
      (radios.find((radio) => radio.checked) ?? radios[0])?.focus?.();
    };
    trigger.addEventListener('click', () => (isOpen() ? close() : open()));
    fieldset.addEventListener('change', (event) => {
      const chosen = event.target?.getAttribute?.('value') ?? event.target?.value;
      if (chosen === undefined || chosen === null || chosen === value) return;
      value = String(chosen);
      sync();
      settings.onChange?.(value);
    });
    fieldset.addEventListener('click', (event) => {
      if (event.detail > 0 && event.target?.closest?.('.filter-menu-option')) {
        window.setTimeout(() => close(), 0);
      }
    });
    done.addEventListener('click', () => close());
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !isOpen()) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      close();
    });
    document.addEventListener('click', (event) => {
      if (isOpen() && !root.contains(event.target)) close({ focus: false });
    });
    root.addEventListener('focusout', (event) => {
      if (isOpen() && event.relatedTarget && !root.contains(event.relatedTarget)) {
        close({ focus: false });
      }
    });
    sync();
    return {
      root,
      get value() {
        return value;
      },
      set: (next) => {
        value = options.some((option) => option.value === String(next))
          ? String(next)
          : (options[0]?.value ?? '');
        sync();
      },
      close,
    };
  }

  function filterBar(host, settings = {}) {
    if (!host || typeof host.append !== 'function') return null;
    filterCount += 1;
    const prefix = `fb-${filterCount}`;
    const query = new URLSearchParams(String(window.location?.search ?? ''));
    const facets = (Array.isArray(settings.facets) ? settings.facets : []).filter(
      (facet) => facet?.name,
    );
    const state = { q: '' };
    const root = make('div', {
      class: 'filter-bar',
      role: 'search',
      'aria-label': String(settings.label ?? 'Filter the list'),
      'data-fold': 'closed',
    });
    const row = make('div', { class: 'filter-bar-row' });
    root.append(row);
    // Search.
    let searchInput = null;
    if (settings.search) {
      const wrap = make('div', { class: 'filter-bar-search' });
      const id = `${prefix}-q`;
      searchInput = make('input', {
        type: 'search',
        class: 'field-control filter-bar-input',
        id,
        autocomplete: 'off',
        placeholder: settings.search.placeholder ?? null,
      });
      wrap.append(
        make('label', { class: 'sr-only', for: id }, String(settings.search.label ?? 'Search')),
        lineIcon('filter-bar-search-icon', 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4'),
        searchInput,
      );
      row.append(wrap);
      state.q = settings.search.param ? (query.get(settings.search.param) ?? '') : '';
      searchInput.value = state.q;
    }
    // The fold: one Filters button on a phone, the facets under it.
    const fold = make('button', {
      type: 'button',
      class: 'compact-action filter-bar-fold',
      'aria-expanded': 'false',
      'aria-controls': `${prefix}-facets`,
    });
    const foldCount = make('span', { class: 'filter-bar-fold-count' });
    fold.append(
      lineIcon('filter-bar-fold-icon', 'M4 6h16M7 12h10M10 18h4'),
      make('span', {}, 'Filters'),
      foldCount,
    );
    row.append(fold);
    const facetsBox = make('div', { class: 'filter-bar-facets', id: `${prefix}-facets` });
    row.append(facetsBox);
    // Facets.
    const parts = new Map();
    for (const facet of facets) {
      const kind = facet.kind === 'multi' ? 'multi' : 'choice';
      const fromAddress = facet.param ? query.get(facet.param) : null;
      if (kind === 'choice') {
        const options = Array.isArray(facet.options) ? facet.options : [];
        const first = String(options[0]?.value ?? '');
        const asked = options.some((option) => String(option.value) === fromAddress)
          ? fromAddress
          : String(facet.value ?? first);
        state[facet.name] = asked;
        const changed = (next) => {
          state[facet.name] = next;
          changedState();
        };
        // Chips only for a primary facet of four options or fewer; else a menu button.
        if (facet.primary && options.length <= 4) {
          const fieldset = make('fieldset', {
            class: 'filter-bar-facet filter-bar-choice',
            'data-facet': facet.name,
          });
          fieldset.append(
            make('legend', { class: 'filter-bar-legend' }, String(facet.label ?? facet.name)),
          );
          const list = make('div', { class: 'filter-bar-chips' });
          for (const option of options) {
            const chip = make('label', { class: 'choice-chip filter-bar-chip' });
            const radio = make('input', {
              type: 'radio',
              name: `${prefix}-${facet.name}`,
              value: String(option.value),
            });
            radio.checked = String(option.value) === asked;
            const count = make('span', {
              class: 'filter-bar-count',
              'data-count-for': String(option.value),
              'data-count-metric': option.metric ? String(option.metric) : null,
            });
            if (Number.isFinite(Number(option.count))) count.textContent = grouped(option.count);
            chip.append(
              radio,
              make('span', { class: 'filter-bar-chip-label' }, String(option.label)),
              count,
            );
            list.append(chip);
          }
          fieldset.append(list);
          fieldset.addEventListener('change', (event) => {
            if (!event.target?.matches?.('input[type="radio"]')) return;
            changed(event.target.value);
          });
          facetsBox.append(fieldset);
          parts.set(facet.name, { kind, facet, element: fieldset, first, chips: true });
        } else {
          const wrap = make('div', { class: 'filter-bar-facet', 'data-facet': facet.name });
          facetsBox.append(wrap);
          const menu = choiceMenu(wrap, {
            id: `${prefix}-${facet.name}`,
            name: facet.name,
            label: facet.label ?? facet.name,
            compact: Boolean(facet.compact),
            options,
            value: asked,
            onChange: changed,
          });
          parts.set(facet.name, { kind, facet, element: wrap, first, menu });
        }
      } else {
        const wrap = make('div', { class: 'filter-bar-facet', 'data-facet': facet.name });
        facetsBox.append(wrap);
        const values = fromAddress
          ? fromAddress.split(',').filter(Boolean)
          : Array.isArray(facet.selected)
            ? facet.selected.map(String)
            : [];
        state[facet.name] = values;
        const control = multiSelect(wrap, {
          name: facet.name,
          label: facet.label,
          singular: facet.singular,
          plural: facet.plural,
          options: facet.options ?? [],
          selected: values,
          countLabel: facet.countLabel,
          maxChips: facet.maxChips ?? 0,
          onChange: (next) => {
            state[facet.name] = [...next];
            changedState();
          },
        });
        parts.set(facet.name, { kind, facet, element: wrap, control });
      }
    }
    // A sort, when the list sorts as well as filters: the same menu, its value in the address.
    let sortMenu = null;
    if (settings.sort && Array.isArray(settings.sort.options) && settings.sort.options.length) {
      const asked = settings.sort.param ? query.get(settings.sort.param) : null;
      const values = settings.sort.options.map((option) => String(option.value));
      state.sort = values.includes(asked) ? asked : String(settings.sort.value ?? values[0]);
      const wrap = make('div', { class: 'filter-bar-facet filter-bar-sort', 'data-facet': 'sort' });
      facetsBox.append(wrap);
      sortMenu = choiceMenu(wrap, {
        id: `${prefix}-sort`,
        name: 'sort',
        label: settings.sort.label ?? 'Sort',
        compact: Boolean(settings.sort.compact),
        options: settings.sort.options,
        value: state.sort,
        onChange: (next) => {
          state.sort = next;
          changedState();
        },
      });
    }
    // The time range.
    let range = null;
    if (settings.range) {
      const wrap = make('div', {
        class: 'filter-bar-facet filter-bar-range',
        'data-facet': 'range',
      });
      facetsBox.append(wrap);
      range = timeRange(wrap, {
        ...settings.range,
        onChange: (detail) => {
          state.range = detail;
          changedState();
        },
      });
      state.range = range?.value ?? null;
    }
    const clear = make(
      'button',
      { type: 'button', class: 'compact-action filter-bar-clear' },
      'Clear',
    );
    clear.append(make('span', { class: 'sr-only' }, ' every filter'));
    facetsBox.append(clear);
    const result = make('p', { class: 'filter-bar-result' });
    row.append(result);
    host.append(root);

    // The page's default range, the one Clear returns to (T3-14): range.default when given (a
    // preset such as 'all', so Clear never writes a fixed end time), else range.value.
    const rangeDefault = () => settings.range?.default ?? settings.range?.value ?? null;
    const defaultRange = () => (rangeDefault() ? resolveRange(rangeDefault()).preset : null);
    // How many filters are set (the fold's "· N"); the search is not one of them.
    const setCount = () =>
      [...parts.values()].filter(({ kind, facet, first }) =>
        kind === 'choice' ? state[facet.name] !== first : state[facet.name].length > 0,
      ).length + (range && defaultRange() && state.range?.preset !== defaultRange() ? 1 : 0);
    const isSet = () => Boolean(state.q) || setCount() > 0;
    const snapshot = () => {
      const out = { q: state.q };
      for (const [name, { kind }] of parts) {
        out[name] = kind === 'multi' ? [...state[name]] : state[name];
      }
      if (range) out.range = { ...state.range };
      if (sortMenu) out.sort = state.sort;
      return out;
    };
    const writeAddress = () => {
      const entries = [];
      if (settings.search?.param) entries.push([settings.search.param, state.q]);
      for (const [name, { kind, facet, first }] of parts) {
        if (!facet.param) continue;
        entries.push([facet.param, kind === 'choice' && state[name] === first ? '' : state[name]]);
      }
      if (sortMenu && settings.sort.param) {
        const first = String(settings.sort.value ?? settings.sort.options[0]?.value);
        entries.push([settings.sort.param, state.sort === first ? '' : state.sort]);
      }
      if (entries.length) writeParams(entries);
    };
    let sayTimer = 0;
    let lastResult = '';
    let resultShown = true;
    const say = () => {
      if (sayTimer) window.clearTimeout(sayTimer);
      sayTimer = window.setTimeout(() => {
        sayTimer = 0;
        if (lastResult) announce(`${lastResult}.`, settings.channel ?? root);
      }, FILTER_SAY_MS);
    };
    // The result line is quiet while nothing narrows the list (SJ's request 6), and when the
    // page said setResult(null).
    const syncResult = () => {
      const words = resultShown && (isSet() || settings.result === 'always') ? lastResult : '';
      if (result.textContent !== words) result.textContent = words;
    };
    const syncChrome = () => {
      setHidden(clear, !isSet());
      const n = setCount();
      foldCount.textContent = n ? ` · ${n}` : '';
      fold.setAttribute('aria-label', n ? `Filters, ${n} set` : 'Filters');
      syncResult();
    };
    function changedState() {
      syncChrome();
      writeAddress();
      const detail = snapshot();
      if (typeof CustomEvent === 'function') {
        host.dispatchEvent?.(new CustomEvent('filterchange', { bubbles: true, detail }));
      }
      settings.onChange?.(detail);
      say();
    }
    let typing = 0;
    searchInput?.addEventListener('input', () => {
      if (typing) window.clearTimeout(typing);
      typing = window.setTimeout(() => {
        typing = 0;
        if (state.q === searchInput.value.trim()) return;
        state.q = searchInput.value.trim();
        changedState();
      }, FILTER_DEBOUNCE_MS);
    });
    // Enter in the search box submits nothing; it applies at once.
    searchInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault?.();
      if (typing) window.clearTimeout(typing);
      typing = 0;
      if (state.q !== searchInput.value.trim()) {
        state.q = searchInput.value.trim();
        changedState();
      }
    });
    fold.addEventListener('click', () => {
      const open = root.getAttribute('data-fold') !== 'open';
      root.setAttribute('data-fold', open ? 'open' : 'closed');
      fold.setAttribute('aria-expanded', String(open));
    });
    clear.addEventListener('click', () => {
      api.clear();
      (searchInput ?? row.querySelector('input'))?.focus?.();
    });

    const setCounts = (counts = {}) => {
      for (const [name, part] of parts) {
        const given = counts?.[name];
        if (!given) continue;
        const of = (value) =>
          Array.isArray(given)
            ? given.find((item) => String(item.id ?? item.value) === value)?.count
            : given[value];
        if (part.kind === 'choice') {
          for (const count of part.element.querySelectorAll('.filter-bar-count')) {
            const n = of(count.getAttribute('data-count-for'));
            const words = Number.isFinite(Number(n)) ? grouped(n) : '';
            if (count.textContent !== words) count.textContent = words;
            const key = count.getAttribute('data-count-metric');
            const store = window.JobDeputyStore;
            let figure = '';
            try {
              figure =
                key && typeof store?.metricText === 'function' ? String(store.metricText(key)) : '';
            } catch {
              figure = '';
            }
            if (key && words && figure === words) count.setAttribute('data-metric', key);
            else count.removeAttribute('data-metric');
          }
        } else {
          part.control?.setOptions(
            (part.facet.options ?? []).map((option) => ({
              ...option,
              count: Number.isFinite(Number(of(String(option.value))))
                ? Number(of(String(option.value)))
                : option.count,
            })),
          );
        }
      }
    };
    const setResult = (shown, total) => {
      if (shown === null || shown === undefined) {
        resultShown = false;
        lastResult = '';
        syncResult();
        return;
      }
      resultShown = true;
      const s = Math.max(0, Math.round(Number(shown) || 0));
      const t = Math.max(s, Math.round(Number(total) || 0));
      const noun = settings.noun ?? ['result', 'results'];
      lastResult =
        s === t
          ? `${grouped(s)} ${nounOf(noun, s)}`
          : `${grouped(s)} of ${grouped(t)} ${nounOf(noun, t)}`;
      if (!s) lastResult = `No ${nounOf(noun, 2)} match`;
      syncResult();
    };
    const api = Object.freeze({
      root,
      get state() {
        return snapshot();
      },
      set: (next = {}) => {
        if (typeof next.q === 'string' && searchInput) {
          state.q = next.q;
          searchInput.value = next.q;
        }
        for (const [name, part] of parts) {
          if (!(name in next)) continue;
          if (part.kind === 'choice') {
            state[name] = String(next[name]);
            if (part.menu) part.menu.set(state[name]);
            for (const radio of part.element.querySelectorAll('input[type="radio"]')) {
              radio.checked = radio.value === state[name];
            }
          } else {
            state[name] = (Array.isArray(next[name]) ? next[name] : []).map(String);
            part.control?.set(state[name]);
          }
        }
        if (next.sort !== undefined && sortMenu) {
          state.sort = String(next.sort);
          sortMenu.set(state.sort);
        }
        if (next.range && range) state.range = range.set(next.range);
        syncChrome();
        writeAddress();
      },
      clear: () => {
        state.q = '';
        if (searchInput) searchInput.value = '';
        for (const [name, part] of parts) {
          if (part.kind === 'choice') {
            state[name] = part.first;
            if (part.menu) part.menu.set(part.first);
            for (const radio of part.element.querySelectorAll('input[type="radio"]')) {
              radio.checked = radio.value === part.first;
            }
          } else {
            state[name] = [];
            part.control?.set([]);
          }
        }
        if (range && rangeDefault()) state.range = range.set(rangeDefault());
        changedState();
      },
      setCounts,
      // A multi facet's options, in place (round 7, T3-19 and T3-3): its list keeps its boxes,
      // its order while open, and focus (multiSelect.setOptions), so a new company never builds
      // the bar again. A choice facet's options are fixed; it returns false for one.
      setOptions: (name, options) => {
        const part = parts.get(name);
        if (!part || part.kind === 'choice' || !part.control) return false;
        part.facet.options = Array.isArray(options) ? options : [];
        part.control.setOptions(part.facet.options);
        const kept = part.control.values ?? [];
        if (JSON.stringify(kept) !== JSON.stringify(state[name] ?? [])) {
          state[name] = [...kept];
          syncChrome();
        }
        return true;
      },
      setResult,
      range,
    });
    syncChrome();
    return api;
  }

  // ---------------------------------------------------------------- usage (round 7, D9, D10)

  // permutationsTable(host, { rows, caption, sort, pageSize }): every key x model x task in a
  // range (JobDeputyStore.usage().permutations) as one sortable table: Key, Model, Task, Calls,
  // Tokens, Cost (an estimate on your own keys, said), Kept by you, and a Total row. Each header
  // is a button (aria-sort on the header), and past pageSize rows (24) it pages with the shared
  // pagination. Round 7 (SP's request 14, R10-6, T6-8), each opt in: top: true adds the compact
  // pager over the table; sizes: [12, 24, 48] the Per page choice (pageSize the first, else
  // given); address: true keeps the page and size in the address (param and sizeParam, 'page' and
  // 'size' by default). Its costs, rows and Total alike, are cents from $0.10 up and up to three
  // significant digits below (T3-28). Returns { render(rows), sort, page, size }.
  const PERMUTATION_COLUMNS = Object.freeze([
    { id: 'key', label: 'Key', text: (row) => row.keyLabel ?? row.key },
    { id: 'model', label: 'Model', text: (row) => row.modelLabel ?? row.model },
    { id: 'task', label: 'Task', text: (row) => row.taskLabel ?? row.task },
    { id: 'calls', label: 'Calls', number: true },
    { id: 'tokens', label: 'Tokens', number: true },
    { id: 'cost', label: 'Cost', number: true },
    { id: 'kept', label: 'Kept by you', number: true },
  ]);

  function permutationsTable(host, settings = {}) {
    if (!host || typeof host.append !== 'function') return null;
    const store = settings.store ?? window.JobDeputyStore;
    let rows = Array.isArray(settings.rows) ? settings.rows : [];
    let sort = {
      by: settings.sort?.by ?? 'tokens',
      dir: settings.sort?.dir === 'asc' ? 'asc' : 'desc',
    };
    const sizes = (Array.isArray(settings.sizes) ? settings.sizes : [])
      .map((value) => Math.round(Number(value)))
      .filter((value) => value > 0);
    const param = settings.param ?? 'page';
    const sizeParam = settings.sizeParam ?? 'size';
    const asked = settings.address
      ? pagination.fromAddress({ param, sizeParam, sizes })
      : { page: 1, size: null };
    let page = asked.page;
    let size = Math.max(1, Math.round(Number(asked.size ?? settings.pageSize) || 24));
    const wrap = make('section', {
      class: 'data-table-wrap permutations-wrap',
      'aria-label': String(settings.caption ?? 'Every key, model, and task in this range'),
      tabindex: '0',
    });
    const table = make('table', { class: 'data-table permutations-table', role: 'table' });
    const topHost = settings.top ? make('div', { class: 'permutations-pages is-top' }) : null;
    const pagesHost = make('div', { class: 'permutations-pages' });
    const note = make('p', { class: 'permutations-note' });
    if (topHost) host.append(topHost);
    host.append(wrap, pagesHost, note);
    wrap.append(table);
    let pager = null;
    const sortValue = (row, id) =>
      id === 'kept'
        ? Number.isFinite(Number(row.keptPct))
          ? Number(row.keptPct)
          : -1
        : id === 'calls' || id === 'tokens' || id === 'cost'
          ? Number(row[id]) || 0
          : String(PERMUTATION_COLUMNS.find((column) => column.id === id)?.text(row) ?? '');
    const sorted = () =>
      [...rows].sort((a, b) => {
        const x = sortValue(a, sort.by);
        const y = sortValue(b, sort.by);
        const order = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
        return (sort.dir === 'asc' ? order : -order) || String(a.id).localeCompare(String(b.id));
      });
    const cellText = (row, column) => {
      if (column.id === 'calls') return grouped(Number(row.calls) || 0);
      if (column.id === 'tokens') return tokenWords(row.tokens, store);
      if (column.id === 'cost') {
        const money = tableMoney(row.cost);
        return row.costEstimate ? `${money} (estimate)` : money;
      }
      if (column.id === 'kept') {
        return Number.isFinite(Number(row.keptPct))
          ? `${Math.round(row.keptPct)}%`
          : 'No decisions yet';
      }
      return String(column.text(row) ?? '');
    };
    function render(next) {
      if (Array.isArray(next)) {
        rows = next;
        page = 1;
      }
      page = Math.min(Math.max(1, page), Math.max(1, Math.ceil(rows.length / size)));
      const head = make('thead');
      const headRow = make('tr', { role: 'row' });
      for (const column of PERMUTATION_COLUMNS) {
        const th = make('th', {
          role: 'columnheader',
          scope: 'col',
          class: column.number ? 'data-table-numeric' : null,
          'aria-sort':
            sort.by === column.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null,
        });
        const button = make('button', {
          type: 'button',
          class: 'data-table-sort',
          'data-sort': column.id,
          'data-morph-key': `sort-${column.id}`,
        });
        button.append(document.createTextNode(column.label));
        th.append(button);
        headRow.append(th);
      }
      head.append(headRow);
      const body = make('tbody');
      const list = sorted();
      const shown = list.slice((page - 1) * size, page * size);
      if (!shown.length) {
        const row = make('tr', { role: 'row' });
        row.append(
          make(
            'td',
            {
              role: 'cell',
              colspan: String(PERMUTATION_COLUMNS.length),
              class: 'data-table-message',
            },
            String(settings.empty ?? 'No AI work in this range.'),
          ),
        );
        body.append(row);
      }
      for (const item of shown) {
        const row = make('tr', { role: 'row' });
        for (const [index, column] of PERMUTATION_COLUMNS.entries()) {
          row.append(
            make(
              index === 0 ? 'th' : 'td',
              {
                role: index === 0 ? 'rowheader' : 'cell',
                scope: index === 0 ? 'row' : null,
                class:
                  index === 0 ? 'permutations-name' : column.number ? 'data-table-numeric' : null,
                'data-label': column.label,
              },
              cellText(item, column),
            ),
          );
        }
        body.append(row);
      }
      const foot = make('tfoot');
      if (list.length) {
        const totals = list.reduce(
          (sum, item) => ({
            calls: sum.calls + (Number(item.calls) || 0),
            tokens: sum.tokens + (Number(item.tokens) || 0),
            cost: sum.cost + (Number(item.cost) || 0),
            kept: sum.kept + (Number(item.kept) || 0),
            decided: sum.decided + (Number(item.decided) || 0),
            estimate: sum.estimate || Boolean(item.costEstimate),
          }),
          { calls: 0, tokens: 0, cost: 0, kept: 0, decided: 0, estimate: false },
        );
        const total = make('tr', { role: 'row', class: 'permutations-total' });
        total.append(
          make(
            'th',
            { role: 'rowheader', scope: 'row', colspan: '3' },
            `Total, ${counted(list.length, ['combination', 'combinations'])}`,
          ),
          make(
            'td',
            { role: 'cell', class: 'data-table-numeric', 'data-label': 'Calls' },
            grouped(totals.calls),
          ),
          make(
            'td',
            { role: 'cell', class: 'data-table-numeric', 'data-label': 'Tokens' },
            tokenWords(totals.tokens, store),
          ),
          make(
            'td',
            { role: 'cell', class: 'data-table-numeric', 'data-label': 'Cost' },
            `${tableMoney(totals.cost)}${totals.estimate ? ' (estimate)' : ''}`,
          ),
          make(
            'td',
            { role: 'cell', class: 'data-table-numeric', 'data-label': 'Kept by you' },
            totals.decided
              ? `${Math.round((totals.kept / totals.decided) * 100)}%`
              : 'No decisions yet',
          ),
        );
        foot.append(total);
      }
      // In place (T3-19): a store tick changes the figures, never the sort buttons.
      morphChildren(table, [head, body, foot]);
      // Wider than its box (T1-13: 898px in 823px at 1024): the edge with more fades, and the
      // Key column holds still while the rest scrolls.
      watchScrollEdges(wrap);
      note.textContent = list.some((item) => item.costEstimate)
        ? 'Cost on your own keys is an estimate at the provider’s list price; platform credits are exact.'
        : '';
      const paged = list.length > size || (sizes.length > 1 && list.length > sizes[0]);
      if (paged) {
        const options = {
          total: list.length,
          pageSize: size,
          page,
          label: 'Pages of combinations',
          noun: ['combination', 'combinations'],
        };
        if (!pager) {
          pager = pagination(pagesHost, {
            ...options,
            top: topHost,
            sizes: sizes.length > 1 ? sizes : undefined,
            address: Boolean(settings.address),
            param,
            sizeParam,
            list: wrap,
            heading: wrap,
            onChange: (next, chosen) => {
              page = next;
              if (chosen) size = chosen;
              render();
            },
            onSize: (chosen, next) => {
              size = chosen;
              page = next;
              render();
            },
          });
        } else pager.render(options);
        setHidden(pagesHost, false);
        if (topHost) setHidden(topHost, list.length <= size);
      } else {
        setHidden(pagesHost, true);
        if (topHost) setHidden(topHost, true);
      }
    }
    table.addEventListener('click', (event) => {
      const button = event.target?.closest?.('[data-sort]');
      if (!button) return;
      const by = button.getAttribute('data-sort');
      const number = PERMUTATION_COLUMNS.find((column) => column.id === by)?.number;
      sort =
        sort.by === by
          ? { by, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
          : { by, dir: number ? 'desc' : 'asc' };
      render();
      table.querySelector(`[data-sort="${by}"]`)?.focus?.();
      const label = PERMUTATION_COLUMNS.find((column) => column.id === by)?.label ?? by;
      announce(
        `Sorted by ${label}, ${sort.dir === 'asc' ? 'lowest first' : 'highest first'}.`,
        wrap,
      );
    });
    render();
    return Object.freeze({
      render: (next) => render(next),
      get sort() {
        return { ...sort };
      },
      get page() {
        return page;
      },
      get size() {
        return size;
      },
    });
  }

  // Money in the combinations table, one rule for its rows and its Total (T3-28, the
  // orchestrator's rule, the same as the tiles): cents from $0.10 up ("$1.74"), and up to three
  // significant digits below that ("$0.0412", "$0.0056"), so a small cost still shows.
  function tableMoney(micros) {
    const dollars = Math.max(0, Number(micros) || 0) / 1000000;
    if (dollars === 0) return '$0.00';
    if (dollars >= 0.1) {
      const [whole, cents] = dollars.toFixed(2).split('.');
      return `$${grouped(Number(whole))}.${cents}`;
    }
    return `$${Number(dollars.toPrecision(3))}`;
  }

  // allowanceRings(host, { kinds, size, metrics }): the ring meters from the store, runs (R9-1:
  // "4 of 10 left", Left and Used, "10 free + 30 bought" once anything was bought) and tokens for
  // the payer in use ("200,190 of 250,000 tokens left", "On your OpenAI key"). Each figure keeps
  // its data-metric (metrics: false leaves them off). Follows the store, in place.
  function metricText(store, key) {
    if (!key || typeof store?.metricText !== 'function') return '';
    try {
      return String(store.metricText(key) ?? '').trim();
    } catch {
      return '';
    }
  }

  function ringMarkup(kind, compact) {
    const meter = make('div', {
      class: 'allowance is-ring',
      'data-meter-kind': kind === 'runs' ? 'watch' : 'assist',
      'data-ring': kind,
    });
    meter.append(
      make('p', { class: 'allowance-label' }, kind === 'runs' ? 'Runs this month' : 'Tokens'),
    );
    const ring = make('div', { class: `allowance-ring${compact ? ' is-compact' : ''}` });
    ring.append(
      make('span', { class: 'allowance-part', 'data-part': 'used' }),
      make('span', { class: 'allowance-part', 'data-part': 'left' }),
    );
    const centre = make('p', { class: 'allowance-ring-centre' });
    centre.append(
      make('span', { class: 'allowance-ring-figure', 'data-ring-value': 'left' }),
      document.createTextNode(' '),
    );
    const unit = make('span', { class: 'allowance-ring-unit' });
    if (kind === 'runs') {
      unit.append(
        document.createTextNode('of '),
        make('span', { 'data-ring-value': 'all' }),
        document.createTextNode(' left'),
      );
    } else unit.append(document.createTextNode('tokens left'));
    centre.append(unit);
    ring.append(centre);
    const key = make('ul', { class: 'allowance-key' });
    const left = make('li', { class: 'allowance-key-item', 'data-part': 'left' });
    left.append(make('span', { 'data-ring-value': 'left-words' }));
    const used = make('li', { class: 'allowance-key-item', 'data-part': 'used' });
    const usedText = make('span');
    usedText.append(
      make('strong', { 'data-ring-value': 'used' }),
      document.createTextNode(' used'),
    );
    used.append(usedText);
    key.append(left, used);
    meter.append(ring, key, make('p', { class: 'allowance-note', 'data-ring-value': 'note' }));
    return meter;
  }

  function fillFigure(element, words, key, store, metrics) {
    if (!element) return;
    if (element.textContent !== words) element.textContent = words;
    const keyed = metrics && key && metricText(store, key) === words;
    if (keyed) element.setAttribute('data-metric', key);
    else element.removeAttribute('data-metric');
  }

  function allowanceRings(host, settings = {}) {
    if (!host || typeof host.append !== 'function') return null;
    const store = settings.store ?? window.JobDeputyStore;
    const kinds = (Array.isArray(settings.kinds) ? settings.kinds : ['runs', 'tokens']).filter(
      (kind) => kind === 'runs' || kind === 'tokens',
    );
    const metrics = settings.metrics !== false;
    const group = make('div', { class: 'allowance-rings' });
    const meters = new Map(
      kinds.map((kind) => [kind, ringMarkup(kind, settings.size !== 'large')]),
    );
    for (const meter of meters.values()) group.append(meter);
    host.append(group);
    const runway = () => {
      try {
        return typeof store?.runway === 'function' ? store.runway() : null;
      } catch {
        return null;
      }
    };
    function render() {
      const now = runway();
      const runs = meters.get('runs');
      if (runs && now?.runs) {
        const r = now.runs;
        const all =
          (Number(r.free) || 0) + (Number(r.bought) || 0) ||
          (Number(r.left) || 0) + (Number(r.used) || 0);
        setAllowance(runs, {
          used: r.used,
          left: r.left,
          state: r.left <= 0 ? 'reached' : r.days <= 2 ? 'attention' : 'ok',
        });
        fillFigure(
          runs.querySelector('[data-ring-value="left"]'),
          grouped(r.left),
          'runs.left',
          store,
          metrics,
        );
        fillFigure(
          runs.querySelector('[data-ring-value="all"]'),
          grouped(all),
          'runs.all',
          store,
          metrics,
        );
        fillFigure(
          runs.querySelector('[data-ring-value="used"]'),
          grouped(r.used),
          'runs.used',
          store,
          metrics,
        );
        runs.querySelector('[data-ring-value="left-words"]').textContent =
          `${grouped(r.left)} left`;
        const note = runs.querySelector('[data-ring-value="note"]');
        note.textContent =
          Number(r.bought) > 0 ? `${grouped(r.free)} free + ${grouped(r.bought)} bought` : '';
        setHidden(note, !note.textContent);
        for (const part of runs.querySelectorAll('.allowance-part')) {
          const kind = part.getAttribute('data-part');
          part.setAttribute(
            'data-tip-title',
            kind === 'used'
              ? `${grouped(r.used)} used`
              : `${grouped(r.left)} of ${grouped(all)} left`,
          );
          part.setAttribute(
            'data-tip',
            kind === 'used'
              ? 'Runs used this month: your searches, Keep watch, Gmail’s scans, and the daily email.'
              : 'Runs left this month, free ones and any you bought.',
          );
        }
      }
      const tokens = meters.get('tokens');
      if (tokens && now?.tokens) {
        const t = now.tokens;
        const limit = Number(t.limit) || (Number(t.left) || 0) + (Number(t.used) || 0);
        setAllowance(tokens, { used: t.used, left: t.left, state: t.left <= 0 ? 'reached' : 'ok' });
        fillFigure(
          tokens.querySelector('[data-ring-value="left"]'),
          tokenWords(t.left, store),
          'tokens.left',
          store,
          metrics,
        );
        tokens
          .querySelector('[data-ring-value="left"]')
          ?.classList.toggle('is-long', tokenWords(t.left, store).length >= 5);
        fillFigure(
          tokens.querySelector('[data-ring-value="used"]'),
          tokenWords(t.used, store),
          '',
          store,
          false,
        );
        tokens.querySelector('[data-ring-value="left-words"]').textContent =
          `${tokenWords(t.left, store)} left`;
        tokens.querySelector('.allowance-label').textContent =
          t.period === 'day' ? 'Tokens today' : 'Tokens this month';
        // "N of M tokens left on your OpenAI key": the centre says N, the note the rest, with the
        // key's limit period (DB's request 13: "Of 250,000 a month on your OpenAI key", "Of
        // 400,000 a day ..."). Written again only when its words change (T3-19).
        const note = tokens.querySelector('[data-ring-value="note"]');
        const payer = String(t.payerLabel ?? 'AI credits').replace(/^Your /, 'your ');
        const per =
          t.payer === 'own' && t.period === 'day'
            ? ' a day'
            : t.payer === 'own' && t.period === 'month'
              ? ' a month'
              : '';
        const noteKey = JSON.stringify([tokenWords(limit, store), per, payer, metrics]);
        if (note.getAttribute('data-note-drawn') !== noteKey) {
          note.setAttribute('data-note-drawn', noteKey);
          note.textContent = '';
          const of = make('span', { 'data-ring-value': 'all' });
          fillFigure(of, tokenWords(limit, store), 'tokens.limit', store, metrics);
          note.append(
            document.createTextNode('Of '),
            of,
            document.createTextNode(`${per} on ${payer}`),
          );
        }
        for (const part of tokens.querySelectorAll('.allowance-part')) {
          const kind = part.getAttribute('data-part');
          part.setAttribute(
            'data-tip-title',
            kind === 'used'
              ? `${tokenWords(t.used, store)} used`
              : `${tokenWords(t.left, store)} of ${tokenWords(limit, store)} left`,
          );
          part.setAttribute(
            'data-tip',
            `Tokens ${kind === 'used' ? 'used' : 'left'} this ${t.period === 'day' ? 'day' : 'month'} on ${String(t.payerLabel ?? 'AI credits').replace(/^Your /, 'your ')}.`,
          );
        }
      }
    }
    render();
    const unsubscribe =
      typeof store?.subscribe === 'function' ? store.subscribe(() => render()) : null;
    return Object.freeze({
      root: group,
      render,
      destroy: () => {
        if (typeof unsubscribe === 'function') unsubscribe();
        group.remove();
      },
    });
  }

  // runwayLine(host, { uses }): "At your settings your 4 runs last through Sat, Oct 3; your
  // OpenAI key’s tokens through Wed, Oct 14." and, with uses, what uses them ("Keep watch 2
  // sources nightly and Gmail’s daily scan: 3 runs a day."), the store's own words
  // (JobDeputyStore.runway()). Follows the store.
  function runwayLine(host, settings = {}) {
    if (!host || typeof host.append !== 'function') return null;
    const store = settings.store ?? window.JobDeputyStore;
    const line = make('p', { class: 'runway-line' });
    const uses = make('p', { class: 'runway-uses' });
    host.append(line);
    if (settings.uses) host.append(uses);
    const sentence = (words) => {
      const text = String(words ?? '').trim();
      return text ? (/[.!?]$/.test(text) ? text : `${text}.`) : '';
    };
    // counts: false leaves the run count out ("your runs last through"), for a page whose rings
    // already show it (each figure once, R3-4).
    const countless = (words) =>
      settings.counts === false
        ? String(words ?? '').replace(/\byour [\d,]+ runs?\b/, 'your runs')
        : words;
    function render() {
      let now = null;
      try {
        now = typeof store?.runway === 'function' ? store.runway() : null;
      } catch {
        now = null;
      }
      const words = sentence(countless(now?.text));
      if (line.textContent !== words) line.textContent = words;
      setHidden(line, !words);
      if (settings.uses) {
        const used = sentence(now?.runs?.usesText);
        if (uses.textContent !== used) uses.textContent = used;
        setHidden(uses, !used);
      }
    }
    render();
    const unsubscribe =
      typeof store?.subscribe === 'function' ? store.subscribe(() => render()) : null;
    return Object.freeze({
      line,
      render,
      destroy: () => {
        if (typeof unsubscribe === 'function') unsubscribe();
        line.remove();
        uses.remove();
      },
    });
  }

  // The Settings tabs scroll sideways on a phone (round 7): the current tab is brought into view
  // inside the strip (its scroll only, never the page's).
  // Where the tabs do not fit, the edge with more past it fades (T2-10): data-more is "start",
  // "end", or "both", kept as the row scrolls or resizes.
  const tabEdges = new WeakSet();
  function markTabEdges(list) {
    const room = (Number(list.scrollWidth) || 0) - (Number(list.clientWidth) || 0);
    const at = Number(list.scrollLeft) || 0;
    const start = room > 1 && at > 1;
    const end = room > 1 && at < room - 1;
    const value = start && end ? 'both' : start ? 'start' : end ? 'end' : '';
    if ((list.getAttribute('data-more') ?? '') === value) return;
    if (value) list.setAttribute('data-more', value);
    else list.removeAttribute('data-more');
  }

  function showCurrentTab(list) {
    if (!list) return;
    const current = list.querySelector?.('[aria-current="page"]');
    if (current && list.scrollWidth > list.clientWidth) {
      const left = current.offsetLeft - list.offsetLeft;
      const target = left - (list.clientWidth - current.offsetWidth) / 2;
      list.scrollLeft = Math.max(0, Math.min(target, list.scrollWidth - list.clientWidth));
    }
    watchScrollEdges(list);
  }

  // Any sideways scroller with data-more kept as it scrolls or resizes (the tab strip, the
  // combinations table, T1-13).
  function watchScrollEdges(element) {
    if (!element) return;
    markTabEdges(element);
    if (tabEdges.has(element)) return;
    tabEdges.add(element);
    element.addEventListener?.('scroll', () => markTabEdges(element), { passive: true });
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => markTabEdges(element)).observe(element);
    }
  }

  // ---------------------------------------------------------------- start

  // Pages that render markup later call init(container) for it; drawing again is idempotent.
  function init(scope) {
    const root = rootOf(scope);
    const each = (selector, run) => {
      if (root instanceof Element && root.matches(selector)) run(root);
      for (const element of root.querySelectorAll(selector)) run(element);
    };
    each(TABLIST, initTablist);
    each('.sparkline[data-values]', drawSparkline);
    each('.donut', drawDonut);
    each('.allowance-ring', drawRing);
    // A page that renders only a donut's key, or a ring's parts, draws the chart that holds them.
    if (root instanceof Element) {
      const donut = root.parentElement?.closest('.donut');
      if (donut) drawDonut(donut);
      const ring = root.parentElement?.closest('.allowance-ring');
      if (ring) drawRing(ring);
    }
    each('fieldset.thumbs', syncThumbs);
    each('[data-list-toolbar]', initList);
    each('.settings-tabs-list', showCurrentTab);
    syncFlowCounts(root);
    syncHomeRegion();
    followStore();
    syncTourOpeners();
  }

  // The chrome's store-backed words (the flow ribbon's counts, the footer's home Region), drawn as
  // soon as the store is there (round 7, T3-1): this script loads before sample-store.js, so the
  // shared scripts after it (deputy.js, app-panels.js) call storeReady() as they run, and the
  // first frame already says the account's figures; init() draws them again on
  // DOMContentLoaded. Returns false while there is no store.
  function storeReady() {
    if (!window.JobDeputyStore) return false;
    syncFlowCounts();
    syncHomeRegion();
    followStore();
    return true;
  }

  window.JobDeputyComponents = Object.freeze({
    init,
    selectTab,
    openDrawer,
    closeDrawer,
    syncFlowCounts,
    storeReady,
    // Round 7 (T3-19): morph(target, freshElements) keeps target's elements where the fresh
    // ones have the same shape, setting only what differs, so focus stays.
    morph: morphChildren,
    matchQuickPick,
    tip: Object.freeze({ show: showTip, hide: hideTip, place: placeTip, id: TIP_ID }),
    allowance: Object.freeze({ set: setAllowance, draw: drawRing }),
    donut: Object.freeze({ draw: drawDonut }),
    runTracker,
    announce,
    // Round 5: the data palette's words, the downloads, and the new components.
    palette: PALETTE,
    download: Object.freeze(
      Object.assign((doc, format) => saveDownload(doc, format), {
        build: buildDownload,
        fileName,
        note: PDF_NOTE,
      }),
    ),
    downloadMenu,
    usageChart,
    // Round 6 (R6-4): growing lists.
    topWithOther,
    seeAll: Object.freeze({ open: openSeeAll, close: () => closeDrawer(seeAllState.drawer) }),
    multiSelect,
    stackedBars,
    // Round 6 part 2 (N1): a prompt's test score across its versions; part 3: its key and its
    // numbers once for a card of row trends.
    scoreTrend: Object.assign(scoreTrend, { key: drawTrendKey, numbers: drawTrendNumbers }),
    // Round 6: background notices (Activity and a quiet toast).
    notice: Object.assign((options) => showNotice(options), { close: () => closeToast() }),
    formScan,
    secretField,
    pagination,
    agreementBanner,
    flagNew,
    // Round 7 (R10-1): boot without flicker, the skeleton, and splitting heavy renders.
    boot: Object.freeze({
      ready: () => bootReady(),
      whenReady: whenBooted,
      split: bootSplit,
      chunks: bootChunks,
      yield: yieldNow,
      get state() {
        return boot.state;
      },
    }),
    skeleton: Object.freeze({ show: showSkeleton, hide: hideSkeleton }),
    // Round 7 (D10, R10-7): the time range picker and the live filter bar.
    timeRange: Object.assign(timeRange, { resolve: resolveRange }),
    filterBar,
    // Round 7 (D9, D10): usage, every combination, the rings, and the runway.
    permutationsTable,
    allowanceRings,
    runwayLine,
    // Round 7 (R10-3): return to where you were.
    place: Object.freeze({
      remember: (run) => {
        placeState.remember = typeof run === 'function' ? run : null;
      },
      restore: (run) => {
        placeState.restore = typeof run === 'function' ? run : null;
      },
      href: placeHref,
      save: savePlace,
      markReturn,
      names: PAGE_NAMES,
      get back() {
        const target = backTarget();
        return target ? { href: target.href, name: target.name } : null;
      },
      get restored() {
        return placeState.saved;
      },
    }),
    list: Object.freeze({ init: initList, refresh: refreshList }),
    paper: Object.freeze({
      markdown: markdownBlocks,
      render: renderPaper,
      print: printPaper,
      text: plainText,
      PAGE_WIDTH,
    }),
    preview: Object.freeze({
      open: openPreview,
      close: closePreview,
      page: showPreviewPage,
      view: (name) => showPreviewView(name, { select: true }),
    }),
    tour: Object.freeze({
      start: (name, options) => startTour(name, options),
      maybeStart: maybeStartTour,
      end: (reason) => endTour(reason),
      next: () => goToStep(tour.index + 1),
      back: () => goToStep(tour.index - 1),
      steps: (name) => tourSteps(name),
      available: (name) => tourSteps(name).length > 0,
      sync: syncTourOpeners,
      page: tourPage,
      get active() {
        return tour.active;
      },
      get step() {
        return tour.active ? tour.index + 1 : 0;
      },
    }),
  });

  // A paused deputy holds the grow before anything renders.
  if (motionPaused()) markMotion('paused');
  // The boot hold starts as this script runs: the page's regions are parsed (the scripts sit at the
  // end of the body) and its own script, which calls boot.ready(), comes after this one.
  bootStart();
  // As this script runs too (T3-27): the Settings tabs bring the current tab into view, and Take
  // the tour shows where the markup has the page's steps, so the first frame is the settled one.
  // init() does both again on DOMContentLoaded.
  if (typeof document.querySelectorAll === 'function' && document.body) {
    for (const list of document.querySelectorAll('.settings-tabs-list')) showCurrentTab(list);
    syncTourOpeners();
  }

  const start = () => {
    init();
    settleMotion();
    watchTourTargets();
    settleTourOpeners();
    startPlace();
    if (tourAsked()) whenReady(() => startTour(tour.pending || undefined, { auto: true }));
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
