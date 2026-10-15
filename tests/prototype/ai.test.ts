import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Page guarantees for AI & credits (brand/ai-preview.html). Round 3 (brief 4.8; findings 5, 23,
// 26, and 30): the free AI runs and Keep watch's nightly runs with Get more runs, the saved keys
// with Change model (the recommended model first, the others behind a cost caution and a
// confirmation), the six prompts, usage with one representation per figure (R3-4), recent AI
// work, and the page's tour. Round 4 (brief 4.3; D4, D8, R4-1 to R4-3): one AI setting for every
// search, Keep watch check, and draft (#ai, saved with JobDeputyStore.setAiChoice) with the model
// named once; the token limit on your own key (#limit: a ring of tokens used against the limit,
// Change limit with presets, a custom amount, the period, and what happens when it is reached,
// saved with setAiLimit); ring meters for Deputy Assist's free AI runs and Keep watch's nightly
// runs with a Shop link; tokens by task from aiUsageBy('task'), by model only where it repeats no
// figure; and the model once above the prompts. Every figure carries data-metric and shows
// JobDeputyStore.metricText(key). The page keeps its pure rules between `/* ai-rules: start */`
// and `end` markers; they run here on their own, fed by the real store. Round 5 (brief 4.3; G3,
// G4, C1, D1, S4, R5-1, R5-2) retires AI runs: the one AI setting gains the platform model
// (#model, saved with setPlatformModel); Deputy Assist's ring is the AI credits (#credits, tokens
// on your model: used, free left, bonus, bought) with Buy credits; How prices are made (#prices:
// AWS's rate plus the margin, the Region, tax at checkout, AWS's source and the date checked, and
// a worked example) from PRICING and models(); the limit falls back to platform credits; Usage
// (#usage) is the shared usage chart by day, by month, and by task with this month's platform
// cost (round 7, D10: moved to Settings, Usage; one line and #usage's forward stay here);
// the Prompts list holds all eight with the version that runs and its guardrail checks;
// and Keep watch's ring takes the night's indigo and bought runs in wine. Round 6 (B3: T1, S1,
// D4, R6-2, R6-3): the page is a Settings tab with the shared page intro; its prompts section
// moved to Settings, Prompts (#prompts forwards there); Usage reads aiMonthUsage, the
// Dashboard's one usage function, with at most five models and Other; the tour is the deputy's,
// in the first person. Round 6 part 2 (P-2, P-10, P-16, P-24): the nightly runs and How prices
// are made moved to Purchases (#watch and #prices forward there), the credits sit beside your
// limit with one Sample data line under the pair, and the credits ring drops Earn bonus credits.
// The store runs here with A3's prompt guard and A4's agreement text loaded, as the pages load them. The rendered
// checks (contrast, targets, overflow, focus, the metrics probe) run in headless Chrome
// (scripts/ui-audit.mjs, /tmp/jd-r3/tools/metrics.mjs, and /tmp/jd-r4/tools/a11y.mjs).

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');
const ai = sourceFor('ai-preview.html');

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

// Text with the tags taken out and no space put in their place, so "+<strong>2</strong> bonus"
// reads "+2 bonus" and "<span>Oct 6</span>, at" reads "Oct 6, at".
const flatOf = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const mainOf = (source: string): string => source.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? '';
const inlineScript = (source: string): string =>
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

const attributesOf = (tag: string): Record<string, string> =>
  Object.fromEntries(
    [...tag.matchAll(/\s([\w:-]+)(?:="([^"]*)")?/g)].map((match) => [
      match[1] ?? '',
      match[2] ?? '',
    ]),
  );

// The text a person sees at load: no scripts, styles, drawings, comments, visually hidden spans,
// elements with the hidden attribute, or the inside of a closed <details> (its summary counts), as
// /tmp/jd-r2/tools/words.mjs counts it.
// With `desktop`, a compact chart key's meanings are left out too: they show on touch screens and
// in the tooltips where a fine pointer can hover (app-components.css), as at 1440x900.
function visibleText(
  html: string,
  { spaced = true, desktop = false }: { spaced?: boolean; desktop?: boolean } = {},
): string {
  const voids = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr']);
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ');
  const stack: boolean[] = [];
  let out = '';
  for (const token of cleaned.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g)) {
    const [, closing, tag = '', attributes = '', text] = token;
    if (text !== undefined) {
      if (!stack.includes(true)) out += spaced ? ` ${text}` : text;
      continue;
    }
    if (closing) {
      stack.pop();
      continue;
    }
    if (voids.has(tag.toLowerCase()) || attributes.trim().endsWith('/')) continue;
    stack.push(
      /\shidden(?=[\s>=]|$)/.test(attributes) ||
        /class="[^"]*\bsr-only\b/.test(attributes) ||
        (tag === 'details' && !/\sopen\b/.test(attributes)) ||
        (desktop && /class="chart-key-meaning"/.test(attributes)),
    );
  }
  return out
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

// Values from another context, compared as plain data.
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// The page's template literals, quoted with #{…} for their placeholders (a plain string may not
// hold a placeholder of its own).
const tpl = (source: string): string => source.replaceAll('#{', '${');

type Key = { status: string; last4: string; model: string; checked: string } | null;
type Keys = Record<string, Key>;
type FieldError = { field: string; message: string };
type Limit = {
  tokens: number | null;
  period: string;
  onReach: string;
  used: number;
  left: number | null;
  share: number | null;
  state: string;
  resetsAt: string;
  periodLabel: string;
  appliesTo: { source: string; label: string } | null;
  paused: boolean;
  usingPlatform: boolean;
  percent: number | null;
  pausedUntil: string | null;
};
type LimitView = {
  applies: boolean;
  ring: boolean;
  canChange: boolean;
  keyName: string;
  keyLabel: string;
  period: string;
  parts: { used: number; left: number };
  percent: number | null;
  state: string;
  reach: string;
  off: { title: string; message: string } | null;
  tips: { used: string[]; left: string[] };
};
type Choice = {
  source: string;
  label: string;
  model: string | null;
  text: string;
  runsModel: boolean;
  summary: string;
  href: string;
  limited?: string | null;
  until?: string | null;
};
type ActivityItem = {
  id: string;
  title: string;
  meta: string;
  at: string;
  icon: string;
  current: boolean;
  attention: boolean;
};
type Credits = {
  model: { id: string; name: string };
  free: { tokens: number; used: number; left: number; refreshesOn: string };
  bonus: { tokens: number; earned: number; friends: number };
  bought: { tokens: number; value: number };
  left: number;
  value: number;
  valueText: string;
  usedMonth: number;
  state: string;
  pricePerMillion: number;
};
type Model = {
  id: string;
  name: string;
  awsIn: number;
  awsOut: number;
  rateIn: number;
  rateOut: number;
  marginPct: number;
  perMillion: number;
  speedSeconds: number;
  speed: string;
  recommended: boolean;
  chosen: boolean;
  searchCost: { tokens: number; value: number; valueText: string };
};
type Pricing = {
  marginPct: number;
  region: string;
  regionName: string;
  source: string;
  sourceUrl: string;
  checkedOn: string;
  tax: string;
  note: string;
};
type Allowance = {
  ai: Record<string, unknown>;
  credits: Credits;
  nightly: Record<string, unknown> & { lastsThrough: string | null };
};
type Usage = {
  entries: Array<Record<string, unknown>>;
  models: Array<{ keySource: string; provider: string; model: string; runs: number }>;
  pending: string[];
};
type SeriesGroup = { id: string; label: string; keySource?: string; tokens: number; cost: number };
type SeriesBar = {
  date?: string;
  month?: string;
  label: string;
  total: number;
  groups: SeriesGroup[];
};
type MonthUsage = {
  month: string;
  label: string;
  total: number;
  days: Array<{ date: string; total: number; groups: Array<{ id: string; tokens: number }> }>;
  models: Array<{ id: string; label: string; tokens: number; tone: string; keyLabel: string }>;
  tasks: Array<{ id: string; label: string; total: number }>;
  combos: Array<{ text: string }>;
  marks: unknown[];
};
type Prompt = {
  id: string;
  name: string;
  where: Array<{ page: string }>;
  model: { model: string | null; text: string; runsModel: boolean };
  customized: boolean;
  isDefault: boolean;
  version: { id: string; n: number; label: string };
  check: { status: string };
};
type MeterView = {
  parts: Record<string, number>;
  show: Record<string, boolean>;
  parted?: boolean;
  state: string;
  tips: Record<string, string[]>;
};
type AiRules = {
  SOURCES: string[];
  SOURCE_LABELS: Record<string, string>;
  PROVIDERS: Record<
    string,
    { name: string; models: Array<{ id: string; recommended?: boolean; description: string }> }
  >;
  CAUTION: string;
  CAUTION_SMALLER: string;
  COLOUR_WORDS: Record<string, string>;
  ACTIVITY_SHOWN: number;
  tokenWords(count: number): string;
  providerName(provider: string): string;
  defaultModel(provider: string): string;
  isAllowed(provider: string, value: string): boolean;
  isRecommended(provider: string, value: string): boolean;
  findModels(
    provider: string,
    query?: string,
  ): Array<{ id: string; recommended: boolean; description: string }>;
  modelChoices(
    provider: string,
    current: string,
  ): Array<{ id: string; recommended: boolean; current: boolean; meta: string }>;
  modelChange(provider: string, current: string, chosen: string): string;
  modelNote(
    provider: string,
    value: string,
  ): { size: string; caution: string; runs: string; it: string; short: string } | null;
  cautionFor(provider: string, value: string): string;
  normalizeKeys(raw: unknown): Keys;
  available(source: string, keys: Keys): boolean;
  effectiveSource(saved: string | null, keys: Keys): string;
  sourceMeta(source: string, keys: Keys, credits?: unknown): string;
  choiceText(choice: unknown): string;
  summaryParts(choice: unknown): { before: string; strong: string; after: string };
  creditsNotice(credits: unknown): { title: string; message: string } | null;
  creditsView(
    credits: unknown,
    options?: { tokens?: (count: number) => string },
  ): MeterView & { stateText: string };
  modelCards(models: unknown): Array<{
    id: string;
    name: string;
    recommended: boolean;
    chosen: boolean;
    speed: string;
    keys: Record<string, string>;
  }>;
  modelCaution(
    models: unknown,
    id: string,
  ): { title: string; message: string; back: string; backId: string } | null;
  validateKey(draft: {
    provider: string;
    model: string;
    key: string;
    consent: boolean;
  }): FieldError[];
  lastFour(key: string): string;
  formatDate(iso: string): string;
  monthName(iso: string): string;
  LIMIT_PRESETS: number[];
  LIMIT_RANGE: { min: number; max: number };
  PERIODS: Array<{ id: string; label: string; title: string; unit: string; span: string }>;
  REACH: Array<{ id: string; label: string }>;
  parseAmount(
    text: string,
    range?: { min: number; max: number },
  ): { tokens?: number; error?: string };
  limitDraft(
    draft: { amount: string; custom: string; period: string; onReach: string },
    range?: { min: number; max: number },
  ): { tokens?: number; period?: string; onReach?: string; error?: string; field?: string };
  limitChoice(
    limit: unknown,
    presets?: number[],
  ): { amount: string; custom: string; period: string; onReach: string };
  sameLimit(a: unknown, b: unknown): boolean;
  reachLine(limit: unknown): string;
  limitView(limit: unknown, options?: { keysReady?: boolean; source?: string | null }): LimitView;
  limitWords(limit: unknown): string;
  activityItems(sources: {
    live?: unknown[];
    entries?: unknown[];
    log?: unknown[];
    ledger?: unknown[];
  }): ActivityItem[];
  hiddenFrom(count: number, expanded: boolean): number;
};

const aiRules = rulesOf<AiRules>(ai, 'ai', 'aiRules');

type Store = {
  get(): {
    ai: { keys: unknown; log: unknown[]; runs: unknown[]; usage: unknown[] };
    checklist: Record<string, boolean>;
  };
  update(change: Record<string, unknown>, mutate: (state: Record<string, unknown>) => void): void;
  subscribe(listener: (state: unknown, change: { type?: string } | undefined) => void): () => void;
  metric(key: string): unknown;
  metricText(key: string): string;
  allowance(): Allowance;
  credits(): Credits;
  models(): Model[];
  setPlatformModel(id: string): Model | null;
  PRICING: Pricing;
  CREDITS: { freeTokens: number; searchTokens: number; nearSearches: number };
  aiUsage(): Usage;
  aiChoice(): Choice;
  setAiChoice(source: string): Choice | null;
  aiLimit(): Limit;
  setAiLimit(fields: Record<string, unknown>): Limit | null;
  aiUsageBy(by?: string): Array<{
    id: string;
    label: string;
    tokens: number;
    runs: number;
    metric: string;
    prompt: string;
  }>;
  aiUsageSeries(options: { days: number; group: string }): SeriesBar[];
  aiUsageMonths(options: { months: number }): SeriesBar[];
  aiMonthUsage(options?: { month?: string }): MonthUsage;
  todo(): Array<{ id: string; title: string; detail: string; href: string; action: string }>;
  startRun(
    sourceId: string,
    options: { via: string },
  ): { ok: boolean; reason?: string; run?: { ai: string; fallback: unknown } };
  LIMIT_PRESETS: number[];
  LIMIT_RANGE: { min: number; max: number };
  TERMS: Record<string, string>;
  prompts(): Prompt[];
  prompt(id: string): Prompt;
  setPrompt(id: string, text: string | null): { ok?: boolean; reason?: string } | null;
  signAgreement(fields: { version: string; name: string; consents: Record<string, boolean> }): {
    ok: boolean;
  };
  buy(itemId: string): { ok: boolean; reason?: string };
  liveRuns(): Array<Record<string, unknown>>;
  format: {
    ago(value: unknown): string;
    date(value: unknown): string;
    tokens(count: number): string;
  };
};

// The shared sample store, run the way the pages run it: A3's prompt guard and A4's agreement text
// first (the store refuses to save a prompt when the guard is not loaded, R5-5), unless `guard` is
// false. `saved` is the AI & credits choice (localStorage['jobdeputy-ai-source']), which the store
// reads too.
function loadStore(saved: string | null = null, { guard = true }: { guard?: boolean } = {}): Store {
  const storage = new Map<string, string>();
  if (saved !== null) storage.set('jobdeputy-ai-source', saved);
  const window: Record<string, unknown> = { addEventListener: () => {}, location: { search: '' } };
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  const context = { window, localStorage, JSON };
  if (guard) runInNewContext(sourceFor('prompt-guard.js'), context);
  runInNewContext(sourceFor('agreement-text.js'), context);
  runInNewContext(sourceFor('sample-store.js'), context);
  return window.JobDeputyStore as Store;
}

// Signs the current agreement (2026.10), which buying needs (requiresAgreement('buy')).
function signed(store: Store): Store {
  store.signAgreement({
    version: '2026.10',
    name: 'Alex Morgan',
    consents: { read: true, act: true, keep: true },
  });
  return store;
}

const main = mainOf(ai);
const script = inlineScript(ai);
const seed = loadStore();
const seedKeys = aiRules.normalizeKeys(plain(seed.get().ai.keys));

// Every [data-metric] element in main: its key, its text, and whether it starts hidden.
function figuresIn(html: string): Array<{ key: string; text: string; hidden: boolean }> {
  const found: Array<{ key: string; text: string; hidden: boolean }> = [];
  for (const match of html.matchAll(
    /<([a-z]+)\b([^>]*\sdata-metric="([^"]+)"[^>]*)>([^<]*)<\/\1>/g,
  )) {
    const before = html.slice(0, match.index);
    // Hidden when an open ancestor tag still in force carries `hidden`.
    const opened: string[] = [];
    for (const tag of before.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/g)) {
      const [, closing, name = '', attributes = ''] = tag;
      if (['br', 'img', 'input', 'use', 'circle', 'path', 'rect'].includes(name)) continue;
      if (attributes.trim().endsWith('/')) continue;
      if (closing) opened.pop();
      else opened.push(/\shidden(?=[\s>=]|$)/.test(attributes) ? 'hidden' : name);
    }
    found.push({
      key: match[3] ?? '',
      text: (match[4] ?? '').trim(),
      hidden: opened.includes('hidden') || /\shidden(?=[\s>=]|$)/.test(match[2] ?? ''),
    });
  }
  return found;
}

// Whether the text at `index` sits inside an element that carries the hidden attribute.
function insideHidden(html: string, index: number): boolean {
  const opened: boolean[] = [];
  for (const tag of html.slice(0, index).matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/g)) {
    const [, closing, name = '', attributes = ''] = tag;
    if (['br', 'img', 'input', 'use', 'circle', 'path', 'rect', 'hr'].includes(name)) continue;
    if (attributes.trim().endsWith('/')) continue;
    if (closing) opened.pop();
    else opened.push(/\shidden(?=[\s>=]|$)/.test(attributes));
  }
  return opened.includes(true);
}

describe('AI & credits page frame', () => {
  it('loads the shell scripts in order, app-panels.js last, before its own script', () => {
    // The orchestrator added A3's prompt guard and A4's agreement text before the store (round 5).
    const order = [
      'app-shell.js',
      'app-components.js',
      'prompt-guard.js',
      'agreement-text.js',
      'sample-store.js',
      'deputy.js',
      'feedback.js',
      'app-panels.js',
    ].map((name) => ai.indexOf(`<script src="./${name}"></script>`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Round 6 (T1): the first inline script is the small #prompts forward at the top of main;
    // the page's own script still comes after app-panels.js.
    expect(order[7]).toBeLessThan(ai.lastIndexOf('<script>'));
    expect(main).toMatch(/^<main class="app-main" id="main">\s*<script>/);
  });

  it('opens with the round 2 title, one short line, the hold-key deputy, and its tour', () => {
    expect(textOf(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')).toBe(
      'What powers the work.',
    );
    // Round 5: the page is about what powers the AI and what it costs.
    const intro = textOf(main.match(/<p class="intro-copy">([\s\S]*?)<\/p>/)?.[1] ?? '');
    expect(intro).toBe('Choose what runs Deputy Assist, and see what it costs.');
    expect(words(intro)).toBeLessThanOrEqual(14);
    expect(ai).toContain('data-deputy-page="ai-credits"');
    expect(ai).toContain('data-deputy-state="hold-key"');
    // Round 6 (R6-3, T1): A3's shared page intro, the eyebrow Settings, and Take the tour in
    // .page-intro-actions (the shared CSS places it); the tour engine reveals it.
    expect(main).toMatch(
      /<section class="page-intro ai-intro" aria-labelledby="page-title" data-page-back>\s*<div class="page-intro-copy">\s*<p class="eyebrow">Settings<\/p>\s*<h1 id="page-title">/,
    );
    expect(main).toContain(
      '<div class="page-intro-actions">\n            <button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour</button>\n          </div>',
    );
    expect(ai).not.toMatch(/\.ai-intro(?:-actions)? \{/);
    // The SettingsTabs block sits right after the intro, with AI & credits current. Round 7:
    // the seven tabs, Usage after AI & credits and Activity last (D10, SE1).
    expect(main).toMatch(/<\/section>\s*<!-- SettingsTabs: start -->/);
    expect(main).toContain(
      '<li><a class="settings-tab" href="./ai-preview.html" aria-current="page">AI &amp; credits</a></li>',
    );
    const tabs = main.slice(
      main.indexOf('<!-- SettingsTabs: start -->'),
      main.indexOf('<!-- SettingsTabs: end -->'),
    );
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
    expect(tabs.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('keeps an anchor on every section the other pages and the brief link to', () => {
    // Round 2: #credits, #keys, #usage, #activity; round 4 the one AI setting (#ai) and your
    // limit (#limit); round 5 the platform model (#model, inside #ai). Round 6 (T1): #prompts
    // forwards to Settings, Prompts; part 2 (P-2, P-10): the nightly runs (#watch) and How prices
    // are made (#prices) moved to Purchases, and both anchors forward there (below). Round 7
    // (D10): usage over time moved to Settings, Usage; #usage forwards there, and one line with
    // its link stays where the section was.
    for (const id of ['ai', 'credits', 'limit', 'keys', 'activity']) {
      expect(main, `#${id}`).toMatch(
        new RegExp(`<section class="task-surface ai-surface[^"]*" id="${id}"`),
      );
    }
    expect(elementById(ai, 'ai')).toMatch(
      /<fieldset\s+class="choice-cards ai-models"\s+id="model"/,
    );
    // The order the brief leads with: the setting and its model, credits beside your limit,
    // the line to Usage, keys, and activity.
    const order = ['ai', 'model', 'credits', 'limit', 'ai-usage-line', 'keys', 'activity'].map(
      (id) => main.indexOf(` id="${id}"`),
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Every page's Change goes to #ai; the limit's To-do item lands on #limit; the nightly
    // item now goes to the Shop's nightly runs (A1, round 5).
    expect(seed.aiChoice().href).toBe('./ai-preview.html#ai');
    expect(sourceFor('sample-store.js')).toContain("'./ai-preview.html#limit'");
    // Round 6, part 2 (N3): one Runs allowance, so the item says Get more runs.
    expect(seed.todo().find((item) => item.id === 'nightly-runs')).toMatchObject({
      href: './shop-preview.html#nightly',
      action: 'Get more runs',
    });
    expect(main).not.toContain('id="source"');
    expect(main).not.toContain('id="keep-watch"');
    for (const id of ['watch', 'prices', 'usage', 'ai-nightly', 'ai-price-explained']) {
      expect(main, id).not.toContain(` id="${id}"`);
    }
  });

  it('marks its sample surfaces once per section group, its sample prices, and what is planned', () => {
    // Round 6 part 2 (P-16): one Sample data line per section group, not per card: under the
    // credits and limit pair and in Recent AI work (Keys has no sample figures). Round 7: Usage
    // moved to its own tab, with its own.
    expect(main.match(/class="sample-note[^"]*">Sample data · not connected</g)?.length).toBe(2);
    const pair = main.slice(
      main.indexOf('<div class="ai-pair">'),
      main.indexOf('<p class="ai-usage-line" id="ai-usage-line">'),
    );
    expect(pair).toMatch(
      /<\/section>\s*<\/div>\s*<p class="sample-note">Sample data · not connected<\/p>\s*<\/div>\s*$/,
    );
    expect(textOf(elementById(ai, 'credits'))).not.toContain('Sample data');
    expect(textOf(elementById(ai, 'limit'))).not.toContain('Sample data');
    expect(textOf(elementById(ai, 'activity'))).toContain('Sample data · not connected');
    // R5-1: every price says it is a sample, beside the models' rates.
    expect(seed.PRICING.note).toBe('Sample prices · nothing is charged');
    expect(textOf(elementById(ai, 'model'))).toContain(seed.PRICING.note);
    expect(textOf(elementById(ai, 'ai-limit-form'))).toContain(
      'Counts tokens on your own keys, on the UTC clock. Local prototype: nothing is sent.',
    );
    expect(textOf(elementById(ai, 'ai-key-form'))).toContain(
      'Local prototype: the key is checked in this browser only. No provider is contacted.',
    );
    expect(textOf(elementById(ai, 'ai-change-form'))).toContain(
      'Your key stays saved; only the model changes. Local prototype: nothing is sent.',
    );
  });

  it('stays within its text budget: prose against the round 4 budget, every word reported', () => {
    // Round 3 set 330 visible words for AI & credits (round 4 read 326, 296 of them prose). Round
    // 5 adds the platform model, How prices are made, the usage views, and two prompts (brief
    // 4.3), so the page reads longer: a proposed budget the orchestrator decides (B3 report). The
    // prose (words with letters; figures, chart keys, and axes are data, the round 4 precedent)
    // is held to 450, and every word to 520; the rendered counts are /tmp/jd-r2/tools/words.mjs.
    const prose = (text: string) => text.split(/\s+/).filter((word) => /\p{L}/u.test(word)).length;
    expect(
      prose(visibleText(main, { desktop: true })) + words('Take the tour'),
    ).toBeLessThanOrEqual(450);
    expect(
      words(visibleText(main, { desktop: true })) + words('Take the tour'),
    ).toBeLessThanOrEqual(520);
    // Explanations are one line at most per section.
    for (const copy of main.matchAll(/<p class="ai-copy">([\s\S]*?)<\/p>/g)) {
      expect(words(textOf(copy[1] ?? ''))).toBeLessThanOrEqual(14);
    }
  });

  it('shows prices only from the store, with tax at checkout and AWS’s source a click away', () => {
    // R5-1: every rate is a metric key of the store's models(); no price is typed in the script.
    expect(script).not.toMatch(/\$\d/);
    for (const model of seed.models()) {
      for (const part of ['in', 'out', 'awsIn', 'awsOut']) {
        expect(main, `${model.id} ${part}`).toContain(`data-metric="ai.price.${model.id}.${part}"`);
      }
    }
    // P-10: How prices are made (the margin, tax at checkout, and AWS's source) is Purchases'
    // one explanation, beside the packs; the models' rates link to it.
    expect(elementById(ai, 'ai-models-foot')).toContain(
      '<a class="chart-action" href="./shop-preview.html#prices" data-return-link data-focus-key="ai-prices">How prices are made<span class="sr-only">, in Purchases</span></a>',
    );
    // Round 7 (SE3): Purchases folds it (a closed disclosure), still at #prices.
    expect(sourceFor('shop-preview.html')).toMatch(
      /<(?:div|details)\s+class="shop-(?:prices|fold)"\s+id="prices"/,
    );
    expect(main).not.toMatch(/ai-price-|data-price-|data-example=/);
    // No dashes as punctuation in what the page says.
    expect(visibleText(main)).not.toMatch(/[–—]/);
    expect(textOf(main)).not.toMatch(/[–—]/);
    expect(script).not.toMatch(/'[^'\n]*[–—][^'\n]*'|`[^`\n]*[–—][^`\n]*`/);
  });

  it('names the matches page Job matches wherever it names it', () => {
    // "Amazon Jobs" and "Stripe Jobs" are sources; the page itself is Job matches.
    expect(textOf(main)).not.toMatch(/\b(?:in|Open|to) Jobs\b|←\s*Jobs/);
    // Round 6: the prompt list moved to Settings, Prompts (prompts.test.ts names its pages).
  });

  it('uses the round 5 names: Deputy Assist on AI credits, never AI runs', () => {
    expect(plain(seed.TERMS)).toMatchObject({
      assist: 'Deputy Assist',
      credits: 'AI credits',
      tokens: 'tokens',
      watch: 'Keep watch',
      // Round 6, part 2 (N3): runs, for every search run.
      nightlyRuns: 'runs',
    });
    expect(elementById(ai, 'credits')).toContain('<p class="section-label">Deputy Assist</p>');
    expect(elementById(ai, 'credits')).toContain('<h2 id="ai-credits-title">AI credits.</h2>');
    expect(textOf(elementById(ai, 'ai-credits-meter'))).toContain('Buy credits');
    // P-2: the runs allowance lives in Purchases; this page names no runs ring.
    expect(main).not.toMatch(/data-topup-open="nightly"|watch\.nightly\.|data-meter-kind="watch"/);
    // AI runs are retired (G3, G4): no free runs ring, no runs packs, no weekly free run.
    expect(main).not.toMatch(
      />Get more runs<|More AI runs|AI runs?\b|free run|bonus runs?\b|this week’s/i,
    );
    expect(script).not.toMatch(
      /AI runs?\b|More AI runs|free run\b|nextFreeAt|ai\.platform\.|ai\.bonus\b|ai\.topups|data-topup-open="ai"/,
    );
    expect(main).not.toContain('data-topup-open="ai"');
  });
});

describe('AI & credits · one representation per figure (R3-3, R3-4)', () => {
  const figures = figuresIn(main);

  it('marks every figure with its metric key and shows the store’s seed text', () => {
    // Round 6 (S1): the prompts' two figures (customized, total) moved to Settings, Prompts;
    // part 2 the nightly runs' seven and the prices' two (the margin, the checked date) moved to
    // Purchases; round 7 (D10) this month's tokens and platform cost moved to Settings, Usage.
    expect(figures.length).toBeGreaterThanOrEqual(25);
    for (const figure of figures) {
      expect(figure.text, figure.key).toBe(seed.metricText(figure.key));
    }
    // Never on a tooltip or a visually hidden label.
    expect(main).not.toMatch(/class="sr-only"[^>]*data-metric|data-metric[^>]*class="sr-only"/);
    expect(main).not.toMatch(/data-tip[^>]*data-metric/);
  });

  it('shows each figure once', () => {
    const keys = figures.map((figure) => figure.key);
    expect(new Set(keys).size).toBe(keys.length);
    const rates = seed
      .models()
      .flatMap((model) =>
        ['in', 'out', 'awsIn', 'awsOut'].map((part) => `ai.price.${model.id}.${part}`),
      );
    expect(keys.sort()).toEqual(
      [
        ...rates,
        'ai.credits.bonus',
        'ai.credits.bought',
        'ai.credits.freeLeft',
        'ai.credits.left',
        'ai.credits.refreshesOn',
        'ai.credits.usedMonth',
        'ai.credits.value',
        'ai.limit.left',
        'ai.limit.percent',
        'ai.limit.resetsAt',
        'ai.limit.tokens',
        'ai.limit.used',
        'ai.model.name',
      ].sort(),
    );
    // What was bought starts hidden, since nothing is bought on the seed.
    expect(figures.filter((figure) => figure.hidden).map((figure) => figure.key)).toEqual([
      'ai.credits.bought',
    ]);
  });

  it('shows one key of each fact the store keeps twice (A1 world.md section 15)', () => {
    // With a monthly limit ai.limit.used is your key's tokens (ai.tokens.own and the model's).
    expect(seed.aiLimit().period).toBe('month');
    expect(seed.metric('ai.limit.used')).toBe(seed.metric('ai.tokens.own'));
    expect(seed.metric('ai.limit.used')).toBe(seed.metric('ai.tokens.model.gpt-5-mini'));
    expect(main).not.toMatch(/data-metric="ai\.tokens\.(?:own|platform|model\.[\w-]+)"/);
    // The credits used this month are the platform's tokens this month: shown once, in the ring.
    expect(seed.metric('ai.credits.usedMonth')).toBe(seed.metric('ai.tokens.platform'));
    // This month's total and its platform cost moved with usage over time to Settings, Usage
    // (round 7, D10), where usage.test.ts holds them.
    expect(seed.metric('ai.tokens.month')).toBe(seed.metric('ai.tokens.byMonth.2026-10'));
    expect(main).not.toMatch(/data-metric="ai\.(?:tokens\.month|cost\.month|tokens\.byMonth\.)/);
    expect(script).not.toMatch(/ai\.tokens\.byMonth\./);
    // Ministral 3 14B's in, out, and blend are all 0.22: the page shows in and out, never blend.
    expect(main).not.toMatch(/\.blend"/);
    // Round 3's AI runs by key repeated the allowance (G2), so no runs figure shows.
    expect(main).not.toMatch(/data-metric="ai\.runs\.|id="ai-usage-runs"/);
    // One key per metric means the figures are never typed in the script either.
    expect(script).not.toMatch(/53,530|48,200|5,330|60,710|54,700|49,810|200,190|339,100|239,100/);
    expect(script).toContain('const metricText = (key) => store?.metricText?.(key) ??');
    expect(script).toMatch(/for \(const element of main\.querySelectorAll\('\[data-metric\]'\)\)/);
  });
});

describe('AI & credits · the one AI setting (#ai, R4-2) and its platform model (#model, G3)', () => {
  const tiles = elementById(ai, 'ai-source-options');

  it('offers the four choices for every search, Keep watch check, and draft as tiles', () => {
    expect(textOf(elementById(ai, 'ai')).startsWith('AI setting What runs your deputy’s AI.')).toBe(
      true,
    );
    expect(tiles).toMatch(
      /^<fieldset\s+class="choice-cards ai-source-tiles"\s+id="ai-source-options"/,
    );
    expect(tiles).toContain(
      '<legend class="sr-only">Every search, Keep watch check, and draft uses</legend>',
    );
    const options = [
      ...tiles.matchAll(
        /<label class="choice-card">\s*<input type="radio" name="ai-source" value="(\w+)"([^>]*)\/>[\s\S]*?<span class="choice-card-label">([^<]+)<\/span>[\s\S]*?<use href="#ai-icon-(\w+)" \/>/g,
      ),
    ].map((match) => [match[1], (match[2] ?? '').trim(), match[3], match[4]]);
    expect(options).toEqual([
      ['openai', 'checked', 'Your OpenAI key', 'key'],
      ['anthropic', 'disabled', 'Your Anthropic key', 'key'],
      ['platform', '', 'Platform credits', 'sparkle'],
      ['none', '', 'Keyword filtering', 'filter'],
    ]);
    expect(plain(aiRules.SOURCES)).toEqual(['openai', 'anthropic', 'platform', 'none']);
    expect(ai).toMatch(
      /@container ai-surface \(min-width: 1000px\) \{\s*\.ai-source-tiles \{\s*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/,
    );
  });

  it('names your key’s model once, in the line under the tiles, and no tile names a model', () => {
    for (const source of aiRules.SOURCES) {
      expect(textOf(elementById(ai, `ai-source-meta-${source}`)), source).toBe(
        aiRules.sourceMeta(source, seedKeys, seed.credits()),
      );
    }
    expect(
      aiRules.SOURCES.map((source) => aiRules.sourceMeta(source, seedKeys, seed.credits())),
    ).toEqual(['Ready', 'Not connected', 'AI credits', 'No AI']);
    // Platform credits say when they run low or out (credits().state).
    expect(aiRules.sourceMeta('platform', seedKeys, { state: 'near' })).toBe(
      'AI credits · running low',
    );
    expect(aiRules.sourceMeta('platform', seedKeys, { state: 'out' })).toBe('AI credits · used up');
    const section = visibleText(elementById(ai, 'ai'));
    expect(section.match(/gpt-5-mini/g)).toHaveLength(1);
    expect(textOf(tiles)).not.toMatch(/gpt-|Ministral|DeepSeek|Claude/);
    // The platform models are named only on their cards (decision 0010).
    expect(loadStore('platform').aiChoice().model).toBe(seed.credits().model.name);
  });

  it('says what the setting runs in the store’s own words', () => {
    expect(textOf(elementById(ai, 'ai-source-status'))).toBe(
      'Saved Every search and draft uses gpt-5-mini on your OpenAI key',
    );
    expect(elementById(ai, 'ai-source-label')).toBe(
      '<span id="ai-source-label">Every search and draft uses <strong><span class="ai-nowrap">gpt-5-mini</span> on your OpenAI key</strong></span>',
    );
    for (const saved of [null, 'openai', 'platform', 'none']) {
      const choice = loadStore(saved).aiChoice();
      const parts = aiRules.summaryParts(choice);
      expect(`${parts.before}${parts.strong}${parts.after}`, String(saved)).toBe(choice.summary);
    }
    expect(plain(aiRules.summaryParts(seed.aiChoice()))).toEqual({
      before: 'Every search and draft uses ',
      strong: 'gpt-5-mini on your OpenAI key',
      after: '',
    });
    expect(plain(aiRules.summaryParts(loadStore('none').aiChoice()))).toEqual({
      before: '',
      strong: 'Deputy Assist is off',
      after: ': searches filter by keywords',
    });
    expect(aiRules.choiceText(seed.aiChoice())).toBe('gpt-5-mini on your OpenAI key');
    expect(aiRules.choiceText(loadStore('platform').aiChoice())).toBe(
      'Ministral 3 14B on platform credits',
    );
    expect(aiRules.choiceText(loadStore('none').aiChoice())).toBe('keyword filtering, with no AI');
    // The page's fallback rule and the store's aiChoice() agree for every saved value.
    for (const saved of [null, 'openai', 'anthropic', 'platform', 'none', 'unknown']) {
      expect(aiRules.effectiveSource(saved, seedKeys), String(saved)).toBe(
        loadStore(saved).aiChoice().source,
      );
    }
  });

  it('says a reached limit in the setting line, leaving its date to Your limit or the credits', () => {
    const paused = loadStore();
    paused.setAiLimit({ tokens: 10000, period: 'month', onReach: 'pause' });
    expect(paused.aiChoice().limited).toBe('paused');
    expect(paused.aiChoice().summary).toBe(
      'Your OpenAI key reached your limit: AI work is paused until Sun, Nov 1',
    );
    expect(plain(aiRules.summaryParts(paused.aiChoice()))).toEqual({
      before: '',
      strong: 'Your OpenAI key reached your limit',
      after: ': AI work is paused until it resets',
    });
    // The date is the limit's reset, which Your limit shows once ("Resets Sun, Nov 1, 00:00 UTC.").
    expect(paused.metricText('ai.limit.resetsAt')).toBe('Sun, Nov 1');
    // V8: Use platform credits falls back while at least a search's worth is left.
    const platform = loadStore();
    platform.setAiLimit({ tokens: 10000, period: 'month', onReach: 'platform' });
    expect(platform.aiChoice().limited).toBe('platform');
    expect(platform.aiChoice().summary).toBe(
      'Your OpenAI key reached your limit: searches and drafts use Ministral 3 14B on platform credits until Sun, Nov 1',
    );
    expect(plain(aiRules.summaryParts(platform.aiChoice()))).toEqual({
      before: '',
      strong: 'Your OpenAI key reached your limit',
      after: ': searches and drafts use Ministral 3 14B on platform credits until it resets',
    });
    // With no credits left, the store's words (world.md section 6) read the same way.
    expect(
      plain(
        aiRules.summaryParts({
          source: 'openai',
          limited: 'paused',
          summary:
            'Your OpenAI key reached your limit and no platform credits are left: AI work is paused until Sun, Nov 1',
        }),
      ),
    ).toEqual({
      before: '',
      strong: 'Your OpenAI key reached your limit and no platform credits are left',
      after: ': AI work is paused until it resets',
    });
    expect(
      plain(
        aiRules.summaryParts({
          source: 'platform',
          limited: 'paused',
          summary:
            'Your platform credits are used up: AI work is paused until Sun, Nov 1, or until you buy credits',
        }),
      ),
    ).toEqual({
      before: '',
      strong: 'Your platform credits are used up',
      after: ': AI work is paused until your free credits refresh, or until you buy credits',
    });
    expect(script).toContain('const parts = rules.summaryParts(choice);');
  });

  it('keeps the pair of cards one height, the setting and its model across the whole width', () => {
    // UAT-D-23: the pair's row stretches its cards, except while the limit form is open. Round 6
    // part 2: one pair (the credits beside your limit), half and half from 760px of row.
    expect(ai).toMatch(/\.ai-pair-grid \{\s*display: grid;\s*gap: 34px;\s*align-items: stretch;/);
    expect(ai).toMatch(
      /\.ai-pair-grid:has\(#ai-limit-form:not\(\[hidden\]\)\) \{\s*align-items: start;/,
    );
    expect(ai).toMatch(
      /@container ai-pair \(min-width: 760px\) \{\s*\.ai-pair-grid \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(main.match(/class="ai-pair"/g)).toHaveLength(1);
    expect(ai).not.toContain('is-golden');
    // #ai is its own row, before the pairs.
    expect(main.indexOf('id="ai"')).toBeLessThan(main.indexOf('class="ai-pair"'));
  });

  it('saves a choice with setAiChoice, never writing storage itself, with Saving… then Saved', () => {
    expect(elementById(ai, 'ai')).not.toMatch(/type="submit"|Save choice/);
    expect(seed.get().checklist.ai).toBe(true);
    expect(script).toContain(
      'const applyChoice = (choice) => (store?.setAiChoice ? store.setAiChoice(choice) : null);',
    );
    expect(script).toContain(
      'const result = rules.available(choice, ai.keys) ? applyChoice(choice) : null;',
    );
    expect(script).not.toMatch(/localStorage\.setItem|localStorage\.removeItem/);
    expect(script).toContain('saveTimer = window.setTimeout(saveSource, wait(420));');
    expect(script).toContain('const busy = saving() || modelSaving();');
    expect(script).toContain(
      "sourceState.textContent = busy ? 'Saving…' : hasChoice ? 'Saved' : 'Default';",
    );
    // R3-8: one reaction for the saved choice, never also a flash.
    expect(script).toMatch(/announce\(`Saved\. \$\{summary\}[\s\S]*?deputy\?\.react\('saved'\);/);
    expect(script).not.toMatch(/deputy\?\.flash\(/);
    expect(elementById(ai, 'ai-source-notice')).toMatch(/data-kind="notice"\s+hidden/);
    expect(main).not.toContain('Start a search');
    // The store saves, tells every listener, and refuses a key that isn't ready.
    const store = loadStore();
    const heard: string[] = [];
    store.subscribe((_state, change) => heard.push(String(change?.type)));
    expect(store.setAiChoice('platform')?.source).toBe('platform');
    expect(store.aiChoice().summary).toBe(
      'Every search and draft uses Ministral 3 14B on platform credits',
    );
    expect(store.setAiChoice('anthropic')).toBeNull();
    expect(store.aiChoice().source).toBe('platform');
    expect(heard).toContain('ai-choice');
  });

  it('says what platform credits with little left mean, when you choose them', () => {
    expect(aiRules.creditsNotice(seed.credits())).toBeNull();
    expect(aiRules.creditsNotice({ state: 'near' })).toEqual({
      title: 'Your AI credits are running low',
      message: 'Fewer than five searches’ worth is left. Buy credits to keep searching.',
    });
    expect(aiRules.creditsNotice({ state: 'out' })).toEqual({
      title: 'Your AI credits are used up',
      message:
        'Not enough is left for a search. Buy credits, or wait for your free credits to refresh.',
    });
    // The store's thresholds: out below a search's worth, near below five.
    expect([seed.CREDITS.searchTokens, seed.CREDITS.nearSearches]).toEqual([11000, 5]);
    expect(script).toContain(
      "const notice = saved === 'platform' ? rules.creditsNotice(store?.credits?.()) : null;",
    );
  });

  it('shows the three platform models with our rate beside AWS’s, speed, and the recommended one', () => {
    const picker = elementById(ai, 'model');
    expect(picker).toMatch(/^<fieldset\s+class="choice-cards ai-models"\s+id="model"/);
    expect(picker).toContain('<legend class="field-label">Model on platform credits</legend>');
    const models = seed.models();
    expect(models.map((model) => [model.id, model.name, model.recommended, model.chosen])).toEqual([
      ['ministral-3-14b', 'Ministral 3 14B', true, true],
      ['gpt-oss-120b', 'gpt-oss-120b', false, false],
      ['deepseek-v3-2', 'DeepSeek V3.2', false, false],
    ]);
    // One card a model: its radio, name, Recommended, our rate, AWS's, and its speed.
    const cards = [...picker.matchAll(/<label class="choice-card">([\s\S]*?)<\/label>/g)].map(
      (match) => {
        const card = match[1] ?? '';
        const line = (name: string) =>
          flatOf(
            card.match(
              new RegExp(
                `<span class="choice-card-meta ${name}">([\\s\\S]*?)</span>\\s*<span class="choice-card-meta`,
              ),
            )?.[1] ??
              card.match(
                new RegExp(`<span class="choice-card-meta ${name}">([^<]*)</span>`),
              )?.[1] ??
              '',
          );
        return {
          id: card.match(/name="ai-model" value="([\w-]+)"/)?.[1],
          chosen: /value="[\w-]+" checked \/>/.test(card),
          name: card.match(/<span class="choice-card-label[^"]*">([^<]+)<\/span>/)?.[1],
          recommended: card.includes('<span class="status-pill is-neutral">Recommended</span>'),
          ours: line('ai-model-rate is-ours'),
          aws: line('ai-model-rate'),
          speed: line('ai-model-speed'),
        };
      },
    );
    expect(cards.map((card) => [card.id, card.chosen, card.name, card.recommended])).toEqual(
      models.map((model) => [model.id, model.chosen, model.name, model.recommended]),
    );
    // Each rate is the store's figure for its key: ours (AWS's plus 10%) beside AWS's.
    const ours = (model: Model) =>
      `Ours ${seed.metricText(`ai.price.${model.id}.in`)} in · ${seed.metricText(`ai.price.${model.id}.out`)} out`;
    const aws = (model: Model) =>
      `AWS ${seed.metricText(`ai.price.${model.id}.awsIn`)} in · ${seed.metricText(`ai.price.${model.id}.awsOut`)} out`;
    expect(cards.map((card) => [card.ours, card.aws])).toEqual(
      models.map((model) => [ours(model), aws(model)]),
    );
    expect(models.map(ours)).toEqual([
      'Ours $0.22 in · $0.22 out',
      'Ours $0.165 in · $0.66 out',
      'Ours $0.682 in · $2.035 out',
    ]);
    for (const model of models) {
      expect(model.rateIn).toBeCloseTo(model.awsIn * 1.1, 6);
      expect(model.rateOut).toBeCloseTo(model.awsOut * 1.1, 6);
    }
    // The speeds come from the store; the foot says once that they are from our test.
    expect(aiRules.modelCards(models).map((card) => card.speed)).toEqual([
      '2.1 s a call',
      '4.8 s a call',
      '9.5 s a call',
    ]);
    expect(cards.map((card) => card.speed)).toEqual(
      aiRules.modelCards(models).map((card) => card.speed),
    );
    // P-10: the rates link to Purchases' one How prices are made.
    expect(textOf(elementById(ai, 'ai-models-foot'))).toBe(
      'Prices per million tokens; speeds from our test. How prices are made , in Purchases Sample prices · nothing is charged',
    );
    expect(picker).toContain('aria-describedby="ai-models-foot"');
  });

  it('saves the platform model with setPlatformModel, and every token figure follows it (W11)', () => {
    expect(script).toContain(
      'const model = id && store?.setPlatformModel ? store.setPlatformModel(id) : null;',
    );
    expect(script).toContain('modelTimer = window.setTimeout(saveModel, wait(420));');
    const store = loadStore();
    const heard: string[] = [];
    store.subscribe((_state, change) => heard.push(String(change?.type)));
    expect(store.setPlatformModel('deepseek-v3-2')?.name).toBe('DeepSeek V3.2');
    expect(heard).toContain('platform-model');
    // The same value reads as fewer tokens on a model whose tokens cost more.
    expect(store.metricText('ai.model.name')).toBe('DeepSeek V3.2');
    expect(store.metricText('ai.credits.left')).toBe('90,863');
    expect(store.metricText('ai.credits.value')).toBe(seed.metricText('ai.credits.value'));
    expect(store.aiChoice().source).toBe('openai');
    expect(loadStore('platform').setPlatformModel('deepseek-v3-2')?.id).toBe('deepseek-v3-2');
    // A model other than the recommended one says how it differs, with the way back.
    expect(plain(aiRules.modelCaution(store.models(), 'deepseek-v3-2'))).toEqual({
      title: 'DeepSeek V3.2 isn’t the model we recommend',
      message:
        'Compared with Ministral 3 14B, it is slower in our test, and a token costs more on it, so your credits buy fewer tokens.',
      back: 'Use Ministral 3 14B',
      backId: 'ministral-3-14b',
    });
    expect(aiRules.modelCaution(store.models(), 'gpt-oss-120b')?.message).toBe(
      'Compared with Ministral 3 14B, it is slower in our test, and its output costs more, so drafts use your credits faster.',
    );
    expect(aiRules.modelCaution(store.models(), 'ministral-3-14b')).toBeNull();
    expect(elementById(ai, 'ai-model-caution')).toMatch(/data-kind="warning"\s+hidden/);
    // Back to Ministral 3 14B restores the tokens.
    store.setPlatformModel('ministral-3-14b');
    expect(store.metricText('ai.credits.left')).toBe('339,100');
    expect(store.setPlatformModel('no-such-model')).toBeNull();
  });
});

describe('AI & credits · your limit (#limit, D4)', () => {
  const section = elementById(ai, 'limit');
  const meter = elementById(ai, 'ai-limit-meter');
  const form = elementById(ai, 'ai-limit-form');
  const view = aiRules.limitView(seed.aiLimit());

  it('draws the share of your limit your key used as a regular ring meter: the percent in the centre', () => {
    expect(flatOf(section).startsWith('Your limit Your OpenAI key.')).toBe(true);
    expect(meter).toMatch(/^<div\s+class="allowance is-ring"\s+id="ai-limit-meter"/);
    expect(meter).toContain('<div class="allowance-ring">');
    const parts = [
      ...meter.matchAll(/<span class="allowance-part" data-part="(\w+)" style="--count: (\d+)"/g),
    ].map((match) => [match[1], Number(match[2])]);
    expect(parts).toEqual([
      ['used', 49810],
      ['left', 200190],
    ]);
    expect(plain(view.parts)).toEqual({ used: 49810, left: 200190 });
    expect([
      view.ring,
      view.canChange,
      view.state,
      view.period,
      view.keyName,
      view.percent,
    ]).toEqual([true, true, 'ok', 'This month', 'Your OpenAI key', 20]);
    // The token ring's one rule, the same on every page (round 5 acceptance, D-4): the centre is
    // the percent used; the key gives the tokens used and the tokens left, each with its figure;
    // one line under it says the limit and when it resets ("Of your 250,000-token limit · resets
    // Sun, Nov 1"), a day's limit with its hour; any limit up to 10,000,000 fits.
    expect(seed.metricText('ai.limit.percent')).toBe('20');
    expect(meter).toContain(
      '<p class="allowance-ring-centre"><span class="allowance-ring-figure"><span data-metric="ai.limit.percent">20</span>%</span> <span class="allowance-ring-unit">used</span></p>',
    );
    expect(meter).toMatch(
      /<ul class="allowance-key">\s*<li class="allowance-key-item" data-part="used"><span><strong data-metric="ai\.limit\.used">49,810<\/strong> used<\/span><\/li>\s*<li class="allowance-key-item" data-part="left"><span><strong data-metric="ai\.limit\.left">200,190<\/strong> tokens left<\/span><\/li>/,
    );
    expect(elementById(ai, 'ai-limit-of')).toBe(
      '<p class="allowance-note" id="ai-limit-of">Of your <span data-metric="ai.limit.tokens">250,000</span>-token limit&nbsp;· resets <span data-metric="ai.limit.resetsAt">Sun, Nov 1</span><span id="ai-limit-utc" hidden>, 00:00 UTC</span></p>',
    );
    expect(script).toContain("limitUtc.hidden = limit.period !== 'day';");
    expect(visibleText(meter, { spaced: false }).replace(/\s+/g, ' ')).toBe(
      'This month 20% used 49,810 used 200,190 tokens left Of your 250,000-token limit · resets Sun, Nov 1 When it’s reached, AI work pauses. Change limit',
    );
    expect(script).not.toMatch(/is-long/);
    expect(textOf(elementById(ai, 'ai-limit-reach'))).toBe(view.reach);
    // Each segment's tip comes from the view.
    for (const part of ['used', 'left'] as const) {
      const tag = meter.match(
        new RegExp(`<span class="allowance-part" data-part="${part}"[^>]*>`),
      )?.[0];
      const attributes = attributesOf(tag ?? '');
      expect([attributes['data-tip-title'], attributes['data-tip']]).toEqual(view.tips[part]);
    }
    // Change limit is the page's one visible primary action at load, and opens the form.
    expect(meter).toContain(
      '<button type="button" class="primary-action" id="ai-limit-open" aria-expanded="false" aria-controls="ai-limit-form">Change limit</button>',
    );
    const shownPrimaries = [...main.matchAll(/class="primary-action"/g)].filter(
      (match) => !insideHidden(main, match.index ?? 0),
    );
    expect(shownPrimaries).toHaveLength(1);
  });

  it('offers the presets, a custom whole number, the period, and what happens when it is reached', () => {
    expect(form).toMatch(/^<form class="ai-limit-form" id="ai-limit-form" novalidate hidden/);
    const amounts = [
      ...form.matchAll(
        /<input type="radio" name="ai-limit-amount" value="(\w+)"( checked)? \/>([^<]+)<\/label>/g,
      ),
    ].map((match) => [match[1], Boolean(match[2]), match[3]]);
    expect(amounts).toEqual([
      ...seed.LIMIT_PRESETS.map((count) => [
        String(count),
        count === seed.aiLimit().tokens,
        count.toLocaleString('en-US'),
      ]),
      ['custom', false, 'Custom'],
    ]);
    expect(plain(aiRules.LIMIT_PRESETS)).toEqual(plain(seed.LIMIT_PRESETS));
    expect(plain(aiRules.LIMIT_RANGE)).toEqual(plain(seed.LIMIT_RANGE));
    expect(form).toContain('<label class="choice-chip">');
    const periods = [
      ...form.matchAll(
        /<input type="radio" name="ai-limit-period" value="(\w+)"( checked)? \/><span class="segmented-label">([^<]+)<\/span>/g,
      ),
    ].map((match) => [match[1], Boolean(match[2]), match[3]]);
    expect(periods).toEqual([
      ['day', false, 'A day'],
      ['week', false, 'A week'],
      ['month', true, 'A month'],
    ]);
    expect(form).toContain('<fieldset class="segmented ai-limit-periods" id="ai-limit-periods">');
    const reach = [
      ...form.matchAll(
        /<input type="radio" name="ai-limit-reach" value="(\w+)"( checked)? \/>[\s\S]*?<span class="choice-card-label">([^<]+)<\/span>/g,
      ),
    ].map((match) => [match[1], Boolean(match[2]), match[3]]);
    expect(reach).toEqual([
      ['pause', true, 'Pause AI work'],
      ['platform', false, 'Use platform credits'],
    ]);
    expect(plain(aiRules.REACH)).toEqual([
      { id: 'pause', label: 'Pause AI work' },
      { id: 'platform', label: 'Use platform credits' },
    ]);
    // Round 5: the fallback is platform credits, while any are left (brief 4.3).
    expect(textOf(elementById(ai, 'ai-limit-reach-options'))).toContain(
      'Use platform credits Deputy Assist runs on platform credits while you have credits left.',
    );
    // The custom amount: a labelled field with its range and FieldFeedback, shown with Custom.
    const custom = elementById(ai, 'ai-limit-custom-field');
    expect(custom).toMatch(/^<div class="ai-field" id="ai-limit-custom-field" hidden>/);
    expect(custom).toContain(
      '<label class="field-label" for="ai-limit-custom">Custom amount</label>',
    );
    const input = attributesOf(custom.match(/<input[\s\S]*?\/>/)?.[0] ?? '');
    expect([input.type, input.inputmode, input['aria-describedby']]).toEqual([
      'text',
      'numeric',
      'ai-limit-custom-help ai-limit-custom-error',
    ]);
    expect(textOf(elementById(ai, 'ai-limit-custom-help'))).toBe(
      'A whole number of tokens, from 10,000 to 10,000,000.',
    );
    expect(custom).toContain('<p class="ai-field-error" id="ai-limit-custom-error" hidden></p>');
    expect(elementById(ai, 'ai-limit-actions')).toContain(
      '<button class="primary-action" id="ai-limit-save" type="submit">Save limit</button>',
    );
    expect(elementById(ai, 'ai-limit-actions')).toContain(
      '<button class="secondary-action" id="ai-limit-cancel" type="button">Cancel</button>',
    );
    // The saved state goes through the shared FeedbackPanel.
    expect(elementById(ai, 'ai-limit-result')).toMatch(/data-kind="success"\s+hidden/);
    expect(textOf(elementById(ai, 'ai-limit-result-title'))).toBe('Limit saved');
    // The form opens on the limit you have.
    expect(plain(aiRules.limitChoice(seed.aiLimit(), seed.LIMIT_PRESETS))).toEqual({
      amount: '250000',
      custom: '',
      period: 'month',
      onReach: 'pause',
    });
    expect(
      plain(
        aiRules.limitChoice(
          { tokens: 10000, period: 'day', onReach: 'platform' },
          seed.LIMIT_PRESETS,
        ),
      ),
    ).toEqual({ amount: 'custom', custom: '10,000', period: 'day', onReach: 'platform' });
    expect(script).toContain("limitOpen.addEventListener('click', openLimitForm);");
    expect(script).toMatch(/event\.key !== 'Escape'[\s\S]*?closeLimitForm\(\{ focus: true \}\);/);
  });

  it('checks a custom amount with field feedback, so 5,000 keeps the old limit', () => {
    const error = (text: string) => aiRules.parseAmount(text, seed.LIMIT_RANGE).error;
    expect(error('5,000')).toBe('5,000 is below the smallest limit, 10,000 tokens.');
    expect(error('5000')).toBe('5,000 is below the smallest limit, 10,000 tokens.');
    expect(error('20,000,000')).toBe('20,000,000 is above the largest limit, 10,000,000 tokens.');
    expect(error('')).toBe('Enter an amount of tokens, from 10,000 to 10,000,000.');
    // UAT-D-5: only digits, with or without thousands commas in their places. Anything else says
    // how to type it, never naming a number nobody typed ("12,5" is not 125).
    for (const text of [
      '1,2,3,4,5',
      '12,5',
      '1,20,000',
      '120,00',
      '120 000',
      '1.5',
      '12k',
      '-20000',
      '120.000',
      ',120,000',
    ]) {
      expect(error(text), text).toBe(
        'Type a whole number of tokens in digits, like 120000 or 120,000.',
      );
    }
    for (const [text, tokens] of [
      ['10,000', 10000],
      ['120000', 120000],
      [' 120,000 ', 120000],
      ['1,000,000', 1000000],
      ['10,000,000', 10000000],
    ] as const) {
      expect(aiRules.parseAmount(text, seed.LIMIT_RANGE).tokens, text).toBe(tokens);
    }
    expect(
      plain(
        aiRules.limitDraft({ amount: 'custom', custom: '5,000', period: 'day', onReach: 'pause' }),
      ),
    ).toEqual({ error: '5,000 is below the smallest limit, 10,000 tokens.', field: 'custom' });
    expect(
      plain(aiRules.limitDraft({ amount: '100000', custom: '', period: 'week', onReach: 'pause' })),
    ).toEqual({ tokens: 100000, period: 'week', onReach: 'pause' });
    // The store agrees: 5,000 is refused and the old limit stays (V7).
    const store = loadStore();
    expect(store.setAiLimit({ tokens: 5000 })).toBeNull();
    expect(store.aiLimit().tokens).toBe(250000);
    // The page shows FieldFeedback and never saves an invalid draft.
    expect(script).toMatch(
      /if \(draft\.error\) \{[\s\S]*?setFieldError\(limitCustomError, limitCustom, draft\.error\);\s*showFieldWithError\(\);[\s\S]*?return;\s*\}/,
    );
    // UAT-A-8: the field keeps focus and comes into view with its error, below the fixed chrome.
    expect(script).toMatch(
      /const showFieldWithError = \(\) => \{\s*limitCustom\.focus\(\{ preventScroll: true \}\);\s*limitCustomField\.scrollIntoView\(\{ block: 'nearest' \}\);\s*\};/,
    );
    expect(script).toContain('const result = store?.setAiLimit?.(draft) ?? null;');
  });

  it('saves each limit through the store, and the ring and its reset follow (V7)', () => {
    const store = loadStore();
    store.setAiLimit({ tokens: 100000, period: 'week', onReach: 'pause' });
    expect([store.metricText('ai.limit.tokens'), store.metricText('ai.limit.resetsAt')]).toEqual([
      '100,000',
      'Mon, Oct 5',
    ]);
    expect(aiRules.limitView(store.aiLimit()).period).toBe('This week');
    store.setAiLimit({ tokens: 10000, period: 'day' });
    const day = aiRules.limitView(store.aiLimit());
    expect([store.metricText('ai.limit.resetsAt'), day.period, day.state]).toEqual([
      'Sat, Oct 3',
      'Today',
      'reached',
    ]);
    expect(day.parts.left).toBe(0);
    const custom = aiRules.limitDraft({
      amount: 'custom',
      custom: '120,000',
      period: 'month',
      onReach: 'pause',
    });
    expect(store.setAiLimit(custom)?.tokens).toBe(120000);
    expect(store.metricText('ai.limit.tokens')).toBe('120,000');
    expect(aiRules.sameLimit(store.aiLimit(), custom)).toBe(true);
    expect(aiRules.limitWords(store.aiLimit())).toBe('120,000 tokens a month');
    // After a save: the form closes, the shared success panel shows by Change limit, the
    // announcement says the limit, its reset, and what happens when it is reached, once each
    // (UAT-A-12), and the deputy reacts once.
    expect(script).toContain(
      tpl(
        "`Limit saved: #{rules.limitWords(result)}. Resets #{store?.format?.date?.(result.resetsAt) ?? ''}, 00:00 UTC. #{rules.reachLine(result)}`",
      ),
    );
    expect(script).toMatch(
      /closeLimitForm\(\);\s*renderAll\(\);[\s\S]*?limitResult\.hidden = false;\s*limitOpen\.focus\(\);\s*announce\(\s*`Limit saved: [\s\S]*?deputy\?\.react\('saved'\);/,
    );
  });

  it('says what happens when the limit is near or reached, by Pause or by platform credits (V8)', () => {
    const near = loadStore();
    near.setAiLimit({ tokens: 60000 });
    const nearView = aiRules.limitView(near.aiLimit());
    expect([nearView.state, nearView.reach]).toEqual([
      'attention',
      'Nearly reached: at the limit, AI work pauses until it resets.',
    ]);
    const store = loadStore();
    store.setAiLimit({ tokens: 10000, period: 'month', onReach: 'pause' });
    expect(store.aiLimit().paused).toBe(true);
    expect(aiRules.limitView(store.aiLimit()).reach).toBe(
      'Reached: raise the limit to resume AI work, or let platform credits stand in.',
    );
    expect(store.aiLimit().percent).toBe(100);
    expect(store.todo().find((item) => item.id === 'ai-limit')).toMatchObject({
      href: './ai-preview.html#limit',
      action: 'Change limit',
    });
    expect(store.startRun('stripe', { via: 'again' })).toMatchObject({
      ok: false,
      reason: 'own-key-limit-reached',
    });
    store.setAiLimit({ onReach: 'platform' });
    expect(store.aiLimit().usingPlatform).toBe(true);
    expect(aiRules.limitView(store.aiLimit()).reach).toBe(
      'Reached: Deputy Assist runs on platform credits until it resets.',
    );
    // The run uses platform credits on your platform model; its tokens come out of the credits
    // when it finishes (the browser probe watches the ring drop by them, V8).
    const run = store.startRun('stripe', { via: 'again' });
    expect([run.ok, run.run?.ai]).toEqual([true, 'platform']);
    expect(aiRules.reachLine({ state: 'ok', onReach: 'platform' })).toBe(
      'When it’s reached, Deputy Assist uses platform credits.',
    );
    expect(aiRules.reachLine({ state: 'near', onReach: 'platform' })).toBe(
      'Nearly reached: at the limit, Deputy Assist uses platform credits.',
    );
    expect(aiRules.reachLine({ state: 'reached', onReach: 'platform', usingPlatform: false })).toBe(
      'Reached, and no platform credits are left. Raise the limit, or buy credits.',
    );
  });

  it('explains the limit when a key is not the setting, and keeps it for later', () => {
    const platform = loadStore('platform');
    expect(platform.aiLimit().appliesTo).toBeNull();
    expect(platform.aiLimit().tokens).toBe(250000);
    const off = aiRules.limitView(platform.aiLimit(), { source: 'platform' });
    expect([off.ring, off.canChange]).toEqual([false, false]);
    expect(off.off).toEqual({
      title: 'Nothing counts now',
      message: 'Deputy Assist uses platform credits, so no tokens count against your key’s limit.',
    });
    expect(aiRules.limitView(loadStore('none').aiLimit(), { source: 'none' }).off?.message).toBe(
      'Deputy Assist is off, so no tokens count against your key’s limit.',
    );
    expect(aiRules.limitView(platform.aiLimit(), { keysReady: false }).off?.title).toBe(
      'No key yet',
    );
    expect(elementById(ai, 'ai-limit-off')).toMatch(/data-kind="notice"\s+hidden/);
    expect(script).toContain('limitBody.hidden = !view.canChange;');
  });
});

describe('AI & credits · Deputy Assist’s AI credits (R4-1, D1, R5-2; the runs moved to Purchases, P-2)', () => {
  const credits = elementById(ai, 'credits');
  const partsOf = (meter: string) =>
    [
      ...meter.matchAll(
        /<span class="allowance-part" data-part="(\w+)" style="--count: (\d+)"( hidden)?/g,
      ),
    ].map((match) => [match[1], Number(match[2]), Boolean(match[3])]);

  it('draws the AI credits as a teal ring: used, free left, bonus, and bought, tokens on your model', () => {
    const meter = elementById(ai, 'ai-credits-meter');
    expect(meter).toMatch(
      /^<div\s+class="allowance is-ring"\s+id="ai-credits-meter"\s+data-meter-kind="assist"/,
    );
    const view = aiRules.creditsView(seed.credits(), { tokens: seed.format.tokens });
    expect(plain(view.parts)).toEqual({ used: 10900, left: 239100, bonus: 100000, bought: 0 });
    expect(partsOf(meter)).toEqual([
      ['used', 10900, false],
      ['left', 239100, false],
      ['bonus', 100000, false],
      ['bought', 0, true],
    ]);
    expect([view.state, view.show.bonus, view.show.bought, view.stateText]).toEqual([
      'ok',
      true,
      false,
      '',
    ]);
    // Round 6 part 3 (T1's note): the key names each figure's window and puts the three parts that
    // make the tokens left before what this month used, so the key adds up to the centre; one line
    // says so in words.
    expect(view.parted).toBe(true);
    expect(aiRules.creditsView({ ...seed.credits(), bonus: null, bought: null }).parted).toBe(
      false,
    );
    expect(elementById(ai, 'ai-credits-parts')).toBe(
      '<p class="allowance-note" id="ai-credits-parts">Tokens left adds the free credits left this month to your bonus and bought credits, which stay until used.</p>',
    );
    expect(script).toContain('creditsParts.hidden = !view.parted;');
    // The parts add up to what is left (world.md section 6): the centre is the total, once.
    const seedCredits = seed.credits();
    expect(seedCredits.free.left + seedCredits.bonus.tokens + seedCredits.bought.tokens).toBe(
      seedCredits.left,
    );
    expect(meter).toContain(
      '<p class="allowance-ring-centre"><span class="allowance-ring-figure is-long" data-metric="ai.credits.left">339,100</span> <span class="allowance-ring-unit">tokens left</span></p>',
    );
    expect(visibleText(meter, { spaced: false }).replace(/\s+/g, ' ')).toBe(
      'On Ministral 3 14B 339,100 tokens left 239,100 free this month +100,000 bonus 10,900 tokens’ worth used this month Tokens left adds the free credits left this month to your bonus and bought credits, which stay until used. Worth $0.07. Free credits refresh Sun, Nov 1. Buy credits Purchases',
    );
    // Money only where money is the point (R5-2): the value beside the tokens.
    expect(seed.metricText('ai.credits.value')).toBe('$0.07');
    expect(meter).toContain(
      '<button type="button" class="secondary-action" data-topup-open="credits" data-focus-key="ai-buy-credits">Buy credits</button>',
    );
    // P-24: the bonus stays in the ring (it is part of the balance); Invite sells it, not here.
    expect(meter).not.toContain('Earn bonus credits');
    expect(meter).not.toContain('./invite-preview.html');
    expect(meter).toContain(
      '<a class="chart-action" href="./shop-preview.html#credits" data-return-link data-focus-key="ai-credits-purchases">Purchases<span class="sr-only">: AI credits</span></a>',
    );
    expect(credits).toContain('<h2 id="ai-credits-title">AI credits.</h2>');
    // Each segment's tip comes from the view.
    for (const part of ['used', 'left', 'bonus', 'bought']) {
      const tag = meter.match(
        new RegExp(`<span class="allowance-part" data-part="${part}"[^>]*>`),
      )?.[0];
      const attributes = attributesOf(tag ?? '');
      expect([attributes['data-tip-title'], attributes['data-tip']], part).toEqual(view.tips[part]);
    }
    // The tour names the colours in the shared palette's words (D1, the orchestrator's rule 3).
    expect(plain(aiRules.COLOUR_WORDS)).toEqual({
      used: 'hatched grey',
      assist: 'teal',
      watch: 'indigo',
      bonus: 'gold',
      bought: 'wine',
    });
    expect(attributesOf(meter.match(/^<div[\s\S]*?>/)?.[0] ?? '')['data-tour-text']).toBe(
      // Round 6 (R6-2): the deputy speaks the tour, in the first person.
      'I show your credits as tokens on your platform model: teal is free credits left, hatched grey is used, gold is bonus from friends, and wine is what you bought. Buy credits adds more; nothing is charged.',
    );
  });

  it('follows the model and what you buy: tokens change with the model, bought credits join the wine part', () => {
    const deepseek = loadStore();
    deepseek.setPlatformModel('deepseek-v3-2');
    const view = aiRules.creditsView(deepseek.credits(), { tokens: deepseek.format.tokens });
    expect(plain(view.parts)).toEqual({ used: 2921, left: 64068, bonus: 26795, bought: 0 });
    // T5-16: the used credits say their unit (tokens' worth on your platform model), and the tip
    // adds the tokens the platform's models used when they differ (the large account: 155,200
    // worth, 92,600 tokens).
    expect(aiRules.creditsView(seed.credits(), { tokens: seed.format.tokens }).tips.used?.[0]).toBe(
      `${seed.format.tokens(seed.credits().usedMonth)} tokens’ worth used`,
    );
    const big = loadStore() as unknown as {
      setScaleDemo?: (name: string) => void;
      credits: () => { usedMonth: number; usedMonthTokens: number };
    };
    big.setScaleDemo?.('large');
    const bigCredits = big.credits();
    if (bigCredits.usedMonthTokens !== bigCredits.usedMonth) {
      expect(aiRules.creditsView(bigCredits, { tokens: seed.format.tokens }).tips.used?.[1]).toBe(
        `AI credits used this month, as tokens on Ministral 3 14B. The platform’s models used ${seed.format.tokens(bigCredits.usedMonthTokens)} tokens for it (Usage shows each one).`,
      );
    }
    expect(view.tips.left?.[1]).toBe(
      'Free credits left this month, as tokens on DeepSeek V3.2. They refresh on the 1st.',
    );
    // Buying needs the current agreement (2026.10), then adds at once and charges nothing.
    const store = loadStore();
    expect(store.buy('credits-5')).toMatchObject({ ok: false, reason: 'agreement-required' });
    signed(store);
    expect(store.buy('credits-5').ok).toBe(true);
    const bought = aiRules.creditsView(store.credits(), { tokens: store.format.tokens });
    expect(bought.parts.bought).toBe(22727272);
    expect(bought.show.bought).toBe(true);
    expect(bought.tips.bought?.[0]).toBe('+22.7 million bought');
    expect(store.metricText('ai.credits.bought')).toBe('22.7 million');
    expect(store.metricText('ai.credits.left')).toBe('23.1 million');
    // Little left: attention when fewer than five searches' worth, reached below one.
    expect(aiRules.creditsView({ ...seed.credits(), state: 'near' }).state).toBe('attention');
    const out = aiRules.creditsView({ ...seed.credits(), state: 'out' });
    expect([out.state, out.stateText]).toEqual([
      'reached',
      'Not enough for a search: buy credits, or wait for the refresh.',
    ]);
    expect(elementById(ai, 'ai-credits-state')).toBe(
      '<p class="allowance-note" id="ai-credits-state" hidden></p>',
    );
  });

  // Round 6 part 2 (P-2, N3): the runs allowance is Purchases' (its home), with the Dashboard and
  // Searches keeping a snapshot ring; AI & credits is about AI, so it shows no runs ring, and its
  // old anchor (#watch) opens Purchases' runs.
  it('leaves the nightly runs to Purchases: no runs ring here, and #watch opens Purchases’ runs', () => {
    expect(main).not.toMatch(
      /id="(?:watch|ai-nightly)"|data-nightly-note|data-topup-open="nightly"/,
    );
    expect(script).not.toMatch(/nightlyView|nightlyMeter|allowance\(\)\.nightly/);
    expect(main).toContain(
      "const MOVED = {\n            '#watch': './shop-preview.html#nightly',\n            '#prices': './shop-preview.html#prices',\n            '#usage': './usage-preview.html',\n          };",
    );
    expect(sourceFor('shop-preview.html')).toMatch(
      /<section class="task-surface shop-surface" id="nightly"/,
    );
  });

  it('redraws every ring from the store with the shared allowance.set, its kind and state included', () => {
    expect(script).toContain('const credits = store?.credits?.();');
    expect(script).toContain('const set = window.JobDeputyComponents?.allowance?.set;');
    expect(script).toContain(
      "sizeMeter(creditsMeter, { ...view.parts, state: view.state, kind: 'assist' });",
    );
    expect(script).toContain('sizeMeter(limitMeter, { ...view.parts, state: view.state });');
    // Your limit's ring is Deputy Assist's too: teal left.
    expect(elementById(ai, 'ai-limit-meter')).toMatch(/data-meter-kind="assist"/);
  });
});

describe('AI & credits · Keys and Change model (finding 26)', () => {
  it('shows each provider as a compact card: mark, status, ending, check date, model, actions', () => {
    const openai = elementById(ai, 'ai-key-openai');
    expect(openai).toMatch(
      /^<li\s+class="ai-key-card"\s+id="ai-key-openai"\s+data-provider="openai"/,
    );
    expect(openai).toContain('<span class="company-mark" aria-hidden="true">OA</span>');
    const openaiText = textOf(openai);
    expect(openaiText).toContain('OpenAI Ready');
    expect(openaiText).toContain('Ending 7284 · checked Oct 1');
    expect(openaiText).toContain('Model gpt-5-mini Recommended');
    expect(openaiText).toContain('Change model for OpenAI');
    expect(openaiText).toContain('Replace key for OpenAI');
    expect(openaiText).toContain('Remove OpenAI key');
    expect(openaiText).toContain('If Deputy Assist runs on it, it switches to Platform credits.');
    const anthropic = elementById(ai, 'ai-key-anthropic');
    expect(textOf(anthropic)).toContain('Anthropic Not connected');
    expect(textOf(anthropic)).toContain('Add key for Anthropic');
    // Change model is only for a ready key.
    expect(anthropic).toMatch(
      /data-model-open\s+aria-expanded="false"\s+aria-controls="ai-change-form"\s+hidden/,
    );
    expect(anthropic).toMatch(/<p class="ai-key-model" data-key-model-line hidden>/);
    expect(plain(seed.get().ai.keys)).toEqual({
      openai: { status: 'ready', last4: '7284', model: 'gpt-5-mini', checked: '2026-10-01' },
      anthropic: null,
    });
    expect(plain(seedKeys)).toEqual(plain(seed.get().ai.keys));
    // The key itself is never stored: only its status, last four, model, and check date.
    expect(script).toMatch(
      /next\.keys\[provider\] = \{ status, last4, model, checked: today\(\) \};/,
    );
    expect(script).toContain("keyInput.value = '';");
  });

  it('lists each provider’s models with the recommended one first and marked', () => {
    const ids = (provider: string) => aiRules.modelChoices(provider, '').map((model) => model.id);
    expect(ids('openai')).toEqual(['gpt-5-mini', 'gpt-5-nano', 'gpt-5']);
    expect(ids('anthropic')).toEqual(['Claude Haiku 4.5', 'Claude Sonnet 5.5', 'Claude Opus 5.5']);
    for (const provider of ['openai', 'anthropic']) {
      const choices = aiRules.modelChoices(provider, aiRules.defaultModel(provider));
      expect(choices.map((choice) => choice.recommended)).toEqual([true, false, false]);
      expect(choices[0]?.meta).toBe('In use · The model we tested for reading and ranking.');
    }
    expect(aiRules.defaultModel('openai')).toBe('gpt-5-mini');
    expect(aiRules.defaultModel('anthropic')).toBe('Claude Haiku 4.5');
    expect(aiRules.isRecommended('openai', 'gpt-5-mini')).toBe(true);
    expect(aiRules.isRecommended('openai', 'gpt-5')).toBe(false);
    // The picker's markup is the seed's choices for OpenAI, with the one selected style's cards.
    const picker = elementById(ai, 'ai-change-choices');
    expect(picker).toMatch(
      /^<fieldset class="choice-cards ai-change-choices" id="ai-change-choices"/,
    );
    expect(picker).toContain(
      '<legend class="field-label" id="ai-change-title">Model for your OpenAI key</legend>',
    );
    const cards = [
      ...picker.matchAll(
        /<input type="radio" name="ai-change-model" value="([^"]+)"( checked)? \/>[\s\S]*?<span class="choice-card-label ai-nowrap">([^<]+)<\/span\s*>(<span class="status-pill is-neutral">Recommended<\/span\s*>)?[\s\S]*?<span class="choice-card-meta">([^<]+)<\/span>/g,
      ),
    ].map((match) => [match[1], Boolean(match[2]), Boolean(match[4]), match[5]]);
    expect(cards).toEqual(
      aiRules
        .modelChoices('openai', 'gpt-5-mini')
        .map((choice) => [choice.id, choice.current, choice.recommended, choice.meta]),
    );
  });

  it('shows the cost caution for any other model and asks to confirm before it saves', () => {
    // Tokens are the unit (R5-2): a model's cost is its price per token, never a cost per run.
    expect(ai).not.toMatch(/per run/);
    expect(aiRules.CAUTION).toBe(
      'Larger models cost more per token on your key and can use more tokens. Results may differ from the model we tested.',
    );
    // A smaller model costs less, so its caution says what is true for it (UAT).
    expect(aiRules.CAUTION_SMALLER).toBe(
      'Smaller models cost less per token but may rank and write less accurately. Results may differ from the model we tested.',
    );
    expect(
      ['gpt-5-mini', 'gpt-5-nano', 'gpt-5'].map((model) => aiRules.cautionFor('openai', model)),
    ).toEqual(['', aiRules.CAUTION_SMALLER, aiRules.CAUTION]);
    expect(
      ['Claude Haiku 4.5', 'Claude Sonnet 5.5', 'Claude Opus 5.5'].map((model) =>
        aiRules.cautionFor('anthropic', model),
      ),
    ).toEqual(['', aiRules.CAUTION, aiRules.CAUTION]);
    expect(aiRules.cautionFor('openai', 'gpt-4o')).toBe('');
    expect(plain(aiRules.modelNote('openai', 'gpt-5-nano'))).toEqual({
      size: 'smaller',
      caution: aiRules.CAUTION_SMALLER,
      runs: 'cost less but may be less accurate',
      it: 'it costs less per token but may rank and write less accurately',
      short: 'results may be less accurate',
    });
    expect(aiRules.modelNote('openai', 'gpt-5')?.runs).toBe('can cost more');
    expect(aiRules.modelNote('openai', 'gpt-5-mini')).toBeNull();
    // Every model that is not recommended says which way it differs.
    for (const [provider, entry] of Object.entries(aiRules.PROVIDERS)) {
      for (const model of entry.models) {
        expect(
          Boolean(model.recommended) ||
            ['larger', 'smaller'].includes(String((model as { size?: string }).size)),
          model.id,
        ).toBe(true);
      }
      expect(aiRules.modelNote(provider, aiRules.defaultModel(provider))).toBeNull();
    }
    expect(script).toContain('const caution = rules.cautionFor(changeProvider, chosenModel());');
    expect(script).toContain(
      tpl(
        '`Your key stays. New searches, drafts, and answers run on #{model} and #{note.runs}; runs already done keep their model.`,\n            model,',
      ),
    );
    const caution = elementById(ai, 'ai-change-caution');
    expect(caution).toMatch(/data-kind="warning"\s+hidden/);
    expect(textOf(caution)).toBe(`! Not the model we recommend ${aiRules.CAUTION}`);
    expect(aiRules.modelChange('openai', 'gpt-5-mini', 'gpt-5-mini')).toBe('same');
    expect(aiRules.modelChange('openai', 'gpt-5-mini', 'gpt-5')).toBe('confirm');
    expect(aiRules.modelChange('openai', 'gpt-5-mini', 'gpt-5-nano')).toBe('confirm');
    expect(aiRules.modelChange('openai', 'gpt-5', 'gpt-5-mini')).toBe('save');
    expect(aiRules.modelChange('openai', 'gpt-5-mini', 'gpt-4o')).toBe('invalid');
    expect(aiRules.modelChange('anthropic', 'Claude Haiku 4.5', 'Claude Opus 5.5')).toBe('confirm');
    // The confirmation: its own panel, the safe choice focused, Save and Cancel set aside.
    const confirm = elementById(ai, 'ai-change-confirm');
    expect(confirm).toMatch(/data-kind="warning"\s+hidden/);
    expect(confirm).toContain(
      '<button class="compact-action" id="ai-change-yes" type="button"></button>',
    );
    expect(confirm).toContain(
      '<button class="compact-action" id="ai-change-no" type="button"></button>',
    );
    expect(script).toMatch(/changeYes\.textContent = `Switch to \$\{model\}`;/);
    expect(script).toMatch(/changeNo\.textContent = `Keep \$\{current\}`;/);
    expect(script).toMatch(/showConfirm\(true\);\s*changeNo\.focus\(\);/);
    expect(elementById(ai, 'ai-change-actions')).toContain(
      '<button class="primary-action" id="ai-change-save" type="submit">Save model</button>',
    );
  });

  it('keeps every model id on one line where a heading or label names it', () => {
    expect(ai).toMatch(/\.ai-nowrap \{\s*white-space: nowrap;\s*\}/);
    expect(ai).toMatch(/\.ai-key-model strong \{[^}]*white-space: nowrap;/);
    expect(script).toContain(
      tpl(
        "fillWithModel($('#ai-change-confirm-title'), `Switch your #{name} key to #{model}?`, model);",
      ),
    );
    expect(script).toContain(
      tpl(
        "fillWithModel($('#ai-key-confirm-title'), `Save your #{name} key with #{model}?`, model);",
      ),
    );
    expect(script).toContain("make('span', 'ai-nowrap', model)");
    expect(script).toContain(
      "title.append(make('span', 'choice-card-label ai-nowrap', choice.id));",
    );
    expect(script).toContain('fillWithModel(strong, parts.strong, choice.model);');
    // Round 6: the line above the prompts moved to Settings, Prompts with them.
  });

  it('saves the model on the saved key through the store, and every place that names it follows', () => {
    // The page's write: only ai.keys and ai.log change; the store's AI runs and usage stay.
    expect(script).toContain('if (next.keys[provider]) next.keys[provider].model = model;');
    expect(script).toMatch(
      /state\.ai\.keys = next\.keys;\s*state\.ai\.log = next\.log\.slice\(0, 8\);/,
    );
    expect(script).not.toMatch(/state\.ai = next;/);
    expect(script).toMatch(/writeAi\(\{ change: 'model', provider, model \}/);
    expect(script).toMatch(
      /announce\(`Model changed to \$\{model\}[\s\S]*?deputy\?\.react\('saved'\);/,
    );
    // The same change on the real store: the key stays, and aiChoice() and every prompt name it.
    const store = loadStore();
    const before = plain(store.get().ai);
    store.update({ type: 'ai', change: 'model', provider: 'openai', model: 'gpt-5' }, (state) => {
      const next = state.ai as { keys: Record<string, { model: string }> };
      if (next.keys.openai) next.keys.openai.model = 'gpt-5';
    });
    const after = plain(store.get().ai);
    expect(after.keys).toEqual({
      openai: { status: 'ready', last4: '7284', model: 'gpt-5', checked: '2026-10-01' },
      anthropic: null,
    });
    expect(after.runs).toEqual(before.runs);
    expect(after.usage).toEqual(before.usage);
    expect(store.aiChoice().text).toBe('gpt-5 on your OpenAI key');
    expect(store.aiChoice().summary).toBe('Every search and draft uses gpt-5 on your OpenAI key');
    expect(aiRules.sourceMeta('openai', aiRules.normalizeKeys(after.keys))).toBe('Ready');
    expect(store.prompts().map((prompt) => prompt.model.text)).toEqual(
      Array(8).fill('gpt-5 on your OpenAI key'),
    );
    // Runs already done keep the model they ran on.
    expect(store.aiUsage().models.map((model) => model.model)).toEqual([
      'gpt-5-mini',
      'Ministral 3 14B',
    ]);
  });

  it('keeps the add-key picker searchable, recommended first, and confirms any other model', () => {
    const model = attributesOf(
      ai.match(/<input\s+class="field-control ai-model-input"([^>]*)\/>/)?.[1] ?? '',
    );
    expect([model.role, model['aria-autocomplete'], model['aria-controls']]).toEqual([
      'combobox',
      'list',
      'ai-model-options',
    ]);
    expect(elementById(ai, 'ai-model-options')).toMatch(/role="listbox"/);
    expect(
      plain(aiRules.findModels('openai', '')).map((entry) => [entry.id, entry.recommended]),
    ).toEqual([
      ['gpt-5-mini', true],
      ['gpt-5-nano', false],
      ['gpt-5', false],
    ]);
    expect(aiRules.findModels('openai', '')[0]?.description).toBe(
      'Recommended. The model we tested for reading and ranking.',
    );
    expect(plain(aiRules.findModels('anthropic', 'opus')).map((entry) => entry.id)).toEqual([
      'Claude Opus 5.5',
    ]);
    expect(aiRules.findModels('anthropic', 'gpt')).toHaveLength(0);
    expect(textOf(elementById(ai, 'ai-model-help'))).toBe(
      'Recommended: gpt-5-mini, the model we tested.',
    );
    // Changing the provider resets the model to the one we recommend.
    expect(script).toContain('modelInput.value = rules.defaultModel(formProvider);');
    // A model other than the recommended one shows its caution and asks first (ui-foundation).
    expect(script).toContain(
      tpl(
        'rules.cautionFor(formProvider, value) || `Recommended: #{recommended}, the model we tested.`;',
      ),
    );
    expect(elementById(ai, 'ai-key-confirm')).toMatch(/data-kind="warning"\s+hidden/);
    expect(script).toMatch(
      /if \(!rules\.isRecommended\(provider, model\)\) \{[\s\S]*?showKeyConfirm\(true\);/,
    );
    const toggle = attributesOf(
      ai.match(/<button\s+class="ai-field-toggle"\s+id="ai-key-toggle"([^>]*)>/)?.[1] ?? '',
    );
    expect(toggle['aria-label']).toBe('Show key');
    expect(ai).not.toMatch(/\saria-pressed=/);
  });

  it('reacts once to each key action: ready, rejected, removed, and a form to fix', () => {
    expect(script).toContain("deputy?.react('saved', { speech: 'Your key is ready.' });");
    expect(script).toContain("deputy?.react('deleted', { speech: 'Your key is removed.' });");
    // A key form to fix, and a key the provider rejected.
    expect(script).toMatch(/keySummary\.focus\(\);\s*deputy\?\.react\('error'\);/);
    expect(script).toMatch(
      /announce\(`We couldn’t use this \$\{name\} key[\s\S]*?deputy\?\.react\('error'\);/,
    );
    // ?keycheck=invalid makes the next check fail, so the error state can be reviewed.
    expect(script).toContain("const status = failNextCheck ? 'invalid' : 'ready';");
    for (const part of ['data-key-confirm-remove', 'data-key-keep', 'Remove your OpenAI key?']) {
      expect(elementById(ai, 'ai-key-openai')).toContain(part);
    }
  });

  it('moves the setting to platform credits through the store when its key goes or fails', () => {
    // Removing the key, and a key the provider rejects: both through setAiChoice, before the key
    // changes, so every page hears it.
    expect(script.match(/applyChoice\('platform'\);\s*saved = currentSource\(\);/g)).toHaveLength(
      2,
    );
    const store = loadStore();
    expect(store.setAiChoice('platform')?.source).toBe('platform');
    store.update({ type: 'ai', provider: 'openai' }, (state) => {
      const next = state.ai as { keys: Record<string, unknown> };
      next.keys.openai = null;
    });
    expect(store.aiChoice().source).toBe('platform');
    expect(store.setAiChoice('openai')).toBeNull();
  });
});

describe('AI & credits · the prompts moved to Settings, Prompts (round 6, T1 and S1)', () => {
  // S1: the prompts' home is Settings, Prompts (prompts-preview.html, prompts.test.ts), with the
  // version dropdown, the two measures, testing, and the rollback rules; this page keeps no copy.
  const forward = main.match(/^<main[^>]*>\s*<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  const go = (search: string, hash: string) => {
    const replaced: string[] = [];
    const listeners: string[] = [];
    runInNewContext(forward, {
      window: {
        location: { search, hash, replace: (url: string) => replaced.push(url) },
        addEventListener: (type: string) => listeners.push(type),
      },
    });
    return { replaced, listeners };
  };

  it('keeps no prompts section, list, or prompt figure of its own', () => {
    expect(main).not.toMatch(
      /id="prompts"|ai-prompt|data-prompt-open|data-metric="prompts\.|What your deputy asks/,
    );
    expect(script).not.toMatch(/promptRows|promptModelLine|renderPrompts|CHECK_WORDS/);
    expect(ai).not.toMatch(/\.ai-prompt/);
    // The Settings tab strip still links to Prompts.
    expect(main).toContain(
      '<li><a class="settings-tab" href="./prompts-preview.html">Prompts</a></li>',
    );
  });

  it('forwards #prompts and a prompt’s old row to Settings, Prompts at once, keeping the query, #watch and #prices to Purchases, and #usage to Usage', () => {
    expect(forward).toContain('/^#prompt(?:s|-([a-z]+))$/');
    expect(go('', '#prompts').replaced).toEqual(['./prompts-preview.html']);
    // ?prompt=<task id> opens that prompt's drawer there, as it did here.
    expect(go('?prompt=rank', '#prompts').replaced).toEqual(['./prompts-preview.html?prompt=rank']);
    expect(go('', '#prompt-mail').replaced).toEqual(['./prompts-preview.html#mail']);
    expect(go('?skipLoader', '#prompt-read').replaced).toEqual([
      './prompts-preview.html?skipLoader#read',
    ]);
    // Round 6 part 2 (P-2, P-10): the nightly runs and How prices are made open in Purchases,
    // without the query (Purchases has no prompt to open).
    expect(go('', '#watch').replaced).toEqual(['./shop-preview.html#nightly']);
    expect(go('?skipLoader', '#prices').replaced).toEqual(['./shop-preview.html#prices']);
    // Round 7 (D10): usage over time opens in Settings, Usage.
    expect(go('', '#usage').replaced).toEqual(['./usage-preview.html']);
    expect(go('?skipLoader', '#usage').replaced).toEqual(['./usage-preview.html']);
    // Every other anchor stays on this page.
    for (const hash of [
      '',
      '#ai',
      '#model',
      '#credits',
      '#limit',
      '#keys',
      '#activity',
      '#promptsx',
    ]) {
      expect(go('', hash).replaced, hash).toEqual([]);
    }
    // A later change of the address's hash is forwarded too.
    expect(go('', '').listeners).toEqual(['hashchange']);
  });
});

// Round 7 (D10): usage over time (round 6's Tokens over time: October by day and model, the last
// 3 months, by task, and the combinations) moved to Settings, Usage, which shows it for any range
// and filter (usage-preview.html, usage.test.ts holds October's figures there). This page keeps
// one line with its link, and #usage forwards there (above).
describe('AI & credits · usage over time moved to Settings, Usage (round 7, D10)', () => {
  it('keeps one line where Tokens over time was, with the link to Usage', () => {
    const line = elementById(ai, 'ai-usage-line');
    expect(line).toBe(
      '<p class="ai-usage-line" id="ai-usage-line">Your tokens over time, by key, model, task, and prompt, are in Usage. <a class="chart-action" href="./usage-preview.html" data-return-link data-focus-key="ai-open-usage">Open Usage</a></p>',
    );
    // It sits under the credits and limit pair, before the keys.
    expect(main.indexOf('id="ai-usage-line"')).toBeGreaterThan(
      main.indexOf('<div class="ai-pair">'),
    );
    expect(main.indexOf('id="ai-usage-line"')).toBeLessThan(main.indexOf(' id="keys"'));
    expect(words(textOf(line))).toBeLessThanOrEqual(16);
  });

  it('draws no usage chart, tabs, or combinations of its own', () => {
    expect(main).not.toMatch(
      /id="usage"|ai-usage-(?:stats|tabs|day|month|task|combos)|data-ai-month/,
    );
    expect(script).not.toMatch(/usageChart|aiMonthUsage|renderUsage|usageViews|monthsBefore/);
    expect(ai).not.toMatch(/\.ai-usage-(?:stats|tabs|note|combos)/);
    // The page's other figures stay: the credits ring, your limit, the model's rates.
    expect(main).toContain('data-metric="ai.credits.usedMonth"');
    expect(main).toContain('data-metric="ai.limit.used"');
  });
});

describe('AI & credits · Recent AI work', () => {
  const items = aiRules.activityItems({
    live: seed.liveRuns(),
    entries: seed.aiUsage().entries,
    log: [],
    ledger: seed.get().ai.runs,
  });

  it('lists the running search first, then each run and draft with its model and key', () => {
    expect(items.map((item) => [item.title, item.meta, item.icon, item.current])).toEqual([
      // The seeded run starts 20 seconds before the sample (A1, round 5), so it is fetching.
      ['Searching Amazon Jobs', 'gpt-5-mini · Your OpenAI key · Fetching pages', 'search', true],
      ['Cover letter for Cloud Reliability', 'gpt-5-mini · Your OpenAI key', 'page', false],
      ['Résumé for Cloud Reliability', 'gpt-5-mini · Your OpenAI key', 'page', false],
      ['Cover letter for Search Infrastructure', 'gpt-5-mini · Your OpenAI key', 'page', false],
      ['Résumé for Search Infrastructure', 'gpt-5-mini · Your OpenAI key', 'page', false],
      ['Keep watch checked Google Careers', 'gpt-5-mini · Your OpenAI key', 'search', false],
      ['Keep watch checked Microsoft Careers', 'gpt-5-mini · Your OpenAI key', 'search', false],
      ['Searched Google Careers', 'Ministral 3 14B · Platform credits', 'sparkle', false],
    ]);
  });

  it('matches the markup: the three newest shown, the rest behind Show all', () => {
    const list = elementById(ai, 'ai-activity-list');
    const rows = [
      ...list.matchAll(
        /<li class="ai-activity-item([^"]*)"([^>]*)>[\s\S]*?<use href="#ai-icon-(\w+)" \/>[\s\S]*?<span class="ai-activity-title">([^<]+)<\/span>\s*<span class="ai-activity-meta">([^<]+)<\/span>[\s\S]*?<span class="ai-activity-time">([\s\S]*?)<\/span>\s*<\/li>/g,
      ),
    ].map((match) => ({
      current: (match[1] ?? '').includes('is-current'),
      hidden: /\shidden\b/.test(match[2] ?? ''),
      icon: match[3],
      title: match[4],
      meta: match[5],
      time: textOf(match[6] ?? ''),
    }));
    expect(rows.map((row) => [row.title, row.meta, row.icon, row.current])).toEqual(
      items.map((item) => [item.title, item.meta, item.icon, item.current]),
    );
    expect(rows.map((row) => row.hidden)).toEqual(
      items.map((_, index) => index >= aiRules.hiddenFrom(items.length, false)),
    );
    expect(rows.map((row) => row.time)).toEqual(
      items.map((item) => (item.current ? 'Now' : seed.format.ago(item.at))),
    );
    expect(aiRules.ACTIVITY_SHOWN).toBe(3);
    expect(aiRules.hiddenFrom(8, true)).toBe(8);
    const more = attributesOf(
      ai.match(/<button\s+class="compact-action"\s+id="ai-activity-more"([^>]*)>/)?.[1] ?? '',
    );
    expect([more.type, more['aria-expanded'], more['aria-controls']]).toEqual([
      'button',
      'false',
      'ai-activity-list',
    ]);
    // R10-3: the full activity's home is Settings, Activity (SE1); one link there, filtered to
    // AI, with the way back.
    expect(elementById(ai, 'ai-activity-all')).toBe(
      '<a class="chart-action" id="ai-activity-all" href="./activity-preview.html?area=ai" data-return-link data-focus-key="ai-activity-all">Every AI action in Activity</a>',
    );
  });

  it('adds this page’s own key and model changes, newest first, built as text', () => {
    const mixed = aiRules.activityItems({
      entries: seed.aiUsage().entries,
      log: [
        {
          at: '2026-10-02T21:05:00.000Z',
          title: 'Changed your OpenAI model to gpt-5',
          detail: 'Your key stayed · applies to new runs',
          kind: 'done',
          icon: 'key',
        },
      ],
    });
    expect(mixed[0]).toMatchObject({
      title: 'Changed your OpenAI model to gpt-5',
      meta: 'Your key stayed · applies to new runs',
      icon: 'key',
    });
    expect(script).toContain("make('span', 'ai-activity-title', entry.title)");
    expect(script).not.toMatch(/innerHTML|insertAdjacentHTML/);
    // A live search redraws its stage each tick, and only when the words change.
    expect(script).toContain('store?.onTick?.(() => renderActivity());');
    expect(script).toContain('if (signature === activitySignature) return;');
  });
});

describe('AI & credits · tour (R3-6)', () => {
  // Round 6 (R6-2): the deputy gives the tour, so every title is his speech line (first person, at
  // most six words) and every text says what he does. The prompts' step moved with the prompts.
  it('walks through the setting, the model, the credits, your limit, and keys', () => {
    const steps = [
      ...main.matchAll(
        /<[a-z]+\b[^>]*\sid="([\w-]+)"[^>]*\sdata-tour-step="(\d+)"\s+data-tour-title="([^"]+)"\s+data-tour-text="([^"]+)"/g,
      ),
    ].map((match) => [Number(match[2]), match[1], match[3], words(match[4] ?? '')]);
    expect(steps.map(([step, id, title]) => [step, id, title])).toEqual([
      [1, 'ai-source-options', 'I run on this one setting.'],
      [2, 'model', 'Choose the model I use.'],
      [3, 'ai-credits-meter', 'These are your AI credits.'],
      // Round 6 part 2: the nightly runs (P-2) and How prices are made (P-10) are Purchases'
      // tour steps now.
      [4, 'ai-limit-meter', 'I stop at your limit.'],
      // Round 7 (D10): usage's step moved with it to Settings, Usage.
      [5, 'ai-key-openai', 'Your keys stay yours.'],
    ]);
    for (const [, , title, count] of steps) {
      expect(Number(count)).toBeLessThanOrEqual(40);
      expect(words(String(title)), String(title)).toBeLessThanOrEqual(6);
    }
    // First person: each step's text is the deputy speaking (I, my, me).
    for (const match of main.matchAll(/data-tour-text="([^"]+)"/g)) {
      expect(match[1], match[1]).toMatch(/\b(?:I|I’m|my|me)\b/);
    }
    // The steps follow the page's order, sit on visible targets (none starts hidden), and never
    // inside a closed disclosure.
    const at = steps.map(([, id]) => main.indexOf(` id="${id}"`));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(main).not.toMatch(/data-tour-step="\d+"[^>]*\shidden/);
    // Colours are named in the shared palette's words (teal, indigo, hatched grey, gold, wine).
    const texts = [...main.matchAll(/data-tour-text="([^"]+)"/g)].map((match) => match[1] ?? '');
    expect(texts.join(' ')).not.toMatch(/\bblack\b|green is left|blue (?:is|was) added/);
  });
});

describe('AI & credits rules', () => {
  it('accepts only the provider’s models and rejects anything typed that is not on the list', () => {
    expect(aiRules.isAllowed('openai', ' gpt-5-mini ')).toBe(true);
    expect(aiRules.isAllowed('openai', 'gpt-5')).toBe(true);
    expect(aiRules.isAllowed('openai', 'gpt-4o')).toBe(false);
    expect(aiRules.isAllowed('openai', 'Claude Haiku 4.5')).toBe(false);
    expect(aiRules.isAllowed('anthropic', 'gpt-5-mini')).toBe(false);
    expect(aiRules.isAllowed('anthropic', 'claude-sonnet-4-5')).toBe(false);
    expect(aiRules.providerName('anthropic')).toBe('Anthropic');
  });

  it('validates a key draft: a listed model, a complete key, and consent', () => {
    const draft = {
      provider: 'openai',
      model: 'gpt-5',
      key: 'sk-test-1234567890abcdef', // gitleaks:allow (fake sample key)
      consent: true,
    };
    expect(aiRules.validateKey(draft)).toHaveLength(0);
    const fields = (change: Partial<typeof draft>) =>
      aiRules.validateKey({ ...draft, ...change }).map((error) => error.field);
    expect(fields({ model: 'gpt-4o' })).toEqual(['model']);
    expect(fields({ key: 'sk-short' })).toEqual(['key']);
    expect(fields({ key: 'sk-test 1234567890abcdef' })).toEqual(['key']);
    expect(fields({ consent: false, model: '' })).toEqual(['model', 'consent']);
    expect(aiRules.validateKey({ ...draft, model: 'x' })[0]?.message).toBe(
      'Choose a model from the OpenAI list.',
    );
    expect(aiRules.lastFour(' sk-test-1234567890abcd ')).toBe('abcd');
    expect(aiRules.formatDate('2026-10-02')).toBe('Oct 2');
    expect(aiRules.monthName('2026-10-31')).toBe('October');
  });

  it('falls back like the API when the chosen source cannot run', () => {
    expect(aiRules.effectiveSource(null, seedKeys)).toBe('openai');
    expect(aiRules.effectiveSource('platform', seedKeys)).toBe('platform');
    expect(aiRules.available('platform', seedKeys)).toBe(true);
    expect(plain(aiRules.normalizeKeys(undefined))).toEqual({ openai: null, anthropic: null });
    expect(aiRules.available('anthropic', seedKeys)).toBe(false);
    expect(aiRules.effectiveSource('anthropic', seedKeys)).toBe('platform');
    const removed = aiRules.normalizeKeys({ openai: null, anthropic: null });
    expect(aiRules.effectiveSource('openai', removed)).toBe('platform');
    const invalid = aiRules.normalizeKeys({
      openai: { status: 'invalid', last4: '0000', model: 'gpt-5-mini', checked: '2026-10-02' },
    });
    expect(aiRules.available('openai', invalid)).toBe(false);
    expect(aiRules.sourceMeta('openai', invalid)).toBe('Needs attention · replace the key');
    expect(aiRules.sourceMeta('openai', removed)).toBe('Not connected');
    // An unknown stored model or status never survives normalising.
    const odd = plain(
      aiRules.normalizeKeys({ anthropic: { status: 'ready', last4: 'abcdef', model: 'claude-x' } }),
    );
    expect(odd.anthropic).toEqual({
      status: 'ready',
      last4: 'cdef',
      model: 'Claude Haiku 4.5',
      checked: '',
    });
    expect(plain(aiRules.normalizeKeys({ openai: { status: 'checking' } })).openai).toBeNull();
  });
});
