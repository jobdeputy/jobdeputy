import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Page guarantees for Searches (brand/searches-preview.html, round 3 brief 4.3; findings 16, 17,
// 18, 23, and 30; round 4 brief 4.2: S1, S2, and R4-2). Your sources lead the page, opening with
// the one AI setting every search runs on. Add a source is one compact row whose Browse examples
// panel holds the examples and the roles to match. Every source, run, figure, schedule, and
// allowance comes from the sample store (R3-3), and every figure carries data-metric with the
// store's own text, once (R3-4). A live run shows in the shared run tracker, counting up (R4-4);
// cards expand to edit their roles and schedule, list every run with what it ran on, and watch a
// live run, and archive or delete; Keep watch is the ring meter; See the prompt opens read and
// rank. The page's pure SearchesModel and SearchesView blocks run here against the real store,
// with a clock the test moves so live runs finish on cue. Round 5 (brief 4.2): the side column
// holds Deputy Assist (what runs your searches' AI, with its ring) beside Keep watch (S1); the run
// tracker v2 shows each stage's real counter and no time bar, and Archive and Delete wait while a
// source runs (S2); Your sources has search, filters, an order, and pages kept in the address (S3);
// and the Prompts card names each prompt's version and guardrail check (S4).

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');
const searches = sourceFor('searches-preview.html');
const gallery = sourceFor('components-preview.html');
const storeSource = sourceFor('sample-store.js');

type Run = {
  id: string;
  sourceId: string;
  sourceIds: string[];
  via: string;
  viaLabel: string;
  ai: string;
  aiLabel: string;
  aiText: string;
  keySource: string | null;
  model: string | null;
  fallback: { from: string; reason: string } | null;
  status: string;
  stage: string;
  stageLabel: string;
  checked: number;
  kept: number;
  jobIds: string[];
  startedAt: string;
  finishedAt: string | null;
  error: { code: string; message: string } | null;
  elapsedSeconds: number | null;
  durationMs: number | null;
  stages?: Array<{ id: string; state: string; count: Record<string, unknown> | null }>;
};
type SourceRecord = {
  id: string;
  name: string;
  address: string;
  status: string;
  state: string;
  schedule: string;
  watched: boolean;
  roles: string[];
};
type Nightly = {
  limit: number;
  used: number;
  left: number;
  freeLeft: number;
  perNight: number;
  lastsThrough: string | null;
  coversMonth: boolean;
  neededForMonth: number;
  nextRunAt: string | null;
  refreshesOn: string;
  topups: number;
  bought?: number;
};
type Choice = { source: string; label: string; summary: string; href: string; text: string };
type Limit = { tokens: number | null; onReach: string; state: string; resetsAt: string };
type StartResult = {
  ok: boolean;
  reason?: string;
  run?: Run;
  resetsAt?: string;
  onReach?: string;
  refreshesOn?: string;
};
type Store = {
  LIMITS: { nightlyAt: string; nightlyMonth: number };
  KIND_GROUPS: Record<string, string>;
  prompt(
    id: string,
  ): { name: string; version: { label: string }; check: { status: string } } | null;
  setPrompt(id: string, text: string): { ok: boolean; reason?: string } | null;
  stopRun(id: string): { ok: boolean; run?: Run; reason?: string };
  credits(): { left: number; usedMonth: number };
  RUN_STAGES: Array<{ id: string; label: string }>;
  SCHEDULES: Record<string, string>;
  AI_LABELS: Record<string, string>;
  get(): { profile: { targetRoles: string[] } };
  catalog(): { sources: SourceRecord[]; deletedSources: Array<{ id: string }> };
  source(id: string): SourceRecord | null;
  metric(key: string): number | string | null;
  metricText(key: string): string;
  runs(filter?: { sourceId?: string; status?: string }): Run[];
  run(id: string): Run | null;
  liveRun(sourceId?: string): Run | null;
  startRun(id: string, options?: { via?: string }): StartResult;
  retryRun(id: string): StartResult;
  aiChoice(): Choice;
  setAiChoice(source: string): Choice | null;
  aiLimit(): Limit;
  setAiLimit(fields: { tokens?: number | null; period?: string; onReach?: string }): Limit | null;
  format: { date(value: string): string; time(value: string): string };
  addSource(
    entry: Record<string, unknown>,
    options?: { start?: boolean },
  ): { ok: boolean; reason?: string; source?: SourceRecord; run?: Run | null };
  updateSource(id: string, fields: Record<string, unknown>): SourceRecord | null;
  archiveSource(id: string): SourceRecord | null;
  restoreSource(id: string): SourceRecord | null;
  deleteSource(id: string): boolean;
  allowance(): {
    nightly: Nightly;
    runs: Nightly & { nextCheck: { willSkip: string[]; text: string } };
  };
  requestTopup(request: { kind: string; runs: number }): { ok: boolean };
  today(): string;
};
type Card = {
  id: string;
  name: string;
  short: string;
  status: string;
  state: string;
  schedule: string;
  watched: boolean;
  roles: string[];
  runs: Run[];
  live: Run | null;
  finished: Run | null;
  latest: Run | null;
};
type PageModel = {
  active: Card[];
  archived: Card[];
  deleted: Array<{ id: string; name: string }>;
  attention: Card[];
  live: Card[];
  runsOut: boolean;
  watch: Nightly & { watched: Array<{ id: string; name: string; short: string }>; state: string };
  ai: { source: string; icon: string; summary: string; href: string; off: boolean } | null;
  roles: string[];
};
type Note = {
  kind: string;
  title: string;
  message: string;
  actions?: Array<{ label: string; href?: string; attrs?: Record<string, string> }>;
} | null;
type Ui = {
  expanded?: Set<string>;
  moreOpen?: Set<string>;
  linked?: string | null;
  notes?: Map<string, unknown>;
  roles?: string[];
  tourCard?: string | null;
  tourLive?: string | null;
  runsOut?: boolean;
  arrived?: { id: string; runId: string | null } | null;
};
type Find = { q: string; status: string; kind: string; sort: string; page: number; size: number };
type FindView = {
  shown: Card[];
  total: number;
  pages: number;
  page: number;
  onPage: Card[];
  filteredOut: Card[];
  elsewhere: Array<{ card: Card; page: number }>;
};
type Assist = { kind: string; limited: boolean; low?: boolean; state?: string } | null;
// The band (round 7, D7): Matches by source and Roles found per search, as the Dashboard drew them.
type Slice = {
  id: string;
  label: string;
  name: string;
  tone: string;
  value: number;
  href?: string;
  figure: { key: string; text: string };
  sources?: { key: string; text: string };
  count?: number;
  tipTitle: string;
  tip: string;
};
type SourcesCard = {
  slices: Slice[];
  other: Slice | null;
  count: number;
  all: Array<{ id: string; label: string; count: number; href: string; tone: string }>;
  seeAll: boolean;
  top: { shown: number; total: { key: string; text: string } } | null;
  tourText: string;
};
type Bar = {
  id: string;
  label: string;
  short: string;
  sublabel: string | null;
  name: string;
  date: string;
  value: number;
  metric: string | null;
  figureKey: string | null;
  checkedText: string;
  href: string;
  tip: string;
  parts: Array<{ series: string; label: string; tone: string; value: number; href: string | null }>;
};
type RunsChart = {
  bars: Bar[];
  all: Bar[];
  series: Array<{ id: string; label: string; tone: string; href: string }>;
  capped: boolean;
  earlier: { bars: number; total: number } | null;
  total: number;
  cap: number;
  unit: [string, string];
  keyCounts: boolean;
  caption: boolean;
  labelledBy: string;
  otherLabel: string;
};
type Page = {
  pageModel(store: Store, options?: { finished?: Record<string, string> }): PageModel;
  orderCards(
    cards: Card[],
    order?: string[] | null,
    sort?: string,
  ): { cards: Card[]; order: string[] };
  findFrom(params: URLSearchParams): Find;
  findParams(find: Find): Record<string, string | null>;
  findView(cards: Card[], find: Find, options?: { size?: number; live?: Card[] }): FindView;
  pageSize(chosen?: unknown): number;
  assistModel(store: Store): Assist;
  assistHtml(store: Store, assist: Assist): string;
  NO_FIND: Find;
  STATUS_FILTERS: string[];
  STATUS_LABELS: Record<string, string>;
  arrivalRun(store: Store, card: Card, runId?: string | null): Run | null;
  aiLeftHtml(store: Store, assist: Assist): string;
  sourcesCard(store: Store): SourcesCard;
  sourceSlices(store: Store): Slice[];
  legendHtml(slices: Slice[]): string;
  sourcesTopHtml(card: SourcesCard): string;
  perSearchChart(store: Store): RunsChart | null;
  runsTopHtml(store: Store, chart: RunsChart | null): string;
  bandSeeAll(store: Store, list: string): Record<string, unknown> | null;
  SOURCE_CAP: number;
  BARS_CAP: number;
  watchingHtml(watched: Array<{ id: string; name: string; short?: string }>): string;
  watchState(nightly: Nightly): string;
  runNote(store: Store, card: { id: string; name: string }, result: StartResult): Note;
  noteHtml(card: { id: string }, note: Note): string;
  trackerHtml(store: Store, run: Run): string;
  ranWith(store: Store, run: Run): string;
  cardHtml(store: Store, card: Card, ui?: Ui): string;
  attrs(map: Record<string, unknown>): string;
  unitHtml(
    store: Store,
    key: string,
    one: string,
    many: string,
    options?: { live?: boolean; className?: string | null },
  ): string;
  WORK_STAGES: string[];
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
  searches,
  ['SearchesModel', 'SearchesView', 'SearchesBand'],
  [
    'pageModel',
    'orderCards',
    'watchState',
    'runNote',
    'noteHtml',
    'trackerHtml',
    'ranWith',
    'cardHtml',
    'attrs',
    'unitHtml',
    'WORK_STAGES',
    'findFrom',
    'findParams',
    'findView',
    'pageSize',
    'assistModel',
    'assistHtml',
    'NO_FIND',
    'STATUS_FILTERS',
    'STATUS_LABELS',
    'arrivalRun',
    'watchingHtml',
    'aiLeftHtml',
    'sourcesCard',
    'sourceSlices',
    'legendHtml',
    'sourcesTopHtml',
    'perSearchChart',
    'runsTopHtml',
    'bandSeeAll',
    'SOURCE_CAP',
    'BARS_CAP',
  ],
);

// The real store with an in-memory localStorage and a clock the test moves (as
// sample-store.test.ts does), so the live Amazon run finishes when the test says.
type Clock = { now: number };
const guardSource = sourceFor('prompt-guard.js');
// { guard: true } loads brand/prompt-guard.js first, as every page does, so prompt saves and their
// checks run; without it the store fails closed (R5-5).
function loadStore({ search = '', guard = false } = {}): { store: Store; clock: Clock } {
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
  const context = { window, localStorage, JSON, Date: FakeDate };
  if (guard) runInNewContext(guardSource, context);
  runInNewContext(storeSource, context);
  return { store: window.JobDeputyStore as Store, clock };
}
const later = (clock: Clock, seconds: number) => {
  clock.now += seconds * 1000;
};

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;| /g, ' ')
    .replace(/\s+/g, ' ')
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
// The same, with a space where an element ends (the page writes its markup without whitespace).
const spaced = (html: string): string =>
  text(html.replace(/<[^>]+>/g, (tag) => (/^<\/?(?:span|strong|a)\b/.test(tag) ? '' : ' ')));
const words = (value: string): number =>
  value.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
const marked = (source: string, name: string): string => {
  const from = source.indexOf(`<!-- ${name}: start -->`);
  const to = source.indexOf(`<!-- ${name}: end -->`);
  expect(from, `${name} markers`).toBeGreaterThan(-1);
  return source.slice(from, to);
};
// Every [data-metric] in some markup: its key and its text.
const figures = (html: string): Array<{ key: string; shown: string }> =>
  [...html.matchAll(/<(\w+)\b[^>]*\bdata-metric="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)].map(
    (match) => ({ key: match[2] ?? '', shown: text(match[3] ?? '') }),
  );

const main = searches.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? '';
const script =
  [...searches.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n') ?? '';
const styles = searches.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
const cardOf = (model: PageModel, id: string): Card => {
  const card = [...model.active, ...model.archived].find((item) => item.id === id);
  expect(card, `card ${id}`).toBeTruthy();
  return card as Card;
};
// Every card on the page drawn with these choices, as the page draws them.
const drawAll = (store: Store, model: PageModel, ui: Ui = {}): string =>
  [...model.active, ...model.archived]
    .map((card) => page.cardHtml(store, card, { roles: model.roles, ...ui }))
    .join('\n');
const liveKeys = (key: string) => /^runs\.r11\./.test(key);

describe('searches page · the frame', () => {
  it('opens with the intro, one short line, and the flow ribbon marking Searches', () => {
    expect(searches).toContain('<title>JobDeputy · Searches</title>');
    expect(main).toMatch(/<p class="eyebrow">Searches<\/p>/);
    expect(text(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')).toBe(
      'Where your deputy looks.',
    );
    // Round 6 (R6-3, A6): the shared page intro. The copy holds the eyebrow, the h1, and the
    // lede; Take the tour is alone in the actions, which app-chrome.css places at the end of the
    // title row from 721px and under the lede below that. No layout of the page's own.
    const intro =
      main.match(/<section class="page-intro srch-intro"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(intro).toContain('aria-labelledby="page-title"');
    expect(text(intro.match(/<div class="page-intro-copy">([\s\S]*?)<\/div>/)?.[1] ?? '')).toBe(
      'Searches Where your deputy looks. Your sources and their runs.',
    );
    expect(intro.match(/<div class="page-intro-actions">([\s\S]*?)<\/div>/)?.[1]?.trim()).toBe(
      '<button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour</button>',
    );
    expect(searches).not.toMatch(/srch-intro-top|srch-tour/);
    const line = text(main.match(/<p class="intro-copy">([\s\S]*?)<\/p>/)?.[1] ?? '');
    expect(line).toBe('Your sources and their runs.');
    expect(words(line)).toBeLessThanOrEqual(14);
    // The gallery's ribbon, byte for byte, with Searches as the current step.
    const ribbon = marked(main, 'FlowRibbon');
    expect(ribbon).toBe(
      marked(gallery, 'FlowRibbon')
        .replace(
          '<a class="flow-ribbon-step" href="./jobs-preview.html" aria-current="page">',
          '<a class="flow-ribbon-step" href="./jobs-preview.html">',
        )
        .replace(
          '<a class="flow-ribbon-step" href="./searches-preview.html">',
          '<a class="flow-ribbon-step" href="./searches-preview.html" aria-current="page">',
        ),
    );
    expect(ribbon.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('loads the shell scripts in order, app-panels.js included, then its own script', () => {
    const order = [...searches.matchAll(/<script(?: src="\.\/([\w-]+\.js)")?>/g)].map(
      (match) => match[1] ?? 'inline',
    );
    // Round 5: the prompt guard and the agreement text load before the store (the orchestrator's
    // tags on every page that loads it).
    expect(order).toEqual([
      'app-shell.js',
      'app-components.js',
      'prompt-guard.js',
      'agreement-text.js',
      'sample-store.js',
      'deputy.js',
      'feedback.js',
      'app-panels.js',
      'inline',
    ]);
  });

  it('opens with its metrics band, then your sources: Add a source, Find a source, the list, and its pages; Keep watch, the prompts, and the AI line beside them (round 7, R10-2)', () => {
    const at = (needle: string) => {
      const index = main.indexOf(needle);
      expect(index, needle).toBeGreaterThan(-1);
      return index;
    };
    const order = [
      '<h1 id="page-title">',
      '<!-- FlowRibbon: start -->',
      // Round 7 (R10-2, D7): the band first: the stat row, then Matches by source and Roles
      // found per search, moved here from the Dashboard (S2: nothing else).
      'id="srch-band"',
      'id="srch-stats"',
      'id="srch-sources"',
      'id="srch-runs"',
      '<section class="task-surface" id="recent-searches"',
      'id="sources-title"',
      'id="srch-add-open"',
      'id="add-source"',
      'id="srch-find"',
      'id="srch-views"',
      'id="srch-live-note"',
      'id="srch-runs-out"',
      'id="srch-active"',
      'id="srch-archived"',
      'id="srch-pages"',
      // Round 6 (P-4): the side column is Keep watch, the prompts, then the one AI line.
      'class="srch-side"',
      'id="keep-watch"',
      'class="task-surface srch-prompts"',
      'id="deputy-assist"',
      'id="srch-ai"',
    ].map(at);
    // The one AI setting moved from the top of Your sources into Deputy Assist (S1), and the stat
    // row into the band (round 7).
    expect(inner(searches, 'recent-searches')).not.toContain('id="srch-ai"');
    expect(inner(searches, 'recent-searches')).not.toContain('id="srch-stats"');
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The band holds only the stat row, the two charts, and its sample note (S2), and the charts
    // sit side by side once the band has 760px, the bars the wider.
    const band = inner(searches, 'srch-band');
    expect([...band.matchAll(/<figure\b/g)]).toHaveLength(2);
    expect(text(band.match(/<h3 id="srch-sources-title">([\s\S]*?)<\/h3>/)?.[1] ?? '')).toBe(
      'Matches by source',
    );
    expect(text(band.match(/<h3 id="srch-runs-title">([\s\S]*?)<\/h3>/)?.[1] ?? '')).toBe(
      'Roles found per search',
    );
    expect(band).not.toMatch(/Latest matches|Keywords|Strong fit/);
    expect(styles.replace(/\s+/g, ' ')).toContain(
      '@container srch-band (min-width: 760px) { .srch-band-charts { grid-template-columns: minmax(0, 1fr) minmax(0, 1.618fr); } }',
    );
    // The round 2 tiles and the big Add a source panel are gone, and so is round 3's How runs
    // work: the run tracker shows a run's four stages, and the prompts have their own panel.
    expect(main).not.toContain('kpi-grid');
    expect(main).not.toContain('srch-strip');
    expect(main).not.toContain('srch-how');
    // Sources beside Keep watch at the golden ratio on wide screens, stacked (sources first)
    // below that.
    expect(styles.replace(/\s+/g, ' ')).toContain(
      '@container srch-page (min-width: 860px) { .srch-layout { grid-template-columns: minmax(0, 1.618fr) minmax(0, 1fr); } }',
    );
  });
});

describe('searches page · the metrics band (round 7, R10-2 and D7)', () => {
  it('charts Matches by source from the store: the top five, most roles first, each opening Job matches for it', () => {
    const { store } = loadStore();
    const slices = page.sourceSlices(store);
    expect(slices.map((slice) => [slice.label, slice.figure.text, slice.tone, slice.href])).toEqual(
      [
        ['Google', '12', 'blue', './jobs-preview.html?source=google'],
        ['Microsoft', '6', 'ink', './jobs-preview.html?source=microsoft'],
        ['Stripe', '4', 'green', './jobs-preview.html?source=stripe'],
        ['Workday', '3', 'quiet', './jobs-preview.html?source=workday'],
        ['Amazon', '2', 'orange', './jobs-preview.html?source=amazon'],
      ],
    );
    // The parts add up to every found role (the flow ribbon's figure), so the centre stays empty.
    expect(slices.reduce((sum, slice) => sum + slice.value, 0)).toBe(
      Number(store.metric('jobs.found')),
    );
    expect(inner(searches, 'srch-sources-donut')).toContain('<div class="donut-ring"></div>');
    expect(inner(searches, 'srch-sources-donut')).not.toContain('donut-total');
    // Each part is the store's figure with its key, a link, and a tip that says what it opens.
    const legend = page.legendHtml(slices);
    expect(figures(legend).map(({ key }) => key)).toEqual([
      'jobs.source.google',
      'jobs.source.microsoft',
      'jobs.source.stripe',
      'jobs.source.workday',
      'jobs.source.amazon',
    ]);
    expect(legend).toContain(
      '<li data-value="12" data-tone="blue"><a class="chart-legend-item" href="./jobs-preview.html?source=google" data-tip-title="Google Careers · 12 roles" data-tip="Roles your deputy found on Google Careers, each counted once. Opens Job matches filtered to Google Careers." data-focus-key="source-google">',
    );
    // Five sources on the usual sample: no Other part and no See all.
    const card = page.sourcesCard(store);
    expect([card.other, card.seeAll, card.top, card.count]).toEqual([null, false, null, 5]);
    expect(page.sourcesTopHtml(card)).toBe('');
    expect(card.tourText).toBe(
      'Each colour is one source. Open one and I show its roles in Job matches.',
    );
    // The page draws the legend in place (morph), and the shared donut draws the ring from it.
    expect(script).toContain(
      'if (drawInto(sourcesLegend, legend)) components?.init?.(sourcesDonut);',
    );
  });

  it('shows the top five sources and one Other part, with See all, however many sources found roles (R6-4)', () => {
    const tones = ['blue', 'ink', 'green', 'quiet', 'orange'];
    const many = Array.from({ length: 124 }, (_, index) => ({
      id: `s${index}`,
      name: `Example Labs ${index}`,
      short: `Labs ${index}`,
      tone: index < 5 ? tones[index] : 'other',
      count: 124 - index,
    }));
    const fake = {
      catalog: () => ({
        sources: many,
        jobs: many.flatMap((source) =>
          Array.from({ length: source.count }, () => ({ source: source.id })),
        ),
        deletedSources: [],
      }),
      sourceTone: (id: string) => many.find((source) => source.id === id)?.tone ?? 'other',
      metricText: (key: string) =>
        ({ 'jobs.sources': '124', 'jobs.source.other': '7,140', 'jobs.sources.other': '119' })[
          key
        ] ?? '1',
    } as unknown as Store;
    const card = page.sourcesCard(fake);
    expect(card.slices.map((slice) => [slice.id, slice.tone])).toEqual([
      ['s0', 'blue'],
      ['s1', 'ink'],
      ['s2', 'green'],
      ['s3', 'quiet'],
      ['s4', 'orange'],
    ]);
    expect(card.other).toMatchObject({ id: 'other', tone: 'other', count: 119, value: 7140 });
    expect(card.seeAll).toBe(true);
    expect(card.all).toHaveLength(124);
    const legend = page.legendHtml([...card.slices, card.other as Slice]);
    expect([...legend.matchAll(/<li data-value/g)]).toHaveLength(6);
    expect(legend).toContain(
      '<li data-value="7140" data-tone="other"><span class="chart-legend-item" data-tip-title="Other sources · 7,140 roles"',
    );
    expect(spaced(legend)).toMatch(/Other \( ?119 sources\) 7,140/);
    expect(page.sourcesTopHtml(card)).toBe(
      '<span>Top 5 of <span data-metric="jobs.sources">124</span> sources with matches</span> <button class="chart-action see-all-open" type="button" data-see-all="sources" data-focus-key="sources-see-all">See all<span class="sr-only"> sources</span></button>',
    );
    expect(card.tourText).toBe(
      'Each colour is one of my top five sources, and Other holds the rest. Open one for its roles, or See all for every source.',
    );
    // See all opens the shared panel with every source that has matches.
    const panel = page.bandSeeAll(fake, 'sources') as {
      title: string;
      items: unknown[];
      key: boolean;
    };
    expect(panel.title).toBe('Matches by source');
    expect(panel.items).toHaveLength(124);
    expect(panel.key).toBe(true);
    expect(script).toContain('const options = bandSeeAll(store, button.dataset.seeAll);');
  });

  it('draws Roles found per search as stacked bars by source, each part opening its run on this page (D2)', () => {
    const { store } = loadStore();
    const chart = page.perSearchChart(store);
    expect(chart).not.toBeNull();
    expect(chart?.bars.map((bar) => [bar.id, bar.name, bar.value, bar.label, bar.href])).toEqual([
      ['r2', 'Example Workday', 3, 'Sep 21', './searches-preview.html?source=workday&run=r2'],
      ['r3', 'Stripe Jobs', 4, 'Sep 23', './searches-preview.html?source=stripe&run=r3'],
      ['r4', 'Amazon Jobs', 2, 'Sep 24', './searches-preview.html?source=amazon&run=r4'],
      ['r5', 'Microsoft Careers', 5, 'Sep 27', './searches-preview.html?source=microsoft&run=r5'],
      ['r6', 'Google Careers', 5, 'Sep 28', './searches-preview.html?source=google&run=r6'],
      ['r8', 'Google Careers', 5, 'Oct 1', './searches-preview.html?source=google&run=r8'],
      [
        'r9',
        'Google Careers and Microsoft Careers',
        3,
        'Oct 2',
        './searches-preview.html?source=google&run=r9',
      ],
    ]);
    // Each bar is its run's kept roles, the store's figure; its key stays with the run's card
    // (each key once, R3-4), so the chart's totals carry none.
    for (const bar of chart?.bars ?? []) {
      expect(bar.metric, bar.id).toBeNull();
      expect(bar.figureKey, bar.id).toBe(`runs.${bar.id}.kept`);
      expect(String(bar.value), bar.id).toBe(store.metricText(`runs.${bar.id}.kept`));
    }
    // Keep watch's nightly run checks both watched sources in one run: two colours, Keep watch
    // under its date, each part opening that source on that run.
    expect(chart?.bars.at(-1)).toMatchObject({ sublabel: 'Keep watch' });
    expect(chart?.bars.at(-1)?.parts).toEqual([
      {
        series: 'google',
        label: 'Google',
        tone: 'blue',
        value: 2,
        href: './searches-preview.html?source=google&run=r9',
      },
      {
        series: 'microsoft',
        label: 'Microsoft',
        tone: 'ink',
        value: 1,
        href: './searches-preview.html?source=microsoft&run=r9',
      },
    ]);
    // The same colours as Matches by source; the key names colours only.
    const colours = Object.fromEntries(
      page.sourceSlices(store).map((slice) => [slice.id, slice.tone]),
    );
    for (const series of chart?.series ?? [])
      expect(series.tone, series.id).toBe(colours[series.id]);
    expect(chart).toMatchObject({
      cap: 5,
      otherLabel: 'Other sources',
      keyCounts: false,
      caption: false,
      labelledBy: 'srch-runs-title',
      capped: false,
    });
    expect(chart?.unit).toEqual(['role found', 'roles found']);
    expect(chart?.bars.reduce((sum, bar) => sum + bar.value, 0)).toBe(
      Number(store.metric('jobs.found')),
    );
    expect(page.runsTopHtml(store, chart)).toBe('');
    // The shared stacked bars draw it; a part's link lands in place on its source's run (D1).
    expect(script).toContain('const drawn = draw(runsPlot, chart);');
    expect(script).toContain(
      'const link = event.target.closest(\'a[href^="./searches-preview.html?source="]\');',
    );
  });

  it('shows the last eight searches, with See all for every one', () => {
    expect(page.BARS_CAP).toBe(8);
    const { store, clock } = loadStore();
    later(clock, 110);
    store.metric('jobs.found');
    expect(store.startRun('acme', { via: 'retry' }).ok).toBe(true);
    later(clock, 110);
    store.metric('jobs.found');
    const chart = page.perSearchChart(store);
    expect(chart?.all.length).toBe(9);
    expect(chart?.capped).toBe(true);
    expect(chart?.bars.map((bar) => bar.id)).toEqual(chart?.all.slice(-8).map((bar) => bar.id));
    expect(chart?.earlier).toEqual({ bars: 1, total: 3 });
    expect(page.runsTopHtml(store, chart)).toBe(
      '<span>Your last 8 searches; 1 earlier one found 3 roles</span> <button class="chart-action see-all-open" type="button" data-see-all="runs" data-focus-key="runs-see-all">See all<span class="sr-only"> searches</span></button>',
    );
    const panel = page.bandSeeAll(store, 'runs') as {
      items: Array<{ id: string }>;
      noun: string[];
    };
    expect(panel.noun).toEqual(['search', 'searches']);
    expect(panel.items.map((item) => item.id)).toEqual(
      [...(chart?.all ?? [])].reverse().map((bar) => bar.id),
    );
  });

  it('boots without a second draw: the band and the layout are held as skeletons until the first render (R10-1)', () => {
    expect(searches).toMatch(
      /<section\s+class="task-surface srch-band"\s+id="srch-band"[^>]*data-skeleton="chart"/,
    );
    expect(searches).toContain('<div class="srch-layout" data-skeleton="cards">');
    const css = styles.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    expect(css).toContain('.srch-band[data-skeleton] { --skeleton-min: 500px; }');
    expect(css).toContain('.srch-layout[data-skeleton] { --skeleton-min: 100vh; }');
    // One reveal, once the first render (and a link's landing row) is drawn, before the load event.
    expect(script).toContain('components?.boot?.ready?.();');
    expect(script.indexOf('components?.boot?.ready?.();')).toBeGreaterThan(
      script.lastIndexOf('render();'),
    );
  });

  it('names a source in full, wrapping where the card is narrow (round 7, T2-21)', () => {
    const css = styles.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    expect(css).toContain('.srch-toggle-name { min-width: 0; overflow-wrap: break-word; }');
    expect(css).not.toMatch(/\.srch-toggle-name \{[^}]*(?:ellipsis|nowrap)/);
  });

  it('keeps a bare flag bare in the address, and skips the store ticks it does not show (T3-20, T3-19)', () => {
    expect(script).toContain("const query = next.toString().replace(/=(?=&|$)/g, '');");
    // An old run's id is written as the run it is part of now (?run=r10 reads ?run=r9).
    expect(script).toContain('if (runNow && runNow !== askedRun) setQuery({ run: runNow });');
    expect(script).toContain('if (change?.progress) return;');
  });

  it('folds its charts behind Show charts on a phone, and ends with its charts on wide screens (T2-12)', () => {
    // The button sits between the stat row and the charts and controls both; only a phone shows
    // it, and there the charts wait for it (the stat row and the sample note stay).
    const band = inner(searches, 'srch-band');
    expect(band).toMatch(
      /<button\s+class="compact-action srch-charts-toggle"\s+id="srch-charts-toggle"\s+type="button"\s+aria-expanded="false"\s+aria-controls="srch-sources srch-runs"\s*>\s*Show charts\s*<\/button>/,
    );
    expect(band.indexOf('id="srch-stats"')).toBeLessThan(band.indexOf('id="srch-charts-toggle"'));
    expect(band.indexOf('id="srch-charts-toggle"')).toBeLessThan(
      band.indexOf('class="srch-band-charts"'),
    );
    const css = styles.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    expect(css).toContain('.srch-charts-toggle { display: none; }');
    const phone = css.slice(css.indexOf('@media (max-width: 720px)'));
    expect(phone).toContain('.srch-charts-toggle { display: inline-flex; justify-self: start; }');
    expect(phone).toContain('.srch-band:not(.is-charts-open) .srch-band-chart { display: none; }');
    expect(phone).toContain('.srch-band[data-skeleton] { --skeleton-min: 220px; }');
    expect(script).toContain("chartsToggle.textContent = open ? 'Hide charts' : 'Show charts';");
    expect(script).toContain(
      "document.querySelector('#srch-band')?.classList.toggle('is-charts-open', open);",
    );
    // Return to where you were keeps it open.
    expect(script).toContain("charts: chartsToggle?.getAttribute('aria-expanded') === 'true',");
    expect(script).toContain('if (saved?.charts) showCharts(true);');
    // Side by side, the sample note sits under Matches by source, beside the taller bars, so no
    // empty row ends the band (round 7).
    expect(band).toMatch(
      /<\/figure>\s*<p class="sample-note srch-band-note">Sample data · not connected<\/p>\s*<\/div>\s*$/,
    );
    expect(css).toContain('grid-template-areas: "sources runs" "note runs";');
    expect(css).toContain('.srch-band-note { grid-area: note; }');
  });
});

describe('searches page · one sample world (R3-3, R3-4)', () => {
  const { store } = loadStore();
  const model = page.pageModel(store);

  it('ships no sample data: sources, runs, and figures all come from the store', () => {
    const own = [main.replace(marked(main, 'FlowRibbon'), ''), script].join('\n');
    for (const source of store.catalog().sources) {
      expect(own, source.name).not.toContain(source.name);
      expect(own, source.address).not.toContain(source.address);
    }
    // No run ids, no seed figures, no seed dates, and no model or key names: the one AI setting
    // and what each run ran on come from the store too.
    expect(own).not.toMatch(/\br(?:[1-9]|1[01])\b/);
    for (const seedText of [
      '218',
      'Oct 6',
      'Oct 3',
      'Sep 28',
      'Sep 22',
      'Nov 1',
      '13:58',
      '02:00',
      'gpt-5',
      'Ministral',
      'OpenAI',
    ]) {
      expect(own, seedText).not.toContain(seedText);
    }
    // Every figure in the static markup waits for the store's text.
    const shipped = figures(main.replace(marked(main, 'FlowRibbon'), ''));
    expect(shipped.length).toBeGreaterThan(8);
    for (const { key, shown } of shipped) expect(shown, key).toBe('');
    // The page reads the store's own texts and never formats a store number itself.
    expect(script).toContain('setText(element, store.metricText(element.dataset.metric));');
    expect(script).toContain('source.metricText(key)');
    expect(script).not.toMatch(/toLocaleString\(\s*['"]en-US['"]\s*\)/);
  });

  it('shows every figure once, as the store writes it, with the cards folded', () => {
    // Round 6 (P-3): what runs the AI is one line with the tokens left; the ring shows only when
    // little is left or the work is paused (not on the usual sample).
    const assistModel = page.assistModel(store);
    expect(assistModel?.low).toBe(false);
    const assist = assistModel?.low
      ? page.assistHtml(store, assistModel)
      : page.aiLeftHtml(store, assistModel);
    // Round 7 (D7): the band's Matches by source legend carries every source's found roles, so
    // each card names its roles to review instead, and a key still shows once.
    const legend = page.legendHtml(page.sourceSlices(store));
    const all = [
      ...figures(main),
      ...figures(drawAll(store, model)),
      ...figures(assist),
      ...figures(legend),
    ].filter(({ key }) => !main.includes(`data-flow-count="${key}"`));
    const keys = all.map(({ key }) => key);
    expect(new Set(keys).size, 'a key repeats').toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        'sources.active',
        'sources.checked',
        'sources.attention',
        'sources.archived',
        // Round 6 (N3): one Runs allowance for every search, under the store's runs.* keys.
        // Part 3 (R9-1): the ring is the runs left of free plus bought, and the split line names
        // the free ones and the bought ones (it shows only once anything was bought).
        'runs.left',
        'runs.all',
        'runs.used',
        'runs.free',
        'runs.bought',
        // Round 7 (T1-7): how long they last, in the store's words for every case.
        'runs.lastsText',
        'watch.nightly.nextRunAt',
        // The legend's figure, and the card's roles to review (round 7, J2).
        'jobs.source.google',
        'jobs.new.source.google',
        // Round 6 (D2): Keep watch's nightly run r9 checked Google and Microsoft in one run, so
        // each card shows its own part of it, and the run's totals show nowhere twice.
        'runs.r9.source.google.checked',
        'runs.r9.source.google.kept',
        'runs.r9.source.microsoft.checked',
        'runs.r9.source.microsoft.kept',
        // Deputy Assist on your key: the tokens left of your limit, in its one line.
        'ai.limit.left',
      ]),
    );
    expect(keys).not.toContain('ai.limit.percent');
    // A live run is shown by its card (the pill and the tracker), so it has no stat of its own,
    // and its figures are the tracker's: each stage's counter fills in place (S2), so the drawn
    // markup carries none of them.
    expect(keys).not.toContain('sources.live');
    expect(keys).not.toContain('runs.r9.checked');
    expect(keys).not.toContain('runs.r9.kept');
    expect(keys.filter(liveKeys)).toEqual([]);
    // Drawn figures carry the store's text.
    for (const { key, shown } of [
      ...figures(drawAll(store, model)),
      ...figures(assist),
      ...figures(legend),
    ]) {
      expect(shown, key).toBe(store.metricText(key));
    }
  });

  it('keeps one element per key with every card open', () => {
    const everyCard = new Set([...model.active, ...model.archived].map((card) => card.id));
    const open = drawAll(store, model, { expanded: everyCard });
    // Round 7 (D7): with the band's legend, whose found figures the cards no longer repeat, and
    // the band's bars, whose totals carry no key (their runs' figures are the cards').
    const legend = page.legendHtml(page.sourceSlices(store));
    const chart = page.perSearchChart(store);
    expect(chart?.bars.every((bar) => bar.metric === null)).toBe(true);
    const keys = [...figures(main), ...figures(open), ...figures(legend)].map(({ key }) => key);
    expect(new Set(keys).size, 'a key repeats').toBe(keys.length);
    // The latest run's figures move from the folded summary into the runs list, once. Round 6
    // (D2): r9 is in both the Google and the Microsoft card's runs, each with its own part.
    expect(keys.filter((key) => key === 'runs.r9.source.google.checked')).toHaveLength(1);
    expect(keys.filter((key) => key === 'runs.r9.source.microsoft.checked')).toHaveLength(1);
    expect(keys.filter((key) => key === 'runs.r9.checked')).toHaveLength(0);
    expect(keys.filter((key) => key === 'runs.r4.kept')).toHaveLength(1);
    // The live run's figures belong to its one tracker, which fills them in place.
    expect(keys.filter(liveKeys)).toEqual([]);
    expect(open.match(/class="run-tracker"/g)).toHaveLength(1);
  });

  it('writes ids, links, and references only through attrs(), so no template text reads as one', () => {
    expect(script).not.toMatch(/\s(?:id|href|src|aria-(?:controls|describedby|labelledby))="\$\{/);
    expect(page.attrs({ id: 'x"y', hidden: true, open: false, href: null })).toBe(
      ' id="x&quot;y" hidden',
    );
  });
});

describe('searches page · Add a source (finding 18)', () => {
  it('is one compact row: the address and Search this source, with Browse examples beside its label', () => {
    const form = inner(searches, 'add-source');
    const head = form.match(/<div class="srch-add-head">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(head).toContain(
      '<label class="field-label" id="source-url-label" for="source-url">Add a source</label>',
    );
    expect(head).toMatch(
      /<button\s+class="compact-action srch-disclose"\s+id="srch-examples-toggle"\s+type="button"\s+aria-expanded="false"\s+aria-controls="srch-examples"\s*>\s*Browse examples\s*<\/button>/,
    );
    const row = form.match(/<div class="srch-add-row">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(row).toMatch(
      /<input\s+class="field-control"\s+id="source-url"\s+name="source-url"\s+type="url"/,
    );
    expect(text(row)).toBe('Search this source');
    expect(row).toContain(
      '<button class="primary-action" id="srch-add-submit" type="submit" aria-describedby="srch-add-cost">',
    );
    // Round 7 (R10-9): what its first search costs, said before you press it; with no run left the
    // line says why instead.
    expect(form).toContain(
      '<p class="field-help" id="srch-add-cost">Its first search uses 1 run.</p>',
    );
    expect(script).toContain(
      "addSubmit.setAttribute('aria-describedby', out ? 'srch-add-runs' : 'srch-add-cost');",
    );
    expect(form).toContain('<div class="srch-examples" id="srch-examples" hidden>');
    expect(searches).toMatch(/placeholder="careers\.fabrikam\.example\/jobs"/);
  });

  it('folds into an Add a source button in the header at every width, so the first card shows in the first screen (round 6, P-4)', () => {
    expect(inner(searches, 'recent-searches')).toMatch(
      /<button\s+class="primary-action srch-disclose srch-add-open"\s+id="srch-add-open"\s+type="button"\s+aria-expanded="false"\s+aria-controls="add-source"/,
    );
    // "Add a source", and on phones a short Add that keeps its name, so it shares the line of
    // Your sources from 360px up.
    const toggle = searches.slice(searches.indexOf('id="srch-add-open"'));
    expect(toggle.slice(0, toggle.indexOf('</button>'))).toMatch(
      />\s*<span>Add<span class="srch-add-more"> a source<\/span><\/span>\s*$/,
    );
    const css = styles.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    // Round 6 (P-4): folded at every width (round 5 folded it on phones only).
    expect(css).toContain(' .srch-add-open { display: inline-flex; }');
    expect(css).toContain(' .srch-sources:not(.is-adding) > .srch-add { display: none; }');
    expect(css).not.toContain('.srch-add-open { display: none; }');
    const phone = styles.slice(styles.indexOf('@media (max-width: 720px) {'));
    const block = phone.slice(0, phone.indexOf('\n      }\n') + 8).replace(/\s+/g, ' ');
    for (const rule of [
      '.srch-sources { row-gap: 13px; }',
      '.srch-add-more { position: absolute;',
      '.srch-legend { display: none; }',
      '.srch-word { display: inline; }',
    ]) {
      expect(block, rule).toContain(rule);
    }
    // Round 7 (R10-2): the stat row leads the band, so phones no longer move it after the list.
    expect(block).not.toContain('.srch-stats { order');
    // The button opens the row and focuses the address; links and Try another address open it too,
    // and it is open while there is no source at all.
    expect(script).toContain("sources.classList.toggle('is-adding', open);");
    expect(script).toContain("addOpen.setAttribute('aria-expanded', String(open));");
    // Folded, the button is the list's one primary action; open, Search this source is.
    expect(script).toContain("addOpen.classList.toggle('primary-action', !open);");
    expect(script).toContain("addOpen.classList.toggle('secondary-action', open);");
    expect(script.match(/setAdding\(true\);/g)?.length).toBeGreaterThanOrEqual(5);
    expect(script).toContain(
      'if (!model.active.length && !model.archived.length && !ui.emptyOpened) {',
    );
    // The summary holds no control, so moving it under the list on phones leaves the focus order.
    expect(inner(searches, 'srch-stats')).not.toMatch(/<(?:a|button|input|select)\b/);
  });

  it('keeps the examples and the roles to match in the Browse examples panel', () => {
    const panel = inner(searches, 'srch-examples');
    // Quick picks: the gallery's markup (a radio, a mark, a name, and a host line) in a fieldset.
    expect(panel).toContain('<fieldset class="quick-picks" id="srch-picks">');
    const picks = [
      ...panel.matchAll(
        /<label class="quick-pick">\s*<input type="radio" name="source-pick" value="([^"]+)" \/>\s*<span class="company-mark" aria-hidden="true">([A-Z]{2})<\/span>\s*<span class="quick-pick-copy"\s*><span class="quick-pick-name">([^<]+)<\/span\s*><span class="quick-pick-host">((?:[^<]|<wbr \/>)+)<\/span><\/span\s*>\s*<\/label>/g,
      ),
    ].map((match) => [match[1], match[3], match[4]?.replace('<wbr />', '')]);
    expect(picks).toEqual([
      [
        'https://boards.greenhouse.io/example',
        'A Greenhouse board',
        'boards.greenhouse.io/example',
      ],
      ['https://jobs.lever.co/example', 'A Lever board', 'jobs.lever.co/example'],
      ['https://example.wd5.myworkdayjobs.com', 'A Workday site', 'example.wd5.myworkdayjobs.com'],
      [
        'https://careers.fabrikam.example/jobs',
        'A company careers page',
        'careers.fabrikam.example/jobs',
      ],
    ]);
    // The one selected style through the shared matcher, as you type or pick.
    expect(script).toContain('components?.matchQuickPick?.(picks, addressField.value);');
    // The roles to match: your target roles from Profile, drawn as choice chips.
    expect(panel).toContain('<legend class="field-label">Roles to match</legend>');
    expect(panel).toContain('<div class="srch-chip-row" id="srch-add-role-chips"></div>');
    expect(panel).toContain('href="./profile-preview.html#preferences">Edit them in Profile</a>');
    expect(script).toContain("label.className = 'choice-chip';");
    // Nothing else about examples stays on the page.
    expect(main.replace(panel, '')).not.toMatch(/quick-pick/);
  });

  it('adds through addSource, which starts a live run first in the list', () => {
    expect(script).toContain(
      'const result = store.addSource({ address, roles: ui.roles.length ? roles : null });',
    );
    const { store } = loadStore();
    const before = page.orderCards(page.pageModel(store).active);
    const added = store.addSource({
      address: 'https://careers.fabrikam.example/jobs',
      roles: ['Software engineer'],
    });
    expect(added.ok).toBe(true);
    const after = page.orderCards(page.pageModel(store).active, before.order);
    expect(after.cards[0]?.id).toBe('careers-fabrikam-example-jobs');
    expect(after.cards[0]?.state).toBe('live');
    expect(after.cards.slice(1).map((card) => card.id)).toEqual(
      before.cards.map((card) => card.id),
    );
    // An address you already have, and one that is not an address.
    expect(store.addSource({ address: 'amazon.jobs/en/search' })).toMatchObject({
      ok: false,
      reason: 'exists',
    });
    expect(script).toContain("title: 'Already one of your sources',");
    expect(script).toContain("title: 'Check the address',");
    expect(script).toContain(
      'Nothing is fetched in this prototype, so a new address finds no roles.',
    );
  });

  it('opens from ?add=1 (the panel too) and #add-source', () => {
    expect(script).toContain("parameters.get('add') === '1' || hash === 'add-source'");
    expect(script).toContain("if (parameters.get('add') === '1') setExamples(true);");
  });

  it('puts the focus on a visible role, with its error in view, when no role is chosen (T2-11)', () => {
    // Round 6 part 3 (T2-11): the roles group lives behind Browse examples, so a submit with no
    // role opens it, brings the group into view with its error, and focuses the first role chip.
    // The focus never lands inside a folded panel, and the scroll is the group's, not the chip's.
    expect(script).toMatch(
      /if \(ui\.roles\.length && !roles\.length\) \{\s*setExamples\(true\);\s*setRolesError\(true\);/,
    );
    expect(script).toContain("addRolesGroup.scrollIntoView({ block: 'nearest' });");
    expect(script).toContain("addRoles.querySelector('input')?.focus({ preventScroll: true });");
    // The error is named by the group while it shows, so it is heard with the roles.
    expect(script).toMatch(
      /addRolesGroup\.setAttribute\(\s*'aria-describedby',\s*on \? 'srch-add-roles-help srch-add-roles-error' : 'srch-add-roles-help',/,
    );
    expect(inner(searches, 'srch-add-roles')).toContain(
      '<p class="srch-error" id="srch-add-roles-error" hidden>Choose at least one role to match.</p>',
    );
    // Checking a role again clears it.
    expect(script).toContain('if (addRoleChoices.size) setRolesError(false);');
  });
});

describe('searches page · source cards (findings 16, 17)', () => {
  it('lists the live source and the one that needs you first, and keeps that order', () => {
    const { store, clock } = loadStore();
    const first = page.orderCards(page.pageModel(store).active);
    // The usual order (round 5, S3): running, needs you, then the newest run first (ties by
    // name), and a source that never ran last. Sixteen active sources on the seed.
    expect(first.cards.map((card) => [card.id, card.state])).toEqual([
      ['amazon', 'live'],
      ['acme', 'attention'],
      ['google', 'complete'],
      ['microsoft', 'complete'],
      // Round 7 (ST, T5-6): the other sources' searches ran in July and August, so Stripe's and
      // Workday's September runs come next.
      ['stripe', 'complete'],
      ['workday', 'complete'],
      ['wide-world', 'complete'],
      ['trey', 'complete'],
      ['margies-travel', 'complete'],
      ['adatum', 'complete'],
      ['fourth-coffee', 'complete'],
      ['lucerne', 'complete'],
      ['humongous', 'complete'],
      ['alpine', 'complete'],
      ['tailwind', 'complete'],
      ['vanarsdel', 'new'],
    ]);
    // The Amazon run ends; its card stays where you were watching it.
    later(clock, 120);
    const after = page.orderCards(page.pageModel(store).active, first.order);
    expect(after.cards.map((card) => card.id)).toEqual(first.cards.map((card) => card.id));
    expect(after.cards[0]?.state).toBe('complete');
  });

  it('sums up a folded card: its state, latest run, checked → new, its roles to review, and Nightly', () => {
    const { store } = loadStore();
    const model = page.pageModel(store);
    const google = page.cardHtml(store, cardOf(model, 'google'), { roles: model.roles });
    expect(google).toContain(
      '<span class="status-pill srch-status" data-state="complete"><span class="sr-only">Last run done </span>Oct 2</span>',
    );
    // Round 6 (D2, world.md section 0): the nightly run r9 checked Google (12, 2 new) and
    // Microsoft (9, 1 new) in one run, so the Google card shows Google's part of it. Round 7
    // (D7, J2): every role a source found is the band's Matches by source figure, so the card
    // names the ones still waiting for your decision (8 of Google's 12, 4 of Microsoft's 6),
    // linking to Job matches' review queue for that source.
    expect(figures(google)).toEqual([
      { key: 'runs.r9.source.google.checked', shown: '12' },
      { key: 'runs.r9.source.google.kept', shown: '2' },
      { key: 'jobs.new.source.google', shown: '8' },
    ]);
    expect(
      figures(page.cardHtml(store, cardOf(model, 'microsoft'), { roles: model.roles })),
    ).toEqual([
      { key: 'runs.r9.source.microsoft.checked', shown: '9' },
      { key: 'runs.r9.source.microsoft.kept', shown: '1' },
      { key: 'jobs.new.source.microsoft', shown: '4' },
    ]);
    expect(google).toContain('href="./jobs-preview.html?source=google"');
    expect(spaced(google.match(/<a class="srch-found"[\s\S]*?<\/a>/)?.[0] ?? '')).toBe(
      '8 to review in Job matches from Google Careers',
    );
    expect(google).not.toContain('view=all');
    // Nightly marks a source Keep watch checks; When you ask is the default and needs no mark.
    // What runs the search is the account's one setting (R4-2), so no card has an AI chip.
    expect(
      spaced(google.match(/<span class="tag srch-chip">[\s\S]*?<\/span><\/span>/)?.[0] ?? ''),
    ).toBe('Nightly with Keep watch');
    const stripe = page.cardHtml(store, cardOf(model, 'stripe'), { roles: model.roles });
    expect(stripe).not.toContain('srch-chip');
    for (const card of [google, stripe]) {
      expect(text(card)).not.toMatch(/OpenAI|Keyword|Platform credits|gpt|Ministral/);
    }
    expect(text(google.match(/<div class="srch-card-action">([\s\S]*?)<\/div>/)?.[1] ?? '')).toBe(
      'Run again: Google Careers',
    );
    // Folded, the address waits for the open card.
    expect(google).not.toContain('srch-card-host');
    // The live source (round 5: the seeded run started 20 s before the sample, so it is already
    // fetching at load and reads Live), the one that stopped, and an archived one.
    const amazon = page.cardHtml(store, cardOf(model, 'amazon'), { roles: model.roles });
    expect(store.liveRun()?.stage).toBe('fetching');
    expect(amazon).toContain(
      '<span class="srch-card-status" data-live-status="r11" data-live-phase="live"><span class="live-pill is-live"><span class="live-pill-dot" aria-hidden="true"></span>Live</span></span>',
    );
    expect(amazon).toContain('<article class="srch-card has-track" id="source-amazon"');
    expect(amazon).toContain('<div class="run-tracker" data-state="live" data-tracker-run="r11">');
    // A run you start waits a moment first: the Queued pill, then Live.
    const queued = store.startRun('google', { via: 'again' });
    expect(queued.run?.stage).toBe('queued');
    const googleNow = page.cardHtml(store, cardOf(page.pageModel(store), 'google'), {
      roles: model.roles,
    });
    expect(googleNow).toContain('data-live-phase="queued"');
    expect(googleNow).toContain(
      '<span class="status-pill is-neutral srch-status" data-state="queued">Queued</span>',
    );
    expect(amazon).toContain('data-action="watch"');
    const acme = page.cardHtml(store, cardOf(model, 'acme'), { roles: model.roles });
    expect(acme).toContain('data-state="attention">Needs you</span>');
    expect(text(acme)).toContain('!Stopped Sep 28');
    expect(acme).toContain('data-action="retry"');
    const contoso = page.cardHtml(store, cardOf(model, 'contoso'), { roles: model.roles });
    expect(contoso).toContain('data-state="archived">Archived Sep 22</span>');
    expect(contoso).toContain('data-action="restore"');
    expect(contoso).not.toContain('srch-chips');
  });

  it('opens to edit roles and schedule (no AI choice: R4-2), list every run, and offer More actions', () => {
    const { store } = loadStore();
    const model = page.pageModel(store);
    const open = page.cardHtml(store, cardOf(model, 'stripe'), {
      roles: model.roles,
      expanded: new Set(['stripe']),
    });
    expect(open).toContain('aria-expanded="true" aria-controls="source-stripe-more"');
    expect(open).toContain('<p class="srch-card-host">stripe.com/jobs/search</p>');
    // Roles to match: your target roles, checked where the source matches them.
    const roles = [
      ...open.matchAll(
        /<input type="checkbox" name="source-stripe-roles" value="([^"]+)"( checked)?/g,
      ),
    ].map((match) => `${match[1]}${match[2] ? ' ✓' : ''}`);
    expect(roles).toEqual(['Software engineer ✓', 'Product engineer ✓', 'Engineering manager']);
    // Schedule as choice cards, saved as they change (updateSource in the page).
    const radios = (name: string) =>
      [
        ...open.matchAll(
          new RegExp(
            `<input type="radio" name="source-stripe-${name}" value="([^"]+)"( checked)?`,
            'g',
          ),
        ),
      ].map((match) => `${match[1]}${match[2] ? ' ✓' : ''}`);
    expect(radios('schedule')).toEqual(['manual ✓', 'nightly']);
    expect(open).toContain(
      '<fieldset class="choice-cards is-grid"><legend class="field-label">Schedule</legend>',
    );
    expect(spaced(open)).toContain(
      // Round 6 (N3): every search uses one run, whoever starts it.
      'When you ask You start each run, one run each Nightly with Keep watch 02:00 Pacific, one run a night',
    );
    // No AI or model choice for one source: every search runs on the account's one setting.
    expect(radios('ai')).toEqual([]);
    expect(open).not.toContain('data-setting="ai"');
    expect(open).not.toMatch(/AI that reads|reads and ranks/);
    // Every run: when, how, what it ran on (kept for history), and what it checked and kept.
    expect(open).toContain('<h4 class="srch-block-title" id="source-stripe-runs">Runs</h4>');
    // In the order a screen reader reads it (the time shows above the title, through CSS).
    expect(
      spaced(
        open.match(
          /<ol class="timeline" aria-labelledby="source-stripe-runs">([\s\S]*?)<\/ol>/,
        )?.[1] ?? '',
      ),
    ).toBe(
      '22 checked → 4 new Done in 3 min 0 s · Wed, Sep 23, 09:40 You started it · No model: keyword filtering',
    );
    // How long it took is the store's real duration in the store's words (round 5, S2).
    expect(store.run('r3')?.elapsedSeconds).toBe(180);
    // More actions: Archive and Delete.
    expect(spaced(open.match(/<details class="srch-more"[\s\S]*?<\/details>/)?.[0] ?? '')).toBe(
      'More actions Archive: Stripe Jobs Delete: Stripe Jobs',
    );
    expect(script).toContain('store.updateSource(id, { roles });');
    expect(script).toContain('store.updateSource(id, { schedule: input.value });');
    expect(script).not.toMatch(/updateSource\(id, \{ ai\b|setting === 'ai'/);
  });

  it('shows the latest run of a stopped source and Try another address beside Retry', () => {
    const { store } = loadStore();
    const model = page.pageModel(store);
    const acme = page.cardHtml(store, cardOf(model, 'acme'), {
      roles: model.roles,
      expanded: new Set(['acme']),
    });
    const problem =
      acme.match(
        /<div class="feedback-panel srch-wide" data-kind="warning">([\s\S]*?)<\/div>/,
      )?.[1] ?? '';
    expect(text(problem.replace(/<\/(?:strong|span)>/g, ' '))).toBe(
      '! We couldn’t read this page The page took too long to load. Retry it, or add another address for this company. Try another address: Acme Engineering',
    );
    // Each run carries its own id (round 6, D1: a link that names a run lands on it).
    expect(acme).toContain(
      '<li class="timeline-item is-attention" id="source-acme-run-r7"><p class="timeline-title">The page took too long to load</p>',
    );
  });

  it('watches a live run in the run tracker: its stages, the time counting up, the earlier runs below', () => {
    const { store } = loadStore();
    const model = page.pageModel(store);
    const amazon = page.cardHtml(store, cardOf(model, 'amazon'), {
      roles: model.roles,
      expanded: new Set(['amazon']),
    });
    // Watch live: one tracker, moved from the folded card's row into the open card.
    expect(amazon).toContain(
      '<section class="srch-live srch-wide" id="source-amazon-live" data-focus="amazon:live" tabindex="-1" aria-labelledby="source-amazon-live-title">',
    );
    expect(amazon).toContain('>Watching live</h4>');
    expect(amazon.match(/class="run-tracker"/g)).toHaveLength(1);
    expect(amazon).not.toContain('has-track');
    expect([...amazon.matchAll(/data-stage="(\w+)"/g)].map((match) => match[1])).toEqual(
      page.WORK_STAGES,
    );
    expect(
      page.WORK_STAGES.map((id) => store.RUN_STAGES.find((stage) => stage.id === id)?.label),
    ).toEqual(['Fetching pages', 'Reading listings', 'Matching your roles', 'Saving']);
    // Each stage's counter is the tracker's (round 5, S2): drawn empty, filled from run().stages
    // with its figures' keys, so the drawn card carries none of the live run's figures.
    expect(
      figures(amazon)
        .map(({ key }) => key)
        .filter(liveKeys),
    ).toEqual([]);
    expect(
      amazon.match(/<span class="run-tracker-step-count" data-run-step-count hidden><\/span>/g),
    ).toHaveLength(4);
    expect(store.run('r11')?.stages?.[0]).toMatchObject({
      id: 'fetching',
      state: 'current',
      count: {
        text: '5 of 9 pages read',
        metric: 'runs.r11.pagesRead',
        ofMetric: 'runs.r11.pagesPlanned',
      },
    });
    // When it started, who started it, and what it runs on (the run's own, kept for history).
    expect(spaced(amazon.match(/<p class="srch-live-meta">[\s\S]*?<\/p>/)?.[0] ?? '')).toBe(
      'Started 13:59 · You started it · gpt-5-mini on your OpenAI key',
    );
    // The tracker counts up on the store's ticks; the page moves the card's Queued to Live.
    expect(script).toContain('store?.onTick?.(() => updateLive());');
    expect(script).toContain(
      'const tracker = components.runTracker(host, host.dataset.trackerRun);',
    );
    expect(script).toContain('slot.innerHTML = LIVE_PILLS[phase];');
    expect(amazon).toContain('>Earlier runs</h4>');
    expect(script).toContain("setQuery({ source: id, live: '1' });");
  });

  it('draws the shared run tracker the gallery documents, without a head or its own Watch live', () => {
    const { store } = loadStore();
    const run = store.liveRun() as Run;
    const tracker = page.trackerHtml(store, run);
    const squash = (html: string) => html.replace(/>\s+</g, '><').trim();
    // The steps and the time as the gallery's run tracker v2 writes them (round 5, S2): each step
    // with its own counter, and no time bar and no Checked and New list (the steps and the finish
    // line say them).
    const specimen = squash(inner(gallery, 'gallery-tracker-host'));
    const steps = (html: string) => html.match(/<ol class="run-tracker-steps"[\s\S]*?<\/ol>/)?.[0];
    expect(steps(tracker)).toBe(steps(specimen));
    for (const part of [
      '<ol class="run-tracker-steps" aria-label="Stages">',
      '<li class="run-tracker-step" data-stage="fetching"><span class="run-tracker-step-name">Fetching pages</span><span class="run-tracker-step-count" data-run-step-count hidden></span><span class="sr-only" data-run-step-state></span></li>',
      '<li class="run-tracker-step" data-stage="saving"><span class="run-tracker-step-name">Saving</span><span class="run-tracker-step-count" data-run-step-count hidden></span><span class="sr-only" data-run-step-state></span></li>',
    ]) {
      expect(specimen, part).toContain(part);
      expect(tracker, part).toContain(part);
    }
    expect(tracker).toContain('<p class="run-tracker-time" data-run-time></p>');
    for (const html of [tracker, specimen]) {
      expect(html).not.toMatch(/run-tracker-bar|run-tracker-fill|run-tracker-count|data-run-count/);
    }
    // No page draws progress as a bar, or anything else from the time (S2); the store's
    // change.progress flag only says a tick changed nothing here (round 7, T3-19).
    expect(script.replace(/change\?\.progress/g, '')).not.toMatch(
      /\.progress\b|run-tracker-bar|--progress/,
    );
    // The card names the source and its state, and Watch live is the card's own action.
    expect(tracker).not.toMatch(/run-tracker-head|data-run-source|data-run-state|data-run-watch/);
    // Never time left (R4-4): the page reads no estimate and formats no countdown.
    expect(script).not.toMatch(/etaSeconds|format\.duration|about \$\{|data-live-eta|'finishing'/);
    // The tracker says each stage and the finish (never the ticking time); the page says neither,
    // and lets a finished run's tracker speak before its card is redrawn.
    expect(script).not.toMatch(/announce\(`\$\{run\.sourceName\}: \$\{run\.stageLabel\}/);
    expect(script.indexOf('settleTrackers(done.map((run) => run.runId))')).toBeLessThan(
      script.indexOf('liveRender();\n        if (!complete) return;'),
    );
  });

  it('ends a watched run in its finished tracker, with its new roles linked in Job matches', () => {
    const { store, clock } = loadStore();
    later(clock, 120);
    expect(store.metric('jobs.source.amazon')).toBe(4);
    const model = page.pageModel(store, { finished: { amazon: 'r11' } });
    const amazon = page.cardHtml(store, cardOf(model, 'amazon'), {
      roles: model.roles,
      expanded: new Set(['amazon']),
    });
    // The tracker, finished: "Finished in 1 min 40 s · 44 checked · 2 new" once it is mounted.
    expect(amazon).toContain(
      '<div class="run-tracker" data-state="complete" data-tracker-run="r11">',
    );
    expect(store.run('r11')?.status).toBe('complete');
    const link = amazon.match(/<a class="srch-new-link"[^>]*>([\s\S]*?)<\/a>/);
    // It names the run, so Job matches lists that search's roles only.
    expect(link?.[0]).toContain('href="./jobs-preview.html?source=amazon&amp;run=r11"');
    // The tracker's New is the figure; the link names the roles without repeating it (R3-4).
    expect(text(link?.[1] ?? '')).toBe('See the new roles in Job matches');
    expect(spaced(amazon.match(/<p class="srch-live-meta">[\s\S]*?<\/p>/)?.[0] ?? '')).toBe(
      'Started 13:59 · You started it · gpt-5-mini on your OpenAI key',
    );
    // Its real duration (S2): 100 seconds from its start, whatever the sample clock says.
    expect(store.run('r11')).toMatchObject({ elapsedSeconds: 100, durationMs: 100000 });
    expect(store.run('r11')?.finishedAt).toBe('2026-10-02T14:01:20-07:00');
    // The finished run shows once, above (its tracker's line fills its figures); the runs list
    // holds the earlier one.
    expect(figures(amazon).filter(({ key }) => liveKeys(key))).toEqual([]);
    expect(amazon.match(/data-tracker-run="r11"/g)).toHaveLength(1);
    expect(spaced(amazon)).toContain('Done in 4 min 0 s · Thu, Sep 24, 11:05');
    expect(script).toContain("deputy?.react?.('found', {");
    expect(script).toContain(
      `speech: kept === 1 ? '1 new role for you.' : \`\${kept} new roles for you.\`,`,
    );
  });

  it('retries Acme: it runs live and its one waiting role arrives', () => {
    const { store, clock } = loadStore();
    expect(store.retryRun('acme')).toMatchObject({ ok: true });
    expect(page.pageModel(store).live.map((card) => card.id)).toEqual(['amazon', 'acme']);
    later(clock, 120);
    const model = page.pageModel(store);
    expect(cardOf(model, 'acme').state).toBe('complete');
    expect(store.metric('jobs.source.acme')).toBe(1);
    expect(model.attention).toEqual([]);
    expect(script).toContain(
      "const result = via === 'retry' ? store.retryRun(id) : store.startRun(id, { via });",
    );
  });

  it('archives (history kept, runs stopped), restores, and deletes (roles stay in Job matches)', () => {
    const { store } = loadStore();
    // The store still stops a live run when its source is archived; the page asks you to wait or
    // Stop first (round 5, S2: the next test).
    expect(store.archiveSource('amazon')).toBeTruthy();
    let model = page.pageModel(store);
    expect(model.archived.map((card) => card.id)).toEqual(['amazon', 'contoso']);
    expect(model.live).toEqual([]);
    expect(cardOf(model, 'amazon').runs.map((run) => run.status)).toEqual(['stopped', 'complete']);
    store.restoreSource('amazon');
    model = page.pageModel(store);
    expect(model.active.map((card) => card.id)).toContain('amazon');
    expect(store.deleteSource('microsoft')).toBe(true);
    model = page.pageModel(store);
    expect(model.active.map((card) => card.id)).not.toContain('microsoft');
    expect(model.deleted.map((source) => source.id)).toEqual(['microsoft']);
    expect(store.metric('jobs.source.microsoft')).toBe(6);
    // The page asks before it deletes, and says what goes and what stays.
    const dialog = inner(searches, 'srch-delete');
    expect(searches).toContain(
      '<dialog class="drawer" id="srch-delete" aria-labelledby="srch-delete-title" aria-describedby="srch-delete-meta">',
    );
    expect(text(inner(dialog, 'srch-delete-list'))).toBe(
      'Its run history is deleted, and it stops running. The roles it found stay in Job matches. The runs and tokens it used stay counted.',
    );
    expect(text(dialog)).toContain('Delete source Keep it');
    expect(script).toContain('const ok = store.deleteSource(id);');
    expect(script.indexOf('const ok = store.deleteSource(id);')).toBeGreaterThan(
      script.indexOf('function confirmDelete()'),
    );
    expect(script).toContain('components?.openDrawer?.(deleteDialog, opener);');
    expect(script).toContain("deputy?.react?.('archived');");
    expect(script).toContain("deputy?.react?.('deleted');");
  });

  it('turns Archive and Delete off while the source runs, says why in text, and offers Stop (S2, R5-4)', () => {
    const { store, clock } = loadStore();
    const draw = () => {
      const model = page.pageModel(store);
      return page.cardHtml(store, cardOf(model, 'amazon'), {
        roles: model.roles,
        expanded: new Set(['amazon']),
        moreOpen: new Set(['amazon']),
      });
    };
    const more = (html: string) =>
      html.match(/<details class="srch-more"[\s\S]*?<\/details>/)?.[0] ?? '';
    const live = more(draw());
    expect(live).toContain(
      '<button class="compact-action" type="button" data-action="stop" data-source="amazon" data-focus="amazon:stop">Stop this search<span class="sr-only">: Amazon Jobs</span></button>',
    );
    // A disabled button takes no focus, so the reason is visible text the buttons point at.
    expect(live).toContain(
      '<button class="compact-action" type="button" data-action="archive" data-source="amazon" data-focus="amazon:archive" disabled aria-describedby="source-amazon-why">Archive<span class="sr-only">: Amazon Jobs</span></button>',
    );
    expect(live).toContain(
      '<button class="compact-action srch-danger" type="button" data-action="delete" data-source="amazon" data-focus="amazon:delete" disabled aria-describedby="source-amazon-why">Delete<span class="sr-only">: Amazon Jobs</span></button>',
    );
    expect(live).toContain(
      '<p class="srch-more-why" id="source-amazon-why">Available when this search finishes</p>',
    );
    // A request that comes anyway (a run started in another tab) waits too, and says so.
    expect(script).toContain('if (!card || waitForRun(card) || !store.archiveSource(id)) return;');
    expect(script).toContain('if (!card || waitForRun(card)) return;');
    expect(script).toContain('if (store.liveRun?.(id)) {');
    // When the run ends, both work again, and Stop goes.
    later(clock, 120);
    const after = more(draw());
    expect(after).not.toMatch(/disabled|srch-more-why|data-action="stop"/);
    expect(spaced(after)).toBe('More actions Archive: Amazon Jobs Delete: Amazon Jobs');
    // Stop ends a run now, through the store: the real time it ran, no roles kept, not a problem.
    const { store: other } = loadStore();
    const stopped = other.stopRun('amazon');
    expect(stopped).toMatchObject({ ok: true });
    expect(stopped.run).toMatchObject({ status: 'stopped', kept: 0, elapsedSeconds: 20 });
    expect(other.source('amazon')?.state).toBe('complete');
    expect(script).toContain('const result = store.stopRun(id);');
    expect(script).toContain(
      "deputy?.react?.('saved', { speech: 'Stopped. Nothing was kept.', duty: 'Stopped' });",
    );
  });

  it('shows the Archived view with Restore, from its tab or ?view=archived', () => {
    expect(inner(searches, 'srch-views')).toContain(
      'Archived <span data-metric="sources.archived"></span>',
    );
    expect(searches).toContain(
      '<div class="tab-panel" id="srch-panel-archived" role="tabpanel" aria-labelledby="srch-tab-archived" hidden>',
    );
    expect(script).toContain("if (parameters.get('view') === 'archived') {");
    expect(script).toContain(
      "setQuery({ view: currentView() === 'archived' ? 'archived' : null, page: null });",
    );
    expect(script).toContain(
      "deputy?.react?.('saved', { speech: 'Restored. It’s active again.' });",
    );
    // A source comes back on the schedule it had, and the message says which.
    expect(script).toContain(
      "const schedule = restored.watched\n          ? 'Keep watch checks it every night again.'\n          : 'It runs when you ask.';",
    );
    const { store } = loadStore();
    store.archiveSource('google');
    expect(page.pageModel(store).watch.watched.map((source) => source.id)).toEqual(['microsoft']);
    expect(store.restoreSource('google')?.watched).toBe(true);
    expect(page.pageModel(store).watch.watched.map((source) => source.id)).toEqual([
      'google',
      'microsoft',
    ]);
    expect(words('Restored. It’s active again.')).toBeLessThanOrEqual(6);
  });

  it('expands and collapses every card, and ?expand=all opens them all', () => {
    expect(searches).toContain(
      '<button class="compact-action" id="srch-expand" type="button" data-focus="page:expand">Expand all</button>',
    );
    expect(script).toContain("expandButton.textContent = allOpen ? 'Collapse all' : 'Expand all';");
    expect(script).toContain("if (parameters.get('expand') === 'all' && store?.catalog) {");
  });

  it('shows an edit on the card at once: a source moved to When you ask leaves Keep watch', () => {
    const { store } = loadStore();
    const before = page.pageModel(store);
    expect(page.cardHtml(store, cardOf(before, 'google'), { roles: before.roles })).toContain(
      'Nightly<span class="sr-only"> with Keep watch</span>',
    );
    store.updateSource('google', { schedule: 'manual' });
    const model = page.pageModel(store);
    expect(page.cardHtml(store, cardOf(model, 'google'), { roles: model.roles })).not.toContain(
      'srch-chip',
    );
    expect(model.watch.watched.map((source) => source.short)).toEqual(['Microsoft']);
    // Round 6, part 2 (N3): every run uses one. Round 7 (R10-9): October counts Gmail's daily
    // scans too, so 4 runs are left, and Keep watch's one source and Gmail's scan use two a day.
    expect(store.metricText('watch.nightly.lastsThrough')).toBe('Sun, Oct 4');
  });
});

describe('searches page · arriving from a link (round 6, D1)', () => {
  // The owner: "Clicking Last search ... takes me to the right search but it selects the whole
  // card and also the filter, which looks odd." A link into a source now lands on its run inside
  // its folded card: no outline, no open settings, no filter changed.
  const arrivedAt = (store: Store, id: string, runId: string | null = null) => {
    const model = page.pageModel(store);
    const card = cardOf(model, id);
    const run = page.arrivalRun(store, card, runId);
    return {
      card,
      run,
      html: page.cardHtml(store, card, {
        roles: model.roles,
        arrived: run ? { id, runId: run.id } : null,
      }),
    };
  };

  it('picks the run the link names, or the source\u2019s latest', () => {
    const { store } = loadStore();
    const model = page.pageModel(store);
    const google = cardOf(model, 'google');
    expect(page.arrivalRun(store, google)?.id).toBe('r9');
    expect(page.arrivalRun(store, google, 'r6')?.id).toBe('r6');
    // r10 was merged into r9 (round 6, D2), so an old ?run=r10 link opens r9.
    expect(page.arrivalRun(store, cardOf(model, 'microsoft'), 'r10')?.id).toBe('r9');
    // A run of another source, or one that doesn't exist, falls back to the latest.
    expect(page.arrivalRun(store, google, 'r5')?.id).toBe('r9');
    expect(page.arrivalRun(store, google, 'nope')?.id).toBe('r9');
    expect(page.arrivalRun(store, cardOf(model, 'vanarsdel'))).toBeNull();
    expect(page.arrivalRun(store, cardOf(model, 'amazon'))?.status).toBe('live');
  });

  it('draws the run as a row of the folded card, with a heading that takes the focus, each figure once', () => {
    const { store } = loadStore();
    const { html } = arrivedAt(store, 'google');
    // Folded (no settings, no role chips, no schedule), with the row in the tracker's place.
    expect(html).toContain('<article class="srch-card has-track" id="source-google"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toMatch(/srch-settings|data-setting=|choice-chip|is-linked/);
    expect(html).toContain(
      '<section class="srch-track srch-run" id="source-google-run" data-run="r9" aria-labelledby="source-google-run-title">',
    );
    expect(html).toContain(
      '<h4 class="srch-block-title" id="source-google-run-title" tabindex="-1" data-focus="google:run">Latest search · Fri, Oct 2, 02:00</h4>',
    );
    // The row is the latest run, so the summary line steps aside and no figure repeats.
    expect(figures(html)).toEqual([
      { key: 'runs.r9.source.google.checked', shown: '12' },
      { key: 'runs.r9.source.google.kept', shown: '2' },
      { key: 'jobs.new.source.google', shown: '8' },
    ]);
    const row = html.match(/<section class="srch-track srch-run"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(spaced(row.match(/<p class="srch-live-meta">[\s\S]*?<\/p>/)?.[0] ?? '')).toBe(
      'Done in 2 min 0 s · Keep watch · In one run with Microsoft Careers · gpt-5-mini on your OpenAI key',
    );
    expect(row).toContain(
      'href="./jobs-preview.html?source=google&amp;run=r9" data-focus="google:run-roles"',
    );
    expect(text(row.match(/<a class="srch-new-link"[\s\S]*?<\/a>/)?.[0] ?? '')).toBe(
      'See the new roles in Job matches',
    );
  });

  it('keeps the latest run\u2019s summary beside an earlier run, and says a stopped run\u2019s reason', () => {
    const { store } = loadStore();
    const older = arrivedAt(store, 'google', 'r6').html;
    expect(older).toContain('>Earlier search · Mon, Sep 28, 08:30</h4>');
    expect(figures(older).map(({ key }) => key)).toEqual([
      'runs.r6.checked',
      'runs.r6.kept',
      'runs.r9.source.google.checked',
      'runs.r9.source.google.kept',
      'jobs.new.source.google',
    ]);
    const acme = arrivedAt(store, 'acme').html;
    const row = acme.match(/<section class="srch-track srch-run"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(spaced(row)).toBe(
      'Latest search · Mon, Sep 28, 08:45 !The page took too long to load Stopped after 2 min 0 s · You started it · No model: keyword filtering Try another address: Acme Engineering',
    );
    expect(row).not.toContain('srch-new-link');
    // Retry stays the card's action, and the summary line steps aside.
    expect(acme).toContain('data-action="retry"');
    expect(acme).not.toContain('!Stopped Sep 28');
  });

  it('lands on a live run\u2019s tracker row with a heading, and offers a stopped source\u2019s other fix', () => {
    const { store } = loadStore();
    const { html, run } = arrivedAt(store, 'amazon');
    expect(run?.id).toBe('r11');
    // Folded, the tracker row gains the heading; the settings stay folded (the owner saw the open
    // card's role chips and schedule as a chosen filter).
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toMatch(/srch-settings|data-setting=/);
    expect(html).toContain(
      '<section class="srch-track srch-run" id="source-amazon-run" data-run="r11" aria-labelledby="source-amazon-run-title">',
    );
    expect(html).toContain(
      '<h4 class="srch-block-title" id="source-amazon-run-title" tabindex="-1" data-focus="amazon:run">Searching now · started 13:59</h4>',
    );
    expect(html.match(/class="run-tracker"/g)).toHaveLength(1);
    expect(figures(html).filter(({ key }) => liveKeys(key))).toEqual([]);
    // When that run ends while you watch, its finished row keeps the heading (and the focus).
    const { store: ended, clock } = loadStore();
    later(clock, 120);
    const done = page.pageModel(ended, { finished: { amazon: 'r11' } });
    const finished = page.cardHtml(ended, cardOf(done, 'amazon'), {
      roles: done.roles,
      arrived: { id: 'amazon', runId: 'r11' },
    });
    expect(finished).toContain(
      '<h4 class="srch-block-title" id="source-amazon-run-title" tabindex="-1" data-focus="amazon:run">Latest search · finished at 14:01</h4>',
    );
    expect(finished).toContain(
      '<div class="run-tracker" data-state="complete" data-tracker-run="r11">',
    );
    // A card drawn again is changed in place and stays the same element, so the list never holds
    // both (round 6: a doubled list let Chrome's scroll anchoring move the page to its end when a
    // run finished) and no control under the pointer is replaced (part 3, R9-3 and T2-8).
    expect(script).toContain('const placed = item ? morph(item, fresh) : fresh;');
    // An earlier run of the source that is searching now (a Dashboard bar for Sep 24): its row
    // comes under the live tracker, which keeps its own place and no heading.
    const earlier = arrivedAt(store, 'amazon', 'r4').html;
    expect(earlier).toContain('<article class="srch-card has-track has-landed" id="source-amazon"');
    expect(earlier).toContain('<div class="srch-track"><div class="run-tracker" data-state="live"');
    expect(earlier).toContain(
      '<section class="srch-run srch-landed" id="source-amazon-run" data-run="r4" aria-labelledby="source-amazon-run-title">',
    );
    expect(earlier).toContain('>Earlier search · Thu, Sep 24, 11:05</h4>');
    expect(figures(earlier).map(({ key }) => key)).toEqual([
      'runs.r4.checked',
      'runs.r4.kept',
      'jobs.new.source.amazon',
    ]);
    expect(styles.replace(/\s+/g, ' ')).toContain(
      '.srch-card.has-track.has-landed { grid-template-areas: "mark head head" "mark track track" "mark landed landed" "mark body action"; }',
    );
    // Acme needs you: Retry is the card's action, and Try another address sits in the row.
    const acme = arrivedAt(store, 'acme').html;
    expect(acme).toContain(
      '<span class="srch-panel-actions"><button class="compact-action" type="button" data-action="replace" data-source="acme" data-focus="acme:replace">Try another address<span class="sr-only">: Acme Engineering</span></button></span>',
    );
  });

  it('moves the run into Runs once the card is open, and draws nothing for another card', () => {
    const { store } = loadStore();
    const model = page.pageModel(store);
    const open = page.cardHtml(store, cardOf(model, 'google'), {
      roles: model.roles,
      expanded: new Set(['google']),
      arrived: { id: 'google', runId: 'r9' },
    });
    expect(open).not.toContain('srch-run');
    expect(open).toContain('<li class="timeline-item is-done" id="source-google-run-r9">');
    const other = page.cardHtml(store, cardOf(model, 'stripe'), {
      roles: model.roles,
      arrived: { id: 'google', runId: 'r9' },
    });
    expect(other).not.toContain('srch-run');
  });

  it('lands on the run without an outline, a filter, or an open card, and glows once', () => {
    // No outline any more, in any form (the round 5 is-linked mark stayed until you clicked away),
    // so no press clears a mark: the page's one pointerdown listener is the live-update hold
    // (R9-3), which changes nothing you can see.
    expect(`${styles}\n${script}`).not.toMatch(/is-linked|ui\.linked/);
    expect(script.match(/'pointerdown'/g)).toHaveLength(1);
    expect(script).toMatch(/document\.addEventListener\(\s*'pointerdown',\s*\(\) => \{/);
    // A link arrives through arrive(): it places the card on its page under the find you set and
    // never clears a filter; a card the filters hide says so, with Show it.
    expect(script).toContain('else arrive(linked, { runId, runMissing: !runKnown });');
    const arrive = script.slice(
      script.indexOf('function arrive(id'),
      script.indexOf('function watchLive(id)'),
    );
    expect(arrive).toContain('if (!placeInList(id)) {');
    expect(arrive).toContain(`title: \`Your filters hide \${card.name}\`,`);
    expect(arrive).not.toMatch(/bringIntoList|ui\.find = |ui\.expanded\.add/);
    const place = script.slice(
      script.indexOf('function placeInList(id)'),
      script.indexOf('function arrive(id'),
    );
    expect(place).not.toMatch(/q: ''|status: ''|kind: ''/);
    // An archived source switches to Archived and says so, in its card.
    expect(arrive).toContain("selectView(archived ? 'archived' : 'active');");
    expect(arrive).toContain("title: 'In Archived',");
    // The heading takes the focus; the run glows once and fades: 987 ms, then 1.618 s, the design
    // system's one-time sequence, with no CSS animation, and none under reduced or paused motion.
    expect(arrive).toContain("row?.querySelector('.srch-block-title')");
    expect(arrive).toContain('glow(row || element);');
    expect(script).toContain('const GLOW_MS = 2605;');
    expect(script).toContain('const GLOW_HOLD_MS = 987;');
    expect(script).toContain("document.documentElement.dataset.motion === 'paused' ||");
    expect(script).toContain("window.matchMedia?.('(prefers-reduced-motion: reduce)').matches");
    expect(script).toContain("if (motionStill() || typeof element.animate !== 'function') {");
    expect(styles.replace(/\s+/g, ' ')).toContain(
      '.srch-run.is-arrived, .srch-block .timeline-item.is-arrived { background: var(--green-wash); }',
    );
    // A live run lands on its tracker row the same way, and &live=1 still opens Watch live.
    expect(arrive).not.toContain('reveal(');
    expect(script).toContain("if (parameters.get('live') === '1') watchLive(linked);");
  });

  it('lands a ?run= with no source on the run’s own source (round 6 part 3, T2-4)', () => {
    // A run's link from anywhere (the Dashboard's bars, Job matches, Activity) may name the run
    // only: the page finds its source and lands exactly as ?source=&run= does. An old run id
    // opens the run it is part of, through the store.
    expect(script).toContain("const askedRun = parameters.get('run');");
    expect(script).toContain(
      "const runOnly = askedRun && !parameters.get('source') ? (store?.run?.(askedRun) ?? null) : null;",
    );
    expect(script).toMatch(
      /const runSource = runOnly\s*\?\s*\(\(runOnly\.sourceIds \?\? \[\]\)\.find\(\(id\) => cardOf\(id\)\) \?\? runOnly\.sourceId \?\? null\)\s*: null;/,
    );
    expect(script).toMatch(/const linked =\s*parameters\.get\('source'\) \?\?\s*runSource \?\?/);
    // r9 is Keep watch's nightly check of Google and Microsoft, so ?run=r9 (and the old ?run=r10)
    // land on Google, its first source, at that run.
    const { store } = loadStore();
    expect(store.run('r9')?.sourceIds).toEqual(['google', 'microsoft']);
    expect(store.run('r10')?.sourceIds).toEqual(['google', 'microsoft']);
    const model = page.pageModel(store);
    expect(page.arrivalRun(store, cardOf(model, 'google'), 'r10')?.id).toBe('r9');
  });

  it('says so when a link names a run that is not in your history (R9-2)', () => {
    // A run or a source that isn't here: one calm notice over the band, under the intro, in view
    // as the page opens (round 7, T7-4); the address drops a run alone.
    const at = (needle: string) => main.indexOf(needle);
    expect(at('<!-- FlowRibbon: end -->')).toBeLessThan(at('id="srch-missing"'));
    expect(at('id="srch-missing"')).toBeLessThan(at('id="srch-band"'));
    expect(main).toMatch(
      /<section\s+class="feedback-panel srch-missing"\s+id="srch-missing"\s+data-kind="notice"\s+hidden/,
    );
    expect(script).toMatch(
      /\} else if \(askedRun && !parameters\.get\('source'\)\) \{\s*showPanel\(missingPanel, \{\s*kind: 'notice',\s*title: 'That run isn’t in your history',\s*message: 'Your sources are below\.',/,
    );
    expect(script).toMatch(
      /\} else if \(linked\) \{[\s\S]{0,200}?showPanel\(missingPanel, \{\s*kind: 'notice',\s*title: gone \? `\$\{gone\.name\} was deleted` : 'That source isn’t here',/,
    );
    expect(script).toContain('setQuery({ run: null });');
    // A real source with a run it never had: it lands on the source, and its card says so where
    // you land.
    expect(script).toContain(
      'const runKnown = !runId || card.runs.some((run) => run.id === (store.run?.(runId)?.id ?? runId));',
    );
    const arrive = script.slice(
      script.indexOf('function arrive(id'),
      script.indexOf('function watchLive(id)'),
    );
    expect(arrive).toContain('if (runMissing) {');
    expect(arrive).toMatch(/title: `That run isn’t in \$\{whose\} history`/);
    expect(arrive).toContain(
      "const rest = run ? 'Here is its latest run.' : 'It hasn’t run yet.';",
    );
    expect(arrive).toContain(`message: archived ? \`\${rest} \${archivedWords}\` : rest,`);
  });
});

describe('searches page · round 6, part 2 (N1, N3, P-1, P-3, P-4, P-8)', () => {
  it('keeps Keep watch here: the sources, the next check, the most searches a day, and the runs (P-1)', () => {
    const watch = inner(searches, 'keep-watch');
    for (const id of [
      'srch-watch-pick',
      'srch-watch-when',
      'srch-watch-skip',
      'srch-daily',
      'srch-watch-meter',
    ]) {
      expect(watch, id).toContain(` id="${id}"`);
    }
    // Searches a day moved here from Profile: the crawl limit (CRAWL_SETTINGS.dailyLimit), empty
    // for the default, at most the admin maximum, saved through the store's update.
    expect(watch).toContain(
      '<label class="field-label" for="srch-daily-input">Searches a day, at most</label>',
    );
    expect(script).toContain('default: Number(store?.LIMITS?.crawlDailyDefault) || 20,');
    expect(script).toContain('max: Number(store?.LIMITS?.crawlDailyMax) || 50,');
    expect(script).toContain(
      "store.update({ type: 'profile', section: 'preferences' }, (state) => {",
    );
    expect(script).toContain(`\`Searches a day: up to \${CRAWL.default} (the default)\``);
    const { store } = loadStore();
    expect(
      (store.get() as { crawlSettings?: { dailyLimit: number | null } }).crawlSettings,
    ).toEqual({
      dailyLimit: null,
    });
  });

  it('says the daily cap with the runs it can really use (round 6 part 3, T6-7)', () => {
    // Twenty searches a day cannot happen on six runs, and every search uses one run, so the line
    // says the cap and the runs in the same breath. The runs figure is the store's own text.
    expect(inner(searches, 'srch-daily-line').replace(/\s+/g, ' ')).toContain(
      '<span ><span id="srch-daily-text"></span>, <span class="srch-daily-within" id="srch-daily-within"></span ></span>',
    );
    expect(script).toContain(
      "const left = Number(store?.metric?.('runs.left') ?? model?.watch?.left ?? 0);",
    );
    expect(script).toMatch(
      /left\s*\? `within your \$\{store\.metricText\('runs\.left'\)\} \$\{plural\(left, 'run', 'runs'\)\} left`\s*: 'none until you have runs again',/,
    );
    // The usual sample reads "up to 20 (the default), within your 4 runs left" (round 7: Gmail's
    // two October scans used two runs, R10-9).
    const { store } = loadStore();
    expect(store.metricText('runs.left')).toBe('4');
    // The runs part stays on one line, so a wrap never leaves "left" alone, and Change sits in its
    // own column beside the sentence.
    const css = styles.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    expect(css).toContain('.srch-daily-within { white-space: nowrap; }');
    expect(css).toContain(
      '.srch-daily-line { display: grid; grid-template-columns: minmax(0, 1fr) auto;',
    );
  });

  it('never replaces a control while the page updates live (round 6 part 3, R9-3 and T2-8)', () => {
    // A live run ticks every second and ends while you look: the cards are changed in place
    // (morph), so a button, link, or input under the pointer or with the focus is the same element
    // before and after, and a press is never swallowed.
    const morph = script.slice(
      script.indexOf('function morph(from, to)'),
      script.indexOf('// Draws one list of cards'),
    );
    expect(morph).toContain('if (from.nodeType !== to.nodeType || from.nodeName !== to.nodeName)');
    expect(morph).toContain("if (from.matches('.run-tracker[data-tracker-run]')) return from;");
    expect(morph).toContain(
      'if (from instanceof HTMLInputElement && from.checked !== to.checked) from.checked = to.checked;',
    );
    // A node keeps its place by a stable key: its id, its focus key, its tracker's run, and a
    // control's action.
    expect(script).toMatch(
      /const key =\s*node\.id \|\| node\.getAttribute\('data-focus'\) \|\| node\.getAttribute\('data-tracker-run'\) \|\| '';/,
    );
    // The glow a link left on the card stays through a redraw.
    expect(script).toContain("const KEPT_CLASSES = ['is-arrived'];");
    // While a pointer is down, a store change waits and the page catches up after the click (or a
    // second later, whichever comes first), so the control pressed is still there on release.
    expect(script).toContain('const HOLD_MS = 1000;');
    expect(script).toMatch(
      /const liveRender = \(\) => \{\s*if \(holding\) heldRender = true;\s*else render\(\);/,
    );
    expect(script).toContain("window.addEventListener('pointerup', catchUp, true);");
    expect(script).toContain("window.addEventListener('pointercancel', catchUp, true);");
    // The shared pagination draws its links afresh, so it is left alone unless its pages, its
    // page, or the address its links carry changed.
    expect(script).toContain(
      'const signature = JSON.stringify([options, window.location.search]);',
    );
    expect(script).toContain('if (pagerDrawn === signature && pager.page === view.page) return;');
    // Deputy Assist's meter is changed in place too, so its Buy and Change stay put.
    expect(script).toMatch(
      /if \(assistDrawn && html\) \{\s*const next = assistMeter\.cloneNode\(false\);/,
    );
  });

  it('says what runs the AI in one line with what is left, and draws the ring only when little is left or paused (P-3)', () => {
    const { store } = loadStore();
    const usual = page.assistModel(store);
    expect(usual).toMatchObject({ kind: 'key', low: false });
    expect(page.aiLeftHtml(store, usual)).toBe(
      ' · <strong data-metric="ai.limit.left">200,190</strong> tokens left this month',
    );
    // Under a fifth of the limit left: the ring shows (its key carries the figures), the line none.
    store.setAiLimit({ tokens: 55000 });
    const low = page.assistModel(store);
    expect(low).toMatchObject({ kind: 'key', low: true });
    expect(page.aiLeftHtml(store, low)).toBe('');
    expect(page.assistHtml(store, low)).toContain('id="srch-assist-ring"');
    expect(script).toContain("const html = assist?.low ? assistHtml(store, assist) : '';");
    // On platform credits: the tokens of credits left.
    const { store: credits } = loadStore();
    credits.setAiChoice('platform');
    expect(page.aiLeftHtml(credits, page.assistModel(credits))).toBe(
      ' · <strong data-metric="ai.credits.left">339,100</strong> tokens of credits left',
    );
    expect(inner(searches, 'deputy-assist')).toMatch(
      /<span class="srch-ai-left" id="srch-ai-left"><\/span\s*>/,
    );
  });

  it('shows both prompts as the shared prompt summary, card size, each with its own trend (round 7, S3)', () => {
    const prompts = inner(searches, 'srch-prompts');
    // One group, so the two score trends share one key; each card draws its own trend.
    expect(prompts).toMatch(
      /<div class="prompt-summary-list" data-prompt-summaries>\s*<div data-prompt-summary="read" data-prompt-size="card" data-prompt-heading="3"><\/div>\s*<div data-prompt-summary="rank" data-prompt-size="card" data-prompt-heading="3"><\/div>\s*<\/div>/,
    );
    // Read job listings has two tests on the usual sample and Score fit three (78% did not pass,
    // then 85% and 93%), so both draw a trend.
    const { store } = loadStore({ guard: true });
    const tests = (
      store as unknown as {
        promptTests(): { prompts: Array<{ id: string; tests: Array<{ score: number }> }> };
      }
    ).promptTests();
    expect(
      tests.prompts.find((item) => item.id === 'read')?.tests.map((test) => test.score),
    ).toEqual([88, 90]);
    expect(
      tests.prompts.find((item) => item.id === 'rank')?.tests.map((test) => test.score),
    ).toEqual([78, 85, 93]);
  });
});

describe('searches page · find a source and pages (round 5, S3; round 7, R10-6 and R10-7)', () => {
  const find = (query: string) => page.findFrom(new URLSearchParams(query));
  const names = (cards: Card[]) => cards.map((card) => card.name);

  it('finds with the shared filter bar: search, Status and Kind with counts, and the order, live (R10-7)', () => {
    // The host carries the tour step; the shared filter bar draws the search (role="search"), the
    // choices with their counts, Clear, and the result.
    expect(main).toMatch(
      /<div\s+class="srch-find"\s+id="srch-find"\s+data-tour-step="4"\s+data-tour-title="Find any of your sources\."[^>]*><\/div>/,
    );
    expect(main).not.toMatch(/id="srch-query"|id="srch-filters"|id="srch-chips"|id="srch-result"/);
    expect(script).toContain('bar = components.filterBar(findHost, {');
    expect(script).toContain("search: { label: 'Find a source', placeholder: 'Name or address' },");
    // "Status: Any" and "Kind: Any", so the row fits beside Keep watch (round 7); the order shows
    // only its value where the shared bar offers it (requested of PL).
    expect(script).toContain(
      "options: [anyOf('Any'), ...STATUS_FILTERS.map((value) => ({ value, label: STATUS_LABELS[value] }))],",
    );
    expect(script).toContain(
      "options: [anyOf('Any'), ...KIND_FILTERS.map((value) => ({ value, label: KIND_LABELS[value] }))],",
    );
    expect(script).toMatch(
      /name: 'sort',\s*label: 'Order',\s*kind: 'choice',[\s\S]{0,200}?compact: true,/,
    );
    // Every source has one status, so the counts add up to the view (T3-24, T1-23).
    expect(page.STATUS_FILTERS).toEqual(['running', 'needs-you', 'nightly', 'manual', 'not-run']);
    expect(page.STATUS_LABELS.manual).toBe('When you ask');
    expect(script).toContain(
      'options: SORTS.map((value) => ({ value, label: SORT_LABELS[value] })),',
    );
    expect(script).toContain("noun: ['source', 'sources'],");
    // Each change applies at once (the bar says the result once), and each choice counts the
    // sources of the view that pass every other choice with it.
    expect(script).toContain('{ spoken: false },');
    expect(script).toContain(
      'const countFor = (name, value) => cards.filter((card) => passes(card, { ...find, [name]: value })).length;',
    );
    expect(script).toContain('bar.setResult(view.total, cards.length);');
    // The page shows its own find in the bar (a link, Show it, Clear filters), and keeps it in the
    // address itself, so the bar writes none.
    expect(script).toContain(
      'bar.set({ q: find.q, status: find.status, kind: find.kind, sort: find.sort });',
    );
    expect(script).not.toMatch(/param: '(?:q|status|kind|sort)'/);
    // The store's two kinds (KIND_GROUPS) are the filter's.
    const { store } = loadStore();
    expect(store.KIND_GROUPS).toEqual({ 'career-site': 'Career site', 'job-board': 'Job board' });
    // An empty state (no panda: a prop) with Clear filters, in both views.
    for (const id of ['srch-active-none', 'srch-archived-none']) {
      const empty = inner(searches, id);
      expect(empty).toContain(
        '<button class="secondary-action" type="button" data-action="clear-find">Clear filters</button>',
      );
    }
    expect(text(inner(searches, 'srch-active-none'))).toBe(
      'No sources match Try another word, or clear the filters to see every source. Clear filters',
    );
  });

  it('pages with the shared pagination: a pager over the list and the full one after it, the range, and the page size (R10-6)', () => {
    expect(main).toContain('<div class="srch-pages-top" id="srch-pages-top"></div>');
    expect(main).toContain('<div class="srch-pages" id="srch-pages"></div>');
    expect(main.indexOf('id="srch-pages-top"')).toBeLessThan(
      main.indexOf('id="srch-panel-active"'),
    );
    expect(main.indexOf('id="srch-pages"')).toBeGreaterThan(
      main.indexOf('id="srch-panel-archived"'),
    );
    expect(script).toMatch(
      /pager = components\.pagination\(pagesHost, \{\s*\.\.\.options,\s*label: 'Pages of your sources',\s*noun: \['source', 'sources'\],\s*top: pagesTop,\s*sizes: PAGE_SIZES,\s*list: document\.querySelector\('#recent-searches'\),\s*heading: sourcesTitle,\s*href: pageHref,\s*channel: announcer,\s*onChange: \(page\) => goToPage\(page, \{ fromPager: true \}\),\s*onSize: \(size\) => changeSize\(size\),\s*\}\);/,
    );
    // The pager brings Your sources' top back (only when above the screen) and focuses its
    // heading; the page leaves both to it.
    expect(script).toContain('if (fromPager) return;');
    // A page size you choose (12, 24, 48) keeps the first card you were reading on screen, and
    // the address keeps it; Clear filters keeps it too.
    expect(page.pageSize()).toBe(12);
    expect([page.pageSize('24'), page.pageSize(48), page.pageSize(10)]).toEqual([24, 48, 12]);
    expect(script).toContain('ui.find = { ...NO_FIND, size: ui.find.size };');
    expect(styles).toContain('.srch-pages:not(:has(> .pagination:not([hidden]))) {');
  });

  it('reads the find from the address and writes back only what differs', () => {
    expect(find('')).toEqual({ q: '', status: '', kind: '', sort: 'last-run', page: 1, size: 12 });
    expect(find('q=work&status=not-run&kind=job-board&sort=name&page=2&size=24')).toEqual({
      q: 'work',
      status: 'not-run',
      kind: 'job-board',
      sort: 'name',
      page: 2,
      size: 24,
    });
    // Unknown values read as unset; a page below 2 is page 1, and a size not offered is 12.
    expect(find('status=lost&kind=blog&sort=size&page=-3&size=7')).toEqual(page.NO_FIND);
    expect(page.findParams(find('q=work&sort=name&page=2'))).toEqual({
      q: 'work',
      status: null,
      kind: null,
      sort: 'name',
      page: '2',
      size: null,
    });
    expect(page.findParams(find('size=48'))).toMatchObject({ size: '48' });
    expect(page.findParams(page.NO_FIND)).toEqual({
      q: null,
      status: null,
      kind: null,
      sort: null,
      page: null,
      size: null,
    });
    expect(script).toContain('find: findFrom(parameters),');
    expect(script).toContain(
      'setQuery({ ...findParams(ui.find), ...(moved ? { source: null, run: null, live: null } : {}) });',
    );
  });

  it('narrows by words, status, and kind, orders three ways, and pages by the size chosen', () => {
    const { store } = loadStore();
    const model = page.pageModel(store);
    const view = (query: string, size = 12) =>
      page.findView(page.orderCards(model.active, null, find(query).sort).cards, find(query), {
        size,
        live: model.live,
      });
    // Words match a name or an address, whatever the case, accents, or apostrophes.
    expect(names(view('q=work').shown)).toEqual(['Example Workday', 'Margie’s Travel']);
    expect(names(view("q=MARGIE'S").shown)).toEqual(['Margie’s Travel']);
    expect(names(view('q=greenhouse').shown)).toEqual([
      'Acme Engineering',
      'Trey Research',
      'Humongous Insurance',
    ]);
    // Each status, from the store's own state and schedule: one each, so they add up to the
    // view's 16 (round 7, T3-24 and T1-23).
    expect(names(view('status=running').shown)).toEqual(['Amazon Jobs']);
    expect(names(view('status=needs-you').shown)).toEqual(['Acme Engineering']);
    expect(names(view('status=nightly').shown)).toEqual(['Google Careers', 'Microsoft Careers']);
    expect(view('status=manual').total).toBe(11);
    expect(names(view('status=manual').shown)).not.toContain('Amazon Jobs');
    expect(names(view('status=not-run').shown)).toEqual(['VanArsdel']);
    expect(
      page.STATUS_FILTERS.reduce((sum, status) => sum + view(`status=${status}`).total, 0),
    ).toBe(16);
    // The two kinds: 8 career sites and 9 job boards in all, 1 career site archived.
    expect(view('kind=career-site').total + view('kind=job-board').total).toBe(16);
    expect(view('kind=job-board').total).toBe(9);
    // Every word must match; nothing matching is an empty result.
    expect(view('q=work&status=not-run').total).toBe(0);
    // The orders: most new roles first, and by name.
    expect(names(view('sort=new').shown).slice(0, 5)).toEqual([
      'Google Careers',
      'Microsoft Careers',
      'Stripe Jobs',
      'Example Workday',
      'Amazon Jobs',
    ]);
    expect(names(view('sort=name').shown).slice(0, 3)).toEqual([
      'Acme Engineering',
      'Adatum',
      'Alpine Ski House Jobs',
    ]);
    // Pages of the size chosen: 12 sources make two pages of 16, 24 one.
    expect([view('', 12).pages, view('', 24).pages]).toEqual([2, 1]);
    expect(view('page=2', 12).onPage).toHaveLength(4);
    // A page past the end lands on the last one.
    expect(view('page=9', 12).page).toBe(2);
  });

  it('never hides a running search without saying so', () => {
    const { store } = loadStore();
    const model = page.pageModel(store);
    const ordered = page.orderCards(model.active).cards;
    // Filtered out: one line says so, and Show it clears the filters to bring it back.
    const hidden = page.findView(ordered, find('status=nightly'), { size: 12, live: model.live });
    expect(hidden.filteredOut.map((card) => card.id)).toEqual(['amazon']);
    // On another page: the line names the page (Amazon Jobs is on page 1 by name).
    const byName = page.orderCards(model.active, null, 'name').cards;
    const later = page.findView(byName, find('sort=name'), { size: 8, live: model.live });
    expect(later.elsewhere).toEqual([]);
    const second = page.findView(byName, find('sort=name&page=2'), { size: 8, live: model.live });
    expect(second.elsewhere.map(({ card, page: at }) => [card.id, at])).toEqual([['amazon', 1]]);
    expect(script).toContain(
      `words = \`\${hidden.length} running \${plural(hidden.length, 'source is', 'sources are')} filtered out.\`;`,
    );
    expect(script).toContain(`action = \`Go to page \${page}\`;`);
    // A deep link to a source brings it into the list: the filters that hide it clear, and the
    // page that holds it shows.
    expect(script).toContain('function bringIntoList(id) {');
    expect(script).toContain(
      `if (bringIntoList(id)) announce(\`Filters cleared to show \${card.name}.\`);`,
    );
  });
});

describe('searches page · Deputy Assist (round 5, S1)', () => {
  it('shows your key against your limit, and your platform credits as one line, with Buy credits and Change limit', () => {
    const { store } = loadStore();
    const assist = page.assistModel(store);
    expect(assist).toMatchObject({ kind: 'key', limited: false, state: 'ok' });
    const html = page.assistHtml(store, assist);
    expect(html).toContain(
      '<div class="allowance is-ring" id="srch-assist-ring" data-meter-kind="assist">',
    );
    expect(spaced(html)).toBe(
      'Your limit 20% used 49,810 used 200,190 tokens left Of your 250,000-token limit · resets Sun, Nov 1 Platform credits: 339,100 tokens on Ministral 3 14B Buy credits Change limit: the tokens your key may use',
    );
    for (const { key, shown } of figures(html)) expect(shown, key).toBe(store.metricText(key));
    // Every part has its tip (R3-5); Buy credits opens the shared buy dialog (G3).
    expect(html).toMatch(
      /data-part="used" data-tip-title="49,810 tokens used" data-tip="Tokens your OpenAI key used this month, counted against your limit\."/,
    );
    expect(html).toMatch(
      /data-part="left" data-tip-title="200,190 tokens left" data-tip="Tokens left this month before your deputy pauses AI work\."/,
    );
    // Buying has one home (round 7, R10-3): Buy credits opens Purchases' credit packs, and Back
    // there returns to it.
    expect(html).toContain(
      '<a class="secondary-action" href="./shop-preview.html#credits" data-return-link data-focus-key="assist-buy">Buy credits</a>',
    );
    expect(html).not.toMatch(/AI runs?|More AI|data-topup-open/);
  });

  it('says the limit and its reset once, in the words of every page, near the limit too (D-4)', () => {
    const { store } = loadStore();
    store.setAiLimit({ tokens: 60000, onReach: 'pause' });
    const near = page.assistModel(store);
    expect(near).toMatchObject({ kind: 'key', limited: false, state: 'attention' });
    const notes = [
      ...page.assistHtml(store, near).matchAll(/<p class="allowance-note">(.*?)<\/p>/g),
    ].map((match) => spaced(match[1] ?? ''));
    expect(notes).toEqual([
      'Of your 60,000-token limit · resets Sun, Nov 1',
      'At your limit, AI work pauses until it resets',
      'Platform credits: 339,100 tokens on Ministral 3 14B',
    ]);
  });

  it('shows the credits ring on platform credits: tokens left in the centre, free, used, bonus, and bought in the key', () => {
    const { store } = loadStore();
    store.setAiChoice('platform');
    const assist = page.assistModel(store);
    expect(assist).toMatchObject({ kind: 'credits', limited: false, state: 'ok' });
    const html = page.assistHtml(store, assist);
    // Round 7 (R10-3): Buy credits is the one way to Purchases from here.
    expect(spaced(html)).toBe(
      'AI credits 339,100 tokens left 239,100 free 10,900 used +100,000 bonus +0 bought Free credits refresh Sun, Nov 1 Buy credits',
    );
    // Bought is hidden until you buy some (its part and key item).
    expect(html).toContain(
      'data-part="bought" data-tip-title="0 bought" data-tip="Tokens you bought, used last." hidden',
    );
    expect(html).toMatch(/<li class="allowance-key-item" data-part="bought" hidden>/);
    expect(figures(html).map(({ key }) => key)).toEqual([
      'ai.credits.left',
      'ai.credits.freeLeft',
      'ai.credits.usedMonth',
      'ai.credits.bonus',
      'ai.credits.bought',
      'ai.credits.refreshesOn',
    ]);
    for (const { key, shown } of figures(html)) expect(shown, key).toBe(store.metricText(key));
    expect(html).toContain('href="./shop-preview.html#credits"');
    // Tokens on your model, never money here (R5-2).
    expect(html).not.toMatch(/\$|ai\.credits\.value/);
  });

  it('says Deputy Assist is off on keyword filtering, with Turn it on, and draws no ring', () => {
    const { store } = loadStore();
    store.setAiChoice('none');
    expect(page.assistModel(store)).toEqual({ kind: 'off', limited: false, low: false });
    expect(page.assistHtml(store, page.assistModel(store))).toBe('');
    // Nothing is left to count, so the AI line names no tokens (round 6, P-3).
    expect(page.aiLeftHtml(store, page.assistModel(store))).toBe('');
    expect(page.pageModel(store).ai).toMatchObject({
      summary: 'Deputy Assist is off: searches filter by keywords',
      link: 'Turn it on',
    });
    // The meter's host hides when it is empty.
    expect(styles.replace(/\s+/g, ' ')).toContain('.srch-assist-meter:empty { display: none; }');
  });

  it('colours the two rings by kind and draws them with the shared allowance.set', () => {
    expect(script).toContain(
      "components?.allowance?.set(ring, { ...values, state: assist.state, kind: 'assist' });",
    );
    expect(script).toContain("kind: 'watch',");
    expect(main).toContain('data-meter-kind="watch"');
    expect(script).toContain("'data-meter-kind': 'assist'");
  });
});

describe('searches page · one AI setting (round 4, R4-2)', () => {
  it('names what runs every search once, at the top of Deputy Assist, with Change', () => {
    // Round 5 (S1): the line opens Deputy Assist in the side column, above its ring.
    const assist = inner(searches, 'deputy-assist');
    const line = inner(searches, 'srch-ai');
    expect(assist.indexOf('id="srch-assist-title"')).toBeLessThan(assist.indexOf('id="srch-ai"'));
    expect(assist.indexOf('id="srch-ai"')).toBeLessThan(assist.indexOf('id="srch-assist-meter"'));
    expect(searches.match(/id="srch-ai"/g)).toHaveLength(1);
    // The words come from the store (aiChoice().summary), and Change from aiChoice().href.
    expect(line).toMatch(/<span id="srch-ai-text"><\/span\s*>/);
    expect(line).toMatch(
      /<a class="chart-action srch-ai-change" id="srch-ai-change" href="\.\/ai-preview\.html#ai"/,
    );
    expect(spaced(line)).toBe('Change what runs every search');
    expect(script).toContain('setText(aiText, ai.summary);');
    expect(script).toContain(
      "if (aiChange.getAttribute('href') !== ai.href) aiChange.setAttribute('href', ai.href);",
    );
    expect(script).toContain('setText(aiChangeWord, ai.link);');
    const { store } = loadStore();
    expect(page.pageModel(store).ai).toEqual({
      source: 'openai',
      limited: null,
      icon: 'key',
      summary: 'Every search and draft uses gpt-5-mini on your OpenAI key',
      href: './ai-preview.html#ai',
      link: 'Change',
      more: ' what runs every search',
      off: false,
    });
    // It follows the setting, which AI & credits saves for the whole account.
    store.setAiChoice('platform');
    expect(page.pageModel(store).ai).toMatchObject({
      icon: 'platform',
      summary: 'Every search and draft uses Ministral 3 14B on platform credits',
    });
    store.setAiChoice('none');
    expect(page.pageModel(store).ai).toMatchObject({
      icon: 'none',
      summary: 'Deputy Assist is off: searches filter by keywords',
      link: 'Turn it on',
      off: true,
    });
  });

  it('says what happens once your key reached its limit, with Change limit (UAT-D-3)', () => {
    const { store } = loadStore();
    // Pause: the store's own words and the paused mark. Change still opens the one AI setting;
    // Change limit is Deputy Assist's own action, under its ring (round 5, S1).
    store.setAiLimit({ tokens: 10000 });
    expect(page.pageModel(store).ai).toEqual({
      source: 'openai',
      limited: 'paused',
      icon: 'paused',
      summary: 'Your OpenAI key reached your limit: AI work is paused until Sun, Nov 1',
      href: './ai-preview.html#ai',
      link: 'Change',
      more: ' what runs every search',
      off: false,
    });
    const paused = page.assistHtml(store, page.assistModel(store));
    expect(paused).toContain('class="allowance is-ring is-reached"');
    expect(paused).toContain(
      '<a class="chart-action" href="./ai-preview.html#limit" data-return-link data-focus-key="assist-limit">Change limit',
    );
    // The line above gives the date, so the meter's note doesn't repeat it (R3-4).
    expect(figures(paused).map(({ key }) => key)).not.toContain('ai.limit.resetsAt');
    // Use platform credits: what runs the searches now, and until when.
    store.setAiLimit({ onReach: 'platform' });
    expect(page.pageModel(store).ai).toMatchObject({
      limited: 'platform',
      icon: 'platform',
      summary:
        'Your OpenAI key reached your limit: searches and drafts use Ministral 3 14B on platform credits until Sun, Nov 1',
      href: './ai-preview.html#ai',
      link: 'Change',
    });
    // The page writes the store's words, the link, and the paused mark; it adds none of its own.
    expect(script).toContain("aiLine.dataset.limited = ai.limited ?? '';");
    expect(styles.replace(/\s+/g, ' ')).toContain(
      '.srch-ai[data-limited="paused"] .srch-ai-icon { background: var(--orange-soft); }',
    );
  });

  it('offers no AI or model choice on any card, folded or open, and no AI chip', () => {
    const { store } = loadStore();
    const model = page.pageModel(store);
    const everyCard = new Set([...model.active, ...model.archived].map((card) => card.id));
    for (const ui of [{}, { expanded: everyCard }]) {
      const all = drawAll(store, model, ui);
      expect(all).not.toMatch(/data-setting="ai"|name="source-[\w-]+-ai"|AI that reads/);
      expect(all).not.toMatch(
        /<li class="tag srch-chip">|srch-chip-icon[^>]*>[^<]*<circle cx="8\.25"/,
      );
    }
  });

  it('keeps what each run ran on in its history, even after the setting changes', () => {
    const { store } = loadStore();
    const runOf = (id: string) => store.run(id) as Run;
    expect(page.ranWith(store, runOf('r8'))).toBe('Ministral 3 14B on platform credits');
    expect(page.ranWith(store, runOf('r9'))).toBe('gpt-5-mini on your OpenAI key');
    expect(page.ranWith(store, runOf('r3'))).toBe('No model: keyword filtering');
    store.setAiChoice('platform');
    expect(page.ranWith(store, runOf('r9'))).toBe('gpt-5-mini on your OpenAI key');
    const model = page.pageModel(store);
    const google = page.cardHtml(store, cardOf(model, 'google'), {
      roles: model.roles,
      expanded: new Set(['google']),
    });
    const history = spaced(google.match(/<ol class="timeline"[\s\S]*?<\/ol>/)?.[0] ?? '');
    // Round 6 (D2): the nightly run checked Microsoft in the same run, and says so.
    expect(history).toContain(
      'Keep watch · In one run with Microsoft Careers · gpt-5-mini on your OpenAI key',
    );
    expect(history).toContain('You ran it again · Ministral 3 14B on platform credits');
    expect(history).toContain('You started it · gpt-5-mini on your OpenAI key');
  });
});

describe('searches page · your key reached its limit (round 4, D4 and V8)', () => {
  it('says why Run again and Retry do not start, and when the limit resets (pause)', () => {
    const { store } = loadStore();
    expect(store.setAiLimit({ tokens: 10000 })).toMatchObject({
      state: 'reached',
      onReach: 'pause',
    });
    const model = page.pageModel(store);
    for (const [id, via] of [
      ['google', 'again'],
      ['acme', 'retry'],
    ] as const) {
      const result = via === 'retry' ? store.retryRun(id) : store.startRun(id, { via });
      expect(result).toMatchObject({
        ok: false,
        reason: 'own-key-limit-reached',
        onReach: 'pause',
      });
      const note = page.runNote(store, cardOf(model, id), result);
      expect(note).toEqual({
        kind: 'error',
        title: 'Your OpenAI key reached your limit',
        message:
          'AI work is paused until Sun, Nov 1, when your limit resets. Raise it, or let searches use platform credits.',
        actions: [{ label: 'Change limit', href: './ai-preview.html#limit' }],
      });
      // Beside the card's action, with the link to the limit on AI & credits.
      // Back on AI & credits returns to it (round 7, R10-3).
      expect(page.noteHtml(cardOf(model, id), note)).toContain(
        `<a class="feedback-panel-action" href="./ai-preview.html#limit" data-return-link data-focus-key="${id}:change-limit">Change limit</a>`,
      );
    }
    // Nothing new started: the seed's Amazon run is still the only live one.
    expect(store.runs({ status: 'live' }).map((run) => run.sourceId)).toEqual(['amazon']);
    expect(script).toContain('const note = runNote(store, card, result);');
  });

  it('runs on platform credits when you chose that, and says so; pauses once none is left', () => {
    const { store, clock } = loadStore();
    store.setAiLimit({ tokens: 10000, onReach: 'platform' });
    const model = page.pageModel(store);
    const left = store.credits().left;
    const started = store.startRun('google', { via: 'again' });
    expect(started.ok).toBe(true);
    expect(started.run).toMatchObject({ ai: 'platform', model: 'Ministral 3 14B' });
    expect(started.run?.fallback).toEqual({ from: 'openai', reason: 'own-key-limit-reached' });
    expect(page.runNote(store, cardOf(model, 'google'), started)).toEqual({
      kind: 'notice',
      title: 'Running on platform credits',
      message:
        'Your OpenAI key reached your limit, so this search uses Ministral 3 14B on platform credits. Your limit resets Sun, Nov 1.',
      actions: [{ label: 'Change limit', href: './ai-preview.html#limit' }],
    });
    // Its history and Watch live say what it ran on, and why.
    expect(page.ranWith(store, started.run as Run)).toBe(
      'Ministral 3 14B on platform credits, as your OpenAI key had reached your limit',
    );
    // A plain run that starts says nothing beside the card.
    expect(
      page.runNote(store, cardOf(model, 'google'), { ok: true, run: store.run('r9') as Run }),
    ).toBe(null);
    // V8 (round 5): once it finishes, your credits left drop by exactly the tokens it used, and
    // Deputy Assist's platform line reads the new figure.
    later(clock, 120);
    const usedNow = store.credits().usedMonth;
    expect(store.credits().left).toBe(left - (usedNow - 10900));
    expect(store.credits().left).toBeLessThan(left);
    expect(page.assistHtml(store, page.assistModel(store))).toContain(
      `Platform credits: <strong data-metric="ai.credits.left">${store.metricText('ai.credits.left')}</strong> tokens on`,
    );
    // When no credits are left either (the store's own-key-limit-reached with onReach platform),
    // the card says so, when the free credits refresh, and offers Buy credits.
    const refused: StartResult = {
      ok: false,
      reason: 'own-key-limit-reached',
      onReach: 'platform',
      resetsAt: '2026-11-01T00:00:00Z',
      refreshesOn: '2026-11-01T00:00:00Z',
    };
    expect(page.runNote(store, cardOf(model, 'stripe'), refused)).toEqual({
      kind: 'error',
      title: 'Your OpenAI key reached your limit',
      message:
        'No platform credits are left either, so AI work is paused. Your free credits refresh and your limit resets Sun, Nov 1.',
      actions: [
        { label: 'Change limit', href: './ai-preview.html#limit' },
        { label: 'Buy credits', href: './shop-preview.html#credits' },
      ],
    });
    // On platform credits with none left, and while the agreement pauses your deputy.
    expect(
      page.runNote(store, cardOf(model, 'stripe'), {
        ok: false,
        reason: 'credits-out',
        refreshesOn: '2026-11-01T00:00:00Z',
      }),
    ).toEqual({
      kind: 'error',
      title: 'Your platform credits are used up',
      message: 'Free credits refresh Sun, Nov 1. Buy credits, or change what runs every search.',
      actions: [
        { label: 'Buy credits', href: './shop-preview.html#credits' },
        { label: 'Change the AI', href: './ai-preview.html#ai' },
      ],
    });
    expect(
      page.runNote(store, cardOf(model, 'stripe'), {
        ok: false,
        reason: 'agreement-required',
      }),
    ).toEqual({
      kind: 'error',
      title: 'Your deputy is paused',
      message:
        'Searches start again once you sign the updated agreement. Your sources and their runs stay here to read.',
      actions: [
        {
          label: 'Review and sign',
          href: './agreement-preview.html?mode=update&return=searches-preview.html%3Fsource%3Dstripe',
        },
      ],
    });
    // Never the retired AI runs (G3). Round 6 (N3): Get more runs is back, for the runs every
    // search uses; round 7 (R10-3): buying has one home, so it is a link to Purchases' run packs,
    // and Back there returns to it.
    expect(`${main}${script}`).not.toMatch(/free platform run|data-topup-open|'ai' \}/);
    const links = [...main.matchAll(/<a\b([^>]*)\s*>\s*Get more runs\s*<\/a\s*>/g)];
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const [, attributes] of links) {
      expect(attributes).toContain(
        'href="./shop-preview.html#buy" data-return-link data-focus-key=',
      );
    }
    expect(script).toContain(
      "actions: [{ label: result.action ?? 'Get more runs', href: './shop-preview.html#buy' }],",
    );
    // Every action link to a home keeps your place (the card's own focus key for the way back).
    expect(script).toContain(
      'const HOME_PAGE = /^\\.\\/(?:shop|ai|applications|prompts|usage|activity|connections)-preview\\.html(?:[?#]|$)/;',
    );
  });

  it('turns off every start once no run is left, says why once over the list, and offers Get more runs (round 6, N3)', () => {
    const { store, clock } = loadStore();
    // The usual sample has 4 of 10 runs left (round 7: Gmail's two October scans used two, R10-9);
    // every search uses one, whoever starts it.
    expect(store.allowance().runs).toMatchObject({ limit: 10, used: 6, left: 4 });
    expect(page.pageModel(store).runsOut).toBe(false);
    // Round 7 (R10-9): while runs are left, every start says its cost before you press it: the
    // one line over the list, which each card's Run again, Retry, and Search now points at.
    const before = page.pageModel(store);
    expect(page.cardHtml(store, cardOf(before, 'google'), { roles: before.roles })).toContain(
      'data-action="again" data-source="google" data-focus="google:primary" aria-describedby="srch-cost">Run again',
    );
    expect(page.cardHtml(store, cardOf(before, 'acme'), { roles: before.roles })).toContain(
      'data-action="retry" data-source="acme" data-focus="acme:primary" aria-describedby="srch-cost">Retry',
    );
    expect(searches).toContain(
      '<p class="srch-cost" id="srch-cost">Run again, Retry, and Search now each use 1 run.</p>',
    );
    expect(script).toContain('costLine.hidden = out;');
    for (const id of ['google', 'microsoft', 'stripe', 'workday']) {
      expect(store.startRun(id, { via: 'again' }).ok, id).toBe(true);
      later(clock, 200);
    }
    const refused = store.startRun('alpine', { via: 'again' });
    expect(refused).toMatchObject({ ok: false, reason: 'no-runs', action: 'Get more runs' });
    const model = page.pageModel(store);
    expect(model.runsOut).toBe(true);
    // The store's line for Keep watch is then the same words as the notice over the list, so
    // Keep watch leaves it out (T7-R3: say it once).
    expect(store.metricText('runs.lastsText')).toBe('No runs left this month');
    expect(script).toContain(
      "watchLasts.hidden = Boolean(model.runsOut) || !store.metricText('runs.lastsText');",
    );
    // The card says it once, with Get more runs (the run packs): the title is the reason, and the
    // line under it says only when the free runs return (part 3, T2-R2: the panels said "No runs
    // left. No runs are left this month."). The date is the store's.
    expect(page.runNote(store, cardOf(model, 'alpine'), refused)).toEqual({
      kind: 'error',
      title: 'No runs left this month',
      message: 'The free 10 return on Sun, Nov 1.',
      actions: [{ label: 'Get more runs', href: './shop-preview.html#buy' }],
    });
    // Run again, Retry, and Search now are off and point at the one reason over the list.
    const alpine = page.cardHtml(store, cardOf(model, 'alpine'), {
      roles: model.roles,
      runsOut: true,
    });
    expect(alpine).toContain(
      'data-action="again" data-source="alpine" data-focus="alpine:primary" disabled aria-describedby="srch-runs-out">Run again',
    );
    expect(
      page.cardHtml(store, cardOf(model, 'vanarsdel'), { roles: model.roles, runsOut: true }),
    ).toContain(
      'data-action="run" data-source="vanarsdel" data-focus="vanarsdel:primary" disabled aria-describedby="srch-runs-out">Search now',
    );
    // Watch live and Restore never wait for a run.
    expect(
      page.cardHtml(store, cardOf(model, 'contoso'), { roles: model.roles, runsOut: true }),
    ).not.toContain('disabled');
    const notice = inner(searches, 'srch-runs-out');
    expect(text(notice)).toBe('! No runs left this month Get more runs');
    expect(script).toContain(
      'if (out) setText(runsOutText, runsBackText(store, model.watch.refreshesOn));',
    );
    // Add a source with no run left says the source was added and why once: its title, then the
    // note's own title and line ("No runs left this month. The free 10 return on Sun, Nov 1.").
    expect(script).toMatch(/message: `\$\{note\.title\}\. \$\{note\.message\}`,/);
    const note = page.runNote(store, cardOf(model, 'alpine'), refused);
    const said = `${note?.title}. ${note?.message}`;
    expect(said).toBe('No runs left this month. The free 10 return on Sun, Nov 1.');
    expect(said.match(/no runs/gi)).toHaveLength(1);
    expect(notice).toMatch(
      /href="\.\/shop-preview\.html#buy" data-return-link data-focus-key="runs-out-buy"\s*>Get more runs<\/a/,
    );
    expect(searches).toContain('<p class="field-help" id="srch-add-runs" hidden>');
    expect(script).toContain("setText(addSubmit, out ? 'Add this source' : 'Search this source');");
    // Keep watch says its check will be skipped, in the store's words.
    expect(store.allowance().runs.nextCheck).toMatchObject({
      willSkip: ['google', 'microsoft'],
      text: 'Keep watch skips tonight’s check: no runs are left',
    });
    expect(script).toContain("if (skipping) setText(watchSkip, watch.nextCheck.text ?? '');");
    expect(page.watchState(store.allowance().runs)).toBe('reached');
  });

  it('says why a new source could not start its first search', () => {
    expect(script).toContain(
      'const started = result.started ?? (result.run ? { ok: true, run: result.run } : null);',
    );
    expect(script).toContain(`title: \`\${added.name} added, not searched yet\`,`);
    const { store } = loadStore();
    store.setAiLimit({ tokens: 10000 });
    const added = store.addSource({
      address: 'https://careers.fabrikam.example/jobs',
    }) as unknown as {
      ok: boolean;
      started: StartResult;
      source: { id: string; name: string };
    };
    expect(added.ok).toBe(true);
    expect(added.started).toMatchObject({ ok: false, reason: 'own-key-limit-reached' });
    expect(page.runNote(store, added.source, added.started)?.title).toBe(
      'Your OpenAI key reached your limit',
    );
  });
});

describe('searches page · counts in the singular and the plural', () => {
  it('says 1 new role and 1 role checked, and follows a live count', () => {
    const { store, clock } = loadStore();
    store.retryRun('acme');
    later(clock, 120);
    expect(store.metric('jobs.source.acme')).toBe(1);
    expect(page.unitHtml(store, 'jobs.source.acme', 'role', 'roles')).toBe(
      '<span data-unit-for="jobs.source.acme" data-one="role" data-many="roles">role</span>',
    );
    expect(page.unitHtml(store, 'jobs.source.google', 'role', 'roles')).toContain('>roles</span>');
    // A live count is drawn plural and its words follow the figure in place.
    expect(page.unitHtml(store, 'jobs.source.acme', 'role', 'roles', { live: true })).toContain(
      '>roles</span>',
    );
    expect(script).toContain(
      'setText(element, count === 1 ? element.dataset.one : element.dataset.many);',
    );
    // Acme's retry kept 1: its finished view says so in the singular.
    const acmeRun = store.runs({ sourceId: 'acme' })[0] as Run;
    const model = page.pageModel(store, { finished: { acme: acmeRun.id } });
    const acme = page.cardHtml(store, cardOf(model, 'acme'), {
      roles: model.roles,
      expanded: new Set(['acme']),
    });
    expect(text(acme.match(/<a class="srch-new-link"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '')).toBe(
      'See the new role in Job matches',
    );
    // The screen-reader words, the finished link, and the summary labels have both forms.
    for (const [one, many] of [
      [' role checked', ' roles checked'],
      ['the new role', 'the new roles'],
    ]) {
      expect(script, one).toContain(`'${one}'`);
      expect(script, many).toContain(`'${many}'`);
    }
    expect(main).toContain('data-unit-for="sources.active" data-one="Source" data-many="Sources"');
    expect(script).toContain("plural(found, 'role', 'roles')");
    expect(main).toContain(
      'data-unit-for="sources.checked" data-one="Role checked" data-many="Roles checked"',
    );
    expect(script).not.toMatch(/\$\{count\.words\}/);
  });
});

describe('searches page · Keep watch (findings 17 and 23; round 4 S2)', () => {
  it('shows the watched sources, the next check, and the shared ring meter (regular size)', () => {
    const watch = inner(searches, 'keep-watch');
    expect(watch).toContain(
      'Next check <strong data-metric="watch.nightly.nextRunAt"></strong> Pacific',
    );
    // The gallery's ring meter: the parts the ring is drawn from, the centre, and the key. Round
    // 5 (D1): Keep watch's kind, so its left part is the night's indigo, and runs you bought are
    // the bought part (wine), never bonus. Round 6 (N3): it is the Runs allowance every search
    // uses, under the store's runs.* keys, labelled Runs.
    expect(watch).toContain('<p class="allowance-label" id="srch-watch-label">Runs</p>');
    expect(watch).toContain(
      '<p class="allowance-note">Every search uses one run: yours, and each source Keep watch checks.</p>',
    );
    expect(watch).toContain(
      '<div class="allowance is-ring" id="srch-watch-meter" data-meter-kind="watch">',
    );
    expect(watch).toContain('<div class="allowance-ring">');
    expect(watch).not.toContain('is-compact');
    expect(watch).not.toContain('allowance-bar');
    // Round 6 part 3 (R9-1): the ring is every run you can still use, so it is used against left
    // (the runs you bought are among the ones left, not a part of their own).
    for (const part of ['used', 'left']) {
      expect(watch).toContain(`<span class="allowance-part" data-part="${part}"`);
    }
    expect(watch).not.toContain('data-part="bonus"');
    expect(watch).not.toContain('data-part="bought"');
    expect(spaced(inner(watch, 'srch-watch-centre'))).toBe('of left');
    expect(watch).toContain('<span class="allowance-ring-figure" data-metric="runs.left"></span>');
    expect(watch).toContain(
      '<span class="allowance-ring-unit">of <span data-metric="runs.all"></span> left</span>',
    );
    // The key's Left row says the same number in words (R9-1); the centre carries its key, so the
    // row holds no second data-metric, and every other count shows once (R3-4).
    expect(watch).toContain(
      '<li class="allowance-key-item" data-part="left" id="srch-watch-left">\n                        <span id="srch-watch-left-words">Left</span>',
    );
    expect(script).toMatch(/setText\(watchLeftWords, `\$\{text\('runs\.left'\)\} left`\);/);
    expect(watch).toContain('<strong data-metric="runs.used"></strong> used');
    // One quiet line says where the total comes from, once anything was bought.
    expect(watch).toContain(
      '<span data-metric="runs.free"></span> free + <span data-metric="runs.bought"></span> bought',
    );
    expect(script).toContain('watchSplit.hidden = bought === 0;');
    // How long they last, in the store's words for every case (round 7, T1-7).
    expect(watch).toMatch(
      /<p class="allowance-note" id="srch-watch-lasts">\s*<span data-metric="runs\.lastsText"><\/span>\s*<\/p>/,
    );
    // With none left, the notice over the list says so once (T7-R3), so the line stays out.
    expect(script).toContain(
      "watchLasts.hidden = Boolean(model.runsOut) || !store.metricText('runs.lastsText');",
    );
    // Get more runs goes to Purchases' run packs, the one home for buying (round 7, R10-3).
    expect(watch).toMatch(
      /<a class="secondary-action" href="\.\/shop-preview\.html#buy" data-return-link data-focus-key="watch-buy"\s*>Get more runs<\/a\s*>/,
    );
    expect(watch).not.toMatch(/nightly runs?\b/i);
    expect(watch).not.toContain('shop-preview.html#nightly');
    expect(watch).toContain('<p class="sample-note">Sample data · not connected</p>');
    // Keep watch is a proposal: the panel says it is planned, and it never shows a price.
    expect(watch).toContain('<span class="tag">Planned for launch</span>');
    expect(watch).not.toMatch(/\$|price|per month/i);
    // Drawn by the shared allowance.set: used against every run left, of free plus bought
    // (R9-1, T6-1), so the ring never reads "0 of 10 left" while 125 runs remain.
    expect(script).toContain('left: watch.left,');
    expect(script).toContain('limit: all,');
    expect(script).toContain('state: watch.state,');
    expect(script).toContain("kind: 'watch',");
    expect(`${main}\n${script}`).not.toContain('watch.nightly.left');
    expect(script).not.toMatch(/watchCentre\.replaceChildren|renderWatchCentre/);
    const { store } = loadStore();
    expect(page.pageModel(store).watch.watched.map((source) => source.short)).toEqual([
      'Google',
      'Microsoft',
    ]);
    // The usual sample: 4 of 10 left, 6 used (round 7: Gmail's two October scans), nothing
    // bought, so no split line.
    const watchModel = page.pageModel(store).watch;
    expect([watchModel.left, watchModel.limit, watchModel.used, watchModel.bought ?? 0]).toEqual([
      4, 10, 6, 0,
    ]);
    expect(store.metricText('runs.left')).toBe('4');
    expect(store.metricText('runs.all')).toBe('10');
  });

  it('counts the runs you bought among the ones left (R9-1, T6-1)', () => {
    // The Large account demo is the case the figures have to survive: 10 free, 180 bought, 69
    // used (round 7: with Gmail's scans and the daily emails), so 121 are left of 190, and the
    // free allowance alone (0 of 10) is never the ring.
    const { store } = loadStore();
    (store as unknown as { setScaleDemo(mode: string | null): unknown }).setScaleDemo('large');
    const watch = page.pageModel(store).watch;
    expect([
      watch.left,
      watch.freeLeft,
      watch.limit,
      watch.bought ?? watch.topups,
      watch.used,
    ]).toEqual([123, 0, 10, 182, 69]);
    expect(store.metricText('runs.left')).toBe('123');
    expect(store.metricText('runs.all')).toBe('192');
    expect(Number(store.metric('runs.all'))).toBe(
      Number(store.metric('runs.free')) + Number(store.metric('runs.bought')),
    );
    // The ring is drawn from the same sum, so its parts and its centre always agree.
    expect(script).toContain('const all = Number(watch.limit ?? 0) + bought;');
    expect(script).toMatch(/`\$\{text\('runs\.left'\)\} of \$\{text\('runs\.all'\)\} left`,/);
  });

  it('names at most three watched sources, then +N for the rest (round 6, P3)', () => {
    const source = (id: string) => ({ id, name: `${id} Careers`, short: id });
    expect(page.watchingHtml([])).toBe(
      'No source is on Nightly yet. Choose it in a source’s settings.',
    );
    expect(page.watchingHtml(['Google', 'Microsoft'].map(source))).toBe(
      'Watching Google and Microsoft',
    );
    expect(page.watchingHtml(['Google', 'Microsoft', 'Stripe'].map(source))).toBe(
      'Watching Google, Microsoft, and Stripe',
    );
    const thirty = Array.from({ length: 30 }, (_, index) => source(`S${index + 1}`));
    expect(page.watchingHtml(thirty)).toBe(
      'Watching S1, S2, S3 <span class="srch-watch-more">+27<span class="sr-only"> more sources</span></span>',
    );
    expect(page.watchingHtml(thirty.slice(0, 4))).toContain(
      '+1<span class="sr-only"> more source</span>',
    );
    expect(script).toContain('const watching = watchingHtml(watch.watched);');
    // With the shared searchable multi-select (A3), the watched sources are its chosen ones (at
    // most three chips, then "+N more"), every active source is in its list with the roles it
    // found, and each change saves only the schedules that changed.
    expect(inner(searches, 'keep-watch')).toContain(
      '<div class="srch-watch-pick" id="srch-watch-pick"></div>',
    );
    for (const part of [
      "if (!watchPick || typeof components?.multiSelect !== 'function') return;",
      'watchFilter = components.multiSelect(watchPick, {',
      "label: 'Watching',",
      "countLabel: ['role found', 'roles found'],",
      'maxChips: WATCH_NAMES,',
      'onChange: (values) => saveWatched(values),',
      "store.updateSource(card.id, { schedule: nightlyOn ? 'nightly' : 'manual' })",
      'watchSources.hidden = Boolean(watchFilter) && watch.watched.length > 0;',
    ]) {
      expect(script, part).toContain(part);
    }
  });

  it('asks for more runs while the runs left won\u2019t last the month, as every page does', () => {
    const { store } = loadStore();
    const state = () => page.watchState(store.allowance().nightly);
    // Round 6, part 2 (N3): every run uses one. Round 7 (R10-9): 4 runs left, and Keep watch's two
    // sources and Gmail's daily scan use three a day.
    expect(store.metricText('watch.nightly.lastsThrough')).toBe('Sat, Oct 3');
    expect(state()).toBe('attention');
    // Ten more move the date, and eighty more keep everything you turned on running to the
    // month's end (87 for Oct 3 to Oct 31).
    store.requestTopup({ kind: 'nightly', runs: 10 });
    expect(store.metricText('watch.nightly.lastsThrough')).toBe('Tue, Oct 6');
    expect(state()).toBe('attention');
    store.requestTopup({ kind: 'nightly', runs: 80 });
    expect(store.allowance().nightly.coversMonth).toBe(true);
    expect(state()).toBe('ok');
    // With no source on Nightly there is nothing to run out of.
    const { store: other } = loadStore();
    other.updateSource('google', { schedule: 'manual' });
    other.updateSource('microsoft', { schedule: 'manual' });
    expect(page.watchState(other.allowance().nightly)).toBe('ok');
    expect(page.watchState({ ...other.allowance().nightly, perNight: 2, left: 0 })).toBe('reached');
  });
});

describe('searches page · prompts (finding 30; round 7, R10-5, S3, S4)', () => {
  it('shows the two prompts a search asks only as the shared summary, with Open in Prompts the one way to change them', () => {
    const prompts = inner(searches, 'srch-prompts');
    expect(prompts).toContain('<h2 class="srch-title" id="srch-prompts-title">Prompts</h2>');
    expect([...prompts.matchAll(/data-prompt-summary="(\w+)"/g)].map((match) => match[1])).toEqual([
      'read',
      'rank',
    ]);
    // R10-3 and R10-5: no inline editor on Searches (the version select, Use this version, See the
    // prompt, the drawer), and no second way to the Prompts page (Manage prompts): each card's Open
    // in Prompts carries return= and is drawn by the shared summary.
    expect(main).not.toMatch(
      /data-prompt-open=|data-prompt-control=|See the prompt|Manage prompts|Use this version/,
    );
    expect(script).not.toMatch(
      /promptStates|promptMetaHtml|renderPrompts|renderTrends|scoreTrend\(/,
    );
    expect(styles).not.toMatch(/\.prompt-summary\b/);
  });

  it('names each prompt, its version in use and state, its tokens this month, and its model mix, from the store (S4)', () => {
    const { store } = loadStore({ guard: true });
    const overview = (
      store as unknown as {
        promptsOverview(): {
          prompts: Array<{
            id: string;
            name: string;
            version: { label: string };
            statusLabel: string;
            keptMetric: string;
            tokensMetric: string;
            modelMixText: string;
          }>;
        };
      }
    ).promptsOverview();
    const row = (id: string) => overview.prompts.find((prompt) => prompt.id === id);
    expect([row('read')?.name, row('read')?.version.label, row('read')?.statusLabel]).toEqual([
      'Read job listings',
      'System default',
      'Version 2 on trial on 20% of runs',
    ]);
    expect([row('rank')?.name, row('rank')?.version.label, row('rank')?.statusLabel]).toEqual([
      'Score fit and give reasons',
      'Version 3',
      'In use',
    ]);
    // Each figure has its own key, which no other part of this page shows (each key once).
    for (const id of ['read', 'rank']) {
      expect(row(id)?.keptMetric).toBe(`prompts.${id}.agreement`);
      expect(row(id)?.tokensMetric).toBe(`prompts.${id}.tokens.month`);
      expect(row(id)?.modelMixText, id).toMatch(/^Ran on gpt-5-mini \d+%/);
      expect(main).not.toContain(`data-metric="prompts.${id}`);
    }
  });
});

describe('searches page · the tour (R3-6)', () => {
  it('marks ten steps in the deputy\u2019s own words: the band\u2019s two charts, add, find, the views, a card, Watch live, Keep watch, the prompts, and the AI line', () => {
    const { store } = loadStore();
    const model = page.pageModel(store);
    const cards = drawAll(store, model, { tourCard: 'amazon', tourLive: 'amazon' });
    const steps = [
      ...`${main}\n${cards}`.matchAll(
        /data-tour-step="(\d+)"\s+data-tour-title="([^"]+)"\s+data-tour-text="([^"]+)"/g,
      ),
    ]
      .map((match) => [Number(match[1]), match[2], match[3]] as const)
      .sort((a, b) => a[0] - b[0]);
    // Round 7 (R10-2): the band leads, so its two charts are steps 1 and 2. Step 3 is the Add a
    // source row, or the button that opens it: the markup carries both, one of the two shows at
    // any width, and the tour skips the hidden one. The button gives the step up while the row is
    // open, so a running tour always has ten steps (nine when no search is live, since Watch live
    // rings the live run's tracker).
    expect(script).toContain("if (open) addOpen.removeAttribute('data-tour-step');");
    expect(script).toContain("else addOpen.setAttribute('data-tour-step', '3');");
    // Round 6 (R6-2, G6): the deputy gives the tour, so each title is his speech line (first
    // person, at most six words) and each body says what he does and what you can do.
    expect(steps.map(([number, title]) => `${number} ${title}`)).toEqual([
      // Round 7 (D7): the charts that moved from the Dashboard keep its tour titles.
      '1 Here is where I found them.',
      '2 This is what each search found.',
      '3 Give me a place to look.',
      '3 Give me a place to look.',
      '4 Find any of your sources.',
      '5 I search the active ones.',
      '6 Each card is one source.',
      '7 Watch me search live.',
      // Round 6 (P-4): the side column's order, Keep watch, the prompts, then the AI line.
      '8 I check these every night.',
      '9 Here is what I am asked.',
      '10 This is what runs my AI.',
    ]);
    for (const [, title, copy] of steps) {
      expect(words(title ?? ''), title).toBeLessThanOrEqual(6);
      expect(`${title} ${copy}`, title).toMatch(/\b(?:I|me|my)\b/);
      expect(copy, title).not.toMatch(/\byour deputy\b/i);
    }
    // Watch live rings the folded card's tracker row; Find a source the search and its filters;
    // Deputy Assist its panel (the one AI setting and its ring).
    expect(cards).toMatch(/<div class="srch-track" data-tour-step="7"/);
    expect(main).toMatch(/<div\s+class="srch-find"\s+id="srch-find"\s+data-tour-step="4"/);
    expect(main).toMatch(
      /id="deputy-assist"\s+aria-labelledby="srch-assist-title"\s+data-tour-step="10"/,
    );
    // Matches by source's words follow the store: with more than five sources, Other and See all.
    expect(script).toContain("bandSources.setAttribute('data-tour-text', card.tourText);");
    for (const [, , copy] of steps) {
      expect(copy).not.toMatch(/[\u2014\u2013]/);
      expect(copy).not.toMatch(/\d/);
    }
    // Keep watch's exact time and free runs come from the store when the page starts, and the
    // rings' colours from the shared palette's words (round 5, D1).
    expect(script).toContain(`\${store.LIMITS.nightlyAt} Pacific`);
    expect(script).toContain(`\${store.LIMITS.nightlyMonth} a month are free`);
    expect(script).toContain("word('left', 'watch', 'indigo')");
    expect(script).toContain("word('left', 'assist', 'teal')");
    // Part 3 (R9-1): the runs you bought are among the ones left, so the ring has two colours and
    // the tour names those two.
    expect(script).toContain('is left, free runs and any you bought.');
    expect(script).not.toContain("word('parts', 'bought', 'wine')");
    expect(`${main}\n${script}`).not.toMatch(
      /green is left|blue (?:was|are|is) (?:added|runs you added)|black/i,
    );
    // Never on a plain load: ?tour=1 is the engine's; after setup it may start once.
    expect(script).toContain('if (from) components?.tour?.maybeStart?.(undefined, { from });');
  });
});

describe('searches page · the deputy and motion (R3-2, R3-8)', () => {
  it('reacts once to each action: started, saved, archived, deleted, found, and error', () => {
    for (const call of [
      "deputy?.react?.('started');",
      "deputy?.react?.('saved');",
      "deputy?.react?.('archived');",
      "deputy?.react?.('deleted');",
      "deputy?.react?.('error');",
    ]) {
      expect(script, call).toContain(call);
    }
    expect(script).not.toContain("flash('success'");
  });

  it('searches while a run is live and rests when none is', () => {
    expect(script).toContain("deputyHost?.toggleAttribute('data-deputy-working', working);");
    expect(script).toContain("if (working) deputy.set('search', { working: true });");
    expect(script).toContain("else deputy.pageState = 'idle';");
    // The dock keeps the page's documented state in its markup.
    expect(searches).toContain('data-deputy-page="searches"');
    expect(searches).toContain('data-deputy-state="search"');
  });

  it('runs no animation of its own, so Pause motion and reduced motion settle everything', () => {
    const css = styles.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/@keyframes|animation\s*:/);
    // Transitions are short UI feedback only.
    for (const match of css.matchAll(/transition:\s*([^;]+);/g)) {
      expect(match[1]).toMatch(/^(?:[\w-]+ 180ms ease,?\s*)+$/);
    }
  });

  it('never hard-codes a header offset', () => {
    expect(script).not.toMatch(/-\s*(?:64|72|89|119|144)\b|<\s*(?:64|72|89|119|144)\b/);
    expect(script).toContain("scrollIntoView({ block: 'start' })");
  });
});

describe('searches page · links and honesty', () => {
  it('answers every deep link the prototype uses for this page', () => {
    for (const part of [
      "parameters.get('source') ??",
      "const runId = parameters.get('run');",
      "if (parameters.get('live') === '1') watchLive(linked);",
      "hash === 'keep-watch'",
      "const prefill = parameters.get('url');",
      'a[href^="./searches-preview.html?source="]',
    ]) {
      expect(script, part).toContain(part);
    }
    // Every Searches link in the other pages and shared scripts lands on something this page has.
    const files = readdirSync(brandDirectory).filter(
      (file) => /\.(?:html|js)$/.test(file) && file !== 'searches-preview.html',
    );
    const targets = new Set<string>();
    for (const file of files) {
      for (const match of sourceFor(file).matchAll(/searches-preview\.html([?#][^"'`\s)<]*)?/g)) {
        targets.add((match[1] ?? '').replace(/&amp;/g, '&'));
      }
    }
    for (const target of targets) {
      const hash = target.split('#')[1]?.replace(/[^\w-].*$/, '');
      if (hash) expect(searches, `#${hash}`).toContain(` id="${hash}"`);
      const query = new URLSearchParams(target.split('#')[0]?.replace(/^\?/, '') ?? '');
      for (const key of query.keys()) {
        expect(
          [
            'source',
            'live',
            'view',
            'add',
            'expand',
            'url',
            'tour',
            'runs',
            'from',
            'prompt',
            // Round 6 (D1): the run a link lands on.
            'run',
            // Round 5 (S3): the find.
            'q',
            'status',
            'kind',
            'sort',
            'page',
          ],
          `?${key}`,
        ).toContain(key);
      }
    }
    // Round 2's addresses for this page keep working.
    for (const part of [
      "(hash.startsWith('source-') ? hash.slice(7) : null)",
      "(hash === 'activity-item' ? (added?.id ?? null) : null)",
      "parameters.get('retryUrl')",
      "const replacing = parameters.get('replaceSource');",
    ]) {
      expect(script, part).toContain(part);
    }
    // The anchors other pages and the deputy's activity link to.
    for (const id of ['add-source', 'recent-searches', 'keep-watch']) {
      expect(searches, `#${id}`).toContain(` id="${id}"`);
    }
  });

  it('says what is sample and what the prototype does not do', () => {
    // The band, Your sources, and Keep watch each say so (round 6, P-16: one note per group; the
    // AI line is one line under them, and the prompt summaries are the store's figures).
    expect(
      main.match(/<p class="sample-note[^"]*">Sample data · not connected<\/p>/g),
    ).toHaveLength(3);
    expect(inner(searches, 'srch-band')).toContain(
      '<p class="sample-note srch-band-note">Sample data · not connected</p>',
    );
    expect(searches).not.toMatch(/\$\d|per month|\/mo\b|€|£/i);
    // Credits show as tokens on your model here, never as money (R5-2), and never AI runs (G3).
    expect(script).not.toMatch(/valueText|ai\.credits\.value|AI runs?\b/);
  });

  it('keeps first person out of its headings and dashes out of its copy and comments', () => {
    const headings = [...main.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/g)].map((match) =>
      text(match[1] ?? ''),
    );
    expect(headings.length).toBeGreaterThan(3);
    for (const heading of headings) expect(heading).not.toMatch(/\b(?:I|I’m|I’ll|me|my)\b/);
    expect(script).not.toMatch(/<h[1-4][^>]*>[^<]*\b(?:I|I’m|I’ll|me|my)\b/);
    expect([main, script, styles].join('\n')).not.toMatch(/[\u2014\u2013]/);
  });
});
