import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Page guarantees for the Dashboard (brand/home-preview.html) and its sample daily email
// (brand/summary-email-preview.html), round 7: one sample world behind every figure (R3-3), each
// figure once (R3-4), every colour explained in the shared palette's words (R3-5), the tour
// (R3-6), and the owner's sixth review: three glance tiles of one design (D1: Job matches,
// Applications with who did each step, D5, and Runs and tokens with the shared rings and runway,
// D10), To-do and What's new unchanged (D4), every prompt as the shared summary row (D2, R10-5),
// Gmail's daily scan and Scan now (D3, R10-9), Usage over a range (D9), Keywords by role (D6), the
// cards that moved to their screens gone (D7, R10-2), the daily email (D8), and a first paint
// that is the last (G2, R10-1). The page's model and views run here against the real shared
// store, with a clock the test moves, so the live Amazon run can finish; the static markup must be
// the views' render of the seed, so the first paint already matches the store.

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');
const home = sourceFor('home-preview.html');
const storeSource = sourceFor('sample-store.js');

type Clock = { now: number };
type Run = {
  id: string;
  sourceId: string;
  sourceName: string;
  status: string;
  stage: string;
  kept: number;
  checked: number;
  jobIds: string[];
};
type Words = { id: string; label: string; tone: string | null; meaning: string };
type Limit = {
  tokens: number | null;
  period: string;
  onReach: string;
  used: number;
  left: number | null;
  state: string;
  paused: boolean;
  usingPlatform: boolean;
};
type Result = { ok: boolean; reason?: string };
type Store = {
  FITS: Words[];
  STAGES: Words[];
  TERMS: Record<string, string>;
  get(): {
    applications: Array<{ id: string; stage: string; interview?: string }>;
    onboarding: Record<string, unknown>;
    profile: { email: string; targetRoles: string[] };
    tours: { seen: Record<string, boolean> };
  };
  update(change: Record<string, unknown>, mutate: (next: Record<string, unknown>) => void): unknown;
  subscribe(listener: (state: unknown, change: Record<string, unknown>) => void): () => void;
  metric(key: string): unknown;
  metricText(key: string): string;
  liveRun(sourceId?: string): Run | null;
  runs(filter?: { status?: string; sourceId?: string }): Run[];
  run(id: string): Run | null;
  startRun(sourceId: string, options?: Record<string, unknown>): Result;
  latest(count?: number): Array<{ id: string; fresh: boolean }>;
  todo(): Array<{ id: string; kind: string; title: string; href: string; action: string }>;
  setAiChoice(source: string): { source: string } | null;
  setAiLimit(limit: Record<string, unknown>): Limit | null;
  aiLimit(): Limit;
  keywordStats(): { basedOn: number; keywords: Array<{ slug: string; roles: number }> };
  aiUsageBy(by: string): Array<{ id: string; label: string; tokens: number; runs: number }>;
  credits(): { left: number; bought: { tokens: number }; model: { name: string } };
  buy(itemId: string): Result;
  agreements(): { current: string; pending: unknown; paused: boolean };
  signAgreement(signature: Record<string, unknown>): Result;
  setAgreementDemo(mode: string | null): unknown;
  updates(): Array<{ id: string; kind: string; title: string; href: string; read: boolean }>;
  markUpdateRead(id: string): unknown;
  setPlatformModel(id: string): unknown;
  catalog(): {
    sources: Array<{ id: string; name: string; tone: string; found: number }>;
    jobs: Array<{ id: string; source: string }>;
    deletedSources: Array<{ id: string; name: string }>;
  };
  skipSetup(stepIds: string[]): { ok: boolean; added?: string[]; reason?: string };
  setSummarySubscription(change: { subscribed?: boolean; time?: string }): Result;
};

// The store, seeded in an empty browser at a fixed moment; the test moves the clock. Its real
// stage plan (about 100 seconds a run) is the one pages see.
function load({ search = '' }: { search?: string } = {}): { store: Store; clock: Clock } {
  const storage = new Map<string, string>();
  const clock: Clock = { now: Date.parse('2026-11-20T18:30:00Z') };
  const window: Record<string, unknown> = { addEventListener: () => {}, location: { search } };
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  const FakeDate = new Proxy(Date, {
    construct: (target, args) => Reflect.construct(target, args.length ? args : [clock.now]),
    get: (target, property) => {
      if (property === 'now') return () => clock.now;
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  runInNewContext(storeSource, { window, localStorage, JSON, Date: FakeDate });
  return { store: window.JobDeputyStore as Store, clock };
}
const seconds = (clock: Clock, count: number) => {
  clock.now += count * 1000;
};
// Lets the store's after-the-read notifications run.
const flush = () => new Promise((done) => setTimeout(done, 0));
// Signs the current agreement as Alex, so buying is allowed (R5-3).
const sign = (store: Store) =>
  store.signAgreement({
    version: store.agreements().current,
    name: 'Alex Morgan',
    consents: ['read', 'act', 'keep'],
  });

type Figure = { key: string; text: string };
type Part = {
  id: string;
  label: string;
  tone: string;
  meaning: string;
  figure: Figure;
  value: number;
  href: string;
  tipTitle: string;
  tip: string;
  unit?: string;
};
type HeadLink = { figure: Figure; words: string; href: string; tipTitle: string; tip: string };
type Tile = {
  tourText: string;
  href: string;
  tipTitle: string;
  tip: string;
  parts: Part[];
  found: Figure;
  fresh: Figure;
  freshWords: string;
  freshHref: string;
  active: Figure;
  waiting: HeadLink | null;
  interview: { figure: Figure; href: string; tipTitle: string; tip: string } | null;
};
type Words2 = Array<{ text: string; key?: string; strong?: boolean; nowrap?: boolean }>;
type Foot = { href: string; tip: string; attention: boolean; words: Words2 } | null;
type Split = {
  caption: string;
  corner: string;
  heads: string[];
  rows: Array<{ id: string; label: string; deputy: Figure; you: Figure; youUnit: string }>;
} | null;
type RunsTile = {
  label: string;
  labelId: string;
  labelTip: string;
  usageHref: string;
  usageTip: string;
  off: string | null;
  actions: Array<{
    kind: string;
    text: string;
    href?: string;
    topup?: string;
    focus: string;
    tip: string;
  }>;
};
type Todo = {
  id: string;
  kind: string;
  title: Array<{ text: string; key?: string }>;
  due: Words2 | null;
  tip: string;
  action: string;
  href: string;
  topup: string | null;
};
type Tracked = {
  id: string;
  name: string;
  phase: string;
  pips: Array<{ id: string; state: string }>;
  stage: string;
  time: string;
  kept: Figure;
  href: string;
};
type Status = {
  live: Tracked[];
  last: {
    id: string;
    name: string;
    href: string;
    when: string;
    checked: Figure;
    fresh: boolean;
    tip: string;
  } | null;
  none: { href: string; text: string };
};
type Keywords = {
  role: string;
  roles: Array<{ id: string; label: string; chosen: boolean }>;
  heading: Words2;
  headingText: string;
  rows: Array<{
    id: string;
    keyword: string;
    figure: Figure;
    value: number;
    share: number;
    onResume: boolean;
    tone: string;
    href: string;
    tipTitle: string;
    tip: string;
  }>;
  fresh: Array<{ id: string; keyword: string; figure: Figure }>;
  href: string;
  top: { shown: number; total: Figure } | null;
  all: Array<{ id: string; label: string; count: number; tone: string; meta: string }>;
  freshMore: number;
  freshAll: Array<{ id: string; label: string; count: number }>;
  tourText: string;
};
// Prompts (round 7, D2): the 8 prompts' ids for the shared summary rows, and the last 30 days.
type Prompts = {
  href: string;
  window: { label: string; words: string };
  ids: string[];
  totals: Words2;
} | null;
// Gmail (round 7, D3: the daily scan and Scan now).
type Gmail = {
  connected: boolean;
  href: string;
  text?: string;
  schedule?: string;
  last?: Figure;
  ago?: string;
  lines?: Words2[];
  next?: Figure | null;
  emails?: Array<{
    id: string;
    from: string;
    kindLabel: string;
    short: string;
    outcome: string;
    read: string;
    readAt: string;
    earlier: boolean;
    subject: string;
    href: string;
  }>;
  emailsHead?: string;
  more?: Figure | null;
  scan?: {
    label: string;
    cost: string;
    available: boolean;
    reason: string;
    action?: { text: string; href: string } | null;
    runs: Figure;
    runsCount: number;
  } | null;
  bars?: Array<{
    id: string;
    label: string;
    short: string;
    metric: string;
    tip: string;
    parts: Array<{ series: string; value: number }>;
  }>;
} | null;
// Usage (round 7, D9).
type Usage = {
  range: string | { from: string; to: string };
  month: boolean;
  title: string;
  total: Figure | { text: string; key?: string };
  empty: string | null;
  chart: {
    step: string;
    groups: Array<{ id: string; label: string; other?: boolean; tokens?: number }>;
    buckets: unknown[];
    totals: { tokens: number };
  } | null;
  runs: Array<{
    id: string;
    label: string;
    value: number;
    figure: Figure | { text: string; key?: string };
    share: number;
  }>;
  runsTotal: number;
  settings: Array<{ id: string; kind: string; text: string }>;
  moreSettings: number;
  href: string;
} | null;
type Email = {
  on: boolean;
  label: string;
  cost: string;
  next: string;
  sampleHref: string;
  manageHref: string;
} | null;
type News = {
  unread: Figure | null;
  items: Array<{
    id: string;
    kind: string;
    kindLabel: string;
    title: string;
    text: string;
    date: string;
    href: string;
    go: { kind: string; label: string };
    read: boolean;
    tip: string;
  }>;
  shown: News['items'];
  more: boolean;
};
type First = {
  kind: string;
  title: string;
  line: string;
  action: string;
  href: string;
  status: string | null;
  neutral?: boolean;
  lineWords?: Array<{ text: string; key?: string }> | null;
  preview: string;
  tourTitle: string;
  tourText: string;
} | null;
type Tour = Record<string, { step: number; title: string; text: string }>;
type View = { role?: string; range?: string | { from: string; to: string } };
type Page = {
  PALETTE_WORDS: {
    tones: Record<string, string>;
    parts: Record<string, string>;
    left: Record<string, string>;
    series: string[];
  };
  CAPS: Record<string, number>;
  TOUR: Tour;
  ALL_ROLES: string;
  USAGE_RANGE: string;
  WEEK_PARTS: Array<{ id: string; label: string; tone: string }>;
  figure(store: Store, key: string): Figure;
  dateLine(store: Store): string;
  introFor(first: First, options?: { setupOpen?: number }): { title: string; line: string };
  wordsMarkup(parts: Array<{ text: string; key?: string }>): string;
  jobsTile(store: Store): Tile;
  jobsFoot(store: Store): Foot;
  appsTile(store: Store): Tile;
  autoSplit(store: Store): Split;
  runsTile(store: Store): RunsTile;
  todoItems(store: Store): Todo[];
  tileSearch(store: Store): Status;
  statusMode(status: Status): string;
  keywordCard(store: Store, role?: string): Keywords;
  promptsCard(store: Store): Prompts;
  gmailCard(store: Store): Gmail;
  usageCard(store: Store, range?: string | { from: string; to: string }): Usage;
  emailLine(store: Store): Email;
  newsCard(store: Store): News;
  firstRun(store: Store, options: { newAccount: boolean }): First;
  signinNote(method: string | null, email: string): string | null;
  regions(store: Store, view?: View): Record<string, string>;
  tourHosts(store: Store): Record<string, { name: string; text: string }>;
  jobsHeadMarkup(tile: Tile): string;
  jobsTileMarkup(tile: Tile): string;
  jobsFootMarkup(foot: Foot): string;
  appsHeadMarkup(tile: Tile): string;
  appsTileMarkup(tile: Tile): string;
  appsFootMarkup(tile: Tile): string;
  autoMarkup(split: Split): string;
  runsHeadMarkup(tile: RunsTile): string;
  runsFootMarkup(tile: RunsTile): string;
  searchMarkup(status: Status): string;
  todoMarkup(items: Todo[]): string;
  newsMarkup(card: News): string;
  promptsTotalsMarkup(card: Prompts): string;
  promptsListMarkup(card: Prompts): string;
  gmailMarkup(card: Gmail): string;
  usageTotalMarkup(card: Usage): string;
  usageRunsMarkup(card: Usage): string;
  usageSettingsMarkup(card: Usage): string;
  emailMarkup(line: Email): string;
  outcomesLine(
    store: Store,
  ): Array<{ id: string; href: string; tip: string; words: Words2 }> | null;
  outcomesMarkup(
    parts: Array<{ id: string; href: string; tip: string; words: Words2 }> | null,
  ): string;
  deputyWeek(store: Store): { words: Words2; href: string } | null;
  weekMarkup(week: { words: Words2; href: string } | null): string;
  keywordsTitleMarkup(card: Keywords): string;
  keywordRolesMarkup(card: Keywords): string;
  keywordsNewMarkup(card: Keywords): string;
  topLineMarkup(top: { shown: number; total: Figure } | null, noun: string, list: string): string;
  tourAttrs(name: string, text?: string): string;
};

// The code between `// <name>: start` and `// <name>: end` for each block, evaluated together with
// the named declarations returned. The blocks are pure (no DOM), so they run as they do in the page.
function blocks<T>(source: string, names: string[], exported: string[]): T {
  const code = names
    .map((name) => {
      const from = source.indexOf(`// ${name}: start`);
      const to = source.indexOf(`// ${name}: end`);
      expect(from, `${name} start marker`).toBeGreaterThan(-1);
      expect(to, `${name} end marker`).toBeGreaterThan(from);
      return source.slice(source.indexOf('\n', from) + 1, to);
    })
    .join('\n');
  return runInNewContext(`(() => {\n${code}\nreturn { ${exported.join(', ')} };\n})()`, {}) as T;
}

const page = blocks<Page>(
  home,
  ['DashboardModel', 'DashboardViews'],
  [
    'PALETTE_WORDS',
    'CAPS',
    'TOUR',
    'ALL_ROLES',
    'USAGE_RANGE',
    'WEEK_PARTS',
    'figure',
    'dateLine',
    'introFor',
    'wordsMarkup',
    'jobsTile',
    'jobsFoot',
    'appsTile',
    'autoSplit',
    'runsTile',
    'todoItems',
    'tileSearch',
    'statusMode',
    'keywordCard',
    'promptsCard',
    'gmailCard',
    'usageCard',
    'emailLine',
    'newsCard',
    'firstRun',
    'signinNote',
    'regions',
    'tourHosts',
    'jobsHeadMarkup',
    'jobsTileMarkup',
    'jobsFootMarkup',
    'appsHeadMarkup',
    'appsTileMarkup',
    'appsFootMarkup',
    'autoMarkup',
    'runsHeadMarkup',
    'runsFootMarkup',
    'searchMarkup',
    'todoMarkup',
    'newsMarkup',
    'promptsTotalsMarkup',
    'promptsListMarkup',
    'gmailMarkup',
    'usageTotalMarkup',
    'usageRunsMarkup',
    'usageSettingsMarkup',
    'emailMarkup',
    'outcomesLine',
    'outcomesMarkup',
    'deputyWeek',
    'weekMarkup',
    'keywordsTitleMarkup',
    'keywordRolesMarkup',
    'keywordsNewMarkup',
    'topLineMarkup',
    'tourAttrs',
  ],
);

// The figures a render shows (the table inside the closed "Show the numbers" carries none).
const figuresIn = (markup: string): Array<[string, string]> =>
  [...markup.matchAll(/\sdata-metric="([^"]+)"[^>]*>([^<]*)</g)].map((match) => [
    match[1] ?? '',
    (match[2] ?? '').replace(/&amp;/g, '&').trim(),
  ]);
const keysOf = (markup: string) => figuresIn(markup).map(([key]) => key);
// The figures the shared charts draw from the page's options: each Gmail day's total on top of
// its bar, with its data-metric, as JobDeputyComponents.stackedBars writes it (grouped digits).
// The shared rings, runway, and prompt summaries draw their own figures from the store (PL's
// tests hold them); the page keeps their keys off its own markup (below).
const chartFigures = (store: Store): Array<[string, string]> =>
  (page.gmailCard(store)?.bars ?? [])
    .filter((bar) => bar.metric)
    .map((bar): [string, string] => [
      bar.metric,
      bar.parts.reduce((sum, part) => sum + part.value, 0).toLocaleString('en-US'),
    ]);
const allFigures = (store: Store) => [
  ...figuresIn(Object.values(page.regions(store)).join('')),
  ...chartFigures(store),
];
const repeats = (keys: string[]) => keys.filter((key, index) => keys.indexOf(key) !== index);

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;| /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
// What a sighted person reads: the markup's text without its visually hidden words, with no space
// where a tag ended right before a comma or after a plus sign.
const shown = (html: string): string =>
  text(html.replace(/<span class="sr-only"[^>]*>[^<]*<\/span>/g, ''))
    .replace(/\s+([,.;:%])/g, '$1')
    .replace(/\s+(-\w)/g, '$1')
    .replace(/(^|\s)\+\s+(\d)/g, '$1+$2');
// Markup compared as structure and text: comments, whitespace between tags, self-closing SVG tags,
// and entity spellings do not count.
const markup = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<([a-z]+)\b([^>]*?)\s*\/>/g, '<$1$2></$1>')
    .replace(/&nbsp;| /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/\s+>/g, '>')
    .replace(/\s*(<[^>]*>)\s*/g, '$1')
    .trim();
// The inner markup of the element that opens with `<tag … id="id" …>`, by tag balance.
function inner(source: string, id: string): string {
  const open = source.search(new RegExp(`<([a-z0-9]+)\\b[^>]*\\sid="${id}"[^>]*>`));
  expect(open, `#${id} in the markup`).toBeGreaterThan(-1);
  const tag = source.slice(open + 1).match(/^[a-z0-9]+/)?.[0] ?? '';
  const start = source.indexOf('>', open) + 1;
  let depth = 1;
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  pattern.lastIndex = start;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return source.slice(start, match.index);
  }
  return '';
}
// The opening tag of the element with this id.
const openTag = (source: string, id: string): string =>
  source.match(new RegExp(`<[a-z0-9]+\\b[^>]*\\sid="${id}"[^>]*>`))?.[0] ?? '';
const main = home.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? '';
const script = home.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
const styles = home.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
// An attribute value as the views escape it.
const attrText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const words = (value: string): number =>
  value.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
const attrsOf = (tag: string): Record<string, string> =>
  Object.fromEntries(
    [...tag.matchAll(/\s([\w-]+)(?:="([^"]*)")?/g)].map((match) => [
      match[1] ?? '',
      (match[2] ?? '').replace(/&amp;/g, '&').replace(/&#39;/g, "'"),
    ]),
  );
const wordsOf = (parts: Words2 | undefined): string =>
  (parts ?? []).map((part) => part.text).join('');
// The ids of the cards in each row of the page, in order, with the row's class.
const rowsOf = (source: string): Array<[string, string[]]> =>
  [
    ...source.matchAll(
      /<div class="dash-row([^"]*)">([\s\S]*?)(?=<div class="dash-row|<figure class="task-surface chart dash-ai"|<p class="sample-note">)/g,
    ),
  ].map((match) => [
    (match[1] ?? '').trim(),
    [
      ...(match[2] ?? '').matchAll(
        /<(?:section|figure|div) class="task-surface[^"]*" id="([^"]+)"/g,
      ),
    ].map((part) => part[1] ?? ''),
  ]);

describe('one sample world: every figure from the store, each once (R3-3, R3-4)', () => {
  it('shows every figure as JobDeputyStore.metricText(key), on its own element', () => {
    const { store } = load();
    const figures = allFigures(store);
    expect(figures.length).toBeGreaterThanOrEqual(60);
    for (const [key, value] of figures) {
      expect(value, key).toBe(store.metricText(key));
      expect(value, `${key} is shown`).not.toBe('');
    }
  });

  it('shows each figure once, so no key repeats on the page', () => {
    const { store } = load();
    const keys = allFigures(store).map(([key]) => key);
    expect(repeats(keys)).toEqual([]);
    // The static page, too: the first paint carries each key once, and the shared stacked bars
    // add Gmail's days when the script draws them.
    const shipped = keysOf(main);
    expect(repeats(shipped)).toEqual([]);
    const drawn = chartFigures(store).map(([key]) => key);
    expect([...shipped, ...drawn].sort()).toEqual([...keys].sort());
    // The shared rings and runway (Runs and tokens) and the prompt summaries carry their own
    // figures, so the page's own markup carries none of their keys (each once, R3-4).
    const own = new Set(keys);
    for (const key of [
      'runs.left',
      'runs.all',
      'runs.used',
      'runs.free',
      'runs.bought',
      'runs.lastsThrough',
      'runs.perDay',
      'tokens.left',
      'tokens.limit',
      'tokens.perDay',
      'tokens.lastsThrough',
      'ai.limit.left',
      'ai.limit.tokens',
      'ai.credits.left',
      ...['read', 'rank', 'tailor', 'letter', 'answer', 'check', 'mail', 'reply'].flatMap((id) => [
        `prompts.${id}.agreement`,
        `prompts.${id}.tokens.month`,
      ]),
    ]) {
      expect(own.has(key), key).toBe(false);
    }
  });

  it('shows the seed’s canonical numbers', () => {
    const { store } = load();
    expect(Object.fromEntries(allFigures(store))).toEqual({
      // Job matches: found, the fit split, and the review queue (J2: To review is jobs.new's
      // figure under the queue's name).
      'jobs.found': '27',
      'jobs.toReview': '20',
      // Where the rest went, at the foot (T1-21): with To review they add up to found.
      'jobs.tracked': '5',
      'jobs.notForMe': '2',
      'jobs.fit.strong': '4',
      'jobs.fit.good': '9',
      'jobs.fit.stretch': '14',
      'runs.r11.kept': '0',
      'watch.nightly.nextRunAt': 'Sat, Oct 3, 02:00',
      // Applications: active by stage, what needs you (the nav badge's number, T6-13), and who
      // did each step (D5).
      'apps.active': '7',
      'apps.stage.shortlisted': '2',
      'apps.stage.tailoring': '1',
      'apps.stage.approval': '1',
      'apps.stage.applied': '2',
      'apps.stage.interviewing': '1',
      'apps.nextInterview': 'Tue, Oct 6, 10:00',
      'apps.needYou': '3',
      'apps.auto.tailored': '5',
      'apps.auto.edited': '1',
      'apps.auto.approvedAuto': '0',
      'apps.auto.approvedByYou': '4',
      'apps.auto.appliedAuto': '1',
      'apps.auto.appliedByYou': '3',
      // D11 (the orchestrator's yes): replies and interviews at the foot of Applications.
      'apps.outcome.applied': '4',
      'apps.outcome.replied': '3',
      'apps.outcome.replyRate': '75%',
      'apps.outcome.interviews': '1',
      // D11: your deputy's week under the intro's email switch (the last 7 days).
      'activity.week.deputy.rolesRead': '138',
      // The roles that fit, found in the same 7 days (T5-4).
      'activity.week.deputy.found': '18',
      'activity.week.deputy.tailored': '3',
      'activity.week.deputy.applied': '1',
      'activity.week.deputy.emailsRead': '10',
      'activity.week.you.approved': '1',
      'activity.week.you.edited': '1',
      // To-do and What's new (D4, unchanged).
      'todo.count': '6',
      'agreement.pauseAt': 'Thu, Oct 15',
      'profile.missingRequired': '2',
      'updates.unread': '6',
      // Prompts (D2): the last 30 days of tests over every prompt.
      'prompts.tests.last30': '13',
      'prompts.tests.passedLast30': '10',
      'prompts.tests.failedLast30': '3',
      'prompts.canaries': '2',
      // Gmail (D3): the daily scan at 07:00, what it did, the next one, and the runs it used.
      'gmail.sync.lastTime': '07:00',
      'gmail.scan.nextAt': 'Sat, Oct 3, 07:00',
      // What the last scan's emails did, in parts that add up to what it read (T5-12): none
      // moved, so moved is left out.
      'gmail.scan.read': '6',
      'gmail.scan.waiting': '2',
      'gmail.scan.needsReply': '2',
      'gmail.scan.interviews': '2',
      'gmail.scan.nothing': '2',
      'gmail.runs.month': '2',
      'gmail.latest.more': '7',
      // Its week, a bar a day (the shared stacked bars).
      'gmail.day.2026-09-26.read': '0',
      'gmail.day.2026-09-27.read': '0',
      'gmail.day.2026-09-28.read': '0',
      'gmail.day.2026-09-29.read': '2',
      'gmail.day.2026-09-30.read': '0',
      'gmail.day.2026-10-01.read': '2',
      'gmail.day.2026-10-02.read': '6',
      // Usage (D9) on its default, Last 30 days (T6-6): the range's tokens with their key; what
      // used the runs is a query for that range (keys exist for This month only).
      'usage.30d.tokens': '337,418',
      // Keywords for all your roles: its heading's count (as Résumés, T5-20), "Top 6 of 43
      // keywords" (round 6, G9), the top six, and this week's new ones.
      'keywords.role.all.found': '27',
      'keywords.total': '43',
      'keyword.distributed-systems': '18',
      'keyword.go': '12',
      'keyword.kubernetes': '10',
      'keyword.java': '9',
      'keyword.technical-strategy': '8',
      'keyword.reliability': '7',
      'keyword.csharp': '3',
      'keyword.developer-platforms': '3',
      'keyword.automation': '2',
      'keyword.cplusplus': '2',
      'keyword.information-retrieval': '2',
      'keyword.real-time-collaboration': '2',
    });
  });

  it('keeps the facts other screens show in detail, and the retired figures, off the page (R10-2)', () => {
    const { store } = load();
    const keys = new Set(allFigures(store).map(([key]) => key));
    for (const key of [
      // D7: Matches by source, Roles found per search, and Latest matches moved to Searches and
      // Job matches, so their figures are theirs.
      'jobs.source.google',
      'jobs.source.microsoft',
      'jobs.source.stripe',
      'jobs.source.workday',
      'jobs.source.amazon',
      'jobs.source.other',
      'jobs.sources',
      'runs.r2.kept',
      'runs.r8.kept',
      'runs.r9.kept',
      // D9: Usage replaced AI in October's task bars and model key (the Usage page has them).
      'ai.tokens.task.search',
      'ai.tokens.task.tailor',
      'ai.tokens.task.letter',
      'ai.tokens.model.gpt-5-mini',
      'ai.tokens.model.ministral-3-14b',
      // Gmail's week totals are its day bars now; the hourly sync's read is the scan's.
      'gmail.week.read',
      'gmail.week.waiting',
      'gmail.week.needsReply',
      'gmail.week.moved',
      'gmail.week.updated',
      'gmail.sync.read',
      'gmail.sync.nextTime',
      // D2: the pass rate and rollbacks are the Prompts page's (the brief's four counts here).
      'prompts.tests.passRateLast30',
      'prompts.rollbacksLast30',
      'prompts.untested',
      // AI runs are retired (G3, G4).
      'ai.platform.leftMonth',
      'ai.platform.usedMonth',
      'ai.bonus',
      'ai.runs.month',
      // The same figure under another name: one per page.
      'jobs.new',
      'apps.fromMatches',
      'jobs.dismissed',
      'apps.auto.waiting',
      'apps.auto.appliedNowAuto',
      'apps.auto.appliedNowByYou',
      'apps.interviews',
      'agreement.daysLeft',
      // While the search runs, its tile shows the new roles so far; checked comes with the finish.
      'runs.r11.checked',
    ]) {
      expect(keys.has(key), key).toBe(false);
    }
    // No price on the Dashboard (money only where money is the point, R5-2).
    expect(text(main)).not.toMatch(/\$\d/);
    // A keyword's count of roles found this week stays in its tooltip.
    expect([...keys].filter((key) => key.endsWith('.recent'))).toEqual([]);
  });

  it('ships the seed’s render, so the first paint already matches the store', () => {
    const { store } = load();
    for (const [id, rendered] of Object.entries(page.regions(store))) {
      expect(markup(inner(home, id)), `#${id}`).toBe(markup(rendered));
    }
    expect(text(inner(home, 'dash-date'))).toBe('Friday, October 2');
    expect(text(inner(home, 'home-title'))).toBe('Welcome back, Alex.');
    expect(text(inner(home, 'dash-intro'))).toBe('Your search today.');
    // Every tour step ships its place and its words (round 6, R6-2), as the views give them.
    for (const [id, step] of Object.entries(page.tourHosts(store))) {
      expect(openTag(home, id), `#${id}`).toContain(page.tourAttrs(step.name, step.text));
    }
    // render() keeps every step's place and words (some follow the store).
    expect(script).toContain('for (const [id, step] of Object.entries(tourHosts(store))) {');
    // The hosts the shared components draw ship empty, held by the shared skeleton at their
    // final size until the first render is done (R10-1): the rings, the runway, Gmail's week,
    // and the usage chart. The prompt summaries ship as their hosts, one a prompt.
    for (const id of ['runs-rings', 'runs-runway', 'gmail-days', 'usage-chart']) {
      expect(inner(home, id), id).toBe('');
      expect(openTag(home, id), id).toMatch(/data-skeleton="(?:block|lines|chart)"/);
    }
    expect(markup(inner(home, 'prompts-list'))).toBe(
      markup(page.promptsListMarkup(page.promptsCard(store))),
    );
    expect(openTag(home, 'prompts-list')).toBe(
      '<ul class="prompt-summary-list" id="prompts-list" data-prompt-summaries aria-labelledby="prompts-title">',
    );
    // Your runs and tokens is one tour step for both rings and the runway, naming their colours.
    expect(openTag(home, 'tile-runs')).toContain(
      `data-tour-text="${attrText('Each search, scan, and daily email uses a run; my AI uses tokens: indigo runs left, teal tokens left, hatched grey used. I say how long they last.')}"`,
    );
  });

  it('moves every figure together when the live Amazon run finishes, 27 to 29', async () => {
    const { store, clock } = load();
    const heard: Array<Record<string, unknown>> = [];
    store.subscribe((_state, change) => heard.push(change));
    const before = Object.fromEntries(allFigures(store));
    // Partway: the tile's tracker steps on and counts up, and nothing else moves.
    seconds(clock, 50);
    const matching = page.tileSearch(store).live[0];
    expect(matching).toMatchObject({
      phase: 'live',
      stage: 'Stage 3 of 4: Matching your roles',
      time: 'Running for 1 min 10 s',
    });
    expect(matching?.pips.map((pip) => pip.state)).toEqual(['done', 'done', 'current', 'next']);
    // Done: the first read commits it; the page hears it once with the two new roles.
    seconds(clock, 60);
    const after = Object.fromEntries(allFigures(store));
    await flush();
    const done = heard.filter((change) => change.type === 'run' && change.stage === 'complete');
    expect(done).toHaveLength(1);
    expect(done[0]?.jobIds).toEqual(['amazon-search-relevance', 'amazon-sdm-ads']);
    expect([before['jobs.found'], after['jobs.found']]).toEqual(['27', '29']);
    expect([before['jobs.toReview'], after['jobs.toReview']]).toEqual(['20', '22']);
    expect([after['jobs.fit.strong'], after['jobs.fit.good'], after['jobs.fit.stretch']]).toEqual([
      '5',
      '10',
      '14',
    ]);
    // The tracker's count leaves with the tracker (its roles wait in Job matches).
    expect([before['runs.r11.kept'], after['runs.r11.kept']]).toEqual(['0', undefined]);
    // The search's AI work joins the last 30 days' tokens (Usage's default range).
    expect([before['usage.30d.tokens'], after['usage.30d.tokens']]).toEqual(['337,418', '351,088']);
    expect(after['keyword.distributed-systems']).toBe('20');
    // The tile's middle turns into one line about the last search: when it started and what it
    // checked; its new roles wait in Job matches.
    const status = page.tileSearch(store);
    expect(status.live).toEqual([]);
    expect(page.statusMode(status)).toBe('idle:r11');
    expect(shown(page.searchMarkup(status))).toBe(
      // It gives the moment it started, as Searches does for the same run ("Latest search · Fri,
      // Oct 2, 13:59"; UAT-M, M-17 and its retest), not when it finished (14:01).
      'Last search: Amazon Jobs, today at 13:59 · 44 checked',
    );
    expect(after['runs.r11.checked']).toBe('44');
    // The donut still adds up to its total.
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
    expect(sum(page.jobsTile(store).parts.map((part) => part.value))).toBe(29);
    expect(repeats(allFigures(store).map(([key]) => key))).toEqual([]);
  });

  it('shows each figure once in every AI, Keep watch, agreement, Gmail, and What’s new state', () => {
    const { store } = load();
    const states: Array<[string, () => unknown]> = [
      ['near', () => store.setAiLimit({ tokens: 60000, onReach: 'pause' })],
      ['near, platform', () => store.setAiLimit({ tokens: 60000, onReach: 'platform' })],
      ['reached', () => store.setAiLimit({ tokens: 40000, onReach: 'pause' })],
      ['reached, platform', () => store.setAiLimit({ tokens: 40000, onReach: 'platform' })],
      ['a week', () => store.setAiLimit({ tokens: 100000, period: 'week', onReach: 'pause' })],
      ['a day, reached', () => store.setAiLimit({ tokens: 10000, period: 'day' })],
      ['no limit', () => store.setAiLimit({ tokens: null })],
      ['platform credits', () => store.setAiChoice('platform')],
      ['DeepSeek V3.2', () => store.setPlatformModel('deepseek-v3-2')],
      ['paused by the agreement', () => store.setAgreementDemo('overdue')],
      ['signed', () => sign(store).ok],
      ['credits bought', () => store.buy('credits-5').ok],
      ['nightly runs bought', () => store.buy('nightly-30').ok],
      ['keyword filtering', () => store.setAiChoice('none')],
      ['one update read', () => store.markUpdateRead('bundle-offer')],
      ['your key again', () => store.setAiChoice('openai')],
      ['a Gmail scan', () => (store as unknown as { gmailScan(): Result }).gmailScan().ok],
    ];
    for (const [name, change] of states) {
      expect(change(), name).toBeTruthy();
      const figures = allFigures(store);
      expect(repeats(figures.map(([key]) => key)), name).toEqual([]);
      for (const [key, value] of figures)
        expect(value, `${name}: ${key}`).toBe(store.metricText(key));
    }
  });

  it('says a finish once: through the tracker, or the page when no tracker showed it', () => {
    expect(script).toContain("if (change?.type === 'run' && change.stage === 'complete') {");
    expect(script).toContain(
      'const count = Array.isArray(change.jobIds) ? change.jobIds.length : 0;',
    );
    expect(script).toContain('if (!heardFinish.has(change.runId)) {');
    expect(script).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected text is page source with a template literal
      "announce(`${name} finished: ${count} new ${plural(count, 'role')}.`);",
    );
    expect(script).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected text is page source with a template literal
      "deputy?.react?.('found', { speech: `${count} new ${plural(count, 'role')} for you.` });",
    );
    expect(words('2 new roles for you.')).toBeLessThanOrEqual(6);
    // The live parts follow the store's ticks; everything follows every change.
    expect(script).toContain('store?.onTick(() => renderLive());');
    expect(script).toMatch(/store\?\.subscribe\(\(_state, change\) => \{\s*const searching/);
    // Another tab's change (the sample or the AI setting) is said once.
    expect(script).toContain(
      "} else if (change?.type === 'external' || change?.type === 'reset' || change?.external) {",
    );
    expect(script).not.toContain("window.addEventListener('storage'");
  });
});

describe('At a glance: three tiles of one design, dense and level (round 7, D1, D5, D10)', () => {
  const { store } = load();

  it('leads with Job matches, Applications, and Runs and tokens, each a head, a visual, a middle, and a foot', () => {
    const top = inner(home, 'dash-top');
    const items = [
      ...top.matchAll(
        /<li class="([^"]+)">\s*(?:<!--[\s\S]*?-->\s*)?<div class="([^"]+)" id="([^"]+)"/g,
      ),
    ].map((match) => [match[1], match[2], match[3]]);
    expect(items).toEqual([
      ['dash-tile', 'kpi kpi-split dash-card dash-jobs', 'jobs-card'],
      ['dash-tile', 'kpi kpi-split dash-card dash-apps', 'apps-card'],
      ['dash-tile dash-tile-runs', 'kpi dash-card dash-runs-tile', 'tile-runs'],
    ]);
    // The same four parts in the same order in every tile (D1): the head, the visual, the
    // middle under a rule, the foot under a rule.
    const parts = (id: string) =>
      [...inner(home, id).matchAll(/^\s*<(?:div|p) class="([^"]+)" id="([^"]+)"/gm)].map(
        (match) => [(match[1] ?? '').split(' ')[0], match[2]],
      );
    expect(parts('jobs-card')).toEqual([
      ['dash-tile-head', 'jobs-head'],
      ['dash-tile-visual', 'tile-jobs'],
      ['dash-search', 'tile-search'],
      ['dash-tile-foot', 'jobs-foot'],
    ]);
    expect(parts('apps-card')).toEqual([
      ['dash-tile-head', 'apps-head'],
      ['dash-tile-visual', 'tile-apps'],
      ['dash-auto', 'apps-auto'],
      ['dash-tile-foot', 'apps-foot'],
    ]);
    expect(parts('tile-runs')).toEqual([
      ['dash-tile-head', 'runs-head'],
      ['dash-tile-visual', 'runs-rings'],
      ['dash-runway', 'runs-runway'],
      ['dash-tile-foot', 'runs-foot'],
    ]);
    expect(shown(inner(home, 'jobs-head'))).toBe('Job matches 20 to review');
    expect(shown(inner(home, 'apps-head'))).toBe('Applications 3 need you');
    expect(shown(inner(home, 'runs-head'))).toBe('Runs and tokens Usage');
    expect(shown(inner(home, 'tile-jobs'))).toMatch(/^27 found/);
    expect(shown(inner(home, 'tile-apps'))).toMatch(/^7 active/);
    // R9-11: the tiles end at their own heights (top aligned, never stretched); the content is
    // designed to end level: a 132px visual (the ring and three rows of 44px key) in each.
    expect(styles).toMatch(
      /\.dash-top \{\s*grid-template-columns: minmax\(0, 1fr\);\s*align-items: start;/,
    );
    expect(styles).toMatch(
      /\.dash-card \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);\s*gap: 13px;\s*align-content: start;\s*align-items: start;/,
    );
    expect(styles).toMatch(/\.dash-rings \{\s*--skeleton-min: 190px;\s*min-height: 132px;/);
    // The two shared rings side by side, each key in one line where it fits.
    expect(styles).toMatch(
      /\.dash-rings > \.allowance-rings \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(styles).toMatch(
      /\.dash-search,\s*\.dash-auto,\s*\.dash-runway,\s*\.dash-tile-foot \{[^}]*padding-top: 13px;\s*border-top: 1px solid var\(--line\);/,
    );
    // Three tiles a row from 1150px of room; two, then Runs and tokens across, from 600px.
    expect(styles).toMatch(
      /@container dash \(width >= 1150px\) \{\s*\.dash-top \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
    );
    expect(styles).toMatch(
      /@container dash \(width >= 600px\) \{\s*\.dash-top \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);\s*\}\s*\.dash-top > \.dash-tile-runs \{\s*grid-column: 1 \/ -1;/,
    );
    // No stretching rule anywhere in the band.
    expect(styles).not.toMatch(/\.dash-(?:top|card|tile)[^{]*\{[^}]*align-self: stretch/);
  });

  it('draws Job matches as a donut of the fit split, the roles to review in its head, Keep watch at its foot', () => {
    const tile = page.jobsTile(store);
    // J2: To review is Job matches' default view, so its link is the plain address (SJ).
    expect([tile.href, tile.freshHref]).toEqual([
      './jobs-preview.html?view=all',
      './jobs-preview.html',
    ]);
    expect(tile.parts.map((part) => [part.label, part.figure.text, part.tone, part.href])).toEqual([
      ['Strong fit', '4', 'green', './jobs-preview.html?view=all&fit=strong'],
      ['Good fit', '9', 'blue', './jobs-preview.html?view=all&fit=good'],
      ['Stretch', '14', 'quiet', './jobs-preview.html?view=all&fit=stretch'],
    ]);
    expect(tile.tipTitle).toBe('27 roles found');
    expect(tile.tip).toContain('20 to review, 5 in Applications, and 2 not for me');
    // J2: the queue's count, To review (the store's jobs.toReview, the same figure as jobs.new).
    expect(tile.fresh).toEqual({ key: 'jobs.toReview', text: '20' });
    const visual = page.jobsTileMarkup(tile);
    expect(visual).not.toContain('stack-bar');
    expect(visual).not.toContain('kpi-label');
    expect(markup(visual)).toContain(
      `<div class="donut is-tile"${page.tourAttrs('found', tile.tourText)}><div class="donut-ring"><a class="donut-total" href="./jobs-preview.html?view=all"`,
    );
    expect(visual).toContain(
      '<span class="donut-total-value" data-metric="jobs.found">27</span> <span class="donut-total-label">found</span><span class="sr-only">. Open Job matches, all roles</span></a>',
    );
    expect(visual).toContain(
      '<ul class="chart-key is-compact is-inline" aria-label="Fit of the 27 roles found"',
    );
    expect(page.jobsHeadMarkup(tile)).toBe(
      '<p class="kpi-label">Job matches</p> <a class="chart-action dash-tile-link" href="./jobs-preview.html" data-tip-title="20 to review" data-tip="Roles you have not added to Applications or set aside yet. Opens them in Job matches." data-focus-key="jobs-new"><span><span data-metric="jobs.toReview">20</span> to review</span></a>',
    );
    // The foot: Keep watch's next check, a link to Keep watch on Searches (its home).
    const foot = page.jobsFoot(store);
    expect(foot).toMatchObject({ href: './searches-preview.html#keep-watch', attention: false });
    expect(page.jobsFootMarkup(foot)).toBe(
      '<a class="kpi-split-line" href="./searches-preview.html#keep-watch" data-tip-title="Keep watch" data-tip="The sources Keep watch checks each night, and when. Opens Keep watch in Searches." data-focus-key="jobs-watch">Next Keep watch check <span data-metric="watch.nightly.nextRunAt">Sat, Oct 3, 02:00</span></a>',
    );
    // Under it, where the found roles went, as Applications' foot gives its outcomes: with To
    // review in the head they add up to the found roles (27 = 20 + 5 + 2).
    const footHtml = page.regions(store)['jobs-foot'] ?? '';
    expect(text(footHtml)).toBe(
      'Next Keep watch check Sat, Oct 3, 02:00 5 added to Applications · 2 not for me',
    );
    expect(footHtml).toContain(
      '<a class="dash-outcome" href="./jobs-preview.html?view=not-for-me" data-tip-title="2 not for me" data-tip="The roles you set aside. Opens Not for me in Job matches, where you can restore them." data-focus-key="outcome-not-for-me">',
    );
  });

  it('ends the tiles of a row level (T1-21, D1): the same visual, middle, and two-line foot', () => {
    // Both keys are 140px (three 44px rows 4px apart), and no stage spans both columns, so each
    // count stays beside its name (T7-R4).
    // Each column is as wide as its words, so every name keeps its gap before its count ("Shortlisted
    // 10" at 1440, large; T4-20 at 710 to 720px): where the ring and two columns don't fit
    // (323px), the key goes under the ring.
    expect(styles).toMatch(
      /\.dash-apps \.donut\.is-tile > \.chart-key \{\s*display: grid;\s*grid-template-columns: repeat\(2, max-content\);\s*align-content: start;\s*gap: 4px 0;/,
    );
    expect(styles).toMatch(
      /@container dash-apps \(width < 323px\) \{\s*\.dash-apps \.donut\.is-tile \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(styles).not.toMatch(/\.chart-key > li:last-child:nth-child\(odd\)/);
    // The search status keeps the room of Applications' four-row table where the two share a row
    // (and a search starting or ending never moves the foot).
    expect(styles).toMatch(
      /@container dash \(width >= 600px\) \{\s*\.dash-search \{\s*min-height: 101px;/,
    );
    // Usage's Show the numbers, open, takes the card's whole width (T7-R1, R9-11).
    expect(styles).toMatch(
      /\.dash-usage-split:has\(\.usage-chart-data\[open\]\) \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    // Each foot's second line (outcomes, where the roles went) is a line of its own at every
    // width.
    expect(styles).toMatch(/\.dash-outcomes \{\s*display: inline-flex;\s*flex-basis: 100%;/);
    const regions = page.regions(load().store);
    for (const id of ['jobs-foot', 'apps-foot']) {
      expect(regions[id]?.match(/<span class="dash-outcomes">/g), id).toHaveLength(1);
    }
  });

  it('says Keep watch skips its check when too few runs are left, in the store’s words (UAT-RM, RM-7)', () => {
    // Uses runs from the month's ledger, as searches do, so the store counts them.
    const spend = (count: number) => {
      const { store: short } = load();
      short.update({ type: 'world' }, (next) => {
        const world = next.world as { used: unknown[] };
        for (let index = 0; index < count; index += 1) {
          world.used.push({
            runId: `x${index}`,
            sourceId: 'google',
            at: '2026-10-02T10:00:00-07:00',
            via: 'you',
          });
        }
      });
      return short;
    };
    const runsOf = (one: Store) =>
      (
        one as unknown as {
          allowance(): { runs: { left: number; nextCheck: { text: string; willSkip: string[] } } };
        }
      ).allowance().runs;
    // One run left for two watched sources: Keep watch checks one of them, in the store's words.
    const left = runsOf(store).left;
    const one = spend(left - 1);
    expect(runsOf(one).left).toBe(1);
    expect(runsOf(one).nextCheck.willSkip).toHaveLength(1);
    const foot = page.jobsFoot(one);
    expect(foot?.attention).toBe(true);
    expect(wordsOf(foot?.words)).toBe(runsOf(one).nextCheck.text);
    expect(wordsOf(foot?.words)).toBe(
      'Keep watch checks 1 of 2 sources at 02:00: no runs are left for the rest',
    );
    expect(page.jobsFootMarkup(foot)).toContain('class="kpi-split-line is-attention"');
    // None left: Keep watch skips tonight, as Searches says; no date of a check that won't happen.
    const none = spend(left);
    expect(wordsOf(page.jobsFoot(none)?.words)).toBe(
      'Keep watch skips tonight’s check: no runs are left',
    );
    expect(styles).toMatch(/\.kpi-split-line\.is-attention \{\s*color: var\(--danger-ink\);/);
  });

  it('shows the live search in the Job matches tile with the shared compact tracker (D2, W15)', () => {
    const { store: live, clock } = load();
    const status = page.tileSearch(live);
    expect(status.live).toHaveLength(1);
    // A fresh visit finds the Amazon search already going (A1: it started 20 seconds before).
    expect(status.live[0]).toMatchObject({
      id: 'r11',
      name: 'Amazon Jobs',
      phase: 'live',
      stage: 'Stage 1 of 4: Fetching pages',
      time: 'Running for 20 s',
      kept: { key: 'runs.r11.kept', text: '0' },
      // Searches lands on the run the link names (round 6, D1; B2 owns the landing).
      href: './searches-preview.html?source=amazon&run=r11&live=1',
    });
    expect(page.statusMode(status)).toBe('live:r11');
    // The first paint is the gallery's compact row: the source, the stage of four after its
    // pips, the time counting up, the new roles so far, and Watch live; never a bar or time left.
    const body = inner(home, 'tile-search');
    expect(markup(body)).toBe(
      markup(
        '<div class="run-tracker is-compact" data-state="live" data-run="r11"><p class="run-tracker-source" data-run-source>Amazon Jobs</p><p class="run-tracker-stage"><span class="run-tracker-pips" aria-hidden="true"><span class="run-tracker-pip is-current" data-stage="fetching"></span><span class="run-tracker-pip" data-stage="reading"></span><span class="run-tracker-pip" data-stage="matching"></span><span class="run-tracker-pip" data-stage="saving"></span></span><span data-run-stage>Stage 1 of 4: Fetching pages</span></p><p class="run-tracker-time" data-run-time>Running for 20 s</p><p class="run-tracker-new"><span data-run-count="kept" data-metric="runs.r11.kept">0</span><span data-run-new-words> new so far</span></p><a class="chart-action run-tracker-watch" data-run-watch href="./searches-preview.html?source=amazon&amp;run=r11&amp;live=1" data-focus-key="watch-r11">Watch live</a></div>',
      ),
    );
    expect(body).not.toMatch(/run-tracker-bar|progress/);
    expect(text(body)).not.toMatch(/\bleft\b|remaining/i);
    // The status part names itself for screen readers and the tour.
    expect(openTag(home, 'tile-search')).toContain('role="group" aria-label="Your latest search"');
    // Two searches at once: a compact row each.
    seconds(clock, 30);
    expect(live.startRun('stripe', { via: 'again' }).ok).toBe(true);
    const both = page.tileSearch(live);
    expect(page.statusMode(both)).toBe(`live:${both.live.map((run) => run.id).join(',')}`);
    // In the store's order (the newest first): the queued one has no stage yet.
    expect(both.live.map((run) => run.name)).toEqual(['Stripe Jobs', 'Amazon Jobs']);
    expect(both.live[0]).toMatchObject({ phase: 'queued', stage: '' });
    expect(both.live[0]?.time).toMatch(/^Queued for \d+ s$/);
    expect([...page.searchMarkup(both).matchAll(/class="run-tracker is-compact"/g)]).toHaveLength(
      2,
    );
    expect(styles).toMatch(
      /\.dash-search > \.run-tracker \+ \.run-tracker \{\s*padding-top: 13px;\s*border-top: 1px solid var\(--line\);/,
    );
  });

  it('turns into one line about the last search, which opens it in Searches (V4)', async () => {
    const { store: idle, clock } = load();
    seconds(clock, 110);
    idle.metric('jobs.found');
    await flush();
    const status = page.tileSearch(idle);
    expect(status.last).toMatchObject({
      id: 'r11',
      name: 'Amazon Jobs',
      href: './searches-preview.html?source=amazon&run=r11',
      when: 'today at 13:59',
      checked: { key: 'runs.r11.checked', text: '44' },
      fresh: true,
      // R10-2: the new roles wait in Job matches (no Latest matches or bar on the Dashboard).
      tip: 'Its new roles are in Job matches. Opens Amazon Jobs in Searches.',
    });
    const line = page.searchMarkup(status);
    expect(line).toContain(
      '<a class="kpi-split-line dash-search-line" href="./searches-preview.html?source=amazon&amp;run=r11" data-tip-title="Last search"',
    );
    expect(line).not.toContain('run-tracker');
    expect(line).not.toContain('Keep watch');
    // A search that kept nothing says so in words.
    const quiet = page.searchMarkup({
      ...status,
      last: status.last ? { ...status.last, fresh: false } : null,
    });
    expect(shown(quiet)).toBe(
      'Last search: Amazon Jobs, today at 13:59 · 44 checked · no new roles',
    );
    expect(shown(page.searchMarkup({ ...status, last: null }))).toBe('No search has run yet');
  });

  it('hands each compact row to the shared tracker, and stops it before taking it away', () => {
    expect(script).toContain("components.runTracker(element, element.getAttribute('data-run'), {");
    expect(script).toMatch(/channel: announcement,\s*compact: true,/);
    expect(script).toMatch(
      /const stopTrackers = \(\) => \{\s*for \(const tracker of trackers\) \{\s*const shown = tracker\.render\?\.\(\);/,
    );
    expect(script).toContain(
      "if (shown?.phase === 'complete' || shown?.phase === 'stopped') heardFinish.add(shown.id);",
    );
    // The page draws the rows again only when the searches change.
    expect(script).toMatch(/if \(key !== statusKey\) \{\s*stopTrackers\(\);/);
    // The ticking time is never a live region.
    expect(inner(home, 'tile-search')).not.toMatch(/role="status"|aria-live/);
  });

  it('draws Applications as a donut of the stages, the roles waiting for you in its head, the next interview at its foot', () => {
    const tile = page.appsTile(store);
    expect(tile.href).toBe('./applications-preview.html');
    expect(tile.parts.map((part) => [part.label, part.figure.text, part.tone, part.href])).toEqual([
      ['Shortlisted', '2', 'quiet', './applications-preview.html?stage=shortlisted'],
      ['Tailoring', '1', 'ink', './applications-preview.html?stage=tailoring'],
      ['Approval', '1', 'orange', './applications-preview.html?stage=approval'],
      ['Applied', '2', 'blue', './applications-preview.html?stage=applied'],
      ['Interviewing', '1', 'green', './applications-preview.html?stage=interviewing'],
    ]);
    expect(tile.interview).toMatchObject({
      figure: { key: 'apps.nextInterview', text: 'Tue, Oct 6, 10:00' },
      href: './applications-preview.html?open=northwind-backend',
      tipTitle: 'Next interview · Northwind Labs',
    });
    expect(tile.tip).toContain('1 closed role is not counted');
    const visual = page.appsTileMarkup(tile);
    expect(visual).toContain(
      '<span class="donut-total-value" data-metric="apps.active">7</span> <span class="donut-total-label">active</span>',
    );
    expect(visual).not.toContain('>Interview <');
    expect(page.appsFootMarkup(tile)).toMatch(
      /^<a class="kpi-split-line" href="\.\/applications-preview\.html\?open=northwind-backend"[^>]*>Interview <span data-metric="apps.nextInterview">Tue, Oct 6, 10:00<\/span><\/a>$/,
    );
    // T6-13: one needs-you number, the nav badge's (apps.needYou: approvals, answers, checks),
    // linking to the board filtered to them; approvals stay in the So far table.
    expect(tile.waiting).toMatchObject({
      figure: { key: 'apps.needYou', text: '3' },
      words: 'need you',
      href: './applications-preview.html?show=need',
    });
    expect(page.appsHeadMarkup(tile)).toContain(
      '<a class="chart-action dash-tile-link" href="./applications-preview.html?show=need" data-tip-title="Need you"',
    );
    // With nothing waiting, the head says so in words (R9-4), no link and no zero.
    expect(page.appsHeadMarkup({ ...tile, waiting: null })).toBe(
      '<p class="kpi-label">Applications</p> <span class="dash-tile-note">Nothing waits for you</span>',
    );
    // Five stages in two columns beside the ring, so the key is as tall as Job matches' three;
    // the columns are as wide as their words (T1-21, T4-20), the tile giving them room or the
    // key going under the ring, and on touch screens, where each item shows its meaning, they
    // take the tile's width under the ring in two even columns and never widen it (T2-1, T4-1).
    expect(styles).toMatch(
      /@media \(hover: none\), \(pointer: coarse\) \{\s*\.dash-apps \.donut\.is-tile \{\s*grid-template-columns: minmax\(0, 1fr\);[^}]*\}\s*\.dash-apps \.donut\.is-tile > \.chart-key \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(styles).toMatch(
      /\.dash-jobs \.donut\.is-tile > \.chart-key \{\s*flex-direction: column;/,
    );
  });

  it('says who did each step: tailored, approved, and applied, by your deputy or by you (D5)', () => {
    const split = page.autoSplit(store);
    expect(split).not.toBeNull();
    expect(split?.caption).toBe('Who did each step, every application so far');
    expect(split?.heads).toEqual(['Your deputy', 'You']);
    // The usual sample (ST's provenance): 5 tailored by your deputy, 1 of them edited by you;
    // 4 approved by you, none automatically (auto approve is off); applied 1 in the background
    // (amazon-sde2) and 3 by you.
    expect(
      split?.rows.map((row) => [
        row.label,
        row.deputy.key,
        row.deputy.text,
        row.you.key,
        row.you.text,
        row.youUnit,
      ]),
    ).toEqual([
      ['Tailored', 'apps.auto.tailored', '5', 'apps.auto.edited', '1', ' edited'],
      ['Approved', 'apps.auto.approvedAuto', '0', 'apps.auto.approvedByYou', '4', ''],
      ['Applied', 'apps.auto.appliedAuto', '1', 'apps.auto.appliedByYou', '3', ''],
    ]);
    const table = page.autoMarkup(split);
    expect(table).toMatch(
      /^<table class="dash-auto-table"><caption class="sr-only">Who did each step, every application so far<\/caption>/,
    );
    expect(table).toContain(
      '<thead><tr><td class="dash-auto-corner">So far</td><th scope="col">Your deputy</th><th scope="col">You</th></tr></thead>',
    );
    expect(table).toContain(
      '<tr data-step="tailored"><th scope="row">Tailored</th><td><span data-metric="apps.auto.tailored">5</span></td><td><span data-metric="apps.auto.edited">1</span> edited</td></tr>',
    );
    // The one waiting figure is the head's (the store's apps.auto.waiting is the same count).
    expect(table).not.toContain('apps.auto.waiting');
    // A sighted reader sees the corner, the two heads, and a row a step (the caption is for
    // screen readers).
    expect(shown(table.replace(/<caption class="sr-only">[^<]*<\/caption>/, ''))).toBe(
      'So far Your deputy You Tailored 5 1 edited Approved 0 4 Applied 1 3',
    );
    // Without the store's provenance there is no table (never a guessed count).
    expect(page.autoMarkup(null)).toBe('');
  });

  it('shows Runs and tokens: the shared rings and runway, Usage in its head, and its two actions (D10)', () => {
    const tile = page.runsTile(store);
    expect(tile).toMatchObject({
      label: 'Runs and tokens',
      usageHref: './usage-preview.html#runway',
      off: null,
    });
    // The head names both units and the rings' colours in the palette's words, and opens Usage at
    // its runway with a way back (R10-3).
    expect(page.runsHeadMarkup(tile)).toBe(
      `<p class="kpi-label" id="runs-label" data-tip-title="Runs and tokens" data-tip="${attrText(tile.labelTip)}">Runs and tokens</p> <a class="chart-action dash-tile-link" href="./usage-preview.html#runway" data-return-link data-tip-title="Usage" data-tip="How long your runs and tokens last at your settings, what uses them, and every day of it. Opens Usage in Settings." data-focus-key="runs-usage">Usage</a>`,
    );
    expect(tile.labelTip).toBe(
      'Every search, Keep watch check, Gmail scan, and daily email uses one run; your deputy’s AI uses tokens. Hatched grey is used, indigo runs left, teal tokens left.',
    );
    // The foot: Get more runs (buying has one home, Purchases, at its quick buy, with a way
    // back, R10-3) and Change (the AI setting's home).
    expect(
      tile.actions.map((action) => [action.kind, action.text, action.topup ?? action.href]),
    ).toEqual([
      ['buy', 'Get more runs', './shop-preview.html#buy'],
      ['link', 'Change', './ai-preview.html#ai'],
    ]);
    expect(page.runsFootMarkup(tile)).toContain(
      '<a class="compact-action" href="./shop-preview.html#buy" data-return-link data-tip-title="Get more runs"',
    );
    expect(page.runsFootMarkup(tile)).not.toContain('data-topup-open');
    expect(page.runsFootMarkup(tile)).toContain(
      '<a class="chart-action" href="./ai-preview.html#ai" data-tip-title="Change" data-tip="What runs your deputy’s AI, its model, and your limit. Opens What runs your deputy’s AI in AI &amp; credits." data-focus-key="assist-change">Change<span class="sr-only">: what runs your deputy’s AI</span></a>',
    );
    // With Deputy Assist off: what searches use instead, and Turn it on.
    const { store: off } = load();
    expect(off.setAiChoice('none')).toBeTruthy();
    const none = page.runsTile(off);
    expect(none.off).toBe('Deputy Assist is off: searches filter by keywords');
    expect(shown(page.runsFootMarkup(none))).toBe(
      'Deputy Assist is off: searches filter by keywords Get more runs Turn it on',
    );
    // The rings (runs, and the tokens of what runs your AI) and the runway are the shared
    // components', drawn in the first render; their hosts are held as skeletons until then.
    expect(script).toContain(
      "components.allowanceRings(ringsHost, { kinds: ['runs', 'tokens'], size: 'compact', metrics: true });",
    );
    expect(script).toContain('components.runwayLine(runwayHost, { uses: true });');
    expect(openTag(home, 'runs-rings')).toContain('data-skeleton="block"');
    expect(openTag(home, 'runs-runway')).toContain('data-skeleton="lines"');
    // The page writes no ring of its own any more.
    expect(script).not.toMatch(/allowance-part|const watchTile|const aiLine/);
    // The old anchors of the two rings land on the tile, which takes the focus.
    expect(openTag(home, 'tile-runs')).toContain(
      'role="group" tabindex="-1" aria-labelledby="runs-label"',
    );
    expect(script).toContain(
      "if (['#assist-meter', '#watch-meter', '#tile-runs'].includes(window.location.hash)) focusAssist();",
    );
    expect(styles).toMatch(/\.dash-runs-tile \{\s*scroll-margin-top: 89px;/);
    // A dialog opened from the tile returns focus to its opener, drawn again or not.
    expect(script).toContain(
      "const opener = event.target.closest?.('main [data-topup-open], main [data-prompt-open]');",
    );
    // Where the tile has a row of its own (tablets), the runway sits beside the rings.
    expect(styles).toMatch(
      /@container dash-runs \(width >= 560px\) \{\s*\.dash-runs-tile \{\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/,
    );
  });

  it('keeps the shared ring’s own words for its state out of the page’s change check', () => {
    expect(script).toContain(
      '.replace(/<span class="sr-only allowance-state-words">[^<]*<\\/span>/g, \'\')',
    );
  });
});

describe('What needs you: To-do beside What’s new, in the same rows (the owner, Oct 5; D5)', () => {
  it('puts the two side by side in equal columns on desktops, each card as tall as its own content', () => {
    const rows = rowsOf(main);
    // Round 7: the band follows the glance (D4: locked, its contents unchanged).
    expect(rows[0]).toEqual(['is-even', ['dash-todo', 'dash-news']]);
    // R9-11 and T1-15: a card never stretches to its neighbour, so it never ends with a band of
    // air and opening Show the numbers grows only its own card; each list starts at the top.
    expect(styles).toMatch(
      /@container dash \(width >= 860px\) \{\s*\.dash-row \{\s*align-items: start;\s*\}\s*\.dash-row\.is-even \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(styles).not.toMatch(/\.dash-row\.is-even \.dash-todo-list \{\s*align-content: stretch/);
    expect(styles).toMatch(/\.dash-todo \{\s*display: grid;\s*gap: 13px;\s*align-content: start;/);
    // Under the heading of the section: what needs you.
    expect(text(inner(home, 'now-title'))).toBe('What needs you');
  });

  it('lists the store’s To-do, the agreement first with the day your deputy pauses (W4)', () => {
    const { store } = load();
    const items = page.todoItems(store);
    expect(items.map((item) => [item.kind, item.title.map((part) => part.text).join('')])).toEqual([
      ['agreement', 'Review and sign the updated agreement'],
      ['approval', 'Approve materials for Search Infrastructure'],
      // R9-12: no Follow up with Amazon beside Amazon's interview invitation (its move waits).
      // Round 6 part 3 (T6-5): the store's words, which the deputy's Activity on the same page
      // also shows. Round 7 (R10-9): every enabled use counts, so October's Gmail scans and
      // Keep watch leave runs for Sat, Oct 3 (ST, figures that moved).
      ['allowance', 'Runs last through Sat, Oct 3'],
      ['interview', 'Prepare for the Northwind interview'],
      ['source', 'Fix the Acme source'],
      ['profile', 'Add 2 details applications need'],
    ]);
    expect(items.map((item) => item.id)).toEqual(store.todo().map((item) => item.id));
    expect(items[0]?.due).toEqual([
      { text: 'Sign by ' },
      { key: 'agreement.pauseAt', text: 'Thu, Oct 15' },
    ]);
    // Each row is its one action: a link to the store's place, or the nightly buy dialog.
    const rows = [
      ...inner(home, 'todo-list').matchAll(
        /<li class="dash-todo-item"[^>]*>(<(a|button)\b[^>]*>)/g,
      ),
    ];
    expect(rows.map((row) => row[2])).toEqual(['a', 'a', 'button', 'a', 'a', 'a']);
    // On the narrowest phones (Dashboard under 334px, a 320px screen) the decorative icon steps
    // aside so a short title such as the runs row stays on one line; What's new's Mark read then
    // lines up with the words.
    expect(styles).toMatch(
      /@container dash \(width < 334px\) \{\s*\.dash-todo-link \{\s*grid-template-columns: minmax\(0, 1fr\) auto;\s*\}\s*\.dash-todo-icon \{\s*display: none;\s*\}\s*\}/,
    );
    expect(styles).toMatch(
      /@container dash \(width < 334px\) \{\s*\.dash-news-item > \.dash-news-read,\s*\.dash-news-item > \.dash-news-done \{\s*margin-inline-start: 4px;\s*\}\s*\}/,
    );
    expect(
      rows.map((row) => attrsOf(row[1] ?? '').href ?? attrsOf(row[1] ?? '')['data-topup-open']),
    ).toEqual([
      './agreement-preview.html?mode=update&return=home-preview.html%3FskipLoader%23dash-todo',
      './materials-preview.html?app=search-infra&from=applications',
      'nightly',
      './applications-preview.html?open=northwind-backend',
      './searches-preview.html?source=acme',
      './profile-preview.html#field-profile.postalCode',
    ]);
    // The detail and where the click goes are the row's tooltip.
    expect(items.map((item) => [item.action, item.tip])).toEqual([
      [
        'Review and sign',
        'Version 2026.10 · your deputy pauses Thu, Oct 15 if it isn’t signed. Opens the agreement to review and sign.',
      ],
      ['Review', 'Google · tailored résumé and cover letter. Opens the materials to review.'],
      // Round 6, part 2 (N3): the store's item says Get more runs; round 7 (R10-9): 83 more
      // runs, for Keep watch and Gmail's daily scan through the month.
      [
        'Get more runs',
        '83 more runs keep both sources watched and Gmail scanned through Oct 31. Opens the run packs.',
      ],
      ['Open role', 'Phone screen Tue, Oct 6, 10:00. Opens the role in Applications.'],
      [
        'Fix source',
        'Stopped Sep 28: The page took too long to load. Opens the source in Searches.',
      ],
      ['Add details', 'Postal code and expected pay. Opens the details in Profile.'],
    ]);
    // The missing required details' count keeps its data-metric.
    expect(items.at(-1)?.title).toEqual([
      { text: 'Add ' },
      { key: 'profile.missingRequired', text: '2' },
      { text: ' details applications need' },
    ]);
    expect(script).toContain("limit: 'Opens Your limit in AI & credits.',");
    expect(script).toMatch(/\n\s+limit:\n\s+'<path d="M4\.75 15\.5a7\.25/);
  });

  it('takes the agreement item away once signed, and says when your deputy is paused (W4, W5)', () => {
    const { store } = load();
    expect(store.setAgreementDemo('overdue')).toBeTruthy();
    expect(page.todoItems(store)[0]?.due).toEqual([
      { text: 'Your deputy is paused until you sign' },
    ]);
    expect(sign(store).ok).toBe(true);
    const items = page.todoItems(store);
    expect(items.map((item) => item.kind)).not.toContain('agreement');
    expect(store.metricText('todo.count')).toBe(String(items.length));
    expect(page.regions(store)['todo-list']).not.toContain('agreement-preview.html');
  });

  it('lists the setup steps you skipped like any To-do, then caps a long To-do at seven with See all (G4, R6-4)', () => {
    const { store } = load();
    expect(page.CAPS.todo).toBe(7);
    // The usual sample: six items (R9-12), every one shown, no See all.
    expect(page.regions(store)['todo-more']).toBe('');
    // Skipping setup puts each step on the To-do, right after the agreement (A2's skipSetup).
    const skipped = store.skipSetup(['resume', 'source', 'ai']);
    expect(skipped.ok).toBe(true);
    const items = page.todoItems(store);
    expect(
      items
        .slice(0, 4)
        .map((item) => [
          item.kind,
          item.title.map((part) => part.text).join(''),
          item.href,
          item.tip,
        ]),
    ).toEqual([
      [
        'agreement',
        'Review and sign the updated agreement',
        './agreement-preview.html?mode=update&return=home-preview.html%3FskipLoader%23dash-todo',
        'Version 2026.10 · your deputy pauses Thu, Oct 15 if it isn’t signed. Opens the agreement to review and sign.',
      ],
      [
        'setup',
        'Add your résumé',
        './documents-preview.html#library',
        'Your deputy reads it to judge fit and tailor drafts. Opens Résumés.',
      ],
      [
        'setup',
        'Add your first source',
        './searches-preview.html?add=1#add-source',
        'A careers page or job board for your deputy to search. Opens Searches.',
      ],
      [
        'setup',
        'Choose how your deputy runs AI',
        './ai-preview.html#ai',
        'One setting runs every search and draft. Opens AI & credits.',
      ],
    ]);
    // The same row as every item: its icon (a flag to finish), its words, and its one action.
    const list = page.regions(store)['todo-list'] ?? '';
    expect(list).toContain(
      '<li class="dash-todo-item" data-kind="setup"><a class="dash-todo-link" href="./documents-preview.html#library" data-tip-title="Add résumé" data-tip="Your deputy reads it to judge fit and tailor drafts. Opens Résumés." data-focus-key="todo-setup-resume">',
    );
    expect(script).toMatch(/\n\s+setup:\n\s+'<path d="/);
    // Nine items now: the seven most urgent show, and See all lists every one (the heading's count
    // is the only figure, so the button names none).
    expect(items).toHaveLength(9);
    expect([...list.matchAll(/<li class="dash-todo-item"/g)]).toHaveLength(7);
    expect(page.regions(store)['todo-more']).toBe(
      '<button class="chart-action see-all-open" type="button" data-see-all="todo" data-focus-key="todo-see-all">See all<span class="sr-only"> To-do items</span></button>',
    );
    expect(page.regions(store)['todo-title']).toContain('data-metric="todo.count">9</span>');
    // See all keeps the To-do's own order and opens each item's place.
    expect(script).toContain(
      "sorts: [{ id: 'urgent', label: 'Most urgent first', compare: keepOrder(items) }],",
    );
  });

  it('draws What’s new in To-do’s rows: the kind’s icon and word, the title, one line, where it goes, and Mark read (W17, G8)', () => {
    const { store } = load();
    const card = page.newsCard(store);
    expect(card.unread).toEqual({ key: 'updates.unread', text: '6' });
    // Each item says where it goes (round 6, G8): a guide in Help, or a page, from the store's
    // link, and the row opens it.
    expect(
      card.items.map((item) => [
        item.id,
        item.kind,
        item.kindLabel,
        item.title,
        item.date,
        item.href,
        item.go.kind,
        item.go.label,
      ]),
    ).toEqual([
      [
        'review-then-apply',
        'launch',
        'Launch',
        'Review, then auto-apply',
        'Oct 2',
        './trust-preview.html?guide=review-then-apply#guides',
        'guide',
        'Read the guide',
      ],
      [
        'prompt-testing',
        'update',
        'Update',
        'Test a prompt before it goes live',
        'Oct 1',
        './prompts-preview.html',
        'page',
        'Open Prompts',
      ],
      [
        'bundle-offer',
        'offer',
        'Offer',
        'Bundles: runs at 25% off',
        'Oct 1',
        './shop-preview.html#bundles',
        'page',
        'Open Purchases',
      ],
      [
        'credits-at-aws-prices',
        'launch',
        'Launch',
        'AI credits at AWS prices',
        'Oct 1',
        './trust-preview.html?guide=credits-at-aws-prices#guides',
        'guide',
        'Read the guide',
      ],
      [
        'site-accounts',
        'update',
        'Update',
        'Site accounts and one-time codes',
        'Sep 30',
        './trust-preview.html?guide=site-accounts#guides',
        'guide',
        'Read the guide',
      ],
      [
        'linkedin-import',
        'update',
        'Update',
        'Import from LinkedIn',
        'Sep 28',
        './trust-preview.html?guide=linkedin-import#guides',
        'guide',
        'Read the guide',
      ],
    ]);
    expect(card.items.map((item) => item.tip.split('.')[0])).toEqual([
      'Opens the guide in Help',
      'Opens Prompts',
      'Opens Purchases',
      'Opens the guide in Help',
      'Opens the guide in Help',
      'Opens the guide in Help',
    ]);
    // The four newest show; See all lists every one (R6-4).
    expect(page.CAPS.news).toBe(4);
    expect(card.shown.map((item) => item.id)).toEqual(
      card.items.slice(0, 4).map((item) => item.id),
    );
    expect(card.more).toBe(true);
    // The same list, row, link, icon, title, and sub line classes as To-do: no new look.
    expect(openTag(home, 'news-list')).toBe(
      '<ul class="dash-todo-list dash-news-list" id="news-list" aria-labelledby="news-title">',
    );
    expect(openTag(home, 'dash-news')).toMatch(
      /^<section class="task-surface dash-todo dash-news" id="dash-news" aria-labelledby="news-title"/,
    );
    const html = page.newsMarkup(card);
    expect(html.split('</li>')).toHaveLength(5);
    const first = html.split('</li>')[0] ?? '';
    expect(first).toMatch(
      /^<li class="dash-todo-item dash-news-item" data-kind="launch" data-update="review-then-apply"><a class="dash-todo-link" href="\.\/trust-preview\.html\?guide=review-then-apply#guides" data-tip-title="Review, then auto-apply" data-tip="Opens the guide in Help\. Opening it marks it read\." data-news-open="review-then-apply" data-focus-key="news-review-then-apply"><span class="dash-todo-icon" aria-hidden="true"><svg class="dash-icon"/,
    );
    // The row reads: the title, the item's own words wrapping under it, then its kind, its date,
    // and where it goes, in words and an icon (a book for a guide, an arrow out for a page), never
    // by colour alone.
    expect(first).toContain(
      '<span class="dash-news-when"><span class="dash-news-kind">Launch</span> · <time datetime="2026-10-02T09:00">Oct 2</time> · <span class="dash-news-go" data-go="guide"><svg class="dash-icon" viewBox="0 0 24 24" width="16" height="16"',
    );
    expect(first).toContain('</svg>Read the guide</span></span></span></span></a>');
    expect(html).toContain('<span class="dash-news-go" data-go="page">');
    expect(html).toContain('</svg>Open Prompts</span>');
    expect(first).not.toContain('aria-describedby');
    expect(first).not.toContain('id="news-text-');
    expect(first).toMatch(
      /<button class="compact-action dash-news-read" type="button" data-news-read="review-then-apply" data-focus-key="news-read-review-then-apply">Mark read<span class="sr-only">: Review, then auto-apply<\/span><\/button>$/,
    );
    expect(shown(html)).toBe(
      'Review, then auto-apply Your deputy drafts and reviews your materials, you approve each role in one step, and it applies in the background. Launch · Oct 2 · Read the guide Mark read Test a prompt before it goes live A new version is replayed on your last 40 decisions, then tried on a share of runs, and rolled back if it doesn’t hold up. Update · Oct 1 · Open Prompts Mark read Bundles: runs at 25% off Until Oct 31, every bundle takes 25% off its runs. Credits always cost AWS’s rate plus 10%. Offer · Oct 1 · Open Purchases Mark read AI credits at AWS prices Platform AI now costs what Amazon Bedrock charges, plus 10%. Choose your model and buy credits in Purchases. Launch · Oct 1 · Read the guide Mark read',
    );
    expect(page.regions(store)['news-more']).toBe(
      '<button class="chart-action see-all-open" type="button" data-see-all="news" data-focus-key="news-see-all">See all<span class="sr-only">: every update</span></button>',
    );
    // The sub line holds the words and then the kind and date, each on its own line.
    expect(styles).toMatch(
      /\.dash-news-item \.dash-todo-due \{\s*display: grid;\s*gap: 2px;\s*margin-top: 4px;/,
    );
    // Neither card ends with a band of air: R9-11 and T1-15, each card is as tall as its own
    // rows (top aligned in its row), so no list spreads its rows to match its neighbour.
    expect(styles).not.toMatch(/\.dash-row\.is-even > \.dash-todo \{\s*grid-template-rows/);
    expect(styles).not.toMatch(/\.dash-row\.is-even \.dash-todo-item \{\s*display: grid;/);
    // Each kind has its own icon (a spark, a tag, a refresh), drawn like To-do's, and so has each
    // destination (a book, an arrow out).
    for (const kind of ['launch', 'offer', 'update', 'guide']) {
      expect(script, kind).toMatch(new RegExp(`\\n\\s+${kind}:\\n\\s+'<path d="`));
    }
    expect(script).toMatch(/\n\s+page: '<path d="/);
    // The heading carries the unread count as To-do's carries its own.
    expect(page.regions(store)['news-title']).toBe(
      'What’s new <span class="board-count" data-metric="updates.unread">6</span><span class="sr-only"> unread</span>',
    );
    // An unread item's icon sits on blue, a read one on the track grey.
    expect(styles).toMatch(
      /\.dash-news-item\[data-kind\] \.dash-todo-icon \{\s*background: var\(--blue-soft\);/,
    );
    expect(styles).toMatch(
      /\.dash-news-item\.is-read\[data-kind\] \.dash-todo-icon \{\s*background: var\(--paper-deep\);/,
    );
  });

  it('never repeats a To-do item: no title or page in common (W17)', () => {
    const { store } = load();
    const todo = store.todo();
    for (const item of page.newsCard(store).items) {
      expect(
        todo.map((entry) => entry.title),
        item.id,
      ).not.toContain(item.title);
      expect(
        todo.map((entry) => entry.href),
        item.id,
      ).not.toContain(item.href);
    }
  });

  it('keeps an item read once marked or opened, quieter, with Read said in words', () => {
    const { store } = load();
    store.markUpdateRead('credits-at-aws-prices');
    const card = page.newsCard(store);
    expect(card.unread).toEqual({ key: 'updates.unread', text: '5' });
    const read = page.newsMarkup(card).split('</li>')[3] ?? '';
    expect(read).toMatch(
      /^<li class="dash-todo-item dash-news-item is-read" data-kind="launch" data-update="credits-at-aws-prices">/,
    );
    expect(read).toMatch(/<span class="dash-news-done">Read<\/span>$/);
    expect(read).not.toContain('data-news-read');
    expect(styles).toMatch(
      /\.dash-news-item\.is-read \.dash-todo-title \{\s*color: var\(--ink-soft\);\s*font-weight: 400;/,
    );
    // All read: the count goes, and every row stays.
    for (const item of store.updates()) store.markUpdateRead(item.id);
    const all = page.newsCard(store);
    expect(all.unread).toBeNull();
    expect(all.items.every((item) => item.read)).toBe(true);
    expect(page.regions(store)['news-title']).toBe('What’s new');
    // The See all panel says which ones you have read (R6-4); opening one there marks it read too.
    expect(script).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected text is page source with a template literal
      "meta: `${item.kindLabel} · ${item.date} · ${item.go.label}${item.read ? ' · Read' : ''}`,",
    );
    expect(script).toContain("drawer.addEventListener('click', onOpen);");
    expect(allFigures(store).map(([key]) => key)).not.toContain('updates.unread');
  });

  it('marks an item read through the store, says so once, and opens its page after a plain click', () => {
    expect(script).toContain('store.markUpdateRead(id);');
    expect(script).toContain("const button = target?.closest('[data-news-read]');");
    expect(script).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected text is page source with a template literal
      'newsList.querySelector(`[data-focus-key="news-${CSS.escape(id)}"]`)?.focus();',
    );
    expect(script).toContain("announce('Marked as read.');");
    expect(script).toContain("deputy?.react?.('saved', { speech: 'I marked it as read.' });");
    expect(script).toContain("const link = target?.closest('a[data-news-open]');");
    expect(script).toMatch(
      /event\.preventDefault\(\);\s*const href = link\.href;\s*markRead\(id\);\s*window\.location\.assign\(href\);/,
    );
    // A click that opens another tab or window marks it once the click is done.
    expect(script).toContain('window.setTimeout(() => markRead(id), 0);');
    // Mark read keeps its 44px target, and takes its own line on a narrow card.
    expect(styles).toMatch(/@container dash-news \(width < 340px\) \{/);
  });
});

describe('the bands, top to bottom: a glance of each area, each linking to its screen (R10-2, D7)', () => {
  it('orders the bands: the glance, To-do and What’s new, Prompts, Gmail beside Usage, Keywords by role', () => {
    const sections = [...main.matchAll(/<section class="dash-section" id="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(sections).toEqual(['dash-glance', 'dash-now', 'dash-work', 'dash-found']);
    const cards = [
      ...main.matchAll(/<(?:section|figure) class="task-surface[^"]*" id="([^"]+)"/g),
    ].map((match) => match[1]);
    expect(cards).toEqual([
      'dash-todo',
      'dash-news',
      'dash-prompts',
      'dash-gmail',
      'dash-usage',
      'dash-keywords',
    ]);
    expect(rowsOf(main)).toEqual([
      ['is-even', ['dash-todo', 'dash-news']],
      ['is-narrow-first', ['dash-gmail', 'dash-usage']],
    ]);
    expect(text(inner(home, 'work-title'))).toBe('How your deputy works for you');
    expect(text(inner(home, 'found-title'))).toBe('The skills your roles ask for');
    // A card the store has no figures for yet leaves its partner the whole row.
    expect(styles).toMatch(
      /@container dash \(width >= 860px\) \{\s*\.dash-row\.is-wide-first:has\(> \[hidden\]\) \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(styles).toMatch(
      /@container dash \(width >= 1150px\) \{\s*\.dash-row\.is-narrow-first:has\(> \[hidden\]\) \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    // Desktops: the narrow card first and the wide second (Gmail, Usage), side by side only from
    // 1150px of page, where Usage has room for its chart beside Runs by use; narrower, each its
    // own row, Gmail's week beside its last scan, so neither row ends far below its partner
    // (T1-21). Phones and tablets stack every card in this order.
    expect(styles).toMatch(
      /@container dash \(width >= 1150px\) \{\s*\.dash-row\.is-narrow-first \{\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1\.618fr\);/,
    );
    expect(styles).toMatch(
      /@container dash \(width >= 860px\) and \(width < 1150px\) \{\s*\.dash-gmail:has\(> \.dash-gmail-week:not\(\[hidden\]\)\) \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(styles).toMatch(
      /\.dash-row \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    // One Sample data note serves each band.
    for (const id of ['dash-glance', 'dash-now', 'dash-work', 'dash-found']) {
      expect(inner(home, id).match(/<p class="sample-note">/g), id).toHaveLength(1);
    }
  });

  it('leaves Matches by source, Roles found per search, Latest matches, and AI in October to their screens (D7, D9)', () => {
    // Their cards, their model, their See all lists, and their tour steps are gone; Searches has
    // the first two at its top (SJ), Job matches is the list, and Usage replaced AI in October.
    for (const gone of [
      'dash-sources',
      'dash-runs',
      'dash-latest',
      'dash-ai',
      'dash-tests',
      'sources-donut',
      'runs-chart',
      'latest-rows',
      'ai-days',
      'assist-meter',
      'watch-meter',
    ]) {
      expect(main, gone).not.toContain(`id="${gone}"`);
    }
    for (const words of [
      'Matches by source',
      'Roles found per search',
      'Latest matches',
      'AI in October',
      'Prompt tests',
    ]) {
      expect(text(main), words).not.toContain(words);
    }
    for (const code of [
      'sourcesCard',
      'perSearchChart',
      'latestRows',
      'livePill',
      'aiMonth',
      'promptTestsCard',
    ]) {
      expect(script, code).not.toContain(code);
    }
    expect(script).not.toMatch(
      /data-see-all="(?:sources|runs)"|\bsources: \(\) =>|\bruns: \(\) =>/,
    );
    // No tour step and no tip names them either.
    const all = `${Object.values(page.TOUR)
      .map((step) => `${step.title} ${step.text}`)
      .join(' ')} ${Object.values(page.regions(load().store)).join(' ')}`;
    expect(all).not.toMatch(
      /Latest matches|Roles found per search|Matches by source|AI in October/,
    );
  });
});

describe('Keywords by role: which roles the keywords are for (D6)', () => {
  const { store } = load();

  it('switches between all your roles and each target role, the heading saying which', () => {
    const card = page.keywordCard(store);
    expect(page.ALL_ROLES).toBe('all');
    expect(card.role).toBe('all');
    // The role switch: All your roles, then each target role (the store's roles).
    expect(card.roles.map((role) => [role.id, role.label, role.chosen])).toEqual([
      ['all', 'All your roles', true],
      ['software-engineer', 'Software engineer', false],
      ['product-engineer', 'Product engineer', false],
      ['engineering-manager', 'Engineering manager', false],
    ]);
    // All your roles: the heading names them with their found count, its own key (as Résumés
    // says it, T5-20), and each keyword links to Résumés' Keywords on the same role (T6-4).
    expect(card.headingText).toBe('Top keywords for all your roles, 27 found');
    expect(page.keywordsTitleMarkup(card)).toBe(
      'Top keywords for all your roles, <span data-metric="keywords.role.all.found">27</span> found',
    );
    expect(card.rows[0]?.href).toBe('./documents-preview.html#keywords');
    expect(page.keywordCard(store, 'engineering-manager').rows[0]?.href).toBe(
      './documents-preview.html?keywords=engineering-manager#keywords',
    );
    expect(page.keywordRolesMarkup(card)).toBe(
      `<legend class="sr-only">Show the keywords of</legend>${card.roles
        .map(
          (role) =>
            `<label class="choice-chip"><input type="radio" name="keywords-role" value="${role.id}" data-focus-key="keywords-role-${role.id}"${role.chosen ? ' checked' : ''} />${role.label}</label>`,
        )
        .join('')}`,
    );
    expect(openTag(home, 'keywords-roles')).toBe(
      '<fieldset class="dash-roles" id="keywords-roles">',
    );
    // One role: its own keywords, its count of found roles in the heading (once, with its key),
    // and every figure the role's own key, so no key repeats the all-roles figures.
    const one = page.keywordCard(store, 'engineering-manager');
    expect(one.role).toBe('engineering-manager');
    expect(one.roles.find((role) => role.chosen)?.id).toBe('engineering-manager');
    expect(one.headingText).toMatch(/^Top keywords for Engineering manager roles, \d+ found$/);
    expect(one.heading.find((part) => part.key)?.key).toBe(
      'keywords.role.engineering-manager.found',
    );
    expect(one.rows.length).toBeGreaterThan(0);
    for (const row of one.rows) {
      expect(row.figure.key, row.id).toBe(`keyword.${row.id}.role.engineering-manager`);
      expect(row.figure.text, row.id).toBe(store.metricText(row.figure.key));
    }
    const figures = figuresIn(
      Object.values(page.regions(store, { role: 'engineering-manager' })).join(''),
    );
    expect(repeats(figures.map(([key]) => key))).toEqual([]);
    // An unknown role shows all your roles.
    expect(page.keywordCard(store, 'astronaut').role).toBe('all');
    // The choice stays in the address (?keywords=), and the radio you pressed keeps its focus.
    expect(script).toContain("role: previewParameters.get('keywords') || ALL_ROLES,");
    expect(script).toContain(
      "keepInAddress('keywords', view.role === ALL_ROLES ? '' : view.role);",
    );
    expect(script).toContain("radio.toggleAttribute('checked', radio === input);");
  });

  it('lists the top six keywords as bars of the roles that ask for each, on your résumé or not, linking to readiness', () => {
    const card = page.keywordCard(store);
    expect(card.rows.map((row) => [row.keyword, row.figure.text, row.onResume, row.tone])).toEqual([
      ['Distributed systems', '18', true, 'green'],
      ['Go', '12', true, 'green'],
      ['Kubernetes', '10', true, 'green'],
      ['Java', '9', false, 'quiet'],
      ['Technical strategy', '8', false, 'quiet'],
      ['Reliability', '7', true, 'green'],
    ]);
    expect(card.rows.map((row) => row.share)).toEqual([0.667, 0.444, 0.37, 0.333, 0.296, 0.259]);
    expect(card.rows.every((row) => row.href === './documents-preview.html#keywords')).toBe(true);
    expect(card.rows[0]).toMatchObject({
      tipTitle: 'Distributed systems · 18 roles',
      tip: '12 of them found this week. On your default résumé. Opens Keywords in Résumés.',
    });
    const bars = page.regions(store)['keyword-bars'] ?? '';
    expect(bars).toContain(
      '<a class="hbar-row" data-tone="green" href="./documents-preview.html#keywords"',
    );
    expect(bars).toContain(
      '<span class="dash-keyword-name dash-keyword-on">Distributed systems</span>',
    );
    expect(bars).toContain('<span class="dash-keyword-name">Java</span>');
    expect(bars).toContain(
      '<span class="sr-only"> roles, not on your résumé yet. Open Keywords in Résumés</span>',
    );
    // The key names both colours in Résumés' words (nothing by colour alone: the check, too),
    // and each item explains itself in a tip (UAT-D-10).
    const key = inner(home, 'dash-keywords').replace(/<legend class="sr-only">[^<]*<\/legend>/, '');
    expect(shown(key)).toMatch(
      /^Top keywords for all your roles, 27 found (?:All your roles Software engineer Product engineer Engineering manager )?Top 6 of 43 keywords See all On your résumé ✓ Your default résumé names it\. Not on it yet Add one only where it’s true\./,
    );
    const items = [
      ...(page.regions(store)['keyword-key'] ?? '').matchAll(/<span class="chart-key-item"[^>]*>/g),
    ].map((match) => attrsOf(match[0]));
    expect(items.map((item) => [item['data-tip-title'], item['data-tip']])).toEqual([
      ['On your résumé', 'Green: your default résumé names the keyword, marked with a check.'],
      [
        'Not on it yet',
        'Grey: your default résumé does not name it yet. Add one only where it’s true.',
      ],
    ]);
    // Two columns of three once the card has the room (from 440px).
    expect(styles).toMatch(
      /@container dash-keywords \(width >= 440px\) \{\s*\.dash-keyword-bars \{\s*grid-template-rows: repeat\(3, auto\);\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
  });

  it('shows this week’s new keywords as links with their unit, each count once, and never the found total (UAT-D-10)', () => {
    const card = page.keywordCard(store);
    expect(card.fresh.map((entry) => [entry.keyword, entry.figure.key, entry.figure.text])).toEqual(
      [
        ['C#', 'keyword.csharp', '3'],
        ['Developer platforms', 'keyword.developer-platforms', '3'],
        ['Automation', 'keyword.automation', '2'],
        ['C++', 'keyword.cplusplus', '2'],
        ['Information retrieval', 'keyword.information-retrieval', '2'],
        ['Real-time collaboration', 'keyword.real-time-collaboration', '2'],
      ],
    );
    const fresh = page.regions(store)['keywords-new'] ?? '';
    expect(shown(fresh)).toBe(
      'New this week C# · 3 roles Developer platforms · 3 roles Automation · 2 roles C++ · 2 roles Information retrieval · 2 roles Real-time collaboration · 2 roles',
    );
    expect(fresh).toContain(
      '<a class="dash-keyword-link" href="./documents-preview.html#keywords" data-tip-title="C# · 3 roles" data-tip="First asked for this week, by 3 of the roles your deputy found. Not on your default résumé yet; add it only where it’s true. Opens Keywords in Résumés." data-focus-key="new-csharp"><span class="tag"><span>C# · <strong data-metric="keyword.csharp">3</strong> roles</span></span><span class="sr-only">, new this week. Open Keywords in Résumés</span></a>',
    );
    expect(styles).toMatch(/\.dash-keyword-link \{\s*display: inline-flex;\s*min-height: 44px;/);
    // The found count shows once, in the heading, with the role's own key (T5-20), never as the
    // Job matches tile's figure.
    expect(text(inner(home, 'dash-keywords')).match(/\b27\b/g)).toHaveLength(1);
    expect(inner(home, 'dash-keywords')).not.toContain('data-metric="jobs.found"');
    // A role whose new keywords are all among its bars says so, never "No new keywords" (T5-14).
    const product = page.keywordCard(store, 'product-engineer');
    expect([
      product.fresh.length,
      product.rows.some((row) => (row as { isNew?: boolean }).isNew),
    ]).toEqual([0, true]);
    expect(page.keywordsNewMarkup(product)).toBe(
      '<li class="dash-keywords-new-label">This week’s new keywords are marked New above</li>',
    );
  });

  it('shows the top six of every keyword, See all for the rest, and at most six new ones plus "+N more" (G9)', () => {
    const card = page.keywordCard(store);
    expect(page.CAPS.keywords).toBe(6);
    expect(card.rows).toHaveLength(6);
    // "Top 6 of 43 keywords": every keyword your found roles ask for (keywords.total, the store's
    // full list; keywordStats keeps the top 12), the total once with its key, and See all beside
    // it. Without the key the line would say "Top 6 keywords" (no number typed into the page).
    expect(card.top).toEqual({ shown: 6, total: { key: 'keywords.total', text: '43' } });
    expect(page.regions(store)['keywords-top']).toBe(
      '<span>Top 6 of <span data-metric="keywords.total">43</span> keywords</span> <button class="chart-action see-all-open" type="button" data-see-all="keywords" data-focus-key="keywords-see-all">See all<span class="sr-only"> keywords</span></button>',
    );
    // See all lists every keyword, most roles first, with its count and whether it is on your
    // résumé (the store's full list, or the card's when the store has none).
    expect(card.all).toHaveLength(12);
    expect(card.all[0]).toEqual({
      id: 'distributed-systems',
      label: 'Distributed systems',
      count: 18,
      href: './documents-preview.html#keywords',
      tone: 'green',
      meta: 'On your résumé',
    });
    expect(card.all.find((entry) => entry.id === 'java')?.meta).toBe('Not on your résumé yet');
    expect(script).toContain("? (store.seeAll?.('keywords')?.items ?? keywordCard(store).all)");
    // New this week: six on the usual sample, so no "+N more"; past six, the rest wait behind it.
    expect([card.fresh.length, card.freshMore]).toEqual([6, 0]);
    expect(page.regions(store)['keywords-new']).not.toContain('dash-keyword-more');
    expect(page.keywordsNewMarkup({ ...card, freshMore: 4 })).toMatch(
      /<li><button class="dash-keyword-link dash-keyword-more" type="button" data-see-all="keywords-new" data-focus-key="keywords-new-more"><span class="tag">\+4 more<\/span><span class="sr-only"> new this week: see them all<\/span><\/button><\/li>$/,
    );
    expect(card.tourText).toBe(
      'Pick a role and I count the skills its roles ask for most; green ones are on your résumé. See all lists every keyword.',
    );
  });
});

describe('Prompts, Gmail, and Usage: how your deputy works (round 7, D2, D3, D9, R10-5, R10-9)', () => {
  const { store } = load();

  it('lists every prompt as the shared prompt summary row, under the last 30 days of tests (D2, R10-5)', () => {
    const card = page.promptsCard(store);
    expect(card).not.toBeNull();
    // All eight, in the store's one order (the same as the Prompts page and Searches).
    expect(card?.ids).toEqual([
      'read',
      'rank',
      'tailor',
      'letter',
      'answer',
      'check',
      'mail',
      'reply',
    ]);
    expect(card?.window).toEqual({ label: 'Last 30 days', words: 'in the last 30 days' });
    // The four counts the brief names: tests, passed, did not pass (R9-8's words), on trial.
    expect(wordsOf(card?.totals)).toBe('13 tests · 10 passed · 3 did not pass · 2 on trial');
    expect(card?.totals.filter((part) => part.key).map((part) => part.key)).toEqual([
      'prompts.tests.last30',
      'prompts.tests.passedLast30',
      'prompts.tests.failedLast30',
      'prompts.canaries',
    ]);
    // A host a prompt for the shared summary (row size, an h4 under the card's h3); the
    // component draws the version, the trend, Kept by you, the tokens, the models, and Open in
    // Prompts with its way back. The page draws no prompt of its own (R10-5).
    expect(page.promptsListMarkup(card)).toBe(
      card?.ids
        .map(
          (id) =>
            `<li data-prompt-summary="${id}" data-prompt-size="row" data-prompt-heading="4"></li>`,
        )
        .join(''),
    );
    expect(openTag(home, 'prompts-list')).toContain('data-prompt-summaries');
    expect(script).not.toMatch(
      /scoreTrend|data-trend=|promptTests\(\)\.prompts\.map\(\(prompt\) => \(\{ id/,
    );
    expect(main).not.toMatch(/data-prompt-open|data-prompt-control/);
    // The card's head: Prompts, its window, and Open Prompts with a way back (R10-3).
    expect(
      shown(inner(home, 'dash-prompts')).startsWith('Prompts Last 30 days Open Prompts 13 tests'),
    ).toBe(true);
    expect(inner(home, 'dash-prompts')).toContain(
      '<a class="chart-action" href="./prompts-preview.html" data-return-link',
    );
    // A redraw never wipes the drawn summaries: the hosts change only with the store's list.
    expect(script).toContain("if (shown.join(' ') !== ids.join(' ')) {");
    expect(script).toContain('window.JobDeputyPanels?.drawPromptSummaries?.(promptsList);');
    // Prompts takes the full width (each row lays its parts across in one line at 1440).
    expect(main).toMatch(
      /<h2 class="sr-only" id="work-title">How your deputy works for you<\/h2>\s*<section class="task-surface dash-prompts" id="dash-prompts"/,
    );
  });

  it('says Gmail scans daily over the last 48 hours, what the last scan did, and Scan now’s cost (D3, R10-9)', () => {
    const card = page.gmailCard(store);
    expect(card).toMatchObject({
      connected: true,
      schedule: 'Daily scan at 07:00 of the last 48 hours.',
      last: { key: 'gmail.sync.lastTime', text: '07:00' },
      next: { key: 'gmail.scan.nextAt', text: 'Sat, Oct 3, 07:00' },
      href: './applications-preview.html#email',
    });
    // What this scan found since the one before (the store's words, T6-9), then what those
    // emails did in the chart's split, so the parts add up to what it read (T5-12: 2 + 2 + 2 = 6;
    // the moves wait for 2026.10, R9-12), and the interview invites among them as a note.
    expect(card?.lines?.map(wordsOf)).toEqual([
      '6 new job emails since yesterday’s 07:00 scan: 2 wait for your signature, 2 need your reply, 2 no change. 2 were interview invites.',
    ]);
    expect(
      card?.lines
        ?.flat()
        .filter((part) => part.key)
        .map((part) => part.key),
    ).toEqual([
      'gmail.scan.read',
      'gmail.scan.waiting',
      'gmail.scan.needsReply',
      'gmail.scan.nothing',
      'gmail.scan.interviews',
    ]);
    const { store: big } = load({ search: '?demo=large' });
    expect(page.gmailCard(big)?.lines?.map(wordsOf)).toEqual([
      expect.stringMatching(
        /^12 new job emails since .+: 4 moved their cards, 4 need your reply, 4 no change\. 3 were interview invites\.$/,
      ),
    ]);
    // Scan now says what it costs before you press it, and the runs Gmail used this month.
    expect(card?.scan).toMatchObject({
      label: 'Scan now',
      cost: 'uses 1 run',
      available: true,
      reason: '',
      runs: { key: 'gmail.runs.month', text: '2' },
    });
    const body = page.regions(store)['gmail-body'] ?? '';
    expect(body).toContain(
      '<div class="dash-gmail-scan"><button class="compact-action" type="button" data-gmail-scan data-focus-key="gmail-scan">Scan now</button><p class="dash-gmail-scan-cost"><span class="dash-nowrap">Uses 1 run;</span> Gmail used <span data-metric="gmail.runs.month">2</span> runs this month.</p></div>',
    );
    // R9-10: the latest three job emails stay (each opens its card), and how many more.
    expect(
      card?.emails?.map((email) => [email.from, email.kindLabel, email.short, email.href]),
    ).toEqual([
      [
        'Jamie Chen, Northwind Labs',
        'Needs your reply',
        '',
        './applications-preview.html?open=northwind-platform',
      ],
      [
        'Amazon Recruiting',
        'Interview invitation',
        'No change',
        './applications-preview.html?open=amazon-sde2',
      ],
      [
        'Riley Park, Northwind Labs',
        'Needs your reply',
        '',
        './applications-preview.html?open=northwind-backend',
      ],
    ]);
    expect(card?.emailsHead).toBe('');
    expect(card?.more).toEqual({ key: 'gmail.latest.more', text: '7' });
    // T7-17: each separator stays with the phrase before it, so a wrap never starts with "·".
    expect(body).toContain(
      '<span class="dash-gmail-when-part">Last <span data-metric="gmail.sync.lastTime">07:00</span> ·</span> <span class="dash-gmail-when-part">',
    );
    expect(shown(body)).toMatch(
      /^Daily scan at 07:00 of the last 48 hours\. Last 07:00 · \d+ hours? ago · next Sat, Oct 3, 07:00 6 new job emails since/,
    );
    expect(script).toContain("const ago = gmailBody.querySelector('[data-gmail-ago]');");
  });

  it('charts the last 7 days of job email by outcome, a bar a day (D3)', () => {
    const card = page.gmailCard(store);
    expect(
      card?.bars?.map((bar) => [
        bar.short,
        bar.metric,
        bar.parts.map((part) => part.value).join(','),
      ]),
    ).toEqual([
      ['S', 'gmail.day.2026-09-26.read', '0,0,0,0,0'],
      ['S', 'gmail.day.2026-09-27.read', '0,0,0,0,0'],
      ['M', 'gmail.day.2026-09-28.read', '0,0,0,0,0'],
      // T6-R2: an email added the phone screen to its card (Card updated); ST counts each email
      // on the day a scan read it (Tuesday's 07:00 scan).
      ['T', 'gmail.day.2026-09-29.read', '0,0,0,1,1'],
      ['W', 'gmail.day.2026-09-30.read', '0,0,0,0,0'],
      ['T', 'gmail.day.2026-10-01.read', '0,0,0,0,2'],
      ['F', 'gmail.day.2026-10-02.read', '0,2,2,0,2'],
    ]);
    expect(page.WEEK_PARTS.map((part) => part.id)).toEqual([
      'moved',
      'waiting',
      'reply',
      'updated',
      'rest',
    ]);
    expect(card?.bars?.at(-1)?.tip).toBe(
      'Fri, Oct 2: 6 job emails read, 2 moves wait, 2 need your reply',
    );
    // T7-F2: a day keeps to one line in Show the numbers.
    expect(card?.bars?.[0]?.label).toBe('Sat, Sep 26');
    // The shared stacked bars draw it into its own host, beside the card's words (so a redraw of
    // the words never redraws the chart).
    expect(script).toContain("title: 'Job emails by day, the last 7 days',");
    expect(script).toContain('series: WEEK_PARTS,');
    expect(main).toMatch(
      /<div class="dash-gmail-body" id="gmail-body">[\s\S]*?<\/div>\s*<details class="dash-fold dash-gmail-week" id="gmail-week" open>\s*<summary class="dash-fold-summary">Show the 7 day chart<\/summary>\s*<div class="dash-gmail-days" id="gmail-days" data-skeleton="chart"><\/div>\s*<\/details>/,
    );
    // On phones the chart starts folded behind that line (T2-12); wider screens always show it.
    expect(script).toContain("const phone = window.matchMedia('(max-width: 720px)');");
    expect(script).toContain('fold.open = !phone.matches;');
    expect(styles).toMatch(
      /@media \(width > 720px\) \{\s*\.dash-fold > \.dash-fold-summary \{\s*display: none;/,
    );
  });

  it('scans now for one run, says what it found, and keeps the latest emails (D3, R9-10)', () => {
    const { store: scanned } = load();
    const result = (
      scanned as unknown as {
        gmailScan(): Result & {
          moved: string[];
          waiting: number;
          needsReply: number;
          scan: { read: number };
        };
      }
    ).gmailScan();
    expect(result).toMatchObject({ ok: true, moved: [], waiting: 1, needsReply: 1 });
    const card = page.gmailCard(scanned);
    expect(card?.last).toEqual({ key: 'gmail.sync.lastTime', text: '14:00' });
    expect(card?.lines?.map(wordsOf)).toEqual([
      '2 new job emails since the 07:00 scan: 1 waits for your signature, 1 needs your reply.',
    ]);
    expect(card?.scan?.runs).toEqual({ key: 'gmail.runs.month', text: '3' });
    // The rows: the newest first, named the latest when an earlier scan read some (R9-10).
    expect(card?.emailsHead).toBe('Latest job emails');
    expect(card?.emails?.map((email) => [email.from, email.read])).toEqual([
      ['Amazon Recruiting', '14:00'],
      ['Northwind Labs Careers', '14:00'],
      ['Jamie Chen, Northwind Labs', '07:00'],
    ]);
    // The page says it once, uses the store's words for a refusal, and the deputy reacts once.
    expect(script).toContain('const result = store.gmailScan();');
    expect(script).toContain("announce(result?.text ?? 'Your deputy couldn’t scan Gmail now.');");
    expect(script).toMatch(/It used 1 run\.`/);
    // A scan the store refuses (Gmail not connected, or no runs) is off with its reason.
    const off = page.gmailMarkup({
      ...card,
      scan: {
        ...(card?.scan ?? {}),
        available: false,
        reason: 'No runs are left this month. Get more runs, or wait for Sun, Nov 1.',
        action: { text: 'Get more runs', href: './shop-preview.html#buy' },
      },
    } as Gmail);
    expect(off).toContain(
      'data-gmail-scan data-focus-key="gmail-scan" disabled aria-describedby="gmail-scan-why">Scan now</button>',
    );
    // The reason is one tight paragraph; its action follows on its own line, outside the
    // sentence, so the 44px target never opens a gap in it (T5-26).
    expect(off).toContain(
      '<p class="dash-gmail-scan-why" id="gmail-scan-why">No runs are left this month. Get more runs, or wait for Sun, Nov 1.</p><a class="chart-action" href="./shop-preview.html#buy" data-return-link data-focus-key="gmail-scan-action">Get more runs</a></div>',
    );
    // With no runs left the words say when they come back and the link says Get more runs, so it
    // is said once (T7-R7).
    const { store: spent } = load();
    const left = (spent as unknown as { runway(): { runs: { left: number } } }).runway().runs.left;
    spent.update({ type: 'world' }, (next) => {
      const world = next.world as { used: unknown[] };
      for (let index = 0; index < left; index += 1) {
        world.used.push({
          runId: `x${index}`,
          sourceId: 'google',
          at: '2026-10-02T10:00:00-07:00',
          via: 'you',
        });
      }
    });
    const none = page.gmailCard(spent)?.scan;
    expect([none?.available, none?.reason, none?.action]).toEqual([
      false,
      'No runs are left until Sun, Nov 1.',
      { text: 'Get more runs', href: './shop-preview.html#buy' },
    ]);
  });

  it('says Connect Gmail when it isn’t connected, with what scanning does and costs', () => {
    const off = page.gmailCard({
      gmailSync: () => ({
        connected: false,
        last: null,
        next: null,
        connectHref: './connections-preview.html#gmail',
      }),
      gmailScans: () => ({
        connected: false,
        last: null,
        time: '07:00',
        windowHours: 48,
        href: './connections-preview.html#gmail',
      }),
    } as unknown as Store);
    expect(off).toMatchObject({ connected: false, href: './connections-preview.html#gmail' });
    // T7-15: one short block, the words and the button together.
    expect(page.gmailMarkup(off)).toBe(
      '<div class="dash-gmail-off"><p class="dash-gmail-gist">Connect Gmail and every morning at 07:00 your deputy reads the last 48 hours of job email, links each to its card, and lists what needs you. Each scan uses 1 run.</p><a class="chart-action" href="./connections-preview.html#gmail" data-focus-key="gmail-connect">Connect Gmail</a></div>',
    );
    expect(script).toContain('gmailWeek.hidden = !card?.connected || !card.bars?.length;');
  });

  it('shows Usage over a range you pick: the tokens by model and key, the runs by use, the combinations (D9)', () => {
    const card = page.usageCard(store);
    // Last 30 days by default, as Usage and Prompts (T6-6); See all opens Usage grouped by model.
    expect(page.USAGE_RANGE).toBe('30d');
    expect(card).toMatchObject({
      range: '30d',
      month: false,
      href: './usage-preview.html?group=model',
    });
    expect(card?.total).toEqual({ key: 'usage.30d.tokens', text: '337,418' });
    // Each model named with the key or credits that paid for it in the range.
    expect(card?.chart?.groups.map((group) => [group.id, group.label])).toEqual([
      ['gpt-5-mini', 'gpt-5-mini · Your OpenAI key'],
      ['ministral-3-14b', 'Ministral 3 14B · Platform credits'],
      ['gpt-5', 'gpt-5 · Your OpenAI key'],
    ]);
    expect(card?.chart?.totals.tokens).toBe(337418);
    expect(card?.chart?.step).toBe('day');
    // What used the runs in the range: the store's query for it (keys exist for This month).
    expect(card?.runs.map((row) => [row.label, row.figure])).toEqual([
      ['Searches you start', { text: '9' }],
      ['Keep watch', { text: '2' }],
      ['Gmail scans', { text: '4' }],
      ['Daily email', { text: '0' }],
    ]);
    // The combination in use when the range began, in the store's line (T5-18); the chart marks
    // the ones inside the range, so the words never repeat them, and one that ended before the
    // range is not listed (T5-11).
    expect(card?.settings.map((entry) => entry.text)).toEqual([
      'Tue, Sep 1: Platform credits with Ministral 3 14B, until Tue, Sep 8',
    ]);
    expect(page.usageCard(store, '1h')?.settings.map((entry) => entry.text)).toEqual([
      'Tue, Sep 15: Your OpenAI key with gpt\u20115\u2011mini',
    ]);
    expect(card?.moreSettings).toBe(0);
    expect(shown(page.usageTotalMarkup(card))).toBe('337,418 tokens');
    // This month: its tokens and what used the runs carry their keys (R10-9: everything is runs).
    const month = page.usageCard(store, 'month');
    expect(month?.total).toEqual({ key: 'usage.month.tokens', text: '60,710' });
    expect(month?.runs.map((row) => row.figure)).toEqual([
      { key: 'runs.used.search', text: '2' },
      { key: 'runs.used.watch', text: '2' },
      { key: 'runs.used.gmail', text: '2' },
      { key: 'runs.used.summary', text: '0' },
    ]);
    expect(month?.href).toBe('./usage-preview.html?range=month&group=model');
    // Another preset: its tokens' key; what used the runs is a query, without keys.
    const week = page.usageCard(store, '1w');
    expect(week?.total).toEqual({ key: 'usage.1w.tokens', text: '107,535' });
    expect(week?.runs.every((row) => !('key' in row.figure))).toBe(true);
    expect(week?.href).toBe('./usage-preview.html?range=1w&group=model');
    expect(page.usageRunsMarkup(week)).not.toContain('data-metric');
    const custom = page.usageCard(store, {
      from: '2026-09-01T00:00:00-07:00',
      to: '2026-09-30T00:00:00-07:00',
    });
    expect(custom?.total.key).toBeUndefined();
    expect(custom?.href).toBe(
      `./usage-preview.html?range=${encodeURIComponent('2026-09-01T00:00:00-07:00..2026-09-30T00:00:00-07:00')}&group=model`,
    );
    // The shared time range picker and the shared usage chart draw into their own hosts; a range
    // change redraws only Usage, kept in the address.
    expect(script).toContain('components.timeRange(usageRange, {');
    expect(script).toContain("param: 'range',");
    expect(script).toMatch(
      /const drawn = draw\(usageChart, \{\s*usage: card\.chart,\s*measure: 'tokens',/,
    );
    expect(openTag(home, 'usage-all')).toContain('data-return-link');
    // Gmail (narrow) beside Usage (wide), under Prompts.
    expect(rowsOf(main)[1]).toEqual(['is-narrow-first', ['dash-gmail', 'dash-usage']]);
    expect(styles).toMatch(
      /@container dash-usage \(width >= 620px\) \{\s*\.dash-usage-split \{\s*grid-template-columns: minmax\(0, 1\.618fr\) minmax\(0, 1fr\);/,
    );
  });
});

describe('every colour explains itself, in the palette’s words (R3-5, D1)', () => {
  const { store } = load();

  it('reads the names, tones, and meanings of fit and stages from the store, never its own', () => {
    const jobs = page.jobsTile(store);
    expect(jobs.parts.map((part) => [part.id, part.label, part.tone, part.meaning])).toEqual(
      store.FITS.map((fit) => [fit.id, fit.label, fit.tone, fit.meaning]),
    );
    const apps = page.appsTile(store);
    expect(apps.parts.map((part) => [part.id, part.label, part.tone, part.meaning])).toEqual(
      store.STAGES.filter((stage) => stage.tone && stage.id !== 'offer').map((stage) => [
        stage.id,
        stage.label,
        stage.tone,
        stage.meaning,
      ]),
    );
    expect(store.STAGES.find((stage) => stage.id === 'closed')?.tone).toBeNull();
    for (const entry of [...store.FITS, ...store.STAGES]) {
      expect(script, entry.id).not.toContain(entry.meaning);
    }
    expect(script).not.toMatch(/FIT_WORDS|STAGE_WORDS|SOURCE_TONES|TONE_CYCLE/);
    // The feature names come from the store: Keep watch in the foot of Job matches and in Runs
    // and tokens' tip.
    expect(wordsOf(page.jobsFoot(store)?.words)).toContain(store.TERMS.watch);
    expect(page.runsTile(store).labelTip).toContain(store.TERMS.watch);
  });

  it('names each colour as the shared palette does: charcoal, hatched grey, teal, indigo, gold, wine', () => {
    // The page's fallback words are the components' (app-components.js PALETTE), which win when
    // the components load.
    const components = sourceFor('app-components.js');
    const palette =
      components.match(/const PALETTE = Object\.freeze\((\{[\s\S]*?\})\);\n/)?.[1] ?? '';
    const shared = runInNewContext(
      `(${palette.replace(/Object\.freeze\(/g, '(').replace(/\[\.\.\.SERIES_TONES\]/, JSON.stringify(page.PALETTE_WORDS.series))})`,
      {},
    ) as Page['PALETTE_WORDS'];
    expect(page.PALETTE_WORDS).toEqual(shared);
    expect(script).toContain('const shared = globalThis.JobDeputyComponents?.palette ?? {};');
    // The words in use: no black, no green left, no blue added.
    const runs = page.tourHosts(store)['tile-runs']?.text ?? '';
    const all = [
      page.jobsTile(store).tourText,
      page.appsTile(store).tourText,
      runs,
      page.runsTile(store).labelTip,
    ].join(' ');
    expect(all).not.toMatch(/\bblack\b|green is left|blue (?:is|was|were) added/i);
    expect(page.appsTile(store).tourText).toContain('charcoal Tailoring');
    // Runs and tokens' step names both rings' colours: indigo runs, teal tokens, hatched grey used.
    expect(runs).toContain('indigo runs left, teal tokens left, hatched grey used');
    expect(page.runsTile(store).labelTip).toContain(
      'Hatched grey is used, indigo runs left, teal tokens left.',
    );
  });

  it('gives every key item a tip with its name, count, meaning, and destination', () => {
    const all = Object.values(page.regions(store)).join('');
    const items = [...all.matchAll(/<a class="chart-key-item"[^>]*>/g)].map((match) =>
      attrsOf(match[0]),
    );
    // Three fits and five stages (the shared charts' keys carry their own tips).
    expect(items.length).toBe(3 + 5);
    for (const item of items) {
      expect(item['data-tip-title'], item.href).toMatch(/ · [\d,]+ roles?$/);
      expect(item['data-tip'], item.href).toMatch(/Opens .+\.$/);
    }
    const strong = store.FITS.find((fit) => fit.id === 'strong')?.meaning ?? '';
    expect(page.jobsTileMarkup(page.jobsTile(store))).toContain(
      `data-tip-title="Strong fit · 4 roles" data-tip="${strong} Opens Job matches filtered to Strong fit."`,
    );
    expect(page.jobsTileMarkup(page.jobsTile(store))).toContain(
      `<span class="chart-key-meaning">${strong}</span>`,
    );
    for (const id of ['tile-jobs', 'tile-apps']) {
      expect(inner(home, id), id).toContain('<div class="donut is-tile" data-tour-step="');
      expect(inner(home, id), id).toContain('<ul class="chart-key is-compact is-inline"');
    }
  });

  it('explains every bar and row with a tip', () => {
    const regions = page.regions(store);
    for (const id of ['keyword-bars', 'usage-runs']) {
      const rows = [...(regions[id] ?? '').matchAll(/<a class="hbar-row[^"]*"[^>]*>/g)];
      expect(rows.length, id).toBeGreaterThanOrEqual(4);
      for (const row of rows)
        expect(row[0], id).toMatch(
          /data-tip-title="[^"]+ · [\d,]+ (?:roles?|runs?)" data-tip="[^"]*Opens /,
        );
    }
    expect(regions['usage-runs']).toContain(
      'data-tip-title="Keep watch · 2 runs" data-tip="Keep watch’s nightly checks: one run for each source it checks. Opens Usage in Settings."',
    );
    for (const id of ['todo-list', 'news-list']) {
      const rows = [...(regions[id] ?? '').matchAll(/class="dash-todo-link"[^>]*>/g)];
      expect(rows.length, id).toBeGreaterThanOrEqual(4);
      for (const row of rows)
        expect(row[0], id).toMatch(/data-tip-title="[^"]+" data-tip="[^"]*Opens /);
    }
    // The heads' links and the feet's actions say where they go.
    for (const id of [
      'jobs-head',
      'apps-head',
      'runs-head',
      'jobs-foot',
      'apps-foot',
      'runs-foot',
    ]) {
      for (const link of (regions[id] ?? '').matchAll(/<(?:a|button)\b[^>]*>/g)) {
        expect(link[0], id).toMatch(/data-tip-title="[^"]+" data-tip="[^"]+"/);
      }
    }
  });

  it('keeps every drawing’s pointer links paired with a keyboard path to the same place', () => {
    for (const art of main.matchAll(/<div class="(?:bar-chart-plot|stack-bar[^"]*)"[^>]*>/g)) {
      expect(art[0]).toContain('aria-hidden="true"');
    }
    // None in the first paint: the donuts' segments are drawn by the components from their keys
    // (the keyboard path), and the shared charts carry their own Show the numbers.
    const pointerOnly = [...main.matchAll(/<a\b[^>]*\shref="([^"]+)"[^>]*\stabindex="-1"/g)];
    expect(pointerOnly).toHaveLength(0);
  });
});

describe('the tour (R3-6): the deputy gives it (round 6, R6-2; round 7, the new tiles)', () => {
  it('explains each tile, ring, colour, list, and card in the deputy’s words, in twelve steps in page order', () => {
    // Round 7: the glance's tiles and parts (the automation split and Runs and tokens are new),
    // the locked To-do and What's new, then Prompts, Gmail, Usage, and Keywords by role. The D7
    // cards left with their steps.
    expect(Object.entries(page.TOUR).map(([name, step]) => [step.step, name, step.title])).toEqual([
      [1, 'found', 'These are your matches.'],
      [2, 'search', 'This is my latest search.'],
      [3, 'applications', 'These are roles you pursue.'],
      [4, 'automation', 'This is who did each step.'],
      [5, 'interview', 'I keep your interviews in view.'],
      [6, 'yours', 'These are your runs and tokens.'],
      [7, 'todo', 'This is what needs you.'],
      [8, 'news', 'This is what’s new.'],
      [9, 'prompts', 'These are all my prompts.'],
      [10, 'gmail', 'This is my Gmail check.'],
      [11, 'usage', 'This is what I used.'],
      [12, 'keywords', 'These skills come up most.'],
    ]);
    const { store } = load();
    const { store: platform } = load();
    platform.setAiChoice('platform');
    const { store: off } = load();
    off.setAiChoice('none');
    const dynamic: Array<[string, string]> = [
      ['Job matches colours', page.jobsTile(store).tourText],
      ['Applications colours', page.appsTile(store).tourText],
      ['Runs and tokens on your key', page.tourHosts(store)['tile-runs']?.text ?? ''],
      ['Runs and tokens on platform credits', page.tourHosts(platform)['tile-runs']?.text ?? ''],
      ['Runs and tokens with Deputy Assist off', page.tourHosts(off)['tile-runs']?.text ?? ''],
      ['Keywords', page.keywordCard(store).tourText],
    ];
    const texts = [
      ...Object.values(page.TOUR).map((step): [string, string] => [step.title, step.text]),
      ...dynamic,
    ];
    for (const [title, value] of texts) {
      expect(value.split(/(?<=\.)\s/).length, title).toBeLessThanOrEqual(2);
      expect(words(value), title).toBeLessThanOrEqual(28);
      // No figure is written into the tour; the tiles carry them.
      expect(value, title).not.toMatch(/\d/);
      expect(value, title).not.toMatch(/[–—]/);
    }
    // The title is the deputy's speech line (at most six words), and he speaks for himself: every
    // step's words say I, me, or my (R6-2).
    for (const step of Object.values(page.TOUR)) {
      expect(words(step.title), step.title).toBeLessThanOrEqual(6);
    }
    for (const [title, value] of texts) {
      expect(value, title).toMatch(/\b(?:I|I’m|I’ll|me|my)\b/);
      expect(value, title).not.toMatch(/\byour deputy\b/i);
    }
    // Every step is on the page, once, in page order, with its title and text.
    const steps = [
      ...home.matchAll(
        /data-tour-step="(\d+)"\s+data-tour-title="([^"]+)"\s+data-tour-text="([^"]+)"/g,
      ),
    ].map((match) => Number(match[1]));
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const [id, step] of Object.entries(page.tourHosts(store))) {
      expect(home, id).toContain(page.tourAttrs(step.name, step.text));
    }
    expect(home).toContain(page.tourAttrs('found', page.jobsTile(store).tourText));
    expect(home).toContain(page.tourAttrs('applications', page.appsTile(store).tourText));
    expect(home).toContain(page.tourAttrs('interview'));
    // The colour steps name each colour the tile shows, in the palette's words.
    expect(page.jobsTile(store).tourText).toBe(
      'I count every role once and give it a fit: green Strong fit, blue Good fit, grey Stretch. Open a colour, or To review, for those roles.',
    );
    expect(page.appsTile(store).tourText).toBe(
      'I track each role you pursue by stage: grey Shortlisted, charcoal Tailoring, orange Approval, blue Applied, green Interviewing. Open a colour for that stage in Applications.',
    );
    // One step for both rings whatever runs the AI: it names their colours.
    expect(dynamic.slice(2, 5).map(([, value]) => value)).toEqual(
      Array(3).fill(
        'Each search, scan, and daily email uses a run; my AI uses tokens: indigo runs left, teal tokens left, hatched grey used. I say how long they last.',
      ),
    );
    // render() keeps every step's words as the store changes.
    expect(script).toContain("setAttribute(element, 'data-tour-text', step.text);");
  });

  it('rings the surfaces and parts each step explains, and every step’s target is on the page', () => {
    for (const [id, step] of [
      ['tile-search', 2],
      ['apps-auto', 4],
      ['tile-runs', 6],
      ['dash-todo', 7],
      ['dash-news', 8],
      ['dash-prompts', 9],
      ['dash-gmail', 10],
      ['dash-usage', 11],
      ['dash-keywords', 12],
    ] as const) {
      expect(openTag(home, id), id).toContain(`data-tour-step="${step}"`);
    }
    // Each donut's step rings its donut and key together; the Interview line is its own step,
    // and says so when no interview is booked yet (round 6, D5).
    const { store } = load();
    expect(page.jobsTileMarkup(page.jobsTile(store))).toContain(
      '<div class="donut is-tile" data-tour-step="1" data-tour-title="These are your matches."',
    );
    expect(page.appsTileMarkup(page.appsTile(store))).toContain(
      '<div class="donut is-tile" data-tour-step="3" data-tour-title="These are roles you pursue."',
    );
    expect(page.appsFootMarkup(page.appsTile(store))).toContain(
      'data-focus-key="apps-interview" data-tour-step="5" data-tour-title="I keep your interviews in view." data-tour-text="Your next interview is here. Open it and I show the role, so you can get ready.">Interview ',
    );
    const none = {
      ...page.appsTile(store),
      interview: null,
      interviewTourText: 'When an interview is booked, I show it here, so you can get ready.',
    };
    expect(page.appsFootMarkup(none as unknown as Tile)).toBe(
      '<span class="kpi-split-line" data-tour-step="5" data-tour-title="I keep your interviews in view." data-tour-text="When an interview is booked, I show it here, so you can get ready.">No interview yet</span>',
    );
    // The rings, the runway, the lists, the bars, and the charts carry no step of their own.
    for (const id of [
      'runs-rings',
      'runs-runway',
      'keyword-bars',
      'prompts-list',
      'gmail-body',
      'usage-chart',
    ]) {
      expect(openTag(home, id), id).not.toContain('data-tour-step');
    }
    for (const step of Object.values(page.TOUR)) {
      expect(step.text, step.title).not.toMatch(/\b(?:below|above|beside|on the (?:left|right))\b/);
    }
  });

  it('gives the first run its own first step, inside its named tour', () => {
    const wrap =
      home.match(
        /<div class="dash-first-wrap" id="dash-first-wrap" data-tour="first-run" hidden>[\s\S]*?<\/section>/,
      )?.[0] ?? '';
    expect(wrap).toContain('data-tour-step="0"');
    // The deputy speaks the first step too (R6-2).
    expect(wrap).toContain('data-tour-title="I’m on your first search."');
    expect(script).toContain(
      "if (newAccount) homeMain.setAttribute('data-tour-page', 'first-run');",
    );
    expect(script).toContain("firstCard.setAttribute('data-tour-title', first.tourTitle);");
  });

  it('starts after setup, from ?tour=1 and Take the tour, never by itself, and ends with a celebration', () => {
    // The shared page intro holds Take the tour, at the end of the title row (round 6, R6-3);
    // round 7 adds the daily email's line under the lede (D8), in the copy.
    expect(
      markup(inner(home, 'main').match(/<section class="page-intro[\s\S]*?<\/section>/)?.[0] ?? ''),
    ).toBe(
      markup(
        `<section class="page-intro home-intro" aria-labelledby="home-title"><div class="page-intro-copy"><p class="eyebrow" id="dash-date">Friday, October 2</p><h1 id="home-title">Welcome back, Alex.</h1><p class="intro-copy" id="dash-intro">Your search today.</p><div class="dash-email" id="dash-email">${inner(home, 'dash-email')}</div><p class="dash-week" id="dash-week">${inner(home, 'dash-week')}</p></div><div class="page-intro-actions"><button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour</button></div></section>`,
      ),
    );
    expect(styles).not.toMatch(/\.home-intro\s*\{/);
    expect(script).toContain(
      "components?.tour?.maybeStart(newAccount ? 'first-run' : undefined, {\n        from: previewParameters.get('from') ?? undefined,\n      });",
    );
    expect(script).toContain(
      "if (event.detail?.type === 'end' && event.detail.reason === 'done') {",
    );
    expect(script).toContain("deputy?.react?.('celebrate');");
    expect(script).not.toMatch(/tour\??\.start\(/);
  });
});

describe('the first run, the sign-in notes, and the chrome hooks', () => {
  it('leads the first run with its first search, or asks for a first source (?state=new)', async () => {
    const { store, clock } = load();
    expect(page.firstRun(store, { newAccount: false })).toBeNull();
    // A review link straight here: the newest search, Amazon Jobs, is the first one.
    expect(page.firstRun(store, { newAccount: true })).toMatchObject({
      kind: 'running',
      title: 'Your first search is running.',
      line: 'Amazon Jobs · Software engineer roles',
      action: 'Watch it live',
      // Searches lands on the run it names (round 6, D1).
      href: './searches-preview.html?source=amazon&run=r11&live=1',
      tourTitle: 'I’m on your first search.',
    });
    expect(page.introFor(page.firstRun(store, { newAccount: true }))).toEqual({
      title: 'Welcome, Alex.',
      line: 'Your deputy is set up and looking.',
    });
    expect(page.introFor(null)).toEqual({
      title: 'Welcome back, Alex.',
      line: 'Your search today.',
    });
    // When it finishes, its new roles are a click away: that run's roles only (F2's request 1).
    seconds(clock, 120);
    store.metric('jobs.found');
    await flush();
    expect(page.firstRun(store, { newAccount: true })).toMatchObject({
      kind: 'finished',
      action: 'See its new roles',
      href: './jobs-preview.html?view=new&source=amazon&run=r11',
    });
    store.update({ type: 'onboarding' }, (next) => {
      next.onboarding = { completed: true, firstSource: 'https://www.stripe.com/jobs/search/' };
    });
    expect(page.firstRun(store, { newAccount: true })).toMatchObject({
      kind: 'finished',
      line: 'Stripe Jobs · Software engineer roles',
    });
    store.update({ type: 'onboarding' }, (next) => {
      next.onboarding = { completed: false, skipped: true, firstSource: null };
    });
    const skipped = page.firstRun(store, { newAccount: true });
    expect(skipped).toMatchObject({
      kind: 'add',
      title: 'Add your first source.',
      action: 'Add your first source',
      href: './searches-preview.html?add=1',
      status: null,
    });
    expect(page.introFor(skipped).line).toBe('Your deputy is set up and ready to look.');
    // UAT-M, M-8: with setup steps still open on the To-do, the line points there, whatever the
    // first search is doing; render() passes the store's count.
    expect(page.introFor(skipped, { setupOpen: 2 })).toEqual({
      title: 'Welcome, Alex.',
      line: 'Your deputy is ready. Finish setup from your To-do when you like.',
    });
    expect(page.introFor(null, { setupOpen: 2 }).line).toBe('Your search today.');
    expect(script).toContain(
      "const intro = introFor(first, { setupOpen: amount(store, 'setup.open') });",
    );
  });

  it('says when setup’s first search did not start, in round 5’s reasons, without repeating a ring’s date', () => {
    const { store } = load();
    const google = 'https://www.google.com/about/careers/applications/jobs/results/';
    const attempt = (reason: string) =>
      store.update({ type: 'onboarding' }, (next) => {
        next.onboarding = {
          completed: true,
          firstSource: google,
          firstRun: { sourceId: 'google', started: false, reason },
        };
      });
    const cases: Array<[string, string, string, string]> = [
      [
        'credits-out',
        'Your platform credits are used up.',
        'Open AI & credits',
        './ai-preview.html#credits',
      ],
      [
        'own-key-limit-reached',
        'Your key reached the limit you set.',
        'Open AI & credits',
        './ai-preview.html#limit',
      ],
      ['key-not-ready', 'Your key isn’t ready yet.', 'Open AI & credits', './ai-preview.html#keys'],
      [
        'agreement-required',
        'Your deputy is paused until you sign the updated agreement.',
        'Review and sign',
        './agreement-preview.html?mode=update&return=home-preview.html%3FskipLoader%23dash-todo',
      ],
      [
        'archived',
        'Your deputy couldn’t start it.',
        'Open Searches',
        './searches-preview.html?source=google',
      ],
      // Setup's first search uses a run now (part 2, N3), so none left is a reason too.
      ['no-runs', 'No runs are left this month.', 'Get more runs', './shop-preview.html#nightly'],
    ];
    for (const [reason, line, action, href] of cases) {
      attempt(reason);
      const card = page.firstRun(store, { newAccount: true });
      expect(card, reason).toMatchObject({
        kind: 'not-started',
        title: 'Your first search didn’t start.',
        line,
        status: 'Not started',
        neutral: true,
        action,
        href,
      });
      for (const value of [card?.title, card?.line, card?.tourText]) {
        expect(value, reason).not.toMatch(/\d/);
      }
    }
    // No runs left says when they refresh, the store's date with its key, once on the page.
    attempt('no-runs');
    const noRuns = page.firstRun(store, { newAccount: true });
    expect(noRuns?.lineWords).toEqual([
      { text: 'No runs are left this month. They refresh ' },
      { key: 'runs.refreshesOn', text: store.metricText('runs.refreshesOn') },
      { text: '.' },
    ]);
    expect(page.wordsMarkup(noRuns?.lineWords ?? [])).toBe(
      `No runs are left this month. They refresh <span data-metric="runs.refreshesOn">${store.metricText('runs.refreshesOn')}</span>.`,
    );
    for (const reason of ['credits-out', 'archived']) {
      attempt(reason);
      expect(page.firstRun(store, { newAccount: true })?.lineWords, reason).toBeNull();
    }
    // No AI runs anywhere: the retired reason has no words of its own.
    expect(script).not.toContain('platform-ai-limit-reached');
    // A search you start later is live, so the card follows it again.
    expect(store.startRun('google', { via: 'you' }).ok).toBe(true);
    expect(page.firstRun(store, { newAccount: true })?.kind).toBe('running');
  });

  it('says when the first search stopped, in the store’s words, and asks for a source when skipped', () => {
    const { store } = load();
    store.update({ type: 'onboarding' }, (next) => {
      next.onboarding = { completed: true, firstSource: 'https://boards.greenhouse.io/acme' };
    });
    expect(page.firstRun(store, { newAccount: true })).toMatchObject({
      kind: 'stopped',
      title: 'Your first search stopped.',
      line: 'The page took too long to load.',
      status: 'Stopped',
      action: 'Open Searches',
      href: './searches-preview.html?source=acme',
    });
    store.update({ type: 'onboarding' }, (next) => {
      next.onboarding = {
        completed: false,
        skipped: true,
        firstSource: null,
        firstRun: { sourceId: 'google', started: false, reason: 'credits-out' },
      };
    });
    expect(page.firstRun(store, { newAccount: true })?.kind).toBe('add');
    expect(script).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected text is page source with a template literal
      "`<span class=\"status-pill${first.neutral ? ' is-neutral' : ''}\">${escapeHtml(first.status)}</span>`",
    );
    expect(script).toContain(
      "} else if (firstKind === 'add' || firstKind === 'not-started' || firstKind === 'stopped') {",
    );
  });

  it('says plainly in the first run that the rest of the page is a sample preview', () => {
    const { store } = load();
    const first = page.firstRun(store, { newAccount: true });
    expect(first?.preview).toBe(
      'Below is a preview with sample data: how your Dashboard fills up after a few searches. Your own roles appear as your first search finishes.',
    );
    expect(first?.tourText).toContain('Everything below is a preview with sample data');
    expect(text(inner(home, 'first-preview'))).toBe(first?.preview);
    expect(script).toContain("setText(document.querySelector('#first-preview'), first.preview);");
    for (const reason of ['credits-out', 'own-key-limit-reached', 'key-not-ready', 'archived']) {
      store.update({ type: 'onboarding' }, (next) => {
        next.onboarding = {
          completed: true,
          firstSource: 'https://www.google.com/about/careers/applications/jobs/results/',
          firstRun: { sourceId: 'google', started: false, reason },
        };
      });
      const card = page.firstRun(store, { newAccount: true });
      expect(card?.preview, reason).toContain('preview with sample data');
      expect(card?.tourText.split(/(?<=\.)\s/).length, reason).toBeLessThanOrEqual(2);
    }
  });

  it('runs the first-run deputy states with the dock’s own deputy', () => {
    expect(script).toContain("previewParameters.get('from') === 'onboarding'");
    expect(script).toContain("previewParameters.get('state') === 'new'");
    expect(script).toContain(
      "startDeputy('search', { working: true, speech: 'Checking your first source.' })",
    );
    expect(script).toContain("startDeputy('idle', { speech: 'Ready when you are.' })");
    expect(script).toContain("if (searching && firstKind !== 'running') startDeputy('report');");
    expect(script).toContain("deputy.flash('arrive')");
    expect(words('Checking your first source.')).toBeLessThanOrEqual(6);
    expect(inner(home, 'dash-first')).toContain('data-deputy-prop="magnifier"');
    expect(main).not.toMatch(/data-deputy-art/);
    // A new account has no week yet, so the sample week's line stays hidden (T1-19).
    expect(script).toContain("if (newAccount) document.getElementById('dash-week').hidden = true;");
    expect(script).toContain(
      "document.getElementById('dash-week').hidden = !markup['dash-week'] || newAccount;",
    );
  });

  it('says how a returning person signed in, LinkedIn included, in one dismissible line', () => {
    const { store } = load();
    const email = store.get().profile.email;
    expect(page.signinNote('google', email)).toBe(
      'Signed in with Google as alex.morgan@example.com',
    );
    expect(page.signinNote('linkedin', email)).toBe(
      'Signed in with LinkedIn as alex.morgan@example.com',
    );
    expect(page.signinNote('email', email)).toBe('Signed in with email as alex.morgan@example.com');
    expect(page.signinNote('onetap', email)).toBe(
      'Signed in with one tap as alex.morgan@example.com',
    );
    expect(page.signinNote('toString', email)).toBeNull();
    expect(page.signinNote(null, email)).toBeNull();
    const note =
      home.match(
        /<div class="feedback-panel has-action" id="signin-note" data-kind="success" hidden>[\s\S]*?<\/div>/,
      )?.[0] ?? '';
    expect(note).toContain(
      '<button class="feedback-panel-action" id="signin-dismiss" type="button" aria-describedby="signin-note-title">',
    );
    expect(note).not.toMatch(/role="(?:status|alert)"|aria-live/);
    expect(script).toContain(".filter((part) => part && !part.startsWith('signin='))");
    expect(script).toContain("deputy.flash('arrive', { speech: 'Welcome back, Alex.' })");
    expect(script).toContain("deputy.set('report', { speech: 'Welcome back, Alex.' })");
  });

  it('keeps the date line, the h1, the skip link, and the shell scripts in order', () => {
    const { store } = load();
    expect(page.dateLine(store)).toBe('Friday, October 2');
    expect(text(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')).toBe('Welcome back, Alex.');
    expect(main).toContain('<p class="eyebrow" id="dash-date">Friday, October 2</p>');
    expect(home).toContain('<a class="skip-link" id="skip-link" href="#home-title" inert>');
    const order = [
      'app-shell.js',
      'app-components.js',
      'prompt-guard.js',
      'agreement-text.js',
      'sample-store.js',
      'deputy.js',
      'feedback.js',
      'app-panels.js',
    ].map((file) => home.indexOf(`<script src="./${file}"></script>`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(home.indexOf('<script>')).toBeGreaterThan(order.at(-1) ?? 0);
    expect(script).not.toContain("document.querySelectorAll('.account-menu')");
  });

  it('labels every sample area', () => {
    const sections = [
      ...main.matchAll(
        /<section class="dash-section" id="([^"]+)"[\s\S]*?(?=<section class="dash-section"|<\/div>\s*<p class="sr-only" id="dash-announcement")/g,
      ),
    ];
    expect(sections.map((match) => match[1])).toEqual([
      'dash-glance',
      'dash-now',
      'dash-work',
      'dash-found',
    ]);
    for (const [body, id] of sections) {
      expect(body, `#${id}`).toMatch(
        /<p class="sample-note">Sample data · not connected<\/p>\s*<\/section>\s*$/,
      );
    }
    expect(inner(home, 'dash-first')).toContain(
      '<p class="sample-note">Sample data · not connected</p>',
    );
  });
});

describe('two additions the orchestrator approved: replies and interviews, and your deputy’s week (D11)', () => {
  // The store's figures for both lines (requested of ST, DB request 11): until they exist the
  // lines are not drawn; a store that has them draws them with their keys.
  const withFigures = (store: Store, figures: Record<string, string>): Store =>
    new Proxy(store, {
      get: (target, property) => {
        if (property === 'metricText')
          return (key: string) => figures[key] ?? target.metricText(key);
        if (property === 'metric')
          return (key: string) =>
            key in figures
              ? Number(String(figures[key]).replace(/[^\d.]/g, ''))
              : target.metric(key);
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const outcomes = {
    'apps.outcome.applied': '4',
    'apps.outcome.replied': '1',
    'apps.outcome.replyRate': '25%',
    'apps.outcome.interviews': '1',
  };
  const week = {
    'activity.week.deputy.rolesRead': '44',
    'activity.week.deputy.tailored': '3',
    'activity.week.deputy.applied': '1',
    'activity.week.deputy.emailsRead': '10',
    'activity.week.you.approved': '1',
    'activity.week.you.edited': '1',
  };

  it('says how many employers replied and how many reached an interview, at the foot of Applications', () => {
    const { store } = load();
    // The store's own line on the usual sample: 4 applied, 3 replied (75%), 1 interview.
    expect(page.outcomesMarkup(page.outcomesLine(store)).replace(/<[^>]+>/g, '')).toBe(
      '4 applied · 3 replied (75%) · 1 interview',
    );
    expect(page.regions(store)['apps-foot']).toContain('<span class="dash-outcomes">');
    const line = page.outcomesLine(withFigures(store, outcomes));
    expect(line?.map((part) => [part.id, wordsOf(part.words), part.href])).toEqual([
      ['applied', '4 applied', './applications-preview.html?stage=applied'],
      ['replied', '1 replied (25%)', './applications-preview.html#email'],
      ['interviews', '1 interview', './applications-preview.html?stage=interviewing'],
    ]);
    const markupOf = page.outcomesMarkup(line);
    expect(figuresIn(markupOf).map(([key]) => key)).toEqual([
      'apps.outcome.applied',
      'apps.outcome.replied',
      'apps.outcome.replyRate',
      'apps.outcome.interviews',
    ]);
    expect(markupOf.replace(/<[^>]+>/g, '')).toBe('4 applied · 1 replied (25%) · 1 interview');
    for (const tag of markupOf.matchAll(/<a\b[^>]*>/g))
      expect(tag[0]).toMatch(/data-tip-title="[^"]+" data-tip="[^"]*Opens /);
    expect(page.outcomesMarkup(null)).toBe('');
    // It shares the foot with the next interview, every link a 44px target.
    expect(script).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected text is page source with a template literal
      "'apps-foot': `${appsFootMarkup(apps)}${outcomesMarkup(outcomesLine(store))}`,",
    );
    expect(styles).toMatch(/\.dash-outcome \{\s*display: inline-flex;\s*min-height: 44px;/);
  });

  it('says what your deputy did this week and what you did, under the email’s switch, with See activity', () => {
    const { store } = load();
    // The store's own line on the usual sample, shipped in the first paint.
    expect(wordsOf(page.deputyWeek(store)?.words)).toBe(
      'This week your deputy checked 138 job listings, found 18 that fit, tailored 3, applied to 1, read 10 emails. You approved 1, edited 1.',
    );
    expect(inner(home, 'dash-week')).toBe(page.regions(store)['dash-week']);
    const line = page.deputyWeek(withFigures(store, week));
    expect(wordsOf(line?.words)).toBe(
      'This week your deputy checked 44 job listings, found 18 that fit, tailored 3, applied to 1, read 10 emails. You approved 1, edited 1.',
    );
    expect(line?.href).toBe('./activity-preview.html?who=deputy&range=1w');
    const markupOf = page.weekMarkup(line);
    expect(figuresIn(markupOf).map(([key]) => key)).toEqual([
      'activity.week.deputy.rolesRead',
      'activity.week.deputy.found',
      ...Object.keys(week).slice(1),
    ]);
    expect(markupOf).toMatch(
      /<a class="chart-action" href="\.\/activity-preview\.html\?who=deputy&amp;range=1w" data-return-link data-focus-key="week-activity">See activity<\/a>$/,
    );
    // It sits in the intro's copy under the switch, shipped with the seed's figures (hidden for a
    // store without them, and for a new account, T1-19).
    expect(main).toMatch(
      /<div class="dash-email" id="dash-email">[\s\S]*?<\/div>\s*<p class="dash-week" id="dash-week">/,
    );
    expect(script).toContain(
      "document.getElementById('dash-week').hidden = !markup['dash-week'] || newAccount;",
    );
    // Every figure of both lines once on the page, with the rest of the page's.
    const { store: both } = load();
    const all = figuresIn(
      Object.values(page.regions(withFigures(both, { ...outcomes, ...week }))).join(''),
    );
    expect(repeats(all.map(([key]) => key))).toEqual([]);
  });
});

describe('the daily email: opt in on the Dashboard, and a sample of what arrives (D8, R10-9)', () => {
  const email = sourceFor('summary-email-preview.html');
  const emailScript = email.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  type EmailPage = {
    emailModel(
      store: Store,
      date?: string,
    ): {
      subject: string;
      to: string;
      date: string;
      greeting: string;
      asOf: string;
      glance: Array<{
        id: string;
        label: string;
        figure: Figure | { text: string; key?: string };
        href: string;
      }>;
      todo: Array<{ id: string; title: string; detail: string; href: string }>;
      todoMore: number;
      changes: Array<{ id: string; text: string; when: string; href: string }>;
      dashboard: { label: string; href: string };
      footer: { why?: string; runs?: string; manageHref?: string };
    } | null;
    emailRegions(store: Store): Record<string, string> | null;
    backTo(search: string): { href: string; name: string };
  };
  const sample = blocks<EmailPage>(
    email,
    ['EmailModel', 'EmailViews'],
    ['emailModel', 'emailRegions', 'backTo'],
  );

  it('offers "Email me this every morning" in the intro, off by default, its cost said before you turn it on', () => {
    const { store } = load();
    const line = page.emailLine(store);
    expect(line).toEqual({
      on: false,
      label: 'Email me this every morning',
      cost: 'Uses 1 run each morning, at 08:00.',
      next: '',
      sampleHref: './summary-email-preview.html',
      manageHref: './account-preview.html#emails',
    });
    // The switch is the shared one (a native checkbox, role switch), its cost tied to it, and See
    // a sample with a way back (R10-3).
    expect(page.emailMarkup(line)).toBe(
      '<label class="switch"><input type="checkbox" role="switch" id="email-toggle" aria-checked="false" aria-describedby="email-cost" data-focus-key="email-toggle" /><span class="switch-track" aria-hidden="true"></span><span class="switch-label">Email me this every morning</span></label> <span class="switch-hint dash-email-cost" id="email-cost">Uses 1 run each morning, at 08:00.</span> <a class="chart-action" href="./summary-email-preview.html" data-return-link data-focus-key="email-sample">See a sample</a>',
    );
    // It sits in the intro's copy, under the lede (the shared intro keeps its layout, R6-3).
    expect(main).toMatch(
      /<p class="intro-copy" id="dash-intro">Your search today\.<\/p>\s*<div class="dash-email" id="dash-email">/,
    );
    // On: when the next one comes, and its home, Settings, Account; the runway counts it.
    expect(store.setSummarySubscription({ subscribed: true }).ok).toBe(true);
    const on = page.emailLine(store);
    expect(on).toMatchObject({ on: true, next: 'Next one Sat, Oct 3, 08:00.' });
    // On: the next email and its home instead of the cost and the sample, so the line keeps its
    // length and nothing under it moves.
    expect(page.emailMarkup(on)).toBe(
      '<label class="switch"><input type="checkbox" role="switch" id="email-toggle" aria-checked="true" aria-describedby="email-cost" data-focus-key="email-toggle" checked /><span class="switch-track" aria-hidden="true"></span><span class="switch-label">Email me this every morning</span></label> <span class="switch-hint dash-email-cost" id="email-cost">Next one Sat, Oct 3, 08:00.</span> <a class="chart-action" href="./account-preview.html#emails" data-return-link data-focus-key="email-manage">Manage in Account</a>',
    );
    expect(
      page.usageCard(store, 'month')?.runs.find((row) => row.id === 'summary')?.figure,
    ).toEqual({
      key: 'runs.used.summary',
      text: '0',
    });
    // The page saves the change at once, says it once, and the deputy reacts once.
    expect(script).toContain(
      'const result = store.setSummarySubscription({ subscribed: input.checked });',
    );
    expect(script).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected text is page source with a template literal
      "announce(line.on ? `Daily email on. ${line.next || line.cost}` : 'Daily email off.');",
    );
    expect(styles).toMatch(/\.dash-email \{\s*display: flex;\s*flex-wrap: wrap;/);
  });

  it('shows the email as it would arrive: the envelope, today’s figures, the To-do, what changed, and the live Dashboard', () => {
    const { store } = load();
    const model = sample.emailModel(store);
    expect(model).not.toBeNull();
    expect([model?.subject, model?.to, model?.date]).toEqual([
      'Your JobDeputy summary for Fri, Oct 2',
      'alex.morgan@example.com',
      'Friday, October 2',
    ]);
    // Today's glance as it stood when it was sent, 08:00 (T6-15): every figure the store's, with
    // its own key, once.
    expect(model?.glance.map((item) => [item.label, item.figure.key, item.figure.text])).toEqual([
      ['Runs left', 'summary.asOf.runs.left', '5'],
      ['Roles to review', 'summary.asOf.jobs.toReview', '23'],
      ['Waiting for your approval', 'summary.asOf.apps.waiting', '0'],
      ['Interviews coming up', 'summary.asOf.apps.interviews', '1'],
      ['Tokens left', 'summary.asOf.tokens.left', '242,820'],
    ]);
    const regions = sample.emailRegions(store) ?? {};
    const figures = figuresIn(Object.values(regions).join(''));
    expect(repeats(figures.map(([key]) => key))).toEqual([]);
    for (const [key, value] of figures) expect(value, key).toBe(store.metricText(key));
    // The To-do (the store's first five and how many more), what changed since yesterday's email
    // (who and when), and Open your live Dashboard.
    expect(model?.todo.map((item) => item.title)).toEqual([
      'Review and sign the updated agreement',
      'Approve materials for Search Infrastructure',
      'Runs last through Sat, Oct 3',
      'Prepare for the Northwind interview',
      'Fix the Acme source',
    ]);
    expect(model?.todoMore).toBe(1);
    expect(model?.changes.length).toBeGreaterThan(0);
    // Each says its day (T1-26): "Today, 07:00", "Yesterday, 15:00".
    for (const change of model?.changes ?? [])
      expect(change.when).toMatch(
        /^(?:You|Your deputy|JobDeputy) · (?:Today|Yesterday|\w{3}, \w{3} \d{1,2}), \d\d:\d\d$/,
      );
    expect(model?.dashboard).toEqual({
      label: 'Open your live Dashboard',
      href: './home-preview.html',
    });
    expect(email).toContain(
      '<a class="primary-action" id="email-open" href="./home-preview.html?skipLoader">Open your live Dashboard</a>',
    );
    // The sample's figures are this morning's (it was never sent), in the store's words under the
    // glance (T5-25).
    expect(model?.asOf).toBe(
      'A sample with this morning’s figures, as of 08:00; the To-do is as of now.',
    );
    expect(sample.emailModel(store, '2026-10-01')?.asOf).toBe(
      'A sample with Thu, Oct 1’s figures, as of 08:00; the To-do is as of now.',
    );
    // A past email (Activity's rows link ?date=, T5-17): its own day, its figures without keys.
    const past = sample.emailModel(load({ search: '?demo=large' }).store, '2026-10-01');
    expect([past?.subject, past?.date, past?.glance[0]?.figure.key]).toEqual([
      'Your JobDeputy summary for Thu, Oct 1',
      'Thursday, October 1',
      undefined,
    ]);
    // What changed is what happened from yesterday's email to this one's (08:00 to 08:00).
    expect(model?.changes.map((change) => change.when)).toContain('Your deputy · Today, 07:00');
    // A past email's items from the day before say Yesterday (T1-26).
    expect(
      sample.emailModel(load().store, '2026-10-01')?.changes.map((change) => change.when),
    ).toContain('Your deputy · Yesterday, 15:00');
    // The footer: why you get it, what it costs (R10-9), Unsubscribe, and the home Region.
    expect(text(regions['email-foot'] ?? '')).toBe(
      'You get this because you turned on the daily summary in Settings, Account. Each summary uses 1 run. Unsubscribe or change the time in Settings, Account. JobDeputy keeps your data in your home Region.',
    );
    // The first paint is the seed's render, so nothing is drawn twice (R10-1).
    for (const [id, html] of Object.entries(regions)) {
      expect(markup(inner(email, id)), `#${id}`).toBe(markup(html));
    }
  });

  it('is an email, not an app page: no app chrome, a sample label, and Back to where you came from', () => {
    // No header, sidebar, deputy, tour, or app footer (an email has none of them).
    for (const part of [
      'app-header',
      'app-sidebar',
      'deputy-dock',
      'data-tour-step',
      'site-footer',
      'page-loader',
      'deputy.js',
      'app-shell.js',
    ]) {
      expect(email, part).not.toContain(part);
    }
    // It keeps every page's rules: the canonical tokens (the Dashboard's block, byte for byte),
    // one h1, Alex Morgan and example.com only, the sample label, and no dashes.
    const rootOf = (html: string) => html.match(/:root \{[\s\S]*?\n {6}\}/)?.[0] ?? '';
    expect(rootOf(email)).toBe(rootOf(home));
    expect(email.match(/<h1\b/g)).toHaveLength(1);
    expect(email).toContain('<p class="sample-note">Sample email · nothing is sent</p>');
    expect(email).not.toMatch(/[\u2013\u2014]/);
    expect(email).not.toMatch(/@(?!example\.com)[a-z0-9-]+\.[a-z]/i);
    // Back to the Dashboard, or where ?return= says (a page of this prototype only).
    expect(sample.backTo('')).toEqual({
      href: './home-preview.html?skipLoader',
      name: 'Back to the Dashboard',
    });
    expect(sample.backTo('?return=home-preview.html%3FskipLoader%23dash-email')).toEqual({
      href: './home-preview.html?skipLoader#dash-email',
      name: 'Back to the Dashboard',
    });
    expect(sample.backTo('?return=account-preview.html%23emails')).toEqual({
      href: './account-preview.html#emails',
      name: 'Back to Account',
    });
    for (const unsafe of [
      '?return=https://evil.example.com',
      '?return=javascript:alert(1)',
      '?return=..%2Fsecret.html',
    ]) {
      expect(sample.backTo(unsafe).href, unsafe).toBe('./home-preview.html?skipLoader');
    }
    expect(emailScript).toContain('store?.subscribe?.(() => render());');
  });
});

describe('boot without flicker (G2, R10-1)', () => {
  it('draws the first view in place: no fade, the redrawn hosts held as skeletons of their size, one reveal', () => {
    // The main shows at once (round 7: the old 380ms fade read as a flicker with skipLoader).
    expect(styles).not.toMatch(/\.home-main\s*\{[^}]*opacity: 0/);
    expect(script).not.toContain("homeMain.classList.add('is-ready')");
    // The regions the shared components draw are the shared skeleton until the first render is
    // done, and the page reveals them in one frame (the shared boot, with its failsafe).
    const held = [...main.matchAll(/\sid="([^"]+)"[^>]*\sdata-skeleton="([a-z]+)"/g)].map(
      (match) => [match[1], match[2]],
    );
    // The bands under the glance are held too, until the whole first render is done: the first
    // render draws the glance at once and the rest after a yield on a slow device (T3-5).
    expect(held).toEqual([
      ['runs-rings', 'block'],
      ['runs-runway', 'lines'],
      ['dash-now', 'block'],
      ['dash-work', 'block'],
      ['gmail-days', 'chart'],
      ['usage-chart', 'chart'],
      ['dash-found', 'block'],
    ]);
    expect(script).toMatch(
      /render\(\)\.then\(\(\) => \{\s*startRange\(\);\s*components\?\.boot\?\.ready\?\.\(\);/,
    );
    expect(script).toContain('return components.boot.split(steps, { budget: 40 });');
    // Live changes morph in place (R9-3, T3-19) and come at most once a frame, the bands yielding
    // between them; a work tick's progress, or a part the Dashboard doesn't show, draws nothing.
    expect(script).toContain('morphChildren(element, next.content);');
    expect(script).toContain('window.requestAnimationFrame(() => {');
    expect(script).toContain('if (change?.progress) return;');
    // Every other region ships the seed's render (the test above), so the usual sample's first
    // paint is its last.
  });
});

describe('links, words, and voice', () => {
  it('opens the page and filter behind every part (brief 4.1 and R3-5)', () => {
    const hrefs = new Set(
      [...main.matchAll(/\shref="([^"]+)"/g)].map((match) =>
        (match[1] ?? '').replace(/&amp;/g, '&'),
      ),
    );
    expect([...hrefs].sort()).toEqual(
      [
        // D11: your deputy's week opens Settings, Activity filtered to it and the week.
        './activity-preview.html?who=deputy&range=1w',
        './agreement-preview.html?mode=update&return=home-preview.html%3FskipLoader%23dash-todo',
        // Runs and tokens' Change opens What runs your deputy's AI (its home).
        './ai-preview.html#ai',
        './applications-preview.html',
        // Gmail's See the emails.
        './applications-preview.html#email',
        // The latest job emails, each opening its card; the next interview.
        './applications-preview.html?open=amazon-sde2',
        './applications-preview.html?open=northwind-backend',
        './applications-preview.html?open=northwind-platform',
        // The stages, and the roles waiting for your approval (D5).
        './applications-preview.html?show=need',
        './applications-preview.html?stage=applied',
        './applications-preview.html?stage=approval',
        './applications-preview.html?stage=interviewing',
        './applications-preview.html?stage=shortlisted',
        './applications-preview.html?stage=tailoring',
        './documents-preview.html#keywords',
        './jobs-preview.html?view=all',
        './jobs-preview.html?view=all&fit=good',
        './jobs-preview.html?view=all&fit=strong',
        './jobs-preview.html?view=all&fit=stretch',
        // The review queue (J2), Job matches' default view, and Not for me (T1-21).
        './jobs-preview.html',
        './jobs-preview.html?view=not-for-me',
        './materials-preview.html?app=search-infra&from=applications',
        './profile-preview.html#field-profile.postalCode',
        // Open Prompts (each prompt's own Open in Prompts is its shared summary's, R10-5).
        './prompts-preview.html',
        // Keep watch's next check opens Keep watch in Searches; each link into a search names
        // its run (round 6, D1).
        './searches-preview.html#keep-watch',
        './searches-preview.html?source=acme',
        './searches-preview.html?source=amazon&run=r11&live=1',
        './shop-preview.html#bundles',
        // Get more runs: buying's one home, Purchases, at its quick buy (R10-3).
        './shop-preview.html#buy',
        // The daily email's sample (D8).
        './summary-email-preview.html',
        './trust-preview.html?guide=credits-at-aws-prices#guides',
        './trust-preview.html?guide=review-then-apply#guides',
        // Usage: See all in Usage and each use of runs (grouped by model, on its default range),
        // and Runs and tokens at its runway (D10).
        './usage-preview.html?group=model',
        './usage-preview.html#runway',
      ].sort(),
    );
    // Every link to a home carries a way back (R10-3, the shared place helper adds return=).
    for (const id of ['usage-all', 'email-sample']) {
      const tag =
        main.match(new RegExp(`<a\\b[^>]*(?:id="${id}"|data-focus-key="${id}")[^>]*>`))?.[0] ?? '';
      expect(tag, id).toContain('data-return-link');
    }
    expect(inner(home, 'runs-head')).toContain(
      'href="./usage-preview.html#runway" data-return-link',
    );
  });

  it('names every chart link with where it goes, for screen readers', () => {
    for (const link of main.matchAll(
      /<a class="(?:chart-key-item|donut-total|hbar-row)"[\s\S]*?<\/a>/g,
    )) {
      expect(link[0], link[0].slice(0, 80)).toMatch(
        /<span class="sr-only">[^<]*Open[^<]*<\/span>(?:<\/span>)?<\/a>$/,
      );
    }
  });

  it('keeps the prose to 420 words at 1440 (chart keys, list data, and table cells are data; tips and closed details do not count)', () => {
    // What a fine pointer at 1440 shows: no visually hidden text, no compact-key meanings (they
    // are tooltips there), nothing hidden, and only the summary of a closed disclosure.
    const visible = main
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<details\b[^>]*>\s*<summary>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, ' $1 ')
      .replace(/<(\w+) class="sr-only"[^>]*>[^<]*<\/\1>/g, ' ')
      .replace(/<span class="chart-key-meaning">[^<]*<\/span>/g, ' ')
      .replace(/<div class="dash-first-wrap"[\s\S]*?<\/section>\s*<\/div>/, ' ')
      .replace(/<div class="feedback-panel has-action" id="signin-note"[\s\S]*?<\/div>/, ' ')
      .replace(/<p class="dash-todo-clear"[^>]*hidden>[^<]*<\/p>/, ' ')
      // The folds' lines show only on phones (the charts are open at 1440).
      .replace(/<summary class="dash-fold-summary">[^<]*<\/summary>/g, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/g, ' ');
    // Data, not prose (round 4 decision 8): the bars' names, the names in the chart keys, the
    // table's cells, the role switch's roles, and list data (round 5 decision 6): the emails'
    // rows (who, kind, outcome).
    const labelled = (pattern: RegExp) =>
      [...visible.matchAll(pattern)]
        .map((match) => words(text(match[1] ?? '')))
        .reduce((sum, count) => sum + count, 0);
    const data =
      labelled(/<span class="hbar-label">([\s\S]*?)<\/span><span class="hbar-value"/g) +
      labelled(/<span class="chart-key-name">([^<]*)<\/span>/g) +
      labelled(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g) +
      labelled(/<label class="choice-chip"><input type="radio"[^>]*\/>([^<]*)<\/label>/g) +
      labelled(/<a class="dash-mail-link"[^>]*>([\s\S]*?)<\/a>/g) +
      // Usage's combinations: a dated list in the store's words, like the emails' rows.
      labelled(/<li class="dash-ai-combo"[^>]*>([\s\S]*?)<\/li>/g);
    const all = words(text(visible));
    // Round 7: the removed cards (D7) and AI in October (D9) give back their words; Gmail's
    // schedule and Scan now's cost (D3, R10-9), Usage's combinations (D9), the runway (drawn by
    // the shared line, not counted here), and the daily email's line (D8) take some: 419 words
    // of prose. D11's two approved lines (the orchestrator's yes) add 33; the testers' fixes
    // (what a scan found, T6-9; the keywords' found count, T5-20) add 8 and shorter labels give
    // back 10 (450 at the first render). T1-21's line at the foot of Job matches (where the found
    // roles went, so the two tiles end level) adds 8: the budget is 458 words of prose and 630
    // in all.
    expect(all - data).toBeLessThanOrEqual(458);
    expect(all).toBeLessThanOrEqual(630);
  });

  it('keeps first person out of the headings and dashes out of the copy, in every state', () => {
    const headings = [...main.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/g)].map((match) =>
      text(match[1] ?? ''),
    );
    expect(headings.length).toBeGreaterThanOrEqual(10);
    for (const heading of headings) expect(heading).not.toMatch(/\b(?:I|I’m|I’ll|me|my)\b/);
    const states = [load().store];
    const { store: platform } = load();
    platform.setAiChoice('platform');
    states.push(platform);
    const { store: off } = load();
    off.setAiChoice('none');
    states.push(off);
    const { store: reached } = load();
    reached.setAiLimit({ tokens: 40000 });
    states.push(reached);
    const { store: paused } = load();
    paused.setAgreementDemo('overdue');
    states.push(paused);
    const { store: bought } = load();
    sign(bought);
    bought.buy('bundle-month');
    for (const item of bought.updates()) bought.markUpdateRead(item.id);
    states.push(bought);
    for (const store of states) {
      const all = `${main} ${Object.values(page.regions(store)).join(' ')}`;
      expect(text(all.replace(/<svg[\s\S]*?<\/svg>/g, ''))).not.toMatch(/[–—]/);
      const tips = [...all.matchAll(/data-tip(?:-title)?="([^"]*)"/g)].map(
        (match) => match[1] ?? '',
      );
      for (const tip of tips) expect(tip).not.toMatch(/[–—]/);
      // No AI runs anywhere (G3, G4). Part 2 (N3) makes runs one allowance, the free ones plus
      // the ones you buy, so "Free runs end" and Get more runs are the store's words now.
      expect(text(all)).not.toMatch(/\bAI runs?\b|More AI runs/);
      // "Nightly runs" are runs everywhere (N3); What's new is the store's text (request 10).
      const own = `${main.replace(/<ul class="dash-todo-list dash-news-list"[\s\S]*?<\/ul>/, '')} ${Object.entries(
        page.regions(store),
      )
        .filter(([id]) => id !== 'news-list')
        .map(([, html]) => html)
        .join(' ')}`;
      expect(text(own)).not.toMatch(/nightly runs?\b/i);
      for (const tip of tips.filter((tip) => !/^Bundles: runs/.test(tip)))
        expect(tip).not.toMatch(/nightly runs?\b/i);
    }
  });
});
