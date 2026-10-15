import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Page guarantees for the materials editor (brand/materials-preview.html), a child of Résumés,
// round 3 (brief 4.6, findings 29 and 30): each draft in Markdown beside its pages, laid out live
// in the role's template by the shared paper, the page count against your page setting, a
// template switch that keeps your edits, Print that prints only those pages, and the prompts for
// tailor and letter; round 2's Job match, Changes, approval, and the autofill offer stay. Its pure
// blocks run here against the shared sample store; rendered checks run in headless Chrome.

const repoRoot = resolve(import.meta.dirname, '../..');
const sourceFor = (file: string): string => readFileSync(resolve(repoRoot, 'brand', file), 'utf8');
const materials = sourceFor('materials-preview.html');
const storeSource = sourceFor('sample-store.js');

const mainOf = (source: string): string => source.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? '';
// Template literals in the page, written with $( so they read as plain strings here.
const code = (text: string): string => text.replace(/\$\(/g, '${');
const stylesOf = (source: string): string =>
  [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1] ?? '').join('');
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
const pageAccess = (code: string): string[] =>
  code.replace(/\/\/.*$/gm, '').match(/\b(?:document|window)\s*\.|\blocalStorage\b/g) ?? [];
const jobsNames = (source: string): string[] => {
  const markup = textOf(source.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ''));
  const scripts = scriptOf(source).replace(/\/\/.*$/gm, '');
  return [
    ...(markup.match(/[^.]*\bJobs\b[^.]*/g) ?? []),
    ...(scripts.match(/'[^'\n]*\bJobs\b[^'\n]*'|`[^`\n]*\bJobs\b[^`\n]*`/g) ?? []),
  ].filter((text) => !/Amazon Jobs/.test(text));
};

// The body of one CSS block (an at-rule or a rule), found by its prelude.
function block(css: string, prelude: string): string {
  const start = css.indexOf(prelude);
  if (start < 0) return '';
  let depth = 0;
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(css.indexOf('{', start) + 1, index);
    }
  }
  return '';
}

type Template = { id: string; name: string; markdown: string };
type Draft = {
  id: string;
  appId: string;
  kind: string;
  template: string;
  pages: number;
  updated: string;
};
type Job = { keywords: string[]; sourceName: string; posted: string };
type Store = {
  get(): {
    applications: Array<{
      id: string;
      role: string;
      company: string;
      location: string;
      jobId?: string;
    }>;
    documents: { drafted: Record<string, Record<string, unknown>>; edits: Record<string, unknown> };
  };
  update(change: unknown, mutate: (state: ReturnType<Store['get']>) => void): unknown;
  templates(): Template[];
  drafts(): Draft[];
  job(id: string): Job | null;
  draftMaterials(appId: string): { ok: boolean; reason?: string };
  setDraftTemplate(appId: string, id: string): string | null;
};

function loadStore(): Store {
  const storage = new Map<string, string>();
  const window: Record<string, unknown> = { addEventListener: () => {}, location: { search: '' } };
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  runInNewContext(storeSource, { window, localStorage, JSON, Date });
  return window.JobDeputyStore as Store;
}

type Fields = Record<string, string>;
type Change = {
  id: string;
  kind: string;
  find: string;
  before: string;
  after: string;
  flag?: string;
};
type Logic = {
  BASE_RESUME: Fields;
  SAMPLE_LINES: Record<string, string>;
  tailoredFields(appId: string): Fields;
  fillTemplate(skeleton: string, fields: Fields): string;
  letterMarkdown(
    app: { id: string; role: string; company: string; location: string },
    day: string,
  ): string;
  changesFor(appId: string): Change[];
  matchKeywords(
    text: string,
    keywords: Array<string | { label: string; terms: string[] }>,
  ): Array<{ label: string; found: boolean }>;
  fileNameFor(company: string, type: string): string;
  fitText(
    result: { pages: number; limit: number; over: boolean; overflowLines: number } | null,
  ): string;
};

const main = mainOf(materials);
const script = scriptOf(materials);
const css = stylesOf(materials);
const logicBlock = blockOf(materials, 'MaterialsLogic');
const logic = new Script(
  `${blockOf(materials, 'SampleDocs')}\n${logicBlock}\n({ BASE_RESUME, SAMPLE_LINES, tailoredFields, fillTemplate, letterMarkdown, changesFor, matchKeywords, fileNameFor, fitText })`,
  { filename: 'materials-logic.js' },
).runInNewContext({}) as Logic;

describe('Materials editor: the desk', () => {
  it('splits the drafts into four ARIA tabs in the brief’s order', () => {
    const tablist = main.match(
      /<div class="tabs"[^>]*role="tablist"[^>]*data-tabs>([\s\S]*?)<\/div>/,
    );
    expect(tablist).not.toBeNull();
    const tabs = [...(tablist?.[1] ?? '').matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    expect(tabs.map((tab) => textOf((tab[2] ?? '').replace(/<span[\s\S]*<\/span>/, '')))).toEqual([
      'Tailored résumé',
      'Cover letter',
      'Job match',
      'Changes',
    ]);
    for (const [index, tab] of tabs.entries()) {
      const attributes = tab[1] ?? '';
      const id = attributes.match(/id="([^"]+)"/)?.[1] ?? '';
      const panel = attributes.match(/aria-controls="([^"]+)"/)?.[1] ?? '';
      expect(attributes).toContain('role="tab"');
      expect(attributes).toContain(`aria-selected="${index === 0}"`);
      if (index > 0) expect(attributes).toContain('tabindex="-1"');
      const panelTag = main.match(
        new RegExp(`<div class="tab-panel[^"]*" id="${panel}"[^>]*>`),
      )?.[0];
      expect(panelTag).toContain('role="tabpanel"');
      expect(panelTag).toContain(`aria-labelledby="${id}"`);
      expect(panelTag?.includes(' hidden')).toBe(index > 0);
    }
  });

  it('gives each draft a labelled Markdown editor beside the shared paper pages', () => {
    for (const [type, label] of [
      ['resume', 'Tailored résumé, in Markdown'],
      ['cover', 'Cover letter, in Markdown'],
    ]) {
      expect(main).toContain(`<label class="field-label" for="${type}-text">${label}</label>`);
      expect(main).toMatch(new RegExp(`<textarea\\s+class="document-editor"\\s+id="${type}-text"`));
      const stack =
        main.match(
          new RegExp(
            `<div\\s+class="paper-stack"\\s+id="${type}-paper"[\\s\\S]*?<div class="paper-pages"></div>`,
          ),
        )?.[0] ?? '';
      expect(stack).toMatch(/data-page-limit="1"\s+data-template="classic"/);
      expect(stack).toContain('<span class="paper-count" data-paper-count></span>');
      expect(main).toContain(`<p class="mat-fit" id="${type}-fit"></p>`);
    }
    // The text face keeps the Markdown marks easy to read; the pages are the shared paper.
    expect(block(css, '.document-editor {')).toContain('font-family: var(--font-text);');
    expect(css).not.toMatch(/\.mat-sheet/);
    // Round 7 (T3-22): the pages follow your typing once you pause, 300ms after the last key
    // and at most a second while you keep typing, laid out by paper.render; the Job match count
    // waits with them, and the keys never wait.
    expect(script).toMatch(
      /part\.editor\.addEventListener\('input', \(\) => \{[\s\S]*?queuePaper\(type, \{ match: matchSource === type \}\);/,
    );
    expect(script).toContain('const PAPER_WAIT_MS = 300;');
    expect(script).toContain('const PAPER_MAX_WAIT_MS = 1000;');
    expect(script).toContain(
      'paperTimer = window.setTimeout(flushPaper, Math.max(0, Math.min(PAPER_WAIT_MS, paperSince + PAPER_MAX_WAIT_MS - now)));',
    );
    // A save or an approval lays out what you typed first, so the pages saved are the text's.
    expect(script).toMatch(/const savedPages = \(\) => \{\s*flushPaper\(\);/);
    expect(script).toContain(
      'const result = components().paper.render(part.paper, part.editor.value, { template, limit });',
    );
    // T3-19: laid out again only when the text, template, page setting, or tab changed.
    expect(script).toContain(
      `const key = \`\${template}|\${limit}|\${part.panel.hidden ? 'hidden' : 'shown'}|\${part.editor.value}\`;`,
    );
    expect(script).toContain('if (key === paperDrawn[type]) return;');
    expect(script).toContain('const fit = fitText(result);');
  });

  it('switches the template over both drafts, and shows the page setting read only, with its home', () => {
    const controls =
      main.match(/<div\s+class="mat-controls"[\s\S]*?id="draft-template-note"/)?.[0] ?? '';
    expect(controls).toContain('<label class="field-label" for="draft-template">Template</label>');
    expect(controls).toContain('<select class="field-control" id="draft-template"');
    // Round 7 (R10-3, the orchestrator's decision): the page setting's home is Résumés'
    // Templates. Here it is one read only line, "Your page setting: 1 page", the figure the
    // store's own, and one link to its home that keeps your place (and unsaved edits) for Back.
    expect(controls).not.toMatch(/<fieldset|type="radio"|segmented/);
    expect(controls).toContain(
      '<span class="mat-page-words" id="draft-pages-words">Your page setting: <strong><span id="draft-pages-value" data-metric="docs.pageLimit"></span> <span id="draft-pages-unit">page</span></strong></span>',
    );
    expect(controls).toContain(
      '<a class="compact-action" id="draft-pages-change" href="./documents-preview.html#page-setting" data-return-link data-focus-key="draft-pages-change" aria-describedby="draft-pages-words">Change in Résumés</a>',
    );
    expect(script).toContain("const text = store.metricText('docs.pageLimit');");
    expect(script).toContain("const unit = pageLimit() === 1 ? 'page' : 'pages';");
    expect(script).not.toContain('store.setPageLimit(');
    // Résumés' page setting is where the link lands.
    expect(sourceFor('documents-preview.html')).toContain(
      '<fieldset class="segmented" id="page-setting">',
    );
    expect(textOf(main)).toContain('One page with only what this role needs is recommended.');
    // The options are the store's templates; a choice lays the résumé out again, keeping edits.
    expect(script).toContain('const options = templatesNow().map((entry) => {');
    expect(script).toContain(
      'relayTemplate(part.editor.value, from.markdown, to.markdown, tailoredFields(fieldsKey))',
    );
    expect(script).toContain('if (appId) store.setDraftTemplate(appId, to.id);');
    expect(script).not.toContain('state.documents.drafted');
    expect(script).toMatch(/react\('saved', \{ speech: `I laid it out in \$\{to\.name\}\.` \}\);/);
  });

  it('keeps every action for both drafts, prints only their pages, and downloads Markdown', () => {
    for (const panel of ['panel-resume', 'panel-cover']) {
      const html =
        main.match(new RegExp(`id="${panel}"[\\s\\S]*?<div class="mat-blank"`))?.[0] ?? '';
      for (const [action, label] of [
        ['save', 'Save changes'],
        ['restore', 'Restore generated draft'],
        ['print', 'Print these pages'],
        ['copy', 'Copy text'],
        ['download', 'Download .md'],
      ]) {
        expect(html).toContain(`data-action="${action}">${label}</button>`);
      }
      // The pages at reading size, in the shared preview dialog.
      expect(html).toContain(
        'data-action="enlarge" aria-haspopup="dialog">Larger preview</button>',
      );
    }
    expect(script).toContain("else if (action === 'enlarge') enlargeDraft(type, control);");
    expect(script).toContain('source: parts[type].editor.value,');
    expect(script).toContain(
      "const blob = new Blob([part.editor.value], { type: 'text/markdown;charset=utf-8' });",
    );
    expect(script).toContain('link.download = name;');
    // Print these pages prints only that draft's pages; the browser's own Print prints the draft
    // in view the same way. The page has no print rules of its own: the shared paper's apply.
    expect(script).toContain('components().paper.print(parts[type].paper);');
    expect(script).toMatch(
      /window\.addEventListener\('beforeprint', \(\) => \{[\s\S]*?printMark\.setAttribute\('data-paper-print', ''\);/,
    );
    expect(script).toMatch(
      /window\.addEventListener\('afterprint', \(\) => \{[\s\S]*?removeAttribute\('data-paper-print'\)/,
    );
    expect(css).not.toContain('@media print');
  });

  it('saves the pages each draft runs to with its text, for the drafts library', () => {
    expect(script).toContain('if (result) pagesNow[type] = result.pages;');
    expect(script).toContain('writeEdits({ [type]: part.editor.value, pages: savedPages() });');
    expect(script).toContain('writeEdits({ resume: relaid, pages: savedPages() });');
    expect(script).toMatch(/cover: parts\.cover\.editor\.value,\s*pages: savedPages\(\),/);
  });

  it('shows the prompts it runs as the shared prompt summary: tailor for the résumé, letter for the cover letter', () => {
    // Round 7 (R1, R10-5): each draft's prompt is the shared prompt summary row between its file
    // line and the desk, with Open in Prompts (return=); no See the prompt and no drawer here.
    const resume = main.match(/id="panel-resume"[\s\S]*?<div class="mat-desk"/)?.[0] ?? '';
    const cover = main.match(/id="panel-cover"[\s\S]*?<div class="mat-desk"/)?.[0] ?? '';
    expect(resume).toContain(
      '<div class="mat-prompt" id="resume-prompt" data-prompt-summary="tailor" data-prompt-size="row" data-prompt-heading="3"></div>',
    );
    expect(cover).toContain(
      '<div class="mat-prompt" id="cover-prompt" data-prompt-summary="letter" data-prompt-size="row" data-prompt-heading="3"></div>',
    );
    expect(count(main, /data-prompt-summary=/g)).toBe(2);
    expect(`${main}${script}`).not.toMatch(
      /data-prompt-open|See the prompt|openPrompt|prompt-drawer|data-prompt-control/,
    );
    // The row hides with its draft's file line while there are no drafts yet.
    expect(script).toContain(`prompt: $(\`#\${type}-prompt\`),`);
    expect(script).toContain('part.prompt.hidden = !has;');
  });

  it('marks a short tour on what each step explains: the editor, the pages, the controls, Approve', () => {
    const steps = [...main.matchAll(/data-tour-step="(\d)"[\s\S]*?data-tour-title="([^"]+)"/g)].map(
      (m) => [m[1], m[2]],
    );
    // Round 6 (R6-2): the deputy gives the tour, so each title is his speech line (first person,
    // six words at most). Step 4 moves with the approval to the top (A2: Approve and apply).
    expect(steps.sort()).toEqual([
      ['1', 'I drafted this. You edit it.'],
      ['2', 'These pages print as shown.'],
      ['3', 'Pick a template for both.'],
      ['4', 'Approve here, and I apply.'],
    ]);
    expect(main).toMatch(/id="mat-approve-apply"[^>]*data-tour-step="4"/);
    for (const match of main.matchAll(/data-tour-title="([^"]+)"\s+data-tour-text="([^"]+)"/g)) {
      expect((match[1] ?? '').split(/\s+/).length).toBeLessThanOrEqual(6);
      expect(`${match[1]} ${match[2]}`).toMatch(/\bI\b/);
    }
    // The steps ring the content itself, not a heading above it.
    expect(main).toMatch(
      /<textarea\s+class="document-editor"\s+id="resume-text"[^>]*data-tour-step="1"/,
    );
    expect(main).toMatch(/<div\s+class="paper-stack"\s+id="resume-paper"[^>]*data-tour-step="2"/);
    // Round 6 (R6-3): Take the tour sits in the shared page intro's actions.
    expect(main).toContain(
      '<div class="page-intro-actions">\n            <button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour</button>',
    );
  });

  it('writes no role, date, or count into the markup: the store fills them', () => {
    expect(main).toContain(
      '<ol class="timeline" id="role-timeline" aria-labelledby="trail-title"></ol>',
    );
    expect(textOf(main)).not.toMatch(/\b(?:Sep|Oct)\s\d|\b\d+ of \d+\b/);
    expect(script).toContain('const job = app.jobId ? store.job(app.jobId) : null;');
  });
});

describe('Materials editor: approval and the routes around it', () => {
  it('asks before approving, says what approval means, and that nothing is sent', () => {
    // Round 6 (P-13): the top bar is the only place to approve: Approve and apply, then Approve
    // only (secondary) with its confirmation and the approved panel; the section below keeps the
    // role's record.
    const approval =
      main.match(/<div class="mat-apply" id="mat-apply" hidden>[\s\S]*?id="mat-apply-done"/)?.[0] ??
      '';
    expect(approval).toContain(
      '<button class="secondary-action" id="approve-open" type="button" aria-describedby="mat-apply-note">Approve only</button>',
    );
    const bottom =
      main.match(/<section class="task-surface[^"]*" id="approval"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(bottom).not.toMatch(/approve-open|approve-confirm|id="approved"|primary-action/);
    expect(bottom).toContain('<h3 class="mat-trail-title" id="trail-title">This role so far</h3>');
    expect(main).not.toContain('id="job-stage"');
    const confirm = textOf(
      approval.match(
        /<div class="mat-confirm" id="approve-confirm" hidden>([\s\S]*?)<\/div>\s*<div class="mat-approved"/,
      )?.[1] ?? '',
    );
    expect(confirm).toContain('Approve both drafts for this role?');
    expect(confirm).toContain('marked final');
    expect(confirm).toContain('Nothing is sent.');
    expect(confirm).toContain('Not yet');
    expect(script).toMatch(/In this prototype nothing is sent to \$\{company\}\./);
    // Both ways on name each other: you apply on the employer site, or your deputy fills it.
    expect(confirm).toContain(
      'Next, you apply on the employer site, or let your deputy fill the application (planned for launch; a preview here).',
    );
    expect(script).toContain(
      'Then you apply on the employer site, or let your deputy fill the application (planned for launch).',
    );
    expect(script).toContain(
      'Next, apply on the employer site and mark it applied, or let your deputy fill the application below (a preview; nothing is sent).',
    );
    expect(script).toContain("next: 'Apply on the employer site, or let your deputy fill it',");
    expect(materials).not.toContain('you apply on the employer site yourself');
    expect(script).toMatch(/approveConfirm\.addEventListener\('keydown'[\s\S]*?'Escape'/);
  });

  it('records approval in the store, reacts once, and can undo it', () => {
    expect(script).toMatch(
      /store\.moveApplication\(appId, [^,]+, \{\s*label: 'Materials approved',\s*by: 'you',\s*approval: 'approved',\s*materials: 'approved',/,
    );
    expect(script).toContain(
      "deputy()?.set('pending', { working: true, duty: 'Working', speech: 'Marking these final.' });",
    );
    expect(script).toContain("react('approved', { speech: 'Approved. Nothing was sent.' });");
    expect(script).not.toContain("flash('success'");
    expect(script).toContain("approveUndo.addEventListener('click', () => {");
    expect(script).toContain(
      "if (last?.label === 'Materials approved' && last.by === 'you') item.timeline.pop();",
    );
  });

  it('offers the autofill preview once the materials are approved', () => {
    const approved =
      main.match(
        /<div class="mat-approved" id="approved" hidden>([\s\S]*?)<div class="mat-button-row" id="approved-actions">/,
      )?.[1] ?? '';
    expect(approved).toMatch(
      /<a class="mat-fill" id="approved-fill" href="\.\/autofill-preview\.html\?app=search-infra">/,
    );
    expect(textOf(approved)).toContain('Let your deputy fill the application (preview)');
    expect(textOf(approved)).toContain('Nothing is sent.');
    expect(script).toMatch(
      /if \(appId\) approvedFill\.href = `\.\/autofill-preview\.html\?app=\$\{encodeURIComponent\(appId\)\}`;/,
    );
    // After Approve and apply, only your deputy's progress shows (UAT M-3): the approved panel is
    // for Approve only (or a stopped run).
    expect(script).toContain("approved.hidden = mode !== 'approved' || bgShown;");
  });

  it('opens the role from ?app=, names its origin, and returns to the drafts from Résumés', () => {
    expect(script).toContain("const DEFAULT_APP = 'search-infra';");
    expect(script).toContain("const requested = parameters.get('app');");
    expect(script).toContain("const title = parameters.get('job');");
    const origins = script.match(/const backOrigins = new Map\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
    expect(
      [...origins.matchAll(/\['(\w+)', \['([^']+)', '([^']+)'\]\]/g)].map((match) =>
        match.slice(1),
      ),
    ).toEqual([
      ['applications', './applications-preview.html', '← Applications'],
      ['jobs', './jobs-preview.html', '← Job matches'],
      ['resumes', './documents-preview.html', '← Résumés'],
    ]);
    expect(script).toContain("materialsBack.href = './documents-preview.html#drafts';");
    expect(script).toContain(": ['./jobs-preview.html', 'Open Job matches'];");
    expect(jobsNames(materials)).toEqual([]);
  });

  it('drafts a role with the store, and says when your deputy used the drafts', () => {
    expect(script).toContain('const result = store.draftMaterials(appId);');
    expect(script).toContain("? ['approve', 'Approved', 'I used these. Nothing sent.']");
    expect(script).toContain("? 'Your deputy used these drafts.'");
  });

  // Round 4, UAT-D-1: at your key's limit the empty state names no model; beside Draft materials
  // the store's words (aiChoice().summary) say drafting is paused until a date, or that drafts use
  // platform credits, with Change limit; a refused draft says it didn't start, and focus stays.
  it('says beside Draft materials why it can’t start at your key’s limit, and until when', () => {
    expect(script).toContain('copy = choice.limited');
    expect(script).toContain("const limit = el('a', 'secondary-action', 'Change limit');");
    expect(script).toContain("limit.href = './ai-preview.html#limit';");
    expect(script).toContain("more.dataset.topupOpen = 'credits';");
    expect(script).toContain(code('const summary = `$(choice.summary}.`;'));
    expect(script).toContain(
      "figure.dataset.metric = paused ? 'ai.limit.pausedUntil' : 'ai.limit.resetsAt';",
    );
    expect(script).toContain("control.setAttribute('aria-describedby', note.id);");
    expect(script).toContain(
      "if (paused) heading = refused ? 'Drafting didn’t start' : 'Drafting is paused';",
    );
    expect(script).toContain("let heading = 'Drafts use platform credits';");
    expect(script).toContain(
      "result?.reason === 'own-key-limit-reached' && choice.limited === 'paused'",
    );
    expect(script).toContain(code('announce(`Drafting didn’t start. $(choice.summary}.`);'));
    // The empty state is rebuilt when the limit changes, and the dock stops saying "ready".
    expect(script).toContain(code(':$(choice.limited}:$(choice.until}:$(store.aiLimit().onReach}'));
    expect(script).toContain("? ['idle', 'Waiting', 'Drafting waits on your limit.']");
    expect(stylesOf(materials)).toMatch(/\.mat-draft-note \{[^}]*text-align: start;/);
  });
});

describe('Materials at your key’s limit, against the store', () => {
  type LimitStore = Store & {
    reset(): void;
    setAiLimit(limit: { tokens: number; period: string; onReach: string }): unknown;
    aiChoice(): { limited: string | null; until: string | null; summary: string; text: string };
    draftMaterials(appId: string): { ok: boolean; reason?: string; resetsAt?: string };
    format: { date(iso: string): string };
  };

  it('refuses a draft with the reason and reset while paused, and drafts on platform credits otherwise', () => {
    const store = loadStore() as LimitStore;
    expect(store.aiChoice().limited).toBeNull();
    store.setAiLimit({ tokens: 10000, period: 'month', onReach: 'pause' });
    const paused = store.aiChoice();
    expect(paused.limited).toBe('paused');
    expect(paused.summary).toBe(
      `Your OpenAI key reached your limit: AI work is paused until ${store.format.date(paused.until ?? '')}`,
    );
    expect(paused.summary).not.toContain('gpt-5-mini');
    const refused = store.draftMaterials('workspace');
    expect(refused).toMatchObject({
      ok: false,
      reason: 'own-key-limit-reached',
      resetsAt: paused.until,
    });
    store.setAiLimit({ tokens: 10000, period: 'month', onReach: 'platform' });
    const platform = store.aiChoice();
    expect(platform.limited).toBe('platform');
    expect(platform.summary).toContain('on platform credits until');
    expect(store.draftMaterials('workspace').ok).toBe(true);
    expect(store.get().documents.drafted.workspace?.model).toBe(
      'Ministral 3 14B on platform credits',
    );
  });
});

describe('Materials logic, run on its own', () => {
  const store = loadStore();
  const skeletons = store.templates().map((template) => template.markdown);

  it('has no page access, so it runs without a document', () => {
    expect(logicBlock.length).toBeGreaterThan(2000);
    expect(pageAccess(logicBlock)).toEqual([]);
  });

  it('finds every change in its draft, in every template, against the document it came from', () => {
    for (const appId of [
      'search-infra',
      'devex',
      'cloud-reliability',
      'amazon-sde2',
      'northwind-backend',
    ]) {
      for (const skeleton of skeletons) {
        const text = logic.fillTemplate(skeleton, logic.tailoredFields(appId));
        for (const change of logic.changesFor(appId)) {
          expect(text, `${appId}: ${change.id}`).toContain(change.find);
        }
      }
    }
    expect(
      logic.changesFor('search-infra').map((change) => [change.kind, Boolean(change.flag)]),
    ).toEqual([
      ['Rewrote', false],
      ['Expanded', true],
      ['Reordered', false],
    ]);
  });

  it('counts the posting’s keywords from the store in the current draft text', () => {
    const job = store.job('search-infra');
    expect(job?.keywords).toEqual([
      'Distributed systems',
      'Go',
      'Search relevance',
      'Latency',
      'Information retrieval',
      'C++',
    ]);
    const classic = skeletons[0] ?? '';
    const draft = logic.fillTemplate(classic, logic.tailoredFields('search-infra'));
    const results = logic.matchKeywords(draft, job?.keywords ?? []);
    expect(results.filter((entry) => !entry.found).map((entry) => entry.label)).toEqual([
      'Information retrieval',
      'C++',
    ]);
    // Typing a keyword into the draft finds it; the count is worked out, not stored.
    const edited = `${draft}\n- Built information retrieval services in C++.`;
    expect(
      logic.matchKeywords(edited, job?.keywords ?? []).filter((entry) => entry.found),
    ).toHaveLength(6);
    // Every role from Job matches finds most of its posting's keywords in its tailored draft.
    const counts = Object.fromEntries(
      ['search-infra', 'devex', 'cloud-reliability', 'amazon-sde2'].map((id) => {
        const keywords = store.job(id)?.keywords ?? [];
        const text = logic.fillTemplate(classic, logic.tailoredFields(id));
        return [
          id,
          `${logic.matchKeywords(text, keywords).filter((entry) => entry.found).length} of ${keywords.length}`,
        ];
      }),
    );
    expect(counts).toEqual({
      'search-infra': '4 of 6',
      devex: '4 of 6',
      'cloud-reliability': '4 of 5',
      'amazon-sde2': '5 of 6',
    });
  });

  it('matches whole words only, with plurals and the other words a keyword appears as', () => {
    const found = (text: string, keywords: string[]) =>
      logic
        .matchKeywords(text, keywords)
        .filter((entry) => entry.found)
        .map((entry) => entry.label);
    expect(found('Wrote algorithms; slower builds.', ['Go', 'SLOs'])).toEqual([]);
    expect(found('Set SLOs and mentored two engineers.', ['SLOs', 'Mentoring'])).toEqual([
      'SLOs',
      'Mentoring',
    ]);
    expect(found('Reliable services in C++.', ['Reliability', 'C++'])).toEqual([
      'Reliability',
      'C++',
    ]);
  });

  it('says how a draft fits your page setting, with the lines to trim', () => {
    expect(logic.fitText({ pages: 1, limit: 1, over: false, overflowLines: 0 })).toBe(
      'Fits one page, the length that’s recommended.',
    );
    expect(logic.fitText({ pages: 2, limit: 1, over: true, overflowLines: 6 })).toBe(
      'Trim 6 lines to fit one page, or allow two pages.',
    );
    expect(logic.fitText({ pages: 3, limit: 2, over: true, overflowLines: 1 })).toBe(
      'Trim 1 line to fit your page setting.',
    );
    expect(logic.fitText({ pages: 1, limit: 2, over: false, overflowLines: 0 })).toBe(
      'Fits one page. Your setting allows two.',
    );
    expect(logic.fitText({ pages: 2, limit: 2, over: false, overflowLines: 0 })).toBe(
      'Fits your setting. One page is recommended.',
    );
  });

  it('keeps the established download names, now Markdown', () => {
    expect(logic.fileNameFor('Google', 'resume')).toBe('Alex_Morgan_Google_Tailored_Resume.md');
    expect(logic.fileNameFor('Google', 'cover')).toBe('Alex_Morgan_Google_Cover_Letter.md');
    expect(logic.fileNameFor('Google Cloud', 'resume')).toBe(
      'Alex_Morgan_Google_Cloud_Tailored_Resume.md',
    );
    expect(logic.fileNameFor('Northwind Labs', 'cover')).toBe(
      'Alex_Morgan_Northwind_Labs_Cover_Letter.md',
    );
  });

  it('keeps a template chosen here, and the pages saved, with the role’s drafts for Résumés', () => {
    expect(store.setDraftTemplate('search-infra', 'modern')).toBe('modern');
    expect(store.setDraftTemplate('search-infra', 'no-such-template')).toBeNull();
    store.update({ type: 'documents' }, (state) => {
      state.documents.edits['search-infra'] = {
        resume: '# Alex Morgan',
        pages: { resume: 2, letter: 1 },
      };
    });
    const rows = store.drafts().filter((draft) => draft.appId === 'search-infra');
    expect(rows.map((draft) => [draft.kind, draft.template, draft.pages, draft.updated])).toEqual([
      ['resume', 'modern', 2, '2026-10-02'],
      ['letter', 'modern', 1, '2026-10-02'],
    ]);
    // The seeded role still counts as drafted.
    expect(store.draftMaterials('search-infra')).toMatchObject({
      ok: false,
      reason: 'already-drafted',
    });
  });
});

// ------------------------------------------------------------------ round 7

describe('Materials, round 7: one home per thing (R10-3)', () => {
  it('links to the role’s home in Applications with your place kept, and Back names where you came from', () => {
    // Every Open in Applications is a shared return link (return= and this place saved on press).
    for (const id of ['job-link', 'approved-open', 'mat-apply-open']) {
      const link = main.match(new RegExp(`<a [^>]*id="${id}"[^>]*>`))?.[0] ?? '';
      expect(link, id).toContain('data-return-link');
    }
    expect(main).toContain(
      'id="job-link" href="./applications-preview.html" data-return-link data-focus-key="job-link"',
    );
    // Opened from a page that kept its place (?return=), the header's Back names that page and
    // goes back to just where you were; ?from= still works for older links.
    expect(script).toContain('const placeBack = components()?.place?.back ?? null;');
    expect(script).toMatch(
      /if \(placeBack\?\.href\) \{\s*\/\/[^\n]*\n\s*materialsBack\.href = \/\^\\\.\\\/documents-preview\\\.html\(\?:\\\?\[\^#\]\*\)\?\$\/\.test\(placeBack\.href\)\s*\? `\$\{placeBack\.href\}#drafts`\s*: placeBack\.href;\s*materialsBack\.textContent = `← \$\{placeBack\.name\}`;\s*\/\/[^\n]*\n\s*materialsBack\.dataset\.pageBackLink = '';\s*\} else if \(appId && parameters\.get\('from'\) === 'applications'\) \{/,
    );
    // One Back on the page: the header's ContextBackAction, never a second one in the intro.
    expect(main).not.toContain('data-page-back');
    expect(count(materials, /id="materials-back"/g)).toBe(1);
  });

  it('keeps the edits you have not saved when you leave for a home, and puts them back on return', () => {
    const remember =
      script.match(/place\?\.remember\?\.\(\(\) => \(\{[\s\S]*?\n {6}\}\)\);/)?.[0] ?? '';
    expect(remember).toMatch(
      /unsaved: Object\.fromEntries\(\s*TYPES\.filter\(\(type\) => dirty\[type\]\)\.map\(\(type\) => \[type, parts\[type\]\.editor\.value\]\),\s*\),/,
    );
    // The way Back is kept as well, since a return from a home drops this page's own return=.
    expect(remember).toContain("back: materialsBack.hasAttribute('data-page-back-link')");
    const restore =
      script.match(/place\?\.restore\?\.\(\(saved\) => \{[\s\S]*?\n {6}\}\);/)?.[0] ?? '';
    // Back is put back only as a page of this prototype, in the header's own words.
    expect(restore).toContain(
      "/^\\.\\/[a-z0-9-]+-preview\\.html(?:[?#]|$)/i.test(String(back?.href ?? ''))",
    );
    // Never into drafts that are approved (read only) or that aren't there.
    expect(restore).toContain('if (locked() || !hasDrafts(app)) return;');
    expect(restore).toContain('dirty[type] = true;');
    expect(restore).toContain('setStatus(type);');
    expect(restore).toContain('renderPaper(type);');
    expect(restore).toContain(
      "announce('Your edits are back as you left them. They aren’t saved yet.');",
    );
  });
});

describe('Materials, round 7: live updates change in place (R9-3, T3-19)', () => {
  it('writes the file names, the record, the Job match chips, and the changes only when they change', () => {
    for (const part of [
      'if (part.file.textContent !== fileName) setFileName(part.file, fileName);',
      'if (timeline.dataset.drawn !== drawn) {',
      'if (matchFound.dataset.drawn === drawn) return;',
      'if (changeList.dataset.drawn === drawn) return;',
      'const drawn = JSON.stringify([base, baseKind, [...confirmed].sort(), locked(), changes.map((change) => change.id)]);',
    ]) {
      expect(script, part).toContain(part);
    }
  });
});

describe('Materials, round 7: drawn once, nothing moves (G2, R10-1)', () => {
  it('holds the first paint for its first render, then calls the shared boot', () => {
    // The head's render-blocking link waits for the marker after the last script, so the top bar
    // (the review and Approve and apply) is decided before the paint: CLS 0.25 at 1440 and 0.52 at
    // 390 before, 0 after, usual and large.
    const head = materials.match(/<head>[\s\S]*?<\/head>/)?.[0] ?? '';
    expect(head).toContain('<link rel="expect" href="#first-view" blocking="render" />');
    expect(head.indexOf('href="./deputy.css"')).toBeLessThan(head.indexOf('rel="expect"'));
    expect(materials).toMatch(
      /<\/script>\n {4}<span id="first-view" hidden><\/span>\n {2}<\/body>/,
    );
    expect(count(materials, /id="first-view"/g)).toBe(1);
    expect(script).toMatch(
      /renderAll\(initialState\);\s*\/\/ R1:[^\n]*\n\s*window\.JobDeputyPanels\?\.drawPromptSummaries\?\.\(document\);\s*\/\/ R10-1:[^\n]*\n[^\n]*\n\s*components\(\)\?\.boot\?\.ready\?\.\(\);/,
    );
  });
});

describe('Materials script order', () => {
  it('loads the shell scripts in order, then its own script', () => {
    const order = [
      'app-shell.js',
      'app-components.js',
      'sample-store.js',
      'deputy.js',
      'feedback.js',
      'app-panels.js',
    ].map((name) => materials.indexOf(`<script src="./${name}"></script>`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order[5]).toBeLessThan(materials.indexOf('<script>'));
  });
});

// Round 6 (A2): Approve and apply at the top of the editor, beside your deputy's review, so a role
// goes from its drafts to applied in one step. The approval section below keeps Approve only.
describe('Materials: Approve and apply at the top (round 6, A2)', () => {
  const bar =
    main.match(/<div class="mat-apply" id="mat-apply" hidden>[\s\S]*?id="mat-apply-open"/)?.[0] ??
    '';

  it('sits in the role’s header, above the tabs, with the review and the one primary action', () => {
    expect(main.indexOf('id="mat-apply"')).toBeGreaterThan(main.indexOf('id="job-link"'));
    expect(main.indexOf('id="mat-apply"')).toBeLessThan(main.indexOf('id="material-tabs"'));
    expect(bar).toContain('<div class="mat-apply-review" id="mat-apply-review"></div>');
    expect(bar).toMatch(/<button\s+class="primary-action"\s+id="mat-approve-apply"/);
    expect(textOf(bar)).toContain('Nothing is sent in this prototype.');
    expect(bar).toContain('id="mat-apply-watch"');
    expect(bar).toContain('id="mat-apply-sign"');
    // Feature-detected: shown once the store can review and approve and apply.
    expect(script).toContain(
      "const canApply = typeof store.approveAndApply === 'function' && typeof store.review === 'function';",
    );
  });

  it('saves the text on screen first, then approves and applies through the store', () => {
    const handler = script.slice(script.indexOf("applyButton.addEventListener('click'"));
    expect(handler.indexOf('resume: parts.resume.editor.value,')).toBeGreaterThan(-1);
    expect(handler.indexOf('resume: parts.resume.editor.value,')).toBeLessThan(
      handler.indexOf('store.approveAndApply(appId)'),
    );
    // The deputy's line matches what the job does next (UAT D-12), six words at most.
    expect(script).toContain("? 'Approved. I’ll wait for your signature.'");
    expect(script).toContain("react('approved', { speech });");
    for (const line of [
      'Approved. You apply this one.',
      'Approved. I’ll wait for your signature.',
      'Approved. I need you first.',
      'Approved. I’ll apply now.',
    ]) {
      expect(script).toContain(`'${line}'`);
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(6);
    }
    // Approve only sits beside it, the quieter action (P-13).
    expect(script).toContain(
      "const approveWords = canApply ? 'Approve only' : 'Approve materials';",
    );
    expect(script).toContain(
      "approveOpen.className = canApply ? 'secondary-action' : 'primary-action';",
    );
  });

  it('says one model where you approve: Approve and apply applies, Approve only leaves it to you (UAT D-14, M-3)', () => {
    expect(script).toContain(
      'Approve and apply saves your edits and marks both drafts final, then your deputy applies in the background. Approve only marks them final and leaves the applying to you.',
    );
    // After Approve and apply only one message: your deputy's progress, with Watch it.
    expect(script).toContain('applyDone.hidden = waiting || !shownJob;');
    expect(script).toContain("approvalMain.hidden = mode === 'waiting' || mode === 'approved';");
  });

  it('says your deputy applies in the record while its job runs or waits, never you (UAT RM-2)', () => {
    expect(script).toContain(
      "if (job?.status === 'running') return ['is-current', 'Your deputy is applying', 'Now', 'your deputy, in the background'];",
    );
    expect(script).toContain("agreement: 'Your deputy waits for your signature, then applies',");
    expect(script).toContain("questions: 'Your deputy needs your answers, then applies',");
    // Approved without a job (Approve only, or a stopped run) keeps round 5's next step.
    expect(script).toContain(
      "if (current === 'approved') return ['', 'Fill the application, or apply yourself', 'Next', 'you'];",
    );
  });

  it('names each check’s state in words beside its mark, and escapes them (R5-5)', () => {
    expect(script).toContain(
      "const CHECK_WORDS = { pass: 'Passed', warn: 'Check this', fail: 'Failed' };",
    );
    expect(script).toMatch(
      /<span class="sr-only">\$\{CHECK_WORDS\[check\.status\] \?\? ''\}: <\/span>/,
    );
    expect(script).toContain('escapeText(check.label)}.</span>');
    expect(script).toContain('escapeText(check.detail)}</span></li>');
  });
});
