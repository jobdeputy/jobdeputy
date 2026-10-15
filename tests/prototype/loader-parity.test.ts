import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Search home opens with the same OpeningLoader as sign-in (docs/design-system.md, Opening loader):
// the same timing, failure-safe, progress values, strings, and accessible names. Search home keeps
// the loader in three blocks between OpeningLoader markers (styles, markup, and script). Sign-in's
// loader styles and markup are already contiguous, so they must match home's blocks byte for byte.
// Its script is interleaved with the story code, so each loader statement and function must match
// instead. Once a page carries the same markers, its whole blocks are compared.

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');
const login = sourceFor('login-preview.html');
const home = sourceFor('home-preview.html');
const svg = sourceFor('jobdeputy-animated.svg');

type BlockKind = 'styles' | 'markup' | 'script';
const MARKERS: Record<BlockKind, [string, string]> = {
  styles: ['/* OpeningLoader styles: start', '/* OpeningLoader styles: end */'],
  markup: ['<!-- OpeningLoader markup: start', '<!-- OpeningLoader markup: end -->'],
  script: ['// OpeningLoader script: start', '// OpeningLoader script: end'],
};

// ------------------------------------------------------------------ extraction helpers
function skipQuoted(text: string, start: number): number {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1;
    else if (text[index] === quote) return index;
  }
  return text.length;
}

function skipTemplate(text: string, start: number): number {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1;
    else if (text[index] === '`') return index;
    else if (text[index] === '$' && text[index + 1] === '{') index = blockEnd(text, index + 1) - 1;
  }
  return text.length;
}

// Index just past the brace that closes the one at `open`, skipping strings and comments.
function blockEnd(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === "'" || character === '"') index = skipQuoted(text, index);
    else if (character === '`') index = skipTemplate(text, index);
    else if (character === '/' && next === '/') index = text.indexOf('\n', index);
    else if (character === '/' && next === '*') index = text.indexOf('*/', index + 2) + 1;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    if (index < 0) break;
  }
  return -1;
}

const lineStart = (text: string, index: number): number => text.lastIndexOf('\n', index) + 1;

// The text between a marker pair, without the marker lines and surrounding blank lines.
function marked(source: string, kind: BlockKind): string | null {
  const [start, end] = MARKERS[kind];
  const from = source.indexOf(start);
  if (from < 0) return null;
  const to = source.indexOf(end, from);
  if (to < 0) return null;
  return source
    .slice(source.indexOf('\n', from) + 1, lineStart(source, to))
    .replace(/^\n+|\s+$/g, '');
}

// Sign-in's contiguous loader styles: `.page-loader` through the loader-detail-in keyframes.
function contiguousStyles(source: string): string | null {
  const from = source.indexOf('      .page-loader {');
  const keyframes = source.indexOf('@keyframes loader-detail-in', from);
  if (from < 0 || keyframes < 0) return null;
  return source.slice(from, blockEnd(source, source.indexOf('{', keyframes)));
}

// Sign-in's contiguous loader markup: the loader element and its status announcement.
function contiguousMarkup(source: string): string | null {
  const from = source.indexOf('<div class="page-loader" id="page-loader">');
  const announcement = source.indexOf('id="loader-announcement"', from);
  if (from < 0 || announcement < 0) return null;
  return source.slice(lineStart(source, from), source.indexOf('></p>', announcement) + 5);
}

const blockOf = (source: string, kind: BlockKind): string | null =>
  marked(source, kind) ??
  (kind === 'styles'
    ? contiguousStyles(source)
    : kind === 'markup'
      ? contiguousMarkup(source)
      : null);

// `const name = (…) => { … };`, from the declaration through its closing semicolon.
function arrowFunction(source: string, name: string): string | null {
  const from = source.indexOf(`const ${name} = (`);
  if (from < 0) return null;
  const end = blockEnd(source, source.indexOf('=> {', from) + 3);
  return end < 0 ? null : source.slice(from, end + 1);
}

// `if (condition) { … }` (and its `else { … }` when present), from `if` through the last brace.
function ifStatement(source: string, head: string, firstLine: string): string | null {
  let from = source.indexOf(head);
  while (from >= 0 && !source.startsWith(firstLine, source.indexOf('\n', from) + 1)) {
    from = source.indexOf(head, from + 1);
  }
  if (from < 0) return null;
  let end = blockEnd(source, from + head.length - 1);
  if (source.startsWith(' else {', end)) end = blockEnd(source, end + ' else '.length);
  return source.slice(from, end);
}

const QUERIES = [
  'pageLoader',
  'loaderLogo',
  'loaderProgressFill',
  'loaderStatus',
  'loaderProgress',
  'loaderAnnouncement',
];
const STATE = [
  'let loaderFinishScheduled = false;',
  'let loaderExitStarted = false;',
  'let loaderFrame;',
  'let loaderProgressValue = 0;',
  'const loaderStartedAt = performance.now();',
  'const loaderDeadline = 4500;',
  'const loaderStoryDuration = 2605;',
];
const PROGRESS_FUNCTIONS = [
  'setLoaderProgress',
  'trackLoaderProgress',
  'settle',
  'animateLoaderProgress',
];
const EXIT_FUNCTIONS = ['exitLoader', 'finishLoader'];

// Every loader statement in sign-in's order, keyed for readable failures. The page-specific end of
// revealPage (the sign-in arrive wave) is excluded; the loader's own reveal steps are compared.
function scriptPieces(source: string): Record<string, string | null> {
  const pieces: Record<string, string | null> = {};
  for (const name of QUERIES) {
    pieces[`query ${name}`] =
      source.match(new RegExp(`const ${name} = document\\.querySelector\\('[^']+'\\);`))?.[0] ??
      null;
  }
  pieces['svg source'] = ifStatement(
    source,
    "if (!previewParameters.has('skipLoader')) {",
    "        const loaderSource = new URL('./jobdeputy-animated.svg'",
  );
  for (const line of STATE) pieces[line] = source.includes(line) ? line : null;
  for (const name of PROGRESS_FUNCTIONS) pieces[name] = arrowFunction(source, name);
  const reveal = arrowFunction(source, 'revealPage');
  const ready = "loaderAnnouncement.textContent = 'JobDeputy is ready.';";
  pieces['revealPage (loader steps)'] =
    reveal?.includes(ready) === true ? reveal.slice(0, reveal.indexOf(ready) + ready.length) : null;
  for (const name of EXIT_FUNCTIONS) pieces[name] = arrowFunction(source, name);
  pieces.boot = ifStatement(
    source,
    "if (previewParameters.has('skipLoader')) {",
    '        loaderFinishScheduled = true;',
  );
  return pieces;
}

// ------------------------------------------------------------------ behaviour-defining values
const number = (source: string, pattern: RegExp): number | null => {
  const found = source.match(pattern)?.[1];
  return found === undefined ? null : Number(found);
};
const text = (source: string, pattern: RegExp): string | null => source.match(pattern)?.[1] ?? null;
const attribute = (element: string | null, name: string): string | null =>
  element?.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

function behaviour(source: string) {
  const styles = blockOf(source, 'styles') ?? '';
  const markup = blockOf(source, 'markup') ?? '';
  const progressbar = markup.match(/<span[^>]*role="progressbar"[^>]*>/)?.[0] ?? null;
  const announcer = markup.match(/<p[^>]*id="loader-announcement"[^>]*>/)?.[0] ?? null;
  const logo = markup.match(/<img[^>]*id="loader-logo"[^>]*>/)?.[0] ?? null;
  return {
    scrollLock:
      source.includes('<body class="loader-active">') &&
      /body\.loader-active \{\s*overflow: hidden;\s*\}/.test(source) &&
      source.includes("document.body.classList.remove('loader-active');"),
    fadeStyle: number(styles, /\.page-loader \{[^}]*opacity (\d+)ms var\(--ease-settle\)/),
    fadeVisibility: number(styles, /\.page-loader \{[^}]*visibility (\d+)ms step-end/),
    fadeScript: number(source, /: fullExit\s*\?\s*(\d+)\s*:\s*Math\.max/),
    fill: number(source, /const fillDuration = fullExit \? (\d+) : 0;/),
    detailIn: text(styles, /animation: (loader-detail-in [^;]+);/),
    story: number(source, /const loaderStoryDuration = (\d+);/),
    deadline: number(source, /const loaderDeadline = (\d+);/),
    failSafeLead: number(
      source,
      /\(\) => exitLoader\(true\),\s*Math\.max\(0, loaderDeadline - (\d+)/,
    ),
    failSafeFadeCap: number(source, /: Math\.max\(0, Math\.min\((\d+), remaining\)\);/),
    exitMargin: number(source, /loaderDeadline - performance\.now\(\) - (\d+);/),
    fullExitBudget: number(source, /!loaderStill\(\) && remaining >= (\d+);/),
    progressCap: number(source, /Math\.min\(([\d.]+), \(elapsed \/ loaderStoryDuration\) \* \1\)/),
    reducedProgress: number(source, /loaderStill\(\) \? (\d+) : Math\.min\(0\.92/),
    reducedMinimumDisplay: number(source, /loaderStill\(\) \? (\d+) : loaderStoryDuration;/),
    reducedFade: number(source, /const fadeDuration = loaderStill\(\)\s*\?\s*(\d+)/),
    loadingAnnouncementDelay: number(source, /'Loading JobDeputy…';\s*\}\s*\}, (\d+)\);/),
    loadingAnnouncement: text(source, /loaderAnnouncement\.textContent = '(Loading[^']*)';/),
    readyAnnouncement: text(source, /loaderAnnouncement\.textContent = '([^']*ready[^']*)';/),
    loadingStatus: text(source, /percent < 100 \? `([^`]+)`/),
    readyStatus: text(source, /percent < 100 \? `[^`]+` : '([^']+)'/),
    initialStatus: text(markup, /id="loader-status" aria-hidden="true">([^<]+)</),
    progressLabel: attribute(progressbar, 'aria-label'),
    progressRange: ['aria-valuemin', 'aria-valuemax', 'aria-valuenow'].map((name) =>
      attribute(progressbar, name),
    ),
    announcer: ['class', 'role', 'aria-live', 'aria-atomic'].map((name) =>
      attribute(announcer, name),
    ),
    logo: [attribute(logo, 'alt'), attribute(logo, 'src')],
    svgSource: text(source, /new URL\('(\.\/jobdeputy-animated\.svg)', window\.location\.href\)/),
    freshInstance: source.includes(
      "loaderSource.searchParams.set('instance', String(performance.timeOrigin));",
    ),
  };
}

// docs/design-system.md, Opening loader.
const CONTRACT: ReturnType<typeof behaviour> = {
  scrollLock: true,
  fadeStyle: 618,
  fadeVisibility: 618,
  fadeScript: 618,
  fill: 380,
  detailIn: 'loader-detail-in 380ms var(--ease-settle) 320ms both',
  story: 2605,
  deadline: 4500,
  failSafeLead: 360,
  failSafeFadeCap: 180,
  exitMargin: 40,
  fullExitBudget: 1000,
  progressCap: 0.92,
  reducedProgress: 0,
  reducedMinimumDisplay: 120,
  reducedFade: 20,
  loadingAnnouncementDelay: 60,
  loadingAnnouncement: 'Loading JobDeputy…',
  readyAnnouncement: 'JobDeputy is ready.',
  // The page's template literal, as source text.
  loadingStatus: `Loading · \${percent}%`,
  readyStatus: 'Ready · 100%',
  initialStatus: 'Loading · 0%',
  progressLabel: 'Loading progress',
  progressRange: ['0', '100', '0'],
  announcer: ['sr-only', 'status', 'polite', 'true'],
  logo: ['', null],
  svgSource: './jobdeputy-animated.svg',
  freshInstance: true,
};

// ------------------------------------------------------------------ tests
describe('opening loader parity: Search home and sign-in', () => {
  it('keeps Search home loader in one styles, one markup, and one script block', () => {
    for (const kind of Object.keys(MARKERS) as BlockKind[]) {
      const [start, end] = MARKERS[kind];
      expect(home.split(start).length - 1, `home ${kind} start marker`).toBe(1);
      expect(home.split(end).length - 1, `home ${kind} end marker`).toBe(1);
      expect(home.indexOf(start), `home ${kind} markers in order`).toBeLessThan(home.indexOf(end));
      expect(marked(home, kind), `home ${kind} block`).toBeTruthy();
    }
    // Nothing loader-specific lives outside the blocks, except the body scroll lock that both
    // pages keep with their base styles (compared below).
    const outside = (Object.keys(MARKERS) as BlockKind[]).reduce(
      (rest, kind) => rest.replace(marked(home, kind) ?? '', ''),
      home,
    );
    expect(outside).not.toMatch(
      /\.page-loader\s*\{|(?<!body)\.loader-[\w-]+\s*\{|@keyframes loader/,
    );
    expect(outside).not.toMatch(/\bloader(?:StartedAt|Deadline|StoryDuration|Frame)\b/);
    expect(outside).not.toContain('id="loader-');
  });

  it.each(['styles', 'markup'] as const)('matches the sign-in loader %s byte for byte', (kind) => {
    const reference = blockOf(login, kind);
    expect(reference, `sign-in loader ${kind}`).toBeTruthy();
    expect(marked(home, kind)).toBe(reference);
  });

  it('runs every loader statement exactly as sign-in does', () => {
    const reference = marked(login, 'script');
    if (reference !== null) {
      // Both pages carry the markers: the whole blocks must be identical.
      expect(marked(home, 'script')).toBe(reference);
      return;
    }
    const block = marked(home, 'script') ?? '';
    const ours = scriptPieces(block);
    const theirs = scriptPieces(login);
    for (const [piece, value] of Object.entries(theirs)) {
      expect(value, `sign-in ${piece}`).not.toBeNull();
      expect(ours[piece], `home ${piece}`).toBe(value);
    }
    // Search home's block is those statements and the reveal hook, in sign-in's order.
    const order = Object.values(ours).map((piece) => block.indexOf(piece ?? '\u0000'));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('keeps the same timing, failure-safe, strings, and labels on both pages', () => {
    expect(behaviour(home)).toEqual(behaviour(login));
  });

  it('meets the documented Opening loader contract', () => {
    expect(behaviour(home)).toEqual(CONTRACT);
  });
});

// Finding 34 (round 3): every entry route opens a visit with the same bootstrap, so account access
// (Create account, the reset request, and the new password) carries sign-in's loader, and a link
// from one entry route to another skips it, like any navigation inside the app.
describe('opening loader parity: account access and sign-in', () => {
  const access = sourceFor('access-preview.html');

  it.each(['styles', 'markup'] as const)('matches the sign-in loader %s byte for byte', (kind) => {
    expect(marked(access, kind), `access loader ${kind}`).toBeTruthy();
    expect(marked(access, kind)).toBe(marked(login, kind));
  });

  it('runs every loader statement exactly as sign-in does', () => {
    const ours = scriptPieces(access);
    for (const [piece, value] of Object.entries(scriptPieces(login))) {
      expect(value, `sign-in ${piece}`).not.toBeNull();
      expect(ours[piece], `access ${piece}`).toBe(value);
    }
  });

  it('keeps the same timing, failure-safe, strings, and labels as sign-in', () => {
    expect(behaviour(access)).toEqual(behaviour(login));
    expect(behaviour(access)).toEqual(CONTRACT);
  });

  it('holds the page inert under the loader and lets the panda arrive only at the reveal', () => {
    expect(access).toContain(
      '<a class="skip-link" id="skip-link" href="#form-title" inert>Skip to account access</a>',
    );
    expect(access).toContain(
      '<header class="site-header" id="site-header" inert aria-hidden="true">',
    );
    expect(access).toMatch(/<main\s[^>]*\sinert\s+aria-hidden="true"\s*>/);
    const unlock = access.match(/const unlockInterface = \(\) => \{([\s\S]*?)\n {6}\};/)?.[1] ?? '';
    for (const part of ['skipLink', 'siteHeader', 'page']) {
      expect(unlock).toContain(`${part}.removeAttribute('inert');`);
      expect(unlock).toContain(`${part}.removeAttribute('aria-hidden');`);
    }
    expect(unlock.trim().endsWith('arrive();')).toBe(true);
    // The panda arrives once, from the reveal, never straight from the script's end.
    expect(access.match(/^\s*arrive\(\);$/gm)).toHaveLength(1);
  });

  it('skips the loader on every link between entry routes', () => {
    const trust = sourceFor('trust-preview.html');
    const links = [login, sourceFor('access-preview.html'), trust].flatMap((source) =>
      [...source.matchAll(/\.\/(?:login|access)-preview\.html\?[^"'`\s]*/g)].map((match) =>
        match[0].replace(/&amp;/g, '&'),
      ),
    );
    expect(links.length).toBeGreaterThan(8);
    for (const link of links) expect(link, link).toMatch(/[?&]skipLoader(?:&|$)/);
  });
});

describe('opening loader asset', () => {
  const style = svg.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const reduced = style.match(
    /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n {4}\}/,
  )?.[1];
  const animated = [...style.matchAll(/\n {4}([.\w, \n-]+?) \{[^}]*\banimation:/g)].flatMap(
    (rule) => (rule[1] ?? '').split(',').map((selector) => selector.trim()),
  );
  const selectorsWithNone = (css: string): string[] =>
    [...css.matchAll(/([^{}]+)\{\s*animation: none;\s*\}/g)].flatMap((rule) =>
      (rule[1] ?? '')
        .replace(/:root:has\(#settled:target\)\s*:is\(/, '')
        .replace(/\)\s*$/, '')
        .split(',')
        .map((selector) => selector.trim()),
    );
  // Every element an animated class selects must also carry a class whose animation is stopped
  // (for example .route-j paths are also .search-route). Each stopping rule comes later in the
  // sheet or is more specific, so it wins the cascade.
  const elementClasses = [...svg.matchAll(/\sclass="([^"]+)"/g)].map((match) =>
    (match[1] ?? '').split(/\s+/),
  );
  const stoppedFor = (selector: string, stopped: string[]): boolean => {
    const carriers = elementClasses.filter((classes) => classes.includes(selector.slice(1)));
    return (
      carriers.length > 0 &&
      carriers.every((classes) => classes.some((name) => stopped.includes(`.${name}`)))
    );
  };

  it('tells the same 2.605s story the hosts wait for', () => {
    expect(style).toContain('--story: 2.605s;');
    expect(behaviour(home).story).toBe(2605);
    // Story animations start at once and last var(--story); only the ambient loops repeat.
    for (const shorthand of style.match(/animation:[^;]+;/g) ?? []) {
      if (/\binfinite\b/.test(shorthand)) {
        expect(shorthand, 'loops start only after the story').toMatch(/var\(--story\) infinite/);
        const seconds = Number(shorthand.match(/(\d+(?:\.\d+)?)s ease/)?.[1]);
        expect(seconds, `${shorthand} period`).toBeGreaterThanOrEqual(5.236);
      }
    }
  });

  it('uses the canonical motion tokens with the page values', () => {
    expect(style).not.toMatch(/--(?:ease-out|spring)\b/);
    for (const token of ['--ease-settle', '--ease-spring']) {
      const value = style.match(new RegExp(`${token}: ([^;]+);`))?.[1];
      expect(value, token).toBeDefined();
      expect(home).toContain(`${token}: ${value};`);
    }
  });

  it('leaves the progress underline to the host', () => {
    const underline = svg.match(/<rect x="247" y="353"[^>]*>/)?.[0] ?? '';
    expect(underline).toContain('opacity="0.1"');
    expect(underline).not.toMatch(/\sclass=/);
    expect(svg).not.toMatch(/<animate|<set\b/);
    expect(style).not.toMatch(/(?:^|[\s,}])rect\b[^{]*\{/);
  });

  it('settles every animation under reduced motion and the #settled fragment', () => {
    expect(reduced, 'reduced-motion block').toBeDefined();
    const settled = style.slice(style.indexOf(':root:has(#settled:target)'));
    expect(svg).toContain('<view id="settled" viewBox="0 0 610 377" />');
    expect(animated.length, 'animated selectors found').toBeGreaterThan(10);
    for (const css of [reduced ?? '', settled]) {
      const stopped = selectorsWithNone(css);
      for (const selector of animated) {
        expect(stoppedFor(selector, stopped), `${selector} keeps animating`).toBe(true);
      }
      // The scanner's final keyframe is its only pose that differs from the base style.
      expect(css).toMatch(/\.scanner \{\s*transform: rotate\(-8deg\);\s*\}/);
    }
    expect(style).toMatch(/100% \{\s*transform: rotate\(-8deg\);\s*\}/);
  });
});

describe('loader parity self-checks', () => {
  it('matches braces across strings, template literals, and comments', () => {
    const sample =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source text with a template literal
      "const f = () => {\n  const a = '}';\n  const b = `${'{'} ${{ x: 1 }.x}`;\n  // }\n  /* { */\n};\n";
    expect(arrowFunction(sample, 'f')).toBe(sample.trimEnd());
  });

  it('reports drift as a value difference', () => {
    const drifted = login.replace(/: fullExit\s*\?\s*\d+\s*:/, (match) =>
      match.replace(/\d+/, '999'),
    );
    expect(behaviour(drifted).fadeScript).toBe(999);
    expect(behaviour(drifted)).not.toEqual(behaviour(home));
  });
});

describe('opening loader under a saved Pause motion', () => {
  const access = sourceFor('access-preview.html');
  it('shows the settled mark and the reduced-motion timing on every page that carries it', () => {
    for (const page of [login, access, home]) {
      expect(page).toContain(
        "loaderMotionPaused = window.localStorage.getItem('jobdeputy.deputyMotion') === 'paused';",
      );
      expect(page).toContain(
        'const loaderStill = () => prefersReducedMotion || loaderMotionPaused;',
      );
      expect(page).toContain("loaderSource.hash = 'settled';");
      expect(page).toContain('const minimumDisplay = loaderStill() ? 120 : loaderStoryDuration;');
    }
  });
});
