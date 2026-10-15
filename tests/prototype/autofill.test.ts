import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Page guarantees for the autofill preview, brand/autofill-preview.html (round 2 brief 4.6 and
// the owner's finding F3; round 3 brief 4.5 and finding 31): a child route of Applications where
// your deputy fills a generic employer form from your profile, stops for what needs you, and waits
// for your review. The page says these are the exact answers your deputy will submit and when the
// form was read, fills voluntary self-identification from Profile with a per-application override,
// shows the account step on the employer's site (planned: your email, your vault, and Gmail for the
// one-time code), and opens the answer prompt. Nothing is sent. The page's model (the block between
// its AutofillModel markers) runs here against the shared sample store, so the static seed markup,
// the run, and the review are checked against the same data the page renders. The rendered checks
// (contrast, 44px targets, overflow, focus) run in scripts/ui-audit.mjs, and the timed run in
// headless Chrome.

const repoRoot = resolve(import.meta.dirname, '../..');
const sourceFor = (file: string): string => readFileSync(resolve(repoRoot, 'brand', file), 'utf8');
const page = sourceFor('autofill-preview.html');
const applications = sourceFor('applications-preview.html');
const storeSource = sourceFor('sample-store.js');
const dataModel = readFileSync(resolve(repoRoot, 'docs/data-model.md'), 'utf8');

const main = page.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? '';
const header = page.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
const inlineScript = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1] ?? '')
  .join('\n');
const modelSource =
  inlineScript.match(/\/\/ AutofillModel: start([\s\S]*?)\/\/ AutofillModel: end/)?.[1] ?? '';

// Code quoted from the page, written with $( for ${ so a plain string can hold it.
const code = (text: string): string => text.replace(/\$\(/g, '${');
const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
const squash = (html: string): string => html.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
const markedBlock = (source: string, name: string): string =>
  source.match(new RegExp(`<!-- ${name}: start -->([\\s\\S]*?)<!-- ${name}: end -->`))?.[1] ?? '';

type Step = { date: string; label: string; by: string };
type App = {
  id: string;
  stage: string;
  approval?: string;
  materials?: string;
  timeline: Step[];
} & Record<string, unknown>;
type State = Record<string, unknown> & {
  applications: App[];
  autofill?: Record<string, unknown>;
  selfId: Record<string, unknown>;
  connections: { gmail: Record<string, unknown> };
  answers: Array<{ id: string; approved?: boolean; answer?: string }>;
  applicant: Record<string, unknown>;
};
type Gmail = { status: string; email: string; reads: string[]; never: string[] };
type Account = {
  id: string;
  site: string;
  username: string;
  passwordMode: string;
  status: string;
  lastCode: { readAt: string; used: boolean } | null;
};
type Site = { appId: string; company: string; site: string; account: Account | null };
type AccountInput = {
  site?: string;
  email?: string;
  gmail?: Gmail | null;
  gate?: { version: string } | null;
  paused?: boolean;
  account?: Account | null;
  active?: boolean;
  signHref?: string;
  code?: { code: string; from: string; receivedAt: string } | null;
};
type Store = {
  get(): State;
  update(change: unknown, mutate: (next: State) => void): State;
  moveApplication(id: string, stage: string, fields?: Record<string, unknown>): App | null;
  application(id: string): App | null;
  addApplication(entry: Record<string, unknown>): App | null;
  setSelfId(fields: Record<string, unknown>): unknown;
  disconnectGmail(): unknown;
  connectGmail(): unknown;
  connections(): { gmail: Gmail };
  siteFor(appId: string): Site | null;
  requiresAgreement(feature: string): { version: string } | null;
  signAgreement(fields: Record<string, unknown>): { ok: boolean };
  createSiteAccount(fields: Record<string, unknown>): {
    ok: boolean;
    reason?: string;
    why?: string;
    account?: Account;
  };
  readOneTimeCode(site: string): { ok: boolean; code?: string; from?: string; reason?: string };
  revealSitePassword(id: string, options?: { action?: string }): { ok: boolean; password?: string };
  passwordCheck(password: string): {
    ok: boolean;
    length: number;
    strength: string;
    problems: Array<{ id: string; text: string }>;
  };
  saveDiscoveredField(
    key: string,
    value: unknown,
    options?: Record<string, unknown>,
  ): { ok: boolean; kept: boolean };
  discoveredFields(): Array<{ key: string; tag: string; value: string; saved: boolean }>;
  metricText(key: string): string;
  setAgreementDemo(mode: string | null): unknown;
  SELF_ID_OPTIONS: Record<string, Array<{ id: string; label: string }>>;
};
type Field = {
  id: string;
  section: string;
  step: string;
  label: string;
  value: string;
  meta?: string;
  source: string;
  state: string;
  ask?: string | null;
};
type View = {
  app: App;
  phase: string;
  ran: boolean;
  fields: Field[];
  counts: {
    total: number;
    filled: number;
    answered: number;
    skipped: number;
    needs: number;
    done: number;
  };
  record: Record<string, unknown>;
};
type Model = {
  TODAY: string;
  DEFAULT_APP: string;
  STEPS: Array<{ id: string; label: string }>;
  SECTIONS: Array<{ id: string; title: string }>;
  SOURCES: Record<string, string>;
  SELF_ID_FIELDS: Array<{ id: string; key: string; label: string }>;
  RUN: Array<{ step: string; fields: string[]; ms: number }>;
  parseAmount(text: string): number | null;
  money(value: unknown): string;
  resolveApp(state: State, id: string | null): { app: App | null; missing: string | null };
  viewOf(state: State, app: App): View;
  selfIdText(key: string, answers: Record<string, unknown>): string;
  cleanSelfId(values: Record<string, unknown>): Record<string, unknown>;
  formRead(
    app: App,
    record: Record<string, unknown>,
  ): { added: string | null; again: string | null; text: string };
  stepsFor(
    view: View,
    progress?: string | null,
    options?: { account?: { site: string; status: string } | null; scan?: string | null },
  ): Array<{ id: string; status: string; detail: string }>;
  statusOf(view: View, filling?: boolean): { text: string; tone: string };
  sourcesOf(view: View): Array<{ source: string; label: string; value: number }>;
  fieldHtml(field: Field, options?: { ask?: string }): string;
  valueHtml(field: Field, options?: { editable?: boolean }): string;
  sectionCount(fields: Field[]): string;
  stepsHtml(steps: unknown[]): string;
  accountStepsOf(
    input: AccountInput,
  ): Array<{ id: string; state: string; title: string; detail: string }>;
  accountStepsHtml(input: AccountInput): string;
  accountTitle(app: App): string;
  signHrefFor(appId: string): string;
  scanFieldsOf(
    view: View,
  ): Array<{ id: string; label: string; source: string; value: string; need: string }>;
  scanNote(record: Record<string, unknown>, view?: View): string;
  passwordCheckText(check: unknown): string;
  selfIdControlsHtml(answers: Record<string, unknown>): string;
  stagePill(app: App): { text: string; tone: string };
  applyModeText(settings: unknown): string;
};

// A fresh store and the page's model, with nothing shared between tests.
function load(): { store: Store; model: Model } {
  const storage = new Map<string, string>();
  // The browser's crypto.getRandomValues makes site passwords and one-time codes (R5-6).
  const window: Record<string, unknown> = { addEventListener: () => {}, crypto: globalThis.crypto };
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  const context = { window, localStorage, JSON, crypto: globalThis.crypto };
  runInNewContext(sourceFor('agreement-text.js'), context);
  runInNewContext(storeSource, context);
  runInNewContext(`${modelSource}\nwindow.AutofillModel = AutofillModel;`, context);
  return { store: window.JobDeputyStore as Store, model: window.AutofillModel as Model };
}

// The seed, approved on Materials, with this page's record for the role.
function prepared(record: Record<string, unknown> | null) {
  const { store, model } = load();
  store.moveApplication('search-infra', 'approval', {
    label: 'Materials approved',
    approval: 'approved',
    materials: 'approved',
  });
  if (record) {
    store.update({ type: 'autofill' }, (next) => {
      next.autofill = { 'search-infra': record };
    });
  }
  const state = store.get();
  const app = model.resolveApp(state, 'search-infra').app as App;
  return { store, model, view: model.viewOf(state, app) };
}

const SELF_ID_IDS = ['gender', 'ethnicity', 'race', 'veteran', 'disability'];

describe('autofill-preview.html: a child route of Applications', () => {
  it('loads the shell scripts in order, app-panels.js last, then its own script', () => {
    const order = [
      'app-shell.js',
      'app-components.js',
      'sample-store.js',
      'deputy.js',
      'feedback.js',
      'app-panels.js',
    ].map((file) => page.indexOf(`<script src="./${file}"></script>`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(page.slice(order[4]).replace(/\s+/g, ' ')).toMatch(
      /^<script src="\.\/feedback\.js"><\/script> <script src="\.\/app-panels\.js"><\/script> <script>/,
    );
  });

  it('copies the chrome byte for byte from an existing internal page', () => {
    const blocks = (source: string) => ({
      root: source.match(/:root \{[\s\S]*?\n {6}\}/)?.[0],
      links: source.match(
        /<link rel="icon"[\s\S]*?<link rel="stylesheet" href="\.\/deputy\.css" \/>/,
      )?.[0],
      headerActions: markedBlock(source, 'HeaderActions'),
      accountMenu: source.match(/<details class="account-menu">[\s\S]*?<\/details>/)?.[0],
      menu: source.match(/<div class="app-menu">[\s\S]*?<\/div>/)?.[0],
      nav: markedBlock(source, 'AppNav').replace(/ aria-current="(?:page|true)"/g, ''),
      dock: markedBlock(source, 'DeputyDock')
        .replace(/data-deputy-page="[^"]*"/, '')
        .replace(/data-deputy-state="[^"]*"/, '')
        .replace(/(<p class="deputy-speech" data-deputy-speech>)[^<]*/, '$1')
        .replace(/(<span data-deputy-duty>)[^<]*/, '$1'),
      footer: source.match(/<footer[\s\S]*?<\/footer>/)?.[0],
    });
    const mine = blocks(page);
    const theirs = blocks(applications);
    for (const key of Object.keys(theirs) as Array<keyof typeof theirs>) {
      expect(mine[key], key).toBeTruthy();
      expect(mine[key], key).toBe(theirs[key]);
    }
  });

  it('marks Applications current as its parent section, and names it on the Menu button', () => {
    const nav = markedBlock(page, 'AppNav');
    expect(nav.match(/aria-current="[^"]*"/g)).toEqual(['aria-current="true"']);
    expect(nav).toContain(
      '<a class="app-nav-link" href="./applications-preview.html" aria-current="true">',
    );
    expect(
      textOf(page.match(/<span class="app-menu-text">[\s\S]*?<\/span><\/span>/)?.[0] ?? ''),
    ).toBe('Menu · Applications');
  });

  it('puts the Back action between HeaderActions and the account menu', () => {
    const after = header.slice(
      header.indexOf('<!-- HeaderActions: end -->') + 27,
      header.indexOf('<details class="account-menu">'),
    );
    expect(after.trim()).toBe(
      '<a class="header-action" id="autofill-back" href="./applications-preview.html">← Applications</a>',
    );
    // Back returns to the role's details, or (round 7, R10-3) to the board you came from: a card's
    // Watch it carries return=, and Back goes there through the shared place helper, which
    // restores where you were.
    expect(inlineScript).toMatch(
      /applications: `\.\/applications-preview\.html\?open=\$\{encodeURIComponent\(appId\)\}`,/,
    );
    expect(inlineScript).toContain(
      'const cameFrom = window.JobDeputyComponents?.place?.back ?? null;',
    );
    expect(inlineScript).toContain('back.href = backTo ?? hrefs().applications;');
    expect(inlineScript).toContain("if (backTo) back.setAttribute('data-page-back-link', '');");
    // Only a way back to Applications is taken from return=; anything else keeps the role's panel.
    expect(inlineScript).toContain(
      'const backTo = cameFrom && /^\\.\\/applications-preview\\.html(?:[?#]|$)/.test(cameFrom.href) ? cameFrom.href : null;',
    );
    // The card's Watch it and the panel's preview link carry return= to this page.
    const apps = sourceFor('applications-preview.html');
    expect(apps).toContain(
      'class="chart-action run-tracker-watch" href=$' + '{attr(watchHref(job))} data-return-link',
    );
    expect(apps).toMatch(
      /id="apps-drawer-fill-link"\s+href="\.\/autofill-preview\.html\?app=search-infra"\s+data-return-link/,
    );
  });

  it('rests the deputy in fill, the state that names this page’s work', () => {
    const dock = markedBlock(page, 'DeputyDock');
    expect(dock).toContain('data-deputy-page="autofill"');
    expect(dock).toContain('data-deputy-state="fill"');
    expect(dock).toContain(
      '<p class="deputy-speech" data-deputy-speech>I fill what you approved.</p>',
    );
    expect(dock).toContain('<span data-deputy-duty>Filling forms</span>');
    // One panda per viewport: the dock is the only drawing.
    expect(page.match(/data-deputy-art/g)).toHaveLength(1);
  });

  it('opens with the intro, the role, and the honest labels', () => {
    expect(main).toContain('<p class="eyebrow">Applications · Autofill preview</p>');
    expect(textOf(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')).toBe(
      'Fill the application.',
    );
    expect(main).toContain(
      '<span class="company-mark" id="af-role-mark" aria-hidden="true">G</span>',
    );
    expect(main).toContain(
      'id="af-role-title">Senior Software Engineer, Search Infrastructure</span>',
    );
    // Round 6 (P-13): while the materials wait for you, the gate's notice says so once, so the
    // header's chip (and the run's) ship hidden at the gate.
    expect(main).toContain('id="af-role-stage" hidden>Approval · waiting for you</span>');
    expect(main).toContain('id="af-run-status" hidden>Waiting for your approval</span>');
    expect(inlineScript).toContain("roleStage.hidden = view.phase === 'gate';");
    expect(textOf(main).match(/Waiting for your approval|waiting for you/g)?.length).toBe(2);
    expect(main).toContain('<span class="status-pill is-neutral">Planned for launch</span>');
    expect(main).toContain('<p class="sample-note">Sample data · not connected</p>');
    expect(textOf(main)).toContain('In this prototype nothing is sent.');
    expect(main).toMatch(
      /<details class="af-how">\s*<summary class="af-how-toggle">How this works<\/summary>/,
    );
  });

  it('uses the shared components and one primary action at a time', () => {
    // The run's button (Start filling, then what comes next), the run's link on (the gate's
    // Review materials), and the review's Submit application never show together.
    expect(main.match(/class="primary-action"/g)).toHaveLength(3);
    expect(main).toMatch(
      /<button class="primary-action" id="af-run-action" type="button" data-does="ready" hidden>Start filling<\/button>/,
    );
    expect(main).toMatch(/<div class="af-review-body" id="af-review-body" hidden>/);
    expect(inlineScript).toContain('runLink.hidden = !panel;');
    expect(inlineScript).toContain('runButton.hidden = !label;');
    expect(main).toMatch(
      /class="meter is-stepped"\s+id="af-meter"\s+role="meter"[\s\S]*?aria-valuemax="20"/,
    );
    expect(main).toContain('<ol class="timeline af-steps" id="af-steps"');
    expect(main).toContain('<div class="stack-bar" id="af-sources-bar" aria-hidden="true"></div>');
    // The chart's colours carry a key (meanings on touch, tooltips on hover and focus).
    expect(main).toContain(
      '<ul class="chart-key is-compact is-inline" id="af-sources-legend" aria-label="Where the answers came from"></ul>',
    );
    expect(page.match(/role="status"/g)?.length).toBe(
      (markedBlock(page, 'DeputyDock').match(/role="status"/g)?.length ?? 0) + 1,
    );
    expect(main).toContain(
      '<p class="sr-only" id="af-announcement" role="status" aria-live="polite"></p>',
    );
  });

  it('names Job matches, never Jobs, and writes no dashes as punctuation', () => {
    const copy = textOf(page.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '')).replace(
      /Amazon Jobs/g,
      '',
    );
    expect(copy).not.toMatch(/\bJobs\b/);
    expect(textOf(main)).not.toMatch(/[\u2013\u2014]/);
    const strings = inlineScript.replace(/\/\/.*$/gm, '').match(/'[^'\n]*'|`[^`\n]*`/g) ?? [];
    expect(strings.filter((text) => /[\u2013\u2014]/.test(text))).toEqual([]);
  });

  // Round 4, UAT-A-2: the run sticks under the header only while all of it fits there, so no
  // focus stop inside it (its last link) lands below the screen.
  it('keeps the run sticky only while it fits under the header', () => {
    const styles = [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
      .map((match) => match[1] ?? '')
      .join('');
    expect(styles).toContain('@media (min-width: 1101px) {');
    expect(styles).toMatch(/\.af-run\[data-fits\] \{\s*position: sticky;\s*top: 89px;\s*\}/);
    expect(styles).not.toMatch(/\.af-run \{\s*position: sticky;/);
    expect(inlineScript).toContain(
      "runSection.toggleAttribute('data-fits', top + runSection.offsetHeight + 13 <= window.innerHeight);",
    );
    expect(inlineScript).toContain('getComputedStyle(document.documentElement).scrollPaddingTop');
    expect(inlineScript).toContain('new ResizeObserver(fitRun).observe(runSection);');
  });

  it('parses as a classic script', () => {
    expect(() => new Script(inlineScript)).not.toThrow();
  });
});

describe('autofill-preview.html: the exact answers, and when the form was read (finding 31)', () => {
  it('says plainly these are the exact answers your deputy will submit, not the employer’s page', () => {
    const head = main.match(/<div class="af-form-head">[\s\S]*?<\/details>/)?.[0] ?? '';
    expect(textOf(head)).toContain('What your deputy submits.');
    expect(main).toContain(
      '<p class="af-form-lede" id="af-form-note">These are the exact answers your deputy will submit for this role. Google’s page looks different.</p>',
    );
    expect(inlineScript).toContain(
      code(
        "formNote.textContent = `These are the exact answers your deputy will submit for this role. $(app.company ? `$(app.company}’s` : 'The employer’s'} page looks different.`;",
      ),
    );
    // Before the run, each row already shows, dashed, the answer your deputy will give.
    const { store, model } = load();
    const state = store.get();
    const view = model.viewOf(state, model.resolveApp(state, 'search-infra').app as App);
    const name = view.fields.find((field) => field.id === 'name') as Field;
    expect(name.state).toBe('waiting');
    expect(textOf(model.valueHtml(name))).toBe(
      'Not filled yet; your deputy will fill: Alex Morgan',
    );
    expect(model.valueHtml(name)).toContain('class="af-box is-empty"');
  });

  it('says when the form was read: when you added the role, and again just before filling', () => {
    const { store, model } = load();
    const app = store.application('search-infra') as App;
    // Search Infrastructure was added to Applications (Shortlisted, by you) on Oct 2 (the store's
    // round 7 follow-ups moved it from Oct 1).
    expect(model.formRead(app, {}).text).toBe(
      'Read Oct\u00a02 when you added the role; read again just before filling.',
    );
    expect(main).toContain(`<span id="af-form-read">${model.formRead(app, {}).text}</span>`);
    expect(model.formRead(app, { readAgainAt: '2026-10-02T14:03:12-07:00' }).text).toBe(
      'Read Oct\u00a02 when you added the role; read again Oct\u00a02 at 14:03, just before filling.',
    );
    // A role you add records the day its form was read.
    expect(model.formRead({ ...app, formReadAt: '2026-10-02' }, {}).added).toBe('2026-10-02');
    // The run reads the form again as it starts, and keeps when.
    expect(inlineScript).toContain('const readAgainAt = nowIso();');
    // Round 5: the run also keeps what was missing as your deputy read the form (the form scan).
    expect(inlineScript).toContain("saveRecord({ run: 'filled', readAgainAt, found });");
    const filled = prepared({ run: 'filled', readAgainAt: '2026-10-02T14:03:12-07:00' });
    expect(filled.model.stepsFor(filled.view)[0]).toMatchObject({
      id: 'open',
      status: 'done',
      detail: 'Read again just before filling',
    });
  });
});

describe('autofill-preview.html: the employer form', () => {
  const { store, model } = load();
  const seed = store.get();
  const view = model.viewOf(seed, model.resolveApp(seed, 'search-infra').app as App);

  it('is a generic employer form in the brief’s six sections, after the account step', () => {
    expect(model.SECTIONS.map((section) => section.title)).toEqual([
      'Contact',
      'Résumé and cover letter',
      'Experience',
      'Work eligibility',
      'Questions',
      'Voluntary self-identification',
    ]);
    const sections = [
      ...main.matchAll(
        /<section class="af-section"[^>]*data-section="([^"]+)">[\s\S]*?<h3 id="af-section-[^"]+">([^<]+)<\/h3>/g,
      ),
    ];
    expect(sections.map((match) => [match[1], match[2]])).toEqual(
      model.SECTIONS.map((section) => [section.id, section.title]),
    );
    expect(main.indexOf('data-section="account"')).toBeLessThan(
      main.indexOf('data-section="contact"'),
    );
  });

  it('draws the seed’s 20 rows from the model, each with a value and a source tag', () => {
    expect(view.fields).toHaveLength(20);
    const rows = [
      ...main.matchAll(
        /<div class="af-field[^"]*" id="af-field-([^"]+)"[\s\S]*?<dd class="af-value">[\s\S]*?<\/dd>/g,
      ),
    ];
    expect(rows.map((match) => match[1])).toEqual(view.fields.map((field) => field.id));
    for (const field of view.fields) {
      const row =
        main.match(
          new RegExp(
            `<div class="af-field[^"]*" id="af-field-${field.id}"[\\s\\S]*?<dd class="af-value">[\\s\\S]*?</dd>`,
          ),
        )?.[0] ?? '';
      // The static row is the model's markup (the editors live inside two rows).
      expect(squash(row)).toBe(squash(model.fieldHtml(field).replace(/\s*<\/div>$/, '')));
      expect(['Profile', 'Résumé', 'Saved answer', 'Deputy draft', 'Needs you']).toContain(
        textOf(row.match(/<dd class="af-source">([\s\S]*?)<\/dd>/)?.[1] ?? ''),
      );
    }
    expect(textOf(main.match(/data-section-count="contact">([^<]+)</)?.[1] ?? '')).toBe(
      '0 of 4 filled',
    );
    expect(textOf(main.match(/data-section-count="self-id">([^<]+)</)?.[1] ?? '')).toBe(
      '0 of 5 filled',
    );
  });

  it('fills every value from the store: profile, career, applicant, answers, and self-identification', () => {
    const value = (id: string) => view.fields.find((field) => field.id === id);
    expect(view.fields.map((field) => [field.id, field.source])).toEqual([
      ['name', 'profile'],
      ['email', 'profile'],
      ['phone', 'profile'],
      ['location', 'profile'],
      ['resume', 'resume'],
      ['cover', 'resume'],
      ['current', 'resume'],
      ['previous', 'resume'],
      ['education', 'resume'],
      ['authorized', 'saved'],
      ['sponsorship', 'saved'],
      ['notice', 'profile'],
      ['go', 'saved'],
      ['salary', 'needs'],
      ['why', 'draft'],
      ['gender', 'profile'],
      ['ethnicity', 'profile'],
      ['race', 'profile'],
      ['veteran', 'profile'],
      ['disability', 'profile'],
    ]);
    expect(value('name')?.value).toBe('Alex Morgan');
    expect(value('email')?.value).toBe('alex.morgan@example.com');
    expect(value('phone')?.value).toBe('+1 206 555 0148');
    expect(value('location')?.value).toBe('Seattle, WA, United States');
    expect(value('current')).toMatchObject({
      value: 'Senior Software Engineer, Fabrikam',
      meta: 'Since Apr 2021 · Seattle, WA',
    });
    expect(value('previous')).toMatchObject({
      value: 'Software Engineer, Litware',
      meta: 'Jun 2017 to Mar 2021',
    });
    expect(value('education')?.value).toBe('B.S. Computer Science, Lakeside University');
    // Round 6 (P-13): a field says only that the materials aren't approved yet (the notice says
    // they wait for you).
    expect(value('resume')).toMatchObject({
      value: 'Tailored résumé for Google',
      meta: 'Not approved yet',
    });
    expect(value('authorized')).toMatchObject({
      label: 'Are you legally authorized to work in the United States?',
      value: 'Yes',
    });
    expect(value('sponsorship')).toMatchObject({
      label: 'Will you now or in the future require visa sponsorship?',
      value: 'No',
    });
    // Start timing is used here, on application forms (APPLICANT noticePeriodDays).
    // Round 6 (P-26): the notice period in the stored answer's words, as Profile says it.
    expect(value('notice')?.value).toBe('14 days');
    expect(value('go')?.value).toBe('3');
    expect(value('why')?.value).toBe(
      'I like making search fast and dependable at scale, and this team owns the systems I have spent five years improving.',
    );
  });

  it('holds an editor for each question that can need you', () => {
    const salary =
      main.match(/<dd class="af-ask" id="af-ask-salary" hidden>[\s\S]*?<\/dd>/)?.[0] ?? '';
    expect(salary).toContain(
      '<label class="field-label" for="af-salary">Your answer, in US dollars a year</label>',
    );
    expect(salary).toMatch(
      /<input class="field-control" id="af-salary" type="text" inputmode="numeric"/,
    );
    // Round 5 (A1): Save to my profile, on by default, for each detail, saying where it appears.
    expect(salary).toContain(
      '<input type="checkbox" id="af-salary-save" checked aria-describedby="af-salary-save-help" />Save to my profile',
    );
    expect(textOf(salary).replace(/ ([,.])/g, '$1')).toContain(
      'It appears in Profile, in Application answers, Pay, tagged from Google’s form. Untick it to use it here only.',
    );

    expect(salary).toMatch(/id="af-salary-use" type="button">Use this answer</);
    expect(salary).toMatch(/id="af-salary-skip" type="button">Skip it</);
    const why = main.match(/<dd class="af-ask" id="af-ask-why" hidden>[\s\S]*?<\/dd>/)?.[0] ?? '';
    expect(why).toContain('<label class="field-label" for="af-why">Your answer</label>');
    expect(why).toMatch(/<textarea class="field-control" id="af-why" rows="4" maxlength="1000"/);
    expect(why).toMatch(/id="af-why-approve" type="button">Approve this answer</);
    expect(why).toContain(
      '<input type="checkbox" id="af-why-save" checked aria-describedby="af-why-save-help" />Save to my profile',
    );
    expect(textOf(why)).toContain(
      'It joins your Saved answers in Profile, for the next form that asks.',
    );
    expect(why).toMatch(/id="af-why-restore" type="button">Restore the draft</);
    // Each editor sits in its own row.
    expect(main.indexOf('id="af-ask-salary"')).toBeGreaterThan(
      main.indexOf('id="af-field-salary"'),
    );
    expect(main.indexOf('id="af-ask-salary"')).toBeLessThan(main.indexOf('id="af-field-why"'));
    expect(main.indexOf('id="af-ask-why"')).toBeGreaterThan(main.indexOf('id="af-field-why"'));
  });

  it('opens the answer prompt where your deputy drafts answers', () => {
    const questions =
      main.match(
        /<section class="af-section" aria-labelledby="af-section-questions"[\s\S]*?<\/section>/,
      )?.[0] ?? '';
    expect(questions).toContain(
      '<button class="compact-action" id="af-prompt" type="button" data-prompt-open="answer" aria-describedby="af-prompt-help">See the prompt</button>',
    );
    expect(main.match(/data-prompt-open="/g)).toHaveLength(1);
  });
});

describe('autofill-preview.html: voluntary self-identification from Profile (finding 31)', () => {
  it('fills each answer from Profile, and Decline to answer for anything not answered there', () => {
    const { store, model } = load();
    expect(model.SELF_ID_FIELDS.map((field) => [field.id, field.label])).toEqual([
      ['gender', 'Gender'],
      ['ethnicity', 'Are you Hispanic or Latino?'],
      ['race', 'Race'],
      ['veteran', 'Veteran status'],
      ['disability', 'Disability status'],
    ]);
    const seedView = model.viewOf(store.get(), store.application('search-infra') as App);
    for (const id of SELF_ID_IDS) {
      expect(seedView.fields.find((field) => field.id === id)).toMatchObject({
        source: 'profile',
        value: 'Decline to answer',
      });
    }
    // Never marked missing, never counted as needing you.
    expect(seedView.counts.needs).toBe(2);
    // Labels come from the store's SELF_ID_OPTIONS.
    store.setSelfId({
      gender: 'self-describe',
      genderSelfDescribe: 'Genderqueer',
      ethnicity: 'not-hispanic-latino',
      race: ['asian', 'white'],
      veteran: 'decline',
    });
    const answered = model.viewOf(store.get(), store.application('search-infra') as App);
    const value = (id: string) => answered.fields.find((field) => field.id === id)?.value;
    expect(value('gender')).toBe('Prefer to self-describe: Genderqueer');
    expect(value('ethnicity')).toBe('Not Hispanic or Latino');
    expect(value('race')).toBe('Asian, White');
    expect(value('veteran')).toBe('I don’t wish to answer');
    expect(value('disability')).toBe('Decline to answer');
    expect(main).toContain(
      '<p class="af-self-note" id="af-self-note">Filled by your deputy from Profile. Not answered there means Decline to answer.</p>',
    );
    expect(main).toContain(
      '<a class="compact-action" id="af-self-profile-link" href="./profile-preview.html#self-id">Change in Profile</a>',
    );
  });

  it('answers differently for one application, and never writes back to Profile unless you choose', () => {
    const { store, model } = load();
    store.update({ type: 'autofill' }, (next) => {
      next.autofill = {
        'search-infra': { selfId: { gender: 'woman', race: ['black-african-american'] } },
      };
    });
    const state = store.get();
    const view = model.viewOf(state, store.application('search-infra') as App);
    expect(view.fields.find((field) => field.id === 'gender')).toMatchObject({
      value: 'Woman',
      source: 'you',
    });
    expect(view.fields.find((field) => field.id === 'race')?.value).toBe(
      'Black or African American',
    );
    expect(view.fields.find((field) => field.id === 'veteran')?.value).toBe('Decline to answer');
    // Profile is unchanged; another role still fills from Profile.
    expect(state.selfId).toMatchObject({ gender: null, race: null });
    expect(
      model
        .viewOf(state, store.application('cloud-reliability') as App)
        .fields.find((field) => field.id === 'gender'),
    ).toMatchObject({
      value: 'Decline to answer',
      source: 'profile',
    });
    // Only known answers are kept, and "I don't wish to answer" stands alone for race.
    expect(
      model.cleanSelfId({
        gender: 'robot',
        genderSelfDescribe: 'x',
        race: ['asian', 'decline', 'unknown'],
        veteran: 'protected',
      }),
    ).toEqual({
      gender: null,
      genderSelfDescribe: null,
      ethnicity: null,
      race: ['decline'],
      veteran: 'protected',
      disability: null,
    });
    // The editor offers every option from SELF_ID_OPTIONS, with Decline to answer for each.
    const controls = model.selfIdControlsHtml({ gender: 'man' });
    for (const option of Object.values(store.SELF_ID_OPTIONS).flat()) {
      expect(controls).toContain(`>${option.label.replace(/’/g, '’')}<`);
    }
    expect(controls.match(/>Decline to answer</g)).toHaveLength(4);
    expect(controls).toContain('<option value="man" selected>Man</option>');
    // The page keeps the override in this application's record, and saves to Profile only on request.
    // Its name is the whole phrase; where the form is narrow it shows a short form of it.
    expect(main).toContain(
      '<button class="compact-action" id="af-self-open" type="button" aria-expanded="false" aria-controls="af-self-editor" aria-label="Answer differently for this application"><span class="af-label-long">Answer differently for this application</span><span class="af-label-short">Answer differently</span></button>',
    );
    expect(page).toMatch(
      /@container af-form \(max-width: 419px\) \{\s*\.af-label-long \{\s*display: none;/,
    );
    expect(main).toContain(
      '<label class="af-check"><input type="checkbox" id="af-self-save" />Also save these answers to Profile</label>',
    );
    expect(inlineScript).toContain('saveRecord({ selfId: values });');
    expect(inlineScript).toContain(
      "const toProfile = selfSave.checked && typeof store.setSelfId === 'function';",
    );
    expect(inlineScript).toContain('store.setSelfId(values);');
  });
});

describe('autofill-preview.html: your account on the employer’s site (round 5, A2)', () => {
  const site =
    main.match(/<section class="task-surface af-site"[\s\S]*?<p class="sample-note">/)?.[0] ?? '';
  const inputFor = (store: Store, more: AccountInput = {}): AccountInput => {
    const there = store.siteFor('search-infra') as Site;
    return {
      site: there.site,
      email: 'alex.morgan@example.com',
      gmail: store.connections().gmail,
      gate: store.requiresAgreement('site-accounts'),
      paused: false,
      account: there.account,
      active: false,
      signHref: '',
      code: null,
      ...more,
    };
  };
  const states = (steps: Array<{ id: string; state: string }>) =>
    steps.map((step) => `${step.id}:${step.state}`).join(' ');
  const sign = (store: Store) =>
    store.signAgreement({
      version: '2026.10',
      name: 'Alex Morgan',
      consents: ['read', 'act', 'keep'],
    });

  it('has its own surface on the employer’s site, before the form: your account, then the scan', () => {
    expect(main.indexOf('id="af-site"')).toBeGreaterThan(main.indexOf('id="af-run"'));
    expect(main.indexOf('id="af-site"')).toBeLessThan(main.indexOf('id="af-form"'));
    expect(site).toContain(
      '<p class="section-label" id="af-site-label">careers.google.example</p>',
    );
    expect(site).toContain('<h2 id="af-site-title">On Google’s site.</h2>');
    expect(site.indexOf('data-section="account"')).toBeLessThan(
      site.indexOf('data-section="scan"'),
    );
    // The deputy never gets past a CAPTCHA (said on the page).
    expect(textOf(site)).toContain(
      'Your deputy stops and asks you at a CAPTCHA, and never bypasses one.',
    );
    expect(site).toContain(
      '<section class="af-scan-frame" id="af-scan-frame" aria-label="Google’s form, as your deputy reads it" hidden>',
    );
  });

  it('draws the seed’s steps from the model: Gmail done, the agreement to sign, then the rest', () => {
    const { store, model } = load();
    const input = inputFor(store, { signHref: model.signHrefFor('search-infra') });
    expect(states(model.accountStepsOf(input))).toBe(
      'gmail:done agreement:next password:next code:next',
    );
    expect(site).toContain(
      `<ol class="timeline af-account-steps" id="af-account-steps" aria-label="Your account, step by step">${model.accountStepsHtml(input)}</ol>`,
    );
    // Review and sign comes back to this role's account step (A4's ?return=).
    expect(model.signHrefFor('search-infra')).toBe(
      './agreement-preview.html?mode=update&return=autofill-preview.html%3Fapp%3Dsearch-infra%23af-account',
    );
    expect(model.accountStepsHtml(input)).toContain(
      'data-account-sign href="./agreement-preview.html?mode=update&amp;return=',
    );
  });

  it('checks Gmail first, and asks for it with consent: what it reads and never does', () => {
    const { store, model } = load();
    store.disconnectGmail();
    sign(store);
    const input = inputFor(store, { active: true });
    expect(states(model.accountStepsOf(input))).toBe(
      'gmail:attention agreement:done password:next code:next',
    );
    const html = model.accountStepsHtml(input);
    expect(html).toContain('data-account-do="gmail">Connect Gmail, read-only</button>');
    for (const item of [...store.connections().gmail.reads, ...store.connections().gmail.never]) {
      expect(html).toContain(`<li>${item.replace(/’/g, '’')}</li>`);
    }
    expect(textOf(html)).toContain('Sample: nothing connects to Google.');
    // Only while the run waits for you does a step show its controls.
    expect(model.accountStepsHtml({ ...input, active: false })).not.toContain('data-account-do');
    expect(inlineScript).toContain('store.connectGmail();');
  });

  it('asks Generate (the default) or Choose my own, checks a chosen one, and refuses a weak one', () => {
    const { store, model } = load();
    sign(store);
    const html = model.accountStepsHtml(inputFor(store, { active: true }));
    expect(states(model.accountStepsOf(inputFor(store, { active: true })))).toBe(
      'gmail:done agreement:done password:attention code:next',
    );
    expect(html).toContain(
      '<input type="radio" name="af-password-mode" value="generated" checked />',
    );
    expect(textOf(html)).toContain(
      'Generate a strong password 20 characters, made in your browser',
    );
    expect(html).toContain('<input type="radio" name="af-password-mode" value="chosen" />');
    expect(textOf(html)).toContain('Sample only: use a made-up password, never a real one.');
    expect(html).toContain('data-account-do="create">Create the account</button>');
    // "password123" is refused with the reason; the check reads it as you type.
    expect(model.passwordCheckText(store.passwordCheck('password123'))).toBe(
      'Not strong enough: Use at least 12 characters (this has 11). It’s one of the most common passwords, so it’s easy to guess.',
    );
    const weak = store.createSiteAccount({
      site: 'careers.google.example',
      company: 'Google',
      passwordMode: 'chosen',
      password: 'password123',
      appId: 'search-infra',
    });
    expect(weak).toMatchObject({ ok: false, reason: 'weak-password' });
    expect(inlineScript).toContain("passwordError(result.why ?? 'Choose a stronger password.');");
    // A generated one is 20 characters with no look-alikes, and the page never holds it.
    const made = store.createSiteAccount({
      site: 'careers.google.example',
      company: 'Google',
      passwordMode: 'generated',
      appId: 'search-infra',
    });
    expect(made.ok).toBe(true);
    const password =
      store.revealSitePassword(made.account?.id ?? '', { action: 'show' }).password ?? '';
    expect(password).toHaveLength(20);
    expect(password).not.toMatch(/[IOilo01]/);
    const after = model.accountStepsHtml(inputFor(store, { active: true }));
    expect(after).not.toContain(password);
    expect(after).toContain(
      '<span class="secret-field-value" id="af-account-secret-value"><span aria-hidden="true" data-secret-value>••••••••••••</span><span class="sr-only" data-secret-state>Hidden</span></span><button type="button" class="compact-action secret-field-show" aria-describedby="af-account-secret-label" data-secret-show>Show</button>',
    );
    // Round 6 (T1): site accounts moved to Settings, Connections.
    expect(after).toContain(
      'href="./connections-preview.html#site-accounts">Site accounts in Settings</a>',
    );
    // Each Show and Copy is logged by the store, with what it was.
    expect(inlineScript).toContain(
      'reveal: ({ action } = {}) => store.revealSitePassword?.(account.id, { action })?.password ?? null,',
    );
  });

  it('reads the one-time code from Gmail once, shows it once, keeps it nowhere, then signs in', () => {
    const { store, model } = load();
    sign(store);
    const made = store.createSiteAccount({
      site: 'careers.google.example',
      company: 'Google',
      appId: 'search-infra',
    });
    expect(states(model.accountStepsOf(inputFor(store, { active: true })))).toBe(
      'gmail:done agreement:done password:done code:attention',
    );
    const read = store.readOneTimeCode(made.account?.id ?? '');
    expect(read.code).toMatch(/^\d{6}$/);
    // A second read gets nothing: the store keeps only that it was read.
    expect(store.readOneTimeCode(made.account?.id ?? '')).toMatchObject({
      ok: false,
      reason: 'no-code',
    });
    const code = { code: read.code ?? '', from: read.from ?? '', receivedAt: '' };
    const shown = model.accountStepsHtml(inputFor(store, { code }));
    expect(states(model.accountStepsOf(inputFor(store)))).toBe(
      'gmail:done agreement:done password:done code:done',
    );
    expect(shown).toContain(`<span class="af-code" aria-hidden="true">${read.code}</span>`);
    expect(textOf(shown)).toContain('Shown once here; it isn’t kept.');
    // After this page view the code is gone for good.
    const later = model.accountStepsHtml(inputFor(store));
    expect(later).not.toContain(read.code ?? '');
    expect(textOf(later)).toContain('was used once and isn’t kept.');
    // The page holds the code in one variable only, never in storage or the address.
    expect(inlineScript).toContain(
      'shownCode = { code: result.code, from: result.from, receivedAt: result.receivedAt };',
    );
    expect(inlineScript).not.toMatch(/localStorage|sessionStorage|searchParams\.set\('code'/);
  });

  it('stops the run for your account, and goes on to the form scan once you are signed in', () => {
    const { model } = load();
    const waiting = prepared({ run: 'account' });
    expect(waiting.view.phase).toBe('account');
    expect(model.statusOf(waiting.view)).toEqual({
      text: 'Your account needs you',
      tone: 'attention',
    });
    const site = 'careers.google.example';
    expect(
      model
        .stepsFor(waiting.view, null, { account: { site, status: 'none' } })
        .map((step) => `${step.status}:${step.detail}`)
        .slice(0, 3),
    ).toEqual([
      'done:Opened careers.google.example',
      'attention:An account on careers.google.example',
      'next:7 fields',
    ]);
    expect(
      model
        .stepsFor(waiting.view, null, { account: { site, status: 'signed-in' } })
        .map((step) => step.status)
        .slice(0, 3),
    ).toEqual(['done', 'done', 'next']);
    expect(inlineScript).toContain("saveRecord({ run: 'account' });");
    expect(inlineScript).toContain('startRun({ resume: true })');
    // While your deputy is paused, autofill says why and offers Review and sign (R5-4).
    expect(inlineScript).toContain("'Your deputy is paused',");
    expect(inlineScript).toContain(
      "'It fills forms again once you sign the updated agreement. You can still read and change everything here.',",
    );
  });
});

describe('autofill-preview.html: the form scan and what it finds (round 5, A1)', () => {
  it('scans the 20 fields: Profile, résumé, and answers, and the two that need you missing', () => {
    const { model, view } = prepared({ run: 'filled' });
    const fields = model.scanFieldsOf(view);
    expect(fields).toHaveLength(20);
    const count = (source: string) => fields.filter((field) => field.source === source).length;
    expect([count('profile'), count('resume'), count('answers'), count('missing')]).toEqual([
      10, 5, 3, 2,
    ]);
    expect(fields.filter((field) => field.source === 'missing')).toEqual([
      expect.objectContaining({ id: 'salary', need: 'optional' }),
      expect.objectContaining({ id: 'why', need: 'required' }),
    ]);
    expect(
      model.scanNote({ readAgainAt: '2026-10-02T14:03:12-07:00', found: ['salary', 'why'] }, view),
    ).toBe('As your deputy read it, Oct\u00a02 at 14:03, before your answers.');
    // After your answers the scan follows them (round 5 acceptance, fix 14): the fields you
    // answered show where their answers came from, so its line ("all 20 filled"), the run card,
    // and the form agree, and the line over it says your answers since are in it.
    const answered = prepared({
      run: 'filled',
      found: ['salary', 'why'],
      salary: { status: 'answered', amount: 185000, saved: true },
      why: { status: 'approved', text: 'Search at scale.' },
    });
    const after = answered.model.scanFieldsOf(answered.view);
    expect(after.filter((field) => field.source === 'missing')).toEqual([]);
    expect(after.filter((field) => ['salary', 'why'].includes(field.id))).toEqual([
      // Saved to your profile, the salary now comes from Profile.
      expect.objectContaining({ id: 'salary', source: 'profile', value: 'USD 185,000 a year' }),
      expect.objectContaining({ id: 'why', source: 'answers', value: 'Search at scale.' }),
    ]);
    expect(
      answered.model.scanNote(
        { readAgainAt: '2026-10-02T14:03:12-07:00', found: ['salary', 'why'] },
        answered.view,
      ),
    ).toBe('As your deputy read it, Oct\u00a02 at 14:03, with your answers since.');
    // Drawn again after an answer, the run's old counts leave the shared status channel.
    expect(inlineScript).toContain(
      "const said = [...document.body.children].find((child) => child.classList.contains('jd-status'));",
    );
    expect(inlineScript).toContain("if (said) said.textContent = '';");
    // A2's formScan draws it, at once under reduced or paused motion; the run waits for it.
    expect(inlineScript).toContain('scan = components.formScan(');
    expect(inlineScript).toContain("await scanTo('fill');");
    expect(inlineScript).toContain("await scanTo('review');");
    // Its frame scrolls with the field at work, never the page.
    expect(inlineScript).toContain(
      "scanFrame.scrollTo({ top: Math.max(0, top), behavior: still() ? 'auto' : 'smooth' });",
    );
  });

  it('saves a missing detail to Profile through saveDiscoveredField, tagged with its form, or not at all', () => {
    expect(inlineScript).toMatch(
      /store\.saveDiscoveredField\('applicant\.expectedCompensation', amount, \{\s*keep: saved,\s*foundOn: \{ appId \},\s*askedAs: 'Expected salary',\s*\}\);/,
    );
    const kept = load().store;
    expect(
      kept.saveDiscoveredField('applicant.expectedCompensation', 185000, {
        keep: true,
        foundOn: { appId: 'search-infra' },
        askedAs: 'Expected salary',
      }).ok,
    ).toBe(true);
    expect(
      kept.discoveredFields().find((field) => field.key === 'applicant.expectedCompensation'),
    ).toMatchObject({
      tag: 'New · from Google’s form, Oct 2',
      value: '$185,000 a year',
      saved: true,
    });
    expect(kept.metricText('profile.missingRequired')).toBe('1');
    // Unticked: used for this form only; Profile stays as it is.
    const once = load().store;
    expect(
      once.saveDiscoveredField('applicant.expectedCompensation', 150000, {
        keep: false,
        foundOn: { appId: 'search-infra' },
        askedAs: 'Expected salary',
      }),
    ).toMatchObject({ ok: true, kept: false });
    expect(once.get().applicant.expectedCompensation ?? null).toBeNull();
    expect(
      once.discoveredFields().some((field) => field.key === 'applicant.expectedCompensation'),
    ).toBe(false);
  });

  it('keeps the why answer for this application only when you untick Save to my profile', () => {
    const { view } = prepared({
      run: 'filled',
      why: { status: 'approved', text: 'Search at scale.', saved: false },
    });
    expect(view.fields.find((field) => field.id === 'why')).toMatchObject({
      state: 'answered',
      source: 'you',
    });
    expect(inlineScript).toContain(
      "saveRecord({ why: { status: 'approved', text, draft, saved } });",
    );
    expect(inlineScript).toMatch(
      /if \(saved\) \{\s*store\.update\(\{ type: 'answers', id: 'why-team' \}/,
    );
  });
});

describe('autofill-preview.html: the run', () => {
  it('uses the backend’s application steps, with your account on the employer’s site', () => {
    const actions = dataModel
      .match(/`action` \(([^)]*)\)/)?.[1]
      ?.match(/`(\w+)`/g)
      ?.map((action) => action.replace(/`/g, ''));
    expect(actions).toEqual(['open', 'login', 'fill', 'upload', 'answer', 'review', 'submit']);
    const { model } = load();
    expect(model.STEPS.map((step) => step.id)).toEqual(actions);
    expect(model.STEPS.map((step) => step.label)).toEqual([
      'Open the form',
      'Your account',
      'Fill your details',
      'Upload materials',
      'Answer questions',
      'Your review',
      'Submit',
    ]);
    const steps = [
      ...main.matchAll(
        /<li class="timeline-item[^"]*" data-step="([^"]+)"><p class="timeline-title">([^<]+)</g,
      ),
    ];
    expect(steps.map((match) => [match[1], match[2]])).toEqual(
      model.STEPS.map((step) => [step.id, step.label]),
    );
    // Round 5 (A2): the account step is real in the prototype, so it names the site.
    const account = { site: 'careers.google.example', status: 'signed-in' };
    const { view } = prepared({ run: 'filled' });
    expect(model.stepsFor(view, null, { account })[1]).toMatchObject({
      id: 'login',
      status: 'done',
      detail: 'Signed in to careers.google.example',
    });
    expect(
      model.stepsFor(prepared(null).view, null, { account: { ...account, status: 'none' } })[1]
        ?.detail,
    ).toBe('An account on careers.google.example');
    expect(main).toContain(
      '<span class="timeline-state">Next</span> · An account on careers.google.example</p>',
    );
  });

  it('fills in sequence in about three seconds, and only what it has', () => {
    const { model } = load();
    const total = model.RUN.reduce(
      (sum, block) => sum + block.ms * Math.max(1, block.fields.length),
      0,
    );
    expect(total).toBeGreaterThanOrEqual(2600);
    expect(total).toBeLessThanOrEqual(3400);
    expect(model.RUN.map((block) => block.step)).toEqual([
      'open',
      'login',
      'fill',
      'upload',
      'answer',
    ]);
    expect(model.RUN.flatMap((block) => block.fields).sort()).toEqual(
      prepared(null)
        .view.fields.map((field) => field.id)
        .sort(),
    );
    // Instant under reduced motion or Pause motion, checked at every step.
    expect(inlineScript).toContain(
      "const still = () => Boolean(reducedMotion.matches || document.documentElement.dataset.motion === 'paused');",
    );
    expect(inlineScript).toContain(
      'const wait = (ms) => (still() ? Promise.resolve() : new Promise((resolve) => window.setTimeout(resolve, ms)));',
    );
    expect(inlineScript).toContain("deputy()?.set('fill', { working: true });");
  });

  it('waits at the gate until the materials are approved', () => {
    const { store, model } = load();
    const state = store.get();
    const view = model.viewOf(state, model.resolveApp(state, 'search-infra').app as App);
    expect(view.phase).toBe('gate');
    expect(view.counts).toMatchObject({ total: 20, done: 0, needs: 2 });
    expect(model.statusOf(view)).toEqual({ text: 'Waiting for your approval', tone: 'attention' });
    const gate =
      main.match(
        /<div class="feedback-panel" id="af-gate" data-kind="warning">[\s\S]*?<\/div>/,
      )?.[0] ?? '';
    expect(textOf(gate)).toContain('Approve the materials first');
    expect(textOf(gate)).toContain('Your deputy fills a form only with materials you approved.');
    // The way on is the run's one primary action, a link to the materials.
    expect(main).toContain(
      '<a class="primary-action" id="af-run-link" href="./materials-preview.html?app=search-infra&amp;from=applications" aria-describedby="af-gate-title">Review materials</a>',
    );
  });

  it('fills 18 of 20 and stops for the two that need you', () => {
    const { model, view } = prepared({ run: 'filled' });
    expect(view.phase).toBe('needs');
    expect(view.counts).toMatchObject({ filled: 18, needs: 2, done: 18 });
    expect(view.fields.filter((field) => field.state === 'needs').map((field) => field.id)).toEqual(
      ['salary', 'why'],
    );
    expect(model.stepsFor(view).map((step) => step.status)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'attention',
      'next',
      'next',
    ]);
    expect(model.stepsFor(view)[4]?.detail).toBe('9 of 11 answered · 2 need you');
    expect(model.statusOf(view).text).toBe('2 questions need you');
    // During the run, the step at work is the current one.
    expect(model.stepsFor(prepared(null).view, 'upload').map((step) => step.status)).toEqual([
      'done',
      'done',
      'done',
      'current',
      'next',
      'next',
      'next',
    ]);
  });

  // Round 6 part 3 (T3-R3): the link is one sentence that flows as text (as a flex box its words
  // and the mode became two wrapped columns in the narrow run card), 44px tall at least.
  it('reads How your deputy applies as one sentence, never two columns', () => {
    const styles = [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
      .map((match) => match[1] ?? '')
      .join('');
    const rule = styles.match(/\n {6}\.af-settings-link \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('display: inline-block;');
    expect(rule).toContain('min-height: 44px;');
    expect(rule).toContain('font-size: 12px;');
    expect(rule).not.toMatch(/display: (inline-)?flex|gap:/);
  });

  it('links How your deputy applies to its settings in Applications', () => {
    // Round 6 (A1, T1): the settings moved from Profile to Applications, #how-you-apply, and the
    // system default is Review, then auto-apply (the store's applyRules()).
    expect(main).toContain(
      '<a class="af-settings-link" id="af-settings" href="./applications-preview.html#how-you-apply">How your deputy applies: <strong id="af-settings-mode">review, then auto-apply</strong></a>',
    );
    const { model } = load();
    expect(model.applyModeText({ mode: 'review_then_auto' })).toBe('review, then auto-apply');
    expect(model.applyModeText({ mode: 'review_each' })).toBe('review each one');
    expect(model.applyModeText({ mode: 'off' })).toBe('off for now');
    expect(model.applyModeText({ mode: 'within_rules' })).toBe('within your rules (planned)');
  });
});

describe('autofill-preview.html: what needs you, review, and submit', () => {
  it('reads a yearly amount, and refuses a guess', () => {
    const { model } = load();
    expect(model.parseAmount('185,000')).toBe(185000);
    expect(model.parseAmount('$185k')).toBe(185000);
    expect(model.parseAmount(' 185000 USD ')).toBe(185000);
    expect(model.parseAmount('')).toBeNull();
    expect(model.parseAmount('a lot')).toBeNull();
    expect(model.parseAmount('12')).toBeNull();
    expect(model.money({ amount: 185000, currency: 'USD', period: 'year' })).toBe(
      'USD 185,000 a year',
    );
  });

  it('tags each answer by where it now comes from', () => {
    const saved = prepared({
      run: 'filled',
      salary: { status: 'answered', amount: 185000, saved: true },
    }).view;
    expect(saved.fields.find((field) => field.id === 'salary')).toMatchObject({
      state: 'answered',
      source: 'profile',
      value: 'USD 185,000 a year',
    });
    const once = prepared({
      run: 'filled',
      salary: { status: 'answered', amount: 150000, saved: false },
    }).view;
    expect(once.fields.find((field) => field.id === 'salary')).toMatchObject({
      state: 'answered',
      source: 'you',
    });
    const skipped = prepared({ run: 'filled', salary: { status: 'skipped' } }).view;
    expect(skipped.fields.find((field) => field.id === 'salary')).toMatchObject({
      state: 'skipped',
      source: 'skipped',
    });
    const approved = prepared({
      run: 'filled',
      why: { status: 'approved', text: 'Search at scale.' },
    }).view;
    expect(approved.fields.find((field) => field.id === 'why')).toMatchObject({
      state: 'answered',
      source: 'saved',
      value: 'Search at scale.',
    });
  });

  it('opens the review once nothing needs you, with where the answers came from', () => {
    const { model, view } = prepared({
      run: 'filled',
      salary: { status: 'answered', amount: 185000, saved: true },
      why: { status: 'approved', text: 'Search at scale.' },
    });
    expect(view.phase).toBe('review');
    expect(view.counts).toMatchObject({ filled: 18, answered: 2, needs: 0, done: 20 });
    expect(model.stepsFor(view).map((step) => step.status)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
      'current',
      'next',
    ]);
    expect(model.sourcesOf(view)).toEqual([
      { source: 'profile', label: 'Profile', value: 11 },
      { source: 'resume', label: 'Résumé', value: 5 },
      { source: 'saved', label: 'Saved answer', value: 4 },
    ]);
    const review =
      main.match(
        /<section class="task-surface af-review"[\s\S]*?<\/section>\s*<\/div>\s*<\/section>/,
      )?.[0] ?? '';
    expect(review).toContain(
      '<label class="af-check"><input type="checkbox" id="af-checked" />I checked this application</label>',
    );
    expect(review).toContain(
      '<button class="primary-action" id="af-submit" type="button" aria-describedby="af-submit-note">Submit application</button>',
    );
    expect(textOf(review)).toContain('In this prototype nothing is sent.');
    expect(review).toMatch(
      /class="feedback-panel"\s+id="af-done"\s+data-kind="success"\s+tabindex="-1"/,
    );
    // Charts link: each part of the sources bar opens where those answers live, and the key's links
    // are the keyboard path (the bar's links are pointer-only inside aria-hidden). Each colour has a
    // tooltip with its name, count, meaning, and what a click opens.
    expect(inlineScript).toContain("profile: ['./profile-preview.html#about', 'Opens Profile.'],");
    expect(inlineScript).toContain("resume: ['./documents-preview.html', 'Opens Résumés.'],");
    expect(inlineScript).toContain(
      "saved: ['./profile-preview.html#answers', 'Opens your answers in Profile.'],",
    );
    expect(inlineScript).toContain('tabindex="-1" data-tone=');
    expect(inlineScript).toMatch(
      /<a class="chart-key-item" href=\$\{quoted\(link\[0\]\)\} \$\{tip\}>/,
    );
    expect(inlineScript).toContain(
      code(
        "const tip = `data-tip-title=$(quoted(`$(entry.label} · $(entry.value} $(unit(entry.value)}`)} data-tip=$(quoted(`$(meaning[entry.source]}$(link ? ` $(link[1]}` : ''}`)}`;",
      ),
    );
    // Its action sits under the message, so a phone keeps the words whole.
    expect(review).toMatch(
      /<span class="af-done-actions">\s*<a class="feedback-panel-action" id="af-done-action"/,
    );
    expect(review).toContain(
      'href="./applications-preview.html?open=search-infra">Open in Applications</a>',
    );
  });

  it('remembers a profile salary next time, so only one question needs you', () => {
    const { store, model } = load();
    store.update({ type: 'applicant' }, (next) => {
      (next.applicant as Record<string, unknown>).expectedCompensation = {
        amount: 185000,
        currency: 'USD',
        period: 'year',
      };
    });
    store.moveApplication('search-infra', 'approval', {
      approval: 'approved',
      materials: 'approved',
    });
    store.update({ type: 'autofill' }, (next) => {
      next.autofill = { 'search-infra': { run: 'filled' } };
    });
    const state = store.get();
    const view = model.viewOf(state, model.resolveApp(state, 'search-infra').app as App);
    expect(view.counts).toMatchObject({ filled: 19, needs: 1 });
    expect(view.fields.find((field) => field.id === 'salary')).toMatchObject({
      source: 'profile',
      state: 'filled',
    });
  });

  it('submits nothing: the role moves to Applied, by your deputy, and the deputy reacts once', () => {
    expect(inlineScript).toMatch(
      /store\.moveApplication\(appId, 'applied', \{\s*label: 'Submitted by your deputy \(prototype, nothing was sent\)',\s*by: 'deputy',\s*applied: M\.TODAY,\s*appliedBy: 'deputy',/,
    );
    expect(inlineScript).toContain(
      "saveRecord({ run: 'submitted', checked: true, submittedOn: M.TODAY });",
    );
    expect(inlineScript).toContain(
      "deputy()?.react?.('submitted', { speech: 'Done. Nothing was sent.' });",
    );
    expect(inlineScript).not.toContain("flash('success'");
    // Save to Profile writes the backend's money shape; approving the draft approves the answer.
    expect(inlineScript).toContain(
      "expectedCompensation: { amount, currency: 'USD', period: 'year' }",
    );
    expect(inlineScript).toContain('item.approved = true;');
    // The page keeps its own section through update().
    expect(inlineScript).toContain('next.autofill = next.autofill ?? {};');

    // A role moved back to Approval in Applications reopens as a filled form that still asks
    // what needs you, rather than claiming it was submitted.
    const { model, view } = prepared({ run: 'submitted', submittedOn: '2026-10-02' });
    expect(view.phase).toBe('needs');
    const { store } = load();
    store.moveApplication('search-infra', 'applied', {
      label: 'Submitted by your deputy (prototype, nothing was sent)',
      by: 'deputy',
      applied: '2026-10-02',
      appliedBy: 'deputy',
      approval: 'approved',
      materials: 'approved',
    });
    store.update({ type: 'autofill' }, (next) => {
      next.autofill = { 'search-infra': { run: 'submitted', submittedOn: '2026-10-02' } };
    });
    const state = store.get();
    const sent = model.viewOf(state, model.resolveApp(state, 'search-infra').app as App);
    expect(sent.phase).toBe('submitted');
    expect(model.stepsFor(sent).every((step) => step.status === 'done')).toBe(true);
    expect(model.stepsFor(sent).at(-1)?.detail).toBe('Oct\u00a02 · nothing was sent');
    expect(model.statusOf(sent)).toEqual({ text: 'Submitted · nothing sent', tone: 'success' });
    expect(model.stagePill(sent.app).text).toBe('Applied · by your deputy');
    // The store's step also carries its time (round 7); the day, words, and who are the run's.
    expect(store.application('search-infra')?.timeline.at(-1)).toMatchObject({
      date: '2026-10-02',
      label: 'Submitted by your deputy (prototype, nothing was sent)',
      by: 'deputy',
    });
  });

  it('knows the roles it can’t fill, and falls back from an unknown one', () => {
    const { store, model } = load();
    const state = store.get();
    const phase = (id: string) => model.viewOf(state, model.resolveApp(state, id).app as App).phase;
    expect(phase('devex')).toBe('applied');
    expect(phase('contoso-platform')).toBe('closed');
    expect(phase('workspace')).toBe('gate');
    expect(phase('cloud-reliability')).toBe('gate');
    expect(model.resolveApp(state, 'not-a-role')).toMatchObject({ missing: 'not-a-role' });
    expect(model.resolveApp(state, 'not-a-role').app?.id).toBe('search-infra');
    expect(model.resolveApp(state, null)).toMatchObject({ missing: null });
    expect(inlineScript).toContain("M.resolveApp(store.get(), params.get('app'))");
  });

  it('fills a role you added from the résumé or CV you chose for it', () => {
    const { store, model } = load();
    store.addApplication({
      id: 'added-role',
      role: 'Staff Engineer',
      company: 'Fabrikam',
      stage: 'approval',
      approval: 'approved',
      materials: 'approved',
      baseDocumentId: 'cv-leadership',
      formReadAt: '2026-10-02',
      timeline: [{ date: '2026-10-02', label: 'Added by you', by: 'you' }],
    });
    const view = model.viewOf(store.get(), store.application('added-role') as App);
    expect(view.fields.find((field) => field.id === 'resume')?.meta).toBe(
      'Approved · from Engineering_Leadership_CV.docx',
    );
    expect(model.formRead(view.app, view.record).text).toBe(
      'Read Oct\u00a02 when you added the role; read again just before filling.',
    );
  });

  it('escapes the words it shows', () => {
    const { store, model } = load();
    store.update({ type: 'profile' }, (next) => {
      (next.profile as Record<string, unknown>).firstName = '<img src=x onerror=alert(1)>';
    });
    const state = store.get();
    const view = model.viewOf(state, model.resolveApp(state, 'search-infra').app as App);
    const html = model.valueHtml({ ...(view.fields[0] as Field), state: 'filled' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    store.setSelfId({ gender: 'self-describe', genderSelfDescribe: '<b>me</b>' });
    expect(model.selfIdControlsHtml(store.get().selfId)).toContain('value="&lt;b&gt;me&lt;/b&gt;"');
  });

  it('keeps the deputy’s lines to six words or fewer', () => {
    const lines = [...inlineScript.matchAll(/speech: '([^']+)'/g)].map((match) => match[1] ?? '');
    expect(lines.length).toBeGreaterThan(4);
    for (const line of [
      ...lines,
      'Two answers need you.',
      'One answer needs you.',
      'Saved to Profile too.',
      'Saved for this application.',
    ]) {
      expect(line.split(/\s+/).length, line).toBeLessThanOrEqual(6);
    }
  });
});

// Round 6 (A3): applying in the background by default. While your deputy's apply job runs or
// waits, this page follows it (Watch it opens ?live=1): the stages, the time counting up, the scan,
// the fill, your answers (they answer the job), then sending. It has a tour now (R6-3).
describe('autofill-preview.html: live, following the background job (round 6, A3)', () => {
  it('holds the live panel at the top of the run, with Stop and Open in Applications', () => {
    const live = main.match(/<div class="af-live" id="af-live" hidden>[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(main.indexOf('id="af-live"')).toBeLessThan(main.indexOf('id="af-meter-label"'));
    expect(live).toContain('<span class="live-pill" id="af-live-pill">');
    expect(live).toContain(
      '<button class="compact-action" id="af-live-stop" type="button">Stop</button>',
    );
    expect(live).toContain('id="af-live-open"');
    expect(textOf(live)).toContain('Nothing is sent in this prototype.');
  });

  it('follows the store’s job, never starting a run of its own while one goes on', () => {
    expect(inlineScript).toContain("if (typeof store.applyJob !== 'function') return null;");
    expect(inlineScript).toContain(
      "if (job && (job.status === 'running' || job.status === 'waiting')) return job;",
    );
    expect(inlineScript).toContain('const live = filling ? null : liveJob();');
    expect(inlineScript).toContain('runButton.hidden = true;');
    // Your answers go to the job, with Save to my profile as you chose.
    expect(inlineScript).toContain(
      'const result = store.answerApplyQuestion(appId, QUESTION_OF[ask], value, { saveToProfile: saved });',
    );
    expect(inlineScript).toContain(
      "const QUESTION_OF = { salary: 'expected-salary', why: 'why-team' };",
    );
    // UAT D-2: Filling it in says the meter's own count and total, drawn on the same tick.
    expect(inlineScript).toContain('liveSteps(job, filledNow, fields.length);');
    const dollar = '$';
    expect(inlineScript).toContain(
      `Filled ${dollar}{filledNow} of ${dollar}{total} from your profile, résumé, and answers`,
    );
    // UAT D-2: the schematic follows the job: it stops before it fills, and from Filling it in
    // shows the meter's own count and total.
    expect(inlineScript).toContain("scanTo('fill').then(() => {");
    expect(inlineScript).toContain('liveScanShow(job, fields, filledNow, fields.length);');
    expect(inlineScript).toContain('const filled = at >= 2 && (field.state === ');
    // Live counters from the store about once a second; the time is never a live region.
    expect(inlineScript).toContain("if (typeof store.onWork === 'function') {");
    expect(main).not.toMatch(/id="af-live-time"[^>]*aria-live/);
  });

  it('keeps what you type and untick in the live answers across store notifications (T5-2, R9-3)', () => {
    // Round 6 part 3: while a background job runs or waits, only the live view opens the answer
    // editors, so a redraw never closes one and opens it again as new (which put back the typed
    // salary and a ticked Save to my profile at every store notification).
    expect(inlineScript).toMatch(
      /function renderAsks\(\) \{\s*const job = filling \? null : liveJob\(\);\s*if \(job && \(job\.status === 'running' \|\| job\.status === 'waiting'\)\) return;/,
    );
    // The live view resets an editor only as it opens.
    expect(inlineScript).toContain('const opening = open && part.box.hidden;');
    expect(inlineScript).toContain('if (!opening) continue;');
  });

  it('says why a job waits for every kind the store has, and never "waits for you" on a hold', () => {
    // Round 6 part 3 (T6-2): the live panel's line is the store's own words; a hold (your quiet
    // hours, your daily limit) goes on by itself, so the title and the pill say On hold, with no
    // attention colour, as Applications says it.
    expect(inlineScript).toContain(
      "const WAIT_NEEDS_YOU = new Set(['agreement', 'gmail', 'questions', 'check', 'problem']);",
    );
    expect(inlineScript).toContain('const needsYou = WAIT_NEEDS_YOU.has(waiting);');
    expect(inlineScript).toContain(
      "? 'Your deputy waits for you'\n                : 'Your deputy is on hold'",
    );
    for (const line of [
      code(
        "'quiet-hours': `$(sentence('Your quiet hours hold it')} Nothing to do: your deputy goes on by itself.`,",
      ),
      code(
        "'daily-limit': `$(sentence('Your daily limit holds it')} Nothing to do: your deputy goes on by itself.`,",
      ),
      code("problem: `$(sentence('Your deputy stopped on a problem')} Nothing was sent.`,"),
      "agreement: sentence('Sign the updated agreement first'),",
    ]) {
      expect(inlineScript, line).toContain(line);
    }
    expect(inlineScript).toContain(
      "const sentence = (fallback) => String(job.waitingFor?.text ?? fallback).replace(/\\.?$/, '.');",
    );
    expect(inlineScript).toContain("? 'Waiting for you'\n                  : 'On hold'");
    expect(inlineScript).toContain(
      code(
        "runStatus.className = `status-pill$(applied ? '' : ' is-neutral'}$(needsYou ? ' af-pill-attention' : ''}`;",
      ),
    );
  });

  it('has a short tour in the deputy’s words: the run, your account, the answers, your review', () => {
    const steps = [
      ...main.matchAll(/data-tour-step="(\d)" data-tour-title="([^"]+)" data-tour-text="([^"]+)"/g),
    ].map((match) => [match[1], match[2], match[3]]);
    expect(steps.map(([number]) => number)).toEqual(['1', '2', '3', '4']);
    expect(steps.map(([, title]) => title)).toEqual([
      'My run, step by step.',
      'First, I sign you in.',
      'These are the answers I send.',
      'You check, then I send.',
    ]);
    for (const [, title, text] of steps) {
      expect(String(title).split(/\s+/).length).toBeLessThanOrEqual(6);
      expect(`${title} ${text}`).toMatch(/\bI\b/);
      expect(`${title} ${text}`).not.toMatch(/[\u2013\u2014]/);
    }
    expect(main).toContain(
      '<div class="page-intro-actions">\n              <button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour</button>',
    );
  });
});
