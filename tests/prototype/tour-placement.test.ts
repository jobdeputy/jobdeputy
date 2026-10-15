import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// One tour button place on every internal page (round 6, R6-3 and finding A6): Take the tour sits
// in the shared page intro. section.page-intro holds div.page-intro-copy (an optional eyebrow, the
// h1, the lede) and div.page-intro-actions with button.secondary-action.page-tour[data-tour-open].
// app-chrome.css places the actions at the right end of the title row, top aligned with the h1,
// from 721px, and on their own row under the lede, at the start, at 720px and below (round 7,
// T2-12: compact at the end of the eyebrow's line where the intro has an eyebrow). The rendered
// check is the recipe in /tmp/jd-r8/A3/handoff.md section 2.1 (scripts/ui-audit.mjs can adopt it).

const brandDirectory = resolve(import.meta.dirname, '../../brand');

// Every signed-in page with the app shell (the same list as ui-consistency.test.ts).
const internalPages = [
  'home-preview.html',
  'searches-preview.html',
  'jobs-preview.html',
  'applications-preview.html',
  'autofill-preview.html',
  'documents-preview.html',
  'materials-preview.html',
  'profile-preview.html',
  'ai-preview.html',
  'trust-preview.html',
  'invite-preview.html',
  'shop-preview.html',
  'account-preview.html',
  'connections-preview.html',
  'prompts-preview.html',
  // Round 7: the two new Settings tabs, Usage (SP) and Activity (SA).
  'usage-preview.html',
  'activity-preview.html',
];

// Pages whose owners have not moved their intro to the shared markup yet (round 6, Phase B). The
// orchestrator removes each page as it migrates and empties the set after Phase B; a page listed
// here is still checked to be an internal page, and nothing else.
// Every internal page uses the shared page intro since round 6, Phase B (emptied by the orchestrator).
const PENDING = new Set<string>([]);

const migrated = internalPages.filter((file) => !PENDING.has(file));

function sourceFor(file: string): string {
  return readFileSync(resolve(brandDirectory, file), 'utf8');
}

function stylesIn(source: string): string {
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1] ?? '')
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const VOID = new Set([
  'area',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
]);

type Element = { tag: string; attributes: string; inner: string; outer: string; start: number };

// The element that opens at `start`, with its inner and outer markup (tags balanced by name).
function elementAt(source: string, start: number): Element | null {
  const open = source.slice(start).match(/^<([a-z][\w-]*)\b([^>]*)>/i);
  if (!open) return null;
  const tag = (open[1] ?? '').toLowerCase();
  const attributes = open[2] ?? '';
  const innerStart = start + open[0].length;
  if (VOID.has(tag)) return { tag, attributes, inner: '', outer: open[0], start };
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  pattern.lastIndex = innerStart;
  let depth = 1;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) {
      return {
        tag,
        attributes,
        inner: source.slice(innerStart, match.index),
        outer: source.slice(start, match.index + match[0].length),
        start,
      };
    }
  }
  return null;
}

// The direct child elements of some markup (comments and text skipped).
function childrenOf(inner: string): Element[] {
  const children: Element[] = [];
  let at = 0;
  while (at < inner.length) {
    const next = inner.indexOf('<', at);
    if (next < 0) break;
    if (inner.startsWith('<!--', next)) {
      at = inner.indexOf('-->', next) + 3;
      continue;
    }
    const element = elementAt(inner, next);
    if (!element) {
      at = next + 1;
      continue;
    }
    children.push(element);
    at = next + element.outer.length;
  }
  return children;
}

const classesOf = (element: Element | undefined): string[] =>
  (element?.attributes.match(/\sclass="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean);
const attributeOf = (element: Element | undefined, name: string): string | undefined =>
  element?.attributes.match(new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s/>]|$)`))?.[1] ??
  (element && new RegExp(`\\s${name}(?=[\\s/>=]|$)`).test(element.attributes) ? '' : undefined);

function introOf(file: string): Element | null {
  const source = sourceFor(file);
  const main = source.slice(source.indexOf('<main'), source.indexOf('</main>'));
  const at = main.search(/<section class="page-intro[\s"]/);
  return at < 0 ? null : elementAt(main, at);
}

describe('the tour button place (R6-3)', () => {
  it('lists only internal pages as pending', () => {
    for (const file of PENDING) expect(internalPages, `${file} is pending`).toContain(file);
  });

  it.each(migrated)('%s opens main with one shared page intro', (file) => {
    const source = sourceFor(file);
    const main = source.slice(source.indexOf('<main'), source.indexOf('</main>'));
    expect(main.match(/<section class="page-intro[\s"]/g), `${file} page intros`).toHaveLength(1);
    const intro = introOf(file);
    expect(intro, `${file} page intro`).not.toBeNull();
    const children = childrenOf(intro?.inner ?? '');
    expect(
      children.map((child) => classesOf(child)[0]),
      `${file} page intro children`,
    ).toEqual(['page-intro-copy', 'page-intro-actions']);
    expect(children.map((child) => child.tag)).toEqual(['div', 'div']);
  });

  it.each(migrated)('%s keeps the eyebrow, the h1, and the lede in the copy', (file) => {
    const intro = introOf(file);
    const [copy] = childrenOf(intro?.inner ?? '');
    const parts = childrenOf(copy?.inner ?? '');
    const h1 = parts.findIndex((part) => part.tag === 'h1');
    expect(h1, `${file} h1 in the copy`).toBeGreaterThanOrEqual(0);
    // The eyebrow, when there is one, comes first and is the only thing above the h1.
    expect(h1, `${file} only the eyebrow sits above the h1`).toBeLessThanOrEqual(1);
    if (h1 === 1) expect(classesOf(parts[0])).toContain('eyebrow');
    const lede = parts[h1 + 1];
    expect(lede?.tag, `${file} lede`).toBe('p');
    expect(classesOf(lede)).toContain('intro-copy');
    // The intro names its h1, the page's only one.
    const id = attributeOf(parts[h1], 'id');
    expect(id, `${file} h1 id`).toBeTruthy();
    expect(attributeOf(intro ?? undefined, 'aria-labelledby')).toBe(id);
    const source = sourceFor(file);
    expect(source.match(/<h1\b/g), `${file} h1 count`).toHaveLength(1);
  });

  it.each(migrated)('%s puts one Take the tour in the actions', (file) => {
    const intro = introOf(file);
    const [, actions] = childrenOf(intro?.inner ?? '');
    const buttons = childrenOf(actions?.inner ?? '');
    const tour = buttons.filter((button) => classesOf(button).includes('page-tour'));
    expect(tour, `${file} Take the tour`).toHaveLength(1);
    const [button] = tour;
    expect(button?.tag).toBe('button');
    expect(attributeOf(button, 'type')).toBe('button');
    expect(classesOf(button)).toEqual(['secondary-action', 'page-tour']);
    expect(attributeOf(button, 'data-tour-open'), `${file} opens the page's own tour`).toBe('');
    // Shipped hidden: the tour engine shows it while the page's tour has a step to show.
    expect(attributeOf(button, 'hidden')).toBe('');
    expect(textOf(button?.inner ?? '')).toBe('Take the tour');
    expect(buttons, `${file} the actions hold only Take the tour`).toHaveLength(1);
  });

  it.each(migrated)('%s has no other Take the tour in main', (file) => {
    const source = sourceFor(file);
    const main = source.slice(source.indexOf('<main'), source.indexOf('</main>'));
    const intro = introOf(file)?.outer ?? '';
    const rest = main.replace(intro, '');
    expect(
      [...rest.matchAll(/<(?:button|a)\b[^>]*>([\s\S]*?)<\/(?:button|a)>/g)]
        .map((match) => textOf(match[1] ?? ''))
        .filter((text) => /^take the tour$/i.test(text)),
      `${file} Take the tour outside the intro`,
    ).toEqual([]);
  });

  // Page CSS must not move the intro's parts: the shared classes stay unstyled, and the page's own
  // intro class (home-intro, srch-intro, ...) sets no layout of its own.
  const LAYOUT =
    /^(?:display|grid(?:-[a-z-]+)?|flex(?:-[a-z-]+)?|justify-[a-z-]+|align-[a-z-]+|place-[a-z-]+|order|position|float|inset(?:-[a-z-]+)?|top|right|bottom|left)$/;

  it.each(migrated)('%s leaves the intro layout to the shared chrome', (file) => {
    const css = stylesIn(sourceFor(file));
    const ownClasses = classesOf(introOf(file) ?? undefined).filter(
      (name) => name !== 'page-intro',
    );
    const problems: string[] = [];
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = (rule[1] ?? '').split(',').map((part) => part.replace(/\s+/g, ' ').trim());
      const properties = (rule[2] ?? '')
        .split(';')
        .map((declaration) => declaration.split(':')[0]?.trim() ?? '')
        .filter(Boolean);
      for (const selector of selectors) {
        if (/\.(?:page-intro(?:-copy|-actions)?|page-tour)\b/.test(selector)) {
          problems.push(`${selector} restyles the shared intro`);
        }
        const own = ownClasses.some((name) =>
          new RegExp(`\\.${name}(?:\\s*>\\s*\\*)?$`).test(selector),
        );
        if (own) {
          for (const property of properties.filter((name) => LAYOUT.test(name))) {
            problems.push(`${selector} { ${property} } moves the intro`);
          }
        }
      }
    }
    expect(problems, `${file} intro styles`).toEqual([]);
  });
});

describe('the shared intro styles (R6-3)', () => {
  const chrome = readFileSync(resolve(brandDirectory, 'app-chrome.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');
  const componentsScript = readFileSync(resolve(brandDirectory, 'app-components.js'), 'utf8');

  it('puts the actions at the end of the title row from 721px', () => {
    expect(chrome).toContain(
      '.page-intro:has(> .page-intro-actions) { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; }',
    );
    expect(chrome).toContain('.page-intro-actions { display: flex;');
    expect(chrome).toMatch(/\.page-intro-actions \{[^}]*grid-column: 2; grid-row: 1;/);
    expect(chrome).toMatch(/\.page-intro-actions \{[^}]*justify-content: flex-end;/);
    // Top aligned with the h1: below the eyebrow's line (12px at 1.2) and its 13px margin.
    expect(chrome).toContain(
      '.page-intro:has(> .page-intro-copy > .eyebrow:first-child) > .page-intro-actions { padding-top: calc(12px * 1.2 + 13px); }',
    );
    expect(chrome).toMatch(
      /\.eyebrow \{[^}]*margin: 0 0 13px;[^}]*font-size: 12px;[^}]*line-height: 1\.2;/,
    );
  });

  it('puts them on their own row under the lede, at the start, at 720px and below', () => {
    // The shell's phone block (the last @media (max-width: 720px) in app-chrome.css) holds them.
    const at = chrome.lastIndexOf('@media (max-width: 720px) {');
    expect(at, 'the phone rules').toBeGreaterThan(-1);
    const phone = chrome.slice(at, chrome.indexOf('} }', at) + 3);
    expect(phone).toContain('.page-intro:has(> .page-intro-actions) { display: block; }');
    expect(phone).toContain(
      '.page-intro:has(> .page-intro-copy > .eyebrow:first-child) > .page-intro-actions { padding-top: 0; }',
    );
    expect(phone).toContain('.page-intro-actions { justify-content: flex-start; }');
    expect(phone).toContain('.page-intro-actions:has(> :not([hidden])) { margin: 21px 0 0; }');
  });

  // Round 7 (T2-12, the owner's "concise"): on phones, where the intro starts with an eyebrow, the
  // button sits compact at the end of the eyebrow's line instead of a row of its own; the h1 and
  // the lede keep the full width under it. An intro without an eyebrow keeps the row above.
  it('puts a compact button on the eyebrow line on phones when the intro has an eyebrow', () => {
    const at = chrome.indexOf(
      '@media screen and (max-width: 720px) { html:not([data-help-view="public"]) .page-intro:has(> .page-intro-copy > .eyebrow:first-child)',
    );
    expect(at, 'the phone eyebrow rules').toBeGreaterThan(-1);
    const phone = chrome.slice(at, chrome.indexOf('} }', at) + 3);
    const intro =
      'html:not([data-help-view="public"]) .page-intro:has(> .page-intro-copy > .eyebrow:first-child):has( > .page-intro-actions > .page-tour:not([data-tour-none]) )';
    expect(phone).toContain(
      `${intro} { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 13px; align-items: center; }`,
    );
    expect(phone).toContain(`${intro} > .page-intro-copy { display: contents; }`);
    expect(phone).toContain(`${intro} > .page-intro-copy > * { grid-column: 1 / -1; }`);
    expect(phone).toContain(
      `${intro} > .page-intro-actions { grid-column: 2; grid-row: 1; margin: 0; padding: 0; }`,
    );
    expect(phone).toContain('> .page-tour { min-height: 44px; padding: 0 13px; font-size: 13px; }');
  });

  it('takes no room for a hidden tour button', () => {
    expect(chrome).toContain('.page-intro-actions:not(:has(> :not([hidden]))) { display: none; }');
  });

  it('keeps the button’s room from the first paint while scripting is enabled (round 7, R10-1)', () => {
    // The button ships hidden and the tour engine shows it, which moved the page under the intro.
    // With scripting it is laid out but invisible until then, and lets its room go only for a
    // page the engine found no tour on (data-tour-none, set once the page has booted and loaded).
    const reserve = chrome.indexOf('@media (scripting: enabled) {');
    expect(reserve, 'the reserve rules').toBeGreaterThan(-1);
    const block = chrome.slice(reserve, chrome.indexOf('} }', reserve) + 3);
    expect(block).toContain(
      '.page-intro-actions > .page-tour[hidden]:not([data-tour-none]) { display: inline-flex !important; visibility: hidden; }',
    );
    expect(block).toContain(
      '.page-intro-actions:has(> .page-tour[hidden]:not([data-tour-none])) { display: flex; margin-inline-start: 34px; }',
    );
    const phone = chrome.indexOf('@media (scripting: enabled) and (max-width: 720px) {');
    expect(phone, 'the phone reserve').toBeGreaterThan(-1);
    expect(chrome.slice(phone, chrome.indexOf('} }', phone) + 3)).toContain(
      '.page-intro-actions:has(> .page-tour[hidden]:not([data-tour-none])) { margin: 21px 0 0; }',
    );
    expect(componentsScript).toContain("button.setAttribute('data-tour-none', '')");
  });
});
