import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Static guards for the UI-quality defect classes the rendered audit (scripts/ui-audit.mjs) also
// checks: reduced motion, live regions, personal data, sticky-header focus, panda speech, and story
// pacing. Each guard has a self-check on inline fixtures so it cannot silently stop detecting.

const repoRoot = resolve(import.meta.dirname, '../..');
const brandDirectory = join(repoRoot, 'brand');
const brandPages = readdirSync(brandDirectory)
  .filter((name) => name.endsWith('.html'))
  .sort();
const chromeFile = 'app-chrome.css';
const entryPages = ['login-preview.html', 'access-preview.html'];

function sourceFor(file: string): string {
  return readFileSync(join(brandDirectory, file), 'utf8');
}

function stylesIn(source: string): string {
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1] ?? '')
    .join('\n');
}

function linksChrome(source: string): boolean {
  return source.includes(`href="./${chromeFile}"`);
}

// ------------------------------------------------------------------ CSS model
interface Declaration {
  property: string;
  value: string;
  important: boolean;
}

interface StyleRule {
  selectors: string[];
  declarations: Declaration[];
  media: string[];
  position: number;
}

type Specificity = [number, number, number];

function closingIndex(text: string, open: number, opener: string, closer: string): number {
  let depth = 0;
  let quote = '';
  for (let index = open; index < text.length; index += 1) {
    const character = text[index] ?? '';
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === opener) depth += 1;
    else if (character === closer) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return text.length;
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? '';
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth -= 1;
    else if (character === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function parseDeclarations(body: string): Declaration[] {
  return splitTopLevel(body, ';').flatMap((item) => {
    const colon = item.indexOf(':');
    if (colon < 0) return [];
    const raw = item.slice(colon + 1).trim();
    const important = /!\s*important\s*$/i.test(raw);
    return [
      {
        property: item.slice(0, colon).trim().toLowerCase(),
        value: raw.replace(/!\s*important\s*$/i, '').trim(),
        important,
      },
    ];
  });
}

// Style rules in source order, with the chain of @media conditions around each one. @supports,
// @layer, and @container are transparent; @keyframes, @font-face, and other at-rules are skipped.
// `base` orders several style sheets in one cascade.
function parseStyleRules(css: string, base = 0): StyleRule[] {
  const rules: StyleRule[] = [];
  let position = base;
  const walk = (text: string, media: string[]): void => {
    let cursor = 0;
    let open = text.indexOf('{');
    while (open >= 0) {
      const prelude = (text.slice(cursor, open).split(';').pop() ?? '').trim();
      const close = closingIndex(text, open, '{', '}');
      const body = text.slice(open + 1, close);
      cursor = close + 1;
      if (/^@media\b/i.test(prelude)) walk(body, [...media, prelude.slice(6).trim()]);
      else if (/^@(supports|layer|container)\b/i.test(prelude)) walk(body, media);
      else if (!prelude.startsWith('@')) {
        position += 1;
        rules.push({
          selectors: splitTopLevel(prelude, ','),
          declarations: parseDeclarations(body),
          media,
          position,
        });
      }
      open = text.indexOf('{', cursor);
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), []);
  return rules;
}

// Compounds and the combinators between them, for example `.a > .b .c`.
function parseSelector(selector: string): { compounds: string[]; combinators: string[] } {
  const compounds: string[] = [];
  const combinators: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  let combinator = '';
  for (const character of selector.trim()) {
    if (quote) {
      current += character;
      if (character === quote) quote = '';
      continue;
    }
    if (depth === 0 && /[\s>+~]/.test(character)) {
      if (current) {
        compounds.push(current);
        current = '';
        combinator = ' ';
      }
      if (!/\s/.test(character)) combinator = character;
      continue;
    }
    if (!current && compounds.length) {
      combinators.push(combinator || ' ');
      combinator = '';
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth -= 1;
    current += character;
  }
  if (current) compounds.push(current);
  return { compounds, combinators };
}

function normalizeAttribute(part: string): string {
  const match = part.match(/^\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(["']?)(.*?)\3\s*([is])?\s*)?\]$/);
  if (!match) return part;
  return match[2] ? `[${match[1]}${match[2]}"${match[4]}"]` : `[${match[1]}]`;
}

// Simple selectors in one compound: a type or `*`, then #id, .class, [attr], :pseudo(), ::pseudo.
// Legacy single-colon pseudo-elements are normalized to the double-colon form.
function simpleSelectors(compound: string): string[] {
  const parts: string[] = [];
  const nameEnd = (start: number): number => {
    let end = start;
    const name = (character: string): boolean =>
      /[\w\\-]/.test(character) || character.charCodeAt(0) > 127;
    while (end < compound.length && name(compound[end] ?? '')) end += 1;
    return end;
  };
  let index = 0;
  while (index < compound.length) {
    const character = compound[index] ?? '';
    const start = index;
    if (character === '[') {
      index = closingIndex(compound, index, '[', ']') + 1;
      parts.push(normalizeAttribute(compound.slice(start, index)));
    } else if (character === ':') {
      index = nameEnd(index + (compound[index + 1] === ':' ? 2 : 1));
      if (compound[index] === '(') index = closingIndex(compound, index, '(', ')') + 1;
      const part = compound.slice(start, index);
      parts.push(/^:(before|after|first-line|first-letter)$/i.test(part) ? `:${part}` : part);
    } else if (character === '.' || character === '#') {
      index = nameEnd(index + 1);
      parts.push(compound.slice(start, index));
    } else {
      index = Math.max(nameEnd(index), index + 1);
      parts.push(compound.slice(start, index).toLowerCase());
    }
  }
  return parts;
}

function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function specificity(selector: string): Specificity {
  const total: Specificity = [0, 0, 0];
  for (const compound of parseSelector(selector).compounds) {
    for (const part of simpleSelectors(compound)) {
      if (part.startsWith('#')) total[0] += 1;
      else if (part.startsWith('.') || part.startsWith('[')) total[1] += 1;
      else if (part.startsWith('::')) total[2] += 1;
      else if (part.startsWith(':')) {
        const name = (part.slice(1).split('(')[0] ?? '').toLowerCase();
        if (name === 'where') continue;
        if (['is', 'not', 'has', 'matches'].includes(name)) {
          const inner = part.slice(part.indexOf('(') + 1, -1);
          const best =
            splitTopLevel(inner, ',').map(specificity).sort(compareSpecificity).at(-1) ??
            ([0, 0, 0] as Specificity);
          total[0] += best[0];
          total[1] += best[1];
          total[2] += best[2];
        } else total[1] += 1;
      } else if (part !== '*') total[2] += 1;
    }
  }
  return total;
}

function attributeName(part: string): string {
  return part.match(/^\[([\w-]+)/)?.[1] ?? '';
}

// `general` matches every element that `specific` matches when it is the same selector, or drops
// ancestor compounds, `*`, or an attribute value ([attr] for [attr="value"]). Child and sibling
// combinators are never generalized. Pseudo-elements must be identical.
function covers(general: string, specific: string): boolean {
  const g = parseSelector(general);
  const s = parseSelector(specific);
  const gParts = g.compounds.map(simpleSelectors);
  const sParts = s.compounds.map(simpleSelectors);
  if (
    JSON.stringify(gParts) === JSON.stringify(sParts) &&
    g.combinators.join() === s.combinators.join()
  )
    return true;
  if ([...g.combinators, ...s.combinators].some((combinator) => combinator !== ' ')) return false;
  const pseudo = (parts: string[] | undefined): string =>
    (parts ?? []).filter((part) => part.startsWith('::')).join('');
  if (pseudo(gParts.at(-1)) !== pseudo(sParts.at(-1))) return false;
  const compoundCovers = (wide: string[] | undefined, narrow: string[] | undefined): boolean =>
    (wide ?? []).every(
      (part) =>
        part === '*' ||
        part.startsWith('::') ||
        (narrow ?? []).includes(part) ||
        (part.startsWith('[') &&
          !part.includes('=') &&
          (narrow ?? []).some((other) => attributeName(other) === attributeName(part))),
    );
  if (!compoundCovers(gParts.at(-1), sParts.at(-1))) return false;
  let candidate = sParts.length - 2;
  for (let index = gParts.length - 2; index >= 0; index -= 1) {
    while (candidate >= 0 && !compoundCovers(gParts[index], sParts[candidate])) candidate -= 1;
    if (candidate < 0) return false;
    candidate -= 1;
  }
  return true;
}

// ------------------------------------------------------------------ reduced-motion rule
// A looping rule is any style rule outside a `prefers-reduced-motion: no-preference` block whose
// `animation` or `animation-iteration-count` includes `infinite`. Each of its selectors must lose
// the cascade to a neutralizing declaration from a block whose media query is reduced motion only
// (no width or other condition, which would leave some viewports looping): `animation: none` or
// another `animation` shorthand without `infinite`, `animation-name: none`, or a finite
// `animation-iteration-count`.
// - A universal reset (`*`, with `*::before` and `*::after` for pseudo-element loops) counts only
//   with !important: `*` has zero specificity, so without !important any class shorthand beats it.
// - An explicit override must name the looping selector or a generalization of it (see covers())
//   and win by importance, by specificity, or by equal specificity and a later position.
//   app-chrome.css precedes a page's own <style>.
// - A looping inline style attribute can only be neutralized by an !important universal reset.
// Class co-occurrence in markup is not inferred: `.capability-prop { animation: none }` does not
// cover `.watch-rig`, even if every .watch-rig also has .capability-prop.
const REDUCE_QUERY =
  /^(?:only\s+)?(?:(?:all|screen)\s+and\s+)?\(\s*prefers-reduced-motion\s*(?::\s*reduce\s*)?\)$/i;
const loops = (declaration: Declaration): boolean =>
  ['animation', 'animation-iteration-count'].includes(declaration.property) &&
  /\binfinite\b/i.test(declaration.value);

function neutralizes(declaration: Declaration): boolean {
  const value = declaration.value.toLowerCase();
  if (value.includes('var(')) return false;
  if (declaration.property === 'animation')
    return !/\binfinite\b/.test(value) && !['inherit', 'revert', 'revert-layer'].includes(value);
  if (declaration.property === 'animation-name')
    return ['none', 'initial', 'unset'].includes(value);
  if (declaration.property === 'animation-iteration-count')
    return value.split(',').every((count) => /^\d+(?:\.\d+)?$/.test(count.trim()));
  return false;
}

function hasReducedMotionBlock(css: string): boolean {
  return /@media[^{]*prefers-reduced-motion\s*:\s*reduce/i.test(
    css.replace(/\/\*[\s\S]*?\*\//g, ''),
  );
}

function unneutralizedLoops(sheets: string[], html = ''): string[] {
  const rules = sheets.flatMap((css, index) => parseStyleRules(css, index * 1_000_000));
  const overrides = rules
    .filter(
      (rule) => rule.media.length > 0 && rule.media.every((query) => REDUCE_QUERY.test(query)),
    )
    .flatMap((rule) =>
      rule.declarations.filter(neutralizes).flatMap((declaration) =>
        rule.selectors.map((selector) => ({
          selector,
          important: declaration.important,
          specificity: specificity(selector),
          position: rule.position,
        })),
      ),
    );
  const problems = new Set<string>();
  for (const rule of rules) {
    if (rule.media.some((query) => /prefers-reduced-motion\s*:\s*no-preference/i.test(query)))
      continue;
    for (const declaration of rule.declarations.filter(loops)) {
      for (const selector of rule.selectors) {
        const own = specificity(selector);
        const neutralized = overrides.some((override) => {
          if (!covers(override.selector, selector)) return false;
          if (override.important !== declaration.important) return override.important;
          const order = compareSpecificity(override.specificity, own);
          return order > 0 || (order === 0 && override.position > rule.position);
        });
        if (!neutralized)
          problems.add(`${selector} { ${declaration.property}: ${declaration.value} }`);
      }
    }
  }
  const universal = overrides.some((override) => override.important && override.selector === '*');
  for (const match of html.matchAll(/\sstyle=(["'])(.*?)\1/gi)) {
    if (/animation[^;]*\binfinite\b/i.test(match[2] ?? '') && !universal)
      problems.add(`inline style="${match[2]}"`);
  }
  return [...problems];
}

function cascadeFor(file: string): string[] {
  if (file === chromeFile) return [sourceFor(chromeFile)];
  const source = sourceFor(file);
  return linksChrome(source) ? [sourceFor(chromeFile), stylesIn(source)] : [stylesIn(source)];
}

describe('reduced motion', () => {
  // Internal pages may rely on the block in the app-chrome.css they link, which precedes their
  // own <style>; app-chrome.css itself must carry one.
  it.each([...brandPages, chromeFile])('%s has a prefers-reduced-motion: reduce block', (file) => {
    expect(
      cascadeFor(file).some(hasReducedMotionBlock),
      `${file} needs @media (prefers-reduced-motion: reduce) in its styles or linked ${chromeFile}`,
    ).toBe(true);
  });

  it.each([...brandPages, chromeFile])('%s neutralizes every infinite animation', (file) => {
    const html = file === chromeFile ? '' : sourceFor(file);
    expect(
      unneutralizedLoops(cascadeFor(file), html),
      `${file} keeps looping under reduce`,
    ).toEqual([]);
  });
});

// ------------------------------------------------------------------ live regions
// docs/ui-foundation.md line 279: "Visible feedback MUST NOT also carry a live-region role by
// default." Announcements belong in visually hidden StatusAnnouncement channels (.sr-only). A
// visible element may keep a live role only as a documented semantic exception (UI SOP step 4).
// Each entry names the file, the element id, and the documented reason. None is documented yet.
const LIVE_REGION_ALLOWLIST: ReadonlyArray<{ file: string; id: string; reason: string }> = [];

const LIVE_ROLES = new Set(['status', 'alert', 'log']);

function visibleLiveRegions(file: string, source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    const attributes = match[2] ?? '';
    const attribute = (name: string): string | undefined =>
      attributes.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];
    const roles = (attribute('role') ?? '').toLowerCase().split(/\s+/);
    const live = attribute('aria-live');
    const isLive =
      roles.some((role) => LIVE_ROLES.has(role)) || (live !== undefined && live !== 'off');
    if (!isLive) continue;
    if ((attribute('class') ?? '').split(/\s+/).includes('sr-only')) continue;
    const id = attribute('id') ?? '';
    if (LIVE_REGION_ALLOWLIST.some((entry) => entry.file === file && entry.id === id)) continue;
    const line = source.slice(0, match.index).split('\n').length;
    found.push(
      `${file}:${line} <${match[1]}${id ? `#${id}` : ''}> ${attributes.replace(/\s+/g, ' ').trim()}`,
    );
  }
  return found;
}

describe('live regions', () => {
  it.each(brandPages)('%s keeps live roles off visible elements', (file) => {
    expect(visibleLiveRegions(file, sourceFor(file))).toEqual([]);
  });

  it.each(brandPages)('%s does not add live roles from script', (file) => {
    const scripts = [...sourceFor(file).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1] ?? '')
      .join('\n');
    const dynamic = [
      ...scripts.matchAll(
        /setAttribute\(\s*['"](?:role|aria-live)['"]\s*,\s*['"](?:status|alert|log|polite|assertive)['"]/g,
      ),
      ...scripts.matchAll(
        /\.(?:role|ariaLive)\s*=\s*['"](?:status|alert|log|polite|assertive)['"]/g,
      ),
    ].map((match) => match[0]);
    expect(dynamic, `${file} must not create a live region at runtime`).toEqual([]);
  });

  // Shared scripts that render markup (the Feedback drawer, the Prompt drawer, and Get more runs)
  // follow the same rule as the pages: live roles only on visually hidden channels, and none added
  // at runtime.
  it.each(['feedback.js', 'app-panels.js'])(
    '%s renders live roles only on visually hidden channels',
    (file) => {
      const script = sourceFor(file);
      expect(visibleLiveRegions(file, script)).toEqual([]);
      expect(script).toMatch(
        /<p class="sr-only" id="[\w-]+" role="status" aria-live="polite"><\/p>/,
      );
      expect(script).not.toMatch(
        /setAttribute\(\s*['"](?:role|aria-live)['"]|\.(?:role|ariaLive)\s*=\s*['"]/,
      );
    },
  );

  it('documents every allowlisted live region', () => {
    for (const entry of LIVE_REGION_ALLOWLIST) {
      expect(entry.reason.length, `${entry.file}#${entry.id} needs a reason`).toBeGreaterThan(20);
      expect(sourceFor(entry.file)).toContain(`id="${entry.id}"`);
    }
  });
});

// ------------------------------------------------------------------ personal data
// Every email address in brand/, docs/, and tests/ must use the reserved example.com, example.org,
// or example.net domains (RFC 2606). Documented service addresses would be exempt, but none exists:
// CONTRIBUTING.md, SECURITY.md, README.md, AGENTS.md, CLAUDE.md, and .github/ publish no contact
// address, so the exemption list is empty.
const SERVICE_ADDRESS_EXEMPTIONS: readonly string[] = [];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const RESERVED_DOMAIN = /(?:^|\.)example\.(?:com|org|net)$/i;
// Retina asset names such as logo@2x.png look like addresses.
const FILE_SUFFIX = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|m?js|ts|json|html?|md)$/i;
const PERSONAL_DOMAIN =
  /@(?:gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|rocketmail|icloud|me|mac|aol|proton|protonmail|pm|gmx|yandex|zoho|fastmail|hey|tutanota|qq|163|126|rediffmail|mail)\.[a-z]{2,}(?:\.[a-z]{2,})?\b/gi;
const TEXT_FILE = new Set([
  '.html',
  '.css',
  '.md',
  '.ts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.svg',
  '.txt',
  '.yml',
  '.yaml',
]);
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'build', 'dist', 'coverage', 'cdk.out']);

function textFilesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : textFilesUnder(path);
    return entry.isFile() && TEXT_FILE.has(extname(entry.name).toLowerCase()) ? [path] : [];
  });
}

function nonReservedAddresses(text: string): string[] {
  return [...text.matchAll(EMAIL)]
    .map((match) => match[0])
    .filter((address) => {
      const domain = address.slice(address.indexOf('@') + 1);
      return (
        !FILE_SUFFIX.test(domain) &&
        !RESERVED_DOMAIN.test(domain) &&
        !SERVICE_ADDRESS_EXEMPTIONS.includes(address.toLowerCase())
      );
    });
}

function personalDomains(text: string): string[] {
  return [...text.matchAll(PERSONAL_DOMAIN)]
    .map((match) => match[0])
    .filter((domain) => !RESERVED_DOMAIN.test(domain.slice(1)));
}

const scannedFiles = ['brand', 'docs', 'tests'].flatMap((directory) =>
  textFilesUnder(join(repoRoot, directory)),
);
const rootDocuments = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'AGENTS.md', 'CLAUDE.md']
  .map((name) => join(repoRoot, name))
  .filter((path) => existsSync(path))
  .concat(textFilesUnder(join(repoRoot, '.github')));

describe('personal data guard', () => {
  it('uses only example.com, example.org, or example.net addresses in brand/, docs/, and tests/', () => {
    const found = scannedFiles.flatMap((path) =>
      nonReservedAddresses(readFileSync(path, 'utf8')).map(
        (address) => `${relative(repoRoot, path)}: ${address}`,
      ),
    );
    expect(found).toEqual([]);
  });

  it('mentions no personal email provider domain', () => {
    const found = [...scannedFiles, ...rootDocuments].flatMap((path) =>
      personalDomains(readFileSync(path, 'utf8')).map(
        (domain) => `${relative(repoRoot, path)}: ${domain}`,
      ),
    );
    expect(found).toEqual([]);
  });
});

// ------------------------------------------------------------------ sticky header
// A sticky or fixed header hides the top of the scrollport, so keyboard focus can land beneath it
// (WCAG 2.4.11). The document must reserve that space with scroll-padding-top on html (the canonical
// :root block is locked, so it cannot carry the declaration).
const STICKY_HEADER_FILES = [chromeFile, ...entryPages];

function stickyHeaders(css: string): string[] {
  return parseStyleRules(css).flatMap((rule) =>
    rule.declarations.some(
      (declaration) =>
        declaration.property === 'position' && /^(?:sticky|fixed)$/i.test(declaration.value),
    )
      ? rule.selectors.filter((selector) => {
          const last = parseSelector(selector).compounds.at(-1) ?? '';
          return /(?:^header|[.#][\w-]*header)(?![\w-])/.test(last);
        })
      : [],
  );
}

function scrollPaddingTop(css: string): string[] {
  return parseStyleRules(css)
    .filter(
      (rule) =>
        rule.media.length === 0 &&
        rule.selectors.some((selector) => ['html', ':root'].includes(selector)),
    )
    .flatMap((rule) =>
      rule.declarations
        .filter((declaration) =>
          [
            'scroll-padding-top',
            'scroll-padding',
            'scroll-padding-block',
            'scroll-padding-block-start',
          ].includes(declaration.property),
        )
        .map((declaration) => declaration.value.split(/\s+/)[0] ?? ''),
    );
}

function scrollPaddingProblem(css: string): string {
  const values = scrollPaddingTop(css);
  if (!values.length) return 'no scroll-padding-top on html';
  const usable = values.some((value) => {
    if (/^(?:0|0px|auto|initial|unset|inherit)$/i.test(value)) return false;
    const pixels = value.match(/^(\d+(?:\.\d+)?)px$/i);
    return !pixels || Number(pixels[1]) >= 64;
  });
  return usable ? '' : `scroll-padding-top ${values.join(', ')} is smaller than the 64px header`;
}

function ownCss(file: string): string {
  return file === chromeFile ? sourceFor(file) : stylesIn(sourceFor(file));
}

describe('sticky header focus space', () => {
  it.each(STICKY_HEADER_FILES)('%s declares a sticky or fixed header', (file) => {
    expect(stickyHeaders(ownCss(file)).length, `${file} header detection`).toBeGreaterThan(0);
  });

  const withStickyHeader = [
    ...new Set([
      ...STICKY_HEADER_FILES,
      ...brandPages.filter((file) => stickyHeaders(ownCss(file)).length),
    ]),
  ];
  it.each(withStickyHeader)('%s reserves scroll-padding-top for its sticky header', (file) => {
    expect(scrollPaddingProblem(cascadeFor(file).join('\n'))).toBe('');
  });

  // On phones the header and the app bar stay at the top together (findings 1 and 32), so the
  // scroll padding there must clear both: the header's height plus the bar's 5px + 44px + 5px and
  // its 1px rule. The bar sticks exactly at the header's bottom.
  it('reserves phone scroll padding for the header and the app bar together', () => {
    const phone = parseStyleRules(sourceFor(chromeFile)).filter((rule) =>
      rule.media.some((query) => /max-width:\s*720px/.test(query)),
    );
    const value = (selector: string, property: string): string =>
      phone
        .filter((rule) => rule.selectors.includes(selector))
        .flatMap((rule) => rule.declarations.filter((item) => item.property === property))
        .map((item) => item.value)
        .pop() ?? '';
    const header = Number.parseFloat(value('.app-header', 'min-height'));
    const bar = phone.find((rule) => rule.selectors.includes('.app-sidebar[data-menu]'));
    const top = bar?.declarations.find((item) => item.property === 'top')?.value;
    expect(bar?.declarations.find((item) => item.property === 'position')?.value).toBe('sticky');
    expect(Number.parseFloat(top ?? '')).toBe(header);
    const padding = phone
      .filter((rule) => rule.selectors.some((selector) => /^html:has\(/.test(selector)))
      .flatMap((rule) => rule.declarations.filter((item) => item.property === 'scroll-padding-top'))
      .map((item) => Number.parseFloat(item.value));
    expect(padding).toHaveLength(1);
    expect(padding[0]).toBeGreaterThanOrEqual(header + 5 + 44 + 5 + 1);
  });
});

// ------------------------------------------------------------------ panda speech and pacing
function literalAfter(source: string, declaration: string): string | null {
  const start = source.indexOf(declaration);
  if (start < 0) return null;
  const open = source.slice(start + declaration.length).search(/[[{]/);
  if (open < 0) return null;
  const index = start + declaration.length + open;
  const opener = source[index] ?? '[';
  const closer = opener === '[' ? ']' : '}';
  let depth = 0;
  let quote = '';
  for (let cursor = index; cursor < source.length; cursor += 1) {
    const character = source[cursor] ?? '';
    if (quote) {
      if (character === '\\') cursor += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') quote = character;
    else if (character === opener) depth += 1;
    else if (character === closer) {
      depth -= 1;
      if (depth === 0) return source.slice(index, cursor + 1);
    }
  }
  return null;
}

interface Chapter {
  scene?: string;
  title?: string;
  body?: string;
  speech?: string;
  duration?: number;
}

// Evaluates the stories literal; `pandaLines` is provided when the page declares it so chapters may
// reference shared speech lines.
function storiesOf(source: string): Chapter[] {
  const stories = literalAfter(source, 'const stories =');
  if (!stories) throw new Error('const stories = [...] not found');
  const lines = literalAfter(source, 'const pandaLines =');
  const context = { pandaLines: lines ? new Script(`(${lines})`).runInNewContext({}) : undefined };
  return new Script(`(${stories})`).runInNewContext(context) as Chapter[];
}

function words(text: string): number {
  return text.split(/[\s–—]+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

// Reading time: 1s to settle plus 240ms per word of the title, body, and speech, never under 3.4s,
// with 100ms of tolerance.
function minimumDuration(chapter: Chapter): number {
  const count = words(`${chapter.title ?? ''} ${chapter.body ?? ''} ${chapter.speech ?? ''}`);
  return Math.max(3400, 1000 + 240 * count) - 100;
}

const entrySources = entryPages.map((file) => [file, sourceFor(file)] as const);
const sharedLines = entrySources.map(([, source]) => literalAfter(source, 'const pandaLines ='));

describe('panda speech copy', () => {
  it.skipIf(sharedLines.every((literal) => literal === null))(
    'declares byte-identical pandaLines on sign-in and account access',
    () => {
      const [login, access] = sharedLines;
      expect(login, 'login-preview.html declares const pandaLines').not.toBeNull();
      expect(access, 'access-preview.html declares const pandaLines').not.toBeNull();
      expect(access).toBe(login);
    },
  );

  it.each(entryPages)('%s keeps every story speech line to six words or fewer', (file) => {
    const long = storiesOf(sourceFor(file))
      .filter((chapter) => words(chapter.speech ?? '') > 6)
      .map(
        (chapter) => `${chapter.scene}: «${chapter.speech}» (${words(chapter.speech ?? '')} words)`,
      );
    expect(long).toEqual([]);
  });
});

describe('story pacing', () => {
  it.each(entryPages)('%s gives every chapter enough time to read', (file) => {
    const rushed = storiesOf(sourceFor(file))
      .filter((chapter) => (chapter.duration ?? 0) < minimumDuration(chapter))
      .map((chapter) => `${chapter.scene}: ${chapter.duration}ms < ${minimumDuration(chapter)}ms`);
    expect(rushed).toEqual([]);
  });
});

// ------------------------------------------------------------------ guard self-checks
describe('guard self-checks', () => {
  const reduce = (body: string): string => `@media (prefers-reduced-motion: reduce) { ${body} }`;
  const loop = '.field-one { animation: drift 13s ease-in-out infinite; }';

  it('reduced motion: a zero-specificity reset without !important loses to a class loop', () => {
    const css = `${loop} ${reduce('*, *::before, *::after { animation-duration: 0.01ms; animation-iteration-count: 1; }')}`;
    expect(unneutralizedLoops([css])).toEqual([
      '.field-one { animation: drift 13s ease-in-out infinite }',
    ]);
  });

  it('reduced motion: an !important universal reset neutralizes element and pseudo-element loops', () => {
    const css = `${loop} .stage::before { animation: orbit 13s infinite; } ${reduce('*, *::before, *::after { animation-iteration-count: 1 !important; }')}`;
    expect(unneutralizedLoops([css])).toEqual([]);
  });

  it('reduced motion: a universal reset without *::before misses a pseudo-element loop', () => {
    const css = `.stage::before { animation: orbit 13s infinite; } ${reduce('* { animation: none !important; }')}`;
    expect(unneutralizedLoops([css])).toHaveLength(1);
  });

  it('reduced motion: explicit overrides must name the selector and win the cascade', () => {
    const watch = '.page[data-scene="watch"] .bamboo { animation: radar 2.4s infinite; }';
    expect(
      unneutralizedLoops([`${watch} ${reduce('.page[data-scene] .bamboo { animation: none; }')}`]),
    ).toEqual([]);
    expect(unneutralizedLoops([`${watch} ${reduce('.bamboo { animation: none; }')}`])).toHaveLength(
      1,
    );
    expect(
      unneutralizedLoops([`${reduce('.field-one { animation: none; }')} ${loop}`]),
    ).toHaveLength(1);
    expect(
      unneutralizedLoops([`${loop} ${reduce('.capability-prop { animation: none; }')}`]),
    ).toHaveLength(1);
  });

  it('reduced motion: width-limited overrides do not count; no-preference loops are ignored', () => {
    const narrow =
      '@media (prefers-reduced-motion: reduce) and (max-width: 720px) { .field-one { animation: none; } }';
    expect(unneutralizedLoops([`${loop} ${narrow}`])).toHaveLength(1);
    const gated = `@media (prefers-reduced-motion: no-preference) { ${loop} }`;
    expect(unneutralizedLoops([gated])).toEqual([]);
    expect(hasReducedMotionBlock(gated)).toBe(false);
    expect(hasReducedMotionBlock(reduce('a { color: red; }'))).toBe(true);
  });

  it('reduced motion: shared chrome comes first in the cascade', () => {
    const chrome = `.spinner { animation: spin 1s infinite; }`;
    expect(unneutralizedLoops([chrome, reduce('.spinner { animation: none; }')])).toEqual([]);
    expect(unneutralizedLoops([reduce('.spinner { animation: none; }'), chrome])).toHaveLength(1);
  });

  it('specificity follows :where, :is, and :not', () => {
    expect(specificity('.a:where(.b)[data-x="1"] .c::before')).toEqual([0, 3, 1]);
    expect(specificity(':is(#a, .b) > span:not(.c)')).toEqual([1, 1, 1]);
  });

  it('live regions: flags visible live roles but not .sr-only channels', () => {
    const page = [
      '<span class="caps-lock-note" id="caps" role="status" aria-live="polite">Caps Lock is on.</span>',
      '<p class="sr-only" id="announce" role="status" aria-live="polite"></p>',
      '<div aria-live="off">Static</div>',
    ].join('\n');
    expect(visibleLiveRegions('fixture.html', page)).toEqual([
      'fixture.html:1 <span#caps> class="caps-lock-note" id="caps" role="status" aria-live="polite"',
    ]);
  });

  it('personal data: allows reserved domains and flags personal providers', () => {
    const personal = ['ada.lovelace', 'gmail.com'].join('@');
    const text = `Use ada@example.org, ops@mail.example.net, logo@2x.png, and ${personal}.`;
    expect(nonReservedAddresses(text)).toEqual([personal]);
    expect(personalDomains(text)).toEqual([`@${personal.split('@')[1]}`]);
  });

  it('sticky header: requires scroll-padding-top of at least the header height on html', () => {
    const header = '.site-header { position: sticky; top: 0; }';
    expect(stickyHeaders(header)).toEqual(['.site-header']);
    expect(stickyHeaders('.section-nav { position: sticky; top: 93px; }')).toEqual([]);
    expect(scrollPaddingProblem(header)).toBe('no scroll-padding-top on html');
    expect(scrollPaddingProblem(`${header} html { scroll-padding-top: 40px; }`)).not.toBe('');
    expect(scrollPaddingProblem(`${header} html { scroll-padding-top: 88px; }`)).toBe('');
    expect(scrollPaddingProblem(`${header} body { scroll-padding-top: 88px; }`)).not.toBe('');
  });

  it('speech and pacing: counts words and derives the minimum chapter time', () => {
    expect(words('It’s me—your panda deputy.')).toBe(5);
    expect(words('Nope. Nope. Promising.')).toBe(3);
    const chapter = {
      title: 'Who’s your deputy?',
      body: 'Someone dependable must be around here.',
      speech: 'Hmm…',
    };
    expect(minimumDuration(chapter)).toBe(3300);
    expect(
      minimumDuration({ title: 'a b c d e f g h i j', body: 'k l m n o p', speech: 'q r' }),
    ).toBe(5220);
    const page = `const pandaLines = { hi: 'Hi there.' };\nconst stories = [{ scene: 'who', speech: pandaLines.hi, duration: 3400 }];`;
    expect(storiesOf(page)).toEqual([{ scene: 'who', speech: 'Hi there.', duration: 3400 }]);
  });
});
