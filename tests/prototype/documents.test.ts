import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Page guarantees for Résumés (brand/documents-preview.html), round 3 (brief 4.6, findings 21, 22,
// and 29): one default résumé and one default CV, a preview for every document, the drafts library
// with the shared list toolbar, readiness that says what your deputy looks for and what it found,
// keywords counted from the found roles, the Markdown templates with Upload your own, and the page
// setting. The page's pure blocks (SampleDocs and DocsModel) run here against the shared sample
// store, so every figure is checked against the store's own. Round 5 (R1): Download, PDF or
// Markdown, on each document and draft with the shared menu, and in the preview. Rendered checks
// (layout, focus, metrics, print, and the files Chrome saves) run in headless Chrome.

const repoRoot = resolve(import.meta.dirname, '../..');
const sourceFor = (file: string): string => readFileSync(resolve(repoRoot, 'brand', file), 'utf8');
const documents = sourceFor('documents-preview.html');
const materials = sourceFor('materials-preview.html');
const storeSource = sourceFor('sample-store.js');

const mainOf = (source: string): string => source.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? '';
const scriptOf = (source: string): string =>
  [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '').join('');
const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
const count = (source: string, pattern: RegExp): number => source.match(pattern)?.length ?? 0;
const blockOf = (source: string, name: string): string =>
  source.match(new RegExp(`// ${name}: start([\\s\\S]*?)// ${name}: end`))?.[1] ?? '';
// Code that reaches the page: the document, the window, or storage (comments are not code).
const pageAccess = (code: string): string[] =>
  code.replace(/\/\/.*$/gm, '').match(/\b(?:document|window)\s*\.|\blocalStorage\b/g) ?? [];
// Visible copy that names the Job matches page "Jobs" (round 1's name). "Amazon Jobs" is a
// source's name, and comments are not copy.
const jobsNames = (source: string): string[] => {
  const markup = textOf(source.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ''));
  const scripts = scriptOf(source).replace(/\/\/.*$/gm, '');
  return [
    ...(markup.match(/[^.]*\bJobs\b[^.]*/g) ?? []),
    ...(scripts.match(/'[^'\n]*\bJobs\b[^'\n]*'|`[^`\n]*\bJobs\b[^`\n]*`/g) ?? []),
  ].filter((text) => !/Amazon Jobs/.test(text));
};

// ------------------------------------------------------------------ the store and the page blocks

type Doc = {
  id: string;
  name: string;
  variant: string;
  format: string;
  updated: string;
  pages?: number;
  keywords?: string[];
};
type Documents = {
  library: Doc[];
  defaults: { resume: string | null; cv: string | null };
  defaultId: string | null;
  templateId: string;
  pageLimit: number;
  drafted: Record<string, Record<string, unknown>>;
  edits: Record<string, Record<string, unknown>>;
};
type Template = {
  id: string;
  name: string;
  markdown: string;
  builtIn: boolean;
  default: boolean;
  description: string;
};
type Draft = {
  id: string;
  appId: string;
  kind: string;
  kindLabel: string;
  role: string;
  company: string;
  status: string;
  statusLabel: string;
  pages: number;
  template: string;
  updated: string;
  base: string;
  href: string;
};
type KeywordStats = {
  keywords: Array<{ keyword: string; slug: string; roles: number; onResume: boolean }>;
  basedOn: number;
  found: number;
  total: number;
  updatedAt: string;
  resume: { id: string; name: string; read: boolean } | null;
};
type Format = { shortDate(value: string): string; date(value: string): string };
type Store = {
  get(): { documents: Documents; applications: Array<{ id: string; role: string }> };
  update(change: unknown, mutate: (state: { documents: Documents }) => void): unknown;
  subscribe(listener: (state: unknown, change: { type: string }) => void): () => void;
  metrics(): Record<string, number | string | null>;
  metric(key: string): number | string | null;
  metricText(key: string): string;
  keywordStats(options?: { role?: string; n?: number }): KeywordStats & {
    role?: { id: string; label: string; found: number };
    roles?: Array<{ id: string; label: string; found: number }>;
    heading?: string;
  };
  drafts(): Draft[];
  templates(): Template[];
  setDefaultDocument(kind: string, id: string): { resume: string | null; cv: string | null } | null;
  setDraftTemplate(appId: string, id: string): string | null;
  setTemplate(id: string): string | null;
  addTemplate(template: { name: string; markdown: string }): Template | null;
  setPageLimit(pages: number): number | null;
  today(): string;
  format: Format;
  TEMPLATE_PLACEHOLDERS: Array<{ id: string; label: string }>;
  seeAll(
    kind: string,
    options?: { role?: string },
  ): {
    total: number;
    items: Array<{ id: string; label: string; count: number; onResume: boolean }>;
  };
  readinessGaps(options?: { role?: string }): {
    items: Array<{ id: string; roles: number; neededByText: string }>;
  };
  draftFromAnswers(
    id: string,
    answers: Record<string, string>,
  ): { ok: boolean; reason?: string; line?: string; where?: { experienceId: string } };
  acceptDraftLine(
    id: string,
    draft: { line: string; experienceId?: string | undefined },
  ): { ok: boolean };
};

type Clock = { now: number };
// The store reads Date.now() and new Date() through a clock the test moves.
function loadStore(search = ''): { store: Store; clock: Clock } {
  const clock = { now: Date.parse('2026-11-20T18:30:00Z') };
  const storage = new Map<string, string>();
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

type Fields = Record<string, string>;
type Part = string | { metric: string };
type Check = {
  id: string;
  title: string;
  done: boolean;
  lookingFor: Part[];
  found: Part[];
  meter?: { value: number; max: number };
};
type Readiness = { state: string; checks: Check[]; met: number; total: number; name?: string };
type Row = {
  id: string;
  appId: string;
  kind: string;
  role: string;
  company: string;
  companyKey: string;
  status: string;
  statusLabel: string;
  rank: number;
  template: string;
  templateName: string;
  meta: string;
  search: string;
  open: string;
  updated: string;
  roleHref: string | null;
  roleIn: string | null;
};
type Page = {
  BASE_RESUME: Fields;
  SAMPLE_CV: string;
  SAMPLE_LINES: Record<string, string>;
  tailoredFields(appId: string): Fields;
  letterMarkdown(
    app: { id: string; role: string; company: string; location: string },
    day: string,
  ): string;
  fillTemplate(skeleton: string, fields: Fields): string;
  unfillTemplate(text: string, skeleton: string): Fields | null;
  relayTemplate(text: string, from: string, to: string, fallback?: Fields): string | null;
  documentMarkdown(id: string, classic: string): string | null;
  defaultsIn(documents: Partial<Documents>): { resume: string | null; cv: string | null };
  libraryRows(
    documents: Partial<Documents>,
    format: Format & { today: string },
  ): Array<{
    id: string;
    tag: string;
    meta: string;
    isDefault: boolean;
    badge: string | null;
    makeDefault: string | null;
    relabel: string;
  }>;
  readinessView(input: {
    doc: Doc | null;
    markdown: string | null;
    pageLimit: number;
    keywords: { found: number; total: number };
  }): Readiness;
  keywordRows(stats: KeywordStats): Array<{
    keyword: string;
    slug: string;
    roles: number;
    onResume: boolean;
    share: number;
    metric: string;
  }>;
  keywordRoleView(stats: unknown): {
    id: string;
    choices: Array<{ id: string; label: string }>;
    heading: Array<string | { metric: string }>;
    totalMetric: string;
  } | null;
  ALL_ROLES: string;
  roleHome(draft: { appId?: string | null; jobId?: string | null }): {
    roleHref: string | null;
    roleIn: string | null;
  };
  draftRows(drafts: Draft[], templates: Template[], format: Format): Row[];
  companiesIn(rows: Row[]): Array<{ key: string; name: string; drafts: number }>;
  companyOptions(rows: Row[]): Array<{ value: string; label: string; count: number }>;
  pageSlice(
    total: number,
    page: number,
    size?: number,
  ): { page: number; pages: number; start: number; end: number };
  DRAFTS_PER_PAGE: number;
  draftView(
    rows: Row[],
    filters?: { q?: string; status?: string; company?: string[] },
    sort?: string,
  ): {
    rows: Row[];
    total: number;
    counts: { status: Record<string, number>; company: Record<string, number> };
    narrowed: boolean;
  };
  DRAFT_STATUSES: string[];
  DRAFT_SORTS: string[];
  DRAFT_SIZES: number[];
  placeholderRows(
    placeholders: Array<{ id: string; label: string }>,
  ): Array<{ id: string; label: string; required: boolean; from: string }>;
  PLACEHOLDER_FROM: Record<string, string>;
  EXAMPLE_TEMPLATE: string;
  exampleOf(
    fields: Fields,
    fill: (skeleton: string, fields: Fields) => string,
  ): { template: string; text: string; excerpt: string };
  TEMPLATE_LIMIT: number;
  gapRows(gaps: unknown): Array<{
    id: string;
    label: string;
    roles: number;
    text: string;
    neededBy: Array<{
      id: string;
      title: string;
      company: string;
      tracked: boolean;
      href: string;
    }>;
    allRoles: Array<{ id: string; title: string; company: string; href: string }>;
    add: { label: string; href: string } | null;
    ask: {
      label: string;
      text: string;
      questions: Array<{
        id: string;
        text: string;
        kind: string;
        options: Array<{ value: string; label: string }>;
      }>;
    } | null;
  }>;
  GAPS_SHOWN: number;
  ROLES_SHOWN: number;
  checkTemplate(
    file: { name: string },
    text: string,
    placeholders: string[],
  ): { ok: boolean; title?: string; message?: string; name?: string; uses?: string[] };
};

const script = scriptOf(documents);
const sampleDocs = blockOf(documents, 'SampleDocs');
const docsModel = blockOf(documents, 'DocsModel');
const page = new Script(
  `${sampleDocs}\n${docsModel}\n({ ...SampleDocs, defaultsIn, libraryRows, readinessView, keywordRows, keywordRoleView, ALL_ROLES, roleHome, draftRows, companiesIn, companyOptions, pageSlice, DRAFTS_PER_PAGE, draftView, DRAFT_STATUSES, DRAFT_SORTS, DRAFT_SIZES, checkTemplate, TEMPLATE_LIMIT, placeholderRows, PLACEHOLDER_FROM, EXAMPLE_TEMPLATE, exampleOf, gapRows, GAPS_SHOWN, ROLES_SHOWN })`,
  { filename: 'documents-blocks.js' },
).runInNewContext({}) as Page;

const partsText = (parts: Part[], store: Store): string =>
  parts.map((part) => (typeof part === 'string' ? part : store.metricText(part.metric))).join('');
const skeleton = (store: Store, id: string): string =>
  store.templates().find((template) => template.id === id)?.markdown ?? '';
const readinessOf = (store: Store, docId = 'resume-main'): Readiness => {
  const stats = store.keywordStats();
  const doc = store.get().documents.library.find((entry) => entry.id === docId) ?? null;
  return page.readinessView({
    doc,
    markdown: doc ? page.documentMarkdown(doc.id, skeleton(store, 'classic')) : null,
    pageLimit: Number(store.metric('docs.pageLimit')),
    keywords: { found: stats.found, total: stats.total },
  });
};

// ------------------------------------------------------------------ the page

describe('Résumés page', () => {
  const main = mainOf(documents);

  it('opens with the editorial intro, a tour, and links to its four sections', () => {
    // Round 6 (R6-3): the shared page intro, Take the tour in its actions at the end of the
    // title row (tour-placement.test.ts checks the markup on every page).
    const intro =
      main.match(/<section class="page-intro docs-intro"[\s\S]*?<\/section>/)?.[0] ?? '';
    // Round 7 (R10-3): a home, so opened with ?return= it shows Back to that page (data-page-back).
    expect(intro).toMatch(
      /^<section class="page-intro docs-intro" aria-labelledby="page-title" data-page-back>\s*<div class="page-intro-copy">\s*<p class="eyebrow">Résumés<\/p>\s*<h1 id="page-title">/,
    );
    expect(intro).toMatch(
      /<\/p>\s*<\/div>\s*<div class="page-intro-actions">\s*<button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour<\/button>\s*<\/div>\s*<\/section>$/,
    );
    expect(textOf(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')).toBe(
      'The documents your deputy tailors from.',
    );
    expect(textOf(main.match(/<p class="intro-copy">([\s\S]*?)<\/p>/)?.[1] ?? '')).toContain(
      'Your originals never change.',
    );
    // Its own tour button placement is gone: the shared chrome places it.
    expect(documents).not.toContain('docs-tour');
    const links = main.match(/<nav class="section-links"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
    expect(
      [...links.matchAll(/href="#([a-z]+)">([^<]+)</g)].map((match) => match.slice(1)),
    ).toEqual([
      ['library', 'Library'],
      ['drafts', 'Drafts'],
      ['readiness', 'Readiness'],
      ['templates', 'Templates'],
    ]);
  });

  it('keeps one bounded surface per job, the drafts second so they are easy to reach', () => {
    const order = [...main.matchAll(/<section class="task-surface[^"]*" id="([a-z]+)"/g)].map(
      (match) => match[1],
    );
    expect(order).toEqual(['library', 'drafts', 'readiness', 'templates']);
    // One obvious primary action: adding a document.
    expect(count(main.replace(/<dialog[\s\S]*?<\/dialog>/, ''), /class="primary-action"/g)).toBe(1);
    expect(main).toMatch(/<button class="primary-action" id="upload-choose"[^>]*>\s*Choose a file/);
  });

  it('stacks the library so no column stands half empty beside the upload box (UAT-D2-6)', () => {
    const styles = documents.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    // The heading and count, the place to add a file, and the list each take the full width at
    // every size, so the count never sits above a band beside a taller box.
    expect(styles).toMatch(
      /\.docs-library \{\s*display: grid;\s*grid-template-areas:\s*"head"\s*"add"\s*"list";\s*grid-template-columns: minmax\(0, 1fr\);\s*gap: 34px;/,
    );
    expect(styles).not.toMatch(/"head add"/);
    // With room, the shared zone lays its parts on one line, keeping its own border, radius,
    // surface, and padding; narrower, it is the shared centred stack.
    expect(main).toContain('<div class="upload-zone docs-upload-zone" id="upload-zone">');
    expect(styles).toMatch(/\.docs-library-add \{[^}]*container: docs-add \/ inline-size;/);
    const strip =
      styles.match(/@container docs-add \(min-width: 640px\) \{([\s\S]*?)\n {6}\}/)?.[1] ?? '';
    expect(strip).toMatch(
      /\.docs-upload-zone \{\s*grid-template-areas:\s*"icon title action"\s*"icon meta action";\s*grid-template-columns: auto minmax\(0, 1fr\) auto;/,
    );
    expect(strip).not.toMatch(/padding|border|background|radius/);
    for (const [part, area] of [
      ['icon', 'icon'],
      ['title', 'title'],
      ['meta', 'meta'],
      ['actions', 'action'],
    ]) {
      expect(strip).toMatch(
        new RegExp(`\\.docs-upload-zone \\.upload-zone-${part} \\{\\s*grid-area: ${area};`),
      );
    }
  });

  // Round 6 (R6-2, G6): your deputy gives the tour, so each title is his speech line (first
  // person where he speaks of himself, six words at most) and each body says, in the first
  // person, what he does and what you can do. The targets and their order are round 5's.
  it('marks every tour step with a title and words, in order, in your deputy’s voice', () => {
    const marked = [...main.matchAll(/data-tour-step="(\d)"\s+data-tour-title="([^"]+)"/g)].map(
      (step) => [step[1], step[2]],
    );
    const drawn = [...script.matchAll(/tourStep\(\s*[\w.]+,\s*'(\d)',\s*'([^']+)'/g)].map(
      (step) => [step[1], step[2]],
    );
    expect([...marked, ...drawn].sort()).toEqual([
      ['1', 'I tailor from your defaults.'],
      ['2', 'See every page I read.'],
      ['3', 'Find any draft here.'],
      ['4', 'This is what I check.'],
      ['5', 'The skills found roles want.'],
      ['6', 'Here is what’s missing.'],
      ['7', 'I lay drafts out here.'],
      ['8', 'One page reads best.'],
    ]);
    for (const [, title] of [...marked, ...drawn]) {
      expect((title ?? '').split(' ').length, title).toBeLessThanOrEqual(6);
    }
    // The steps ring the content they explain: the keyword bars and the template cards.
    expect(main).toMatch(
      /<ol\s+class="hbar docs-keyword-bars"\s+id="keyword-bars"[^>]*data-tour-step="5"/,
    );
    expect(main).toMatch(
      /<ul\s+class="docs-template-grid"\s+id="template-list"[^>]*data-tour-step="7"/,
    );
    // The page draws steps 1, 2, 4, and 6 on the first document, its Preview, the first check,
    // and the first missing skill (round 6, R2: a step of its own, after the keywords it comes
    // from).
    expect(drawn.map((step) => step[0])).toEqual(['1', '2', '4', '6']);
    const texts = [
      ...[...main.matchAll(/data-tour-text="([^"]+)"/g)].map((step) => step[1] ?? ''),
      ...[...script.matchAll(/tourStep\([^)]*?'([^']{40,})',?\s*\)/g)].map((step) => step[1] ?? ''),
    ];
    expect(texts).toHaveLength(8);
    for (const text of texts) {
      expect(text.split(' ').length, text).toBeLessThanOrEqual(30);
      expect(text, text).toMatch(/\bI\b/);
      expect(text, text).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it('shows no figure in the markup: the store fills every one, each with its key', () => {
    // The static markup carries no counts or dates; the page fills them from JobDeputyStore.
    const visible = textOf(main.replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/g, ''));
    expect(visible).not.toMatch(/\b(?:Sep|Oct|Nov)\s\d/);
    expect(visible).not.toMatch(/\b2026\b/);
    const metrics = [...main.matchAll(/<span[^>]*data-metric="([^"]+)"[^>]*><\/span>/g)].map(
      (match) => match[1],
    );
    // Round 6 (UAT-D-11): the keyword total beside See all ("Top 12 of 43 keywords").
    expect(metrics).toEqual([
      'docs.library',
      'docs.keywordsBasedOn',
      'keywords.total',
      'docs.keywordsUpdatedAt',
    ]);
    // Round 7 (R10-7): the drafts' Status counts are drawn by the shared filter bar; each carries
    // its store key while nothing else narrows the list.
    expect(script).toContain(`const STATUS_METRICS = {
        all: 'docs.drafts',
        waiting: 'docs.drafts.waiting',
        draft: 'docs.drafts.draft',
        approved: 'docs.drafts.approved',
      };`);
    // Figures the page draws take the store's own text.
    expect(script).toContain('node.textContent = store.metricText(key);');
    // Round 7 (T3-19): the bars change in place, each count the store's own text with its key.
    expect(script).toContain('text: store.metricText(row.metric),');
    expect(script).toContain("setData(value, 'metric', row.metric);");
    expect(script).toContain('setText(value, row.text);');
  });

  it('declares the same document limits as the shared contract', () => {
    const shared = readFileSync(resolve(repoRoot, 'packages/shared/src/documents.ts'), 'utf8');
    const maxDocuments = shared.match(/export const MAX_DOCUMENTS = (\d+);/)?.[1];
    const maxBytes = shared.match(/export const MAX_UPLOAD_BYTES = ([\d\s*]+);/)?.[1]?.trim();
    expect(maxDocuments).toBe('10');
    expect(script).toContain(`const MAX_DOCUMENTS = ${maxDocuments};`);
    expect(script).toContain(`const MAX_UPLOAD_BYTES = ${maxBytes};`);
    expect(textOf(main)).toContain(
      'PDF or DOCX, up to 5 MB, read in your United States home Region.',
    );
    expect(textOf(main)).toContain('of 10');
  });

  it('uploads through a hidden file input that a visible button opens, with honest states', () => {
    expect(main).toMatch(
      /<input\s+id="upload-file"\s+type="file"\s+accept="\.pdf,\.docx,application\/pdf,application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document"\s+multiple\s+hidden\s*\/>/,
    );
    expect(script).toContain("chooseFile.addEventListener('click', () => fileInput.click());");
    for (const [state, label] of [
      ['uploading', 'Uploading'],
      ['checking', 'Checking the file'],
      ['reading', 'Reading the text'],
    ]) {
      expect(script).toContain(`state: '${state}',`);
      expect(script).toContain(`label: '${label}'`);
    }
    expect(script).toContain("item.dataset.state = 'failed';");
    expect(script).toContain("itemButton('Choose another file', 'uploadRetry')");
    // The "checking" step really reads the file's first bytes; the malware scan is named as the
    // launch behaviour, never claimed.
    expect(script).toContain('at launch, a malware scan in your home Region');
    expect(script).toContain(
      'const SIGNATURES = { PDF: [0x25, 0x50, 0x44, 0x46], DOCX: [0x50, 0x4b, 0x03, 0x04] };',
    );
    expect(textOf(main)).toContain('In this prototype the file stays in this browser.');
  });

  it('shows the prompt behind readiness as the shared prompt summary, and the shared preview for every document', () => {
    // Round 7 (R1, R10-5): the readiness prompt is the shared prompt summary card (its version,
    // score trend, Kept by you, tokens, models, and Open in Prompts with return=), in the score
    // column under the ring. No See the prompt, no drawer, and no other prompt view on the page.
    const score =
      main.match(/<div class="docs-score">[\s\S]*?<div class="docs-checks">/)?.[0] ?? '';
    expect(score).toContain(
      '<div\n                  class="docs-score-prompt"\n                  id="readiness-prompt"\n                  data-prompt-summary="check"\n                  data-prompt-size="card"\n                  data-prompt-heading="3"\n                ></div>',
    );
    expect(count(main, /data-prompt-summary=/g)).toBe(1);
    expect(`${main}${script}`).not.toMatch(
      /data-prompt-open|See the prompt|openPrompt|prompt-drawer|data-prompt-control/,
    );
    expect(script).toContain('components().preview.open(');
    // ?preview=<document, draft, or template id> opens that preview on load.
    expect(script).toContain("const requested = parameters.get('preview');");
    expect(script).toMatch(
      /openDocumentPreview\(requested[\s\S]*openDraftPreview\(requested[\s\S]*openTemplatePreview\(requested/,
    );
  });

  it('downloads each document and draft as a PDF or Markdown, with the shared menu (R1)', () => {
    // The shared Download (A2's downloadMenu), the same menu and file as the preview's: a compact
    // button among the row's actions, found again after a redraw, opening under them.
    for (const part of [
      "if (typeof components()?.downloadMenu !== 'function') return null;",
      'const made = components().downloadMenu(document.createDocumentFragment(), source, {',
      'channel: announcer,',
      "toggle.classList.replace('secondary-action', 'compact-action');",
      "toggle.dataset.action = 'download';",
      "made.menu.classList.add('is-below');",
      "if (result?.ok) react('saved', { speech: 'It’s downloading.' });",
    ]) {
      expect(script, part).toContain(part);
    }
    // A library document downloads the text its preview shows, named for the file; one this
    // prototype can't read has no Download, says why in its row, and its preview offers none.
    expect(script).toContain(
      "const textOf = () => documentMarkdown(row.id, skeletonOf('classic'));",
    );
    expect(script).toContain(
      'const download = readable ? downloadControl(() => ({ title: row.name, markdown: textOf() }), nameId) : null;',
    );
    expect(script).toContain("'No download: this prototype doesn’t read the file'");
    expect(script).toContain('download: Boolean(text),');
    expect(script).toMatch(
      /actions\.append\(\s*preview,\s*\.\.\.\(download \? \[download\] : \[\]\),/,
    );
    // A draft downloads as it is now (your edits in Materials), under its preview's title.
    expect(script).toContain('() => ({ title: draftTitle(row), markdown: draftSource(row) }),');
    expect(script).toContain(`const draftTitle = (row) => \`\${row.kindLabel}: \${row.role}\`;`);
    expect(script).toContain('title: draftTitle(row),');
    // Rows draw again only when they change, so a live search's ticks never close an open menu.
    expect(script).toContain('if (signature !== librarySignature) {');
    expect(script).toContain('if (signature === draftsSignature) return;');
    expect(script).toContain("if (action === 'download') return;");
    // Narrow rows: the menu takes the actions' width under them, so it fits 320px.
    const styles = documents.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(styles).toMatch(
      /@container docs-library \(max-width: 899px\) \{\s*\.docs-row-actions \{\s*position: relative;\s*\}\s*\.docs-row-actions \.download-menu \{\s*position: static;\s*\}\s*\.docs-row-actions \.download-menu-list \{\s*left: 0;\s*width: auto;\s*min-width: 0;/,
    );
    expect(styles).toMatch(
      /\.docs-draft-actions \.download-menu-list \{\s*left: 0;\s*width: auto;\s*min-width: 0;/,
    );
    // The two sample documents have text to download; an uploaded file has none.
    const { store } = loadStore();
    const classic = skeleton(store, 'classic');
    expect(page.documentMarkdown('resume-main', classic)).toMatch(/^# Alex Morgan/);
    expect(page.documentMarkdown('cv-leadership', classic)).toMatch(/^# Alex Morgan/);
    expect(page.documentMarkdown('doc-uploaded', classic)).toBeNull();
  });

  it('wires every action to the store and a deputy reaction', () => {
    for (const call of [
      'store.setDefaultDocument(doc.variant, id)',
      'store.setTemplate(id)',
      'store.addTemplate({ name: result.name, markdown: text })',
      'store.removeTemplate(id)',
      'store.setPageLimit(pages)',
      'store.keywordStats()',
      'store.drafts()',
      'store.subscribe(',
      'components().filterBar(draftsFilterHost, {',
    ]) {
      expect(script).toContain(call);
    }
    for (const reaction of [
      "react('saved'",
      "react('deleted')",
      "react('error'",
      "react('found'",
    ]) {
      expect(script).toContain(reaction);
    }
    // A completed search recounts the keywords, and your deputy says so once.
    expect(script).toMatch(
      /change\?\.type === 'run' && change\.stage === 'complete' && change\.jobIds\?\.length/,
    );
  });

  // Round 7 (R10-7): the shared filter bar, live as you type or choose and kept in the address:
  // the search, Status and Company with their counts, Order, and Clear.
  it('builds the drafts list on the shared filter bar: search, Status, Company, and Order', () => {
    const section =
      main.match(
        /<section class="task-surface docs-surface docs-drafts"[\s\S]*?<\/section>/,
      )?.[0] ?? '';
    // The bar's host carries the tour's step, then the pages at the top, the list, the pages at
    // the bottom. No list toolbar of its own any more, and no filter markup to keep in step.
    expect(section).toMatch(
      /<div\s+class="docs-drafts-filter"\s+id="drafts-filter"\s+data-tour-step="3"[\s\S]*?><\/div>\s*<div class="docs-drafts-pages is-top" id="drafts-pages-top"><\/div>\s*<ul class="docs-drafts-list" id="draft-list" aria-label="Tailored drafts"><\/ul>\s*<div class="docs-drafts-pages" id="drafts-pages"><\/div>/,
    );
    expect(section).not.toMatch(
      /data-list-toolbar|data-list-filter|data-count-metric|<search\b|<select/,
    );
    for (const part of [
      'draftBar = components().filterBar(draftsFilterHost, {',
      "label: 'Find a draft',",
      "search: { label: 'Search drafts', param: 'q', placeholder: 'For example: Google' },",
      "name: 'status',",
      "kind: 'choice',",
      "param: 'status',",
      // Each Status count is the store's figure with its key while it shows exactly that figure.
      'options: DRAFT_STATUSES.map((id) => ({ value: id, label: STATUS_LABELS[id], metric: STATUS_METRICS[id] })),',
      "name: 'company',",
      "kind: 'multi',",
      "param: 'company',",
      "countLabel: ['draft', 'drafts'],",
      'maxChips: 3,',
      // The bar's own order, named Order as on every page (T6-16), in the address (?sort=),
      // never reset by Clear.
      "label: 'Order',",
      "param: 'sort',",
      'value: DRAFT_SORTS[0],',
      'options: DRAFT_SORTS.map((value) => ({ value, label: SORT_LABELS[value] })),',
      "noun: ['draft', 'drafts'],",
      'const view = draftView(rows, draftFilters, draftFilters.sort);',
      'draftBar?.setCounts(view.counts);',
      'draftBar?.setResult(view.rows.length, view.total);',
    ]) {
      expect(script, part).toContain(part);
    }
    // Round 6 (R1): no Kind filter; the search finds a kind ("cover letter" matches each letter).
    expect(script).toContain(
      "search: [draft.kindLabel, draft.role, draft.company, draft.statusLabel, templateName].join(' '),",
    );
    expect(page.DRAFT_SORTS).toEqual([
      'status:asc',
      'updated:desc',
      'updated:asc',
      'company:asc',
      'role:asc',
    ]);
    expect(script).toContain(`const SORT_LABELS = {
        'status:asc': 'Needs you first',
        'updated:desc': 'Newest first',
        'updated:asc': 'Oldest first',
        'company:asc': 'Company, A to Z',
        'role:asc': 'Role, A to Z',
      };`);
    // Show all drafts clears every filter and puts you back in the search.
    expect(main).toContain(
      '<button class="secondary-action" type="button" id="drafts-clear">Show all drafts</button>',
    );
    expect(script).toMatch(
      /\$\('#drafts-clear'\)\.addEventListener\('click', \(\) => \{\s*draftBar\?\.clear\(\);\s*draftsFilterHost\.querySelector\('input\[type="search"\]'\)\?\.focus\(\);/,
    );
  });

  it('matches, orders, and counts the drafts as the filter bar asks, from the store', () => {
    const { store } = loadStore();
    const rows = page.draftRows(store.drafts(), store.templates(), store.format);
    const all = page.draftView(rows, {}, 'status:asc');
    expect(all.rows).toHaveLength(Number(store.metric('docs.drafts')));
    expect(all.narrowed).toBe(false);
    // Unnarrowed, every Status count is the store's own figure.
    expect(all.counts.status).toEqual({
      all: Number(store.metric('docs.drafts')),
      waiting: Number(store.metric('docs.drafts.waiting')),
      draft: Number(store.metric('docs.drafts.draft')),
      approved: Number(store.metric('docs.drafts.approved')),
    });
    expect(all.counts.company).toEqual({
      Google: 4,
      'Google Cloud': 2,
      Amazon: 2,
      'Northwind Labs': 2,
      'Contoso Health': 2,
    });
    // Needs you first: waiting, then drafts, then approved, each in the store's order.
    expect(all.rows.map((row) => row.status)).toEqual(
      [...all.rows.map((row) => row.status)].sort(
        (a, b) => page.DRAFT_STATUSES.indexOf(a) - page.DRAFT_STATUSES.indexOf(b),
      ),
    );
    // Every word of the search, any case or accent: "COVER letter" finds each letter.
    const letters = page.draftView(rows, { q: 'COVER letter' });
    expect(letters.rows.every((row) => row.kind === 'letter')).toBe(true);
    expect(letters.rows).toHaveLength(Number(store.metric('docs.drafts')) / 2);
    expect(letters.narrowed).toBe(true);
    // Google and Google Cloud both have the word "google".
    expect(page.draftView(rows, { q: 'resume google' }).rows.map((row) => row.id)).toEqual([
      'search-infra-resume',
      'cloud-reliability-resume',
      'devex-resume',
    ]);
    // A status narrows the list, never its own counts; a company narrows the Status counts.
    const waiting = page.draftView(rows, { status: 'waiting' });
    expect(waiting.rows.every((row) => row.status === 'waiting')).toBe(true);
    expect(waiting.counts.status).toEqual(all.counts.status);
    expect(waiting.counts.company.Google).toBe(2);
    const google = page.draftView(rows, { company: ['Google'] });
    expect(google.rows).toHaveLength(4);
    expect(google.counts.status).toEqual({ all: 4, waiting: 2, draft: 0, approved: 2 });
    expect(google.counts.company).toEqual(all.counts.company);
    // Companies are their names, in any case: an older link's ?company=google cloud finds them.
    expect(page.draftView(rows, { company: ['google cloud'] }).rows).toHaveLength(2);
    // The orders.
    expect(page.draftView(rows, {}, 'company:asc').rows[0]?.company).toBe('Amazon');
    expect(page.draftView(rows, {}, 'role:asc').rows[0]?.role).toBe(
      'Engineering Manager, Cloud Reliability',
    );
    const newest = page.draftView(rows, {}, 'updated:desc').rows.map((row) => row.updated);
    expect(newest).toEqual([...newest].sort().reverse());
    // An unknown status or order reads as All and Needs you first.
    expect(page.draftView(rows, { status: 'bogus' }, 'bogus').rows).toEqual(all.rows);
  });

  // Round 6 part 3 (T3-2), kept in round 7: the filters live in the address (?q=, ?status=,
  // ?company= in the companies' names, ?sort=), so a reload or a shared link opens on the same
  // drafts; an older link's companies are put in the names the bar lists.
  it('keeps the drafts’ filters in the address, and reads an older ?company= in any case', () => {
    for (const part of [
      'function canonicalCompanies(rows) {',
      "const asked = parameters.get('company');",
      "const chosen = [...new Set(asked.split(',').map((name) => names.get(keyOf(name))).filter(Boolean))];",
      "if (chosen.length) url.searchParams.set('company', chosen.join(','));",
      "else url.searchParams.delete('company');",
      'canonicalCompanies(rows);',
      'const companyChoices = (rows) => companyOptions(rows).map((option) => ({ ...option, value: option.label }));',
      // T3-3: a company's first or last draft changes the Company choices in place; the bar is
      // built once, so what you type, an open menu, and the phone's fold stay.
      'companyFacet.options.splice(0, companyFacet.options.length, ...companyChoices(rows));',
      'syncCompanyChoices(rows);',
    ]) {
      expect(script, part).toContain(part);
    }
    const { store } = loadStore();
    const rows = page.draftRows(store.drafts(), store.templates(), store.format);
    expect(page.companyOptions(rows)).toEqual([
      { value: 'google', label: 'Google', count: 4 },
      { value: 'google-cloud', label: 'Google Cloud', count: 2 },
      { value: 'amazon', label: 'Amazon', count: 2 },
      { value: 'northwind-labs', label: 'Northwind Labs', count: 2 },
      { value: 'contoso-health', label: 'Contoso Health', count: 2 },
    ]);
  });

  // Round 6 part 3 (T3-3): a screen reader hears what each Preview previews; the visible word stays
  // "Preview".
  it('names every Preview button for what it previews', () => {
    expect(script).toContain(`const button = (label, data, describedBy, names = '') => {`);
    expect(script).toContain(`if (names) node.append(el('span', 'sr-only', \`: \${names}\`));`);
    expect(script).toContain(
      "const preview = button('Preview', { action: 'preview' }, nameId, row.name);",
    );
    expect(script).toContain(
      `button('Preview', { action: 'preview' }, \`\${kindId} \${titleId}\`, \`\${row.kindLabel}, \${row.role}, \${row.company}\`),`,
    );
    expect(script).toContain(
      `actions.append(button('Preview', { action: 'preview' }, nameId, \`the \${template.name} template\`));`,
    );
  });

  // Round 6 part 3 (T6-8, R9-4): no checks yet reads a word, never a dash.
  it('reads a word in the readiness ring before the checks are made', () => {
    expect(main).toContain(
      '<p class="ring-figure" id="readiness-figure"><span class="docs-ring-none">Not yet</span></p>',
    );
    expect(script).toContain(
      "readinessFigure.replaceChildren(el('span', 'docs-ring-none', 'Not yet'));",
    );
    expect(main).toContain('aria-valuetext="Not checked yet"');
    expect(documents).not.toMatch(/[–—]/);
  });

  // Round 7 (R10-6): the shared pages at the top and the bottom of the list, "13 to 24 of 95
  // drafts", 12, 24, or 48 a page, the page and size in the address, the list's top in view and
  // focus on its heading after a change; only the page shown is drawn.
  it('pages the drafts with the shared pages, top and bottom, and draws only the page shown', () => {
    expect(page.DRAFT_SIZES).toEqual([12, 24, 48]);
    expect(page.pageSlice(12, 1)).toEqual({ page: 1, pages: 1, start: 0, end: 12 });
    expect(page.pageSlice(95, 2, 24)).toEqual({ page: 2, pages: 4, start: 24, end: 48 });
    // A page past the last (the list got shorter) shows the last; nothing shows page 1 of 1.
    expect(page.pageSlice(70, 9)).toEqual({ page: 6, pages: 6, start: 60, end: 70 });
    expect(page.pageSlice(0, 3)).toEqual({ page: 1, pages: 1, start: 0, end: 0 });
    for (const part of [
      "const pagesAsked = components()?.pagination?.fromAddress?.({ param: 'page', sizeParam: 'size', sizes: DRAFT_SIZES }) ?? {};",
      'draftPager = components().pagination(draftPagesHost, {',
      "label: 'Pages of drafts',",
      "noun: ['draft', 'drafts'],",
      'top: draftPagesTop,',
      'sizes: DRAFT_SIZES,',
      'list: draftList,',
      'heading: draftsTitle,',
      'address: true,',
      'drawDraftPage(view.rows.slice(slice.start, slice.end));',
      // A new search, filter, or order starts again at page 1.
      'draftFilters = state;',
    ]) {
      expect(script, part).toContain(part);
    }
    expect(script).toMatch(
      /onChange: \(state\) => \{\s*draftFilters = state;\s*draftPage = 1;\s*renderDrafts\(\{ moved: true \}\);/,
    );
    // The rows are drawn again only when the page's rows change, keeping focus where it was.
    expect(script).toMatch(
      /function drawDraftPage\(rows\) \{\s*const signature = JSON\.stringify\(rows\);\s*if \(signature === draftsSignature\) return;/,
    );
    // T3-19: they morph in place: a row whose draft did not change keeps its element (and the
    // focus or an open menu in it), a changed one is drawn again, and rows move only when the
    // order changed.
    for (const part of [
      'if (item && item.dataset.rowSignature === rowSignature) return item;',
      'for (const item of [...draftList.children]) if (!wanted.has(item)) item.remove();',
      'if (draftList.children[index] !== item) draftList.insertBefore(item, draftList.children[index] ?? null);',
      "if (!draftList.contains(document.activeElement)) restoreFocus(draftList, memo, 'data-draft');",
    ]) {
      expect(script, part).toContain(part);
    }
    // The Large account demo: 95 drafts, 12 drawn.
    const { store } = loadStore('?demo=large');
    const rows = page.draftRows(store.drafts(), store.templates(), store.format);
    const view = page.draftView(rows, {});
    expect(view.rows).toHaveLength(95);
    expect(page.pageSlice(view.rows.length, 1, 12)).toEqual({
      page: 1,
      pages: 8,
      start: 0,
      end: 12,
    });
  });

  // Round 6 (R6-4): the twelve keyword bars are the top of a longer list, and your own templates
  // grow with every upload, so both have a cap and a way to see the rest.
  it('opens every keyword in the shared See all panel, and caps your own templates (R6-4)', () => {
    // UAT-D-11: one rule with the Dashboard's top six: "Top 12 of N keywords" (N is
    // keywords.total, once on the page) and See all beside it, shown when there are more.
    expect(main).toMatch(
      /<figcaption class="chart-title" id="keywords-title">[\s\S]*?<\/figcaption>[\s\S]*?<p class="docs-keyword-top" id="keywords-top" hidden><span>Top <span id="keywords-shown"><\/span> of <span id="keywords-total" data-metric="keywords.total"><\/span> keywords<\/span> <button type="button" class="chart-action see-all-open" id="keywords-all">See all<span class="sr-only"> keywords<\/span><\/button><\/p>/,
    );
    for (const part of [
      // D6: the list of the role shown, or every keyword on all your roles.
      "return keywordRole === ALL_ROLES ? store.seeAll('keywords') : store.seeAll('keywords', { role: keywordRole });",
      'const total = Number(store.metric(keywordsTotal.dataset.metric)) || Number(all?.total) || 0;',
      'keywordsTop.hidden = total <= shown;',
      'keywordsShown.textContent = String(shown);',
      "countLabel: ['role', 'roles'],",
      "meta: item.onResume ? 'On your résumé' : 'Not on it yet',",
      'const YOURS_SHOWN = 3;',
      `templatesMore.textContent = templatesExpanded ? 'Show fewer' : \`Show all \${yours} of yours\`;`,
    ]) {
      expect(script, part).toContain(part);
    }
    expect(main).toContain(
      '<button class="compact-action docs-templates-more" type="button" id="templates-more" aria-controls="template-list" aria-expanded="false" hidden></button>',
    );
    // The store's full list starts with the twelve bars, each with the same count.
    const { store } = loadStore();
    const all = store.seeAll('keywords');
    const bars = page.keywordRows(store.keywordStats());
    expect(all.total).toBeGreaterThan(bars.length);
    expect(store.metric('keywords.total')).toBe(all.total);
    expect(all.items).toHaveLength(all.total);
    expect(all.items.slice(0, bars.length).map((item) => [item.label, item.count])).toEqual(
      bars.map((row) => [row.keyword, row.roles]),
    );
  });

  // Round 6 (R3): How custom templates work, on the Templates section: the steps, what your
  // deputy does with a template, what it checks, the limits, and a worked example.
  it('explains custom templates in four steps, with the details folded away (R3)', () => {
    const guide =
      main.match(/<section class="docs-guide" id="template-guide"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(guide).toContain('aria-labelledby="template-guide-title"');
    expect(textOf(guide.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? '')).toBe(
      'How custom templates work',
    );
    expect(
      [...guide.matchAll(/<p class="docs-guide-title">([^<]+)<\/p>/g)].map((match) => match[1]),
    ).toEqual(['Start from a copy', 'Place the placeholders', 'Mind the page', 'Upload it']);
    // In sight: the steps and what your deputy does. Folded: the placeholders, the checks and
    // limits, and the example.
    expect([...guide.matchAll(/<summary>([^<]+)<\/summary>/g)].map((match) => match[1])).toEqual([
      'The placeholders and what fills each',
      'What your deputy checks, and the limits',
      'A worked example',
    ]);
    const does = guide.match(/<div class="docs-guide-does">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect([...does.matchAll(/<li>([^<]+)<\/li>/g)].map((match) => match[1])).toEqual([
      'Fills each placeholder from your profile and the text it tailored for the role.',
      'Keeps your layout: your sections, their order, and your own words.',
      'Counts the pages against your page setting and trims the draft to fit.',
      'Flags a draft that still runs over in Materials, before you approve it.',
    ]);
    // The page facts are the shared paper's: US Letter at 816 page pixels, 72 of them (0.75in) a
    // margin.
    const paper = readFileSync(resolve(repoRoot, 'brand/app-components.css'), 'utf8');
    expect(paper).toContain('padding: calc(100cqw * 72 / 816);');
    expect(textOf(guide)).toContain('US Letter, 8.5 by 11 inches, with 0.75 inch margins.');
    // Honest about type: an uploaded template has no look of its own, so it prints in Classic's.
    expect(paper).not.toMatch(/\[data-template="custom/);
    expect(textOf(guide)).toContain(
      'Markdown holds no fonts, so your template prints in the Classic look.',
    );
  });

  it('lists the checks the upload really runs, and every placeholder with what fills it (R3)', () => {
    const guide =
      main.match(/<section class="docs-guide" id="template-guide"[\s\S]*?<\/section>/)?.[0] ?? '';
    const checks =
      guide.match(/<ul class="docs-guide-list" id="template-checks">([\s\S]*?)<\/ul>/)?.[1] ?? '';
    expect(
      [...checks.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) =>
        textOf(match[1] ?? '').replace(/ \.$/, '.'),
      ),
    ).toEqual([
      'It’s a Markdown file, .md or .markdown.',
      'It isn’t empty, and holds at most 20,000 characters.',
      'It has {{name}}.',
      'It uses only the placeholders listed.',
    ]);
    // Each line is a check checkTemplate runs: the file type, empty, the limit, {{name}}, and
    // only known placeholders.
    const { store } = loadStore();
    const known = store.TEMPLATE_PLACEHOLDERS.map((entry) => entry.id);
    expect(page.TEMPLATE_LIMIT).toBe(20000);
    expect(page.checkTemplate({ name: 'mine.markdown' }, '# {{name}}', known).ok).toBe(true);
    expect(page.checkTemplate({ name: 'mine.txt' }, '# {{name}}', known).ok).toBe(false);
    expect(page.checkTemplate({ name: 'a.md' }, `{{name}}${'x'.repeat(19992)}`, known).ok).toBe(
      true,
    );
    expect(page.checkTemplate({ name: 'a.md' }, `{{name}}${'x'.repeat(19993)}`, known).ok).toBe(
      false,
    );
    // Every placeholder the store lists says where its words come from.
    const rows = page.placeholderRows(store.TEMPLATE_PLACEHOLDERS);
    expect(rows.map((row) => row.id)).toEqual(known);
    expect(Object.keys(page.PLACEHOLDER_FROM).sort()).toEqual([...known].sort());
    expect(rows.map((row) => [row.id, row.from, row.required])).toEqual([
      ['{{name}}', 'From your profile', true],
      ['{{contact}}', 'From your profile', false],
      ['{{headline}}', 'Tailored for each role', false],
      ['{{summary}}', 'Tailored for each role', false],
      ['{{experience}}', 'Tailored for each role', false],
      ['{{skills}}', 'Tailored for each role', false],
      ['{{education}}', 'From your profile', false],
      ['{{certifications}}', 'From your profile', false],
    ]);
  });

  it('fills the worked example for a real role, and offers copies to start from (R3)', () => {
    const example = page.exampleOf(page.tailoredFields('search-infra'), page.fillTemplate);
    const { store } = loadStore();
    const known = store.TEMPLATE_PLACEHOLDERS.map((entry) => entry.id);
    // The example is a template the upload accepts, and filling it leaves no placeholder.
    expect(page.checkTemplate({ name: 'example.md' }, example.template, known).ok).toBe(true);
    expect(example.text).not.toMatch(/\{\{\w+\}\}/);
    expect(example.text.split('\n').slice(0, 2)).toEqual([
      '# Alex Morgan',
      page.BASE_RESUME.contact,
    ]);
    expect(example.text).toContain('## About me');
    expect(example.excerpt.endsWith('\n…')).toBe(true);
    expect(example.excerpt.split('\n')).toHaveLength(11);
    expect(example.text.startsWith(example.excerpt.slice(0, -2))).toBe(true);
    // The role it is filled for comes from the store.
    expect(script).toContain("store.application('search-infra')");
    // Step 1: a Markdown copy of each built-in template; the example downloads as a template too.
    for (const part of [
      "const result = components()?.download?.({ title, markdown }, 'md');",
      'const builtIn = templatesNow().filter((template) => template.builtIn);',
      "{ action: 'copy', template: template.id }, 'guide-copy-text')",
      "saveMarkdown('Example template', EXAMPLE_TEMPLATE)",
      'components().preview.open(',
    ]) {
      expect(script, part).toContain(part);
    }
  });

  it('names Job matches, never Jobs, wherever it names that page', () => {
    expect(jobsNames(documents)).toEqual([]);
  });

  it('marks every sample surface and keeps one panda per viewport', () => {
    expect(count(main, /<p class="sample-note">Sample data · not connected<\/p>/g)).toBe(5);
    // The dock is the only panda; empty states use prop illustrations.
    expect(count(documents, /data-deputy-art/g)).toBe(1);
    expect(main).toContain('data-deputy-prop="page"');
  });

  it('renames in the shared drawer with a labelled, bounded field', () => {
    const drawer =
      main.match(/<dialog class="drawer" id="rename-drawer"[\s\S]*?<\/dialog>/)?.[0] ?? '';
    expect(drawer).toContain('aria-labelledby="rename-title"');
    expect(drawer).toContain('<label class="field-label" for="rename-input">Display name</label>');
    expect(drawer).toMatch(/id="rename-input"\s+type="text"\s+maxlength="200"/);
    expect(drawer).toContain('data-drawer-close');
    expect(drawer).toContain('<p class="sr-only" id="rename-announcement" role="status"');
    expect(script).toContain('components().openDrawer(renameDrawer, control);');
  });

  it('offers the page setting as the shared segmented control, with the one-page advice in one line', () => {
    const setting =
      main.match(/<fieldset class="segmented" id="page-setting">[\s\S]*?<\/fieldset>/)?.[0] ?? '';
    expect(
      [...setting.matchAll(/value="(\d)"[\s\S]*?<span class="segmented-label">([^<]+)</g)].map(
        (m) => m.slice(1),
      ),
    ).toEqual([
      ['1', '1 page'],
      ['2', '2 pages'],
    ]);
    expect(textOf(main)).toContain(
      'Recommended: one page with only what each role needs. Your deputy trims drafts to fit.',
    );
  });
});

// ------------------------------------------------------------------ the sample documents

describe('Résumés sample documents (SampleDocs)', () => {
  const { store } = loadStore();
  const classic = skeleton(store, 'classic');

  it('is the same block on Résumés and Materials, and touches nothing on the page', () => {
    expect(sampleDocs.length).toBeGreaterThan(4000);
    expect(blockOf(materials, 'SampleDocs')).toBe(sampleDocs);
    expect(pageAccess(sampleDocs)).toEqual([]);
  });

  it('reads the default résumé from the same work history and keywords the store holds', () => {
    const text = page.documentMarkdown('resume-main', classic) ?? '';
    for (const word of ['Fabrikam', 'Litware', 'Lakeside University', 'alex.morgan@example.com']) {
      expect(storeSource).toContain(word);
      expect(text).toContain(word);
    }
    const resume = store.get().documents.library.find((doc) => doc.id === 'resume-main');
    const lower = text.toLowerCase();
    for (const keyword of resume?.keywords ?? []) {
      // "Mentoring" reads "Mentored" in a bullet; every other keyword is in the text as it is.
      expect(lower, keyword).toContain(keyword === 'Mentoring' ? 'mentor' : keyword.toLowerCase());
    }
    const cv = store.get().documents.library.find((doc) => doc.id === 'cv-leadership');
    for (const keyword of cv?.keywords ?? []) {
      expect(page.SAMPLE_CV.toLowerCase(), keyword).toContain(keyword.toLowerCase());
    }
    expect(page.documentMarkdown('doc-uploaded', classic)).toBeNull();
  });

  // Round 4, UAT-A-6: on phones a template card's actions take its whole width under the picture
  // and the words, so Use for new drafts (a compact action that never wraps) fits at 320px with
  // text spacing; the chosen template's pill sits where the others offer that action.
  it('gives a phone template card’s actions its whole width, with the chosen pill among them', () => {
    const styles = [...documents.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
      .map((match) => match[1] ?? '')
      .join('');
    const phone = styles.slice(styles.indexOf('@container docs-templates (max-width: 439px) {'));
    expect(phone).toMatch(
      /^@container docs-templates \(max-width: 439px\) \{[\s\S]*?\.docs-template-actions \{\s*grid-column: 1 \/ -1;\s*\}/,
    );
    const script = scriptOf(documents);
    expect(script).toContain(
      "if (chosen) actions.append(el('span', 'status-pill', 'Used for new drafts'));",
    );
    expect(script).toContain(
      "else actions.append(button('Use for new drafts', { action: 'use' }, nameId));",
    );
  });

  it('fills every template and reads each one back, so a template switch keeps your edits', () => {
    for (const template of store.templates()) {
      const text = page.fillTemplate(template.markdown, page.BASE_RESUME);
      expect(text).toContain(page.BASE_RESUME.experience);
      expect(text, template.id).not.toMatch(/\{\{\w+\}\}/);
      const fields = page.unfillTemplate(text, template.markdown);
      expect(fields, template.id).not.toBeNull();
      for (const [key, value] of Object.entries(fields ?? {})) {
        expect(value, `${template.id}: ${key}`).toBe(String(page.BASE_RESUME[key]).trim());
      }
      for (const other of store.templates()) {
        expect(page.relayTemplate(text, template.markdown, other.markdown, page.BASE_RESUME)).toBe(
          page.fillTemplate(other.markdown, page.BASE_RESUME),
        );
      }
    }
    const modern = skeleton(store, 'modern');
    const edited = page
      .fillTemplate(classic, page.tailoredFields('search-infra'))
      .replace('Cut p99 query latency', 'Cut p99 search latency');
    const relaid =
      page.relayTemplate(edited, classic, modern, page.tailoredFields('search-infra')) ?? '';
    expect(relaid).toContain('Cut p99 search latency');
    // Modern shows a headline that Classic has not, so it comes from your deputy's draft.
    expect(relaid).toContain('**Software engineer, search infrastructure** · Seattle, WA');
    // A draft whose sections no longer follow its template can't be read back.
    expect(
      page.relayTemplate(edited.replace('## Experience', '## Work'), classic, modern),
    ).toBeNull();
  });

  it('tailors from what is already there: it rewords and reorders, and never adds a result', () => {
    const numbers = (text: string) => new Set(text.match(/\d[\d,]*/g) ?? []);
    const base = numbers(page.fillTemplate(classic, page.BASE_RESUME));
    for (const appId of [
      'search-infra',
      'devex',
      'amazon-sde2',
      'northwind-backend',
      'workspace',
    ]) {
      for (const number of numbers(page.fillTemplate(classic, page.tailoredFields(appId)))) {
        expect(base.has(number), `${appId}: ${number}`).toBe(true);
      }
    }
    const cv = numbers(page.SAMPLE_CV);
    for (const number of numbers(
      page.fillTemplate(classic, page.tailoredFields('cloud-reliability')),
    )) {
      expect(cv.has(number), `cloud-reliability: ${number}`).toBe(true);
    }
  });

  it('writes each cover letter for its role, dated the day it was drafted', () => {
    const letter = page.letterMarkdown(
      {
        id: 'search-infra',
        role: 'Senior Software Engineer, Search Infrastructure',
        company: 'Google',
        location: 'Seattle, WA',
      },
      '2026-10-02',
    );
    expect(letter.split('\n').slice(0, 6)).toEqual([
      '# Alex Morgan',
      page.BASE_RESUME.contact,
      '',
      'October 2, 2026',
      '',
      'Dear Google hiring team,',
    ]);
    const other = page.letterMarkdown(
      {
        id: 'northwind-backend',
        role: 'Senior Backend Engineer',
        company: 'Northwind Labs',
        location: 'Seattle, WA',
      },
      '2026-09-21',
    );
    expect(other).toContain('September 21, 2026');
    expect(other).toContain('the Senior Backend Engineer role in Seattle');
    expect(other).toContain('to Northwind Labs.');
  });
});

// ------------------------------------------------------------------ the model, against the store

describe('Résumés model (DocsModel), from the store', () => {
  it('has no page access, so it runs without a document', () => {
    expect(docsModel.length).toBeGreaterThan(2000);
    expect(pageAccess(docsModel)).toEqual([]);
  });

  it('shows one default résumé and one default CV as badges, and offers each kind its own default', () => {
    const { store } = loadStore();
    const format = { ...store.format, today: store.today() };
    const seed = page.libraryRows(store.get().documents, format);
    expect(seed.map((row) => [row.id, row.badge, row.makeDefault, row.tag, row.relabel])).toEqual([
      ['resume-main', 'Default résumé', null, 'Résumé', 'Mark as CV'],
      ['cv-leadership', 'Default CV', null, 'CV', 'Mark as résumé'],
    ]);
    expect(seed.map((row) => row.meta)).toEqual(['PDF · updated Sep 26', 'DOCX · updated Sep 18']);
    // A second résumé offers Make default résumé; making it the default moves the badge.
    store.update({ type: 'documents' }, (state) => {
      state.documents.library.push({
        id: 'resume-2',
        name: 'Alex_Morgan_Platform.pdf',
        variant: 'resume',
        format: 'PDF',
        updated: '2026-10-02',
      });
    });
    const two = page.libraryRows(store.get().documents, format);
    expect(two.find((row) => row.id === 'resume-2')).toMatchObject({
      badge: null,
      makeDefault: 'Make default résumé',
      meta: 'PDF · added today',
    });
    expect(store.setDefaultDocument('resume', 'resume-2')).toEqual({
      resume: 'resume-2',
      cv: 'cv-leadership',
    });
    const moved = page.libraryRows(store.get().documents, format);
    expect(moved.filter((row) => row.badge).map((row) => [row.id, row.badge])).toEqual([
      ['cv-leadership', 'Default CV'],
      ['resume-2', 'Default résumé'],
    ]);
    // The page's rule is the store's: a deleted or relabelled default hands over to the next.
    const documents = store.get().documents;
    const without = {
      ...documents,
      library: documents.library.filter((doc) => doc.id !== 'resume-2'),
    };
    expect(page.defaultsIn(without)).toEqual({ resume: 'resume-main', cv: 'cv-leadership' });
    const relabelled = {
      ...documents,
      library: documents.library.map((doc) =>
        doc.id === 'cv-leadership' ? { ...doc, variant: 'resume' } : doc,
      ),
    };
    expect(page.defaultsIn(relabelled)).toEqual({ resume: 'resume-2', cv: null });
    expect(store.setDefaultDocument('cv', 'resume-2')).toBeNull();
  });

  it('says what your deputy looks for and what it found, for each of the five checks', () => {
    const { store } = loadStore();
    const view = readinessOf(store);
    expect(view.state).toBe('read');
    expect(
      view.checks.map((check) => [
        check.title,
        check.done,
        partsText(check.lookingFor, store),
        partsText(check.found, store),
      ]),
    ).toEqual([
      [
        'Contact details',
        true,
        'Email, phone, and city near your name',
        'alex.morgan@example.com · +1 206 555 0148 · Seattle, WA',
      ],
      [
        'Summary',
        true,
        'Two to four sentences on what you do',
        '2 sentences, starting “Backend engineer with nine years in…”',
      ],
      [
        'Measurable results',
        false,
        'A number in half your bullets or more, where it’s true',
        '2 of 6 bullets have one',
      ],
      [
        'Keywords',
        false,
        'The skills found roles ask for most, where they’re true',
        '7 of the top 12 are on it',
      ],
      ['Length', true, 'Your page setting: 1 page', '1 page'],
    ]);
    expect([view.met, view.total]).toEqual([3, 5]);
    // The keyword and page figures are the store's own keys, shown once.
    const metrics = view.checks.flatMap((check) =>
      [...check.lookingFor, ...check.found].filter((part) => typeof part !== 'string'),
    );
    expect(metrics).toEqual([
      { metric: 'docs.keywordsFound' },
      { metric: 'docs.keywordsTotal' },
      { metric: 'docs.pageLimit' },
    ]);
    expect(view.checks.find((check) => check.id === 'results')?.meter).toEqual({
      value: 2,
      max: 6,
    });
  });

  it('checks the CV against the page setting when it is your default résumé, and waits on a file it can’t read', () => {
    const { store } = loadStore();
    const cv = readinessOf(store, 'cv-leadership');
    expect(cv.checks.find((check) => check.id === 'length')).toMatchObject({
      done: false,
      found: ['2 pages'],
    });
    expect(cv.checks.find((check) => check.id === 'summary')?.done).toBe(true);
    store.setPageLimit(2);
    expect(
      readinessOf(store, 'cv-leadership').checks.find((check) => check.id === 'length')?.done,
    ).toBe(true);
    const upload = page.readinessView({
      doc: {
        id: 'doc-x',
        name: 'Mine.pdf',
        variant: 'resume',
        format: 'PDF',
        updated: '2026-10-02',
      },
      markdown: null,
      pageLimit: 1,
      keywords: { found: 0, total: 12 },
    });
    expect(upload).toMatchObject({ state: 'unread', name: 'Mine.pdf', checks: [] });
    expect(
      page.readinessView({
        doc: null,
        markdown: null,
        pageLimit: 1,
        keywords: { found: 0, total: 12 },
      }).state,
    ).toBe('none');
  });

  it('counts the top keywords across found roles, exactly as the store does, and follows a live run', () => {
    const { store, clock } = loadStore();
    const rows = page.keywordRows(store.keywordStats());
    expect(rows).toHaveLength(12);
    expect(
      rows.slice(0, 4).map((row) => [row.keyword, row.roles, row.onResume, row.share]),
    ).toEqual([
      ['Distributed systems', 18, true, 0.667],
      ['Go', 12, true, 0.444],
      ['Kubernetes', 10, true, 0.37],
      ['Java', 9, false, 0.333],
    ]);
    for (const row of rows) expect(store.metric(row.metric)).toBe(row.roles);
    expect(rows.filter((row) => row.onResume)).toHaveLength(
      Number(store.metric('docs.keywordsFound')),
    );
    // Round 6 (D2, A2's world section 0): the nightly check (r9, Fri, Oct 2) now keeps three of
    // the 27 roles, so the counts last changed that day, not on Thu, Oct 1.
    expect([
      store.metricText('docs.keywordsBasedOn'),
      store.metricText('docs.keywordsUpdatedAt'),
    ]).toEqual(['27', 'Fri, Oct 2']);
    // The seed's live Amazon run finishes after 100 seconds; its two roles join the counts.
    clock.now += 100 * 1000;
    store.metrics();
    const after = page.keywordRows(store.keywordStats());
    expect(after[0]).toMatchObject({ keyword: 'Distributed systems', roles: 20 });
    for (const row of after) expect(store.metric(row.metric)).toBe(row.roles);
    expect([
      store.metricText('docs.keywordsBasedOn'),
      store.metricText('docs.keywordsUpdatedAt'),
    ]).toEqual(['29', 'Fri, Oct 2']);
  });

  it('lists every draft from drafts(), with its role, company, kind, status, pages, template, and date', () => {
    const { store } = loadStore();
    const rows = page.draftRows(store.drafts(), store.templates(), store.format);
    expect(rows).toHaveLength(Number(store.metric('docs.drafts')));
    expect(rows.slice(0, 3).map((row) => [row.id, row.status, row.meta, row.open])).toEqual([
      [
        'search-infra-resume',
        'waiting',
        'Google · 1 page · Classic · updated Oct 2',
        './materials-preview.html?app=search-infra&from=resumes',
      ],
      [
        'search-infra-letter',
        'waiting',
        'Google · 1 page · Classic · updated Oct 2',
        './materials-preview.html?app=search-infra&from=resumes&type=cover',
      ],
      [
        'cloud-reliability-resume',
        'draft',
        'Google Cloud · 1 page · Classic · updated Oct 2',
        './materials-preview.html?app=cloud-reliability&from=resumes',
      ],
    ]);
    for (const status of ['waiting', 'draft', 'approved']) {
      expect(rows.filter((row) => row.status === status)).toHaveLength(
        Number(store.metric(`docs.drafts.${status}`)),
      );
    }
    expect(rows[0]?.search).toBe(
      'Tailored résumé Senior Software Engineer, Search Infrastructure Google Waiting for your approval Classic',
    );
    expect(page.companiesIn(rows).map((company) => [company.key, company.name])).toEqual([
      ['google', 'Google'],
      ['google-cloud', 'Google Cloud'],
      ['amazon', 'Amazon'],
      ['northwind-labs', 'Northwind Labs'],
      ['contoso-health', 'Contoso Health'],
    ]);
    // A template chosen for a role in Materials shows here too, by name, and so do the pages a
    // saved edit runs to (Materials saves them with the text).
    expect(store.setDraftTemplate('search-infra', 'compact')).toBe('compact');
    store.update({ type: 'documents' }, (state) => {
      state.documents.edits['search-infra'] = {
        resume: '# Alex Morgan',
        pages: { resume: 2, letter: 1 },
      };
    });
    const relaid = page.draftRows(store.drafts(), store.templates(), store.format);
    expect(relaid.slice(0, 2).map((row) => [row.id, row.templateName, row.meta])).toEqual([
      ['search-infra-resume', 'Compact', 'Google · 2 pages · Compact · updated Oct 2'],
      ['search-infra-letter', 'Compact', 'Google · 1 page · Compact · updated Oct 2'],
    ]);
    // Your template for new drafts leaves the drafts you already have as they are.
    store.setTemplate('modern');
    expect(page.draftRows(store.drafts(), store.templates(), store.format)[2]?.templateName).toBe(
      'Classic',
    );
  });

  it('checks an uploaded template in the browser: Markdown, {{name}}, and only the placeholders listed', () => {
    const { store } = loadStore();
    const placeholders = store.TEMPLATE_PLACEHOLDERS.map((entry) => entry.id);
    expect(placeholders).toEqual([
      '{{name}}',
      '{{contact}}',
      '{{headline}}',
      '{{summary}}',
      '{{experience}}',
      '{{skills}}',
      '{{education}}',
      '{{certifications}}',
    ]);
    const good = '# {{name}}\n{{contact}}\n\n## Work\n{{experience}}';
    expect(page.checkTemplate({ name: 'Two column.md' }, good, placeholders)).toMatchObject({
      ok: true,
      name: 'Two column',
      uses: ['{{name}}', '{{contact}}', '{{experience}}'],
    });
    const failures = [
      [{ name: 'resume.docx' }, good, 'Choose a Markdown file'],
      [{ name: 'empty.md' }, '  \n', 'empty.md is empty'],
      [{ name: 'long.md' }, `{{name}}${'x'.repeat(20000)}`, 'long.md is too long'],
      [{ name: 'photo.md' }, '# {{name}}\n{{photo}}', 'photo.md uses {{photo}}'],
      [{ name: 'nameless.md' }, '## {{summary}}', 'nameless.md needs {{name}}'],
    ] as const;
    for (const [file, text, title] of failures) {
      expect(page.checkTemplate(file, text, placeholders)).toMatchObject({ ok: false, title });
    }
    // The store adds a checked template and keeps it in this browser.
    const added = store.addTemplate({ name: 'Two column', markdown: good });
    expect(added).toMatchObject({ name: 'Two column', builtIn: false });
    expect(store.templates().map((template) => template.id)).toEqual([
      'classic',
      'modern',
      'compact',
      'custom-1',
    ]);
  });
});

// ------------------------------------------------------------------ what's missing (R2)

describe('Résumés: what’s missing, for which roles, and how to fix it (R2)', () => {
  const main = mainOf(documents);

  it('lists each missing skill from the store, with who asks for it and its two fixes', () => {
    const { store } = loadStore();
    const rows = page.gapRows(store.readinessGaps());
    // The usual sample: the top 12 keywords minus the 7 on your résumé, most roles first.
    expect(rows.map((row) => [row.label, row.roles])).toEqual([
      ['Java', 9],
      ['Technical strategy', 8],
      ['Incident response', 5],
      ['People management', 5],
      ['Hiring', 4],
    ]);
    // How many roles ask is the keyword's own figure, already on its bar, so a row names the
    // roles instead of counting them again (R3-4).
    for (const row of rows) {
      const slug = row.id.replace(/^keyword-/, '');
      expect(store.metric(`keyword.${slug}`), row.label).toBe(row.roles);
      expect(row.text, row.label).not.toMatch(/\d/);
    }
    expect(rows[0]?.text).toBe('Found roles ask for it, including Workspace at Google');
    // See which roles: the first five, the roles you track first, each linking to its page.
    expect(page.ROLES_SHOWN).toBe(5);
    expect(rows[0]?.neededBy.slice(0, 2)).toEqual([
      {
        id: 'workspace',
        title: 'Backend Software Engineer, Workspace',
        company: 'Google',
        tracked: true,
        href: './applications-preview.html?open=workspace',
      },
      {
        id: 'amazon-sde2',
        title: 'Software Development Engineer II',
        company: 'Amazon',
        tracked: true,
        href: './applications-preview.html?open=amazon-sde2',
      },
    ]);
    expect(rows[0]?.neededBy).toHaveLength(5);
    expect(rows[0]?.allRoles).toHaveLength(9);
    expect(rows[4]?.allRoles).toEqual([]);
    // Add it yourself opens your skills in Profile; your deputy asks three short questions.
    expect(rows[0]?.add).toEqual({
      label: 'Add it yourself',
      href: './profile-preview.html#field-profile.skills',
    });
    expect(rows[0]?.ask?.label).toBe('Let your deputy ask you');
    expect(rows[0]?.ask?.questions.map((question) => [question.id, question.kind])).toEqual([
      ['used', 'yes-no'],
      ['where', 'choice'],
      ['what', 'text'],
    ]);
    expect(rows[0]?.ask?.questions[0]?.options).toEqual([
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ]);
  });

  it('drafts a line from your answers for your approval, and adds it only when you say so', () => {
    const { store } = loadStore();
    expect(Number(store.metric('docs.keywordsFound'))).toBe(7);
    const draft = store.draftFromAnswers('keyword-java', {
      used: 'yes',
      where: 'litware',
      what: 'wrote the billing event store in Java',
    });
    expect(draft).toMatchObject({ ok: true, line: 'Wrote the billing event store in Java.' });
    // Drafting changes nothing; Use this line does.
    expect(page.gapRows(store.readinessGaps())).toHaveLength(5);
    expect(
      store.acceptDraftLine('keyword-java', {
        line: 'Wrote the billing event store in Java 17.',
        experienceId: draft.where?.experienceId,
      }).ok,
    ).toBe(true);
    expect(page.gapRows(store.readinessGaps()).map((row) => row.label)).not.toContain('Java');
    expect(Number(store.metric('docs.keywordsFound'))).toBe(8);
    expect(store.draftFromAnswers('keyword-hiring', { used: 'no' })).toMatchObject({
      ok: false,
      reason: 'not-true',
    });
  });

  it('draws the list under the keyword bars, three at a time, with the flow wired to the store', () => {
    // Under the bars it comes from, with its own sample line.
    expect(main.indexOf('id="readiness-gaps"')).toBeGreaterThan(main.indexOf('id="keyword-bars"'));
    expect(main.indexOf('id="readiness-gaps"')).toBeLessThan(main.indexOf('id="templates"'));
    const box =
      main.match(
        /<div class="docs-gaps" id="readiness-gaps" hidden>[\s\S]*?<\/div>\s*<\/section>/,
      )?.[0] ?? '';
    expect(textOf(box.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? '')).toBe(
      'What’s missing, and for which roles',
    );
    expect(box).toContain(
      '<p class="sample-note">Sample: your deputy’s questions and lines are drafted in this browser</p>',
    );
    expect(page.GAPS_SHOWN).toBe(3);
    for (const part of [
      "typeof store.readinessGaps === 'function' &&",
      // D6: What's missing follows the role the keywords show.
      'return gapRows(keywordRole === ALL_ROLES ? store.readinessGaps() : store.readinessGaps({ role: keywordRole }));',
      'const result = open',
      ': store.draftFromAnswers(id, answers);',
      'const result = store.acceptDraftLine(id, { line, experienceId: state.draft?.where?.experienceId });',
      `gapsMore.textContent = gapsExpanded ? 'Show fewer' : \`Show all \${rows.length}\`;`,
      "actions.append(submit, gapButton('Not now', 'close'));",
      "if (state.step !== 'edit') actions.append(gapButton('Edit', 'edit'));",
      "const use = el('button', 'secondary-action', 'Use this line');",
      "react('found', { speech: 'Here’s a line for you.' });",
      "react('saved', { speech: 'It’s on your résumé now.' });",
      'components().seeAll.open(',
    ]) {
      expect(script, part).toContain(part);
    }
  });
});

// ------------------------------------------------------------------ round 7

describe('Résumés, round 7: one home per thing (R10-3)', () => {
  const main = mainOf(documents);

  it('links each draft’s role to its one home: its card in Applications, or the role in Job matches', () => {
    expect(page.roleHome({ appId: 'search-infra' })).toEqual({
      roleHref: './applications-preview.html?open=search-infra',
      roleIn: 'Applications',
    });
    expect(page.roleHome({ appId: null, jobId: 'job-7' })).toEqual({
      roleHref: './jobs-preview.html?job=job-7',
      roleIn: 'Job matches',
    });
    expect(page.roleHome({})).toEqual({ roleHref: null, roleIn: null });
    const { store } = loadStore();
    const rows = page.draftRows(store.drafts(), store.templates(), store.format);
    expect(
      rows.every((row) => row.roleHref === `./applications-preview.html?open=${row.appId}`),
    ).toBe(true);
    expect(new Set(rows.map((row) => row.roleIn))).toEqual(new Set(['Applications']));
    // The Large account demo's drafts started from Job matches go to their role there.
    const large = loadStore('?demo=large').store;
    const fromJobs = page
      .draftRows(large.drafts(), large.templates(), large.format)
      .filter((row) => !row.appId);
    expect(fromJobs.length).toBeGreaterThan(0);
    expect(
      fromJobs.every(
        (row) =>
          row.roleHref?.startsWith('./jobs-preview.html?job=') && row.roleIn === 'Job matches',
      ),
    ).toBe(true);
  });

  it('keeps your place when you leave for a home, and puts it back when you come Back', () => {
    // The role link and Open in Materials are shared return links (PL's place: return= and your
    // place saved on press), each with a focus key so Back lands on the control you left from.
    expect(script).toContain("link.dataset.returnLink = '';");
    expect(script).toContain(`link.dataset.focusKey = \`draft-role-\${row.id}\`;`);
    expect(script).toContain(
      `link.append(roleName, el('span', 'sr-only', \`, open in \${row.roleIn}\`));`,
    );
    expect(script).toContain("open.dataset.returnLink = '';");
    expect(script).toContain(`open.dataset.focusKey = \`draft-open-\${row.id}\`;`);
    // A missing skill's roles go to their homes the same way.
    expect(script).toContain(
      `link.dataset.focusKey = \`gap-role-\${domId(row.id)}-\${domId(role.id)}\`;`,
    );
    // What the address and the scroll don't keep: every missing skill shown, a skill's roles
    // opened, and all your templates shown; restored only on a return.
    expect(script).toMatch(
      /place\?\.remember\?\.\(\(\) => \(\{\s*gapsExpanded,\s*rolesOpen: \[\.\.\.gapState\]\.filter\(\(\[, state\]\) => state\.rolesOpen\)\.map\(\(\[id\]\) => id\),\s*templatesExpanded,\s*\}\)\);/,
    );
    expect(script).toContain('place?.restore?.((saved) => {');
    // The role link is a 44px target that keeps the title's layout at any number of lines.
    expect(documents).toMatch(
      /\.docs-draft-role \{\s*display: inline-flex;\s*padding-block: 12px;\s*margin-block: -12px;/,
    );
    // Résumés has no prompt view, no drawer, and no second editor of anything with a home.
    expect(main).not.toMatch(/data-prompt-open|prompt-drawer|data-prompt-control/);
  });
});

describe('Résumés, round 7: keywords by role (D6)', () => {
  const main = mainOf(documents);
  const figure =
    main.match(/<figure class="chart docs-keywords" id="keywords"[\s\S]*?<\/figure>/)?.[0] ?? '';

  it('puts the role switch under the title row, as the Dashboard’s: the shared choice chips', () => {
    expect(figure).toContain(
      '<fieldset class="docs-keyword-roles" id="keyword-roles" hidden>\n                  <legend class="sr-only">Show the keywords of</legend>\n                </fieldset>',
    );
    expect(figure.indexOf('id="keywords-top"')).toBeLessThan(figure.indexOf('id="keyword-roles"'));
    expect(figure.indexOf('id="keyword-roles"')).toBeLessThan(figure.indexOf('class="chart-key'));
    for (const part of [
      "const label = el('label', 'choice-chip');",
      "input.type = 'radio';",
      "input.name = 'keyword-role';",
      "for (const input of keywordRolesBox.querySelectorAll('input')) input.checked = input.value === view.id;",
    ]) {
      expect(script, part).toContain(part);
    }
  });

  it('says in the heading whose keywords it shows, with the store’s words and its found figure', () => {
    for (const search of ['', '?demo=large']) {
      const { store } = loadStore(search);
      const roles = store.keywordStats({ role: 'all' }).roles ?? [];
      expect(roles.map((role) => role.id)).toEqual([
        'all',
        'software-engineer',
        'product-engineer',
        'engineering-manager',
      ]);
      for (const role of roles) {
        const stats = store.keywordStats({ role: role.id });
        const view = page.keywordRoleView(stats);
        expect(view?.id).toBe(role.id);
        expect(view?.choices.map((choice) => choice.label)).toEqual([
          'All your roles',
          'Software engineer',
          'Product engineer',
          'Engineering manager',
        ]);
        // "Top keywords for Engineering manager roles, 9 found": the store's own heading, its
        // count the role's found figure (keywords.role.<role>.found) with its key.
        const text = (view?.heading ?? [])
          .map((part) => (typeof part === 'string' ? part : store.metricText(part.metric)))
          .join('');
        expect(text).toBe(stats.heading);
        expect(view?.heading[1]).toEqual({ metric: `keywords.role.${role.id}.found` });
        expect(Number(store.metric(`keywords.role.${role.id}.found`))).toBe(role.found);
        expect(store.metric(view?.totalMetric ?? '')).not.toBeNull();
      }
    }
    // A store without roles keeps today's heading ("Top keywords in the 27 roles your deputy found").
    expect(page.keywordRoleView(loadStore().store.keywordStats())).toBeNull();
    expect(figure).toContain(
      '<figcaption class="chart-title" id="keywords-title">Top keywords in the <span id="keywords-based-on" data-metric="docs.keywordsBasedOn"></span> roles your deputy found</figcaption>',
    );
  });

  it('counts each role’s bars with that role’s own figures, each with its key', () => {
    const { store } = loadStore();
    const all = page.keywordRows(store.keywordStats({ role: 'all' }));
    // All your roles keeps today's keys and figures, so the bars read as before.
    expect(all.map((row) => [row.keyword, row.roles, row.metric])).toEqual(
      page.keywordRows(store.keywordStats()).map((row) => [row.keyword, row.roles, row.metric]),
    );
    expect(all.every((row) => row.metric === `keyword.${row.slug}`)).toBe(true);
    for (const role of ['software-engineer', 'product-engineer', 'engineering-manager']) {
      const rows = page.keywordRows(store.keywordStats({ role }));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.metric).toBe(`keyword.${row.slug}.role.${role}`);
        expect(store.metric(row.metric)).toBe(row.roles);
      }
    }
    // The Engineering manager roles ask for people management most, which all roles don't.
    const manager = page.keywordRows(store.keywordStats({ role: 'engineering-manager' }));
    expect(manager[0]?.keyword).toBe('People management');
    expect(all[0]?.keyword).toBe('Distributed systems');
  });

  it('keeps the choice in the address, draws it in place, and says the new heading once', () => {
    for (const part of [
      "let keywordRole = String(parameters.get('keywords') ?? '').trim() || ALL_ROLES;",
      "if (role === ALL_ROLES) url.searchParams.delete('keywords');",
      "else url.searchParams.set('keywords', role);",
      // An old or mistyped ?keywords= shows all your roles, and the address says so.
      'const shownRole = view?.id ?? ALL_ROLES;',
      'syncKeywordsUrl(shownRole);',
      "keywordRolesBox.addEventListener('change', (event) => {",
      `announce(\`\${keywordsTitle.textContent.replace(/\\s+/g, ' ').trim()}.\`);`,
      // The readiness check stays on all your roles.
      'keywords: { found: stats.found, total: stats.total },',
    ]) {
      expect(script, part).toContain(part);
    }
  });

  it('follows the role in See all and What’s missing, each from the store for that role', () => {
    const { store } = loadStore();
    for (const role of ['software-engineer', 'product-engineer', 'engineering-manager']) {
      const bars = page.keywordRows(store.keywordStats({ role }));
      // See all: that role's keywords, the bars first, each with that role's count.
      const all = store.seeAll('keywords', { role });
      expect(all.total).toBe(Number(store.metric(`keywords.role.${role}.total`)));
      expect(all.items.slice(0, bars.length).map((item) => [item.label, item.count])).toEqual(
        bars.map((row) => [row.keyword, row.roles]),
      );
      // What's missing: that role's grey keywords, asked by that role's roles only.
      const gaps = page.gapRows(store.readinessGaps({ role }));
      expect(gaps.map((row) => row.label)).toEqual(
        bars.filter((row) => !row.onResume).map((row) => row.keyword),
      );
      for (const gap of gaps) {
        const bar = bars.find((row) => row.keyword === gap.label);
        expect(gap.roles).toBe(bar?.roles);
      }
    }
    // Engineering manager roles ask most for people management, which your résumé lacks.
    expect(page.gapRows(store.readinessGaps({ role: 'engineering-manager' }))[0]?.label).toBe(
      'People management',
    );
    expect(page.gapRows(store.readinessGaps())[0]?.label).toBe('Java');
    // See all's title names the role shown.
    expect(script).toContain(`? \`Keywords in the \${role.label} roles your deputy found\``);
  });
});

describe('Résumés, round 7: live updates change in place (R9-3, T3-3, T3-19)', () => {
  it('builds the filter bar once and changes only the Company choices when the companies change', () => {
    expect(count(script, /components\(\)\.filterBar\(/g)).toBe(1);
    expect(script).not.toContain('draftsFilterHost.replaceChildren(');
    expect(script).toMatch(
      /function renderDrafts\(\{ moved = false \} = \{\}\) \{\s*const rows = draftRowsNow\(\);\s*if \(!draftBar && typeof components\(\)\?\.filterBar === 'function'\) \{\s*canonicalCompanies\(rows\);\s*buildDraftBar\(rows\);\s*\} else \{\s*syncCompanyChoices\(rows\);\s*\}/,
    );
    // Only which companies there are counts (the menu orders them), and the counts follow.
    expect(script).toContain(
      "const names = companiesIn(rows).map((entry) => entry.name).sort().join('|');",
    );
    expect(script).toMatch(
      /if \(counts !== draftCountsSignature\) \{\s*draftCountsSignature = counts;\s*draftBar\?\.setCounts\(view\.counts\);/,
    );
  });

  it('writes the readiness checks, the keyword bars, the heading, and the templates only when they change', () => {
    for (const part of [
      'if (signature !== checksSignature) {',
      'if (signature === keywordBarsSignature) return;',
      'if (!item || item.dataset.slug !== row.slug) {',
      'while (keywordBars.children.length > bars.length) keywordBars.lastElementChild.remove();',
      'if (view && keywordsTitle.dataset.drawn !== headingText) {',
      'const signature = JSON.stringify([chosen, templatesExpanded, shown]);',
      'if (signature !== templatesSignature) {',
      `if (readinessFigure.textContent !== \`\${view.met}/\${view.total}\`) {`,
    ]) {
      expect(script, part).toContain(part);
    }
    expect(script).not.toMatch(/keywordBars\.replaceChildren\(/);
  });
});

describe('Résumés, round 7: drawn once, nothing moves (G2, R10-1)', () => {
  it('holds the first paint for its first render, then calls the shared boot', () => {
    // The head's render-blocking link waits for the marker after the last script, so the page is
    // painted once, as the script drew it (CLS 0.133 at 390 before, 0 after, usual and large).
    const head = documents.match(/<head>[\s\S]*?<\/head>/)?.[0] ?? '';
    expect(head).toContain('<link rel="expect" href="#first-view" blocking="render" />');
    expect(head.indexOf('href="./deputy.css"')).toBeLessThan(head.indexOf('rel="expect"'));
    expect(documents).toMatch(
      /<\/script>\n {4}<span id="first-view" hidden><\/span>\n {2}<\/body>/,
    );
    expect(count(documents, /id="first-view"/g)).toBe(1);
    expect(script).toMatch(
      /renderAll\(\);\s*\/\/ R1:[^\n]*\n\s*window\.JobDeputyPanels\?\.drawPromptSummaries\?\.\(document\);\s*\/\/ R10-1:[^\n]*\n[^\n]*\n\s*components\(\)\?\.boot\?\.ready\?\.\(\);/,
    );
  });
});

describe('Résumés script order', () => {
  it('loads the shell scripts in order, then its own script', () => {
    // Round 5: the prompt guard and the agreement's text load before the store (the
    // orchestrator's tags), so the Prompt drawer can check what you save.
    const order = [
      'app-shell.js',
      'app-components.js',
      'prompt-guard.js',
      'agreement-text.js',
      'sample-store.js',
      'deputy.js',
      'feedback.js',
      'app-panels.js',
    ].map((name) => documents.indexOf(`<script src="./${name}"></script>`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order[7]).toBeLessThan(documents.indexOf('<script>'));
  });
});
