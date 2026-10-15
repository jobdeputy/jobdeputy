import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Page guarantees for Job matches (brand/jobs-preview.html; round 3 brief 4.4, owner findings 3,
// 3b, 19, 25, and 30): the deputy's ranked inbox of every role its searches found, between
// Searches (where it looks) and Applications (what you chose to pursue). Round 3 reads every role
// from the sample world (JobDeputyStore.catalog()), adds the All view, counts every view from the
// store's metrics so All = New + In Applications + Not for me, names each fit in the Dashboard's
// colours and words, checks keywords with the readiness rule, opens the rank prompt, marks the
// roles a finished search adds as New, reacts to each decision, and carries a tour. The rendered
// flows are checked in headless Chrome.

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');
const source = sourceFor('jobs-preview.html');
const gallery = sourceFor('components-preview.html');
const storeSource = sourceFor('sample-store.js');
const main = source.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? '';
const style = source.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
const script =
  [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '').at(-1) ?? '';

// Page-script fragments are written with #{ for the script's own template placeholders, so the
// expectations stay plain strings.
const code = (fragment: string): string => fragment.replaceAll('#{', `$${'{'}`);

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

function words(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

// One top-level declaration of the page script (eight spaces in), evaluated on its own: the text
// from `const <name> = ` up to the first semicolon that ends a whole expression.
function constant<T>(name: string, context: Record<string, unknown> = {}): T {
  const start = script.indexOf(`\n        const ${name} = `);
  if (start < 0) throw new Error(`${name} not found in the Job matches script`);
  const lines = script.slice(start + `\n        const ${name} = `.length).split('\n');
  for (let count = 1; count <= lines.length; count += 1) {
    const text = lines.slice(0, count).join('\n');
    if (!text.trimEnd().endsWith(';')) continue;
    const literal = text.trimEnd().slice(0, -1);
    try {
      new Script(`(${literal})`);
    } catch {
      continue;
    }
    return runInNewContext(`(${literal})`, context) as T;
  }
  throw new Error(`${name} has no complete declaration`);
}

type Fit = 'strong' | 'good' | 'stretch';
type View = 'all' | 'new' | 'tracked' | 'dismissed';
type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  workplace: string;
  workplaceLabel: string;
  posted: string;
  firstSeen: string;
  foundAt: string;
  source: string;
  sourceName: string;
  fit: Fit;
  score: number;
  closed: string | null;
  role: [string, string];
  place: [string, string];
  keywords: string[];
  found: string[];
  missing: string[];
  view: 'new' | 'tracked' | 'dismissed';
  applicationId: string | null;
  feedback: { value: string; reasons: string[] } | null;
  fresh: boolean;
  runId: string | null;
};
type Filters = { fit: string; source: string; workplace: string; query: string; run?: string };
type Model = {
  inView(job: Job, view: View, pinned?: Map<string, string> | null): boolean;
  passes(job: Job, filters: Partial<Filters>): boolean;
  shown(
    jobs: Job[],
    view: View,
    filters: Partial<Filters>,
    options?: {
      sort?: 'fit' | 'newest';
      pinned?: Map<string, string> | null;
      first?: Set<string> | null;
    },
  ): Job[];
  count(jobs: Job[], view: View, filters: Partial<Filters>): number;
  countKey(view: View, filters: Partial<Filters>): string | null;
  marked(rows: Job[]): { fresh: Job[]; earlier: number; run: string | null };
  keywords(job: Job): Array<{ word: string; onResume: boolean }>;
  pageSize(chosen?: unknown): number;
  sizes: number[];
  pageCount(total: number, size: number): number;
  clampPage(page: unknown, total: number, size: number): number;
  pageOf(index: number, size: number): number;
  onPage<T>(rows: T[], page: number, size: number): T[];
  sourceSet(value: unknown): Set<string>;
};
type Application = { id: string; jobId: string | null; stage: string; fit: string | null };
type Store = {
  FITS: Array<{ id: Fit; label: string; tone: string; meaning: string }>;
  VIEWS: Array<{ id: View; label: string }>;
  STAGES: Array<{ id: string; label: string }>;
  get(): {
    applications: Application[];
    jobs: Record<string, string>;
    jobFeedback: Record<string, { value: string; reasons: string[] }>;
    documents: {
      library: Array<{ id: string; keywords?: string[] }>;
      defaults: { resume: string };
    };
  };
  catalog(): {
    jobs: Job[];
    sources: Array<{ id: string; name: string; status: string; state: string }>;
    deletedSources: Array<{ id: string; name: string; found: number }>;
  };
  metric(key: string): number | string | null;
  metricText(key: string): string;
  keywordStats(): {
    keywords: Array<{ keyword: string; roles: number; onResume: boolean }>;
    basedOn: number;
  };
  subscribe(listener: (state: unknown, change: { type: string; stage?: string }) => void): void;
  addApplication(entry: Record<string, unknown>): Application | null;
  setJob(id: string, status: string | null): void;
  update(change: Record<string, unknown>, mutate: (next: Record<string, unknown>) => void): void;
  retryRun(sourceId: string): { ok: boolean };
  run(id: string): { id: string; sourceId: string; kept: number; jobIds: string[] } | null;
  stageCounts(): Record<string, number>;
  today(): string;
};

// The shared sample store in a sandbox with its own storage and a clock the test moves, so the
// live Amazon Jobs run (about 100 seconds) can finish.
type Clock = { now: number };
function sampleStore(clock: Clock = { now: Date.parse('2026-11-20T18:30:00Z') }): {
  store: Store;
  clock: Clock;
} {
  const window: Record<string, unknown> = { addEventListener: () => {}, location: { search: '' } };
  const storage = new Map<string, string>();
  const FakeDate = new Proxy(Date, {
    construct: (target, args) => Reflect.construct(target, args.length ? args : [clock.now]),
    get: (target, property) => {
      if (property === 'now') return () => clock.now;
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  runInNewContext(storeSource, {
    window,
    JSON,
    Date: FakeDate,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  return { store: window.JobDeputyStore as Store, clock };
}
const flush = () => new Promise((done) => setTimeout(done, 0));

const model = constant<() => Model>('jobsModel')();
const TONE_WORDS = constant<Record<string, string>>('TONE_WORDS');
const VIEW_IDS = constant<View[]>('VIEW_IDS');
const SKILLS_MATCH = constant<number>('SKILLS_MATCH');
const isFresh = constant<(job: Job) => boolean>('isFresh');
const NO_FILTERS: Filters = { fit: '', source: 'all', workplace: '', query: '' };

const markedBlock = (html: string, name: string): string => {
  const start = `<!-- ${name}: start -->`;
  const end = `<!-- ${name}: end -->`;
  const from = html.indexOf(start);
  const to = html.indexOf(end);
  return from >= 0 && to > from ? html.slice(from, to + end.length) : '';
};

describe('Job matches page frame', () => {
  it('opens with the renamed eyebrow, the h1, and one short line', () => {
    expect(main).toMatch(/<p class="eyebrow">Job matches<\/p>/);
    expect(textOf(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')).toBe(
      'Roles your deputy found.',
    );
    const intro = textOf(main.match(/<p class="intro-copy">([\s\S]*?)<\/p>/)?.[1] ?? '');
    expect(words(intro)).toBeGreaterThan(0);
    expect(words(intro)).toBeLessThanOrEqual(14);
    expect(source).toContain('<a class="skip-link" href="#page-title">Skip to job matches</a>');
    expect(source).toContain('<title>JobDeputy · Job matches</title>');
    // Every visible "Jobs" that names this page now reads "Job matches"; only sources keep it.
    const named = textOf(main).replace(/\b(?:Amazon|Stripe) Jobs\b/g, '');
    expect(named).not.toMatch(/\bJobs\b/);
  });

  it('places the gallery’s flow ribbon, current on Job matches, then its line', () => {
    const ribbon = markedBlock(main, 'FlowRibbon');
    expect(ribbon).not.toBe('');
    expect(ribbon).toBe(markedBlock(gallery, 'FlowRibbon'));
    expect(ribbon.match(/aria-current="page"/g)).toHaveLength(1);
    expect(ribbon).toMatch(/href="\.\/jobs-preview\.html" aria-current="page"/);
    const after = main.slice(main.indexOf('<!-- FlowRibbon: end -->'));
    // Round 7 (J2): the line says the queue in one sentence.
    expect(textOf(after.match(/<p class="jobs-flow-line">([\s\S]*?)<\/p>/)?.[1] ?? '')).toBe(
      'Add a role to Applications or set it aside, and the next one opens.',
    );
    // Round 6 (R6-3, finding A6): the ribbon follows the shared page intro, 21px under it as the
    // Settings tab strip sits, so the intro holds only its copy and Take the tour.
    expect(main.indexOf('</section>')).toBeLessThan(main.indexOf('<div class="jobs-flow">'));
    expect(main.indexOf('<div class="jobs-flow">')).toBeLessThan(
      main.indexOf('<!-- FlowRibbon: start -->'),
    );
    expect(style).toMatch(/\.jobs-flow \{\s*display: grid;\s*gap: 8px;\s*margin: -13px 0 34px;/);
  });

  it('opens with the shared page intro, Take the tour at the end of the title row (R6-3)', () => {
    const intro =
      main.match(/<section class="page-intro jobs-intro"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(intro).toMatch(
      /^<section class="page-intro jobs-intro" aria-labelledby="page-title">\s*<div class="page-intro-copy">\s*<p class="eyebrow">Job matches<\/p>\s*<h1 id="page-title">[^<]+<\/h1>\s*<p class="intro-copy">[^<]+<\/p>\s*<\/div>\s*<div class="page-intro-actions">\s*<button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour<\/button>\s*<\/div>\s*<\/section>$/,
    );
    // One Take the tour on the page, and the page places none itself (app-chrome.css does).
    expect(main.match(/>Take the tour</g)).toHaveLength(1);
    expect(style).not.toMatch(/page-intro|page-tour|jobs-flow-end|\.jobs-intro\b/);
  });

  it('loads the shell scripts in order, then its own', () => {
    const order = [
      'app-shell.js',
      'app-components.js',
      'sample-store.js',
      'deputy.js',
      'feedback.js',
      'app-panels.js',
    ].map((name) => source.indexOf(`<script src="./${name}"></script>`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order.at(-1)).toBeLessThan(source.lastIndexOf('<script>'));
  });

  it('keeps one panda: the dock draws the deputy, empty states use prop illustrations', () => {
    expect(source.match(/data-deputy-art\b/g)).toHaveLength(1);
    const props = [...main.matchAll(/data-deputy-prop="([^"]+)"/g)].map((match) => match[1]);
    expect(props).toEqual(['cards', 'cards']);
    expect(script).toContain("prop: 'magnifier'");
    expect(script).toContain('deputy?.renderProp(art, copy.prop);');
  });
});

describe('one sample world (R3-3)', () => {
  const { store, clock } = sampleStore();
  const seed = store.catalog().jobs;
  // Every job record the store holds: the found roles, then the two the live Amazon Jobs run and
  // the one an Acme retry would add.
  clock.now += 101_000;
  store.retryRun('acme');
  clock.now += 101_000;
  const every = store.catalog().jobs;

  it('keeps no job data of its own: no list, no titles, no ids, no source names', () => {
    expect(every).toHaveLength(30);
    const page = `${main}\n${script}`;
    expect(script).not.toMatch(/\bconst (?:JOBS|SOURCES)\b/);
    for (const job of every) {
      expect(page, job.title).not.toContain(job.title);
      expect(page, job.id).not.toMatch(new RegExp(`['"\`=]${job.id}['"\`&]`));
    }
    for (const name of ['Google Careers', 'Microsoft Careers', 'Example Workday', 'Woodgrove']) {
      expect(page, name).not.toContain(name);
    }
    expect(page).not.toMatch(/\b(?:12|27|29) of 27\b|shown in this sample/);
  });

  it('reads the roles, sources, and applications from the store, and redraws on every change it shows', () => {
    expect(script).toContain('catalog = store.catalog();');
    expect(script).toContain('applications = store.get().applications ?? [];');
    // Round 6: switching to the Large account demo (or back) is another world, not arrivals, so
    // the page starts again on it instead of welcoming every role as new. Round 7 (T3-5, T3-19):
    // a work tick's live progress, or a change only to parts the page doesn't show, draws nothing.
    expect(script).toContain("if (change?.type === 'scale-demo') return switchWorld();");
    expect(script).toContain('if (change?.progress) return;');
    expect(script).toContain("const UNSHOWN = new Set(['prompts', 'tours']);");
    expect(script).toContain(
      'if (Array.isArray(areas) && areas.length && areas.every((area) => UNSHOWN.has(area))) return;',
    );
    expect(script).toMatch(
      /const switchWorld = \(\) => \{\s*read\(\);\s*known = new Set\(catalog\.jobs\.map\(\(job\) => job\.id\)\);\s*restart\(\);/,
    );
    expect(script).toContain('store?.onTick(() => renderLive());');
    // The sources to filter by come from the catalog (the roles' sources), never from a list in
    // the page.
    expect(script).toContain(
      '[...model.sourceCounts(catalog.jobs, state.view, filters(), state.sources)].map(',
    );
  });

  it('writes no count into the markup: every figure is filled from the store', () => {
    const figures = [...main.matchAll(/<(\w+)\b[^>]*\bdata-metric="([^"]+)"[^>]*>([^<]*)</g)];
    expect(figures.map((figure) => figure[2])).toEqual(['jobs.new', 'jobs.dismissed']);
    for (const figure of figures) expect(figure[3], figure[2]).toBe('');
    // The band's figures (round 7) are empty slots the script fills with the store's key and text.
    const band = [...main.matchAll(/<span data-band-figure="(\w+)"><\/span>/g)].map(
      (match) => match[1],
    );
    expect(band).toEqual(['found', 'today', 'week', 'tracked']);
    expect(script).toContain('? store.metricText(key)');
    expect(script).toContain("if (key) node.setAttribute('data-metric', key);");
  });

  it('lists all 27 found roles on the seed, as the Dashboard’s found count says', () => {
    const fresh = sampleStore().store;
    expect(seed).toHaveLength(27);
    expect(model.shown(seed, 'all', NO_FILTERS)).toHaveLength(27);
    expect(fresh.metric('jobs.found')).toBe(27);
    expect(fresh.metricText('jobs.found')).toBe('27');
  });
});

describe('the review queue: To review and Not for me (round 7, J1 and J2)', () => {
  const tabs = [
    ...main.matchAll(
      /<button\s+id="jobs-tab-(\w+)"\s+type="button"\s+role="tab"\s+aria-selected="(true|false)"\s+aria-controls="jobs-panel-(\w+)"\s+data-view="(\w+)"[^>]*>([\s\S]*?)<\/button>/g,
    ),
  ];
  const { store } = sampleStore();
  const jobs = store.catalog().jobs;
  const EVERY_VIEW: View[] = ['all', 'new', 'tracked', 'dismissed'];

  it('shows To review and Not for me, each with its store count; All and In Applications left', () => {
    expect(main).toContain(
      '<div class="tabs is-even jobs-views" role="tablist" aria-label="Job match views" data-tabs>',
    );
    // The store's views new and dismissed, named for the queue.
    expect(tabs.map((tab) => [tab[1], tab[2], tab[3], tab[4]])).toEqual([
      ['new', 'true', 'new', 'new'],
      ['dismissed', 'false', 'dismissed', 'dismissed'],
    ]);
    expect(tabs.map((tab) => textOf(tab[5] ?? ''))).toEqual([
      'To review roles',
      'Not for me roles',
    ]);
    expect(VIEW_IDS).toEqual(['new', 'dismissed']);
    expect(script).toContain("const VIEWS = { new: 'To review', dismissed: 'Not for me' };");
    expect(main).not.toMatch(
      /jobs-tab-all|jobs-tab-tracked|jobs-panel-all|jobs-panel-tracked|jobs-bridge/,
    );
  });

  it('says role or roles after each count, for screen readers', () => {
    const nouns = [...main.matchAll(/<span class="sr-only" data-view-noun> roles<\/span>/g)];
    expect(nouns).toHaveLength(2);
    expect(script).toContain("const noun = count === 1 ? ' role' : ' roles';");
    // Every other count in words goes through counted(), which says 1 role and 2 roles.
    const grouped = constant<(count: number) => string>('grouped');
    const counted = constant<(count: number, one: string, many?: string) => string>('counted', {
      grouped,
    });
    expect([counted(1, 'role'), counted(2, 'role'), counted(0, 'role')]).toEqual([
      '1 role',
      '2 roles',
      '0 roles',
    ]);
    // Round 6 (the Large account demo): counts read with thousands separators.
    expect(counted(1024, 'role')).toBe('1,024 roles');
    expect(script).not.toMatch(/\$\{[^}]+\} roles/);
  });

  it('gives each view a labelled panel with its ranked rows and an empty state', () => {
    for (const view of VIEW_IDS) {
      const panel =
        main.match(
          new RegExp(
            `<div\\s+class="tab-panel"\\s+id="jobs-panel-${view}"\\s+role="tabpanel"\\s+aria-labelledby="jobs-tab-${view}"[\\s\\S]*?data-empty="${view}"`,
          ),
        )?.[0] ?? '';
      expect(panel, view).toContain(`<ol class="jobs-rows" data-rows="${view}"`);
    }
    expect(main.match(/<div\s+class="tab-panel"[^>]*\bhidden\b/g)).toHaveLength(1);
    expect(main).toContain(
      '<ol class="jobs-rows" data-rows="new" aria-label="Roles to review, best fit first"></ol>',
    );
  });

  it('counts the seed: Found 27 = To review 20 + In Applications 5 + Not for me 2', () => {
    const counts = Object.fromEntries(
      EVERY_VIEW.map((view) => [view, model.count(jobs, view, NO_FILTERS)]),
    );
    expect(counts).toEqual({ all: 27, new: 20, tracked: 5, dismissed: 2 });
    for (const view of EVERY_VIEW) {
      const key = model.countKey(view, NO_FILTERS);
      expect(key, view).not.toBeNull();
      expect(store.metric(key ?? ''), view).toBe(counts[view]);
    }
    // The store's round 7 names for the queue are the same figures (ST, J2), read where they exist.
    for (const [old, named] of [
      ['jobs.new', 'jobs.toReview'],
      ['jobs.dismissed', 'jobs.notForMe'],
    ] as const) {
      const value = store.metric(named);
      if (value !== null && value !== undefined) expect(value, named).toBe(store.metric(old));
    }
    expect(script).toContain("['jobs.new', 'jobs.toReview'],");
    expect(script).toContain("['jobs.dismissed', 'jobs.notForMe'],");
    expect(
      model
        .shown(jobs, 'dismissed', NO_FILTERS)
        .map((job) => job.id)
        .sort(),
    ).toEqual(['devtools-principal', 'identity-manager']);
  });

  it('keeps the counts adding up under every filter, and names the store metric whenever one exists', () => {
    const fits: string[] = ['', 'strong', 'good', 'stretch'];
    const sources: string[] = ['all', ...store.catalog().sources.map((item) => item.id)];
    const extras: Array<Partial<Filters>> = [{}, { workplace: 'remote' }, { query: 'seattle' }];
    let keyed = 0;
    for (const fit of fits) {
      for (const id of sources) {
        for (const extra of extras) {
          const filters: Filters = { ...NO_FILTERS, fit, source: id, ...extra };
          const count = (view: View) => model.count(jobs, view, filters);
          // The band's Found is every view: what you review, added, and set aside.
          expect(count('all')).toBe(count('new') + count('tracked') + count('dismissed'));
          for (const view of EVERY_VIEW) {
            const key = model.countKey(view, filters);
            const single = !extra.workplace && !extra.query && !(fit && id !== 'all');
            expect(key === null, `${view} ${fit} ${id} ${JSON.stringify(extra)}`).toBe(!single);
            if (key) {
              keyed += 1;
              expect(store.metric(key), key).toBe(count(view));
            }
          }
        }
      }
    }
    // 4 counts × (1 + 3 fits + one per source) single filters (round 5: 17 sources).
    expect(keyed).toBe(4 * (1 + 3 + (sources.length - 1)));
    expect(sources.length - 1).toBe(17);
  });

  it('opens with its metrics band: Found, what is new, and In Applications, under the filters in use (R10-2)', () => {
    // The band leads, under the ribbon: the stat row, then the latest search's line.
    const at = (needle: string) => main.indexOf(needle);
    expect(at('<!-- FlowRibbon: end -->')).toBeLessThan(at('id="jobs-band"'));
    expect(at('id="jobs-band"')).toBeLessThan(at('id="jobs-surface"'));
    const band =
      main.match(/<section\s+class="task-surface jobs-band"[\s\S]*?<\/section>/)?.[0] ?? '';
    const labels = [...band.matchAll(/<dt class="stat-label">([\s\S]*?)<\/dt>/g)].map(
      (match) => match[1] ?? '',
    );
    expect(
      labels.map((label) =>
        textOf(label.replace(/<span class="jobs-stat-short"[^>]*>[^<]*<\/span>/, '')),
      ),
    ).toEqual(['Found', 'Found today', 'Found this week', 'Added to Applications']);
    // On a phone each says a word or two (round 7, T2-12), the whole name kept for screen readers.
    expect(
      labels.map(
        (label) =>
          label.match(/<span class="jobs-stat-short" aria-hidden="true">([^<]+)</)?.[1] ?? null,
      ),
    ).toEqual([null, 'Today', 'This week', 'Added']);
    expect(style).toMatch(
      /\.jobs-stats \{\s*grid-auto-columns: minmax\(0, 1fr\);\s*grid-auto-flow: column;/,
    );
    // Added to Applications counts the roles you added from here (the ribbon's tracked count also
    // holds the ones you added in Applications yourself, round 6 part 2, P-5), and its label opens
    // their home (R10-3) with no row of its own under the stats (round 7); today and this week
    // show once the store counts them (ST), hidden until then.
    expect(labels[3]).toContain(
      '<a class="chart-action jobs-stat-link" id="jobs-stat-tracked" href="./applications-preview.html"',
    );
    expect(band).not.toContain('stat-meta');
    expect(band).toMatch(/<div class="stat" data-stat="today" hidden>/);
    expect(band).toMatch(/<div class="stat" data-stat="week" hidden>/);
    // Each figure is the store's key for the filters in use (a fit, one source), so "Google 12"
    // on Searches lands on "12 found" here, else the count without a key, as the tabs do.
    expect(script).toContain(
      "setFigure(band.figures.found, model.countKey('all', chosen), model.count(catalog.jobs, 'all', chosen));",
    );
    expect(script).toContain(
      "const WINDOWS = { today: 'jobs.foundToday', week: 'jobs.foundWeek' };",
    );
    // Today and this week stay under every filter (round 7, T1-18): the store's key where it has
    // one, else the count of the same roles, from the same days the store counts.
    expect(script).toContain('const known = hasMetric(base);');
    expect(script).toContain(
      "setFigure(band.figures[name], windowKey(base, chosen), model.count(found, 'all', chosen));",
    );
    const foundWindows = constant<() => { today: string; week: string }>('foundWindows', {
      store: { today: () => '2026-10-02' },
      Date,
    });
    expect(foundWindows()).toEqual({ today: '2026-10-02', week: '2026-09-28' });
    {
      const { store: world } = sampleStore();
      const days = constant<() => { today: string; week: string }>('foundWindows', {
        store: world,
        Date,
      })();
      const jobs = world.catalog().jobs as Array<Job & { foundAt?: string }>;
      const since = (day: string) =>
        jobs.filter((job) => String(job.foundAt ?? '').slice(0, 10) >= day);
      expect(model.count(since(days.today), 'all', NO_FILTERS)).toBe(
        Number(world.metric('jobs.foundToday')),
      );
      expect(model.count(since(days.week), 'all', NO_FILTERS)).toBe(
        Number(world.metric('jobs.foundWeek')),
      );
    }
    expect(model.countKey('all', { ...NO_FILTERS, source: 'google' })).toBe('jobs.source.google');
    expect(store.metricText('jobs.source.google')).toBe('12');
    expect(model.countKey('tracked', { ...NO_FILTERS, fit: 'strong' })).toBe(
      'jobs.tracked.fit.strong',
    );
    // The latest search that kept roles, from the store's series, with Show only those (in place).
    expect(script).toContain(
      "const who = run?.via === 'watch' ? (store.TERMS?.watch ?? 'Keep watch') : 'Your search';",
    );
    expect(script).toContain(
      "el('strong', { 'data-metric': bar.metric }, store.metricText(bar.metric))",
    );
    expect(band).toContain(
      '<a class="compact-action" id="jobs-newest-link" href="./jobs-preview.html">Show only those</a>',
    );
  });

  it('keys the counts the Dashboard and Searches links land on: a fit or a source, found and to review', () => {
    expect(model.countKey('all', { ...NO_FILTERS, fit: 'strong' })).toBe('jobs.fit.strong');
    expect(model.countKey('new', { ...NO_FILTERS, fit: 'good' })).toBe('jobs.new.fit.good');
    expect(model.countKey('all', { ...NO_FILTERS, source: 'google' })).toBe('jobs.source.google');
    expect(model.countKey('dismissed', { ...NO_FILTERS, source: 'microsoft' })).toBe(
      'jobs.dismissed.source.microsoft',
    );
    expect(model.countKey('new', NO_FILTERS)).toBe('jobs.new');
    expect(store.metric('jobs.fit.strong')).toBe(4);
    expect(model.count(jobs, 'all', { ...NO_FILTERS, fit: 'strong' })).toBe(4);
  });

  it('opens To review by default, lands every old view, and sends a role in Applications to Applications (R10-3)', () => {
    expect(script).toContain("state.view = VIEW_ALIASES[requestedView] ?? 'new';");
    expect(script).toContain(
      "const VIEW_ALIASES = { review: 'new', new: 'new', all: 'new', 'not-for-me': 'dismissed', dismissed: 'dismissed' };",
    );
    expect(script).toContain("const VIEW_PARAMS = { new: null, dismissed: 'not-for-me' };");
    expect(script).toContain("setParameter('view', VIEW_PARAMS[view]);");
    expect(script).toContain("tablist.addEventListener('jobdeputy:tabchange'");
    // One home per thing: a ?job= of a role in Applications opens it there, and In Applications
    // is Applications itself; before anything is drawn, with no history entry.
    expect(script).toMatch(
      /const forwardTo = \(\(\) => \{\s*const asked = parameters\.get\('job'\) \?\? '';\s*const app = asked \? appFor\(jobFor\(asked\)\) : null;\s*if \(app\) return openHref\(app\);\s*if \(parameters\.get\('view'\) === 'tracked'\) return '\.\/applications-preview\.html';\s*return null;\s*\}\)\(\);\s*if \(forwardTo\) \{\s*window\.location\.replace\(forwardTo\);\s*return;\s*\}/,
    );
    expect(script.indexOf('if (forwardTo) {')).toBeLessThan(script.indexOf('buildFits();\n'));
    // ?job= of a role still in the queue keeps working, in its own view.
    expect(script).toContain('if (!model.inView(target, state.view)) state.view = target.view;');
    const app = store.get().applications.find((item) => item.jobId === 'devex');
    expect(app?.id).toBe('devex');
  });

  it('ranks best fit first (closed postings last within a fit), or newest found first', () => {
    const ranked = model.shown(jobs, 'all', NO_FILTERS);
    const order = { strong: 0, good: 1, stretch: 2 };
    for (const [index, job] of ranked.entries()) {
      const next = ranked[index + 1];
      if (!next) continue;
      expect(order[job.fit] <= order[next.fit], `${job.id} before ${next.id}`).toBe(true);
    }
    expect(ranked[0]?.id).toBe('search-infra');
    expect(ranked.filter((job) => job.fit === 'stretch').at(-1)?.id).toBe('data-platforms');
    const newest = model.shown(jobs, 'all', NO_FILTERS, { sort: 'newest' });
    expect(Date.parse(newest[0]?.foundAt ?? '')).toBeGreaterThanOrEqual(
      Date.parse(newest.at(-1)?.foundAt ?? ''),
    );
  });

  it('takes a decided role out at once, opens the next one, and says where it went with Undo (J2)', () => {
    // No view pins a decided role any more: it leaves the queue at once.
    expect(script).toContain('const pinned = new Map();');
    expect(script).not.toMatch(/pinned\.set\(/);
    const { store: world } = sampleStore();
    const before = model.shown(world.catalog().jobs, 'new', NO_FILTERS).map((job) => job.id);
    expect(before.slice(0, 3)).toEqual([
      'internal-platforms',
      'storage-platform',
      'payments-infra',
    ]);
    world.setJob('internal-platforms', 'dismissed');
    const after = model.shown(world.catalog().jobs, 'new', NO_FILTERS).map((job) => job.id);
    expect(after).toEqual(before.slice(1));
    // The next role is the one that takes its place, else the one before.
    expect(script).toContain('const next = rows[index + 1] ?? rows[index - 1] ?? null;');
    // Focus goes to its title: the open role's h2 when you decided there, else its row.
    expect(script).toContain(
      "if (!detail.title.hasAttribute('tabindex')) detail.title.setAttribute('tabindex', '-1');",
    );
    expect(script).toContain("const link = rowElements.get(id)?.querySelector('.jobs-row-link');");
    // The notice: Added to Applications with Open in Applications and Undo; Not for me and a
    // restore with Undo. Over the next role in the open role, or where the row was in the list.
    expect(script).toContain("title: 'Added to Applications',");
    expect(script).toContain(
      code(
        "dismissed: { title: 'Set aside in Not for me', message: (d) => `#{d.title} at #{d.company}.` },",
      ),
    );
    expect(script).toContain(
      code('href: `./applications-preview.html?open=#{encodeURIComponent(d.appId)}`,'),
    );
    expect(script).toContain("'Open in Applications',");
    expect(script).toContain(
      "{ class: 'feedback-panel-action', type: 'button', 'data-decided': 'undo', 'data-key': 'decided-undo' },",
    );
    // The notice shows where you pressed, at every width (round 7, T6-12 refined for T4-25): from
    // the open role, over the next role's title, so Undo is one Shift+Tab from the focused title;
    // from a row, in the list where the row was, at the row's height. No tooltip follows a row
    // that came under a still pointer.
    expect(script).toContain("place: from === 'detail' && next ? 'detail' : 'list',");
    expect(script).not.toContain("next && isNarrow() ? 'detail'");
    const detailPane = main.slice(
      main.indexOf('id="jobs-decided"'),
      main.indexOf('id="detail-title"'),
    );
    expect(detailPane).not.toMatch(/<(?:a|button|input|select)\b/);
    expect(script).toContain(
      'const height = Math.round(rowElements.get(id)?.getBoundingClientRect().height ?? 0);',
    );
    expect(script).toContain(code('style: d.height ? `min-height: #{d.height}px` : null,'));
    expect(script).toContain('components?.tip?.hide?.();');
    expect(script).toMatch(/if \(still\) event\.stopPropagation\(\);\s*else stillAt = null;/);
    // The address names the role open after a decision, so a reload opens it (T3-20).
    expect(script).toContain(
      "setParameter('job', state.opened && state.active ? state.active : null);",
    );
    expect(main).toMatch(
      /<section\s+class="feedback-panel jobs-decided"\s+id="jobs-decided"\s+data-kind="success"\s+hidden\s+aria-labelledby="jobs-decided-title"\s*>/,
    );
    // Through the store's queue API where it has it (ST, item 7), else as round 6 did.
    expect(script).toContain(
      "if (typeof store.addToApplications === 'function') return store.addToApplications(job.id);",
    );
    expect(script).toContain('? store.undoAddToApplications(job.id)');
    expect(script).toContain(
      "if (typeof store.notForMe === 'function') return store.notForMe(job.id);",
    );
    expect(script).toContain(
      "if (typeof store.undoNotForMe === 'function') return store.undoNotForMe(job.id);",
    );
    // A view, a filter, or a page change ends the notice.
    expect(script).toMatch(
      /const restart = \(\) => \{\s*pinned\.clear\(\);\s*arrivals\.clear\(\);\s*unseen\.clear\(\);\s*state\.page = 1;\s*state\.decision = null;/,
    );
  });
});

describe('fit colours and words (finding 3b)', () => {
  const { store } = sampleStore();
  const key =
    main.match(/<ul\s+class="chart-key is-compact is-inline jobs-fit-key"[\s\S]*?<\/ul>/)?.[0] ??
    '';
  const page = `${main}\n${script}`;

  it('reads every fit’s name, colour, and meaning from the store, and retypes none', () => {
    expect(store.FITS.map((fit) => fit.id)).toEqual(['strong', 'good', 'stretch']);
    expect(script).toContain('const FIT_LEVELS = store?.FITS ?? [];');
    expect(script).toContain('const FITS = labelsOf(FIT_LEVELS);');
    expect(script).toContain(
      'const FIT_TONES = Object.fromEntries(FIT_LEVELS.map((fit) => [fit.id, fit.tone]));',
    );
    expect(script).toContain(
      'const FIT_MEANINGS = Object.fromEntries(FIT_LEVELS.map((fit) => [fit.id, fit.meaning]));',
    );
    for (const fit of store.FITS) {
      expect(page, fit.meaning).not.toContain(fit.meaning.replace(/\.$/, ''));
      expect(main, fit.label).not.toContain(fit.label);
    }
    // Nor the first draft's words, which promised checks the deputy does not make.
    expect(page).not.toMatch(/must-have|nice-to-have/);
  });

  it('builds a visible fit key from the store: each colour, its name, and its meaning', () => {
    // The markup holds the empty key and its tour step; the script fills it.
    expect(key).toMatch(
      /<ul\s+class="chart-key is-compact is-inline jobs-fit-key"\s+id="fit-key"\s+aria-label="Fit levels"\s+data-tour-step="4"[\s\S]*?><\/ul>/,
    );
    expect(script).toContain("{ 'data-tone': fit.tone },");
    expect(script).toContain("el('span', { class: 'chart-key-name' }, fit.label),");
    expect(script).toMatch(/\{ class: 'chart-key-meaning' \},\s*fit\.meaning\.replace\(/);
    expect(script).toContain(
      code('href: `./jobs-preview.html?fit=#{encodeURIComponent(fit.id)}`,'),
    );
    // Each tooltip names the fit, how many of its roles the view holds, and what it means, and the
    // key filters in place.
    expect(script).toContain(
      code("const tip = `#{FITS[fit]} · #{counted(count, 'role')} #{where}`;"),
    );
    expect(script).toContain("link.setAttribute('data-tip-title', tip);");
    expect(script).toContain(
      code("link.setAttribute('data-tip', `#{FIT_MEANINGS[fit]} Shows only these roles.`);"),
    );
    expect(script).toContain("fitKey.addEventListener('click', (event) => {");
    // The tour names every colour in words, from the store's tones.
    for (const fit of store.FITS) expect(TONE_WORDS[fit.tone], fit.tone).toBeTruthy();
    expect(script).toContain(code('`#{TONE_WORDS[fit.tone] ?? fit.tone} for #{fit.label}`'));
  });

  it('names each role’s fit in its colour, with the meaning in a tooltip', () => {
    expect(script).toMatch(
      /const toneLabel = \(fit\) =>\s*el\('span', \{ class: 'tone-label', 'data-tone': FIT_TONES\[fit\] \}, FITS\[fit\]\);/,
    );
    expect(script).toMatch(
      /class: 'jobs-row-fit jobs-row-tip',\s*'data-tip-title': FITS\[job\.fit\],\s*'data-tip': FIT_MEANINGS\[job\.fit\],/,
    );
    // A source in the filter bar's list keeps its source colour (round 6, R6-4).
    expect(script).toContain('tone: sourceToneOf(id) ?? undefined');
    // The open role names its fit the same way, beside the sample marker.
    expect(script).toContain("el('span', { class: 'jobs-fit-sample' }, ' · sample'),");
    expect(script).toContain("detail.fit.setAttribute('data-tip', FIT_MEANINGS[job.fit]);");
    // No fit ring: its green arc read as Strong fit for every level.
    expect(script).not.toContain('ring is-tiny');
  });
});

describe('rows', () => {
  it('lead with the role, then its fit, company, and place, and keep their own address', () => {
    expect(script).toContain(
      code('href: `./jobs-preview.html?job=#{encodeURIComponent(job.id)}`,'),
    );
    expect(script).toContain(code("'aria-labelledby': `row-#{job.id}-title`,"));
    expect(script).toContain(code("'aria-describedby': `row-#{job.id}-meta`,"));
    expect(script).toContain(
      code("el('span', { class: 'jobs-row-place' }, `#{job.company} · #{placeOf(job)}`),"),
    );
  });

  it('name the city in the row (or Remote, US) and leave the full place to the open role', () => {
    const placeOf = constant<(job: Pick<Job, 'workplace' | 'location'>) => string>('placeOf');
    expect(placeOf({ workplace: 'hybrid', location: 'Seattle, WA' })).toBe('Seattle');
    expect(placeOf({ workplace: 'onsite', location: 'Mountain View, CA' })).toBe('Mountain View');
    expect(placeOf({ workplace: 'remote', location: 'Remote, US' })).toBe('Remote, US');
    expect(script).toMatch(/job\.company,\s*job\.location,\s*job\.workplaceLabel,/);
  });

  it('offer Add to Applications and Not for me as named icons; a tracked role shows its stage', () => {
    expect(script).toMatch(/iconAction\(\s*'add',\s*'Add to Applications',/);
    expect(script).toMatch(/iconAction\(\s*'dismiss',\s*'Not for me',/);
    // The name starts with the touch word, so the visible word is in the accessible name.
    expect(script).toMatch(
      /button\.append\(\s*el\('span', \{ class: 'jobs-action-word', 'aria-hidden': 'true' \}, word\),\s*el\('span', \{ class: 'sr-only' \}, `\$\{label\}: \$\{job\.title\}`\),\s*\);/,
    );
    expect(script).toMatch(/iconAction\(\s*'add',\s*'Add to Applications',\s*'Add',/);
    expect(script).toMatch(/iconAction\(\s*'dismiss',\s*'Not for me',\s*'Not for me',/);
    expect(script).toContain("'data-tip-title': label,");
    expect(script).toContain("isWaiting(app) ? 'Approval · needs you' : stageName(app),");
    // Not for me's rows offer Restore; Undo is the decision notice's (round 7, J2).
    expect(script).toContain("named('Restore', job),");
    expect(script).not.toContain('undoable');
    expect(script).toContain(code("'data-tip-title': `Posting closed #{shortDate(job.closed)}`,"));
    expect(script).toContain(code('state: `Posting closed #{shortDate(job.closed)}`,'));
    expect(script).toContain(
      code(
        "const named = (label, job) => [label, el('span', { class: 'sr-only' }, `: #{job.title}`)];",
      ),
    );
  });
});

describe('the open role', () => {
  const detail = main.match(/<article class="jobs-detail"[\s\S]*?<\/article>/)?.[0] ?? '';
  const { store } = sampleStore();
  const jobs = store.catalog().jobs;

  it('reads in order: what you just decided, the role, your decision, why it fits with its prompt, then the posting, collapsed', () => {
    const parts = [
      'id="jobs-decided"',
      'id="detail-title"',
      'id="detail-decision"',
      'id="why-title"',
      'id="detail-checks"',
      'data-prompt-summary="rank"',
      'id="detail-thumbs"',
      'id="detail-posting"',
    ].map((part) => detail.indexOf(part));
    expect(parts.every((index) => index > -1)).toBe(true);
    expect([...parts].sort((a, b) => a - b)).toEqual(parts);
    expect(detail).toMatch(/<details class="jobs-disclosure jobs-posting" id="detail-posting">/);
    expect(detail).not.toMatch(/<details[^>]*\sopen\b/);
    expect(textOf(detail)).toContain('What the posting says');
  });

  it('shows the prompt it ranks with as the shared prompt summary in Why it fits, read only, once (R10-5)', () => {
    // Round 7 (R10-5, J1): the same prompt summary as Searches; Open in Prompts (with return=)
    // is the only way to change it, so See the prompt and the drawer's editor are gone.
    expect(main).not.toMatch(/data-prompt-open=|data-prompt-control=|See the prompt/);
    expect(main.match(/data-prompt-summary=/g)).toHaveLength(1);
    expect(detail).toMatch(
      /<div class="jobs-why-head">\s*<h3 class="section-label" id="why-title">Why it fits<\/h3>\s*<p class="jobs-why-fit" id="detail-fit"><\/p>\s*<\/div>/,
    );
    expect(detail).toMatch(
      /<div\s+class="jobs-why-prompt"\s+id="jobs-why-prompt"\s+data-prompt-summary="rank"\s+data-prompt-size="row"\s+data-prompt-heading="4"\s*><\/div>/,
    );
  });

  it('shows Why it fits as a tick or ! for the role, the place, and the skills', () => {
    expect(style).toContain('content: "✓" / "";');
    expect(style).toContain('content: "!" / "";');
    expect(script).toContain("kind === 'match' ? 'Matches: ' : 'Worth checking: '");
    expect(script).toContain("class: 'meter jobs-check-meter',");
    const checksFor = constant<(job: Job) => Array<[string, string, string]>>('checksFor', {
      SKILLS_MATCH,
    });
    for (const job of jobs) {
      const [role, place, skills] = checksFor(job);
      expect(role?.[0]).toBe('Role');
      expect(place?.[0]).toBe('Place');
      expect(skills?.[2], job.id).toBe(
        `${job.found.length} of ${job.keywords.length} keywords on your résumé`,
      );
      // Each fit level tells a consistent story with its checks.
      const kinds = [role?.[1], place?.[1], skills?.[1]];
      const gaps = kinds.filter((kind) => kind === 'check').length;
      if (job.fit === 'strong') expect(gaps, job.id).toBeLessThanOrEqual(1);
    }
  });

  it('shows a tracked role as In Applications with its stage, materials in one line, and one way there', () => {
    expect(script).toContain(code('state: `In Applications · #{stageName(app)}`,'));
    expect(script).toContain(
      "actions: [{ key: 'open', label: 'Open in Applications', href: openHref(app) }],",
    );
    expect(script).toContain("waiting: 'Materials are ready for your approval.',");
    // The application workflow lives in Applications: nothing here tailors, reviews, or approves.
    expect(`${main}${script}`).not.toMatch(/materials-preview\.html/);
    expect(`${main}${script}`).not.toMatch(
      /label: 'Tailor|>\s*Tailor|Review &amp; approve|Review & approve|Approve materials/,
    );
    expect(`${main}${script}`).not.toMatch(/bulk|Select visible/i);
  });

  it('says when your deputy tailors a role you add: the store\u2019s morning schedule', () => {
    expect(script).toContain('note: tailorWords(),');
    expect(script).toContain('const daily = store?.tailorQueue?.()?.daily;');
    expect(script).toContain(
      code(
        'return `Your deputy tailors it #{when} at #{store.format.time(daily.nextAt) || daily.time}, in Applications.`;',
      ),
    );
    // Tomorrow, today, or the day, at the schedule's time; with the rule off, Tailor now.
    const storeAt = (nextAt: string | null, enabled = true) => ({
      tailorQueue: () => ({ daily: { enabled, nextAt, time: '06:00' } }),
      today: () => '2026-10-02',
      format: {
        date: (value: string) => String(value).slice(0, 10),
        time: (value: string) => String(value).slice(11, 16),
      },
    });
    const say = (store: unknown) => constant<() => string>('tailorWords', { store, Date })();
    expect(say(storeAt('2026-10-03T06:00:00-07:00'))).toBe(
      'Your deputy tailors it tomorrow at 06:00, in Applications.',
    );
    expect(say(storeAt('2026-10-02T06:00:00-07:00'))).toBe(
      'Your deputy tailors it today at 06:00, in Applications.',
    );
    expect(say(storeAt('2026-10-05T06:00:00-07:00'))).toBe(
      'Your deputy tailors it on 2026-10-05 at 06:00, in Applications.',
    );
    expect(say(storeAt(null, false))).toBe(
      'Your deputy tailors it when you choose Tailor now, in Applications.',
    );
    expect(script).not.toContain('Nothing is sent to');
  });
});

describe('keywords: the readiness rule (finding 22)', () => {
  const { store } = sampleStore();
  const jobs = store.catalog().jobs;
  const state = store.get();
  const resume = state.documents.library.find((doc) => doc.id === state.documents.defaults.resume);
  const onResume = new Set((resume?.keywords ?? []).map((word) => word.toLowerCase()));
  const stats = store.keywordStats();

  it('checks every posting keyword against the default résumé, in the posting’s order', () => {
    expect(onResume.size).toBeGreaterThan(0);
    for (const job of jobs) {
      const chips = model.keywords(job);
      expect(
        chips.map((chip) => chip.word),
        job.id,
      ).toEqual(job.keywords);
      for (const chip of chips) {
        expect(chip.onResume, `${job.id}: ${chip.word}`).toBe(
          onResume.has(chip.word.toLowerCase()),
        );
      }
      expect(chips.filter((chip) => chip.onResume).map((chip) => chip.word)).toEqual(job.found);
      expect(chips.filter((chip) => !chip.onResume).map((chip) => chip.word)).toEqual(job.missing);
    }
  });

  it('never disagrees with Résumés readiness about a keyword', () => {
    const top = new Map(stats.keywords.map((entry) => [entry.keyword.toLowerCase(), entry]));
    let shared = 0;
    for (const job of jobs) {
      for (const chip of model.keywords(job)) {
        const entry = top.get(chip.word.toLowerCase());
        if (!entry) continue;
        shared += 1;
        expect(chip.onResume, `${job.id}: ${chip.word}`).toBe(entry.onResume);
      }
    }
    expect(shared).toBeGreaterThan(50);
    // A top keyword's chip names the count readiness shows ("in 18 of 27 roles"); another
    // keyword the store's count across found roles.
    expect(script).toContain("const roles = counted(stats?.basedOn ?? 0, 'role');");
    expect(script).toContain(
      code("'data-tip-title': `#{entry.keyword} · in #{grouped(entry.roles)} of #{roles}`,"),
    );
    expect(script).toContain(
      code("'data-tip-title': `#{word} · in #{grouped(count)} of #{roles}`,"),
    );
    expect(script).toContain('const stats = store?.keywordStats?.() ?? null;');
    // The store's full keyword list agrees with readiness on every top keyword's count.
    const all = new Map(
      (
        store as unknown as {
          seeAll(kind: string): { items: Array<{ label: string; count: number }> };
        }
      )
        .seeAll('keywords')
        .items.map((item) => [item.label.toLowerCase(), item.count]),
    );
    for (const entry of stats.keywords) {
      expect(all.get(entry.keyword.toLowerCase()), entry.keyword).toBe(entry.roles);
    }
  });

  it('shows keywords on and off the résumé as chips, grouped in words', () => {
    expect(script).toContain("keywordGroup('found', 'On your résumé', onResume, context)");
    expect(script).toContain("keywordGroup('missing', 'Not on your résumé', missing, context)");
    expect(script).toContain(code('id: `keywords-#{kind}-label`'));
    expect(script).toContain(code("'aria-labelledby': `keywords-#{kind}-label`"));
    expect(style).toMatch(/\.jobs-keyword\.is-found::before \{\s*content: "✓" \/ "";/);
  });
});

describe('keywords: at most six, then +N more (round 6, G9 and R6-4)', () => {
  type Chip = { word: string; onResume: boolean };
  type Pick = (
    list: Chip[],
    options: { n: number; value: (chip: Chip) => number; label: (chip: Chip) => string },
  ) => { top: Array<{ item: Chip }>; all: Array<{ item: Chip }> };
  const KEYWORD_CAP = constant<number>('KEYWORD_CAP');
  const rankKeywords = constant<
    (
      chips: Chip[],
      counts: Map<string, number>,
      pick: Pick | null,
    ) => { order: Chip[]; shown: Set<string>; more: number }
  >('rankKeywords', { KEYWORD_CAP });
  const { store } = sampleStore();
  const pick = (store as unknown as { topWithOther: Pick }).topWithOther;
  const counts = new Map(
    (
      store as unknown as {
        seeAll(kind: string): { items: Array<{ label: string; count: number }> };
      }
    )
      .seeAll('keywords')
      .items.map((item) => [item.label.toLowerCase(), item.count]),
  );

  it('shows the six keywords most found roles ask for, most asked first', () => {
    expect(KEYWORD_CAP).toBe(6);
    expect(typeof pick).toBe('function');
    for (const job of store.catalog().jobs) {
      const chips = model.keywords(job);
      const { order, shown, more } = rankKeywords(chips, counts, pick);
      // Every keyword of the role is there, once, and the first six are the ones shown.
      expect(order.map((chip) => chip.word).sort(), job.id).toEqual(job.keywords.slice().sort());
      expect(shown.size, job.id).toBe(Math.min(6, chips.length));
      expect(more, job.id).toBe(chips.length - shown.size);
      expect([...shown], job.id).toEqual(order.slice(0, shown.size).map((chip) => chip.word));
      const value = (chip: Chip) => counts.get(chip.word.toLowerCase()) ?? 0;
      for (const [index, chip] of order.entries()) {
        const next = order[index + 1];
        if (next) expect(value(chip), `${job.id} ${chip.word}`).toBeGreaterThanOrEqual(value(next));
      }
    }
    // A role with seven keywords on the seed shows six and "+1 more".
    const seven = store.catalog().jobs.find((job) => job.keywords.length === 7);
    expect(seven).toBeDefined();
    expect(rankKeywords(model.keywords(seven as Job), counts, pick).more).toBe(1);
    // Without the shared rule every keyword shows, in the posting's order.
    const [first] = store.catalog().jobs;
    const plain = rankKeywords(model.keywords(first as Job), counts, null);
    expect(plain.more).toBe(0);
    expect(plain.order.map((chip) => chip.word)).toEqual(first?.keywords);
  });

  it('keeps the rest of the role’s keywords one press away, in their groups', () => {
    expect(script).toContain('const { order, shown, more } = rankKeywords(chipsOf, counts, pick);');
    expect(script).toContain(
      'const pick = components?.topWithOther ?? store?.topWithOther ?? null;',
    );
    expect(script).toContain('hidden: !shown.has(word),');
    expect(script).toContain('more > 0 ? keywordMore(more) : null,');
    expect(script).toContain("'aria-controls': 'detail-keywords',");
    expect(script).toContain("'aria-expanded': 'false',");
    expect(script).toContain(
      code("el('span', { 'data-more-words': '' }, `+#{grouped(more)} more`),"),
    );
    expect(script).toMatch(
      /for \(const node of box\.querySelectorAll\('\.is-more'\)\) node\.hidden = !open;/,
    );
    expect(script).toContain("? 'Show fewer'");
    // A group whose keywords are all folded folds with them.
    expect(script).toContain('const folded = words.every((word) => !shown.has(word));');
    // The skills line still counts every keyword of the role.
    expect(script).toContain(code('`#{found} of #{total} keywords on your résumé`,'));
  });
});

describe('thumbs: was this match right?', () => {
  const thumbs =
    main.match(/<fieldset class="thumbs"[\s\S]*?<\/button>\s*<\/div>\s*<\/fieldset>/)?.[0] ?? '';
  const galleryThumbs =
    gallery.match(
      /<fieldset class="thumbs" data-thumbs-context="Job match: Senior Software Engineer, Search Infrastructure" id="gallery-thumbs">[\s\S]*?<\/button>\s*<\/div>\s*<\/fieldset>/,
    )?.[0] ?? '';
  const shape = (html: string): string =>
    html
      .replace(/data-thumbs-context="[^"]*"/, '')
      .replace(/data-feedback-context="[^"]*"/, '')
      .replace(/\sid="[^"]*"/g, '')
      .replace(/name="[\w-]+"/g, 'name=""')
      .replace(/\s+/g, ' ');

  it('uses the gallery’s thumbs under Why it fits, with the open role as the context', () => {
    expect(thumbs).not.toBe('');
    expect(shape(thumbs)).toBe(shape(galleryThumbs));
    expect(thumbs).toContain('<legend class="field-label">Was this match right?</legend>');
    expect(thumbs).toContain('data-thumbs-context="Job match"');
    expect(script).toContain(
      code("fieldset.setAttribute('data-thumbs-context', `Job match: #{job.title}`);"),
    );
    expect(script).toContain('components?.init(fieldset);');
  });

  it('saves the answer in the page’s own store section, dated by the sample clock', () => {
    expect(script).toContain("store.update({ type: 'jobFeedback', jobId: job.id }, (next) => {");
    expect(script).toContain('...(next.jobFeedback ?? {}),');
    expect(script).toContain(
      "[job.id]: { value, reasons: value === 'no' ? reasons : [], date: store.today() },",
    );
    expect(script).toContain('const saved = job.feedback ?? null;');
    expect(script).toContain("detail.thumbs.addEventListener('jobdeputy:thumbs'");
    expect(textOf(main)).toContain('Saved in this browser only.');
  });

  it('carries the seed’s answers for the two roles you set aside', () => {
    const { store } = sampleStore();
    const dismissed = store.catalog().jobs.filter((job) => job.view === 'dismissed');
    expect(dismissed.map((job) => [job.id, job.feedback?.reasons])).toEqual([
      ['devtools-principal', ['Too senior']],
      ['identity-manager', ['Wrong place']],
    ]);
  });
});

describe('deep links and the filter bar', () => {
  it('reads ?view=, ?fit=, ?source=, and ?job=, and ?job= reveals its role', () => {
    expect(script).toContain("state.fit = FITS[requestedFit] ? requestedFit : '';");
    // Round 6 (R6-4): ?source= names one source or several (repeated, or comma separated), and
    // an unknown one is left out.
    expect(script).toContain(
      "const requestedSources = [...model.sourceSet(parameters.getAll('source'))];",
    );
    expect(script).toContain('state.sources = requestedSources.filter(knownSource);');
    expect(script).toContain('const target = jobFor(askedJob);');
    expect(script).toContain("if (state.fit && target.fit !== state.fit) state.fit = '';");
    expect(script).toMatch(
      /if \(state\.sources\.length && !state\.sources\.includes\(target\.source\)\) \{\s*state\.sources = runSources\(state\.run\);/,
    );
  });

  it('reads ?sort= and keeps every order in the address (round 6 part 3, T2-1 and T2-2)', () => {
    // The order is a filter like any other: the address carries it, so a link and a reload show
    // the same list, and Best fit first (the usual order) leaves the address clean.
    expect(script).toContain("const requestedSort = parameters.get('sort') ?? '';");
    expect(script).toContain("state.sort = SORTS[requestedSort] ? requestedSort : 'fit';");
    expect(
      script.match(/setParameter\('sort', state\.sort === 'fit' \? null : state\.sort\);/g),
    ).toHaveLength(2);
    // Round 7 (R10-7): the search and the work style are in the address too, read back on load.
    expect(script).toContain("setParameter('q', state.query.trim() || null);");
    expect(script).toContain("setParameter('workplace', state.workplace || null);");
    expect(script).toContain("state.query = (parameters.get('q') ?? '').trim().slice(0, 80);");
    expect(script).toContain("if (state.sort !== 'fit') url.set('sort', state.sort);");
    expect(constant<Record<string, string>>('SORTS')).toEqual({
      fit: 'Best fit first',
      newest: 'Newest first',
    });
    // Newest first is the store's foundAt, newest first (the model's own order).
    const { store } = sampleStore();
    const found = model
      .shown(store.catalog().jobs, 'all', NO_FILTERS, { sort: 'newest' })
      .map((job) => Date.parse(job.foundAt));
    expect(found).toEqual([...found].sort((a, b) => b - a));
  });

  it('opens a folded run by its old id (round 6 part 3, T2-3)', () => {
    // Keep watch's nightly check is one run since round 6 (D2): round 5's r10 was Microsoft's
    // half of it, so an old ?run=r10 link opens r9, the run it is part of, with its three roles.
    const { store } = sampleStore();
    expect(store.run('r10')).toMatchObject({ id: 'r9', aliasOf: 'r10' });
    expect(script).toContain("const runIdOf = (id) => (id ? (store?.run?.(id)?.id ?? id) : '');");
    expect(script).toContain(
      "const requestedRun = runSources(runIdOf(askedRun)).length ? runIdOf(askedRun) : '';",
    );
    expect(model.count(store.catalog().jobs, 'all', { ...NO_FILTERS, run: 'r9' })).toBe(3);
  });

  it('says so when a link names a role, a source, or a search that is not here (R9-2)', () => {
    // One calm notice over the band, under the intro, in view as the page opens (round 7, T7-4),
    // and said once; it stays while you work, so nothing above the list moves.
    const at = (needle: string) => main.indexOf(needle);
    expect(at('<!-- FlowRibbon: end -->')).toBeLessThan(at('id="jobs-missing"'));
    expect(at('id="jobs-missing"')).toBeLessThan(at('id="jobs-band"'));
    expect(main).toMatch(
      /<section\s+class="feedback-panel jobs-missing"\s+id="jobs-missing"\s+data-kind="notice"\s+hidden/,
    );
    expect(main).not.toContain('<p class="jobs-arrivals" id="jobs-missing"');
    expect(script).not.toMatch(/const restart = \(\) => \{[^}]*missing/);
    expect(script).toContain(
      "askedJob && !target ? ['a role', 'That role isn’t in your matches', 'Here are your roles.'] : null,",
    );
    expect(script).toContain(
      "? ['a source', 'That source isn’t one of yours', 'Here are your roles.']",
    );
    expect(script).toContain(
      "? ['a search', 'That search isn’t in your history', 'Here are your roles.']",
    );
    // A search that is still running says its roles come when it finishes; one that found none
    // here says that instead, so the words are never wrong about a real run.
    expect(script).toContain(
      "? ['a search', 'That search is still running', 'Here are your roles until it finishes.']",
    );
    expect(script).toContain(
      ": ['a search', 'That search found no new roles', 'Here are your roles.']",
    );
    expect(script).toContain('missingNotice.panel.hidden = false;');
    expect(script).toContain(code('announce(`#{title}. #{message}`);'));
    // Never for a link that names something real.
    expect(script).toContain('askedJob && !target');
  });

  it('filters live with the shared filter bar: search, Fit, Source, Work style, and Order (R10-7)', () => {
    // The bar sits under the views; the drawer, its chips, and Filters went.
    expect(main).toMatch(
      /<div\s+class="jobs-filter"\s+id="jobs-filter"\s+data-tour-step="3"\s+data-tour-title="Narrow the list here\."[^>]*><\/div>/,
    );
    expect(main).not.toMatch(
      /id="jobs-filters"|id="active-filters"|id="filters-open"|jobs-sheet|data-drawer-open/,
    );
    expect(script).toContain('bar = components.filterBar(filterHost, {');
    // Short enough for a phone's field beside Filters (round 7, T3-21).
    expect(script).toContain(
      "search: { label: 'Search roles', placeholder: 'Title, company, city' },",
    );
    expect(script).toContain(
      "{ name: 'fit', label: 'Fit', kind: 'choice', options: choiceOptions(FITS) },",
    );
    // "Fit: Any", as Source says it, so the row fits on one line (round 7).
    expect(script).toContain("{ value: '', label: 'Any' },");
    expect(script).toMatch(
      /const sourceFacet = \{\s*name: 'source',\s*label: 'Source',\s*kind: 'multi',\s*singular: 'source with roles',\s*plural: 'sources with roles',\s*countLabel: \['role', 'roles'\],\s*maxChips: SOURCE_CHIPS,/,
    );
    expect(constant<number>('SOURCE_CHIPS')).toBe(3);
    expect(script).toContain('options: choiceOptions(WORKPLACE),');
    expect(script).toContain(
      'options: Object.entries(SORTS).map(([value, label]) => ({ value, label })),',
    );
    // Every change applies at once (the bar says the result once); choosing sources leaves a run.
    expect(script).toMatch(/if \(!sameSet\(sources, barSources\(\)\)\) \{\s*state\.run = '';/);
    expect(script).toContain('applyFilters(false);');
    // Each choice counts its roles in the view under the other filters; the source list is the
    // sources with roles there (and a picked one), in the Dashboard's colours.
    expect(script).toContain(
      'model.count(catalog.jobs, state.view, { ...others, [name]: value }),',
    );
    expect(script).toContain(
      '[...model.sourceCounts(catalog.jobs, state.view, filters(), state.sources)].map(',
    );
    expect(script).toContain('count, tone: sourceToneOf(id) ?? undefined }),');
    expect(script).toContain('bar.setResult(rows.length, total);');
    // The page shows its own filters in the bar (a link, the fit key, Show only those, Clear) and
    // keeps them in the address itself; the bar writes none.
    expect(script).toContain('if (differs) bar.set(wanted);');
    expect(script).not.toMatch(/param: '(?:q|fit|source|workplace|sort)'/);
    // Several sources write one ?source= each; a search that checked several stands for them all.
    expect(script).toContain('setSourceParameters(addressSources(state.sources, state.run));');
    expect(script).toContain(
      'return run && checked.length > 1 && sameSet(sources, checked) ? [] : sources;',
    );
    expect(script).toContain("for (const id of ids) url.searchParams.append('source', id);");
  });

  it('says when the list is one search’s roles: one chip under the filters, with × (T7-5)', () => {
    // "Search at 02:02 · 2 sources" in the shared chip's look, at the top of the key row under the
    // filter bar, so the run's words are in the first view; Source says Any while it shows.
    expect(main).toMatch(
      /<ul class="multi-select-chips jobs-run-chips" id="jobs-run-line" aria-label="The search shown" hidden>\s*<li>\s*<button class="compact-action multi-select-chip" id="jobs-run-clear" type="button">\s*<span class="multi-select-chip-name" id="jobs-run-words"><\/span\s*><svg class="multi-select-chip-icon"/,
    );
    const at = (needle: string) => main.indexOf(needle);
    expect(at('id="jobs-filter"')).toBeLessThan(at('id="jobs-run-line"'));
    expect(at('id="jobs-run-line"')).toBeLessThan(at('id="fit-key"'));
    expect(script).toContain(code('const words = `#{runLabel(state.run)}#{many}`;'));
    expect(script).toContain(
      code("runLine.clear.setAttribute('aria-label', `Remove #{words}: show every role`);"),
    );
    expect(script).toContain('const barSources = () => (wholeRun() ? [] : [...state.sources]);');
    expect(script).toContain('source: barSources(),');
    expect(script).toMatch(
      /runLine\.clear\.addEventListener\('click', \(\) => \{\s*if \(wholeRun\(\)\) state\.sources = \[\];\s*state\.run = '';/,
    );
    expect(script).toContain(
      code("const runLabel = (id) => (runWhen(id) ? `Search #{runWhen(id)}` : 'One search');"),
    );
  });

  it('lists only the sources with roles in the view, and a picked one with none (UAT-D-15)', () => {
    type Counts = (
      jobs: Job[],
      view: View,
      filters: Partial<Filters>,
      picked?: string[],
    ) => Map<string, number>;
    const sourceCounts = (model as unknown as { sourceCounts: Counts }).sourceCounts;
    const { store } = sampleStore();
    const check = (label: string) => {
      const { jobs, sources } = store.catalog();
      for (const view of VIEW_IDS) {
        const counts = sourceCounts(jobs, view, NO_FILTERS);
        // Every listed source has roles in the view; every source with roles there is listed.
        for (const [id, count] of counts) {
          expect(count, `${label} ${view} ${id}`).toBe(
            model.count(jobs, view, { ...NO_FILTERS, source: id }),
          );
          expect(count, `${label} ${view} ${id}`).toBeGreaterThan(0);
        }
        const withRoles = new Set(
          jobs.filter((job) => model.inView(job, view)).map((j) => j.source),
        );
        expect([...counts.keys()].sort(), `${label} ${view}`).toEqual([...withRoles].sort());
      }
      // A source with no roles (Acme needs attention) is left out, unless an address picked it.
      expect(sources.some((source) => source.id === 'acme')).toBe(true);
      expect(sourceCounts(jobs, 'all', NO_FILTERS).has('acme'), label).toBe(false);
      expect(sourceCounts(jobs, 'all', NO_FILTERS, ['acme']).get('acme'), label).toBe(0);
      // The other filters narrow it; the sources and the run do not.
      const strong = sourceCounts(jobs, 'all', { ...NO_FILTERS, fit: 'strong' });
      for (const [id, count] of strong) {
        expect(count).toBe(model.count(jobs, 'all', { ...NO_FILTERS, fit: 'strong', source: id }));
      }
      expect(sourceCounts(jobs, 'all', { ...NO_FILTERS, source: 'google', run: 'r9' }).size).toBe(
        sourceCounts(jobs, 'all', NO_FILTERS).size,
      );
      return sourceCounts(jobs, 'all', NO_FILTERS).size;
    };
    // The usual sample: the 5 sources the Dashboard's Matches by source shows.
    expect(check('usual')).toBe(5);
    // The Large account demo: the Dashboard's "Top 5 of 112 sources", not 113 with Acme.
    (store as unknown as { setScaleDemo(mode: string | null): unknown }).setScaleDemo('large');
    expect(store.catalog().jobs.length).toBeGreaterThan(900);
    expect(check('large')).toBe(112);
  });

  it('counts several sources together, with no store figure for the mix', () => {
    const { store } = sampleStore();
    const jobs = store.catalog().jobs;
    expect([...model.sourceSet(['google,stripe', 'all', '', ' amazon '])]).toEqual([
      'google',
      'stripe',
      'amazon',
    ]);
    expect(model.sourceSet('all').size).toBe(0);
    const two = { ...NO_FILTERS, source: ['google', 'stripe'] as unknown as string };
    for (const view of VIEW_IDS) {
      expect(model.count(jobs, view, two), view).toBe(
        model.count(jobs, view, { ...NO_FILTERS, source: 'google' }) +
          model.count(jobs, view, { ...NO_FILTERS, source: 'stripe' }),
      );
      expect(model.countKey(view, two), view).toBeNull();
    }
    expect(model.count(jobs, 'all', two)).toBe(
      model.count(jobs, 'new', two) +
        model.count(jobs, 'tracked', two) +
        model.count(jobs, 'dismissed', two),
    );
    // One source in a list is the same filter as the source alone, with its store figure.
    const one = { ...NO_FILTERS, source: ['google'] as unknown as string };
    expect(model.countKey('all', one)).toBe('jobs.source.google');
    expect(model.count(jobs, 'all', one)).toBe(store.metric('jobs.source.google'));
  });

  it('lands a run that checked several sources on exactly the roles it found (D2)', () => {
    const { store } = sampleStore();
    const jobs = store.catalog().jobs;
    const run = store.run('r9') as unknown as {
      sourceIds: string[];
      kept: number;
      sources: Array<{ sourceId: string; kept: number; jobIds: string[] }>;
    };
    expect(run.sourceIds).toEqual(['google', 'microsoft']);
    const found = run.sources.flatMap((part) => part.jobIds).sort();
    const rows = model.shown(jobs, 'all', {
      ...NO_FILTERS,
      source: run.sourceIds as unknown as string,
      run: 'r9',
    });
    expect(rows.map((job) => job.id).sort()).toEqual(found);
    expect(rows).toHaveLength(run.kept);
    // One of its sources alone (Searches links ?view=all&source=microsoft&run=r9, B2's request):
    // that source's part.
    for (const part of run.sources) {
      const only = model.shown(jobs, 'all', { ...NO_FILTERS, source: part.sourceId, run: 'r9' });
      expect(only.map((job) => job.id).sort(), part.sourceId).toEqual([...part.jobIds].sort());
    }
    // The page reads a run's sources from the roles it found, in the order the run checked them.
    expect(script).toContain('const order = store?.run?.(id)?.sourceIds ?? [];');
    expect(script).toContain('state.sources = runSources(run);');
  });

  it('names each source in the Dashboard’s colour for it, and Other in Other’s', () => {
    expect(script).toContain('const sourceToneOf = (id) => store?.sourceTone?.(id) ?? null;');
    // Other is the shared hatched grey, apart from the top five's plain grey (A3's tone).
    expect(sourceFor('app-components.css')).toContain('.tone-label[data-tone="other"]::before');
    // The store's key: the top five sources by found roles have a colour; every other is Other.
    const { store } = sampleStore();
    const colours = (
      store as unknown as {
        sourceColours(): { top: string[]; tones: Record<string, string> };
        sourceTone(id: string): string;
      }
    ).sourceColours();
    expect(colours.top).toHaveLength(5);
    for (const source of store.catalog().sources) {
      const tone = (store as unknown as { sourceTone(id: string): string }).sourceTone(source.id);
      expect(tone, source.id).toBe(colours.tones[source.id] ?? 'other');
    }
  });

  it('explains a source with no roles here: still searching, needs attention, or archived', () => {
    expect(script).toContain(code('title: `Your deputy is still searching #{name}`,'));
    expect(script).toContain(code('title: `#{name} needs attention`,'));
    expect(script).toContain(code('title: `#{name} is archived`,'));
    expect(script).toContain("href: './searches-preview.html?view=archived'");
    expect(script).toContain(
      code('const card = `./searches-preview.html?source=#{encodeURIComponent(id)}`;'),
    );
  });
});

describe('the shared store: decisions (round 2) and reactions (R3-8)', () => {
  const entryFor = constant<(job: Job, today: string) => Record<string, unknown>>('entryFor');

  it('adds a role to Applications exactly as Shortlist did, and Applications shows it', () => {
    expect(script).toContain('store.addApplication(entryFor(job, store.today()));');
    expect(script).toContain("store.setJob(job.id, 'shortlisted');");
    const { store } = sampleStore();
    const job = store.catalog().jobs.find((item) => item.id === 'payments-infra');
    if (!job) throw new Error('payments-infra missing');
    const entry = entryFor(job, store.today());
    expect(entry).toMatchObject({
      id: 'payments-infra',
      jobId: 'payments-infra',
      role: 'Software Engineer, Payments Infrastructure',
      company: 'Stripe',
      workStyle: 'Hybrid',
      source: 'Stripe Jobs',
      fit: 'good',
      stage: 'shortlisted',
      materials: 'none',
      timeline: [
        { date: '2026-09-23', label: 'Found on Stripe Jobs', by: 'deputy' },
        { date: '2026-10-02', label: 'Shortlisted', by: 'you' },
      ],
    });
    const before = store.stageCounts().shortlisted ?? 0;
    store.addApplication(entry);
    store.setJob(job.id, 'shortlisted');
    expect(store.stageCounts().shortlisted).toBe(before + 1);
    expect(store.get().applications[0]).toMatchObject({
      id: 'payments-infra',
      stage: 'shortlisted',
    });
    expect(store.get().jobs).toEqual({
      'devtools-principal': 'dismissed',
      'identity-manager': 'dismissed',
      'payments-infra': 'shortlisted',
    });
    // The role moves from New to In Applications; All still holds it, and the views add up.
    const jobs = store.catalog().jobs;
    expect(jobs.find((item) => item.id === 'payments-infra')?.view).toBe('tracked');
    expect([
      store.metric('jobs.found'),
      store.metric('jobs.new'),
      store.metric('jobs.tracked'),
      store.metric('jobs.dismissed'),
    ]).toEqual([27, 19, 6, 2]);
    expect(model.count(jobs, 'tracked', NO_FILTERS)).toBe(6);
  });

  it('keeps every seeded application that came from a search as a found role, at its fit', () => {
    const { store } = sampleStore();
    const jobs = store.catalog().jobs;
    const fromSearches = store.get().applications.filter((item) => item.jobId);
    expect(fromSearches.map((app) => app.id).sort()).toEqual(
      ['amazon-sde2', 'cloud-reliability', 'devex', 'search-infra', 'workspace'].sort(),
    );
    for (const app of fromSearches) {
      const job = jobs.find((item) => item.id === app.jobId);
      expect(job, `${app.id} is a found role`).toBeDefined();
      expect(job?.fit).toBe(app.fit);
      expect(job?.applicationId).toBe(app.id);
    }
  });

  it('sets a role aside and brings it back in this browser only', () => {
    expect(script).toContain("store.setJob(job.id, 'dismissed');");
    expect(script).toContain('delete next.jobs[id];');
    expect(script).toContain("note: 'It stays out of To review. Saved in this browser only.',");
    const { store } = sampleStore();
    store.setJob('payments-infra', 'dismissed');
    expect(store.metric('jobs.dismissed')).toBe(3);
    store.update({ type: 'job', jobId: 'payments-infra', status: null }, (next) => {
      delete (next.jobs as Record<string, string>)['payments-infra'];
    });
    expect([store.metric('jobs.new'), store.metric('jobs.dismissed')]).toEqual([20, 2]);
  });

  it('reacts once to each decision: added, dismissed, and saved for a restore or an answer', () => {
    const reactions = [
      ...script.matchAll(/deputy\?\.react\?\.\('(\w+)'(?:, \{ speech: (.+?) \})?\);/g),
    ].map((match) => [match[1], match[2] ?? null]);
    expect(reactions).toEqual([
      ['found', code("`#{counted(jobs.length, 'new role')} for you.`")],
      // A decision the store refused, and an undo it refused (round 7, J2).
      ['error', null],
      ['error', null],
      ['saved', code('`It’s back in #{VIEWS[d.view]}.`')],
      ['saved', "'Noted, in this browser only.'"],
    ]);
    // Each decision reacts once by its kind: added, dismissed, and saved for a restore.
    expect(script).toContain(
      "const REACTIONS = { added: 'added', dismissed: 'dismissed', restored: 'saved' };",
    );
    expect(script).toContain(
      "deputy?.react?.(REACTIONS[kind], kind === 'restored' ? { speech: 'It’s back in To review.' } : undefined);",
    );
    // Never a flash for the same action (handoff 2).
    expect(script).not.toMatch(/deputy\?\.flash\(/);
    for (const [, speech] of reactions) {
      if (speech) expect(words(speech.replace(/[`'#{}()]/g, ' ')), speech).toBeLessThanOrEqual(8);
    }
    // Only the answer reacts; a reason changed after it is saved quietly.
    expect(script).toMatch(
      /if \(change === 'answer'\) \{\s*deputy\?\.react\?\.\('saved', \{ speech: 'Noted, in this browser only\.' \}\);/,
    );
  });
});

describe('a search that finishes while you look (finding 19)', () => {
  it('adds its roles to every count and marks them New, without a reload', async () => {
    const { store, clock } = sampleStore();
    const changes: Array<{ type: string; stage?: string }> = [];
    store.subscribe((_state, change) => changes.push(change));
    const before = store.catalog().jobs;
    expect(before.filter(isFresh)).toEqual([]);
    clock.now += 101_000;
    const after = store.catalog().jobs;
    await flush();
    expect(changes).toMatchObject([{ type: 'run', stage: 'complete' }]);
    const fresh = after.filter(isFresh).map((job) => job.id);
    expect(fresh.sort()).toEqual(['amazon-sdm-ads', 'amazon-search-relevance']);
    expect(model.shown(after, 'new', NO_FILTERS).filter(isFresh)).toHaveLength(2);
    // Found (the band), To review and Not for me (the tabs), and In Applications (the band).
    const views: View[] = ['all', 'new', 'tracked', 'dismissed'];
    const counts = views.map((view) => model.count(after, view, NO_FILTERS));
    expect(counts).toEqual([29, 22, 5, 2]);
    for (const view of views) {
      expect(store.metric(model.countKey(view, NO_FILTERS) ?? '')).toBe(
        model.count(after, view, NO_FILTERS),
      );
    }
    expect(store.metric('jobs.fit.strong')).toBe(5);
    expect(model.count(after, 'all', { ...NO_FILTERS, source: 'amazon' })).toBe(4);
  });

  it('redraws from the store, welcomes the new rows once, and lets the deputy say how many', () => {
    expect(script).toContain('const arrived = known ? ids.filter((id) => !known.has(id)) : [];');
    expect(script).toContain('if (arrived.length) welcome(arrived);');
    expect(script).toMatch(/components\?\.flagNew\(/);
    expect(script).toContain(
      code("announce(`#{counted(jobs.length, 'new role')} from #{from}#{where}: #{titles}.`);"),
    );
    // From a later page the announcement says where they are, as the line above the list does.
    expect(script).toContain(
      "const where = jobs.every((job) => waiting.includes(job)) ? ' on page 1' : '';",
    );
    // The New badge, for roles a search found in this browser and still waiting on you.
    expect(script).toContain("const isFresh = (job) => Boolean(job.fresh) && job.view === 'new';");
    expect(script).toContain("'New',");
  });

  it('lands a run’s "N new roles" on those N, and names the latest search in the band (UAT-D2-4)', async () => {
    const { store, clock } = sampleStore();
    clock.now += 101_000;
    const after = store.catalog().jobs;
    await flush();
    const run = store.run('r11');
    expect(run?.kept).toBe(2);
    const ids = (rows: Job[]) => rows.map((job) => job.id).sort();
    // The source alone (the link before round 5's fix) also holds Amazon's older waiting role,
    // found by an earlier run and never marked New.
    const bySource = model.shown(after, 'new', { ...NO_FILTERS, source: 'amazon' });
    expect(ids(bySource)).toEqual([
      'amazon-principal',
      'amazon-sdm-ads',
      'amazon-search-relevance',
    ]);
    expect(bySource.find((job) => job.id === 'amazon-principal')).toMatchObject({
      runId: 'r4',
      fresh: false,
    });
    // The run lists exactly the roles it found, every one marked New, whatever the view's size.
    const byRun = model.shown(after, 'new', { ...NO_FILTERS, source: 'amazon', run: 'r11' });
    expect(ids(byRun)).toEqual([...(run?.jobIds ?? [])].sort());
    expect(byRun.every(isFresh)).toBe(true);
    expect(model.count(after, 'all', { ...NO_FILTERS, run: 'r11' })).toBe(run?.kept);
    expect(model.count(after, 'new', { ...NO_FILTERS, run: 'r4' })).toBe(
      after.filter((job) => job.runId === 'r4' && job.view === 'new').length,
    );
    // One run's counts are no store figure, so they carry no metric.
    expect(model.countKey('new', { ...NO_FILTERS, source: 'amazon', run: 'r11' })).toBeNull();
    // Round 7 (J1, D7): the band names the latest search that kept roles, what it found and
    // where, with Show only those; it is the store's newest bar, the Amazon run once it ends.
    const series = (
      store as unknown as {
        newRolesSeries(): { bars: Array<{ id: string; total: number; metric: string }> };
      }
    ).newRolesSeries();
    const latest = series.bars.filter((bar) => bar.id !== 'deleted').at(-1);
    expect([latest?.id, latest?.total, latest?.metric]).toEqual(['r11', 2, 'runs.r11.kept']);
    expect(store.metricText('runs.r11.kept')).toBe('2');
    expect(script).toContain(
      "const bar = (series?.bars ?? []).filter((item) => item.id !== 'deleted').at(-1) ?? null;",
    );
    expect(script).toContain(code('const href = `./jobs-preview.html?#{runParameters(bar.id)}`;'));
    // The marked line went with it: the band says what is new, once.
    expect(main).not.toContain('id="jobs-marked"');
    expect(script).not.toContain('model.marked(');
  });

  it('reads ?run= with its source, and words the line above the list', () => {
    // Round 6 (D2): a run may check several sources (Keep watch checks every watched source in
    // one run), so ?run= keeps every source it checked, or the ones asked for that it checked.
    // Round 6 part 3 (T2-3): the id the link names is read through the store, so an old run's id
    // opens the run it is part of.
    expect(script).toMatch(
      /const requestedRun = runSources\(runIdOf\(askedRun\)\)\.length \? runIdOf\(askedRun\) : '';/,
    );
    expect(script).toContain('const asked = state.sources.filter((id) => checked.includes(id));');
    expect(script).toContain('if (!state.sources.length || asked.length) {');
    expect(script).toContain('state.sources = asked.length ? asked : checked;');
    expect(script).toContain("if (state.run && target.runId !== state.run) state.run = '';");
    // A search of several sources, with all of them, is one chip ("Search at 02:02 · 2
    // sources"), and its × shows every source again.
    expect(script).toContain(
      code("const many = wholeRun() ? ` · #{counted(state.sources.length, 'source')}` : '';"),
    );
    expect(script).toContain("setParameter('run', state.run || null);");
    expect(script).toContain("if (state.run) url.set('run', state.run);");
    // Picking sources in the filter bar leaves the run.
    expect(script).toMatch(
      /if \(!sameSet\(sources, barSources\(\)\)\) \{\s*state\.run = '';\s*state\.sources = sources;\s*\}/,
    );
    expect(script).toContain(
      code("const runLabel = (id) => (runWhen(id) ? `Search #{runWhen(id)}` : 'One search');"),
    );
    // Show only those in the band narrows to that search in place; its chip takes the focus.
    expect(script).toMatch(
      /band\.newestLink\.addEventListener\('click', \(event\) => \{\s*const run = band\.newestLink\.dataset\.run;/,
    );
    expect(script).toMatch(/applyFilters\(\);\s*runLine\.clear\.focus\(\);/);
  });

  it('shows the running search above the list, as a status, never a live region', () => {
    const line = main.match(/<p\s+class="jobs-live"[\s\S]*?<\/p>/)?.[0] ?? '';
    expect(line).toContain('<span class="live-pill is-live"');
    expect(line).not.toMatch(/role="status"|aria-live/);
    expect(script).toContain(
      code("const word = run ? `Live · searching #{run.sourceName}` : 'Live';"),
    );
  });
});

describe('pages (round 4 brief 4.5, finding J1; round 7, R10-6)', () => {
  const list = main.slice(
    main.indexOf('<div class="jobs-list" id="jobs-list">'),
    main.indexOf('<article class="jobs-detail"'),
  );
  const SIZES = [12, 24, 48];
  const pageWords = constant<(page: number, pages: number) => string>('pageWords');

  it('pages by the size you choose: 12, 24, or 48 roles, 12 until you do, at every width (R10-6)', () => {
    expect(model.sizes).toEqual([12, 24, 48]);
    expect([
      model.pageSize(),
      model.pageSize(24),
      model.pageSize('48'),
      model.pageSize(10),
    ]).toEqual([12, 24, 48, 12]);
    // Round 7 (R10-6): the shared pagination's size choice; the address keeps a size other than
    // the first (?size=), and a resize never changes it (the width no longer sizes a page).
    expect(script).toContain('const PAGE_SIZES = model.sizes;');
    expect(script).toContain('const pageSizeNow = () => model.pageSize(state.chosen);');
    expect(script).toContain(
      'state.chosen = PAGE_SIZES.includes(requestedSize) && requestedSize !== PAGE_SIZES[0] ? requestedSize : null;',
    );
    expect(script).toContain("setParameter('size', state.chosen ? String(size) : null);");
    expect(script).toContain("if (state.chosen) url.set('size', String(state.chosen));");
    expect(script).not.toMatch(/PAGE_QUERIES|matchMedia/);
  });

  it('counts the pages of every view on the seed and after the live search', () => {
    const { store, clock } = sampleStore();
    const views: View[] = ['all', 'new', 'tracked', 'dismissed'];
    const pagesAt = (jobs: Job[]) =>
      Object.fromEntries(
        views.map((view) => [
          view,
          SIZES.map((size) => model.pageCount(model.count(jobs, view, NO_FILTERS), size)),
        ]),
      );
    expect(pagesAt(store.catalog().jobs)).toEqual({
      all: [3, 2, 1],
      new: [2, 1, 1],
      tracked: [1, 1, 1],
      dismissed: [1, 1, 1],
    });
    clock.now += 101_000;
    expect(pagesAt(store.catalog().jobs)).toEqual({
      all: [3, 2, 1],
      new: [2, 1, 1],
      tracked: [1, 1, 1],
      dismissed: [1, 1, 1],
    });
    // An empty view still has one page (and no pages to show).
    expect(model.pageCount(0, 8)).toBe(1);
  });

  it('splits every view into pages that hold each role once, in the list’s order', () => {
    const { store } = sampleStore();
    const jobs = store.catalog().jobs;
    const filterSets: Array<Partial<Filters>> = [
      NO_FILTERS,
      { ...NO_FILTERS, fit: 'stretch' },
      { ...NO_FILTERS, source: 'google' },
    ];
    for (const view of VIEW_IDS) {
      for (const filters of filterSets) {
        const rows = model.shown(jobs, view, filters);
        for (const size of SIZES) {
          const pages = model.pageCount(rows.length, size);
          const joined = Array.from({ length: pages }, (_, index) =>
            model.onPage(rows, index + 1, size),
          );
          for (const [index, page] of joined.entries()) {
            const last = index === pages - 1;
            if (!last) expect(page, `${view} ${size}`).toHaveLength(size);
            else expect(page.length).toBeLessThanOrEqual(size);
          }
          expect(joined.flat().map((job) => job.id)).toEqual(rows.map((job) => job.id));
        }
      }
    }
    // Page 1 of All on a phone is the eight best fits.
    const all = model.shown(jobs, 'all', NO_FILTERS);
    expect(model.onPage(all, 1, 8).map((job) => job.id)).toEqual(
      all.slice(0, 8).map((job) => job.id),
    );
  });

  it('lands any page asked for on one that exists (?page=, clamped)', () => {
    expect(model.clampPage(2, 27, 12)).toBe(2);
    expect(model.clampPage(99, 27, 12)).toBe(3);
    expect(model.clampPage(0, 27, 8)).toBe(1);
    expect(model.clampPage(-4, 27, 8)).toBe(1);
    expect(model.clampPage('abc', 27, 8)).toBe(1);
    expect(model.clampPage(2.7, 27, 8)).toBe(2);
    expect(model.clampPage(3, 0, 8)).toBe(1);
    expect(script).toContain(
      "state.page = Number.parseInt(parameters.get('page') ?? '', 10) || 1;",
    );
    expect(script).toContain('state.page = model.clampPage(state.page, rows.length, size);');
    // The address keeps the page shown, and page 1 leaves it out.
    expect(script).toContain('const wanted = state.page > 1 ? String(state.page) : null;');
    expect(script).toContain("setParameter('page', wanted);");
  });

  it('opens the page that holds a ?job= role, whatever page was asked for', () => {
    const { store } = sampleStore();
    const all = model.shown(store.catalog().jobs, 'all', NO_FILTERS);
    for (const size of SIZES) {
      for (const [index, job] of all.entries()) {
        const page = model.pageOf(index, size);
        expect(model.onPage(all, page, size), `${job.id} at ${size}`).toContain(job);
      }
    }
    expect(model.pageOf(26, 12)).toBe(3);
    expect(script).toContain('render({ anchor: target?.id ?? null });');
    expect(script).toContain('if (index >= 0) state.page = model.pageOf(index, size);');
  });

  it('puts the roles a search adds while you look first, so they join page 1', () => {
    const { store, clock } = sampleStore();
    clock.now += 101_000;
    const jobs = store.catalog().jobs;
    const arrived = new Set(['amazon-search-relevance', 'amazon-sdm-ads']);
    const ranked = model.shown(jobs, 'all', NO_FILTERS);
    // Ranked alone, the Good fit lands on page 2 of 12 roles a page.
    expect(
      model.pageOf(
        ranked.findIndex((job) => job.id === 'amazon-sdm-ads'),
        12,
      ),
    ).toBe(2);
    const shown = model.shown(jobs, 'all', NO_FILTERS, { first: arrived });
    expect(shown.slice(0, 2).map((job) => job.id)).toEqual([
      'amazon-search-relevance',
      'amazon-sdm-ads',
    ]);
    // The others keep their order.
    expect(shown.slice(2)).toEqual(ranked.filter((job) => !arrived.has(job.id)));
    expect(script).toContain('first: arrivals });');
    expect(script).toMatch(
      /const restart = \(\) => \{[\s\S]*?arrivals\.clear\(\);\s*unseen\.clear\(\);\s*state\.page = 1;/,
    );
  });

  it('uses the shared pagination: a pager over the rows and the full one after them, with the range and the page size (R10-6)', () => {
    // Both hosts sit inside the list they page: the compact pager above the panels, the full one
    // after them; the component draws them (one state for both) and the page gives them room.
    expect(list.indexOf('<div class="jobs-pages-top" id="jobs-pages-top"></div>')).toBeGreaterThan(
      -1,
    );
    expect(list.indexOf('id="jobs-pages-top"')).toBeLessThan(list.indexOf('id="jobs-panel-new"'));
    expect(list.indexOf('id="jobs-pages"')).toBeGreaterThan(
      list.lastIndexOf('data-empty="dismissed"'),
    );
    expect(main).not.toMatch(/jobs-pages-count|jobs-pages-numbers|data-page-step/);
    expect(script).toMatch(
      /pager = components\.pagination\(pagesHost, \{\s*\.\.\.options,\s*label: 'Pages of roles',\s*noun: \['role', 'roles'\],\s*top: pagesTop,\s*sizes: PAGE_SIZES,\s*list: jobsList,\s*href: pageHref,\s*channel: announcement,\s*onChange: \(page\) => goToPage\(page, \{ fromPager: true \}\),\s*onSize: \(size\) => changeSize\(size, \{ fromPager: true \}\),\s*\}\);/,
    );
    // Drawn again only when what it shows changes (R9-3).
    expect(script).toContain('if (pagerDrawn === signature) return;');
    // Its range is words, never a tab's count, and carries no metric (R3-4).
    expect(script).not.toMatch(/Showing|roles? \$\{[^}]+\} of/);
    // Hidden while a view fits on one page.
    expect(style).toContain('.jobs-pages:not(:has(> .pagination:not([hidden]))) {');
  });

  it('moves focus to the new page’s first role, under the chrome, and says the page once', () => {
    const goToPage = script.slice(
      script.indexOf('const goToPage = (page, { fromPager = false } = {}) => {'),
    );
    const body = goToPage.slice(0, goToPage.indexOf('\n        };'));
    expect(body).toContain("const link = lists[state.view].querySelector('.jobs-row-link');");
    expect(body).toContain("jobsList.scrollIntoView({ block: 'start', behavior: 'instant' });");
    expect(body).toContain('link.focus({ preventScroll: true });');
    // The shared pagination brings the list's top back and says the page itself; Go to page 1
    // does both here.
    expect(body).toContain(
      code(
        'if (!fromPager) announce(`#{pageWords(state.page, model.pageCount(rows.length, size))}.`);',
      ),
    );
    expect(body).toContain(
      'if (!fromPager && (top < chromeOffset() || bottom > window.innerHeight)) {',
    );
    expect(body.match(/announce\(/g)).toHaveLength(1);
    expect(pageWords(2, 3)).toBe('Page 2 of 3');
    expect(body).toMatch(/state\.page = target;\s*state\.active = null;/);
  });

  it('starts again on page 1 when the view or a filter changes, and says how many pages', () => {
    expect(script).toContain(
      code("announce(`#{VIEWS[view]}: #{counted(count, 'role')}.#{pagesSaid(count)}`);"),
    );
    expect(script).toContain(
      code(": `#{VIEWS[state.view]}: #{counted(count, 'role')} match.#{pagesSaid(count)}`,"),
    );
    expect(script).toContain(code("return pages > 1 ? ` #{pageWords(1, pages)}.` : '';"));
  });

  it('keeps the role you are on, or the open one, on screen when the page size changes', () => {
    expect(script).toContain('const resized = state.size > 0 && size !== state.size;');
    expect(script).toContain(
      'const keep = anchor ?? (resized ? (focusedRowId() ?? state.active) : null);',
    );
    // A change of the sample world keeps the page, or the page of the row you are on.
    expect(script).toContain('render({ anchor: focusedRowId() });');
  });

  it('names new roles waiting on page 1 from a later page, with the way there, quietly', () => {
    const line = main.match(/<p class="jobs-arrivals"[\s\S]*?<\/p>/)?.[0] ?? '';
    expect(line).toMatch(/^<p class="jobs-arrivals" id="jobs-arrivals" hidden>/);
    expect(line).toContain(
      '<a class="compact-action" id="jobs-arrivals-link" href="./jobs-preview.html" data-page="1">Go to page 1</a>',
    );
    expect(line).not.toMatch(/role="status"|aria-live/);
    // Round 7: the latest search's count is the band's, so this line says it in words.
    expect(script).toContain("? 'The role a search just found is on page 1.'");
    expect(script).toContain(": 'The roles a search just found are on page 1.';");
    expect(script).toContain(
      'waiting = state.page > 1 ? rows.filter((job) => unseen.has(job.id)) : [];',
    );
    expect(script).toMatch(
      /arrivalsLine\.link\.addEventListener\('click', \(event\) => \{[\s\S]*?goToPage\(1\);/,
    );
    // They light up once, when their page is first in view.
    expect(script).toContain('components?.flagNew(landed.map((job) => rowElements.get(job.id)));');
  });
});

describe('the tour (R3-6)', () => {
  const steps = [
    ...source.matchAll(
      /data-tour-step="(\d+)"\s+data-tour-title="([^"]+)"\s+data-tour-text="([^"]+)"/g,
    ),
  ].map((match) => [match[1] ?? '', match[2] ?? '', match[3] ?? ''] as const);

  it('explains the band, the queue, the filters, the fit colours, the decisions, and Why it fits', () => {
    // The engine follows the numbers, so the pages (after the list) come last.
    const ordered = [...steps].sort((a, b) => Number(a[0]) - Number(b[0]));
    // Round 6 (R6-2, finding G6): the deputy gives the tour, so each title is his speech line
    // (first person or addressed to you, at most six words) and each body says what he does.
    // Round 7: the band leads, and the views are the review queue.
    expect(ordered.map((step) => [step[0], step[1]])).toEqual([
      ['1', 'Here is what I found.'],
      ['2', 'Decide on each role here.'],
      ['3', 'Narrow the list here.'],
      ['4', 'Each colour is a fit.'],
      ['6', 'The call is yours.'],
      ['7', 'Here is why it fits.'],
      ['8', 'I split long lists into pages.'],
    ]);
    for (const [, title, text] of steps) {
      expect(words(title), title).toBeLessThanOrEqual(6);
      expect(words(text), title).toBeLessThanOrEqual(30);
      // The body is the deputy speaking: it says what he does ("I ...").
      expect(text, title).toMatch(/\bI\b/);
      expect(`${title} ${text}`, title).not.toMatch(/your deputy|[–—]/i);
    }
    // Step 5 rings the first role of the view, whichever it is.
    expect(script).toContain("first.setAttribute('data-tour-step', '5');");
    expect(script).toContain(
      "first.setAttribute('data-tour-title', 'I put the best fits first.');",
    );
    expect(script).toContain(
      "'Each row shows the fit, the company, and the place. Open a role to see why I ' +",
    );
    // The fit key's step names every colour in his words.
    expect(script).toContain(
      code('`I colour every role by its fit: #{colours}. Point at a colour to read what it ` +'),
    );
  });

  it('never starts by itself: ?tour=1, Show me around, and Take the tour start it', () => {
    expect(script).not.toMatch(/tour\.(?:start|maybeStart)\(/);
    expect(main).toContain('data-tour-open hidden>Take the tour</button>');
  });
});

describe('phones and tablets', () => {
  it('lists first, then opens a role as its own view with a way back', () => {
    // The split needs about 300px for the list beside the role; narrower, the role is its own view.
    const split = Number(style.match(/@container jobs \(min-width: (\d+)px\)/)?.[1]);
    const stacked = Number(
      style.match(/@container jobs \(max-width: (\d+)px\) \{\s*\.jobs-layout/)?.[1],
    );
    expect(split).toBeGreaterThanOrEqual(780);
    expect(stacked).toBe(split - 1);
    expect(style).toMatch(
      /@container jobs \(max-width: \d+px\) \{[\s\S]*?\.jobs-surface:not\(\[data-pane="detail"\]\) \.jobs-detail,\s*\.jobs-surface\[data-pane="detail"\] \.jobs-list,/,
    );
    expect(main).toContain(
      '<button class="compact-action jobs-back" id="back-to-list" type="button">',
    );
    expect(script).toContain(
      "window.history.pushState({ jobsPane: 'detail', job: id }, '', addressOf(url));",
    );
    // The address keeps a bare flag bare (?skipLoader, never ?skipLoader=; round 7, T3-20).
    const addressOf = constant<(url: URL) => string>('addressOf');
    expect(addressOf(new URL('file:///b/jobs-preview.html?skipLoader=&fit=strong&job=a#x'))).toBe(
      '/b/jobs-preview.html?skipLoader&fit=strong&job=a#x',
    );
    expect(script).toContain("window.addEventListener('popstate'");
  });

  it('sets the four views two by two where a tab is too narrow for its longest word', () => {
    expect(style).toMatch(
      /@container jobs \(max-width: 420px\) \{\s*\.jobs-views-host > \.jobs-views \{\s*grid-auto-flow: row;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
  });

  it('names the quick decisions in words on touch screens, under the role on phone-width lists', () => {
    expect(style).toMatch(/\.jobs-action-word \{\s*display: none;\s*\}/);
    expect(style).toMatch(
      /@media \(hover: none\), \(pointer: coarse\) \{\s*\.jobs-action-word \{\s*display: inline;\s*\}\s*@container jobs-list \(max-width: 559px\) \{\s*\.jobs-row \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(style).toMatch(/\.jobs-row-end > \.compact-action \{\s*flex: 1 1 auto;/);
  });

  it('keeps the filter bar with the list: while a role is open as its own view, both step aside', () => {
    // Round 7 (R10-7): the drawer and its bottom sheet went; the filter bar sits over the list.
    expect(style).toMatch(
      /\.jobs-surface\[data-pane="detail"\] \.jobs-toolbar,\s*\.jobs-surface\[data-pane="detail"\] \.jobs-filter,\s*\.jobs-surface\[data-pane="detail"\] \.jobs-keyrow \{\s*display: none;/,
    );
    expect(style).not.toContain('jobs-sheet');
  });

  it('scrolls with the page’s scroll padding, never a hard-coded header height', () => {
    expect(script).toContain(
      'Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 89;',
    );
    expect(script).toContain(
      'const top = surface.getBoundingClientRect().top + window.scrollY - chromeOffset();',
    );
    expect(script).not.toMatch(/-\s*89\b|<\s*72\b|innerHeight - 89/);
  });
});

describe('deputy states', () => {
  it('ranks by default, and searches while a source you filtered to is being searched', () => {
    expect(source).toContain('data-deputy-page="jobs"');
    expect(source).toContain('data-deputy-state="rank"');
    expect(script).toContain("setDeputyPage(now ? 'search' : 'rank');");
    expect(script).toContain(
      'const now = state.sources.some((id) => Boolean(store?.liveRun(id)));',
    );
  });
});

describe('honest prototype', () => {
  it('labels the sample once on the surface and keeps the open role’s fit beside the marker', () => {
    expect(main.match(/<p class="sample-note[^"]*">[^<]+<\/p>/g)).toEqual([
      '<p class="sample-note jobs-surface-note">Sample data · not connected</p>',
    ]);
    expect(script).toMatch(
      /`Sample posting · first seen \$\{whenFound\(job\.foundAt\)\} on \$\{\s*job\.sourceName\s*\}`/,
    );
  });

  it('links postings only to the reserved example domain', () => {
    const links = [...source.matchAll(/https:\/\/[^\s"'`<)]+/g)].map((match) => match[0]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link, link).toMatch(/^https:\/\/jobs\.example\.com\//);
  });

  it('writes no dashes as punctuation and shows no prices', () => {
    const copy = `${textOf(main)} ${[...script.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((match) => match[1] ?? match[2]).join(' ')}`;
    expect(copy).not.toMatch(/[\u2013\u2014]/);
    expect(copy).not.toMatch(/\$\s?\d|per month|pricing/i);
  });
});
