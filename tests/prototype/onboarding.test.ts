import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Page guarantees for setup (brand/onboarding-preview.html). The rendered flows (every door
// clicked through, keyboard order, focus, the phone first viewport, the keyboard simulation, and
// the store hand-off) are checked in headless Chrome; these static guards keep the contract from
// drifting, and the hand-off runs here against the real sample store: Done saves the answers and
// the account's one AI setting (setAiChoice, round 4), Finish starts the first source's run on it
// (startRun via 'setup' without its own ai; a new address through addSource), and the Dashboard
// opens with its first-run tour (?state=new&from=onboarding).

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');

const onboarding = sourceFor('onboarding-preview.html');

const inlineScript = (source: string): string =>
  [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '').join('\n');
const stylesOf = (source: string): string =>
  [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1] ?? '')
    .join('\n');

// The literal that follows a declaration, matched bracket for bracket (strings skipped).
function literalAfter(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  expect(start, `${declaration} must exist`).toBeGreaterThanOrEqual(0);
  const open = start + declaration.length + source.slice(start + declaration.length).search(/[[{]/);
  const opener = source[open] ?? '[';
  const closer = opener === '[' ? ']' : '}';
  let depth = 0;
  let quote = '';
  for (let index = open; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') quote = character;
    else if (character === opener) depth += 1;
    else if (character === closer) {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`${declaration} has no closing bracket`);
}

// A top-level arrow function with a block body, from `const name =` to its closing `};`.
function arrowFunction(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = `);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\n      };\n', start);
  return source.slice(start, end + '\n      };'.length);
}

// A top-level declaration that ends at its first `;` at the end of a line.
function statement(source: string, name: string): string {
  const found = source.match(new RegExp(`const ${name} = [\\s\\S]*?;\\n`))?.[0];
  expect(found, `${name} must exist`).toBeTruthy();
  return found ?? '';
}

const evaluate = <T>(literal: string): T => runInNewContext(`(${literal})`) as T;
const words = (text: string): number =>
  text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
// The markup of one step body, from its opening tag to the next step comment.
const stepBody = (id: string): string =>
  onboarding.match(
    new RegExp(
      `<div class="ob-step" data-step="${id}"[\\s\\S]*?(?=<!-- \\d|<section\\s+class="feedback-panel")`,
    ),
  )?.[0] ?? '';

interface Sample {
  profile: Record<string, unknown> & {
    helpWith: string[];
    startTiming: string | null;
    targetRoles: string[];
  };
  world: { sources: Array<{ id: string; address: string; schedule: string }> };
  watch: { schedule: string; requested: string | null };
  checklist: Record<string, boolean>;
  onboarding: {
    completed?: boolean;
    firstSource?: string | null;
    firstRun?: Record<string, unknown>;
  };
  referrals?: Record<string, unknown>;
  sources: Record<string, Record<string, unknown>>;
  documents: { library: Array<{ id: string; name: string }>; defaultId: string };
  catalog: { sources: string[] };
}

interface Step {
  id: string;
  eyebrow: string;
  title: string;
  why: string;
  optional?: boolean;
  deputy: string;
  speech?: string;
  notice?: string;
  noticeFor?: Record<string, string>;
  missing?: string;
}

interface Answers {
  focus: string[];
  roles: string[];
  extraRoles: string[];
  workplace: string[];
  location: string;
  schedule: string;
  resume: { name: string; state: string; sample?: boolean; existing?: boolean } | null;
  source: string;
  sourceUrl: string;
  ai: string | null;
  model: string | null;
  linkedin: number;
}

const script = inlineScript(onboarding);
const styles = stylesOf(onboarding);
const steps = evaluate<Step[]>(literalAfter(script, 'const steps ='));
const rerunCopy = evaluate<Record<string, Partial<Step>>>(
  literalAfter(script, 'const rerunCopy ='),
);
const blankSource = script.match(/const blankAnswers = ([\s\S]*?\}\));/)?.[1] ?? '';
const blankAnswers = runInNewContext(`(${blankSource})`) as () => Answers;

type Run = { id: string; sourceId: string; via: string; ai: string; status: string };
type Source = { id: string; name: string; address: string; status: string; schedule: string };
type Store = {
  get(): Sample & { ai: { keys: Record<string, unknown> } };
  aiChoice(): { source: string; summary: string };
  setAiChoice(source: string): unknown;
  update(change: unknown, mutate: (next: Sample) => void): Sample;
  catalog(): { sources: Source[] };
  runs(): Run[];
  addSource(
    fields: Record<string, unknown>,
    options?: { start?: boolean },
  ): { ok: boolean; source?: Source };
  metricText(key: string): string;
  // Round 6 part 3 (T1-9): the test checks the live run of a source after setup's Finish.
  liveRun(sourceId: string): { id: string } | null;
};

// The real sample store (brand/sample-store.js) in a sandbox, with its localStorage.
function sampleStore() {
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  const sandbox: Record<string, unknown> = { addEventListener: () => {} };
  runInNewContext(sourceFor('sample-store.js'), { window: sandbox, localStorage, JSON });
  const store = sandbox.JobDeputyStore as Store;
  return { store, storage, localStorage };
}

// The page's address helpers, run on their own; the sources come from the store.
const addressCode = [
  arrowFunction(script, 'sourceAddress'),
  statement(script, 'shortAddress'),
  arrowFunction(script, 'markFor'),
  statement(script, 'knownSources'),
  statement(script, 'knownSourceFor'),
].join('\n');
const addresses = runInNewContext(
  `${addressCode}\n({ sourceAddress, shortAddress, markFor, knownSources, knownSourceFor })`,
  { URL, String, store: sampleStore().store },
) as {
  sourceAddress: (raw: string) => URL | null;
  shortAddress: (url: URL) => string;
  markFor: (name: string) => string;
  knownSources: () => Array<{ id: string; name: string; address: string }>;
  knownSourceFor: (address: string) => { id: string; name: string; address: string } | null;
};

describe('onboarding steps', () => {
  it('runs the nine screens of the brief, in order, one question each', () => {
    expect(steps.map((step) => [step.id, step.title])).toEqual([
      ['welcome', 'Hi Alex, I’m your deputy.'],
      ['focus', 'Where should I help?'],
      ['roles', 'What roles should I look for?'],
      ['workplace', 'Where can you work?'],
      ['watch', 'How often should I look for new roles?'],
      ['resume', 'Add your résumé.'],
      ['source', 'Where should I start?'],
      ['ai', 'How should I run AI?'],
      ['done', 'Thanks, Alex. I’m on it.'],
    ]);
    for (const step of steps) {
      expect(onboarding, `${step.id} has its own step body`).toContain(
        `<div class="ob-step" data-step="${step.id}"`,
      );
      expect(step.eyebrow.length && step.why.length, `${step.id} copy`).toBeTruthy();
    }
  });

  it('explains every question in one short line, in the deputy’s words', () => {
    for (const copy of [...steps, ...Object.values(rerunCopy)]) {
      const line = copy.why ?? '';
      expect(words(line), `«${line}» is 14 words or fewer`).toBeLessThanOrEqual(14);
      expect(`${copy.title ?? ''} ${line}`, 'no em or en dashes').not.toMatch(/[–—]/);
    }
  });

  it('marks the optional steps, which offer Skip, and keeps the rest required', () => {
    expect(steps.filter((step) => step.optional).map((step) => step.id)).toEqual([
      'focus',
      'resume',
      'source',
    ]);
    for (const step of steps.filter((item) => item.optional || ['roles', 'ai'].includes(item.id))) {
      expect(step.missing, `${step.id} explains what is missing`).toBeTruthy();
    }
  });

  it('gives each step its deputy pose, with short first-person lines', () => {
    expect(Object.fromEntries(steps.map((step) => [step.id, step.deputy]))).toEqual({
      welcome: 'idle',
      focus: 'notice',
      roles: 'search',
      workplace: 'notice',
      watch: 'watch',
      resume: 'protect-data',
      source: 'search',
      ai: 'hold-key',
      done: 'search',
    });
    const watchSpeech = evaluate<Record<string, string>>(
      literalAfter(script, 'const watchSpeech ='),
    );
    const lines = [
      ...steps.flatMap((step) => [
        step.speech,
        step.notice,
        ...Object.values(step.noticeFor ?? {}),
      ]),
      ...Object.values(rerunCopy).map((copy) => copy.speech),
      ...Object.values(watchSpeech),
    ];
    const custom = [...script.matchAll(/speech: '([^']+)'/g)].map((match) => match[1]);
    for (const line of [...lines, ...custom].filter((value): value is string => Boolean(value))) {
      expect(words(line), `«${line}» is six words or fewer`).toBeLessThanOrEqual(6);
      expect(line, 'no em or en dashes').not.toMatch(/[–—]/);
    }
    for (const [, duty] of script.matchAll(/duty: '([^']+)'/g)) {
      expect(words(duty ?? ''), `duty «${duty}»`).toBeLessThanOrEqual(3);
    }
    // Setup finished is the celebrate reaction (R3-8), then the deputy rests on search; the
    // upload works under pending.
    expect(script).toContain(
      "if (deputy?.react) deputy.react('celebrate', { speech: 'Thanks, Alex. All set.' });",
    );
    expect(script).toMatch(/deputy\?\.set\('pending', \{\s*working: true,/);
  });

  it('renders the Welcome step in the static markup, matching the first step', () => {
    const welcome = steps[0] as Step;
    expect(onboarding).toContain(`<p class="eyebrow" id="ob-eyebrow">${welcome.eyebrow}</p>`);
    expect(onboarding).toContain(
      `<h1 class="ob-title" id="page-title" tabindex="-1">${welcome.title}</h1>`,
    );
    const why = onboarding.match(/<p class="intro-copy" id="ob-why">([\s\S]*?)<\/p>/)?.[1] ?? '';
    expect(textOf(why)).toBe(welcome.why);
    expect(onboarding).toContain('<a class="skip-link" href="#page-title">Skip to setup</a>');
    expect(onboarding.match(/<h1\b/g)).toHaveLength(1);
    expect(onboarding).toContain('<title>JobDeputy · Set up your deputy</title>');
  });

  it('asks with big choice cards: a native control, the label, and a line icon on the right', () => {
    const cards = [...onboarding.matchAll(/<label class="choice-card">([\s\S]*?)<\/label>/g)].map(
      (match) => match[1] ?? '',
    );
    const named = cards.map((card) => [
      card.match(/name="(\w+)"/)?.[1],
      card.match(/value="([\w-]+)"/)?.[1],
      textOf(card.match(/<span class="choice-card-label">([\s\S]*?)<\/span>/)?.[1] ?? ''),
    ]);
    expect(named).toEqual([
      ['focus', 'roles', 'Finding roles'],
      ['focus', 'tailoring', 'Tailoring résumés'],
      ['focus', 'applying', 'Filling in applications'],
      ['focus', 'tracking', 'Tracking applications'],
      ['workplace', 'remote', 'Remote'],
      ['workplace', 'hybrid', 'Hybrid'],
      ['workplace', 'onsite', 'On-site'],
      ['schedule', 'manual', 'When I ask'],
      ['schedule', 'nightly', 'Every night with Keep watch'],
      ['ai', 'platform', 'Platform credits'],
      ['ai', 'own-key', 'Your own key'],
      ['ai', 'keywords', 'Keyword filtering only'],
    ]);
    for (const card of cards) {
      expect(card).toMatch(/^\s*<input type="(checkbox|radio)"/);
      expect(card).toContain('<span class="choice-card-control" aria-hidden="true"></span>');
      expect(card).toMatch(
        /<\/span>\s*<svg class="choice-card-icon" aria-hidden="true" focusable="false"><use href="#ob-icon-[\w-]+" \/><\/svg>\s*$/,
      );
    }
    // Multi-select where the brief says so; one answer for the schedule and AI.
    expect(onboarding).not.toMatch(/type="radio" name="(focus|workplace)"/);
    expect(onboarding).not.toMatch(/type="checkbox" name="(schedule|ai)"/);
  });

  it('adds Filling in applications to step 1, with the Gmail it needs, planned, saved as applying', () => {
    const card = stepBody('focus').match(
      /<label class="choice-card">\s*<input type="checkbox" name="focus" value="applying" \/>[\s\S]*?<\/label>/,
    )?.[0];
    expect(card).toBeTruthy();
    // It says what it needs (read-only Gmail, for one-time codes and status emails) and who
    // decides, in one line that keeps every option in a phone's first screen.
    expect(textOf(card ?? '')).toContain(
      'Filling in applications Needs read-only Gmail for one-time codes and status emails; you approve each form Planned for launch',
    );
    expect(card?.match(/class="choice-card-meta"/g)).toHaveLength(1);
    expect(card).toContain('<span class="tag ob-card-tag">Planned for launch</span>');
    const labels = evaluate<{ focus: Record<string, string> }>(
      literalAfter(script, 'const labels ='),
    );
    expect(Object.keys(labels.focus)).toEqual(['roles', 'tailoring', 'applying', 'tracking']);
    // The summary says it is planned, too.
    expect(script).toContain(`\`\${labels.focus.applying} (planned for launch)\``);
  });

  it('asks how often to look, with the one Runs allowance and getting more, Keep watch planned', () => {
    const body = stepBody('watch');
    // Round 6, part 2 (N3): every search run uses one run, yours or Keep watch's, so asking is no
    // longer free and the free allowance is the account's runs, not nightly runs.
    expect(textOf(body)).toContain('When I ask You start each search; each uses one run');
    expect(textOf(body)).toContain(
      'Every night with Keep watch Each source it checks uses one run Planned for launch',
    );
    expect(textOf(body)).not.toMatch(/nightly runs?\b|\bFree ·/i);
    // The free runs a month are the store's figure, filled in from it.
    const { store } = sampleStore();
    expect(body.replace(/\s+/g, ' ')).toContain(
      `<p class="field-help" id="ob-runs-note"> <span data-metric="runs.free">${store.metricText('runs.free')}</span> free runs a month for every search, then get more. </p>`,
    );
    expect(script).toContain(
      "const text = store?.metricText?.(figure.getAttribute('data-metric'));",
    );
    expect(textOf(body)).not.toMatch(/Premium/);
    // What is Keep watch? opens Help's answer, in a new tab so setup keeps its place.
    expect(body).toMatch(
      /<a class="ob-link" id="ob-watch-help" href="\.\/trust-preview\.html#keep-watch" target="_blank" rel="noopener"\s*>What is Keep watch\?<span class="sr-only"> Opens Help in a new tab\.<\/span><\/a\s*>/,
    );
    expect(sourceFor('trust-preview.html')).toMatch(/\sid="keep-watch"/);
    // The summary row, and start timing gone from the page.
    expect(onboarding).toContain('<dt>How often I look</dt>');
    expect(onboarding).not.toContain('When you’d like to start');
    expect(onboarding).not.toMatch(/name="timing"|startTiming:|data-step="timing"/);
    // No prices anywhere on the page.
    expect(textOf(onboarding)).not.toMatch(/[$€£]\s?\d|\bper month\b|\/mo\b/i);
  });

  it('asks for the one AI setting, named Deputy Assist, that runs every search and draft (R4-2)', () => {
    const ai = steps.find((step) => step.id === 'ai');
    expect(ai).toMatchObject({ eyebrow: 'Deputy Assist', title: 'How should I run AI?' });
    expect(ai?.why).toBe('Deputy Assist is my AI work: one setting runs every search and draft.');
    expect(ai?.notice).toBe('Change it later in AI & credits.');
    const body = stepBody('ai');
    expect(textOf(body)).toContain('Keyword filtering only Deputy Assist off: no model, no tokens');
    // One choice for the account: three radios, no model or per-source choice in setup.
    expect(body.match(/type="radio" name="ai"/g)).toHaveLength(3);
    expect(onboarding).not.toMatch(/name="(model|source-ai|task-ai)"/);
    expect(onboarding).toContain('<dt>Deputy Assist</dt>');
    // Your own key names the key and its one model when one is ready, from the store.
    const describe = script.slice(script.indexOf('const describeOwnKey = () => {'));
    expect(describe).toContain('const provider = ownKeySource();');
    expect(describe).toContain(
      `\`\${key.model ? \`\${key.model} on your \${name} key\` : \`Your \${name} key\`}; your provider may charge\``,
    );
    expect(describe).toContain(
      "'OpenAI or Anthropic, added in AI & credits; your provider may charge'",
    );
    const { store } = sampleStore();
    expect(store.aiChoice()).toMatchObject({
      source: 'openai',
      summary: 'Every search and draft uses gpt-5-mini on your OpenAI key',
    });
  });

  it('keeps Continue focusable: aria-disabled until answered, never the disabled attribute', () => {
    const button = onboarding.match(/<button class="primary-action ob-continue"[^>]*>/)?.[0] ?? '';
    expect(button).toContain('id="ob-continue"');
    expect(button).not.toMatch(/\sdisabled\b/);
    expect(script).toContain("continueButton.setAttribute('aria-disabled', 'true');");
    expect(script).toContain("continueButton.removeAttribute('aria-disabled');");
    expect(script).not.toMatch(/continueButton\.disabled\s*=/);
    // Pressing it while unanswered explains what is missing, beside the actions.
    expect(onboarding).toMatch(
      /<section\s+class="feedback-panel"\s+id="ob-feedback"\s+data-kind="validation"\s+hidden/,
    );
    expect(script).toContain('announce(`Check one detail before continuing.');
  });

  it('says to wait, not that a file is missing, when Continue comes while the file uploads', () => {
    // UAT-D-19: Uploading, Checking the file, or Reading the text is not "missing".
    const uploading = arrowFunction(script, 'isUploading');
    expect(uploading).toContain("current === 'resume' &&");
    expect(uploading).toContain("!['ready', 'failed'].includes(answers.resume.state);");
    const missing = arrowFunction(script, 'showMissing');
    expect(missing).toMatch(/if \(isUploading\(\)\) \{[\s\S]*?feedback\.dataset\.kind = 'notice';/);
    expect(missing).toContain("feedbackTitle.textContent = 'Your file is still uploading';");
    expect(missing).toContain(
      "feedbackMessage.textContent = 'Wait for it to finish, then continue, or skip this step.';",
    );
    expect(missing).toContain(
      "announce('Your file is still uploading. Wait for it to finish, then continue, or skip this step.');",
    );
    // A notice, with the shared notice icon; it goes once the file is ready or stops uploading.
    expect(missing).toContain("feedbackIcon.textContent = 'i';");
    expect(arrowFunction(script, 'refresh')).toContain(
      "if (feedback.dataset.kind === 'notice' && (answered || !isUploading())) hideFeedback();",
    );
    // Starting the upload is the recovery: the missing-file message goes with it.
    expect(arrowFunction(script, 'refresh')).toContain(
      "if (feedback.dataset.kind === 'validation' && (answered || isUploading())) hideFeedback();",
    );
    expect(arrowFunction(script, 'hideFeedback')).toContain("feedbackIcon.textContent = '!';");
    // Without a file the step still asks for one.
    expect(steps.find((step) => step.id === 'resume')?.missing).toBe(
      'Add a PDF or DOCX file, or skip this step.',
    );
  });

  it('focuses the question and announces once on every step change', () => {
    expect(script).toContain('title.focus({ preventScroll: true });');
    expect(script).toMatch(/announce\(\s*index === 0/);
    expect(onboarding).toContain(
      '<p class="sr-only" id="ob-announcer" role="status" aria-live="polite" aria-atomic="true"></p>',
    );
  });
});

describe('onboarding round 5: LinkedIn and platform credits', () => {
  it('offers Import from LinkedIn in the résumé step, reviewed item by item, after 2026.10 (G2, W9)', () => {
    const body = stepBody('resume');
    expect(textOf(body)).toContain(
      'Or import from LinkedIn Your data export or profile PDF · you choose what joins Import from LinkedIn',
    );
    expect(body).toContain(
      '<button class="secondary-action" id="ob-import-open" type="button" aria-describedby="ob-import-meta">',
    );
    expect(onboarding).toContain('<symbol id="ob-icon-linkedin" viewBox="0 0 24 24">');
    // The review: the file (the prototype reads the sample export), then each item new,
    // different (with your value), or already the same, ticked or not; only the ticked are saved.
    const drawer =
      onboarding.match(/<dialog\s+class="drawer"\s+id="ob-import-drawer"[\s\S]*?<\/dialog>/)?.[0] ??
      '';
    expect(drawer).toContain(
      '<input id="ob-import-file" type="file" accept=".zip,.pdf,application/zip,application/pdf" hidden />',
    );
    expect(textOf(drawer)).toContain(
      'A ZIP or PDF file. In this prototype nothing is uploaded: your deputy reads a sample export instead.',
    );
    expect(evaluate(literalAfter(script, 'const IMPORT_WORDS ='))).toEqual({
      new: 'New to your profile',
      differs: 'Different from yours',
      same: 'Already in your profile',
    });
    expect(script).toContain("const IMPORT_ORDER = ['new', 'differs', 'same'];");
    expect(script).toContain(`? \`Yours now: \${item.current}\``);
    expect(script).toContain('const result = store?.applyLinkedinImport?.([...importing.keys]);');
    // Until 2026.10 is signed, the review asks for it in place and comes back with the ticks.
    expect(script).toContain("store.requiresAgreement('linkedin-import')");
    expect(script).toContain(
      `\`./agreement-preview.html?mode=update&return=\${encodeURIComponent('onboarding-preview.html?step=resume&import=linkedin')}\`,`,
    );
    expect(script).toContain(
      "if (parameters.get('import') === 'linkedin' && current === 'resume') {",
    );
    expect(script).toContain("const IMPORT_KEY = 'jobdeputy.onboarding.import';");
    // An import answers the step, and Done names it.
    expect(arrowFunction(script, 'isAnswered')).toContain(
      "if (id === 'resume') return answers.resume?.state === 'ready' || answers.linkedin > 0;",
    );
    expect(script).toContain(
      `\`\${answers.linkedin === 1 ? '1 detail' : \`\${answers.linkedin} details\`} from LinkedIn\``,
    );
    expect(blankAnswers()).toMatchObject({ model: null, linkedin: 0 });
    // The store: the gate, then only the ticked items.
    const { store } = sampleStore();
    const typed = store as unknown as {
      requiresAgreement(feature: string): unknown;
      linkedinImport(): { items: Array<{ key: string; compare: string }> };
      applyLinkedinImport(keys: string[]): { ok: boolean; reason?: string; applied?: string[] };
      signAgreement(fields: Record<string, unknown>): { ok: boolean };
    };
    const ticked = typed
      .linkedinImport()
      .items.filter((item) => item.compare !== 'same' && item.key !== 'profile.summary')
      .map((item) => item.key);
    expect(typed.applyLinkedinImport(ticked)).toMatchObject({
      ok: false,
      reason: 'agreement-required',
    });
    // A new account signs 2026.10 before setup (context new), so the import goes straight on.
    expect(
      typed.signAgreement({
        version: '2026.10',
        name: 'Alex Morgan',
        consents: ['read', 'act', 'keep'],
        context: 'new',
      }).ok,
    ).toBe(true);
    expect(typed.requiresAgreement('linkedin-import')).toBeNull();
    expect(typed.applyLinkedinImport(ticked).applied).toHaveLength(7);
  });

  it('runs platform credits on one model, saved at Done with setPlatformModel, and never on AI runs', () => {
    const { store } = sampleStore();
    const body = stepBody('ai');
    // Platform credits: the free tokens a month, the store's figure; no runs, no weekly cadence.
    expect(body).toContain(
      `<span data-metric="ai.credits.free">${store.metricText('ai.credits.free')}</span> free tokens each month, then buy credits`,
    );
    expect(textOf(onboarding)).not.toMatch(
      /\bAI runs?\b|free AI runs|at most one a week|free runs each month/,
    );
    // The model choice: the store's three models with their speed and prices, and the R5-1 note.
    expect(body).toContain(
      '<fieldset class="choice-cards ob-models" id="ob-models" aria-describedby="ob-models-note" hidden>',
    );
    expect(body).toContain(
      '<p class="sample-note" id="ob-models-note">Sample prices · nothing is charged</p>',
    );
    const render = script.slice(
      script.indexOf('function renderModels() {'),
      script.indexOf('function syncModels() {'),
    );
    expect(render).toContain(
      "const models = typeof store?.models === 'function' ? store.models() : [];",
    );
    expect(render).toContain(
      `\${rate(model.rateIn)} in, \${rate(model.rateOut)} out per million tokens`,
    );
    expect(render).toContain('if (store.PRICING?.note) note.textContent = store.PRICING.note;');
    expect(render).not.toMatch(/\$\d|0\.22|0\.165/);
    expect(script).toContain("if (modelsField) modelsField.hidden = answers.ai !== 'platform';");
    // Done saves the one model with the one setting; the summary names it.
    expect(arrowFunction(script, 'saveAnswers')).toContain(
      "if (answers.ai === 'platform' && answers.model && !sameModel) store?.setPlatformModel?.(answers.model);",
    );
    expect(script).toContain(
      `return model ? \`\${labels.ai.platform} · \${model}\` : labels.ai[answers.ai];`,
    );
  });
});

describe('onboarding first source', () => {
  it('copies the quick-pick markup from the components gallery', () => {
    const gallery = sourceFor('components-preview.html');
    const picks = [
      ...stepBody('source').matchAll(/<label class="quick-pick">[\s\S]*?<\/label>/g),
    ].map((match) => match[0]);
    expect(picks).toHaveLength(3);
    const flat = (html: string) => html.replace(/\s+/g, ' ');
    for (const pick of picks) {
      expect(pick).toContain('<input type="radio" name="first-source" value="');
      expect(flat(gallery), 'the same pick, apart from the radio name').toContain(
        flat(pick.replace('name="first-source"', 'name="gallery-first-source"')),
      );
    }
    expect(stepBody('source')).toContain(
      '<fieldset class="quick-picks" id="ob-picks">\n                  <legend class="field-label">Or start with one of these</legend>',
    );
  });

  it('selects a pick from a typed address and confirms the choice with the company mark', () => {
    expect(script).toContain('components?.matchQuickPick(picks, sourceInput.value)');
    expect(script).toContain(`\`First search: \${name ? \`\${name} · \${host}\` : host}\``);
    expect(script).toContain("mark.className = 'company-mark';");
    // The confirmation is visible text, never a live region; the change is announced instead.
    expect(onboarding).toContain('<p class="ob-confirm" id="ob-source-confirm" hidden></p>');
    expect(script).toContain(`announce(\`\${sourceConfirm.textContent}.\`);`);
    // Errors stay beside the field, as before.
    expect(stepBody('source')).toContain(
      'Enter a public web address, such as amazon.jobs/en/search.',
    );
    expect(addresses.markFor('careers.example.com')).toBe('EX');
  });

  it('knows the sources by the store’s own addresses, and adds any other through addSource', () => {
    const { store } = sampleStore();
    // The sources the page matches a first source against are the store's (R3-3).
    const active = store.catalog().sources.filter((source) => source.status === 'active');
    expect(addresses.knownSources().map((source) => [source.id, source.address])).toEqual(
      active.map((source) => [source.id, source.address.toLowerCase()]),
    );
    expect(script).not.toContain('const catalogSources =');
    // The three quick picks: two of the sample's sources, and one new board.
    const picks = [...stepBody('source').matchAll(/name="first-source" value="([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    );
    const known = picks.map((href) => {
      const url = addresses.sourceAddress(href);
      return url ? (addresses.knownSourceFor(addresses.shortAddress(url))?.id ?? null) : null;
    });
    expect(known).toEqual(['amazon', 'google', null]);
    // A new address becomes a source with the store's slug, as Searches adds it.
    const added = store.addSource({ address: 'careers.example.com/jobs' }, { start: false });
    expect(added.ok).toBe(true);
    expect(added.source?.id).toBe('careers-example-com-jobs');
    // A source has no AI of its own (R4-2): the run uses the one setting Done saved.
    expect(script).toMatch(
      /store\.addSource\(\s*\{ address: search\.address, roles: \[\.\.\.answers\.roles\], schedule: search\.schedule \},\s*\{ start: false \},?\s*\)/,
    );
    expect(script).toContain(": store.startRun(source.id, { via: 'setup' });");
    expect(script).not.toMatch(/startRun\([^)]*\bai:/);
    // The round 2 shortcut through store.sources is gone.
    expect(script).not.toMatch(/setSource\(|newSourceFor|sourceKey/);
  });

  it('accepts only public web addresses for the first source', () => {
    const short = (raw: string) => {
      const url = addresses.sourceAddress(raw);
      return url ? addresses.shortAddress(url) : null;
    };
    expect(short('amazon.jobs/en/search')).toBe('amazon.jobs/en/search');
    expect(short('https://www.amazon.jobs/en/search/')).toBe('amazon.jobs/en/search');
    expect(short('boards.greenhouse.io/acme')).toBe('boards.greenhouse.io/acme');
    for (const bad of [
      '',
      'not a url',
      'localhost:3000',
      'ftp://example.com',
      'javascript:alert(1)',
    ]) {
      expect(short(bad), bad).toBeNull();
    }
  });
});

describe('onboarding doors and the re-run', () => {
  it('names the door a new account came through on Welcome', () => {
    const doors = runInNewContext(`(${literalAfter(script, 'const doors =')})`, {
      EMAIL: 'alex.morgan@example.com',
    }) as Record<string, { label: string; value: string; icon: string; note: string }>;
    expect(script).toContain("const EMAIL = 'alex.morgan@example.com';");
    expect(doors).toEqual({
      setup: { label: 'Signed in as', value: 'alex.morgan@example.com', icon: 'person', note: '' },
      email: {
        label: 'Signed up with email',
        value: 'alex.morgan@example.com',
        icon: 'mail',
        note: 'Account creation is simulated · nothing was sent',
      },
      google: {
        label: 'Signed up with Google',
        value: 'alex.morgan@example.com',
        icon: 'google',
        note: 'Google sign-up is simulated · no Google request was made',
      },
      'google-new': {
        label: 'Signed up with Google',
        value: 'Another Google account',
        icon: 'google',
        note: 'Google sign-up is simulated · a new account uses Alex Morgan’s sample data',
      },
      // Round 5 (G2, A4's request 3): Create account with LinkedIn signs the agreement, then
      // opens setup with ?via=linkedin (and &new=1 for another account).
      linkedin: {
        label: 'Signed up with LinkedIn',
        value: 'alex.morgan@example.com',
        icon: 'linkedin',
        note: 'LinkedIn sign-up is simulated · no LinkedIn request was made',
      },
      'linkedin-new': {
        label: 'Signed up with LinkedIn',
        value: 'Another LinkedIn account',
        icon: 'linkedin',
        note: 'LinkedIn sign-up is simulated · a new account uses Alex Morgan’s sample data',
      },
    });
    expect(script).toContain("const rerun = parameters.get('rerun') === '1';");
    expect(script).toMatch(
      /via === 'google' \|\| via === 'linkedin'\s*\?\s*parameters\.get\('new'\) === '1'\s*\?\s*`\$\{via\}-new`\s*:\s*via/,
    );
    // The agreement page's Continue opens setup through these doors.
    const agreement = sourceFor('agreement-preview.html');
    expect(agreement).toContain(
      `const query = door ? \`?via=\${door}\${isNew ? '&new=1' : ''}\` : '';`,
    );
    // Round 6 (G3): with the home Region chosen at Create account, which Welcome shows.
    // Round 7 (G3): the signing moment says it on the way ("Signed. Taking you to setup.").
    const squash = (value: string): string => value.replace(/\s+/g, '');
    expect(squash(agreement)).toContain(
      squash(
        `return { href: \`./onboarding-preview.html\${query}\${where}\`, label: 'Continue to setup', going: 'to setup', };`,
      ),
    );
    for (const icon of Object.values(doors).map((door) => door.icon)) {
      expect(onboarding).toContain(`<symbol id="ob-icon-${icon}"`);
    }
    expect(onboarding).toContain(
      '<span class="status-pill" id="ob-account-pill" hidden>New account</span>',
    );
  });

  it('turns Help’s Run setup again into Update your setup, saved only by the last button', () => {
    expect(rerunCopy.welcome?.title).toBe('Update your setup.');
    expect(rerunCopy.done?.title).toBe('Check your setup.');
    expect(rerunCopy.done?.why).toBe('Nothing changes until you save.');
    // Help links Run setup again; wherever it moves, some page still links the re-run.
    const pages = readdirSync(brandDirectory).filter((name) => name.endsWith('.html'));
    expect(pages.some((page) => sourceFor(page).includes('onboarding-preview.html?rerun=1'))).toBe(
      true,
    );
    // A first setup saves on arrival at Done; a re-run waits, then saves and returns.
    expect(script).toContain('if (!rerun && saveAnswers()) {');
    expect(script).toContain(`finishLink.textContent = \`Save and return to \${origin.name}\`;`);
    expect(script).toContain(`laterLink.textContent = \`Back to \${origin.name}\`;`);
  });

  it('returns a re-run to the page it came from, and to Help by default', () => {
    const code = `const returns = ${literalAfter(script, 'const returns =')};\n${arrowFunction(script, 'returnFor')}\nreturnFor`;
    const returnFor = runInNewContext(code, { URL, Object }) as (
      from: string | null,
      referrer: string,
      origin: string,
    ) => { href: string; name: string };
    const origin = 'https://prototype.example.com';
    expect(returnFor(null, '', 'null')).toMatchObject({
      href: './trust-preview.html#topics',
      name: 'Help',
    });
    expect(returnFor('profile', '', 'null')).toMatchObject({ href: './profile-preview.html' });
    expect(returnFor('home', '', 'null')).toMatchObject({
      href: './home-preview.html?skipLoader',
      name: 'your dashboard',
    });
    expect(returnFor(null, `${origin}/brand/ai-preview.html#keys`, origin)).toMatchObject({
      href: './ai-preview.html',
    });
    // Another site, an unknown page, or a made-up ?from= falls back to Help.
    expect(
      returnFor(null, 'https://elsewhere.example.net/brand/ai-preview.html', origin).name,
    ).toBe('Help');
    expect(returnFor('__proto__', `${origin}/brand/login-preview.html`, origin).name).toBe('Help');
    expect(returnFor('javascript:alert(1)', '', 'null').name).toBe('Help');
  });

  it('fills a re-run in from the saved answers', () => {
    const code = [
      `const MAX_ROLES = 10;`,
      `const blankAnswers = ${blankSource};`,
      `const labels = ${literalAfter(script, 'const labels =')};`,
      `const aiChoices = ${literalAfter(script, 'const aiChoices =')};`,
      arrowFunction(script, 'sourceAddress'),
      statement(script, 'shortAddress'),
      arrowFunction(script, 'answersFromStore'),
      'answersFromStore',
    ].join('\n');
    const answersFromStore = runInNewContext(code, { URL, Array, Object }) as (
      state: Sample,
      savedAi: string | null,
      suggestions: string[],
      savedModel?: string | null,
      openSteps?: string[],
    ) => Answers;
    const { store } = sampleStore();
    const state = store.get();
    state.profile.helpWith = ['applying', 'tracking'];
    state.profile.targetRoles = ['Software engineer', 'Staff engineer'];
    state.watch.requested = 'daily';
    state.onboarding.firstSource = 'https://careers.example.com/jobs';
    expect(answersFromStore(state, 'anthropic', ['Software engineer'])).toEqual({
      focus: ['applying', 'tracking'],
      roles: ['Software engineer', 'Staff engineer'],
      extraRoles: ['Staff engineer'],
      workplace: ['remote', 'hybrid'],
      location: 'Seattle, WA',
      // The setup's Keep watch request reads back as the nightly choice.
      schedule: 'nightly',
      resume: { name: 'Alex_Morgan_Resume.pdf', state: 'ready', existing: true },
      source: 'careers.example.com/jobs',
      sourceUrl: 'https://careers.example.com/jobs',
      ai: 'own-key',
      model: null,
      linkedin: 0,
      // Round 6 (G4): a re-run starts with no step passed, so it closes only the To-do items you
      // answer in it.
      passed: [],
    });
    // The platform model comes back as the store has it.
    expect(answersFromStore(state, 'platform', [], 'deepseek-v3-2')).toMatchObject({
      ai: 'platform',
      model: 'deepseek-v3-2',
    });
    // The seed's own answers, with no saved AI source (the other pages default to OpenAI).
    expect(answersFromStore(store.get(), null, [])).toMatchObject({
      schedule: 'manual',
      source: '',
      ai: 'own-key',
    });
    // Round 6 part 3 (T1-11): steps still open on the To-do have no answer yet, so a re-run from
    // a To-do item (openSteps lists what the person skipped) blanks only those fields and leaves
    // the rest as the store has them. Nothing a person did not answer joins the review.
    const fresh = sampleStore().store;
    const freshState = fresh.get();
    freshState.profile.helpWith = ['applying'];
    freshState.profile.targetRoles = ['Software engineer'];
    expect(
      answersFromStore(freshState, 'openai', [], null, [
        'focus',
        'roles',
        'workplace',
        'watch',
        'resume',
        'source',
        'ai',
      ]),
    ).toMatchObject({
      focus: [],
      roles: [],
      workplace: [],
      location: '',
      schedule: 'manual',
      resume: null,
      source: '',
      ai: null,
      model: null,
    });
    // One step open (just focus) blanks only that one.
    const oneOpen = answersFromStore(freshState, 'openai', [], null, ['focus']);
    expect(oneOpen.focus).toEqual([]);
    expect(oneOpen.roles).toEqual(['Software engineer']);
    expect(oneOpen.ai).toBe('own-key');
  });
});

describe('onboarding round 7 (T1-10, T1-20)', () => {
  it('breaks long addresses after an @ or a /, never mid-word', () => {
    expect(onboarding).not.toContain('overflow-wrap: anywhere');
    expect(onboarding.match(/overflow-wrap: break-word;/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(script).toContain("const parts = String(text ?? '').split(/(?<=[@/])/);");
    expect(script).toContain("document.createElement('wbr')");
    expect(script).toContain(
      "setBreakable(document.querySelector('#ob-account-value'), entry.value);",
    );
    expect(script).toContain(
      'setBreakable(value, text || (skipped ? todoSummary : emptySummary[id]));',
    );
    const helper = script.slice(
      script.indexOf('function setBreakable(element, text) {'),
      script.indexOf('const todoSummary'),
    );
    expect(helper).toContain('element.replaceChildren(');
    expect(helper).not.toMatch(/innerHTML/);
  });

  it('says that Finish spends a run on the first search (R10-9)', () => {
    expect(script).toContain("' · starts when you finish, uses 1 run'");
  });
});

describe('onboarding hand-off and storage', () => {
  it('keeps answers in sessionStorage and writes the shared store and AI source at Done', () => {
    expect(script).toContain("const SESSION_KEY = 'jobdeputy.onboarding';");
    expect(script).toContain('window.sessionStorage.setItem(');
    expect(script).toContain(
      'JSON.stringify({ answers, returnTo, saved, mode, firstSearch, startedAddress }),',
    );
    const save = arrowFunction(script, 'saveAnswers');
    for (const part of [
      "store?.update({ type: 'onboarding' }",
      'next.profile = {',
      'targetRoles: [...answers.roles]',
      'helpWith: [...answers.focus]',
      'next.watch = {',
      "schedule: 'manual',",
      "requested: answers.schedule === 'nightly' ? 'daily' : null,",
      'next.checklist = {',
      'next.onboarding = {',
      // Round 6 (G4): a re-run that keeps the AI setting does not save it again, so a skipped AI
      // step stays on the To-do until you choose.
      'const kept = rerun && ai === currentAiSource();',
      'const choice = kept ? (store?.aiChoice?.() ?? null) : (store?.setAiChoice?.(ai) ?? null);',
      'if (search) search.ready = choice !== null;',
    ]) {
      expect(save, part).toContain(part);
    }
    // The one AI setting is the store's (R4-2): the page never reads or writes its storage key.
    expect(script).not.toContain('jobdeputy-ai-source');
    expect(script).not.toMatch(/localStorage/);
    // Start timing is no longer asked, so an old answer stays as it was.
    expect(save).not.toContain('startTiming');
    // Required answers first, so a review link straight to Done never blanks the sample profile.
    expect(save).toContain('if (!isComplete()) return false;');
    expect(evaluate(literalAfter(script, 'const aiSources ='))).toEqual({
      platform: 'platform',
      'own-key': 'openai',
      keywords: 'none',
    });
    expect(script).toMatch(/\['remote', 'hybrid', 'onsite'\]\.filter/);
    // A round 2 tab's "daily" reads as the nightly choice.
    expect(script).toContain("if (answers.schedule === 'daily') answers.schedule = 'nightly';");
  });

  // Runs the page's own Done code (saveAnswers) and, with finish, its Finish code
  // (startFirstSearch) against the real sample store (brand/sample-store.js).
  const runDone = (
    answers: Answers,
    {
      rerun = false,
      finish = false,
      aiSource = null as string | null,
      before = (_: Sample) => {},
    } = {},
  ) => {
    const { store, storage, localStorage } = sampleStore();
    store.update({ type: 'test' }, before);
    if (aiSource) storage.set('jobdeputy-ai-source', aiSource);
    const code = [
      `const aiSources = ${literalAfter(script, 'const aiSources =')};`,
      `const labels = ${literalAfter(script, 'const labels =')};`,
      addressCode,
      statement(script, 'fileKind'),
      statement(script, 'needsLocation'),
      arrowFunction(script, 'currentAiSource'),
      arrowFunction(script, 'currentModel'),
      arrowFunction(script, 'ownKeySource'),
      arrowFunction(script, 'isAnswered'),
      statement(script, 'isComplete'),
      arrowFunction(script, 'libraryWith'),
      arrowFunction(script, 'saveAnswers'),
      arrowFunction(script, 'startFirstSearch'),
      `const saveResult = saveAnswers();`,
      `const run = ${finish ? 'startFirstSearch()' : 'null'};`,
      '({ saveResult, run, firstSearch, startedAddress })',
    ].join('\n');
    const context = {
      answers,
      store,
      rerun,
      window: { localStorage },
      sourceInput: { value: answers.source },
      writeSession: () => {},
      saved: false,
      firstSearch: null,
      startedAddress: null,
      Date,
      URL,
      String,
    };
    const out = runInNewContext(code, context) as {
      saveResult: boolean;
      run: { ok: boolean; reason?: string; run?: Run } | null;
      firstSearch: { address: string; ai: string; schedule: string; ready: boolean } | null;
      startedAddress: string | null;
    };
    return {
      result: out.saveResult,
      run: out.run,
      firstSearch: out.firstSearch,
      store,
      sample: store.get(),
      aiSource: storage.get('jobdeputy-ai-source') ?? null,
    };
  };

  const answered = (change: Partial<Answers>): Answers => ({
    ...blankAnswers(),
    roles: ['Software engineer'],
    workplace: ['remote'],
    ai: 'platform',
    ...change,
  });

  it('writes the value ids sample-store.js documents, for every page that reads them', () => {
    const { result, sample, aiSource, firstSearch } = runDone(
      answered({
        focus: ['roles', 'applying', 'tracking'],
        roles: ['Software engineer', 'Staff engineer'],
        extraRoles: ['Staff engineer'],
        workplace: ['hybrid', 'remote'],
        location: 'Austin, TX',
        schedule: 'nightly',
        resume: { name: 'Alex_Morgan_CV_2026.docx', state: 'ready' },
        source: 'amazon.jobs/en/search',
        sourceUrl: 'https://www.amazon.jobs/en/search',
        ai: 'own-key',
      }),
      { before: (next) => Object.assign(next.profile, { startTiming: 'months' }) },
    );
    expect(result).toBe(true);
    expect(sample.profile).toMatchObject({
      firstName: 'Alex',
      helpWith: ['roles', 'applying', 'tracking'],
      targetRoles: ['Software engineer', 'Staff engineer'],
      workStyles: ['remote', 'hybrid'],
      location: 'Austin, TX',
      locations: ['Austin, TX'],
      startTiming: 'months',
    });
    // The setup's answer stays readable for a re-run; the schedule itself is the source's.
    expect(sample.watch).toEqual({ schedule: 'manual', requested: 'daily' });
    expect(sample.checklist).toMatchObject({ roles: true, resume: true, source: true, ai: true });
    expect(sample.onboarding).toMatchObject({
      completed: true,
      firstSource: 'https://www.amazon.jobs/en/search',
    });
    // Done plans the first search; nothing starts until Finish.
    expect(firstSearch).toEqual({
      address: 'amazon.jobs/en/search',
      ai: 'openai',
      schedule: 'nightly',
      ready: true,
    });
    expect(sample.sources).toEqual({});
    expect(sample.documents.library[0]).toMatchObject({
      name: 'Alex_Morgan_CV_2026.docx',
      variant: 'cv',
      format: 'DOCX',
      updated: '2026-10-02',
    });
    expect(sample.documents.library).toHaveLength(3);
    expect(aiSource).toBe('openai');
    for (const value of sample.profile.helpWith) {
      expect(['roles', 'tailoring', 'applying', 'tracking']).toContain(value);
    }
  });

  it('starts the first source’s run on Finish: a sample source as it is, via setup', () => {
    const google = runDone(
      answered({
        source: 'google.com/about/careers/applications/jobs/results',
        sourceUrl: 'https://www.google.com/about/careers/applications/jobs/results',
        ai: 'own-key',
      }),
      { finish: true },
    );
    expect(google.run?.ok).toBe(true);
    expect(google.run?.run).toMatchObject({
      sourceId: 'google',
      via: 'setup',
      ai: 'openai',
      status: 'live',
    });
    expect(google.store.runs().filter((run) => run.via === 'setup')).toHaveLength(1);
    // The Dashboard's first-run card reads whether it started.
    expect(google.store.get().onboarding.firstRun).toEqual({
      sourceId: 'google',
      started: true,
      runId: google.run?.run?.id,
    });
    // Round 6 part 3 (T1-9): Amazon is already live in the sample, from before the account was
    // made (r11, 13:59). Setup's Finish stops it and starts its own run, so the Dashboard shows
    // the first search as this account's.
    const amazon = runDone(
      answered({ source: 'amazon.jobs/en/search', sourceUrl: 'https://www.amazon.jobs/en/search' }),
      { finish: true },
    );
    expect(amazon.run).toMatchObject({ ok: true });
    expect(amazon.run?.run?.id).not.toBe('r11');
    const amazonRuns = amazon.store.runs().filter((item) => item.sourceId === 'amazon');
    const r11 = amazonRuns.find((item) => item.id === 'r11');
    expect(r11?.status).toBe('stopped');
    expect(amazon.store.liveRun('amazon')?.id).toBe(amazon.run?.run?.id);
    expect(amazon.store.get().onboarding.firstRun).toMatchObject({
      sourceId: 'amazon',
      started: true,
      runId: amazon.run?.run?.id,
    });
    // Keep watch chosen in setup turns on the source's nightly check.
    const nightly = runDone(
      answered({
        schedule: 'nightly',
        source: 'stripe.com/jobs/search',
        sourceUrl: 'https://stripe.com/jobs/search',
        ai: 'keywords',
      }),
      { finish: true },
    );
    expect(nightly.store.catalog().sources.find((source) => source.id === 'stripe')?.schedule).toBe(
      'nightly',
    );
    expect(nightly.run?.run).toMatchObject({ sourceId: 'stripe', via: 'setup', ai: 'none' });
  });

  it('still opens the Dashboard when the first search cannot start, and records why', () => {
    // Round 5 (G3): AI runs are retired, so platform-ai-limit-reached never happens. With not
    // even a search's worth of platform credits left (a large platform job used them this
    // month), the first search can't start, and setup records when the free credits refresh.
    const noCredits = runDone(
      answered({
        source: 'google.com/about/careers/applications/jobs/results',
        sourceUrl: 'https://www.google.com/about/careers/applications/jobs/results',
        ai: 'platform',
      }),
      {
        finish: true,
        before: (next) => {
          (next as Sample & { ai: { usage: Array<Record<string, unknown>> } }).ai.usage.push({
            id: 'u-test-big',
            at: '2026-10-02T12:00:00-07:00',
            task: 'tailor',
            title: 'A large platform job',
            keySource: 'platform',
            provider: 'platform',
            model: 'Ministral 3 14B',
            modelId: 'ministral-3-14b',
            inputTokens: 300000,
            outputTokens: 30000,
          });
        },
      },
    );
    expect(noCredits.run).toEqual({
      ok: false,
      reason: 'credits-out',
      refreshesOn: '2026-11-01T00:00:00Z',
    });
    expect(noCredits.store.get().onboarding.firstRun).toEqual({
      sourceId: 'google',
      started: false,
      reason: 'credits-out',
      ai: 'platform',
      refreshesOn: '2026-11-01T00:00:00Z',
    });
    expect(script).not.toMatch(/nextFreeAt|platform-ai-limit-reached/);
    // Your own key chosen, but no key is ready: setAiChoice refuses it, the setting stays as
    // it was, and the first search records why it can't start (the source is still added).
    const noKey = runDone(
      answered({
        source: 'stripe.com/jobs/search',
        sourceUrl: 'https://stripe.com/jobs/search',
        ai: 'own-key',
      }),
      {
        finish: true,
        before: (next) => {
          (next as Sample & { ai: { keys: Record<string, unknown> } }).ai.keys.openai = null;
        },
      },
    );
    expect(noKey.firstSearch).toMatchObject({ ai: 'openai', ready: false });
    expect(noKey.run).toMatchObject({ ok: false, reason: 'key-not-ready' });
    expect(noKey.store.get().onboarding.firstRun).toMatchObject({
      sourceId: 'stripe',
      started: false,
      reason: 'key-not-ready',
      ai: 'openai',
    });
    expect(noKey.aiSource).toBeNull();
    expect(noKey.store.aiChoice().source).toBe('platform');
    expect(noKey.store.runs().filter((run) => run.via === 'setup')).toHaveLength(0);
    // Your key past its token limit (round 4): with Pause, the search can't start and says when
    // the limit resets; with Use free platform runs, it runs on a platform run instead.
    const paused = runDone(
      answered({
        source: 'stripe.com/jobs/search',
        sourceUrl: 'https://stripe.com/jobs/search',
        ai: 'own-key',
      }),
      {
        finish: true,
        before: (next) => {
          (next as Sample & { ai: Record<string, unknown> }).ai.limit = {
            tokens: 10000,
            period: 'month',
            onReach: 'pause',
          };
        },
      },
    );
    expect(paused.run).toMatchObject({ ok: false, reason: 'own-key-limit-reached' });
    expect(paused.store.get().onboarding.firstRun).toEqual({
      sourceId: 'stripe',
      started: false,
      reason: 'own-key-limit-reached',
      ai: 'openai',
      resetsAt: '2026-11-01T00:00:00Z',
    });
    const fallback = runDone(
      answered({
        source: 'stripe.com/jobs/search',
        sourceUrl: 'https://stripe.com/jobs/search',
        ai: 'own-key',
      }),
      {
        finish: true,
        before: (next) => {
          (next as Sample & { ai: Record<string, unknown> }).ai.limit = {
            tokens: 10000,
            period: 'month',
            onReach: 'platform',
          };
        },
      },
    );
    expect(fallback.run?.run).toMatchObject({ sourceId: 'stripe', via: 'setup', ai: 'platform' });
    expect(fallback.store.get().onboarding.firstRun).toMatchObject({
      sourceId: 'stripe',
      started: true,
    });
    // Finish is a link to the Dashboard: it goes there whether or not the search started.
    const finish = script.slice(script.indexOf("finishLink.addEventListener('click'"));
    expect(finish.slice(0, finish.indexOf('if (saveAnswers())'))).not.toContain('preventDefault');
  });

  it('adds a first source the store does not know through addSource, then starts it', () => {
    const { sample, store, run } = runDone(
      answered({
        roles: ['Software engineer', 'Product engineer'],
        source: 'boards.greenhouse.io/example',
        sourceUrl: 'https://boards.greenhouse.io/example',
      }),
      { finish: true },
    );
    expect(sample.onboarding.firstSource).toBe('https://boards.greenhouse.io/example');
    const added = store
      .catalog()
      .sources.find((source) => source.id === 'boards-greenhouse-io-example');
    expect(added).toMatchObject({
      address: 'boards.greenhouse.io/example',
      schedule: 'manual',
      status: 'active',
    });
    expect(run?.run).toMatchObject({
      sourceId: 'boards-greenhouse-io-example',
      via: 'setup',
      ai: 'platform',
    });
    // Not a round 2 store.sources entry any more.
    expect(sample.sources).toEqual({});
    // When I ask stays the answer, with no request.
    expect(sample.watch).toEqual({ schedule: 'manual', requested: null });
  });

  it('saves the platform model you chose, only for platform credits (round 5, G3)', () => {
    type Models = {
      models(): Array<{ id: string; chosen: boolean }>;
      aiChoice(): { summary: string };
    };
    const chosen = (store: unknown) => (store as Models).models().find((model) => model.chosen)?.id;
    const platform = runDone(answered({ ai: 'platform', model: 'deepseek-v3-2' }));
    expect(platform.result).toBe(true);
    expect(chosen(platform.store)).toBe('deepseek-v3-2');
    expect((platform.store as unknown as Models).aiChoice().summary).toBe(
      'Every search and draft uses DeepSeek V3.2 on platform credits',
    );
    // Your own key keeps the account's platform model as it was.
    const own = runDone(answered({ ai: 'own-key', model: 'deepseek-v3-2' }));
    expect(chosen(own.store)).toBe('ministral-3-14b');
  });

  it('leaves skipped answers and the sample library as they were', () => {
    const { result, sample, aiSource, run } = runDone(
      answered({
        roles: ['Product engineer'],
        resume: { name: 'Alex_Morgan_Resume.pdf', state: 'ready', sample: true },
        ai: 'keywords',
      }),
      { finish: true },
    );
    expect(result).toBe(true);
    expect(sample.profile).toMatchObject({
      location: 'Seattle, WA',
      locations: ['Seattle, WA'],
      startTiming: null,
      helpWith: [],
    });
    // The sample file is already in the library, so it is not added twice.
    expect(sample.documents.library.map((doc) => doc.name)).toEqual([
      'Alex_Morgan_Resume.pdf',
      'Engineering_Leadership_CV.docx',
    ]);
    // No first source: nothing to start.
    expect(sample.onboarding.firstSource).toBeNull();
    expect(run).toBeNull();
    expect(sample.sources).toEqual({});
    expect(aiSource).toBe('none');
    // Without the required answers nothing is written.
    expect(runDone({ ...blankAnswers(), roles: ['Product engineer'] }).result).toBe(false);
  });

  it('saves a re-run without restarting its first search or replacing an Anthropic key', () => {
    // Your Anthropic key is ready and is the AI setting, so Your own key keeps it.
    const before = (next: Sample) => {
      next.onboarding.firstSource = 'https://careers.example.com/jobs';
      (next as Sample & { ai: { keys: Record<string, unknown> } }).ai.keys.anthropic = {
        status: 'ready',
        last4: '4821',
        model: 'claude-haiku-4-5',
        checked: '2026-10-01',
      };
    };
    const same = runDone(
      answered({
        source: 'careers.example.com/jobs',
        sourceUrl: 'https://careers.example.com/jobs',
        ai: 'own-key',
      }),
      { rerun: true, finish: true, aiSource: 'anthropic', before },
    );
    expect(same.result).toBe(true);
    expect(same.run).toBeNull();
    expect(same.aiSource).toBe('anthropic');
    // Skipping the step keeps the saved first source.
    const skipped = runDone(answered({}), { rerun: true, finish: true, before });
    expect(skipped.sample.onboarding.firstSource).toBe('https://careers.example.com/jobs');
    expect(skipped.run).toBeNull();
    // A new address in a re-run starts a search for it.
    const changed = runDone(
      answered({ source: 'jobs.lever.co/example', sourceUrl: 'https://jobs.lever.co/example' }),
      { rerun: true, finish: true, before },
    );
    expect(changed.sample.onboarding.firstSource).toBe('https://jobs.lever.co/example');
    expect(changed.run?.run).toMatchObject({ sourceId: 'jobs-lever-co-example', via: 'setup' });
  });

  it('hands off to the Dashboard first run, whose tour starts after setup', () => {
    expect(onboarding).toMatch(
      /<a\s+class="primary-action ob-continue"\s+id="ob-finish"\s+href="\.\/home-preview\.html\?skipLoader&amp;state=new&amp;from=onboarding"/,
    );
    // Skip setup keeps its honest first run (no from=onboarding, so no tour by itself).
    expect(onboarding).toContain(
      '<a class="ob-link" id="ob-later" href="./home-preview.html?skipLoader&amp;state=new"',
    );
    // Finish saves if Done has not (and then lists the steps you skipped on the To-do, round 6,
    // G4), then starts the first search, before the page goes. A re-run's save closes the To-do
    // items it answered and forgets this tab's copy, since the store has the answers.
    const finish = script.slice(script.indexOf("finishLink.addEventListener('click'"));
    expect(finish).toMatch(
      /if \(!rerun\) \{\s*if \(!saved && saveAnswers\(\)\) noteSkipped\(\);\s*startFirstSearch\(\);\s*return;\s*\}/,
    );
    expect(finish).toMatch(
      /if \(saveAnswers\(\)\) \{\s*completeAnswered\(\);\s*startFirstSearch\(\);\s*forgetSession\(\);\s*return;\s*\}/,
    );
    // Round 6 part 3 (T1-11): a re-run opened from a To-do item (deepRerun, with required steps
    // still open) saves only what you answered, through saveSkipped, so no sample answers write
    // themselves to your profile.
    expect(finish).toMatch(
      /if \(deepRerun && !isComplete\(\)\) \{\s*if \(saveSkipped\(\)\) \{\s*completeAnswered\(\);\s*forgetSession\(\);\s*return;\s*\}\s*\}/,
    );
    // A search starts once, even after going back and finishing again.
    expect(arrowFunction(script, 'startFirstSearch')).toContain(
      'search.address === startedAddress',
    );
  });

  it('turns the JobDeputy logo into Skip setup for now (round 6 part 3, T1-6)', () => {
    expect(script).toContain("const brandLink = document.querySelector('header .brand');");
    const handler = script.slice(script.indexOf("brandLink?.addEventListener('click'"));
    // A re-run's logo still just goes home (nothing is being skipped there), and the usual
    // modifier clicks keep the browser's own meaning.
    expect(handler).toMatch(/if \(rerun \|\| event\.defaultPrevented\) return;/);
    expect(handler).toMatch(
      /if \(event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey \|\| event\.button !== 0\) return;/,
    );
    expect(handler).toContain('event.preventDefault();');
    expect(handler).toContain('skipRest();');
    expect(handler).toContain(
      "window.location.assign(laterLink.getAttribute('href') ?? brandLink.getAttribute('href'));",
    );
  });

  it('says plainly what is simulated', () => {
    expect(onboarding).toMatch(
      /<p class="sample-note" id="ob-door-note" hidden>\s*Google sign-up is simulated · no Google request was made\s*<\/p>/,
    );
    expect(onboarding).toContain('In this\n                    prototype nothing is uploaded.');
    expect(onboarding).toContain('Sample data · saved only in this browser, no API was called');
  });
});

// Round 6, G4 (R6-8): never trapped in setup. Skip setup for now (Welcome) and Skip the rest (every
// question after it) keep what you answered, start the first source you chose, and put every step
// you did not answer on your To-do as its own item (JobDeputyStore.skipSetup); Done does the same
// for the steps you skipped one by one; a re-run closes the items it answers.
describe('skipping setup (round 6, G4)', () => {
  type SetupStore = Store & {
    setupTodos(): Array<{ step: string; href: string }>;
    skipSetup(steps: string[]): { ok: boolean };
  };
  type Answered = Partial<Answers> & { passed?: string[] };

  // Runs the page's own skip, Done, and re-run code against the real sample store.
  const runSetup = (
    given: Answered,
    {
      current = 'welcome',
      action = 'skip' as 'skip' | 'done' | 'rerun',
      before = (_store: SetupStore) => {},
    } = {},
  ) => {
    const { store } = sampleStore();
    const typed = store as SetupStore;
    before(typed);
    const answers = { ...blankAnswers(), ...given };
    const finish = {
      skip: 'skipRest();',
      done: 'if (saveAnswers()) noteSkipped();\nstartFirstSearch();',
      rerun: 'if (saveAnswers()) { completeAnswered(); startFirstSearch(); }',
    }[action];
    const code = [
      `const aiSources = ${literalAfter(script, 'const aiSources =')};`,
      `const labels = ${literalAfter(script, 'const labels =')};`,
      `const stepIds = ${JSON.stringify(steps.map((step) => step.id))};`,
      addressCode,
      statement(script, 'fileKind'),
      statement(script, 'needsLocation'),
      arrowFunction(script, 'currentAiSource'),
      arrowFunction(script, 'currentModel'),
      arrowFunction(script, 'ownKeySource'),
      arrowFunction(script, 'isAnswered'),
      statement(script, 'isComplete'),
      arrowFunction(script, 'libraryWith'),
      arrowFunction(script, 'saveAnswers'),
      arrowFunction(script, 'startFirstSearch'),
      arrowFunction(script, 'setupSteps'),
      arrowFunction(script, 'chose'),
      arrowFunction(script, 'noteSkipped'),
      arrowFunction(script, 'completeAnswered'),
      arrowFunction(script, 'saveSkipped'),
      arrowFunction(script, 'skipRest'),
      finish,
      '({ firstSearch, startedAddress })',
    ].join('\n');
    const context = {
      answers,
      store,
      rerun: action === 'rerun',
      current,
      window: {},
      sourceInput: { value: answers.source },
      picks: { querySelector: () => null },
      cancelUpload: () => {},
      writeSession: () => {},
      saved: false,
      firstSearch: null,
      startedAddress: null,
      Array,
      Date,
      URL,
      String,
    };
    const out = runInNewContext(code, context) as { firstSearch: unknown; startedAddress: unknown };
    return {
      ...out,
      store: typed,
      sample: store.get(),
      todos: typed.setupTodos().map((item) => item.step),
    };
  };
  const seed = sampleStore().store.get();

  it('offers a quiet way out on every screen but Done, saying the rest goes to the To-do', () => {
    const actions = onboarding.match(/<div\s+class="ob-actions"[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(actions).toMatch(
      /<p class="ob-exit" id="ob-exit">\s*<a class="ob-link" id="ob-later" href="\.\/home-preview\.html\?skipLoader&amp;state=new" aria-describedby="ob-exit-note"\s*>Skip setup for now<\/a\s*>\s*<span class="ob-exit-note" id="ob-exit-note">I’ll add what’s left to your To-do\.<\/span>\s*<\/p>/,
    );
    // It comes after the buttons, so Continue keeps its place in the tab order.
    expect(actions.indexOf('id="ob-continue"')).toBeLessThan(actions.indexOf('id="ob-exit"'));
    const refresh = arrowFunction(script, 'refresh');
    expect(refresh).toContain('exitLine.hidden = isDone;');
    expect(refresh).toContain(
      "if (!rerun) laterLink.textContent = current === 'welcome' ? 'Skip setup for now' : 'Skip the rest';",
    );
    // A re-run's line goes back without saving, on every screen.
    expect(script).toContain("exitNote.textContent = 'Your setup stays as it was.';");
    expect(script).toMatch(
      /laterLink\.addEventListener\('click', \(\) => \{\s*if \(rerun\) return;\s*skipRest\(\);\s*\}\);/,
    );
  });

  it('skips the whole setup from Welcome: every step joins the To-do and nothing is overwritten', () => {
    const out = runSetup({}, { current: 'welcome' });
    expect(out.todos).toEqual(['focus', 'roles', 'workplace', 'watch', 'resume', 'source', 'ai']);
    expect(out.sample.onboarding).toMatchObject({
      completed: false,
      skipped: true,
      firstSource: null,
    });
    expect(out.sample.profile.targetRoles).toEqual(seed.profile.targetRoles);
    expect(out.sample.watch).toEqual(seed.watch);
    expect(out.firstSearch).toBeNull();
    expect(out.store.runs().filter((run) => run.via === 'setup')).toHaveLength(0);
    // Each item opens the right place (the store's links).
    const links = Object.fromEntries(out.store.setupTodos().map((item) => [item.step, item.href]));
    expect(links.resume).toBe('./documents-preview.html#library');
    expect(links.focus).toBe('./onboarding-preview.html?rerun=1&step=focus&from=home');
  });

  it('skips the rest after two answers: those are saved, the steps left join the To-do', () => {
    const out = runSetup(
      { focus: ['tailoring'], roles: ['Platform engineer'], passed: ['welcome', 'focus', 'roles'] },
      { current: 'workplace' },
    );
    expect(out.todos).toEqual(['workplace', 'watch', 'resume', 'source', 'ai']);
    expect(out.sample.profile.targetRoles).toEqual(['Platform engineer']);
    expect(out.sample.profile.helpWith).toEqual(['tailoring']);
    // What you didn't answer keeps the profile's own value.
    expect(out.sample.profile.workStyles).toEqual(seed.profile.workStyles);
    expect(out.sample.checklist).toMatchObject({ roles: true });
  });

  it('starts the first source you chose before skipping the AI step, on the account’s setting', () => {
    const out = runSetup(
      {
        roles: ['Platform engineer'],
        workplace: ['remote'],
        source: 'google.com/about/careers/applications/jobs/results',
        sourceUrl: 'https://www.google.com/about/careers/applications/jobs/results',
        passed: ['welcome', 'focus', 'roles', 'workplace', 'watch', 'resume', 'source'],
      },
      { current: 'ai' },
    );
    expect(out.todos).toEqual(['focus', 'resume', 'ai']);
    expect(out.sample.onboarding).toMatchObject({
      skipped: true,
      firstSource: 'https://www.google.com/about/careers/applications/jobs/results',
      firstRun: { sourceId: 'google', started: true },
    });
    expect(out.store.runs().filter((run) => run.via === 'setup')).toHaveLength(1);
  });

  it('counts the schedule as answered once you chose it or went past it', () => {
    const chosen = runSetup(
      { schedule: 'nightly', roles: ['Platform engineer'] },
      { current: 'watch' },
    );
    expect(chosen.todos).not.toContain('watch');
    expect(chosen.sample.watch).toMatchObject({ requested: 'daily' });
    const unseen = runSetup({ roles: ['Platform engineer'] }, { current: 'watch' });
    expect(unseen.todos).toContain('watch');
  });

  it('lists the steps you skipped one by one when a first setup reaches Done', () => {
    const out = runSetup(
      {
        roles: ['Platform engineer'],
        workplace: ['remote'],
        ai: 'platform',
        passed: ['welcome', 'roles', 'workplace', 'watch', 'ai'],
      },
      { current: 'done', action: 'done' },
    );
    expect(out.todos).toEqual(['focus', 'resume', 'source']);
    expect(out.sample.onboarding).toMatchObject({ completed: true });
    // The summary says where they went.
    expect(script).toContain("const todoSummary = 'Skipped · I’ll add it to your To-do';");
  });

  it('closes only the To-do items a re-run answered, and keeps an AI setting you did not change', () => {
    const before = (store: SetupStore) => {
      store.skipSetup(['focus', 'roles', 'ai']);
    };
    const out = runSetup(
      {
        focus: ['roles'],
        roles: [...seed.profile.targetRoles],
        workplace: ['remote', 'hybrid'],
        location: 'Seattle, WA',
        ai: 'own-key',
        passed: ['focus'],
      },
      { current: 'done', action: 'rerun', before },
    );
    expect(out.todos).toEqual(['roles', 'ai']);
  });

  it('opens a re-run from a To-do item at its question, then straight to Check your setup', () => {
    expect(script).toContain(
      "rerun && !sameRun && stepIds.includes(requested) && !['welcome', 'done'].includes(requested);",
    );
    expect(script).toContain(
      "let returnTo = (sameRun && session.returnTo === 'done') || deepRerun ? 'done' : null;",
    );
    expect(arrowFunction(script, 'forgetSession')).toContain(
      'window.sessionStorage.removeItem(SESSION_KEY);',
    );
  });

  it('shows the home Region everywhere on setup (round 6 part 3, R9-6)', () => {
    // The three Regions, each with the words the page uses in different places (label, name, and
    // the one in "stays in <place>"), so every Region fact names the one chosen.
    expect(evaluate(literalAfter(script, 'const REGIONS ='))).toEqual({
      US: { label: 'United States (US)', name: 'United States', place: 'the United States' },
      IN: { label: 'India (IN)', name: 'India', place: 'India' },
      UK: { label: 'United Kingdom (UK)', name: 'United Kingdom', place: 'the United Kingdom' },
    });
    // The one chosen above Create account's ways in (?region=us, in, or uk) comes before every
    // other fact; after the account exists, the store's homeRegion (its latest signed agreement
    // record's Region) is the one; the sample account's United States with neither.
    expect(script).toMatch(
      /const regionFromUrl = \(\) => \{\s*const code = String\(parameters\.get\('region'\) \?\? ''\)\.toUpperCase\(\);\s*return !rerun && Object\.hasOwn\(REGIONS, code\) \? code : null;/,
    );
    expect(script).toMatch(
      /const regionFromStore = \(\) => \{\s*try \{\s*const code = String\(store\?\.homeRegion\?\.\(\)\?\.code \?\? ''\)\.toUpperCase\(\);\s*return Object\.hasOwn\(REGIONS, code\) \? code : null;/,
    );
    expect(script).toContain(
      "const homeRegionCode = () => regionFromUrl() ?? regionFromStore() ?? 'US';",
    );
    // Welcome names the Region, the résumé step says where the file stays, the file once it is
    // ready too, and the deputy's shield (data-deputy-region) reads it, so its "your data stays
    // in" line names the same one. The static values default to the sample's United States.
    expect(onboarding).toContain(
      '<strong class="ob-fact-value" id="ob-region-value">United States (US)</strong>',
    );
    expect(onboarding).toContain(
      'PDF or DOCX, up to 5 MB, kept in your\n                    <span data-home-region-name>United States</span> home Region.',
    );
    expect(script).toContain('regionValue.textContent = region.label;');
    expect(script).toContain(
      "document.querySelector('#onboarding-deputy').dataset.deputyRegion = homeRegionCode();",
    );
    expect(script).toMatch(
      /ready · stays in \$\{escapeHtml\(homeRegion\(\)\.place\)\}\$\{file\.sample \? ' · sample file' : ''\}/,
    );
    expect(script).toContain(
      "for (const node of document.querySelectorAll('[data-home-region-name]')) {",
    );
  });
});

// Round 6, R6-3 and R6-2: the shared page intro with Take the tour, and a short tour the deputy
// gives on Welcome (how setup works, your Region, and how to skip), in his own words.
describe('setup tour (round 6)', () => {
  it('uses the shared page intro with Take the tour at the end of the title row', () => {
    expect(onboarding).toMatch(
      /<section\s+class="page-intro ob-intro"\s+id="ob-intro"\s+aria-labelledby="page-title"/,
    );
    expect(onboarding).toMatch(
      /<div class="page-intro-copy">\s*<p class="eyebrow" id="ob-eyebrow">/,
    );
    expect(onboarding).toMatch(
      /<div class="page-intro-actions">\s*<button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour<\/button>\s*<\/div>\s*<\/section>/,
    );
    // The page never places the shared intro or its button itself.
    expect(styles).not.toMatch(/\.page-intro(?:-actions|-copy)?\s*[{,]|\.page-tour\s*[{,]/);
  });

  it('marks three steps in the deputy’s words, offered on Welcome of a first setup only', () => {
    const marked = [
      ...onboarding.matchAll(
        /data-ob-tour="(\d)"\s+data-tour-title="([^"]+)"\s+data-tour-text="([^"]+)"/g,
      ),
    ];
    expect(marked.map((step) => [step[1], step[2]])).toEqual([
      ['1', 'Eight short steps.'],
      ['2', 'Your account and its Region.'],
      ['3', 'You can skip anytime.'],
    ]);
    for (const [, , title = '', body = ''] of marked) {
      expect(words(title), title).toBeLessThanOrEqual(6);
      expect(body, title).toMatch(/\bI\b/);
      expect(`${title} ${body}`).not.toMatch(/[–—]/);
    }
    // The steps carry data-tour-step only on Welcome (app-components.js shows Take the tour
    // while a step is marked), so the questions keep their screen to themselves.
    expect(onboarding).not.toMatch(/data-tour-step=/);
    expect(script).toContain("const offered = current === 'welcome' && !rerun;");
    expect(script).toContain(
      "if (offered) target.setAttribute('data-tour-step', target.dataset.obTour);",
    );
    expect(arrowFunction(script, 'showStep')).toContain('syncTour();');
    // While it runs, the phone bar rejoins the flow so the tour can ring it above its sheet.
    expect(styles.replace(/\s+/g, ' ')).toContain(
      '.ob-task.is-touring .ob-actions { position: static; }',
    );
  });
});

describe('onboarding on phones', () => {
  // The rules inside one @media block of the page's styles.
  const mediaBlock = (query: string): string => {
    const start = styles.indexOf(`@media ${query} {`);
    expect(start, `@media ${query}`).toBeGreaterThanOrEqual(0);
    return literalAfter(styles.slice(start), `@media ${query}`);
  };
  const compact = (css: string) => css.replace(/\s+/g, ' ');

  it('puts the step progress on top, in the setup header, at every width', () => {
    const header = onboarding.match(/<header class="app-header">[\s\S]*?<\/header>/)?.[0] ?? '';
    expect(header).toContain('<div class="step-progress ob-progress" id="ob-progress">');
    expect(header).toContain(
      '<p class="step-progress-label" id="ob-progress-label">8 short steps</p>',
    );
    expect(header.match(/<li class="step-progress-step"><\/li>/g)).toHaveLength(8);
    expect(header).toContain('aria-hidden="true"');
  });

  it('gives phones a sticky action bar with safe-area padding, which steps aside while typing', () => {
    const phone = compact(mediaBlock('(max-width: 720px)'));
    expect(phone).toMatch(
      /\.ob-actions \{ position: sticky; z-index: 10; bottom: 0; flex-wrap: wrap; margin: auto -13px 0; padding: 8px 13px max\(13px, env\(safe-area-inset-bottom\)\);/,
    );
    // One row while it fits (the narrowest phones trim the buttons' padding); a long last
    // button or WCAG text spacing wraps instead of widening the page.
    expect(compact(mediaBlock('(max-width: 359px)'))).toContain(
      '.ob-actions > :is(.ob-back, .ob-skip, .ob-continue) { padding-inline: 13px; }',
    );
    expect(phone).toContain('.ob-task.is-typing .ob-actions { position: static; }');
    // Keyboard focus clears the bar, and a script check covers cards around hidden radios.
    expect(phone).toContain(
      '.ob-step :is(input, button, a, select, textarea) { scroll-margin-bottom: 89px; }',
    );
    expect(script).toContain(
      "if (textFields.includes(event.target)) form.classList.add('is-typing');",
    );
    expect(script).toContain("form.classList.remove('is-typing');");
    expect(script).toContain('const textFields = [roleInput, locationInput, sourceInput];');
    expect(arrowFunction(script, 'keepClear')).toContain("element.closest('label') ?? element");
    expect(script).toContain("window.visualViewport?.addEventListener('resize'");
    // The page leaves the shared scroll padding alone (the consistency test checks the html rule).
    expect(styles).not.toMatch(/(?:^|[\s}])html\s*\{[^}]*scroll-padding/);
  });

  it('lets deputy.css lay out the phone scene, and keeps one panda', () => {
    expect(styles).not.toMatch(/\.ob-stage \.deputy-scene\s*\{/);
    // The stage gives back only measured empty space under the scene (reduced motion leaves a
    // band there), and the form paints above it, so the question keeps its place.
    const trim = arrowFunction(script, 'trimStage');
    expect(trim).toContain("stage.style.removeProperty('margin-bottom');");
    expect(trim).toContain(`if (empty > 0) stage.style.marginBottom = \`-\${empty}px\`;`);
    expect(script).toContain('new ResizeObserver(trimStage).observe(scene);');
    expect(compact(mediaBlock('(max-width: 720px)'))).toContain(
      '.ob-task { position: relative; z-index: 1; display: flex;',
    );
    expect(onboarding.match(/data-deputy-art/g)).toHaveLength(1);
    expect(onboarding).not.toContain('deputy-dock');
  });

  it('gives each text field the keyboard, capitalization, and Enter key it needs', () => {
    const field = (id: string) =>
      onboarding.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
    expect(field('ob-role-input')).toMatch(
      /type="text"[\s\S]*autocapitalize="sentences"[\s\S]*enterkeyhint="done"/,
    );
    expect(field('ob-location')).toMatch(
      /type="text"[\s\S]*autocomplete="address-level2"[\s\S]*autocapitalize="words"[\s\S]*enterkeyhint="next"/,
    );
    expect(field('ob-source')).toMatch(
      /inputmode="url"[\s\S]*autocomplete="url"[\s\S]*autocapitalize="off"[\s\S]*autocorrect="off"[\s\S]*spellcheck="false"[\s\S]*enterkeyhint="go"/,
    );
  });
});

describe('onboarding scene', () => {
  it('hosts one live deputy scene with its own Pause motion and announcement channel', () => {
    const scene =
      onboarding.match(
        /<div\s+class="deputy-scene"[\s\S]*?<\/div>\s*<p class="ob-stage-note" id="ob-stage-note">/,
      )?.[0] ?? '';
    expect(scene).toMatch(/id="onboarding-deputy"\s+data-deputy\s+data-deputy-page="onboarding"/);
    expect(scene).not.toContain('data-deputy-demo');
    for (const part of [
      '<div class="deputy-art" data-deputy-art aria-hidden="true"></div>',
      '<p class="deputy-speech" data-deputy-speech>Hi, Alex. Let’s get going.</p>',
      '<span data-deputy-duty>Ready</span>',
      '<div class="deputy-actions"><button class="deputy-motion" type="button" data-deputy-motion>Pause motion</button></div>',
      '<p class="sr-only" data-deputy-announce role="status"></p>',
    ]) {
      expect(scene).toContain(part);
    }
  });

  it('loads the shared scripts in order before its own', () => {
    const order = ['app-components.js', 'sample-store.js', 'deputy.js'].map((name) =>
      onboarding.indexOf(`<script src="./${name}"></script>`),
    );
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order[2]).toBeLessThan(onboarding.indexOf('<script>'));
    expect(onboarding).not.toContain('app-shell.js');
  });
});
