import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Page guarantees for Profile (brand/profile-preview.html), what your deputy uses to apply (round
// 6, T1 and P4): the overview (how ready the profile is, and each detail to add with its reason),
// the section nav, the five section cards in their order (About you, Career, Job preferences,
// Application answers, Found while applying) and their deep links (#field-<key> included), the
// need markers from JobDeputyStore.fieldStatus(), voluntary self-identification, Keep watch (its
// sources in the shared multi-select, P3), Found while applying with what you imported from
// LinkedIn, the deputy's first-person tour (R6-2) from the shared page intro (R6-3), the honest
// status tags, and that the page captures every field the backend design names. Account, Gmail,
// LinkedIn's import and sign-in, and site accounts moved to Settings (account.test.ts and
// connections.test.ts hold their tests now); How your deputy applies moved to Applications. Every
// old anchor forwards to its new home. The page keeps its pure rules (fields, validation, view rows,
// need words, self-identification, and how each editor writes the sample store) between
// `/* profile-rules: start */` and `end` markers; they run here on their own, against the shared
// store's seed. The rendered checks (contrast, targets, overflow, focus) run in
// scripts/ui-audit.mjs.

const repo = resolve(import.meta.dirname, '../..');
const brandDirectory = resolve(repo, 'brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');
const profile = sourceFor('profile-preview.html');
const dataModel = readFileSync(resolve(repo, 'docs/data-model.md'), 'utf8');
const sharedProfile = readFileSync(resolve(repo, 'packages/shared/src/profile.ts'), 'utf8');

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
const stylesOf = (source: string): string =>
  [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1] ?? '')
    .join('\n');
const scriptOf = (source: string): string =>
  [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '').join('\n');

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

const words = (text: string): number =>
  text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

// A page's pure rules: the block between its markers, evaluated on its own in a fresh context.
function rulesOf<T>(source: string, name: string, global: string): T {
  const start = source.indexOf(`/* ${name}-rules: start */`);
  const end = source.indexOf(`/* ${name}-rules: end */`);
  if (start < 0 || end < start) throw new Error(`${name}-rules markers not found`);
  const block = source.slice(start, end);
  return new Script(`${block}\n${global};`, { filename: `${name}-rules` }).runInNewContext({}) as T;
}

// Values from the rules' context, compared as plain data.
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type State = Record<string, unknown> & {
  profile: Record<string, unknown>;
  preferences: Record<string, unknown>;
  applicant: Record<string, unknown>;
  applySettings: Record<string, unknown>;
  career: Record<string, unknown>;
  answers: Array<Record<string, unknown>>;
};
type Field = { key: string; type: string; status: string; backend?: string; label: string };
type Row = {
  key: string;
  label: string;
  value?: string;
  tags?: string[];
  lines?: string[];
  field?: string;
  tag?: string;
  need?: string;
  quiet?: boolean;
};
type View = {
  homeRegion: string;
  profile: Record<string, unknown> & { headline: string; skills: string[] };
  search: Record<string, unknown> & { workStyles: string[]; locations: string[] };
  roles: Array<{ title: string; priority: number; resumeId: string | null; altTitles: string[] }>;
  applicant: Record<string, unknown>;
  answers: Array<{ id: string; approved: boolean; source: string }>;
  career: { experience: Array<{ id: string }>; checkedOn: string | null };
  selfId: Record<string, unknown>;
  crawl: { dailyLimit: number | null };
  apply: {
    mode: string;
    dailyMax: number;
    quietHours: { start: string; end: string; timezone: string } | null;
  };
  found: { noticeEndDate: string; kept: { noticeEndDate: boolean } };
};
type FieldError = { field: string; message: string };
// One detail your deputy needs, as JobDeputyStore.fieldStatus() lists it.
type Need = {
  key: string;
  label: string;
  section: string;
  group: string;
  field: string;
  need: 'required' | 'optional';
  missing: boolean;
  why: string;
  id: string;
  anchor: string;
};
type SelfIdOptions = Record<string, Array<{ id: string; label: string }>>;
type SelfId = {
  gender: string | null;
  genderSelfDescribe: string;
  ethnicity: string | null;
  race: string[];
  veteran: string | null;
  disability: string | null;
};
type EditorField = Field & {
  options?: Array<[string, string]>;
  grid?: boolean;
  alone?: string;
  when?: Record<string, string>;
};
type Group = {
  section: string;
  title: string;
  fields: Field[];
  rows(view: View): Row[];
  apply(state: State, draft: Record<string, unknown>): void;
};
type Collection = {
  section: string;
  status: string;
  backend: string;
  fields: Field[];
  items(view: View): Array<Record<string, unknown> & { id: string }>;
  write(state: State, id: string | null, draft: Record<string, unknown>): void;
  remove?(state: State, id: string): void;
  canRemove?(view: View): string;
};
type ProfileRules = {
  TODAY: string;
  SECTIONS: Array<[string, string]>;
  SECTION_STATUS: Record<string, string>;
  STATUS_TAGS: Record<string, string>;
  LIMITS: Record<string, number>;
  CRAWL_DEFAULT: number;
  CRAWL_MAX: number;
  GROUPS: Record<string, Group>;
  COLLECTIONS: Record<string, Collection>;
  MOVED: Record<string, string>;
  HOME_REGIONS: string[];
  movedTo(location: { search?: string; hash?: string }): string | null;
  postalProblem(value: string, region: string): string;
  read(raw: unknown): View;
  validate(
    id: string,
    draft: Record<string, unknown>,
    view: View,
    itemId?: string | null,
  ): FieldError[];
  summaryTitle(count: number): string;
  limitMessage(id: string): string;
  addEntry(
    list: string[],
    value: string,
    options: { limit: number; noun: string; plural?: string; max?: number },
  ): { ok: boolean; error?: string; entry?: string; list?: string[] };
  parseMoney(input: { amount: string; currency: string; period: string }): unknown;
  formatMoney(value: unknown): string;
  span(start: string, end: string): string;
  sensitiveQuestion(question: string): string;
  NEED_ADD: Record<string, string>;
  SECTION_NEED_WORDS: Record<string, string>;
  SELF_ID_QUESTIONS: Array<[string, string]>;
  needAction(status: Need): string;
  needWord(need: string): string;
  needGoto(status: Need): string;
  missingNeeds(fields: Need[]): Need[];
  sectionNeed(fields: Need[], section: string): string;
  sectionStatus(
    view: View,
    fields: Need[],
  ): Record<string, { need: string; words?: string; check?: string; review?: boolean }>;
  readSelfId(raw: unknown, options: SelfIdOptions): SelfId;
  selfIdAnswered(selfId: SelfId): boolean;
  selfIdRows(
    selfId: SelfId,
    options: SelfIdOptions,
  ): Array<{ key: string; label: string; value: string; quiet?: boolean }>;
  selfIdFields(options: SelfIdOptions): EditorField[];
  selfIdChanges(draft: Record<string, unknown>): Record<string, unknown>;
  clearFound(state: State, key: string): boolean;
  foundGoto(found: Found, fields: Need[]): string;
  foundRemovable(found: Found): boolean;
};
// One detail a form found or LinkedIn shared (JobDeputyStore.discoveredFields()).
type Found = {
  key: string;
  source: 'form' | 'linkedin';
  kind: string;
  label: string;
  section: string;
  group: string;
  value: string;
  raw: unknown;
  saved: boolean;
  tag: string;
  need: string;
  id: string;
};
// One item of the sample LinkedIn export (linkedinImport().items).
type ImportItem = {
  key: string;
  kind: string;
  label: string;
  section: string;
  group: string;
  value: string;
  compare: 'new' | 'same' | 'differs';
  current: string | null;
};
const rules = rulesOf<ProfileRules>(profile, 'profile', 'profileRules');

// The shared sample store (brand/sample-store.js) in a sandbox, as the pages use it.
type Store = {
  get(): State;
  fieldStatus(): Need[];
  metric(key: string): unknown;
  metricText(key: string): string;
  setSelfId(fields: Record<string, unknown>): Record<string, unknown>;
  clearSelfId(): Record<string, unknown>;
  connectGmail(): Record<string, unknown>;
  disconnectGmail(): Record<string, unknown>;
  updateSource(id: string, fields: Record<string, unknown>): Record<string, unknown> | null;
  allowance(): { nightly: Record<string, number | string | null> };
  catalog(): { sources: Array<{ id: string; name: string; status: string; schedule: string }> };
  today(): string;
  SELF_ID_OPTIONS: SelfIdOptions;
  // Round 5, drop 2.
  discoveredFields(): Found[];
  saveDiscoveredField(
    key: string,
    value: unknown,
    options?: Record<string, unknown>,
  ): { ok: boolean; reason?: string; kept?: boolean };
  connections(): {
    linkedin: {
      status: string;
      shares: string[];
      never: string[];
      import: { imported: number; lastImportAt: string | null };
    };
  };
  connectLinkedin(): { status: string };
  disconnectLinkedin(): { status: string };
  linkedinImport(): {
    file: string;
    note: string;
    items: ImportItem[];
    counts: Record<string, number>;
  };
  applyLinkedinImport(keys: string[]): {
    ok: boolean;
    reason?: string;
    applied?: string[];
    unchanged?: string[];
  };
  requiresAgreement(feature: string): { version: string; label: string } | null;
  signAgreement(fields: Record<string, unknown>): { ok: boolean };
  siteAccounts(): Array<Record<string, unknown> & { id: string; site: string }>;
  createSiteAccount(fields: Record<string, unknown>): { ok: boolean; reason?: string };
  revealSitePassword(id: string, options?: { action: string }): { ok: boolean; password?: string };
  removeSiteAccount(id: string): { ok: boolean };
  vaultLog(): Array<{ action: string; label: string; at: string }>;
};
function sampleStore(): Store {
  const storage = new Map<string, string>();
  const window: Record<string, unknown> = { addEventListener: () => {} };
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  // The browser's crypto.getRandomValues, which site passwords and one-time codes need.
  window.crypto = globalThis.crypto;
  runInNewContext(sourceFor('sample-store.js'), { window, localStorage, JSON });
  return window.JobDeputyStore as Store;
}
// Signs the October agreement the way the agreement page does (round 5, G1).
const signOctober = (store: Store) =>
  store.signAgreement({
    version: '2026.10',
    name: 'Alex Morgan',
    consents: ['read', 'act', 'keep'],
  });
// The shared sample store's seed, read the way the pages read it.
const seedState = (): State => plain(sampleStore().get());
const seedView = (): View => rules.read(seedState());
const seedNeeds = (): Need[] => plain(sampleStore().fieldStatus());

// Every backend attribute the page maps a field to.
const backends = (): string[] =>
  [...Object.values(rules.GROUPS), ...Object.values(rules.COLLECTIONS)].flatMap((spec) =>
    spec.fields.map((field) => field.backend ?? ''),
  );

const main = mainOf(profile);
// Round 6 (P4): what your deputy uses to apply, then where details came from (Found, last).
const SECTION_IDS = ['about', 'career', 'preferences', 'answers', 'found'];

describe('Profile page frame', () => {
  it('loads the sample store between the components and the deputy, and the panels last', () => {
    const order = [
      'app-shell.js',
      'app-components.js',
      'sample-store.js',
      'deputy.js',
      'feedback.js',
      'app-panels.js',
    ].map((name) => profile.indexOf(`<script src="./${name}"></script>`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order[5]).toBeLessThan(profile.indexOf('<script>'));
    // app-shell.js closes the account menu on every page, so the page no longer does.
    expect(scriptOf(profile)).not.toContain("document.querySelectorAll('.account-menu')");
  });

  it('opens with the information architecture title and the protect-data deputy', () => {
    expect(textOf(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')).toBe(
      'What your deputy knows about you.',
    );
    expect(profile).toContain('data-deputy-page="profile"');
    expect(profile).toContain('data-deputy-state="protect-data"');
    expect(profile).toContain('<a class="skip-link" href="#profile-title">');
    // Round 6 (T1): the settings left, so the eyebrow names the page.
    expect(main).toContain('<p class="eyebrow">Profile</p>');
    expect(profile).not.toContain('Profile &amp; settings');
    // One supporting line under the h1.
    const intro = textOf(main.match(/<p class="intro-copy">([\s\S]*?)<\/p>/)?.[1] ?? '');
    expect(words(intro)).toBeGreaterThan(0);
    expect(words(intro)).toBeLessThanOrEqual(16);
  });

  it('says once, under the lede, that the whole page is sample data (P-16)', () => {
    // Round 6 part 2 (P-16): one label for the page instead of one per card; the Phase 2 and
    // Planned tags stay where a part differs.
    expect(
      main.match(/<p class="sample-note[^"]*">Sample data · not connected<\/p>/g),
    ).toHaveLength(1);
    const intro = main.slice(
      main.indexOf('<section class="page-intro'),
      main.indexOf('</section>'),
    );
    expect(intro).toMatch(
      /<p class="intro-copy">[^<]+<\/p>\s*<p class="sample-note profile-page-note">Sample data · not connected<\/p>/,
    );
    for (const id of ['profile', ...SECTION_IDS]) {
      expect(elementById(profile, id), `#${id}`).not.toContain('class="sample-note"');
    }
  });
});

describe('Profile sections and navigation', () => {
  it('shows five section cards in order, each leading with an icon, a heading, and one short line', () => {
    const sections = [
      ...main.matchAll(
        /<section class="task-surface profile-section" id="([\w-]+)" aria-labelledby="([\w-]+)">/g,
      ),
    ];
    expect(sections.map((match) => match[1])).toEqual(SECTION_IDS);
    const headings = sections.map((match) => textOf(elementById(profile, match[2] ?? '')));
    // Round 6 (P4): in the order a form reads, then where details came from (Found, last).
    expect(headings).toEqual([
      'About you',
      'Career',
      'Job preferences',
      'Application answers',
      'Found while applying',
    ]);
    expect(rules.SECTIONS.map(([id]) => id)).toEqual(SECTION_IDS);
    for (const id of SECTION_IDS) {
      const section = elementById(profile, id);
      expect(section, `#${id} icon`).toMatch(
        /<span class="profile-section-icon" aria-hidden="true"/,
      );
      const line = section.match(/<p class="profile-section-line">([\s\S]*?)<\/p>/)?.[1] ?? '';
      expect(words(textOf(line)), `#${id} line`).toBeGreaterThan(0);
      expect(words(textOf(line)), `#${id} line`).toBeLessThanOrEqual(14);
    }
  });

  it('lists the sections in a nav: a sticky list at 1101px and wider, a sideways row below', () => {
    const nav = elementById(profile, 'profile-nav');
    expect(nav).toMatch(
      /^<nav class="profile-nav" id="profile-nav" aria-label="Profile sections">/,
    );
    const links = [
      ...nav.matchAll(
        /<a class="profile-nav-link" href="#([\w-]+)"[\s\S]*?<span class="profile-nav-label">([^<]+)<\/span\s*>/g,
      ),
    ];
    expect(links.map((match) => [match[1], match[2]])).toEqual([
      ['about', 'About you'],
      ['career', 'Career'],
      ['preferences', 'Job preferences'],
      ['answers', 'Application answers'],
      ['found', 'Found'],
    ]);
    const css = stylesOf(profile).replace(/\s+/g, ' ');
    expect(css).toMatch(
      /@media \(min-width: 1101px\) \{[^@]*\.profile-nav \{ position: sticky; top: 89px;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 1100px\) \{[^@]*\.profile-nav-list \{ display: flex;[^}]*overflow-x: auto;/,
    );
    // The current section is marked like the app's own nav, and the sideways row becomes a
    // labelled, focusable scroll region only while it scrolls.
    expect(scriptOf(profile)).toContain("link.setAttribute('aria-current', 'true')");
    expect(scriptOf(profile)).toContain("navList.setAttribute('tabindex', '0');");
    expect(scriptOf(profile)).toContain(
      "navList.setAttribute('aria-label', 'Profile sections, scrolls sideways');",
    );
    // A focused link scrolls into view inside the row (UAT-A-4); with nothing in the row
    // focused, the row keeps the current section (or the first) in view.
    const script = scriptOf(profile);
    for (const part of [
      "navList.addEventListener('focusin', (event) => {",
      'if (link) showInRow(link);',
      "navList.addEventListener('focusout', (event) => {",
      'window.requestAnimationFrame(keepCurrentInRow);',
      'if (focusedInRow()) return;',
      "showInRow(navLinks.find((entry) => entry.hasAttribute('aria-current')) ?? navLinks[0]);",
      "navList.style.scrollSnapType = 'none';",
    ]) {
      expect(script, part).toContain(part);
    }
    // The inset focus ring sits on paper-deep: green-ink keeps it at 3:1 or more (UAT-A-3).
    expect(css).toMatch(
      /@media \(max-width: 1100px\) \{[^@]*\.profile-nav-link:focus-visible \{ outline-color: var\(--green-ink\); outline-offset: -3px; \}/,
    );
  });

  it('answers every deep link other pages use, and the older Profile anchors still land', () => {
    const ids = new Set([...profile.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? ''));
    for (const id of [
      ...SECTION_IDS,
      'profile',
      'target-roles',
      'resumes',
      'ans-saved',
      'ans-pay',
      // Round 3: self-identification; Keep watch keeps its anchor on the line that links to
      // Searches (round 6 part 2, P-1), and the anchor forwards there.
      'watch',
      'self-id',
      // Round 5: Found while applying.
      'found',
      // Round 6 (T1): what moved keeps its old anchor on the Moved list's link, which forwards.
      'account',
      'gmail',
      'site-accounts',
      'linkedin',
      'applying',
    ]) {
      expect(ids.has(id), `#${id}`).toBe(true);
    }
    // Account's groups forward too, with no element of their own here any more; Access and
    // Deputy Assist went on to AI & credits (round 6 part 2, P-11).
    for (const id of ['acct-signin', 'acct-region', 'acct-data']) {
      expect(rules.MOVED[id], `#${id}`).toMatch(/^\.\/account-preview\.html/);
    }
    expect(rules.MOVED['ai-access'], '#ai-access').toBe('./ai-preview.html#ai');
    // Round 7 (T7-9): usage moved on to its own Settings tab.
    expect(rules.MOVED.usage, '#usage').toBe('./usage-preview.html');
    // Field links carry dots (#field-profile.postalCode), from the store's To-do and any page.
    const pages = readdirSync(brandDirectory).filter((name) => name.endsWith('.html'));
    const used = new Set<string>();
    for (const page of pages) {
      for (const match of sourceFor(page).matchAll(/profile-preview\.html#([\w.-]+)/g))
        used.add(match[1] ?? '');
    }
    for (const field of seedNeeds()) used.add(field.anchor.split('#')[1] ?? '');
    for (const todo of (sampleStore() as unknown as { todo(): Array<{ href: string }> }).todo()) {
      const [page, hash] = todo.href.split('#');
      if (page?.endsWith('profile-preview.html') && hash) used.add(hash);
    }
    expect(used.has('field-profile.postalCode')).toBe(true);
    for (const id of used) expect(ids.has(id), `#${id} from another page`).toBe(true);
    // A deep link is placed again once the sections are drawn; a field link opens its field,
    // found by id (it holds dots, so never a selector).
    const script = scriptOf(profile);
    expect(script).toContain('const id = decodeURIComponent(window.location.hash.slice(1));');
    expect(script).toContain(
      "const status = id.startsWith('field-') ? needs().find((entry) => entry.id === id) : null;",
    );
    expect(script).toContain('openField(status);');
    expect(script).not.toMatch(/querySelector\(`#\$\{/);
  });

  it('forwards every anchor that moved to its new home, and says where they went (T1, R6-10)', () => {
    // Account to Settings, Account; Gmail, LinkedIn, and site accounts to Settings, Connections;
    // How your deputy applies to Applications. The LinkedIn review's return (?import=linkedin)
    // forwards to Connections, where the review now lives.
    expect(plain(rules.MOVED)).toEqual({
      account: './account-preview.html',
      'acct-signin': './account-preview.html#acct-signin',
      'acct-region': './account-preview.html#acct-region',
      'acct-data': './account-preview.html#acct-data',
      'ai-access': './ai-preview.html#ai',
      usage: './usage-preview.html',
      gmail: './connections-preview.html#gmail',
      linkedin: './connections-preview.html#linkedin',
      'site-accounts': './connections-preview.html#site-accounts',
      applying: './applications-preview.html#how-you-apply',
      'apply-mode': './applications-preview.html#how-you-apply',
      'apply-limits': './applications-preview.html#how-you-apply',
      'apply-quiet': './applications-preview.html#how-you-apply',
      // Round 6 part 2 (P-1): Keep watch and Searches a day live on Searches.
      watch: './searches-preview.html#keep-watch',
      'pref-schedule': './searches-preview.html#keep-watch',
    });
    expect(rules.movedTo({ search: '', hash: '#gmail' })).toBe('./connections-preview.html#gmail');
    expect(rules.movedTo({ search: '?skipLoader', hash: '#account' })).toBe(
      './account-preview.html',
    );
    expect(rules.movedTo({ search: '?import=linkedin', hash: '#linkedin' })).toBe(
      './connections-preview.html?import=linkedin#linkedin',
    );
    expect(rules.movedTo({ hash: '#field-applySettings.dailyMax' })).toBe(
      './applications-preview.html#how-you-apply',
    );
    expect(rules.movedTo({ hash: '#site%2Daccounts' })).toBe(
      './connections-preview.html#site-accounts',
    );
    // What stays here does not move, a field link included.
    expect(rules.movedTo({ hash: '#watch' })).toBe('./searches-preview.html#keep-watch');
    for (const hash of [
      '',
      '#about',
      '#target-roles',
      '#found',
      '#field-profile.postalCode',
      '#%E0%A4%A',
    ]) {
      expect(rules.movedTo({ search: '', hash }), hash).toBeNull();
    }
    // Each new home has the anchor it is sent to.
    for (const target of Object.values(rules.MOVED)) {
      const [file, anchor] = target.replace('./', '').split('#');
      if (!anchor) continue;
      expect(sourceFor(file ?? ''), target).toContain(`id="${anchor}"`);
    }
    // It forwards before anything is drawn, with location.replace (Back skips the old address),
    // and again when the anchor changes on this page.
    const script = scriptOf(profile);
    expect(script).toContain('const next = profileRules.movedTo(window.location);');
    expect(script).toContain('if (next) window.location.replace(next);');
    expect(script).toContain("window.addEventListener('hashchange', forward);");
    expect(script).toContain('if (profileAway) return;');
    expect(script.indexOf('const profileAway')).toBeLessThan(
      script.indexOf('const store = window.JobDeputyStore;'),
    );
    // The Moved line (round 6 part 2, P-17: one line, not a list) names each new home; its links
    // carry the old anchors.
    const moved = elementById(profile, 'profile-moved');
    for (const [id, href] of [
      ['account', './account-preview.html'],
      ['gmail', './connections-preview.html#gmail'],
      ['linkedin', './connections-preview.html#linkedin'],
      ['site-accounts', './connections-preview.html#site-accounts'],
      ['applying', './applications-preview.html#how-you-apply'],
    ]) {
      expect(moved, id).toContain(`<a id="${id}" href="${href}">`);
    }
    expect(textOf(moved)).toBe(
      'Moved to Settings: Account Gmail LinkedIn Site accounts To Applications: How your deputy applies',
    );
    // Nothing of what moved is drawn here any more.
    for (const gone of [
      'id="profile-gmail-card"',
      'id="profile-linkedin-card"',
      'id="profile-linkedin-import-open"',
      'id="profile-sites-list"',
      'id="profile-vault-log"',
      'id="profile-apply-mode"',
      'id="profile-password-form"',
      'id="profile-delete-drawer"',
      'id="profile-import-drawer"',
      'id="profile-gmail-drawer"',
      'id="profile-linkedin-drawer"',
      'data-topup-open="credits"',
      // Round 6 part 2 (P-1): Keep watch's ring, its runs, and its sources; Searches a day.
      'id="profile-watch-meter"',
      'id="profile-watch-pick"',
      'data-topup-open="nightly"',
      'id="pref-schedule"',
    ]) {
      expect(profile, gone).not.toContain(gone);
    }
  });

  it('labels what the backend does not accept yet, and only there', () => {
    const titleRow = (id: string) =>
      elementById(profile, id).match(/<div class="profile-section-title">([\s\S]*?)<\/div>/)?.[1] ??
      '';
    for (const id of ['found', 'career', 'answers']) {
      expect(titleRow(id), `#${id}`).toContain('<span class="tag">Phase 2</span>');
      expect(rules.SECTION_STATUS[id]).toBe('phase2');
    }
    expect(Object.keys(rules.SECTION_STATUS).sort()).toEqual([...SECTION_IDS].sort());
    for (const id of ['about', 'preferences']) {
      expect(titleRow(id), `#${id}`).not.toContain('class="tag"');
      expect(rules.SECTION_STATUS[id]).toBe('api');
    }
    for (const id of ['pref-companies-title', 'ans-sensitive-title', 'self-id-title']) {
      expect(elementById(profile, id), id).toContain('<span class="tag">Planned</span>');
    }
    // Keep watch is planned. No prices anywhere.
    expect(textOf(profile)).not.toMatch(/[$€£]\s?\d|\bper month\b|\/mo\b|Premium/);
    // A field tags itself only where it differs from its section: the street address in About
    // you (Phase 2) and the résumé a role tailors from (planned).
    expect(
      rules.GROUPS['about-contact']?.fields.find((field) => field.key === 'addressLine1')?.status,
    ).toBe('phase2');
    expect(
      rules.COLLECTIONS['pref-roles']?.fields.find((field) => field.key === 'resumeId')?.status,
    ).toBe('planned');
    expect(scriptOf(profile)).toContain(
      "const untagged = (field, base) => (field.status === base ? { ...field, status: 'api' } : field);",
    );
  });
});

describe('Profile overview (round 6, P4)', () => {
  it('leads with what your deputy still needs: each detail with its reason, the counts in the meters (P-17)', () => {
    const store = sampleStore();
    const block = elementById(profile, 'profile-needs');
    expect(block).toMatch(/^<div\s+class="profile-needs"\s+id="profile-needs"/);
    // Round 6 part 2 (P-17): completeness is said once, by the meters; the need summary's
    // counts ("2 required, 10 optional to add") left the overview.
    expect(profile).not.toContain('id="profile-need-summary"');
    expect(block).not.toMatch(/data-metric="profile\.missing(Required|Optional)"/);
    expect(textOf(elementById(profile, 'profile-needs-title'))).toBe('Details to add');
    expect(elementById(profile, 'profile-need-done')).toContain(
      'data-need="none" hidden>Everything applications need is here</p>',
    );
    // The first four missing details, required first, each the shared need marker (red for
    // required, the optional tone for optional) as an Add link that lands on its field without
    // script and opens it with script, and beside it the store's reason, in words (round 6, P4:
    // the owner asked to see what is missing and why). None is black (finding 24).
    const links = [
      ...elementById(profile, 'profile-need-list').matchAll(
        /<li class="profile-need-item"><a class="need-add" data-need="(\w+)" href="#([\w.-]+)" data-goto="([\w:-]+)">([^<]+)<span class="need-add-word">(\w+)<\/span><\/a><span class="profile-need-why">([^<]+)<\/span><\/li>/g,
      ),
    ];
    const first = rules.missingNeeds(store.fieldStatus()).slice(0, 4);
    expect(
      links.map((match) => [match[1], match[2], match[3], match[4], match[5], match[6]]),
    ).toEqual(
      first.map((need) => [
        need.need,
        need.id,
        rules.needGoto(need),
        rules.needAction(need),
        rules.needWord(need.need),
        need.why,
      ]),
    );
    expect(block).not.toContain('primary-action');
    expect(scriptOf(profile)).not.toContain("link.className = 'primary-action'");
    expect(first.map((need) => need.key)).toEqual([
      'profile.postalCode',
      'applicant.expectedCompensation',
      'profile.preferredName',
      'profile.headline',
    ]);
    // The rest are one tap away in place (the list holds at most what fieldStatus() names).
    const script = scriptOf(profile);
    expect(script).toContain('const HERO_NEEDS = 4;');
    expect(script).toContain(
      "el('li', { class: 'profile-need-item', hidden: !needsOpen && index >= HERO_NEEDS }, [",
    );
    expect(script).toContain("el('span', { class: 'profile-need-why', text: status.why }),");
    expect(elementById(profile, 'profile-need-more')).toMatch(
      /^<button\s+class="compact-action profile-need-more"\s+id="profile-need-more"\s+type="button"\s+aria-expanded="false"\s+aria-controls="profile-need-list"\s*>\s*Show all details to add\s*<\/button>$/,
    );
    expect(script).toContain(
      "const moreWords = needsOpen ? 'Show fewer' : 'Show all details to add';",
    );
    expect(store.fieldStatus().every((need) => need.why)).toBe(true);
    // Found details that wait are named here too, in words: Found while applying is last now.
    expect(textOf(elementById(profile, 'profile-found-waiting'))).toBe(
      'Details found on forms wait for you Open Found while applying',
    );
    expect(elementById(profile, 'profile-found-waiting')).toContain('href="#found"');
    // The ring and its 13 checks are gone: one representation of what is missing.
    expect(profile).not.toContain('Profile strength');
    expect(profile).not.toMatch(/class="ring"/);
    // A suggested answer waits, in words and without a count.
    expect(textOf(elementById(profile, 'profile-review'))).toBe(
      'A suggested answer waits for you Review it',
    );
  });

  it('shows how ready the profile is, as the store’s figures on the shared meter, once (P-17)', () => {
    // The meters ship with the seed's figures, each the store's own (R3-4), and stay hidden if
    // the store does not count them.
    const ready = elementById(profile, 'profile-ready');
    const store0 = sampleStore();
    for (const key of [
      'profile.requiredDone',
      'profile.required',
      'profile.optionalDone',
      'profile.optional',
    ]) {
      expect(ready, key).toContain(`<span data-metric="${key}">${store0.metricText(key)}</span>`);
    }
    expect(textOf(ready)).toBe('Required details 12 of 14 filled Optional details 6 of 16 filled');
    expect(ready).toContain(
      '<div class="meter is-stepped" role="meter" aria-labelledby="profile-ready-required-label" aria-valuemin="0" aria-valuemax="14" aria-valuenow="12" aria-valuetext="12 of 14 filled" style="--value: 85.7; --steps: 14"></div>',
    );
    const script = scriptOf(profile);
    for (const key of [
      'profile.requiredDone',
      'profile.required',
      'profile.optionalDone',
      'profile.optional',
    ]) {
      expect(script, key).toContain(`'${key}'`);
    }
    expect(script).toContain(
      "const counted = kinds.every(([, , done, total]) => metricText(done) !== '' && metricText(total) !== '');",
    );
    expect(script).toContain("class: 'meter is-stepped',");
    expect(script).toContain("role: 'meter',");
    expect(script).toContain(
      "el('p', { class: 'meter-value' }, [metricSpan(doneKey), ' of ', metricSpan(totalKey), ' filled']),",
    );
    // When the store counts them, they agree with fieldStatus().
    const store = sampleStore();
    if (store.metricText('profile.required') !== '') {
      const needs = store.fieldStatus();
      const required = needs.filter((need) => need.need === 'required');
      const optional = needs.filter((need) => need.need === 'optional');
      expect([
        store.metric('profile.required'),
        store.metric('profile.requiredDone'),
        store.metric('profile.optional'),
        store.metric('profile.optionalDone'),
      ]).toEqual([
        required.length,
        required.filter((need) => !need.missing).length,
        optional.length,
        optional.filter((need) => !need.missing).length,
      ]);
    }
  });

  it('opens the tour from the shared page intro, never by itself (R6-3)', () => {
    const intro = main.slice(
      main.indexOf('<section class="page-intro'),
      main.indexOf('</section>'),
    );
    expect(intro).toContain('<div class="page-intro-copy">');
    expect(intro).toContain(
      '<button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour</button>',
    );
    // One Take the tour in main: the overview's own button is gone.
    expect(main.match(/>Take the tour</g)).toHaveLength(1);
    expect(stylesOf(profile)).not.toMatch(
      /(^|[\s,}])\.(page-intro|page-tour|profile-intro)[^{]*\{/m,
    );
    // The page names no tour of its own and starts none on load: the shared engine does, from
    // ?tour=1, Show me around, and this button.
    expect(scriptOf(profile)).not.toMatch(/tour\.(start|maybeStart)\(/);
  });

  it('shows the avatar and an honest photo note; the home Region is Account’s now', () => {
    const hero = elementById(profile, 'profile');
    expect(hero).toContain('src="./profile-avatar.svg"');
    // Round 6 (T1): the locked home Region lives in Settings, Account.
    expect(textOf(hero)).not.toContain('US home Region');
    expect(textOf(elementById(sourceFor('account-preview.html'), 'acct-region'))).toContain(
      'United States home Region Locked to your account',
    );
    expect(textOf(elementById(profile, 'profile-photo-note'))).toBe(
      'Photo: prototype only, never uploaded.',
    );
    expect(elementById(profile, 'profile-photo-change')).toContain(
      'aria-describedby="profile-photo-note"',
    );
    expect(profile).toMatch(
      /<input id="profile-photo-file" type="file" accept="image\/png,image\/jpeg,image\/webp" hidden \/>/,
    );
  });
});

describe('Profile captures the backend design', () => {
  // The keys of a z.strictObject({ ... }) block in packages/shared/src/profile.ts.
  const zodKeys = (name: string): string[] => {
    const start = sharedProfile.indexOf(name);
    const block = sharedProfile.slice(start, sharedProfile.indexOf('\n});', start));
    return [...block.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1] ?? '');
  };

  it('maps every profileInput key (PUT /me/profile) to a field', () => {
    const keys = zodKeys('export const profileInput').filter((key) => key !== 'version');
    expect(keys).toEqual([
      'firstName',
      'lastName',
      'preferredName',
      'phone',
      'location',
      'headline',
      'summary',
      'yearsExperience',
      'skills',
      'languages',
      'links',
      'timezone',
    ]);
    const mapped = backends();
    for (const key of keys) {
      expect(
        mapped.some((backend) => backend.startsWith(`users.PROFILE.${key}`)),
        key,
      ).toBe(true);
    }
    for (const part of ['city', 'region', 'country', 'postalCode']) {
      expect(mapped).toContain(`users.PROFILE.location.${part}`);
    }
    for (const link of ['linkedin', 'github', 'portfolio', 'website', 'other']) {
      expect(mapped).toContain(`users.PROFILE.links.${link}`);
    }
    // Email comes from the account, read only; the home Region is Settings, Account's (T1).
    expect(mapped).toContain('users.PROFILE.email');
    // The Phase 2 address is captured too.
    expect(dataModel).toContain(
      '`address? {line1, line2?, city, region, postalCode, country}` (accepted from product Phase 2)',
    );
    expect(mapped).toEqual(
      expect.arrayContaining(['users.PROFILE.address.line1', 'users.PROFILE.address.line2']),
    );
  });

  it('maps every searchInput key (PUT /me/preferences/search) and every role field (/me/roles)', () => {
    const search = zodKeys('export const searchInput').filter((key) => key !== 'version');
    expect(search).toEqual([
      'locations',
      'workplace',
      'employmentTypes',
      'minSalary',
      'seniority',
      'excludeKeywords',
    ]);
    const mapped = backends();
    for (const key of search) expect(mapped, key).toContain(`preferences.SEARCH.${key}`);
    const roleBlock = sharedProfile.slice(
      sharedProfile.indexOf('const roleFields = {'),
      sharedProfile.indexOf('};', sharedProfile.indexOf('const roleFields = {')),
    );
    const roleKeys = [...roleBlock.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1] ?? '');
    expect(roleKeys).toEqual([
      'title',
      'altTitles',
      'seniority',
      'locations',
      'mustHave',
      'exclude',
      'priority',
      'active',
    ]);
    for (const key of roleKeys) expect(mapped, key).toContain(`preferences.ROLE#.${key}`);
    // The data model also links a résumé to each role; the API does not take it yet.
    expect(dataModel).toContain('`resumeDocumentId?`');
    expect(sharedProfile).not.toContain('resumeDocumentId');
    expect(mapped).toContain('preferences.ROLE#.resumeDocumentId');
  });

  it('maps the APPLICANT item and company rules; the crawl limit is Searches’ now', () => {
    const mapped = backends().join(' ');
    const applicant = [
      'workAuthorization',
      'needsSponsorship',
      'noticePeriodDays',
      'earliestStartDate',
      'currentCompensation',
      'expectedCompensation',
      'willingToRelocate',
      'relocationCountries',
      'maxTravelPercent',
      'securityClearance',
      'over18',
      'formerEmployers',
    ];
    const applicantRow = dataModel.match(/\| `APPLICANT` \|[^\n]*/)?.[0] ?? '';
    for (const key of applicant) {
      expect(applicantRow, `data model APPLICANT ${key}`).toContain(`\`${key}`);
      expect(mapped, key).toContain(key);
    }
    // Round 6 (T1, A1): APPLY_SETTINGS (mode, limits, quiet hours, email) is How your deputy
    // applies, which moved to Applications (applyRules()); Profile maps none of it now.
    expect(mapped).not.toContain('APPLY_SETTINGS');
    const ruleRow = dataModel.match(/\| `COMPANY_RULE#<companyId>` \|[^\n]*/)?.[0] ?? '';
    for (const key of ['mode', 'maxJobs', 'extraCompanyIds', 'note']) {
      expect(ruleRow, `data model COMPANY_RULE ${key}`).toContain(`\`${key}`);
      expect(mapped, key).toContain(`COMPANY_RULE#.${key}`);
    }
    // T08c moved the one limit for every company to CRAWL_SETTINGS and left COMPANY_RULE for
    // later (#40) without `windowDays` or the `COMPANY_RULE#*` default. The planned Profile
    // drawer still maps both; reconcile them with #40 before that drawer is built.
    expect(mapped).toContain('COMPANY_RULE#.windowDays');
    expect(mapped).toContain('COMPANY_RULE#*.mode');
    expect(scriptOf(profile)).toContain('counted as found');
    // Round 6 part 2 (P-1): Searches a day (CRAWL_SETTINGS.dailyLimit) moved to Searches with
    // Keep watch; Profile maps none of it now.
    expect(dataModel).toContain('`dailyLimit?`');
    expect(mapped).not.toContain('CRAWL_SETTINGS');
  });

  it('maps work history, education, and certifications, and saved answers', () => {
    const mapped = backends();
    const rowOf = (key: string) =>
      dataModel.match(new RegExp(`\\| \`${key}<id>\` \\|[^\\n]*`))?.[0] ?? '';
    const attributes: Record<string, string[]> = {
      'EXPERIENCE#': [
        'company',
        'title',
        'employmentType',
        'location',
        'startDate',
        'endDate',
        'description',
        'highlights',
        'skills',
      ],
      'EDUCATION#': ['school', 'degree', 'field', 'startDate', 'endDate', 'grade', 'highlights'],
      'CERTIFICATION#': ['name', 'issuer', 'issuedOn', 'expiresOn', 'credentialUrl'],
    };
    for (const [item, keys] of Object.entries(attributes)) {
      for (const key of keys) {
        expect(rowOf(item), `data model ${item} ${key}`).toContain(`\`${key}`);
        expect(mapped, `${item}${key}`).toContain(`users.${item}.${key}`);
      }
    }
    const answers = dataModel.match(/## 11\. `answers`[\s\S]*?## 12/)?.[0] ?? '';
    for (const key of ['question', 'category', 'answerType', 'answer', 'options', 'scope']) {
      expect(answers, `data model answers ${key}`).toContain(`\`${key}`);
      expect(mapped, key).toContain(`answers.${key}`);
    }
    // source, approved, useCount, and lastUsedAt are shown, not typed: suggestions wait for you.
    const script = scriptOf(profile);
    expect(script).toContain("'Suggested by your deputy · waiting for you'");
    expect(script).toContain('item.useCount');
    expect(script).toContain('item.lastUsedAt');
    expect(script).toContain("source: 'user',");
  });

  it('shows the vault as planned: self-identification kept in this browser, the rest not collected', () => {
    expect(dataModel).toContain(
      '`SENSITIVE` | `ciphertext` of `dateOfBirth` and the voluntary equal-opportunity answers',
    );
    expect(dataModel).toContain('`SITE_LOGIN#<domain>`');
    // Self-identification is planned for the vault; the prototype keeps it in this browser.
    expect(elementById(profile, 'self-id-title')).toContain('<span class="tag">Planned</span>');
    expect(scriptOf(profile)).toContain(
      'Planned: kept encrypted in your vault; this prototype keeps it in this browser.',
    );
    const sensitive = textOf(elementById(profile, 'ans-sensitive'));
    expect(sensitive).toContain(
      'Date of birth Not collected Planned · kept encrypted, only for forms that require it',
    );
    expect(sensitive).toContain('Never stored Government ID numbers and bank or card details');
    // Site accounts (the vault's SITE_LOGIN#) moved to Settings, Connections (round 6, T1).
    expect(sourceFor('connections-preview.html')).toContain('id="conn-sites-list"');
  });
});

describe('Profile rules', () => {
  it('reads the seed into one shape', () => {
    const view = seedView();
    expect(view.profile.headline).toBe('');
    expect(plain(view.search.workStyles)).toEqual(['remote', 'hybrid']);
    expect(plain(view.roles.map((role) => [role.title, role.priority, role.resumeId]))).toEqual([
      ['Software engineer', 1, 'resume-main'],
      ['Product engineer', 2, 'resume-main'],
      ['Engineering manager', 3, 'cv-leadership'],
    ]);
    expect(view.crawl.dailyLimit).toBeNull();
    expect(plain(view.apply.quietHours)).toEqual({
      start: '21:00',
      end: '08:00',
      timezone: 'America/Los_Angeles',
    });
    // Words, never counts: the strongest need marker per section (required beats optional).
    expect(plain(rules.sectionStatus(view, seedNeeds()))).toEqual({
      about: { need: 'required' },
      career: { need: 'none', check: 'check', words: 'Check these' },
      preferences: { need: 'none' },
      answers: { need: 'required', review: true },
    });
    expect(plain(rules.SECTION_NEED_WORDS)).toEqual({
      required: 'Required details to add',
      optional: 'Optional details to add',
      none: 'Complete',
    });
  });

  it('reads older saves and onboarding spellings, and fills missing sections with defaults', () => {
    const view = rules.read({
      profile: {
        firstName: 'Sam',
        targetRoles: [' Staff engineer ', 'staff engineer'],
        workStyles: ['office', 'Remote'],
        startTiming: 'asap',
      },
    });
    expect(plain(view.roles.map((role) => role.title))).toEqual(['Staff engineer']);
    expect(plain(view.search.workStyles)).toEqual(['remote', 'onsite']);
    expect(view.apply.mode).toBe('review_each');
    expect(view.apply.dailyMax).toBe(5);
    expect(plain(view.answers)).toEqual([]);
    expect(rules.read(null).profile.headline).toBe('');
  });

  it('marks every detail the store lists, on the view row that shows it, with its Add words', () => {
    const view = seedView();
    const needs = seedNeeds();
    // Round 5 (R2): the notice period end date Google's form asked for joins Availability.
    expect(needs).toHaveLength(30);
    for (const need of needs) {
      expect(rules.NEED_ADD[need.key], `${need.key} Add words`).toBeTruthy();
      expect(need.id).toBe(`field-${need.key}`);
      const collection = rules.COLLECTIONS[need.group];
      if (collection) {
        // Target roles: the list itself, whose empty state carries the marker.
        expect(need.key).toBe('profile.targetRoles');
        expect(rules.needGoto(need)).toBe('item:pref-roles');
        continue;
      }
      const group = rules.GROUPS[need.group];
      expect(group, need.group).toBeDefined();
      const row = group?.rows(view).find((entry) => entry.need === need.key);
      expect(row, `${need.key} has a row`).toBeDefined();
      // The row opens the editor field the store names (email is read only).
      if (need.key !== 'profile.email') expect(row?.field, need.key).toBe(need.field);
      expect(
        group?.fields.some((field) => field.key === need.field),
        `${need.group}:${need.field}`,
      ).toBe(true);
      expect(rules.needGoto(need)).toBe(`${need.group}:${need.field}`);
    }
    // No row names a detail the store does not list; self-identification is never one.
    const keys = new Set(needs.map((need) => need.key));
    for (const group of Object.values(rules.GROUPS)) {
      for (const row of group.rows(view))
        if (row.need) expect(keys.has(row.need), row.need).toBe(true);
    }
    expect([...keys].some((key) => /selfId|gender|race|veteran|disability|ethnic/i.test(key))).toBe(
      false,
    );
    // Required first, then optional, each in the store's order.
    expect(rules.missingNeeds(needs).map((need) => [need.need, need.key])).toEqual([
      ['required', 'profile.postalCode'],
      ['required', 'applicant.expectedCompensation'],
      ['optional', 'profile.preferredName'],
      ['optional', 'profile.headline'],
      ['optional', 'profile.summary'],
      ['optional', 'profile.links.linkedin'],
      ['optional', 'profile.links.github'],
      ['optional', 'applicant.securityClearance'],
      ['optional', 'applicant.earliestStartDate'],
      ['optional', 'found.noticeEndDate'],
      ['optional', 'applicant.currentCompensation'],
      ['optional', 'applicant.formerEmployers'],
    ]);
    expect([rules.needWord('required'), rules.needWord('optional')]).toEqual([
      'Required',
      'Optional',
    ]);
    // City and Country, and where you can work and sponsorship, are separate rows now.
    const contact = rules.GROUPS['about-contact']?.rows(view) ?? [];
    expect(contact.map((row) => [row.key, row.value ?? ''])).toEqual(
      expect.arrayContaining([
        ['city', 'Seattle, WA'],
        ['country', 'United States'],
      ]),
    );
    const eligibility = rules.GROUPS['ans-eligibility']?.rows(view) ?? [];
    expect(plain(eligibility.slice(0, 2).map((row) => [row.key, row.lines]))).toEqual([
      ['authorization', ['United States: Citizen']],
      ['sponsorship', ['United States: No sponsorship needed']],
    ]);
  });

  it('validates each editor with the API’s own messages and limits', () => {
    const view = seedView();
    const fields = (id: string, draft: Record<string, unknown>) =>
      plain(rules.validate(id, draft, view));
    const name = {
      firstName: 'Alex',
      lastName: 'Morgan',
      preferredName: '',
      yearsExperience: '9',
      headline: '',
      summary: '',
    };
    expect(fields('about-name', name)).toEqual([]);
    expect(
      fields('about-name', { ...name, firstName: '', lastName: '' }).map((error) => error.message),
    ).toEqual(['Enter your first name.', 'Enter your last name.']);
    expect(fields('about-name', { ...name, yearsExperience: '71' })[0]?.message).toBe(
      'Use a whole number from 0 to 70.',
    );
    const contact = {
      email: 'alex.morgan@example.com',
      phone: { countryCode: '+1', number: '206 555 0148' },
      city: 'Seattle',
      region: 'WA',
      country: 'US',
      postalCode: '',
      timezone: 'America/Los_Angeles',
      addressLine1: '',
      addressLine2: '',
    };
    expect(fields('about-contact', contact)).toEqual([]);
    // Postal code (round 6 part 3, T4-1): the home Region's format, with a clear error; it is
    // Required, so an empty value is no error here (the need list asks for it).
    const postal = (value: string, homeRegion = 'US') =>
      plain(
        rules.validate('about-contact', { ...contact, postalCode: value }, {
          ...view,
          homeRegion,
        } as View),
      ).find((error) => error.field === 'postalCode')?.message ?? '';
    expect([postal('98101'), postal('98101-1234'), postal('')]).toEqual(['', '', '']);
    for (const value of ['ABC!!', '1', '!!!!!!!!!!!!', '9810', 'SW1A 1AA']) {
      expect(postal(value), value).toBe('Enter a ZIP code, such as 98101 or 98101-1234.');
    }
    expect([postal('SW1A 1AA', 'UK'), postal('n1 9gu', 'UK'), postal('EC1A1BB', 'UK')]).toEqual([
      '',
      '',
      '',
    ]);
    expect(postal('98101', 'UK')).toBe('Enter a postcode, such as SW1A 1AA.');
    expect([postal('560001', 'IN'), postal('560 001', 'IN')]).toEqual(['', '']);
    expect(postal('1', 'IN')).toBe(
      'Enter a postal code of 3 to 10 letters, digits, spaces, or hyphens.',
    );
    // The home Region is the latest signed agreement record's, and the sample's is the US.
    expect(rules.read(seedState()).homeRegion).toBe('US');
    expect(rules.HOME_REGIONS).toEqual(['US', 'IN', 'UK']);
    expect(rules.postalProblem('98101', 'US')).toBe('');
    expect(
      fields('about-contact', {
        ...contact,
        phone: { countryCode: '1', number: '206 555 0148' },
      })[0]?.message,
    ).toBe('Use a code like +1, +44, or +91.');
    expect(
      fields('about-contact', { ...contact, phone: { countryCode: '+1', number: 'abc' } })[0]
        ?.message,
    ).toBe('Use digits, spaces, dashes, or brackets.');
    expect(
      fields('about-links', {
        linkedin: 'http://example.com/me',
        github: '',
        portfolio: '',
        website: '',
        other: [],
      })[0]?.message,
    ).toBe('Use a full https:// address, such as https://example.com/you.');
    expect(fields('pref-where', { workStyles: ['hybrid'], locations: [] })[0]?.message).toBe(
      'Add a place for hybrid or on-site roles, or choose Remote only.',
    );
    expect(fields('pref-where', { workStyles: ['remote'], locations: [] })).toEqual([]);
    expect(fields('pref-where', { workStyles: [], locations: ['Seattle, WA'] })[0]?.message).toBe(
      'Choose at least one workplace.',
    );
    // Searches a day moved to Searches (round 6 part 2, P-1).
    expect(rules.GROUPS['pref-schedule']).toBeUndefined();
    expect(
      fields('ans-availability', { noticePeriodDays: '400', earliestStartDate: '' })[0]?.message,
    ).toBe('Use a whole number of days, from 0 to 365.');
    expect(
      fields('ans-availability', { noticePeriodDays: '', earliestStartDate: '2026-09-30' })[0]
        ?.message,
    ).toBe('Choose today or a later date.');
    const pay = rules.parseMoney({ amount: '$190,000', currency: 'USD', period: 'year' });
    expect(plain(pay)).toEqual({ amount: 190000, currency: 'USD', period: 'year' });
    expect(
      fields('ans-pay', {
        currentCompensation: rules.parseMoney({ amount: 'lots', currency: 'USD', period: 'year' }),
        expectedCompensation: null,
      })[0]?.message,
    ).toBe('Enter an amount in numbers, such as 185,000.');
    expect(rules.formatMoney(pay)).toBe('$190,000 a year');
    // Expected pay is above 0 (round 6 part 3, T4-2): a form never gets "$0 a year". Current pay,
    // which is optional and may be nothing, still takes 0.
    const payErrors = (amount: string) =>
      fields('ans-pay', {
        currentCompensation: null,
        expectedCompensation: rules.parseMoney({ amount, currency: 'USD', period: 'year' }),
      }).map((error) => error.message);
    expect(payErrors('0')).toEqual(['Enter an amount above 0.']);
    expect(payErrors('1')).toEqual([]);
    expect(payErrors('')).toEqual([]);
    expect(
      fields('ans-pay', {
        currentCompensation: rules.parseMoney({ amount: '0', currency: 'USD', period: 'year' }),
        expectedCompensation: null,
      }),
    ).toEqual([]);
    // How your deputy applies (its limits and quiet hours) moved to Applications (T1, A1).
    expect(rules.GROUPS['apply-limits']).toBeUndefined();
    expect(rules.GROUPS['apply-quiet']).toBeUndefined();
    expect(rules.summaryTitle(1)).toBe('Check one detail before continuing.');
    expect(rules.summaryTitle(3)).toBe('Check 3 details before continuing.');
  });

  it('keeps target roles unique, within ten, and at least one', () => {
    const view = seedView();
    const draft = {
      title: 'product engineer',
      altTitles: [],
      seniority: [],
      mustHave: [],
      exclude: [],
      locations: [],
      priority: '2',
      active: true,
      resumeId: 'resume-main',
    };
    expect(rules.validate('pref-roles', draft, view, null)[0]?.message).toBe(
      'product engineer is already one of your roles.',
    );
    expect(rules.validate('pref-roles', draft, view, 'product-engineer')).toHaveLength(0);
    expect(rules.limitMessage('pref-roles')).toBe(
      'You have 10 target roles, the most your deputy can use. Remove one to add another.',
    );
    expect(rules.COLLECTIONS['pref-roles']?.canRemove?.(view)).toBe('');
    expect(
      rules.COLLECTIONS['pref-roles']?.canRemove?.(
        rules.read({ profile: { targetRoles: ['Staff engineer'] } }),
      ),
    ).toBe('Keep at least one target role, so your deputy knows what to look for.');
  });

  it('refuses sensitive questions and duplicates in saved answers, and checks the answer type', () => {
    const view = seedView();
    const draft = {
      question: 'What is your gender?',
      category: 'custom',
      answerType: 'text',
      options: [],
      answer: 'x',
      scope: 'global',
      scopeCompany: '',
    };
    const check = (overrides: Record<string, unknown>) =>
      rules
        .validate('ans-saved', { ...draft, ...overrides }, view, null)
        .map((error) => error.message);
    expect(check({})[0]).toBe(
      'Questions about gender, ethnicity, veteran status, or disability aren’t saved here. Your deputy declines them for you.',
    );
    expect(check({ question: 'What is your Social Security number?' })[0]).toBe(
      'Your deputy never stores government ID numbers or bank details. Forms that ask wait for you.',
    );
    expect(check({ question: 'Why are you interested in this team?' })[0]).toBe(
      'You already have an answer for this question.',
    );
    expect(
      check({ question: 'Can you work weekends?', answerType: 'yes_no', answer: 'Sometimes' }),
    ).toEqual(['Answer Yes or No.']);
    expect(
      check({ question: 'Pick one', answerType: 'choice', options: ['A'], answer: 'A' }),
    ).toEqual(['Add at least two choices.']);
    expect(
      check({ question: 'Team size you have led?', answerType: 'number', answer: '6' }),
    ).toEqual([]);
    expect(rules.sensitiveQuestion('Are you a protected veteran?')).not.toBe('');
  });

  it('writes each editor into the right store section', () => {
    const state = seedState();
    rules.GROUPS['about-contact']?.apply(state, {
      phone: { countryCode: '+44', number: '20 7946 0958' },
      city: 'London',
      region: '',
      country: 'GB',
      postalCode: 'N1 9GU',
      timezone: 'Europe/London',
      addressLine1: '1 Example Street',
      addressLine2: '',
    });
    expect(
      plain([
        state.profile.phone,
        state.profile.location,
        state.profile.country,
        state.profile.postalCode,
        state.profile.timezone,
        state.profile.address,
      ]),
    ).toEqual([
      { countryCode: '+44', number: '20 7946 0958' },
      'London',
      'GB',
      'N1 9GU',
      'Europe/London',
      { line1: '1 Example Street' },
    ]);
    rules.GROUPS['ans-pay']?.apply(state, {
      currentCompensation: null,
      expectedCompensation: { amount: 190000, currency: 'USD', period: 'year' },
    });
    expect(plain(state.applicant.expectedCompensation)).toEqual({
      amount: 190000,
      currency: 'USD',
      period: 'year',
    });
    rules.GROUPS['ans-eligibility']?.apply(state, {
      authorization: [
        { country: 'US', status: 'citizen', visaType: '', expiresOn: '', sponsorship: false },
        {
          country: 'CA',
          status: 'visa',
          visaType: 'Work permit',
          expiresOn: '2027-01-31',
          sponsorship: true,
        },
      ],
      over18: true,
      securityClearance: '',
    });
    expect(
      plain([
        state.applicant.workAuthorization,
        state.applicant.needsSponsorship,
        state.applicant.securityClearance,
      ]),
    ).toEqual([
      [
        { country: 'US', status: 'citizen' },
        { country: 'CA', status: 'visa', visaType: 'Work permit', expiresOn: '2027-01-31' },
      ],
      { US: false, CA: true },
      null,
    ]);
    // Renaming a role keeps its details under the new title.
    const roles = rules.COLLECTIONS['pref-roles'];
    roles?.write(state, 'product-engineer', {
      title: 'Product engineer, platform',
      altTitles: ['Full stack engineer'],
      seniority: ['senior'],
      mustHave: [],
      exclude: [],
      locations: [],
      priority: '1',
      active: false,
      resumeId: 'cv-leadership',
    });
    const details = state.preferences.roleDetails as Record<string, Record<string, unknown>>;
    expect(plain(state.profile.targetRoles)).toEqual([
      'Software engineer',
      'Product engineer, platform',
      'Engineering manager',
    ]);
    expect(details['Product engineer']).toBeUndefined();
    expect(plain(details['Product engineer, platform'])).toEqual({
      altTitles: ['Full stack engineer'],
      seniority: ['senior'],
      mustHave: [],
      exclude: [],
      priority: 1,
      active: false,
      resumeId: 'cv-leadership',
    });
    // A saved or edited answer is yours, and approved.
    rules.COLLECTIONS['ans-saved']?.write(state, 'why-team', {
      question: 'Why are you interested in this team?',
      category: 'motivation',
      answerType: 'text',
      options: [],
      answer: 'Search at scale.',
      scope: 'global',
      scopeCompany: '',
    });
    expect(plain(state.answers.find((entry) => entry.id === 'why-team'))).toEqual({
      id: 'why-team',
      question: 'Why are you interested in this team?',
      category: 'motivation',
      answerType: 'text',
      answer: 'Search at scale.',
      scope: 'global',
      source: 'user',
      approved: true,
      useCount: 0,
    });
    rules.COLLECTIONS['career-experience']?.write(state, null, {
      title: 'Intern',
      company: 'Proseware',
      employmentType: 'internship',
      location: '',
      startDate: '2016-06',
      endDate: '2016-09',
      description: '',
      highlights: [],
      skills: [],
    });
    expect((state.career.experience as Array<{ id: string }>).map((entry) => entry.id)).toEqual([
      'fabrikam',
      'litware',
      'experience-3',
    ]);
    expect(rules.span('2017-06', '2021-03')).toBe('Jun 2017 to Mar 2021 · 3 yrs 10 mos');
  });

  it('adds chips once, short enough, within the limit, and explains a refusal', () => {
    const options = { limit: 10, noun: 'role', plural: 'roles' };
    expect(plain(rules.addEntry(['Software engineer'], '  Staff   engineer ', options))).toEqual({
      ok: true,
      entry: 'Staff engineer',
      list: ['Software engineer', 'Staff engineer'],
    });
    expect(rules.addEntry(['Software engineer'], 'software ENGINEER', options).error).toBe(
      'software ENGINEER is already on your list.',
    );
    expect(rules.addEntry([], '   ', options).error).toBe('Type a role first.');
    expect(rules.addEntry([], 'x'.repeat(130), options).error).toBe(
      'Keep each role to 120 characters.',
    );
    const full = Array.from({ length: 10 }, (_, index) => `Role ${index + 1}`);
    expect(rules.addEntry(full, 'Role 11', options).error).toBe(
      'You have 10 roles, the most your deputy can use. Remove one to add another.',
    );
    expect([rules.LIMITS.roles, rules.LIMITS.places, rules.LIMITS.skills]).toEqual([10, 20, 100]);
  });
});

describe('Profile drops what the backend does not use (F4)', () => {
  it('never claims that start dates affect ranking, and asks for availability only for forms', () => {
    const text = textOf(profile);
    expect(text).not.toMatch(/start dates? (when it ranks|affects?|for ranking)/i);
    expect(profile).not.toMatch(/weighs start dates/i);
    expect(rules.GROUPS['ans-availability']?.fields.map((field) => field.key)).toEqual([
      'noticePeriodDays',
      'earliestStartDate',
      'noticeEndDate',
    ]);
    expect(profile).toContain("help: 'Used only to answer application forms.'");
  });

  it('no longer asks for start timing or what matters most', () => {
    expect(profile).not.toMatch(
      /startTiming|priorities|What matters most|When you’d like to start/,
    );
    expect(main).not.toMatch(/name="(startTiming|priority)"/);
  });
});

describe('Profile account (moved to Settings, Account in round 6)', () => {
  it('keeps no sign-in, password, Region, credits, export, or deletion of its own', () => {
    // Their tests moved to account.test.ts with them (T1).
    for (const gone of [
      'id="acct-signin"',
      'id="acct-region"',
      'id="ai-access"',
      'id="usage"',
      'id="acct-data"',
      'autocomplete="current-password"',
      'Delete account',
      'Download a copy',
    ]) {
      expect(profile, gone).not.toContain(gone);
    }
    expect(scriptOf(profile)).not.toMatch(/validatePassword|deletionConfirmed|aiChoice|wireToggle/);
    const account = sourceFor('account-preview.html');
    // Access and Deputy Assist went on to AI & credits (round 6 part 2, P-11).
    for (const id of ['acct-signin', 'acct-region', 'acct-data', 'acct-delete-drawer']) {
      expect(account, id).toContain(`id="${id}"`);
    }
  });
});

describe('Profile store wiring', () => {
  it('saves through the shared store, into the section each editor names', () => {
    const script = scriptOf(profile);
    expect(script).toContain("if (store) store.update({ type: 'profile', section }, mutate);");
    expect(script).toContain('write(group.section, (state) => group.apply(state, draft));');
    expect(script).toContain('write(spec.section, (state) => spec.write(state, itemId, draft));');
    for (const section of ['answers', 'career']) {
      expect(script, section).toContain(`write('${section}', (state) => {`);
    }
    expect(script).toContain('store?.subscribe(() => {');
    // Round 3 saves through the store's own calls: self-identification. The Gmail connection
    // moved to Settings, Connections (round 6), and a source's nightly schedule to Searches (round
    // 6 part 2, P-1). Nothing writes the round 2 Keep watch request any more.
    expect(script).not.toContain('updateSource');
    expect(script).toContain('save: (draft) => store?.setSelfId?.(rules.selfIdChanges(draft)),');
    expect(script).toContain('clear: () => store?.clearSelfId?.(),');
    expect(script).not.toContain('connectGmail');
    expect(script).not.toMatch(/requested:\s*daily|state\.watch\s*=/);
    // The groups write the sections the autofill preview and onboarding read.
    const sections = new Set(Object.values(rules.GROUPS).map((group) => group.section));
    expect([...sections].sort()).toEqual(['about', 'answers', 'preferences']);
  });

  it('keeps the page’s announcements in visually hidden channels', () => {
    for (const id of ['profile-status', 'profile-item-status']) {
      expect(elementById(profile, id), id).toMatch(
        /^<p class="sr-only" id="[\w-]+" role="status" aria-live="polite"><\/p>$/,
      );
    }
  });
});

describe('Profile need markers (R3-9)', () => {
  // The rows the page ships for each detail, so #field-<key> links resolve without script.
  const staticRow = (id: string): string =>
    profile.match(
      new RegExp(
        `<div class="profile-fact" id="${id.replace(/\./g, '\\.')}"><dt>([^<]+)</dt><dd></dd></div>`,
      ),
    )?.[0] ?? '';

  it('gives every detail the store lists one field-<key> wrapper, inside its group', () => {
    const view = seedView();
    for (const need of seedNeeds()) {
      const occurrences = profile.split(` id="${need.id}"`).length - 1;
      expect(occurrences, need.id).toBe(1);
      if (rules.COLLECTIONS[need.group]) {
        expect(profile).toContain(
          `<ul class="profile-items" id="${need.id}" data-items="${need.group}"`,
        );
        continue;
      }
      // The wrapper sits in its group's view list, labelled as the page renders it.
      const list =
        elementById(profile, need.group).match(
          /<dl class="profile-facts" data-view="[\w-]+">[\s\S]*?<\/dl>/,
        )?.[0] ?? '';
      expect(list, need.group).toContain(` id="${need.id}"`);
      const row = rules.GROUPS[need.group]?.rows(view).find((entry) => entry.need === need.key);
      expect(staticRow(need.id), need.id).toContain(`<dt>${row?.label}</dt>`);
    }
  });

  it('draws the shared markers from fieldStatus(): red required, the optional ring, with why', () => {
    const script = scriptOf(profile);
    // A missing detail is the shared need-add (button on a row, link in the header card),
    // with data-need from the store, the word in .need-add-word, and the store's why as a tip.
    expect(script).toContain("class: 'need-add',");
    expect(script).toContain("'data-need': status.need,");
    expect(script).toContain(`'data-tip-title': \`\${status.label} · \${word}\`,`);
    expect(script).toContain("'data-tip': status.why,");
    expect(script).toContain("el('span', { class: 'need-add-word', text: word })");
    // Editor fields for those details show the need pill while missing, never "(optional)".
    expect(script).toContain(
      "el('span', { class: 'need-pill', 'data-need': field.need.need, text: rules.needWord(field.need.need) })",
    );
    // Section list and headers: the marker in words and glyphs, never a count.
    expect(script).toContain(
      "el('span', { class: 'need-summary-part', 'data-need': entry.need }, srOnly(words))",
    );
    expect(profile).not.toMatch(/profile-nav-count|data-nav-count/);
    const nav = elementById(profile, 'profile-nav');
    expect(
      [
        ...nav.matchAll(
          /data-nav-need="(\w+)"( hidden)?>(<span class="need-summary-part" data-need="(\w+)">)?/g,
        ),
      ].map((m) => [m[1], m[4] ?? '']),
    ).toEqual([
      ['about', 'required'],
      ['career', ''],
      ['preferences', ''],
      ['answers', 'required'],
    ]);
    expect(elementById(profile, 'about')).toContain(
      '<span class="need-pill" data-need="required" data-section-status="about">Required details to add</span>',
    );
    // The page never restyles the shared markers; its own CSS only hides what it hides.
    const css = stylesOf(profile);
    expect(css).not.toMatch(/(^|[\s,}])\.need-(pill|add|summary)[^{]*\{/m);
  });

  it('updates the markers and the summary from the store after every save', () => {
    const script = scriptOf(profile);
    // Every render reads fieldStatus() and the metrics; the save announces the new counts.
    expect(script).toContain(
      "const needs = () => (typeof store?.fieldStatus === 'function' ? store.fieldStatus() : []);",
    );
    expect(script).toContain('const fields = needs();');
    // The figure and its word are one item inside each part (UAT-D2-7), so no marker gap sits
    // between them.
    // The overview's counts are the meters now (P-17); the need summary's are gone.
    expect(script).not.toContain('requiredPart.replaceChildren');
    expect(script).toContain(
      `announce(rules.GROUPS[groupId] ? \`\${group.title} saved. \${needsWords(needs())}\` : \`\${group.title} saved.\`);`,
    );
    // Filling a detail through the store drops it from the counts at once.
    const store = sampleStore();
    expect([
      store.metric('profile.missingRequired'),
      store.metric('profile.missingOptional'),
    ]).toEqual([2, 10]);
    const state = plain(store.get());
    rules.GROUPS['about-contact']?.apply(state, {
      phone: { countryCode: '+1', number: '206 555 0148' },
      city: 'Seattle',
      region: 'WA',
      country: 'US',
      postalCode: '98101',
      timezone: 'America/Los_Angeles',
      addressLine1: '',
      addressLine2: '',
    });
    (store as unknown as { update(change: unknown, mutate: (next: State) => void): void }).update(
      { type: 'test' },
      (next) => Object.assign(next.profile, { postalCode: state.profile.postalCode }),
    );
    expect(store.metric('profile.missingRequired')).toBe(1);
    expect(rules.missingNeeds(store.fieldStatus())[0]?.key).toBe('applicant.expectedCompensation');
  });
});

describe('Profile voluntary self-identification (#self-id)', () => {
  const store = sampleStore();
  const options = store.SELF_ID_OPTIONS;
  const group = elementById(profile, 'self-id');

  it('asks every voluntary question with inclusive options, from the store', () => {
    const fields = rules.selfIdFields(options);
    const optionsOf = (key: string) =>
      plain(fields.find((field) => field.key === key)?.options?.map(([, label]) => label));
    expect(optionsOf('gender')).toEqual([
      'Woman',
      'Man',
      'Non-binary',
      'Prefer to self-describe',
      'Prefer not to say',
    ]);
    // Prefer to self-describe opens a text field of your own words.
    const describe = fields.find((field) => field.key === 'genderSelfDescribe');
    expect(plain(describe?.when)).toEqual({ gender: 'self-describe' });
    expect(describe?.type).toBe('text');
    expect(optionsOf('ethnicity')).toEqual([
      'Hispanic or Latino',
      'Not Hispanic or Latino',
      'I don’t wish to answer',
    ]);
    // Race: the US EEO categories, more than one allowed, and "I don't wish to answer" alone.
    const race = fields.find((field) => field.key === 'race');
    expect(race?.type).toBe('checks');
    expect(race?.alone).toBe('decline');
    expect(optionsOf('race')).toEqual([
      'American Indian or Alaska Native',
      'Asian',
      'Black or African American',
      'Native Hawaiian or Pacific Islander',
      'White',
      'I don’t wish to answer',
    ]);
    expect(optionsOf('veteran')).toEqual([
      'I identify as one or more of the protected veteran groups',
      'I am not a protected veteran',
      'I don’t wish to answer',
    ]);
    expect(optionsOf('disability')).toEqual([
      'Yes, I have a disability, or have had one in the past',
      'No, I don’t have a disability',
      'I don’t wish to answer',
    ]);
    expect(plain(rules.SELF_ID_QUESTIONS.map(([key]) => key))).toEqual([
      'gender',
      'ethnicity',
      'race',
      'veteran',
      'disability',
    ]);
  });

  it('states the purpose plainly, stays neutral, and declines what is not answered', () => {
    expect(textOf(elementById(profile, 'self-id-purpose'))).toBe(
      'Only to answer employers’ voluntary questions. Never used to rank or filter roles. Change or clear it any time.',
    );
    expect(textOf(elementById(profile, 'self-id-note'))).toBe(
      'Not answered: your deputy chooses Decline to answer.',
    );
    expect(scriptOf(profile)).toContain(
      'Your deputy picks the employer’s own option that matches your answer, and declines when none does.',
    );
    // Neutral: no need markers, no counts, and the five questions read Not answered.
    expect(group).not.toMatch(/need-(pill|add|summary)|data-need=|data-metric=/);
    expect(
      textOf(
        group.match(/<dl class="profile-facts" data-view="self-id">[\s\S]*?<\/dl>/)?.[0] ?? '',
      ),
    ).toBe(
      'Gender Not answered Hispanic or Latino Not answered Race Not answered Protected veteran status Not answered Disability Not answered',
    );
    expect(plain(rules.selfIdRows(rules.readSelfId(store.get().selfId, options), options))).toEqual(
      rules.SELF_ID_QUESTIONS.map(([key, label]) => ({
        key,
        label,
        value: 'Not answered',
        quiet: true,
      })),
    );
  });

  it('saves through setSelfId, clears with clearSelfId, and is never counted', () => {
    const before = [
      store.metric('profile.missingRequired'),
      store.metric('profile.missingOptional'),
    ];
    const changes = rules.selfIdChanges({
      gender: 'self-describe',
      genderSelfDescribe: '  In my own words ',
      ethnicity: '',
      race: ['asian', 'white'],
      veteran: 'decline',
      disability: '',
    });
    expect(plain(changes)).toEqual({
      gender: 'self-describe',
      genderSelfDescribe: 'In my own words',
      ethnicity: null,
      race: ['asian', 'white'],
      veteran: 'decline',
      disability: null,
    });
    // "I don't wish to answer" stands alone; another gender drops the words.
    expect(
      plain(
        rules.selfIdChanges({
          gender: 'woman',
          genderSelfDescribe: 'x',
          race: ['asian', 'decline'],
        }),
      ),
    ).toMatchObject({
      gender: 'woman',
      genderSelfDescribe: null,
      race: ['decline'],
    });
    store.setSelfId(changes);
    const saved = rules.readSelfId(store.get().selfId, options);
    expect(rules.selfIdAnswered(saved)).toBe(true);
    expect(plain(rules.selfIdRows(saved, options).map((row) => row.value))).toEqual([
      'Prefer to self-describe: In my own words',
      'Not answered',
      'Asian, White',
      'I don’t wish to answer',
      'Not answered',
    ]);
    // Never counted as missing, and never a detail the store lists.
    expect([
      store.metric('profile.missingRequired'),
      store.metric('profile.missingOptional'),
    ]).toEqual(before);
    expect(store.fieldStatus().some((need) => /self/i.test(need.key))).toBe(false);
    store.clearSelfId();
    expect(rules.selfIdAnswered(rules.readSelfId(store.get().selfId, options))).toBe(false);
    expect((store.get().selfId as { mode?: string }).mode).toBe('decline');
  });
});

describe('Profile Keep watch (moved to Searches in round 6 part 2, P-1)', () => {
  it('keeps one line that links to Searches, where Keep watch and its runs live', () => {
    const watch = elementById(profile, 'watch');
    expect(watch).toMatch(/^<div class="profile-group" id="watch">/);
    expect(textOf(watch)).toBe(
      'Keep watch checks your sources every night. It’s in Searches , Keep watch',
    );
    expect(watch).toContain('<a class="chart-action" href="./searches-preview.html#keep-watch">');
    expect(sourceFor('searches-preview.html')).toContain('id="keep-watch"');
    // No ring, no runs, no sources here: their figures and controls are Searches' (and the runs'
    // home is Purchases, P-2).
    expect(profile).not.toMatch(/data-metric="(watch|runs)\./);
    expect(scriptOf(profile)).not.toMatch(/renderWatch|multiSelect|allowance\?\.\(\)/);
    expect(rules.GROUPS['pref-schedule']).toBeUndefined();
  });
});

describe('Profile Found while applying (#found, round 5 R2)', () => {
  const found = elementById(profile, 'found');

  it('leads with the store’s figures, then what forms found, each with its tag and where it went', () => {
    const store = sampleStore();
    expect(found).toMatch(
      /^<section class="task-surface profile-section" id="found" aria-labelledby="found-title">/,
    );
    for (const key of ['profile.found', 'profile.found.waiting', 'profile.found.saved']) {
      expect(found, key).toContain(
        `<strong data-metric="${key}">${store.metricText(key)}</strong>`,
      );
    }
    expect(textOf(elementById(profile, 'profile-stats'))).toBe('4 found 3 waiting for you 1 saved');
    expect(found).toContain(
      '<ul class="profile-items" id="profile-found-list" aria-labelledby="found-forms-title"></ul>',
    );
    // The seed's four, newest first: three empty from Google's form, travel saved from Woodgrove.
    const seed = plain(store.discoveredFields());
    expect(seed.map((entry) => [entry.key, entry.tag, entry.saved])).toEqual([
      ['found.noticeEndDate', 'New · from Google’s form, Oct 1', false],
      ['applicant.earliestStartDate', 'New · from Google’s form, Oct 1', false],
      ['profile.links.github', 'New · from Google’s form, Oct 1', false],
      ['applicant.maxTravelPercent', 'New · from Woodgrove Bank’s form, Sep 23', true],
    ]);
    // Add or Edit opens the field in its own section; an empty one can go.
    const needs = seedNeeds();
    expect(seed.map((entry) => rules.foundGoto(entry, needs))).toEqual([
      'ans-availability:noticeEndDate',
      'ans-availability:earliestStartDate',
      'about-links:github',
      'ans-moves:maxTravelPercent',
    ]);
    expect(seed.map((entry) => rules.foundRemovable(entry))).toEqual([true, true, true, false]);
    const script = scriptOf(profile);
    expect(script).toContain(
      "const all = typeof store?.discoveredFields === 'function' ? store.discoveredFields() : [];",
    );
    expect(script).toContain(
      "const result = store?.saveDiscoveredField?.(key, '', { keep: false });",
    );
    expect(script).toContain("needButton('button', status, { type: 'button', 'data-goto': goto })");
    // Removing one leaves Found and its section, and the need summary drops it (W33, W28).
    const before = store.metric('profile.missingOptional');
    expect(store.saveDiscoveredField('profile.links.github', '', { keep: false })).toMatchObject({
      ok: true,
      kept: false,
    });
    expect(store.discoveredFields().map((entry) => entry.key)).not.toContain(
      'profile.links.github',
    );
    expect(store.metric('profile.missingOptional')).toBe(Number(before) - 1);
  });

  it('tags each found detail in its section, and keeps the notice end date with the found field', () => {
    const script = scriptOf(profile);
    expect(script).toContain("const found = status?.discovered?.tag ?? '';");
    expect(script).toContain(
      "found ? el('span', { class: 'profile-found-tag', 'data-found-tag': '', text: found }) : null,",
    );
    // The source tag is a line, never the shared pill: .tag is one line by the component
    // contract, and a company name plus a date cannot shrink, so a pill here stretched the
    // Answers column and the page scrolled sideways at 320px under WCAG 1.4.12 text spacing
    // (UAT-A). Every source tag wraps instead.
    expect(profile).not.toMatch(/class: 'tag profile-found-tag'/);
    const css = stylesOf(profile);
    expect(css).toMatch(/\.profile-found-tag \{[^}]*font-size: 12px;/);
    expect(css).not.toMatch(/\.profile-found-tag[^{]*\{[^}]*white-space/);
    const tagged = seedNeeds()
      .filter((need) => (need as Need & { discovered?: { tag: string } }).discovered)
      .map((need) => need.id);
    expect(tagged).toEqual([
      'field-profile.links.github',
      'field-applicant.earliestStartDate',
      'field-found.noticeEndDate',
      'field-applicant.maxTravelPercent',
    ]);
    // Availability gains the end date's row (after Earliest start date) while its find is kept.
    const availability = () =>
      plain(rules.GROUPS['ans-availability']?.rows(rules.read(store.get())) ?? []).map((row) => [
        row.key,
        row.value ?? '',
        row.need ?? '',
      ]);
    const store = sampleStore();
    expect(availability()).toEqual([
      ['noticePeriodDays', '14 days', 'applicant.noticePeriodDays'],
      ['earliestStartDate', '', 'applicant.earliestStartDate'],
      ['noticeEndDate', '', 'found.noticeEndDate'],
    ]);
    expect(profile).toContain(
      '<div class="profile-fact" id="field-found.noticeEndDate"><dt>Notice period end date</dt><dd></dd></div>',
    );
    // Its editor saves through saveDiscoveredField (checked and dated); clearing it keeps it found.
    expect(script).toContain('if (next) store?.saveDiscoveredField?.(storeKey, next);');
    expect(script).toContain(
      'else write(group.section, (state) => rules.clearFound(state, storeKey));',
    );
    expect(store.saveDiscoveredField('found.noticeEndDate', '2026-10-30').ok).toBe(true);
    expect(availability()[2]).toEqual(['noticeEndDate', 'Oct 30, 2026', 'found.noticeEndDate']);
    const state = plain(store.get());
    expect(rules.clearFound(state, 'found.noticeEndDate')).toBe(true);
    expect(rules.read(state).found).toMatchObject({
      noticeEndDate: '',
      kept: { noticeEndDate: true },
    });
    // Not kept, it leaves the section (and the editor, through the field's shown()).
    const dropped = sampleStore();
    dropped.saveDiscoveredField('found.noticeEndDate', '', { keep: false });
    const view = rules.read(dropped.get());
    expect(view.found).toMatchObject({ kept: { noticeEndDate: false } });
    expect(rules.GROUPS['ans-availability']?.rows(view).map((row) => row.key)).toEqual([
      'noticePeriodDays',
      'earliestStartDate',
    ]);
    expect(script).toContain(
      'const specs = group.fields.filter((field) => !field.shown || field.shown(view)).map((field) => ({',
    );
    expect(rules.NEED_ADD['found.noticeEndDate']).toBe('Add notice period end date');
  });
});

describe('Profile From LinkedIn (#found-linkedin, round 5 G2 and R2)', () => {
  it('lists what you imported from LinkedIn under Found, tagged in its section; the import lives in Connections', () => {
    const group = elementById(profile, 'found-linkedin');
    expect(elementById(profile, 'found')).toContain(
      '<div class="profile-group" id="found-linkedin">',
    );
    expect(group).toContain(
      '<ul class="profile-items" id="profile-linkedin-list" aria-labelledby="found-linkedin-title" hidden></ul>',
    );
    expect(group).toContain(
      '<a class="compact-action profile-link-action" href="./connections-preview.html#linkedin">Import<span class="sr-only"> from LinkedIn in Settings, Connections</span></a>',
    );
    expect(textOf(elementById(profile, 'profile-linkedin-empty'))).toBe(
      'Nothing imported yet. Import your LinkedIn data in Settings, Connections, and choose what joins your profile.',
    );
    const script = scriptOf(profile);
    expect(script).toContain("$('#profile-linkedin-empty').hidden = imported.length > 0;");
    // After an import (in Connections), each joins its section, tagged on its item.
    const store = sampleStore();
    expect(signOctober(store).ok).toBe(true);
    const items = store.linkedinImport().items;
    const ticked = items
      .filter((item) => item.compare !== 'same')
      .map((item) => item.key)
      .filter((key) => !['profile.summary', 'profile.skills.terraform'].includes(key));
    expect(store.applyLinkedinImport(ticked)).toMatchObject({ ok: true });
    const linkedin = store.discoveredFields().filter((entry) => entry.source === 'linkedin');
    expect(linkedin).toHaveLength(6);
    const view = rules.read(store.get());
    const experience = view.career.experience.map((entry) => entry.id);
    for (const entry of linkedin.filter((item) => item.kind === 'position')) {
      expect(experience, entry.key).toContain((entry.raw as { id: string }).id);
    }
    expect(script).toContain(
      `if (collection && entry.raw?.id) tags.set(\`\${collection}:\${entry.raw.id}\`, entry.tag);`,
    );
    expect(script).toContain(
      `el('p', { class: 'timeline-title' }, [\`\${item.title}, \${item.company}\`, foundTagNode('career-experience', item.id)]),`,
    );
    // Found lists them under From LinkedIn, with Edit to their own place.
    const needs = plain(store.fieldStatus());
    expect(
      linkedin
        .map((entry) => rules.foundGoto(entry, needs))
        .filter((goto) => goto.startsWith('edit:')),
    ).toEqual(
      expect.arrayContaining(['edit:career-experience:tailspin', 'edit:career-experience:litware']),
    );
    expect(script).toContain(
      'const importRows = imported.map((entry) => foundItem(entry, fields));',
    );
    expect(script).toContain('replaceIfChanged(linkedinList, importRows);');
  });
});

describe('Profile growing lists (R6-4)', () => {
  it('shows the first five of each list that grows as you apply, and Show all N opens the rest in place', () => {
    const script = scriptOf(profile);
    for (const part of [
      "'ans-saved': { first: 5, noun: ['saved answer', 'saved answers'] },",
      "'pref-companies': { first: 5, noun: ['company rule', 'company rules'] },",
      "found: { first: 5, noun: ['found detail', 'found details'] },",
      "linkedin: { first: 5, noun: ['imported detail', 'imported details'] },",
      'if (!open && index >= first) row.hidden = true;',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the page's own source text, matched as written
      "const words = open ? 'Show fewer' : `Show all ${total} ${total === 1 ? noun[0] : noun[1]}`;",
      'capItems(formRows, foundList, CAPPED.found);',
      'syncMore(linkedinList, imported.length, CAPPED.linkedin);',
    ]) {
      expect(script, part).toContain(part);
    }
    // Keep watch's sources are the shared multi-select (above); the details to add are at most
    // what fieldStatus() names, so they open in place (the overview).
    expect(sampleStore().fieldStatus().length).toBeLessThanOrEqual(40);
  });
});

describe('Profile Gmail and site accounts (moved to Settings, Connections in round 6)', () => {
  it('keeps no connection of its own; their tests moved to connections.test.ts', () => {
    const script = scriptOf(profile);
    expect(script).not.toMatch(
      /gmailOf|renderGmail|renderSites|revealSitePassword|connectLinkedin|applyLinkedinImport|linkedinImport\(\)/,
    );
    const connections = sourceFor('connections-preview.html');
    for (const id of ['gmail', 'linkedin', 'site-accounts', 'keys']) {
      expect(connections, id).toContain(`id="${id}"`);
    }
  });
});

describe('Profile figures, tour, and reactions', () => {
  it('carries every figure as data-metric, once, equal to the store on the seed (R3-3, R3-4)', () => {
    const store = sampleStore();
    const shown = [...main.matchAll(/data-metric="([\w.]+)">([^<]*)</g)].map(
      (match): [string, string] => [match[1] ?? '', match[2] ?? ''],
    );
    const keys = shown.map(([key]) => key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        'profile.requiredDone',
        'profile.required',
        'profile.optionalDone',
        'profile.optional',
        'profile.found',
        'profile.found.waiting',
        'profile.found.saved',
      ]),
    );
    // Round 6 part 2: Keep watch's figures are Searches' (P-1), and the need summary's counts
    // left with it (P-17).
    expect(keys.filter((key) => /^(watch|runs)\./.test(key))).toEqual([]);
    expect(keys).not.toContain('profile.missingRequired');
    // What moved took its figures along (Account and Connections show them now).
    for (const key of [
      'ai.credits.left',
      'ai.model.name',
      'gmail.connectedAt',
      'gmail.lastCheckedAt',
      'sites.accounts',
      'vault.reveals',
    ]) {
      expect(keys, key).not.toContain(key);
    }
    // AI runs are retired (round 5): none of their keys is shown.
    expect(keys.filter((key) => /^ai\.(platform|bonus|topups)/.test(key))).toEqual([]);
    for (const [key, text] of shown) expect(text, key).toBe(store.metricText(key));
    expect(scriptOf(profile)).toContain("for (const node of $$('main [data-metric]')) {");
  });

  it('never hard-codes the header offset: it reads the page’s scroll padding', () => {
    const script = scriptOf(profile);
    expect(script).not.toMatch(/getBoundingClientRect\(\)\.top\s*<=?\s*\d/);
    expect(script).toContain(
      'Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 89;',
    );
    expect(script).toContain(
      "if (edit.getBoundingClientRect().top < scrollPad()) host.scrollIntoView({ block: 'start' });",
    );
  });

  it('marks its tour in page order, in the deputy’s first person: what is missing, a field marker, self-identification, found details (R6-2)', () => {
    const steps = [
      ...profile.matchAll(
        /data-tour-step="(\d)"\s+data-tour-title="([^"]+)"\s+data-tour-text="([^"]+)"/g,
      ),
    ].map((match) => [match[1], match[2]]);
    expect(steps).toEqual([
      ['1', 'Here is what I still need.'],
      ['3', 'I decline what you skip.'],
      ['4', 'I keep what forms asked.'],
    ]);
    // Step 2 rings the first field that needs you, drawn with its row.
    expect(scriptOf(profile)).toContain("'data-tour-step': '2',");
    for (const [, title] of steps) expect(words(title ?? ''), title).toBeLessThanOrEqual(6);
    for (const text of [...profile.matchAll(/data-tour-text="([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    )) {
      expect(text, 'first person').toMatch(/\b(I|I’m|I’ll)\b/);
    }
    expect(scriptOf(profile)).toContain("'data-tour-title': 'I mark each missing field.',");
    expect(profile).not.toMatch(/green is left|blue is runs you added|hatched is used/);
    for (const text of [...profile.matchAll(/data-tour-text="([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    )) {
      expect(words(text), text).toBeLessThanOrEqual(30);
      expect(text, 'no dashes').not.toMatch(/[–—]/);
    }
  });

  it('rings small tour targets: self-identification is its heading and purpose, not the whole group', () => {
    expect(elementById(profile, 'self-id')).toMatch(
      /<div\s+class="profile-group-intro"\s+data-tour-step="3"/,
    );
  });

  it('keeps the field an editor opens for in view, clear of the fixed chrome', () => {
    const script = scriptOf(profile);
    const open = script.slice(
      script.indexOf('function openEditor('),
      script.indexOf('function closeEditor('),
    );
    expect(open).toContain('revealField(host, target?.node);');
    expect(open).not.toContain("host.scrollIntoView({ block: 'start'");
    const reveal = script.slice(
      script.indexOf('function revealField('),
      script.indexOf('function closeEditor('),
    );
    expect(reveal).toContain('const pad = scrollPad();');
    expect(reveal).toContain(
      'top = Math.min(Math.max(start, fieldBottom - (window.innerHeight - room)), fieldTop - pad);',
    );
    // 'auto' follows the page's smooth scrolling, which Pause motion and reduced motion stop.
    expect(reveal).toContain("window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });");
    expect(script).not.toMatch(/behavior: reducedMotion\.matches \? 'auto' : 'smooth'/);
  });

  it('writes every example placeholder as e.g., so an empty field never looks filled', () => {
    const script = scriptOf(profile);
    const examples = [
      ...script.matchAll(/placeholder: (?:field\.placeholder \?\? \()?'([^']+)'/g),
    ].map((match) => match[1] ?? '');
    expect(examples.length).toBeGreaterThanOrEqual(15);
    for (const example of examples) expect(example, example).toMatch(/^e\.g\. /);
    // Both pay amounts read the same hint, with the separator the field accepts.
    expect(script).toContain("placeholder: 'e.g. 185,000',");
    expect(rules.parseMoney({ amount: '185,000', currency: 'USD', period: 'year' })).toMatchObject({
      amount: 185000,
    });
    // The password fields, whose hints are not examples, moved to Settings, Account.
  });

  it('reacts once to each action, through react(), never a success flash', () => {
    const script = scriptOf(profile);
    expect(script).toContain('const react = (name, options) => deputy?.react?.(name, options);');
    expect(script).not.toMatch(/flash\('(success|error)'/);
    for (const call of [
      "react('saved', { speech: group.speech ?? SPEECH[group.section] });",
      "react('approved', { speech: 'I’ll use that answer.' });",
      "react('saved', { speech: 'Cleared. I’ll decline these.' });",
      "react('error');",
    ]) {
      expect(script, call).toContain(call);
    }
    for (const [, speech] of script.matchAll(/speech: '([^']+)'/g)) {
      expect(words(speech ?? ''), speech).toBeLessThanOrEqual(6);
    }
  });
});
