import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Page guarantees for Settings, Activity (brand/activity-preview.html, round 7, SE1): the audit
// trail. Every entry from JobDeputyStore.activityLog() says who did it (You, Your deputy, or
// JobDeputy for the system: reminders, billing, the agreement), what, where, and when, with a link
// to the thing. It opens with its metrics band (R10-2: the whole log's last 30 days by who), then
// the log: the shared filter bar (who, area, the time range, and search, each with its counts,
// live as you choose, R10-7), the shared pagination (top and bottom, the page size, the page in
// the address, R10-6), Export (every entry the filters show as a CSV file, through the shared
// download), and calm empty states. A Settings tab, last, with the shell of the other Settings
// pages; the deputy keeps track. The page keeps its pure rules between `/* activity-rules: start
// */` and `end` markers; they run here on their own. The rendered checks run in
// scripts/ui-audit.mjs, and the click-throughs in headless Chrome.

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');
const page = sourceFor('activity-preview.html');
// The Settings page whose shell Activity copies (a tab that is not Account).
const shop = sourceFor('shop-preview.html');

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

function rulesOf<T>(source: string, name: string, global: string): T {
  const start = source.indexOf(`/* ${name}-rules: start */`);
  const end = source.indexOf(`/* ${name}-rules: end */`);
  if (start < 0 || end < start) throw new Error(`${name}-rules markers not found`);
  const block = source.slice(start, end);
  return new Script(`${block}\n${global};`, { filename: `${name}-rules` }).runInNewContext({}) as T;
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type Entry = {
  id: string;
  who: string;
  whoLabel: string;
  text: string;
  href: string;
  area: string;
  areaLabel: string;
  target: string;
  at: string;
  time: string;
};
type Facets = Record<string, Array<{ id: string; label?: string; count: number }>>;
type ActivityRules = {
  WHO: Record<string, string>;
  WHO_ORDER: string[];
  SIZES: number[];
  DEFAULT_SIZE: number;
  DEFAULT_RANGE: string;
  RANGES: string[];
  whoLabel(who: string): string;
  whoOptions(facets: unknown): Array<{ value: string; label: string; count: number }>;
  areaOptions(facets: unknown): Array<{ value: string; label: string; count: number }>;
  barCounts(facets: unknown): { who: Record<string, number>; area: Record<string, number> };
  queryFor(
    state?: Record<string, unknown>,
    place?: { page?: number; size?: number },
  ): Record<string, unknown>;
  exportQuery(state?: Record<string, unknown>): Record<string, unknown>;
  filtered(state?: Record<string, unknown>): boolean;
  entryView(row: unknown, options?: { time?: (at: unknown) => string }): Entry;
  dayGroups(
    rows: unknown,
    options?: {
      dayKey?: (at: unknown) => string;
      day?: (at: unknown) => string;
      time?: (at: unknown) => string;
    },
  ): Array<{ key: string; title: string; entries: Entry[] }>;
  emptyView(input: { total?: number; state?: Record<string, unknown> }): {
    title: string;
    copy: string;
    clear: boolean;
  } | null;
  bandFigures(facets: unknown): Record<string, number>;
  exportNote(total: number): string;
  exportTitle(day: string): string;
};
const rules = rulesOf<ActivityRules>(page, 'activity', 'activityRules');

type Store = {
  metric(key: string): unknown;
  metricText(key: string): string;
  activityLog?: (query?: Record<string, unknown>) => {
    rows: Array<Record<string, unknown>>;
    total: number;
    facets: Facets;
  };
  format: { date(value: unknown): string; time(value: unknown): string };
};
function sampleStore(): Store {
  const storage = new Map<string, string>();
  const window: Record<string, unknown> = { addEventListener: () => {} };
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  window.crypto = globalThis.crypto;
  runInNewContext(sourceFor('agreement-text.js'), { window, localStorage, JSON });
  runInNewContext(sourceFor('sample-store.js'), { window, localStorage, JSON, URLSearchParams });
  return window.JobDeputyStore as Store;
}

const main = mainOf(page);
const script = scriptOf(page);

describe('Activity page frame', () => {
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
    ].map((name) => page.indexOf(`<script src="./${name}"></script>`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order.at(-1)).toBeLessThan(page.indexOf('<script>'));
  });

  it('copies a Settings page’s shell: :root, links, header, nav, account menu, dock, and footer', () => {
    const rootOf = (source: string) => source.match(/:root\s*\{[^}]*\}/)?.[0];
    expect(rootOf(page)).toBe(rootOf(shop));
    const links = (source: string) =>
      between(source, '<link rel="icon"', '<link rel="stylesheet" href="./deputy.css" />');
    expect(links(page)).toBe(links(shop));
    const header = (source: string) => source.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
    expect(header(page)).toBe(header(shop));
    expect(markedBlock(page, 'AppNav')).toBe(markedBlock(shop, 'AppNav'));
    expect(markedBlock(page, 'AppNav')).toContain(
      '<a class="app-nav-link" href="./account-preview.html" aria-current="true">',
    );
    const footer = (source: string) => between(source, '<footer class="site-footer"', '</footer>');
    expect(footer(page)).toBe(footer(shop));
    const menu = (source: string) =>
      source.match(/<button\s+class="compact-action app-menu-toggle"[\s\S]*?<\/button>/)?.[0];
    expect(menu(page)).toBe(menu(shop));
    expect(textOf(menu(page) ?? '')).toBe('Menu · Settings');
    expect(page).toContain('<title>JobDeputy · Settings · Activity</title>');
    expect(page).toContain('<a class="skip-link" href="#page-title">Skip to Activity</a>');
    expect(page).toContain('<link rel="icon" href="./jobdeputy-mark.svg" type="image/svg+xml" />');
  });

  it('hosts the deputy keeping track, with that state’s duty and speech', () => {
    const dock = markedBlock(page, 'DeputyDock');
    expect(dock).toContain('data-deputy-page="activity"');
    expect(dock).toContain('data-deputy-state="track"');
    expect(dock).toContain('<p class="deputy-speech" data-deputy-speech>I log every step.</p>');
    expect(dock).toContain('<span data-deputy-duty>Keeping track</span>');
    const normalize = (block: string) =>
      block
        .replace(/data-deputy-page="[^"]*"/, '')
        .replace(/data-deputy-state="[^"]*"/, '')
        .replace(/(<p class="deputy-speech" data-deputy-speech>)[^<]*(<\/p>)/, '$1$2')
        .replace(/(<span data-deputy-duty>)[^<]*(<\/span>)/, '$1$2');
    expect(normalize(dock)).toBe(normalize(markedBlock(shop, 'DeputyDock')));
    // One panda per viewport: the empty state uses a prop, never a second drawing.
    expect(main).not.toMatch(/data-deputy(?:-art)?[\s>=]/);
    expect(elementById(page, 'act-empty')).toContain('data-deputy-prop="clipboard"');
  });

  it('opens with the shared page intro and the seven Settings tabs, Activity last (R6-3, R10-3)', () => {
    const intro = main.match(/<section class="page-intro act-intro"[\s\S]*?<\/section>/)?.[0] ?? '';
    // Activity is the full log's home: a link here with return= gets Back to its page.
    expect(intro).toMatch(
      /^<section class="page-intro act-intro" aria-labelledby="page-title" data-page-back>\s*<div class="page-intro-copy">\s*<p class="eyebrow">Settings<\/p>/,
    );
    expect(textOf(intro.match(/<h1 id="page-title">([\s\S]*?)<\/h1>/)?.[1] ?? '')).toBe(
      'Activity.',
    );
    const lede = textOf(intro.match(/<p class="intro-copy">([\s\S]*?)<\/p>/)?.[1] ?? '');
    expect(lede).toBe('Everything you, your deputy, and JobDeputy did, newest first.');
    expect(words(lede)).toBeLessThanOrEqual(16);
    expect(intro).toMatch(
      /<div class="page-intro-actions">\s*<button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour<\/button>\s*<\/div>/,
    );
    expect(main.match(/<h1\b/g)).toHaveLength(1);
    const tabs = markedBlock(page, 'SettingsTabs');
    expect(
      [
        ...tabs.matchAll(/<a class="settings-tab" href="\.\/([\w-]+)\.html"[^>]*>([^<]+)<\/a>/g),
      ].map((match) => match[2]),
    ).toEqual([
      'Account',
      'Connections',
      'Prompts',
      'AI &amp; credits',
      'Usage',
      'Purchases',
      'Activity',
    ]);
    expect(tabs).toContain(
      '<li><a class="settings-tab" href="./activity-preview.html" aria-current="page">Activity</a></li>',
    );
    expect(tabs.match(/aria-current/g)).toHaveLength(1);
    // The same strip as Purchases', apart from which tab is current.
    expect(tabs.replace(' aria-current="page"', '')).toBe(
      markedBlock(shop, 'SettingsTabs').replace(' aria-current="page"', ''),
    );
    expect(main).toMatch(/<\/section>\s*<!-- SettingsTabs: start -->/);
    // The page never places or restyles the shared intro, the tour button, or the tabs.
    expect(stylesOf(page)).not.toMatch(
      /(^|[\s,}])\.(page-intro|page-tour|settings-tab|stat-row|filter-bar|pagination)[^{]*\{/m,
    );
  });

  it('opens with its metrics band, then the log with its filters, pagers, and Export (R10-2)', () => {
    const sections = [
      ...main.matchAll(
        /<section class="task-surface act-surface" id="([\w-]+)" aria-labelledby="([\w-]+)">/g,
      ),
    ].map((match) => [match[1], match[2]]);
    expect(sections).toEqual([
      ['summary', 'act-summary-title'],
      ['log', 'act-log-title'],
    ]);
    // The band: four figures of the whole log's last 30 days, by who.
    const stats = elementById(page, 'act-stats');
    expect(stats).toMatch(
      /^<dl\s+class="stat-row act-stats"\s+id="act-stats"\s+data-skeleton="lines"/,
    );
    expect(
      [...stats.matchAll(/<dt class="stat-label">([^<]+)<\/dt>/g)].map((match) => match[1]),
    ).toEqual(['Last 30 days', 'By your deputy', 'By you', 'By JobDeputy']);
    expect([...stats.matchAll(/data-act-stat="(\w+)"/g)].map((match) => match[1])).toEqual([
      'total',
      'deputy',
      'you',
      'jobdeputy',
    ]);
    // Until the page reads the store, each figure reads a word, never a dash (R9-4).
    expect([...stats.matchAll(/data-act-stat="\w+">([^<]+)</g)].map((match) => match[1])).toEqual([
      'Counting',
      'Counting',
      'Counting',
      'Counting',
    ]);
    // The log: the head with Export, the filter bar's host, the two pagers, the days, the empty
    // state, in that order.
    const log = elementById(page, 'log');
    const order = [
      'act-log-title',
      'act-export',
      'act-filters',
      'act-pager-top',
      'act-days',
      'act-empty',
      'act-pager',
    ].map((id) => log.indexOf(`id="${id}"`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(textOf(log.match(/<p class="act-copy">([\s\S]*?)<\/p>/)?.[1] ?? '')).toBe(
      'Who did each thing: you, your deputy, or JobDeputy for reminders, billing, and the agreement.',
    );
    // The heading takes focus after a page change (the pager's heading).
    expect(elementById(page, 'act-log-title')).toBe(
      '<h2 id="act-log-title" tabindex="-1">What happened.</h2>',
    );
    // Export says what it saves, beside it and in its name.
    expect(elementById(page, 'act-export')).toBe(
      '<button class="secondary-action" id="act-export" type="button">Export<span class="sr-only"> what the filters show as a CSV file</span></button>',
    );
    expect(textOf(elementById(page, 'act-export-note'))).toBe(
      'A CSV file of what the filters show',
    );
    // One Sample data note, in the log.
    expect(main.match(/>Sample data · not connected</g)).toHaveLength(1);
    // The regions the script draws hold their place behind skeletons until it reveals (R10-1).
    for (const id of ['act-stats', 'act-filters', 'act-days']) {
      expect(elementById(page, id), id).toMatch(/\sdata-skeleton="[a-z]+"/);
    }
    expect(script).toContain('components?.boot?.ready?.();');
  });

  it('announces through one visually hidden channel, and writes no dashes', () => {
    const live = [
      ...page.matchAll(
        /<([a-z]+)\b([^>]*(?:role="(?:status|alert|log)"|aria-live="(?!off)[^"]*")[^>]*)>/g,
      ),
    ].map((match) => match[0]);
    expect(live).toEqual([
      '<p class="sr-only" data-deputy-announce role="status">',
      '<p class="sr-only" id="act-status" role="status" aria-live="polite">',
    ]);
    expect(textOf(main)).not.toMatch(/[\u2013\u2014]/);
    expect(script).not.toMatch(/[\u2013\u2014]/);
    expect(stylesOf(page)).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('Activity rules', () => {
  const facets: Facets = {
    who: [
      { id: 'deputy', label: 'Your deputy', count: 160 },
      { id: 'you', label: 'You', count: 38 },
      { id: 'jobdeputy', label: 'JobDeputy', count: 16 },
    ],
    area: [
      { id: 'gmail', label: 'Gmail', count: 30 },
      { id: 'searches', label: 'Searches', count: 120 },
    ],
  };

  it('names who did it in words, always in the order You, Your deputy, JobDeputy', () => {
    expect(plain(rules.WHO)).toEqual({ you: 'You', deputy: 'Your deputy', jobdeputy: 'JobDeputy' });
    expect(plain(rules.WHO_ORDER)).toEqual(['you', 'deputy', 'jobdeputy']);
    expect(rules.whoLabel('deputy')).toBe('Your deputy');
    expect(plain(rules.whoOptions(facets))).toEqual([
      { value: 'all', label: 'All', count: 214 },
      { value: 'you', label: 'You', count: 38 },
      { value: 'deputy', label: 'Your deputy', count: 160 },
      { value: 'jobdeputy', label: 'JobDeputy', count: 16 },
    ]);
    expect(plain(rules.whoOptions(undefined)).map((option) => option.count)).toEqual([0, 0, 0, 0]);
    expect(plain(rules.areaOptions(facets))).toEqual([
      { value: 'gmail', label: 'Gmail', count: 30 },
      { value: 'searches', label: 'Searches', count: 120 },
    ]);
    expect(plain(rules.barCounts(facets))).toEqual({
      who: { all: 214, you: 38, deputy: 160, jobdeputy: 16 },
      area: { gmail: 30, searches: 120 },
    });
    expect(plain(rules.bandFigures(facets))).toEqual({
      total: 214,
      you: 38,
      deputy: 160,
      jobdeputy: 16,
    });
  });

  it('asks the store for one page of what the filters show, and every page for Export', () => {
    expect(plain(rules.queryFor())).toEqual({ page: 1, size: 24, range: '30d' });
    expect(
      plain(
        rules.queryFor(
          { q: ' Gmail ', who: 'deputy', area: ['gmail', ''], range: { preset: '1w' } },
          { page: 3, size: 48 },
        ),
      ),
    ).toEqual({ page: 3, size: 48, q: 'Gmail', who: 'deputy', area: ['gmail'], range: '1w' });
    // All asks for everyone; an unknown size falls back to 24; a custom range is its from and to.
    expect(
      plain(
        rules.queryFor(
          { who: 'all', range: { preset: 'custom', from: 'a', to: 'b' } },
          { size: 7 },
        ),
      ),
    ).toEqual({ page: 1, size: 24, from: 'a', to: 'b' });
    expect(plain(rules.exportQuery({ who: 'you' }))).toEqual({ who: 'you', range: '30d' });
    expect(plain(rules.SIZES)).toEqual([12, 24, 48]);
    expect([rules.DEFAULT_SIZE, rules.DEFAULT_RANGE]).toEqual([24, '30d']);
    expect(rules.filtered({})).toBe(false);
    expect(rules.filtered({ range: '30d', who: 'all' })).toBe(false);
    expect(rules.filtered({ range: { preset: '1w' } })).toBe(true);
    expect(rules.filtered({ q: 'scan' })).toBe(true);
    expect(rules.filtered({ area: ['gmail'] })).toBe(true);
  });

  it('draws a page of entries by day: who, what with its link, where, and the time', () => {
    const rows = [
      {
        id: 'act-2',
        at: '2026-10-02T07:00:00-07:00',
        who: 'deputy',
        whoLabel: 'Your deputy',
        area: 'gmail',
        areaLabel: 'Gmail',
        text: 'Scanned Gmail: read 6 job emails',
        target: { label: 'Gmail', href: './connections-preview.html#gmail' },
      },
      {
        id: 'act-1',
        at: '2026-10-01T09:15:00-07:00',
        who: 'you',
        area: 'searches',
        areaLabel: 'Searches',
        text: 'Ran Google Careers again',
        target: { label: 'Google Careers', href: 'javascript:alert(1)' },
      },
      { id: 'act-0', at: '2026-10-01T08:00:00-07:00', who: 'odd', text: 'Sent your daily summary' },
    ];
    const store = sampleStore();
    const groups = rules.dayGroups(rows, {
      dayKey: store.format.date,
      day: store.format.date,
      time: store.format.time,
    });
    expect(groups.map((group) => [group.title, group.entries.map((entry) => entry.id)])).toEqual([
      ['Fri, Oct 2', ['act-2']],
      ['Thu, Oct 1', ['act-1', 'act-0']],
    ]);
    expect(plain(groups[0]?.entries[0])).toEqual({
      id: 'act-2',
      who: 'deputy',
      whoLabel: 'Your deputy',
      text: 'Scanned Gmail: read 6 job emails',
      href: './connections-preview.html#gmail',
      area: 'gmail',
      areaLabel: 'Gmail',
      target: 'Gmail',
      at: '2026-10-02T07:00:00-07:00',
      time: '07:00',
    });
    // Only a link to a page of this prototype is kept; an unknown who reads JobDeputy.
    expect(groups[1]?.entries[0]?.href).toBe('');
    expect(groups[1]?.entries[0]?.whoLabel).toBe('You');
    expect(groups[1]?.entries[1]?.who).toBe('jobdeputy');
    expect(rules.dayGroups(undefined)).toEqual([]);
    // The row: an icon and a word for who (never colour alone), the text as the link with
    // return=, the area, and the time.
    expect(script).toContain(
      "who.querySelector('use').setAttribute('href', `#act-icon-$" + '{entry.who}`);',
    );
    // With a link, what happened and where is one 44px link (the audit's target check).
    expect(script).toContain("const what = document.createElement(entry.href ? 'a' : 'div');");
    expect(script).toContain("what.setAttribute('data-return-link', '');");
    expect(script).toContain('what.dataset.focusKey = `act-$' + '{entry.id}`;');
    expect(stylesOf(page)).toMatch(/\.act-what \{[^}]*min-height: 44px;/);
    for (const who of ['you', 'deputy', 'jobdeputy']) {
      expect(page, who).toContain(`<symbol id="act-icon-${who}"`);
    }
  });

  it('says calmly when nothing is there, and offers Clear only when filters hide it', () => {
    expect(rules.emptyView({ total: 3, state: {} })).toBeNull();
    expect(plain(rules.emptyView({ total: 0, state: {} }))).toEqual({
      title: 'Nothing in this time yet.',
      copy: 'When you or your deputy do something, it is listed here with who did it.',
      clear: false,
    });
    expect(plain(rules.emptyView({ total: 0, state: { who: 'jobdeputy' } }))).toEqual({
      title: 'Nothing matches these filters.',
      copy: 'Try fewer filters or a longer time range.',
      clear: true,
    });
    expect(textOf(elementById(page, 'act-empty'))).toBe(
      'Nothing matches these filters. Try fewer filters or a longer time range. Clear the filters',
    );
    expect(script).toContain('bar?.clear?.();');
  });

  it('names Export’s file and what it holds', () => {
    expect(rules.exportNote(214)).toBe('A CSV file of the 214 entries the filters show');
    expect(rules.exportNote(1)).toBe('A CSV file of the entry the filters show');
    expect(rules.exportNote(0)).toBe('Nothing to export for these filters');
    expect(rules.exportTitle('Fri, Oct 2')).toBe('JobDeputy activity, Fri, Oct 2');
    expect(rules.exportTitle('')).toBe('JobDeputy activity');
    // The CSV text is the store's (activityLogCsv), saved through the shared download; without
    // either, Export is off and says why beside it.
    expect(script).toContain("const csv = call('activityLogCsv', rules.exportQuery(barState()));");
    expect(script).toContain(
      "result = await components.download({ title: rules.exportTitle(day(call('nowIso'))), csv }, 'csv');",
    );
    expect(script).toContain("if (off) exportButton.setAttribute('aria-disabled', 'true');");
    expect(script).toContain("'Export isn’t available on this page yet.'");
  });
});

describe('Activity: the shared filter bar, pagination, and the store (R10-6, R10-7)', () => {
  it('builds the filter bar from the store’s facets, live, with its state in the address', () => {
    for (const part of [
      'bar = components.filterBar(filterHost, {',
      // T4-13: the search says what it finds.
      "search: { label: 'Search activity', param: 'q', placeholder: 'For example: Gmail or Google' },",
      "{ name: 'who', label: 'Who', kind: 'choice', param: 'who', options: rules.whoOptions(seed?.facets) },",
      // T3-14: the log reaches back further: Last 90 days, Last 12 months, All time.
      "range: { param: 'range', value: rules.DEFAULT_RANGE, presets: [...rules.RANGES] },",
      "noun: ['entry', 'entries'],",
      // T3-19: the bar's counts change only when they do.
      'if (countsKey !== lastCountsKey) {',
      'bar?.setCounts?.(counts);',
      'bar?.setResult?.(total);',
    ]) {
      expect(script, part).toContain(part);
    }
    // A filter change goes back to page 1.
    expect(script).toMatch(
      /onChange: \(\) => \{\s*place\.page = 1;\s*renderLog\(\{ moved: true \}\);/,
    );
  });

  it('pages with the shared pagination: top and bottom, the size, the address, the list top', () => {
    for (const part of [
      "pager = components.pagination($('#act-pager'), {",
      "label: 'Pages of activity',",
      "top: $('#act-pager-top'),",
      'sizes: [...rules.SIZES],',
      'list: daysHost,',
      'address: true,',
      "components.pagination.fromAddress({ param: 'page', sizeParam: 'size', sizes: [...rules.SIZES] })",
      'pager.render({ total, page: place.page, pageSize: place.size });',
      // T7-1: the pager is drawn again only when what it says changed.
      'if (key === pagerKey) return;',
      // T4-9, T2-18: after a page change focus goes to the new page's first day, at the list top
      // (the heading above the filters is out of view).
      "daysHost.querySelector('.act-day-title')?.focus({ preventScroll: true });",
      // T3-7: a new page size starts at the first page, in the address too.
      "addressPage('page', 1);",
    ]) {
      expect(script, part).toContain(part);
    }
    expect(script).toMatch(
      /onChange: \(page\) => \{\s*place\.page = page;\s*renderLog\(\);\s*focusListTop\(\);/,
    );
    expect(script).toContain('title.tabIndex = -1;');
  });

  it('reads only one page from the store, and follows it in place (R9-3, L1)', () => {
    expect(script).toContain("const result = call('activityLog', query);");
    expect(script).toContain('if (signature !== lastSignature) {');
    // T3-19, T7-1: a live progress tick is skipped; a change morphs the page in place, keeping
    // each entry's node and the focus inside it.
    expect(script).toMatch(
      /store\?\.subscribe\?\.\(\(_state, change\) => \{\s*if \(change\?\.progress\) return;/,
    );
    expect(script).toContain('morphDays(rules.dayGroups(rows, { dayKey, day, time }));');
    expect(script).toContain('if (!item || item.dataset.signature !== signature) {');
    expect(script).toContain('if (at !== child) parent.insertBefore(child, at);');
    expect(plain(rules.RANGES)).toEqual([
      '1h',
      '3h',
      '12h',
      '1d',
      '3d',
      '1w',
      '2w',
      '30d',
      'month',
      '90d',
      'year',
      'all',
    ]);
    // The band: the store's metric keys where it has them, else the facet counts.
    expect(script).toContain("total: 'activity.last30',");
    const store = sampleStore();
    if (typeof store.activityLog === 'function') {
      const all = store.activityLog({ range: '30d', size: 24 });
      expect(all.rows.length).toBeLessThanOrEqual(24);
      expect(Object.keys(all.facets)).toEqual(expect.arrayContaining(['who', 'area']));
      const who = rules.bandFigures(all.facets);
      expect(who.total).toBe((who.you ?? 0) + (who.deputy ?? 0) + (who.jobdeputy ?? 0));
    }
  });
});

describe('Activity tour', () => {
  const steps = [
    ...main.matchAll(
      /\sdata-tour-step="(\d+)"\s+data-tour-title="([^"]+)"\s+data-tour-text="([^"]+)"/g,
    ),
  ].map((match): [number, string, string] => [Number(match[1]), match[2] ?? '', match[3] ?? '']);

  it('explains the band, Export, the filters, and an entry, in the deputy’s first person (R6-2)', () => {
    expect(steps.map(([number, title]) => [number, title])).toEqual([
      [1, 'I log everything I do.'],
      [2, 'Take a copy any time.'],
      [3, 'Choose whose actions to see.'],
      [4, 'Each entry says who did it.'],
    ]);
    for (const [, title, text] of steps) {
      expect(words(title), title).toBeLessThanOrEqual(6);
      expect(words(text), title).toBeLessThanOrEqual(30);
    }
    expect(steps.some(([, title, text]) => /\b(?:I|me|my)\b/.test(`${title} ${text}`))).toBe(true);
    const targets = [...main.matchAll(/\sid="([\w-]+)"[^>]*?\sdata-tour-step="(\d+)"/g)].map(
      (match) => match[1],
    );
    expect(targets).toEqual(['act-stats', 'act-export-step', 'act-filters', 'act-days']);
    expect(script).not.toMatch(/tour\.start|maybeStart/);
  });
});
