import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Page guarantees for Applications, brand/applications-preview.html. Round 7 (A1, R10-4) made it one
// flow: a header (the flow summary, who did what, what needs you, Gmail's line with Sync from
// Gmail, the employer emails and your rules in two drawers), then the board, six lanes in the flow's
// order with every step on its card and Closed folded under them. Earlier rounds' guarantees that
// still hold stay here: the Dashboard's stage colours and words, every figure once and from the
// store, an Add a role form that captures the posting, "From Gmail" on timeline steps, the role's
// panel, background applying, and the page's tour. The page's model (the block between its
// AppsModel markers) runs here against the shared sample store, so the static seed markup, the
// header, the form, and the moves are checked against the same data the page renders. The rendered
// checks (contrast, 44px targets, overflow, focus, the boot budgets) run in scripts/ui-audit.mjs.
const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');
const page = sourceFor('applications-preview.html');
const gallery = sourceFor('components-preview.html');
const main = page.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? '';
const drawer = page.match(/<dialog class="drawer" id="apps-drawer"[\s\S]*?<\/dialog>/)?.[0] ?? '';
const addDrawer = page.match(/<dialog class="drawer" id="apps-add"[\s\S]*?<\/dialog>/)?.[0] ?? '';
const emailsDrawer =
  page.match(/<dialog class="drawer apps-emails-drawer" id="email"[\s\S]*?<\/dialog>/)?.[0] ?? '';
const rulesDrawer =
  page.match(
    /<dialog class="drawer apps-rules-drawer" id="how-you-apply"[\s\S]*?<\/dialog>/,
  )?.[0] ?? '';
// The flow's surface: the header, then the board, then Closed.
const flow =
  main.match(/<section class="task-surface apps-surface" id="apps-flow"[\s\S]*$/)?.[0] ?? '';
const inlineScript = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1] ?? '')
  .join('\n');

type Step = { date: string; label: string; by: string };
type App = {
  id: string;
  role: string;
  company: string;
  stage: string;
  approval?: string;
  materials?: string;
  followUp?: string | null;
  interview?: string | null;
  deadline?: string | null;
  closedReason?: string | null;
  applied?: string;
  appliedBy?: string;
  next?: string | null;
  timeline: Step[];
  [field: string]: unknown;
};
type Documents = {
  library: Array<{ id: string; name: string; variant: string }>;
  defaults: { resume: string; cv: string };
};
type Store = {
  STAGES: Array<{ id: string; label: string }>;
  get(): { applications: App[]; documents: Documents };
  application(id: string): App | null;
  stageCounts(): Record<string, number>;
  metric(key: string): unknown;
  metricText(key: string): string;
  addApplication(entry: Record<string, unknown>): App | null;
  moveApplication(id: string, stage: string, fields?: Record<string, unknown>): App | null;
  setDefaultDocument(kind: string, id: string): unknown;
  mailEvents(): MailEvent[];
  applyMailEvent(id: string): { ok: boolean; reason?: string; event?: MailEvent };
  undoMailEvent(id: string): { ok: boolean; reason?: string; event?: MailEvent };
  ignoreMailEvent(id: string): { ok: boolean; reason?: string; event?: MailEvent };
  draftReply(id: string): { ok: boolean; reason?: string; feature?: string };
  requiresAgreement(feature: string): { version: string; label: string } | null;
  signAgreement(fields: Record<string, unknown>): { ok: boolean };
  connections(): { gmail: { status: string; reads: string[]; never: string[] } };
  review(id: string): { appId: string; score: number; status: string } | null;
  provenance(id: string): Record<string, unknown> | null;
  mailWatch(): { connected: boolean; moves: Array<Record<string, unknown>> };
  drafts(): Array<{ appId: string; kind: string }>;
  tailorJob(id: string): Record<string, unknown> | null;
  startTailoring(id: string): { ok: boolean; reason?: string };
  gmailScans(): Scans;
  gmailScan(): Record<string, unknown>;
  disconnectGmail(): unknown;
  setApplyRules(patch: Record<string, unknown>): { ok: boolean; field?: string };
  update(change: Record<string, unknown>, mutate: (next: Record<string, unknown>) => void): unknown;
};
type MailEvent = {
  id: string;
  at: string;
  from: string;
  address: string;
  subject: string;
  kind: string;
  kindLabel: string;
  appId: string;
  role: string | null;
  change: { from: string; to: string } | null;
  status: string;
  did: string;
  snippet: string;
  replyNeeded: boolean;
  canReply: boolean;
  canUndo: boolean;
  href: string;
  draft: {
    to: string;
    subject: string;
    text: string;
    model: string;
    note: string;
    sent: boolean;
    prompt: { label: string };
  } | null;
};
type Values = Record<string, string | null>;
type Tailor = {
  status: string;
  words: string;
  steps: Array<{ label: string; state: string }>;
  time: string;
  why?: string;
  action: { kind: string; label: string; href?: string } | null;
} | null;
type Prov = Record<string, unknown> | null;
type Who = { by: string; what: string; when: string } | null;
type CardOptions = {
  confirming?: boolean;
  tour?: boolean;
  applying?: boolean;
  review?: unknown;
  job?: unknown;
  move?: unknown;
  wait?: unknown;
  answers?: Map<string, unknown>;
  prov?: Prov;
  tailor?: Tailor;
  canTailor?: boolean;
  metric?: boolean;
};
type Scans = {
  connected: boolean;
  windowHours?: number;
  last: {
    at: string;
    read: number;
    moved: number;
    waiting: number;
    needsReply: number;
    window?: { hours: number };
  } | null;
  next: { at: string } | null;
  scanNow?: { available: boolean; reason: string | null; cost: string };
};
type Model = {
  TODAY: string;
  ADD_STAGES: string[];
  ADD_NEEDS: Array<[string, string]>;
  CLOSE_REASONS: string[];
  FILTER_EMPTY: Record<string, [string, string]>;
  SAMPLE_POSTING: Record<string, string>;
  STAGES: Array<{ id: string; label: string }>;
  LANE_CAP: number;
  WHO: Record<string, string>;
  fillOffer(app: App): 'fill' | 'review' | null;
  fillHref(app: App): string;
  byDeputy(app: App): boolean;
  stageTone(id: string): string | null;
  stageMeaning(id: string): string;
  stageLabel(id: string): string;
  isWaiting(app: App): boolean;
  summaryTips(
    values: Record<string, string>,
  ): Record<
    'tracked' | 'fromMatches' | 'addedByYou' | 'active' | 'closed',
    { title: string; text: string }
  >;
  summaryHtml(values: Record<string, string>): Record<string, string>;
  nextStep(app: App, options?: { table?: boolean }): { label: string; text: string };
  moveFields(app: Partial<App>, stage: string, reason?: string | null): Record<string, unknown>;
  moveOptions(app: App): string;
  laneOrder(a: App, b: App): number;
  isLink(value: unknown): boolean;
  payOf(values: Values): Record<string, unknown> | null;
  payText(pay: unknown): string;
  addNeeds(values: Values): { required: string[]; optional: string[] };
  needSummaryHtml(missing: { required: string[]; optional: string[] }): string;
  addProblems(values: Values): Record<string, string>;
  addSummary(problems: Record<string, string>): { title: string; message: string };
  readPosting(values: Values): { values: Values; filled: string[] };
  addEntry(values: Values, options?: { taken?: Set<string> }): App;
  aboutRows(app: Partial<App>, options?: { baseName?: string }): Array<[string, string]>;
  cardHtml(app: App, options?: CardOptions): string;
  stepFor(app: App, options?: CardOptions): { kind: string; html: string };
  cardFacts(app: App, options?: { move?: unknown; wait?: unknown }): string;
  whoFor(app: App, options?: { prov?: Prov; job?: unknown; tailor?: Tailor }): Who;
  whoHtml(who: Who): string;
  whenText(iso: string): string;
  shortDate(iso: string): string;
  cardNeedsYou(app: App, options?: { job?: unknown; wait?: unknown }): boolean;
  tailorFor(
    app: App,
    options?: {
      job?: unknown;
      drafts?: Array<{ kind: string }>;
      daily?: { enabled: boolean; time: string } | null;
    },
  ): Tailor;
  tailorHtml(app: App, tailor: Tailor): string;
  gmailFactsHtml(
    scans: Scans | null,
    options?: {
      fig?: (name: string, value: unknown) => string;
      count?: (name: string, value: unknown) => number;
      ago?: string;
      totals?: { moved: number; waiting: number; replyNeeded: number } | null;
    },
  ): string;
  syncWords(
    result: Record<string, unknown>,
    options?: {
      roleOf?: (id: string) => string;
      stageOf?: (id: string) => string;
      pending?: { count: number; version: string } | null;
      totals?: { moved: number; waiting: number; replyNeeded: number } | null;
    },
  ): {
    title: string;
    message: string;
    moved: string[];
    waiting: number;
    held?: number;
    replies: number;
    read: number;
  };
  laneTitleHtml(id: string): string;
  laneEmptyHtml(id: string): string;
  timelineHtml(app: App, options?: { wait?: unknown; tailor?: Tailor }): string;
  dayDate(iso: string): string;
  resumeOptions(documents: Documents): string;
  newId(role: string, company: string, taken: Set<string>): string;
  markFor(company: string): string;
  mailMove(event: MailEvent): string | null;
  mailMoveFor(app: App, watch: unknown): unknown;
  mailFiguresHtml(values: Record<string, string>, options?: { watch?: boolean }): string;
  mailMainHtml(event: MailEvent, options?: { note?: string }): string;
  mailActionsHtml(event: MailEvent, options?: { replyOpen?: boolean }): string;
  mailItemHtml(event: MailEvent, options?: { note?: string; replyOpen?: boolean }): string;
  replyHtml(event: MailEvent): string;
};

// A fresh store and the page's model, with nothing shared between tests. search: the address's
// query, such as ?demo=large for the large sample.
function load(search = ''): { store: Store; model: Model } {
  const storage = new Map<string, string>();
  const window: Record<string, unknown> = { addEventListener: () => {} };
  if (search) window.location = { search, href: `file:///applications-preview.html${search}` };
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  const context = { window, localStorage, JSON };
  // The agreement text gives signed records their fingerprint; drafting a reply records tokens.
  runInNewContext(sourceFor('agreement-text.js'), context);
  runInNewContext(storeSource, context);
  runInNewContext(`${modelSource}\nwindow.AppsModel = AppsModel;`, context);
  return { store: window.JobDeputyStore as Store, model: window.AppsModel as Model };
}

const storeSource = sourceFor('sample-store.js');
const modelSource =
  inlineScript.match(/\/\/ AppsModel: start([\s\S]*?)\/\/ AppsModel: end/)?.[1] ?? '';

// Code quoted from the page, written with $( for ${ so a plain string can hold it.
const code = (text: string): string => text.replace(/\$\(/g, '${');
const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
// The block between two HTML comment markers, with its indentation removed.
const markedBlock = (source: string, name: string): string =>
  (source.match(new RegExp(`<!-- ${name}: start -->([\\s\\S]*?)<!-- ${name}: end -->`))?.[1] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

// The canonical stage colours and meanings (the round 3 handoff, which the Dashboard uses too).
const CANON: Record<string, [string | null, string]> = {
  shortlisted: ['quiet', 'You chose it; your deputy has not started the materials.'],
  tailoring: ['ink', 'Your deputy is drafting the résumé and cover letter.'],
  approval: ['orange', 'The drafts wait for your approval.'],
  applied: ['blue', 'Sent to the employer, by you or your deputy.'],
  interviewing: ['green', 'You have an interview in progress.'],
  offer: ['green', 'You have an offer.'],
  closed: [null, 'Finished: not selected, withdrawn, or declined.'],
};

// Every detail of Add a role, as a person fills it from a pasted description.
const FILLED: Values = {
  link: 'https://careers.fabrikam.example/jobs/77',
  description: 'Fabrikam is hiring a staff engineer for its platform team.\n\n- Go and Kubernetes',
  role: '  Staff Engineer,  Platform ',
  company: 'Fabrikam',
  location: 'Remote, US',
  workplace: 'remote',
  employmentType: 'contract',
  payMin: '$160k',
  payMax: '190,000',
  payCurrency: 'USD',
  payPeriod: 'year',
  foundVia: 'referral',
  contact: 'Riley Chen, riley.chen@example.com',
  deadline: '2026-10-15',
  baseDocumentId: 'cv-leadership',
  priority: '1',
  stage: 'shortlisted',
  notes: ' Ask about on-call. ',
  postingRead: null,
};
const EMPTY: Values = Object.fromEntries(Object.keys(FILLED).map((name) => [name, '']));

// The usual sample's first render, as the page draws each card: the store's review, the email that
// moved a card or waits for your signature, who did what, and tailoring's steps.
// The browser writes an SVG shape as <path ...></path> where the page writes <path ... />.
const squash = (html: string): string =>
  html
    .replace(/<(path|rect|circle|use)\b([^>]*?)\s*\/>/g, '<$1$2></$1>')
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/ ([a-z-]+)=""/g, ' $1')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
// Text as the page shows it: tags removed without adding spaces.
const plainOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
// The morning's tailoring rule as the page reads it (Your rules, tailorDaily).
function dailyOf(store: Store): { enabled: boolean; time: string } | null {
  const daily = (store as unknown as Round6Store).applyRules().tailorDaily as
    | { enabled?: boolean; time?: string }
    | boolean
    | undefined;
  if (daily === undefined || daily === null) return null;
  return typeof daily === 'object'
    ? { enabled: Boolean(daily.enabled), time: daily.time ?? '06:00' }
    : { enabled: Boolean(daily), time: '06:00' };
}
function cardOptionsFor(store: Store, model: Model, app: App): CardOptions {
  const watch = store.mailWatch();
  const events = store.mailEvents();
  const waiting = model.isWaiting(app);
  return {
    applying: true,
    review: waiting ? store.review(app.id) : null,
    metric: waiting && store.metric(`review.${app.id}.score`) !== null,
    job: null,
    move: model.mailMoveFor(app, watch),
    wait: (model as unknown as Round6Model).mailWaitFor(app, watch, events),
    prov: store.provenance(app.id),
    tailor: model.tailorFor(app, {
      job:
        app.stage === 'tailoring' || app.stage === 'shortlisted' ? store.tailorJob(app.id) : null,
      drafts: store.drafts().filter((draft) => draft.appId === app.id),
      daily: app.stage === 'shortlisted' ? dailyOf(store) : null,
    }),
    canTailor: true,
  };
}
// Where a Shortlisted or Tailoring role stands in your deputy's queue (T2-20): its place in the
// store's lane order (tailorQueue().laneOrder); else the one tailoring now, then the line in
// order, then the morning's schedule in order, then the rest.
function queueRank(store: Store, app: App): number {
  const queue = (
    store as unknown as { tailorQueue?(): { laneOrder?: Record<string, string[]> } }
  ).tailorQueue?.();
  if (queue?.laneOrder) {
    const index = (queue.laneOrder[app.stage] ?? []).indexOf(app.id);
    return index < 0 ? 9000 : index;
  }
  if (app.stage !== 'shortlisted' && app.stage !== 'tailoring') return 9000;
  const job = store.tailorJob(app.id) as {
    status?: string;
    queue?: { position?: number };
    order?: number;
  } | null;
  if (!job) return 9000;
  if (job.status === 'running') return 0;
  if (job.status === 'queued') return 10 + (Number(job.queue?.position) || 0);
  if (job.status === 'scheduled') return 1000 + (Number(job.order) || 0);
  return 5000;
}
// Each lane's cards in the page's order: a card on the store's needs-you list first, then the
// queue, then the lane order.
function laneFor(store: Store, model: Model, stage: string): App[] {
  const need = new Set((store as unknown as { needYou(): { ids: string[] } }).needYou().ids);
  return store
    .get()
    .applications.filter((app) => app.stage === stage)
    .sort(
      (a, b) =>
        Number(need.has(b.id)) - Number(need.has(a.id)) ||
        queueRank(store, a) - queueRank(store, b) ||
        model.laneOrder(a, b),
    );
}
const LANES = ['shortlisted', 'tailoring', 'approval', 'applied', 'interviewing', 'offer'];

describe('applications-preview.html: page and chrome', () => {
  it('loads the shared scripts in order, app-panels.js last, then its own script', () => {
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
    expect(page.slice(order[5]).replace(/\s+/g, ' ')).toMatch(
      /^<script src="\.\/app-panels\.js"><\/script> <script>/,
    );
  });

  it('opens with the information-architecture title, one primary action, and honest notes', () => {
    expect(textOf(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')).toBe(
      'Every role you’re pursuing.',
    );
    expect(main).toContain('<p class="eyebrow">Applications</p>');
    expect(main).toContain(
      '<p class="intro-copy">Roles you chose to pursue, from shortlist to offer.</p>',
    );
    // The page's primary action is Approve and apply, on each card that waits for you (one in the
    // usual sample); Your rules, Add a role, and Sync from Gmail are secondary.
    expect(main.match(/class="primary-action[^"]*"/g)).toEqual([
      'class="primary-action apps-card-action"',
    ]);
    expect(main).toMatch(
      /class="primary-action apps-card-action" type="button" data-approve-apply="search-infra"/,
    );
    expect(main).toMatch(
      /class="secondary-action"\s+id="apps-add-open"[^>]*data-drawer-open="apps-add"/,
    );
    expect(main).toContain('<p class="sample-note">Sample data · not connected</p>');
    expect(textOf(main)).toContain('Planned for launch, Phase 2.');
    expect(drawer).toContain('<p class="sample-note">Sample data · not connected</p>');
    expect(emailsDrawer).toContain('<p class="sample-note">Sample data · not connected</p>');
    expect(page).not.toContain('This page is being rebuilt in this prototype.');
    expect(page).toContain('Nothing is sent to an employer.');
  });

  it('marks Applications current and starts the deputy keeping track', () => {
    expect(page).toMatch(
      /<a class="app-nav-link" href="\.\/applications-preview\.html" aria-current="page">/,
    );
    const dock = page.slice(
      page.indexOf('<!-- DeputyDock: start -->'),
      page.indexOf('<!-- DeputyDock: end -->'),
    );
    expect(dock).toContain('data-deputy-page="applications"');
    expect(dock).toContain('data-deputy-state="track"');
  });

  it('uses the store’s stage labels, never the gallery’s old “Ready for approval”', () => {
    expect(page).not.toMatch(/Ready for approval/);
  });

  it('copies the flow ribbon from the gallery, with Applications as the current step', () => {
    const ribbon = markedBlock(page, 'FlowRibbon');
    expect(ribbon).not.toBe('');
    expect(ribbon.replace(/ aria-current="page"/g, '')).toBe(
      markedBlock(gallery, 'FlowRibbon').replace(/ aria-current="page"/g, ''),
    );
    const current = [
      ...ribbon.matchAll(/<a class="flow-ribbon-step" href="([^"]+)" aria-current="page">/g),
    ];
    expect(current.map((match) => match[1])).toEqual(['./applications-preview.html']);
    const intro = main.match(/<section class="page-intro[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(intro.indexOf('<p class="intro-copy">')).toBeLessThan(
      intro.indexOf('<!-- FlowRibbon: start -->'),
    );
    // Applications is a home (the employer emails, your rules), so a link with return= gets the
    // shared Back to <page> in its intro (R10-3).
    expect(intro).toMatch(
      /<section class="page-intro apps-intro" aria-labelledby="page-title" data-page-back>/,
    );
  });

  it('names Job matches, never Jobs, wherever this page names that page', () => {
    const named = textOf(page.replace(/<script\b[\s\S]*?<\/script>/g, '')).replace(
      /Amazon Jobs/g,
      '',
    );
    expect(named).not.toMatch(/\bJobs\b/);
    const script = inlineScript.replace(/\/\/.*$/gm, '').replace(/Amazon Jobs/g, '');
    expect(script.match(/'[^'\n]*\bJobs\b[^'\n]*'|`[^`\n]*\bJobs\b[^`\n]*`/g)).toBeNull();
    expect(main).toContain(
      '<a class="secondary-action" id="apps-empty-jobs" href="./jobs-preview.html" hidden>Open Job matches</a>',
    );
  });

  it('keeps one hidden announcement channel each for the page and each of its four drawers', () => {
    const channels = [...page.matchAll(/<p class="([^"]*)" id="([^"]+)" role="status"[^>]*>/g)].map(
      (match) => [match[1], match[2]],
    );
    expect(channels).toEqual([
      ['sr-only', 'apps-announcement'],
      ['sr-only', 'apps-drawer-announcement'],
      ['sr-only', 'apps-add-announcement'],
      ['sr-only', 'apps-emails-announcement'],
      ['sr-only', 'apps-rules-announcement'],
    ]);
    // An open drawer speaks through its own channel, since the page behind it is inert.
    expect(inlineScript).toMatch(
      /: emailsDrawer\?\.open\s*\? emailsChannel\s*: rulesDrawer\?\.open\s*\? rulesChannel\s*: pageChannel;/,
    );
  });

  it('writes no dash anywhere, and an empty lane reads a word (round 6 part 3, T6-8, R9-4)', () => {
    const copy = textOf(page.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ''));
    expect(copy).not.toMatch(/[\u2013\u2014]/);
    const strings = inlineScript.replace(/\/\/.*$/gm, '').match(/'[^'\n]*'|`[^`\n]*`/g) ?? [];
    expect(strings.filter((text) => /[\u2013\u2014]/.test(text))).toEqual([]);
    const { model } = load();
    expect(model.laneEmptyHtml('offer')).toBe('<li class="board-empty">No offers yet.</li>');
    expect(main).toContain('<li class="board-empty">No offers yet.</li>');
  });

  it('parses as a classic script', () => {
    expect(() => new Script(inlineScript)).not.toThrow();
  });
});

// Round 7 (A1, R10-4, D5): one surface, the header first. It says where your roles stand and who
// did what, filters the board to what needs you, and holds Gmail's line and the two drawers.
describe('applications-preview.html: the flow header (round 7, A1, D5)', () => {
  const { store, model } = load();

  it('puts the summary, who did what, your rules, Add a role, Needs you, and Gmail before the board', () => {
    const order = [
      '<p class="section-label">Your flow</p>',
      '<h2 id="apps-flow-title">Where each role stands.</h2>',
      'id="apps-origin"',
      'id="apps-split"',
      'id="apps-rules-open"',
      'id="apps-add-open"',
      'id="apps-rules-line"',
      'id="apps-need"',
      'id="apps-company"',
      'id="apps-filter"',
      'id="apps-gmail"',
      'id="apps-sync"',
      'id="apps-emails-open"',
      'id="apps-flow-notice"',
      'id="apps-move-feedback"',
      'id="apps-board-view"',
      'id="apps-board"',
      'id="apps-closed"',
      'id="apps-empty"',
    ].map((marker) => flow.indexOf(marker));
    expect(
      order.every((index) => index > -1),
      String(order),
    ).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // One surface: nothing else on the page holds the work (no Ready for you, Up next, emails, or
    // rules section; no Board and List switch; no stage strip; no list).
    for (const gone of [
      'id="ready"',
      'id="apps-upcoming"',
      'id="apps-view"',
      'id="apps-stages"',
      'id="apps-list-view"',
      'apps-tracker"',
      'Approve all that passed',
    ]) {
      expect(page, gone).not.toContain(gone);
    }
    expect(main.match(/<section class="task-surface/g)).toHaveLength(1);
    // The emails and your rules keep their anchors (#email, #how-you-apply) as their drawers' ids,
    // outside the page's main, so every page's link to them still lands (in the drawer).
    expect(main).not.toMatch(/id="(?:email|how-you-apply)"/);
    expect(page).toContain('<dialog class="drawer apps-emails-drawer" id="email"');
    expect(page).toContain('<dialog class="drawer apps-rules-drawer" id="how-you-apply"');
  });

  it('shows figures that add up, from the store, each saying what it counts on hover and focus', () => {
    const line =
      main.match(/<p\s+class="apps-summary-line"\s+id="apps-origin"[\s\S]*?<\/p>/)?.[0] ?? '';
    const plain = line
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const value = (key: string) => store.metricText(key);
    expect(plain).toBe(
      `${value('apps.tracked')} tracked: ${value('apps.fromMatches')} from Job matches, ${value('apps.addedByYou')} added by you · ${value('apps.active')} active, ${value('apps.closed')} closed`,
    );
    const number = (key: string) => Number(store.metric(key));
    expect(number('apps.fromMatches') + number('apps.addedByYou')).toBe(number('apps.tracked'));
    expect(number('apps.active') + number('apps.closed')).toBe(number('apps.tracked'));
    const values = {
      tracked: value('apps.tracked'),
      fromMatches: value('apps.fromMatches'),
      addedByYou: value('apps.addedByYou'),
      active: value('apps.active'),
      closed: value('apps.closed'),
    };
    const tips = model.summaryTips(values);
    expect(tips.tracked).toEqual({
      title: '8 tracked',
      text: 'Every role in Applications, open or closed: 5 from Job matches and 3 added by you.',
    });
    // Job matches has no In Applications view now (J2), so From Job matches is a figure here too.
    expect(tips.fromMatches.text).toBe('Roles you added from Job matches.');
    for (const [name, html] of Object.entries(model.summaryHtml(values))) {
      const tip = tips[name as keyof typeof tips];
      expect(line, name).toContain(html);
      expect(html).toContain(`data-tip-title="${tip.title}"`);
      expect(html).toContain(`data-tip="${tip.text}"`);
      expect(html).toMatch(/^<span class="apps-figure" tabindex="0" data-summary=/);
    }
    expect(line).not.toContain('jobs-preview.html?view=tracked');
    expect(inlineScript).toContain('const tips = M.summaryTips(values);');
    expect(inlineScript).toContain("for (const element of $$('[data-summary]', main)) {");
  });

  it('says who did what from the store: tailored, approved, and applied, by your deputy or by you (D5)', () => {
    const split = main.match(/<p\s+class="apps-split"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '';
    const value = (key: string) => store.metricText(key);
    expect(textOf(split)).toBe(
      `Tailored ${value('apps.auto.tailored')} by your deputy, ${value('apps.auto.edited')} edited by you · Approved ${value('apps.auto.approvedAuto')} automatically, ${value('apps.auto.approvedByYou')} by you · Applied ${value('apps.auto.appliedAuto')} automatically, ${value('apps.auto.appliedByYou')} by you`,
    );
    // The usual sample's mix (the store's provenance): 5 tailored by your deputy (1 you edited),
    // every approval yours (auto approve is off), and 1 of the 4 applications auto-applied.
    expect(textOf(split)).toBe(
      'Tailored 5 by your deputy, 1 edited by you · Approved 0 automatically, 4 by you · Applied 1 automatically, 3 by you',
    );
    for (const key of [
      'apps.auto.tailored',
      'apps.auto.edited',
      'apps.auto.approvedAuto',
      'apps.auto.approvedByYou',
      'apps.auto.appliedAuto',
      'apps.auto.appliedByYou',
    ]) {
      expect(split, key).toContain(`<span data-metric="${key}">${value(key)}</span>`);
    }
    // Drawn from the store only where it has the keys (feature-detected), never invented.
    expect(inlineScript).toContain("if (!metricKnown('apps.auto.tailored')) return '';");
    expect(main).toMatch(/<p\s+class="apps-split"\s+id="apps-split"\s+data-skeleton="lines"/);
  });

  it('counts what needs you and filters the board to exactly those cards, in the address (?show=need)', () => {
    const need = main.match(/<button\s+class="apps-need"[\s\S]*?<\/button>/)?.[0] ?? '';
    expect(need).toMatch(/aria-pressed="false"/);
    expect(need).toContain('<span class="apps-need-mark" aria-hidden="true">!</span>');
    // The usual sample: the approval waiting for you, and two cards whose email moves wait for
    // your signature (R9-12), the same cards that wear the orange rule.
    const apps = store.get().applications;
    const needing = apps.filter((app) =>
      model.cardNeedsYou(app, cardOptionsFor(store, model, app)),
    );
    expect(needing.map((app) => app.id).sort()).toEqual(['amazon-sde2', 'devex', 'search-infra']);
    expect(textOf(need)).toBe(`! ${needing.length} need you`);
    expect(need).toContain(`data-count="${needing.length}"`);
    const orange = [
      ...main.matchAll(
        /<article class="board-card apps-card is-attention"[^>]*data-app="([^"]+)"/g,
      ),
    ].map((match) => match[1]);
    expect(orange.sort()).toEqual(needing.map((app) => app.id).sort());
    // The store's count where it has one (apps.needYou), else the same rule over its data.
    // One list (T5-10): the store's needYou() ids filter the board and make the count.
    expect(inlineScript).toContain(
      "const needIds = typeof store.needYou === 'function' ? new Set(store.needYou()?.ids ?? []) : null;",
    );
    expect(inlineScript).toContain('ctx.needIds ? ctx.needIds.has(app.id)');
    expect(inlineScript).toContain('const count = ctx.needIds ? ctx.needIds.size');
    const ids = (store as unknown as { needYou(): { ids: string[] } }).needYou().ids;
    expect([...ids].sort()).toEqual(needing.map((app) => app.id).sort());
    // T5-13: while it filters, each lane's count says what the lane shows.
    expect(inlineScript).toContain('const narrowed = needOnly || companies.size > 0;');
    expect(inlineScript).toContain("let needOnly = params.get('show') === 'need';");
    expect(inlineScript).toContain("if (needOnly) url.searchParams.set('show', 'need');");
    expect(inlineScript).toContain("needButton.setAttribute('aria-pressed', String(needOnly));");
    // Needs you leaves only the lanes that hold such a card.
    expect(inlineScript).toContain('(needOnly && !items.length && !filter)');
    // Nothing waiting reads a word (R9-4).
    expect(inlineScript).toContain(`'<span class="apps-need-noun">Nothing needs you</span>'`);
  });

  it('says how your deputy applies beside Your rules, which opens its drawer', () => {
    const { model: fresh, store: rulesStore } = load6();
    expect(main).toContain(
      `<p class="apps-rules-line" id="apps-rules-line">${fresh.rulesLine(rulesStore.applyRules())}</p>`,
    );
    expect(main).toMatch(
      /id="apps-rules-open"\s+type="button"\s+data-drawer-open="how-you-apply"\s+aria-describedby="apps-rules-line"/,
    );
  });

  it('shows each figure once, equal to the store', () => {
    const markup = page.replace(/<script\b[\s\S]*?<\/script>/g, '');
    const keys = [...markup.matchAll(/data-metric="([^"$]+)"/g)].map((match) => match[1] ?? '');
    // Each stage's count is written twice and shown once: in the phone's stage index at 720px and
    // narrower, beside its lane's name wider (the CSS hides the other).
    const stageKeys = [...LANES, 'closed'].map((stage) => `apps.stage.${stage}`);
    for (const key of stageKeys)
      expect(
        keys.filter((each) => each === key),
        key,
      ).toHaveLength(2);
    const once = keys.filter((key) => !stageKeys.includes(key));
    expect(new Set(once).size, once.join(' ')).toBe(once.length);
    expect(page).toMatch(/\.apps-index \{\s*display: none;\s*\}/);
    expect(page).toMatch(
      /@media \(max-width: 720px\) \{\s*\.apps-index \{\s*display: block;[\s\S]*?\.apps-board \.apps-lane \.board-column-header > \.board-count,\s*\.apps-closed \.apps-closed-head \.apps-closed-toggle > \.board-count \{\s*display: none;/,
    );
    for (const key of keys) {
      const element = markup.match(
        new RegExp(`data-metric="${key.replace(/\./g, '\\.')}">([^<]*)<`),
      );
      expect(element?.[1], key).toBe(store.metricText(key));
    }
    for (const key of [
      'apps.tracked',
      'apps.auto.tailored',
      'gmail.scan.read',
      'mail.events',
      'review.search-infra.score',
      ...LANES.map((stage) => `apps.stage.${stage}`),
      'apps.stage.closed',
      'mail.replyNeeded',
      'mail.waiting',
    ]) {
      expect(keys, key).toContain(key);
    }
    expect(inlineScript).toContain("for (const element of $$('[data-metric]', main))");
  });

  it('shows a filter in words, in its colour, beside its own Show all', () => {
    expect(main).toMatch(
      /<div class="apps-view-meta" id="apps-filter" data-filtered="false">\s*<p class="apps-status" id="apps-status" hidden><\/p>\s*<button class="compact-action" id="apps-show-all" type="button" aria-describedby="apps-status" hidden>Show all<\/button>/,
    );
    expect(inlineScript).toContain(
      code(
        '`<span class="tone-label" data-tone="$(tone}">$(M.escapeHtml(M.stageLabel(filter))}</span>`',
      ),
    );
    expect(inlineScript).toContain(
      'filterBox.dataset.filtered = String(Boolean(filter || needOnly));',
    );
    expect(inlineScript).toContain("params.get('stage')");
    // Show all clears the stage and Needs you, and focus goes to Needs you, which stays in view.
    expect(inlineScript).toMatch(
      /needOnly = false;\s*setFilter\('', \{ say: false \}\);\s*needButton\.focus\(\);/,
    );
  });

  it('says so once when ?stage= names no stage of the board, and shows every role (R9-2)', () => {
    const notice =
      main.match(/<section class="feedback-panel apps-link-notice"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(notice).toContain('id="apps-link-notice" data-kind="notice"');
    expect(notice).toContain('aria-labelledby="apps-link-notice-title"');
    expect(notice).toMatch(/<section[^>]*\shidden>/);
    expect(textOf(notice)).toBe('i That stage isn’t on your board. Showing every role instead.');
    expect(main.indexOf('id="apps-link-notice"')).toBeLessThan(main.indexOf('id="apps-board"'));
    // Under the intro, before the flow, so phones see it in the first view (T7-R5).
    expect(main).toMatch(
      /<\/section>\s*<!-- A \?stage= or \?open= that names nothing on your board[\s\S]*?-->\s*<section class="feedback-panel apps-link-notice" id="apps-link-notice"[\s\S]*?<\/section>\s*<!-- The flow \(round 7/,
    );
    expect(main.indexOf('class="page-intro apps-intro"')).toBeLessThan(
      main.indexOf('id="apps-link-notice"'),
    );
    expect(flow).not.toContain('id="apps-link-notice"');
    expect(inlineScript).toContain("const stageMissing = Boolean(params.get('stage')) && !filter;");
    expect(inlineScript).toMatch(
      /if \(stageMissing\) \{\s*linkNotice\.hidden = false;\s*syncUrl\(\);/,
    );
    // A link to a role that isn't on the board says so in the same notice, and leaves the
    // address as ?stage= does, so a reload shows the board without it.
    expect(inlineScript).toMatch(
      /if \(askedFor && !byId\(askedFor\)\) \{\s*\$\('#apps-link-notice-title'\)\.textContent = 'That role isn’t on your board\.';\s*linkNotice\.hidden = false;\s*try \{\s*const url = new URL\(window\.location\.href\);\s*url\.searchParams\.delete\('open'\);\s*url\.searchParams\.delete\('app'\);\s*window\.history\.replaceState\(window\.history\.state, '', url\);/,
    );
  });

  it('marks the tour in reading order, in the deputy’s words', () => {
    const steps = [
      ...page.matchAll(
        /data-tour-step="(\d)"\s+data-tour-title="([^"]+)"\s+data-tour-text="([^"]+)"/g,
      ),
    ].map((match) => [Number(match[1]), match[2], match[3]]);
    const targets = new Map(steps.map(([number, title]) => [number, title]));
    expect([...targets.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(targets.get(1)).toBe('Every role, in one flow.');
    expect(targets.get(2)).toBe('I count who did what.');
    expect(targets.get(3)).toBe('You set how I apply.');
    expect(targets.get(4)).toBe('Found a role elsewhere? Add it.');
    expect(targets.get(5)).toBe('These need you.');
    expect(targets.get(6)).toBe('I read your job email daily.');
    expect(targets.get(7)).toBe('These are the emails I read.');
    expect(targets.get(8)).toBe('Each card shows its step.');
    for (const [, title, text] of steps) {
      expect(String(title).split(/\s+/).length, String(title)).toBeLessThanOrEqual(6);
      expect(`${title} ${text}`, String(title)).toMatch(/\b(?:I|I’m|I’ll|me|my)\b/);
      expect(`${title} ${text}`).not.toMatch(/[\u2013\u2014]/);
    }
    for (const [id, step] of [
      ['apps-origin', 1],
      ['apps-rules-open', 3],
      ['apps-add-open', 4],
      ['apps-need', 5],
      ['apps-gmail', 6],
      ['apps-emails-open', 7],
    ] as const) {
      expect(main, id).toMatch(new RegExp(`id="${id}"[^>]*data-tour-step="${step}"`));
    }
    // Who did what: the step sits on its wrapper, which phones fold behind one button (T2-12).
    expect(main).toMatch(/<div\s+class="apps-split-wrap"\s+data-tour-step="2"/);
    // The card step sits on the board's first card only, and a card drawn without tour has none.
    const first = laneFor(store, model, 'shortlisted')[0] as App;
    expect(main).toMatch(
      new RegExp(`<article[^>]*data-app="${first.id}" data-step="[a-z]+" data-tour-step="8"`),
    );
    expect(main.match(/<article[^>]*data-tour-step="8"/g)).toHaveLength(1);
    expect(model.cardHtml(first)).not.toContain('data-tour-step');
    // Take the tour sits in the shared page intro's actions (R6-3).
    const intro = main.match(/<section class="page-intro[\s\S]*?<\/section>/)?.[0] ?? '';
    const tourButton =
      '<button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour</button>';
    expect(intro).toContain(tourButton);
    expect(intro.indexOf('<!-- FlowRibbon: end -->')).toBeLessThan(intro.indexOf(tourButton));
    expect(inlineScript).not.toMatch(/tour\.start\(/);
  });
});

// Round 7 (A1, R10-4): the board is the flow. Six lanes in the store's order, Closed folded under
// them, every step on its card with who did it, and no Move to on a card.
describe('applications-preview.html: the board as the flow (round 7, A1, R10-4)', () => {
  const { store, model } = load();

  it('draws six lanes in the flow’s order, each named in its stage colour with its count', () => {
    const lanes = [
      ...main.matchAll(
        /<div class="board-column apps-lane" id="apps-lane-([a-z]+)" data-lane="\1">([\s\S]*?)<\/ol>/g,
      ),
    ];
    expect(lanes.map((lane) => lane[1])).toEqual(LANES);
    expect(LANES).toEqual(store.STAGES.map((stage) => stage.id).filter((id) => id !== 'closed'));
    for (const lane of lanes) {
      const stage = lane[1] ?? '';
      const title =
        lane[2]?.match(/<h3 class="board-column-title"[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? '';
      expect(title).toBe(model.laneTitleHtml(stage));
      expect(textOf(title)).toBe(store.STAGES.find((entry) => entry.id === stage)?.label);
      expect(title).toContain(
        `<span class="tone-label" data-tone="${CANON[stage]?.[0]}" aria-hidden="true"></span>`,
      );
      // The count beside the name is the stage's figure (its one place on the page).
      expect(lane[2]).toContain(
        `<span class="board-count" data-metric="apps.stage.${stage}">${store.metricText(`apps.stage.${stage}`)}</span>`,
      );
    }
    // Every stage keeps the Dashboard's words and colours, read from the store.
    for (const [id, [tone, meaning]] of Object.entries(CANON)) {
      expect(model.stageTone(id)).toBe(tone);
      expect(model.stageMeaning(id)).toBe(meaning);
    }
  });

  it('ships the usual sample’s first render, card for card, so nothing redraws after paint (R10-1)', () => {
    for (const stage of [...LANES, 'closed']) {
      const list =
        main.match(
          new RegExp(
            `<ol class="board-list[^"]*"(?: id="apps-closed-list")? data-lane-list="${stage}"[^>]*>([\\s\\S]*?)</ol>`,
          ),
        )?.[1] ?? '';
      const apps = laneFor(store, model, stage);
      const first = stage === 'shortlisted';
      const expected = apps.length
        ? apps
            .map((app, index) =>
              model.cardHtml(app, {
                ...cardOptionsFor(store, model, app),
                tour: first && index === 0,
              }),
            )
            .join('')
        : model.laneEmptyHtml(stage);
      expect(squash(list), stage).toBe(squash(expected));
    }
  });

  it('opens with the new roles waiting in Job matches, in the first lane', () => {
    const line =
      main.match(/<p class="apps-lane-intro" id="apps-matches-line">([\s\S]*?)<\/p>/)?.[1] ?? '';
    const key = store.metric('jobs.toReview') !== null ? 'jobs.toReview' : 'jobs.new';
    expect(line).toBe(
      `<a class="apps-summary-link apps-matches-link" href="./jobs-preview.html" data-focus-key="matches-line"><span data-metric="${key}">${store.metricText(key)}</span> new roles to review in Job matches</a>`,
    );
    const shortlisted = main.slice(
      main.indexOf('id="apps-lane-shortlisted"'),
      main.indexOf('id="apps-lane-tailoring"'),
    );
    expect(shortlisted).toContain('id="apps-matches-line"');
  });

  it('gives every card its details link and one action at most, and moves a role from its panel', () => {
    for (const app of store.get().applications) {
      const card =
        main.match(new RegExp(`<article[^>]*data-app="${app.id}"[\\s\\S]*?</article>`))?.[0] ?? '';
      expect(card, app.id).toContain(`href="./applications-preview.html?open=${app.id}"`);
      expect(card).toContain('data-drawer-open="apps-drawer"');
      expect(card).toMatch(/<span class="company-mark" aria-hidden="true">[A-Z]{1,2}<\/span>/);
      // No Move to on a card (round 7): one step, one action.
      expect(card).not.toContain('<select');
      expect(card).not.toMatch(/for="move-/);
      expect((card.match(/ apps-card-action"/g) ?? []).length).toBeLessThanOrEqual(1);
    }
    // Move to lives in the role's panel (Your control), every stage with the current one marked.
    expect(drawer).toContain(
      '<label class="field-label" for="apps-move">Move to<span class="sr-only"> a stage</span></label>',
    );
    expect(drawer).toContain(
      '<select class="field-control" id="apps-move" data-focus-key="panel-move">',
    );
    const options = [
      ...model
        .moveOptions(store.application('workspace') as App)
        .matchAll(/<option value="([^"]*)"( disabled)?>/g),
    ].map((match) => [match[1], Boolean(match[2])]);
    expect(options).toEqual([
      ['', false],
      ...store.STAGES.map((stage) => [stage.id, stage.id === 'shortlisted']),
    ]);
    expect(inlineScript).toContain('moveCard(openId, moveSelect.value, { from: moveSelect });');
  });

  it('shows each step on its card: Tailor now, tailoring’s steps, the review with Approve and apply, and the next date', () => {
    const kinds = Object.fromEntries(
      store
        .get()
        .applications.map((app) => [
          app.id,
          model.stepFor(app, cardOptionsFor(store, model, app)).kind,
        ]),
    );
    expect(kinds).toEqual({
      workspace: 'shortlisted',
      'northwind-platform': 'shortlisted',
      'cloud-reliability': 'tailoring',
      'search-infra': 'approval',
      devex: 'applied',
      'amazon-sde2': 'applied',
      'northwind-backend': 'interviewing',
      'contoso-platform': 'closed',
    });
    const card = (id: string) =>
      model.cardHtml(
        store.application(id) as App,
        cardOptionsFor(store, model, store.application(id) as App),
      );
    // Shortlisted: when your deputy tailors it (the morning's tailoring, in the store's words: its
    // day, time, and place in line), and Tailor now beside it, compact.
    const scheduled = store.tailorJob('workspace') as { status: string; text: string };
    expect(scheduled.status).toBe('scheduled');
    expect(textOf(card('workspace'))).toContain(`${scheduled.text} Tailor now`);
    // With the rule off, the store's manual words: the role waits for Tailor now.
    const manual = load();
    expect(manual.store.setApplyRules({ tailorDaily: { enabled: false } }).ok).toBe(true);
    const manualJob = manual.store.tailorJob('workspace') as { status: string; text: string };
    expect(manualJob.status).toBe('manual');
    const manualApp = manual.store.application('workspace') as App;
    expect(
      textOf(
        manual.model.cardHtml(manualApp, {
          ...cardOptionsFor(manual.store, manual.model, manualApp),
        }),
      ),
    ).toContain(`${manualJob.text} Tailor now`);
    // Without the store's words, the page says it plainly.
    const off = model.tailorFor(store.application('workspace') as App, {
      daily: { enabled: false, time: '06:00' },
    });
    expect(textOf(model.tailorHtml(store.application('workspace') as App, off))).toContain(
      'Waits for you to start it Tailor now',
    );
    // A store without the rule, or a role without a job: one plain line, still Tailor now.
    expect(
      textOf(model.cardHtml(store.application('workspace') as App, { canTailor: true })),
    ).toContain('Not started yet Tailor now');
    expect(card('workspace')).toContain(
      '<button class="compact-action apps-card-action" type="button" data-tailor-start="workspace"',
    );
    expect(card('workspace')).toContain('data-tailor-start="workspace"');
    expect(textOf(model.cardHtml(store.application('workspace') as App))).toContain(
      'Tailor materials',
    );
    // Tailoring: the store's job (round 7, AP-2) in one status line: its steps as pips, the words
    // (a pause says why), and its one action. The seed's job is paused, so the card offers Carry on.
    const tailoring = card('cloud-reliability');
    const seededJob = store.tailorJob('cloud-reliability') as {
      status: string;
      steps: Array<{ state: string }>;
    };
    expect(seededJob.status).toBe('stopped');
    const seededTailor = model.tailorFor(store.application('cloud-reliability') as App, {
      job: seededJob,
    });
    // The store's own words for the pause (who paused it and when), and its reason under them.
    const seededText = (seededJob as unknown as { text: string; reason: string | null }).text;
    expect(seededTailor?.words).toBe(seededText);
    expect(seededText).toMatch(/paused/i);
    expect(seededTailor?.action).toEqual({ kind: 'start', label: 'Carry on' });
    expect(tailoring).toContain(
      '<div class="apps-step-row apps-tailor" data-state="stopped" data-tailor="cloud-reliability">',
    );
    const doneSteps = seededJob.steps.filter((step) => step.state === 'done').length;
    expect(textOf(tailoring)).toContain(
      `${seededTailor?.words} , ${doneSteps} of 3 steps done Carry on`,
    );
    expect(tailoring.match(/run-tracker-pip is-done/g)).toHaveLength(doneSteps);
    expect(tailoring).toContain('data-tailor-start="cloud-reliability"');
    // Without the store's job, the drafts your deputy wrote say where it is.
    const drafted = model.tailorFor(store.application('cloud-reliability') as App, {
      drafts: store.drafts().filter((draft) => draft.appId === 'cloud-reliability'),
    });
    expect(
      textOf(model.tailorHtml(store.application('cloud-reliability') as App, drafted)),
    ).toContain('Drafted: your review next , 2 of 3 steps done Review the drafts');
    // Approval: your deputy's review, then Approve and apply and Preview, on the card.
    const approval = card('search-infra');
    expect(approval).toContain(
      '<span class="apps-review-value" data-metric="review.search-infra.score">94</span>',
    );
    expect(textOf(approval)).toContain(
      'Your deputy’s review Passed every check · 5 of 5 Approve and apply',
    );
    expect(approval).toContain(
      '<button class="primary-action apps-card-action" type="button" data-approve-apply="search-infra"',
    );
    expect(approval).toContain('data-preview="search-infra" data-kind="resume"');
    // Applied, Interviewing: the next date, or the email's waiting move in its place (R9-12).
    expect(textOf(card('northwind-backend'))).toContain('Phone screen Tue, Oct 6, 10:00');
    expect(textOf(card('amazon-sde2'))).toContain(
      'It moves to Interviewing once you sign. Review and sign',
    );
    expect(textOf(card('amazon-sde2'))).not.toContain('Follow up');
    expect(textOf(card('contoso-platform'))).toContain('Not selected · Sep 20');
  });

  it('tailors on the card: Tailor now moves it to Tailoring at once, live, and Stop pauses it', () => {
    const { store: live, model: m } = load();
    expect(live.startTailoring('workspace')).toMatchObject({ ok: true });
    const app = live.application('workspace') as App;
    expect(app.stage).toBe('tailoring');
    const tailor = m.tailorFor(app, { job: live.tailorJob('workspace') });
    expect(tailor).toMatchObject({
      status: 'running',
      words: 'Tailoring now: Tailoring your résumé',
    });
    const html = m.tailorHtml(app, tailor);
    expect(html).toContain('data-state="live"');
    expect(html).toContain('data-tailor-time="workspace"');
    expect(html).toContain('data-tailor-stop="workspace"');
    expect(textOf(html)).toContain('Tailoring now: Tailoring your résumé');
    // Its place in your deputy's queue, and a pause that says why (ST's queue, AP-6).
    const queued = (queue: Record<string, unknown>) =>
      m.tailorFor(live.application('northwind-platform') as App, {
        job: { status: 'queued', steps: [], ...queue },
      });
    expect(queued({ queue: { position: 1, of: 2 } })?.words).toBe('Your deputy starts this next');
    expect(
      queued({ queue: { position: 2, of: 2 }, startsAt: '2026-10-02T14:18:00-07:00' })?.words,
    ).toBe('Number 2 in line · starts today, 14:18');
    expect(queued({ queue: { position: 1 } })?.action).toEqual({
      kind: 'start',
      label: 'Tailor now',
    });
    expect(
      m.tailorFor(app, {
        job: { status: 'stopped', reason: 'Your OpenAI key reached its limit', steps: [] },
      })?.words,
    ).toBe('Paused: Your OpenAI key reached its limit');
    // The page starts it from the card, follows it each second, and Stop pauses it.
    expect(inlineScript).toContain(
      "const result = typeof store.startTailoring === 'function' ? store.startTailoring(id) : store.draftMaterials(id);",
    );
    expect(inlineScript).toContain('const result = store.stopTailoring(id);');
    expect(inlineScript).toContain("for (const element of $$('[data-tailor-time]')) {");
  });

  it('says who did each card’s last step, in words: you, your deputy, or an email', () => {
    const who = (id: string) => {
      const app = store.application(id) as App;
      return model.whoFor(app, { prov: store.provenance(id) });
    };
    // Dates keep a no-break space, so a date never wraps (as everywhere on the page).
    // When each role's last step was, from the store: today's with its time ("today, 09:05"),
    // an older one by its day (a no-break space keeps a date whole).
    const dayOf = (id: string) => {
      const step = (store.application(id) as App).timeline.at(-1) as
        | { date: string; at?: string }
        | undefined;
      const today = step?.at && model.whenText(step.at).startsWith('today');
      return model.whenText((today ? step?.at : step?.date) ?? '');
    };
    expect(dayOf('workspace')).toMatch(/^(?:today, \d\d:\d\d|[A-Z][a-z]{2}\u00a0\d{1,2})$/);
    expect(who('workspace')).toEqual({ by: 'you', what: 'Shortlisted', when: dayOf('workspace') });
    expect(who('northwind-platform')).toEqual({
      by: 'you',
      what: 'Added',
      when: dayOf('northwind-platform'),
    });
    // The latest step whatever its source (T6b-2): the pause, by you, at its time, never the
    // tailoring that started before it; from the timeline or from the paused job itself.
    const paused = store.application('cloud-reliability') as App;
    const tailor = model.tailorFor(paused, { job: store.tailorJob('cloud-reliability') });
    expect(tailor?.status).toBe('stopped');
    const pausedLine = { by: 'you', what: 'Paused', when: 'today, 11:28' };
    expect(
      model.whoFor(paused, {
        prov: store.provenance('cloud-reliability'),
        tailor,
      }),
    ).toEqual(pausedLine);
    const untold = {
      ...paused,
      timeline: paused.timeline.filter((step) => !/^Paused/.test(step.label)),
    };
    expect(untold.timeline.at(-1)?.label).toBe('Tailoring started');
    expect(model.whoFor(untold, { prov: store.provenance('cloud-reliability'), tailor })).toEqual(
      pausedLine,
    );
    // The store's provenance tailoring alone says it too (ST, 18.3).
    expect(
      (store.provenance('cloud-reliability') as { tailoring?: { kind: string; by: string } })
        .tailoring,
    ).toMatchObject({ kind: 'paused', by: 'you' });
    expect(model.whoFor(untold, { prov: store.provenance('cloud-reliability') })).toEqual(
      pausedLine,
    );
    expect(model.whoHtml(pausedLine)).toContain(
      '<span class="apps-who-what">Paused</span>\u00a0· <span class="apps-who-when">today, 11:28</span>',
    );
    // The store's provenance names who applied: your deputy in the background, or you.
    expect(who('amazon-sde2')).toEqual({
      by: 'deputy',
      what: 'Auto-applied',
      when: 'Sat, Sep\u00a026, 10:12',
    });
    // When you applied, as the store keeps it (with its time where it has one).
    const appliedAt =
      (store.provenance('devex') as { applied?: { at?: string } } | null)?.applied?.at ??
      '2026-09-30';
    expect(who('devex')).toEqual({ by: 'you', what: 'Applied', when: model.whenText(appliedAt) });
    expect(model.whenText(appliedAt)).toMatch(/^(?:[A-Z][a-z]{2}, )?Sep\u00a030/);
    expect(who('northwind-backend')).toEqual({
      by: 'email',
      what: 'Phone screen scheduled',
      when: 'Sep\u00a029',
    });
    // Approved automatically by your rules reads so, with the score.
    const approved = { ...(store.application('search-infra') as App), approval: 'approved' };
    expect(
      model.whoFor(approved, {
        prov: { approved: { by: 'auto', at: '2026-10-02T10:02:00-07:00', score: 94 } },
      }),
    ).toEqual({ by: 'deputy', what: 'Auto-approved, score 94', when: 'today, 10:02' });
    expect(
      model.whoFor(approved, {
        prov: { approved: { by: 'you', at: '2026-10-02T10:02:00-07:00' } },
      }),
    ).toEqual({
      by: 'you',
      what: 'Approved',
      when: 'today, 10:02',
    });
    // The words carry it (the mark beside them is for the eye only).
    const html = model.whoHtml(who('amazon-sde2'));
    expect(html).toMatch(
      /^<p class="apps-who" data-by="deputy"><svg class="apps-who-icon"[^>]*aria-hidden="true"/,
    );
    expect(plainOf(html)).toBe('Your deputy: Auto-applied · Sat, Sep 26, 10:12');
    expect(model.WHO).toEqual({ you: 'You', deputy: 'Your deputy', email: 'An email' });
    // A role with no steps yet has no who line, never a dash.
    expect(model.whoFor({ ...(store.application('workspace') as App), timeline: [] })).toBeNull();
    expect(model.whoHtml(null)).toBe('');
  });

  it('folds Closed under the board, with its count, and opens its cards on request', () => {
    const closed = main.match(/<section class="apps-closed"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(closed).toMatch(
      /<button class="apps-closed-toggle" id="apps-closed-toggle" type="button" aria-expanded="false" aria-controls="apps-closed-list" data-focus-key="closed-toggle"><span class="apps-closed-name">Closed<\/span><span class="board-count" data-metric="apps\.stage\.closed">1<\/span><span class="apps-closed-verb">Show<\/span><\/button>/,
    );
    expect(closed).toMatch(
      /<ol class="board-list apps-closed-list" id="apps-closed-list" data-lane-list="closed" aria-labelledby="apps-closed-title" hidden>/,
    );
    expect(inlineScript).toContain("let closedOpen = filter === 'closed';");
    expect(inlineScript).toContain("closedToggle.setAttribute('aria-expanded', String(open));");
  });

  it('lays the lanes out as a grid that never scrolls sideways: three, two, or one list by stage', () => {
    expect(page).toMatch(/\.apps-view \{\s*container: apps-board \/ inline-size;\s*\}/);
    expect(page).toMatch(
      /\.apps-board\.board \{\s*grid-auto-flow: row;\s*grid-template-columns: minmax\(0, 1fr\);\s*gap: 13px;\s*padding: 0;\s*overflow: visible;/,
    );
    expect(page).toMatch(
      /@container apps-board \(min-width: 520px\) \{\s*\.apps-board\.board \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(page).toMatch(
      /@container apps-board \(min-width: 780px\) \{\s*\.apps-board\.board \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
    );
    // No scroll cue and no scroll region: the board is never wider than its frame.
    expect(page).not.toContain('Scroll for more stages');
    expect(main).not.toMatch(/id="apps-board"[^>]*tabindex/);
  });

  it('gives phones a stage index: jump links with each count, which never hide a card', () => {
    const index =
      main.match(
        /<nav class="apps-index" id="apps-index" aria-label="Jump to a stage">[\s\S]*?<\/nav>/,
      )?.[0] ?? '';
    const links = [
      ...index.matchAll(/<li data-index="([a-z]+)"><a class="apps-index-link" href="#([a-z-]+)"/g),
    ].map((match) => [match[1], match[2]]);
    expect(links).toEqual([
      ...LANES.map((stage) => [stage, `apps-lane-${stage}`]),
      ['closed', 'apps-closed'],
    ]);
    for (const stage of [...LANES, 'closed'])
      expect(index).toContain(
        `<span class="apps-index-count" data-metric="apps.stage.${stage}">${store.metricText(`apps.stage.${stage}`)}</span>`,
      );
    // It jumps (Closed opens on the way) and focuses the lane's heading; it follows the lanes a
    // filter leaves, and filters nothing itself.
    expect(inlineScript).toContain("const link = event.target.closest('.apps-index-link');");
    expect(inlineScript).toContain(
      "lane.scrollIntoView({ block: 'start', behavior: still() ? 'auto' : 'smooth' });",
    );
    expect(inlineScript).toContain('if (entry) entry.hidden = lane.hidden;');
  });

  it('shows each role’s fit in the fit’s colour, as Job matches does', () => {
    expect(model.cardHtml(store.application('search-infra') as App)).toContain(
      '<span class="tone-label" data-tone="green">Strong fit</span>',
    );
    expect(model.cardHtml(store.application('cloud-reliability') as App)).toContain(
      '<span class="tone-label" data-tone="blue">Good fit</span>',
    );
    expect(model.cardHtml(store.application('northwind-platform') as App)).toContain(
      '<span class="apps-card-source">Added by you</span>',
    );
  });

  it('caps each lane at five with See all, and offers the companies most roles first', () => {
    const { store: s6, model: m6 } = load6();
    expect(m6.LANE_CAP).toBe(5);
    const companies = m6.companiesOf(s6.get().applications);
    expect(companies[0]).toEqual({ value: 'Google', label: 'Google', count: 3 });
    expect(companies.map((company) => company.count)).toEqual(
      [...companies.map((company) => company.count)].sort((a, b) => b - a),
    );
    expect(main).toContain('<div class="apps-company" id="apps-company" hidden></div>');
    expect(inlineScript).toContain("typeof multiSelect !== 'function'");
    expect(inlineScript).toContain("url.searchParams.set('company', [...companies].join(','));");
    expect(inlineScript).toContain(code("$(whole ? 'Show fewer' : `See all $(items.length}`}"));
  });
});

// The store's current mail totals as the page reads them (mailTotals): one source for the Gmail
// line, the Sync notice, and the Emails drawer (T2b-1).
const totalsOf = (store: Store) => ({
  moved: Number(store.metric('mail.moved')) || 0,
  waiting: Number(store.metric('mail.waiting')) || 0,
  replyNeeded: Number(store.metric('mail.replyNeeded')) || 0,
});

// Round 7 (D3): Gmail scans once a day over the last 48 hours of mail, and Sync from Gmail scans now
// for one run; the cards an email moved glide to their lanes, and one notice says what changed.
describe('applications-preview.html: Gmail and Sync from Gmail (round 7, D3)', () => {
  it('says the last scan, its window, what it did, and the next scan, each count from the store', () => {
    const { store, model } = load();
    const scans = store.gmailScans();
    const fig = (name: string, value: unknown) =>
      store.metric(name) !== null
        ? `<span data-metric="${name}">${store.metricText(name)}</span>`
        : String(value);
    // What this scan found (the store's foundText), then the current totals (T2b-1: one source).
    const totals = totalsOf(store);
    const html = model.gmailFactsHtml(scans, { fig, ago: '7 hours ago', totals });
    expect(plainOf(html)).toBe(
      'Last scan today, 07:00 (7 hours ago): 6 new job emails since yesterday’s 07:00 scan. 2 moves wait for your signature, 2 emails need your reply. Next scan Sat, Oct 3, 07:00',
    );
    expect(html).toContain('<span data-gmail-ago>7 hours ago</span>');
    expect(html).toContain(
      '<span data-metric="mail.waiting">2</span> moves wait for your signature',
    );
    expect(html).toContain('<span data-metric="mail.replyNeeded">2</span> emails need your reply');
    // The shipped line is the first render's.
    const line =
      main.match(
        /<p class="apps-gmail-facts" id="apps-gmail-facts" data-skeleton="lines">([\s\S]*?)<\/p>/,
      )?.[1] ?? '';
    const ago = line.match(/<span data-gmail-ago(?:="")?>([^<]*)</)?.[1] ?? '';
    expect(squash(line)).toBe(squash(model.gmailFactsHtml(scans, { fig, ago, totals })));
    expect(model.gmailFactsHtml({ ...scans, last: null })).toBe('');
  });

  it('offers Sync from Gmail with what it costs, and Connect Gmail where it isn’t connected', () => {
    const gmail = main.match(/<section\s+class="apps-gmail"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(gmail).toContain(
      '<button class="secondary-action apps-sync" id="apps-sync" type="button" aria-describedby="apps-sync-cost" data-focus-key="sync"><span class="apps-sync-label" id="apps-sync-label">Sync from Gmail</span><span class="apps-sync-cost" id="apps-sync-cost">uses 1 run</span></button>',
    );
    expect(gmail).toContain(
      '<a class="secondary-action" id="apps-gmail-connect" href="./connections-preview.html#gmail" data-return-link hidden>Connect Gmail</a>',
    );
    expect(gmail).toContain('data-drawer-open="email"');
    expect(plainOf(gmail)).toContain('Emails (10)');
    const { store } = load();
    expect(store.gmailScans().scanNow).toMatchObject({ cost: 'uses 1 run', available: true });
    // The store's own words for the cost and for a refusal; nothing is used then.
    expect(inlineScript).toContain("const cost = scans?.scanNow?.cost ?? 'uses 1 run';");
    expect(inlineScript).toContain(
      "'no-runs': `No runs are left this month. Get more runs, or wait for $" + '{(() => {',
    );
    expect(inlineScript).toContain('message: `$' + '{why} Nothing was used.`,');
  });

  it('scans now for one run, says what changed, and puts the moves back with Undo', () => {
    const { store, model } = load();
    const before = Number(store.metric('runs.left'));
    const result = store.gmailScan();
    expect(result).toMatchObject({ ok: true, moved: [], waiting: 1, needsReply: 1 });
    expect(Number(store.metric('runs.left'))).toBe(before - 1);
    const role = (id: string) => store.application(id)?.role ?? '';
    const stage = (id: string) => model.stageLabel(store.application(id)?.stage ?? '');
    const words = model.syncWords(result, { roleOf: role, stageOf: stage });
    expect(words.title).toBe('Synced: 2 new job emails');
    expect(words.message).toBe(
      `1 move waits for your signature. 1 email needs your reply. Used 1 run; ${before - 1} runs left.`,
    );
    // Signed, the same email moves its card at once: the board glides it to Applied.
    const signedStore = load();
    signed(signedStore.store);
    const moved = signedStore.store.gmailScan();
    expect(moved).toMatchObject({ ok: true, moved: ['northwind-platform'] });
    const after = signedStore.model.syncWords(moved, {
      roleOf: (id) => signedStore.store.application(id)?.role ?? '',
      stageOf: (id) => signedStore.model.stageLabel(signedStore.store.application(id)?.stage ?? ''),
    });
    expect(after.message).toMatch(/^Staff Engineer, Developer Platform moved to Applied\. /);
    expect(after.moved).toEqual(['northwind-platform']);
    // Undo the moves goes through each email's own Undo.
    expect(inlineScript).toContain(
      "if (!event.target.closest('[data-sync-undo]') || !lastSync?.length) return;",
    );
    expect(inlineScript).toContain('if (store.undoMailEvent?.(move.mailId)?.ok) back += 1;');
    // A sync that read nothing says so in words.
    expect(
      model.syncWords({ ok: true, scan: { read: 0 }, moved: [], runs: { left: 3 } }).message,
    ).toBe('Nothing new since the last scan. Used 1 run; 3 runs left.');
  });

  it('refuses calmly without Gmail or runs, and uses nothing', () => {
    const { store } = load();
    store.disconnectGmail();
    const refused = store.gmailScan();
    expect(refused).toMatchObject({ ok: false, reason: 'gmail-not-connected' });
    expect(inlineScript).toContain("title: 'We couldn’t sync from Gmail.',");
    expect(inlineScript).toContain('syncButton.hidden = !connected || !can.scan;');
  });
});

// Round 7 (A1): the employer emails and How your deputy applies each open in a drawer over the
// board, with their anchors (#email, #mail-<id>, ?mail=<id>, #how-you-apply) landing in them.
describe('applications-preview.html: the two drawers (round 7, A1)', () => {
  it('holds the employer emails in a drawer that Emails (N) opens, with its gate and the newest five', () => {
    expect(emailsDrawer).toMatch(
      /aria-labelledby="apps-emails-title" aria-describedby="apps-mail-figures"/,
    );
    expect(emailsDrawer).toContain(
      '<h2 class="drawer-title" id="apps-emails-title">What employers told you.</h2>',
    );
    expect(emailsDrawer).toContain('<p class="eyebrow">Updates from your email</p>');
    expect(emailsDrawer).toContain('id="apps-mail-gate"');
    expect(emailsDrawer).toContain('<ol class="apps-mail-list" id="apps-mail-list"');
    expect(emailsDrawer).toContain('id="apps-mail-see-all"');
    expect(main).not.toContain('apps-mail-list');
    expect(inlineScript).toContain('const mailSection = emailsDrawer;');
  });

  it('holds How your deputy applies in a drawer that Your rules opens, the same form and settings', () => {
    expect(rulesDrawer).toContain(
      '<h2 class="drawer-title" id="apps-rules-title">Your rules, kept every time.</h2>',
    );
    expect(rulesDrawer).toContain('<form class="apps-rules-form" id="apps-rules-form" novalidate>');
    expect(rulesDrawer).toContain('id="apps-rules-reset"');
    expect(main).not.toContain('apps-rules-form');
  });

  it('lands the anchors in their drawers: #email, an email’s own, ?mail=, and #how-you-apply', () => {
    expect(inlineScript).toContain("if (hash === 'email') openEmails();");
    expect(inlineScript).toContain(
      "else if (hash.startsWith('mail-') && mailEvent(hash)) openEmails(hash);",
    );
    expect(inlineScript).toContain("else if (hash === 'how-you-apply') openRules();");
    expect(inlineScript).toContain("window.addEventListener('hashchange', followHash);");
    expect(inlineScript).toContain("const mailId = params.get('mail');");
    // The address says which drawer is open, so a reload or a way back lands in it.
    expect(inlineScript).toContain("const HASHES = { emails: '#email', rules: '#how-you-apply' };");
    // An email's row lands in view with its first action focused, again after the load's own jump.
    expect(inlineScript).toContain("here.scrollIntoView({ block: 'start', behavior: 'auto' });");
    expect(inlineScript).toContain(
      "if (document.readyState !== 'complete') window.addEventListener('load', () => window.requestAnimationFrame(land), { once: true });",
    );
    // A role named in the emails opens its panel over the board, not over the emails.
    expect(inlineScript).toContain('window.JobDeputyComponents?.closeDrawer(emailsDrawer);');
  });

  it('shows the prompts only as the shared summary with Open in Prompts (R10-5)', () => {
    expect(emailsDrawer).toContain(
      '<ul class="prompt-summary-list" data-prompt-summaries>\n            <li data-prompt-summary="mail" data-prompt-size="row" data-prompt-heading="4"></li>\n            <li data-prompt-summary="reply" data-prompt-size="row" data-prompt-heading="4"></li>\n          </ul>',
    );
    expect(rulesDrawer).toContain(
      '<li data-prompt-summary="answer" data-prompt-size="row" data-prompt-heading="4"></li>',
    );
    // No See the prompt of its own anywhere on the page (the shared summary has Open in Prompts).
    expect(page).not.toContain('data-prompt-open');
    expect(page).not.toContain('See the prompt');
    expect(page.match(/data-prompt-summary="/g)).toHaveLength(3);
  });
});

// R10-1 and R9-3: the first view is drawn before paint (or held behind the shared skeleton), and
// cards glide to where they are now without moving focus or the page.
describe('applications-preview.html: boot and live moves (R10-1, R9-3)', () => {
  it('holds the regions it redraws behind the skeleton and reveals them once, after the first render', () => {
    for (const id of ['apps-split', 'apps-gmail-facts', 'apps-board']) {
      expect(main, id).toMatch(new RegExp(`id="${id}"[^>]*data-skeleton="[a-z]+"`));
    }
    const start = inlineScript.slice(inlineScript.indexOf('const away = awayMoves();'));
    expect(start.indexOf('render();')).toBeLessThan(
      start.indexOf('window.JobDeputyComponents?.boot?.ready?.();'),
    );
    expect(inlineScript).toContain('window.JobDeputyComponents?.boot?.ready?.();');
  });

  it('glides a card that moved to its new place, rings it once, and keeps focus and the scroll still', () => {
    expect(inlineScript).toContain('const before = booted ? boxesOf() : null;');
    expect(inlineScript).toContain('const moved = glide(before);');
    expect(inlineScript).toMatch(
      /card\.animate\(\[\{ transform: `translate\(\$\{dx\}px, \$\{dy\}px\)` \}, \{ transform: 'none' \}\], \{\s*duration: 380,\s*easing: 'cubic-bezier\(0\.22, 1, 0\.36, 1\)',/,
    );
    expect(inlineScript).toContain('const motion = !still() && !document.hidden;');
    expect(inlineScript).not.toMatch(/glide[\s\S]{0,400}scrollIntoView/);
    // Reduced motion and Pause motion: no glide and no ring, only the words.
    expect(page).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.apps-landed \{\s*animation: none;/,
    );
    expect(page).toContain(
      'html[data-motion="paused"] .apps-landed,\n      html[data-motion="paused"] .apps-tailor .run-tracker-pip {\n        animation: none;',
    );
  });

  it('holds a redraw while you press, so a click is never lost to a card drawn again (R9-3)', () => {
    expect(inlineScript).toContain(
      'if (holding) {\n            heldRender = true;\n            return;\n          }',
    );
    expect(inlineScript).toContain('holding = window.setTimeout(release, 1000);');
    // A lane redraws only when its shape changes, so a store tick never replaces your answers.
    expect(inlineScript).toContain('const shape = laneHtml(new Map());');
    expect(inlineScript).toContain('if (list.dataset.drawn !== shape) {');
  });

  it('shows the moves made while you were away (a signature, a job that finished) as they glide in', () => {
    expect(inlineScript).toContain("const LANES_KEY = 'jobdeputy.applications.lanes';");
    // Said as the shared quiet toast, which floats over the page, so nothing moves after the first
    // paint (R10-1).
    expect(inlineScript).toMatch(
      /components\(\)\.notice\(\{\s*id: `away-\$\{[\s\S]*?toast: true,\s*record: false,/,
    );
    expect(inlineScript).toContain("window.addEventListener('pagehide', () => {");
    expect(inlineScript).toMatch(
      /apps = now\.map\(\(app\) => \(was\.has\(app\.id\) \? \{ \.\.\.app, stage: was\.get\(app\.id\) \} : app\)\);\s*render\(\);\s*apps = now;\s*booted = true;\s*render\(\);/,
    );
    expect(inlineScript).toContain(
      "title: told.length === 1 ? 'A card moved while you were away' : `$" +
        '{told.length} cards moved while you were away`,',
    );
  });
});

describe('applications-preview.html: drawers and states', () => {
  it('holds the role details: about the role, timeline, dates, notes, materials, applied, and close', () => {
    expect(drawer).toMatch(/aria-labelledby="apps-drawer-title"/);
    expect(drawer).toContain('<section class="drawer-section" id="apps-about"');
    expect(drawer).toContain('<dl class="apps-facts" id="apps-about-facts"></dl>');
    expect(drawer).toMatch(
      /<details class="apps-description" id="apps-about-description" hidden>\s*<summary class="apps-description-toggle">The job description<\/summary>/,
    );
    expect(drawer).toContain('<ol class="timeline" id="apps-drawer-timeline"');
    expect(drawer).toMatch(/<input class="field-control" id="apps-followup" type="date"/);
    expect(drawer).toMatch(
      /<input class="field-control" id="apps-interview" type="datetime-local"/,
    );
    expect(drawer).toMatch(/<textarea[^>]*id="apps-notes"/);
    expect(drawer).toContain('id="apps-save-status"');
    expect(drawer).toContain(
      'href="./materials-preview.html?app=search-infra&amp;from=applications"',
    );
    expect(textOf(drawer)).toContain('Did you apply on the employer site?');
    expect(drawer).toMatch(/id="apps-confirm-yes" type="button">I applied</);
    expect(drawer).toMatch(/id="apps-confirm-no" type="button">Not yet</);
    const reasons = [...drawer.matchAll(/name="apps-close-reason" value="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(reasons).toEqual(['Not selected', 'Withdrew', 'Accepted offer']);
    expect(textOf(drawer)).toContain(
      'Approving lets your deputy submit this application at launch. In this prototype nothing is sent.',
    );
    // Once approved, both ways on are named, as Materials names them.
    expect(textOf(drawer)).toContain(
      'Next, you apply on the employer site and mark it applied, or let your deputy fill the application (planned for launch; the preview below). In this prototype nothing is sent.',
    );
    // The base document comes from the store: the one you chose, its drafts' base, or the default.
    expect(inlineScript).toContain(
      'const id = app.baseDocumentId ?? drafted?.base ?? state.documents?.defaults?.resume ?? state.documents?.defaultId;',
    );
  });

  it('offers the autofill preview in the drawer for materials approved or waiting', () => {
    const block =
      drawer.match(/<div class="apps-drawer-block" id="apps-drawer-fill">[\s\S]*?<\/div>/)?.[0] ??
      '';
    expect(block).toMatch(
      /<a\s+class="compact-action"\s+id="apps-drawer-fill-link"\s+href="\.\/autofill-preview\.html\?app=search-infra"/,
    );
    expect(textOf(block)).toContain('Fill the application (preview)');
    expect(textOf(block)).toContain('Nothing is sent.');
    expect(inlineScript).toContain("field('#apps-drawer-fill').hidden = !offer;");
    expect(inlineScript).toContain('fillLink.href = M.fillHref(app);');
    expect(textOf(drawer)).toContain(
      'In this prototype your deputy never applies or contacts an employer.',
    );
  });

  it('shows the clipboard prop when a filter returns nothing, with copy for every stage', () => {
    const { model, store } = load();
    expect(main).toMatch(
      /<div class="empty-state-art" data-deputy-prop="clipboard" aria-hidden="true">/,
    );
    expect(Object.keys(model.FILTER_EMPTY)).toEqual(store.STAGES.map((stage) => stage.id));
  });

  it('follows the deep links and reacts once to each thing you do', () => {
    expect(inlineScript).toContain("params.get('stage')");
    expect(inlineScript).toContain("params.get('open')");
    expect(inlineScript).toContain("params.get('add') === '1'");
    expect(inlineScript).toContain('window.JobDeputyComponents?.openDrawer(addDrawer, addOpen);');
    expect(inlineScript).toContain('window.history.replaceState(');
    // ?app= names a role as ?open= does (the autofill view's and Materials' links).
    expect(inlineScript).toContain(
      "const askedFor = params.get('open') ?? params.get('app') ?? '';",
    );
    // One view now (R10-4): no Board and List choice to remember.
    expect(inlineScript).not.toContain('jobdeputy.applications.view');
    // Round 6 (A3): approve while a draft waits, choose while an approved role waits for you to
    // apply, fill while your deputy applies in the background, else track.
    expect(inlineScript).toMatch(
      /app && M\.isWaiting\(app\)\s*\?\s*'approve'\s*:\s*app && M\.isReady\(app\) && !appLive\s*\?\s*'choose'\s*:\s*running\s*\?\s*'fill'\s*:\s*'track'/,
    );
    // R3-8: one reaction per action (added, saved, archived, celebrate, found, error), no flashes.
    expect(inlineScript).toContain(
      'deputy()?.react?.(name, { ...(speech ? { speech } : {}), ...more });',
    );
    expect(inlineScript).toContain("react('added');");
    expect(inlineScript).toContain("react('error');");
    expect(inlineScript).toMatch(
      /react\('found', count \? 'I read the sample posting\.' : 'Nothing new to fill\.', \{\s*duty: 'Read the posting',\s*\}\);/,
    );
    expect(inlineScript).not.toContain("flash('success'");
    for (const line of [...inlineScript.matchAll(/react\('[a-z]+', '([^']+)'\)/g)].map(
      (match) => match[1] ?? '',
    )) {
      expect(line.split(/\s+/).length, line).toBeLessThanOrEqual(6);
    }
    expect(inlineScript).toContain('store.subscribe(');
    // Pause motion and reduced motion both read "paused" on the root.
    expect(inlineScript).toContain("document.documentElement.dataset.motion === 'paused'");
  });
});

describe('applications-preview.html: Add a role captures the posting (finding 20)', () => {
  const field = (id: string): string =>
    addDrawer.match(new RegExp(`<(?:input|select|textarea)[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';
  const labelOf = (id: string): string =>
    textOf(
      addDrawer.match(new RegExp(`<label[^>]*for="${id}"[^>]*>([\\s\\S]*?)</label\\s*>`))?.[1] ??
        '',
    );

  it('asks for every detail your deputy needs to judge the role and tailor your materials', () => {
    expect(addDrawer).toMatch(
      /<form class="drawer-body apps-add-form" id="apps-add-form" novalidate>/,
    );
    const fields: Array<[string, string, string]> = [
      ['apps-add-link', 'input', 'Link to the posting Optional'],
      ['apps-add-description', 'textarea', 'Job description Required'],
      ['apps-add-role', 'input', 'Role title Required'],
      ['apps-add-company', 'input', 'Company Required'],
      ['apps-add-location', 'input', 'Where it is Required'],
      ['apps-add-workplace', 'select', 'Workplace Required'],
      ['apps-add-type', 'select', 'Employment type Required'],
      ['apps-add-pay-min', 'input', 'From'],
      ['apps-add-pay-max', 'input', 'To'],
      ['apps-add-pay-currency', 'select', 'Currency'],
      ['apps-add-pay-period', 'select', 'Per'],
      ['apps-add-found', 'select', 'Where you found it'],
      ['apps-add-contact', 'input', 'Contact or referral Optional'],
      ['apps-add-deadline', 'input', 'Apply by Optional'],
      ['apps-add-resume', 'select', 'Résumé or CV to tailor from'],
      ['apps-add-priority', 'select', 'Priority'],
      ['apps-add-stage', 'select', 'Stage'],
      ['apps-add-notes', 'textarea', 'Notes'],
    ];
    for (const [id, tag, label] of fields) {
      expect(field(id), id).toMatch(new RegExp(`^<${tag}\\b`));
      expect(labelOf(id), id).toBe(label);
    }
    expect(field('apps-add-link')).toContain('type="url"');
    expect(field('apps-add-deadline')).toContain('type="date"');
    expect(field('apps-add-description')).toContain('maxlength="32000"');
    expect(
      textOf(
        addDrawer.match(/<legend class="field-label apps-add-label"[\s\S]*?<\/legend\s*>/)?.[0] ??
          '',
      ),
    ).toBe('Pay range Optional');
    for (const id of [
      'apps-add-description',
      'apps-add-role',
      'apps-add-company',
      'apps-add-location',
      'apps-add-workplace',
      'apps-add-type',
    ]) {
      expect(field(id), id).toMatch(/\brequired\b/);
    }
    const options = (id: string) =>
      [
        ...(
          addDrawer.match(new RegExp(`<select[^>]*id="${id}"[\\s\\S]*?</select>`))?.[0] ?? ''
        ).matchAll(/<option value="([^"]*)"/g),
      ].map((match) => match[1]);
    const { model } = load();
    expect(options('apps-add-stage')).toEqual(model.ADD_STAGES);
    expect(options('apps-add-workplace')).toEqual(['', 'onsite', 'hybrid', 'remote']);
    expect(options('apps-add-type')).toEqual([
      '',
      'full_time',
      'part_time',
      'contract',
      'internship',
      'temporary',
    ]);
    expect(options('apps-add-priority')).toEqual(['1', '2', '3']);
    expect(options('apps-add-found')).toEqual([
      'careers-site',
      'job-board',
      'network',
      'recruiter',
      'referral',
      'other',
    ]);
    // The summary pattern: a validation panel that takes focus, and field errors that start hidden.
    expect(addDrawer).toMatch(
      /class="feedback-panel"\s+id="apps-add-summary"\s+data-kind="validation"\s+tabindex="-1"/,
    );
    for (const id of [
      'apps-add-link-error',
      'apps-add-description-error',
      'apps-add-role-error',
      'apps-add-company-error',
      'apps-add-location-error',
      'apps-add-workplace-error',
      'apps-add-type-error',
      'apps-add-pay-error',
      'apps-add-deadline-error',
    ]) {
      expect(addDrawer).toMatch(new RegExp(`<p class="apps-field-error" id="${id}" hidden>`));
    }
    expect(addDrawer).toMatch(
      /<button class="primary-action" type="submit" form="apps-add-form">Add role<\/button>/,
    );
  });

  it('marks required details red and optional ones blue with the shared need markers', () => {
    const pills = [
      ...addDrawer.matchAll(
        /<span class="need-pill" data-need="(required|optional)" data-need-of="([a-zA-Z]+)">(Required|Optional)<\/span>/g,
      ),
    ].map((match) => [match[2], match[1], match[3]]);
    const { model } = load();
    expect(pills.map(([name, need]) => [name, need])).toEqual(model.ADD_NEEDS);
    for (const [, need, word] of pills)
      expect(word).toBe(need === 'required' ? 'Required' : 'Optional');
    // The summary at the top counts what is still empty and follows your typing.
    expect(
      textOf(
        addDrawer.match(/<p class="need-summary" id="apps-add-needs">[\s\S]*?<\/p>/)?.[0] ?? '',
      ),
    ).toBe('6 required, 4 optional to add');
    expect(model.addNeeds(EMPTY)).toEqual({
      required: ['description', 'role', 'company', 'location', 'workplace', 'employmentType'],
      optional: ['link', 'pay', 'contact', 'deadline'],
    });
    expect(model.addNeeds(FILLED)).toEqual({ required: [], optional: [] });
    expect(inlineScript).toContain(
      "addNeeds.textContent = 'Everything your deputy needs is here';",
    );
    // Self-identification never appears in this form.
    expect(addDrawer).not.toMatch(/gender|ethnicity|veteran|disability/i);
  });

  it('ends the need summary with one word space before "to add", in every state', () => {
    const { model } = load();
    // Every child is a marked part, so the summary's gap (kept for the markers) never stands in
    // for the space before "to add" (UAT-D2: "2 optional  to add").
    const parts = (html: string) =>
      [...html.matchAll(/<span class="need-summary-part" data-need="(\w+)">([^<]*)<\/span>/g)].map(
        (match) => [match[1], match[2]],
      );
    const both = model.needSummaryHtml(model.addNeeds(EMPTY));
    expect(parts(both)).toEqual([
      ['required', '6 required,'],
      ['optional', '4 optional to add'],
    ]);
    expect(both.replace(/<span[^>]*>[^<]*<\/span>/g, '')).toBe(' ');
    expect(
      parts(model.needSummaryHtml({ required: [], optional: ['contact', 'deadline'] })),
    ).toEqual([['optional', '2 optional to add']]);
    expect(parts(model.needSummaryHtml({ required: ['role'], optional: [] }))).toEqual([
      ['required', '1 required to add'],
    ]);
    expect(model.needSummaryHtml(model.addNeeds(FILLED))).toBe('');
    // The page draws what the model writes, and the markup it starts with reads the same way.
    expect(inlineScript).toContain('const parts = M.needSummaryHtml(missing);');
    expect(inlineScript).not.toContain('<span>to add</span>');
    const first = addDrawer.match(
      /<p class="need-summary" id="apps-add-needs">([\s\S]*?)<\/p>/,
    )?.[1];
    expect(parts(first ?? '')).toEqual(parts(both));
    expect((first ?? '').replace(/<span[^>]*>[^<]*<\/span>/g, '').trim()).toBe('');
  });

  it('checks the details with FieldFeedback and one summary', () => {
    const { model } = load();
    const problems = model.addProblems(EMPTY);
    expect(Object.keys(problems)).toEqual([
      'description',
      'role',
      'company',
      'location',
      'workplace',
      'employmentType',
    ]);
    expect(model.addSummary(problems)).toEqual({
      title: 'Check 6 details before continuing.',
      message:
        'Add the job description, the role title, the company, where it is, the workplace, and the employment type.',
    });
    const wrong = model.addProblems({
      ...FILLED,
      link: 'careers.fabrikam.example',
      payMin: '200,000',
      payMax: '150,000',
      deadline: '2026-13-40',
    });
    expect(Object.keys(wrong)).toEqual(['link', 'pay', 'deadline']);
    expect(model.addSummary(wrong).title).toBe('Check 3 details before continuing.');
    expect(model.addProblems({ ...FILLED, payMin: 'a lot' })).toHaveProperty('pay');
    expect(model.addProblems(FILLED)).toEqual({});
    expect(model.isLink('https://careers.fabrikam.example/jobs/77')).toBe(true);
    expect(model.isLink('javascript:alert(1)')).toBe(false);
    expect(model.isLink('http://localhost')).toBe(false);
  });

  it('reads the posting in the prototype: a sample fills only what is empty, and nothing is fetched', () => {
    expect(addDrawer).toMatch(
      /<button class="compact-action" id="apps-add-read" type="button" aria-describedby="apps-add-read-note">Read the posting<\/button>/,
    );
    expect(textOf(addDrawer)).toContain(
      'Prototype: fills in a sample posting. Nothing is fetched.',
    );
    expect(addDrawer).toMatch(/id="apps-add-read-done"\s+data-kind="success"/);
    const { model } = load();
    const read = model.readPosting({
      ...EMPTY,
      link: 'https://careers.relecloud.example/jobs/4821',
      role: 'My title',
    });
    expect(read.filled).toEqual([
      'company',
      'location',
      'workplace',
      'employmentType',
      'description',
      'pay',
    ]);
    expect(read.values).toMatchObject({
      role: 'My title',
      company: 'Relecloud',
      location: 'Seattle, WA',
      workplace: 'hybrid',
      employmentType: 'full_time',
      payMin: '172,000',
      payMax: '215,000',
    });
    expect(model.addNeeds(read.values).required).toEqual([]);
    // A fictional sample company, and an example address.
    expect(model.SAMPLE_POSTING.company).toBe('Relecloud');
    expect(field('apps-add-link')).toContain(
      'placeholder="https://careers.relecloud.example/jobs/4821"',
    );
    // A read after an empty submit clears what it fixed, and the summary follows (or goes).
    expect(inlineScript).toMatch(/showProblems\(open\);\s*writeAddSummary\(open\);/);
    // The read waits a moment (instant when motion is still), with a pending state.
    expect(inlineScript).toContain("readButton.textContent = 'Reading…';");
    expect(inlineScript).toContain('still() ? 0 : 987');
  });

  it('offers your résumé and CV by name, the default résumé chosen, from Résumés', () => {
    const { store, model } = load();
    const documents = store.get().documents;
    const options = model.resumeOptions(documents);
    expect(options).toBe(
      '<option value="resume-main" selected>Alex_Morgan_Resume.pdf · default résumé</option><option value="cv-leadership">Engineering_Leadership_CV.docx · default CV</option>',
    );
    expect(addDrawer).toContain(
      `<select class="field-control" id="apps-add-resume" name="baseDocumentId" aria-describedby="apps-add-resume-help">${options}</select>`,
    );
    expect(inlineScript).toContain('M.resumeOptions(store.get().documents)');
  });

  it('keeps every detail on the role it adds, and the new role shows them', () => {
    const { store, model } = load();
    const before = Number(store.metric('apps.addedByYou'));
    const entry = model.addEntry(FILLED, {
      taken: new Set(store.get().applications.map((app) => app.id)),
    });
    expect(entry).toMatchObject({
      id: 'staff-engineer-platform-fabrikam',
      role: 'Staff Engineer, Platform',
      company: 'Fabrikam',
      location: 'Remote, US',
      workplace: 'remote',
      workStyle: 'Remote',
      employmentType: 'contract',
      salary: { min: 160000, max: 190000, currency: 'USD', period: 'year' },
      description:
        'Fabrikam is hiring a staff engineer for its platform team.\n\n- Go and Kubernetes',
      link: 'https://careers.fabrikam.example/jobs/77',
      postingRead: null,
      foundVia: 'referral',
      contact: 'Riley Chen, riley.chen@example.com',
      deadline: '2026-10-15',
      baseDocumentId: 'cv-leadership',
      formReadAt: '2026-10-02',
      source: 'Added by you',
      stage: 'shortlisted',
      priority: 1,
      materials: 'none',
      notes: 'Ask about on-call.',
      next: 'Tailor materials',
      timeline: [{ date: '2026-10-02', label: 'Added by you', by: 'you' }],
    });
    store.addApplication(entry);
    const saved = store.application(entry.id) as App;
    expect(saved).toMatchObject({
      employmentType: 'contract',
      deadline: '2026-10-15',
      contact: entry.contact,
    });
    expect(store.metric('apps.addedByYou')).toBe(before + 1);
    expect(store.stageCounts()).toMatchObject({ shortlisted: 3 });
    // The card shows the deadline; the details show the facts.
    expect(textOf(model.cardHtml(saved))).toContain('Apply by Thu, Oct 15');
    expect(model.aboutRows(saved, { baseName: 'Engineering_Leadership_CV.docx' })).toEqual([
      ['Employment', 'Contract'],
      ['Pay', 'USD 160,000 to 190,000 a year'],
      ['Apply by', 'Thu, Oct\u00a015'],
      ['Found on', 'A referral'],
      ['Contact', 'Riley Chen, riley.chen@example.com'],
      ['Tailor from', 'Engineering_Leadership_CV.docx'],
    ]);
    // A role you add as Applied keeps no made-up application date.
    const applied = model.addEntry({ ...FILLED, stage: 'applied' });
    expect(applied).toMatchObject({ stage: 'applied', next: 'Follow up' });
    expect(applied).not.toHaveProperty('applied');
    expect(applied.timeline[0]?.label).toBe('Added by you as Applied');
    // The page saves the entry through the store, then reacts.
    expect(inlineScript).toContain(
      'const entry = M.addEntry(values, { taken: new Set(apps.map((app) => app.id)) });',
    );
    expect(inlineScript).toContain('store.addApplication(entry);');
  });

  it('reads pay as the posting states it, never converted', () => {
    const { model } = load();
    expect(
      model.payOf({ payMin: '150000', payMax: '', payCurrency: 'GBP', payPeriod: 'year' }),
    ).toEqual({
      min: 150000,
      currency: 'GBP',
      period: 'year',
    });
    expect(model.payText({ max: 95, currency: 'USD', period: 'hour' })).toBe(
      'Up to USD 95 an hour',
    );
    expect(model.payText(null)).toBe('');
    expect(model.payOf({ payMin: '', payMax: '' })).toBeNull();
  });
});

// Round 5, A3: Updates from your email. Your deputy reads status emails in Gmail, read-only, moves a
// card when one says so (with Undo, after the October agreement), and drafts a reply you edit and
// send yourself. Every word of an email is escaped. Round 7: the emails live in a drawer (#email).
describe('applications-preview.html: Updates from your email (round 5, A3)', () => {
  const section = emailsDrawer;
  const sign = (store: Store) =>
    store.signAgreement({
      version: '2026.10',
      name: 'Alex Morgan',
      consents: ['read', 'act', 'keep'],
    });

  it('opens at #email in its drawer, with its figures and the plain line', () => {
    expect(section).toContain('<p class="eyebrow">Updates from your email</p>');
    expect(section).toContain(
      '<h2 class="drawer-title" id="apps-emails-title">What employers told you.</h2>',
    );
    const { store, model } = load();
    const values = {
      events: store.metricText('mail.events'),
      replyNeeded: store.metricText('mail.replyNeeded'),
    };
    // Round 6 (A4, R3-4): with Gmail's watch on the board saying this week's emails read, the
    // section keeps the replies needed; without the watch, round 5's words stand.
    const figures = model.mailFiguresHtml(values, { watch: true });
    expect(section).toContain(
      `<p class="drawer-meta apps-email-figures" id="apps-mail-figures">${figures}</p>`,
    );
    // Round 6 part 3: a week of job email (ten emails since Mon, Sep 28; two need your reply).
    expect(textOf(figures)).toBe('2 need your reply');
    expect(textOf(model.mailFiguresHtml(values))).toBe('10 emails read · 2 need your reply');
    // The prompt your deputy reads email with is the shared summary in this drawer (R10-5).
    expect(section).toContain(
      '<li data-prompt-summary="mail" data-prompt-size="row" data-prompt-heading="4"></li>',
    );
    // Round 6 (P-12): what Gmail lets your deputy read lives in Settings, Connections; this
    // section keeps what it did, with one link there (no scope line or lists here).
    expect(section).toContain(
      '<p class="apps-email-reads" id="apps-mail-reads"><a class="apps-summary-link" id="apps-mail-scope" href="./connections-preview.html#gmail" data-return-link>What your deputy reads in Gmail, and never does: Settings, Connections</a></p>',
    );
    expect(section).not.toMatch(/apps-mail-reads-line|apps-mail-reads-list|apps-mail-never-list/);
    expect(inlineScript).not.toContain('renderMailReads');
  });

  it('draws the seed’s emails from the model, newest first, each with what your deputy did', () => {
    const { store, model } = load();
    const events = store.mailEvents();
    // Round 6 part 3: the week's ten emails (the four of round 5 keep their ids and words).
    expect(events.map((event) => event.id)).toEqual([
      'mail-northwind-referral',
      'mail-amazon-calendar',
      'mail-northwind-reply',
      'mail-devex-not-selected',
      'mail-amazon-interview',
      'mail-devex-review',
      'mail-devex-received',
      'mail-northwind-calendar',
      'mail-northwind-screen',
      'mail-amazon-review',
    ]);
    const list = section.slice(section.indexOf('<ol class="apps-mail-list"'));
    // Round 6 part 3 (R6-4): the list ships the newest five, so the section never grows with the
    // inbox; See all opens the rest in place, with the same rows and the same actions.
    expect(squash(list)).toContain(
      squash(
        events
          .slice(0, 5)
          .map((event) => model.mailItemHtml(event))
          .join(''),
      ),
    );
    expect(list).not.toContain(squash(model.mailItemHtml(events[5] as MailEvent)));
    expect(section).toContain(
      '<p class="apps-mail-all" id="apps-mail-all" hidden><button class="compact-action" id="apps-mail-see-all" type="button" aria-controls="apps-mail-list" aria-expanded="false">See all</button></p>',
    );
    expect(inlineScript).toContain('const MAIL_CAP = 5;');
    expect(inlineScript).toContain('const shown = mailOpen ? events : events.slice(0, MAIL_CAP);');
    expect(inlineScript).toContain('mailAll.hidden = events.length <= MAIL_CAP;');
    expect(inlineScript).toContain(
      code("const seeAllWords = mailOpen ? 'Show fewer' : `See all $(events.length} emails`;"),
    );
    // An email the cap leaves out, spoken of by a note or a reply you came back for, opens the
    // whole list first, so its row is there.
    expect(inlineScript).toContain('function revealMail(id) {');
    expect(inlineScript).toContain('if (at >= MAIL_CAP) mailOpen = true;');
    // From, subject, when, and what your deputy did or will do, in the store's words.
    const amazon = model.mailItemHtml(
      events.find((event) => event.id === 'mail-amazon-interview') as MailEvent,
    );
    expect(textOf(amazon)).toContain('Interview invitation: Software Development Engineer II');
    // Round 7 (D3): read by the 07:00 daily scan, so it arrived before it (the store re-timed it).
    expect(textOf(amazon)).toContain('Amazon Recruiting · Fri, Oct 2, 06:02');
    expect(textOf(amazon)).toContain(
      'Moves it to Interviewing once you sign the updated agreement',
    );
    // The role opens its card's details on this page.
    expect(amazon).toContain(
      'href="./applications-preview.html?open=amazon-sde2" data-drawer-open="apps-drawer" data-app-open="amazon-sde2"',
    );
  });

  it('asks for the October agreement in place for automatic moves, and comes back here', () => {
    const { store } = load();
    expect(store.requiresAgreement('mail-updates')?.version).toBe('2026.10');
    const gate =
      section.match(
        /<section class="feedback-panel" id="apps-mail-gate"[\s\S]*?<\/section>/,
      )?.[0] ?? '';
    expect(gate).toContain('data-kind="warning"');
    // The same total as the Gmail line, which carries the figure (once on the page).
    expect(gate).toContain(
      `id="apps-mail-gate-title">${store.metricText('mail.waiting')} moves wait for your signature</strong>`,
    );
    expect(gate).toContain(
      'href="./agreement-preview.html?mode=update&amp;return=applications-preview.html%23email">Review and sign</a>',
    );
    expect(inlineScript).toContain(
      code(
        '`./agreement-preview.html?mode=update&return=$(encodeURIComponent(`applications-preview.html$(query}#email`)}`',
      ),
    );
    // The gate goes once it is signed; a reply asked for before signing comes back as ?reply=.
    expect(inlineScript).toContain(
      "const gate = typeof store.requiresAgreement === 'function' ? store.requiresAgreement('mail-updates') : null;",
    );
    expect(inlineScript).toContain("const replyId = params.get('reply');");
  });

  it('offers the move each status allows: Ignore, Undo, Move the card, and Draft a reply', () => {
    const { store, model } = load();
    const byId = (id: string) => store.mailEvents().find((event) => event.id === id) as MailEvent;
    const words = (event: MailEvent) =>
      [...model.mailActionsHtml(event).matchAll(/<button[^>]*>([^<]+)</g)].map((match) => match[1]);
    expect(words(byId('mail-amazon-interview'))).toEqual(['Ignore', 'Draft a reply']);
    expect(words(byId('mail-northwind-reply'))).toEqual(['Draft a reply']);
    // A no-reply address takes no reply, and an email that moves nothing has no move.
    expect(words(byId('mail-devex-received'))).toEqual([]);
    // Before signing a move can't happen; ignoring one still works.
    expect(store.applyMailEvent('mail-amazon-interview')).toMatchObject({
      ok: false,
      reason: 'agreement-required',
    });
    expect(store.ignoreMailEvent('mail-amazon-interview').ok).toBe(true);
    expect(words(byId('mail-amazon-interview'))).toEqual(['Move the card', 'Draft a reply']);
    // Signing makes the waiting move on its own; Undo puts it back.
    sign(store);
    expect(byId('mail-devex-not-selected')).toMatchObject({ status: 'applied', canUndo: true });
    expect(words(byId('mail-devex-not-selected'))).toEqual(['Undo', 'Draft a reply']);
    expect(inlineScript).toContain(
      'const call = { undo: store.undoMailEvent, ignore: store.ignoreMailEvent, apply: store.applyMailEvent }[does];',
    );
  });

  it('really moves the card back with Undo, and every stage count follows', () => {
    const { store } = load();
    const counts = () =>
      store.STAGES.map((stage) => store.metricText(`apps.stage.${stage.id}`)).join('');
    const seed = counts();
    expect(seed).toBe('2112101');
    sign(store);
    // Amazon to Interviewing and Developer Experience to Closed, from their emails.
    expect(store.application('amazon-sde2')?.stage).toBe('interviewing');
    expect(store.application('devex')?.stage).toBe('closed');
    expect(counts()).toBe('2110202');
    expect(store.undoMailEvent('mail-amazon-interview').ok).toBe(true);
    expect(store.undoMailEvent('mail-devex-not-selected').ok).toBe(true);
    expect(store.application('amazon-sde2')?.stage).toBe('applied');
    expect(store.application('amazon-sde2')?.interview ?? null).toBeNull();
    expect(store.application('devex')?.stage).toBe('applied');
    expect(counts()).toBe(seed);
    // The page draws the header, the board, the drawers, and every figure again on each change.
    expect(inlineScript).toContain('store.subscribe((_state, change) => {');
    expect(inlineScript).toMatch(
      /keepFocus\(\(\) => \{\s*const ctx = context\(\);\s*renderMail\(\);\s*renderGmail\(\);\s*renderCompanies\(\);\s*renderRules\(\);\s*renderHead\(ctx\);\s*renderBoard\(ctx\);\s*renderFigures\(\);/,
    );
  });

  it('drafts a reply through the reply prompt, for you to edit and copy, and never sends it', () => {
    const { store, model } = load();
    // Drafting replies is new in 2026.10 too.
    expect(store.draftReply('mail-northwind-reply')).toMatchObject({
      ok: false,
      reason: 'agreement-required',
    });
    sign(store);
    expect(store.draftReply('mail-northwind-reply').ok).toBe(true);
    const event = store
      .mailEvents()
      .find((each) => each.id === 'mail-northwind-reply') as MailEvent;
    expect(event.draft?.sent).toBe(false);
    const html = model.replyHtml(event);
    // The draft names its prompt; the prompt itself is the shared summary at the drawer's end.
    expect(html).not.toContain('data-prompt-open');
    expect(html).toContain('data-reply-copy="mail-northwind-reply"');
    expect(textOf(html)).toContain(
      'A draft for you to edit and send yourself. Your deputy never sends email.',
    );
    expect(textOf(html)).toContain(`prompt: ${event.draft?.prompt.label}`);
    // The draft is the field's value (plain text), never markup; nothing offers to send it.
    expect(html).toMatch(
      /<textarea class="field-control apps-reply-text" id="apps-reply-text-mail-northwind-reply"[^>]*><\/textarea>/,
    );
    expect(html).not.toContain('Hi Riley');
    expect(inlineScript).toContain('field.value = replyEdits.get(event.id) ?? event.draft.text;');
    expect(`${html}${section}`).not.toMatch(/<(?:button|a)\b[^>]*>\s*Send\b/);
    expect(model.mailActionsHtml(event, { replyOpen: true })).toContain('>Hide your draft<');
  });

  it('escapes every word of an email: sender, subject, snippet, and the draft’s head (R5-5)', () => {
    const { store, model } = load();
    const base = store.mailEvents()[0] as MailEvent;
    const hostile: MailEvent = {
      ...base,
      from: '<img src=x onerror=alert(1)>',
      subject: '<script>alert(1)</script>',
      snippet: 'Q&A <b>bold</b>',
      did: '<i>did</i>',
      draft: {
        to: '<x@example.com>',
        subject: '<s>Re</s>',
        text: '<b>Hi</b>',
        model: 'gpt-5-mini',
        note: 'A draft.',
        sent: false,
        prompt: { label: '<u>System</u>' },
      },
    };
    const html = `${model.mailItemHtml(hostile)}${model.replyHtml(hostile)}`;
    expect(html).not.toMatch(/<(img|script|b|i|s|u)\b/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Q&amp;A &lt;b&gt;bold&lt;/b&gt;');
    expect(html).toContain('&lt;x@example.com&gt;');
  });
});

describe('applications-preview.html: the page model', () => {
  it('explains each stage in the Dashboard’s words and colours, read from the store', () => {
    const { model } = load();
    expect(modelSource).not.toContain('You chose it; your deputy has not started the materials.');
    expect(modelSource).toContain('const stageTone = (id) => stageOf(id)?.tone ?? null;');
    for (const [id, [tone, meaning]] of Object.entries(CANON)) {
      expect(model.stageTone(id)).toBe(tone);
      expect(model.stageMeaning(id)).toBe(meaning);
    }
  });

  it('names each role’s next step, without repeating the follow-up date in the table', () => {
    const { store, model } = load();
    const step = (id: string, table = false) =>
      model.nextStep(store.application(id) as App, { table }).text;
    expect(model.nextStep(store.application('search-infra') as App)).toEqual({
      label: 'Needs you',
      text: 'Review and approve materials',
    });
    // A no-break space keeps each date together when a line wraps.
    expect(step('amazon-sde2')).toBe('Follow up Sat, Oct\u00a03 · tomorrow');
    expect(step('amazon-sde2', true)).toBe('Follow up');
    expect(step('northwind-backend')).toBe('Phone screen Tue, Oct\u00a06, 10:00');
    expect(step('contoso-platform')).toBe('Not selected · Sep\u00a020');
  });

  it('keeps each move honest: the approval sub-status, the applied record, and the close reason', () => {
    const { store, model } = load();
    const workspace = store.application('workspace') as App;
    expect(model.moveFields(workspace, 'approval')).toMatchObject({ approval: 'waiting' });
    expect(model.moveFields({ ...workspace, materials: 'approved' }, 'approval')).toMatchObject({
      approval: 'approved',
    });
    expect(model.moveFields(workspace, 'applied')).toMatchObject({
      applied: model.TODAY,
      appliedBy: 'you',
    });
    expect(model.moveFields(workspace, 'closed', 'Withdrew')).toMatchObject({
      closedReason: 'Withdrew',
      next: null,
    });

    store.moveApplication('workspace', 'closed', {
      label: 'Closed: withdrew',
      by: 'you',
      ...model.moveFields(workspace, 'closed', 'Withdrew'),
    });
    expect(store.stageCounts()).toMatchObject({ shortlisted: 1, closed: 2 });
    // The store's step also carries its time (round 7); the day, words, and who are the move's.
    expect(store.application('workspace')?.timeline.at(-1)).toMatchObject({
      date: '2026-10-02',
      label: 'Closed: withdrew',
      by: 'you',
    });
  });

  it('renders the approval card in both states, and asks before marking applied', () => {
    const { store, model } = load();
    const waiting = model.cardHtml(store.application('search-infra') as App);
    expect(waiting).toContain('class="board-card apps-card is-attention"');
    expect(waiting).toContain(
      'href="./materials-preview.html?app=search-infra&amp;from=applications"',
    );
    expect(textOf(waiting)).toContain('Review & approve');
    expect(textOf(waiting)).not.toContain('Approving lets your deputy');
    const approved = { ...(store.application('search-infra') as App), approval: 'approved' };
    expect(textOf(model.cardHtml(approved))).toContain(
      'Approved · apply on the employer’s site, or let your deputy Mark as applied',
    );
    expect(textOf(model.cardHtml(approved))).not.toContain('Submission isn’t connected');
    expect(model.nextStep(approved)).toEqual({
      label: 'Next',
      text: 'Apply on the employer site, or let your deputy fill it',
    });
    const confirming = model.cardHtml(approved, { confirming: true });
    expect(textOf(confirming)).toContain('Did you apply on the employer site? I applied Not yet');
    expect(confirming).not.toContain('data-mark-applied');
  });

  it('escapes the words of a role you add', () => {
    const { store, model } = load();
    const app = {
      ...(store.application('workspace') as App),
      role: '<img src=x onerror=alert(1)>',
      company: 'A & B',
      deadline: '2026-10-20',
    };
    const card = model.cardHtml(app);
    for (const html of [card]) {
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    }
    expect(card).toContain('A &amp; B');
    expect(model.markFor('A & B')).toBe('A&');
    // The details drawer escapes every fact and the description it shows.
    expect(inlineScript).toContain(
      code('`<dt>$(M.escapeHtml(label)}</dt><dd>$(M.escapeHtml(value)}</dd>`'),
    );
    expect(inlineScript).toContain(
      "field('#apps-about-description-text').textContent = description;",
    );
  });

  it('gives an added role a readable id the store doesn’t already hold', () => {
    const { model } = load();
    expect(model.newId('Staff Engineer, Développeur Tools', 'Fabrikam', new Set())).toBe(
      'staff-engineer-developpeur-tools-fabrikam',
    );
    expect(
      model.newId(
        'Platform Engineer',
        'Contoso Health',
        new Set(['platform-engineer-contoso-health']),
      ),
    ).toBe('platform-engineer-contoso-health-2');
    expect(model.newId('!!!', '???', new Set())).toBe('role');
  });

  it('logs every timeline step with who did it, and marks the steps read from Gmail', () => {
    const { store, model } = load();
    const html = model.timelineHtml(store.application('search-infra') as App);
    expect(textOf(html)).toContain('Found on Google Careers Done · Oct 1 By your deputy');
    const shortlistedOn = (store.application('search-infra') as App).timeline.find(
      (step) => step.label === 'Shortlisted',
    )?.date;
    expect(textOf(html)).toContain(
      `Shortlisted Done · ${textOf(model.shortDate(String(shortlistedOn)))} By you`,
    );
    expect(textOf(html)).toContain('Approve materials Needs you Tailored résumé and cover letter');
    // Round 6 (A1): after you approve, your deputy applies in the background (the default).
    expect(textOf(html)).toContain(
      'Your deputy applies Then In the background, within your rules; nothing is sent',
    );
    // A status email read from Gmail (by: 'gmail') says so, and links to the connection, which
    // moved to Settings, Connections (round 6, T1).
    const northwind = store.application('northwind-backend') as App;
    expect(northwind.timeline.find((step) => step.by === 'gmail')?.label).toBe(
      'Phone screen scheduled',
    );
    const gmail = model.timelineHtml(northwind);
    expect(textOf(gmail)).toContain('Phone screen scheduled Done · Sep 29 From Gmail');
    expect(gmail).toContain(
      '<a class="apps-gmail-link" href="./connections-preview.html#gmail">From Gmail',
    );
    expect(gmail.match(/From Gmail/g)).toHaveLength(1);
  });

  it('offers the autofill preview only while it can help, and to look back at what was submitted', () => {
    const { store, model } = load();
    const offers = Object.fromEntries(
      store.get().applications.map((app) => [app.id, model.fillOffer(app)]),
    );
    // Waiting for approval: the preview opens on its gate. Applied by you or closed: nothing.
    expect(offers).toEqual({
      workspace: null,
      'northwind-platform': null,
      'cloud-reliability': null,
      'search-infra': 'fill',
      devex: null,
      // Auto-applied in the background (round 7, the store's provenance): look back at the form.
      'amazon-sde2': 'review',
      'northwind-backend': null,
      'contoso-platform': null,
    });
    expect(model.fillHref(store.application('search-infra') as App)).toBe(
      './autofill-preview.html?app=search-infra',
    );
    store.moveApplication('search-infra', 'approval', {
      approval: 'approved',
      materials: 'approved',
    });
    const approved = store.application('search-infra') as App;
    expect(model.fillOffer(approved)).toBe('fill');
    // The autofill preview submits (nothing is sent): Applied, by the deputy.
    store.moveApplication('search-infra', 'applied', {
      label: 'Submitted by your deputy (prototype, nothing was sent)',
      by: 'deputy',
      applied: '2026-10-02',
      appliedBy: 'deputy',
    });
    const submitted = store.application('search-infra') as App;
    expect(model.byDeputy(submitted)).toBe(true);
    expect(model.fillOffer(submitted)).toBe('review');
    expect(textOf(model.timelineHtml(submitted))).toContain(
      'Submitted by your deputy (prototype, nothing was sent) Done · Oct 2 By your deputy',
    );
    expect(model.nextStep(submitted)).toEqual({ label: 'Next', text: 'Add a follow-up date' });
  });
});

// Round 6 (A1 to A5), on the board since round 7: Review, then auto-apply. A card that waits for
// your approval shows your deputy's review and Approve and apply; after approval your deputy
// applies in the background (the card's live status, Needs you with the questions inline, the
// agreement first); How your deputy applies is a drawer. The page's model runs against the shared
// store, as above.
type Check = { id: string; label: string; status: string; detail: string };
type Review = {
  appId: string;
  score: number;
  status: string;
  checks: Check[];
  materials: Array<{ kind: string; pages: number }>;
};
type Question = {
  id: string;
  label: string;
  kind: string;
  answered: boolean;
  value: unknown;
  suggested?: string | null;
  why?: string;
  saved?: boolean | null;
};
type Job = {
  appId: string;
  status: string;
  stage: string;
  elapsedSeconds: number;
  site: string;
  stages: Array<{ id: string; label: string; state: string; detail?: string }>;
  waitingFor: { kind: string; text?: string; href?: string } | null;
  questions: Question[];
  watchHref: string;
  result: { text: string } | null;
};
type Round6Store = Store & {
  review(id: string): Review | null;
  approveAndApply(id: string): { ok: boolean; job: Job | null; reason?: string };
  applyJob(id: string): Job | null;
  applyRules(): Record<string, unknown> & { changed: string[]; isDefault: boolean };
  resetApplyRules(): { ok: boolean };
  setApplyRules(patch: Record<string, unknown>): { ok: boolean; field?: string };
  mailWatch(): { connected: boolean; moves: Array<Record<string, unknown>> };
};
type Round6Model = Model & {
  reviewVerdict(review: Review): string;
  reviewHtml(review: Review | null, options?: { metric?: boolean }): string;
  thumbsHtml(app: App, review: Review | null): string;
  reviewCardHtml(review: Review | null, options?: { metric?: boolean }): string;
  rulesLine(rules: unknown): string;
  jobView(job: Job): {
    state: string;
    headline: string;
    step: string;
    time: string;
    waiting: string;
    needsYou: boolean;
    why: string;
  };
  jobHtml(
    job: Job,
    app: App,
    options?: { compact?: boolean; answers?: Map<string, unknown> },
  ): string;
  saveKey(appId: string): string;
  jobTitle(job: Job): string;
  stepDetail(job: Job, stage: { id: string; detail?: string }): string;
  mailWaitFor(app: App, watch: unknown, events?: MailEvent[]): MailWait | null;
  signHrefFor(appId: string): string;
  timelineHtml(app: App, options?: { wait?: MailWait | null }): string;
  fillText(job: Job & { fields?: number; filled?: number }): string | null;
  watchHref(job: Job): string;
  rulesDiffText(rules: unknown): string;
  companiesOf(apps: App[]): Array<{ value: string; label: string; count: number }>;
  LANE_CAP: number;
};
type MailWait = { mailId: string; to: string; said: string; text: string; href: string };
const load6 = () => load() as unknown as { store: Round6Store; model: Round6Model };
const signed = (store: Store) =>
  store.signAgreement({
    version: '2026.10',
    name: 'Alex Morgan',
    consents: ['read', 'act', 'keep'],
  });

describe('applications-preview.html: approving on the card (round 6, A2; round 7, A1)', () => {
  it('shows the waiting role’s review on its card, and Approve and apply in one step', () => {
    const { store, model } = load6();
    const app = store.application('search-infra') as App;
    const review = store.review('search-infra') as Review;
    expect(review.score).toBe(94);
    const card = model.cardHtml(app, { applying: true, review, metric: true });
    // The score once, with its key; the verdict in words; the checks that need a look.
    expect(card).toContain(
      '<span class="apps-review-value" data-metric="review.search-infra.score">94</span>',
    );
    expect(textOf(card)).toContain('Passed every check · 5 of 5');
    const actions = card.slice(card.indexOf('apps-step-actions'));
    expect(actions.indexOf('Approve and apply')).toBeLessThan(actions.indexOf('Preview'));
    expect(card).toContain(
      '<button class="primary-action apps-card-action" type="button" data-approve-apply="search-infra" data-focus-key="card-approve:search-infra">',
    );
    // Without drafts your deputy reviewed, the card offers Review & approve in Materials.
    expect(textOf(model.cardHtml(app))).toContain('Review & approve');
    // In the panel: every check, the materials as pages, with the same one-step action, and the
    // score carries no key there (the card's is the page's one).
    expect(model.reviewHtml(review)).not.toContain('data-metric');
    expect(model.reviewHtml(review)).toMatch(
      /<details class="apps-review-all"><summary>Every check \(5\)<\/summary>/,
    );
    for (const check of review.checks)
      expect(textOf(model.reviewHtml(review))).toContain(`${check.label}. ${check.detail}`);
    const thumbs = model.thumbsHtml(app, review);
    expect(
      thumbs.match(/<button class="apps-thumb" type="button" data-preview="search-infra"/g),
    ).toHaveLength(2);
    expect(textOf(thumbs)).toContain('Preview the tailored résumé, Résumé 1 page');
    expect(inlineScript).toContain("title.textContent = 'Your approval';");
    expect(inlineScript).toContain(
      'data-approve-apply="$' + '{id}" data-focus-key="panel-approve:$' + '{id}">Approve and apply',
    );
  });

  it('names a warning and a failure in words beside their mark, never by colour alone', () => {
    const { store, model } = load6();
    const warned = store.review('cloud-reliability') as Review;
    expect(warned).toMatchObject({ score: 81, status: 'warned' });
    const html = model.reviewHtml(warned);
    expect(model.reviewVerdict(warned)).toBe('1 to check · 4 of 5 passed');
    expect(html).toContain('<div class="apps-review" data-status="warned">');
    expect(html).toMatch(
      /<ul class="apps-review-flags"><li class="apps-check" data-status="warn"><span class="apps-check-mark" aria-hidden="true">!<\/span><span class="apps-check-copy"><span class="sr-only">Check this: <\/span>/,
    );
    const failed = {
      ...warned,
      status: 'failed',
      checks: warned.checks.map((check, index) => (index ? check : { ...check, status: 'fail' })),
    };
    expect(model.reviewVerdict(failed)).toBe('1 check failed · 3 of 5 passed');
    expect(model.reviewHtml(failed)).toContain('<span class="sr-only">Failed: </span>');
    expect(model.reviewCardHtml(failed)).toContain('<span class="sr-only">Failed: </span>');
  });

  it('turns the card into the job in place, says it once, and keeps focus with the role (UAT A-4)', () => {
    expect(inlineScript).toContain(code('announce(`Approved $(app.role}. $(message}`);'));
    expect(inlineScript).toContain(
      "card?.querySelector('.run-tracker-watch, .apps-job-wait a, .apps-job-wait button, .apps-questions .field-control') ??",
    );
    // One approval is one step; the batch approval went with the queue (auto approve is the bulk path).
    expect(inlineScript).not.toContain('approveMany');
  });

  it('keeps the preview’s text from the shared sample documents', () => {
    const documents = sourceFor('documents-preview.html');
    const block = (source: string) =>
      source.match(/\/\/ SampleDocs: start([\s\S]*?)\/\/ SampleDocs: end/)?.[1] ?? '';
    expect(block(page)).not.toBe('');
    expect(block(page)).toBe(block(documents));
  });
});

describe('applications-preview.html: background applying (round 6, A3)', () => {
  it('shows the job on the card: waiting for your signature first, with Review and sign', () => {
    const { store, model } = load6();
    const result = store.approveAndApply('search-infra');
    expect(result.ok).toBe(true);
    const app = store.application('search-infra') as App;
    const job = store.applyJob('search-infra') as Job;
    const card = model.cardHtml(app, { applying: true, job });
    expect(card).toContain(
      '<div class="run-tracker is-compact apps-job" data-state="queued" data-job="search-infra">',
    );
    expect(textOf(card)).toContain('Waiting for your signature');
    expect(textOf(card)).toContain(
      'Sign the updated agreement so your deputy can create your account on careers.google.example.',
    );
    expect(card).toMatch(
      /<a class="secondary-action" href="\.\/agreement-preview\.html\?mode=update&amp;return=[^"]+"[^>]*>Review and sign<\/a>/,
    );
    // Mark as applied waits while your deputy applies; Stop and Watch it stay.
    expect(card).not.toContain('data-mark-applied');
    expect(card).toContain('data-job-stop="search-infra"');
    expect(model.watchHref(job)).toBe('./autofill-preview.html?app=search-infra&watch=1&live=1');
  });

  it('runs once the agreement is signed, the time counting up, never as a bar', () => {
    const { store, model } = load6();
    signed(store);
    store.approveAndApply('search-infra');
    const job = store.applyJob('search-infra') as Job;
    expect(job.status).toBe('running');
    const view = model.jobView(job);
    expect(view.state).toBe('live');
    expect(view.headline).toBe('Applying for you');
    expect(view.time).toMatch(/^Applying for \d+ s$/);
    expect(view.step).toBe('Step 1 of 5: Signing in to the employer’s site');
    const app = store.application('search-infra') as App;
    const card = model.cardHtml(app, { applying: true, job });
    expect(card).toContain(
      `<p class="run-tracker-time" data-job-time="search-infra">${view.time}</p>`,
    );
    expect(card).not.toMatch(/run-tracker-bar|role="progressbar"|<progress/);
    expect(card).toContain('data-step="applying"');
    // The panel shows every step on the shared timeline.
    const panel = model.jobHtml(job, app, { compact: false });
    expect(panel).toContain(
      '<ol class="timeline apps-job-steps" aria-label="Your deputy’s steps">',
    );
    expect(panel).toMatch(
      /<li class="timeline-item is-current" aria-current="step"><p class="timeline-title">Signing in to the employer’s site<\/p>/,
    );
  });

  it('asks Needs you with the questions inline, Save to my profile on by default', () => {
    const { store, model } = load6();
    signed(store);
    store.approveAndApply('search-infra');
    const base = store.applyJob('search-infra') as Job;
    // The job at Needs you (its questions are the store's; the wait as the store reports it).
    const job: Job = {
      ...base,
      status: 'waiting',
      stage: 'needs-you',
      waitingFor: { kind: 'questions' },
      stages: base.stages.map((stage) => ({
        ...stage,
        state:
          stage.id === 'needs-you'
            ? 'waiting'
            : ['account', 'scan', 'fill'].includes(stage.id)
              ? 'done'
              : 'upcoming',
      })),
    };
    const app = store.application('search-infra') as App;
    const card = model.cardHtml(app, { applying: true, job });
    expect(textOf(card)).toContain('Needs you');
    expect(textOf(card)).toContain('Step 4 of 5: Your answers');
    expect(card).toContain(
      '<form class="apps-questions" data-questions="search-infra" data-where="card"',
    );
    expect(card).toContain(
      '<label class="field-label" for="q-search-infra-card-expected-salary">Expected salary</label>',
    );
    expect(card).toContain('<textarea class="field-control" id="q-search-infra-card-why-team"');
    expect(card).toContain('<input type="checkbox" data-save-profile checked');
    expect(textOf(card)).toContain('Save to my profile, so your deputy can answer it next time');
    expect(card).toContain(
      '<button class="secondary-action" type="submit" data-focus-key="answer:search-infra:card">Answer and continue</button>',
    );
    // Your answers fill in where you can see them while the run goes on.
    const answered: Job = {
      ...job,
      status: 'running',
      stage: 'submit',
      waitingFor: null,
      questions: job.questions.map((question) => ({
        ...question,
        answered: true,
        saved: true,
        value: question.kind === 'money' ? '$180,000 a year' : 'Search at scale.',
      })),
    };
    const after = model.jobHtml(answered, app);
    expect(textOf(after)).toContain('Expected salary: $180,000 a year · saved to your profile');
    expect(textOf(after)).toContain('Why are you interested in this team? Search at scale.');
    expect(after).not.toContain('apps-questions');
    expect(inlineScript).toContain(
      'store.answerApplyQuestion(id, question.id, value, { saveToProfile: save });',
    );
  });

  // Round 6 part 3 (T5-2, R9-3): what you type and untick in a job's questions survives every
  // redraw, on the card and in the panel, and a store notification never replaces those fields.
  it('keeps your answers and an unticked Save to my profile across redraws, with no caret on a checkbox', () => {
    const { store, model } = load6();
    signed(store);
    const base = store.approveAndApply('search-infra').job as Job;
    const job: Job = {
      ...base,
      status: 'waiting',
      stage: 'needs-you',
      waitingFor: { kind: 'questions' },
    };
    const app = store.application('search-infra') as App;
    const answers = new Map<string, unknown>([
      ['search-infra:expected-salary', '185000'],
      [model.saveKey('search-infra'), false],
    ]);
    for (const compact of [true, false]) {
      const html = model.jobHtml(job, app, { compact, answers });
      expect(html).toContain('value="185000"');
      expect(html).toMatch(
        /<input type="checkbox" data-save-profile data-focus-key="save:search-infra:(card|panel)" \/>/,
      );
      // Without your choices the form is the default one: Save to my profile ticked.
      expect(model.jobHtml(job, app, { compact })).toContain(
        '<input type="checkbox" data-save-profile checked',
      );
    }
    // The page keeps what you type and tick (input and change), copies it to the job's other form,
    // and forgets it once the answers are sent.
    for (const part of [
      "const control = event.target.closest('[data-question], [data-save-profile]');",
      'if (save) answers.set(M.saveKey(id), control.checked);',
      "host.addEventListener('change', onApplyInput);",
      'if (save) other.checked = control.checked;',
      'answers.delete(M.saveKey(id));',
      "const save = Boolean(form.querySelector('[data-save-profile]')?.checked);",
    ]) {
      expect(inlineScript, part).toContain(part);
    }
    // The panel and the lanes redraw only when the job itself changes (their shape without your
    // answers), and the caret comes back on a text field only.
    expect(inlineScript).toContain('shape = M.jobHtml(job, app, { compact: false });');
    expect(inlineScript).toContain('if (drawerApplyBody.dataset.drawn !== shape) {');
    expect(inlineScript).toContain('const shape = laneHtml(new Map());');
    expect(inlineScript).toContain('morphInto(list, laneHtml(answers));');
    expect(inlineScript).toContain(
      "focusKey && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;",
    );
    expect(inlineScript).not.toContain("'setSelectionRange' in again");
    // The panel's other parts redraw only when they change, so View posting is never replaced.
    expect(inlineScript).toContain(
      "drawInto(field('#apps-drawer-timeline'), M.timelineHtml(app, { wait: mailWait ?? null, tailor: tailorFor(app) }));",
    );
    expect(inlineScript).toContain(
      "drawInto(field('#apps-drawer-materials'), materialsHtml(app));",
    );
    // The email draft has a focus key, so a redraw gives focus and the caret back.
    expect(inlineScript).toContain(
      code('data-reply-text="$(id}" data-focus-key="reply-text:$(id}">'),
    );
  });

  it('escapes what a job and a review show (R5-5)', () => {
    const { store, model } = load6();
    const app = { ...(store.application('search-infra') as App), role: '<img src=x>' };
    const review = {
      ...(store.review('search-infra') as Review),
      checks: [{ id: 'x', label: '<b>bold</b>', status: 'warn', detail: '<script>' }],
    };
    const html = model.cardHtml(app, { applying: true, review });
    expect(html).not.toMatch(/<img src=x>|<b>bold<\/b>|<script>/);
    expect(html).toContain('&lt;img src=x&gt;');
  });

  it('matches the deputy’s line to the job, closes a toast once its need is met, and counts in place', () => {
    // UAT D-12: after Approve and apply, the line says what happens next (six words at most).
    expect(inlineScript).toContain("return 'Approved. I’ll wait for your signature.';");
    expect(inlineScript).toContain("react('approved', approvedSpeech(result));");
    // UAT D-3: the toast that asked for answers closes when the job moves on, or when you answer.
    expect(inlineScript).toContain('closeToast(job.appId);');
    expect(inlineScript).toContain(
      "if (kind === 'needs-you' && handle) toasts.set(job.appId, handle);",
    );
    // UAT D-2: each step's count in the panel is the store's, updated in place each second.
    const { store, model } = load6();
    signed(store);
    store.approveAndApply('search-infra');
    const panel = model.jobHtml(
      store.applyJob('search-infra') as Job,
      store.application('search-infra') as App,
      {
        compact: false,
      },
    );
    expect(panel).toContain('data-job-detail="search-infra:fill"');
    // One count and one total, as the autofill preview's meter: filled plus answers, of 20.
    const job = store.applyJob('search-infra') as Job & { fields: number; filled: number };
    expect(model.fillText({ ...job, filled: 7 })).toBe(
      `Filled 7 of ${job.fields} from your profile, résumé, and answers`,
    );
    expect(textOf(panel)).toContain(
      `Filled 0 of ${job.fields} from your profile, résumé, and answers`,
    );
    expect(inlineScript).toContain("for (const element of $$('[data-job-detail]')) {");
  });

  it('says Applied once in the panel, where the steps already end with it (UAT RD-6)', () => {
    const { store, model } = load6();
    const app = store.application('search-infra') as App;
    const text = 'Applied · sample: nothing was sent';
    const job = {
      ...(store.approveAndApply('search-infra').job as Job),
      status: 'applied',
      result: { text },
    } as Job;
    job.stages = job.stages.map((stage) => {
      const detail = stage.id === 'submit' ? text : stage.detail;
      return { ...stage, state: 'done', ...(detail === undefined ? {} : { detail }) };
    });
    expect(textOf(model.jobHtml(job, app, { compact: false })).split(text)).toHaveLength(2);
    expect(textOf(model.jobHtml(job, app, { compact: true }))).toContain(text);
  });

  it('says the job in the deputy’s Activity and once politely, and follows the store each second', () => {
    expect(inlineScript).toContain('components().notice({');
    expect(inlineScript).toContain('window.setInterval(tickJobs, 1000);');
    // The time is updated in place, never in a live region.
    expect(page).not.toMatch(/data-job-time="[^"]*"[^>]*aria-live/);
  });
});

// Round 6 part 3 (T6-2): a job that waits says what it waits for in the store's own words, the
// same on the card, in Up next, in the role panel, and in the list, for every kind of wait the
// store's apply gate can reach. A wait that passes on its own (your quiet hours, your daily limit)

// Round 6 part 3 (T6-2): a job that waits says what it waits for in the store's own words, the
// same on the card and in the role panel, for every kind of wait the store's apply gate can reach. A wait that passes on its own (your quiet hours, your daily limit)
// never says "Waiting for you", never wears the attention colour, and never invents questions.
describe('applications-preview.html: every kind of wait (round 6 part 3, T6-2)', () => {
  // The kinds come from the store itself, so a new one fails here until the page has words for it.
  const storeKinds = (() => {
    const source = sourceFor('sample-store.js');
    const gate = source.slice(
      source.indexOf('function applyGate('),
      source.indexOf('function accountStep('),
    );
    const advance = source.slice(source.indexOf('function advanceJobs('));
    return [
      ...new Set([
        ...[...gate.matchAll(/kind: '([a-z-]+)'/g)].map((match) => match[1] as string),
        ...[...advance.matchAll(/waitingFor = \{\s*\n\s*kind: '([a-z-]+)'/g)].map(
          (match) => match[1] as string,
        ),
      ]),
    ].sort();
  })();

  // What each wait says: the store's text, the headline on the card and in the panel, and whether
  // it needs you.
  const WAITS: Record<
    string,
    {
      text: string;
      headline: string;
      needsYou: boolean;
      card: string;
    }
  > = {
    agreement: {
      text: 'Sign the updated agreement so your deputy can create your account on careers.google.example',
      headline: 'Waiting for your signature',
      needsYou: true,
      card: 'Sign the updated agreement so your deputy can create your account on careers.google.example.',
    },
    gmail: {
      text: 'Connect Gmail so your deputy can read the one-time code from careers.google.example',
      headline: 'Waiting for Gmail',
      needsYou: true,
      card: 'Connect Gmail so your deputy can read the one-time code from careers.google.example.',
    },
    questions: {
      text: '2 questions for you',
      headline: 'Needs you',
      needsYou: true,
      card: 'asks two questions your profile can’t answer yet.',
    },
    check: {
      text: 'Check the filled form, then send it',
      headline: 'Ready for your check',
      needsYou: true,
      card: 'Your deputy filled the form. Check it, then send it.',
    },
    // The two holds pass on their own, so they quote the store everywhere and ask nothing of you.
    'quiet-hours': {
      text: 'Your quiet hours: it goes on at 15:00',
      headline: 'Waiting for your quiet hours',
      needsYou: false,
      card: 'Your quiet hours: it goes on at 15:00. Nothing to do: your deputy goes on by itself.',
    },
    'daily-limit': {
      text: 'Your daily limit of 5 is reached: it goes on tomorrow',
      headline: 'Waiting for your daily limit',
      needsYou: false,
      card: 'Your daily limit of 5 is reached: it goes on tomorrow. Nothing to do: your deputy goes on by itself.',
    },
    problem: {
      text: 'Your deputy couldn’t make a safe password on this device',
      headline: 'Stopped by a problem',
      needsYou: true,
      card: 'Your deputy couldn’t make a safe password on this device. Nothing was sent.',
    },
  };

  // The job the store starts, held by the kind under test.
  const waiting = (kind: string, store: Round6Store): Job => {
    const base = store.approveAndApply('search-infra').job as Job;
    return {
      ...base,
      status: 'waiting',
      stage: kind === 'questions' || kind === 'check' ? 'needs-you' : 'account',
      waitingFor: {
        kind,
        text: WAITS[kind]?.text ?? '',
        href:
          kind === 'quiet-hours' || kind === 'daily-limit'
            ? './applications-preview.html#applying'
            : (base.waitingFor?.href ?? ''),
      },
    };
  };

  it('has words for every kind of wait the store’s apply gate can reach', () => {
    expect(storeKinds).toEqual(Object.keys(WAITS).sort());
  });

  for (const [kind, words] of Object.entries(WAITS)) {
    it(`says a ${kind} wait the same on the card and in the panel`, () => {
      const { store, model } = load6();
      signed(store);
      const job = waiting(kind, store);
      const app = store.application('search-infra') as App;
      const view = model.jobView(job);
      expect(view.headline).toBe(words.headline);
      expect(view.headline).not.toBe('Waiting for you');
      expect(view.needsYou).toBe(words.needsYou);
      // The card: the headline, why it waits, and the attention colour only while it needs you.
      const card = model.cardHtml(app, { applying: true, job });
      expect(textOf(card)).toContain(words.headline);
      expect(textOf(card)).toContain(words.card);
      expect(card.includes('board-card apps-card is-attention')).toBe(words.needsYou);
      expect(model.cardNeedsYou(app, { job })).toBe(words.needsYou);
      if (kind === 'questions') expect(card).toContain('<form class="apps-questions"');
      else expect(textOf(card)).not.toContain('Answer two questions');
      // The role panel: the same headline, and the step marked Needs you or On hold.
      const panel = model.jobHtml(job, app, { compact: false });
      expect(textOf(panel)).toContain(words.headline);
      expect(textOf(panel)).toContain(words.needsYou ? 'Needs you' : 'On hold');
      expect(textOf(panel)).toContain(words.card);
      expect(panel.includes('timeline-item is-attention')).toBe(words.needsYou);
    });
  }

  it('sends a hold to How your deputy applies, and the agreement back to the role (T3-1)', () => {
    const { store, model } = load6();
    signed(store);
    const app = store.application('search-infra') as App;
    // The store points the two holds at this page's rules; #how-you-apply opens the rules drawer,
    // so the link lands in it.
    const hold = model.jobHtml(waiting('quiet-hours', store), app, { compact: true });
    expect(hold).toContain(
      '<a class="secondary-action" href="./applications-preview.html#how-you-apply" data-focus-key="job-wait:search-infra:card">How your deputy applies</a>',
    );
    expect(textOf(hold)).toContain('Nothing to do: your deputy goes on by itself.');
    // Review and sign comes back with ?open=<appId>, so you land on the role you acted from.
    const unsigned = load6();
    const job = unsigned.store.approveAndApply('search-infra').job as Job;
    expect(job.waitingFor?.kind).toBe('agreement');
    const card = unsigned.model.jobHtml(job, app, { compact: true });
    expect(card).toContain(
      'href="./agreement-preview.html?mode=update&amp;return=applications-preview.html%3Fopen%3Dsearch-infra"',
    );
  });
});

describe('applications-preview.html: a card an email moved (round 6, A4)', () => {
  it('marks a card an email moved, with Undo while it can', () => {
    const { store, model } = load6();
    signed(store);
    const move = store
      .mailWatch()
      .moves.find((each) => each.appId === 'amazon-sde2' && each.status === 'applied');
    expect(move).toBeTruthy();
    const app = store.application('amazon-sde2') as App;
    const card = model.cardHtml(app, { move });
    expect(textOf(card)).toContain(String(move?.label));
    expect(card).toContain(`data-mail-move="undo" data-mail="${move?.mailId}"`);
    // Round 6 part 3 (T6-4): Undo goes with the move, so focus lands on the card it put back (the
    // email list's Undo leaves focus on the row's next control through its own focus key).
    expect(inlineScript).toContain("const id = undo.closest('[data-app]')?.dataset.app ?? '';");
    expect(inlineScript).toContain(
      code(
        'shownOrNull(boardView.querySelector(`[data-focus-key="card:$(key(id)}"]`))?.focus({ preventScroll: true });',
      ),
    );
    expect(card).toContain('data-focus-key="card:amazon-sde2"');
  });
});

describe('applications-preview.html: How your deputy applies, in its drawer (round 6, A1; round 7)', () => {
  const rules = rulesDrawer;

  it('opens at #how-you-apply, with every rule changeable and Reset', () => {
    expect(rules).toContain('<p class="eyebrow">How your deputy applies</p>');
    for (const name of [
      'autoApprove.enabled',
      'autoApprove.minFit',
      'autoApprove.minScore',
      'autoApprove.noNewAnswers',
      'autoApprove.notAvoided',
      'autoApply.dailyLimit',
      'quiet',
      'quietStart',
      'quietEnd',
      'autoApply.onlyWithoutNewAnswers',
    ])
      expect(rules, name).toContain(`name="${name}"`);
    // The morning's tailoring (tailorDaily, the orchestrator's decision): a switch, on by default,
    // shown once the store has it; Reset to default restores it.
    expect(rules).toContain('<fieldset class="apps-rules-group" id="apps-rules-tailor" hidden>');
    expect(rules).toContain(
      '<label class="switch">\n                <input type="checkbox" role="switch" name="tailorDaily" aria-checked="true" aria-describedby="apps-rules-tailor-help" />\n                <span class="switch-track" aria-hidden="true"></span>',
    );
    expect(textOf(rules)).toContain(
      'Your deputy tailors the roles you added each morning at 06:00',
    );
    expect(inlineScript).toContain("$('#apps-rules-tailor').hidden = !daily;");
    // What differs from the system default names it in words (the store's changed key).
    const { store: ruleStore, model: ruleModel } = load6();
    expect(ruleStore.setApplyRules({ tailorDaily: { enabled: false } }).ok).toBe(true);
    expect(ruleModel.rulesDiffText(ruleStore.applyRules())).toContain(
      'Tailoring each morning: yours off; the default is on.',
    );
    expect(inlineScript).toContain(
      "patch = { tailorDaily: typeof rules.tailorDaily === 'object' ? { enabled: control.checked } : control.checked };",
    );
    // Email after each application lives in Settings, Account, with every email we send (D8,
    // SA-1): one read only line here, linking there with return=.
    expect(rules).not.toContain('name="notifyEmail"');
    expect(rules).toContain(
      '<p class="apps-rule-line" id="apps-rule-notify">Email after each application: <span id="apps-rule-notify-state">On</span> · <a class="apps-summary-link" href="./account-preview.html#emails" data-return-link>Change in Settings, Account</a></p>',
    );
    expect(inlineScript).toContain("const notify = rules.notifyEmail ? 'On' : 'Off';");
    expect(inlineScript).not.toContain("control.name === 'notifyEmail'");
    expect(rules).toContain(
      '<input type="checkbox" checked disabled aria-describedby="apps-rule-agreement-why" />',
    );
    expect(rules).toContain('Always on: your deputy never applies without it.');
    expect(rules).toContain(
      '<button class="secondary-action" id="apps-rules-reset" type="button" aria-describedby="apps-rules-diff">Reset to default</button>',
    );
    expect(rules).toContain('Planned for launch, Phase 2 · nothing is sent in this prototype');
    // Reset stays one line and fits at 320px with text spacing (UAT A-3): a short label, and the
    // line it describes (aria-describedby) names the system default.
    expect(rules).toContain('aria-describedby="apps-rules-diff">Reset to default</button>');
  });

  it('starts on Review, then auto-apply with auto approve off, says what differs, and resets', () => {
    const { store, model } = load6();
    const now = store.applyRules();
    expect(now.mode).toBe('review_then_auto');
    expect((now.autoApprove as { enabled: boolean }).enabled).toBe(false);
    expect(model.rulesLine(now)).toBe('Review, then auto-apply · up to 5 a day');
    expect(model.rulesDiffText(now)).toBe(
      'One setting differs from the system default. Quiet hours: yours 21:00 to 08:00; the default is 22:00 to 07:00.',
    );
    expect(store.resetApplyRules().ok).toBe(true);
    expect(model.rulesDiffText(store.applyRules())).toBe('You’re on the system default.');
    expect(store.setApplyRules({ autoApprove: { minScore: 40 } })).toMatchObject({
      ok: false,
      field: 'autoApprove.minScore',
    });
    expect(inlineScript).toContain("ruleError(field, result?.why ?? 'Check this setting.');");
  });
});

// Round 6 part 3, fix pass 2: the role panel names the job's state (T3-R4), an email whose move
// waits for your signature is told where it matters (R9-12, T7-7), and the way back from signing

describe('applications-preview.html: fix pass 2 (T3-R4, R9-12, T3-R1)', () => {
  it('names the job’s state over the panel, and a held step says it hasn’t started (T3-R4)', () => {
    const { store, model } = load6();
    const app = store.application('search-infra') as App;
    const job = store.approveAndApply('search-infra').job as Job;
    expect(job.waitingFor?.kind).toBe('agreement');
    expect(model.jobTitle(job)).toBe('Your deputy waits for you');
    const held: Job = {
      ...job,
      waitingFor: { kind: 'quiet-hours', text: 'Your quiet hours: it goes on at 15:00' },
    };
    expect(model.jobTitle(held)).toBe('Your deputy is on hold');
    expect(model.jobTitle({ ...job, status: 'running', waitingFor: null })).toBe(
      'Your deputy is applying',
    );
    expect(model.jobTitle({ ...job, status: 'stopped', waitingFor: null })).toBe(
      'Your deputy stopped',
    );
    expect(model.jobTitle({ ...job, status: 'applied', waitingFor: null })).toBe(
      'Applied by your deputy',
    );
    // The held step's detail says it hasn't started; a step that needs you keeps the store's.
    const account = job.stages.find((stage) => stage.id === 'account') as Job['stages'][number];
    expect(model.stepDetail(held, account)).toBe(
      'Not started yet: signing in to careers.google.example',
    );
    expect(model.stepDetail(job, account)).toBe('Signing in to careers.google.example');
    expect(textOf(model.jobHtml(held, app, { compact: false }))).toContain(
      'On hold Not started yet: signing in to careers.google.example',
    );
    // Stopped: the heading says it, so the panel drops the pill that repeated "Stopped" and says
    // what stopping means; the card keeps its own line.
    const stopped = { ...job, status: 'stopped', waitingFor: null } as Job;
    const panel = model.jobHtml(stopped, app, { compact: false });
    expect(panel).not.toContain('run-tracker-state');
    expect(textOf(panel)).toContain('Nothing was sent, and your materials stay approved.');
    expect(textOf(model.jobHtml(stopped, app, { compact: true }))).toContain(
      'Your deputy stopped. Nothing was sent.',
    );
    expect(inlineScript).toContain('title.textContent = M.jobTitle(job);');
    // The ticker that keeps each step's detail current uses the same words.
    expect(inlineScript).toContain("const text = job && stage ? M.stepDetail(job, stage) : '';");
  });

  it('tells an email’s waiting move on the card and in the panel (R9-12)', () => {
    const { store, model } = load6();
    const watch = store.mailWatch();
    const events = store.mailEvents();
    const amazon = store.application('amazon-sde2') as App;
    const wait = model.mailWaitFor(amazon, watch, events) as MailWait;
    expect(wait).toEqual({
      mailId: 'mail-amazon-interview',
      to: 'Interviewing',
      said: 'an email invited you to interview, Thu, Oct 8, 13:00',
      text: 'An email invited you to interview, Thu, Oct 8, 13:00. It moves to Interviewing once you sign.',
      href: './agreement-preview.html?mode=update&return=applications-preview.html%3Fopen%3Damazon-sde2',
    });
    const devex = model.mailWaitFor(store.application('devex') as App, watch, events) as MailWait;
    expect(devex.text).toBe(
      'An email says Google isn’t moving forward. It moves to Closed once you sign.',
    );
    // The card: the email's words with Review and sign, in place of its own next step (no
    // follow-up beside an interview invitation), and it needs you.
    const card = model.cardHtml(amazon, { wait });
    expect(textOf(card)).toContain(
      'An email invited you to interview, Thu, Oct 8, 13:00. It moves to Interviewing once you sign. Review and sign',
    );
    expect(card).toContain(
      'href="./agreement-preview.html?mode=update&amp;return=applications-preview.html%3Fopen%3Damazon-sde2"',
    );
    expect(card).not.toContain('board-card-next');
    expect(textOf(card)).not.toContain('Follow up');
    expect(card).toContain('board-card apps-card is-attention');
    expect(textOf(model.cardHtml(amazon))).toContain('Follow up');
    // The panel's timeline says the same.
    const timeline = textOf(model.timelineHtml(amazon, { wait }));
    expect(timeline).toContain('Sign, and it moves to Interviewing Needs you An email invited you');
    expect(timeline).not.toContain('Follow up');
    // Once you sign, the moves happen and the cards say so with Undo instead.
    signed(store);
    expect(model.mailWaitFor(amazon, store.mailWatch(), store.mailEvents())).toBeNull();
    // The page reads the waits once per render, and the panel shows Review and sign under the words.
    expect(inlineScript).toContain('const wait = M.mailWaitFor(app, watch, events);');
    expect(drawer).toContain(
      '<p class="apps-drawer-block" id="apps-drawer-mail" hidden><a class="secondary-action" id="apps-drawer-mail-sign" href="./agreement-preview.html?mode=update">Review and sign</a></p>',
    );
    expect(inlineScript).toContain(
      "if (mailWait) field('#apps-drawer-mail-sign').href = mailWait.href;",
    );
  });

  it('lands in the reply’s draft after signing, even with #email in the address (T3-R1)', () => {
    // The browser's own #email jump runs once the document has loaded and takes focus with it, so
    // the landing runs again after it.
    expect(inlineScript).toContain('function landOnReply(id) {');
    expect(inlineScript).toContain("row.scrollIntoView({ block: 'start', behavior: 'auto' });");
    expect(inlineScript).toContain('field.focus({ preventScroll: true });');
    expect(inlineScript).toMatch(
      /if \(window\.location\.hash\) \{\s*const again = \(\) => window\.requestAnimationFrame\(\(\) => landOnReply\(replyId\)\);\s*if \(document\.readyState === 'complete'\) again\(\);\s*else window\.addEventListener\('load', again, \{ once: true \}\);/,
    );
  });
});

describe('applications-preview.html: the testers’ round 7 items', () => {
  it('orders Shortlisted and Tailoring by your deputy’s queue (T2-20)', () => {
    expect(inlineScript).toContain('const queueRank = (ctx, app) => {');
    expect(inlineScript).toContain(
      'Number(needsNow(ctx, b)) - Number(needsNow(ctx, a)) || queueRank(ctx, a) - queueRank(ctx, b) || M.laneOrder(a, b);',
    );
    // The large sample: the one tailoring now, then the line by its place, then the rest; the
    // morning's schedule in its order.
    const { store, model } = load('?demo=large');
    type Job = { status: string; queue?: { position?: number }; order?: number } | null;
    const jobOf = (app: App) => store.tailorJob(app.id) as Job;
    const tailoring = laneFor(store, model, 'tailoring').map(jobOf);
    expect(tailoring[0]?.status).toBe('running');
    const line = tailoring.filter((job) => job?.status === 'queued');
    expect(line.length).toBeGreaterThan(1);
    expect(line.map((job) => Number(job?.queue?.position))).toEqual(
      line.map((job) => Number(job?.queue?.position)).sort((a, b) => a - b),
    );
    expect(tailoring.indexOf(line.at(-1) ?? null)).toBeLessThan(
      tailoring.findIndex((job) => job?.status === 'stopped'),
    );
    const morning = laneFor(store, model, 'shortlisted')
      .map(jobOf)
      .filter((job) => job?.status === 'scheduled')
      .map((job) => Number(job?.order));
    expect(morning.length).toBeGreaterThan(1);
    expect(morning).toEqual([...morning].sort((a, b) => a - b));
    // The store's own lane order, which the page reads (ST, section 18).
    expect(inlineScript).toContain(
      "const laneOrder = typeof store.tailorQueue === 'function' ? store.tailorQueue()?.laneOrder : null;",
    );
    expect(inlineScript).toContain(
      'if (ctx.queueOrder) return ctx.queueOrder.has(app.id) ? ctx.queueOrder.get(app.id) : 9000;',
    );
    const order = (
      store as unknown as { tailorQueue(): { laneOrder: Record<string, string[]> } }
    ).tailorQueue().laneOrder;
    const need = new Set((store as unknown as { needYou(): { ids: string[] } }).needYou().ids);
    for (const stage of ['shortlisted', 'tailoring']) {
      const ids = laneFor(store, model, stage).map((app) => app.id);
      expect(ids.filter((id) => !need.has(id))).toEqual(
        order[stage]?.filter((id) => ids.includes(id) && !need.has(id)),
      );
    }
  });

  it('redraws for tailoring’s progress, never for a progress it doesn’t show (change.areas)', () => {
    expect(inlineScript).toContain(
      "if (change?.progress && Array.isArray(change.areas) && !change.areas.some((area) => area === 'tailoring' || area === 'applications')) return;",
    );
  });

  it('says the tailoring job’s state in the panel and its timeline, as the card does (T6-2)', () => {
    const { store, model } = load();
    // Paused: the card's words and why, and no drafting in progress.
    const paused = store.application('cloud-reliability') as App;
    const job = store.tailorJob('cloud-reliability') as { status: string; reason?: string };
    expect(job.status).toBe('stopped');
    const tailor = model.tailorFor(paused, { job });
    const timeline = textOf(model.timelineHtml(paused, { tailor }));
    expect(timeline).toContain(`${tailor?.words} Paused`);
    if (tailor?.why) expect(timeline).toContain(tailor.why);
    expect(timeline).not.toMatch(/drafting/i);
    // Running: the current step, marked as the step now.
    expect(store.startTailoring('workspace').ok).toBe(true);
    const running = store.application('workspace') as App;
    const live = model.tailorFor(running, { job: store.tailorJob('workspace') });
    expect(live?.status).toBe('running');
    const html = model.timelineHtml(running, { tailor: live });
    expect(html).toContain('aria-current="step"');
    expect(textOf(html)).toContain(`${live?.words} Now`);
    // The panel reads the same tailoring (the card's), and its timeline too.
    expect(inlineScript).toContain(
      "if (tailor?.status === 'stopped') return `$" +
        '{sentence(tailor.words)}$' +
        '{tailor.why ? ` $' +
        "{sentence(tailor.why)}` : ''} Carry on from its card when you’re ready.`;",
    );
    expect(inlineScript).toContain(
      'M.timelineHtml(app, { wait: mailWait ?? null, tailor: tailorFor(app) })',
    );
  });

  it('announces the roles that finish tailoring into Approval once, politely, together (T4-3)', () => {
    expect(inlineScript).toContain('function noticeTailoring() {');
    expect(inlineScript).toContain(
      "if (lastStages.get(id) === 'tailoring' && stage === 'approval' && !manualMoves.has(id)) finishedTailoring.add(id);",
    );
    // One batch: a second and a half gathers what finished, then one polite line says it.
    expect(inlineScript).toMatch(
      /if \(!finishedTailoring\.size \|\| tailorTimer\) return;\s*tailorTimer = window\.setTimeout\(\(\) => \{/,
    );
    expect(inlineScript).toContain('}, 1500);');
    expect(inlineScript).toContain(
      '`Your deputy finished tailoring $' + '{roles[0].role}. It waits for your approval.`',
    );
    expect(inlineScript).toContain(
      '`Your deputy finished tailoring $' +
        '{roles.length} roles: $' +
        '{M.joinWords(roles.map((app) => app.role))}. They wait for your approval.`',
    );
    // Every render looks, after the board is drawn; the page's channel is polite.
    expect(inlineScript).toMatch(/const moved = glide\(before\);\s*noticeTailoring\(\);/);
    expect(main).toContain(
      '<p class="sr-only" id="apps-announcement" role="status" aria-live="polite"></p>',
    );
  });

  it('morphs each lane in place, card by card, and keeps the focused control in view (T4-6, R9-3)', () => {
    expect(inlineScript).toContain('morphInto(list, laneHtml(answers));');
    expect(inlineScript).not.toContain('list.innerHTML = laneHtml(');
    // Cards are matched by their key, so a card keeps its node and its controls.
    expect(inlineScript).toContain(
      "const keyOf = (node) => (node.nodeType === 1 ? node.getAttribute('data-card') : null);",
    );
    expect(inlineScript).toContain(
      "if (name === 'value' && from === document.activeElement) continue;",
    );
    const { store, model } = load();
    const app = store.application('workspace') as App;
    expect(model.cardHtml(app, cardOptionsFor(store, model, app))).toContain(
      'data-card="workspace"',
    );
    // A control that moved with its card to another lane is focused there and, only when it
    // would sit under the sticky bars or below the screen, scrolled into view where its card
    // settles (its box less the glide's offset), after Tailor now and after the move (T4-6).
    expect(inlineScript).toContain('if (again) reveal(again);');
    expect(inlineScript).toContain(
      'const top = (Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0) + 8;',
    );
    expect(inlineScript).toContain(
      'const delta = box.top < top ? box.top - top : box.bottom > bottom ? Math.min(box.bottom - bottom, box.top - top) : 0;',
    );
    expect(inlineScript).toContain('const shift = new DOMMatrixReadOnly(matrix).m42;');
    expect(inlineScript).toMatch(
      /control\?\.focus\(\{ preventScroll: true \}\);[\s\S]{0,120}reveal\(control\);/,
    );
    expect(inlineScript).not.toContain('again.scrollIntoView(');
  });

  it('ends each lane where its cards end, and keeps a who line’s time with its dot (T2-19, T2-22)', () => {
    const css = page.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    const board = css.match(/\n {6}\.apps-board\.board \{[^}]*\}/)?.[0] ?? '';
    expect(board).toContain('align-items: start;');
    expect(css).toMatch(/\.apps-who-when \{\s*white-space: nowrap;\s*\}/);
    const { model } = load();
    expect(
      model.whoHtml({ by: 'deputy', what: 'Auto-applied', when: 'Sat, Sep 26, 10:12' }),
    ).toContain(
      '<span class="apps-who-what">Auto-applied</span>\u00a0· <span class="apps-who-when">Sat, Sep 26, 10:12</span>',
    );
    // The dot sits outside the time, after a no-break space: a wrap never starts with it.
    expect(page).not.toContain('<span class="apps-who-when"> ·');
    // The card's company line too: each dot after a no-break space.
    const { store: metaStore } = load();
    const card = model.cardHtml(metaStore.application('devex') as App);
    const meta = card.match(/<span class="board-card-meta">([^<]*)<\/span>/)?.[1] ?? '';
    expect(meta).toContain('Google\u00a0· ');
    expect(meta).not.toMatch(/ ·/);
  });

  it('keeps the header compact on phones: the summary on one line, who did what folded (T2-12)', () => {
    const css = page.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    const phone = css.slice(css.indexOf('@media (max-width: 720px) {'));
    expect(phone).toMatch(/\.apps-summary-origin \{\s*display: none;\s*\}/);
    expect(phone).toMatch(/\.apps-split-toggle \{\s*display: inline-flex;\s*\}/);
    expect(phone).toMatch(/\.apps-split:not\(\.is-open\) \{\s*display: none;\s*\}/);
    expect(css).toMatch(/\.apps-split-toggle \{\s*display: none;/);
    expect(main).toContain(
      '<button class="compact-action apps-split-toggle" id="apps-split-toggle" type="button" aria-expanded="false" aria-controls="apps-split">Who did what</button>',
    );
    expect(inlineScript).toContain("$('#apps-split').classList.toggle('is-open', open);");
  });

  it('says after Sync on the unsigned sample that the cards move once you sign, with Sign now', () => {
    const { store, model } = load();
    const gate = store.requiresAgreement('mail-updates');
    expect(gate?.version).toBe('2026.10');
    const result = store.gmailScan() as { ok: boolean; moved: string[] };
    expect(result.ok).toBe(true);
    expect(result.moved).toEqual([]);
    const held = Number((store.mailWatch() as unknown as { waiting: number }).waiting);
    expect(held).toBeGreaterThan(0);
    const totals = totalsOf(store);
    expect(totals.waiting).toBe(held);
    const words = model.syncWords(result, {
      roleOf: (id) => store.application(id)?.role ?? '',
      pending: { count: totals.waiting, version: gate?.version ?? '' },
      totals,
    });
    expect(words.message).toContain(`${held} cards will move once you sign version 2026.10.`);
    expect(words.message).toContain(`${totals.replyNeeded} emails need your reply.`);
    expect(words.held).toBe(held);
    // Its notice offers Sign now, the one-step page that comes back to the board.
    expect(inlineScript).toContain(
      'const pending = gate ? { count: Number(totals ? totals.waiting : watchNow()?.waiting) || 0, version: gate.version } : null;',
    );
    expect(inlineScript).toContain("words.held ? 'Sign now' : 'Review and sign'");
    expect(inlineScript).toContain(
      './agreement-preview.html?mode=update&return=$' +
        "{encodeURIComponent('applications-preview.html')}",
    );
  });

  it('says one set of totals in the Gmail line, the Sync notice, and the drawer: before, after Sync, signed (T2b-1)', () => {
    const { store, model } = load();
    const fig = (name: string, value: unknown) =>
      store.metric(name) !== null ? store.metricText(name) : String(value);
    const count = (name: string, value: unknown) =>
      Number(store.metric(name) !== null ? store.metric(name) : value) || 0;
    const line = () =>
      plainOf(
        model.gmailFactsHtml(store.gmailScans(), {
          fig,
          count,
          ago: 'now',
          totals: totalsOf(store),
        }),
      );
    expect(line()).toContain(
      '6 new job emails since yesterday’s 07:00 scan. 2 moves wait for your signature, 2 emails need your reply.',
    );
    // Sync on the unsigned sample: this scan's find, then every move that waits and every reply.
    const result = store.gmailScan() as Record<string, unknown>;
    const after = totalsOf(store);
    expect(after).toMatchObject({ waiting: 3, replyNeeded: 3 });
    expect(line()).toContain(
      `2 new job emails since the 07:00 scan. ${after.waiting} moves wait for your signature, ${after.replyNeeded} emails need your reply.`,
    );
    const words = model.syncWords(result, {
      roleOf: (id) => store.application(id)?.role ?? '',
      pending: { count: after.waiting, version: '2026.10' },
      totals: after,
    });
    expect(words.message).toContain(
      `${after.waiting} cards will move once you sign version 2026.10. ${after.replyNeeded} emails need your reply.`,
    );
    // The drawer: its gate and its figures in the same totals.
    const figures = plainOf(
      model.mailFiguresHtml(
        {
          events: store.metricText('mail.events'),
          replyNeeded: store.metricText('mail.replyNeeded'),
        },
        { watch: true },
      ),
    );
    expect(figures).toBe(`${after.replyNeeded} need your reply`);
    expect(inlineScript).toContain(
      '? `$' +
        "{M.escapeHtml(store.metricText('mail.waiting'))} $" +
        "{waiting === 1 ? 'move waits' : 'moves wait'} for your signature`",
    );
    // Signed: the cards the emails actually moved, every one.
    signed(store);
    const signedTotals = totalsOf(store);
    expect(signedTotals).toMatchObject({ moved: 3, waiting: 0 });
    expect(line()).toContain(
      `2 new job emails since the 07:00 scan. 3 cards moved, ${signedTotals.replyNeeded} emails need your reply.`,
    );
    expect(inlineScript).toContain('totals: mailTotals(),');
  });

  it('forwards the old anchors: #ready to what needs you, #apps-tracker to the board (T7-9)', () => {
    expect(inlineScript).toMatch(
      /if \(hash === 'ready'\) \{\s*needOnly = true;\s*render\(\);[\s\S]*?url\.hash = '';\s*window\.history\.replaceState\(window\.history\.state, '', url\);[\s\S]*?syncUrl\(\);\s*return;\s*\}/,
    );
    expect(inlineScript).toMatch(
      /if \(hash === 'apps-tracker'\) \{\s*document\.getElementById\('apps-flow'\)\?\.scrollIntoView\(\{ block: 'start', behavior: 'auto' \}\);\s*return;\s*\}/,
    );
    expect(main).toContain('id="apps-flow"');
  });

  it('steps the status line aside over an empty filter, and says the day runs come back (T7-14, T5-20)', () => {
    expect(inlineScript).toContain('if (!emptyView.hidden) statusLine.hidden = true;');
    const { store, model } = load();
    const day = (store as unknown as { runway(): { runs: { refreshesOn: string } } }).runway().runs
      .refreshesOn;
    expect(model.dayDate(day).replace(/ /g, ' ')).toBe('Sun, Nov 1');
    expect(inlineScript).toContain("return day ? M.dayDate(day) : 'next month';");
    expect(page).not.toContain('wait for the 1st');
  });

  it('says a held role waits for your signature, never Not started yet (T5-22)', () => {
    const { store, model } = load();
    // On the unsigned sample, Sync reads an email saying you applied to a shortlisted role.
    expect((store.gmailScan() as { ok: boolean }).ok).toBe(true);
    const queue = (
      store as unknown as {
        tailorQueue(): { held: Array<{ appId: string }>; laneOrder: Record<string, string[]> };
      }
    ).tailorQueue();
    const heldIds = queue.held.map((job) => job.appId);
    expect(heldIds.length).toBeGreaterThan(0);
    for (const id of heldIds) {
      const app = store.application(id) as App;
      expect(app.stage).toBe('shortlisted');
      const job = store.tailorJob(id) as { status: string; text: string };
      expect(job.status).toBe('held');
      const tailor = model.tailorFor(app, { job, daily: dailyOf(store) });
      expect(tailor).toMatchObject({ status: 'held', words: job.text, action: null });
      const html = model.cardHtml(app, cardOptionsFor(store, model, app));
      const text = plainOf(html);
      expect(text).toContain(job.text);
      expect(text).not.toContain('Not started yet');
      expect(text).toContain('once you sign');
      expect(html).not.toContain(`data-tailor-start="${id}"`);
      expect(html).not.toContain('run-tracker-pips');
      // The store puts it after the queue; it leads the lane only because it needs you.
      expect(queue.laneOrder.shortlisted?.at(-1)).toBe(heldIds.at(-1));
    }
  });

  it('keeps a waiting move’s line after Gmail is disconnected: moves already read still wait (T5-10)', () => {
    const { store, model } = load();
    const waitingBefore = store
      .get()
      .applications.filter((app) => cardOptionsFor(store, model, app).wait)
      .map((app) => app.id)
      .sort();
    expect(waitingBefore).toEqual(['amazon-sde2', 'devex']);
    store.disconnectGmail();
    expect(store.mailWatch().moves).toEqual([]);
    for (const id of waitingBefore) {
      const app = store.application(id) as App;
      const options = cardOptionsFor(store, model, app);
      expect(options.wait).toBeTruthy();
      const text = plainOf(model.cardHtml(app, options));
      expect(text).toMatch(/It moves to (Interviewing|Closed) once you sign\./);
      expect(text).toContain('Review and sign');
      expect(text).not.toContain('Follow up');
    }
    // Still the store's needs-you list.
    const need = (store as unknown as { needYou(): { ids: string[] } }).needYou().ids;
    for (const id of waitingBefore) expect(need).toContain(id);
    expect(inlineScript).toContain(
      "const read = (events ?? []).find((each) => each.appId === app.id && each.status === 'waiting' && each.change?.to);",
    );
  });

  it('says a return from signing as yours: Signed, and the cards your emails moved (T6b-3)', () => {
    // The page notes, as you leave, whether the updated agreement still waits; back signed, the
    // moves it released are said as the emails' moves, the rest after them.
    expect(inlineScript).toContain(
      'JSON.stringify({ at: Date.now(), gated: mailGated(), stages: Object.fromEntries(apps.map((app) => [app.id, app.stage])) }),',
    );
    expect(inlineScript).toContain('signedAway = saved.gated === true && !mailGated();');
    expect(inlineScript).toContain(
      'const fromMail = signedAway ? told.filter((move) => byId(move.id) && M.mailMoveFor(byId(move.id), watch)) : [];',
    );
    expect(inlineScript).toContain(
      'title: `Signed. $' +
        "{fromMail.length === 1 ? 'A card' : `$" +
        '{fromMail.length} cards`} moved from your emails`,',
    );
    expect(inlineScript).toContain(
      '...(rest.length ? [`Also while you were away: $' + "{rest.map(line).join(' ')}`] : []),",
    );
    // The shared notice's folded pill says "Signed" too (PL's pill option).
    expect(inlineScript).toContain("...(fromMail.length ? { pill: 'Signed' } : {}),");
    // Any other return keeps its words.
    expect(inlineScript).toContain(
      "title: told.length === 1 ? 'A card moved while you were away' : `$" +
        '{told.length} cards moved while you were away`,',
    );
    // The store: signing releases the emails' moves, which the watch then lists as made.
    const { store, model } = load();
    expect((store.gmailScan() as { ok: boolean }).ok).toBe(true);
    const waiting = store
      .get()
      .applications.filter((app) => cardOptionsFor(store, model, app).wait)
      .map((app) => app.id);
    expect(waiting.length).toBe(3);
    signed(store);
    expect(store.requiresAgreement('mail-updates')).toBeNull();
    for (const id of waiting) {
      expect(model.mailMoveFor(store.application(id) as App, store.mailWatch())).toBeTruthy();
    }
  });

  it('counts each lane by what the need view shows, from the store’s one list (T5-10, T5-13)', () => {
    const { store, model } = load('?demo=large');
    const need = (store as unknown as { needYou(): { count: number; ids: string[] } }).needYou();
    const apps = store.get().applications;
    const byLane = Object.fromEntries(
      [...LANES, 'closed'].map((stage) => [
        stage,
        apps.filter((app) => app.stage === stage && need.ids.includes(app.id)).length,
      ]),
    );
    expect(Object.values(byLane).reduce((sum, count) => sum + count, 0)).toBe(need.count);
    // Each lane with such a card puts them first, so the five it shows include them.
    for (const stage of LANES) {
      const lane = laneFor(store, model, stage);
      const first = lane.slice(0, byLane[stage]).map((app) => app.id);
      expect(first.every((id) => need.ids.includes(id))).toBe(true);
    }
    expect(inlineScript).toMatch(
      /if \(narrowed\) \{\s*if \(badge\.dataset\.metric\) \{\s*badge\.dataset\.metricHeld = badge\.dataset\.metric;\s*delete badge\.dataset\.metric;/,
    );
  });
});
