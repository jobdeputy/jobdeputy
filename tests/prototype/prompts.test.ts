import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Settings, Prompts (brand/prompts-preview.html, round 6, S1 and T1; part 2, N4, P-7, P-14; round
// 7, SE2, S4, R10-3, R10-5). The page leads with the stats of the last 30 days (tests, pass rate,
// trials, rollbacks), then every prompt as the shared prompt summary row (app-panels.js draws
// [data-prompt-summary]: name, version and state, the score trend, Kept by you, tokens, the model
// mix) with Details beside it, which opens the prompt in place: its state in one line, the full
// prompt control (every version and its tests, Use this version, Test it, Compare, Edit as a new
// version, Roll back), the version x model table (S4), its tokens over time, and its own rollback
// rules. ?prompt=<task id>&return=<page> opens one with Back to <page> (R10-3). Definitions, the
// account's rollback rules, and How testing works are disclosures under More about your prompts.
// prompt-drawer.test.ts runs the control itself against the real store. The page's pure rules sit
// between `/* prompts-rules: start */` and `end` and run here on their own; the rendered checks
// (layout, the metrics probe, the tour, the flow of a test, the budgets) run in headless Chrome.

const brand = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string) => readFileSync(resolve(brand, file), 'utf8');
const page = sourceFor('prompts-preview.html');
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

type Store = {
  PROMPT_IDS: string[];
  prompt(id: string): { name: string; where: Array<{ page: string }> } | null;
  metricText(key: string): string;
  rolloutSettings(id?: string): Settings;
  setRolloutSettings(
    patch: Record<string, unknown> | null,
    options?: { promptId?: string },
  ): { ok: boolean; reason?: string; field?: string; why?: string };
  aiChoice(): { text: string };
  promptTests(): Tests;
  testPrompt(id: string, versionId: string): { ok: boolean };
  format: { date(value: unknown): string };
};
type TestEntry = {
  id: string;
  name: string;
  tested: boolean;
  tests: Array<{ versionId: string; n: number; label: string; score: number; status: string }>;
  running: { versionId: string; n: number; replayed: number; of: number } | null;
  minAgreementPct: number;
  inUse: { versionId: string; label: string };
  trial: { versionId: string; label: string; sharePct: number; endsAt: string } | null;
};
type Tests = {
  prompts: TestEntry[];
  untested: Array<{ id: string; name: string }>;
  window: { days: number; label: string; words: string; range: string };
};
type Settings = Record<string, number | boolean | string[] | Record<string, unknown>> & {
  overridden: string[];
  systemDefault: Record<string, number | boolean>;
};

function loadStore(): Store {
  const storage = new Map<string, string>();
  const window: Record<string, unknown> = { addEventListener: () => {}, location: { search: '' } };
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

type Rule = {
  key: string;
  group: string;
  kind: string;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  effect(value: unknown, all: Record<string, unknown>): string;
};
type Rules = {
  RULES: Rule[];
  GROUPS: Record<string, string>;
  readRule(rule: Rule, raw: unknown): { ok: boolean; value?: unknown; why?: string };
  stateLine(settings: Settings, scope: string): string;
  ruleValue(rule: Rule, value: unknown): string;
  rulesSentence(settings: Settings | null): string;
  rulesBrief(settings: Settings | null): string;
  stateWords(entry: unknown, day?: (value: unknown) => string): string;
  MODEL_COLUMNS: Array<{ key: string; label: string; numeric?: boolean }>;
  modelRows(table: unknown): Array<Record<string, unknown>>;
  modelTotals(table: unknown): { runs: string; tokens: string };
  MODEL_SIZES: number[];
  sinceWords(table: unknown, day?: (value: unknown) => string): string;
  modelWords(choice: unknown, included?: { text: string; models: string[] } | null): string;
  pageOf(
    rows: unknown[],
    page?: number,
    size?: number,
  ): {
    rows: Array<Record<string, unknown>>;
    page: number;
    pages: number;
    size: number;
    total: number;
  };
};
const block = (() => {
  const start = script.indexOf('/* prompts-rules: start */');
  const end = script.indexOf('/* prompts-rules: end */');
  return script.slice(start, end);
})();
const rules = new Script(
  `${block}\n;({ RULES, GROUPS, readRule, stateLine, ruleValue, rulesSentence, rulesBrief, stateWords, MODEL_COLUMNS, modelRows, modelTotals, MODEL_SIZES, pageOf, sinceWords, modelWords })`,
).runInNewContext({}) as Rules;
const rule = (key: string) => rules.RULES.find((item) => item.key === key) as Rule;

const seed = loadStore();
const IDS = ['read', 'rank', 'tailor', 'letter', 'answer', 'check', 'mail', 'reply'];

describe('Prompts page frame (T1, R6-3, R6-6)', () => {
  it('opens with the shared page intro: Settings, its title, one short line, and Take the tour', () => {
    // R10-3: data-page-back, so a link with return= shows Back to <page> in the intro.
    expect(main).toMatch(
      /<section class="page-intro prompts-intro" aria-labelledby="page-title" data-page-back>\s*<div class="page-intro-copy"[^>]*>\s*<p class="eyebrow">Settings<\/p>\s*<h1 id="page-title">The prompts your deputy runs\.<\/h1>\s*<p class="intro-copy">Each prompt’s version, its tests, and how much of its work you kept\.<\/p>\s*<\/div>\s*<div class="page-intro-actions">\s*<button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour<\/button>\s*<\/div>\s*<\/section>/,
    );
    expect(
      words(textOf(main.match(/<p class="intro-copy">([\s\S]*?)<\/p>/)?.[1] ?? '')),
    ).toBeLessThanOrEqual(14);
    expect(main.match(/<h1\b/g)).toHaveLength(1);
    // The Settings tab strip right after the intro, Prompts current.
    expect(main).toMatch(/<\/section>\s*<!-- SettingsTabs: start -->/);
    expect(main).toContain(
      '<li><a class="settings-tab" href="./prompts-preview.html" aria-current="page">Prompts</a></li>',
    );
    // Round 7: the seven tabs, Usage after AI & credits and Activity last (D10, SE1).
    const tabs = main.slice(
      main.indexOf('<!-- SettingsTabs: start -->'),
      main.indexOf('<!-- SettingsTabs: end -->'),
    );
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
    expect(tabs.match(/aria-current="page"/g)).toHaveLength(1);
    // The page's deputy state is test (A1's state: "Checking prompts", working "Testing prompts").
    expect(page).toContain('data-deputy-page="prompts"');
    expect(page).toContain('data-deputy-state="test"');
    expect(page).toContain('<title>JobDeputy · Settings · Prompts</title>');
  });

  it('keeps its own rules prefixed and never restyles the shared intro or the prompt control', () => {
    const selectors = [...style.matchAll(/(^|\n)\s*([^{}@\n][^{}\n]*)\{/g)]
      .map((match) => (match[2] ?? '').trim())
      .filter(
        (selector) =>
          !selector.startsWith(':root') && !selector.startsWith('--') && !selector.startsWith('@'),
      );
    for (const selector of selectors) {
      for (const part of selector.split(',').map((item) => item.trim())) {
        expect(part, part).toMatch(/^(?:html|body|button|a|p|\.prompts-[\w-]+)(?:[\s>:[.]|$)/);
      }
    }
    expect(style).not.toMatch(/\.prompt-control|\.page-intro|\.page-tour|\.settings-tab/);
  });
});

// Round 6 part 2 (N4): the page leads with the stats. Round 7 (SE2, R10-5): then every prompt as
// the shared prompt summary row, each opening in place (Details) to the full view.
describe('Prompts page: the stats lead, then every prompt (N4, SE2, R10-5)', () => {
  const figures = [...main.matchAll(/<(\w+)\b[^>]*\sdata-metric="([^"]+)"[^>]*>([^<]*)</g)].map(
    (match) => ({ key: match[2] ?? '', text: match[3] ?? '' }),
  );
  const items = [
    ...main.matchAll(
      /<li class="prompts-item" id="(\w+)" data-prompt-card="(\w+)">\s*<div class="prompts-item-row">\s*<div class="prompts-item-summary" data-prompt-summary="(\w+)" data-prompt-size="row" data-prompt-open="off" data-prompt-fold="off" data-prompt-heading="3"[^>]*><h3>([^<]+)<\/h3><\/div>\s*<button type="button" class="compact-action prompts-item-toggle" data-prompt-expand="(\w+)" aria-expanded="false" aria-controls="prompts-(\w+)-more"[^>]*>Details<span class="sr-only"> of ([^<]+)<\/span><\/button>\s*<\/div>\s*<section class="prompts-row-more" id="prompts-(\w+)-more" aria-label="([^"]+): versions, tests, models, and rules" hidden>\s*<div class="prompts-part" data-prompt-control="(\w+)" data-prompt-stats="folded" data-prompt-heading="4" data-prompt-note="off" data-prompt-metric="off"><\/div>\s*<div class="prompts-part" data-models-host="(\w+)"><\/div>\s*<div class="prompts-part" data-burn-host="(\w+)"><\/div>\s*<details class="prompts-fold prompts-own" data-own-rules="(\w+)">\s*<summary><span class="prompts-fold-name">This prompt’s rollback rules<span class="prompts-fold-meta" data-own-state="(\w+)"><\/span><\/span><\/summary>\s*<div class="prompts-fold-body"><form class="prompts-rules" data-rules-scope="(\w+)" novalidate><\/form><\/div>\s*<\/details>\s*<\/section>\s*<\/li>/g,
    ),
  ].map((match) => ({
    id: match[1],
    same: [2, 3, 5, 6, 8, 10, 11, 12, 13, 14, 15].map((index) => match[index]),
    names: [match[4], match[7], match[9]],
  }));

  it('opens with the last 30 days’ tests, pass rate, trials, and rollbacks, each once, as the store says', () => {
    expect(main).toMatch(
      /<section class="task-surface prompts-section" id="prompts" aria-labelledby="prompts-list-title">\s*<div class="prompts-head">\s*<p class="section-label">Prompt tests<\/p>\s*<h2 id="prompts-list-title">How your prompts are doing\.<\/h2>\s*<p class="prompts-window" id="prompts-window">Last 30 days<\/p>\s*<\/div>\s*<div\s+class="prompts-summary"\s+id="summary"/,
    );
    // Round 6 part 3: the window is the last 30 days. The summaries' figures (Kept by you and the
    // tokens of each prompt) are app-panels.js's, written as the page starts.
    expect(figures.map((figure) => figure.key)).toEqual([
      'prompts.tests.last30',
      'prompts.testsRunning',
      'prompts.tests.passRateLast30',
      'prompts.tests.passedLast30',
      'prompts.tests.failedLast30',
      'prompts.canaries',
      'prompts.rollbacksLast30',
      'prompts.untested',
    ]);
    for (const figure of figures) expect(figure.text, figure.key).toBe(seed.metricText(figure.key));
    expect(main).not.toMatch(/this month/i);
    expect(seed.promptTests().window).toMatchObject({ label: 'Last 30 days', days: 30 });
    // "N testing now" shows only while a test runs, wherever it was started.
    expect(main).toContain(
      // T7-6: the running line is the Tests stat's second meta line, never drawn over the first.
      '<dd class="stat-meta"><span class="prompts-running" id="prompts-running" hidden><span data-metric="prompts.testsRunning">0</span> testing now</span></dd>',
    );
    expect(script).toContain('if (running.hidden === some) running.hidden = !some;');
    const labels = [...main.matchAll(/<dt class="stat-label">([^<]+)<\/dt>/g)].map((m) => m[1]);
    expect(labels).toEqual(['Tests', 'Pass rate', 'On trial', 'Rollbacks']);
    const metas = [...main.matchAll(/<dd class="stat-meta">([^<]*)</g)].map((m) => m[1]);
    // T2-25: the card says its window once ("Last 30 days" beside its title), not on each stat;
    // T5-20, T3-16: a test that fails "did not pass" here as everywhere (R9-8).
    expect(metas).toEqual(['', '', 'On a share of runs now']);
    expect(main.match(/Last 30 days/g)).toHaveLength(1);
    expect(main).toContain(
      '<span data-metric="prompts.tests.failedLast30">' +
        seed.metricText('prompts.tests.failedLast30') +
        '</span> did not pass</dd>',
    );
    expect(main).not.toMatch(/\d<\/span> failed/);
    // The figures inside the controls and the summaries are theirs to write.
    expect(script).toContain(
      "if (element.closest('.prompt-control, .prompt-summary, [data-prompt-summary]')) continue;",
    );
  });

  it('shows every prompt, in the store’s order, as the shared prompt summary row with Details', () => {
    expect(seed.PROMPT_IDS).toEqual(IDS);
    expect(items.map((item) => item.id)).toEqual(IDS);
    for (const item of items) {
      // The same id in every part: the row, its summary, its Details, its panel, its control,
      // its table and burn hosts, and its own rules.
      expect(item.same, item.id).toEqual(Array(11).fill(item.id));
      expect(item.names, item.id).toEqual(Array(3).fill(seed.prompt(item.id ?? '')?.name));
    }
    // R10-5: one group of summaries (one key for their trends), each row always shown: no prompt
    // waits for a test to be listed, so nothing under the list moves when the figures arrive.
    expect(main).toContain(
      '<ul class="prompts-list" id="prompts-list" data-prompt-summaries aria-label="Your prompts" data-skeleton="rows">',
    );
    // R10-1: held as a skeleton at least as tall as its rows on the usual sample at each width
    // (the large account's store can paint first), so nothing in view moves when they appear.
    expect(style).toMatch(/\.prompts-list \{\s*--skeleton-min: 915px;/);
    for (const [width, height] of [
      [1100, 1420],
      [800, 1925],
      [480, 2576],
      [360, 2896],
    ]) {
      expect(style).toContain(
        `@media (max-width: ${width}px) {\n        .prompts-list {\n          --skeleton-min: ${height}px;`,
      );
    }
    expect(main.match(/data-prompt-summary="/g)).toHaveLength(8);
    expect(main).not.toMatch(/<li class="prompts-item"[^>]*\shidden/);
    // The page draws no trend, key, or prompt view of its own (the summary is the only way).
    expect(script).not.toMatch(
      /scoreTrend\?\.\(|scoreTrend\.key|data-trend-key|data-prompt-view="row"/,
    );
    expect(main).not.toMatch(/data-prompt-view="row"|data-trend-host/);
    // Open in Prompts is off here: this is Prompts (PL contract 2.1).
    expect(main.match(/data-prompt-open="off"/g)).toHaveLength(8);
    // The page's own Details opens a prompt; the summary's phone fold stays in step with it
    // (data-prompt-fold="off" asks PL to leave it out here).
    expect(main.match(/data-prompt-fold="off"/g)).toHaveLength(8);
    expect(script).toContain("const fold = event.target.closest('.prompt-summary-fold');");
    expect(script).toContain('if (opening) openRow(folded.id, { sync: false });');
    expect(script).toContain("host.toggleAttribute('data-prompt-unfolded', open);");
  });

  it('says a prompt’s state in one line: a test running and how far, then in use, then a trial with its end', () => {
    const read = seed.promptTests().prompts.find((entry) => entry.id === 'read');
    // A date the page writes keeps together (no-break spaces inside it).
    expect(rules.stateWords(read, seed.format.date)).toBe(
      'System default in use. Version 2 on trial until Sun,\u00a0Oct\u00a04.',
    );
    // The trial's share is the pill's (one state per row, P-7), so the line leaves it out.
    expect(rules.stateWords(read, seed.format.date)).not.toContain('20%');
    expect(
      rules.stateWords({
        inUse: { label: 'Version 3' },
        trial: null,
        running: { versionId: 'rank-v4', n: 4, replayed: 23, of: 40 },
      }),
    ).toBe('Testing version 4: 23 of 40 decisions replayed. Version 3 in use.');
    expect(
      rules.stateWords({
        inUse: null,
        running: { versionId: 'rank-v4', n: 4, replayed: 40, of: 40 },
      }),
    ).toBe(
      'Testing version 4: all 40 decisions replayed, checking the guardrails. System default in use.',
    );
    expect(rules.stateWords({ inUse: null, trial: null, running: null })).toBe(
      'System default in use.',
    );
    // The line leads the open prompt, over its control.
    expect(script).toContain("line.className = 'prompts-part-meta prompts-state-line';");
    expect(script).toContain('panel.prepend(line);');
  });

  // S4: per version and per model, runs, Kept by you, Test score, tokens per run, tokens in
  // total, and seconds per run, from the store's promptVersionModels(id).
  it('builds the version x model table in words, every empty value a word (S4, R9-4)', () => {
    expect(rules.MODEL_COLUMNS.map((column) => column.label)).toEqual([
      'Version',
      'Model',
      'Runs',
      'Kept by you',
      'Test score',
      'Tokens per run',
      'Tokens in total',
      'Seconds per run',
    ]);
    const table = {
      rows: [
        {
          versionId: 'rank-v3',
          label: 'Version 3',
          model: 'gpt-5-mini',
          modelLabel: 'gpt-5-mini',
          keyLabel: 'Your OpenAI key',
          runs: 12,
          keptPct: 88,
          testScore: 93,
          tokensPerRun: 2210.4,
          tokens: 26525,
          secondsPerRun: 2.36,
        },
        {
          versionId: 'rank-v3',
          label: 'Version 3',
          model: 'ministral-3-14b',
          modelLabel: 'Ministral 3 14B',
          keyLabel: 'Platform credits',
          runs: 1,
          keptPct: null,
          testScore: 93,
          tokensPerRun: 1890,
          tokens: 1890,
          secondsPerRun: 2.1,
        },
        {
          versionId: 'rank-v1',
          label: 'Version 1',
          model: 'gpt-5-mini',
          modelLabel: 'gpt-5-mini',
          keyLabel: 'Your OpenAI key',
          runs: 0,
          keptPct: null,
          testScore: 78,
          tokensPerRun: 0,
          tokens: 0,
          secondsPerRun: 0,
        },
      ],
      totals: { runs: 13, tokens: 28415 },
    };
    // T7-6: Kept by you says its count ("88% of 12 runs", the runs you decided on, R9-5); no
    // percentage without runs.
    (table.rows[0] as Record<string, unknown>).decided = 12;
    expect(rules.modelRows(table)).toEqual([
      {
        versionId: 'rank-v3',
        repeat: false,
        version: 'Version 3',
        model: 'gpt-5-mini',
        key: 'Your OpenAI key',
        runs: '12',
        kept: '88% of 12 runs',
        test: '93%',
        perRun: '2,210',
        tokens: '26,525',
        seconds: '2.4 s',
      },
      {
        versionId: 'rank-v3',
        repeat: true,
        version: 'Version 3',
        model: 'Ministral 3 14B',
        key: 'Platform credits',
        runs: '1',
        kept: 'None decided yet',
        test: '93%',
        perRun: '1,890',
        tokens: '1,890',
        seconds: '2.1 s',
      },
      {
        versionId: 'rank-v1',
        repeat: false,
        version: 'Version 1',
        model: 'gpt-5-mini',
        key: 'Your OpenAI key',
        runs: '0',
        kept: 'No runs yet',
        test: '78%',
        perRun: 'None yet',
        tokens: '0',
        seconds: 'None yet',
      },
    ]);
    expect(rules.modelTotals(table)).toEqual({ runs: '13', tokens: '28,415' });
    // T7-6: every version is listed, the one in use too before its first run, in the store's
    // order; the table says its window once, from the store's first run.
    const listed = rules.modelRows({
      rows: [
        {
          versionId: 'system',
          label: 'System default',
          modelLabel: 'gpt-5',
          runs: 1,
          decided: 1,
          keptPct: 100,
        },
      ],
      versions: [
        { versionId: 'answer-v1', label: 'Version 1', runs: 0, testScore: 88 },
        { versionId: 'system', label: 'System default', runs: 1 },
      ],
    });
    expect(listed.map((row) => [row.version, row.model, row.runs, row.kept, row.test])).toEqual([
      ['Version 1', 'Not run yet', '0', 'No runs yet', '88%'],
      ['System default', 'gpt-5', '1', '100% of 1 run', 'Not tested'],
    ]);
    expect(rules.sinceWords({ since: '2026-07-04' }, () => 'Sat, Jul 4')).toBe(
      'Every run since Sat, Jul 4, each on the model it ran on.',
    );
    // Against the store: every version of every prompt has a row.
    const versionModels = (
      seed as unknown as {
        promptVersionModels?: (id: string) => { versions: Array<{ versionId: string }> };
      }
    ).promptVersionModels;
    if (typeof versionModels === 'function') {
      for (const id of IDS) {
        const data = versionModels(id);
        const shown = new Set(rules.modelRows(data).map((row) => row.versionId));
        for (const version of data.versions ?? [])
          expect(shown.has(version.versionId), `${id} ${version.versionId}`).toBe(true);
      }
    }
    expect(rules.modelRows(null)).toEqual([]);
    expect(rules.modelRows({ rows: [{ versionId: 'x', testScore: null }] })[0]?.test).toBe(
      'Not tested',
    );
    // The page reads it from the store, draws it as the shared data table (stacked rows on a
    // phone, each cell named), and draws it again only when its figures change.
    expect(script).toContain("const table = call('promptVersionModels', id);");
    expect(script).toContain('<table class="data-table prompts-models-table" role="table"');
    expect(script).toContain('data-label="$' + '{esc(column.label)}"');
    expect(script).toContain('if (host.dataset.signature !== markup) {');
    // R6-4 and R10-6: past 12 rows (the large account's 44) it pages with the shared pagination,
    // top and bottom, 12, 24, or 48 a page, and each page's first row names its version.
    expect(rules.MODEL_SIZES).toEqual([12, 24, 48]);
    const many = Array.from({ length: 30 }, (_, index) => ({
      versionId: `v${Math.floor(index / 4)}`,
      repeat: index % 4 > 0,
    }));
    const second = rules.pageOf(many, 2);
    expect([second.page, second.pages, second.size, second.total, second.rows.length]).toEqual([
      2, 3, 12, 30, 12,
    ]);
    expect(second.rows[0]?.repeat).toBe(false);
    expect(rules.pageOf(many, 9).page).toBe(3);
    expect(rules.pageOf(many, 1, 48).pages).toBe(1);
    expect(rules.pageOf(many, 1, 7).size).toBe(12);
    expect(script).toContain('const paged = shown.total > MODEL_SIZES[0];');
    expect(script).toContain('sizes: MODEL_SIZES,');
    expect(script).toContain('top,');
    // T6-8, T3-18: the page and its size in the address, as on the lists.
    expect(script).toContain("param: 'vpage',");
    expect(script).toContain("sizeParam: 'vsize',");
    // Against the real store, once it has the table: every row in words, totals that add up.
    const real = (seed as unknown as { promptVersionModels?: (id: string) => unknown })
      .promptVersionModels;
    if (typeof real === 'function') {
      for (const id of IDS) {
        const data = real(id) as {
          rows: Array<{ runs: number; tokens: number; versionId: string }>;
          versions?: Array<{ versionId: string }>;
          totals: { runs: number; tokens: number };
        };
        const rows = rules.modelRows(data);
        // Every row of the store, plus one for each version that has none yet.
        const unrun = (data.versions ?? []).filter(
          (version) => !data.rows.some((row) => row.versionId === version.versionId),
        ).length;
        expect(rows.length, id).toBe(data.rows.length + unrun);
        expect(
          data.rows.reduce((sum, row) => sum + row.runs, 0),
          id,
        ).toBe(data.totals.runs);
        for (const row of rows) {
          for (const value of Object.values(row)) expect(String(value)).not.toMatch(/[–—]/);
        }
      }
    }
  });

  it('draws each prompt’s tokens over time with the shared usage chart, and the way to Usage', () => {
    expect(script).toContain(
      "const usage = call('usage', { range: BURN_RANGE, group: 'prompt', filter: { task: [id] } });",
    );
    // The same tokens as the prompt's burn in the store, by version.
    const store = seed as unknown as {
      usage?: (options: unknown) => { totals: { tokens: number }; groups: Array<{ id: string }> };
      promptBurn?: (id: string, options: unknown) => { totals: { tokens: number } };
    };
    if (store.usage && store.promptBurn) {
      for (const id of IDS) {
        const usage = store.usage({ range: '30d', group: 'prompt', filter: { task: [id] } });
        expect(usage.totals.tokens, id).toBe(store.promptBurn(id, { range: '30d' }).totals.tokens);
        for (const group of usage.groups)
          expect(group.id, id).toMatch(new RegExp(`^(?:${id}:|other$)`));
      }
    }
    expect(script).toContain("const BURN_RANGE = '30d';");
    expect(script).toContain("components.usageChart($('[data-burn-chart]', host), {");
    expect(script).toContain("otherLabel: 'Other versions',");
    // R10-3: the link to Usage carries return= (the shared place helper adds it on press).
    expect(script).toContain(
      'href="./usage-preview.html?task=$' +
        '{esc(id)}&amp;group=prompt&amp;range=$' +
        '{BURN_RANGE}" data-return-link data-focus-key="prompts-burn-usage-$' +
        '{esc(id)}">See every range in Usage</a>',
    );
  });

  // The owner asked to see the test as it runs: a test started anywhere (Searches' summary, another
  // tab, or store.testPrompt) shows here on load and when it starts.
  it('shows a test running wherever it was started: the state line counts, the stats say it, its prompt opens', () => {
    const store = loadStore();
    expect(store.testPrompt('read', 'read-v3').ok).toBe(true);
    const read = store.promptTests().prompts.find((entry) => entry.id === 'read');
    expect(read?.running).toMatchObject({ versionId: 'read-v3', n: 3, of: 40 });
    expect(rules.stateWords(read, store.format.date)).toMatch(
      /^Testing version 3: \d+ of 40 decisions replayed\. System default in use\. Version 2 on trial until Sun,\u00a0Oct\u00a04\.$/,
    );
    expect(store.metricText('prompts.testsRunning')).toBe('1');
    // The lines and the count follow the store once a second (onWork) and on every change.
    expect(script).toContain('store.onWork?.(() => fillStates());');
    // T3-19: a work tick's progress redraws only the state lines; other changes the page.
    expect(script).toContain('if (change?.progress) fillStates();');
    // Its prompt opens with the live view (the control's test), once per test, on load and when
    // the store says it started.
    expect(script).toContain(
      'shownRunning.add(`$' + '{running.id}|$' + '{running.running.versionId}`);',
    );
    expect(script).toContain('openRow(running.id);');
    expect(script.indexOf('openRunning();')).toBeGreaterThan(
      script.indexOf('const render = () => {'),
    );
  });

  it('names the prompts never tested once more under the list, each linking to its row', () => {
    const untested = main.slice(main.indexOf('id="prompts-untested"'));
    expect(untested).toMatch(
      /^id="prompts-untested" hidden>\s*<p class="prompts-untested-title"><span data-metric="prompts.untested">\d+<\/span> not tested yet, on the system default<\/p>/,
    );
    const links = [
      ...untested.matchAll(
        /<li data-untested="(\w+)" hidden><a class="compact-action" href="#(\w+)">([^<]+)<span class="sr-only">: open it, read it, and test a version<\/span><\/a><\/li>/g,
      ),
    ].map((match) => [match[1], match[2], match[3]]);
    expect(links).toEqual(IDS.map((id) => [id, id, seed.prompt(id)?.name]));
    // An untested prompt's link shows; the line shows while any prompt is untested.
    expect(script).toContain('if (button && button.hidden !== tested) button.hidden = tested;');
    expect(script).toContain('if (line.hidden === some) line.hidden = !some;');
  });

  it('opens one prompt at a time in place: Details, #<id>, ?prompt=<id>&return=, or any open on this page', () => {
    expect(script).toContain('if (openId && openId !== id) setRow(openId, false);');
    expect(script).toContain("toggleOf(id)?.setAttribute('aria-expanded', String(open));");
    expect(script).toContain("event.target.closest('[data-prompt-expand]')");
    expect(script).toContain('if (panel.hidden === open) panel.hidden = !open;');
    expect(script).toContain("window.addEventListener('hashchange', followHash);");
    // PL contract 2.2: on this page a plain open expands the row (preventDefault); Edit as a new
    // version, Compare, and See the prompt from inside a control keep the drawer, this page's
    // editor.
    expect(script).toContain("document.addEventListener('jobdeputy:prompt-open', (event) => {");
    expect(script).toContain('if (detail.edit || detail.compare) return;');
    expect(script).toContain(
      "if (detail.opener?.closest?.('.prompt-control, .prompt-drawer')) return;",
    );
    expect(script).toContain('event.preventDefault();');
    // R10-3: ?prompt= (aliases resolved by the shared panels) opens and reveals that prompt, its
    // Details focused; &edit= and &compare=1 then open the drawer on it.
    expect(script).toContain('panels().promptFor(asked)');
    expect(script).toContain('openRow(askedId, { reveal: true, focus: true });');
    expect(script).toContain(
      'if (edit) panels()?.openPrompt?.(askedId, { edit, opener: toggleOf(askedId) });',
    );
    // Coming back through Back to Prompts opens the prompt you left open.
    expect(script).toContain('components?.place?.remember?.(() => ({ open: openId }));');
    expect(script).toContain('if (saved?.open && !askedId) openRow(saved.open);');
    // T7-21: ?version=<id>#<task> still chooses that version in its menu.
    expect(script).toContain("let namedVersion = parameters.get('version') ?? '';");
    // A test started from a control opens its prompt, so it can be watched.
    expect(script).toContain(
      "if (event.detail?.action === 'test' && event.detail.ok) openRow(event.detail.id);",
    );
    // Nothing opens by itself: the stats lead, the rest waits for a click.
    const panels = [...main.matchAll(/<section class="prompts-row-more"[^>]*>/g)].map((m) => m[0]);
    expect(panels).toHaveLength(8);
    for (const tag of panels) expect(tag).toMatch(/\shidden>$/);
    // R10-1: the page shows itself in one frame once the shared panels drew it.
    expect(script).toContain('components?.boot?.ready?.();');
  });

  // T5-18, T6-11: say what is true, from the store: new work runs on the one AI setting, the
  // email reading a Gmail scan's run includes runs on its own model, and each row names what its
  // prompt ran on in the last 30 days (Read application emails: Ministral 3 14B 100%).
  it('says what runs the prompts, from the store: the AI setting, and what a run includes', () => {
    expect(main).toContain(
      '<p class="prompts-model" id="prompts-model" data-tour-step="5" data-tour-title="They all run on one setting." data-tour-text="I run new work on the AI you chose in AI &amp; credits. Usage shows what each one used, by key, model, and day.">New work runs on your one AI setting. <a class="chart-action" href="./ai-preview.html#ai" data-return-link data-focus-key="prompts-ai-setting">Change it in AI &amp; credits</a></p>',
    );
    const store = seed as unknown as {
      usage: (options: unknown) => {
        totals: { included: { text: string } };
        groups: Array<{ label: string; calls: number; other?: boolean }>;
      };
    };
    const run = store.usage({ range: '30d', group: 'model', filter: { key: ['run'] } });
    expect(
      rules.modelWords(seed.aiChoice(), {
        text: run.totals.included.text,
        models: run.groups
          .filter((group) => !group.other && group.calls > 0)
          .map((group) => group.label),
      }),
    ).toBe(
      'New work runs on your AI setting, gpt-5-mini on your OpenAI key. Reading your job email is included in each Gmail scan’s run, on Ministral 3 14B. Each prompt says what it ran on in the last 30 days.',
    );
    expect(rules.modelWords({ source: 'none', text: '' })).toBe(
      'No prompt runs while Deputy Assist is off.',
    );
    expect(rules.modelWords({ source: 'openai', text: 'gpt-5 on your OpenAI key' })).toBe(
      'New work runs on your AI setting, gpt-5 on your OpenAI key. Each prompt says what it ran on in the last 30 days.',
    );
    expect(script).toContain(
      "const run = call('usage', { range: '30d', group: 'model', filter: { key: ['run'] } });",
    );
    expect(main).not.toMatch(/Every prompt runs on/);
  });

  it('marks its sample data once for the stats, and once in How testing works', () => {
    expect(main.match(/class="sample-note[^"]*"/g)).toHaveLength(2);
    expect(main).toContain(
      '<p class="sample-note prompts-sample" id="prompts-sample">Sample data · real figures start when runs are recorded per version</p>',
    );
    expect(main).toContain(
      '<p class="sample-note">Sample: tests replay your decisions in this prototype; nothing is sent.</p>',
    );
    // The open prompts show no second sample line (data-prompt-note="off").
    expect(main.match(/data-prompt-note="off"/g)).toHaveLength(8);
  });
});

// Everything else is one click away: the definitions, your account's rollback rules (P-7), and
// How testing works fold under More about your prompts; a prompt's own rules, the system prompt,
// and every version's words open from its Details.
describe('Prompts page: more about your prompts, behind disclosures (N4)', () => {
  const more = main.slice(main.indexOf('<section class="task-surface prompts-more"'));

  it('folds the definitions, the rollback rules, and How testing works, each closed', () => {
    const summaries = [
      ...more.matchAll(/<details\b[^>]*\sid="([\w-]+)"[^>]*>\s*<summary>([\s\S]*?)<\/summary>/g),
    ].map((match) => [match[1], textOf(match[2] ?? '')]);
    expect(summaries).toEqual([
      ['what-these-mean', 'What Kept by you and Test score mean'],
      ['rollout', 'Rollback rules'],
      ['how-testing-works', 'How testing works'],
    ]);
    expect(more).not.toMatch(/<details\b[^>]*\sopen/);
    // UAT-RM RM-10: each summary's words wrap in their own box, so the chevron stays on the
    // first line at every width.
    expect(more.match(/<summary><span class="prompts-fold-name">/g)).toHaveLength(3);
    expect(style).toMatch(/\.prompts-fold > summary \{[^}]*display: flex;[^}]*\}/);
    expect(style.match(/\.prompts-fold > summary \{[^}]*\}/)?.[0]).not.toContain('flex-wrap');
    expect(style).toMatch(/\.prompts-fold-name \{[^}]*flex-wrap: wrap;/);
    expect(textOf(more)).toContain(
      'The system prompt, every version’s words, and the editor open from each prompt’s Details: See the prompt, or Edit as a new version.',
    );
  });

  it('defines Kept by you and Test score once, in the control’s own words (P-14)', () => {
    const terms = [...more.matchAll(/<dt>([^<]+)<\/dt><dd>([^<]+)<\/dd>/g)].map((match) => [
      match[1],
      match[2],
    ]);
    expect(terms).toEqual([
      [
        'Kept by you',
        'Of what this prompt produced in real use, the share you kept. Each prompt says what kept means in its drawer.',
      ],
      [
        'Test score',
        'A version replayed on your last 40 decisions: how often it agreed with what you decided, and the guardrail checks.',
      ],
    ]);
    const panels = sourceFor('app-panels.js');
    expect(panels).toContain(
      "      name: 'Kept by you',\n      meaning: 'Of what this prompt produced in real use, the share you kept.',",
    );
    expect(panels).toContain(
      'A version replayed on your last $' +
        '{count(of)} decisions: how often it agreed with what you decided, and the guardrail checks.',
    );
    // The old name is gone from the page (P-14).
    expect(page).not.toMatch(/Agreement with you/);
  });
});

describe('Prompts page: rollback rules (S1, account defaults and per-prompt overrides)', () => {
  it('has six rules in two groups, each with the store’s range', () => {
    expect(
      rules.RULES.map((item) => [item.key, item.group, item.kind, item.min, item.max]),
    ).toEqual([
      ['canarySharePct', 'trial', 'number', 0, 50],
      ['canaryDays', 'trial', 'number', 1, 14],
      ['autoPromote', 'trial', 'toggle', undefined, undefined],
      ['minAgreementPct', 'back', 'number', 50, 99],
      ['maxDropPoints', 'back', 'number', 1, 20],
      ['autoRollback', 'back', 'toggle', undefined, undefined],
    ]);
    expect(rules.GROUPS).toEqual({ trial: 'Trying a new version', back: 'Rolling back' });
    // The account defaults the brief sets, as the store has them.
    expect(seed.rolloutSettings()).toMatchObject({
      canarySharePct: 20,
      canaryDays: 3,
      minAgreementPct: 80,
      maxDropPoints: 5,
      autoRollback: true,
      autoPromote: true,
      overridden: [],
    });
  });

  it('says the effect of each value in one line', () => {
    const defaults = seed.rolloutSettings() as unknown as Record<string, unknown>;
    const effects = rules.RULES.map((item) => item.effect(defaults[item.key], defaults));
    expect(effects).toEqual([
      'A version that passes runs on 20% of runs first; the version in use runs the rest.',
      'Its trial lasts 3 days, then the rules below decide.',
      'On: your deputy moves every run to it when the trial ends within the rules.',
      'In its trial, a version that keeps less than 80% of what it produced rolls back.',
      // R9-9: one rule said one way (more than 5 fails, exactly 5 passes).
      'Even above 80%, more than 5 points below the version in use fails: in a test by Test score, in a trial by Kept by you. Exactly 5 points below passes.',
      'On: the version before comes back at once, and you’re told.',
    ]);
    expect(rule('canarySharePct').effect(0, defaults)).toBe(
      'A version that passes goes into use on every run at once.',
    );
    expect(rule('canaryDays').effect(3, { ...defaults, canarySharePct: 0 })).toBe(
      'Not used while the share is 0.',
    );
    expect(rule('autoRollback').effect(false, defaults)).toBe(
      'Off: your deputy tells you and waits for you to choose.',
    );
    expect(rule('autoPromote').effect(false, defaults)).toBe(
      'Off: it waits on its trial until you choose Use this version.',
    );
    for (const effect of effects) expect(effect).not.toMatch(/[–—]/);
  });

  it('checks each number as the store does, before anything is saved', () => {
    expect(rules.readRule(rule('canarySharePct'), '10')).toEqual({ ok: true, value: 10 });
    expect(rules.readRule(rule('canarySharePct'), '51')).toEqual({
      ok: false,
      why: 'Choose a whole number from 0 to 50.',
    });
    expect(rules.readRule(rule('minAgreementPct'), '80.5').ok).toBe(false);
    expect(rules.readRule(rule('maxDropPoints'), '').ok).toBe(false);
    expect(rules.readRule(rule('autoRollback'), false)).toEqual({ ok: true, value: false });
    // The store refuses the same values with the same words.
    const store = loadStore();
    expect(store.setRolloutSettings({ canarySharePct: 51 })).toMatchObject({
      ok: false,
      reason: 'invalid',
      field: 'canarySharePct',
      why: 'Choose a whole number from 0 to 50.',
    });
  });

  it('says what changed from the defaults, and what a prompt keeps as its own', () => {
    const store = loadStore();
    expect(rules.stateLine(store.rolloutSettings(), 'account')).toBe('These are the defaults.');
    store.setRolloutSettings({ canarySharePct: 10, autoRollback: false });
    expect(rules.stateLine(store.rolloutSettings(), 'account')).toBe(
      'Changed from the defaults: the share of runs (10%), rolling back by itself (off).',
    );
    expect(rules.stateLine(store.rolloutSettings('rank'), 'rank')).toBe(
      'This prompt follows your account’s rules.',
    );
    store.setRolloutSettings({ minAgreementPct: 85 }, { promptId: 'rank' });
    expect(store.rolloutSettings('rank')).toMatchObject({
      minAgreementPct: 85,
      overridden: ['minAgreementPct'],
    });
    expect(rules.stateLine(store.rolloutSettings('rank'), 'rank')).toBe(
      'This prompt’s own rules: the Kept by you minimum (85%). The rest follow your account’s.',
    );
    // Use your account's rules clears the override.
    store.setRolloutSettings(null, { promptId: 'rank' });
    expect(store.rolloutSettings('rank').overridden).toEqual([]);
  });

  it('says the account’s rules in a few words while closed, and in one plain sentence when open', () => {
    const store = loadStore();
    expect(rules.rulesBrief(store.rolloutSettings())).toBe(
      '20% of runs for 3 days; below 80% or more than 5 points down rolls back',
    );
    expect(rules.rulesSentence(store.rolloutSettings())).toBe(
      'A version that passes its test runs on 20% of runs for 3 days first, then on every run; it rolls back by itself if Kept by you falls below 80% or more than 5 points below the version in use.',
    );
    store.setRolloutSettings({ canarySharePct: 0, autoRollback: false });
    expect(rules.rulesBrief(store.rolloutSettings())).toBe(
      'straight into use; below 80% or more than 5 points down asks you',
    );
    expect(rules.rulesSentence(store.rolloutSettings())).toBe(
      'A version that passes its test goes into use at once; below 80% or more than 5 points down, you’re told and choose.',
    );
    expect(main).toContain(
      '<summary><span class="prompts-fold-name">Rollback rules<span class="prompts-fold-meta" id="prompts-rules-now"></span></span></summary>',
    );
    // A link to #rollout (a result's Rollback rules, the drawer's Change the rules) opens it.
    expect(script).toContain("if (window.location.hash === '#rollout') $('#rollout').open = true;");
  });

  // SE2: a prompt's own rules open with the prompt (its Details), one form a prompt; your
  // account's stay in one place, under More about your prompts.
  it('keeps your account’s rules in one fold, and each prompt’s own rules in its Details', () => {
    const rollout = main.slice(
      main.indexOf('id="rollout"'),
      main.indexOf('id="how-testing-works"'),
    );
    expect(rollout).toContain(
      '<form class="prompts-rules" id="prompts-rules" data-rules-scope="account" novalidate></form>',
    );
    expect(rollout).toContain(
      '<p class="field-help prompts-own-note" id="prompts-own-note">A prompt can keep its own rules: open its Details, then This prompt’s rollback rules. Only what you change there differs from these.</p>',
    );
    expect(rollout).not.toMatch(/<select|data-rules-scope="(?!account)/);
    // One own form in each prompt's Details, its scope the prompt, in a closed fold that says
    // whether it has rules of its own.
    const own = [
      ...main.matchAll(
        /<details class="prompts-fold prompts-own" data-own-rules="(\w+)">[\s\S]*?data-rules-scope="(\w+)"/g,
      ),
    ].map((match) => [match[1], match[2]]);
    expect(own).toEqual(IDS.map((id) => [id, id]));
    expect(main.match(/<form class="prompts-rules"/g)).toHaveLength(9);
    expect(script).toContain(
      'const words = own ? `$' +
        "{plural(own, 'rule', 'rules')} of its own` : 'Your account’s rules';",
    );
    // A prompt's form is drawn when its prompt opens. T3-2: a form with unsaved edits is never
    // drawn again (the large account's store changes every few seconds); a clean one only when
    // its settings change; Save, Reset, and Use your account's rules draw it fresh.
    expect(script).toContain('const form = $(`form[data-rules-scope="$' + '{id}"]`, panel);');
    expect(script).toContain('if (form) drawForm(form);');
    expect(script).toContain("if (!force && form.dataset.dirty === 'true') return;");
    expect(script).toContain('if (!force && form.dataset.signature === signature) return;');
    expect(script).toContain("form.dataset.dirty = 'true';");
    expect(script).toContain('drawForm(form, { force: true });');
  });

  it('builds the forms with Save, Reset to the defaults, and Use your account’s rules, saving through the store', () => {
    expect(main).toContain(
      '<form class="prompts-rules" id="prompts-rules" data-rules-scope="account" novalidate></form>',
    );
    expect(script).toContain('Reset to the defaults');
    expect(script).toContain('Use your account’s rules');
    expect(script).toContain("call('setRolloutSettings', patch)");
    expect(script).toContain("call('setRolloutSettings', null, { promptId: scope })");
    expect(script).toContain('Save this prompt’s rules');
    // Field feedback: the reason in words beside the field, aria-invalid, and the focus moved.
    expect(script).toContain("input.setAttribute('aria-invalid', 'true');");
    expect(script).toContain('first.focus();');
    // A prompt keeps as its own only what differs from your account's rules.
    expect(script).toContain('.filter(([key, value]) => account[key] !== value)');
    // It never writes storage itself.
    expect(script).not.toMatch(/localStorage/);
  });
});

describe('Prompts page: How testing works', () => {
  it('says the four steps and how you are told, in plain words', () => {
    const how = main.slice(main.indexOf('id="how-testing-works"'));
    const steps = [
      ...how.matchAll(
        /<li class="prompts-step">[\s\S]*?<strong>([^<]+)<\/strong>([^<]+)<\/span><\/li>/g,
      ),
    ].map((match) => `${match[1]}${match[2]}`.trim());
    expect(steps).toEqual([
      'You save a version. It’s a draft: nothing runs it yet.',
      // R9-8 and R9-9: a version that fails its test never runs, so nothing rolls back.
      'Your deputy tests it. It replays your last 40 decisions and runs the guardrail checks. That’s the Test score. It doesn’t pass if the Test score is below your minimum, or more than the points you allow below the Test score of the version in use; then it never runs, so nothing rolls back.',
      'It passes, then it’s tried. It runs on a share of runs for a few days while Kept by you is watched.',
      'It goes into use, or it rolls back. If Kept by you falls short of your rules in its trial, it rolls back and the version before is used again.',
    ]);
    expect(textOf(how)).toContain(
      'You’re told each time: a notice on the page you’re on, a line in your deputy’s Activity, and a To-do when a test doesn’t pass or a version rolls back.',
    );
  });
});

describe('Prompts page: the deputy’s tour (R6-2)', () => {
  const steps = [
    ...main.matchAll(
      /<(\w+)\b[^>]*\sdata-tour-step="(\d+)"[^>]*\sdata-tour-title="([^"]+)"[^>]*\sdata-tour-text="([^"]+)"/g,
    ),
  ].map((match) => ({ step: Number(match[2]), title: match[3] ?? '', text: match[4] ?? '' }));

  // Round 7 (SE2): the third step is the first prompt's summary, the fourth its Details, and the
  // fifth the one AI setting they all run on (every prompt has history now, so the untested
  // line is rarely there to point at).
  it('walks through the prompts, the stats, a summary, its Details, the setting, and the rules', () => {
    expect(steps.map((item) => [item.step, item.title])).toEqual([
      [1, 'I run these prompts for you.'],
      [2, 'Here is how they’re doing.'],
      [3, 'This is each version’s test.'],
      [4, 'Open one to see it all.'],
      [5, 'They all run on one setting.'],
      [6, 'You decide when I roll back.'],
    ]);
    for (const item of steps) {
      expect(words(item.title), item.title).toBeLessThanOrEqual(6);
      expect(words(item.text), item.title).toBeLessThanOrEqual(40);
      expect(item.text, item.title).toMatch(/\b(?:I|I’m|my|me)\b/);
      expect(`${item.title} ${item.text}`).not.toMatch(/[–—]/);
    }
    // The steps follow the page's order.
    const at = steps.map((item) => main.indexOf(`data-tour-step="${item.step}"`));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(main).not.toMatch(/data-tour-step="\d+"[^>]*\shidden/);
  });
});

describe('Prompts page: words', () => {
  it('writes no dashes and never says keep rate or Agreement with you', () => {
    expect(textOf(main)).not.toMatch(/[–—]/);
    expect(script).not.toMatch(/'[^'\n]*[–—][^'\n]*'|`[^`\n]*[–—][^`\n]*`/);
    expect(page).not.toMatch(/keep rate|agreement with you/i);
  });
});
