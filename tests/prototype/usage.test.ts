import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Settings, Usage (brand/usage-preview.html, round 7, D9 and D10): a new Settings tab after AI &
// credits. The owner: "how many tokens and how many runs they have and how long they will run with
// everything enabled, very granular information, this is what users pay money for", "all
// permutations and combinations", "metrics for different ranges like last 1 week, 1 hour, like
// CloudWatch". So: one bar with the shared time range picker and the live filters (key, model,
// task, prompt, what used a run) in the address; the runway (the runs and tokens rings, the dates
// they last through, what uses a run each day, and the next runs until they run out); runs over
// time by what used them; tokens over time by key, model, task, or prompt, with the settings that
// ran them; and every key x model x task combination. AI & credits' Tokens over time moved here
// (its figures for October are held below). The page's pure rules sit between
// `/* usage-rules: start */` and `end` and run here on their own, fed by the real store; the
// rendered checks (layout, the metrics probe, the tour, the budgets) run in headless Chrome.

const brand = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string) => readFileSync(resolve(brand, file), 'utf8');
const page = sourceFor('usage-preview.html');
const prompts = sourceFor('prompts-preview.html');
const main = page.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? '';
const script = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1] ?? '')
  .join('\n');
const style = page.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

const textOf = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const between = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  return from < 0 || to < 0 ? '' : source.slice(from, to + end.length);
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

type Use = {
  id: string;
  label: string;
  detail: string;
  perDay: number;
  sharePct: number;
  enabled: boolean;
  metric: string;
  href: string;
};
type Runway = {
  runs: {
    left: number;
    all: number;
    perDay: number;
    uses: Use[];
    schedule: Array<{
      at: string;
      feature: string;
      runs: number;
      covered?: number;
      leftAfter: number;
      short?: boolean;
    }>;
    lastsThrough: string;
    text: string;
  };
  tokens: {
    payerLabel: string;
    left: number;
    perDay: number;
    lastsThrough: string | null;
    text: string;
    scheduled?: { roles: number; tokens: number; at: string };
  };
  text: string;
};
type Usage = {
  range: string;
  step: string;
  totals: {
    calls: number;
    tokens: number;
    cost: number;
    costPlatform: number;
    costOwnEstimate: number;
    included: { calls: number; tokens: number };
  };
  groups: Array<{ id: string; label: string; tokens: number }>;
  buckets: Array<{ at: string; tokens: number; parts: Array<{ id: string; tokens: number }> }>;
  permutations: Array<{
    id: string;
    key: string;
    model: string;
    task: string;
    tokens: number;
    calls: number;
  }>;
  facets: Record<string, Array<{ id: string; label: string; calls: number }>>;
  settings: Array<{ text: string }>;
};
type Store = {
  PROMPT_IDS: string[];
  USAGE_RANGES: Array<{ id: string; label: string }>;
  metric(key: string): unknown;
  metricText(key: string): string;
  runway(): Runway;
  runsLedger(options?: Record<string, unknown>): {
    total: number;
    byFeature: Record<string, number>;
    features: Array<{ id: string; label: string }>;
    entries: Array<{ feature: string; by: string }>;
  };
  usage?(options?: Record<string, unknown>): Usage;
  aiMonthUsage(options?: { month?: string }): {
    total: number;
    models: Array<{ id: string; tokens: number }>;
    tasks: Array<{ id: string; label: string; total: number }>;
    combos: Array<{ text: string }>;
  };
  format: {
    date(value: unknown): string;
    dateTime?(value: unknown): string;
    tokens(value: number): string;
    money(value: number): string;
  };
};

function loadStore(search = ''): Store {
  const storage = new Map<string, string>();
  const window: Record<string, unknown> = { addEventListener: () => {}, location: { search } };
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  const context = { window, localStorage, JSON };
  runInNewContext(sourceFor('prompt-guard.js'), context);
  runInNewContext(sourceFor('agreement-text.js'), context);
  runInNewContext(sourceFor('sample-store.js'), context);
  return window.JobDeputyStore as Store;
}

type Rules = {
  GROUPS: Array<{ id: string; label: string; other: string }>;
  FACETS: Array<{ name: string; label: string; singular: string; plural: string }>;
  groupOf(value: unknown): string;
  listOf(value: unknown): string[];
  filtersOf(state: Record<string, unknown>): { tokens: Record<string, string[]>; uses: string[] };
  filtered(state: Record<string, unknown>): boolean;
  facetOptions(items: unknown): Array<{ value: string; label: string; count: number }>;
  usesRows(runway: unknown): Array<{
    id: string;
    label: string;
    detail: string;
    on: boolean;
    figure: string;
    unit: string;
    metric: string;
    href: string;
  }>;
  scheduleRows(
    runway: unknown,
    when?: (value: unknown) => string,
  ): Array<{ short: boolean; text: string }>;
  totalsWords(
    totals: unknown,
    format?: { tokens?: (value: number) => string; money?: (value: number) => string },
  ): { tokens: string; calls: string; callsNoun: string; cost: string; costEstimate: string };
  rangeMetric(
    preset: string,
    field: string,
    state?: Record<string, unknown>,
    has?: (key: string) => boolean,
  ): string;
  settingsLines(usage: unknown, day?: (value: unknown) => string): string[];
  preciseMoney(micros: number): string;
  scheduledParts(
    runway: unknown,
    format?: {
      today?: string;
      day?: (value: unknown) => string;
      time?: (value: unknown) => string;
    },
  ): {
    before: string;
    roles: string;
    rolesMetric: string;
    middle: string;
    tokens: string;
    tokensMetric: string;
    after: string;
  } | null;
};
const block = (() => {
  const start = script.indexOf('/* usage-rules: start */');
  const end = script.indexOf('/* usage-rules: end */');
  return script.slice(start, end);
})();
const rules = new Script(
  `${block}\n;({ GROUPS, FACETS, groupOf, listOf, filtersOf, filtered, facetOptions, usesRows, scheduleRows, totalsWords, rangeMetric, settingsLines, scheduledParts, preciseMoney })`,
).runInNewContext({}) as Rules;
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const seed = loadStore();
const large = loadStore('?demo=large');

describe('Usage page frame (D10, R6-3, R6-6)', () => {
  it('opens with the shared page intro: Settings, its title, one short line, and Take the tour', () => {
    expect(main).toMatch(
      /<section class="page-intro usage-intro" aria-labelledby="page-title" data-page-back>\s*<div class="page-intro-copy"[^>]*>\s*<p class="eyebrow">Settings<\/p>\s*<h1 id="page-title">Your runs and tokens\.<\/h1>\s*<p class="intro-copy">What you have, what uses them, and how long they last\.<\/p>\s*<\/div>\s*<div class="page-intro-actions">\s*<button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour<\/button>\s*<\/div>\s*<\/section>/,
    );
    expect(
      words(textOf(main.match(/<p class="intro-copy">([\s\S]*?)<\/p>/)?.[1] ?? '')),
    ).toBeLessThanOrEqual(14);
    expect(main.match(/<h1\b/g)).toHaveLength(1);
    expect(page).toContain('<title>JobDeputy · Settings · Usage</title>');
    expect(page).toContain('<a class="skip-link" href="#page-title">Skip to Usage</a>');
    // The deputy reports in (the shared report state: "Reporting in", "Here’s what I found.").
    expect(page).toContain('data-deputy-page="usage"\n            data-deputy-state="report"');
    expect(page).toContain('<p class="deputy-speech" data-deputy-speech>Here’s what I found.</p>');
    expect(page).toContain('<span data-deputy-duty>Reporting in</span>');
  });

  it('is a Settings tab after AI & credits, under the same strip as every Settings page', () => {
    expect(main).toMatch(/<\/section>\s*<!-- SettingsTabs: start -->/);
    const tabs = between(main, '<!-- SettingsTabs: start -->', '<!-- SettingsTabs: end -->');
    expect(
      [
        ...tabs.matchAll(/<a class="settings-tab" href="\.\/([\w-]+)\.html"([^>]*)>([^<]+)<\/a>/g),
      ].map((match) => [match[1], match[3], (match[2] ?? '').includes('aria-current="page"')]),
    ).toEqual([
      ['account-preview', 'Account', false],
      ['connections-preview', 'Connections', false],
      ['prompts-preview', 'Prompts', false],
      ['ai-preview', 'AI &amp; credits', false],
      ['usage-preview', 'Usage', true],
      ['shop-preview', 'Purchases', false],
      ['activity-preview', 'Activity', false],
    ]);
    // The same strip on the Prompts page, apart from aria-current.
    const normalize = (block: string) => block.replace(/ aria-current="page"/g, '');
    expect(normalize(tabs)).toBe(
      normalize(between(prompts, '<!-- SettingsTabs: start -->', '<!-- SettingsTabs: end -->')),
    );
    // Settings marks the nav (Settings opens Account).
    expect(page).toContain(
      '<a class="app-nav-link" href="./account-preview.html" aria-current="true">',
    );
  });

  it('copies the shell of a Settings page exactly: tokens, header, nav, dock, footer, scripts', () => {
    const rootOf = (source: string) => source.match(/:root \{[\s\S]*?\n {6}\}/)?.[0];
    expect(rootOf(page)).toBe(rootOf(prompts));
    for (const marker of ['HeaderActions', 'AppNav']) {
      expect(between(page, `<!-- ${marker}: start -->`, `<!-- ${marker}: end -->`), marker).toBe(
        between(prompts, `<!-- ${marker}: start -->`, `<!-- ${marker}: end -->`),
      );
    }
    const dock = (source: string) =>
      between(source, '<!-- DeputyDock: start -->', '<!-- DeputyDock: end -->')
        .replace(/data-deputy-page="[^"]*"/, '')
        .replace(/data-deputy-state="[^"]*"/, '')
        .replace(/(<p class="deputy-speech" data-deputy-speech>)[^<]*(<\/p>)/, '$1$2')
        .replace(/(<span data-deputy-duty>)[^<]*(<\/span>)/, '$1$2');
    expect(dock(page)).toBe(dock(prompts));
    const footer = (source: string) => between(source, '<footer class="site-footer">', '</footer>');
    expect(footer(page)).toBe(footer(prompts));
    const head = (source: string) => between(source, '<header class="app-header">', '</header>');
    expect(head(page)).toBe(head(prompts));
    const scripts = (source: string) =>
      [...source.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
    expect(scripts(page)).toEqual(scripts(prompts));
    // One panda: only the dock draws one.
    expect(main).not.toMatch(/data-deputy(?:-art)?[\s>=]/);
  });

  it('keeps its own rules prefixed and never restyles the shared parts', () => {
    const selectors = [...style.matchAll(/(^|\n)\s*([^{}@\n][^{}\n]*)\{/g)]
      .map((match) => (match[2] ?? '').trim())
      .filter(
        (selector) =>
          !selector.startsWith(':root') && !selector.startsWith('--') && !selector.startsWith('@'),
      );
    for (const selector of selectors) {
      for (const part of selector.split(',').map((item) => item.trim())) {
        expect(part, part).toMatch(/^(?:html|body|button|a|p|\.usage-[\w-]+)(?:[\s>:[.]|$)/);
      }
    }
    expect(style).not.toMatch(
      /\.(?:page-intro|page-tour|settings-tab|filter-bar|time-range|allowance|runway-line|permutations-table|usage-chart)\b/,
    );
  });
});

describe('Usage page: the sections, in the order you read them (D9, D10)', () => {
  it('leads with the range and the filters, then the runway, runs, tokens, and every combination', () => {
    const order = ['filters', 'runway', 'runs', 'tokens', 'combinations'].map((id) =>
      main.indexOf(` id="${id}"`),
    );
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(main.indexOf(' id="filters"')).toBeGreaterThan(
      main.indexOf('<!-- SettingsTabs: end -->'),
    );
    const titles = [
      ...main.matchAll(/<p class="section-label">([^<]+)<\/p>\s*<h2 id="([\w-]+)">([^<]+)<\/h2>/g),
    ].map((match) => [match[1], match[2], match[3]]);
    expect(titles).toEqual([
      ['Runway', 'usage-runway-title', 'How long they last.'],
      ['Runs', 'usage-runs-title', 'Runs over time.'],
      ['Tokens', 'usage-tokens-title', 'Tokens over time.'],
      ['Combinations', 'usage-combos-title', 'Every key, model, and task.'],
    ]);
    // Each section says the window it covers: the runway from now, the rest the chosen range.
    expect(textOf(elementById(main, 'runway'))).toContain('From now, at your settings');
    expect(main.match(/data-usage-range-label>Last 30 days</g)).toHaveLength(3);
  });

  it('builds on the shared components and the store, never its own copies (PL 5 to 7, ST 2 and 4)', () => {
    expect(script).toContain('components.filterBar(barHost, {');
    expect(script).toContain("range: { param: 'range', value: state.range.preset },");
    expect(script).toContain('components.timeRange(barHost, {');
    expect(script).toContain(
      "components.allowanceRings(rings, { kinds: ['runs', 'tokens'], size: 'compact', metrics: true });",
    );
    expect(script).toContain('components.runwayLine(line, { uses: false, counts: false });');
    expect(script).toContain(
      "components.usageChart(host, {\n            ledger,\n            measure: 'runs',",
    );
    expect(script).toContain("measure: 'tokens',");
    expect(script).toContain('components.permutationsTable(host, {');
    expect(script).toContain("sort: { by: 'tokens', dir: 'desc' },");
    // T6-8, R10-6: the combinations page like the lists: top and bottom pagers, Per page, and the
    // page in the address.
    for (const option of [
      'top: true,',
      'sizes: [12, 24, 48],',
      'address: true,',
      "param: 'combos',",
      "sizeParam: 'combosSize',",
    ]) {
      expect(script, option).toContain(option);
    }
    expect(script).toContain("const runway = call('runway');");
    expect(script).toContain(
      "call('runsLedger', { ...rangeQuery(), feature: uses.length ? uses : undefined })",
    );
    expect(script).toContain(
      "tokenUsage = call('usage', { ...rangeQuery(), group: state.group, filter: tokens });",
    );
    // It never writes storage itself or types a figure.
    expect(script).not.toMatch(/localStorage|60,710|49,810|10,900/);
    // The regions it draws are held as skeletons of their size until the first render (R10-1):
    // the bar and the runway at their drawn heights at each width, so nothing in the first
    // screen moves.
    for (const id of [
      'usage-filter-bar',
      'usage-runs-chart',
      'usage-group-key',
      'usage-permutations',
    ]) {
      expect(elementById(main, id), id).toMatch(/data-skeleton="(?:block|lines|rows|chart)"/);
    }
    expect(main).toContain('<div class="usage-runway" data-skeleton="block" data-tour-step="3"');
    expect(style).toMatch(/\.usage-filter-bar \{\s*--skeleton-min: 44px;/);
    expect(style).toMatch(
      /\.usage-runway \{\s*--skeleton-min: 394px;\s*min-width: 0;\s*min-height: var\(--skeleton-min\);/,
    );
    expect(script).toContain('components?.boot?.ready?.();');
  });

  it('groups tokens four ways with the shared tabs, the choice kept in the address', () => {
    const tabs = elementById(main, 'usage-group-tabs');
    expect(tabs).toMatch(/role="tablist" aria-label="Group tokens by" data-tabs/);
    const buttons = [
      ...tabs.matchAll(
        /<button id="usage-group-tab-(\w+)" type="button" role="tab" aria-selected="(\w+)" aria-controls="usage-group-(\w+)"( tabindex="-1")?>([^<]+)<\/button>/g,
      ),
    ].map((match) => [match[1], match[2], match[3], Boolean(match[4]), match[5]]);
    expect(buttons).toEqual([
      ['key', 'true', 'key', false, 'By key'],
      ['model', 'false', 'model', true, 'By model'],
      ['task', 'false', 'task', true, 'By task'],
      ['prompt', 'false', 'prompt', true, 'By prompt'],
    ]);
    expect(plain(rules.GROUPS)).toEqual([
      { id: 'key', label: 'By key', other: 'Other keys' },
      { id: 'model', label: 'By model', other: 'Other models' },
      { id: 'task', label: 'By task', other: 'Other tasks' },
      { id: 'prompt', label: 'By prompt', other: 'Other versions' },
    ]);
    expect(rules.groupOf('model')).toBe('model');
    expect(rules.groupOf('nope')).toBe('key');
    expect(rules.groupOf(null)).toBe('key');
    expect(script).toContain("address.searchParams.set('group', state.group);");
    expect(script).toContain("window.history.replaceState(window.history.state, '', address);");
  });

  it('marks its sample data once for the runway and once for the tokens', () => {
    expect(main.match(/class="sample-note[^"]*">Sample data · not connected</g)).toHaveLength(2);
    expect(textOf(elementById(main, 'runway'))).toContain('Sample data · not connected');
    expect(textOf(elementById(main, 'tokens'))).toContain('Sample data · not connected');
    // Your own keys' cost is an estimate, and we never bill for it.
    expect(textOf(elementById(main, 'combinations'))).toContain(
      'Your provider bills you for your own keys, never JobDeputy. Kept by you counts the work you decided on.',
    );
  });

  it('links to the homes of the AI setting and of buying, with the way back (R10-3)', () => {
    // T2-23: two links side by side, never inside a sentence (a phone left a wide gap there).
    expect(main).toContain(
      '<p class="usage-more"><span class="usage-more-lead">Change what runs your AI, or buy more:</span> <a class="chart-action" href="./ai-preview.html#ai" data-return-link data-focus-key="usage-ai">AI &amp; credits</a> <a class="chart-action" href="./shop-preview.html#nightly" data-return-link data-focus-key="usage-purchases">Purchases</a></p>',
    );
    expect(style).toMatch(/\.usage-more \{\s*display: flex;\s*flex-wrap: wrap;/);
    // AI & credits' Tokens over time is here now; its old anchor forwards (ai.test.ts).
    expect(sourceFor('ai-preview.html')).toContain("'#usage': './usage-preview.html',");
  });
});

describe('Usage page: the range and the filters (D10, R10-7)', () => {
  it('offers every filter the owner asked for, each kept in the address', () => {
    expect(rules.FACETS.map((facet) => [facet.name, facet.label])).toEqual([
      ['key', 'Key'],
      ['model', 'Model'],
      ['task', 'Task'],
      ['prompt', 'Prompt'],
      ['uses', 'Runs used by'],
    ]);
    expect(script).toContain('param: facet.name,');
    expect(script).toContain("kind: 'multi',");
    // The bar's state becomes the store's filters: tokens by key, model, task, and prompt; runs
    // by what used them.
    expect(
      plain(rules.filtersOf({ key: ['openai'], model: [], task: 'rank,tailor', uses: ['gmail'] })),
    ).toEqual({
      tokens: { key: ['openai'], task: ['rank', 'tailor'] },
      uses: ['gmail'],
    });
    expect(rules.filtered({})).toBe(false);
    expect(rules.filtered({ prompt: ['rank:rank-v3'] })).toBe(true);
    expect(rules.listOf(' a, b ,,c')).toEqual(['a', 'b', 'c']);
    expect(rules.listOf(null)).toEqual([]);
  });

  it('lists each facet’s options from the store with their counts, never Other', () => {
    expect(
      plain(
        rules.facetOptions([
          { id: 'openai', label: 'Your OpenAI key', calls: 12 },
          { id: 'other', label: 'Other', calls: 3 },
          { id: 'platform', label: 'Platform credits', calls: 2.4 },
        ]),
      ),
    ).toEqual([
      { value: 'openai', label: 'Your OpenAI key', count: 12 },
      { value: 'platform', label: 'Platform credits', count: 2 },
    ]);
    expect(rules.facetOptions(undefined)).toEqual([]);
    // T1-2: the "Runs used by" counts are the range's (the facet's own choice left out).
    expect(script).toContain(
      "const ranged = uses.length ? call('runsLedger', rangeQuery()) : ledger;",
    );
    expect(script).toContain('counts.uses = usesCounts;');
    const month = seed.runsLedger({ range: 'month' });
    const day = seed.runsLedger({ range: '1d' });
    expect(month.byFeature).not.toEqual(day.byFeature);
    // The counts follow every change (the other filters applied), as the store counts them.
    expect(script).toContain('bar.setCounts(counts);');
  });

  it('keeps a range figure’s metric key only for the plain view of a preset range', () => {
    const has = (key: string) => key === 'usage.30d.tokens';
    expect(rules.rangeMetric('30d', 'tokens', {}, has)).toBe('usage.30d.tokens');
    expect(rules.rangeMetric('30d', 'calls', {}, has)).toBe('');
    expect(rules.rangeMetric('30d', 'tokens', { key: ['openai'] }, has)).toBe('');
    expect(rules.rangeMetric('', 'tokens', {}, has)).toBe('');
  });
});

describe('Usage page: the runway (D10, R10-9)', () => {
  const runway = seed.runway();

  it('says what uses a run each day, each with its home, Off said once (T1-25)', () => {
    expect(plain(rules.usesRows(runway))).toEqual([
      {
        id: 'watch',
        label: 'Keep watch',
        detail: '2 sources nightly at 02:00',
        on: true,
        figure: '2',
        unit: 'runs a day',
        metric: 'runs.use.watch',
        href: './searches-preview.html#keep-watch',
      },
      {
        id: 'gmail',
        label: 'Gmail’s daily scan',
        detail: 'at 07:00, the last 48 hours of mail',
        on: true,
        figure: '1',
        unit: 'run a day',
        metric: 'runs.use.gmail',
        href: './connections-preview.html#gmail',
      },
      {
        id: 'summary',
        label: 'The daily email',
        // T1-25: Off once, at the end (the store's detail "off" is not repeated).
        detail: '',
        on: false,
        figure: 'Off',
        unit: '',
        metric: '',
        href: './account-preview.html#emails',
      },
    ]);
    // Every enabled use's figure is the store's metric, and they add up to the day's runs.
    for (const row of rules.usesRows(runway).filter((item) => item.on)) {
      expect(seed.metricText(row.metric)).toBe(row.figure);
    }
    expect(seed.metric('runs.perDay')).toBe(3);
    expect(runway.runs.uses.reduce((sum, use) => sum + use.perDay, 0)).toBe(runway.runs.perDay);
    expect(main).toContain(
      '<p class="usage-uses-total" id="usage-uses-total"><span data-metric="runs.perDay">3</span> runs a day in all</p>',
    );
  });

  it('lists the next runs until they run out, the short ones said plainly', () => {
    const rows = rules.scheduleRows(runway, (value) => String(value).slice(5, 16));
    expect(plain(rows)).toEqual([
      { short: false, text: '10-03T02:00: Keep watch uses 2 runs, 2 left after.' },
      { short: false, text: '10-03T07:00: Gmail’s daily scan uses 1 run, 1 left after.' },
      { short: true, text: '10-04T02:00: Keep watch needs 2 runs; only 1 is left.' },
      { short: true, text: '10-04T07:00: Gmail’s daily scan needs 1 run; none are left.' },
    ]);
    // The schedule ends where the runs do: the runway's own date.
    expect(runway.runs.lastsThrough).toBe('2026-10-03');
    // The line joins the store's own words for the runs and the tokens (read from the store, as
    // ST's forecast moves: the roles you added are tailored at 06:00 tomorrow, so the key's
    // tokens run out sooner than its 7-day average alone would say).
    expect(runway.text).toBe(`${runway.runs.text}; ${runway.tokens.text}`);
    expect(runway.runs.text).toBe('At your settings your 4 runs last through Sat, Oct 3');
    expect(runway.tokens.text).toBe(
      `your OpenAI key’s tokens through ${seed.format.date(runway.tokens.lastsThrough)}`,
    );
    expect(String(runway.tokens.lastsThrough) > '2026-10-02').toBe(true);
  });

  it('says the tokens already planned in one line: the roles tailored at the next morning run', () => {
    const plan = runway.tokens.scheduled;
    expect(plan).toMatchObject({ roles: 2, tokens: 37040, at: '2026-10-03T06:00:00-07:00' });
    const parts = rules.scheduledParts(runway, {
      today: '2026-10-02',
      day: seed.format.date,
      time: (value) => String(value).slice(11, 16),
    });
    expect(
      parts && `${parts.before}${parts.roles}${parts.middle}${parts.tokens}${parts.after}`,
    ).toBe('Tailoring 2 roles tomorrow at 06:00 uses about 37,040 tokens.');
    // Its two figures are the store's keys, each once on the page.
    expect([parts?.rolesMetric, parts?.tokensMetric]).toEqual([
      'tailor.scheduled',
      'tokens.scheduled',
    ]);
    expect([seed.metricText('tailor.scheduled'), seed.metricText('tokens.scheduled')]).toEqual([
      parts?.roles,
      parts?.tokens,
    ]);
    // A later day names its date; one role is a role; nothing planned draws nothing.
    const later = rules.scheduledParts(
      { tokens: { scheduled: { roles: 1, tokens: 18520, at: '2026-10-05T06:00:00-07:00' } } },
      { today: '2026-10-02', day: () => 'Mon, Oct 5', time: () => '06:00' },
    );
    expect(
      later && `${later.before}${later.roles}${later.middle}${later.tokens}${later.after}`,
    ).toBe('Tailoring 1 role on Mon, Oct 5 at 06:00 uses about 18,520 tokens.');
    expect(rules.scheduledParts({ tokens: { scheduled: { roles: 0, tokens: 0 } } })).toBeNull();
    expect(rules.scheduledParts({ tokens: {} })).toBeNull();
    expect(main).toContain('<p class="usage-scheduled" id="usage-scheduled" hidden></p>');
    // The large account plans its ten added roles the same way.
    expect(large.runway().tokens.scheduled).toMatchObject({ roles: 10, tokens: 185200 });
  });

  it('counts the large account’s many sources the same way', () => {
    const big = large.runway();
    const rows = rules.usesRows(big);
    expect(rows.map((row) => row.id)).toEqual(['watch', 'gmail', 'summary']);
    expect(big.runs.uses.reduce((sum, use) => sum + use.perDay, 0)).toBe(big.runs.perDay);
    expect(large.metric('runs.perDay')).toBe(big.runs.perDay);
    for (const row of rows) expect(row.figure).not.toMatch(/[–—]/);
  });
});

describe('Usage page: tokens and runs over time, and every combination (D9, D10)', () => {
  it('says a range’s totals in words, the store’s formats', () => {
    expect(
      rules.totalsWords(
        { tokens: 60710, calls: 9, costPlatform: 2398, costOwnEstimate: 120000 },
        { tokens: seed.format.tokens, money: seed.format.money },
      ),
    ).toEqual({
      tokens: '60,710',
      calls: '9',
      callsNoun: 'calls',
      cost: seed.format.money(2398),
      costEstimate: seed.format.money(120000),
    });
    // T5-20: money at the precision of its parts, so the platform cost and your keys' estimate
    // add up to the combinations' total ($0.024 + $0.221 = $0.245).
    expect(
      [2398, 24011.68, 221010, 1709300, 0].map((micros) => rules.preciseMoney(micros)),
    ).toEqual(['$0.0024', '$0.024', '$0.221', '$1.71', '$0.00']);
    expect(script).toContain(
      'const words = totalsWords(tokenUsage.totals, { tokens: tokensText, money: preciseMoney });',
    );
    // T3-9: the store folds the tail once; the chart folds nothing more.
    expect(script.match(/cap: 6,/g)?.length).toBeGreaterThanOrEqual(1);
    expect(script).not.toMatch(/cap: 5,\s*otherLabel: group\.other/);
    // The count is the store's figure (usage.<range>.calls), its noun beside it.
    expect(rules.totalsWords({ calls: 1 }).callsNoun).toBe('call');
    expect(main).toContain(
      '<dd class="stat-meta"><span data-usage-total="calls">Counting</span> <span data-usage-noun="calls">calls</span></dd>',
    );
    // What ran your AI in the range: what was in place when it began ("Since", the last setting
    // or model and the last limit before it), then each change inside it, "until" when it ended
    // there. Older changes (a key added in July) stay out.
    const day = (value: unknown) => String(value).slice(5, 10);
    expect(
      rules.settingsLines(
        {
          from: '2026-09-02T14:00:00-07:00',
          to: '2026-10-02T14:00:00-07:00',
          settings: [
            { at: '2026-07-04T09:00:00-07:00', kind: 'key', text: 'You added your Anthropic key' },
            {
              at: '2026-07-04T09:00:00-07:00',
              kind: 'limit',
              text: 'Your keys’ limit: 50,000 tokens a day',
            },
            {
              at: '2026-08-10T09:00:00-07:00',
              kind: 'model',
              text: 'Your Anthropic key with claude-haiku-4-5',
            },
            {
              at: '2026-09-01T09:00:00-07:00',
              until: '2026-09-08T09:00:00-07:00',
              kind: 'setting',
              text: 'Platform credits with Ministral 3 14B',
            },
            {
              at: '2026-09-08T09:00:00-07:00',
              until: '2026-09-15T08:00:00-07:00',
              kind: 'setting',
              text: 'Your OpenAI key with gpt-5',
            },
            { at: '2026-10-01T09:15:00-07:00', kind: 'one-off', text: '' },
          ],
        },
        day,
      ),
    ).toEqual([
      'Since 07-04: Your keys’ limit: 50,000 tokens a day',
      'Since 09-01: Platform credits with Ministral 3 14B, until 09-08',
      '09-08: Your OpenAI key with gpt-5, until 09-15',
    ]);
    // ST 18 (T5-18): the store's own line wins, its until included; only "Since" is added.
    expect(
      rules.settingsLines({
        from: '2026-09-02T14:00:00-07:00',
        to: '2026-10-02T14:00:00-07:00',
        settings: [
          {
            at: '2026-09-01T09:00:00-07:00',
            until: '2026-09-08T09:00:00-07:00',
            kind: 'setting',
            text: 'Platform credits with Ministral 3 14B',
            line: 'Tue, Sep 1: Platform credits with Ministral 3 14B, until Tue, Sep 8',
          },
          {
            at: '2026-10-01T11:30:00-07:00',
            kind: 'fallback',
            text: 'x',
            line: 'Thu, Oct 1: Your OpenAI key reached its daily limit at 11:30, so Ministral 3 14B on platform credits ran until the limit reset at 17:00',
          },
        ],
      }),
    ).toEqual([
      'Since Tue, Sep 1: Platform credits with Ministral 3 14B, until Tue, Sep 8',
      'Thu, Oct 1: Your OpenAI key reached its daily limit at 11:30, so Ministral 3 14B on platform credits ran until the limit reset at 17:00',
    ]);
    expect(script).toContain('if (!change?.progress) render();');
    // T4-23: each use's link to its home has a focus key, so Back returns to it.
    expect(script).toContain("link.setAttribute('data-focus-key', `usage-use-$" + '{row.id}`);');
  });

  // Round 6's AI in October moved here (round 7, D10): October is unchanged in both worlds, so
  // This month reads 60,710 tokens: 49,810 gpt-5-mini on your OpenAI key and 10,900 Ministral 3
  // 14B on platform credits; by task 18,080 searching, 27,180 tailoring, and 15,450 letters.
  it('keeps October’s figures: 60,710 tokens, by model and by task (AI & credits’ old view)', () => {
    const month = seed.aiMonthUsage();
    expect(month.total).toBe(60710);
    expect(seed.metric('ai.tokens.month')).toBe(60710);
    expect(month.models.map((model) => [model.id, model.tokens])).toEqual([
      ['gpt-5-mini', 49810],
      ['ministral-3-14b', 10900],
    ]);
    expect(
      month.tasks.filter((task) => task.total > 0).map((task) => [task.label, task.total]),
    ).toEqual([
      ['Searches', 18080],
      ['Tailored résumés', 27180],
      ['Cover letters', 15450],
    ]);
    expect(month.combos.map((combo) => combo.text)).toEqual([
      'Your OpenAI key runs Deputy Assist: 1 search, 2 tailored résumés, and 2 cover letters',
      'Platform credits ran 1 search on Oct 1',
    ]);
    if (typeof seed.usage === 'function') {
      const usage = seed.usage({ range: 'month', group: 'model' });
      expect(usage.totals.tokens).toBe(60710);
      const byModel = Object.fromEntries(usage.groups.map((group) => [group.id, group.tokens]));
      expect(byModel['gpt-5-mini']).toBe(49810);
      expect(byModel['ministral-3-14b']).toBe(10900);
      const byTask = seed.usage({ range: 'month', group: 'task' });
      expect(byTask.totals.tokens).toBe(60710);
      // The permutations add up to the totals.
      expect(usage.permutations.reduce((sum, row) => sum + row.tokens, 0)).toBe(
        usage.totals.tokens,
      );
      expect(large.usage?.({ range: 'month' }).totals.tokens).toBe(large.metric('ai.tokens.month'));
    }
  });

  it('counts runs over the range by what used them, from the store’s ledger', () => {
    const ledger = seed.runsLedger({ range: 'month' });
    expect(ledger.total).toBe(6);
    expect(plain(ledger.byFeature)).toEqual({ search: 2, watch: 2, gmail: 2, summary: 0 });
    expect(ledger.features.map((feature) => feature.id)).toEqual([
      'search',
      'watch',
      'gmail',
      'summary',
    ]);
    expect(ledger.entries.reduce((sum, entry) => sum + (entry.feature ? 1 : 0), 0)).toBe(
      ledger.total,
    );
    expect(seed.metric('runs.used')).toBe(ledger.total);
  });

  it('names the setting changes and fallbacks in the range, and keeps reading mail apart', () => {
    expect(main).toContain(
      '<summary><span class="usage-fold-name" id="usage-settings-title">What ran your AI in this range<span class="usage-fold-meta" id="usage-settings-count"></span></span></summary>',
    );
    // Closed: the chart marks each change on its bar; the fold holds the full dated list.
    expect(elementById(main, 'usage-settings-wrap')).toMatch(
      /^<details class="usage-fold usage-settings-wrap" id="usage-settings-wrap" hidden>/,
    );
    expect(script).toContain(
      "const lines = settingsLines(tokenUsage, (value) => store.format?.date?.(value) ?? '');",
    );
    // Reading job email is part of each Gmail scan's run (ST judgment call 1), so its tokens are
    // said apart from the ones you pay for.
    expect(script).toContain('is part of each Gmail scan’s run, so it isn’t in the tokens above.');
  });
});

describe('Usage page: the deputy’s tour (R6-2)', () => {
  const steps = [
    ...main.matchAll(
      /<(\w+)\b[^>]*\sdata-tour-step="(\d+)"[^>]*\sdata-tour-title="([^"]+)"[^>]*\sdata-tour-text="([^"]+)"/g,
    ),
  ].map((match) => ({ step: Number(match[2]), title: match[3] ?? '', text: match[4] ?? '' }));

  it('walks through what you pay for, the range, the runway, runs, tokens, and the combinations', () => {
    expect(steps.map((item) => [item.step, item.title])).toEqual([
      [1, 'This is what you pay for.'],
      [2, 'Choose any range here.'],
      [3, 'This is how long they last.'],
      [4, 'This is what used your runs.'],
      [5, 'Group your tokens any way.'],
      [6, 'Every combination, counted.'],
    ]);
    for (const item of steps) {
      expect(words(item.title), item.title).toBeLessThanOrEqual(6);
      expect(words(item.text), item.title).toBeLessThanOrEqual(40);
      expect(item.text, item.title).toMatch(/\b(?:I|I’m|my|me)\b/);
      expect(`${item.title} ${item.text}`).not.toMatch(/[–—]/);
    }
    const at = steps.map((item) => main.indexOf(`data-tour-step="${item.step}"`));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(main).not.toMatch(/data-tour-step="\d+"[^>]*\shidden/);
  });
});

describe('Usage page: words', () => {
  it('writes no dashes, and every empty value reads a word', () => {
    expect(textOf(main)).not.toMatch(/[–—]/);
    expect(script).not.toMatch(/'[^'\n]*[–—][^'\n]*'|`[^`\n]*[–—][^`\n]*`/);
    expect(page).not.toMatch(/[–—]/);
    // R9-4: a figure still being counted reads "Counting", never a dash or a blank.
    expect(main.match(/>Counting</g)?.length).toBe(4);
    // Alex Morgan and example.com only.
    expect(page).not.toMatch(/@(?!example\.com)[\w-]+\.(?:com|org|net)/);
  });
});
