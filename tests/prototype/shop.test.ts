import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Page guarantees for the Shop (brand/shop-preview.html) in round 5 (brief 4.4, the owner's G3, G4,
// and G5; R5-1 replaces round 4's R4-5): an internal page with no nav item, on the Dashboard's
// signed-in chrome, with seven sections in the brief's order: Your balances (#balances, the
// Deputy Assist and Keep watch rings), AI credits (#credits, the one platform model and three
// packs with tokens and price, and how the price is made), Nightly runs (#nightly), Bundles
// (#bundles, list price, price, and saving; the discount on the nightly runs only), Bonus from
// friends (#bonus), Purchases (#purchases), and Support JobDeputy (#support: interest only, the
// planned benefits, the supporters list, not tax deductible, never an amount). Prices are shown
// now, and only the store's: shopItems(), models(), and PRICING, with "Sample prices · nothing is
// charged" beside each list. Round 4's anchors (#runs, #assist, #watch, #added) land on their
// nearest new section. Every figure comes from the store with data-metric (R3-3, R3-4). It also
// covers brand/app-panels.js's buy dialog and checkout (brief 3.5) against the real store; the
// shared fakes are in ui-consistency.test.ts. The page keeps its pure rules between
// `/* shop-rules: start */` and `end` markers; they run here on their own. The rendered checks
// (contrast, targets, overflow, focus) run in scripts/ui-audit.mjs, and the click-throughs in
// headless Chrome. Round 6 (T1, R6-2, R6-3, R6-4, R6-6): the Shop is Purchases, a Settings tab:
// the nav marks Settings (aria-current="true"), the account menu and footer name Purchases, the
// SettingsTabs block sits under the shared page intro (eyebrow Settings, h1 Purchases, Take the
// tour), the tour speaks in the deputy's first person, and What you bought shows the newest five
// with See all. Every section, anchor, price, and ?checkout= stays. Round 6 part 2 (N3, P-2, P-3,
// P-10, P-24): Purchases is the home of the one Runs allowance (every search uses one run, whoever
// starts it; its ring sits beside the run packs, #nightly with #balances, #runs, and #watch at its
// top); the key-limit ring and the Deputy Assist variants leave (their home is AI & credits); AI
// credits are one line above their packs with a link to choose the model in AI & credits; the
// one How prices are made (#prices, from AI & credits) sits beside the credit packs; Bonus from
// friends is one line; one sample note per section group.

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');
const shop = sourceFor('shop-preview.html');
// The page whose signed-in chrome the Shop copies (round 4, brief 4.4).
const home = sourceFor('home-preview.html');
const panelsSource = sourceFor('app-panels.js');

function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const mainOf = (source: string): string => source.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? '';
const inlineScript = (source: string): string =>
  [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '').join('\n');

// The markup between `<!-- name: start -->` and `<!-- name: end -->`, markers included.
function markedBlock(source: string, name: string): string {
  const start = `<!-- ${name}: start -->`;
  const end = `<!-- ${name}: end -->`;
  const from = source.indexOf(start);
  const to = source.indexOf(end);
  return from < 0 || to < from ? '' : source.slice(from, to + end.length);
}

const between = (source: string, start: string, end: string): string => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  return from < 0 || to < from ? '' : source.slice(from, to + end.length);
};

// The element that carries `id`, from its opening tag to the matching close.
function elementById(source: string, id: string): string {
  const open = new RegExp(`<([a-z][\\w-]*)\\b[^>]*\\sid="${id}"[^>]*>`).exec(source);
  if (!open) return '';
  const tag = open[1] ?? '';
  const pattern = new RegExp(`<${tag}\\b|</${tag}\\s*>`, 'g');
  pattern.lastIndex = open.index + open[0].length;
  let depth = 1;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return source.slice(open.index, match.index + match[0].length);
  }
  return '';
}

function rulesOf<T>(source: string, name: string, global: string): T {
  const start = source.indexOf(`/* ${name}-rules: start */`);
  const end = source.indexOf(`/* ${name}-rules: end */`);
  if (start < 0 || end < start) throw new Error(`${name}-rules markers not found`);
  const block = source.slice(start, end);
  return new Script(`${block}\n${global};`, { filename: `${name}-rules` }).runInNewContext({}) as T;
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const words = (text: string): number =>
  text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

// ------------------------------------------------------------------ the store

type Item = Record<string, unknown> & { id: string; priceText: string };
type Store = {
  TERMS: Record<string, string>;
  PRICING: Record<string, string | number>;
  BUNDLE_OFFER: Record<string, unknown>;
  CREDITS: Record<string, number>;
  get(): { referrals: { capFriends: number; rewardTokens: number; invites: unknown[] } };
  allowance(): { nightly: Record<string, unknown>; runs: Record<string, unknown> };
  credits(): Record<string, unknown> & { left: number };
  aiChoice(): Record<string, unknown>;
  aiLimit(): Record<string, unknown>;
  setAiChoice(source: string): unknown;
  setAiLimit(limit: Record<string, unknown>): unknown;
  models(): Array<Record<string, unknown>>;
  setPlatformModel(id: string): Record<string, unknown> | null;
  shopItems(): { credits: Item[]; nightly: Item[]; bundles: Item[] } & Record<string, unknown>;
  buy(id: string): { ok: boolean; reason?: string };
  purchases(): Array<Record<string, unknown>>;
  requiresAgreement(feature: string): Record<string, unknown> | null;
  signAgreement(entry: Record<string, unknown>): { ok: boolean };
  support(): Record<string, unknown>;
  pledgeSupport(cadence: string): Record<string, unknown> | null;
  withdrawSupport(): Record<string, unknown>;
  setSupporterListing(fields: Record<string, unknown>): Record<string, unknown> | null;
  prompt(id: string): Record<string, unknown> | null;
  metric(key: string): unknown;
  metricText(key: string): string;
  format: {
    date(value: unknown): string;
    dateTime(value: unknown): string;
    tokens(value: unknown): string;
  };
};

// The shared sample store, run the way the pages run it (with the agreement text, so a signature
// keeps its fingerprint).
function loadStore(): Store {
  const storage = new Map<string, string>();
  const window: Record<string, unknown> = { addEventListener: () => {} };
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  const context = { window, localStorage, JSON };
  runInNewContext(sourceFor('agreement-text.js'), context);
  runInNewContext(sourceFor('sample-store.js'), context);
  return window.JobDeputyStore as Store;
}

// Signing 2026.10 is what buying needs (requiresAgreement('buy'), brief 3.1 item 4).
const sign = (store: Store) =>
  store.signAgreement({
    version: '2026.10',
    name: 'Alex Morgan',
    consents: ['read', 'act', 'keep'],
  });

// ------------------------------------------------------------------ app-panels.js

// app-panels.js against a minimal document: each dialog keeps its markup, and querySelector hands
// back one recording part per selector (as in ui-consistency.test.ts), so the tests read what the
// script writes. The pack radios come from the markup written into the packs fieldset.
type Listener = (event: Record<string, unknown>) => void;

class Part {
  textContent = '';
  innerHTML = '';
  hidden = false;
  value = '';
  name = '';
  disabled = false;
  open = false;
  checked = false;
  maxLength = -1;
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  constructor(readonly owner: Dialog) {}
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ preventDefault: () => {}, target: this, ...event });
    }
  }
  focus(): void {
    this.owner.focused = this;
  }
}

class Dialog {
  className = '';
  id = '';
  innerHTML = '';
  open = false;
  scrollTop = 0;
  focused: Part | null = null;
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  readonly parts = new Map<string, Part>();
  private radios: { html: string; parts: Part[] } = { html: '', parts: [] };
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  querySelector(selector: string): Part {
    let part = this.parts.get(selector);
    if (!part) {
      part = new Part(this);
      this.parts.set(selector, part);
    }
    return part;
  }
  querySelectorAll(selector: string): Part[] {
    if (selector === 'input[name="item"]') {
      const html = this.querySelector('#topup-drawer-packs').innerHTML;
      if (html !== this.radios.html) {
        const parts = [
          ...html.matchAll(/<input type="radio" name="item" value="([\w-]+)" \/>/g),
        ].map((match) => {
          const radio = new Part(this);
          radio.name = 'item';
          radio.value = match[1] ?? '';
          return radio;
        });
        this.radios = { html, parts };
      }
      return this.radios.parts;
    }
    return selector.split(',').map((part) => this.querySelector(part.trim()));
  }
  contains(part: unknown): boolean {
    return [...this.parts.values()].includes(part as Part);
  }
  showModal(): void {
    this.open = true;
  }
  close(): void {
    this.open = false;
    for (const listener of this.listeners.get('close') ?? []) listener({});
  }
}

type Panels = {
  openTopup(kind: string): Dialog;
  checkout(itemId: string): Dialog;
  openPrompt(id: string): Dialog;
};

function loadPanels(
  store: unknown,
  {
    pathname = '/jobdeputy/brand/home-preview.html',
    search = '',
    hash = '',
    loading = false,
  }: { pathname?: string; search?: string; hash?: string; loading?: boolean } = {},
) {
  const dialogs: Dialog[] = [];
  const calls: Array<[string, ...unknown[]]> = [];
  const addresses: string[] = [];
  // A page still loading runs the panels at DOMContentLoaded; the load event comes after.
  const pending = new Map<string, () => void>();
  const document = {
    readyState: loading ? 'loading' : 'complete',
    activeElement: null,
    body: { append: (node: Dialog) => dialogs.push(node) },
    createElement: () => new Dialog(),
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'DOMContentLoaded') pending.set(type, listener);
    },
  };
  class FakeElement {}
  class FakeHTMLElement extends FakeElement {}
  const window: Record<string, unknown> = {
    JobDeputyStore: store,
    JobDeputyDeputy: {
      set: (...args: unknown[]) => calls.push(['deputy.set', ...args]),
      flash: (...args: unknown[]) => calls.push(['deputy.flash', ...args]),
      react: (...args: unknown[]) => calls.push(['deputy.react', ...args]),
    },
    JobDeputyComponents: { openDrawer: (dialog: Dialog) => dialog.showModal() },
    location: { search, pathname, hash },
    history: {
      state: null,
      replaceState: (_state: unknown, _title: string, url: string) => addresses.push(url),
    },
    setTimeout: (callback: () => void) => {
      callback();
      return 1;
    },
    clearTimeout: () => {},
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'load') pending.set(type, listener);
    },
  };
  new Script(panelsSource, { filename: 'app-panels.js' }).runInNewContext({
    window,
    document,
    URLSearchParams,
    Element: FakeElement,
    HTMLElement: FakeHTMLElement,
  });
  const byId = (id: string) => dialogs.find((dialog) => dialog.id === id) as Dialog;
  return {
    api: window.JobDeputyPanels as Panels,
    get topup() {
      return byId('topup-drawer');
    },
    get prompt() {
      return byId('prompt-drawer');
    },
    calls,
    addresses,
    location: window.location as Record<string, string>,
    // Fires DOMContentLoaded or load, as the browser would.
    fire: (type: 'DOMContentLoaded' | 'load') => pending.get(type)?.(),
  };
}

// The packs as cards ([id, label, meta]) and the checkout's order as rows ([label, values]).
const cardsOf = (dialog: Dialog) =>
  [
    ...dialog
      .querySelector('#topup-drawer-packs')
      .innerHTML.matchAll(
        /<input type="radio" name="item" value="([\w-]+)" \/>[\s\S]*?<span class="choice-card-label">([^<]+)<\/span>(?:<span class="choice-card-meta">([^<]+)<\/span>)?/g,
      ),
  ].map((match) => [match[1], match[2], match[3] ?? '']);
const rowsOf = (dialog: Dialog) =>
  [
    ...dialog
      .querySelector('#topup-drawer-summary')
      .innerHTML.matchAll(/<div><dt>([^<]+)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/g),
  ].map((match) => [
    match[1],
    [...(match[2] ?? '').matchAll(/<span>([^<]*)<\/span>/g)].map((part) => part[1]),
  ]);

// ------------------------------------------------------------------ the page's rules

type Tips = Record<string, [string, string]>;
type Row = {
  id: string;
  figure: string;
  unit: string;
  meta: string;
  price: string;
  was: string;
  save: string;
  action: string;
  lasts: { text: string; parts: Array<string | [string, string]> } | null;
};
type Rules = {
  TERMS: Record<string, string>;
  WORDS: Record<string, string>;
  LEGACY: Record<string, string>;
  KINDS: string[];
  KIND_LABELS: Record<string, string>;
  CADENCES: string[];
  DISPLAYS: string[];
  RECEIPT_SIZES: number[];
  termsFrom(stored: unknown): Record<string, string>;
  wordsFrom(palette: unknown): Record<string, string>;
  creditsLine(credits: unknown, choice: unknown): { model: string; paused: string; state: string };
  runsView(
    runs: unknown,
    options?: { day?: (value: unknown) => string },
  ): {
    parts: Record<string, number>;
    state: string;
    lasts: boolean;
    out: string;
    tips: Tips;
  };
  whoLine(figures: Record<string, unknown>): Array<string | [string, string]>;
  runsTour(options?: Record<string, unknown>): string;
  bonusTour(cap: unknown, options?: Record<string, unknown>): string;
  bonusView(
    referrals: unknown,
    credits: unknown,
    options?: { tokens?: (value: unknown) => string; freeTokens?: number },
  ): { reward: string; who: string };
  chosenModel(models: unknown): Record<string, unknown> | null;
  itemRows(kind: string, items: unknown, options?: { day?: (value: unknown) => string }): Row[];
  kindOf(items: unknown, id: string): string | null;
  kindFor(hash: string): string | null;
  landsOnBuy(hash: string): boolean;
  recommend(
    items: unknown,
    runs: unknown,
    options?: { day?: (value: unknown) => string },
  ): (Record<string, unknown> & { kind: string; id: string; reason: string }) | null;
  buyWords(row: unknown): string;
  bundleRule(offer: unknown): string;
  offerEnds(offer: unknown, options?: { day?: (value: unknown) => string }): string;
  howView(models: unknown, pricing: unknown): Record<string, unknown> | null;
  receiptRow(row: unknown, options?: { when?: (at: unknown) => string }): Record<string, string>;
  totalsOf(rows: unknown): Record<string, number>;
  totalsLine(totals: unknown, options?: { money?: (micros: unknown) => string }): string;
  receiptMarkdown(
    receipt: unknown,
    options?: { when?: (at: unknown) => string; money?: (micros: unknown) => string },
  ): string;
  facetOptions(facet: unknown): Array<{ value: string; label: string; count: number }>;
  receiptQuery(state: unknown, place?: { page?: number; size?: number }): Record<string, unknown>;
  supportView(
    support: unknown,
    options?: { when?: (at: unknown) => string },
  ): {
    pledged: boolean;
    cadence: string | null;
    title: string;
    message: string;
    listing: {
      optIn: boolean;
      display: string;
      names: Record<string, string>;
      status: string;
    };
    benefits: Array<{ id: string; title: string; text: string; planned: boolean }>;
    note: string;
  };
  sentence(value: string): string;
  anchorFor(hash: string): string | null;
};

const rules = rulesOf<Rules>(shop, 'shop', 'shopRules');
const store = loadStore();
const main = mainOf(shop);
const script = inlineScript(shop);
const tokens = (value: unknown) => store.format.tokens(value);

// Figures as [key, the text the markup holds] (R3-3, R3-4).
const figuresOf = (markup: string): Array<[string, string]> =>
  [...markup.matchAll(/<([a-z]+)\b[^>]*\sdata-metric="([^"]+)"[^>]*>([^<]*)<\/\1>/g)].map(
    (match): [string, string] => [match[2] ?? '', (match[3] ?? '').trim()],
  );

describe('Shop page frame', () => {
  it('loads the shell scripts in order, app-panels.js last, before its own script', () => {
    const order = [
      'app-shell.js',
      'app-components.js',
      'prompt-guard.js',
      'agreement-text.js',
      'sample-store.js',
      'deputy.js',
      'feedback.js',
      'app-panels.js',
    ].map((name) => shop.indexOf(`<script src="./${name}"></script>`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order.at(-1)).toBeLessThan(shop.indexOf('<script>'));
    const tags = (source: string) =>
      between(
        source,
        '<script src="./app-shell.js"></script>',
        '<script src="./app-panels.js"></script>',
      );
    expect(tags(shop)).toBe(tags(home));
  });

  it('copies the Dashboard’s :root, links, header, account menu, and footer byte for byte', () => {
    const rootOf = (source: string) => source.match(/:root\s*\{[^}]*\}/)?.[0];
    expect(rootOf(shop)).toBe(rootOf(home));
    const links = (source: string) =>
      between(source, '<link rel="icon"', '<link rel="stylesheet" href="./deputy.css" />');
    expect(links(shop)).toBe(links(home));
    // The Dashboard hides its chrome under the opening loader; the Shop has no loader, so its
    // opening tags drop those attributes (as every other internal page does). Round 6 (T1): the
    // account menu marks no link current on any page (the nav and the tab strip say where you
    // are), so the header is the Dashboard's byte for byte.
    const header = (source: string) =>
      (source.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '').replace(
        '<header class="app-header" id="app-header" inert aria-hidden="true">',
        '<header class="app-header">',
      );
    expect(header(shop)).toBe(header(home));
    expect(shop).toContain('<a href="./shop-preview.html">Purchases</a>');
    expect(shop).toContain('<header class="app-header">');
    const footer = (source: string) =>
      between(source, '<footer class="site-footer"', '</footer>').replace(
        '<footer class="site-footer" id="home-footer" inert aria-hidden="true">',
        '<footer class="site-footer">',
      );
    expect(footer(shop)).toBe(footer(home));
    expect(shop).toContain('<footer class="site-footer">');
    expect(markedBlock(shop, 'HeaderActions')).toBe(markedBlock(home, 'HeaderActions'));
    expect(markedBlock(shop, 'HeaderActions')).not.toContain('aria-current');
    // Round 6 (T1): the page is Purchases, under Settings.
    expect(shop).toContain('<a class="skip-link" href="#page-title">Skip to Purchases</a>');
    expect(shop).toContain('<title>JobDeputy · Settings · Purchases</title>');
    expect(shop).not.toMatch(/\binert\b|loader-active|OpeningLoader/);
  });

  it('marks Settings current in the nav, as every Settings tab does (T1, R6-6)', () => {
    // Round 6 (T1): Purchases is a Settings tab, so the nav's Settings link carries
    // aria-current="true" (the section), the Menu button names Settings, the account menu is the
    // Dashboard's with no link marked, and the footer names Purchases.
    const nav = markedBlock(shop, 'AppNav');
    expect(nav.match(/aria-current/g)).toHaveLength(1);
    expect(nav).toContain(
      '<a class="app-nav-link" href="./account-preview.html" aria-current="true">',
    );
    expect(nav).toBe(
      markedBlock(home, 'AppNav')
        .replace(' aria-current="page"', '')
        .replace(
          '<a class="app-nav-link" href="./account-preview.html">',
          '<a class="app-nav-link" href="./account-preview.html" aria-current="true">',
        ),
    );
    expect(shop).toContain('<div class="app-sidebar" id="app-sidebar">');
    expect(
      textOf(
        shop.match(/<button\s+class="compact-action app-menu-toggle"[\s\S]*?<\/button>/)?.[0] ?? '',
      ),
    ).toBe('Menu · Settings');
    expect(between(shop, '<details class="account-menu">', '</details>')).toBe(
      between(home, '<details class="account-menu">', '</details>'),
    );
    expect(between(shop, '<details class="account-menu">', '</details>')).not.toContain(
      'aria-current',
    );
    expect(between(shop, '<footer class="site-footer"', '</footer>')).toContain(
      '<a class="footer-link" href="./shop-preview.html">Purchases</a>',
    );
    // The tab strip sits right after the page intro and marks Purchases; round 7 adds Usage
    // after AI & credits and Activity last, the same seven tabs on every Settings page.
    const tabs = markedBlock(shop, 'SettingsTabs');
    expect(
      [
        ...tabs.matchAll(/<a class="settings-tab" href="\.\/([\w-]+)\.html"[^>]*>([^<]+)<\/a>/g),
      ].map((match) => [match[1], match[2]]),
    ).toEqual([
      ['account-preview', 'Account'],
      ['connections-preview', 'Connections'],
      ['prompts-preview', 'Prompts'],
      ['ai-preview', 'AI &amp; credits'],
      ['usage-preview', 'Usage'],
      ['shop-preview', 'Purchases'],
      ['activity-preview', 'Activity'],
    ]);
    expect(tabs).toContain(
      '<li><a class="settings-tab" href="./shop-preview.html" aria-current="page">Purchases</a></li>',
    );
    expect(tabs.match(/aria-current/g)).toHaveLength(1);
    expect(main).toMatch(/<\/section>\s*<!-- SettingsTabs: start -->/);
    expect(main.indexOf('<!-- SettingsTabs: start -->')).toBeGreaterThan(
      main.indexOf('<section class="page-intro shop-intro"'),
    );
  });

  it('hosts the deputy in the idle state, with that state’s duty and speech', () => {
    const dock = markedBlock(shop, 'DeputyDock');
    expect(dock).toContain('data-deputy-page="shop"');
    expect(dock).toContain('data-deputy-state="idle"');
    expect(dock).toContain(
      '<p class="deputy-speech" data-deputy-speech>Here when you need me.</p>',
    );
    expect(dock).toContain('<span data-deputy-duty>Ready</span>');
    const normalize = (block: string) =>
      block
        .replace(/data-deputy-page="[^"]*"/, '')
        .replace(/data-deputy-state="[^"]*"/, '')
        .replace(/(<p class="deputy-speech" data-deputy-speech>)[^<]*(<\/p>)/, '$1$2')
        .replace(/(<span data-deputy-duty>)[^<]*(<\/span>)/, '$1$2');
    expect(normalize(dock)).toBe(normalize(markedBlock(home, 'DeputyDock')));
    // One panda per viewport: the dock is the only drawing, and the page draws no art of its own.
    expect(main).not.toMatch(/data-deputy(?:-art)?[\s>=]/);
  });

  it('opens with the shared page intro: Settings, Purchases, one line, Back, and Take the tour (T1, R6-3, R10-3)', () => {
    const intro = main.match(/<section class="page-intro shop-intro"[\s\S]*?<\/section>/)?.[0];
    // Purchases is buying's home (R10-3): a link here with return= gets Back to its page.
    expect(intro).toMatch(
      /^<section class="page-intro shop-intro" aria-labelledby="page-title" data-page-back>\s*<div class="page-intro-copy">\s*<p class="eyebrow">Settings<\/p>/,
    );
    expect(textOf(intro?.match(/<h1 id="page-title">([\s\S]*?)<\/h1>/)?.[1] ?? '')).toBe(
      'Purchases.',
    );
    expect(textOf(intro?.match(/<p class="intro-copy">([\s\S]*?)<\/p>/)?.[1] ?? '')).toBe(
      // Round 7 (SE3): balances first, then one quick buy, then every receipt.
      'Your balances, one quick buy, and every receipt.',
    );
    expect(intro).toMatch(
      /<div class="page-intro-actions">\s*<button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour<\/button>\s*<\/div>/,
    );
    expect(main.match(/<h1\b/g)).toHaveLength(1);
    // The page's own tour button placement is gone; the shared chrome places it.
    const styles = shop.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(styles).not.toMatch(/\.shop-intro(?:-actions)?\s*\{|\.page-intro|\.page-tour/);
  });

  it('lays out balances, one quick buy, receipts, then the bonus and support (SE3)', () => {
    // Round 7 (SE3, "keep it concise and get the buy in quickly"): balances lead, then the one
    // chooser and its Buy (bundles are a kind there, so they have no section of their own),
    // then every receipt (round 6's What you bought), then the bonus line and support, compact.
    const sections = [
      ...main.matchAll(
        /<section class="task-surface shop-surface(?: [\w-]+)*" id="(\w+)" aria-labelledby="([\w-]+)">/g,
      ),
    ].map((match) => [match[1] ?? '', match[2] ?? '']);
    expect(sections.map(([id]) => id)).toEqual(['nightly', 'buy', 'receipts', 'bonus', 'support']);
    // Each section names itself: an h2, or for the one-line bonus card its title line.
    for (const [id, title] of sections) {
      expect(elementById(main, String(id)), `#${id}`).toMatch(
        new RegExp(`<(h2|p)\\b[^>]*\\sid="${title}"[^>]*>[^<]+</\\1>`),
      );
    }
    const labels = sections.map(([id]) =>
      textOf(
        elementById(main, String(id)).match(/<p class="section-label"[^>]*>([^<]+)<\/p>/)?.[1] ??
          '',
      ),
    );
    expect(labels).toEqual(['Balances', 'Buy', 'Receipts', '', 'Support JobDeputy']);
    const headings = sections.map(([, title]) => textOf(elementById(main, String(title))));
    expect(headings).toEqual([
      'What you have.',
      'Get more in one step.',
      'Every payment.',
      'Bonus from friends',
      'Donate at launch.',
    ]);
    // The bonus line and support share a row from 760px (their pair).
    expect(main).toMatch(
      /<div class="shop-pair">\s*<div class="shop-pair-grid">[\s\S]*?id="bonus"[\s\S]*?id="support"/,
    );
    // R4-3: the feature names come from JobDeputyStore.TERMS on render.
    expect(main.match(/data-term="credits"/g)).toHaveLength(1);
    expect(store.TERMS).toEqual({
      assist: 'Deputy Assist',
      credits: 'AI credits',
      tokens: 'tokens',
      watch: 'Keep watch',
      // Round 6, part 2 (N3): one Runs allowance; the round 5 names read runs too.
      nightlyRun: 'run',
      nightlyRuns: 'runs',
      run: 'run',
      runs: 'runs',
    });
    // Every heading level follows the one before it.
    const levels = [...main.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
    for (const [index, level] of levels.entries()) {
      if (index > 0) expect(level - (levels[index - 1] ?? 1)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps every old anchor and deep link, each at the top of the section it lands on (SE3)', () => {
    // #balances, #runs, and #watch land on the balances (#nightly); #credits, #assist, and
    // #bundles on the chooser (#buy), each choosing its kind; #purchases and #added on Receipts.
    for (const [old, now] of [
      ['balances', 'nightly'],
      ['runs', 'nightly'],
      ['watch', 'nightly'],
      ['credits', 'buy'],
      ['assist', 'buy'],
      ['bundles', 'buy'],
      ['purchases', 'receipts'],
      ['added', 'receipts'],
    ]) {
      const section = elementById(main, String(now));
      expect(section, `#${old} in #${now}`).toMatch(
        new RegExp(
          `^<section [^>]*>(?:\\s*<span class="shop-anchor" id="\\w+"></span>)*\\s*<span class="shop-anchor" id="${old}"></span>`,
        ),
      );
    }
    for (const [old, now] of [
      ['balances', 'nightly'],
      ['runs', 'nightly'],
      ['watch', 'nightly'],
      ['assist', 'credits'],
      ['purchases', 'receipts'],
      ['added', 'receipts'],
    ]) {
      expect(rules.anchorFor(`#${old}`), old).toBe(now);
    }
    expect(elementById(main, 'nightly')).toMatch(
      /^<section [^>]*>\s*<span class="shop-anchor" id="balances"><\/span>/,
    );
    // #bonus, #support, #prices, #credits, #bundles, and #receipts keep their names.
    for (const id of [
      'bonus',
      'support',
      'credits',
      'nightly',
      'bundles',
      'prices',
      'receipts',
      'buy',
    ]) {
      expect(rules.anchorFor(`#${id}`)).toBeNull();
    }
    expect(rules.anchorFor('#toString')).toBeNull();
    // The kind each anchor opens in the chooser.
    expect(
      ['#credits', '#assist', '#bundles', '#buy', '#nightly', '#toString'].map(rules.kindFor),
    ).toEqual(['credits', 'credits', 'bundles', null, null, null]);
    // T3-25: Get more runs and Buy credits from another page land on the quick buy (#buy, or an
    // anchor inside it). There the Buy label's line gets the same Back as the intro (PL's own
    // link, cloned once drawn, so a press marks the return), on a flex line so nothing moves, and
    // focus goes to the Buy heading after load (until then the browser's scroll to the anchor
    // moves focus to the page).
    expect(
      ['#buy', '#credits', '#assist', '#bundles', '#receipts', '#nightly', '', '#toString'].map(
        rules.landsOnBuy,
      ),
    ).toEqual([true, true, true, true, false, false, false, false]);
    for (const part of [
      'if (rules.landsOnBuy(window.location.hash) && components?.place?.back) {',
      "const back = $('main .page-intro .page-back');",
      'buyLabel.prepend(back.cloneNode(true));',
      "document.addEventListener('DOMContentLoaded', mountBuyBack, { once: true });",
      'buyTitle.tabIndex = -1;',
      'buyTitle.focus({ preventScroll: true });',
      "else window.addEventListener('load', focusBuy, { once: true });",
    ]) {
      expect(script, part).toContain(part);
    }
    expect(shop).toMatch(
      /#buy > \.shop-head > \.section-label \{\s*display: flex;\s*align-items: center;\s*\}/,
    );
    expect(script).toMatch(/window\.location\.replace\(`#\$\{target\}`\);/);
    expect(script).toContain("window.addEventListener('hashchange', () => {");
    expect(script).toContain("if (window.location.hash === '#prices') $('#prices').open = true;");
    // ?checkout=<item> chooses its kind and pack, so the checkout's focus returns to the one Buy.
    expect(script).toContain(
      "const wanted = new URLSearchParams(window.location.search).get('checkout');",
    );
    expect(rules.kindOf(store.shopItems(), 'bundle-month')).toBe('bundles');
    expect(rules.kindOf(store.shopItems(), 'credits-10')).toBe('credits');
    expect(rules.kindOf(store.shopItems(), 'nightly-60')).toBe('nightly');
    expect(rules.kindOf(store.shopItems(), 'nightly-7')).toBeNull();
  });

  it('shows only the store’s prices, with "Sample prices · nothing is charged" beside them (R5-1)', () => {
    // The packs are drawn from shopItems() into the chooser; the markup holds none of their prices.
    for (const kind of ['nightly', 'credits', 'bundles']) {
      expect(main).toMatch(
        new RegExp(
          `<fieldset class="choice-cards shop-picks" data-shop-picks="${kind}" id="shop-packs-${kind}"(?: hidden)?>\\s*<legend class="sr-only">[^<]+</legend>\\s*</fieldset>`,
        ),
      );
    }
    // A currency sign in the markup is only ever a store figure (its seed text, redrawn on load),
    // or the one Buy's seed words, which the script sets from the chosen pack.
    const outsideFigures = main
      .replace(/<([a-z]+)\b[^>]*\sdata-metric="[^"]+"[^>]*>[^<]*<\/\1>/g, '')
      .replace(/<button class="primary-action" id="shop-buy"[^>]*>[^<]*<\/button>/, '');
    expect(outsideFigures).not.toMatch(/[$€£¥₹]\s?\d/);
    // The page's script types no price either.
    expect(script.replace(/\/\/[^\n]*/g, '')).not.toMatch(/\$\d/);
    // The note sits beside the Buy and in Receipts, in the store's words.
    const note = String(store.PRICING.note);
    expect(note).toBe('Sample prices · nothing is charged');
    expect(elementById(main, 'buy')).toContain(
      `<span class="sample-note" id="shop-buy-note" data-shop-note>${note}</span>`,
    );
    expect(elementById(main, 'receipts')).toContain(
      `<span class="sample-note" data-shop-note>${note}</span>`,
    );
    expect(script).toContain('const note = store?.PRICING?.note;');
    // How prices are made (round 6 part 2, P-10: the one place; AI & credits' #prices forwards
    // here) folds under the chooser (round 7): the sum, AWS's rates for the model in use in your
    // home Region, the worked example, the bundle rule, tax at checkout, and the source and date.
    const prices = elementById(main, 'prices');
    expect(prices).toMatch(/^<details\s+class="shop-fold"\s+id="prices"/);
    expect(prices).toContain('<summary class="shop-fold-toggle">How prices are made</summary>');
    // The text as read: the tags between figures and their punctuation add no space.
    const read = (markup: string) => textOf(markup).replace(/\s+([.,%])/g, '$1');
    expect(read(elementById(main, 'shop-price-sum'))).toBe(
      'AWS’s rate + plus 10% margin = makes Our rate',
    );
    expect(read(elementById(main, 'shop-how'))).toBe(
      'AWS charges $0.20 a million input tokens and $0.20 a million output tokens for Ministral 3 14B in US East (N. Virginia), your home Region. A token’s price blends the two at this month’s mix of your platform work.',
    );
    expect(read(elementById(main, 'shop-example'))).toBe(
      'A search uses about 11,000 tokens: about $0.0024 on Ministral 3 14B.',
    );
    expect(read(prices)).toContain(
      'Run packs cost what they say. A bundle takes its discount off its runs only.',
    );
    expect(prices).toContain(
      `<p class="shop-prices-copy" data-shop-tax>${String(store.PRICING.tax)}</p>`,
    );
    // AWS's price list opens in a new tab, and every model's rates are one link away, each a
    // 44px action (the audit's target check).
    expect(prices).toContain(
      `<a class="compact-action" href="${String(store.PRICING.sourceUrl)}" target="_blank" rel="noopener noreferrer" data-shop-source>See AWS’s prices <span aria-hidden="true">↗</span><span class="sr-only"> (opens a new tab)</span></a>`,
    );
    expect(prices).toContain(
      '<a class="chart-action" href="./ai-preview.html#model">Every model’s rates<span class="sr-only">, in AI &amp; credits</span></a>',
    );
    expect(read(prices)).toContain(
      `AWS’s rates: ${String(store.PRICING.source)}, checked Thu, Oct 1.`,
    );
    // Bundles: the discount is on the runs only (N3), said under the bundles.
    expect(textOf(elementById(main, 'shop-bundle-line'))).toContain(
      '25% off the runs only; AI credits always cost AWS’s rate plus our margin.',
    );
  });

  it('keeps support free of amounts, says it is not tax deductible, and asks for no card anywhere', () => {
    const support = elementById(main, 'support');
    expect(textOf(support)).not.toMatch(/[$€£¥₹]|\d/);
    expect(textOf(elementById(support, 'shop-support-note'))).toBe(String(store.support().note));
    expect(String(store.support().note)).toContain('support isn’t tax deductible');
    // The only fields: the chooser's kind (its packs are drawn as radios too), once or monthly,
    // the supporters list, and how your name shows. Nothing asks for a number or a card.
    const inputs = [...main.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map((match) => match[0]);
    expect(inputs).toEqual([
      '<input type="radio" name="shop-kind" value="nightly" checked />',
      '<input type="radio" name="shop-kind" value="credits" />',
      '<input type="radio" name="shop-kind" value="bundles" />',
      '<input type="radio" name="cadence" value="once" />',
      '<input type="radio" name="cadence" value="monthly" />',
      '<input type="checkbox" name="listing" id="shop-listing-opt" />',
      '<input type="radio" name="display" value="full" />',
      '<input type="radio" name="display" value="initial" />',
      '<input type="radio" name="display" value="anonymous" />',
    ]);
    expect(shop).not.toMatch(/autocomplete="cc-|inputmode="(?:numeric|decimal)"|card number/i);
    // What supporters get and the tax line fold away (round 7: support is compact).
    expect(support).toMatch(
      /<details class="shop-fold shop-benefits">\s*<summary class="shop-fold-toggle shop-benefits-title">Supporter benefits <span class="status-pill is-neutral">Planned<\/span><\/summary>/,
    );
  });

  it('says nothing about AI runs, which round 5 retired (G3, W10)', () => {
    expect(textOf(main)).not.toMatch(/\bAI runs?\b|free runs/i);
    expect(script).not.toMatch(/\bAI runs?\b|requestTopup|topups\(\)/);
    for (const match of main.matchAll(/\sdata-(?:tour-title|tour-text|tip|tip-title)="([^"]*)"/g)) {
      expect(match[1]).not.toMatch(/\bAI runs?\b/);
    }
  });

  it('announces through one visually hidden channel and keeps visible feedback quiet', () => {
    const live = [
      ...shop.matchAll(
        /<([a-z]+)\b([^>]*(?:role="(?:status|alert|log)"|aria-live="(?!off)[^"]*")[^>]*)>/g,
      ),
    ].map((match) => match[0]);
    expect(live).toEqual([
      '<p class="sr-only" data-deputy-announce role="status">',
      '<p class="sr-only" id="shop-status" role="status" aria-live="polite">',
    ]);
  });

  it('keeps its copy free of dashes as punctuation', () => {
    expect(textOf(main)).not.toMatch(/[\u2013\u2014]/);
    expect(script).not.toMatch(/[\u2013\u2014]/);
    for (const match of main.matchAll(/\sdata-tour-(?:title|text)="([^"]*)"/g)) {
      expect(match[1]).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it('holds the regions it draws behind skeletons, and reveals once (R10-1)', () => {
    for (const id of ['shop-tokens', 'shop-runway', 'shop-chooser', 'shop-receipts-list']) {
      expect(elementById(main, id), id).toMatch(/\sdata-skeleton="[a-z]+"/);
    }
    expect(script).toContain('components?.boot?.ready?.();');
    expect(script.indexOf('render();\n        components?.boot?.ready?.();')).toBeGreaterThan(-1);
  });
});

describe('Shop figures', () => {
  it('shows each figure once, with the store’s text (R3-3, R3-4)', () => {
    // The chooser's lines wait hidden for their kind; each figure is still in the page once.
    const keys = figuresOf(main).map(([key]) => key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [key, shown] of figuresOf(main)) expect(shown, key).toBe(store.metricText(key));
    expect(main).not.toMatch(
      /data-shop-assist=|shop-meter-limit|shop-meter-ai|data-metric="ai\.limit\./,
    );
    // The page writes the store's text for every key, and keeps a figure without a value as it is.
    expect(script).toContain('setText(element, store.metricText(element.dataset.metric));');
    expect(script).toContain('if (!known(element.dataset.metric)) continue;');
  });

  it('leads with the runs ring and the tokens ring, then the runway (SE3, R9-1, R10-9)', () => {
    const parts = [
      ...elementById(main, 'shop-meter-runs').matchAll(
        /<span class="allowance-part" data-part="(\w+)" style="--count: (\d+)"(?: hidden)? data-tip-title="([^"]+)" data-tip="([^"]+)"><\/span>/g,
      ),
    ].map((match) => match[1]);
    // Runs (round 6 part 3, R9-1): indigo is every run left this month, free plus bought, so the
    // ring keeps two parts and the split line says where the total comes from.
    const runs = elementById(main, 'shop-meter-runs');
    expect(runs).toMatch(
      /^<div\s+class="allowance is-ring is-attention"\s+id="shop-meter-runs"\s+data-meter-kind="watch"/,
    );
    expect(parts).toEqual(['used', 'left']);
    expect(runs).toContain('<p class="allowance-label">Runs this month</p>');
    expect(runs).toContain(
      '<p class="allowance-ring-centre"><span class="allowance-ring-figure" data-metric="runs.left">4</span> <span class="allowance-ring-unit">of <span data-metric="runs.all">10</span> left</span></p>',
    );
    // The key's Left row says the number, in words the centre's figure keeps the key for.
    expect(runs).toContain(
      '<li class="allowance-key-item" data-part="left"><span id="shop-runs-key-left">4 left</span></li>',
    );
    expect(runs).toContain(
      '<p class="allowance-note shop-runs-split is-empty" id="shop-runs-split"><span data-metric="runs.free">10</span> free + <span data-metric="runs.bought">0</span> bought</p>',
    );
    // Who used them: you, and your deputy (Keep watch, Gmail's scans, the daily email).
    expect(textOf(runs)).toContain('2 started by you, 4 by your deputy');
    // How long they last is the runway's line under both rings, never said twice.
    expect(runs).not.toContain('runs.lastsThrough');
    // Keep watch's schedule lives on Searches (P-1): one 44px link there.
    expect(runs).toContain(
      '<a class="chart-action" href="./searches-preview.html#keep-watch">Keep watch<span class="sr-only">, its schedule in Searches</span></a>',
    );
    expect(
      [
        'runs.left',
        'runs.all',
        'runs.free',
        'runs.bought',
        'runs.used',
        'runs.byYou',
        'runs.byDeputy',
      ].map((key) => store.metricText(key)),
    ).toEqual(['4', '10', '10', '0', '6', '2', '4']);
    // The rings side by side, then the runway (the shared allowanceRings and runwayLine). On a
    // phone the runway line comes first as the one-line balance and the rings fold under it, so
    // the quick buy is in reach (the testers' phone pass).
    expect(elementById(main, 'nightly')).toMatch(
      /<details class="shop-rings" id="shop-rings" open>\s*<summary class="shop-fold-toggle shop-rings-toggle">Your runs and tokens in detail<\/summary>\s*<div class="shop-balances">\s*<div\s+class="allowance is-ring[\s\S]*?<div\s+class="shop-tokens"\s+id="shop-tokens"[\s\S]*?<\/div>\s*<\/div>\s*<\/details>\s*<div class="shop-runway" id="shop-runway" data-skeleton="lines"><\/div>/,
    );
    expect(shop).toMatch(
      /@media \(max-width: 720px\) \{\s*#nightly > \.shop-head \{\s*order: -2;\s*\}\s*#nightly > \.shop-runway \{\s*order: -1;/,
    );
    expect(script).toContain('rings.open = !phone.matches;');
    expect(script).toContain('if (!event.matches) rings.open = true;');
    expect(script).toContain(
      "components.allowanceRings(tokensHost, { kinds: ['tokens'], size: 'large', metrics: true });",
    );
    expect(script).toContain('components.runwayLine(runwayHost, { uses: true });');
    // Regular size (120px): a panel, not a tile; sized through the shared allowance.set.
    expect(runs).toContain('<div class="allowance-ring">');
    expect(runs).not.toContain('is-compact');
    expect(script).toContain('set(meter, { ...parts, state, kind });');
    expect(script).toContain("sizeMeter(runsMeter, view.parts, view.state, 'watch');");
    expect(script).toContain("setText($('#shop-runs-key-left'), view.leftWords);");
    // The split keeps its line, unseen, until anything is bought, so nothing under it moves.
    expect(script).toContain("$('#shop-runs-split').classList.toggle('is-empty', !view.split);");
    expect(shop).toMatch(/\.shop-runs-split\.is-empty \{\s*visibility: hidden;\s*\}/);
    // The store's runway for the usual sample: 3 runs a day, through Sat, Oct 3.
    expect(store.metricText('runs.perDay')).toBe('3');
    expect(store.metricText('runs.lastsThrough')).toBe('Sat, Oct 3');
  });

  it('shows the AI credits balance in one line under their packs, with the model’s link (P-3, P-10)', () => {
    const line = elementById(main, 'shop-credits-line');
    expect(line).toMatch(/^<p class="shop-balance" id="shop-credits-line" hidden>/);
    expect(textOf(line).replace(/\s+([.,])/g, '$1')).toBe(
      '339,100 tokens left on Ministral 3 14B, worth $0.07. Change model',
    );
    for (const key of ['ai.credits.left', 'ai.model.name', 'ai.credits.value']) {
      expect(line, key).toContain(`data-metric="${key}"`);
    }
    // The model is chosen in AI & credits (its one home); Purchases names it and links there.
    expect(line).toContain(
      '<a class="chart-action" href="./ai-preview.html#model">Change model</a>',
    );
    expect(main).not.toMatch(/name="shop-model"|shop-model-choices|<details class="shop-more"/);
    expect(script).not.toContain("call('setPlatformModel'");
    // It shows with the AI credits kind, after its packs.
    const chooser = elementById(main, 'shop-chooser');
    expect(chooser.indexOf('id="shop-packs-credits"')).toBeLessThan(
      chooser.indexOf('id="shop-credits-line"'),
    );
    expect(script).toContain("creditsLine.hidden = chosen.kind !== 'credits';");
  });

  it('says what a friend earns you both in one line, with Invite friends (P-24)', () => {
    const line = elementById(main, 'shop-bonus-line');
    expect(textOf(line).replace(/\s+([;.])/g, '$1')).toBe(
      'A friend’s first search earns you both 100,000 tokens; Jordan’s search earned you 100,000 so far.',
    );
    expect(line).toContain(
      '<span data-shop-earned>; <span data-shop-who>Jordan’s search</span> earned you <span data-metric="referrals.bonus">100,000</span> so far</span>',
    );
    expect(store.metricText('referrals.bonus')).toBe('100,000');
    // No credits ring shows it any more, so the earned clause shows whenever a friend earned it.
    expect(script).toContain("$('[data-shop-earned]', bonusLine).hidden = !view.who;");
    expect(elementById(main, 'bonus')).toContain(
      '<a class="secondary-action" href="./invite-preview.html">Invite friends</a>',
    );
  });

  it('keeps the figures round 5 retired off the page', () => {
    const keys = figuresOf(main).map(([key]) => key);
    for (const key of keys) expect(store.metricText(key), key).not.toBe('');
    expect(
      keys.filter((key) =>
        /^(?:ai\.platform\.|ai\.bonus$|ai\.topups$|shop\.added\.|referrals\.bonusRuns$)/.test(key),
      ),
    ).toEqual([]);
  });
});

describe('Shop one quick buy (round 7, SE3)', () => {
  it('chooses a kind, then a pack, with one recommended pick and one Buy', () => {
    const chooser = elementById(main, 'shop-chooser');
    expect(chooser).toMatch(
      /^<div\s+class="shop-chooser"\s+id="shop-chooser"\s+data-skeleton="block"/,
    );
    // The kind: a native radio group in the shared segmented style.
    expect(elementById(main, 'shop-kinds')).toMatch(
      /^<fieldset class="segmented shop-kinds" id="shop-kinds">\s*<legend class="sr-only">What to buy<\/legend>/,
    );
    expect(
      [
        ...elementById(main, 'shop-kinds').matchAll(
          /<span class="segmented-label"[^>]*>([^<]+)<\/span>/g,
        ),
      ].map((match) => match[1]),
    ).toEqual(['Runs', 'AI credits', 'Bundles']);
    // One primary action on the page: the one Buy, named for the chosen pack, opening the
    // existing checkout (JobDeputyPanels.checkout on [data-checkout]).
    expect(main.match(/class="primary-action"/g)).toHaveLength(1);
    expect(chooser).toContain(
      '<button class="primary-action" id="shop-buy" type="button" data-checkout="nightly-120" aria-describedby="shop-buy-note">Buy 120 runs for $9.00</button>',
    );
    expect(script).toContain(
      "if (buyButton.getAttribute('data-checkout') !== row.id) buyButton.setAttribute('data-checkout', row.id);",
    );
    expect(script).toContain('setText(buyButton, rules.buyWords(row));');
    expect(script).not.toMatch(/call\('buy'|store\.buy\(/);
    expect(main).not.toContain('data-topup-open=');
    // A pack is a choice card: its radio, its figure, what it adds, Recommended and why, its price.
    expect(script).toContain("card.className = 'choice-card shop-pick';");
    expect(script).toContain('input.name = `shop-pick-$' + '{kind}`;');
    expect(script).toContain('const isPick = recommended?.id === row.id;');
    expect(rules.buyWords({ action: '120 runs for $9.00' })).toBe('Buy 120 runs for $9.00');
    expect(rules.buyWords(null)).toBe('Buy');
    expect(plain(rules.KIND_LABELS)).toEqual({
      nightly: 'Runs',
      credits: 'AI credits',
      bundles: 'Bundles',
    });
  });

  it('recommends the smallest run pack that keeps everything running, from the store (SE3)', () => {
    const items = store.shopItems();
    const runs = store.allowance().runs;
    // The store says what each pack would last through at your settings (3 runs a day on the
    // usual sample): 30 through Tue, Oct 13, 60 through Fri, Oct 23, 120 past the month.
    expect(
      items.nightly.map((item) => [item.id, (item.runway as Record<string, unknown>)?.coversMonth]),
    ).toEqual([
      ['nightly-30', false],
      ['nightly-60', false],
      ['nightly-120', true],
    ]);
    expect(
      ['nightly-30', 'nightly-60', 'nightly-120'].map((id) =>
        store.metricText(`runs.ifBuy.${id}.lastsThrough`),
      ),
    ).toEqual(['Tue, Oct 13', 'Fri, Oct 23', 'Sun, Nov 15']);
    expect(plain(rules.recommend(items, runs))).toEqual({
      kind: 'nightly',
      id: 'nightly-120',
      reason: 'Keeps everything you turned on running through the month',
    });
    // None lasts the month: the most runs, and the card's own date says how far (never twice).
    const short = {
      nightly: [
        { id: 'nightly-30', runs: 30, runway: { lastsThrough: '2026-10-06', coversMonth: false } },
        {
          id: 'nightly-120',
          runs: 120,
          runway: { lastsThrough: '2026-10-09', coversMonth: false },
        },
      ],
    };
    expect(plain(rules.recommend(short, runs))).toEqual({
      kind: 'nightly',
      id: 'nightly-120',
      reason: 'The most runs in one pack; none lasts the month at your settings',
    });
    // Before the store gives each pack its runway: the smallest that covers what the month
    // needs (runs.neededForMonth, with its key), else the largest, else the smallest.
    const bare = { nightly: items.nightly.map(({ runway, ...item }) => item) };
    expect(plain(rules.recommend(bare, runs))).toEqual({
      kind: 'nightly',
      id: 'nightly-120',
      reason: 'Covers the 83 more runs this month needs at your settings',
      // The figure goes in with its key (R3-4).
      parts: [
        'Covers the ',
        ['runs.neededForMonth', '83'],
        ' more runs this month needs at your settings',
      ],
      neededMetric: 'runs.neededForMonth',
    });
    expect(rules.recommend(bare, { neededForMonth: 40 })?.id).toBe('nightly-60');
    expect(rules.recommend(bare, { neededForMonth: 30 })?.id).toBe('nightly-30');
    expect(rules.recommend(bare, { neededForMonth: 500 })).toMatchObject({
      id: 'nightly-120',
      reason: 'The most runs in one pack, toward the 500 more this month needs',
    });
    expect(rules.recommend(bare, { neededForMonth: 0 })).toMatchObject({
      id: 'nightly-30',
      reason: 'Your runs last the month; this is the smallest pack',
    });
    expect(rules.recommend(undefined, runs)).toBeNull();
    // The chooser keeps each kind's pack while you switch, and starts on the pick.
    expect(script).toContain(
      'chosen.picks[kind] = recommended?.kind === kind && ids.includes(recommended.id) ? recommended.id : ids[0];',
    );
    expect(script).toContain("if (!chosen.kind) chosen.kind = recommended?.kind ?? 'nightly';");
  });
});

describe('Shop receipts (round 7, SE3)', () => {
  it('lists every payment with the shared filter bar, totals, pagination, and View (R10-6, R10-7)', () => {
    const receipts = elementById(main, 'receipts');
    expect(receipts).toContain('<h2 id="shop-receipts-title" tabindex="-1">Every payment.</h2>');
    // The usual sample has none, and says so calmly.
    expect(textOf(elementById(main, 'shop-receipts-empty'))).toBe(
      'No payments yet. When you buy runs or AI credits, each receipt is kept here, ready to download.',
    );
    for (const id of [
      'shop-receipts-filters',
      'shop-receipts-totals',
      'shop-receipts-pager-top',
      'shop-receipts-list',
      'shop-receipts-pager',
    ]) {
      expect(receipts, id).toContain(`id="${id}"`);
    }
    const parts = [
      'receiptBar = components.filterBar(receiptsFilters, {',
      // T4-13: the search says what it finds.
      "search: { label: 'Search receipts', param: 'rq', placeholder: 'For example: JD-2026-0004 or credits' },",
      "{ name: 'kind', label: 'Kind', kind: 'multi', param: 'kind', singular: 'kind', plural: 'kinds', options: rules.facetOptions(all.facets?.kind) },",
      "range: { param: 'rrange', value: 'all', presets: ['1w', '30d', 'month', '90d', 'year', 'all'] },",
      "receiptPager = components.pagination($('#shop-receipts-pager'), {",
      "top: $('#shop-receipts-pager-top'),",
      'sizes: [...rules.RECEIPT_SIZES],',
      'address: true,',
      "const result = any ? call('receipts', rules.receiptQuery(receiptBar?.state ?? {}, receiptPlace)) : null;",
      // T3-15: the filter's totals add up the rows themselves.
      'setText(receiptsTotals, `For these filters: $' +
        '{rules.totalsLine(rules.totalsOf(every?.rows), { money })}`);',
      // T3-7: a new page size starts at the first page, in the address too.
      "addressPage('rpage', 1);",
      // T2-17: compact rows on a phone beside the table.
      'receiptsList.replaceChildren(...(rows.length ? [receiptTable(rows), receiptRows(rows)] : []));',
      // T3-19: the bar's counts and the pager change only when they do.
      'if (countsKey !== receiptCountsKey) {',
      'if (pagerKey !== receiptPagerKey) {',
      "const receipt = call('receipt', id);",
      'components.preview.open(',
    ];
    for (const part of parts) expect(script, part).toContain(part);
    // ?receipt=<id> opens that receipt once the page is drawn.
    expect(script).toContain(
      "const asked = new URLSearchParams(window.location.search).get('receipt');",
    );
  });

  it('turns receipts() into rows, totals, a query, and a printable copy', () => {
    const row = rules.receiptRow(
      {
        id: 'receipt-purchase-1',
        number: 'JD-2026-0001',
        at: '2026-09-21T10:00:00-07:00',
        kind: 'bundle',
        kindLabel: 'Bundle',
        item: 'Season bundle: $20.00 of AI credits and 120 runs',
        amountText: '$26.75',
        taxText: '$2.74',
        totalText: '$29.49',
        method: 'Visa ending 4242',
        status: 'refunded',
        statusLabel: 'Refunded',
      },
      { when: store.format.dateTime },
    );
    expect(plain(row)).toEqual({
      id: 'receipt-purchase-1',
      number: 'JD-2026-0001',
      when: 'Mon, Sep 21, 10:00',
      at: '2026-09-21T10:00:00-07:00',
      kind: 'bundle',
      kindLabel: 'Bundle',
      item: 'Season bundle: $20.00 of AI credits and 120 runs',
      amount: '$26.75',
      tax: '$2.74',
      total: '$29.49',
      method: 'Visa ending 4242',
      status: 'refunded',
      statusLabel: 'Refunded',
    });
    expect(rules.receiptRow({ status: 'odd' }).status).toBe('paid');
    const money = (micros: unknown) => `$${(Number(micros) / 1e6).toFixed(2)}`;
    // T3-15: totals from the rows, each rounded to the cent as its table shows it; what was paid
    // with the tax inside it, and what was refunded (its tax refunded too).
    const totals = rules.totalsOf([
      { id: 'a', status: 'paid', total: 5_512_500, tax: 512_500 },
      { id: 'b', status: 'paid', total: 5_512_500, tax: 512_500 },
      { id: 'c', status: 'refunded', total: 11_025_000, tax: 1_025_000 },
      null,
    ]);
    expect(plain(totals)).toEqual({
      count: 3,
      paid: 11_020_000,
      paidTax: 1_020_000,
      refunded: 11_030_000,
      refunds: 1,
    });
    expect(rules.totalsLine(totals, { money })).toBe(
      '3 payments · $11.02 paid, including $1.02 tax · $11.03 refunded.',
    );
    expect(
      rules.totalsLine(
        rules.totalsOf([{ id: 'c', status: 'refunded', total: 11_025_000, tax: 1_025_000 }]),
        { money },
      ),
    ).toBe('1 payment · $11.03 refunded.');
    expect(rules.totalsLine({ count: 0 })).toBe('');
    expect(
      plain(
        rules.receiptQuery(
          { q: ' visa ', kind: ['runs'], status: 'paid', range: { preset: '30d' } },
          { page: 2, size: 24 },
        ),
      ),
    ).toEqual({ page: 2, size: 24, q: 'visa', kind: ['runs'], range: '30d', status: 'paid' });
    // Every payment is the default: All time asks the store for no time filter.
    expect(plain(rules.receiptQuery({ range: 'all' }))).toEqual({ page: 1, size: 12 });
    expect(plain(rules.receiptQuery({ range: { preset: 'all' }, q: 'visa' }))).toEqual({
      page: 1,
      size: 12,
      q: 'visa',
    });
    expect(
      plain(rules.receiptQuery({ status: 'all', range: { preset: 'custom', from: 'a', to: 'b' } })),
    ).toEqual({
      page: 1,
      size: 12,
      from: 'a',
      to: 'b',
    });
    expect(plain(rules.facetOptions([{ id: 'runs', label: 'Runs', count: 3 }, null]))).toEqual([
      { value: 'runs', label: 'Runs', count: 3 },
    ]);
    const copy = rules.receiptMarkdown(
      {
        id: 'r1',
        number: 'JD-2026-0001',
        at: '2026-09-21T10:00:00-07:00',
        seller: { name: 'JobDeputy' },
        buyer: { name: 'Alex Morgan', email: 'alex.morgan@example.com' },
        lines: [{ label: '120 runs', quantity: 1, amount: 9_000_000 }],
        subtotal: 9_000_000,
        tax: 922_500,
        taxRatePct: 10.25,
        total: 9_922_500,
        paidWith: 'Visa ending 4242',
        status: 'paid',
        notes: ['Sample receipt: nothing was charged.', 'Prices are samples.'],
      },
      { when: store.format.dateTime, money },
    );
    expect(copy.split('\n')).toEqual([
      '# Receipt JD-2026-0001',
      '',
      'JobDeputy · Mon, Sep 21, 10:00',
      '',
      'Billed to Alex Morgan, alex.morgan@example.com',
      '',
      '## What you bought',
      '',
      '- 120 runs: $9.00',
      '',
      // T1-15: a line each (Markdown joins lines that touch into one paragraph).
      'Subtotal: $9.00',
      '',
      'Tax (10.25%): $0.92',
      '',
      'Total: $9.92',
      '',
      'Paid with Visa ending 4242. Paid.',
      '',
      'Sample receipt: nothing was charged.',
      '',
      'Prices are samples.',
    ]);
    // T6-10: a refund says its status once, with its day.
    const refundedCopy = rules.receiptMarkdown(
      {
        id: 'r2',
        number: 'JD-2026-0007',
        at: '2026-09-15T08:00:00-07:00',
        status: 'refunded',
        refundedAt: '2026-09-16T10:00:00-07:00',
        paidWith: 'Visa ending 4242',
        total: 5_512_500,
      },
      { when: (at: unknown) => `${store.format.date(at)}, ${String(at).slice(0, 4)}`, money },
    );
    expect(refundedCopy).toContain('Paid with Visa ending 4242. Refunded Wed, Sep 16, 2026.');
    expect(refundedCopy).not.toMatch(/Refunded, refunded/);
    expect(rules.receiptMarkdown(null)).toBe('');
  });
});

describe('Shop tour', () => {
  const steps = [
    ...main.matchAll(
      /\sdata-tour-step="(\d+)"\s+data-tour-title="([^"]+)"\s+data-tour-text="([^"]+)"/g,
    ),
  ].map((match): [number, string, string] => [Number(match[1]), match[2] ?? '', match[3] ?? '']);

  it('explains the runs, the tokens, the quick buy, the prices, receipts, the bonus, and support', () => {
    // Round 6 (R6-2): the deputy gives the tour, so each title is his speech line (six words at
    // most) and each body says, in his first person, what he does and what you can do. Round 7
    // (SE3): the balances lead, then the one chooser, the fold, and every receipt.
    expect(steps.map(([number, title]) => [number, title])).toEqual([
      [1, 'These are your runs.'],
      [2, 'These are your tokens.'],
      [3, 'I picked what you need.'],
      [4, 'Here is how prices are made.'],
      [5, 'I keep every receipt.'],
      [6, 'Friends earn us both credits.'],
      [7, 'Help us when donations open.'],
    ]);
    for (const [, title, text] of steps) {
      expect(words(text)).toBeLessThanOrEqual(34);
      expect(words(title), title).toBeLessThanOrEqual(6);
      expect(`${title} ${text}`, title).toMatch(/\b(?:I|I’ll|my|me|us)\b/);
      expect(`${title} ${text}`, title).not.toMatch(/\bnightly runs?\b/i);
    }
    const targets = [...main.matchAll(/\sid="([\w-]+)"[^>]*?\sdata-tour-step="(\d+)"/g)].map(
      (match) => match[1],
    );
    expect(targets).toEqual([
      'shop-meter-runs',
      'shop-tokens',
      'shop-chooser',
      'prices',
      'shop-bonus-step',
      'shop-support-form',
    ]);
    // Receipts' step is on its head (no id of its own).
    expect(elementById(main, 'receipts')).toMatch(/<div\s+class="shop-head"\s+data-tour-step="5"/);
    // The ring colours are named in the palette's words, never by colour alone (R3-5, D1).
    expect(steps[0]?.[2]).toContain(
      'Hatched grey is used and indigo is left, free runs and any you bought',
    );
    expect(steps[5]?.[2]).toContain('up to 5 friends a year');
    // The page keeps them in step with the store and the palette.
    expect(steps[0]?.[2]).toBe(rules.runsTour());
    expect(steps[5]?.[2]).toBe(rules.bonusTour(store.get().referrals.capFriends));
    // The tour starts only when asked (R3-6): the page never calls start itself.
    expect(script).not.toMatch(/tour\.start|maybeStart/);
  });
});

describe('Shop rules', () => {
  it('reads the names and the palette’s words from their owners, with fallbacks', () => {
    // Round 6, part 2 (N3): the store's TERMS gained run and runs; the page keeps the names it
    // knows, each as the store holds it.
    const known = Object.fromEntries(
      Object.keys(rules.TERMS).map((key) => [key, (store.TERMS as Record<string, string>)[key]]),
    );
    expect(plain(rules.termsFrom(store.TERMS))).toEqual(plain(known));
    expect(plain(rules.termsFrom(undefined))).toEqual(plain(rules.TERMS));
    expect(rules.termsFrom({ assist: ' ', other: 'x' }).assist).toBe('Deputy Assist');
    const palette = {
      parts: { used: 'hatched grey', left: 'green', bonus: 'gold', bought: 'wine' },
      left: { watch: 'indigo', assist: 'teal', none: 'green' },
    };
    expect(plain(rules.wordsFrom(palette))).toEqual({
      used: 'hatched grey',
      bonus: 'gold',
      bought: 'wine',
      watch: 'indigo',
      assist: 'teal',
    });
    expect(plain(rules.wordsFrom(undefined))).toEqual(plain(rules.WORDS));
    // The page's fallback words are A2's (app-components.js).
    const components = sourceFor('app-components.js');
    expect(components).toContain(
      "parts: Object.freeze({ used: 'hatched grey', left: 'green', bonus: 'gold', bought: 'wine' }),",
    );
    expect(components).toContain(
      "left: Object.freeze({ watch: 'indigo', assist: 'teal', none: 'green' }),",
    );
  });

  it('says the AI credits balance’s state, and what happens once they ran out (P-3)', () => {
    expect(plain(rules.creditsLine(store.credits(), store.aiChoice()))).toEqual({
      model: 'Ministral 3 14B',
      paused: '',
      state: 'ok',
    });
    expect(rules.creditsLine({ state: 'out' }, { source: 'platform' }).state).toBe('reached');
    expect(rules.creditsLine({ state: 'near' }, {}).state).toBe('attention');
    // Out of credits while they run your AI: the store's own words say what happens now.
    expect(
      rules.creditsLine(
        { state: 'out' },
        {
          source: 'platform',
          limited: 'credits',
          summary: 'Deputy Assist is paused until you buy credits',
        },
      ).paused,
    ).toBe('Deputy Assist is paused until you buy credits.');
    // On your own key the credits wait as the platform's, so nothing is paused here.
    expect(
      rules.creditsLine({ state: 'out' }, { source: 'openai', limited: 'limit', summary: 'x' })
        .paused,
    ).toBe('');
  });

  it('fills the runs ring from allowance().runs, every run left of free plus bought (N3, R9-1, R10-9)', () => {
    // Round 7 (R10-9): every search, Keep watch check, Gmail scan, and daily email uses one run,
    // so October's two Gmail scans make 6 of 10 used.
    expect(plain(rules.runsView(store.allowance().runs, { day: store.format.date }))).toEqual({
      parts: { used: 6, left: 4, limit: 10 },
      state: 'attention',
      lasts: true,
      out: '',
      split: '',
      leftWords: '4 left',
      tips: {
        used: [
          '6 used',
          'Runs used this month: your searches, Keep watch, Gmail’s scans, and the daily email.',
        ],
        left: [
          '4 of 10 left',
          'Runs left this month, free ones and any you bought; the free 10 return on Sun, Nov 1.',
        ],
      },
    });
    // allowance().nightly is the same allowance (A2's alias).
    expect(plain(rules.runsView(store.allowance().nightly))).toEqual(
      plain(rules.runsView(store.allowance().runs)),
    );
    const local = loadStore();
    sign(local);
    local.buy('nightly-30');
    // 30 more still end before the month does: attention stays, and the centre counts them in.
    expect(plain(rules.runsView(local.allowance().runs, { day: store.format.date }))).toMatchObject(
      {
        parts: { used: 6, left: 34, limit: 40 },
        state: 'attention',
        split: '10 free + 30 bought',
        leftWords: '34 left',
        tips: {
          left: [
            '34 of 40 left',
            'Runs left this month: 4 free and 30 bought. The free 10 return on Sun, Nov 1; bought runs stay.',
          ],
        },
      },
    );
    local.buy('nightly-120');
    expect(rules.runsView(local.allowance().runs)).toMatchObject({
      parts: { left: 154, limit: 160 },
      split: '10 free + 150 bought',
      state: 'ok',
    });
    // None left: reached, and the line says what to do in place of Lasts through.
    const none = rules.runsView(
      { used: 10, freeLeft: 0, left: 0, limit: 10, refreshesOn: '2026-11-01' },
      { day: store.format.date },
    );
    expect(none).toMatchObject({ state: 'reached', lasts: false });
    expect(none.out).toBe('No runs are left this month. Buy runs below, or wait for Sun, Nov 1.');
    expect(rules.runsView(undefined)).toMatchObject({ lasts: false, state: 'reached' });
    // Who used them, from the store's figures: you and your deputy once the store counts it.
    expect(plain(rules.whoLine({ byYou: 2, byDeputy: 4, byKeepWatch: 2 }))).toEqual([
      ['byYou', 'runs.byYou'],
      ' started by you, ',
      ['byDeputy', 'runs.byDeputy'],
      ' by your deputy',
    ]);
    expect(plain(rules.whoLine({ byYou: 2, byKeepWatch: 2 }))).toEqual([
      ['byYou', 'runs.byYou'],
      ' started by you, ',
      ['byKeepWatch', 'runs.byKeepWatch'],
      ' by Keep watch',
    ]);
  });

  it('works out the friend bonus from the store, as tokens on your model, and whose searches earned it', () => {
    const credits = store.credits();
    const freeTokens = Number(store.CREDITS.freeTokens);
    expect(freeTokens).toBe(250000);
    expect(plain(rules.bonusView(store.get().referrals, credits, { tokens, freeTokens }))).toEqual({
      reward: '100,000',
      who: 'Jordan’s search',
    });
    // On another model the same value is fewer tokens, as Invite says it (W11).
    const local = loadStore();
    local.setPlatformModel('deepseek-v3-2');
    expect(
      rules.bonusView(local.get().referrals, local.credits(), {
        tokens: local.format.tokens,
        freeTokens,
      }).reward,
    ).toBe(local.metricText('referrals.bonus'));
    // Before any friend is rewarded: the reward in proportion to your free credits on the model.
    const none = { rewardTokens: 100000, invites: [{ name: 'Sam Rivera', status: 'joined' }] };
    expect(
      plain(
        rules.bonusView(
          none,
          { bonus: { friends: 0, earned: 0 }, free: { tokens: 66989 } },
          {
            freeTokens,
          },
        ),
      ),
    ).toEqual({ reward: '26,795', who: '' });
    expect(rules.bonusView({ rewardTokens: 100000 }, undefined).reward).toBe('100,000');
    // Two named friends, then more, then one without a name.
    const invite = (name: string | null) => ({ name, status: 'rewarded' });
    expect(rules.bonusView({ invites: [invite('Jordan Lee'), invite('Sam Rivera')] }, {}).who).toBe(
      'Jordan’s and Sam’s searches',
    );
    expect(rules.bonusView({ invites: [invite('A B'), invite('C D'), invite(null)] }, {}).who).toBe(
      '3 friends’ searches',
    );
    expect(rules.bonusView({ invites: [invite(null)] }, {}).who).toBe('A friend’s search');
    expect(rules.bonusView(undefined, undefined)).toEqual({ reward: '', who: '' });
  });

  it('names the runs ring’s colours in its tour as the palette does (D1, R3-5)', () => {
    // Round 7 (R10-9): every use is a run, so the tour names them all.
    expect(rules.runsTour()).toBe(
      'I use one run for every search, Keep watch check, Gmail scan, and daily email. Hatched grey is used and indigo is left, free runs and any you bought.',
    );
    expect(rules.bonusTour(5)).toBe(
      'Each friend’s first search earns you both bonus AI credits, up to 5 friends a year. I use them after your free credits.',
    );
    expect(rules.bonusTour(undefined)).not.toContain('up to');
    expect(words(rules.runsTour())).toBeLessThanOrEqual(34);
    // The platform model in use, for How prices are made.
    expect(rules.chosenModel(store.models())?.id).toBe('ministral-3-14b');
    const local = loadStore();
    local.setPlatformModel('deepseek-v3-2');
    expect(rules.chosenModel(local.models())?.name).toBe('DeepSeek V3.2');
    expect(rules.chosenModel([])).toBeNull();
  });

  it('turns shopItems() into packs: tokens and price, runs, bundles with list price and saving', () => {
    const items = store.shopItems();
    expect(plain(rules.itemRows('credits', items))).toEqual([
      {
        id: 'credits-5',
        price: '$5.00',
        meta: '',
        was: '',
        save: '',
        lasts: null,
        figure: '22.7 million',
        unit: 'tokens',
        action: '22.7 million tokens for $5.00',
      },
      {
        id: 'credits-10',
        price: '$10.00',
        meta: '',
        was: '',
        save: '',
        lasts: null,
        figure: '45.5 million',
        unit: 'tokens',
        action: '45.5 million tokens for $10.00',
      },
      {
        id: 'credits-20',
        price: '$20.00',
        meta: '',
        was: '',
        save: '',
        lasts: null,
        figure: '90.9 million',
        unit: 'tokens',
        action: '90.9 million tokens for $20.00',
      },
    ]);
    // Round 7 (R10-9): round 6's "more nights" counted Keep watch only; each pack says what it
    // would last through at your settings, the store's date with its key.
    expect(
      rules
        .itemRows('nightly', items, { day: store.format.date })
        .map((row) => [row.figure, row.unit, row.meta, row.price, row.lasts?.text]),
    ).toEqual([
      ['30', 'runs', '', '$3.00', 'Lasts through Tue, Oct 13 at your settings'],
      ['60', 'runs', '', '$5.00', 'Lasts through Fri, Oct 23 at your settings'],
      ['120', 'runs', '', '$9.00', 'Lasts through Sun, Nov 15 at your settings'],
    ]);
    expect(
      plain(rules.itemRows('nightly', items, { day: store.format.date })[0]?.lasts?.parts),
    ).toEqual([
      'Lasts through ',
      ['runs.ifBuy.nightly-30.lastsThrough', 'Tue, Oct 13'],
      ' at your settings',
    ]);
    // A bundle's runs last the same as its run pack's; credit packs on your own key, no date.
    expect(
      rules.itemRows('bundles', items, { day: store.format.date }).map((row) => row.lasts?.text),
    ).toEqual([
      'Lasts through Tue, Oct 13 at your settings',
      'Lasts through Fri, Oct 23 at your settings',
      'Lasts through Sun, Nov 15 at your settings',
    ]);
    expect(rules.itemRows('credits', items).map((row) => row.lasts)).toEqual([null, null, null]);
    // T1-7: a pack that runs short today has no day it lasts through; it says the store's words
    // for it with their key, and drops the line only when the store says nothing.
    const short = (runway: unknown) =>
      plain(
        rules.itemRows('nightly', {
          nightly: [{ id: 'nightly-30', runs: 30, priceText: '$3.00', runway }],
        })[0]?.lasts,
      );
    expect(
      short({
        left: 30,
        lastsThrough: null,
        lastsText: 'Runs short on Sat, Oct 3 at 08:00',
        metric: 'runs.ifBuy.nightly-30.lastsThrough',
      }),
    ).toEqual({
      text: 'Runs short on Sat, Oct 3 at 08:00',
      parts: [['runs.ifBuy.nightly-30.lastsText', 'Runs short on Sat, Oct 3 at 08:00']],
    });
    expect(short({ left: 30, lastsThrough: null })).toBeNull();
    expect(short(null)).toBeNull();
    expect(
      rules
        .itemRows('bundles', items)
        .map((row) => [row.figure, row.unit, row.meta, row.was, row.price, row.save, row.action]),
    ).toEqual([
      [
        'Starter',
        '',
        '$5.00 credits + 30 runs',
        '$8.00',
        '$7.25',
        'Save $0.75',
        'the Starter bundle for $7.25',
      ],
      [
        'Month',
        '',
        '$10.00 credits + 60 runs',
        '$15.00',
        '$13.75',
        'Save $1.25',
        'the Month bundle for $13.75',
      ],
      [
        'Season',
        '',
        '$20.00 credits + 120 runs',
        '$29.00',
        '$26.75',
        'Save $2.25',
        'the Season bundle for $26.75',
      ],
    ]);
    // Every price is the store's own text; a credit pack's tokens follow the platform model (W11).
    for (const kind of rules.KINDS) {
      const list = items[kind as 'credits' | 'nightly' | 'bundles'];
      expect(rules.itemRows(kind, items).map((row) => row.price)).toEqual(
        list.map((item) => item.priceText),
      );
    }
    const local = loadStore();
    local.setPlatformModel('deepseek-v3-2');
    expect(rules.itemRows('credits', local.shopItems()).map((row) => row.action)).toEqual([
      '6.1 million tokens for $5.00',
      '12.2 million tokens for $10.00',
      '24.4 million tokens for $20.00',
    ]);
    expect(rules.itemRows('nightly', undefined)).toEqual([]);
    expect(rules.itemRows('credits', { credits: [{ priceText: '$1.00' }, null] })).toEqual([]);
  });

  it('says the bundle discount is on the runs only, and when the offer ends (G4, N3)', () => {
    expect(rules.bundleRule(store.BUNDLE_OFFER)).toBe(
      '25% off the runs only; AI credits always cost AWS’s rate plus our margin.',
    );
    expect(rules.bundleRule(undefined)).toBe(
      'The discount is on the runs only; AI credits always cost AWS’s rate plus our margin.',
    );
    expect(rules.offerEnds(store.BUNDLE_OFFER, { day: store.format.date })).toBe(
      'Offer ends Sat, Oct 31',
    );
    expect(rules.offerEnds({})).toBe('');
  });

  it('shows how prices are made for the model in use, from models() and PRICING (P-10)', () => {
    expect(plain(rules.howView(store.models(), store.PRICING))).toEqual({
      id: 'ministral-3-14b',
      name: 'Ministral 3 14B',
      awsInKey: 'ai.price.ministral-3-14b.awsIn',
      awsOutKey: 'ai.price.ministral-3-14b.awsOut',
      region: 'US East (N. Virginia)',
      tax: 'Tax is added at checkout, based on your billing address.',
      source: 'Amazon Bedrock on-demand pricing, Standard tier',
      sourceUrl: 'https://aws.amazon.com/bedrock/pricing/',
      // Round 6 part 2 (P-10): the worked example, moved here from AI & credits.
      example: {
        tokensKey: 'ai.search.tokens',
        costKey: 'ai.price.ministral-3-14b.search',
        tokens: 11000,
        cost: '$0.0024',
      },
    });
    expect([
      store.metricText('ai.search.tokens'),
      store.metricText('ai.price.ministral-3-14b.search'),
    ]).toEqual(['11,000', '$0.0024']);
    const local = loadStore();
    local.setPlatformModel('deepseek-v3-2');
    const how = rules.howView(local.models(), local.PRICING);
    expect([how?.awsInKey, how?.awsOutKey].map((key) => local.metricText(String(key)))).toEqual([
      '$0.62',
      '$1.85',
    ]);
    // Only an https source link is kept.
    expect(rules.howView(store.models(), { sourceUrl: 'javascript:alert(1)' })?.sourceUrl).toBe('');
    expect(rules.howView([], store.PRICING)).toBeNull();
  });

  it('records support as interest only, with the planned benefits and your listing (G5, W13)', () => {
    const local = loadStore();
    const seed = rules.supportView(local.support());
    expect(plain(seed)).toMatchObject({
      pledged: false,
      cadence: null,
      title: '',
      message: '',
      listing: { optIn: false, display: 'initial', status: 'Not on the list.' },
      note: 'JobDeputy isn’t a charity, so support isn’t tax deductible, and the benefits are thanks, not a purchase.',
    });
    expect(seed.benefits.map((benefit) => [benefit.title, benefit.planned])).toEqual([
      ['The supporters list', true],
      ['A quarterly Q&A', true],
      ['Early access', true],
      ['A vote on what we build', true],
    ]);
    // The page lists the same four in its markup until the store's words replace them.
    expect(
      [...elementById(main, 'shop-benefits').matchAll(/<li>([^<]+)<\/li>/g)].map((match) =>
        (match[1] ?? '').replace('&amp;', '&'),
      ),
    ).toEqual(seed.benefits.map((benefit) => benefit.title));
    // Joining the list needs your interest recorded first.
    expect(local.setSupporterListing({ optIn: true })).toBeNull();
    local.pledgeSupport('monthly');
    expect(plain(rules.supportView(local.support(), { when: local.format.date }))).toMatchObject({
      pledged: true,
      cadence: 'monthly',
      title: 'You’re counted in, monthly.',
      message: 'We’ll tell you when donations open. Recorded Fri, Oct 2.',
    });
    local.setSupporterListing({ display: 'initial', optIn: true });
    // "Alex M." ends its sentence once.
    expect(rules.supportView(local.support()).listing.status).toBe('On the list as Alex M.');
    local.setSupporterListing({ display: 'anonymous' });
    expect(rules.supportView(local.support()).listing.status).toBe(
      'On the list as Anonymous supporter.',
    );
    // Withdrawing takes you off the list; your display choice stays.
    local.withdrawSupport();
    expect(rules.supportView(local.support()).listing).toMatchObject({
      optIn: false,
      display: 'anonymous',
      status: 'Not on the list.',
    });
    // Never an amount: an unknown cadence or a number is not an interest.
    expect(rules.supportView({ pledged: true, cadence: '5' }).pledged).toBe(false);
    expect(local.pledgeSupport('weekly')).toBeNull();
    expect(JSON.stringify(local.support())).not.toMatch(/amount|\$\d/i);
    expect(plain(rules.CADENCES)).toEqual(['once', 'monthly']);
    expect(plain(rules.DISPLAYS)).toEqual(['full', 'initial', 'anonymous']);
    expect([rules.sentence('Alex M.'), rules.sentence('Alex Morgan')]).toEqual([
      'Alex M.',
      'Alex Morgan.',
    ]);
  });
});

describe('Shop actions', () => {
  it('records interest with pledgeSupport and the listing with setSupporterListing, and says so', () => {
    expect(script).toContain("const result = call('pledgeSupport', picked.value);");
    expect(script).toContain("call('withdrawSupport');");
    expect(script).toContain("call('setSupporterListing', { optIn: listingOpt.checked })");
    expect(script).toContain("call('setSupporterListing', { display: input.value })");
    expect(script).toContain(
      "deputy?.react?.('saved', { speech: 'I’ll tell you when they open.' });",
    );
    expect(script).toContain(
      "deputy?.react?.('saved', { speech: 'Withdrawn. Nothing was charged.' });",
    );
    const form = elementById(main, 'shop-support-form');
    expect(form).toContain('<legend class="sr-only">How often</legend>');
    // The group is described by its error only while the error shows (UAT-A-11).
    expect(form).toContain('<fieldset class="segmented" id="shop-cadence">');
    expect(script).toContain(
      "if (on) cadenceGroup.setAttribute('aria-describedby', 'shop-support-error');",
    );
    expect(form).toContain(
      '<p class="feedback-error" id="shop-support-error" hidden>Choose once or monthly.</p>',
    );
    expect(form).toContain(
      '<button class="secondary-action" type="submit" id="shop-support-add">Count me in</button>',
    );
    expect(elementById(main, 'shop-support-done')).toContain(
      '<button class="feedback-panel-action" type="button" id="shop-support-withdraw" aria-describedby="shop-support-done-title">Withdraw</button>',
    );
    // The supporters list shows once you are counted in.
    expect(elementById(main, 'shop-listing')).toMatch(
      /^<fieldset class="shop-listing" id="shop-listing" hidden>/,
    );
    expect(textOf(elementById(main, 'shop-listing'))).toContain('List me as a supporter');
  });

  it('keeps focus on the control that asked, or moves it to what replaced it', () => {
    expect(script).toContain('supportDone.focus();');
    expect(script).toContain(
      '(cadences.find((input) => input.value === before.cadence) ?? cadences[0])?.focus();',
    );
    // A pack or the Buy that is drawn again keeps the focus it had (R9-3).
    expect(script).toContain('focused.focus({ preventScroll: true });');
    expect(script).toContain(
      "const existing = new Map($$('.shop-pick', list).map((card) => [card.dataset.item, card]));",
    );
    // A receipt's View keeps its focus across a redraw.
    expect(script).toContain(
      'const again = key ? [...receiptsList.querySelectorAll(`[data-focus-key="$' +
        '{CSS.escape(key)}"]`)].find((node) => node.getClientRects().length) : null;',
    );
  });

  it('re-renders on every store change, and writes store text as text', () => {
    // T3-19: every store change but a live progress tick, which changes nothing here.
    expect(script).toMatch(
      /store\?\.subscribe\?\.\(\(_state, change\) => \{\s*if \(change\?\.progress\) return;\s*render\(\);/,
    );
    // The one innerHTML write is a fixed template (a pack's card); store values are set as text.
    expect(script.match(/innerHTML/g)).toHaveLength(1);
    expect(script).toContain('cell.textContent = value;');
    expect(script).toContain("setText($('[data-pick-price]', card), row.price);");
  });
});

describe('The buy dialog and checkout (app-panels.js, with the real store)', () => {
  it('lists the store’s packs, tokens on your model with their prices, and follows the model (W10, W11)', () => {
    const local = loadStore();
    // Round 7 (R10-3, T2-6): buying has one home. Elsewhere, Get more runs and Buy credits go to
    // Purchases' quick buy (#buy, or #credits for AI credits) and open no drawer.
    for (const [kind, href] of [
      ['nightly', './shop-preview.html#buy'],
      ['credits', './shop-preview.html#credits'],
    ] as const) {
      const away = loadPanels(local, { search: '?skipLoader' });
      expect(away.api.openTopup(kind), kind).toBeNull();
      expect(away.location.href, kind).toBe(href);
    }
    // On Purchases the same packs open as its own step.
    const { api, topup } = loadPanels(local, { pathname: '/jobdeputy/brand/shop-preview.html' });
    const part = (selector: string) => topup.querySelector(selector);
    api.openTopup('credits');
    expect(part('#topup-drawer-title').textContent).toBe('Buy AI credits');
    expect(part('#topup-drawer-now').textContent).toBe(
      'You have 339,100 tokens of AI credits left on Ministral 3 14B.',
    );
    expect(cardsOf(topup)).toEqual([
      ['credits-5', '22.7 million tokens for $5.00', 'AI credits on Ministral 3 14B'],
      ['credits-10', '45.5 million tokens for $10.00', 'AI credits on Ministral 3 14B'],
      ['credits-20', '90.9 million tokens for $20.00', 'AI credits on Ministral 3 14B'],
    ]);
    expect(part('#topup-drawer-note').textContent).toBe(local.PRICING.note);
    expect(part('#topup-drawer-shop').getAttribute('href')).toBe('./shop-preview.html#credits');
    topup.close();
    local.setPlatformModel('deepseek-v3-2');
    api.openTopup('ai');
    expect(cardsOf(topup).map(([, label, meta]) => [label, meta])).toEqual([
      ['6.1 million tokens for $5.00', 'AI credits on DeepSeek V3.2'],
      ['12.2 million tokens for $10.00', 'AI credits on DeepSeek V3.2'],
      ['24.4 million tokens for $20.00', 'AI credits on DeepSeek V3.2'],
    ]);
    topup.close();
    api.openTopup('nightly');
    // Round 7 (T2-6, T5-2): the runs say what they last through at your settings, as the chooser
    // does, never Keep watch's nights alone.
    expect(part('#topup-drawer-title').textContent).toBe('Buy runs');
    expect(cardsOf(topup)).toEqual([
      ['nightly-30', '30 runs for $3.00', 'Lasts through Tue, Oct 13 at your settings'],
      ['nightly-60', '60 runs for $5.00', 'Lasts through Fri, Oct 23 at your settings'],
      ['nightly-120', '120 runs for $9.00', 'Covers the rest of the month at your settings'],
    ]);
    expect(topup.querySelector('#topup-drawer-packs').innerHTML).not.toMatch(/more nights/);
  });

  it('checks out W12: the agreement first, then credits, a bundle, and nightly runs, each celebrated', () => {
    const local = loadStore();
    // On the Shop: Buy $5 of credits asks for the October agreement, and signing comes back here
    // with the checkout open again on its section (W6).
    const onShop = loadPanels(local, {
      pathname: '/jobdeputy/brand/shop-preview.html',
      search: '?skipLoader',
    });
    const part = (selector: string) => onShop.topup.querySelector(selector);
    onShop.api.checkout('credits-5');
    expect(part('#topup-drawer-eyebrow').textContent).toBe('Checkout');
    expect(part('#topup-drawer-title').textContent).toBe('$5.00 of AI credits');
    expect(rowsOf(onShop.topup)).toEqual([
      ['What it adds', ['22.7 million tokens of AI credits on Ministral 3 14B']],
      ['Price', ['$5.00']],
      ['Tax', ['Added at checkout, based on your billing address.']],
    ]);
    expect(part('#topup-drawer-gate').hidden).toBe(false);
    expect(part('[data-topup-buy]').hidden).toBe(true);
    expect(part('[data-topup-sign]').getAttribute('href')).toBe(
      `./agreement-preview.html?mode=update&return=${encodeURIComponent('shop-preview.html?skipLoader&checkout=credits-5#credits')}`,
    );
    // On the Shop the dialog's links to the Shop would lead back here, so they hide.
    expect(part('#topup-drawer-shop').hidden).toBe(true);
    onShop.topup.close();
    expect(local.purchases()).toEqual([]);
    expect(sign(local).ok).toBe(true);
    // Back from signing: ?checkout= opens it at once, ready to add.
    const back = loadPanels(local, {
      pathname: '/jobdeputy/brand/shop-preview.html',
      search: '?skipLoader&checkout=credits-5',
      hash: '#credits',
    });
    expect(back.topup.open).toBe(true);
    const again = (selector: string) => back.topup.querySelector(selector);
    expect(again('#topup-drawer-gate').hidden).toBe(true);
    expect(back.topup.focused).toBe(again('[data-topup-buy]'));
    again('[data-topup-buy]').fire('click');
    expect(again('#topup-drawer-done-title').textContent).toBe('22.7 million tokens added.');
    expect(again('#topup-drawer-done-message').textContent).toBe(
      'You have 23.1 million tokens on Ministral 3 14B now. Nothing was charged.',
    );
    expect(again('#topup-drawer-purchases').hidden).toBe(true);
    expect(back.calls).toContainEqual([
      'deputy.react',
      'celebrate',
      { speech: 'I have more credits now.' },
    ]);
    // ?checkout= has done its work: the address keeps the rest.
    expect(back.addresses).toEqual(['/jobdeputy/brand/shop-preview.html?skipLoader#credits']);
    // The Month bundle: its discount is on the nightly runs only.
    back.topup.close();
    back.api.checkout('bundle-month');
    expect(rowsOf(back.topup)).toEqual([
      [
        'What it adds',
        [
          '45.5 million tokens of AI credits on Ministral 3 14B',
          // Round 7 (T5-2): what the runs would last through at your settings.
          '60 runs: lasts through Fri, Oct 23 at your settings',
        ],
      ],
      ['List price', ['$15.00']],
      ['You save', ['$1.25: 25% off the runs']],
      ['Price', ['$13.75']],
      ['Tax', ['Added at checkout, based on your billing address.']],
    ]);
    again('[data-topup-buy]').fire('click');
    expect(again('#topup-drawer-done-message').textContent).toBe(
      // Round 7 (R10-9): 6 runs used before the bundle (the Gmail scans count), so 64 left, and
      // at 3 a day (Keep watch's 2 and Gmail's daily scan) they last through Fri, Oct 23.
      'You have 68.5 million tokens on Ministral 3 14B now. Your runs now last through Fri, Oct 23. Nothing was charged.',
    );
    expect(back.calls).toContainEqual([
      'deputy.react',
      'celebrate',
      { speech: 'I have credits and nights now.' },
    ]);
    // Purchases' own choose step: 30 runs, through Continue (elsewhere Get more runs goes to
    // Purchases, round 7).
    const dashboard = loadPanels(local, {
      pathname: '/jobdeputy/brand/shop-preview.html',
      search: '?skipLoader',
    });
    const dash = (selector: string) => dashboard.topup.querySelector(selector);
    dashboard.api.openTopup('nightly');
    const radios = dashboard.topup.querySelectorAll('input[name="item"]');
    expect(radios.map((radio) => radio.value)).toEqual(['nightly-30', 'nightly-60', 'nightly-120']);
    (radios[0] as Part).checked = true;
    dash('#topup-drawer-form').fire('submit');
    expect(dash('#topup-drawer-title').textContent).toBe('30 runs');
    expect(dash('[data-topup-back]').hidden).toBe(false);
    dash('[data-topup-buy]').fire('click');
    expect(dash('#topup-drawer-done-title').textContent).toBe('30 runs added.');
    expect(dash('#topup-drawer-purchases').getAttribute('href')).toBe(
      './shop-preview.html#purchases',
    );
    // On Purchases the receipts are on the page itself, so its link to them hides.
    expect(dash('#topup-drawer-purchases').hidden).toBe(true);
    expect(dashboard.calls).toContainEqual([
      'deputy.react',
      'celebrate',
      { speech: 'I can keep watch longer.' },
    ]);
    // Every page reads the same world: three purchases, the credits, and the nightly runs.
    expect(local.purchases().map((purchase) => purchase.itemId)).toEqual([
      'nightly-30',
      'bundle-month',
      'credits-5',
    ]);
    expect(local.purchases().every((purchase) => purchase.charged === false)).toBe(true);
    expect(local.metricText('ai.credits.left')).toBe('68.5 million');
    expect(local.metricText('watch.nightly.topups')).toBe('90');
  });

  it('goes back to the page it came from: the Dashboard keeps ?skipLoader, and one-time triggers drop', () => {
    const local = loadStore();
    const fromHome = loadPanels(local, { search: '?state=new&tour=1&prompt=rank' });
    fromHome.prompt.close();
    fromHome.api.checkout('nightly-60');
    expect(fromHome.topup.querySelector('[data-topup-sign]').getAttribute('href')).toBe(
      `./agreement-preview.html?mode=update&return=${encodeURIComponent('home-preview.html?skipLoader&state=new&checkout=nightly-60')}`,
    );
    const fromAi = loadPanels(local, {
      pathname: '/jobdeputy/brand/ai-preview.html',
      hash: '#credits',
    });
    fromAi.api.checkout('credits-10');
    expect(fromAi.topup.querySelector('[data-topup-sign]').getAttribute('href')).toBe(
      `./agreement-preview.html?mode=update&return=${encodeURIComponent('ai-preview.html?checkout=credits-10#credits')}`,
    );
    // The agreement page accepts only a *-preview.html page in this folder (A4's safeReturn);
    // round 6 (T1) names the Shop Purchases there too.
    expect(sourceFor('agreement-preview.html')).toContain("shop: 'Purchases',");
    // An item the Shop does not have never opens a checkout on load.
    expect(loadPanels(local, { search: '?checkout=credits-7' }).topup.open).toBe(false);
  });

  it('gives the checkout its focus back after Chrome scrolls to the address’s #anchor on load', () => {
    const local = loadStore();
    sign(local);
    const page = loadPanels(local, {
      pathname: '/jobdeputy/brand/shop-preview.html',
      search: '?skipLoader&checkout=bundle-month',
      hash: '#bundles',
      loading: true,
    });
    page.fire('DOMContentLoaded');
    expect(page.topup.open).toBe(true);
    const buy = page.topup.querySelector('[data-topup-buy]');
    expect(page.topup.focused).toBe(buy);
    // The browser clears focus when it scrolls to #bundles, just before load.
    page.topup.focused = null;
    page.fire('load');
    expect(page.topup.focused).toBe(buy);
  });

  it('keeps the dialog’s ids clear of the Shop’s', () => {
    const { topup, prompt } = loadPanels(store);
    const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const page = new Set(ids(shop));
    expect(
      [...ids(topup.innerHTML), ...ids(prompt.innerHTML)].filter((id) => page.has(id)),
    ).toEqual([]);
  });

  it('states the one AI setting in the Prompt drawer and offers no model choice (R4-2)', () => {
    // Round 7 (R10-3): the drawer is the Prompts page's editor; elsewhere a prompt opens there.
    const { api, prompt } = loadPanels(store, {
      pathname: '/jobdeputy/brand/prompts-preview.html',
    });
    expect(prompt.innerHTML).not.toMatch(/<select\b|type="radio"|name="model"/);
    api.openPrompt('tailor');
    expect(prompt.querySelector('[data-prompt-model]').innerHTML).toBe(
      '<span>gpt-5-mini on your OpenAI key</span><span class="prompt-facts-note">Every search and draft uses your one AI setting.</span>',
    );
    prompt.close();
    api.openPrompt('rank');
    expect(prompt.querySelector('[data-prompt-model]').innerHTML).toBe(
      `<span>gpt-5-mini on your OpenAI key</span><span class="prompt-facts-note">${String(store.prompt('rank')?.note)}</span>`,
    );
    expect(String(store.prompt('rank')?.note)).toMatch(/one AI setting/);
    expect(panelsSource).not.toMatch(/[\u2013\u2014]/);
  });
});
