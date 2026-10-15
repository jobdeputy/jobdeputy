import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Static guards for the shared app components (brand/app-components.css and app-components.js) and
// their gallery (brand/components-preview.html). The rendered checks (contrast, 44px targets,
// overflow from 320 to 1440) run in scripts/ui-audit.mjs and the gallery's CDP probe. Each guard
// has a self-check on an inline fixture so it cannot silently stop detecting. The script's
// behaviour (flow counts, charts, thumbs, quick picks, and the grow motion) runs in a node:vm
// sandbox against the small fake DOM below.

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');

const componentsFile = 'app-components.css';
const chromeFile = 'app-chrome.css';
const scriptFile = 'app-components.js';
const galleryFile = 'components-preview.html';
const components = sourceFor(componentsFile);
const chrome = sourceFor(chromeFile);
const script = sourceFor(scriptFile);
const gallery = sourceFor(galleryFile);

// The canonical :root tokens (docs/design-system.md, Component contract), and the custom
// properties a component reads from its own markup.
const TOKENS = [
  '--ink',
  '--ink-soft',
  '--muted',
  '--quiet',
  '--paper',
  '--paper-deep',
  '--surface',
  '--surface-strong',
  '--header-surface',
  '--line',
  '--line-soft',
  '--line-strong',
  '--green',
  '--green-soft',
  '--green-wash',
  '--green-line',
  '--green-ink',
  '--orange',
  '--orange-soft',
  '--danger-ink',
  '--blue',
  '--blue-soft',
  '--on-ink-muted',
  '--shadow',
  '--shadow-control',
  '--ease-settle',
  '--ease-spring',
  '--font-display',
  '--font-text',
];
// --hbar sizes a horizontal bar's fill and --share a stacked-bar segment, both from 0 to 1;
// --count sizes an allowance meter's part (runs), and --tooltip-arrow places the tooltip's caret;
// --bars is how many bars a usage chart lays out (round 5).
const COMPONENT_PROPERTIES = [
  '--value',
  '--steps',
  '--max',
  '--hbar',
  '--share',
  '--count',
  '--tooltip-arrow',
  '--bars',
  // Round 6: the donut's Other segment reads its hatch pattern's address.
  '--hatch',
  // Round 6 part 2 (N1): where the score trend places each point and the minimum.
  '--x',
  '--y',
  // Round 7 (R10-1): a held region's final height (the page sets it), and the skeleton's own knobs.
  // (The prompt summary's Open column went with T1-11: the name's link is the one way to open it.)
  '--skeleton-min',
  '--skeleton-shapes',
  '--skeleton-rows',
];
// The custom properties the skeleton declares itself (round 7): its placeholder shapes per kind, and
// the JS block's row count.
const SKELETON_PROPERTIES = ['--skeleton-shapes', '--skeleton-rows'];

// Every component in the briefs, with the parts page builders copy.
const DOCUMENTED_CLASSES = [
  'stat-row',
  'stat',
  'stat-figure',
  'stat-label',
  'stat-meta',
  'meter',
  'meter-group',
  'meter-label',
  'meter-value',
  'ring',
  'ring-art',
  'ring-edge',
  'ring-track',
  'ring-arc',
  'ring-figure',
  'ring-label',
  'stage-track',
  'stage',
  'stage-count',
  'stage-name',
  'checklist',
  'checklist-header',
  'checklist-count',
  'checklist-item',
  'checklist-status',
  'checklist-title',
  'checklist-meta',
  'checklist-state',
  'checklist-action',
  'data-table-wrap',
  'data-table',
  'data-table-sort',
  'data-table-select',
  'data-table-check',
  'data-table-title',
  'data-table-meta',
  'board',
  'board-column',
  'board-column-title',
  'board-count',
  'board-list',
  'board-card',
  'board-card-link',
  'board-card-title',
  'board-card-company',
  'board-card-meta',
  'board-card-tags',
  'board-card-footer',
  'board-card-next',
  'board-card-move',
  'board-empty',
  'drawer',
  'drawer-header',
  'drawer-title',
  'drawer-close',
  'drawer-body',
  'drawer-section',
  'drawer-footer',
  'segmented',
  'segmented-option',
  'segmented-label',
  'tabs',
  'tab-panel',
  'timeline',
  'timeline-item',
  'timeline-time',
  'timeline-state',
  'timeline-title',
  'timeline-detail',
  'empty-state',
  'empty-state-art',
  'empty-state-icon',
  'empty-state-title',
  'empty-state-copy',
  'empty-state-actions',
  'upload-zone',
  'upload-zone-title',
  'upload-zone-meta',
  'upload-list',
  'upload-item',
  'choice-cards',
  'choice-card',
  'choice-card-control',
  'choice-card-label',
  'choice-card-meta',
  'choice-card-icon',
  'choice-card-current',
  'toolbar',
  'toolbar-field',
  'toolbar-actions',
  'sample-note',
  'company-mark',
  'step-progress',
  'step-progress-label',
  'step-progress-bar',
  'step-progress-step',
  'bar-chart',
  'bar-chart-legend',
  'bar-chart-key',
  'bar-chart-plot',
  'bar-chart-bar',
  'bar-chart-data',
  // Round 2 (orchestration brief 3.5 to 3.7).
  'flow-ribbon',
  'flow-ribbon-list',
  'flow-ribbon-step',
  'flow-ribbon-icon',
  'flow-ribbon-label',
  'flow-ribbon-count',
  'kpi-grid',
  'kpi',
  'kpi-label',
  'kpi-value',
  'kpi-unit',
  'kpi-visual',
  'kpi-meta',
  'kpi-trend',
  'sparkline',
  'sparkline-art',
  'sparkline-line',
  'sparkline-dot',
  'chart',
  'chart-title',
  'chart-action',
  'chart-empty',
  'chart-empty-art',
  'chart-empty-copy',
  'hbar',
  'hbar-row',
  'hbar-label',
  'hbar-value',
  'hbar-track',
  'hbar-fill',
  'stack-bar',
  'stack-bar-seg',
  'chart-legend',
  'chart-legend-item',
  'chart-legend-label',
  'chart-legend-value',
  'donut',
  'donut-ring',
  'donut-art',
  'donut-total',
  'donut-total-value',
  'donut-total-label',
  'donut-seg',
  'donut-track',
  'donut-link',
  'donut-sweep',
  'thumbs',
  'thumbs-options',
  'thumbs-option',
  'thumbs-icon',
  'thumbs-followup',
  'thumbs-reasons',
  'quick-picks',
  'quick-pick',
  'quick-pick-copy',
  'quick-pick-name',
  'quick-pick-host',
  // Round 3 (orchestration brief 3.4).
  'tooltip',
  'tooltip-title',
  'tooltip-text',
  'chart-key',
  'chart-key-item',
  'chart-key-name',
  'chart-key-count',
  'chart-key-meaning',
  'tone-label',
  'kpi-split',
  'kpi-split-value',
  'kpi-split-line',
  'allowance',
  'allowance-label',
  'allowance-bar',
  'allowance-part',
  'allowance-key',
  'allowance-key-item',
  'allowance-note',
  'allowance-action',
  'live-pill',
  'live-pill-dot',
  'live-table-wrap',
  'live-table-head',
  'live-table-title',
  'live-table',
  'live-table-link',
  'live-table-meta',
  'live-table-role',
  'live-table-fit',
  'live-table-source',
  'live-table-found',
  'need-pill',
  'need-add',
  'need-add-word',
  'need-summary',
  'need-summary-part',
  'list-toolbar',
  'list-toolbar-search',
  'list-toolbar-filters',
  'list-toolbar-count',
  'list-toolbar-sort',
  'list-toolbar-result',
  'paper-stack',
  'paper-stack-head',
  'paper-stack-title',
  'paper-count',
  'paper-pages',
  'paper',
  'paper-sheet',
  'paper-content',
  'paper-flow',
  'paper-number',
  'paper-measure',
  'doc-preview',
  'doc-preview-header',
  'doc-preview-title',
  'doc-preview-meta',
  'doc-preview-close',
  'doc-preview-body',
  'doc-preview-thumbs',
  'doc-preview-thumb',
  'doc-preview-main',
  'doc-preview-stage',
  'doc-preview-pager',
  'doc-preview-count',
  'doc-preview-text',
  'doc-preview-words',
  'doc-preview-footer',
  'doc-preview-note',
  'tour-spotlight',
  'tour-card',
  'tour-card-title',
  'tour-card-text',
  'tour-card-actions',
  'tour-card-moves',
];

const TONES = ['green', 'blue', 'orange', 'ink', 'quiet', 'teal', 'indigo', 'gold', 'wine'];

// The data colour palette (round 5, D1): the --viz-* properties app-components.css declares in
// its one :where(html) block, and the two meter kinds that pick the left part's colour.
const VIZ_TONES = TONES;
const VIZ_ROLES = ['used', 'used-ground', 'track', 'left', 'bonus', 'bought'];
const VIZ_PROPERTIES = [
  ...[...VIZ_TONES, ...VIZ_ROLES].map((name) => `--viz-${name}`),
  // The attention mark's own property, so a dot or a leading rule keeps 3:1 while the brand orange
  // stays for soft grounds and anything with text beside it (round 5, UAT-A-4).
  '--mark-attention',
];
// The tour panda's size (round 6): the deputy's guide API reads it (A1, /tmp/jd-r8/A1/guide-api.md).
const GUIDE_PROPERTIES = ['--deputy-guide-size'];
// The optional need marker's tone (round 6, P2), declared in the palette block.
const NEED_PROPERTIES = ['--need-optional-fill', '--need-optional-line', '--need-optional-mark'];
// The score trend's own knobs (round 6 part 3): the room a version takes and the plot's floor,
// each declared on .score-trend (and its sizes), so a trend of two points never stretches over a
// wide card; --trend-points is set inline from the number of versions.
const TREND_PROPERTIES = ['--trend-floor', '--trend-points', '--trend-step'];
const paletteBlock = (): string => components.match(/:where\(html\)\s*\{([^}]*)\}/)?.[1] ?? '';
const kindBlock = (kind: string): string =>
  components.match(new RegExp(`\\[data-meter-kind="${kind}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? '';

// ------------------------------------------------------------------ helpers
// From tests/prototype/ui-consistency.test.ts.

function stylesIn(source: string): string {
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1] ?? '')
    .join('\n');
}

// Keyframe steps (from, to, and percentages) are not selectors two files could share.
const KEYFRAME_STEP = /^(?:from|to|\d+(?:\.\d+)?%)$/;

function selectorsIn(css: string): string[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((rule) =>
    (rule[1] ?? '')
      .split(',')
      .map((selector) => selector.replace(/\s+/g, ' ').trim())
      .filter((selector) => selector && !selector.startsWith('@') && !KEYFRAME_STEP.test(selector)),
  );
}

// From tests/prototype/ui-quality.test.ts: style rules in source order with their @media chain.
interface Declaration {
  property: string;
  value: string;
  important: boolean;
}

interface StyleRule {
  selectors: string[];
  declarations: Declaration[];
  media: string[];
}

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
    return [
      {
        property: item.slice(0, colon).trim().toLowerCase(),
        value: raw.replace(/!\s*important\s*$/i, '').trim(),
        important: /!\s*important\s*$/i.test(raw),
      },
    ];
  });
}

// @media, @container, and @supports are walked with their conditions; @keyframes are skipped.
function parseStyleRules(css: string): StyleRule[] {
  const rules: StyleRule[] = [];
  const walk = (text: string, media: string[]): void => {
    let cursor = 0;
    let open = text.indexOf('{');
    while (open >= 0) {
      const prelude = (text.slice(cursor, open).split(';').pop() ?? '').trim();
      const close = closingIndex(text, open, '{', '}');
      const body = text.slice(open + 1, close);
      cursor = close + 1;
      if (/^@(media|container|supports)\b/i.test(prelude)) walk(body, [...media, prelude]);
      else if (!prelude.startsWith('@')) {
        rules.push({
          selectors: splitTopLevel(prelude, ',').map((selector) => selector.replace(/\s+/g, ' ')),
          declarations: parseDeclarations(body),
          media,
        });
      }
      open = text.indexOf('{', cursor);
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), []);
  return rules;
}

// The subject (last) compound of a selector, ignoring what sits inside :has(), :not(), and the
// like, so `.a:has(.b) .c` yields `.c`.
function subjectCompound(selector: string): string {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index] ?? '';
    if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth -= 1;
    else if (depth === 0 && /[\s>+~]/.test(character)) start = index + 1;
  }
  return selector.slice(start).trim();
}

function topLevelClasses(compound: string): string[] {
  const outside = compound.replace(/\((?:[^()]|\([^()]*\))*\)/g, '').replace(/\[[^\]]*\]/g, '');
  return [...outside.matchAll(/\.([\w-]+)/g)].map((match) => match[1] ?? '');
}

// Selector specificity as [ids, classes, elements]; :is(), :not(), and :has() count their most
// specific argument and :where() counts nothing.
type Specificity = [number, number, number];

function specificity(selector: string): Specificity {
  const total: Specificity = [0, 0, 0];
  let rest = selector;
  const functional = /:(is|not|has|where)\(((?:[^()]|\([^()]*\))*)\)/;
  for (let match = rest.match(functional); match; match = rest.match(functional)) {
    if (match[1] !== 'where') {
      const best = splitTopLevel(match[2] ?? '', ',')
        .map(specificity)
        .sort((a, b) => compareSpecificity(b, a))[0] ?? [0, 0, 0];
      total[0] += best[0];
      total[1] += best[1];
      total[2] += best[2];
    }
    rest = rest.replace(match[0], ' ');
  }
  rest = rest.replace(/\[[^\]]*\]/g, () => {
    total[1] += 1;
    return ' ';
  });
  total[0] += (rest.match(/#[\w-]+/g) ?? []).length;
  total[1] += (rest.match(/\.[\w-]+/g) ?? []).length;
  total[1] += (rest.match(/(?<!:):[\w-]+/g) ?? []).length;
  total[2] += (rest.match(/::[\w-]+/g) ?? []).length;
  total[2] += (rest.replace(/[.#:][\w-]+/g, ' ').match(/(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return total;
}

function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

const SYSTEM_COLORS =
  /\b(?:Canvas|CanvasText|LinkText|VisitedText|ActiveText|ButtonFace|ButtonText|ButtonBorder|Field|FieldText|Highlight|HighlightText|SelectedItem|SelectedItemText|Mark|MarkText|GrayText|AccentColor|AccentColorText)\b/;
const NAMED_COLORS =
  /\b(?:black|silver|gray|grey|red|maroon|purple|fuchsia|green|lime|olive|yellow|navy|blue|teal|aqua|orange|pink|brown|gold|beige|ivory|tan|khaki|coral|salmon|crimson|indigo|violet|cyan|magenta)\b/i;
const COLOR_PROPERTIES =
  /^(?:color|background|background-color|background-image|border(?:-[\w-]+)?-color|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?|outline(?:-color)?|fill|stroke|box-shadow|text-decoration(?:-color)?|caret-color|accent-color|column-rule(?:-color)?)$/;

// A raw colour is a hex, an rgb()/hsl()-family function, or a named colour other than white,
// transparent, or currentColor. Token references (var()) are stripped first; system colours are
// only allowed in forced-colours blocks.
function rawColours(rules: StyleRule[]): string[] {
  return rules.flatMap((rule) => {
    const forced = rule.media.some((query) => /forced-colors\s*:\s*active/i.test(query));
    return rule.declarations
      .filter(({ property }) => COLOR_PROPERTIES.test(property))
      .filter(({ value }) => {
        const bare = value.replace(/var\(\s*--[\w-]+\s*\)/g, '');
        if (/#[0-9a-f]{3,8}\b/i.test(bare)) return true;
        if (/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i.test(bare)) return true;
        if (NAMED_COLORS.test(bare.replace(/\b(?:white|transparent|currentcolor)\b/gi, '')))
          return true;
        return !forced && SYSTEM_COLORS.test(bare);
      })
      .map(({ property, value }) => `${rule.selectors.join(', ')} { ${property}: ${value} }`);
  });
}

function fontFamilyProblems(rules: StyleRule[]): string[] {
  return rules.flatMap((rule) =>
    rule.declarations
      .filter(
        ({ property, value }) =>
          (property === 'font-family' &&
            !['var(--font-display)', 'var(--font-text)', 'inherit'].includes(value)) ||
          (property === 'font' && value !== 'inherit'),
      )
      .map(({ property, value }) => `${rule.selectors.join(', ')} { ${property}: ${value} }`),
  );
}

// The paper's page content is a picture of a printed page (docs/design-system.md: text inside an
// aria-hidden illustration may be smaller): its type is set in page pixels that scale with the sheet
// (calc(100cqw * 14 / 816)) and in em inside it. Only selectors inside .paper-content are exempt, and
// the gallery and script tests below hold every sheet aria-hidden.
const pagePicture = (rule: StyleRule): boolean =>
  rule.selectors.every((selector) => /\.paper-content\b/.test(selector));

// Every pixel size in a font-size value, including each clamp() and min() argument.
function smallText(rules: StyleRule[]): string[] {
  return rules
    .filter((rule) => !pagePicture(rule))
    .flatMap((rule) =>
      rule.declarations
        .filter(({ property }) => property === 'font-size')
        .filter(({ value }) => {
          const pixels = [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
          const relative = /\d(?:em|rem|%|vw|vh)\b/.test(value) && !/clamp\(/.test(value);
          return relative || pixels.some((size) => size < 12) || pixels.length === 0;
        })
        .map(({ value }) => `${rule.selectors.join(', ')} { font-size: ${value} }`),
    );
}

// A content value with a glyph must carry alt text after a slash: content: "✓" / "".
function glyphsWithoutAlt(rules: StyleRule[]): string[] {
  return rules.flatMap((rule) =>
    rule.declarations
      .filter(({ property }) => property === 'content')
      .filter(({ value }) => {
        if (/^(?:none|normal|""|'')$/.test(value)) return false;
        return !/\/\s*(?:"[^"]*"|'[^']*')\s*$/.test(value);
      })
      .map(({ value }) => `${rule.selectors.join(', ')} { content: ${value} }`),
  );
}

// Text never wears green, quiet, orange, or blue (docs/design-system.md, Color).
function tonedText(rules: StyleRule[]): string[] {
  return rules.flatMap((rule) =>
    rule.declarations
      .filter(
        ({ property, value }) =>
          property === 'color' && /var\(--(?:green|quiet|orange|blue)\)/.test(value),
      )
      .map(({ value }) => `${rule.selectors.join(', ')} { color: ${value} }`),
  );
}

const REDUCE = /prefers-reduced-motion\s*:\s*reduce/i;
const FORCED = /forced-colors\s*:\s*active/i;
const isReduce = (rule: StyleRule): boolean => rule.media.some((query) => REDUCE.test(query));
const isForced = (rule: StyleRule): boolean => rule.media.some((query) => FORCED.test(query));

// Every selector that animates or transitions outside the reduced-motion block must be listed in
// it with animation: none !important and transition: none !important; hover transforms must be
// reset there with !important too.
// Round 7: the boot failsafe (a held region shows itself after a long wait) is not motion, so a
// reduced-motion rule that keeps only it stops the region's motion, and it needs no reset itself.
const BOOT_FAILSAFE = /^jd-skeleton-(?:reveal|gone) 180ms step-end 5236ms forwards$/;

function motionLeaks(rules: StyleRule[]): string[] {
  const reset = (property: string): Set<string> =>
    new Set(
      rules
        .filter(isReduce)
        .filter((rule) =>
          rule.declarations.some(
            (declaration) =>
              declaration.property === property &&
              declaration.important &&
              (declaration.value === 'none' ||
                (property === 'animation' && BOOT_FAILSAFE.test(declaration.value))),
          ),
        )
        .flatMap((rule) => rule.selectors),
    );
  const stopped = { animation: reset('animation'), transition: reset('transition') };
  const still = reset('transform');
  const problems = new Set<string>();
  for (const rule of rules.filter((candidate) => !isReduce(candidate))) {
    for (const declaration of rule.declarations) {
      const property = declaration.property.replace(/-(?:name|duration|property)$/, '');
      if (
        (property === 'animation' || property === 'transition') &&
        declaration.value !== 'none' &&
        !BOOT_FAILSAFE.test(declaration.value)
      ) {
        for (const selector of rule.selectors) {
          if (!stopped[property].has(selector)) problems.add(`${selector} { ${property} }`);
        }
      }
      if (declaration.property === 'transform' && declaration.value !== 'none') {
        for (const selector of rule.selectors.filter((item) => /:hover|\.is-hover/.test(item))) {
          if (!still.has(selector)) problems.add(`${selector} { transform }`);
        }
      }
    }
  }
  return [...problems];
}

function importantOutsideReduce(rules: StyleRule[]): string[] {
  return rules
    .filter((rule) => !isReduce(rule))
    .flatMap((rule) =>
      rule.declarations
        .filter((declaration) => declaration.important)
        .map(({ property }) => `${rule.selectors.join(', ')} { ${property} }`),
    );
}

const componentRules = parseStyleRules(components);
const chromeRules = parseStyleRules(chrome);
const chromeSelectors = new Set(selectorsIn(chrome));
// Component classes only: state modifiers such as .is-attention or .has-action are a shared
// vocabulary, not components.
const isModifier = (name: string): boolean => /^(?:is|has)-/.test(name);
// Shared components that chrome places inside its own parts, setting only where they sit (round
// 5: `.prompt-drawer .prompt-numbers > .data-table-wrap` puts the shared table in the Prompt
// drawer). They stay this file's components; the test below checks chrome only places them.
const PLACED_BY_CHROME = new Set(['data-table-wrap']);
const PLACEMENT = /^(?:margin(?:-[\w-]+)?|grid-(?:area|column|row)|align-self|justify-self|order)$/;
// A rule of this file that only places a chrome part inside one of this file's own components
// (checked in full by its own test below).
const placesInsideOwn = (rule: StyleRule, selector: string): boolean => {
  const root = selector.match(/^\.([\w-]+)[\s>+~]/)?.[1] ?? '';
  return (
    root !== '' &&
    !chromeClasses.has(root) &&
    rule.media.some((query) => query.includes(`container ${root} `)) &&
    rule.declarations.every((declaration) => PLACEMENT.test(declaration.property))
  );
};
const chromeClasses = new Set(
  selectorsIn(chrome).flatMap((selector) =>
    [...selector.matchAll(/\.([\w-]+)/g)]
      .map((match) => match[1] ?? '')
      .filter((name) => !isModifier(name) && !PLACED_BY_CHROME.has(name)),
  ),
);

// The last value of a property for one exact selector, outside any @media unless one is named.
function declared(
  rules: StyleRule[],
  selector: string,
  property: string,
  where: (rule: StyleRule) => boolean = (rule) => rule.media.length === 0,
): string | undefined {
  return rules
    .filter((rule) => where(rule) && rule.selectors.includes(selector))
    .flatMap((rule) => rule.declarations.filter((item) => item.property === property))
    .map((item) => item.value)
    .pop();
}

// Padding sides in pixels from padding or padding-inline, as [top, right, bottom, left]; a side the
// declaration does not set is undefined.
type Sides = [number | undefined, number | undefined, number | undefined, number | undefined];

function paddingOf(
  rules: StyleRule[],
  selector: string,
  media?: (rule: StyleRule) => boolean,
): Sides {
  const where = media ?? ((rule: StyleRule) => rule.media.length === 0);
  const sides: Sides = [undefined, undefined, undefined, undefined];
  for (const rule of rules.filter((item) => where(item) && item.selectors.includes(selector))) {
    for (const { property, value } of rule.declarations) {
      const px = value.split(/\s+/).map((part) => Number.parseFloat(part));
      if (property === 'padding') {
        const [top = 0, right = top, bottom = top, left = right] = px;
        sides.splice(0, 4, top, right, bottom, left);
      } else if (property === 'padding-inline') {
        const [start = 0, end = start] = px;
        sides[1] = end;
        sides[3] = start;
      }
    }
  }
  return sides;
}

// ------------------------------------------------------------------ the stylesheet

describe('app-components.css tokens and type', () => {
  it('has no :root block of its own; pages declare the canonical tokens', () => {
    expect(components).not.toMatch(/:root\s*\{/);
  });

  it('uses only canonical tokens: no raw hex, colour functions, or named colours', () => {
    expect(rawColours(componentRules)).toEqual([]);
  });

  it('reads only canonical tokens, its component properties, and its own data palette', () => {
    const allowed = new Set([
      ...TOKENS,
      ...COMPONENT_PROPERTIES,
      ...VIZ_PROPERTIES,
      ...GUIDE_PROPERTIES,
      ...NEED_PROPERTIES,
      ...TREND_PROPERTIES,
    ]);
    const used = [...components.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1] ?? '');
    expect([...new Set(used.filter((name) => !allowed.has(name)))]).toEqual([]);
    // The only custom properties it declares are the palette's, in the palette block, plus the
    // left colour each meter kind picks, (round 6) the tour panda's size, which the deputy's
    // guide API reads (A1's documented knob), each in a rule of its own on .tour-card, and (part
    // 3) the score trend's room per version, on .score-trend and its sizes.
    const declared = [...components.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1]);
    expect([...new Set(declared)].sort()).toEqual(
      [
        ...VIZ_PROPERTIES,
        ...GUIDE_PROPERTIES,
        ...NEED_PROPERTIES,
        ...TREND_PROPERTIES.filter((name) => name !== '--trend-points'),
        ...SKELETON_PROPERTIES,
      ].sort(),
    );
    const outside = components
      .replace(/:where\(html\)\s*\{[^}]*\}/, '')
      .replace(/\[data-meter-kind="(?:watch|assist)"\]\s*\{[^}]*\}/g, '')
      .replace(/\.tour-card\s*\{\s*--deputy-guide-size:\s*\d+px;\s*\}/g, '')
      // The trend's knobs sit on .score-trend and its two sizes, in rules of their own.
      .replace(/\.score-trend(?:\.is-(?:large|row|medium))?\s*\{[^}]*\}/g, '')
      // Round 7: the skeleton's shapes per kind and the JS block's rows, in rules of their own.
      .replace(/html:not\(\[data-boot="ready"\]\) \[data-skeleton="\w+"\]\s*\{[^}]*\}/g, '')
      .replace(/\.skeleton-block\s*\{[^}]*\}/g, '')
      // The prompt summary's Open column on the Prompts page itself.
      .replace(/\[data-prompt-home\]\s*\{[^}]*\}/g, '');
    expect(outside).not.toMatch(/^\s*--[\w-]+\s*:/m);
    // Raw colours live only in the palette block, as its own values.
    expect(outside).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('uses only the two font stacks or inherit', () => {
    expect(fontFamilyProblems(componentRules)).toEqual([]);
  });

  it('keeps every font size at 12px or larger', () => {
    expect(smallText(componentRules)).toEqual([]);
  });

  it('gives every CSS glyph empty or descriptive alt text', () => {
    expect(glyphsWithoutAlt(componentRules)).toEqual([]);
  });

  it('never colours text green, quiet, orange, or blue', () => {
    expect(tonedText(componentRules)).toEqual([]);
  });
});

describe('app-components.css beside app-chrome.css', () => {
  it('repeats no selector from app-chrome.css', () => {
    const shared = selectorsIn(components).filter((selector) => chromeSelectors.has(selector));
    expect([...new Set(shared)]).toEqual([]);
  });

  it('lets chrome only place a shared component inside its own parts, never restyle it', () => {
    const placements = chromeRules.filter((rule) =>
      rule.selectors.some((selector) =>
        topLevelClasses(subjectCompound(selector)).some((name) => PLACED_BY_CHROME.has(name)),
      ),
    );
    for (const rule of placements) {
      for (const selector of rule.selectors) {
        // Placed inside a chrome part, never on its own.
        expect(selector, selector).toMatch(/^\.[\w-]+[\s>+~]/);
      }
      expect(
        rule.declarations
          .map((declaration) => declaration.property)
          .filter((p) => !PLACEMENT.test(p)),
        rule.selectors.join(', '),
      ).toEqual([]);
    }
    for (const name of PLACED_BY_CHROME) expect(selectorsIn(components)).toContain(`.${name}`);
  });

  it('never restyles a chrome component: no rule targets an app-chrome.css class', () => {
    const restyled = componentRules.flatMap((rule) =>
      rule.selectors.filter(
        (selector) =>
          topLevelClasses(subjectCompound(selector)).some((name) => chromeClasses.has(name)) &&
          !placesInsideOwn(rule, selector),
      ),
    );
    expect([...new Set(restyled)]).toEqual([]);
  });

  // The mirror of the rule above: a component of this file may place a chrome part that it holds
  // (round 5: the pause banner puts the shared panel's Review and sign on its own row on phones).
  // Only where it sits, only inside the component, and the component must be this file's.
  it('places a chrome part it holds only inside its own component, with placement alone', () => {
    const placings = componentRules.flatMap((rule) =>
      rule.selectors
        .filter((selector) =>
          topLevelClasses(subjectCompound(selector)).some((name) => chromeClasses.has(name)),
        )
        .map((selector) => ({ rule, selector })),
    );
    expect(placings.map(({ selector }) => selector)).toEqual([
      '.agreement-banner > .feedback-panel > .feedback-panel-action',
    ]);
    for (const { rule, selector } of placings) {
      const root = selector.match(/^\.([\w-]+)[\s>+~]/)?.[1] ?? '';
      expect(selectorsIn(components), selector).toContain(`.${root}`);
      expect(chromeClasses.has(root), root).toBe(false);
      expect(
        rule.declarations
          .map((declaration) => declaration.property)
          .filter((property) => !PLACEMENT.test(property)),
        selector,
      ).toEqual([]);
      // Inside a container query of the component's own container, never a blanket rule.
      expect(rule.media.join(' '), selector).toContain(`container ${root} `);
    }
  });

  it('defines every documented component class', () => {
    const defined = new Set(
      selectorsIn(components).flatMap((selector) =>
        [...selector.matchAll(/\.([\w-]+)/g)].map((match) => match[1] ?? ''),
      ),
    );
    expect(DOCUMENTED_CLASSES.filter((name) => !defined.has(name))).toEqual([]);
  });

  it('keeps 44px targets on its own controls and 52px on choice cards and steps', () => {
    const minimum = (selector: string, property: string): number => {
      const values = componentRules
        .filter((rule) => rule.media.length === 0 && rule.selectors.includes(selector))
        .flatMap((rule) => rule.declarations.filter((item) => item.property === property))
        .map((item) => Number.parseFloat(item.value));
      return Math.max(0, ...values);
    };
    expect(minimum('.data-table-sort', 'min-height')).toBeGreaterThanOrEqual(44);
    expect(minimum('.data-table-check', 'height')).toBeGreaterThanOrEqual(44);
    expect(minimum('.data-table-title', 'min-height')).toBeGreaterThanOrEqual(44);
    expect(minimum('.segmented-option', 'min-height')).toBeGreaterThanOrEqual(44);
    expect(minimum('.tabs > [role="tab"]', 'min-height')).toBeGreaterThanOrEqual(44);
    expect(minimum('.board-card-link', 'min-height')).toBeGreaterThanOrEqual(44);
    expect(minimum('.bar-chart-data > summary', 'min-height')).toBeGreaterThanOrEqual(44);
    expect(minimum('.choice-card', 'min-height')).toBeGreaterThanOrEqual(52);
    expect(minimum('.flow-ribbon-step', 'min-height')).toBeGreaterThanOrEqual(52);
    expect(minimum('.quick-pick', 'min-height')).toBeGreaterThanOrEqual(52);
    expect(minimum('.thumbs-option', 'min-height')).toBeGreaterThanOrEqual(44);
    expect(minimum('.hbar-row', 'min-height')).toBeGreaterThanOrEqual(44);
    expect(minimum('a.chart-legend-item', 'min-height')).toBeGreaterThanOrEqual(44);
    expect(minimum('.chart-action', 'min-height')).toBeGreaterThanOrEqual(44);
  });

  it('keeps a forced-colours boundary on its controls and pills', () => {
    const forced = componentRules.filter(isForced);
    expect(forced.length).toBeGreaterThan(0);
    const transparentEdge = (selector: string): boolean =>
      componentRules.some(
        (rule) =>
          rule.selectors.includes(selector) &&
          rule.declarations.some(
            ({ property, value }) =>
              /^(?:border|outline)$/.test(property) && /\b1px solid transparent\b/.test(value),
          ),
      );
    for (const selector of [
      '.stage-track .stage',
      '.segmented',
      '.board-count',
      '.company-mark',
      '.empty-state-icon',
      '.flow-ribbon-step',
      '.hbar-row',
      '.chart-legend-item',
    ]) {
      expect(transparentEdge(selector), selector).toBe(true);
    }
  });
});

// ------------------------------------------------------------------ one selected style

describe('one selected style (brief 3.7)', () => {
  // Each choice control, the rule that marks it selected, its plain rule, the rule that sets the
  // selected label's weight, and where its check sits.
  const controls = [
    {
      selected: '.choice-card:has(input:checked)',
      base: '.choice-card',
      label: '.choice-card:has(input:checked) .choice-card-label',
      check: '.choice-card:has(input:checked) .choice-card-control::before',
    },
    {
      selected: '.quick-pick:has(input:checked)',
      base: '.quick-pick',
      label: '.quick-pick:has(input:checked) .quick-pick-name',
      check: '.quick-pick:has(input:checked)::after',
    },
    {
      selected: '.thumbs-option:has(input:checked)',
      base: '.thumbs-option',
      label: '.thumbs-option:has(input:checked)',
      check: '.thumbs-option:has(input:checked)::before',
    },
    {
      selected: '.segmented-option:has(input:checked) .segmented-label',
      base: '.segmented-label',
      label: '.segmented-option:has(input:checked) .segmented-label',
      check: '.segmented-option:has(input:checked) .segmented-label::before',
    },
  ];

  it.each(controls)(
    '$selected: green-soft, a 2px green border, and an ink 700 label',
    (control) => {
      expect(declared(componentRules, control.selected, 'background')).toBe('var(--green-soft)');
      // The segmented sits on the paper-deep track, where green measures 2.84:1, so its boundary is
      // green-ink and a check states the selection without colour (round 5, UAT-A-3).
      const border = control.selected.includes('segmented')
        ? '2px solid var(--green-ink)'
        : '2px solid var(--green)';
      expect(declared(componentRules, control.selected, 'border')).toBe(border);
      expect(declared(componentRules, control.label, 'font-weight')).toBe('700');
      const ink = declared(componentRules, control.selected, 'color') ?? 'var(--ink)';
      expect(ink).toBe('var(--ink)');
      // The plain control has a 1px border, so the selected padding gives back exactly 1px.
      expect(declared(componentRules, control.base, 'border')).toMatch(/^1px solid /);
      const base = paddingOf(componentRules, control.base);
      const selected = paddingOf(componentRules, control.selected);
      selected.forEach((side, index) => {
        if (side !== undefined)
          expect((base[index] ?? 0) - side, `${control.selected} side ${index}`).toBe(1);
      });
    },
  );

  it.each(controls)('$selected keeps a Highlight border in forced colours', (control) => {
    expect(declared(componentRules, control.selected, 'border-color', isForced)).toBe('Highlight');
  });

  it.each(controls.filter((control) => control.check))(
    '$selected shows a green-ink check',
    (control) => {
      const check = control.check ?? '';
      expect(declared(componentRules, check, 'content')).toBe('"✓" / ""');
      const colour =
        declared(componentRules, check, 'color') ??
        declared(componentRules, '.choice-card-control', 'color');
      expect(colour).toBe('var(--green-ink)');
    },
  );

  it('turns secondary text ink-soft on green-soft, where muted fails AA', () => {
    expect(
      declared(componentRules, '.choice-card:has(input:checked) .choice-card-meta', 'color'),
    ).toBe('var(--ink-soft)');
    expect(
      declared(componentRules, '.quick-pick:has(input:checked) .quick-pick-host', 'color'),
    ).toBe('var(--ink-soft)');
  });

  it('gives back the mobile choice-card padding too', () => {
    const phone = (rule: StyleRule): boolean =>
      rule.media.some((query) => /max-width:\s*720px/.test(query));
    const base = paddingOf(componentRules, '.choice-card', phone);
    const selected = paddingOf(componentRules, '.choice-card:has(input:checked)', phone);
    expect(base.map((side, index) => (side ?? 0) - (selected[index] ?? 0))).toEqual([1, 1, 1, 1]);
  });

  it('matches the chips and the rating faces in app-chrome.css', () => {
    for (const selector of [
      '.choice-chip:has(input:checked)',
      '.feedback-rate:has(input:checked)',
    ]) {
      expect(declared(chromeRules, selector, 'border'), selector).toBe('2px solid var(--green)');
      expect(declared(chromeRules, selector, 'background'), selector).toBe('var(--green-soft)');
      expect(declared(chromeRules, selector, 'color'), selector).toBe('var(--ink)');
      expect(declared(chromeRules, selector, 'font-weight'), selector).toBe('700');
    }
    // A long answer of your own (a role title of 80 characters, T1-7) stays inside its card.
    expect(declared(chromeRules, '.choice-chip', 'max-width')).toBe('100%');
    expect(declared(chromeRules, '.choice-chip', 'overflow-wrap')).toBe('anywhere');
    expect(declared(chromeRules, '.choice-chip', 'white-space')).toBeUndefined();
  });
});

// ------------------------------------------------------------------ charts and tones

describe('chart tones and forced colours', () => {
  // Round 5 (D1): every tone reads its own data colour, never a brand token.
  const tokenFor: Record<string, string> = Object.fromEntries(
    VIZ_TONES.map((tone) => [tone, `var(--viz-${tone})`]),
  );
  const toned = (tone: string): Array<[string, string]> => [
    [`.hbar-row[data-tone="${tone}"] .hbar-fill`, 'background'],
    [`.stack-bar-seg[data-tone="${tone}"]`, 'background'],
    [`.chart-legend > [data-tone="${tone}"] > .chart-legend-item::before`, 'background'],
    [`.donut-seg[data-tone="${tone}"]`, 'fill'],
    [`.sparkline[data-tone="${tone}"] .sparkline-dot`, 'fill'],
    [`.sparkline[data-tone="${tone}"] .sparkline-line`, 'stroke'],
  ];

  it('maps every tone to its data colour, with the data green as the default', () => {
    for (const [tone, token] of Object.entries(tokenFor)) {
      for (const [selector, property] of toned(tone)) {
        expect(declared(componentRules, selector, property), selector).toBe(token);
      }
      expect(
        declared(
          componentRules,
          `.chart-key > [data-tone="${tone}"] > .chart-key-item::before`,
          'background',
        ),
      ).toBe(token);
      expect(
        declared(componentRules, `.tone-label[data-tone="${tone}"]::before`, 'background'),
      ).toBe(token);
      expect(declared(componentRules, `.usage-chart-seg[data-tone="${tone}"]`, 'background')).toBe(
        token,
      );
    }
    expect(declared(componentRules, '.hbar-fill', 'background')).toBe('var(--viz-green)');
    expect(declared(componentRules, '.stack-bar-seg', 'background')).toBe('var(--viz-green)');
    expect(declared(componentRules, '.chart-legend-item::before', 'background')).toBe(
      'var(--viz-green)',
    );
    expect(declared(componentRules, '.donut-seg', 'fill')).toBe('var(--viz-green)');
    expect(declared(componentRules, '.sparkline-line', 'stroke')).toBe('var(--viz-green)');
    expect(declared(componentRules, '.sparkline-dot', 'fill')).toBe('var(--viz-green)');
    // The script falls back to quiet for an unknown tone, from the same list.
    expect(script).toContain(`const TONES = [${TONES.map((tone) => `'${tone}'`).join(', ')}];`);
  });

  it('turns every chart part to system colours in forced colours, outweighing the tones', () => {
    const parts: Array<[string, string, string, RegExp]> = [
      ['.hbar-row .hbar-track > .hbar-fill', 'background', 'Highlight', /\.hbar-fill$/],
      ['.stack-bar > .stack-bar-seg', 'background', 'Highlight', /\.stack-bar-seg(?:\[[^\]]*\])?$/],
      [
        '.chart-legend > [data-tone] > .chart-legend-item::before',
        'background',
        'Highlight',
        /\.chart-legend-item::before$/,
      ],
      ['.donut-art .donut-seg', 'fill', 'Canvas', /\.donut-seg(?:\[[^\]]*\])?$/],
      ['.sparkline .sparkline-art .sparkline-line', 'stroke', 'CanvasText', /\.sparkline-line$/],
      ['.sparkline .sparkline-art .sparkline-dot', 'fill', 'Highlight', /\.sparkline-dot$/],
    ];
    for (const [forcedSelector, property, value, subject] of parts) {
      expect(declared(componentRules, forcedSelector, property, isForced), forcedSelector).toBe(
        value,
      );
      const rivals = componentRules
        .filter((rule) => !isForced(rule) && rule.media.length === 0)
        .filter((rule) => rule.declarations.some((item) => item.property === property))
        .flatMap((rule) => rule.selectors)
        .filter(
          (selector) => subject.test(selector) && !/:hover|is-active|is-hover/.test(selector),
        );
      expect(rivals.length, forcedSelector).toBeGreaterThan(0);
      for (const rival of rivals) {
        expect(
          compareSpecificity(specificity(forcedSelector), specificity(rival)),
          `${forcedSelector} against ${rival}`,
        ).toBeGreaterThanOrEqual(0);
      }
    }
    expect(declared(componentRules, '.hbar-track', 'border', isForced)).toBe(
      '1px solid CanvasText',
    );
    expect(declared(componentRules, '.stack-bar', 'border', isForced)).toBe('1px solid CanvasText');
    expect(
      declared(
        componentRules,
        '.flow-ribbon-step[aria-current="page"]',
        'border-inline-start-color',
        isForced,
      ),
    ).toBe('Highlight');
  });

  it('marks the current flow step like the current nav link: a real 3px green border and ink 700', () => {
    const current = '.flow-ribbon-step[aria-current="page"]';
    expect(declared(componentRules, current, 'border-inline-start')).toBe('3px solid var(--green)');
    expect(declared(componentRules, current, 'padding-inline-start')).toBe('11px');
    expect(declared(componentRules, `${current} .flow-ribbon-label`, 'font-weight')).toBe('700');
    expect(declared(componentRules, `${current} .flow-ribbon-label`, 'color')).toBe('var(--ink)');
    expect(declared(componentRules, '.flow-ribbon-list > li + li::before', 'content')).toBe(
      '"→" / ""',
    );
  });

  it('lays the ribbon out as three equal columns, label over count, below 560px', () => {
    const narrow = (rule: StyleRule): boolean =>
      rule.media.some((query) => /@container flow-ribbon \(max-width: 559px\)/.test(query));
    expect(declared(componentRules, '.flow-ribbon-list', 'grid-template-columns', narrow)).toBe(
      'repeat(3, minmax(0, 1fr))',
    );
    expect(declared(componentRules, '.flow-ribbon-icon', 'display', narrow)).toBe('none');
    expect(
      declared(componentRules, '.flow-ribbon-step', 'grid-template-areas', narrow)?.replace(
        /\s+/g,
        ' ',
      ),
    ).toBe('"label" "count"');
  });

  it('puts KPI tiles two to a row on phones, 178px columns otherwise', () => {
    expect(declared(componentRules, '.kpi-grid', 'grid-template-columns')).toBe(
      'repeat(auto-fit, minmax(min(100%, 178px), 1fr))',
    );
    expect(declared(componentRules, '.kpi-grid', 'gap')).toBe('21px');
    const phone = (rule: StyleRule): boolean =>
      rule.media.some((query) => /max-width:\s*720px/.test(query));
    expect(declared(componentRules, '.kpi-grid', 'grid-template-columns', phone)).toBe(
      'repeat(2, minmax(0, 1fr))',
    );
    expect(declared(componentRules, '.kpi-value', 'font-size')).toBe('34px');
    expect(declared(componentRules, '.kpi-value', 'font-family')).toBe('var(--font-display)');
    expect(declared(componentRules, '.kpi.is-hero .kpi-value', 'font-size')).toMatch(/55px\)$/);
  });

  it('adds 55px and 34px rings beside the 89px one', () => {
    expect(declared(componentRules, '.ring.is-small .ring-art', 'width')).toBe('55px');
    expect(declared(componentRules, '.ring.is-tiny .ring-art', 'width')).toBe('34px');
    expect(declared(componentRules, '.ring-art', 'width')).toBe('89px');
  });
});

describe('app-components.css motion', () => {
  const growing = [
    '.meter::before',
    '.hbar-fill',
    '.bar-chart-bar',
    '.ring-arc',
    '.sparkline-art',
    '.stack-bar',
    '.donut-sweep',
  ];

  it('has a prefers-reduced-motion: reduce block', () => {
    expect(componentRules.some(isReduce)).toBe(true);
  });

  it('neutralises every animation, transition, and hover lift under reduced motion', () => {
    expect(motionLeaks(componentRules)).toEqual([]);
  });

  it('loops only the live pulse and the run tracker\u2019s current step, and only while a run is live', () => {
    const loops = componentRules.filter((rule) =>
      rule.declarations.some(
        ({ property, value }) => /^animation/.test(property) && /\binfinite\b/.test(value),
      ),
    );
    expect(loops.flatMap((rule) => rule.selectors)).toEqual([
      '.live-pill.is-live .live-pill-dot::after',
      '.run-tracker[data-state="live"] .run-tracker-step.is-current::before',
      '.run-tracker[data-state="live"] .run-tracker-pip.is-current',
      // Round 7 (R10-1): the skeleton's sweep, only while a region is held for the boot (before
      // html[data-boot="ready"], with scripting) or a later load shows the JS block.
      'html:not([data-boot="ready"]) [data-skeleton]::after',
      '.skeleton-block::after',
    ]);
    expect(loops.map((rule) => rule.media)).toEqual([
      [],
      [],
      [],
      ['@media (scripting: enabled)'],
      [],
    ]);
  });

  it('uses the golden-ratio durations', () => {
    // 5236ms is not motion: the boot failsafe's wait before a held region shows itself (round 7).
    const failsafe = [
      ...components.matchAll(/jd-skeleton-(?:reveal|gone) 180ms step-end (\d+)ms/g),
    ];
    expect(failsafe.length).toBeGreaterThan(0);
    expect(new Set(failsafe.map((match) => match[1]))).toEqual(new Set(['5236']));
    const motion = components.replace(/jd-skeleton-(?:reveal|gone) 180ms step-end 5236ms/g, '');
    const durations = [...motion.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)].map((match) =>
      match[2] === 's' ? Number(match[1]) * 1000 : Number(match[1]),
    );
    expect(durations.filter((ms) => ![180, 380, 618, 987, 1618].includes(ms))).toEqual([]);
  });

  it('uses !important only to make the reduced-motion reset win', () => {
    // Round 7: and to keep the boot failsafe's wait under Pause motion, whose reset in
    // app-chrome.css zeroes every delay (the failsafe only shows a held region; it is not motion).
    expect(importantOutsideReduce(componentRules)).toEqual([
      'html[data-motion="paused"]:not([data-boot="ready"]) [data-skeleton] { animation }',
      'html[data-motion="paused"]:not([data-boot="ready"]) [data-skeleton]::after { animation }',
    ]);
    for (const rule of componentRules.filter(
      (item) => !isReduce(item) && item.declarations.some((declaration) => declaration.important),
    )) {
      expect(rule.declarations.map((declaration) => declaration.value)).toEqual([
        expect.stringMatching(/^jd-skeleton-(?:reveal|gone) 180ms step-end 5236ms forwards$/),
      ]);
    }
  });

  it.each(growing)(
    '%s grows once, for 618ms on the settle curve, from defined keyframes',
    (selector) => {
      const animation = declared(componentRules, selector, 'animation') ?? '';
      const match = animation.match(/^(jd-[\w-]+) (\d+)ms var\(--ease-settle\) backwards$/);
      expect(match, `${selector}: ${animation}`).not.toBeNull();
      expect(Number(match?.[2])).toBeLessThanOrEqual(618);
      expect(components).toContain(`@keyframes ${match?.[1]} {`);
    },
  );

  it('holds the grow behind the opening loader, after the first render, and under Pause motion', () => {
    const gate = (subject: string): string =>
      `:is(:root[data-component-motion], .loader-active) ${subject}`;
    for (const subject of growing) {
      expect(declared(componentRules, gate(subject), 'animation'), subject).toBe('none');
      // The gate outweighs every other rule for the part, so it always wins.
      const rivals = componentRules
        .filter((rule) => rule.media.length === 0)
        .flatMap((rule) => rule.selectors)
        .filter(
          (selector) =>
            selector !== gate(subject) && selector.endsWith(subject.split(' ').pop() ?? subject),
        );
      for (const rival of rivals) {
        expect(
          compareSpecificity(specificity(gate(subject)), specificity(rival)),
          rival,
        ).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ------------------------------------------------------------------ the script, in a sandbox
// A small DOM: elements with attributes, classes, children, text, styles, rectangles, focus, and
// events that capture and bubble, plus a selector engine for tags, ids, classes, attributes, and the
// descendant and child combinators, which is all app-components.js asks of it. Text has a simple
// layout for paper pages: a block is one 20px line per 60 characters, and a page's content box is
// 1056px tall with 72px padding, so 45 lines fit.

interface EventInit {
  bubbles?: boolean;
  detail?: unknown;
  key?: string;
  pointerType?: string;
  relatedTarget?: FakeElement | null;
  clientX?: number;
  clientY?: number;
}

class FakeEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly detail: unknown;
  readonly key: string;
  readonly pointerType: string;
  readonly relatedTarget: FakeElement | null;
  readonly clientX: number;
  readonly clientY: number;
  readonly altKey = false;
  readonly ctrlKey = false;
  readonly metaKey = false;
  target: FakeNode | null = null;
  defaultPrevented = false;
  propagationStopped = false;

  constructor(type: string, init: EventInit = {}) {
    this.type = type;
    this.bubbles = init.bubbles === true;
    this.detail = init.detail;
    this.key = init.key ?? '';
    this.pointerType = init.pointerType ?? '';
    this.relatedTarget = init.relatedTarget ?? null;
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }
}

type Listener = (event: FakeEvent) => void;
interface ListenerEntry {
  listener: Listener;
  capture: boolean;
  once: boolean;
}

class FakeNode {
  parent: FakeNode | null = null;
  children: FakeElement[] = [];
  readonly listeners = new Map<string, ListenerEntry[]>();

  get parentElement(): FakeElement | null {
    return this.parent instanceof FakeElement ? this.parent : null;
  }

  addEventListener(
    type: string,
    listener: Listener,
    options?: boolean | { capture?: boolean; once?: boolean; passive?: boolean },
  ): void {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const once = typeof options === 'object' && Boolean(options?.once);
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), { listener, capture, once }]);
  }

  // Capture from the root down to the target, then bubble back up when the event bubbles.
  dispatchEvent(event: FakeEvent): boolean {
    if (!event.target) event.target = this;
    const path: FakeNode[] = [];
    for (let node: FakeNode | null = this; node; node = node.parent) path.push(node);
    const run = (node: FakeNode, capture: boolean): void => {
      for (const entry of [...(node.listeners.get(event.type) ?? [])]) {
        if (entry.capture !== capture || event.propagationStopped) continue;
        if (entry.once) {
          node.listeners.set(
            event.type,
            (node.listeners.get(event.type) ?? []).filter((item) => item !== entry),
          );
        }
        entry.listener(event);
      }
    };
    for (const node of [...path].reverse().slice(0, -1)) run(node, true);
    run(this, true);
    run(this, false);
    if (event.bubbles) for (const node of path.slice(1)) run(node, false);
    return !event.defaultPrevented;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    const visit = (node: FakeNode): void => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

interface Compound {
  tag: string | null;
  id: string | null;
  classes: string[];
  attributes: Array<[string, string | null]>;
  focusVisible: boolean;
  modal: boolean;
}

function parseCompound(text: string): Compound {
  const compound: Compound = {
    tag: null,
    id: null,
    classes: [],
    attributes: [],
    focusVisible: false,
    modal: false,
  };
  const part =
    /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|(:focus-visible)|(:modal)/gy;
  let consumed = 0;
  for (let match = part.exec(text); match; match = part.exec(text)) {
    consumed = part.lastIndex;
    if (match[1]) compound.tag = match[1].toLowerCase();
    else if (match[2]) compound.id = match[2];
    else if (match[3]) compound.classes.push(match[3]);
    else if (match[4]) compound.attributes.push([match[4], match[5] ?? null]);
    else if (match[6]) compound.focusVisible = true;
    else if (match[7]) compound.modal = true;
  }
  if (consumed !== text.length) throw new Error(`The fake DOM cannot match "${text}"`);
  return compound;
}

// :focus-visible is the focused element, unless a pointer press moved focus there.
function matchesCompound(element: FakeElement, compound: Compound): boolean {
  if (compound.tag && element.tagName.toLowerCase() !== compound.tag) return false;
  // :modal is a dialog opened with showModal() and not closed since.
  if (compound.modal && !(element.modal && element.hasAttribute('open'))) return false;
  if (compound.focusVisible) {
    const document = element.ownerDocument();
    if (document?.activeElement !== element || document.pointerFocus) return false;
  }
  if (compound.id && element.getAttribute('id') !== compound.id) return false;
  if (!compound.classes.every((name) => element.classList.contains(name))) return false;
  return compound.attributes.every(([name, value]) =>
    value === null ? element.hasAttribute(name) : element.getAttribute(name) === value,
  );
}

function matchesComplex(element: FakeElement, selector: string): boolean {
  const tokens = selector
    .replace(/\s*>\s*/g, ' > ')
    .trim()
    .split(/\s+/);
  const compounds: Compound[] = [];
  const combinators: string[] = [];
  for (const token of tokens) {
    if (token === '>') combinators[compounds.length - 1] = '>';
    else {
      if (compounds.length && combinators[compounds.length - 1] === undefined) {
        combinators[compounds.length - 1] = ' ';
      }
      compounds.push(parseCompound(token));
    }
  }
  const from = (candidate: FakeElement | null, index: number): boolean => {
    const compound = compounds[index];
    if (!candidate || !compound || !matchesCompound(candidate, compound)) return false;
    if (index === 0) return true;
    if (combinators[index - 1] === '>') return from(candidate.parentElement, index - 1);
    for (let up = candidate.parentElement; up; up = up.parentElement) {
      if (from(up, index - 1)) return true;
    }
    return false;
  };
  return from(element, compounds.length - 1);
}

// Inline styles: properties as fields, and custom properties through setProperty.
class FakeStyle {
  [property: string]: unknown;

  setProperty(name: string, value: string): void {
    this[name] = value;
  }

  getPropertyValue(name: string): string {
    return String(this[name] ?? '');
  }
}

const FAKE_LINE_PX = 20;
const FAKE_LINE_CHARS = 60;
const FAKE_PAGE_PX = 1056;
const FAKE_BLOCKS = new Set(['DIV', 'P', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'HR', 'FIGURE']);

interface FakeRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

class FakeElement extends FakeNode {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly style = new FakeStyle();
  readonly isSvg: boolean;
  checked = false;
  value = '';
  clientWidth = 0;
  rect: FakeRect = { top: 0, left: 0, width: 0, height: 0 };
  readonly scrolledIntoView: Array<Record<string, unknown>> = [];
  // Opened with showModal() (UAT-RD RD-7: notices wait for a modal dialog to close).
  modal = false;
  private text = '';
  private explicitClientHeight: number | null = null;

  constructor(tag: string, svg = false) {
    super();
    this.isSvg = svg;
    this.tagName = svg ? tag : tag.toUpperCase();
  }

  readonly classList = {
    contains: (name: string): boolean => this.classNames().includes(name),
    add: (...names: string[]): void => {
      this.setAttribute('class', [...new Set([...this.classNames(), ...names])].join(' '));
    },
    remove: (...names: string[]): void => {
      this.setAttribute(
        'class',
        this.classNames()
          .filter((name) => !names.includes(name))
          .join(' '),
      );
    },
    toggle: (name: string, force?: boolean): boolean => {
      const on = force ?? !this.classList.contains(name);
      if (on) this.classList.add(name);
      else this.classList.remove(name);
      return on;
    },
  };

  private classNames(): string[] {
    return (this.attributes.get('class') ?? '').split(/\s+/).filter(Boolean);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, String(value));
    if (name === 'value') this.value = String(value);
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  get textContent(): string {
    return this.children.length
      ? this.children.map((child) => child.textContent).join('')
      : this.text;
  }

  set textContent(value: string) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.text = String(value);
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }

  prepend(...nodes: FakeElement[]): void {
    for (const node of [...nodes].reverse()) {
      node.remove();
      node.parent = this;
      this.children.unshift(node);
    }
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  get isConnected(): boolean {
    return this.ownerDocument() !== null;
  }

  ownerDocument(): FakeDocument | null {
    let node: FakeNode | null = this;
    while (node?.parent) node = node.parent;
    return node instanceof FakeDocument ? node : null;
  }

  matches(selector: string): boolean {
    return splitTopLevel(selector, ',').some((complex) => matchesComplex(this, complex));
  }

  closest(selector: string): FakeElement | null {
    for (let element: FakeElement | null = this; element; element = element.parentElement) {
      if (element.matches(selector)) return element;
    }
    return null;
  }

  contains(node: FakeNode | null): boolean {
    for (let item: FakeNode | null = node; item; item = item.parent) if (item === this) return true;
    return false;
  }

  cloneNode(deep = false): FakeElement {
    const copy = new FakeElement(
      this.isSvg ? this.tagName : this.tagName.toLowerCase(),
      this.isSvg,
    );
    for (const [name, value] of this.attributes) copy.setAttribute(name, value);
    copy.checked = this.checked;
    copy.value = this.value;
    if (!this.children.length) copy.textContent = this.text;
    if (deep) for (const child of this.children) copy.append(child.cloneNode(true));
    return copy;
  }

  // Rendered: not hidden, not display none, and not inside a closed details (its summary shows).
  checkVisibility(): boolean {
    for (let element: FakeElement | null = this; element; element = element.parentElement) {
      if (element.hasAttribute('hidden') || element.style.display === 'none') return false;
      const parent = element.parentElement;
      if (
        parent?.tagName === 'DETAILS' &&
        !parent.hasAttribute('open') &&
        element.tagName !== 'SUMMARY'
      )
        return false;
    }
    return true;
  }

  getBoundingClientRect(): FakeRect & { right: number; bottom: number; x: number; y: number } {
    const { top, left, width, height } = this.rect;
    return { top, left, width, height, right: left + width, bottom: top + height, x: left, y: top };
  }

  get offsetHeight(): number {
    if (this.hasAttribute('hidden')) return 0;
    const blocks = this.children.filter((child) => FAKE_BLOCKS.has(child.tagName));
    if (blocks.length) return blocks.reduce((sum, child) => sum + child.offsetHeight, 0);
    if (this.tagName === 'HR') return FAKE_LINE_PX;
    const words = this.textContent.trim();
    return words ? Math.ceil(words.length / FAKE_LINE_CHARS) * FAKE_LINE_PX : 0;
  }

  get clientHeight(): number {
    if (this.explicitClientHeight !== null) return this.explicitClientHeight;
    return this.classList.contains('paper-content') ? FAKE_PAGE_PX : 0;
  }

  set clientHeight(value: number) {
    this.explicitClientHeight = value;
  }

  // Focus moves the document's activeElement and fires focusout and focusin, as a browser does.
  focus(): void {
    const document = this.ownerDocument();
    if (!document) return;
    const previous = document.activeElement;
    if (previous === this) return;
    document.activeElement = this;
    previous?.dispatchEvent(new FakeEvent('focusout', { bubbles: true, relatedTarget: this }));
    this.dispatchEvent(new FakeEvent('focusin', { bubbles: true, relatedTarget: previous }));
  }

  scrollIntoView(options: Record<string, unknown> = {}): void {
    this.scrolledIntoView.push(options);
  }

  get open(): boolean {
    return this.hasAttribute('open');
  }

  set open(value: boolean) {
    if (value) this.setAttribute('open', '');
    else this.removeAttribute('open');
  }

  // A modal dialog: open, then focus its autofocus control or its first shown button.
  showModal(): void {
    this.modal = true;
    this.setAttribute('open', '');
    const buttons = this.querySelectorAll('button').filter((button) => button.checkVisibility());
    (buttons.find((button) => button.hasAttribute('autofocus')) ?? buttons[0])?.focus();
  }

  close(): void {
    if (!this.hasAttribute('open')) return;
    this.modal = false;
    this.removeAttribute('open');
    this.dispatchEvent(new FakeEvent('close'));
  }
}

class FakeDocument extends FakeNode {
  readyState = 'complete';
  // True while a pointer press moves focus, so :focus-visible does not match.
  pointerFocus = false;
  readonly documentElement = new FakeElement('html');
  readonly body = new FakeElement('body');
  activeElement: FakeElement | null;

  constructor() {
    super();
    this.documentElement.parent = this;
    this.children = [this.documentElement];
    this.documentElement.append(this.body);
    this.activeElement = this.body;
  }

  createElement(tag: string): FakeElement {
    return new FakeElement(tag);
  }

  createElementNS(_namespace: string, tag: string): FakeElement {
    return new FakeElement(tag, true);
  }

  createTextNode(words: string): FakeElement {
    return text(words);
  }

  getElementById(id: string): FakeElement | null {
    return this.querySelector(`#${id}`);
  }
}

type Child = FakeElement | string;

// A text node: an element named #text, so it never matches a selector.
function text(words: string): FakeElement {
  const node = new FakeElement('#text');
  node.textContent = words;
  return node;
}

// h('a', { class: 'kpi', href: '#' }, h('span', {}, 'Roles found')): a lone string child is the
// text; strings beside elements become text nodes.
function h(
  tag: string,
  attributes: Record<string, string | boolean> = {},
  ...children: Child[]
): FakeElement {
  const element = new FakeElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'checked') element.checked = value === true;
    else if (value !== false) element.setAttribute(name, value === true ? '' : value);
  }
  const mixed = children.length > 1;
  for (const child of children) {
    if (typeof child === 'string') {
      if (mixed) element.append(text(child));
      else element.textContent = child;
    } else element.append(child);
  }
  return element;
}

interface TourApi {
  start: (name?: string, options?: { opener?: FakeElement }) => boolean;
  maybeStart: (name?: string, options?: { from?: string }) => boolean;
  end: (reason?: string) => boolean;
  next: () => void;
  back: () => void;
  steps: (name?: string) => FakeElement[];
  available: (name?: string) => boolean;
  sync: () => void;
  page: () => string;
  readonly active: boolean;
  readonly step: number;
}

interface PaperResult {
  pages: number;
  limit: number;
  over: boolean;
  overflowLines: number;
  text: string;
}

interface TrackerHandle {
  render: () => unknown;
  stop: () => void;
  readonly runId: string | null;
  readonly active: boolean;
}

interface ComponentsApi {
  init: (root?: FakeNode) => void;
  openDrawer: (dialog: FakeElement | null, opener?: FakeElement) => void;
  closeDrawer: (dialog: FakeElement | null) => void;
  syncFlowCounts: (scope?: FakeNode) => void;
  storeReady: () => boolean;
  matchQuickPick: (group: FakeElement | null, address: string) => FakeElement | null;
  tip: { show: (trigger: FakeElement) => boolean; hide: () => void; id: string };
  allowance: {
    set: (meter: FakeElement, values: Record<string, unknown>) => Record<string, number | null>;
    draw: (ring: FakeElement) => void;
  };
  donut: { draw: (donut: FakeElement) => void };
  runTracker: (
    host: FakeElement | null,
    runId?: string,
    options?: Record<string, unknown>,
  ) => TrackerHandle | null;
  announce: (words: string, near?: FakeElement | null) => boolean;
  flagNew: (rows: FakeElement | FakeElement[]) => number;
  list: {
    init: (toolbar: FakeElement) => void;
    refresh: (
      toolbar: FakeElement,
      options?: { announce?: boolean },
    ) => { shown: number; total: number; text: string } | null;
  };
  paper: {
    markdown: (source: string) => FakeElement[];
    render: (stack: FakeElement, source: string, options?: Record<string, unknown>) => PaperResult;
    print: (stack: FakeElement) => boolean;
    text: (blocks: FakeElement[]) => string;
  };
  preview: {
    open: (options: Record<string, unknown>, opener?: FakeElement) => { pages: number };
    close: () => void;
    page: (index: number) => void;
    view: (name: string) => void;
  };
  tour: TourApi;
  // Round 5.
  palette: {
    tones: Record<string, string>;
    parts: Record<string, string>;
    left: Record<string, string>;
    series: string[];
  };
  download: ((doc: Record<string, unknown>, format?: string) => DownloadResult) & {
    build: (doc: Record<string, unknown>, format?: string) => DownloadFile;
    fileName: (title: string, extension: string) => string;
    note: string;
  };
  downloadMenu: (
    host: FakeElement | null,
    source: unknown,
    options?: Record<string, unknown>,
  ) => { menu: FakeElement; close: () => void } | null;
  usageChart: (
    host: FakeElement | null,
    options: Record<string, unknown>,
  ) => {
    chart: FakeElement;
    groups: Array<Record<string, unknown>>;
    total: number;
    top: number;
  } | null;
  formScan: (
    host: FakeElement | null,
    fields: Array<Record<string, unknown>>,
    options?: Record<string, unknown>,
  ) => {
    play: () => string;
    finish: (options?: { quiet?: boolean }) => string;
    stop: () => void;
    readonly stage: string;
  } | null;
  secretField: (
    host: FakeElement | null,
    options: Record<string, unknown>,
  ) => { hide: () => void; readonly shown: boolean } | null;
  pagination: (
    host: FakeElement | null,
    options: Record<string, unknown>,
  ) => {
    render: (next?: Record<string, unknown>) => { page: number; pages: number };
    readonly page: number;
    readonly pages: number;
  } | null;
  agreementBanner: (
    host: FakeElement | null,
    options?: Record<string, unknown>,
  ) => { render: () => boolean; readonly paused: boolean } | null;
  // Round 6 (R6-4 and the background notices).
  topWithOther: (
    list: Array<Record<string, unknown>>,
    options?: Record<string, unknown>,
  ) => {
    top: Array<{ item: Record<string, unknown>; value: number; label: string; key: string }>;
    other: { label: string; value: number; count: number; items: unknown[] } | null;
    total: number;
    all: Array<{ key: string; value: number }>;
  };
  seeAll: {
    open: (
      options: Record<string, unknown>,
      opener?: FakeElement,
    ) => { drawer: FakeElement; close: () => void };
    close: () => void;
  };
  multiSelect: (
    host: FakeElement | null,
    options: Record<string, unknown>,
  ) => {
    root: FakeElement;
    readonly values: string[];
    readonly isOpen: boolean;
    set: (values: string[]) => void;
    setOptions: (options: Array<Record<string, unknown>>) => void;
    open: () => void;
    close: () => void;
    destroy: () => void;
  } | null;
  stackedBars: (
    host: FakeElement | null,
    options: Record<string, unknown>,
  ) => { chart: FakeElement; series: Array<Record<string, unknown>>; total: number } | null;
  scoreTrend: (
    host: FakeElement | null,
    options: Record<string, unknown>,
  ) => { chart: FakeElement; points: Array<Record<string, unknown>>; lo: number } | null;
  notice: ((options: Record<string, unknown>) => {
    element: FakeElement | null;
    close: () => void;
  }) & { close: () => void };
}

interface DownloadFile {
  ok: boolean;
  reason?: string;
  name?: string;
  type?: string;
  bytes?: Uint8Array;
  text?: string;
  pages?: number | null;
}

interface DownloadResult {
  ok: boolean;
  reason?: string;
  name?: string;
  pages?: number | null;
  size?: number;
}

interface FakeStore {
  counts: unknown;
  listeners: Array<() => void>;
  flowCounts?: () => unknown;
  subscribe: (listener: () => void) => () => void;
  [extra: string]: unknown;
}

function fakeStore(counts: unknown, { withCounts = true } = {}): FakeStore {
  const store: FakeStore = {
    counts,
    listeners: [],
    subscribe: (listener) => {
      store.listeners.push(listener);
      return () => undefined;
    },
  };
  if (withCounts) store.flowCounts = () => store.counts;
  return store;
}

interface FakeObserverRecord {
  callback: () => void;
  disconnected: boolean;
  target: unknown;
  options: { attributeFilter?: string[]; childList?: boolean } | undefined;
}

interface FakeResizeRecord {
  callback: () => void;
  targets: unknown[];
}

interface Loaded {
  api: ComponentsApi;
  document: FakeDocument;
  window: Record<string, unknown>;
  timers: Array<{ ms: number; run: () => void; cleared?: boolean }>;
  frames: Array<() => void>;
  observers: FakeObserverRecord[];
  resizeObservers: FakeResizeRecord[];
  reads: string[];
  scrolls: Array<{ top: number; behavior: string }>;
  windowListeners: Map<string, Array<() => void>>;
  printed: { count: number };
}

// The window properties the sandbox provides; app-components.js may add only JobDeputyComponents.
const FAKE_WINDOW_KEYS = [
  'localStorage',
  'setTimeout',
  'clearTimeout',
  'innerWidth',
  'innerHeight',
  'scrollY',
  'location',
  'matchMedia',
  'requestAnimationFrame',
  'addEventListener',
  'scrollTo',
  'print',
];

// What getComputedStyle reports: the inline position and radius, and paper-page padding.
function fakeComputedStyle(element: FakeElement): Record<string, string> {
  const page = element.classList.contains('paper-content');
  return {
    direction: 'ltr',
    position: String(element.style.position ?? ''),
    paddingTop: page ? '72px' : '0px',
    paddingBottom: page ? '72px' : '0px',
    lineHeight: `${FAKE_LINE_PX}px`,
    borderTopLeftRadius: String(element.style.borderRadius ?? '0px'),
  };
}

function load({
  build,
  store,
  stored = {},
  deputy,
  readyState = 'complete',
  loaderActive = false,
  media = [],
  search = '',
  size = [1440, 900],
  globals = {},
}: {
  build?: (body: FakeElement) => void;
  store?: FakeStore;
  stored?: Record<string, string>;
  deputy?: Record<string, unknown>;
  readyState?: string;
  loaderActive?: boolean;
  media?: string[];
  search?: string;
  size?: [number, number];
  // Extra globals for the script's context (round 5: Blob and URL for a download).
  globals?: Record<string, unknown>;
} = {}): Loaded {
  const document = new FakeDocument();
  document.readyState = readyState;
  if (loaderActive) document.body.setAttribute('class', 'loader-active');
  build?.(document.body);
  const timers: Loaded['timers'] = [];
  const frames: Loaded['frames'] = [];
  const observers: Loaded['observers'] = [];
  const resizeObservers: Loaded['resizeObservers'] = [];
  const reads: string[] = [];
  const scrolls: Loaded['scrolls'] = [];
  const windowListeners: Loaded['windowListeners'] = new Map();
  const printed = { count: 0 };
  const storage = new Map(Object.entries(stored));
  const window: Record<string, unknown> = {
    localStorage: {
      getItem: (key: string) => {
        reads.push(key);
        return storage.get(key) ?? null;
      },
    },
    setTimeout: (run: () => void, ms: number) => {
      timers.push({ run, ms });
      return timers.length;
    },
    clearTimeout: (id: number) => {
      const timer = timers[id - 1];
      if (timer) timer.cleared = true;
    },
    innerWidth: size[0],
    innerHeight: size[1],
    scrollY: 0,
    location: { search, pathname: '/brand/components-preview.html' },
    matchMedia: (query: string) => ({ matches: media.includes(query) }),
    requestAnimationFrame: (run: () => void) => {
      frames.push(run);
      return frames.length;
    },
    addEventListener: (type: string, run: () => void) => {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), run]);
    },
    scrollTo: (options: { top: number; behavior: string }) => {
      scrolls.push(options);
      window.scrollY = options.top;
    },
    print: () => {
      printed.count += 1;
    },
  };
  if (store) window.JobDeputyStore = store;
  if (deputy) window.JobDeputyDeputy = deputy;
  class FakeObserver implements FakeObserverRecord {
    callback: () => void;
    disconnected = false;
    target: unknown = null;
    options: FakeObserverRecord['options'] = undefined;
    constructor(callback: () => void) {
      this.callback = callback;
      observers.push(this);
    }
    observe(target: unknown, options: FakeObserverRecord['options']): void {
      this.target = target;
      this.options = options;
    }
    disconnect(): void {
      this.disconnected = true;
    }
  }
  class FakeResizeObserver implements FakeResizeRecord {
    callback: () => void;
    targets: unknown[] = [];
    constructor(callback: () => void) {
      this.callback = callback;
      resizeObservers.push(this);
    }
    observe(target: unknown): void {
      this.targets.push(target);
    }
    disconnect(): void {
      this.targets = [];
    }
  }
  // A dialog element is an HTMLDialogElement, so the drawer helpers accept it.
  const FakeDialogElement = {
    [Symbol.hasInstance]: (value: unknown): boolean =>
      value instanceof FakeElement && value.tagName === 'DIALOG',
  };
  new Script(script, { filename: scriptFile }).runInNewContext({
    window,
    document,
    Element: FakeElement,
    HTMLElement: FakeElement,
    HTMLDialogElement: FakeDialogElement,
    CustomEvent: FakeEvent,
    MutationObserver: FakeObserver,
    ResizeObserver: FakeResizeObserver,
    getComputedStyle: fakeComputedStyle,
    // Round 7: the place helper reads and writes addresses as a browser does.
    URLSearchParams,
    ...globals,
  });
  return {
    api: window.JobDeputyComponents as ComponentsApi,
    document,
    window,
    timers,
    frames,
    observers,
    resizeObservers,
    reads,
    scrolls,
    windowListeners,
    printed,
  };
}

// Runs the timers and frames that are due, in order, until none are left (or a limit).
function flush(loaded: Loaded, { frames = true, timers = true } = {}): void {
  for (let round = 0; round < 50; round += 1) {
    const due = [
      ...(frames ? loaded.frames.splice(0) : []),
      ...(timers
        ? loaded.timers
            .filter((timer) => !timer.cleared && !('done' in timer))
            .map((timer) => {
              Object.assign(timer, { done: true });
              return timer.run;
            })
        : []),
    ];
    if (!due.length) return;
    for (const run of due) run();
  }
}

const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const attribute = (element: FakeElement | null | undefined, name: string): string =>
  element?.getAttribute(name) ?? '';

describe('app-components.js', () => {
  it('parses as a classic script and adds only window.JobDeputyComponents', () => {
    const { window, document } = load();
    expect(Object.keys(window).filter((key) => !FAKE_WINDOW_KEYS.includes(key))).toEqual([
      'JobDeputyComponents',
    ]);
    expect(Object.keys(window.JobDeputyComponents as object).sort()).toEqual([
      'agreementBanner',
      'allowance',
      // Round 7 (D10): the runs and tokens rings.
      'allowanceRings',
      'announce',
      // Round 7 (R10-1): boot without flicker.
      'boot',
      'closeDrawer',
      'donut',
      'download',
      'downloadMenu',
      // Round 7 (R10-7): the live filter bar.
      'filterBar',
      'flagNew',
      'formScan',
      'init',
      'list',
      'matchQuickPick',
      // Round 7 (T3-19): elements kept in place on a store tick.
      'morph',
      // Round 6 (R6-4): the growing-list components.
      'multiSelect',
      'notice',
      'openDrawer',
      'pagination',
      'palette',
      'paper',
      // Round 7 (D9): every key, model, and task.
      'permutationsTable',
      // Round 7 (R10-3): return to where you were.
      'place',
      'preview',
      'runTracker',
      // Round 7 (D10): the runway in the store's words.
      'runwayLine',
      // Round 6 part 2 (N1).
      'scoreTrend',
      'secretField',
      'seeAll',
      'selectTab',
      'skeleton',
      'stackedBars',
      // Round 7 (T3-1): the chrome's store-backed words, drawn as the later scripts run.
      'storeReady',
      'syncFlowCounts',
      // Round 7 (D10): the time range picker.
      'timeRange',
      'tip',
      'topWithOther',
      'tour',
      'usageChart',
    ]);
    expect(Object.isFrozen(window.JobDeputyComponents)).toBe(true);
    expect([...document.listeners.keys()].sort()).toEqual([
      'change',
      'click',
      'close',
      'focusin',
      'focusout',
      'keydown',
      'pointerdown',
      'pointerout',
      'pointerover',
      // Round 6 (UAT-RM RM-8): a chart table that opens says when it scrolls sideways.
      'toggle',
    ]);
  });

  it('implements the ARIA tabs keys and the drawer helpers', () => {
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(script).toContain(`'${key}'`);
    }
    expect(script).toContain('[role="tablist"][data-tabs]');
    expect(script).toContain('aria-selected');
    expect(script).toMatch(/tabIndex = selected \? 0 : -1/);
    expect(script).toMatch(/panel\.hidden = !selected/);
    expect(script).toContain('[data-drawer-open]');
    expect(script).toContain('[data-drawer-close]');
    expect(script).toContain('showModal()');
    expect(script).toMatch(/opener\?\.isConnected\) opener\.focus\(\)/);
    expect(script).toContain('const opener = openerAgain(dialog, openers.get(dialog));');
  });

  it('keeps keyboard focus in a drawer clear of its sticky header and footer (WCAG 2.4.11)', () => {
    const size = { header: 89, footer: 77 };
    const sized = (element: FakeElement, height: () => number, rect: FakeRect): FakeElement => {
      Object.defineProperty(element, 'offsetHeight', {
        get: () => (element.hasAttribute('hidden') ? 0 : height()),
      });
      element.rect = rect;
      return element;
    };
    const field = (id: string, top: number): FakeElement => {
      const input = h('input', { id, type: 'text' });
      input.rect = { top, left: 834, width: 412, height: 44 };
      return input;
    };
    const { api, document, resizeObservers } = load({
      build: (body) => {
        body.append(
          h('button', { type: 'button', id: 'opener', 'data-drawer-open': 'details' }, 'Details'),
          h(
            'dialog',
            { class: 'drawer', id: 'details' },
            sized(
              h(
                'div',
                { class: 'drawer-header' },
                h('h2', {}, 'Details'),
                h('button', { type: 'button', id: 'close', 'data-drawer-close': true }, 'Close'),
              ),
              () => size.header,
              { top: 0, left: 800, width: 480, height: 89 },
            ),
            h(
              'div',
              { class: 'drawer-body' },
              field('under-header', 80),
              field('ring-under-header', 92),
              field('just-clear', 94),
              field('clear', 300),
              field('under-footer', 620),
              sized(
                h('button', { type: 'button', id: 'button-under-footer' }, 'Withdraw'),
                () => 44,
                { top: 600, left: 834, width: 160, height: 44 },
              ),
            ),
            sized(
              h(
                'div',
                { class: 'drawer-footer' },
                h('button', { type: 'button', id: 'save' }, 'Save'),
              ),
              () => size.footer,
              { top: 643, left: 800, width: 480, height: 77 },
            ),
          ),
        );
      },
    });
    const dialog = document.querySelector('#details');
    const opener = document.querySelector('#opener');
    const header = dialog?.querySelector('.drawer-header');
    const footer = dialog?.querySelector('.drawer-footer');
    if (!dialog || !opener || !header || !footer) throw new Error('The drawer is missing');
    dialog.rect = { top: 0, left: 800, width: 480, height: 720 };
    const byId = (id: string): FakeElement => {
      const found = document.querySelector(`#${id}`);
      if (!found) throw new Error(`#${id} is missing`);
      return found;
    };
    const focus = (...ids: string[]): void => {
      for (const id of ids) byId(id).focus();
    };
    const scrolled = (): string[] =>
      dialog
        .querySelectorAll('input, button')
        .filter((control) => control.scrolledIntoView.length > 0)
        .map((control) => attribute(control, 'id'));

    // Opening pads the drawer by the header's and footer's heights plus 13px, and watches both.
    opener.focus();
    opener.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(byId('close'));
    expect(dialog.style.scrollPaddingTop).toBe('102px');
    expect(dialog.style.scrollPaddingBottom).toBe('90px');
    expect(resizeObservers).toHaveLength(1);
    const watched = resizeObservers[0]?.targets ?? [];
    expect(watched).toHaveLength(3);
    expect(watched[0]).toBe(dialog);
    expect(watched[1]).toBe(header);
    expect(watched[2]).toBe(footer);

    // Keyboard focus under either part, its 5px focus ring included, scrolls to the nearest edge;
    // focus already clear, or in the header or footer, stays put.
    focus('clear', 'just-clear', 'save', 'under-header', 'ring-under-header', 'under-footer');
    focus('button-under-footer');
    expect(scrolled()).toEqual([
      'under-header',
      'ring-under-header',
      'under-footer',
      'button-under-footer',
    ]);
    expect(byId('under-footer').scrolledIntoView).toEqual([{ block: 'nearest' }]);

    // A pointer press that focuses a button is left where it is, so its click lands; a field you
    // type into still scrolls clear, as its focus is the point of the press.
    document.pointerFocus = true;
    focus('clear', 'button-under-footer', 'under-footer');
    document.pointerFocus = false;
    expect(byId('button-under-footer').scrolledIntoView).toHaveLength(1);
    expect(byId('under-footer').scrolledIntoView).toHaveLength(2);

    // The padding follows the parts as they change size, and a hidden footer takes no room.
    size.header = 120;
    header.rect = { top: 0, left: 800, width: 480, height: 120 };
    footer.setAttribute('hidden', '');
    resizeObservers[0]?.callback();
    expect(dialog.style.scrollPaddingTop).toBe('133px');
    expect(dialog.style.scrollPaddingBottom).toBe('13px');
    focus('just-clear', 'under-footer');
    expect(byId('just-clear').scrolledIntoView).toEqual([{ block: 'nearest' }]);
    expect(byId('under-footer').scrolledIntoView).toHaveLength(2);

    // Closing returns focus to the opener; opening again (twice) adds no second listener or
    // observer, so JobDeputyPanels.keepFocusClear after this changes nothing.
    api.closeDrawer(dialog);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    api.openDrawer(dialog, opener);
    api.openDrawer(dialog, opener);
    expect(dialog.open).toBe(true);
    expect(dialog.listeners.get('focusin')).toHaveLength(1);
    expect(resizeObservers).toHaveLength(1);
    // A page that draws the opener again while the drawer is open (a purchase redraws the
    // Dashboard's Get more runs, T5-4, R9-3) gets focus back on the control with its key.
    opener.setAttribute('data-focus-key', 'details-open');
    const again = h('button', { type: 'button', 'data-focus-key': 'details-open' }, 'Details');
    opener.remove();
    document.body.append(again);
    api.closeDrawer(dialog);
    expect(document.activeElement).toBe(again);
    // On a short screen the header stops sticking while you type (T5-5), and then the drawer's
    // scroll padding leaves it out.
    expect(script).toContain("return getComputedStyle(part).position === 'static' ? null : part;");
  });

  it('reads one stored value, Pause motion, and writes nothing, fetches nothing, and never loops', () => {
    // Round 7 (R10-3): the one exception is your place, kept in sessionStorage per page
    // (jobdeputy.place.<page>) and the mark of a return through Back (jobdeputy.place.returning),
    // all through one helper; localStorage is still only read, and only for Pause motion.
    expect(script).not.toMatch(
      /fetch\(|XMLHttpRequest|setInterval|localStorage\.(?:setItem|removeItem)/,
    );
    expect(script.match(/window\.sessionStorage/g)).toHaveLength(1);
    expect(script).toContain('return window.sessionStorage ?? null;');
    expect(
      [...script.matchAll(/\.(setItem|removeItem)\(\s*([^,)]+)/g)].map((match) => [
        match[1],
        match[2]?.replace(/\W/g, ''),
      ]),
    ).toEqual([
      ['setItem', 'PLACE_PREFIXpageFile'],
      ['setItem', 'PLACE_RETURNING'],
      ['removeItem', 'PLACE_RETURNING'],
    ]);
    expect(script).toContain("const PLACE_PREFIX = 'jobdeputy.place.';");
    expect(script).toContain("const PLACE_RETURNING = 'jobdeputy.place.returning';");
    expect(
      [...script.matchAll(/localStorage\.(\w+)\(([^)]*)\)/g)].map((match) => match.slice(1)),
    ).toEqual([['getItem', 'MOTION_KEY']]);
    expect(script).toContain("const MOTION_KEY = 'jobdeputy.deputyMotion';");
    // Once as it loads, and again at start, when deputy.js may already say.
    expect([...new Set(load().reads)]).toEqual(['jobdeputy.deputyMotion']);
  });

  it('starts on DOMContentLoaded while the page is still loading', () => {
    const { document, timers } = load({
      readyState: 'loading',
      build: (body) => body.append(h('span', { class: 'sparkline', 'data-values': '1,2' })),
    });
    expect(document.querySelector('.sparkline-art')).toBeNull();
    expect(timers).toEqual([]);
    document.dispatchEvent(new FakeEvent('DOMContentLoaded'));
    expect(document.querySelector('.sparkline-art')).not.toBeNull();
    expect(timers.map((timer) => timer.ms)).toEqual([1618]);
  });
});

describe('app-components.js · the flow ribbon counts', () => {
  const ribbon = (body: FakeElement): void => {
    const step = (href: string, label: string, key: string, seed: string): FakeElement =>
      h(
        'li',
        {},
        h(
          'a',
          { class: 'flow-ribbon-step', href },
          h('span', { class: 'flow-ribbon-label' }, label),
          h('span', { class: 'flow-ribbon-count', 'data-flow-count': key }, seed),
        ),
      );
    body.append(
      h(
        'nav',
        { class: 'flow-ribbon', 'aria-label': 'How roles move' },
        h(
          'ol',
          { class: 'flow-ribbon-list' },
          step('./searches-preview.html', 'Searches', 'sources', '6 sources'),
          step('./jobs-preview.html', 'Job matches', 'matches', '6 found'),
          step('./applications-preview.html', 'Applications', 'tracked', '8 tracked'),
        ),
      ),
    );
  };
  const counts = (document: FakeDocument): string[] =>
    document.querySelectorAll('[data-flow-count]').map((element) => element.textContent);

  it('keeps the seed text without the store, or without flowCounts', () => {
    expect(counts(load({ build: ribbon }).document)).toEqual(['6 sources', '6 found', '8 tracked']);
    const store = fakeStore({ sources: 1, matches: 1, tracked: 1 }, { withCounts: false });
    expect(counts(load({ build: ribbon, store }).document)).toEqual([
      '6 sources',
      '6 found',
      '8 tracked',
    ]);
  });

  // Round 6 part 2 (P-5): the current step names itself only; the page shows its own count.
  it('shows no count on the current step, and keeps the others’ counts', () => {
    expect(
      declared(
        componentRules,
        '.flow-ribbon-step[aria-current="page"] .flow-ribbon-count',
        'display',
      ),
    ).toBe('none');
    expect(declared(componentRules, '.flow-ribbon-count', 'display')).toBeUndefined();
  });

  it('fills the counts from JobDeputyStore.flowCounts(), with one source in the singular', () => {
    const store = fakeStore({ sources: 1, matches: 12, tracked: 9 });
    expect(counts(load({ build: ribbon, store }).document)).toEqual([
      '1 source',
      '12 found',
      '9 tracked',
    ]);
  });

  it('follows every store change through one subscription', () => {
    const store = fakeStore({ sources: 6, matches: 6, tracked: 8 });
    const { document, api } = load({ build: ribbon, store });
    api.init(document);
    expect(store.listeners).toHaveLength(1);
    store.counts = { sources: 7, matches: 5, tracked: 9 };
    for (const listener of store.listeners) listener();
    expect(counts(document)).toEqual(['7 sources', '5 found', '9 tracked']);
  });

  it('draws the counts as soon as the store is there, before the first paint (T3-1)', () => {
    const store = fakeStore({ sources: 2, matches: 3, tracked: 4 });
    const loaded = load({ build: ribbon, store });
    store.counts = { sources: 5, matches: 3, tracked: 4 };
    expect(loaded.api.storeReady()).toBe(true);
    expect(counts(loaded.document)).toEqual(['5 sources', '3 found', '4 tracked']);
    // The shared scripts after the store call it as they run.
    expect(sourceFor('deputy.js')).toContain('window.JobDeputyComponents?.storeReady?.();');
  });

  it('treats anything but a node as the whole page, so it can be a store listener', () => {
    const store = fakeStore({ sources: 2, matches: 3, tracked: 4 });
    const loaded = load({ build: ribbon, store });
    store.counts = { sources: 3, matches: 3, tracked: 4 };
    // The arguments a JobDeputyStore.subscribe listener receives: the state and the change.
    expect(() => loaded.api.syncFlowCounts({ version: 1 } as unknown as FakeNode)).not.toThrow();
    expect(counts(loaded.document)).toEqual(['3 sources', '3 found', '4 tracked']);
    expect(() => loaded.api.init('#main' as unknown as FakeNode)).not.toThrow();
  });

  it('keeps the text shown for a missing, negative, or fractional count, or a failing store', () => {
    const store = fakeStore({ sources: -1, matches: 2.5, tracked: '8' });
    expect(counts(load({ build: ribbon, store }).document)).toEqual([
      '6 sources',
      '6 found',
      '8 tracked',
    ]);
    const failing = fakeStore(null);
    failing.flowCounts = () => {
      throw new Error('storage unavailable');
    };
    expect(counts(load({ build: ribbon, store: failing }).document)).toEqual([
      '6 sources',
      '6 found',
      '8 tracked',
    ]);
  });
});

describe('app-components.js · the footer’s home Region (R9-6)', () => {
  const footer = (body: FakeElement): void => {
    body.append(
      h(
        'div',
        { class: 'footer-secondary' },
        h(
          'span',
          {},
          h('strong', {}, 'United States home Region'),
          ' · Your profile, searches, and stored keys stay encrypted here.',
        ),
      ),
    );
  };
  const line = (document: FakeDocument): string | undefined =>
    document.querySelector('.footer-secondary strong')?.textContent;

  it('keeps the markup’s words without the store, or without homeRegion', () => {
    expect(line(load({ build: footer }).document)).toBe('United States home Region');
    const store = fakeStore(null, { withCounts: false });
    expect(line(load({ build: footer, store }).document)).toBe('United States home Region');
  });

  it('names the account’s home Region, and follows a change', () => {
    const store = fakeStore(null, { withCounts: false });
    store.homeRegion = () => ({ code: 'UK', name: 'United Kingdom', short: 'UK' });
    const loaded = load({ build: footer, store });
    expect(line(loaded.document)).toBe('United Kingdom home Region');
    store.homeRegion = () => ({ code: 'IN', name: 'India', short: 'IN' });
    for (const listener of store.listeners) listener();
    expect(line(loaded.document)).toBe('India home Region');
    // An unknown code, or a store that throws, leaves the words as they are.
    store.homeRegion = () => ({ code: 'ZZ' });
    for (const listener of store.listeners) listener();
    expect(line(loaded.document)).toBe('India home Region');
    store.homeRegion = () => {
      throw new Error('storage unavailable');
    };
    expect(() => {
      for (const listener of store.listeners) listener();
    }).not.toThrow();
    expect(line(loaded.document)).toBe('India home Region');
  });
});

describe('app-components.js · sparklines', () => {
  const spark = (values: string, size?: [number, number]) =>
    load({
      build: (body) => {
        const host = h('span', { class: 'sparkline', 'data-values': values });
        if (size) [host.clientWidth, host.clientHeight] = size;
        body.append(host);
      },
    });
  const art = (loaded: Loaded): FakeElement | null =>
    loaded.document.querySelector('.sparkline > svg');

  it('draws an aria-hidden line and an end dot in the 89 by 34 box, without axes', () => {
    const drawn = art(spark('3,3,6,4,8,9,12'));
    expect(attribute(drawn, 'class')).toBe('sparkline-art');
    expect(attribute(drawn, 'aria-hidden')).toBe('true');
    expect(attribute(drawn, 'focusable')).toBe('false');
    expect(attribute(drawn, 'viewBox')).toBe('0 0 89 34');
    const line = drawn?.querySelector('.sparkline-line');
    expect(attribute(line, 'd')).toMatch(/^M5 29 L18\.17 29 L31\.33 21 .* L84 5$/);
    const dot = drawn?.querySelector('.sparkline-dot');
    expect([attribute(dot, 'cx'), attribute(dot, 'cy'), attribute(dot, 'r')]).toEqual([
      '84',
      '5',
      '4',
    ]);
    expect(drawn?.children.map((child) => attribute(child, 'class'))).toEqual([
      'sparkline-line',
      'sparkline-dot',
    ]);
  });

  it('draws in the host’s own pixel box when it has one', () => {
    expect(attribute(art(spark('1,2', [144, 55])), 'viewBox')).toBe('0 0 144 55');
  });

  it('puts zero on the baseline, a flat series at mid-height, and one value as a dot', () => {
    expect(attribute(art(spark('0,0,0'))?.querySelector('.sparkline-dot'), 'cy')).toBe('29');
    expect(attribute(art(spark('4,4,4'))?.querySelector('.sparkline-dot'), 'cy')).toBe('17');
    const single = art(spark('3'));
    expect(single?.querySelector('.sparkline-line')).toBeNull();
    expect(attribute(single?.querySelector('.sparkline-dot'), 'cx')).toBe('84');
    expect(art(spark(''))).toBeNull();
    expect(attribute(art(spark('2, x, 5'))?.querySelector('.sparkline-line'), 'd')).toBe(
      'M5 29 L84 5',
    );
  });

  it('draws again only when the values change', () => {
    const loaded = spark('3,6');
    const first = art(loaded);
    loaded.api.init();
    expect(art(loaded)).toBe(first);
    loaded.document.querySelector('.sparkline')?.setAttribute('data-values', '6,3');
    loaded.api.init();
    expect(art(loaded)).not.toBe(first);
    expect(loaded.document.querySelectorAll('.sparkline-art')).toHaveLength(1);
  });
});

describe('app-components.js · donuts', () => {
  const item = (value: string, tone: string, href?: string): FakeElement =>
    h(
      'li',
      { 'data-value': value, 'data-tone': tone },
      href
        ? h(
            'a',
            { class: 'chart-legend-item', href },
            h('span', { class: 'chart-legend-label' }, value),
          )
        : h(
            'span',
            { class: 'chart-legend-item' },
            h('span', { class: 'chart-legend-label' }, value),
          ),
    );
  const donut = (...items: FakeElement[]) =>
    load({
      build: (body) =>
        body.append(
          h(
            'figure',
            { class: 'chart' },
            h(
              'div',
              { class: 'donut' },
              h('div', { class: 'donut-ring' }, h('p', { class: 'donut-total' }, '27')),
              h('ol', { class: 'chart-legend' }, ...items),
            ),
          ),
        ),
    });
  const sources = () =>
    donut(
      item('12', 'blue', './jobs-preview.html?source=google'),
      item('8', 'ink', './jobs-preview.html?source=microsoft'),
      item('0', 'orange', './searches-preview.html?source=acme'),
      item('4', 'purple'),
      item('3', 'quiet', './jobs-preview.html?source=workday'),
    );

  it('draws one segment per positive legend value, in legend order, into an aria-hidden ring', () => {
    const { document } = sources();
    const ring = document.querySelector('.donut-ring');
    const art = ring?.children[0];
    expect(attribute(art, 'class')).toBe('donut-art');
    expect(attribute(art, 'aria-hidden')).toBe('true');
    expect(attribute(art, 'viewBox')).toBe('0 0 100 100');
    const segments = document.querySelectorAll('.donut-seg');
    expect(segments.map((segment) => attribute(segment, 'data-index'))).toEqual([
      '0',
      '1',
      '3',
      '4',
    ]);
    // An unknown tone falls back to quiet; the text keeps the meaning either way.
    expect(segments.map((segment) => attribute(segment, 'data-tone'))).toEqual([
      'blue',
      'ink',
      'quiet',
      'quiet',
    ]);
    // Clockwise from the top: the first segment starts at (50, 2), on the 48-unit outer edge.
    expect(attribute(segments[0], 'd')).toMatch(/^M50 2A48 48 0 0 1 /);
  });

  it('links each segment whose legend item links, out of the tab order', () => {
    const links = sources().document.querySelectorAll('a.donut-link');
    expect(links.map((link) => [attribute(link, 'href'), attribute(link, 'tabindex')])).toEqual([
      ['./jobs-preview.html?source=google', '-1'],
      ['./jobs-preview.html?source=microsoft', '-1'],
      ['./jobs-preview.html?source=workday', '-1'],
    ]);
    expect(links.every((link) => link.children[0]?.classList.contains('donut-seg'))).toBe(true);
  });

  it('sweeps in once through an alpha mask, so forced colours keep the segments', () => {
    const { document } = sources();
    const mask = document.querySelector('mask');
    expect(attribute(mask, 'mask-type')).toBe('alpha');
    expect(attribute(document.querySelector('.donut-sweep'), 'pathLength')).toBe('100');
    expect(attribute(document.querySelector('g'), 'mask')).toBe(`url(#${attribute(mask, 'id')})`);
  });

  it('draws one value as the whole ring and nothing to draw as the track', () => {
    const whole = donut(item('12', 'blue')).document.querySelectorAll('.donut-seg');
    expect(whole).toHaveLength(1);
    expect(attribute(whole[0], 'fill-rule')).toBe('evenodd');
    const empty = donut(item('0', 'blue')).document;
    expect(empty.querySelectorAll('.donut-seg')).toHaveLength(0);
    expect(empty.querySelectorAll('.donut-track')).toHaveLength(1);
  });

  it('draws again only when the legend changes', () => {
    const loaded = sources();
    const first = loaded.document.querySelector('.donut-art');
    loaded.api.init();
    expect(loaded.document.querySelector('.donut-art')).toBe(first);
    loaded.document.querySelector('.chart-legend li')?.setAttribute('data-value', '13');
    loaded.api.init();
    expect(loaded.document.querySelector('.donut-art')).not.toBe(first);
    expect(loaded.document.querySelectorAll('.donut-art')).toHaveLength(1);
    expect(
      loaded.document.querySelectorAll('mask').map((mask) => attribute(mask, 'id')),
    ).toHaveLength(1);
  });

  it('lights a legend item and its segment together, on hover and on focus', () => {
    const { document } = sources();
    const legendLink = document.querySelectorAll('.chart-legend a')[1] ?? null;
    legendLink?.dispatchEvent(new FakeEvent('pointerover', { bubbles: true }));
    const active = (): string[] =>
      document
        .querySelectorAll('.donut-seg')
        .filter((segment) => segment.classList.contains('is-active'))
        .map((segment) => attribute(segment, 'data-index'));
    expect(active()).toEqual(['1']);
    legendLink?.dispatchEvent(new FakeEvent('pointerout', { bubbles: true }));
    expect(active()).toEqual([]);
    document
      .querySelectorAll('.donut-seg')[2]
      ?.dispatchEvent(new FakeEvent('focusin', { bubbles: true }));
    expect(
      document
        .querySelectorAll('.chart-legend > li')
        .map((li) => li.classList.contains('is-active')),
    ).toEqual([false, false, false, true, false]);
  });
});

describe('app-components.js · stacked bars beside their legend', () => {
  it('lights the segment that matches a legend item, by position', () => {
    const { document } = load({
      build: (body) =>
        body.append(
          h(
            'figure',
            { class: 'chart' },
            h(
              'div',
              { class: 'stack-bar', 'aria-hidden': 'true' },
              h('a', { class: 'stack-bar-seg', href: '?fit=strong', tabindex: '-1' }),
              h('a', { class: 'stack-bar-seg', href: '?fit=good', tabindex: '-1' }),
            ),
            h(
              'ul',
              { class: 'chart-legend' },
              h('li', {}, h('a', { class: 'chart-legend-item', href: '?fit=strong' })),
              h('li', {}, h('a', { class: 'chart-legend-item', href: '?fit=good' })),
            ),
          ),
        ),
    });
    document
      .querySelectorAll('.chart-legend a')[1]
      ?.dispatchEvent(new FakeEvent('pointerover', { bubbles: true }));
    expect(
      document
        .querySelectorAll('.stack-bar-seg')
        .map((segment) => segment.classList.contains('is-active')),
    ).toEqual([false, true]);
    document
      .querySelectorAll('.stack-bar-seg')[0]
      ?.dispatchEvent(new FakeEvent('pointerover', { bubbles: true }));
    expect(
      document.querySelectorAll('.chart-legend li').map((li) => li.classList.contains('is-active')),
    ).toEqual([true, false]);
  });
});

describe('app-components.js · thumbs', () => {
  const context = 'Job match: Senior Software Engineer, Search Infrastructure';
  const thumbs = (checkedNo = false) =>
    load({
      build: (body) =>
        body.append(
          h(
            'fieldset',
            { class: 'thumbs', 'data-thumbs-context': context },
            h('legend', {}, 'Was this match right?'),
            h(
              'div',
              { class: 'thumbs-options' },
              h(
                'label',
                { class: 'thumbs-option' },
                h('input', { type: 'radio', name: 't', value: 'yes' }),
              ),
              h(
                'label',
                { class: 'thumbs-option' },
                h('input', { type: 'radio', name: 't', value: 'no', checked: checkedNo }),
              ),
            ),
            h(
              'div',
              { class: 'thumbs-followup' },
              h(
                'fieldset',
                { class: 'thumbs-reasons' },
                ...['Wrong role', 'Wrong place', 'Too senior', 'Too junior', 'Something else'].map(
                  (reason) =>
                    h(
                      'label',
                      { class: 'choice-chip' },
                      h('input', {
                        type: 'checkbox',
                        value: reason,
                        checked: checkedNo && reason === 'Too senior',
                      }),
                    ),
                ),
              ),
              h('button', {
                class: 'compact-action thumbs-more',
                type: 'button',
                'data-feedback-open': true,
                'data-feedback-context': context,
              }),
            ),
          ),
        ),
    });
  const choose = (loaded: Loaded, value: string): void => {
    const inputs = loaded.document.querySelectorAll('.thumbs-option input');
    for (const input of inputs) input.checked = input.value === value;
    inputs
      .find((input) => input.value === value)
      ?.dispatchEvent(new FakeEvent('change', { bubbles: true }));
  };
  const tick = (loaded: Loaded, reason: string): void => {
    const input = loaded.document
      .querySelectorAll('.thumbs-reasons input')
      .find((item) => item.value === reason);
    if (!input) return;
    input.checked = !input.checked;
    input.dispatchEvent(new FakeEvent('change', { bubbles: true }));
  };
  const button = (loaded: Loaded): string =>
    attribute(loaded.document.querySelector('.thumbs-more'), 'data-feedback-context');

  it('fires a bubbling jobdeputy:thumbs event with the answer, the reasons, and the role', () => {
    const loaded = thumbs();
    const heard: unknown[] = [];
    loaded.document.addEventListener('jobdeputy:thumbs', (event) => heard.push(event.detail));
    choose(loaded, 'no');
    tick(loaded, 'Wrong place');
    tick(loaded, 'Too senior');
    expect(heard).toEqual([
      { value: 'no', reasons: [], context, change: 'answer' },
      { value: 'no', reasons: ['Wrong place'], context, change: 'reason' },
      { value: 'no', reasons: ['Wrong place', 'Too senior'], context, change: 'reason' },
    ]);
  });

  it('gives Tell us more the role and the reasons as its Feedback context', () => {
    const loaded = thumbs();
    choose(loaded, 'no');
    tick(loaded, 'Wrong place');
    expect(button(loaded)).toBe(`${context} · Wrong place`);
    tick(loaded, 'Too junior');
    expect(button(loaded)).toBe(`${context} · Wrong place, Too junior`);
  });

  it('clears the reasons when the answer turns to Yes', () => {
    const loaded = thumbs();
    choose(loaded, 'no');
    tick(loaded, 'Wrong role');
    choose(loaded, 'yes');
    expect(
      loaded.document.querySelectorAll('.thumbs-reasons input').some((input) => input.checked),
    ).toBe(false);
    expect(button(loaded)).toBe(context);
  });

  it('sets the context for a No that is already chosen when the page loads', () => {
    expect(button(thumbs(true))).toBe(`${context} · Too senior`);
  });

  it('ignores changes outside a thumbs fieldset', () => {
    const loaded = thumbs();
    const heard: unknown[] = [];
    loaded.document.addEventListener('jobdeputy:thumbs', (event) => heard.push(event.detail));
    const other = h('input', { type: 'checkbox', value: 'x' });
    loaded.document.body.append(other);
    other.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    expect(heard).toEqual([]);
  });
});

describe('app-components.js · quick picks', () => {
  const picks = () =>
    load({
      build: (body) =>
        body.append(
          h(
            'fieldset',
            { class: 'quick-picks' },
            ...[
              'https://www.amazon.jobs/en/search',
              'https://boards.greenhouse.io/example',
              'https://jobs.lever.co/example',
            ].map((value) =>
              h(
                'label',
                { class: 'quick-pick' },
                h('input', { type: 'radio', name: 'source', value }),
              ),
            ),
          ),
        ),
    });

  it('selects the pick whose address matches, ignoring the scheme, www., a query, and a trailing slash', () => {
    const { api, document } = picks();
    const group = document.querySelector('.quick-picks');
    const chosen = (): string[] =>
      document
        .querySelectorAll('.quick-pick input')
        .filter((input) => input.checked)
        .map((input) => input.value);
    for (const typed of [
      'amazon.jobs/en/search',
      'AMAZON.JOBS/en/search/',
      'http://www.amazon.jobs/en/search?q=go#top',
    ]) {
      expect(api.matchQuickPick(group, typed)?.value, typed).toBe(
        'https://www.amazon.jobs/en/search',
      );
      expect(chosen()).toEqual(['https://www.amazon.jobs/en/search']);
    }
    expect(api.matchQuickPick(group, 'jobs.lever.co/example')?.value).toBe(
      'https://jobs.lever.co/example',
    );
    expect(chosen()).toEqual(['https://jobs.lever.co/example']);
  });

  it('clears every pick when the address is edited away, and copes with no group', () => {
    const { api, document } = picks();
    const group = document.querySelector('.quick-picks');
    api.matchQuickPick(group, 'boards.greenhouse.io/example');
    expect(api.matchQuickPick(group, 'boards.greenhouse.io/exampl')).toBeNull();
    expect(document.querySelectorAll('.quick-pick input').some((input) => input.checked)).toBe(
      false,
    );
    expect(api.matchQuickPick(group, '')).toBeNull();
    expect(api.matchQuickPick(null, 'amazon.jobs/en/search')).toBeNull();
  });
});

describe('app-components.js · the one-time grow', () => {
  const motion = (loaded: Loaded): string =>
    attribute(loaded.document.documentElement, 'data-component-motion');

  it('settles 1.618s after the first render, so charts drawn later appear still', () => {
    const loaded = load();
    expect(motion(loaded)).toBe('');
    expect(loaded.timers.map((timer) => timer.ms)).toEqual([1618]);
    loaded.timers[0]?.run();
    expect(motion(loaded)).toBe('settled');
  });

  it('holds the grow at once while Pause motion is on', () => {
    const paused = load({ stored: { 'jobdeputy.deputyMotion': 'paused' } });
    expect(motion(paused)).toBe('paused');
    expect(paused.timers).toEqual([]);
    expect(motion(load({ deputy: { paused: true } }))).toBe('paused');
    // The deputy's own state wins over what was stored, once deputy.js is there.
    expect(
      motion(load({ deputy: { paused: false }, stored: { 'jobdeputy.deputyMotion': 'paused' } })),
    ).toBe('');
  });

  it('waits for the opening loader to reveal the page, with a 4.5s failsafe', () => {
    const loaded = load({ loaderActive: true });
    // One observer watches the body's class for the loader; the other watches for tour steps.
    const loader = loaded.observers.find((observer) =>
      observer.options?.attributeFilter?.includes('class'),
    );
    expect(loaded.observers).toHaveLength(2);
    expect(loaded.timers.map((timer) => timer.ms)).toEqual([4500]);
    loader?.callback();
    expect(loaded.timers).toHaveLength(1);
    loaded.document.body.classList.remove('loader-active');
    loader?.callback();
    expect(loader?.disconnected).toBe(true);
    expect(loaded.timers.map((timer) => timer.ms)).toEqual([4500, 1618]);
    loaded.timers[1]?.run();
    expect(motion(loaded)).toBe('settled');
  });
});

// ------------------------------------------------------------------ the gallery

const sectionOf = (id: string): string =>
  gallery.match(
    new RegExp(`<section class="gallery-section" id="${id}"[\\s\\S]*?</section>`),
  )?.[0] ?? '';
const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
// The live (not inert) part of a section: everything before its specimen strip.
const liveOf = (html: string): string => html.split(/<div class="gallery-specimens/)[0] ?? '';

describe('components-preview.html', () => {
  it('links app-chrome.css, then app-components.css, before its own styles', () => {
    const chromeLink = gallery.indexOf(`<link rel="stylesheet" href="./${chromeFile}" />`);
    const componentsLink = gallery.indexOf(`<link rel="stylesheet" href="./${componentsFile}" />`);
    expect(chromeLink).toBeGreaterThan(-1);
    expect(componentsLink).toBeGreaterThan(chromeLink);
    expect(componentsLink).toBeLessThan(gallery.indexOf('<style'));
    expect(gallery.indexOf(`<script src="./${scriptFile}"></script>`)).toBeLessThan(
      gallery.lastIndexOf('<script>'),
    );
  });

  it('loads the components, the store, the deputy, Feedback, and the panels in the app pages’ order', () => {
    const tags = [
      'app-components.js',
      'sample-store.js',
      'deputy.js',
      'feedback.js',
      'app-panels.js',
    ].map((name) => `<script src="./${name}"></script>`);
    const at = tags.map((tag) => gallery.indexOf(tag));
    expect(at.every((index) => index > -1)).toBe(true);
    // One unbroken run of script tags, then the gallery's own inline script. Round 5's app pages
    // load prompt-guard.js and agreement-text.js between the components and the store; the
    // script tags are chrome (the orchestrator adds them here, requests/A3.md item 1), so the run
    // accepts them only in that place.
    const scriptTag = (name: string) => `<script src="\\./${name.replace(/\./g, '\\.')}"></script>`;
    const order = new RegExp(
      `^${scriptTag('app-components.js')} (?:${scriptTag('prompt-guard.js')} )?(?:${scriptTag('agreement-text.js')} )?${tags
        .slice(1)
        .map((t) => t.replace(/\./g, '\\.'))
        .join(' ')} <script>`,
    );
    const run = gallery
      .slice(at[0] ?? 0)
      .replace(/\s+/g, ' ')
      .slice(0, 400);
    expect(run).toMatch(order);
    for (const tag of tags) expect(gallery.split(tag)).toHaveLength(2);
  });

  it('restyles no shared component in its own <style>', () => {
    const own = selectorsIn(stylesIn(gallery));
    const shared = new Set([...selectorsIn(chrome), ...selectorsIn(components)]);
    const base = new Set(['html', 'body', 'p', 'button', 'a']);
    expect(own.filter((selector) => shared.has(selector) && !base.has(selector))).toEqual([]);
  });

  it('shows every component, with the working tabs, drawer, view toggle, table, and board', () => {
    const used = new Set(
      [...gallery.matchAll(/class="([^"]+)"/g)].flatMap((match) => (match[1] ?? '').split(/\s+/)),
    );
    for (const name of [
      'stat-row',
      'meter',
      'ring',
      'stage-track',
      'checklist',
      'data-table',
      'board',
      'drawer',
      'segmented',
      'tabs',
      'timeline',
      'empty-state',
      'upload-zone',
      'choice-card',
      'toolbar',
      'sample-note',
      'company-mark',
      'step-progress',
      'bar-chart',
      'flow-ribbon',
      'kpi-grid',
      'kpi',
      'sparkline',
      'chart',
      'chart-empty',
      'hbar',
      'stack-bar',
      'chart-legend',
      'donut',
      'thumbs',
      'quick-picks',
      'is-small',
      'is-tiny',
    ]) {
      expect(used.has(name), name).toBe(true);
    }
    expect(gallery).toMatch(/role="tablist"[^>]*data-tabs/);
    expect(gallery).toMatch(/<dialog class="drawer"/);
    expect(gallery).toMatch(/data-drawer-open="role-drawer"/);
    // A labelled <section> is a region landmark; the board must be one and take focus.
    const boardTag = gallery.match(/<section[^>]*\sclass="board"[^>]*>/)?.[0] ?? '';
    expect(boardTag).toMatch(/\saria-label="[^"]+"/);
    expect(boardTag).toMatch(/\stabindex="0"/);
    expect(gallery).toMatch(/<fieldset class="segmented" id="applications-view">/);
    expect(gallery).toMatch(/<table class="data-table" role="table">/);
  });

  // Round 6: seven new sections (stacked bar chart, daily chart by model, multi-select filter,
  // See all, page intro, Settings tabs, background notice), and part 2's score trend: 59 in all.
  // Round 7: the skeleton and boot, and the prompt summary (and the rest of round 7 after them).
  it('numbers its sections in index order', () => {
    const index = [
      ...gallery.matchAll(
        /<li><a href="#([\w-]+)"><span class="gallery-index-number">(\d\d)<\/span>/g,
      ),
    ];
    expect(index.length).toBeGreaterThanOrEqual(61);
    expect(index.map((match) => match[2])).toEqual(
      Array.from({ length: index.length }, (_, number) => String(number + 1).padStart(2, '0')),
    );
    for (const match of index) {
      expect(sectionOf(match[1] ?? ''), match[1]).toContain(`· ${match[2]}</p>`);
    }
  });
});

describe('components-preview.html · the flow ribbon contract (brief 3.5)', () => {
  const blocks = [
    ...gallery.matchAll(/<!-- FlowRibbon: start -->([\s\S]*?)<!-- FlowRibbon: end -->/g),
  ];
  const block = blocks[0]?.[1] ?? '';

  it('carries one canonical block, the only live ribbon on the page', () => {
    expect(blocks).toHaveLength(1);
    expect(block.trim()).toMatch(
      /^<nav class="flow-ribbon" aria-label="How roles move">\s*<ol class="flow-ribbon-list">/,
    );
    expect(block.trim()).toMatch(/<\/ol>\s*<\/nav>$/);
    expect(gallery.match(/<nav class="flow-ribbon"/g)).toHaveLength(1);
  });

  it('links Searches, Job matches, and Applications with their seed counts', () => {
    const steps = [
      ...block.matchAll(
        /<li>\s*<a class="flow-ribbon-step" href="([^"]+)"( aria-current="page")?>\s*<svg class="flow-ribbon-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1\.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">[\s\S]*?<\/svg>\s*<span class="flow-ribbon-label">([^<]+)<\/span>\s*<span class="flow-ribbon-count" data-flow-count="(\w+)">([^<]+)<\/span>\s*<\/a>\s*<\/li>/g,
      ),
    ];
    expect(steps.map((step) => [step[1], step[3], step[4], step[5]])).toEqual([
      ['./searches-preview.html', 'Searches', 'sources', '6 sources'],
      ['./jobs-preview.html', 'Job matches', 'matches', '27 found'],
      ['./applications-preview.html', 'Applications', 'tracked', '8 tracked'],
    ]);
    expect(steps.filter((step) => step[2]).map((step) => step[1])).toEqual(['./jobs-preview.html']);
  });

  it('reuses the AppNav icons for the three steps', () => {
    const icons = [...block.matchAll(/<svg class="flow-ribbon-icon"[^>]*>([\s\S]*?)<\/svg>/g)].map(
      (match) => match[1],
    );
    const jobs = sourceFor('jobs-preview.html');
    for (const icon of icons) expect(jobs, icon).toContain(`focusable="false">${icon}</svg>`);
  });
});

describe('components-preview.html · charts that link (brief 3.4 and rule 3)', () => {
  // The filtered pages a chart part may open.
  // Round 3: the fit and source links open every role (view=all) with the filter.
  const DEEP_LINK =
    /^\.\/(?:jobs-preview\.html(?:\?(?:fit=(?:strong|good|stretch)|source=\w+|view=(?:all|new|tracked|dismissed)(?:&amp;(?:fit=(?:strong|good|stretch)|source=\w+))?))?|applications-preview\.html(?:\?stage=\w+)?|searches-preview\.html(?:\?source=\w+|#keep-watch)?|ai-preview\.html#credits)$/;
  const live = ['kpi', 'chart', 'hbar', 'stack-bar', 'donut']
    .map((id) => liveOf(sectionOf(id)))
    .join('\n');
  const links = [
    ...live.matchAll(
      /<a class="(kpi|hbar-row|chart-legend-item)" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
    ),
  ];

  it('opens a filtered page from every tile, row, and legend item, and names where it goes', () => {
    expect(links.length).toBeGreaterThanOrEqual(25);
    for (const [, kind, href, body] of links) {
      expect(href, `${kind} ${href}`).toMatch(DEEP_LINK);
      const ending = body?.match(/<span class="sr-only">([^<]+)<\/span>\s*$/)?.[1] ?? '';
      expect(ending, `${kind} ${href}`).toMatch(/\b(?:Open|Fix)\b/);
    }
  });

  it('keeps stacked-bar segments out of the tab order, behind a legend link to the same place', () => {
    let segments = 0;
    for (const figure of live.match(/<figure class="chart"[\s\S]*?<\/figure>/g) ?? []) {
      const bar = figure.match(/<div class="stack-bar"([^>]*)>([\s\S]*?)<\/div>/);
      if (!bar) continue;
      expect(bar[1]).toContain('aria-hidden="true"');
      const legend = new Set(
        [...figure.matchAll(/<a class="chart-legend-item" href="([^"]+)"/g)].map(
          (match) => match[1],
        ),
      );
      for (const segment of (bar[2] ?? '').matchAll(
        /<a class="stack-bar-seg" href="([^"]+)"([^>]*)>/g,
      )) {
        expect(segment[2]).toContain('tabindex="-1"');
        expect(legend.has(segment[1]), segment[1]).toBe(true);
        segments += 1;
      }
    }
    expect(segments).toBe(8);
  });

  it('feeds each donut from a legend of values and tones', () => {
    let items = 0;
    for (const legend of sectionOf('donut').match(/<ol class="chart-legend">[\s\S]*?<\/ol>/g) ??
      []) {
      for (const item of legend.matchAll(/<li([^>]*)>/g)) {
        expect(item[1]).toMatch(/ data-value="\d+"/);
        expect(TONES).toContain(item[1]?.match(/data-tone="(\w+)"/)?.[1]);
        items += 1;
      }
    }
    expect(items).toBe(7);
  });

  it('carries a summary in every sparkline', () => {
    const sparklines = [
      ...gallery.matchAll(
        /<span class="sparkline" data-values="[\d,]*"[^>]*\s*>([\s\S]*?)<\/span\s*>/g,
      ),
    ];
    expect(sparklines.length).toBeGreaterThanOrEqual(6);
    for (const sparkline of sparklines)
      expect(sparkline[1]).toMatch(/^<span class="sr-only">[^<]+\.$/);
  });

  it('uses the canonical sample numbers (round 3 brief 3.1)', () => {
    expect(gallery).toContain('data-values="3,3,6,4,8,9,12"');
    const donut = liveOf(sectionOf('donut'));
    const values = [
      ...(donut.match(/<ol class="chart-legend">[\s\S]*?<\/ol>/)?.[0] ?? '').matchAll(
        /data-value="(\d+)"/g,
      ),
    ].map((match) => Number(match[1]));
    // The sources add up to the 27 found; the centre counts sources, not the found total again.
    expect(values).toEqual([12, 6, 4, 3, 2]);
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(27);
    expect(donut).toContain('<span class="donut-total-value">5</span>');
    const pipeline = sectionOf('hbar').match(/hbar-pipeline-title[\s\S]*?<\/ol>/)?.[0] ?? '';
    expect(
      [...pipeline.matchAll(/<span class="hbar-value">(\d+)<\/span>/g)].map((match) => match[1]),
    ).toEqual(['2', '1', '1', '2', '1', '0', '1']);
    const fit = sectionOf('stack-bar');
    expect(
      [...fit.matchAll(/<span class="chart-legend-value">(\d+)<\/span>/g)]
        .slice(0, 3)
        .map((match) => match[1]),
    ).toEqual(['4', '9', '14']);
    expect(textOf(sectionOf('kpi'))).toContain('Northwind Labs · Tue, Oct 6, 10:00');
  });
});

describe('components-preview.html · choice controls', () => {
  it('shows thumbs with a legend, Yes and No, the five reasons, and Tell us more for Feedback', () => {
    const fieldset =
      sectionOf('thumbs').match(
        /<fieldset class="thumbs"[\s\S]*?<\/button>\s*<\/div>\s*<\/fieldset>/,
      )?.[0] ?? '';
    expect(fieldset).toMatch(/^<fieldset class="thumbs" data-thumbs-context="Job match: [^"]+"/);
    expect(fieldset).toContain('<legend class="field-label">Was this match right?</legend>');
    expect(
      [
        ...fieldset.matchAll(
          /<label class="thumbs-option">\s*<input type="radio" name="[\w-]+" value="(\w+)"/g,
        ),
      ].map((match) => match[1]),
    ).toEqual(['yes', 'no']);
    expect([
      ...fieldset.matchAll(/<svg class="thumbs-icon"[^>]*aria-hidden="true" focusable="false">/g),
    ]).toHaveLength(2);
    expect(
      [
        ...fieldset.matchAll(
          /<label class="choice-chip"><input type="checkbox" name="[\w-]+" value="([^"]+)"/g,
        ),
      ].map((match) => match[1]),
    ).toEqual(['Wrong role', 'Wrong place', 'Too senior', 'Too junior', 'Something else']);
    expect(fieldset).toMatch(
      /<button\s+class="compact-action thumbs-more"\s+type="button"\s+data-feedback-open\s+data-feedback-context="Job match: [^"]+"\s*>\s*Tell us more\s*<\/button>/,
    );
  });

  it('builds each quick pick from a radio, an aria-hidden mark, a name, and its address', () => {
    const live = liveOf(sectionOf('quick-picks'));
    const picks = [
      ...live.matchAll(
        /<label class="quick-pick">\s*<input type="radio" name="[\w-]+" value="(https:\/\/[^"]+)" \/>\s*<span class="company-mark" aria-hidden="true">[A-Z]{1,2}<\/span>\s*<span class="quick-pick-copy">\s*<span class="quick-pick-name">([^<]+)<\/span>\s*<span class="quick-pick-host">([^<]+)<\/span>/g,
      ),
    ];
    expect(picks.map((pick) => pick[2])).toEqual([
      'Amazon Jobs',
      'Google Careers',
      'A Greenhouse board',
      'A Lever board',
      'A Workday site',
    ]);
    for (const [, value, , host] of picks) {
      expect((value ?? '').replace(/^https:\/\/(?:www\.)?/, '')).toMatch(
        new RegExp(`^${(host ?? '').replace(/[.]/g, '\\.')}`),
      );
    }
  });

  it('shows the one selected style on every choice control, checked, side by side', () => {
    const overview = sectionOf('selected-style');
    for (const control of [
      'choice-card',
      'choice-chip',
      'quick-pick',
      'segmented-option',
      'thumbs-option',
      'feedback-rate',
    ]) {
      expect(overview, control).toMatch(
        new RegExp(`<label class="${control}">(?:<input|\\s*<input)[^>]*checked`),
      );
    }
  });

  it('keeps the current-default pill neutral on the green-soft selected card', () => {
    expect(gallery).not.toContain('<span class="status-pill choice-card-current">');
    expect(gallery).toContain(
      '<span class="status-pill is-neutral choice-card-current">Current default</span>',
    );
  });
});

// ------------------------------------------------------------------ round 3: the stylesheet

describe('app-components.css · round 3 components (brief 3.4)', () => {
  const phone = (rule: StyleRule): boolean =>
    rule.media.some((query) => /max-width:\s*720px/.test(query));

  it('draws one tooltip on ink with white words, above the tour spotlight', () => {
    expect(declared(componentRules, '.tooltip', 'position')).toBe('fixed');
    expect(declared(componentRules, '.tooltip', 'background')).toBe('var(--ink)');
    expect(declared(componentRules, '.tooltip', 'color')).toBe('white');
    expect(declared(componentRules, '.tooltip', 'font-size')).toBe('13px');
    expect(declared(componentRules, '.tooltip', 'border')).toBe('1px solid transparent');
    expect(Number(declared(componentRules, '.tooltip', 'z-index'))).toBeGreaterThan(
      Number(declared(componentRules, '.tour-spotlight', 'z-index')),
    );
    expect(declared(componentRules, '.tooltip', 'animation')).toBe('jd-tooltip-in 180ms ease');
  });

  it('keeps the compact key a legend where a fine pointer hovers, and a key on touch screens', () => {
    const fine = (rule: StyleRule): boolean =>
      rule.media.some((query) => /\(hover: hover\) and \(pointer: fine\)/.test(query));
    expect(
      declared(componentRules, '.chart-key.is-compact .chart-key-meaning', 'display', fine),
    ).toBe('none');
    // No rule hides the meanings of a plain key: it is visible to everyone.
    expect(declared(componentRules, '.chart-key .chart-key-meaning', 'display')).toBeUndefined();
    const touch = (rule: StyleRule): boolean =>
      rule.media.some((query) => /\(hover: none\), \(pointer: coarse\)/.test(query));
    expect(declared(componentRules, '.chart-key.is-compact.is-inline', 'display', touch)).toBe(
      'grid',
    );
    expect(declared(componentRules, '.chart-key-meaning', 'color')).toBe('var(--muted)');
  });

  // Round 6 (P2): optional moved from blue-soft and a blue dot to the calm green wash with a
  // hollow green-ink ring (the owner: "use a different one that better suits us").
  it('marks required in danger-ink on orange-soft and optional in ink on the green wash, never toned text', () => {
    expect(declared(componentRules, '.need-pill[data-need="required"]', 'color')).toBe(
      'var(--danger-ink)',
    );
    expect(declared(componentRules, '.need-pill[data-need="required"]', 'background')).toBe(
      'var(--orange-soft)',
    );
    expect(declared(componentRules, '.need-pill[data-need="optional"]', 'color')).toBe(
      'var(--ink)',
    );
    expect(declared(componentRules, '.need-pill[data-need="optional"]', 'background')).toBe(
      'var(--need-optional-fill)',
    );
    expect(paletteBlock()).toContain('--need-optional-fill: var(--green-wash);');
    expect(paletteBlock()).toContain('--need-optional-line: var(--green-line);');
    expect(paletteBlock()).toContain('--need-optional-mark: var(--green-ink);');
    const required = '.need-pill[data-need="required"]::before';
    expect(declared(componentRules, required, 'content')).toBe('"!" / ""');
    expect(declared(componentRules, required, 'background')).toBe('var(--danger-ink)');
    const ring = '.need-pill[data-need="optional"]::before';
    expect(declared(componentRules, ring, 'background')).toBe('transparent');
    expect(declared(componentRules, ring, 'border')).toBe('2px solid var(--need-optional-mark)');
    expect(declared(componentRules, ring, 'border-radius')).toBe('50%');
    expect(declared(componentRules, '.need-add[data-need="required"]', 'border-color')).toBe(
      'var(--danger-ink)',
    );
    expect(declared(componentRules, '.need-add[data-need="optional"]', 'border-color')).toBe(
      'var(--need-optional-line)',
    );
    expect(declared(componentRules, '.need-add[data-need="optional"]', 'background')).toBe(
      'var(--need-optional-fill)',
    );
    expect(declared(componentRules, '.need-add[data-need="optional"]', 'color')).toBe('var(--ink)');
  });

  it('gives the allowance meter four looks: used grey hatching, left by kind, bonus gold, bought wine', () => {
    const flat = (value: string | undefined): string =>
      (value ?? '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');
    expect(flat(declared(componentRules, '.allowance-part[data-part="used"]', 'background'))).toBe(
      'repeating-linear-gradient(-45deg, var(--viz-used) 0 2px, var(--viz-used-ground) 2px 5px)',
    );
    expect(declared(componentRules, '.allowance-part', 'background')).toBe('var(--viz-left)');
    expect(declared(componentRules, '.allowance-part[data-part="bonus"]', 'background')).toBe(
      'var(--viz-bonus)',
    );
    expect(declared(componentRules, '.allowance-part[data-part="bought"]', 'background')).toBe(
      'var(--viz-bought)',
    );
    // Bonus is solid now: no edge drawn inside it.
    expect(declared(componentRules, '.allowance-part[data-part="bonus"]', 'box-shadow')).toBe(
      undefined,
    );
    expect(
      declared(componentRules, '.allowance-key-item[data-part="bought"]::before', 'background'),
    ).toBe('var(--viz-bought)');
    expect(declared(componentRules, '.allowance-bar', 'background')).toBe('var(--viz-track)');
    expect(declared(componentRules, '.allowance-bar', 'gap')).toBe('2px');
    expect(declared(componentRules, '.allowance-part', 'flex')).toBe('var(--count, 1) 1 0');
  });

  it('pulses the live dot only under .is-live, and highlights a new row once', () => {
    expect(declared(componentRules, '.live-pill.is-live .live-pill-dot::after', 'animation')).toBe(
      'jd-live-pulse 1.618s var(--ease-settle) infinite',
    );
    expect(declared(componentRules, '.live-pill-dot', 'animation')).toBeUndefined();
    expect(
      declared(componentRules, '.live-table [role="row"].is-new > [role="cell"]', 'animation'),
    ).toBe('jd-row-new 1.618s ease');
    expect(declared(componentRules, '.live-table-link::after', 'inset')).toBe('0');
    expect(declared(componentRules, '.live-table tbody [role="row"]', 'position')).toBe('relative');
  });

  it('stops under Pause motion everything reduced motion stops', () => {
    // The boot failsafe's reduced-motion rules keep the failsafe, not motion; under Pause motion
    // their own rules keep it too (round 7).
    const reduce = componentRules
      .filter(isReduce)
      .filter((rule) =>
        rule.declarations.some(
          (item) => item.property === 'animation' && !BOOT_FAILSAFE.test(item.value),
        ),
      )
      .flatMap((rule) => rule.selectors);
    const lift = componentRules
      .filter(isReduce)
      .filter((rule) => rule.declarations.some((item) => item.property === 'transform'))
      .flatMap((rule) => rule.selectors);
    const paused = (property: string): Set<string> =>
      new Set(
        componentRules
          .filter((rule) => rule.media.length === 0)
          .filter((rule) =>
            rule.declarations.some((item) => item.property === property && item.value === 'none'),
          )
          .flatMap((rule) => rule.selectors)
          .filter((selector) => selector.startsWith(':root[data-motion="paused"]'))
          .flatMap((selector) => {
            const rest = selector.replace(':root[data-motion="paused"]', '').trim();
            const inner = rest.match(/^:is\(([\s\S]*)\)$/);
            return inner ? splitTopLevel(inner[1] ?? '', ',') : [rest];
          })
          .map((selector) => selector.replace(/\s+/g, ' ').trim()),
      );
    const stopped = paused('animation');
    const transitions = paused('transition');
    expect(reduce.filter((selector) => !stopped.has(selector))).toEqual([]);
    expect(reduce.filter((selector) => !transitions.has(selector))).toEqual([]);
    expect(lift.filter((selector) => !paused('transform').has(selector))).toEqual([]);
  });

  it('prints only a marked stack, one US letter page each, at its true size', () => {
    const print = (rule: StyleRule): boolean =>
      rule.media.some((query) => /^@media print$/.test(query));
    const hide = componentRules.find(
      (rule) =>
        print(rule) &&
        rule.selectors.some((selector) => selector.includes(':not(:has([data-paper-print]))')),
    );
    expect(hide?.declarations).toEqual([{ property: 'display', value: 'none', important: false }]);
    expect(declared(componentRules, '[data-paper-print] .paper', 'break-after', print)).toBe(
      'page',
    );
    expect(declared(componentRules, '[data-paper-print] .paper', 'page', print)).toBe('paper');
    expect(declared(componentRules, '[data-paper-print] .paper-sheet', 'width', print)).toBe(
      '8.5in',
    );
    expect(declared(componentRules, '[data-paper-print] .paper-sheet', 'height', print)).toBe(
      '11in',
    );
    expect(components.replace(/\s+/g, ' ')).toContain('@page paper { size: letter; margin: 0; }');
    // Screen-only marks never print: the dashed frame past the setting, the tooltip, and the tour.
    for (const frame of [
      '.paper.is-over .paper-sheet',
      '[data-paper-print] .paper.is-over .paper-sheet',
    ]) {
      expect(declared(componentRules, frame, 'outline', print), frame).toBe('0');
    }
    for (const overlay of ['.tooltip', '.tour-spotlight', '.tour-card[open]']) {
      expect(declared(componentRules, overlay, 'display', print), overlay).toBe('none');
    }
    expect(declared(componentRules, '.paper-sheet', 'aspect-ratio')).toBe('8.5 / 11');
    expect(declared(componentRules, '.paper-content', 'font-size')).toBe('calc(100cqw * 14 / 816)');
  });

  it('keeps 44px targets on the new controls', () => {
    for (const selector of [
      '.chart-key-item',
      '.kpi-split-value',
      'a.kpi-split-line',
      '.need-add',
      '.doc-preview-thumb',
      'a.donut-total',
    ]) {
      expect(
        Number.parseFloat(declared(componentRules, selector, 'min-height') ?? '0'),
        selector,
      ).toBeGreaterThanOrEqual(44);
    }
    // A split tile's value can be one digit ("4"): it is 44px wide at the least.
    expect(declared(componentRules, '.kpi-split-value', 'min-width')).toBe('44px');
    expect(declared(componentRules, '.kpi-split-value', 'display')).toBe('inline-flex');
  });

  it('keeps a forced-colours boundary on the new pills and controls', () => {
    const transparentEdge = (selector: string): boolean =>
      componentRules.some(
        (rule) =>
          rule.selectors.includes(selector) &&
          rule.declarations.some(
            ({ property, value }) =>
              /^(?:border|outline)$/.test(property) && /\b1px solid transparent\b/.test(value),
          ),
      );
    for (const selector of [
      '.tooltip',
      '.chart-key-item',
      '.live-pill',
      '.need-pill',
      '.need-summary',
      '.paper-count',
    ]) {
      expect(transparentEdge(selector), selector).toBe(true);
    }
    expect(
      declared(componentRules, '.allowance-part[data-part="bonus"]', 'background', isForced),
    ).toBe('LinkText');
    expect(
      declared(componentRules, '.allowance-part[data-part="used"]', 'background', isForced),
    ).toMatch(/CanvasText/);
    expect(
      declared(componentRules, '.doc-preview-thumb[aria-current="true"]', 'border-color', isForced),
    ).toBe('Highlight');
    expect(declared(componentRules, '.tour-spotlight', 'box-shadow', isForced)).toBe(
      '0 0 0 3px Highlight',
    );
  });

  it('makes the tour card a bottom sheet on phones and the preview a sheet from the bottom', () => {
    expect(declared(componentRules, '.tour-card', 'bottom', phone)).toBe('0');
    expect(declared(componentRules, '.tour-card', 'left', phone)).toBe('0');
    expect(declared(componentRules, '.tour-card', 'width', phone)).toBe('100%');
    expect(declared(componentRules, '.tour-card', 'border-radius', phone)).toBe('22px 22px 0 0');
    expect(declared(componentRules, '.doc-preview', 'margin', phone)).toBe('auto 0 0');
    expect(declared(componentRules, '.kpi-grid > .is-split', 'grid-column', phone)).toBe('1 / -1');
    expect(declared(componentRules, '.tour-card::backdrop', 'background')).toBe('transparent');
  });
});

// ------------------------------------------------------------------ round 3: the script

describe('app-components.js · the tooltip (R3-5)', () => {
  const STRONG_TIP =
    'A target role, with most of what it asks. Opens Job matches filtered to Strong fit.';
  const chart = (body: FakeElement): void => {
    body.append(
      h(
        'figure',
        { class: 'chart' },
        h(
          'div',
          { class: 'stack-bar', 'aria-hidden': 'true' },
          h('a', { class: 'stack-bar-seg', href: '?fit=strong', tabindex: '-1' }),
          h('a', {
            class: 'stack-bar-seg',
            href: '?fit=good',
            tabindex: '-1',
            'data-tip': 'Its own words.',
          }),
        ),
        h(
          'ul',
          { class: 'chart-legend' },
          h(
            'li',
            {},
            h('a', {
              class: 'chart-legend-item',
              id: 'strong',
              href: '?fit=strong',
              'data-tip-title': 'Strong fit · 4 roles',
              'data-tip': STRONG_TIP,
              'aria-describedby': 'fit-help',
            }),
          ),
          h('li', {}, h('a', { class: 'chart-legend-item', href: '?fit=good' })),
        ),
      ),
      h('button', { type: 'button', id: 'elsewhere' }, 'Elsewhere'),
    );
  };
  const tipOf = (loaded: Loaded): FakeElement | null =>
    loaded.document.querySelector('#jd-tooltip');
  const words = (node: FakeElement | null): string[] =>
    ['.tooltip-title', '.tooltip-text'].map((selector) => {
      const part = node?.querySelector(selector);
      return part && !part.hasAttribute('hidden') ? part.textContent : '';
    });

  it('shows one shared role="tooltip" on focus and wires aria-describedby to the focused trigger', () => {
    const loaded = load({ build: chart });
    const link = loaded.document.querySelector('#strong');
    link?.focus();
    const node = tipOf(loaded);
    expect(attribute(node, 'role')).toBe('tooltip');
    expect(node?.hasAttribute('hidden')).toBe(false);
    // The title ends in a visually hidden full stop, so the description reads as sentences.
    expect(words(node)).toEqual(['Strong fit · 4 roles.', STRONG_TIP]);
    expect(node?.querySelector('.tooltip-title .sr-only')?.textContent).toBe('.');
    // The trigger keeps its own description and adds the tooltip's.
    expect(attribute(link, 'aria-describedby')).toBe('fit-help jd-tooltip');
    loaded.document.querySelector('#elsewhere')?.focus();
    expect(tipOf(loaded)?.hasAttribute('hidden')).toBe(true);
    expect(attribute(link, 'aria-describedby')).toBe('fit-help');
    expect(loaded.document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
  });

  it('shows on mouse hover, stays while the pointer is on it, and never after a touch', () => {
    const loaded = load({ build: chart });
    const link = loaded.document.querySelector('#strong');
    link?.dispatchEvent(new FakeEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    const node = tipOf(loaded);
    expect(node?.hasAttribute('hidden')).toBe(false);
    // Moving onto the tooltip keeps it; leaving both hides it after a short grace.
    link?.dispatchEvent(new FakeEvent('pointerout', { bubbles: true, relatedTarget: node }));
    expect(loaded.timers.filter((timer) => timer.ms === 120)).toHaveLength(0);
    link?.dispatchEvent(new FakeEvent('pointerout', { bubbles: true, relatedTarget: null }));
    expect(loaded.timers.filter((timer) => timer.ms === 120)).toHaveLength(1);
    flush(loaded);
    expect(node?.hasAttribute('hidden')).toBe(true);

    const touched = load({ build: chart });
    const tapped = touched.document.querySelector('#strong');
    tapped?.dispatchEvent(new FakeEvent('pointerover', { bubbles: true, pointerType: 'touch' }));
    expect(tipOf(touched)).toBeNull();
    tapped?.dispatchEvent(new FakeEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    tapped?.focus();
    expect(tipOf(touched)).toBeNull();
  });

  it('lets a pointer-only segment borrow its legend item’s tip, and never describes it', () => {
    const loaded = load({ build: chart });
    const [plain, own] = loaded.document.querySelectorAll('.stack-bar-seg');
    plain?.dispatchEvent(new FakeEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    expect(words(tipOf(loaded))).toEqual(['Strong fit · 4 roles.', STRONG_TIP]);
    expect(plain?.hasAttribute('aria-describedby')).toBe(false);
    own?.dispatchEvent(new FakeEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    expect(words(tipOf(loaded))).toEqual(['', 'Its own words.']);
  });

  it('hides on Escape first and keeps that Escape from reaching anything else', () => {
    const loaded = load({ build: chart });
    const link = loaded.document.querySelector('#strong');
    const heard: string[] = [];
    link?.addEventListener('keydown', () => heard.push('link'));
    link?.focus();
    const first = new FakeEvent('keydown', { bubbles: true, key: 'Escape' });
    link?.dispatchEvent(first);
    expect(tipOf(loaded)?.hasAttribute('hidden')).toBe(true);
    expect(first.defaultPrevented).toBe(true);
    expect(heard).toEqual([]);
    expect(loaded.document.activeElement).toBe(link);
    const second = new FakeEvent('keydown', { bubbles: true, key: 'Escape' });
    link?.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
    expect(heard).toEqual(['link']);
  });

  it('moves into an open modal dialog, so it stays above it', () => {
    const loaded = load({
      build: (body) =>
        body.append(
          h(
            'dialog',
            { open: true, id: 'modal' },
            h(
              'button',
              { type: 'button', id: 'inside', 'data-tip': 'Inside the dialog.' },
              'Inside',
            ),
          ),
        ),
    });
    loaded.document.querySelector('#inside')?.focus();
    expect(tipOf(loaded)?.parentElement).toBe(loaded.document.querySelector('#modal'));
  });

  it('copies each legend item’s tip onto its donut segment', () => {
    const loaded = load({
      build: (body) =>
        body.append(
          h(
            'div',
            { class: 'donut' },
            h('div', { class: 'donut-ring' }),
            h(
              'ol',
              { class: 'chart-legend' },
              h(
                'li',
                { 'data-value': '12', 'data-tone': 'blue' },
                h('a', {
                  class: 'chart-legend-item',
                  href: '?source=google',
                  'data-tip-title': 'Google Careers · 12 roles',
                  'data-tip': 'Opens Job matches filtered to Google Careers.',
                }),
              ),
              h('li', { 'data-value': '6', 'data-tone': 'ink', 'data-tip': 'On the item itself.' }),
            ),
          ),
        ),
    });
    const [link] = loaded.document.querySelectorAll('a.donut-link');
    expect(attribute(link, 'data-tip-title')).toBe('Google Careers · 12 roles');
    expect(attribute(link, 'tabindex')).toBe('-1');
    const shapes = loaded.document.querySelectorAll('.donut-seg');
    expect(attribute(shapes[1], 'data-tip')).toBe('On the item itself.');
  });
});

describe('app-components.js · allowance meters (finding 5)', () => {
  const meter = (body: FakeElement): void => {
    body.append(
      h(
        'div',
        { class: 'allowance', id: 'meter' },
        h(
          'div',
          { class: 'allowance-bar', 'aria-hidden': 'true' },
          ...['used', 'left', 'bonus', 'bought'].map((part) =>
            h('span', { class: 'allowance-part', 'data-part': part }),
          ),
        ),
        h(
          'ul',
          { class: 'allowance-key' },
          h(
            'li',
            { class: 'allowance-key-item', 'data-part': 'left' },
            h(
              'strong',
              { 'data-allowance-value': 'left', 'data-metric': 'watch.nightly.freeLeft' },
              '0',
            ),
            ' of ',
            h('span', { 'data-allowance-value': 'limit' }, '0'),
            ' left',
          ),
          h(
            'li',
            { class: 'allowance-key-item', 'data-part': 'used' },
            h('strong', { 'data-allowance-value': 'used' }, '0'),
            ' used',
          ),
          h(
            'li',
            { class: 'allowance-key-item', 'data-part': 'bonus' },
            '+',
            h('strong', { 'data-allowance-value': 'bonus' }, '0'),
            ' bonus',
          ),
          h(
            'li',
            { class: 'allowance-key-item', 'data-part': 'bought' },
            '+',
            h('strong', { 'data-allowance-value': 'bought' }, '0'),
            ' bought',
          ),
        ),
      ),
    );
  };
  const keyText = (loaded: Loaded): string[] =>
    loaded.document
      .querySelectorAll('.allowance-key-item')
      .filter((item) => !item.hasAttribute('hidden'))
      .map((item) => item.textContent);

  it('writes the numbers as text: 8 of 10 left · 2 used · +2 bonus · +30 bought', () => {
    const loaded = load({ build: meter });
    const counts = loaded.api.allowance.set(
      loaded.document.querySelector('#meter') as FakeElement,
      { used: 2, left: 8, bonus: 2, bought: 30 },
    );
    expect(counts).toEqual({ used: 2, left: 8, bonus: 2, bought: 30, limit: 10 });
    expect(keyText(loaded)).toEqual(['8 of 10 left', '2 used', '+2 bonus', '+30 bought']);
    expect(
      loaded.document
        .querySelectorAll('.allowance-part')
        .map((part) => part.style.getPropertyValue('--count')),
    ).toEqual(['2', '8', '2', '30']);
    // The number keeps its data-metric, so the page's figure check still finds it.
    expect(attribute(loaded.document.querySelector('[data-metric]'), 'data-metric')).toBe(
      'watch.nightly.freeLeft',
    );
  });

  it('hides a part of zero and the bonus or bought key item at zero, and ignores values it cannot use', () => {
    const loaded = load({ build: meter });
    const element = loaded.document.querySelector('#meter') as FakeElement;
    loaded.api.allowance.set(element, { used: 2, left: 8, bonus: 0, bought: 0 });
    expect(keyText(loaded)).toEqual(['8 of 10 left', '2 used']);
    expect(
      loaded.document
        .querySelectorAll('.allowance-part')
        .map((part) => part.hasAttribute('hidden')),
    ).toEqual([false, false, true, true]);
    loaded.api.allowance.set(element, { used: -1, left: 'many', bought: 30 });
    expect(keyText(loaded)).toEqual(['8 of 10 left', '2 used', '+30 bought']);
  });

  it('sets the meter’s kind, which picks its left colour, and clears it with null', () => {
    const loaded = load({ build: meter });
    const element = loaded.document.querySelector('#meter') as FakeElement;
    loaded.api.allowance.set(element, { left: 8, kind: 'watch' });
    expect(attribute(element, 'data-meter-kind')).toBe('watch');
    loaded.api.allowance.set(element, { left: 8, kind: 'assist' });
    expect(attribute(element, 'data-meter-kind')).toBe('assist');
    // An unknown kind changes nothing; null removes it (left is green again).
    loaded.api.allowance.set(element, { left: 8, kind: 'gold' });
    expect(attribute(element, 'data-meter-kind')).toBe('assist');
    loaded.api.allowance.set(element, { left: 8, kind: null });
    expect(element.hasAttribute('data-meter-kind')).toBe(false);
    expect(kindBlock('watch')).toContain('--viz-left: var(--viz-indigo);');
    expect(kindBlock('assist')).toContain('--viz-left: var(--viz-teal);');
  });
});

describe('app-components.js · live rows (findings 9 and 12)', () => {
  const rows = (body: FakeElement): void => {
    body.append(h('table', {}, h('tbody', {}, h('tr', { id: 'one' }), h('tr', { id: 'two' }))));
  };

  it('gives new rows one 1.618s highlight, then takes it away', () => {
    const loaded = load({ build: rows });
    const found = loaded.document.querySelectorAll('tr');
    expect(loaded.api.flagNew(found)).toBe(2);
    expect(found.every((row) => row.classList.contains('is-new'))).toBe(true);
    expect(loaded.timers.filter((timer) => timer.ms === 1618).length).toBeGreaterThanOrEqual(2);
    flush(loaded);
    expect(found.some((row) => row.classList.contains('is-new'))).toBe(false);
  });

  it('highlights nothing while motion is paused or reduced', () => {
    for (const options of [
      { stored: { 'jobdeputy.deputyMotion': 'paused' } },
      { media: ['(prefers-reduced-motion: reduce)'] },
    ]) {
      const loaded = load({ build: rows, ...options });
      expect(loaded.api.flagNew(loaded.document.querySelector('#one') as FakeElement)).toBe(0);
      expect(loaded.document.querySelector('#one')?.classList.contains('is-new')).toBe(false);
    }
    const marked = load({ build: rows });
    marked.document.documentElement.setAttribute('data-motion', 'paused');
    expect(marked.api.flagNew(marked.document.querySelector('#one') as FakeElement)).toBe(0);
  });
});

describe('app-components.js · the list toolbar (finding 21)', () => {
  const DRAFTS: Array<[string, string, string, string, string]> = [
    ['Tailored résumé, Google', 'approval', 'resume', '2026-10-02', 'Google'],
    ['Cover letter, Google', 'approval', 'letter', '2026-10-01', 'Google'],
    ['Tailored résumé, Amazon', 'approved', 'resume', '2026-09-25', 'Amazon'],
    ['Cover letter, Northwind Labs', 'approved', 'letter', '2026-09-21', 'Northwind Labs'],
  ];
  const library = (body: FakeElement): void => {
    const chip = (name: string, value: string, type = 'radio', checked = false): FakeElement =>
      h(
        'label',
        { class: 'choice-chip' },
        h('input', { type, name, value, checked }),
        h('span', { class: 'list-toolbar-count' }, '?'),
      );
    body.append(
      h(
        'div',
        {
          class: 'list-toolbar',
          id: 'toolbar',
          'data-list-toolbar': true,
          'data-list-target': 'drafts',
          'data-list-empty': 'empty',
          'data-list-noun': 'draft',
          'data-list-nouns': 'drafts',
        },
        h('input', { type: 'search', id: 'search', 'data-list-search': true }),
        h(
          'fieldset',
          { 'data-list-filter': 'status' },
          chip('status', 'all', 'radio', true),
          chip('status', 'approval'),
          chip('status', 'approved'),
        ),
        h(
          'fieldset',
          { 'data-list-filter': 'kind' },
          chip('kind', 'resume', 'checkbox'),
          chip('kind', 'letter', 'checkbox'),
        ),
        h('select', { id: 'sort', 'data-list-sort': true, value: 'updated:desc' }),
        h('p', { 'data-list-count': true }, ''),
      ),
      h(
        'ul',
        { id: 'drafts' },
        ...DRAFTS.map(([title, status, kind, updated, company]) =>
          h(
            'li',
            {
              'data-list-item': true,
              'data-filter-status': status,
              'data-filter-kind': kind,
              'data-sort-updated': updated,
              'data-sort-company': company,
            },
            title,
          ),
        ),
      ),
      h('div', { id: 'empty', hidden: true }),
    );
  };
  const shown = (loaded: Loaded): string[] =>
    loaded.document
      .querySelectorAll('#drafts > li')
      .filter((item) => !item.hasAttribute('hidden'))
      .map((item) => item.textContent);
  const counts = (loaded: Loaded): string[] =>
    loaded.document.querySelectorAll('.list-toolbar-count').map((count) => count.textContent);
  const result = (loaded: Loaded): string =>
    loaded.document.querySelector('[data-list-count]')?.textContent ?? '';

  it('sorts newest first and counts every chip on load', () => {
    const loaded = load({ build: library });
    expect(shown(loaded)).toEqual(DRAFTS.map(([title]) => title));
    expect(counts(loaded)).toEqual(['4', '2', '2', '2', '2']);
    expect(result(loaded)).toBe('4 drafts');
  });

  it('filters by the search (ignoring case and accents), the chips, and the checkboxes', () => {
    const loaded = load({ build: library });
    const search = loaded.document.querySelector('#search') as FakeElement;
    search.value = 'RESUME';
    search.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    expect(shown(loaded)).toEqual(['Tailored résumé, Google', 'Tailored résumé, Amazon']);
    expect(result(loaded)).toBe('2 of 4 drafts');
    // Chip counts follow the search: each says what it would show.
    expect(counts(loaded)).toEqual(['2', '1', '1', '2', '0']);
    search.value = '';
    const approved = loaded.document.querySelector('input[value="approved"]') as FakeElement;
    for (const input of loaded.document.querySelectorAll('input[type="radio"]'))
      input.checked = input === approved;
    approved.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    expect(shown(loaded)).toEqual(['Tailored résumé, Amazon', 'Cover letter, Northwind Labs']);
    const letter = loaded.document.querySelector('input[value="letter"]') as FakeElement;
    letter.checked = true;
    letter.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    expect(shown(loaded)).toEqual(['Cover letter, Northwind Labs']);
    expect(result(loaded)).toBe('1 of 4 drafts');
  });

  it('sorts by any data-sort key, and shows the empty state and announces the result once', () => {
    const loaded = load({ build: library });
    const sort = loaded.document.querySelector('#sort') as FakeElement;
    sort.value = 'company:asc';
    sort.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    expect(shown(loaded)).toEqual([
      'Tailored résumé, Amazon',
      'Tailored résumé, Google',
      'Cover letter, Google',
      'Cover letter, Northwind Labs',
    ]);
    const search = loaded.document.querySelector('#search') as FakeElement;
    search.value = 'contoso';
    search.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    expect(shown(loaded)).toEqual([]);
    expect(result(loaded)).toBe('No drafts match');
    expect(loaded.document.querySelector('#empty')?.hasAttribute('hidden')).toBe(false);
    // Typing announces once, after a pause; a status channel inside the toolbar speaks.
    flush(loaded);
    const channel = loaded.document.querySelector('#toolbar > [role="status"]');
    expect(attribute(channel, 'aria-live')).toBe('polite');
    expect(channel?.textContent).toBe('No drafts match.');
  });
});

describe('app-components.js · paper (finding 29)', () => {
  const stack = (body: FakeElement): void => {
    body.append(
      h(
        'div',
        { class: 'paper-stack', id: 'stack', 'data-page-limit': '1', 'data-template': 'classic' },
        h(
          'div',
          { class: 'paper-stack-head' },
          h('span', { class: 'paper-count', 'data-paper-count': true }, ''),
        ),
        h('div', { class: 'paper-pages' }),
      ),
    );
  };
  const LONG = Array.from(
    { length: 60 },
    (_, line) => `Line ${line + 1} of a long draft that fills.`,
  ).join('\n\n');

  it('reads Markdown into blocks with text nodes only, so markup in the text stays text', () => {
    const { api } = load();
    const blocks = api.paper.markdown(
      '# Alex Morgan\nSeattle, WA · <b>bold?</b>\n\n## Skills\n- Go\n- **Java**\n\nA [link](https://example.com) and `code`.',
    );
    expect(blocks.map((block) => block.tagName)).toEqual(['H1', 'P', 'H2', 'UL', 'P']);
    expect(blocks[1]?.classList.contains('paper-contact')).toBe(true);
    expect(blocks[1]?.textContent).toBe('Seattle, WA · <b>bold?</b>');
    expect(blocks[1]?.querySelector('b')).toBeNull();
    expect(blocks[3]?.children.map((item) => item.textContent)).toEqual(['Go', 'Java']);
    expect(blocks[3]?.querySelector('strong')?.textContent).toBe('Java');
    expect(blocks[4]?.textContent).toBe('A link and code.');
  });

  it('lays the blocks into aria-hidden letter pages and counts them against the setting', () => {
    const loaded = load({ build: stack });
    const element = loaded.document.querySelector('#stack') as FakeElement;
    const short = loaded.api.paper.render(element, '# Alex Morgan\n\nOne line.');
    expect(short).toEqual({
      pages: 1,
      limit: 1,
      over: false,
      overflowLines: 0,
      text: '1 of 1 page',
    });
    const sheets = loaded.document.querySelectorAll('#stack .paper-sheet');
    expect(sheets.map((sheet) => attribute(sheet, 'aria-hidden'))).toEqual(['true']);
    expect(loaded.document.querySelector('.paper-number')?.textContent).toBe('Page 1');
    // The measuring sheet is gone again.
    expect(loaded.document.querySelector('.paper-measure')).toBeNull();

    const over = loaded.api.paper.render(element, LONG);
    expect(over.pages).toBe(2);
    expect(over.over).toBe(true);
    expect(over.text).toBe('Runs to 2 pages');
    expect(over.overflowLines).toBeGreaterThan(0);
    const count = loaded.document.querySelector('[data-paper-count]');
    expect(count?.textContent).toBe('Runs to 2 pages');
    expect(count?.classList.contains('is-over')).toBe(true);
    const figures = loaded.document.querySelectorAll('#stack figure.paper');
    expect(figures.map((figure) => figure.classList.contains('is-over'))).toEqual([false, true]);
    expect(figures[1]?.querySelector('.paper-number')?.textContent).toBe(
      'Page 2 · past your 1-page setting',
    );
    const roomy = loaded.api.paper.render(element, LONG, { limit: 2 });
    expect(roomy.text).toBe('2 of 2 pages');
    expect(attribute(element, 'data-page-limit')).toBe('2');
  });

  it('carries a heading at the foot of a page on with what follows it, and splits a long list', () => {
    const loaded = load({ build: stack });
    const element = loaded.document.querySelector('#stack') as FakeElement;
    const filler = Array.from({ length: 44 }, (_, line) => `Filler line ${line + 1}.`).join('\n\n');
    loaded.api.paper.render(element, `${filler}\n\n## Skills\nGo, Java, TypeScript`);
    const second = loaded.document.querySelectorAll('#stack .paper-flow')[1];
    expect(second?.children.map((block) => block.tagName)).toEqual(['H2', 'P']);
    const list = Array.from({ length: 50 }, (_, item) => `- Item ${item + 1}`).join('\n');
    loaded.api.paper.render(element, list);
    const flows = loaded.document.querySelectorAll('#stack .paper-flow');
    expect(flows).toHaveLength(2);
    expect(flows.map((flow) => flow.children[0]?.tagName)).toEqual(['UL', 'UL']);
    expect(flows[1]?.children[0]?.children[0]?.textContent).toBe('Item 46');
  });

  it('prints only the marked stack, and puts the marks back afterwards', () => {
    const loaded = load({
      build: (body) => {
        stack(body);
        body.append(h('div', { class: 'paper-stack', id: 'other', 'data-paper-print': true }));
      },
    });
    const element = loaded.document.querySelector('#stack') as FakeElement;
    expect(loaded.api.paper.print(element)).toBe(true);
    expect(loaded.printed.count).toBe(1);
    expect(element.hasAttribute('data-paper-print')).toBe(true);
    expect(loaded.document.querySelector('#other')?.hasAttribute('data-paper-print')).toBe(false);
    for (const run of loaded.windowListeners.get('afterprint') ?? []) run();
    expect(element.hasAttribute('data-paper-print')).toBe(false);
    expect(loaded.document.querySelector('#other')?.hasAttribute('data-paper-print')).toBe(true);
  });
});

describe('app-components.js · the document preview (finding 21)', () => {
  const LONG = Array.from({ length: 60 }, (_, line) => `Line ${line + 1} of the CV.`).join('\n\n');

  it('opens one modal dialog with the page, page n of m, thumbnails, the words, and Download', () => {
    const loaded = load({
      build: (body) => body.append(h('button', { type: 'button', id: 'opener' }, 'Preview')),
    });
    const opener = loaded.document.querySelector('#opener') as FakeElement;
    opener.focus();
    const result = loaded.api.preview.open(
      {
        title: 'Engineering_Leadership_CV.docx',
        meta: 'Default CV · DOCX',
        source: `# Alex Morgan\n\n${LONG}`,
      },
      opener,
    );
    expect(result).toEqual({ pages: 2 });
    const dialog = loaded.document.querySelector('dialog.doc-preview');
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(attribute(dialog, 'aria-labelledby')).toBe('jd-preview-title');
    expect(loaded.document.querySelector('#jd-preview-title')?.textContent).toBe(
      'Engineering_Leadership_CV.docx',
    );
    expect(loaded.document.querySelector('.doc-preview-count')?.textContent).toBe('Page 1 of 2');
    expect(attribute(loaded.document.querySelector('.doc-preview-stage'), 'aria-label')).toBe(
      'Page 1 of 2',
    );
    expect(attribute(loaded.document.querySelector('.doc-preview-stage'), 'tabindex')).toBe('0');
    const thumbs = loaded.document.querySelectorAll('.doc-preview-thumb');
    expect(thumbs.map((thumb) => attribute(thumb, 'aria-current'))).toEqual(['true', '']);
    // Round 5 (R1): Download works, as the shared small menu with PDF and Markdown.
    const download = loaded.document.querySelector(
      '.doc-preview-footer .download-menu [data-download-toggle]',
    );
    expect(download?.textContent).toBe('Download');
    expect(download?.hasAttribute('disabled')).toBe(false);
    expect(attribute(download, 'aria-expanded')).toBe('false');
    expect(
      loaded.document
        .querySelectorAll('.doc-preview-footer [data-download-format]')
        .map((choice) => attribute(choice, 'data-download-format')),
    ).toEqual(['pdf', 'md']);
    expect(
      loaded.document.querySelector('.doc-preview-footer .download-menu-note')?.textContent,
    ).toBe('A simple PDF of this text; the product’s PDF matches the template.');
    expect(loaded.document.querySelector('#jd-preview-note')).toBe(null);
    expect(
      loaded.document
        .querySelectorAll('.doc-preview .paper-sheet')
        .every((sheet) => attribute(sheet, 'aria-hidden') === 'true'),
    ).toBe(true);
    // The words keep the document's structure: its title as a heading, then its paragraphs
    // (round 4, UAT-A-14).
    const words = loaded.document.querySelector('.doc-preview-words');
    expect(words?.textContent).toMatch(/^Alex MorganLine 1 of the CV\./);
    expect(words?.querySelector('h3')?.textContent).toBe('Alex Morgan');
    expect(words?.querySelector('h3')?.classList.contains('doc-preview-words-heading')).toBe(true);
    expect(words?.querySelector('p')?.textContent).toMatch(/^Line 1 of the CV\./);

    loaded.document
      .querySelector('[data-preview-step="1"]')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(loaded.document.querySelector('.doc-preview-count')?.textContent).toBe('Page 2 of 2');
    expect(thumbs.map((thumb) => attribute(thumb, 'aria-current'))).toEqual(['', 'true']);
    expect(loaded.document.querySelector('[data-preview-step="1"]')?.hasAttribute('disabled')).toBe(
      true,
    );

    loaded.document
      .querySelector('[data-preview-close]')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(dialog?.hasAttribute('open')).toBe(false);
    expect(loaded.document.activeElement).toBe(opener);
  });
});

describe('app-components.js · the tour engine (R3-6)', () => {
  const page = (body: FakeElement): void => {
    body.append(
      h(
        'main',
        { 'data-tour-page': 'dashboard' },
        h('section', {
          id: 'third',
          'data-tour-step': '3',
          'data-tour-title': 'Third',
          'data-tour-text': 'Three.',
        }),
        h('section', {
          id: 'first',
          'data-tour-step': '1',
          'data-tour-title': 'First',
          'data-tour-text': 'One.',
        }),
        h(
          'section',
          { hidden: true },
          h('div', { 'data-tour-step': '2', 'data-tour-title': 'Hidden' }),
        ),
        h(
          'details',
          { id: 'more' },
          h('summary', {}, 'More'),
          h('p', { 'data-tour-step': '2.5', 'data-tour-title': 'In the details' }),
        ),
        h('section', {
          id: 'again',
          'data-tour-step': '1',
          'data-tour-title': 'First again',
          'data-tour-text': 'Tie.',
        }),
        h(
          'div',
          { 'data-tour': 'first-run' },
          h('section', { 'data-tour-step': '1', 'data-tour-title': 'Welcome' }),
        ),
        h('button', { type: 'button', id: 'open', 'data-tour-open': true }, 'Take the tour'),
        h(
          'button',
          { type: 'button', id: 'open-first', 'data-tour-open': 'first-run' },
          'First run',
        ),
        h('button', { type: 'button', id: 'open-none', 'data-tour-open': 'nowhere' }, 'Nothing'),
      ),
    );
  };
  const titles = (steps: FakeElement[]): string[] =>
    steps.map((step) => attribute(step, 'data-tour-title'));
  const card = (loaded: Loaded): FakeElement | null =>
    loaded.document.querySelector('dialog.tour-card');
  const shownButtons = (loaded: Loaded): string[] =>
    loaded.document
      .querySelectorAll('.tour-card [data-tour-action]')
      .filter((button) => !button.hasAttribute('hidden'))
      .map((button) => attribute(button, 'data-tour-action'));
  const hooks = () => {
    const calls: string[] = [];
    const deputy = {
      paused: false,
      hold: (pose: string) => calls.push(`hold:${pose}`),
      release: () => calls.push('release'),
    };
    const store = fakeStore(null, { withCounts: false });
    store.markTourSeen = (name: string) => calls.push(`seen:${name}`);
    return { calls, deputy, store };
  };

  it('orders steps by number, keeps document order for ties, and skips hidden targets', () => {
    const loaded = load({ build: page });
    expect(loaded.api.tour.page()).toBe('dashboard');
    expect(titles(loaded.api.tour.steps())).toEqual(['First', 'First again', 'Third']);
    expect(titles(loaded.api.tour.steps('first-run'))).toEqual(['Welcome']);
    loaded.document.querySelector('#more')?.setAttribute('open', '');
    expect(titles(loaded.api.tour.steps())).toEqual([
      'First',
      'First again',
      'In the details',
      'Third',
    ]);
  });

  it('shows each [data-tour-open] only while its tour has a step to show', () => {
    const loaded = load({ build: page });
    const hidden = (id: string): boolean | undefined =>
      loaded.document.querySelector(`#${id}`)?.hasAttribute('hidden');
    expect([hidden('open'), hidden('open-first'), hidden('open-none')]).toEqual([
      false,
      false,
      true,
    ]);
    for (const step of loaded.document.querySelectorAll('main > section'))
      step.setAttribute('hidden', '');
    loaded.api.tour.sync();
    expect([hidden('open'), hidden('open-first')]).toEqual([true, false]);
    expect(loaded.observers.some((observer) => observer.options?.childList === true)).toBe(true);
  });

  it('starts from its button: a labelled modal card, Back, Next, Done, Skip tour, and focus back', async () => {
    const { calls, deputy, store } = hooks();
    const loaded = load({
      build: page,
      deputy,
      store,
      media: ['(prefers-reduced-motion: reduce)'],
    });
    const heard: unknown[] = [];
    loaded.document.addEventListener('jobdeputy:tour', (event) => heard.push(event.detail));
    const opener = loaded.document.querySelector('#open') as FakeElement;
    opener.focus();
    opener.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    await settled();
    const dialog = card(loaded);
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(attribute(dialog, 'aria-labelledby')).toBe('jd-tour-title');
    expect(attribute(dialog, 'aria-describedby')).toBe('jd-tour-count jd-tour-text');
    expect(loaded.document.querySelector('#jd-tour-title')?.textContent).toBe('First');
    expect(loaded.document.querySelector('#jd-tour-count')?.textContent).toBe('Step 1 of 3');
    expect(shownButtons(loaded)).toEqual(['skip', 'next']);
    expect(attribute(loaded.document.activeElement, 'data-tour-action')).toBe('next');
    expect(calls).toEqual(['hold:guide']);
    expect(loaded.api.tour.active).toBe(true);

    loaded.document.activeElement?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    await settled();
    expect(loaded.document.querySelector('#jd-tour-count')?.textContent).toBe('Step 2 of 3');
    expect(shownButtons(loaded)).toEqual(['skip', 'back', 'next']);
    flush(loaded);
    expect(dialog?.querySelector('[role="status"]')?.textContent).toBe(
      'Step 2 of 3. First again. Tie.',
    );

    loaded.api.tour.next();
    await settled();
    expect(loaded.document.querySelector('#jd-tour-count')?.textContent).toBe('Step 3 of 3');
    expect(shownButtons(loaded)).toEqual(['back', 'done']);
    expect(attribute(loaded.document.activeElement, 'data-tour-action')).toBe('done');

    loaded.document.activeElement?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(dialog?.hasAttribute('open')).toBe(false);
    expect(loaded.document.querySelector('.tour-spotlight')?.hasAttribute('hidden')).toBe(true);
    expect(calls).toEqual(['hold:guide', 'release', 'seen:dashboard']);
    expect(loaded.document.activeElement).toBe(opener);
    expect(heard).toEqual([
      { type: 'start', page: 'dashboard', steps: 3 },
      { type: 'end', page: 'dashboard', reason: 'done', step: 3, steps: 3 },
    ]);
  });

  it('ends on Escape (the dialog’s cancel) and on Skip tour, and steps with the arrow keys', async () => {
    const { calls, deputy, store } = hooks();
    const loaded = load({
      build: page,
      deputy,
      store,
      media: ['(prefers-reduced-motion: reduce)'],
    });
    expect(loaded.api.tour.start()).toBe(true);
    await settled();
    expect(loaded.api.tour.start()).toBe(false);
    card(loaded)?.dispatchEvent(new FakeEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    await settled();
    expect(loaded.api.tour.step).toBe(2);
    card(loaded)?.dispatchEvent(new FakeEvent('keydown', { bubbles: true, key: 'ArrowLeft' }));
    await settled();
    expect(loaded.api.tour.step).toBe(1);
    const cancel = new FakeEvent('cancel');
    card(loaded)?.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(card(loaded)?.hasAttribute('open')).toBe(false);
    expect(loaded.api.tour.active).toBe(false);
    loaded.api.tour.start();
    await settled();
    loaded.document
      .querySelector('.tour-card [data-tour-action="skip"]')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(loaded.api.tour.active).toBe(false);
    expect(calls.filter((call) => call.startsWith('seen:'))).toEqual([
      'seen:dashboard',
      'seen:dashboard',
    ]);
  });

  // Round 6 (G6, R6-2): the deputy gives the tour through A1's guide API when it is there.
  const guideHooks = () => {
    const calls: unknown[][] = [];
    const deputy = {
      paused: false,
      hold: (pose: string) => calls.push(['hold', pose]),
      release: () => calls.push(['dock-release']),
      guide: (host: FakeElement, options: Record<string, unknown>) => {
        calls.push(['guide', attribute(host, 'class'), options]);
        return {
          active: true,
          update: (next: Record<string, unknown>) => calls.push(['update', next]),
          release: (options?: Record<string, unknown>) => calls.push(['release', options]),
        };
      },
    };
    const store = fakeStore(null, { withCounts: false });
    store.markTourSeen = (name: string) => calls.push(['seen', name]);
    return { calls, deputy, store };
  };

  it('narrates through the deputy: his slot, his speech line, his pointer, and a finished release', async () => {
    const { calls, deputy, store } = guideHooks();
    const loaded = load({
      build: page,
      deputy,
      store,
      media: ['(prefers-reduced-motion: reduce)'],
    });
    expect(loaded.api.tour.start()).toBe(true);
    await settled();
    const dialog = card(loaded) as FakeElement;
    // The slot is the card's first child, decorative, and the card says it has its guide.
    expect(attribute(dialog.children[0], 'class')).toBe('tour-card-guide');
    expect(attribute(dialog.children[0], 'aria-hidden')).toBe('true');
    expect(dialog.hasAttribute('data-guide')).toBe(true);
    expect(['left', 'right', 'up', 'down']).toContain(attribute(dialog, 'data-point'));
    expect(calls[0]?.[0]).toBe('guide');
    expect(calls[0]?.[1]).toBe('tour-card-guide');
    expect(calls[0]?.[2]).toMatchObject({ speech: 'First' });
    // He takes over from the dock's pose: no hold.
    expect(calls.some((call) => call[0] === 'hold')).toBe(false);
    // The button reads Skip the tour (round 6).
    expect(dialog.querySelector('[data-tour-action="skip"]')?.textContent).toBe('Skip the tour');

    loaded.api.tour.next();
    await settled();
    expect(calls).toContainEqual(['update', { speech: 'First again' }]);
    loaded.api.tour.next();
    await settled();
    loaded.document
      .querySelector('.tour-card [data-tour-action="done"]')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(calls.at(-2)).toEqual(['release', { finished: true }]);
    expect(calls.at(-1)).toEqual(['seen', 'dashboard']);
    expect(dialog.hasAttribute('data-guide')).toBe(false);
    expect(calls.some((call) => call[0] === 'dock-release')).toBe(false);
  });

  it('says a speech line that ends in a full stop with one full stop', async () => {
    const loaded = load({ build: page, media: ['(prefers-reduced-motion: reduce)'] });
    loaded.document.querySelector('#again')?.setAttribute('data-tour-title', 'I keep it here.');
    loaded.api.tour.start();
    await settled();
    loaded.api.tour.next();
    await settled();
    flush(loaded);
    expect(card(loaded)?.querySelector('[role="status"]')?.textContent).toBe(
      'Step 2 of 3. I keep it here. Tie.',
    );
  });

  it('releases him quietly on Skip and on Escape', async () => {
    const { calls, deputy, store } = guideHooks();
    const loaded = load({
      build: page,
      deputy,
      store,
      media: ['(prefers-reduced-motion: reduce)'],
    });
    loaded.api.tour.start();
    await settled();
    loaded.document
      .querySelector('.tour-card [data-tour-action="skip"]')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(calls.filter((call) => call[0] === 'release')).toEqual([['release', undefined]]);
    loaded.api.tour.start();
    await settled();
    card(loaded)?.dispatchEvent(new FakeEvent('cancel'));
    expect(calls.filter((call) => call[0] === 'release')).toEqual([
      ['release', undefined],
      ['release', undefined],
    ]);
  });

  it('aims his pointer at the target from where the card sits, unless a step names it', async () => {
    const { calls, deputy, store } = guideHooks();
    const loaded = load({
      build: withHeader(),
      deputy,
      store,
      media: ['(prefers-reduced-motion: reduce)'],
    });
    const first = loaded.document.querySelector('#first') as FakeElement;
    first.rect = { top: 93, left: 300, width: 400, height: 200 };
    loaded.api.tour.start();
    await settled();
    const dialog = card(loaded) as FakeElement;
    dialog.rect = { top: 322, left: 300, width: 360, height: 240 };
    scrolled(loaded);
    // The card sits under the target, so he points up.
    expect(attribute(dialog, 'data-point')).toBe('up');
    // Beside it, on its right and level with it: he points left.
    first.rect = { top: 85, left: 300, width: 400, height: 240 };
    dialog.rect = { top: 85, left: 729, width: 360, height: 240 };
    scrolled(loaded);
    expect(attribute(dialog, 'data-point')).toBe('left');
    expect(calls).toContainEqual(['update', { point: 'left' }]);
    // Off to the left and clearly lower than the card: down, not left (A1: the left pose reads
    // weakest, so it is kept for a target level with the card).
    first.rect = { top: 93, left: 300, width: 400, height: 600 };
    scrolled(loaded);
    expect(attribute(dialog, 'data-point')).toBe('down');
    // Off to the right and sharing the card's height: right, even well below its middle.
    first.rect = { top: 280, left: 1100, width: 300, height: 300 };
    scrolled(loaded);
    expect(attribute(dialog, 'data-point')).toBe('right');
    // A step may choose the direction itself.
    first.setAttribute('data-tour-point', 'down');
    scrolled(loaded);
    expect(attribute(dialog, 'data-point')).toBe('down');
  });

  // A page with a 72px sticky header; the target's box is where the page has scrolled it to.
  const withHeader =
    (size: [number, number] = [1440, 900]) =>
    (body: FakeElement): void => {
      const header = h('header', { class: 'app-header' });
      header.style.position = 'sticky';
      header.rect = { top: 0, left: 0, width: size[0], height: 72 };
      body.append(header);
      page(body);
    };
  const scrolled = (loaded: Loaded): void => {
    for (const run of loaded.windowListeners.get('scroll') ?? []) run();
    flush(loaded);
  };
  const ringOf = (loaded: Loaded): string[] => {
    const spot = loaded.document.querySelector('.tour-spotlight');
    return [String(spot?.style.transform), String(spot?.style.width), String(spot?.style.height)];
  };
  const cardAt = (loaded: Loaded): string[] => [
    String(card(loaded)?.style.left),
    String(card(loaded)?.style.top),
  ];

  it('scrolls each target’s top to just below the sticky chrome, not merely into view', async () => {
    const loaded = load({ build: withHeader(), media: ['(prefers-reduced-motion: reduce)'] });
    const first = loaded.document.querySelector('#first') as FakeElement;
    // In view already: the nearest edge would not move, but the step starts from the top.
    first.rect = { top: 600, left: 300, width: 400, height: 200 };
    loaded.api.tour.start();
    await settled();
    // The ring's top (600 - 8) goes to 13px below the 72px header.
    expect(loaded.scrolls.at(-1)).toEqual({ top: 507, behavior: 'instant' });
    const spot = loaded.document.querySelector('.tour-spotlight');
    expect(spot?.hasAttribute('hidden')).toBe(false);
    expect(spot?.classList.contains('is-moving')).toBe(false);

    // A target in a fixed layer does not move with the page, so the page stays put.
    loaded.api.tour.end();
    const count = loaded.scrolls.length;
    first.style.position = 'fixed';
    loaded.api.tour.start();
    await settled();
    expect(loaded.scrolls).toHaveLength(count);
  });

  it('lets a page’s entrance finish before it scrolls to a step, and ignores endless motion', async () => {
    const loaded = load({ build: withHeader(), media: ['(prefers-reduced-motion: reduce)'] });
    const main = loaded.document.querySelector('main') as FakeElement;
    const first = loaded.document.querySelector('#first') as FakeElement;
    first.rect = { top: 600, left: 300, width: 400, height: 200 };
    let finish = (): void => undefined;
    const entrance = {
      playState: 'running',
      effect: { target: main, getComputedTiming: () => ({ endTime: 380 }) },
      finished: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    };
    const pulse = {
      playState: 'running',
      effect: { target: first, getComputedTiming: () => ({ endTime: Number.POSITIVE_INFINITY }) },
      finished: new Promise<void>(() => undefined),
    };
    Object.assign(loaded.document, { getAnimations: () => [entrance, pulse] });
    loaded.api.tour.start();
    await settled();
    expect(loaded.scrolls).toEqual([]);
    entrance.playState = 'finished';
    finish();
    await settled();
    expect(loaded.scrolls).toEqual([{ top: 507, behavior: 'instant' }]);
  });

  // UAT-RD RD-1: the glide to a step is timed by the clock, not by frames (a hidden page draws
  // none), so a glide that never moves the page still lands the step.
  it('RD-1: glides to a near step, jumps the rest of a glide that stands still, and jumps far', async () => {
    let now = 1000;
    class FakeDate extends Date {
      static override now(): number {
        return now;
      }
    }
    const loaded = load({ build: withHeader(), globals: { Date: FakeDate } });
    const scrolls: Array<{ top: number; behavior: string }> = [];
    // A smooth scroll here never moves the page; an instant one does.
    loaded.window.scrollTo = (options: { top: number; behavior: string }) => {
      scrolls.push(options);
      if (options.behavior !== 'smooth') loaded.window.scrollY = options.top;
    };
    const first = loaded.document.querySelector('#first') as FakeElement;
    first.rect = { top: 600, left: 300, width: 400, height: 200 };
    loaded.api.tour.start();
    await settled();
    expect(scrolls).toEqual([{ top: 507, behavior: 'smooth' }]);
    // Standing still for less than 250ms, it waits.
    now += 200;
    flush(loaded);
    expect(scrolls).toHaveLength(1);
    // Then the page jumps the rest, and the step comes to rest where it should.
    now += 60;
    flush(loaded);
    await settled();
    expect(scrolls).toEqual([
      { top: 507, behavior: 'smooth' },
      { top: 507, behavior: 'instant' },
    ]);

    // A person who scrolls meanwhile keeps the page where they put it.
    loaded.api.tour.end();
    loaded.window.scrollY = 0;
    scrolls.length = 0;
    loaded.api.tour.start();
    await settled();
    for (const run of loaded.windowListeners.get('wheel') ?? []) run();
    now += 2000;
    flush(loaded);
    await settled();
    expect(scrolls).toEqual([{ top: 507, behavior: 'smooth' }]);

    // A step more than a screen and a half away is jumped to.
    loaded.api.tour.end();
    loaded.window.scrollY = 0;
    scrolls.length = 0;
    first.rect = { top: 3000, left: 300, width: 400, height: 200 };
    loaded.api.tour.start();
    await settled();
    expect(scrolls).toEqual([{ top: 2907, behavior: 'instant' }]);

    // So is any step on a hidden page.
    loaded.api.tour.end();
    loaded.window.scrollY = 0;
    scrolls.length = 0;
    first.rect = { top: 600, left: 300, width: 400, height: 200 };
    Object.assign(loaded.document, { hidden: true });
    loaded.api.tour.start();
    await settled();
    expect(scrolls).toEqual([{ top: 507, behavior: 'instant' }]);
  });

  it('puts the card below the target, else beside it, else above it, and never over its ring', async () => {
    const loaded = load({ build: withHeader(), media: ['(prefers-reduced-motion: reduce)'] });
    const first = loaded.document.querySelector('#first') as FakeElement;
    loaded.api.tour.start();
    await settled();
    const dialog = card(loaded) as FakeElement;
    dialog.rect = { top: 0, left: 0, width: 360, height: 240 };

    // Below: the ring (8px round the box) and the card 21px under it, at the target's left.
    first.rect = { top: 93, left: 300, width: 400, height: 200 };
    scrolled(loaded);
    expect(ringOf(loaded)).toEqual(['translate(292px, 85px)', '416px', '216px']);
    expect(cardAt(loaded)).toEqual(['300px', '322px']);

    // Beside: too tall for the card below, so it sits to the right, level with the ring's top.
    first.rect = { top: 93, left: 300, width: 400, height: 600 };
    scrolled(loaded);
    expect(ringOf(loaded)).toEqual(['translate(292px, 85px)', '416px', '616px']);
    expect(cardAt(loaded)).toEqual(['729px', '85px']);

    // Above: full width and low in the viewport (the page could scroll no further).
    first.rect = { top: 500, left: 0, width: 1440, height: 300 };
    scrolled(loaded);
    expect(ringOf(loaded)).toEqual(['translate(-8px, 492px)', '1456px', '316px']);
    expect(cardAt(loaded)).toEqual(['13px', '231px']);
  });

  it('rings only the visible top of a target taller than the room, with the card under it', async () => {
    const loaded = load({ build: withHeader(), media: ['(prefers-reduced-motion: reduce)'] });
    const first = loaded.document.querySelector('#first') as FakeElement;
    loaded.api.tour.start();
    await settled();
    const dialog = card(loaded) as FakeElement;
    dialog.rect = { top: 0, left: 0, width: 360, height: 240 };
    first.rect = { top: 93, left: 0, width: 1440, height: 1200 };
    scrolled(loaded);
    // The card sits at the foot of the viewport (900 - 13 - 240), and the ring stops 21px above.
    expect(ringOf(loaded)).toEqual(['translate(-8px, 85px)', '1456px', '541px']);
    expect(cardAt(loaded)).toEqual(['13px', '647px']);
    // Scrolled further by hand, the ring never reaches under the header.
    first.rect = { top: -300, left: 0, width: 1440, height: 1200 };
    scrolled(loaded);
    expect(ringOf(loaded)).toEqual(['translate(-8px, 72px)', '1456px', '554px']);
  });

  it('on phones keeps the ring above the bottom sheet', async () => {
    const loaded = load({
      build: withHeader([390, 844]),
      media: ['(prefers-reduced-motion: reduce)', '(max-width: 720px)'],
      size: [390, 844],
    });
    const first = loaded.document.querySelector('#first') as FakeElement;
    loaded.api.tour.start();
    await settled();
    const sheet = card(loaded) as FakeElement;
    sheet.rect = { top: 544, left: 0, width: 390, height: 300 };
    first.rect = { top: 93, left: 21, width: 348, height: 800 };
    scrolled(loaded);
    // The sheet's top (544) less 13px of room: the ring shows the target's top 446px.
    expect(ringOf(loaded)).toEqual(['translate(13px, 85px)', '364px', '446px']);
    expect(cardAt(loaded)).toEqual(['', '']);
  });

  it('ends a tour with no opener on the main heading, not the skip link (D15)', () => {
    const loaded = load({
      build: (body) => {
        body.append(h('a', { class: 'skip-link', href: '#main' }, 'Skip to content'));
        page(body);
        body.querySelector('main')?.prepend(h('h1', { id: 'title' }, 'Dashboard'));
      },
      search: '?skipLoader&tour=1',
      media: ['(prefers-reduced-motion: reduce)'],
    });
    flush(loaded);
    expect(loaded.api.tour.active).toBe(true);
    loaded.api.tour.end('skip');
    const heading = loaded.document.querySelector('#title');
    expect(loaded.document.activeElement).toBe(heading);
    expect(attribute(heading, 'tabindex')).toBe('-1');

    // A tour started while focus sat on the skip link has no opener either.
    loaded.document.querySelector('.skip-link')?.focus();
    expect(loaded.api.tour.start()).toBe(true);
    loaded.api.tour.end('done');
    expect(loaded.document.activeElement).toBe(heading);
  });

  it('never starts on a plain load; starts from ?tour=1, and after setup only while unseen', () => {
    const plain = load({ build: page });
    flush(plain);
    expect(plain.api.tour.active).toBe(false);
    expect(plain.api.tour.maybeStart('dashboard')).toBe(false);
    expect(plain.api.tour.maybeStart('dashboard', { from: 'login' })).toBe(false);

    const asked = load({ build: page, search: '?skipLoader&tour=1' });
    expect(asked.api.tour.active).toBe(false);
    flush(asked);
    expect(asked.api.tour.active).toBe(true);

    const unseen = fakeStore(null, { withCounts: false });
    unseen.get = () => ({ tours: { seen: {} } });
    const fresh = load({ build: page, store: unseen });
    expect(fresh.api.tour.maybeStart('dashboard', { from: 'onboarding' })).toBe(true);
    flush(fresh);
    expect(fresh.api.tour.active).toBe(true);

    const seen = fakeStore(null, { withCounts: false });
    seen.get = () => ({ tours: { seen: { dashboard: true } } });
    const again = load({ build: page, store: seen });
    expect(again.api.tour.maybeStart('dashboard', { from: 'onboarding' })).toBe(false);
  });
});

// ------------------------------------------------------------------ round 3: the gallery

// A section by its id, from its comment marker to the next one (sections hold inner <section>s).
const roundSection = (id: string): string => {
  const start = gallery.indexOf(`<section class="gallery-section" id="${id}"`);
  const next = gallery.indexOf('\n        <!-- ', start);
  return start < 0 ? '' : gallery.slice(start, next < 0 ? undefined : next);
};

describe('components-preview.html · round 3 components', () => {
  it('writes no en dash, and sorts by company as the pages do', () => {
    expect(gallery).not.toContain('\u2013');
    expect(gallery).toContain('<option>Company, A to Z</option>');
    for (const source of [script, components]) expect(source).not.toMatch(/[\u2013\u2014]/);
  });

  it('shows every new component in its own numbered section', () => {
    for (const [id, title] of [
      ['split-tile', 'Split tile'],
      ['allowance', 'Allowance meter'],
      ['tooltip', 'Tooltip'],
      ['chart-key', 'Chart key'],
      ['live', 'Live pill and table'],
      ['list-toolbar', 'List toolbar'],
      ['need-markers', 'Need markers'],
      ['paper', 'Paper'],
      ['doc-preview', 'Document preview'],
      ['panels', 'Panels'],
      ['tour', 'Tour'],
    ] as Array<[string, string]>) {
      expect(roundSection(id), id).toContain(`>${title}</h2>`);
      expect(gallery, id).toMatch(
        new RegExp(`<li><a href="#${id}"><span class="gallery-index-number">\\d\\d</span>`),
      );
    }
  });

  it('builds the split tile from parts that each link and each carry a tip in the brief’s pattern', () => {
    const tile = roundSection('split-tile').split('<div class="gallery-specimens')[0] ?? '';
    const segments = [
      ...tile.matchAll(/<a class="stack-bar-seg" href="([^"]+)" tabindex="-1"/g),
    ].map((m) => m[1]);
    const keys = [
      ...tile.matchAll(
        /<a\s+class="chart-key-item"\s+href="([^"]+)"\s+data-tip-title="([^"]+)"\s+data-tip="([^"]+)"/g,
      ),
    ];
    expect(segments).toHaveLength(8);
    expect(keys.map((key) => key[1])).toEqual(segments);
    for (const [, , title = '', words = ''] of keys) {
      expect(title).toMatch(/^[A-Z][\w ]+ · \d+ roles?$/);
      expect(words).toMatch(/\. Opens (?:Job matches|Applications) filtered to [A-Z][\w ]+\.$/);
    }
    expect(tile).toContain(
      '<ul class="chart-key is-compact is-inline" aria-label="Fit of the 27 roles">',
    );
    expect(tile).toMatch(/<a\s+class="kpi-split-value"\s+href="\.\/jobs-preview\.html\?view=all"/);
    expect(tile).toMatch(/<li class="is-split">/);
    expect(textOf(tile)).toContain('Strong fit 4');
    expect(textOf(tile)).toContain('Stretch 14');
  });

  it('writes the allowance numbers as text beside the four looks, each meter with its kind', () => {
    const meter = roundSection('allowance');
    expect(textOf(meter.match(/<ul class="allowance-key">[\s\S]*?<\/ul>/)?.[0] ?? '')).toBe(
      '239,100 free left 10,900 used + 100,000 bonus + 0 bought',
    );
    for (const part of ['used', 'left', 'bonus', 'bought']) {
      expect(meter).toContain(`<span class="allowance-part" data-part="${part}" style="--count:`);
    }
    expect(meter).toContain(
      'id="gallery-allowance-ai"\n                  data-meter-kind="assist"',
    );
    expect(meter).toContain('id="gallery-allowance-watch" data-meter-kind="watch"');
    expect(meter).toContain(
      '<p class="allowance-note">Lasts through Tue, Oct 6 · 2 a night for 2 sources</p>',
    );
  });

  it('carries the panel openers exactly as pages write them, with a fallback for each script', () => {
    const panels = roundSection('panels');
    expect(panels).toContain(
      '<button type="button" class="secondary-action" data-prompt-open="rank">See the prompt</button>',
    );
    expect(panels).toContain(
      '<button type="button" class="secondary-action" data-topup-open="nightly">More nightly runs</button>',
    );
    // Round 5 (G3, brief 3.5): the buy dialog's kinds are credits and nightly; AI runs are retired.
    expect(panels).toContain(
      '<button type="button" class="secondary-action" data-topup-open="credits">Buy credits</button>',
    );
    expect(panels).toContain('button[data-topup-open="credits|nightly"]');
    expect(panels).not.toContain('data-topup-open="ai"');
    expect(panels).toContain('this gallery loads as the app pages do');
    expect(panels).not.toContain('does not load');
    // The readout speaks only when app-panels.js is missing.
    expect(panels).toContain('<p class="gallery-readout" id="gallery-panels-readout" hidden></p>');
    expect(gallery).toContain('if (!opener || window.JobDeputyPanels) return;');
    expect(gallery).toContain('if (!opener || window.JobDeputyFeedback) return;');
  });

  it('marks a demo tour: six steps in number order, one more inside a closed details', () => {
    expect(gallery).toContain('<main id="main" data-tour-page="components">');
    const steps = [
      ...gallery.matchAll(
        /data-tour-step="([\d.]+)"\s+data-tour-title="([^"]+)"\s+data-tour-text="([^"]+)"/g,
      ),
    ];
    expect(steps.map((step) => step[1]).sort()).toEqual(['1', '2', '3', '4', '4.5', '5', '6']);
    for (const [, , title = '', words = ''] of steps) {
      expect(title.length).toBeLessThanOrEqual(34);
      expect(words.split(/\s+/).length).toBeLessThanOrEqual(34);
      expect(`${title} ${words}`).not.toMatch(/[–—]/);
    }
    const hidden =
      gallery.match(/<details class="gallery-tour-hidden">[\s\S]*?<\/details>/)?.[0] ?? '';
    expect(hidden).toContain('data-tour-step="4.5"');
    const openers = [
      ...gallery.matchAll(
        /<button type="button" class="(?:secondary|primary)-action" data-tour-open hidden>Take the tour<\/button>/g,
      ),
    ];
    expect(openers).toHaveLength(2);
  });

  it('writes the need markers with their words, and leaves self-identification unmarked', () => {
    const markers = roundSection('need-markers').split('<div class="gallery-specimens')[0] ?? '';
    expect(markers).toContain('<span class="need-pill" data-need="required">Required</span>');
    expect(markers).toContain('<span class="need-pill" data-need="optional">Optional</span>');
    expect(markers).toMatch(
      /<a class="need-add" data-need="required" href="\.\/profile-preview\.html#about">Add postal code<span class="need-add-word">Required<\/span><\/a>/,
    );
    expect(textOf(markers.match(/<p\s+class="need-summary"[\s\S]*?<\/p>/)?.[0] ?? '')).toBe(
      '2 required, 7 optional to add',
    );
    // "to add" sits one word space after the last count, not the 8px gap that keeps the markers
    // clear (round 5 acceptance, F2's request 2).
    expect(
      readFileSync(resolve(brandDirectory, 'app-components.css'), 'utf8').replace(/\s+/g, ' '),
    ).toContain(
      '.need-summary > :not(.need-summary-part) { margin-inline-start: calc(0.25em - 8px); }',
    );
    const gender =
      markers.match(/<li>\s*<span class="gallery-need-field">Gender<\/span>[\s\S]*?<\/li>/)?.[0] ??
      '';
    expect(gender).not.toMatch(/need-(?:pill|add|summary)/);
  });

  it('makes every live table row a link and keys the table on explicit roles', () => {
    const live = roundSection('live').split('<div class="gallery-specimens')[0] ?? '';
    const rows = [
      ...live.matchAll(
        /<tr role="row">\s*<td role="cell" class="live-table-role"><a class="live-table-link" href="([^"]+)">/g,
      ),
    ];
    expect(rows).toHaveLength(5);
    for (const [, href] of rows)
      expect(href).toMatch(/^\.\/jobs-preview\.html\?view=all&amp;job=[\w-]+$/);
    expect(live).toContain(
      '<table class="live-table" role="table" aria-labelledby="gallery-live-title">',
    );
    expect(live).toContain(
      '<span class="live-pill is-live" id="gallery-live-pill"><span class="live-pill-dot" aria-hidden="true"></span>',
    );
  });

  it('keeps the list toolbar wired to its list, its empty state, and its nouns', () => {
    const toolbar = roundSection('list-toolbar');
    expect(toolbar).toMatch(
      /<search\s+class="list-toolbar"\s+aria-label="Find a draft"\s+data-list-toolbar\s+data-list-target="gallery-drafts"\s+data-list-empty="gallery-drafts-empty"\s+data-list-noun="draft"\s+data-list-nouns="drafts"/,
    );
    expect([...toolbar.matchAll(/<li data-list-item /g)]).toHaveLength(12);
    expect(toolbar).toContain('<div class="empty-state" id="gallery-drafts-empty" hidden>');
  });
});

// ------------------------------------------------------------------ round 4: the stylesheet

describe('app-components.css · round 4 components (brief 3.2)', () => {
  const phone = (rule: StyleRule): boolean =>
    rule.media.some((query) => /max-width:\s*720px/.test(query));

  it('draws the ring meter in the bar meter’s four looks, at 88px compact and 120px regular', () => {
    expect(declared(componentRules, '.allowance-ring', 'width')).toBe('120px');
    expect(declared(componentRules, '.allowance-ring.is-compact', 'width')).toBe('88px');
    expect(declared(componentRules, '.allowance-ring > .allowance-part', 'display')).toBe('none');
    expect(declared(componentRules, '.allowance-ring-track', 'fill')).toBe('var(--viz-track)');
    // Left takes the meter's kind (data-meter-kind sets --viz-left); bonus and bought are solid.
    expect(declared(componentRules, '.allowance-ring-seg[data-part="left"]', 'fill')).toBe(
      'var(--viz-left)',
    );
    expect(declared(componentRules, '.allowance-ring-seg[data-part="bonus"]', 'fill')).toBe(
      'var(--viz-bonus)',
    );
    expect(declared(componentRules, '.allowance-ring-seg[data-part="bought"]', 'fill')).toBe(
      'var(--viz-bought)',
    );
    expect(
      declared(componentRules, '.allowance-ring-seg[data-part="bonus"]', 'stroke'),
    ).toBeUndefined();
    // Used is the pattern the script draws: quiet grey stripes on the light ground, as the bar's.
    expect(declared(componentRules, '.allowance-ring-hatch-line', 'fill')).toBe('var(--viz-used)');
    expect(declared(componentRules, '.allowance-ring-hatch-ground', 'fill')).toBe(
      'var(--viz-used-ground)',
    );
    // No rule paints the used segment over its pattern.
    expect(
      declared(componentRules, '.allowance-ring-seg[data-part="used"]', 'fill'),
    ).toBeUndefined();
    expect(declared(componentRules, '.allowance-ring-seg', 'fill')).toBeUndefined();
    expect(declared(componentRules, '.allowance-ring-figure', 'font-size')).toBe('28px');
    expect(declared(componentRules, '.allowance-ring-figure.is-long', 'font-size')).toBe('15px');
    expect(declared(componentRules, '.allowance-ring-unit', 'color')).toBe('var(--muted)');
    expect(declared(componentRules, '.allowance.is-reached .allowance-ring-figure', 'color')).toBe(
      'var(--danger-ink)',
    );
    expect(
      declared(componentRules, '.allowance.is-reached .allowance-label::before', 'content'),
    ).toBe('"!" / ""');
  });

  it('keeps the ring’s four parts distinct in forced colours, and the key’s swatches with them', () => {
    expect(
      declared(
        componentRules,
        '.allowance-ring-art .allowance-ring-seg[data-part="left"]',
        'fill',
        isForced,
      ),
    ).toBe('Highlight');
    expect(
      declared(
        componentRules,
        '.allowance-ring-art .allowance-ring-seg[data-part="bonus"]',
        'fill',
        isForced,
      ),
    ).toBe('LinkText');
    expect(
      declared(
        componentRules,
        '.allowance-ring-art .allowance-ring-seg[data-part="bought"]',
        'fill',
        isForced,
      ),
    ).toBe('CanvasText');
    expect(
      declared(componentRules, '.allowance-ring-art .allowance-ring-hatch-line', 'fill', isForced),
    ).toBe('CanvasText');
    expect(
      declared(
        componentRules,
        '.allowance-ring-art .allowance-ring-hatch-ground',
        'fill',
        isForced,
      ),
    ).toBe('Canvas');
    expect(
      declared(
        componentRules,
        '.allowance.is-ring .allowance-key-item[data-part="bonus"]::before',
        'background',
        isForced,
      ),
    ).toBe('LinkText');
    expect(
      declared(
        componentRules,
        '.allowance.is-ring .allowance-key-item[data-part="bought"]::before',
        'background',
        isForced,
      ),
    ).toBe('CanvasText');
    const kept = componentRules
      .filter(isForced)
      .filter((rule) => rule.declarations.some((item) => item.property === 'forced-color-adjust'))
      .flatMap((rule) => rule.selectors);
    expect(kept).toContain('.allowance-ring-art');
    expect(kept).toContain('.run-tracker-step::before');
    // Each forced rule outweighs the tone it replaces.
    for (const [forced, plain] of <Array<[string, string]>>[
      [
        '.allowance-ring-art .allowance-ring-seg[data-part="left"]',
        '.allowance-ring-seg[data-part="left"]',
      ],
      ['.allowance-ring-art .allowance-ring-hatch-line', '.allowance-ring-hatch-line'],
    ]) {
      expect(compareSpecificity(specificity(forced), specificity(plain)), forced).toBeGreaterThan(
        0,
      );
    }
  });

  it('gives the donut tile an 88px ring with a linked centre of 48px or more and the green focus ring', () => {
    expect(declared(componentRules, '.donut.is-tile .donut-ring', 'width')).toBe('88px');
    expect(declared(componentRules, 'a.donut-total', 'min-width')).toBe('48px');
    expect(declared(componentRules, 'a.donut-total', 'min-height')).toBe('48px');
    expect(declared(componentRules, 'a.donut-total', 'pointer-events')).toBe('auto');
    expect(declared(componentRules, 'a.donut-total:focus-visible', 'outline')).toBe(
      '2px solid var(--green)',
    );
    // The plain donut's centre stays out of the pointer's way.
    expect(declared(componentRules, '.donut-total', 'pointer-events')).toBe('none');
  });

  it('pulses the tracker’s current step only while the run is live, and keeps its figures tabular', () => {
    expect(
      declared(
        componentRules,
        '.run-tracker[data-state="live"] .run-tracker-step.is-current::before',
        'animation',
      ),
    ).toBe('jd-step-pulse 1.618s var(--ease-settle) infinite');
    expect(
      declared(componentRules, '.run-tracker-step.is-current::before', 'animation'),
    ).toBeUndefined();
    expect(declared(componentRules, '.run-tracker-time', 'font-variant-numeric')).toBe(
      'tabular-nums',
    );
    // Round 5: each stage's counter is tabular too, and the round 4 time bar and Checked and New
    // list never show (nobody knows how long a crawl takes; the steps say the figures).
    expect(declared(componentRules, '.run-tracker-step-count', 'font-variant-numeric')).toBe(
      'tabular-nums',
    );
    expect(declared(componentRules, '.run-tracker-bar', 'display')).toBe('none');
    expect(
      declared(componentRules, '.run-tracker:not(.is-compact) > .run-tracker-counts', 'display'),
    ).toBe('none');
    expect(declared(componentRules, '.run-tracker-step.is-done::before', 'background')).toBe(
      'var(--viz-green)',
    );
    // The compact row's current pip pulses only while live, as the step does.
    expect(
      declared(
        componentRules,
        '.run-tracker[data-state="live"] .run-tracker-pip.is-current',
        'animation',
      ),
    ).toBe('jd-step-pulse 1.618s var(--ease-settle) infinite');
    expect(declared(componentRules, '.run-tracker-step::before', 'background')).toBe(
      'var(--muted)',
    );
    expect(declared(componentRules, '.run-tracker-state', 'outline')).toBe('1px solid transparent');
    expect(declared(componentRules, '.run-tracker-state[data-state="stopped"]', 'color')).toBe(
      'var(--danger-ink)',
    );
    const narrow = (rule: StyleRule): boolean =>
      rule.media.some((query) => /@container run-tracker \(max-width: 399px\)/.test(query));
    expect(declared(componentRules, '.run-tracker-steps', 'grid-template-columns', narrow)).toBe(
      'repeat(2, minmax(0, 1fr))',
    );
  });

  it('puts the preview’s Pages and Text switch above one region, and stacks it on phones without overlap', () => {
    const flat = (value: string | undefined): string => (value ?? '').replace(/\s+/g, ' ');
    expect(flat(declared(componentRules, '.doc-preview-body', 'grid-template-areas'))).toBe(
      '"tabs tabs" "thumbs main"',
    );
    expect(
      flat(declared(componentRules, '.doc-preview-body[data-view="text"]', 'grid-template-areas')),
    ).toBe('"tabs tabs" "main main"');
    expect(declared(componentRules, '.doc-preview-tabs', 'grid-area')).toBe('tabs');
    expect(declared(componentRules, '.doc-preview-main', 'grid-area')).toBe('main');
    expect(declared(componentRules, '.doc-preview-text', 'max-width')).toBe('68ch');
    expect(declared(componentRules, '.doc-preview-words', 'font-size')).toBe('17px');
    // Phones: the switch, the region and its pager, then one sideways row of thumbnails.
    expect(flat(declared(componentRules, '.doc-preview-body', 'grid-template-areas', phone))).toBe(
      '"tabs" "main" "thumbs"',
    );
    expect(declared(componentRules, '.doc-preview-body', 'grid-template-rows', phone)).toBe(
      'auto minmax(0, 1fr) auto',
    );
    expect(declared(componentRules, '.doc-preview-thumbs', 'overflow', phone)).toBe('auto hidden');
    expect(
      declared(
        componentRules,
        '.doc-preview-body[data-pages="1"] .doc-preview-thumbs',
        'display',
        phone,
      ),
    ).toBe('none');
    const short = (rule: StyleRule): boolean =>
      rule.media.some((query) => /max-width: 720px\) and \(max-height: 699px\)/.test(query));
    expect(declared(componentRules, '.doc-preview-thumbs', 'display', short)).toBe('none');
    // The old details is gone.
    expect(components).not.toContain('.doc-preview-text > summary');
  });
});

// ------------------------------------------------------------------ round 4: the script

describe('app-components.js · ring meters (R4-1)', () => {
  const part = (name: string, count: number, tip = true): FakeElement => {
    const span = h('span', {
      class: 'allowance-part',
      'data-part': name,
      style: `--count: ${count}`,
      ...(tip ? { 'data-tip-title': `${count} ${name}`, 'data-tip': `What ${name} means.` } : {}),
    });
    if (count === 0) span.setAttribute('hidden', '');
    return span;
  };
  const meter =
    (parts: FakeElement[], compact = true) =>
    (body: FakeElement): void => {
      body.append(
        h(
          'div',
          { class: 'allowance is-ring', id: 'meter' },
          h('p', { class: 'allowance-label' }, 'Deputy Assist'),
          h(
            'div',
            { class: compact ? 'allowance-ring is-compact' : 'allowance-ring' },
            ...parts,
            h(
              'p',
              { class: 'allowance-ring-centre' },
              h('span', { class: 'allowance-ring-figure', 'data-allowance-value': 'left' }, '3'),
            ),
          ),
          h(
            'ul',
            { class: 'allowance-key' },
            h('li', { class: 'allowance-key-item', 'data-part': 'left' }, 'Left'),
            h(
              'li',
              { class: 'allowance-key-item', 'data-part': 'used' },
              h('strong', { 'data-allowance-value': 'used' }, '1'),
            ),
            h(
              'li',
              { class: 'allowance-key-item', 'data-part': 'bonus' },
              h('strong', { 'data-allowance-value': 'bonus' }, '2'),
            ),
          ),
        ),
      );
    };
  const seed = () => meter([part('used', 1), part('left', 3), part('bonus', 2)]);
  const segments = (loaded: Loaded): FakeElement[] =>
    loaded.document.querySelectorAll('.allowance-ring-seg');

  it('draws an aria-hidden ring from the parts: used hatched, left, then bonus, clockwise from the top', () => {
    const loaded = load({ build: seed() });
    const ring = loaded.document.querySelector('.allowance-ring');
    const art = ring?.children[0];
    expect(attribute(art, 'class')).toBe('allowance-ring-art');
    expect(attribute(art, 'aria-hidden')).toBe('true');
    expect(attribute(art, 'focusable')).toBe('false');
    expect(segments(loaded).map((segment) => attribute(segment, 'data-part'))).toEqual([
      'used',
      'left',
      'bonus',
    ]);
    // Used takes the hatching pattern drawn in the same svg; the others take their CSS tones.
    const pattern = loaded.document.querySelector('pattern');
    expect(attribute(segments(loaded)[0], 'fill')).toBe(`url(#${attribute(pattern, 'id')})`);
    expect(
      segments(loaded)
        .slice(1)
        .every((segment) => !segment.hasAttribute('fill')),
    ).toBe(true);
    expect(pattern?.querySelectorAll('.allowance-ring-hatch-line')).toHaveLength(1);
    // The track sits under everything and shows in the gaps.
    expect(loaded.document.querySelectorAll('.allowance-ring-track')).toHaveLength(1);
    // The first segment starts just after the top, the 2px gap cut from its start.
    const start = attribute(segments(loaded)[0], 'd').match(/^M([\d.]+) ([\d.]+)A48 48/);
    expect(Number(start?.[1])).toBeGreaterThan(50);
    expect(Number(start?.[1])).toBeLessThan(52);
    // Each segment carries its part's tip for a pointer; none is focusable.
    expect(segments(loaded).map((segment) => attribute(segment, 'data-tip-title'))).toEqual([
      '1 used',
      '3 left',
      '2 bonus',
    ]);
    expect(segments(loaded).some((segment) => segment.hasAttribute('tabindex'))).toBe(false);
    // The same counts draw nothing new.
    const first = loaded.document.querySelector('.allowance-ring-art');
    loaded.api.init();
    expect(loaded.document.querySelector('.allowance-ring-art')).toBe(first);
  });

  it('draws bonus and bought solid on the ring’s full width, 2px apart, and one part as the whole ring', () => {
    const loaded = load({
      build: meter([part('used', 1), part('left', 3), part('bonus', 2), part('bought', 4)]),
    });
    expect(segments(loaded).map((segment) => attribute(segment, 'data-part'))).toEqual([
      'used',
      'left',
      'bonus',
      'bought',
    ]);
    // Round 5: no part is inset any more; every segment runs on the ring's outer radius.
    for (const segment of segments(loaded)) expect(attribute(segment, 'd')).toMatch(/A48 48 /);
    const whole = load({ build: meter([part('used', 0), part('left', 4), part('bonus', 0)]) });
    const only = segments(whole);
    expect(only.map((segment) => attribute(segment, 'data-part'))).toEqual(['left']);
    expect(attribute(only[0], 'fill-rule')).toBe('evenodd');
    // Nothing to draw leaves the track.
    const none = load({ build: meter([part('used', 0), part('left', 0)]) });
    expect(segments(none)).toHaveLength(0);
    expect(none.document.querySelectorAll('.allowance-ring-track')).toHaveLength(1);
  });

  it('keeps a small part at least 4px long, with room taken from the large ones', () => {
    const loaded = load({ build: meter([part('used', 1), part('left', 999)], false) });
    const [used] = segments(loaded);
    // At 120px a 4px arc on the middle radius (43 units) is about 0.078 radians; the used part's
    // outer edge must span more than its share of 1 in 1000 (0.006 radians).
    const numbers = (attribute(used, 'd').match(/-?[\d.]+/g) ?? []).map(Number);
    const [ax, ay, , , , , , bx, by] = numbers;
    const angle = (x: number, y: number): number => Math.atan2(x - 50, 50 - y);
    expect(angle(bx ?? 0, by ?? 0) - angle(ax ?? 0, ay ?? 0)).toBeGreaterThan(0.03);
  });

  it('takes allowance.set like the bar: counts, grouped numbers, the state, and a fresh ring', () => {
    const loaded = load({ build: seed() });
    const element = loaded.document.querySelector('#meter') as FakeElement;
    const before = loaded.document.querySelector('.allowance-ring-art');
    const counts = loaded.api.allowance.set(element, {
      used: 49810,
      left: 200190,
      bonus: 0,
      state: 'attention',
    });
    expect(counts).toEqual({ used: 49810, left: 200190, bonus: 0, bought: null, limit: 250000 });
    expect(loaded.document.querySelector('[data-allowance-value="used"]')?.textContent).toBe(
      '49,810',
    );
    expect(loaded.document.querySelector('.allowance-ring-art')).not.toBe(before);
    expect(segments(loaded).map((segment) => attribute(segment, 'data-part'))).toEqual([
      'used',
      'left',
    ]);
    expect(element.classList.contains('is-attention')).toBe(true);
    loaded.api.allowance.set(element, { state: 'reached' });
    expect([
      element.classList.contains('is-attention'),
      element.classList.contains('is-reached'),
    ]).toEqual([false, true]);
    loaded.api.allowance.set(element, { state: 'ok' });
    expect(element.classList.contains('is-reached')).toBe(false);
    // Without a state the classes stay as the markup set them.
    element.classList.add('is-attention');
    loaded.api.allowance.set(element, { used: 2 });
    expect(element.classList.contains('is-attention')).toBe(true);
  });

  it('lights a segment and the key item of the same part together', () => {
    const loaded = load({ build: seed() });
    const left = segments(loaded)[1];
    left?.dispatchEvent(new FakeEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    const active = (): string[] =>
      loaded.document
        .querySelectorAll('.allowance-key-item, .allowance-ring-seg')
        .filter((item) => item.classList.contains('is-active'))
        .map((item) => `${item.tagName.toLowerCase()}:${attribute(item, 'data-part')}`);
    expect(active()).toEqual(['path:left', 'li:left']);
    // Its tip shows for the pointer and describes nothing (the segment is not focusable).
    expect(loaded.document.querySelector('#jd-tooltip .tooltip-title')?.textContent).toBe(
      '3 left.',
    );
    left?.dispatchEvent(new FakeEvent('pointerout', { bubbles: true }));
    expect(active()).toEqual([]);
    loaded.document
      .querySelectorAll('.allowance-key-item')[2]
      ?.dispatchEvent(new FakeEvent('pointerover', { bubbles: true }));
    expect(active()).toEqual(['path:bonus', 'li:bonus']);
  });

  it('draws again a frame after a store change, from the counts the page wrote', () => {
    const store = fakeStore({ sources: 1, matches: 1, tracked: 1 });
    const loaded = load({ build: seed(), store });
    const used = loaded.document.querySelector('.allowance-part[data-part="used"]') as FakeElement;
    used.setAttribute('style', '--count: 2');
    for (const listener of store.listeners) listener();
    expect(segments(loaded)).toHaveLength(3);
    const before = loaded.document.querySelector('.allowance-ring-art');
    flush(loaded, { timers: false });
    expect(loaded.document.querySelector('.allowance-ring-art')).not.toBe(before);
  });
});

describe('app-components.js · donut tiles (D1)', () => {
  const key = (name: string, count: string, tone: string, href: string): FakeElement =>
    h(
      'li',
      { 'data-tone': tone },
      h(
        'a',
        {
          class: 'chart-key-item',
          href,
          'data-tip-title': `${name} · ${count} roles`,
          'data-tip': `About ${name}.`,
        },
        h('span', { class: 'chart-key-name' }, name),
        h('span', { class: 'chart-key-count', 'data-metric': `jobs.fit.${tone}` }, count),
      ),
    );
  const tile = (body: FakeElement): void => {
    body.append(
      h(
        'div',
        { class: 'kpi kpi-split', id: 'tile' },
        h('p', { class: 'kpi-label' }, 'Job matches'),
        h(
          'div',
          { class: 'donut is-tile' },
          h(
            'div',
            { class: 'donut-ring' },
            h(
              'a',
              { class: 'donut-total', href: './jobs-preview.html?view=all', id: 'centre' },
              h('span', { class: 'donut-total-value' }, '27'),
              h('span', { class: 'donut-total-label' }, 'found'),
            ),
          ),
          h(
            'ul',
            { class: 'chart-key is-compact is-inline', id: 'key' },
            key('Strong fit', '4', 'green', '?fit=strong'),
            key('Good fit', '9', 'blue', '?fit=good'),
            key('Stretch', '14', 'quiet', '?fit=stretch'),
          ),
        ),
      ),
    );
  };

  it('draws the segments from the chart key’s counts, linked out of the tab order, with each tip', () => {
    const loaded = load({ build: tile });
    const ring = loaded.document.querySelector('.donut-ring');
    expect(attribute(ring?.children[0], 'class')).toBe('donut-art');
    // The linked centre stays, after the art.
    expect(ring?.children[1]).toBe(loaded.document.querySelector('#centre'));
    const links = loaded.document.querySelectorAll('a.donut-link');
    expect(links.map((link) => [attribute(link, 'href'), attribute(link, 'tabindex')])).toEqual([
      ['?fit=strong', '-1'],
      ['?fit=good', '-1'],
      ['?fit=stretch', '-1'],
    ]);
    expect(links.map((link) => attribute(link, 'data-tip-title'))).toEqual([
      'Strong fit · 4 roles',
      'Good fit · 9 roles',
      'Stretch · 14 roles',
    ]);
    expect(
      loaded.document.querySelectorAll('.donut-seg').map((seg) => attribute(seg, 'data-tone')),
    ).toEqual(['green', 'blue', 'quiet']);
  });

  it('follows the count text: init on the key (or a store change) draws the donut again', () => {
    const store = fakeStore({ sources: 1, matches: 1, tracked: 1 });
    const loaded = load({ build: tile, store });
    const first = loaded.document.querySelector('.donut-art');
    const strong = loaded.document.querySelector('.chart-key-count') as FakeElement;
    strong.textContent = '5';
    loaded.api.init(loaded.document.querySelector('#key') as FakeElement);
    const second = loaded.document.querySelector('.donut-art');
    expect(second).not.toBe(first);
    strong.textContent = '1,204';
    for (const listener of store.listeners) listener();
    flush(loaded, { timers: false });
    expect(loaded.document.querySelector('.donut-art')).not.toBe(second);
    expect(attribute(loaded.document.querySelector('.donut'), 'data-donut-drawn')).toMatch(
      /^1204:green:/,
    );
    // Drawing again changes nothing when nothing changed.
    const third = loaded.document.querySelector('.donut-art');
    loaded.api.donut.draw(loaded.document.querySelector('.donut') as FakeElement);
    expect(loaded.document.querySelector('.donut-art')).toBe(third);
  });

  it('lights a key item and its segment together inside the tile', () => {
    const loaded = load({ build: tile });
    loaded.document
      .querySelectorAll('.chart-key-item')[2]
      ?.dispatchEvent(new FakeEvent('focusin', { bubbles: true }));
    expect(
      loaded.document
        .querySelectorAll('.donut-seg')
        .map((segment) => segment.classList.contains('is-active')),
    ).toEqual([false, false, true]);
  });
});

describe('app-components.js · the run tracker (D2, S1, R4-4; round 5 v2, S2)', () => {
  interface FakeRun {
    id: string;
    sourceId: string;
    sourceName: string;
    status: string;
    stage: string;
    stageLabel: string;
    progress: number;
    checked: number;
    kept: number;
    pagesRead?: number;
    scored?: number;
    expected?: { pages: number; checked: number; kept: number };
    stages?: Array<Record<string, unknown>>;
    elapsedSeconds?: number | null | undefined;
    durationSeconds?: number | null;
    startedAt?: string;
    finishedAt?: string | null;
    error?: { message: string } | null;
  }
  const STAGES = [
    { id: 'queued', label: 'Queued', from: 0 },
    { id: 'fetching', label: 'Fetching pages', from: 0.05 },
    { id: 'reading', label: 'Reading listings', from: 0.35 },
    { id: 'matching', label: 'Matching your roles', from: 0.6 },
    { id: 'saving', label: 'Saving', from: 0.85 },
    { id: 'complete', label: 'Complete', from: 1 },
  ];
  const runStore = (run: FakeRun, extra: Record<string, unknown> = {}) => {
    const ticks: Array<() => void> = [];
    const changes: Array<() => void> = [];
    const store = {
      RUN_STAGES: STAGES,
      current: run,
      ticks,
      changes,
      run: (id: string) => (id === store.current.id ? { ...store.current } : null),
      liveRun: () => (store.current.status === 'live' ? { ...store.current } : null),
      metricText: (key: string) => {
        const [, id, name] = key.split('.');
        const value = (store.current as unknown as Record<string, unknown>)[name ?? ''];
        return id === store.current.id && value !== undefined ? String(value) : '';
      },
      onTick: (listener: () => void) => {
        ticks.push(listener);
        return () => ticks.splice(ticks.indexOf(listener), 1);
      },
      subscribe: (listener: () => void) => {
        changes.push(listener);
        return () => changes.splice(changes.indexOf(listener), 1);
      },
      tick: () => {
        for (const listener of [...ticks]) listener();
      },
      ...extra,
    };
    return store;
  };
  const live = (overrides: Partial<FakeRun> = {}): FakeRun => ({
    id: 'r11',
    sourceId: 'amazon',
    sourceName: 'Amazon Jobs',
    status: 'live',
    stage: 'queued',
    stageLabel: 'Queued',
    progress: 0.03,
    checked: 0,
    kept: 0,
    elapsedSeconds: 3,
    durationSeconds: 100,
    ...overrides,
  });
  const host = (body: FakeElement): void => {
    body.append(h('section', { id: 'host' }));
  };
  const text = (loaded: Loaded, selector: string): string =>
    loaded.document.querySelector(selector)?.textContent ?? '';
  const spoken = (loaded: Loaded): string[] => {
    flush(loaded);
    return loaded.document
      .querySelectorAll('.jd-status')
      .map((channel) => channel.textContent)
      .filter(Boolean);
  };

  it('builds its markup in an empty host and shows a queued run counting up from its start', () => {
    const store = runStore(live());
    const loaded = load({ build: host, store: store as unknown as FakeStore });
    const tracker = loaded.api.runTracker(loaded.document.querySelector('#host'), 'r11');
    expect(tracker?.runId).toBe('r11');
    const root = loaded.document.querySelector('#host .run-tracker');
    expect(attribute(root, 'data-state')).toBe('queued');
    expect(text(loaded, '[data-run-source]')).toBe('Amazon Jobs');
    expect(text(loaded, '[data-run-state]')).toBe('Queued');
    expect(text(loaded, '[data-run-time]')).toBe('Queued for 3 s');
    expect(
      loaded.document
        .querySelectorAll('.run-tracker-step')
        .map((step) => attribute(step, 'data-stage')),
    ).toEqual(['fetching', 'reading', 'matching', 'saving']);
    expect(attribute(loaded.document.querySelector('.run-tracker-steps'), 'aria-label')).toBe(
      'Stages',
    );
    // Nothing in the tracker is a live region; the time is plain text.
    expect(root?.querySelectorAll('[role="status"], [aria-live], [role="timer"]')).toHaveLength(0);
    // Round 5: no time bar, and a counter in every step (empty and hidden until it counts).
    expect(loaded.document.querySelector('.run-tracker-bar')).toBeNull();
    expect(loaded.document.querySelector('.run-tracker-fill')).toBeNull();
    expect(
      loaded.document
        .querySelectorAll('.run-tracker-step')
        .map((step) => step.querySelector('[data-run-step-count]')?.hasAttribute('hidden')),
    ).toEqual([true, true, true, true]);
  });

  it('marks the stages done, current, and upcoming, counts each stage, and links Watch live (round 4 markup)', () => {
    const store = runStore(
      live({
        stage: 'reading',
        stageLabel: 'Reading listings',
        progress: 0.45,
        pagesRead: 9,
        checked: 18,
        expected: { pages: 9, checked: 44, kept: 2 },
        elapsedSeconds: 72,
      }),
    );
    const loaded = load({
      build: (body) =>
        body.append(
          h(
            'div',
            { class: 'run-tracker', id: 'tracker' },
            h(
              'ol',
              { class: 'run-tracker-steps' },
              ...['fetching', 'reading', 'matching', 'saving'].map((stage) =>
                h(
                  'li',
                  { class: 'run-tracker-step', 'data-stage': stage },
                  h('span', { class: 'run-tracker-step-name' }, stage),
                  h('span', { class: 'sr-only', 'data-run-step-state': true }),
                ),
              ),
            ),
            h('p', { class: 'run-tracker-time', 'data-run-time': true }),
            h('dd', { 'data-run-count': 'checked' }, '0'),
            h('dd', { 'data-run-count': 'kept' }, '0'),
            h('div', { class: 'run-tracker-bar' }, h('span', { class: 'run-tracker-fill' })),
            h(
              'a',
              { class: 'chart-action run-tracker-watch', 'data-run-watch': true, href: '#' },
              'Watch live',
            ),
          ),
        ),
      store: store as unknown as FakeStore,
    });
    loaded.api.runTracker(loaded.document.querySelector('#tracker'), 'r11');
    const steps = loaded.document.querySelectorAll('.run-tracker-step');
    expect(
      steps.map((step) => [
        step.classList.contains('is-done'),
        step.classList.contains('is-current'),
        attribute(step, 'aria-current'),
      ]),
    ).toEqual([
      [true, false, ''],
      [false, true, 'step'],
      [false, false, ''],
      [false, false, ''],
    ]);
    expect(steps.map((step) => step.querySelector('[data-run-step-state]')?.textContent)).toEqual([
      ', done',
      ', now',
      '',
      '',
    ]);
    expect(text(loaded, '[data-run-time]')).toBe('Running for 1 min 12 s');
    // Each stage's own counter, worked out from the run's figures (a store without stages): the
    // pages read of the plan, then the roles read; upcoming stages count nothing.
    const counters = steps.map((step) => step.querySelector('[data-run-step-count]'));
    expect(counters.map((counter) => counter?.textContent ?? '')).toEqual([
      '9 of 9 pages read',
      '18 roles read',
      '',
      '',
    ]);
    expect(
      counters.map((counter) =>
        counter
          ?.querySelectorAll('[data-metric]')
          .map((figure) => attribute(figure, 'data-metric')),
      ),
    ).toEqual([['runs.r11.pagesRead'], ['runs.r11.checked'], [], []]);
    // The round 4 Checked and New figures stay current but out of sight, without their keys,
    // so no figure shows twice; and the time bar is never drawn.
    const checked = loaded.document.querySelector('[data-run-count="checked"]');
    expect([checked?.textContent, checked?.hasAttribute('data-metric')]).toEqual(['18', false]);
    expect(
      loaded.document.querySelector('.run-tracker-fill')?.style.getPropertyValue('--value'),
    ).toBe('');
    const watch = loaded.document.querySelector('[data-run-watch]');
    expect(attribute(watch, 'href')).toBe('./searches-preview.html?source=amazon&live=1');
    expect(watch?.hasAttribute('hidden')).toBe(false);
  });

  it('counts up on each tick, from the store’s elapsedSeconds or else from startedAt', () => {
    const store = runStore(
      live({ stage: 'fetching', stageLabel: 'Fetching pages', elapsedSeconds: 8 }),
    );
    const loaded = load({ build: host, store: store as unknown as FakeStore });
    loaded.api.runTracker(loaded.document.querySelector('#host'), 'r11');
    expect(text(loaded, '[data-run-time]')).toBe('Running for 8 s');
    store.current = { ...store.current, elapsedSeconds: 61 };
    store.tick();
    expect(text(loaded, '[data-run-time]')).toBe('Running for 1 min 1 s');
    store.current = { ...store.current, elapsedSeconds: 3780 };
    store.tick();
    expect(text(loaded, '[data-run-time]')).toBe('Running for 1 h 3 min');
    // A store without elapsedSeconds: the time since startedAt, against now().
    const older = runStore(
      live({
        stage: 'fetching',
        elapsedSeconds: undefined,
        startedAt: '2026-10-02T13:58:00-07:00',
      }),
      { now: () => new Date('2026-10-02T21:00:12.000Z') },
    );
    const fallback = load({ build: host, store: older as unknown as FakeStore });
    fallback.api.runTracker(fallback.document.querySelector('#host'), 'r11');
    expect(text(fallback, '[data-run-time]')).toBe('Running for 2 min 12 s');
    // The store's own words win when it has them.
    const worded = runStore(live({ stage: 'fetching' }), {
      format: { elapsed: (s: number) => `${s} sec`, elapsedWords: (s: number) => `${s} seconds` },
    });
    const own = load({ build: host, store: worded as unknown as FakeStore });
    own.api.runTracker(own.document.querySelector('#host'), 'r11');
    expect(text(own, '[data-run-time]')).toBe('Running for 3 sec');
  });

  it('says each new stage and the finish once, through the shared channel, never the time', () => {
    const store = runStore(live());
    const loaded = load({ build: host, store: store as unknown as FakeStore });
    loaded.api.runTracker(loaded.document.querySelector('#host'), 'r11');
    // The first look says nothing; ticks inside one stage say nothing.
    store.current = { ...store.current, elapsedSeconds: 4 };
    store.tick();
    expect(spoken(loaded)).toEqual([]);
    store.current = {
      ...store.current,
      stage: 'fetching',
      stageLabel: 'Fetching pages',
      elapsedSeconds: 6,
    };
    store.tick();
    store.tick();
    expect(spoken(loaded)).toEqual(['Amazon Jobs: Fetching pages.']);
    expect(loaded.document.querySelectorAll('.jd-status')).toHaveLength(1);
    const channel = loaded.document.querySelector('.jd-status');
    expect([
      attribute(channel, 'role'),
      attribute(channel, 'aria-live'),
      channel?.parentElement,
    ]).toEqual(['status', 'polite', loaded.document.body]);
    store.current = {
      ...store.current,
      status: 'complete',
      stage: 'complete',
      stageLabel: 'Complete',
      progress: 1,
      checked: 44,
      kept: 2,
      elapsedSeconds: null,
      durationSeconds: null,
    };
    for (const listener of [...store.changes]) listener();
    store.tick();
    expect(text(loaded, '[data-run-state]')).toBe('Finished');
    // The duration seen while it ran: 100 seconds, then the figures, each with its key.
    expect(text(loaded, '[data-run-time]')).toBe('Finished in 1 min 40 s · 44 checked · 2 new');
    expect(
      loaded.document
        .querySelectorAll('[data-run-time] [data-metric]')
        .map((figure) => attribute(figure, 'data-metric')),
    ).toEqual(['runs.r11.checked', 'runs.r11.kept']);
    // A finished run says its figures once: the steps keep their ticks, not their counters.
    expect(
      loaded.document
        .querySelectorAll('[data-run-step-count]')
        .every((counter) => counter.hasAttribute('hidden')),
    ).toBe(true);
    expect(spoken(loaded)).toEqual([
      'Amazon Jobs finished in 1 minute 40 seconds: 44 checked, 2 new.',
    ]);
    // Watch live shows only while the run is queued or live.
    expect(loaded.document.querySelector('[data-run-watch]')?.hasAttribute('hidden')).toBe(true);
    expect(
      loaded.document
        .querySelectorAll('.run-tracker-step')
        .every((step) => step.classList.contains('is-done')),
    ).toBe(true);
  });

  it('tells the finish on the clock the count used: from the start when the live time counted from it', () => {
    // As the round 4 store does: r11 was asked for at 13:58, and its live time counts from then.
    let now = new Date('2026-10-02T21:00:01.000Z');
    const store = runStore(
      live({
        stage: 'reading',
        stageLabel: 'Reading listings',
        elapsedSeconds: 121,
        durationSeconds: 100,
        startedAt: '2026-10-02T13:58:00-07:00',
      }),
      { now: () => now },
    );
    const loaded = load({ build: host, store: store as unknown as FakeStore });
    loaded.api.runTracker(loaded.document.querySelector('#host'), 'r11');
    expect(text(loaded, '[data-run-time]')).toBe('Running for 2 min 1 s');
    now = new Date('2026-10-02T21:01:40.000Z');
    store.current = {
      ...store.current,
      status: 'complete',
      stage: 'complete',
      elapsedSeconds: null,
      durationSeconds: null,
      checked: 44,
      kept: 2,
      finishedAt: '2026-10-02T14:01:40-07:00',
    };
    store.tick();
    // Never shorter than the count before it: 3 min 40 s from the request, not the 100 s it moved.
    expect(text(loaded, '[data-run-time]')).toBe('Finished in 3 min 40 s · 44 checked · 2 new');
  });

  it('speaks through a page’s own channel when given one, and marks the stage a stopped run stopped on', () => {
    const store = runStore(live({ stage: 'fetching', stageLabel: 'Fetching pages' }));
    const loaded = load({
      build: (body) => {
        host(body);
        body.append(h('p', { id: 'page-status', role: 'status', class: 'sr-only' }));
      },
      store: store as unknown as FakeStore,
    });
    loaded.api.runTracker(loaded.document.querySelector('#host'), 'r11', {
      channel: '#page-status',
      metrics: false,
    });
    // { metrics: false }: no figure in the tracker carries a key.
    store.current = { ...store.current, pagesRead: 2 };
    store.tick();
    expect(loaded.document.querySelector('#host [data-metric]')).toBeNull();
    expect(text(loaded, '[data-run-step-count]')).toBe('2 pages read');
    store.current = {
      ...store.current,
      status: 'stopped',
      stage: 'stopped',
      stageLabel: 'Stopped',
      error: { message: 'The page took too long to load' },
    };
    store.tick();
    flush(loaded);
    expect(text(loaded, '#page-status')).toBe('Amazon Jobs stopped.');
    expect(loaded.document.querySelectorAll('.jd-status')).toHaveLength(0);
    expect(text(loaded, '[data-run-time]')).toBe('Stopped: The page took too long to load');
    const stopped = loaded.document
      .querySelectorAll('.run-tracker-step')
      .map((step) => step.classList.contains('is-stopped'));
    expect(stopped).toEqual([true, false, false, false]);
  });

  it('shows the store’s own stages: their words, their states, and each figure’s key once', () => {
    const stages = [
      {
        id: 'fetching',
        label: 'Fetching pages',
        state: 'done',
        count: {
          label: 'pages read',
          value: 9,
          of: 9,
          metric: 'runs.r11.pagesRead',
          ofMetric: 'runs.r11.pagesPlanned',
          text: '9 of 9 pages read',
        },
      },
      {
        id: 'reading',
        label: 'Reading listings',
        state: 'done',
        count: {
          label: 'roles read',
          value: 44,
          of: null,
          metric: 'runs.r11.checked',
          text: '44 roles read',
        },
      },
      {
        id: 'matching',
        label: 'Matching your roles',
        state: 'current',
        count: {
          label: 'roles scored',
          value: 1,
          of: null,
          metric: 'runs.r11.scored',
          found: 1,
          foundMetric: 'runs.r11.kept',
          text: '1 role scored · 1 new',
        },
      },
      { id: 'saving', label: 'Saving', state: 'upcoming', count: null },
    ];
    const store = runStore(
      live({
        stage: 'matching',
        stageLabel: 'Matching your roles',
        pagesRead: 9,
        checked: 44,
        kept: 1,
        scored: 1,
        stages,
        elapsedSeconds: 75,
      }),
    );
    const loaded = load({ build: host, store: store as unknown as FakeStore });
    loaded.api.runTracker(loaded.document.querySelector('#host'), 'r11');
    const steps = loaded.document.querySelectorAll('.run-tracker-step');
    expect(
      steps.map((step) => step.querySelector('[data-run-step-count]')?.textContent ?? ''),
    ).toEqual(['9 of 9 pages read', '44 roles read', '1 role scored · 1 new', '']);
    expect(
      steps.map((step) =>
        step.querySelectorAll('[data-metric]').map((figure) => attribute(figure, 'data-metric')),
      ),
    ).toEqual([
      ['runs.r11.pagesRead', 'runs.r11.pagesPlanned'],
      ['runs.r11.checked'],
      ['runs.r11.scored', 'runs.r11.kept'],
      [],
    ]);
    const keys = loaded.document
      .querySelectorAll('#host [data-metric]')
      .map((figure) => attribute(figure, 'data-metric'));
    expect(new Set(keys).size).toBe(keys.length);
    expect(steps.map((step) => step.classList.contains('is-current'))).toEqual([
      false,
      false,
      true,
      false,
    ]);
    // A stage the store marks stopped is the one marked stopped.
    store.current = {
      ...store.current,
      status: 'stopped',
      stage: 'stopped',
      stages: stages.map((stage) =>
        stage.id === 'matching' ? { ...stage, state: 'stopped' } : stage,
      ),
    };
    store.tick();
    expect(steps.map((step) => step.classList.contains('is-stopped'))).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(text(loaded, '[data-run-time]')).toBe('Stopped');
  });

  it('is one row with { compact: true }: the source, the stage, the time, the new roles so far, and Watch live', () => {
    const store = runStore(
      live({
        stage: 'reading',
        stageLabel: 'Reading listings',
        checked: 18,
        kept: 0,
        elapsedSeconds: 41,
      }),
    );
    const loaded = load({ build: host, store: store as unknown as FakeStore });
    loaded.api.runTracker(loaded.document.querySelector('#host'), 'r11', { compact: true });
    const root = loaded.document.querySelector('#host .run-tracker');
    expect(root?.classList.contains('is-compact')).toBe(true);
    expect(root?.querySelector('.run-tracker-steps')).toBeNull();
    expect(text(loaded, '[data-run-source]')).toBe('Amazon Jobs');
    expect(text(loaded, '[data-run-stage]')).toBe('Stage 2 of 4: Reading listings');
    expect(
      loaded.document
        .querySelectorAll('.run-tracker-pip')
        .map((pip) =>
          pip.classList.contains('is-done')
            ? 'done'
            : pip.classList.contains('is-current')
              ? 'now'
              : '',
        ),
    ).toEqual(['done', 'now', '', '']);
    expect(attribute(loaded.document.querySelector('.run-tracker-pips'), 'aria-hidden')).toBe(
      'true',
    );
    expect(text(loaded, '[data-run-time]')).toBe('Running for 41 s');
    const fresh = loaded.document.querySelector('[data-run-count="kept"]');
    expect([fresh?.textContent, attribute(fresh, 'data-metric')]).toEqual(['0', 'runs.r11.kept']);
    expect(text(loaded, '.run-tracker-new')).toBe('0 new so far');
    expect(loaded.document.querySelector('[data-run-watch]')?.hasAttribute('hidden')).toBe(false);
    // Queued: no stage yet, so the stage line is out of the way.
    store.current = { ...store.current, stage: 'queued', stageLabel: 'Queued', elapsedSeconds: 3 };
    store.tick();
    expect(loaded.document.querySelector('.run-tracker-stage')?.hasAttribute('hidden')).toBe(true);
    expect(text(loaded, '[data-run-time]')).toBe('Queued for 3 s');
    // Finished: the time it took and the new roles it found.
    store.current = {
      ...store.current,
      status: 'complete',
      stage: 'complete',
      kept: 2,
      checked: 44,
      elapsedSeconds: 100,
      durationSeconds: null,
    };
    store.tick();
    expect(text(loaded, '[data-run-time]')).toBe('Finished in 1 min 40 s');
    expect(text(loaded, '.run-tracker-new')).toBe('2 new');
    expect(loaded.document.querySelector('[data-run-watch]')?.hasAttribute('hidden')).toBe(true);
    // { watchHref: null } leaves Watch live out (a page that is the live view already).
    const own = load({ build: host, store: runStore(live()) as unknown as FakeStore });
    own.api.runTracker(own.document.querySelector('#host'), 'r11', { watchHref: null });
    expect(own.document.querySelector('[data-run-watch]')?.hasAttribute('hidden')).toBe(true);
  });

  it('stays quiet with { quiet: true }, for a second view of a run another tracker speaks for', () => {
    const store = runStore(live());
    const loaded = load({
      build: (body) => {
        body.append(h('section', { id: 'host' }), h('section', { id: 'second' }));
      },
      store: store as unknown as FakeStore,
    });
    loaded.api.runTracker(loaded.document.querySelector('#host'), 'r11');
    loaded.api.runTracker(loaded.document.querySelector('#second'), 'r11', {
      compact: true,
      quiet: true,
    });
    store.current = { ...store.current, stage: 'fetching', stageLabel: 'Fetching pages' };
    store.tick();
    expect(spoken(loaded)).toEqual(['Amazon Jobs: Fetching pages.']);
  });

  it('follows the newest live run without an id, and stops listening once it leaves the page', () => {
    const store = runStore(live({ stage: 'reading', stageLabel: 'Reading listings' }));
    const loaded = load({ build: host, store: store as unknown as FakeStore });
    // The components' own subscription (flow counts and charts) is there before the tracker's.
    const before = store.changes.length;
    const tracker = loaded.api.runTracker(loaded.document.querySelector('#host'));
    expect(tracker?.runId).toBe('r11');
    expect([store.ticks.length, store.changes.length]).toEqual([1, before + 1]);
    loaded.document.querySelector('#host')?.remove();
    store.tick();
    expect([store.ticks.length, store.changes.length, tracker?.active]).toEqual([0, before, false]);
    // Without a store there is nothing to track.
    const bare = load({ build: host });
    expect(bare.api.runTracker(bare.document.querySelector('#host'), 'r11')).toBeNull();
  });
});

describe('app-components.js · the shared status channel', () => {
  it('says words once in the page, or in the open modal dialog that holds the component', () => {
    const loaded = load({
      build: (body) =>
        body.append(
          h('button', { type: 'button', id: 'outside' }, 'Outside'),
          h(
            'dialog',
            { open: true, id: 'modal' },
            h('button', { type: 'button', id: 'inside' }, 'Inside'),
          ),
        ),
    });
    const api = loaded.api as unknown as {
      announce: (words: string, near?: FakeElement | null) => boolean;
    };
    expect(api.announce('  ')).toBe(false);
    api.announce('Saved.', loaded.document.querySelector('#outside'));
    api.announce('Inside the dialog.', loaded.document.querySelector('#inside'));
    flush(loaded);
    const channels = loaded.document.querySelectorAll('.jd-status');
    const where = (tag: string) =>
      channels.find((channel) => channel.parentElement?.tagName === tag);
    expect(channels).toHaveLength(2);
    expect(where('BODY')?.textContent).toBe('Saved.');
    expect(where('DIALOG')?.textContent).toBe('Inside the dialog.');
    // The same words again are heard again: the channel clears first.
    api.announce('Saved.', loaded.document.querySelector('#outside'));
    expect(where('BODY')?.textContent).toBe('');
    flush(loaded);
    expect(where('BODY')?.textContent).toBe('Saved.');
  });
});

describe('app-components.js · the preview’s Pages and Text switch (R1)', () => {
  const LONG = Array.from({ length: 60 }, (_, line) => `Line ${line + 1} of the CV.`).join('\n\n');
  const open = (view?: string) => {
    const loaded = load({
      build: (body) => body.append(h('button', { type: 'button', id: 'opener' }, 'Preview')),
    });
    const opener = loaded.document.querySelector('#opener') as FakeElement;
    opener.focus();
    loaded.api.preview.open({ title: 'CV', source: `# Alex Morgan\n\n${LONG}`, view }, opener);
    return { loaded, opener };
  };
  const part = (loaded: Loaded, selector: string): FakeElement | null =>
    loaded.document.querySelector(selector);
  // The tabs set the hidden and tabIndex properties (a browser reflects them as attributes; the
  // small DOM keeps them apart), the preview sets the attributes.
  const hidden = (element: FakeElement | null): boolean => {
    const own = (element as unknown as { hidden?: boolean } | null)?.hidden;
    return typeof own === 'boolean' ? own : Boolean(element?.hasAttribute('hidden'));
  };
  const tabStop = (element: FakeElement | null): string =>
    String(
      (element as unknown as { tabIndex?: number } | null)?.tabIndex ??
        attribute(element, 'tabindex'),
    );

  it('puts an ARIA tablist with Pages and Text above the one labelled scroll region', () => {
    const { loaded } = open();
    const tablist = part(loaded, '.doc-preview-tabs');
    expect([attribute(tablist, 'role'), attribute(tablist, 'aria-label')]).toEqual([
      'tablist',
      'Show the document as',
    ]);
    const tabs = tablist?.querySelectorAll('[role="tab"]') ?? [];
    expect(
      tabs.map((tab) => [tab.textContent, attribute(tab, 'aria-selected'), tabStop(tab)]),
    ).toEqual([
      ['Pages', 'true', '0'],
      ['Text', 'false', '-1'],
    ]);
    const stage = part(loaded, '.doc-preview-stage');
    // Both panels live inside the one region; only the pages show.
    expect(
      stage
        ?.querySelectorAll('[role="tabpanel"]')
        .map((panel) => [attribute(panel, 'aria-labelledby'), hidden(panel)]),
    ).toEqual([
      ['jd-preview-tab-pages', false],
      ['jd-preview-tab-text', true],
    ]);
    expect(tabs.map((tab) => attribute(tab, 'aria-controls'))).toEqual([
      'jd-preview-pages',
      'jd-preview-text',
    ]);
    expect(part(loaded, '.doc-preview-body')?.children[0]).toBe(tablist);
    // No details element is left.
    expect(loaded.document.querySelector('dialog.doc-preview details')).toBeNull();
  });

  it('shows the words in the same region on Text, hides the pager and thumbnails, and back', () => {
    const { loaded } = open();
    const stage = part(loaded, '.doc-preview-stage');
    part(loaded, '#jd-preview-tab-text')?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(attribute(part(loaded, '.doc-preview-body'), 'data-view')).toBe('text');
    expect(hidden(part(loaded, '#jd-preview-text'))).toBe(false);
    expect(hidden(part(loaded, '#jd-preview-pages'))).toBe(true);
    expect(part(loaded, '.doc-preview-pager')?.hasAttribute('hidden')).toBe(true);
    expect(part(loaded, '.doc-preview-thumbs')?.hasAttribute('hidden')).toBe(true);
    expect(attribute(stage, 'aria-label')).toBe('Text of the document');
    expect(part(loaded, '.doc-preview-words')?.textContent).toMatch(/^Alex MorganLine 1/);
    // The region is the same element, and still the one tab stop for scrolling.
    expect(part(loaded, '#jd-preview-text')?.parentElement).toBe(stage);
    expect(attribute(stage, 'tabindex')).toBe('0');
    expect(attribute(part(loaded, '#jd-preview-text'), 'tabindex')).toBe('-1');
    // The arrow key moves back to Pages and selects it.
    const textTab = part(loaded, '#jd-preview-tab-text') as FakeElement;
    textTab.focus();
    textTab.dispatchEvent(new FakeEvent('keydown', { bubbles: true, key: 'ArrowLeft' }));
    expect(loaded.document.activeElement).toBe(part(loaded, '#jd-preview-tab-pages'));
    expect(attribute(part(loaded, '.doc-preview-body'), 'data-view')).toBe('pages');
    expect(part(loaded, '.doc-preview-pager')?.hasAttribute('hidden')).toBe(false);
    expect(attribute(stage, 'aria-label')).toBe('Page 1 of 2');
  });

  it('opens on Text when asked, opens on Pages next time, and returns focus on Escape or Close', () => {
    const { loaded, opener } = open('text');
    expect(attribute(part(loaded, '.doc-preview-body'), 'data-view')).toBe('text');
    expect(attribute(part(loaded, '#jd-preview-tab-text'), 'aria-selected')).toBe('true');
    // The dialog's cancel (Escape) closes it, and focus returns to the opener.
    (part(loaded, 'dialog.doc-preview') as FakeElement).close();
    expect(loaded.document.activeElement).toBe(opener);
    loaded.api.preview.open({ title: 'CV', source: '# Alex Morgan' }, opener);
    expect(attribute(part(loaded, '.doc-preview-body'), 'data-view')).toBe('pages');
    expect(attribute(part(loaded, '.doc-preview-body'), 'data-pages')).toBe('1');
    loaded.api.preview.view('text');
    expect(attribute(part(loaded, '#jd-preview-tab-text'), 'aria-selected')).toBe('true');
    expect(part(loaded, '.doc-preview-pager')?.hasAttribute('hidden')).toBe(true);
  });
});

// ------------------------------------------------------------------ round 4: the gallery

describe('components-preview.html · round 4 components', () => {
  it('shows each new component in its own numbered section', () => {
    for (const [id, title] of [
      ['ring-meter', 'Ring meter'],
      ['donut-tile', 'Donut tile'],
      ['run-tracker', 'Run tracker'],
    ] as Array<[string, string]>) {
      expect(roundSection(id), id).toContain(`>${title}</h2>`);
      expect(gallery, id).toMatch(
        new RegExp(`<li><a href="#${id}"><span class="gallery-index-number">\\d\\d</span>`),
      );
    }
  });

  it('builds every ring meter from the bar’s parts, and never shows the centre’s count twice', () => {
    const live = roundSection('ring-meter').split('<div class="gallery-specimens')[0] ?? '';
    const meters = live.match(/<div class="allowance is-ring[\s\S]*?<\/ul>/g) ?? [];
    expect(meters).toHaveLength(3);
    for (const meter of meters) {
      const ring =
        meter.match(/<div class="allowance-ring(?: is-compact)?">([\s\S]*?)<\/div>/)?.[1] ?? '';
      expect(ring).toMatch(/<span class="allowance-part" data-part="used" style="--count: \d+"/);
      const centre = textOf(
        ring.match(/<p class="allowance-ring-centre">[\s\S]*?<\/p>/)?.[0] ?? '',
      );
      const figure = centre.split(' ')[0] ?? '';
      // A count, or a token limit's share used ("20%", the one rule of round 5's D-4).
      expect(figure).toMatch(/^[\d,]+%?$/);
      // The key names the centre's part without its number.
      const key = textOf(meter.match(/<ul class="allowance-key">[\s\S]*?<\/ul>/)?.[0] ?? '');
      expect(key.split(/\s+/)).not.toContain(figure);
    }
    expect(textOf(meters[0] ?? '')).toContain('339,100 tokens left');
    expect(live).toContain('class="allowance-ring-figure is-long"');
    // Round 5 (D1): each meter names its kind, which picks its left colour.
    expect(meters.map((meter) => meter.match(/data-meter-kind="(\w+)"/)?.[1])).toEqual([
      'assist',
      'watch',
      'assist',
    ]);
    expect(live).toContain('data-part="bought"');
  });

  it('feeds each donut tile from its chart key’s counts, with a linked centre', () => {
    const live = roundSection('donut-tile').split('<div class="gallery-specimens')[0] ?? '';
    const tiles = live.match(/<div class="donut is-tile">[\s\S]*?<\/ul>/g) ?? [];
    expect(tiles).toHaveLength(2);
    for (const tile of tiles) {
      expect(tile).toMatch(
        /<a class="donut-total" href="\.\/(?:jobs|applications)-preview\.html(?:\?view=all)?"/,
      );
      expect(tile).not.toContain('data-value=');
      expect(tile).toContain('<ul class="chart-key is-compact is-inline"');
      for (const item of tile.matchAll(
        /<a class="chart-key-item" href="([^"]+)" data-tip-title="([^"]+)" data-tip="([^"]+)"/g,
      )) {
        expect(item[2]).toMatch(/^[A-Z][\w ]+ · \d+ roles?$/);
        expect(item[3]).toMatch(/\. Opens (?:Job matches|Applications) filtered to [A-Z][\w ]+\.$/);
      }
    }
    expect(textOf(tiles[0] ?? '')).toContain('27 found');
    expect(textOf(tiles[1] ?? '')).toContain('7 active');
  });

  it('writes the tracker’s static markup with the store’s four stages and its hooks', () => {
    const section = roundSection('run-tracker');
    const live = section.split('<div class="gallery-specimens')[0] ?? '';
    expect(
      [...live.matchAll(/<li class="run-tracker-step" data-stage="(\w+)">/g)].map((m) => m[1]),
    ).toEqual(['fetching', 'reading', 'matching', 'saving']);
    for (const hook of [
      'data-run-source',
      'data-run-state',
      'data-run-time',
      'data-run-step-count',
      'data-run-stage',
      'data-run-count="kept"',
      'data-run-new-words',
      'data-run-watch',
    ]) {
      expect(live, hook).toContain(hook);
    }
    // Round 5 (S2): no time bar and no Checked and New list in the markup pages copy.
    expect(live).not.toContain('run-tracker-bar');
    expect(live).not.toContain('run-tracker-counts');
    expect(live).toContain('<div class="run-tracker is-compact" data-state="queued">');
    expect(live).not.toMatch(/aria-live|role="status"|role="timer"/);
    expect(textOf(section)).toContain('Finished in 1 min 40 s · 44 checked · 2 new');
    expect(textOf(section)).toContain('Running for 1 min 12 s');
    expect(textOf(section)).toContain('20 roles scored · 1 new');
    expect(textOf(section)).not.toMatch(/\bleft\b/);
    expect(gallery).toContain("components.runTracker(trackerHost, 'gallery-run', {");
  });

  it('opens a preview on Text from the gallery, and says so in the section', () => {
    const section = roundSection('doc-preview');
    expect(section).toContain('data-gallery-view="text"');
    expect(textOf(section)).toContain('Pages and Text switch');
    expect(section).not.toContain('details.doc-preview-text');
  });
});

// ------------------------------------------------------------------ round 5: the data palette

// WCAG 2 contrast of two sRGB colours.
const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminanceOf = ([r, g, b]: number[]): number =>
  0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0);
const contrastOf = (a: number[], b: number[]): number => {
  const [light, dark] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
};
const rgbOf = (hex: string): number[] =>
  [0, 2, 4].map((at) => Number.parseInt(hex.replace('#', '').slice(at, at + 2), 16));
// The card is surface (white at 82%) over paper; the track is paper-deep.
const CARD_RGB = [254.1, 253.74, 252.84];
const TRACK_RGB = rgbOf('#f0ece3');

// A --viz-* value, following var() references within the palette block (and the kinds' left).
function vizColour(name: string, kind?: string): string {
  const block = paletteBlock();
  const read = (property: string): string =>
    block.match(new RegExp(`${property}:\\s*([^;]+);`))?.[1]?.trim() ?? '';
  let value =
    kind && name === 'left'
      ? (kindBlock(kind).match(/--viz-left:\s*([^;]+);/)?.[1] ?? '')
      : read(`--viz-${name}`);
  for (let hops = 0; hops < 5 && value.startsWith('var('); hops += 1) {
    value = read(value.slice(4, -1).trim());
  }
  return value;
}

describe('app-components.css · the data colour palette (round 5, D1)', () => {
  it('declares every data colour once, in one :where(html) block', () => {
    expect(components.match(/:where\(html\)\s*\{/g)).toHaveLength(1);
    const names = [...paletteBlock().matchAll(/(--(?:viz|mark)-[\w-]+)\s*:/g)].map(
      (match) => match[1],
    );
    expect(names.sort()).toEqual([...VIZ_PROPERTIES].sort());
    // The attention mark points at the data orange, so that colour lives in one place.
    expect(paletteBlock()).toContain('--mark-attention: var(--viz-orange);');
    for (const tone of VIZ_TONES) expect(vizColour(tone), tone).toMatch(/^#[0-9a-f]{6}$/i);
    // The roles point at the tones (or the neutral surfaces), so a colour lives in one place.
    expect(paletteBlock()).toContain('--viz-used: var(--viz-quiet);');
    expect(paletteBlock()).toContain('--viz-left: var(--viz-green);');
    expect(paletteBlock()).toContain('--viz-bonus: var(--viz-gold);');
    expect(paletteBlock()).toContain('--viz-bought: var(--viz-wine);');
    expect(paletteBlock()).toContain('--viz-track: var(--paper-deep);');
  });

  it('keeps every fill 3:1 or more on the card and on the paper-deep track', () => {
    const fills: Array<[string, string]> = [
      ...VIZ_TONES.map((tone): [string, string] => [tone, vizColour(tone)]),
      ['used stripes', vizColour('used')],
      ['left', vizColour('left')],
      ['left, Keep watch', vizColour('left', 'watch')],
      ['left, Deputy Assist', vizColour('left', 'assist')],
      ['bonus', vizColour('bonus')],
      ['bought', vizColour('bought')],
    ];
    for (const [name, hex] of fills) {
      expect(hex, name).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrastOf(rgbOf(hex), CARD_RGB), `${name} on the card`).toBeGreaterThanOrEqual(3);
      expect(contrastOf(rgbOf(hex), TRACK_RGB), `${name} on the track`).toBeGreaterThanOrEqual(3);
    }
    // Round 4's orange (2.97:1) and grey (2.99:1) fell short; their places now pass.
    expect(contrastOf(rgbOf(vizColour('orange')), CARD_RGB)).toBeGreaterThan(3.5);
    expect(contrastOf(rgbOf(vizColour('quiet')), CARD_RGB)).toBeGreaterThan(3.5);
  });

  it('gives each meter kind its left colour: Keep watch indigo, Deputy Assist teal, green otherwise', () => {
    expect(vizColour('left', 'watch')).toBe(vizColour('indigo'));
    expect(vizColour('left', 'assist')).toBe(vizColour('teal'));
    expect(vizColour('left')).toBe(vizColour('green'));
    // The kinds and bonus and bought are five different colours.
    const looks = new Set(
      [
        vizColour('left', 'watch'),
        vizColour('left', 'assist'),
        vizColour('left'),
        vizColour('bonus'),
        vizColour('bought'),
      ].map((hex) => hex.toLowerCase()),
    );
    expect(looks.size).toBe(5);
  });

  it('points every chart part at the palette, never at a brand colour', () => {
    const BRAND = /var\(--(?:green-ink|green|blue|blue-soft|orange|quiet|ink-soft|ink)\)/;
    const parts: Array<[string, string]> = [
      ['.meter::before', 'background'],
      ['.ring-arc', 'stroke'],
      ['.bar-chart-key::before', 'background'],
      ['.bar-chart-key.is-output::before', 'background'],
      ['.bar-chart-bar', 'background'],
      ['.bar-chart-bar.is-output', 'background'],
      ['.sparkline-line', 'stroke'],
      ['.sparkline-dot', 'fill'],
      ['.hbar-fill', 'background'],
      ['.stack-bar-seg', 'background'],
      ['.chart-legend-item::before', 'background'],
      ['.donut-seg', 'fill'],
      ['.chart-key-item::before', 'background'],
      ['.tone-label::before', 'background'],
      ['.allowance-part', 'background'],
      ['.allowance-key-item::before', 'background'],
      ['.allowance-ring-seg[data-part="left"]', 'fill'],
      ['.allowance-ring-seg[data-part="bonus"]', 'fill'],
      ['.allowance-ring-seg[data-part="bought"]', 'fill'],
      ['.allowance-ring-hatch-line', 'fill'],
      ['.run-tracker-step.is-done::before', 'background'],
      ['.run-tracker-pip.is-done', 'background'],
      ['.usage-chart-seg', 'background'],
      ['.viz-swatch', 'background'],
    ];
    for (const [selector, property] of parts) {
      const value = declared(componentRules, selector, property) ?? '';
      expect(value, selector).toMatch(/var\(--viz-/);
      expect(value, selector).not.toMatch(BRAND);
    }
    // The tracks the parts sit on are the palette's too.
    for (const [selector, property] of <Array<[string, string]>>[
      ['.hbar-track', 'background'],
      ['.stack-bar', 'background'],
      ['.allowance-bar', 'background'],
      ['.allowance-ring-track', 'fill'],
      ['.donut-track', 'fill'],
      ['.ring-track', 'stroke'],
      ['.meter', 'background'],
    ]) {
      expect(declared(componentRules, selector, property), selector).toBe('var(--viz-track)');
    }
  });

  it('uses the palette only on chart parts, so no button, link, or status colour changes', () => {
    const chart =
      /(?:meter|ring|bar-chart|sparkline|hbar|stack-bar|chart-legend|donut|chart-key|tone-label|allowance|run-tracker|usage-chart|viz-swatch|score-trend|prompt-summary-burn)/;
    const users = componentRules
      .filter((rule) => rule.declarations.some((item) => /var\(--viz-/.test(item.value)))
      .flatMap((rule) => rule.selectors);
    expect(
      users.filter((selector) => !chart.test(selector) && selector !== ':where(html)'),
    ).toEqual([]);
  });

  it('keeps nine tones apart in forced colours, the extra four outlined in a system colour', () => {
    const forcedFill = (tone: string): string | undefined =>
      declared(componentRules, `.donut-art .donut-seg[data-tone="${tone}"]`, 'fill', isForced);
    expect(['green', 'blue', 'quiet', 'ink'].map(forcedFill)).toEqual([
      'Highlight',
      'LinkText',
      'GrayText',
      'CanvasText',
    ]);
    expect(
      ['teal', 'indigo', 'gold'].map((tone) =>
        declared(componentRules, `.donut-art .donut-seg[data-tone="${tone}"]`, 'stroke', isForced),
      ),
    ).toEqual(['Highlight', 'LinkText', 'GrayText']);
    expect(
      ['blue', 'quiet', 'ink'].map((tone) =>
        declared(componentRules, `.usage-chart-seg[data-tone="${tone}"]`, 'background', isForced),
      ),
    ).toEqual(['LinkText', 'GrayText', 'CanvasText']);
    expect(
      declared(componentRules, '.usage-chart-seg[data-tone="orange"]', 'border-style', isForced),
    ).toBe('dashed');
    expect(
      declared(componentRules, '.viz-swatch[data-part="bought"]', 'background', isForced),
    ).toBe('CanvasText');
  });
});

describe('app-components.js · the palette’s words (round 5, D1)', () => {
  it('names every tone and part as it looks, for a page’s tooltips and tours', () => {
    const { api } = load();
    expect(api.palette.tones).toEqual({
      green: 'green',
      blue: 'blue',
      orange: 'orange',
      ink: 'charcoal',
      quiet: 'grey',
      teal: 'teal',
      indigo: 'indigo',
      gold: 'gold',
      wine: 'wine',
    });
    expect(api.palette.parts).toEqual({
      used: 'hatched grey',
      left: 'green',
      bonus: 'gold',
      bought: 'wine',
    });
    expect(api.palette.left).toEqual({ watch: 'indigo', assist: 'teal', none: 'green' });
    expect(api.palette.series).toEqual([
      'blue',
      'green',
      'orange',
      'wine',
      'quiet',
      'ink',
      'indigo',
    ]);
    expect(Object.isFrozen(api.palette)).toBe(true);
    expect(Object.isFrozen(api.palette.series)).toBe(true);
  });
});

// ------------------------------------------------------------------ round 5: downloads

const RESUME_MD = [
  '# Alex Morgan',
  'alex.morgan@example.com · Seattle, WA',
  '',
  '## Summary',
  'Builds **search** and *data* systems for teams.',
  '',
  '## Experience',
  '### Senior Engineer, Contoso · 2021 to now',
  '- Led the move to streaming for 40 million documents.',
  '- Mentored six engineers.',
  '1. First step.',
  '2. Second step.',
  '',
  '---',
  '',
  '## Skills',
  'Go, Java, `gRPC`, (parentheses) and a back\\slash.',
].join('\n');

const utf16Hex = (text: string): string =>
  `<FEFF${[...text].map((character) => (character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')).join('')}>`;

describe('app-components.js · downloads (round 5, R1)', () => {
  const pdfOf = (markdown: string, title = 'Alex Morgan résumé'): DownloadFile =>
    load().api.download.build({ title, markdown, date: new Date('2026-10-04T12:00:00Z') }, 'pdf');

  it('makes a valid PDF 1.4: the header, every object at its cross-reference offset, the trailer, and the end', () => {
    const file = pdfOf(RESUME_MD);
    expect([file.ok, file.name, file.type]).toEqual([
      true,
      'Alex Morgan résumé.pdf',
      'application/pdf',
    ]);
    const text = file.text ?? '';
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);
    const xref = Number(text.match(/startxref\n(\d+)\n%%EOF\n$/)?.[1]);
    expect(text.slice(xref, xref + 5)).toBe('xref\n');
    const count = Number(text.slice(xref).match(/^xref\n0 (\d+)\n/)?.[1]);
    const entries = text
      .slice(xref)
      .split('\n')
      .slice(2, 2 + count);
    expect(entries[0]).toBe('0000000000 65535 f ');
    expect(entries).toHaveLength(count);
    entries.slice(1).forEach((entry, index) => {
      expect(entry).toMatch(/^\d{10} 00000 n $/);
      expect(text.slice(Number(entry.slice(0, 10))).startsWith(`${index + 1} 0 obj\n`)).toBe(true);
    });
    expect(text).toMatch(new RegExp(`trailer\\n<< /Size ${count} /Root 1 0 R /Info \\d+ 0 R >>`));
    // One byte a character (ASCII, but for the four bytes of the binary comment).
    expect(file.bytes?.length).toBe(text.length);
    expect([...(file.bytes ?? []).slice(10, 14)]).toEqual([0xe2, 0xe3, 0xcf, 0xd3]);
  });

  it('declares US Letter pages, the standard faces in WinAnsi, the title, and exact stream lengths', () => {
    const file = pdfOf(RESUME_MD);
    const text = file.text ?? '';
    expect(file.pages).toBe(1);
    expect(text).toContain('/Type /Catalog /Pages 2 0 R /Lang (en-US)');
    expect(text).toContain('/MediaBox [0 0 612 792]');
    for (const face of [
      'Helvetica',
      'Helvetica-Bold',
      'Helvetica-Oblique',
      'Helvetica-BoldOblique',
      'Courier',
    ]) {
      expect(text).toContain(`/BaseFont /${face} /Encoding /WinAnsiEncoding`);
    }
    expect(text).toContain(`/Title ${utf16Hex('Alex Morgan résumé')}`);
    expect(text).toContain('/CreationDate (D:20261004120000Z)');
    const streams = [...text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)];
    expect(streams.length).toBeGreaterThan(0);
    for (const match of streams) {
      const start = (match.index ?? 0) + match[0].length;
      expect(text.indexOf('\nendstream', start) - start).toBe(Number(match[1]));
    }
  });

  it('writes the words: bold headings, bullets and numbers, a rule, bold and italic runs, code, and escapes', () => {
    const text = pdfOf(RESUME_MD).text ?? '';
    expect(text).toContain('/F2 20 Tf (Alex Morgan) Tj');
    expect(text).toContain('/F1 10 Tf (alex.morgan@example.com \\267 Seattle, WA) Tj');
    expect(text).toContain('/F2 13 Tf (Summary) Tj');
    expect(text).toContain('/F2 11 Tf (Senior Engineer, Contoso \\267 2021 to now) Tj');
    expect(text).toContain('/F1 10.5 Tf (\\225) Tj');
    expect(text).toContain('/F1 10.5 Tf (1.) Tj');
    expect(text).toContain('/F2 10.5 Tf (search) Tj');
    expect(text).toContain('/F3 10.5 Tf (data) Tj');
    expect(text).toContain('/F5 10.5 Tf (gRPC) Tj');
    expect(text).toContain('\\(parentheses\\) and a back\\\\slash.');
    // The rule under the line, and under each section heading.
    expect(
      text.match(/0\.6 w 0\.75 0\.73 0\.7 RG 72 [\d.]+ m 540 [\d.]+ l S/g)?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  it('wraps long lines inside the margins, breaks pages, and numbers them', () => {
    const long = Array.from(
      { length: 40 },
      (_, index) =>
        `## Section ${index + 1}\n${'Words to wrap across the page, again and again. '.repeat(12)}`,
    ).join('\n\n');
    const file = pdfOf(long, 'A long document');
    const text = file.text ?? '';
    expect(file.pages).toBeGreaterThan(3);
    expect(text).toContain(`/Count ${file.pages}`);
    expect(text).toContain(`(Page 1 of ${file.pages}) Tj`);
    expect(text).toContain(`(Page ${file.pages} of ${file.pages}) Tj`);
    const lines = [...text.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm (.*?) ET/g)];
    const body = lines.filter((line) => !/\(Page \d+ of \d+\)/.test(line[3] ?? ''));
    for (const [, x, y] of body) {
      expect(Number(x)).toBeGreaterThanOrEqual(72);
      expect(Number(y)).toBeGreaterThanOrEqual(72);
      expect(Number(y)).toBeLessThanOrEqual(720);
    }
    // A paragraph wraps: the same words spread over many lines, each at most a line's width.
    expect(body.filter((line) => (line[3] ?? '').includes('Words to wrap')).length).toBeGreaterThan(
      40 * 2,
    );
  });

  it('names the file for the title, without its own extension or characters a file name cannot hold', () => {
    const { api } = load();
    expect(api.download.fileName('Alex_Morgan_Resume.pdf', 'md')).toBe('Alex_Morgan_Resume.md');
    expect(api.download.fileName('A long document: test / file?', 'pdf')).toBe(
      'A long document test file.pdf',
    );
    expect(api.download.fileName('   ', 'pdf')).toBe('Document.pdf');
    expect(api.download.note).toBe(
      'A simple PDF of this text; the product’s PDF matches the template.',
    );
  });

  it('saves the Markdown as written in UTF-8, makes words paragraphs, and refuses what it cannot make', () => {
    const { api } = load();
    expect(api.download.build({ title: 'Notes', markdown: '# Hi\nThere' }, 'md')).toMatchObject({
      ok: true,
      name: 'Notes.md',
      type: 'text/markdown;charset=utf-8',
      text: '# Hi\nThere\n',
    });
    expect([...(api.download.build({ title: 'é', markdown: 'é' }, 'md').bytes ?? [])]).toEqual([
      0xc3, 0xa9, 0x0a,
    ]);
    expect(api.download.build({ title: 'Words', words: 'One.\n\nTwo.' }, 'pdf').text).toContain(
      '(One.) Tj',
    );
    expect(api.download.build({ title: 'Empty', markdown: '  ' }, 'pdf')).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(api.download.build({ title: 'X', markdown: 'x' }, 'docx')).toEqual({
      ok: false,
      reason: 'unknown-format',
    });
    // A browser without Blob says it cannot save, rather than pretending.
    expect(api.download({ title: 'X', markdown: 'x' }, 'md')).toMatchObject({
      ok: false,
      reason: 'unsupported',
    });
  });
});

describe('app-components.js · the Download menu (round 5, R1)', () => {
  const saved: Array<{ name: string; type: string; size: number }> = [];
  class FakeBlob {
    readonly type: string;
    readonly size: number;
    constructor(parts: Uint8Array[], options: { type: string }) {
      this.type = options.type;
      this.size = parts.reduce((sum, part) => sum + part.length, 0);
    }
  }
  const urls = { created: 0, revoked: 0 };
  const FakeURL = {
    createObjectURL: (blob: FakeBlob) => {
      urls.created += 1;
      saved.push({ name: '', type: blob.type, size: blob.size });
      return `blob:${urls.created}`;
    },
    revokeObjectURL: () => {
      urls.revoked += 1;
    },
  };
  const withMenu = (): {
    loaded: Loaded;
    toggle: FakeElement;
    list: FakeElement;
    heard: () => string;
  } => {
    const loaded = load({
      build: (body) =>
        body.append(
          h('div', { id: 'docs' }),
          h('button', { type: 'button', id: 'elsewhere' }, 'Elsewhere'),
        ),
      globals: { Blob: FakeBlob, URL: FakeURL },
    });
    loaded.api.downloadMenu(loaded.document.querySelector('#docs'), () => ({
      title: 'Alex Morgan résumé',
      markdown: RESUME_MD,
    }));
    return {
      loaded,
      toggle: loaded.document.querySelector('[data-download-toggle]') as FakeElement,
      list: loaded.document.querySelector('.download-menu-list') as FakeElement,
      heard: () => {
        flush(loaded);
        return loaded.document.querySelector('.jd-status')?.textContent ?? '';
      },
    };
  };
  const click = (element: FakeElement | null): void => {
    element?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
  };

  it('is a button that opens two choices, each saying what it holds, and the PDF note', () => {
    const { loaded, toggle, list } = withMenu();
    expect([
      toggle.textContent,
      attribute(toggle, 'aria-expanded'),
      attribute(toggle, 'aria-controls'),
    ]).toEqual(['Download', 'false', attribute(list, 'id')]);
    expect(list.hasAttribute('hidden')).toBe(true);
    click(toggle);
    expect([attribute(toggle, 'aria-expanded'), list.hasAttribute('hidden')]).toEqual([
      'true',
      false,
    ]);
    expect(
      loaded.document
        .querySelectorAll('[data-download-format]')
        .map((choice) => [
          attribute(choice, 'data-download-format'),
          choice.querySelector('.download-menu-name')?.textContent,
        ]),
    ).toEqual([
      ['pdf', 'PDF'],
      ['md', 'Markdown (.md)'],
    ]);
    expect(loaded.document.querySelector('.download-menu-note')?.textContent).toBe(
      'A simple PDF of this text; the product’s PDF matches the template.',
    );
  });

  it('saves the chosen file through a download link, says so once, and returns focus to the button', () => {
    const { loaded, toggle, list, heard } = withMenu();
    click(toggle);
    click(loaded.document.querySelector('[data-download-format="pdf"]'));
    expect(saved.at(-1)?.type).toBe('application/pdf');
    expect(urls.created).toBeGreaterThan(0);
    expect([attribute(toggle, 'aria-expanded'), list.hasAttribute('hidden')]).toEqual([
      'false',
      true,
    ]);
    expect(loaded.document.activeElement).toBe(toggle);
    expect(heard()).toBe('Downloaded Alex Morgan résumé.pdf.');
    // The link is gone once used; its address is let go a moment later.
    expect(loaded.document.querySelector('a[download]')).toBeNull();
    click(toggle);
    click(loaded.document.querySelector('[data-download-format="md"]'));
    expect(saved.at(-1)?.type).toBe('text/markdown;charset=utf-8');
    expect(heard()).toBe('Downloaded Alex Morgan résumé.md.');
    expect(urls.revoked).toBeGreaterThan(0);
  });

  it('closes on Escape (focus back on the button), on a click elsewhere, and when focus leaves', () => {
    const { loaded, toggle, list } = withMenu();
    click(toggle);
    const pdf = loaded.document.querySelector('[data-download-format="pdf"]') as FakeElement;
    pdf.focus();
    const escapeKey = new FakeEvent('keydown', { bubbles: true, key: 'Escape' });
    pdf.dispatchEvent(escapeKey);
    expect([
      list.hasAttribute('hidden'),
      loaded.document.activeElement === toggle,
      escapeKey.defaultPrevented,
    ]).toEqual([true, true, true]);
    click(toggle);
    click(loaded.document.querySelector('#elsewhere'));
    expect(list.hasAttribute('hidden')).toBe(true);
    click(toggle);
    pdf.focus();
    (loaded.document.querySelector('#elsewhere') as FakeElement).focus();
    expect(list.hasAttribute('hidden')).toBe(true);
  });
});

// ------------------------------------------------------------------ round 5: the usage chart

describe('app-components.js · the usage chart (round 5, C1)', () => {
  const SERIES = [
    {
      date: '2026-10-01',
      label: 'Thu, Oct 1',
      short: 'Oct 1',
      groups: [
        { id: 'gpt-5-mini', label: 'gpt-5-mini on your key', tokens: 0 },
        { id: 'ministral', label: 'Ministral 3 14B', tokens: 10900 },
      ],
    },
    {
      date: '2026-10-02',
      label: 'Fri, Oct 2',
      short: 'Oct 2',
      groups: [
        { id: 'gpt-5-mini', label: 'gpt-5-mini on your key', tokens: 49810 },
        { id: 'ministral', label: 'Ministral 3 14B', tokens: 0 },
      ],
    },
  ];
  const chartIn = (options: Record<string, unknown>) => {
    const loaded = load({ build: (body) => body.append(h('div', { id: 'usage' })) });
    const result = loaded.api.usageChart(loaded.document.querySelector('#usage'), options);
    return { loaded, result };
  };

  it('stacks each day’s groups in the series order of the palette, with a key of totals', () => {
    const { loaded, result } = chartIn({ series: SERIES, title: 'Tokens by day, by model' });
    expect(result?.total).toBe(60710);
    expect(result?.top).toBe(50000);
    const figure = loaded.document.querySelector('figure.usage-chart');
    expect(attribute(figure, 'aria-labelledby')).toBe(
      attribute(loaded.document.querySelector('.usage-chart-title'), 'id'),
    );
    expect(
      loaded.document
        .querySelectorAll('.usage-chart-key > li')
        .map((item) => [
          attribute(item, 'data-tone'),
          item.querySelector('.chart-key-name')?.textContent,
          item.querySelector('.chart-key-count')?.textContent,
        ]),
    ).toEqual([
      ['blue', 'gpt-5-mini on your key', '49,810'],
      ['green', 'Ministral 3 14B', '10,900'],
    ]);
    // One column a day; zero groups draw nothing; a bar's height is its share of the scale.
    const bars = loaded.document.querySelectorAll('.usage-chart-bar');
    expect(bars.map((bar) => bar.style.getPropertyValue('--value'))).toEqual(['21.8', '99.6']);
    expect(
      bars.map((bar) =>
        bar.querySelectorAll('.usage-chart-seg').map((segment) => attribute(segment, 'data-tone')),
      ),
    ).toEqual([['green'], ['blue']]);
    expect(attribute(loaded.document.querySelector('.usage-chart-plot'), 'aria-hidden')).toBe(
      'true',
    );
    expect(
      loaded.document.querySelectorAll('.usage-chart-axis > li').map((tick) => tick.textContent),
    ).toEqual(['50,000', '25,000', '0']);
  });

  it('reads whole counts on the axis for a few runs, never "0, 1, 1" (T6-14)', () => {
    const few = (counts: number[]) =>
      chartIn({
        unit: 'runs',
        series: counts.map((count, index) => ({
          date: `2026-10-0${index + 1}`,
          label: `Oct ${index + 1}`,
          groups: [{ id: 'watch', label: 'Keep watch', tokens: count }],
        })),
      })
        .loaded.document.querySelectorAll('.usage-chart-axis > li')
        .map((tick) => tick.textContent);
    expect(few([1, 0])).toEqual(['2', '1', '0']);
    expect(few([3, 1])).toEqual(['4', '2', '0']);
    expect(few([5])).toEqual(['6', '3', '0']);
    expect(few([12])).toEqual(['20', '10', '0']);
  });

  it('gives every segment its tip, and Show the numbers the same values as the bars', () => {
    const two = [
      {
        ...SERIES[1],
        groups: [
          { id: 'gpt-5-mini', label: 'gpt-5-mini on your key', tokens: 49810 },
          { id: 'ministral', label: 'Ministral 3 14B', tokens: 10900 },
        ],
      },
    ];
    const { loaded } = chartIn({ series: two, title: 'October' });
    const [own, platform] = loaded.document.querySelectorAll('.usage-chart-seg');
    expect([attribute(own, 'data-tip-title'), attribute(own, 'data-tip')]).toEqual([
      'Oct 2 · gpt-5-mini on your key',
      '49,810 tokens, of 60,710 that day.',
    ]);
    expect(own?.style.getPropertyValue('--share')).toBe('0.8205');
    expect(attribute(platform, 'data-tip-title')).toBe('Oct 2 · Ministral 3 14B');
    // UAT-RD RD-8: a few days of as many groups or more run across, the groups as rows and each
    // day's total in the foot, so long group names wrap as row names instead of widening the
    // table; one day needs no Total column.
    const table = loaded.document.querySelector('.usage-chart-data table');
    expect(attribute(table, 'role')).toBe('table');
    const cells = (rows: FakeElement[] | undefined) =>
      rows?.map((row) => row.children.map((cell) => cell.textContent));
    expect(table?.querySelectorAll('thead th').map((cell) => cell.textContent)).toEqual([
      'Model',
      'Fri, Oct 2',
    ]);
    expect(cells(table?.querySelectorAll('tbody tr'))).toEqual([
      ['gpt-5-mini on your key', '49,810'],
      ['Ministral 3 14B', '10,900'],
    ]);
    expect(cells(table?.querySelectorAll('tfoot tr'))).toEqual([['Total', '60,710']]);
    expect(loaded.document.querySelector('.usage-chart-data > summary')?.textContent).toBe(
      'Show the numbers',
    );

    // More days than groups keep a row a day, with the Total held at the end.
    const day = (date: string, own: number, platform: number) => ({
      date,
      label: date,
      groups: [
        { id: 'gpt-5-mini', label: 'gpt-5-mini on your key', tokens: own },
        { id: 'ministral', label: 'Ministral 3 14B', tokens: platform },
      ],
    });
    const { loaded: daily } = chartIn({
      series: [day('2026-10-01', 0, 10900), day('2026-10-02', 49810, 0), day('2026-10-03', 5, 5)],
    });
    const rows = daily.document.querySelector('.usage-chart-data table');
    expect(rows?.querySelectorAll('thead th').map((cell) => cell.textContent)).toEqual([
      'Day',
      'gpt-5-mini on your key',
      'Ministral 3 14B',
      'Total',
    ]);
    expect(cells(rows?.querySelectorAll('tbody tr'))?.at(-1)).toEqual([
      '2026-10-03',
      '5',
      '5',
      '10',
    ]);
    expect(rows?.querySelectorAll('tfoot')).toHaveLength(0);
  });

  it('takes the page’s groups in order, with their tones and a data-metric on a total', () => {
    const { loaded } = chartIn({
      series: SERIES,
      groups: [
        { id: 'ministral', label: 'Platform credits', tone: 'teal', metric: 'ai.tokens.platform' },
        { id: 'gpt-5-mini', label: 'Your OpenAI key', tone: 'indigo' },
      ],
    });
    expect(
      loaded.document
        .querySelectorAll('.usage-chart-key > li')
        .map((item) => [
          attribute(item, 'data-tone'),
          item.querySelector('.chart-key-name')?.textContent,
          attribute(item.querySelector('.chart-key-count'), 'data-metric'),
        ]),
    ).toEqual([
      ['teal', 'Platform credits', 'ai.tokens.platform'],
      ['indigo', 'Your OpenAI key', ''],
    ]);
  });

  it('draws nothing new for the same data, says so when there is nothing to draw, and reads money and millions', () => {
    const { loaded } = chartIn({ series: SERIES });
    const host = loaded.document.querySelector('#usage') as FakeElement;
    const first = host.querySelector('figure.usage-chart');
    loaded.api.usageChart(host, { series: SERIES });
    expect(host.querySelector('figure.usage-chart')).toBe(first);
    const empty = chartIn({
      series: [
        { date: '2026-10-01', label: 'Oct 1', groups: [{ id: 'a', label: 'A', tokens: 0 }] },
      ],
      empty: 'No AI work in these 30 days.',
    });
    expect(empty.loaded.document.querySelector('.usage-chart-empty')?.textContent).toBe(
      'No AI work in these 30 days.',
    );
    expect(empty.loaded.document.querySelector('.usage-chart-plot .usage-chart-empty')).toBeNull();
    const big = chartIn({
      series: [{ label: 'Oct', groups: [{ id: 'a', label: 'A', tokens: 22700000 }] }],
      period: 'month',
    });
    expect(big.loaded.document.querySelector('.chart-key-count')?.textContent).toBe('22.7 million');
    expect(big.loaded.document.querySelector('thead th')?.textContent).toBe('Month');
    const money = chartIn({
      series: [{ label: 'Oct', groups: [{ id: 'a', label: 'A', tokens: 10900, cost: 2398 }] }],
      measure: 'cost',
    });
    expect(money.loaded.document.querySelector('.chart-key-count')?.textContent).toBe('$0.0024');
  });
});

// ------------------------------------------------------------------ round 5: the form scan

const SCAN_FIELDS = [
  { id: 'first', label: 'First name', source: 'profile', value: 'Alex' },
  { id: 'title', label: 'Current title', source: 'resume', value: 'Senior Software Engineer' },
  { id: 'authorized', label: 'Authorized to work in the US?', source: 'answers', value: 'Yes' },
  { id: 'notice', label: 'Notice period', source: 'missing', need: 'required' },
  { id: 'github', label: 'GitHub profile', source: 'missing', need: 'optional' },
];

// A page's own [role="status"] element that records every message it is given.
function recordingChannel(): { element: FakeElement; heard: string[] } {
  const element = h('p', { role: 'status', class: 'sr-only', id: 'page-status' });
  const heard: string[] = [];
  let current = '';
  Object.defineProperty(element, 'textContent', {
    get: () => current,
    set: (value: string) => {
      current = String(value);
      if (current) heard.push(current);
    },
  });
  return { element, heard };
}

describe('app-components.js · the form scan (round 5, A1)', () => {
  const scanIn = (media: string[] = []) => {
    const channel = recordingChannel();
    const loaded = load({
      build: (body) => body.append(h('div', { id: 'scan' }), channel.element),
      media,
    });
    const stages: string[] = [];
    const scan = loaded.api.formScan(loaded.document.querySelector('#scan'), SCAN_FIELDS, {
      site: 'careers.example.com',
      title: 'Apply: Senior Backend Engineer',
      channel: channel.element,
      stepMs: 250,
      onStage: (stage: string) => stages.push(stage),
    });
    return { loaded, scan, stages, heard: channel.heard };
  };
  const rows = (loaded: Loaded): FakeElement[] =>
    loaded.document.querySelectorAll('.form-scan-field');

  it('opens the page, finds each field, matches it, fills it, and waits for your review', () => {
    const { loaded, scan, stages } = scanIn();
    expect(scan?.stage).toBe('open');
    expect(loaded.document.querySelector('.form-scan-stage')?.textContent).toBe('Opening the page');
    // One step of the scan (its own 250ms timers; the page's other timers wait).
    const step = (): void => {
      const timer = loaded.timers.find(
        (item) => !item.cleared && !('done' in item) && item.ms === 250,
      );
      if (!timer) return;
      Object.assign(timer, { done: true });
      timer.run();
    };
    step();
    step();
    expect(loaded.document.querySelector('.form-scan-stage')?.textContent).toBe(
      'Finding the fields: 1 of 5',
    );
    expect(rows(loaded).map((row) => row.classList.contains('is-found'))).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    for (let index = 0; index < 30; index += 1) step();
    expect(scan?.stage).toBe('review');
    expect(stages).toEqual(['open', 'find', 'match', 'fill', 'review']);
    expect(loaded.document.querySelector('.form-scan-stage')?.textContent).toBe(
      'Waiting for your review: 3 filled, 2 need you',
    );
    expect(rows(loaded).map((row) => row.querySelector('.form-scan-value')?.textContent)).toEqual([
      'Alex',
      'Senior Software Engineer',
      'Yes',
      '',
      '',
    ]);
    expect(rows(loaded).every((row) => row.classList.contains('is-matched'))).toBe(true);
  });

  it('says each stage once, politely, and never each field', () => {
    const { loaded, heard } = scanIn();
    flush(loaded);
    expect(heard).toEqual([
      'Opening careers.example.com.',
      'Finding the fields on the form.',
      'Matching 5 fields to your Profile, résumé, and answers.',
      'Filling the form.',
      'Filled 3 of 5 fields. 2 need you. Nothing is sent until you check it.',
    ]);
  });

  it('shows the final state at once under reduced motion or Pause motion, and says it once', () => {
    const reduced = scanIn(['(prefers-reduced-motion: reduce)']);
    expect(reduced.scan?.stage).toBe('review');
    flush(reduced.loaded);
    expect(reduced.heard).toEqual([
      'Filled 3 of 5 fields. 2 need you. Nothing is sent until you check it.',
    ]);
    const channel = recordingChannel();
    const paused = load({
      build: (body) => body.append(h('div', { id: 'scan' }), channel.element),
      stored: { 'jobdeputy.deputyMotion': 'paused' },
    });
    const scan = paused.api.formScan(paused.document.querySelector('#scan'), SCAN_FIELDS, {
      channel: channel.element,
    });
    expect(scan?.stage).toBe('review');
  });

  it('tags each answer with where it comes from, and missing details with the need markers', () => {
    const { loaded } = scanIn(['(prefers-reduced-motion: reduce)']);
    expect(
      rows(loaded).map((row) => {
        const tag = row.querySelector('.form-scan-tag');
        return [attribute(tag, 'data-tone') || attribute(tag, 'data-need'), tag?.textContent];
      }),
    ).toEqual([
      ['green', 'From Profile'],
      ['blue', 'From your résumé'],
      ['gold', 'From your answers'],
      ['required', 'Missing · Required'],
      ['optional', 'Missing · Optional'],
    ]);
    expect(rows(loaded).map((row) => row.querySelector('[data-scan-words]')?.textContent)).toEqual([
      ', filled from profile',
      ', filled from your résumé',
      ', filled from your answers',
      ', missing, required',
      ', missing, optional',
    ]);
    expect(attribute(loaded.document.querySelector('.form-scan-fields'), 'aria-label')).toBe(
      'Fields on the form',
    );
    expect(attribute(loaded.document.querySelector('.form-scan-bar'), 'aria-hidden')).toBe('true');
  });
});

// ------------------------------------------------------------------ round 5: the secret field

describe('app-components.js · the secret field (round 5, R5-6)', () => {
  const SECRET = 'Rk7wPq3vNm8zTj4sHc2x'; // gitleaks:allow (fake sample key)
  const fieldIn = (secret = SECRET) => {
    const loaded = load({ build: (body) => body.append(h('div', { id: 'secret' })) });
    const reveals: string[] = [];
    let reads = 0;
    const field = loaded.api.secretField(loaded.document.querySelector('#secret'), {
      label: 'Password for careers.example.com',
      reveal: () => {
        reads += 1;
        return secret;
      },
      onReveal: ({ action }: { action: string }) => reveals.push(action),
    });
    const value = loaded.document.querySelector('[data-secret-value]') as FakeElement;
    const show = loaded.document.querySelector('[data-secret-show]') as FakeElement;
    const copy = loaded.document.querySelector('[data-secret-copy]') as FakeElement;
    return { loaded, field, value, show, copy, reveals, reads: () => reads };
  };
  const press = async (button: FakeElement): Promise<void> => {
    button.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    await settled();
  };

  it('stays masked until Show, reads Hide while shown (no aria-pressed), and hides again', async () => {
    const { loaded, field, value, show, reveals, reads } = fieldIn();
    const state = loaded.document.querySelector('[data-secret-state]') as FakeElement;
    // The button's words, and so its name, say what it does next; a button whose name changes is
    // not also a pressed toggle (round 5 acceptance, D-2 and M-2).
    expect([
      value.textContent,
      value.getAttribute('aria-hidden'),
      state.textContent,
      show.textContent,
      show.getAttribute('aria-pressed'),
    ]).toEqual(['••••••••••••', 'true', 'Hidden', 'Show', null]);
    await press(show);
    expect([
      value.textContent,
      value.getAttribute('aria-hidden'),
      state.textContent,
      show.textContent,
      show.getAttribute('aria-pressed'),
      field?.shown,
    ]).toEqual([SECRET, null, '', 'Hide', null, true]);
    flush(loaded);
    expect(loaded.document.querySelector('.jd-status')?.textContent).toBe(
      'Password for careers.example.com shown.',
    );
    expect([reveals, reads()]).toEqual([['show'], 1]);
    await press(show);
    expect([
      value.textContent,
      value.getAttribute('aria-hidden'),
      state.textContent,
      show.textContent,
      show.getAttribute('aria-pressed'),
      field?.shown,
    ]).toEqual(['••••••••••••', 'true', 'Hidden', 'Show', null, false]);
    flush(loaded);
    expect(loaded.document.querySelector('.jd-status')?.textContent).toBe(
      'Password for careers.example.com hidden.',
    );
    // Hiding reads nothing; every Show reads (and so logs) again.
    expect(reads()).toBe(1);
    await press(show);
    expect([reveals, reads()]).toEqual([['show', 'show'], 2]);
  });

  it('copies without showing, logs it, and says why when it cannot copy', async () => {
    const { loaded, value, copy, reveals } = fieldIn();
    const copied: string[] = [];
    loaded.window.navigator = {
      clipboard: { writeText: async (words: string) => void copied.push(words) },
    };
    await press(copy);
    expect([copied, value.textContent, reveals]).toEqual([[SECRET], '••••••••••••', ['copy']]);
    flush(loaded);
    expect(loaded.document.querySelector('.jd-status')?.textContent).toBe(
      'Password for careers.example.com copied. It isn’t shown.',
    );
    loaded.window.navigator = {};
    await press(copy);
    flush(loaded);
    expect(loaded.document.querySelector('.jd-status')?.textContent).toBe(
      'We couldn’t copy it. Choose Show and copy it yourself.',
    );
    expect(reveals).toEqual(['copy']);
  });

  it('never shows how long the secret is, and wires a field once however often it is called', async () => {
    const short = fieldIn('abc');
    expect(short.value.textContent).toBe('••••••••••••');
    // A second call updates the field's options (a page that renders again) and binds nothing
    // twice: one press reads once, through the newest reveal.
    const { loaded, show, reads } = fieldIn();
    let second = 0;
    loaded.api.secretField(loaded.document.querySelector('#secret'), {
      reveal: () => {
        second += 1;
        return SECRET;
      },
    });
    await press(show);
    expect([reads(), second]).toEqual([0, 1]);
  });
});

// ------------------------------------------------------------------ round 5: pagination

describe('app-components.js · pagination (round 5, S3)', () => {
  const pagesIn = (options: Record<string, unknown>) => {
    const loaded = load({ build: (body) => body.append(h('div', { id: 'pages' })) });
    const pages = loaded.api.pagination(loaded.document.querySelector('#pages'), options);
    const nav = loaded.document.querySelector('nav.pagination') as FakeElement;
    const numbers = (): string[] =>
      nav
        .querySelectorAll('.pagination-numbers > li')
        .map((item) =>
          item.querySelector('.pagination-gap')
            ? '…'
            : (item.textContent ?? '').replace('Page ', ''),
        );
    return { loaded, pages, nav, numbers };
  };

  it('says Page n of m, then Previous, the numbers with the one shown current, and Next, the ends unavailable', () => {
    const { nav, numbers, pages } = pagesIn({
      total: 30,
      pageSize: 8,
      page: 1,
      label: 'Pages of your sources',
    });
    expect(attribute(nav, 'aria-label')).toBe('Pages of your sources');
    expect(nav.querySelector('.pagination-count')?.textContent).toBe('Page 1 of 4');
    expect(numbers()).toEqual(['1', '2', '3', '4']);
    const current = nav.querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe('Page 1');
    const previous = nav.querySelector('[data-page-step="previous"]');
    expect([
      previous?.tagName,
      attribute(previous, 'aria-disabled'),
      previous?.textContent,
    ]).toEqual(['BUTTON', 'true', 'Previous page']);
    expect(attribute(nav.querySelector('[data-page-step="next"]'), 'aria-disabled')).toBe('');
    expect([pages?.page, pages?.pages]).toEqual([1, 4]);
  });

  it('keeps the first, the last, and the pages around this one beyond seven, with gaps between', () => {
    expect(pagesIn({ total: 200, pageSize: 10, page: 9 }).numbers()).toEqual([
      '1',
      '…',
      '8',
      '9',
      '10',
      '…',
      '20',
    ]);
    expect(pagesIn({ total: 200, pageSize: 10, page: 1 }).numbers()).toEqual([
      '1',
      '2',
      '3',
      '4',
      '…',
      '20',
    ]);
    expect(pagesIn({ total: 200, pageSize: 10, page: 20 }).numbers()).toEqual([
      '1',
      '…',
      '17',
      '18',
      '19',
      '20',
    ]);
  });

  it('changes page on a click: once in words, focus kept on the control, and onChange told', () => {
    const changes: number[] = [];
    const { loaded, nav } = pagesIn({
      total: 30,
      pageSize: 10,
      page: 2,
      onChange: (page: number) => changes.push(page),
    });
    const next = nav.querySelector('[data-page-step="next"]') as FakeElement;
    next.focus();
    const event = new FakeEvent('click', { bubbles: true });
    next.dispatchEvent(event);
    expect(changes).toEqual([3]);
    expect(event.defaultPrevented).toBe(true);
    expect(nav.querySelector('.pagination-count')?.textContent).toBe('Page 3 of 3');
    // Next is now unavailable, so focus moves to the page shown, never to the body.
    expect(loaded.document.activeElement).toBe(nav.querySelector('[aria-current="page"]'));
    flush(loaded);
    expect(loaded.document.querySelector('.jd-status')?.textContent).toBe('Page 3 of 3.');
    // An unavailable end and the page shown do nothing.
    nav
      .querySelector('[data-page-step="next"]')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    nav
      .querySelector('[aria-current="page"]')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(changes).toEqual([3]);
  });

  it('morphs in place when the list grows, so the focused control stays (T7-1, R9-3)', () => {
    const {
      loaded,
      nav,
      numbers,
      pages: pager,
    } = pagesIn({
      total: 30,
      pageSize: 10,
      page: 1,
      noun: ['entry', 'entries'],
      onChange: () => {},
    });
    const next = nav.querySelector('[data-page-step="next"]') as FakeElement;
    next.focus();
    // The live log grows within its pages: the words change, the controls are the same elements.
    pager?.render({ total: 28 });
    pager?.render({ total: 29 });
    expect(nav.querySelector('[data-page-step="next"]')).toBe(next);
    expect(loaded.document.activeElement).toBe(next);
    expect(nav.querySelector('.pagination-range')?.textContent).toBe('1 to 10 of 29 entries');
    // A new page number is a new shape: drawn again, focus on the control with the same key.
    pager?.render({ total: 41 });
    expect(numbers()).toEqual(['1', '2', '3', '4', '5']);
    expect(attribute(loaded.document.activeElement, 'data-page-step')).toBe('next');
    expect(script).toContain('morphInto(nav, row);');
    expect(script).not.toContain("nav.textContent = '';");
  });

  it('makes links for the address with href(page), which navigate by themselves without onChange', () => {
    const { nav } = pagesIn({
      total: 30,
      pageSize: 10,
      page: 2,
      href: (page: number) => `./searches-preview.html?page=${page}`,
    });
    expect(
      nav.querySelectorAll('a.pagination-number').map((link) => attribute(link, 'href')),
    ).toEqual([
      './searches-preview.html?page=1',
      './searches-preview.html?page=2',
      './searches-preview.html?page=3',
    ]);
    const link = nav.querySelector('a[data-page-step="next"]') as FakeElement;
    const event = new FakeEvent('click', { bubbles: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('hides itself with one page, and draws again with new counts', () => {
    const { nav, pages } = pagesIn({ total: 6, pageSize: 8, page: 1 });
    expect(nav.hasAttribute('hidden')).toBe(true);
    pages?.render({ total: 40 });
    expect([
      nav.hasAttribute('hidden'),
      nav.querySelector('.pagination-count')?.textContent,
    ]).toEqual([false, 'Page 1 of 5']);
    pages?.render({ page: 9 });
    expect(nav.querySelector('.pagination-count')?.textContent).toBe('Page 5 of 5');
  });
});

// ------------------------------------------------------------------ round 5: the pause banner

describe('app-components.js · the pause banner (round 5, G1)', () => {
  const bannerIn = (paused: boolean, extra: Record<string, unknown> = {}) => {
    const state = { paused, listeners: [] as Array<() => void> };
    const store = {
      agreements: () => ({ paused: state.paused }),
      subscribe: (listener: () => void) => {
        state.listeners.push(listener);
        return () => undefined;
      },
      ...extra,
    };
    const loaded = load({
      build: (body) => body.append(h('main', { id: 'main' })),
      search: '?skipLoader',
    });
    const banner = loaded.api.agreementBanner(loaded.document.querySelector('#main'), { store });
    const set = (next: boolean): void => {
      state.paused = next;
      for (const listener of state.listeners) listener();
    };
    return {
      loaded,
      banner,
      set,
      element: loaded.document.querySelector('.agreement-banner') as FakeElement,
    };
  };

  it('is one line while paused, the warning panel with Review and sign back to this page', () => {
    const { element, banner } = bannerIn(true);
    expect(banner?.paused).toBe(true);
    expect(element.hasAttribute('hidden')).toBe(false);
    const panel = element.querySelector('.feedback-panel');
    expect(attribute(panel, 'data-kind')).toBe('warning');
    expect(
      panel?.querySelectorAll('.feedback-panel-copy > p').map((line) => line.textContent),
    ).toEqual(['Your deputy is paused until you sign the updated agreement']);
    const action = element.querySelector('a.feedback-panel-action');
    expect([action?.textContent, attribute(action, 'href')]).toEqual([
      'Review and sign',
      './agreement-preview.html?mode=update&return=components-preview.html%3FskipLoader',
    ]);
    expect(attribute(element.querySelector('.feedback-panel-icon'), 'aria-hidden')).toBe('true');
  });

  it('hides when not paused, follows the store, and says itself once when it appears later', () => {
    const { loaded, element, set } = bannerIn(false);
    expect(element.hasAttribute('hidden')).toBe(true);
    flush(loaded);
    expect(loaded.document.querySelector('.jd-status')?.textContent ?? '').toBe('');
    set(true);
    expect(element.hasAttribute('hidden')).toBe(false);
    flush(loaded);
    expect(loaded.document.querySelector('.jd-status')?.textContent).toBe(
      'Your deputy is paused until you sign the updated agreement.',
    );
    set(false);
    expect(element.hasAttribute('hidden')).toBe(true);
  });

  it('shows nothing when the store has no agreements', () => {
    const loaded = load({ build: (body) => body.append(h('main', { id: 'main' })) });
    const banner = loaded.api.agreementBanner(loaded.document.querySelector('#main'), {
      store: {},
    });
    expect(banner?.paused).toBe(false);
    expect(loaded.document.querySelector('.agreement-banner')?.hasAttribute('hidden')).toBe(true);
  });
});

// ------------------------------------------------------------------ round 5: the gallery

describe('components-preview.html · round 5 components', () => {
  it('shows each new component in its own numbered section', () => {
    for (const [id, title] of [
      ['palette', 'Data colours'],
      ['usage-chart', 'Usage chart'],
      ['form-scan', 'Form scan'],
      ['secret-field', 'Secret field'],
      ['pagination', 'Pagination'],
      ['download', 'Download'],
      ['agreement-banner', 'Pause banner'],
    ] as Array<[string, string]>) {
      expect(roundSection(id), id).toContain(`>${title}</h2>`);
      expect(gallery, id).toMatch(
        new RegExp(
          `<li><a href="#${id}"><span class="gallery-index-number">\\d\\d</span>${title}</a></li>`,
        ),
      );
    }
  });

  it('shows every data colour, the meters’ parts, the series, and the colour-blind simulations', () => {
    const palette = roundSection('palette');
    for (const tone of VIZ_TONES.slice(0, 5)) {
      expect(palette, tone).toContain(
        `<span class="viz-swatch" data-tone="${tone}" aria-hidden="true"></span>`,
      );
    }
    expect(palette).toContain('data-part="left" data-meter-kind="watch"');
    expect(palette).toContain('data-part="left" data-meter-kind="assist"');
    for (const part of ['used', 'bonus', 'bought'])
      expect(palette).toContain(`data-part="${part}"`);
    for (const vision of ['normal', 'protanopia', 'deuteranopia', 'tritanopia']) {
      expect(palette).toContain(`<li class="gallery-sim" data-vision="${vision}">`);
    }
    for (const vision of ['protanopia', 'deuteranopia', 'tritanopia']) {
      expect(palette).toContain(
        `<filter id="gallery-sim-${vision}" color-interpolation-filters="linearRGB">`,
      );
    }
    // The order the series takes, in words.
    expect(textOf(palette)).toContain(
      '1. Blue 2. Green 3. Orange 4. Wine 5. Grey 6. Charcoal 7. Indigo',
    );
  });

  it('writes no AI run anywhere outside the shared chrome, and no Get more runs', () => {
    const own = gallery.replace(/<nav class="account-popover"[\s\S]*?<\/nav>/, '');
    expect(own).not.toMatch(/AI runs?\b/);
    expect(own).not.toContain('Get more runs');
    expect(own).not.toContain('data-topup-open="ai"');
  });

  it('plays its demos from this page only, with the store’s usage when it has some', () => {
    expect(gallery).toContain("store.aiUsageSeries({ days: 30, group: 'model' })");
    expect(gallery).toContain(
      'components.formScan(scanHost, SCAN_FIELDS, { ...scanOptions, autoplay: false });',
    );
    expect(gallery).toContain(
      "components.secretField(document.querySelector('#gallery-secret'), {",
    );
    expect(gallery).toContain("components.pagination(document.querySelector('#gallery-pages'), {");
    expect(gallery).toContain(
      "components.agreementBanner(document.querySelector('#gallery-banner-host'), {",
    );
    expect(gallery).toContain(
      '{ store: sampleStore, metrics: false, compact: true, quiet: true },',
    );
  });
});

// ------------------------------------------------------------------ guard self-checks

describe('guard self-checks', () => {
  const rules = (css: string): StyleRule[] => parseStyleRules(css);

  it('flags raw colours but allows tokens, white, transparent, and forced-colours system colours', () => {
    expect(
      rawColours(
        rules(
          '.a { color: #fff; } .b { background: rgba(0, 0, 0, 0.1); } .c { border-color: red; } .d { color: var(--ink); background: white; } .e { stroke: Highlight; } @media (forced-colors: active) { .f { stroke: Highlight; } }',
        ),
      ),
    ).toEqual([
      '.a { color: #fff }',
      '.b { background: rgba(0, 0, 0, 0.1) }',
      '.c { border-color: red }',
      '.e { stroke: Highlight }',
    ]);
  });

  it('flags other font stacks, small text, glyphs without alt text, and toned text', () => {
    expect(
      fontFamilyProblems(rules('.a { font-family: Georgia; } .b { font-family: inherit; }')),
    ).toEqual(['.a { font-family: Georgia }']);
    expect(
      smallText(
        rules(
          '.a { font-size: 11px; } .b { font-size: clamp(10px, 2vw, 14px); } .c { font-size: 12px; }',
        ),
      ),
    ).toEqual(['.a { font-size: 11px }', '.b { font-size: clamp(10px, 2vw, 14px) }']);
    expect(
      glyphsWithoutAlt(
        rules(
          '.a::before { content: "✓"; } .b::before { content: "✓" / ""; } .c::after { content: ""; }',
        ),
      ),
    ).toEqual(['.a::before { content: "✓" }']);
    expect(
      tonedText(
        rules('.a { color: var(--green); } .b { color: var(--green-ink); fill: var(--blue); }'),
      ),
    ).toEqual(['.a { color: var(--green) }']);
  });

  it('finds a chrome class in the subject compound only, and skips keyframe steps', () => {
    expect(subjectCompound('.board-card:has(.compact-action:focus-visible) .board-card-link')).toBe(
      '.board-card-link',
    );
    expect(topLevelClasses('.compact-action.checklist-action:hover')).toEqual([
      'compact-action',
      'checklist-action',
    ]);
    expect(topLevelClasses('.choice-card:has(input:checked)')).toEqual(['choice-card']);
    expect(['is-attention', 'has-action', 'compact-action'].filter(isModifier)).toEqual([
      'is-attention',
      'has-action',
    ]);
    expect(
      selectorsIn('@keyframes a { from { opacity: 0; } 50% { opacity: 1; } } .b { color: red; }'),
    ).toEqual(['.b']);
  });

  it('weighs selectors like a browser', () => {
    expect(specificity('.hbar-row[data-tone="blue"] .hbar-fill')).toEqual([0, 3, 0]);
    expect(specificity('.chart-legend > [data-tone] > .chart-legend-item::before')).toEqual([
      0, 3, 1,
    ]);
    expect(specificity(':is(:root[data-component-motion], .loader-active) .meter::before')).toEqual(
      [0, 3, 1],
    );
    expect(specificity('.choice-card:has(input:checked)')).toEqual([0, 2, 1]);
    expect(specificity('a.kpi:hover')).toEqual([0, 2, 1]);
    expect(specificity(':where(.a) #b')).toEqual([1, 0, 0]);
  });

  it('flags motion the reduced-motion block does not stop', () => {
    const css =
      '.a { transition: color 180ms ease; } .b { animation: in 380ms; } .c:hover { transform: translateY(-1px); } @media (prefers-reduced-motion: reduce) { .a { transition: none !important; } .b { animation: none; } }';
    expect(motionLeaks(rules(css))).toEqual(['.b { animation }', '.c:hover { transform }']);
    expect(importantOutsideReduce(rules('.a { color: red !important; }'))).toEqual([
      '.a { color }',
    ]);
  });

  it('reads padding sides from padding and padding-inline', () => {
    expect(paddingOf(rules('.a { padding: 12px 20px; }'), '.a')).toEqual([12, 20, 12, 20]);
    expect(paddingOf(rules('.a { padding: 7px 12px 7px 6px; }'), '.a')).toEqual([7, 12, 7, 6]);
    expect(paddingOf(rules('.a { padding-inline: 12px; }'), '.a')).toEqual([
      undefined,
      12,
      undefined,
      12,
    ]);
  });

  it('matches selectors in the fake DOM as a browser would', () => {
    const tree = h(
      'div',
      { class: 'chart' },
      h('ul', { class: 'chart-legend' }, h('li', { 'data-tone': 'blue' }, h('a', { href: '#x' }))),
    );
    const link = tree.querySelector('a[href]');
    expect(link?.closest('.donut, .chart')).toBe(tree);
    expect(link?.matches('.chart-legend > li > a')).toBe(true);
    expect(link?.matches('.chart > a')).toBe(false);
    expect(tree.querySelectorAll('[data-tone="blue"]')).toHaveLength(1);
    expect(() => tree.matches('a:hover')).toThrow(/cannot match/);
  });
});

describe('even tabs', () => {
  const css = readFileSync(resolve(brandDirectory, 'app-components.css'), 'utf8').replace(
    /\s+/g,
    ' ',
  );

  it('keeps a short set of tabs with counts on one row at 720px and narrower', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 720px) { .tabs.is-even'));
    expect(phone).toMatch(
      /^@media \(max-width: 720px\) \{ \.tabs\.is-even \{ display: grid; grid-auto-columns: minmax\(0, 1fr\); grid-auto-flow: column; \}/,
    );
    expect(phone).toMatch(
      /\.tabs\.is-even > \[role="tab"\] \{ min-height: 64px; flex-direction: column; gap: 4px; justify-content: center; padding: 6px 4px; font-size: 13px; white-space: normal; text-align: center; \}/,
    );
  });

  it('shows the variant in the gallery and on Job matches', () => {
    expect(readFileSync(resolve(brandDirectory, 'components-preview.html'), 'utf8')).toContain(
      '<div class="tabs is-even" role="tablist">',
    );
    expect(readFileSync(resolve(brandDirectory, 'jobs-preview.html'), 'utf8')).toContain(
      '<div class="tabs is-even jobs-views" role="tablist" aria-label="Job match views" data-tabs>',
    );
  });
});

// ------------------------------------------------------------------ round 6: growing lists

describe('app-components.js · growing lists (round 6, R6-4)', () => {
  it('topWithOther keeps the n largest, ties by label, and sums the rest as Other', () => {
    const { api } = load();
    const list = [
      { id: 'a', label: 'Bravo', value: 3 },
      { id: 'b', label: 'Alpha', value: 3 },
      { id: 'c', label: 'Charlie', value: 9 },
      { id: 'd', label: 'Delta', value: 1 },
      { id: 'e', label: 'Echo', value: 2 },
    ];
    const result = api.topWithOther(list, { n: 3 });
    expect(result.top.map((entry) => entry.key)).toEqual(['c', 'b', 'a']);
    expect(result.other).toEqual({ label: 'Other', value: 3, count: 2, items: [list[4], list[3]] });
    expect(result.total).toBe(18);
    expect(api.topWithOther(list, { n: 9 }).other).toBe(null);
    // value, label, and key may name a field.
    const named = api.topWithOther([{ name: 'X', found: 4, slug: 'x' }], {
      value: 'found',
      label: 'name',
      key: 'slug',
    });
    expect(named.top[0]).toMatchObject({ value: 4, label: 'X', key: 'x' });
  });

  it('matches the store’s topWithOther when the store has one', () => {
    const storeSource = readFileSync(resolve(brandDirectory, 'sample-store.js'), 'utf8');
    const own = script.slice(script.indexOf('function topWithOther('));
    const theirs = storeSource.slice(storeSource.indexOf('function topWithOther('));
    // The same sort and the same Other: by value, then label, then order.
    const rule = 'b.value - a.value || a.label.localeCompare(b.label) || a.index - b.index';
    expect(own.slice(0, 1600)).toContain(rule);
    if (storeSource.includes('function topWithOther('))
      expect(theirs.slice(0, 1600)).toContain(rule);
  });

  const stackBars = [
    {
      id: 'r1',
      label: 'Mon, Sep 21',
      metric: 'runs.r1.kept',
      parts: [
        { sourceId: 'google', value: 2, href: './searches-preview.html?source=google&run=r1' },
        { sourceId: 'stripe', value: 1, href: './searches-preview.html?source=stripe&run=r1' },
      ],
    },
    {
      id: 'r2',
      label: 'Tue, Sep 22',
      href: './searches-preview.html?source=acme',
      parts: [
        { sourceId: 'acme', value: 3, tone: 'other' },
        { sourceId: 'google', value: 1 },
      ],
    },
  ];
  const stackSeries = [
    { id: 'google', label: 'Google Careers', tone: 'blue' },
    { id: 'stripe', label: 'Stripe Jobs', tone: 'green' },
  ];

  it('stackedBars stacks each bar by series, totals it on top, and keys the series and Other', () => {
    const loaded = load({ build: (body) => body.append(h('div', { id: 'host' })) });
    const host = loaded.document.querySelector('#host');
    const result = loaded.api.stackedBars(host, {
      title: 'New roles per search',
      bars: stackBars,
      series: stackSeries,
      otherLabel: 'Other sources',
      unit: ['new role', 'new roles'],
    });
    expect(result?.total).toBe(7);
    const figure = loaded.document.querySelector('figure.bar-chart');
    expect(figure?.classList.contains('is-stacked')).toBe(true);
    expect(attribute(figure, 'aria-labelledby')).toBe(
      attribute(loaded.document.querySelector('.bar-chart-title'), 'id'),
    );
    expect(attribute(loaded.document.querySelector('.bar-chart-plot'), 'aria-hidden')).toBe('true');
    const bars = loaded.document.querySelectorAll('.bar-chart-bar');
    expect(bars).toHaveLength(2);
    // The first bar's parts link (pointer only), so the bar itself does not.
    expect(bars[0]?.tagName).toBe('SPAN');
    const parts = bars[0]?.querySelectorAll('.bar-chart-part') ?? [];
    expect(
      parts.map((part) => [
        part.tagName,
        attribute(part, 'data-tone'),
        attribute(part, 'tabindex'),
      ]),
    ).toEqual([
      ['A', 'blue', '-1'],
      ['A', 'green', '-1'],
    ]);
    expect(attribute(parts[0], 'data-tip')).toBe('2 new roles of 3.');
    expect(bars[0]?.querySelector('.bar-chart-value')?.textContent).toBe('3');
    expect(attribute(bars[0]?.querySelector('.bar-chart-value'), 'data-metric')).toBe(
      'runs.r1.kept',
    );
    // The second bar links as a whole; its Other part is hatched grey.
    expect(bars[1]?.tagName).toBe('A');
    expect(attribute(bars[1]?.querySelector('[data-series="other"]'), 'data-tone')).toBe('other');
    const key = loaded.document.querySelector('.bar-chart-stack-key');
    expect(
      key?.querySelectorAll('li').map((item) => [attribute(item, 'data-tone'), item.textContent]),
    ).toEqual([
      ['blue', 'Google Careers 3 new roles'],
      ['green', 'Stripe Jobs 1 new role'],
      ['other', 'Other sources 3 new roles'],
    ]);
    // Show the numbers (round 6, N2): one row a bar, its parts in one cell with the part links
    // as the keyboard path, and its total.
    expect(
      loaded.document.querySelectorAll('.bar-chart-data thead th').map((cell) => cell.textContent),
    ).toEqual(['Bar', 'Parts', 'New roles']);
    const cells = loaded.document.querySelectorAll('.bar-chart-data tbody td');
    expect(cells.map((cell) => cell.textContent)).toEqual([
      'Google Careers 2, Stripe Jobs 1',
      '3',
      'Google Careers 1, Other sources 3',
      '4',
    ]);
    expect(cells[0]?.querySelectorAll('a').map((link) => attribute(link, 'href'))).toEqual([
      './searches-preview.html?source=google&run=r1',
      './searches-preview.html?source=stripe&run=r1',
    ]);
    expect(cells[1]?.classList.contains('is-number')).toBe(true);
  });

  it('stackedBars dates every bar, with an optional second line, and names it in the table', () => {
    const loaded = load({ build: (body) => body.append(h('div', { id: 'host' })) });
    loaded.api.stackedBars(loaded.document.querySelector('#host'), {
      bars: [
        { id: 'r8', label: 'Thu, Oct 1', short: 'Oct 1', parts: [{ series: 'google', value: 5 }] },
        {
          id: 'r9',
          label: 'Fri, Oct 2',
          short: 'Oct 2',
          sublabel: 'Keep watch',
          parts: [
            { series: 'google', value: 2 },
            { series: 'microsoft', value: 1 },
          ],
        },
      ],
      series: stackSeries,
    });
    expect(
      loaded.document.querySelectorAll('.bar-chart-label').map((label) => label.textContent),
    ).toEqual(['Oct 1', 'Oct 2']);
    expect(loaded.document.querySelector('.bar-chart-sublabel')?.textContent).toBe('Keep watch');
    // A date and the time under it are thinned together where they do not fit (T1-4): no time
    // under a date that is not shown, and a date that would read twice goes instead.
    expect(script).toContain(
      "if (dropped || textWidth(sub) + 8 > room) sub.setAttribute('data-thinned', '');",
    );
    expect(script).toContain('if (words && words === said && !told) {');
    // Only one date said twice goes: the comparison reads the bar's full date, so two days that
    // share a letter (Saturday's and Sunday's "S") both keep their labels (T6-5).
    expect(script).toContain(
      "const words = String(label.getAttribute('data-day') || label.textContent || '').trim();",
    );
    expect(
      loaded.document
        .querySelectorAll('.bar-chart-label')
        .map((label) => label.getAttribute('data-day')),
    ).toEqual(['Thu, Oct 1', 'Fri, Oct 2']);
    expect(
      loaded.document.querySelectorAll('.bar-chart-data tbody th').map((cell) => cell.textContent),
    ).toEqual(['Thu, Oct 1', 'Fri, Oct 2Keep watch']);
    expect(
      loaded.document.querySelector('.bar-chart-data tbody th .data-table-meta')?.textContent,
    ).toBe('Keep watch');
  });

  it('stackedBars caps the series at five, and can leave out its caption and its key counts', () => {
    const loaded = load({
      build: (body) =>
        body.append(h('h3', { id: 'card-title' }, 'New roles'), h('div', { id: 'host' })),
    });
    const many = Array.from({ length: 7 }, (_, index) => ({
      id: `s${index}`,
      label: `Source ${index}`,
    }));
    loaded.api.stackedBars(loaded.document.querySelector('#host'), {
      bars: [
        {
          id: 'r1',
          label: 'Mon, Sep 21',
          parts: many.map((item, index) => ({ series: item.id, value: 10 - index })),
        },
      ],
      series: many,
      labelledBy: 'card-title',
      keyCounts: false,
    });
    const figure = loaded.document.querySelector('figure.bar-chart');
    expect(attribute(figure, 'aria-labelledby')).toBe('card-title');
    expect(loaded.document.querySelector('.bar-chart-caption')).toBe(null);
    const key = loaded.document.querySelectorAll('.bar-chart-stack-key li');
    expect(key.map((item) => item.textContent)).toEqual([
      'Source 0',
      'Source 1',
      'Source 2',
      'Source 3',
      'Source 4',
      'Other',
    ]);
    expect(loaded.document.querySelectorAll('.bar-chart-stack-key .chart-key-count')).toHaveLength(
      0,
    );
    // The counts stay in the tips.
    expect(attribute(key[5]?.querySelector('.chart-key-item'), 'data-tip-title')).toBe('Other · 9');
  });

  it('usageChart folds models past the cap into Other, marks fallback days, and pads the month', () => {
    const loaded = load({ build: (body) => body.append(h('div', { id: 'host' })) });
    const models = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const series = [
      {
        date: '2026-10-01',
        label: 'Thu, Oct 1',
        short: 'Oct 1',
        groups: models.map((id, index) => ({
          id,
          label: `Model ${id}`,
          tokens: 7000 - index * 1000,
        })),
      },
      {
        date: '2026-10-02',
        label: 'Fri, Oct 2',
        short: 'Oct 2',
        fallback: true,
        groups: models.map((id) => ({ id, label: `Model ${id}`, tokens: 100 })),
      },
    ];
    loaded.api.usageChart(loaded.document.querySelector('#host'), {
      series,
      groups: [
        {
          id: 'a',
          label: 'Model a',
          instead: 'in Deputy Assist',
          href: '#assist-meter',
          metric: 'x',
        },
      ],
      cap: 5,
      otherLabel: 'Other models',
      columns: 31,
      totalLabel: 'tokens in October',
      totalMetric: 'ai.tokens.month',
      title: 'Tokens by day, by model',
    });
    const key = loaded.document.querySelectorAll('.usage-chart-key > li');
    expect(key.map((item) => attribute(item, 'data-tone'))).toEqual([
      'blue',
      'green',
      'orange',
      'wine',
      'quiet',
      'other',
      '',
    ]);
    // The group named instead of its count: a link, the words, no figure, no metric.
    const first = key[0]?.querySelector('.chart-key-item');
    expect(first?.tagName).toBe('A');
    expect(attribute(first, 'href')).toBe('#assist-meter');
    expect(first?.querySelector('.usage-chart-instead')?.textContent).toBe('in Deputy Assist');
    expect(loaded.document.querySelectorAll('[data-metric="x"]')).toHaveLength(0);
    expect(key[5]?.textContent).toContain('Other models 3,200');
    expect(key[6]?.textContent).toBe('Fell back to platform credits 1 day');
    expect(loaded.document.querySelectorAll('.usage-chart-column')).toHaveLength(31);
    expect(loaded.document.querySelectorAll('.usage-chart-column.is-future')).toHaveLength(29);
    expect(loaded.document.querySelectorAll('.usage-chart-mark')).toHaveLength(1);
    const total = loaded.document.querySelector('.usage-chart-total');
    expect(total?.textContent).toBe('28,700 tokens in October');
    expect(attribute(total?.querySelector('strong'), 'data-metric')).toBe('ai.tokens.month');
    // The table lists only the days shown, with a Note for the marked day. Two days of six
    // groups run across (UAT-RD RD-8): a column a day, a row a group, then the Note row.
    const table = loaded.document.querySelector('.usage-chart-data table');
    expect(table?.querySelectorAll('thead th').map((cell) => cell.textContent)).toEqual([
      'Model',
      'Thu, Oct 1',
      'Fri, Oct 2',
      'Total',
    ]);
    const rows = table?.querySelectorAll('tbody tr') ?? [];
    expect(rows).toHaveLength(7);
    expect(rows.at(-1)?.children.map((cell) => cell.textContent)).toEqual([
      'Note',
      '',
      'Fell back to platform credits',
      '',
    ]);
  });
});

describe('app-components.js · See all (round 6, R6-4)', () => {
  const items = [
    {
      id: 'g',
      label: 'Google Careers',
      count: 12,
      tone: 'blue',
      href: './jobs-preview.html?source=g',
    },
    { id: 'n', label: 'Northwind Traders careers', count: 4, tone: 'other', meta: 'Northwind' },
    { id: 'a', label: 'Acme Engineering', count: 20, tone: 'green' },
  ];

  it('lists every item in one drawer, sorted, with its count, colour, and link', () => {
    const loaded = load();
    const opener = h('button', { type: 'button' }, 'See all 3');
    loaded.document.body.append(opener);
    const { drawer } = loaded.api.seeAll.open(
      {
        title: 'Matches by source',
        items,
        noun: ['source', 'sources'],
        countLabel: ['role', 'roles'],
        key: true,
      },
      opener,
    );
    expect(drawer.hasAttribute('open')).toBe(true);
    expect(drawer.classList.contains('see-all-drawer')).toBe(true);
    expect(loaded.document.querySelector('#jd-see-all-title')?.textContent).toBe(
      'Matches by source',
    );
    const rows = loaded.document.querySelectorAll('.see-all-item');
    expect(rows.map((row) => row.querySelector('.see-all-label')?.textContent)).toEqual([
      'Acme Engineering',
      'Google Careers',
      'Northwind Traders careers',
    ]);
    expect(rows[1]?.querySelector('.see-all-link')?.tagName).toBe('A');
    expect(rows[1]?.querySelector('.see-all-count')?.textContent).toBe('12 roles');
    expect(attribute(rows[2]?.querySelector('.viz-swatch'), 'data-tone')).toBe('other');
    expect(rows[2]?.querySelector('.see-all-meta')?.textContent).toBe('Northwind · In Other');
    expect(loaded.document.querySelector('.see-all-result')?.textContent).toBe(
      '3 sources, most first',
    );
    // Typing narrows the list, and the count is said once the typing settles.
    const input = loaded.document.querySelector('#jd-see-all-find') as FakeElement;
    input.value = 'north';
    input.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    expect(loaded.document.querySelectorAll('.see-all-item')).toHaveLength(1);
    expect(loaded.document.querySelector('.see-all-result')?.textContent).toBe(
      'Showing 1 of 3 sources',
    );
    flush(loaded);
    expect(drawer.querySelector('[role="status"]')?.textContent).toBe('Showing 1 of 3 sources.');
    // The sort: Name, A to Z.
    input.value = '';
    input.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    const select = loaded.document.querySelector('#jd-see-all-sort') as FakeElement;
    select.value = 'name';
    select.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    expect(
      loaded.document.querySelectorAll('.see-all-label').map((label) => label.textContent),
    ).toEqual(['Acme Engineering', 'Google Careers', 'Northwind Traders careers']);
  });

  it('lists items without counts in their own order, with no sort control', () => {
    const loaded = load();
    loaded.api.seeAll.open({
      title: 'To-do',
      items: [
        { id: 'z', label: 'Sign the agreement', count: null, meta: 'Sign by Thu, Oct 15' },
        { id: 'a', label: 'Approve materials', count: null },
      ],
      sorts: [],
      noun: ['item', 'items'],
    });
    expect(
      loaded.document.querySelectorAll('.see-all-label').map((label) => label.textContent),
    ).toEqual(['Sign the agreement', 'Approve materials']);
    expect(loaded.document.querySelectorAll('.see-all-count')).toHaveLength(0);
    expect(loaded.document.querySelector('.see-all-sort')?.hasAttribute('hidden')).toBe(true);
    expect(loaded.document.querySelector('.see-all-result')?.textContent).toBe('2 items');
    // One choice is no choice either (T1-17): a single sort draws no control, and the grid display
    // of the control gives way to the hidden attribute.
    loaded.api.seeAll.open({
      title: 'To-do',
      items: [{ id: 'a', label: 'Approve materials', count: null }],
      sorts: [{ id: 'urgent', label: 'Most urgent first' }],
      noun: ['item', 'items'],
    });
    expect(loaded.document.querySelector('.see-all-sort')?.hasAttribute('hidden')).toBe(true);
    expect(loaded.document.querySelectorAll('#jd-see-all-sort option')).toHaveLength(1);
    expect(declared(componentRules, '.see-all-sort[hidden]', 'display')).toBe('none');
  });
});

describe('app-components.js · the multi-select filter (round 6, R1 and P3)', () => {
  const options = [
    { value: 'google', label: 'Google', count: 3 },
    { value: 'stripe', label: 'Stripe', count: 5 },
    { value: 'acme', label: 'Acme', count: 1 },
    { value: 'northwind', label: 'Northwind Traders', count: 2 },
    { value: 'contoso', label: 'Contoso', count: 2, tone: 'other' },
  ];
  const build = (body: FakeElement): void => body.append(h('div', { id: 'host' }));

  it('names what it holds on a disclosure button, and opens a labelled search and checkboxes', () => {
    const loaded = load({ build });
    const filter = loaded.api.multiSelect(loaded.document.querySelector('#host'), {
      name: 'company',
      label: 'Company',
      singular: 'company',
      plural: 'companies',
      options,
      selected: ['acme'],
      countLabel: ['draft', 'drafts'],
    });
    const trigger = loaded.document.querySelector('.multi-select-trigger') as FakeElement;
    // The names live in the chips; the button says how many (B6's report, round 6).
    expect(trigger.textContent).toBe('Company: 1 selected');
    expect(attribute(trigger, 'aria-expanded')).toBe('false');
    const popover = loaded.document.querySelector('.multi-select-popover') as FakeElement;
    expect(attribute(trigger, 'aria-controls')).toBe(attribute(popover, 'id'));
    expect(attribute(popover, 'role')).toBe('group');
    expect(popover.hasAttribute('hidden')).toBe(true);
    trigger.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(filter?.isOpen).toBe(true);
    expect(attribute(trigger, 'aria-expanded')).toBe('true');
    expect(popover.hasAttribute('hidden')).toBe(false);
    // Focus goes to the labelled search box.
    const input = popover.querySelector('input[type="search"]') as FakeElement;
    expect(loaded.document.activeElement).toBe(input);
    expect(attribute(popover.querySelector('label.field-label'), 'for')).toBe(
      attribute(input, 'id'),
    );
    expect(popover.querySelector('label.field-label')?.textContent).toBe('Find a company');
    // Selected first, then by count, then by name.
    expect(
      popover.querySelectorAll('.multi-select-option-name').map((name) => name.textContent),
    ).toEqual(['Acme', 'Stripe', 'Google', 'Contoso', 'Northwind Traders']);
    expect(attribute(popover.querySelector('.multi-select-swatch'), 'data-tone')).toBe('other');
    expect(popover.querySelector('.multi-select-result')?.textContent).toBe(
      '5 companies, 1 selected',
    );
    expect(popover.querySelector('legend')?.textContent).toBe('Companies');
  });

  it('says "an" before a vowel sound in its search label (T4-15)', () => {
    const findLabel = (singular: string): string | undefined => {
      const loaded = load({ build });
      loaded.api.multiSelect(loaded.document.querySelector('#host'), {
        name: 'area',
        label: 'Area',
        singular,
        options,
      });
      return loaded.document.querySelector('.multi-select-find label.field-label')?.textContent;
    };
    expect(findLabel('area')).toBe('Find an area');
    expect(findLabel('outcome')).toBe('Find an outcome');
    expect(findLabel('source')).toBe('Find a source');
    expect(findLabel('university')).toBe('Find a university');
    expect(findLabel('hour')).toBe('Find an hour');
  });

  it('fires one change per choice, shows three chips and +N more, and closes on Escape', () => {
    const loaded = load({ build });
    const heard: unknown[] = [];
    const filter = loaded.api.multiSelect(loaded.document.querySelector('#host'), {
      name: 'company',
      label: 'Company',
      singular: 'company',
      plural: 'companies',
      options,
      onChange: (values: string[]) => heard.push(['callback', values]),
    });
    filter?.root.addEventListener('change', (event) => heard.push(['event', event.detail]));
    filter?.open();
    const boxes = loaded.document.querySelectorAll('.multi-select-option input');
    for (const box of boxes.slice(0, 4)) {
      box.checked = true;
      box.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    }
    // The boxes stay in place while it is open (none moves under the pointer).
    expect(loaded.document.querySelectorAll('.multi-select-option input')).toEqual(boxes);
    expect(heard.filter((entry) => (entry as unknown[])[0] === 'event')).toHaveLength(4);
    expect(filter?.values).toEqual(['stripe', 'google', 'contoso', 'northwind']);
    expect(loaded.document.querySelector('.multi-select-trigger')?.textContent).toBe(
      'Company: 4 selected',
    );
    const chips = loaded.document.querySelectorAll('.multi-select-chips button');
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Stripe',
      'Google',
      'Contoso',
      '+1 more',
    ]);
    expect(attribute(chips[0], 'aria-label')).toBe('Remove Stripe');
    // "+N more" has one clean name that starts with its words (T2-13): no hidden part inside it,
    // so no line break in its text and no space before the colon.
    expect(attribute(chips[3], 'aria-label')).toBe('+1 more: show all 4 selected');
    expect(chips[3]?.querySelector('.sr-only')).toBeNull();
    flush(loaded);
    expect(loaded.document.querySelector('.multi-select [role="status"]')?.textContent).toBe(
      '4 companies selected.',
    );
    // Escape closes it and returns focus to the button.
    const escapeKey = new FakeEvent('keydown', { bubbles: true, key: 'Escape' });
    loaded.document.querySelector('.multi-select-option input')?.dispatchEvent(escapeKey);
    expect(escapeKey.defaultPrevented).toBe(true);
    expect(filter?.isOpen).toBe(false);
    expect(loaded.document.activeElement).toBe(
      loaded.document.querySelector('.multi-select-trigger'),
    );
    // A chip removes its value; Clear removes them all.
    chips[0]?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(filter?.values).toEqual(['google', 'contoso', 'northwind']);
    filter?.open();
    loaded.document
      .querySelector('.multi-select-clear')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(filter?.values).toEqual([]);
    expect(loaded.document.querySelector('.multi-select-trigger')?.textContent).toBe(
      'Company: Any',
    );
    expect(loaded.document.querySelector('.multi-select-chips')?.hasAttribute('hidden')).toBe(true);
  });

  it('names the first two on the button only when it shows no chips, in its own word', () => {
    const loaded = load({ build });
    loaded.api.multiSelect(loaded.document.querySelector('#host'), {
      label: 'Company',
      options,
      selected: ['google', 'stripe', 'acme'],
      maxChips: 0,
    });
    expect(loaded.document.querySelector('.multi-select-trigger')?.textContent).toBe(
      'Company: Stripe, Google +1',
    );
    expect(loaded.document.querySelector('.multi-select-chips')?.hasAttribute('hidden')).toBe(true);
    const watched = load({ build });
    watched.api.multiSelect(watched.document.querySelector('#host'), {
      label: 'Sources',
      options,
      selected: ['google', 'stripe'],
      selectedWord: 'watched',
    });
    expect(watched.document.querySelector('.multi-select-trigger')?.textContent).toBe(
      'Sources: 2 watched',
    );
  });

  it('narrows the list as you type and says how many match', () => {
    const loaded = load({ build });
    const filter = loaded.api.multiSelect(loaded.document.querySelector('#host'), {
      label: 'Company',
      singular: 'company',
      plural: 'companies',
      options,
    });
    filter?.open();
    const input = loaded.document.querySelector(
      '.multi-select input[type="search"]',
    ) as FakeElement;
    input.value = 'north';
    input.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    expect(loaded.document.querySelectorAll('.multi-select-option')).toHaveLength(1);
    expect(loaded.document.querySelector('.multi-select-result')?.textContent).toBe(
      '1 of 5 companies match',
    );
    input.value = 'zzz';
    input.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    expect(loaded.document.querySelector('.multi-select-empty')?.textContent).toBe(
      'No company matches “zzz”.',
    );
    // Clear empties the search as well as the choices, and the whole list is back (T2-9).
    loaded.document
      .querySelector('.multi-select-clear')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(input.value).toBe('');
    expect(loaded.document.querySelectorAll('.multi-select-option')).toHaveLength(5);
    expect(loaded.document.querySelector('.multi-select-result')?.textContent).toBe('5 companies');
    // Closing empties it too (Escape, Done, a click outside), so no typed words stay unseen.
    input.value = 'north';
    input.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    filter?.close();
    expect(filter?.isOpen).toBe(false);
    expect(input.value).toBe('');
    expect(loaded.document.querySelectorAll('.multi-select-option')).toHaveLength(5);
    filter?.open();
    input.value = 'acme';
    input.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    loaded.document
      .querySelector('.multi-select-done')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(input.value).toBe('');
  });
});

describe('app-components.js · background notices (round 6)', () => {
  it('records through the store, shows one quiet toast, says it once, and leaves after 21 seconds', () => {
    const recorded: unknown[] = [];
    const store = fakeStore(null, { withCounts: false });
    store.addNotice = (notice: unknown) => recorded.push(notice);
    const loaded = load({ store });
    const shown = loaded.api.notice({
      id: 'prompt-test-rank-v4',
      text: 'Rank version 4 passed its test',
      detail: 'It tries on 20% of runs',
      action: { label: 'See why', href: './prompts-preview.html#rank' },
    });
    expect(recorded).toEqual([
      {
        id: 'prompt-test-rank-v4',
        text: 'Rank version 4 passed its test',
        kind: 'done',
        href: './prompts-preview.html#rank',
      },
    ]);
    const toast = loaded.document.querySelector('.bg-toast') as FakeElement;
    expect(shown.element).toBe(toast);
    expect(attribute(toast, 'data-kind')).toBe('done');
    expect(attribute(toast, 'role')).toBe('');
    expect(attribute(toast.querySelector('.bg-toast-action'), 'href')).toBe(
      './prompts-preview.html#rank',
    );
    expect(attribute(toast.querySelector('.bg-toast-close'), 'aria-label')).toBe(
      'Dismiss this notice',
    );
    // The same id shows once.
    loaded.api.notice({ id: 'prompt-test-rank-v4', text: 'Again' });
    expect(loaded.document.querySelectorAll('.bg-toast')).toHaveLength(1);
    const timer = loaded.timers.find((entry) => entry.ms === 21000);
    expect(timer).toBeTruthy();
    flush(loaded, { timers: false });
    for (const entry of loaded.timers.filter((item) => item.ms === 60)) entry.run();
    expect(loaded.document.querySelector('.jd-status')?.textContent).toBe(
      'Rank version 4 passed its test. It tries on 20% of runs.',
    );
    timer?.run();
    expect(loaded.document.querySelector('.bg-toast')).toBe(null);
  });

  it('leaves the toast out on request, and closes on Dismiss', () => {
    const loaded = load();
    expect(loaded.api.notice({ text: 'Quiet', toast: false }).element).toBe(null);
    expect(loaded.document.querySelector('.bg-toast')).toBe(null);
    loaded.api.notice({ text: 'Your deputy needs an answer', kind: 'needs-you' });
    const toast = loaded.document.querySelector('.bg-toast');
    expect(attribute(toast, 'data-kind')).toBe('needs-you');
    toast
      ?.querySelector('.bg-toast-close')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(loaded.document.querySelector('.bg-toast')).toBe(null);
  });
});

// ------------------------------------------------------------------ round 6 acceptance (UAT-A)

describe('app-components · round 6 acceptance fixes (UAT-A)', () => {
  const options = [
    { value: 'google', label: 'Google', count: 3 },
    { value: 'stripe', label: 'Stripe', count: 5 },
    { value: 'acme', label: 'Acme', count: 1 },
    { value: 'northwind', label: 'Northwind Traders', count: 2 },
    { value: 'contoso', label: 'Contoso', count: 2 },
  ];
  const build = (body: FakeElement): void => body.append(h('div', { id: 'host' }));

  it('A-1: keeps focus on its box when the page draws again while it is open, and Escape still closes it', () => {
    const loaded = load({ build });
    const filter = loaded.api.multiSelect(loaded.document.querySelector('#host'), {
      label: 'Sources',
      options,
      selected: ['google'],
    });
    filter?.open();
    const boxes = loaded.document.querySelectorAll('.multi-select-option input');
    const stripe = boxes.find((box) => attribute(box, 'value') === 'stripe') as FakeElement;
    stripe.focus();
    // A store tick: the same options with new counts, and the same selection.
    filter?.setOptions(options.map((option) => ({ ...option, count: option.count + 1 })));
    filter?.set(['google']);
    expect(loaded.document.querySelectorAll('.multi-select-option input')).toEqual(boxes);
    expect(loaded.document.activeElement).toBe(stripe);
    expect(
      loaded.document
        .querySelectorAll('.multi-select-option-count')
        .map((count) => count.textContent),
    ).toContain('6');
    // A tick that adds an option draws the list again: focus returns to the same value's box.
    filter?.setOptions([...options, { value: 'fabrikam', label: 'Fabrikam', count: 9 }]);
    expect(attribute(loaded.document.activeElement, 'value')).toBe('stripe');
    expect(filter?.isOpen).toBe(true);
    loaded.document.activeElement?.dispatchEvent(
      new FakeEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    expect(filter?.isOpen).toBe(false);
    expect(loaded.document.activeElement).toBe(
      loaded.document.querySelector('.multi-select-trigger'),
    );
  });

  it('A-1: keeps focus on a chip when a tick draws the chips again', () => {
    const loaded = load({ build });
    const filter = loaded.api.multiSelect(loaded.document.querySelector('#host'), {
      label: 'Sources',
      options,
      selected: ['google', 'stripe'],
    });
    const chip = loaded.document.querySelector('.multi-select-chip') as FakeElement;
    chip.focus();
    const value = attribute(chip, 'data-value');
    filter?.setOptions(options.map((option) => ({ ...option, label: `${option.label} jobs` })));
    expect(attribute(loaded.document.activeElement, 'data-value')).toBe(value);
  });

  it('A-6: Escape and Done return focus to "+N more" when it opened the popover', () => {
    const loaded = load({ build });
    const filter = loaded.api.multiSelect(loaded.document.querySelector('#host'), {
      label: 'Sources',
      options,
      selected: ['google', 'stripe', 'acme', 'northwind', 'contoso'],
    });
    const more = () => loaded.document.querySelector('.multi-select-more') as FakeElement;
    more().dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(filter?.isOpen).toBe(true);
    loaded.document
      .querySelector('.multi-select input[type="search"]')
      ?.dispatchEvent(new FakeEvent('keydown', { bubbles: true, key: 'Escape' }));
    expect(loaded.document.activeElement).toBe(more());
    more().dispatchEvent(new FakeEvent('click', { bubbles: true }));
    loaded.document
      .querySelector('.multi-select-done')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(loaded.document.activeElement).toBe(more());
    // Opened from the button, it returns to the button.
    loaded.document
      .querySelector('.multi-select-trigger')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    loaded.document
      .querySelector('.multi-select-done')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(loaded.document.activeElement).toBe(
      loaded.document.querySelector('.multi-select-trigger'),
    );
  });

  it('A-2: in forced colours every stacked part tone takes a system colour, after its own tone', () => {
    const forced = (selector: string, property: string): string | undefined =>
      declared(componentRules, selector, property, isForced);
    expect(forced('.bar-chart-part[data-tone="green"]', 'background')).toBe('Highlight');
    expect(forced('.bar-chart-part[data-tone="blue"]', 'background')).toBe('LinkText');
    expect(forced('.bar-chart-part[data-tone="quiet"]', 'background')).toBe('GrayText');
    expect(forced('.bar-chart-part[data-tone="ink"]', 'background')).toBe('CanvasText');
    expect(forced('.bar-chart-part[data-tone="other"]', 'background')).toContain(
      'repeating-linear-gradient(45deg, CanvasText',
    );
    const group = componentRules.find(
      (rule) =>
        isForced(rule) &&
        rule.selectors.some((selector) => selector.startsWith('.bar-chart-part:is(')),
    );
    expect(group?.selectors[0]).toContain('[data-tone="wine"]');
  });
});

// ------------------------------------------------------------------ round 6 part 2

describe('app-components.js · the score trend (round 6 part 2, N1)', () => {
  const build = (body: FakeElement): void => body.append(h('div', { id: 'host' }));
  const points = [
    { id: 'v1', label: 'Version 1', short: 'v1', score: 88 },
    { id: 'v2', label: 'Version 2', short: 'v2', score: 90, trial: true },
    { id: 'v3', label: 'Version 3', short: 'v3', score: 75 },
  ];

  it('draws a point a version, the minimum as a dashed rule, and tells passed from failed by shape and words', () => {
    const loaded = load({ build });
    const result = loaded.api.scoreTrend(loaded.document.querySelector('#host'), {
      title: 'Read job listings',
      points,
      minimum: 80,
    });
    // A score under the minimum keeps its value under its point, so the scale leaves room below
    // (UAT-RM RM-1).
    expect(result?.lo).toBe(60);
    const figure = loaded.document.querySelector('figure.score-trend');
    expect(attribute(figure, 'aria-labelledby')).toBe(
      attribute(loaded.document.querySelector('.score-trend-title'), 'id'),
    );
    expect(attribute(loaded.document.querySelector('.score-trend-plot'), 'aria-hidden')).toBe(
      'true',
    );
    const marks = loaded.document.querySelectorAll('.score-trend-point');
    // A score under the minimum did not pass, whatever the page said.
    expect(marks.map((mark) => attribute(mark, 'data-result'))).toEqual([
      'passed',
      'passed',
      'failed',
    ]);
    expect(marks[1]?.hasAttribute('data-trial')).toBe(true);
    expect(attribute(marks[2], 'data-tip')).toBe('Did not pass: below your 80% minimum.');
    // Round 6 part 3: each score reads as the store's figure does ("88%"), so a page that keys
    // it (data-metric) shows the store's own text.
    expect(
      loaded.document.querySelectorAll('.score-trend-value').map((value) => value.textContent),
    ).toEqual(['88%', '90%', '75%']);
    expect(
      loaded.document
        .querySelectorAll('.score-trend-value')
        .map((value) => value.hasAttribute('data-below')),
    ).toEqual([false, false, true]);
    expect(loaded.document.querySelector('.score-trend-min-label')?.textContent).toBe(
      'Minimum 80%',
    );
    expect(
      attribute(loaded.document.querySelector('.score-trend-path'), 'points').split(' '),
    ).toHaveLength(3);
    // The key names every shape shown, in words.
    expect(
      loaded.document.querySelectorAll('.score-trend-key-item').map((item) => item.textContent),
    ).toEqual(['Passed', 'Did not pass', 'On trial', 'Minimum 80%']);
    // Show the numbers: one row a version, with its score and its result.
    const rows = loaded.document.querySelectorAll('.score-trend-data tbody tr');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Version 188%Passed',
      'Version 2On trial90%Passed',
      'Version 375%Did not pass',
    ]);
  });

  it('takes the large form, says when nothing was tested, and draws the same data once', () => {
    const loaded = load({ build });
    const api = loaded.api;
    const host = loaded.document.querySelector('#host');
    const first = api.scoreTrend(host, { points, minimum: 80, size: 'large', caption: false });
    expect(first?.chart.classList.contains('is-large')).toBe(true);
    expect(loaded.document.querySelector('.score-trend-title')).toBe(null);
    expect(
      api.scoreTrend(host, { points, minimum: 80, size: 'large', caption: false })?.chart,
    ).toBe(first?.chart);
    const empty = load({ build });
    empty.api.scoreTrend(empty.document.querySelector('#host'), {
      points: [],
      empty: 'Not tested yet.',
    });
    expect(empty.document.querySelector('.score-trend-empty')?.textContent).toBe('Not tested yet.');
    expect(empty.document.querySelector('.score-trend-data')).toBe(null);
  });
});

describe('app-components · Show the numbers inside a chart (round 6 part 2, N2)', () => {
  it('keeps a chart table a compact table: its own container, never the list tables’ stacked rows', () => {
    expect(declared(componentRules, '.bar-chart-data > .data-table-wrap', 'container')).toBe(
      'chart-table / inline-size',
    );
    expect(declared(componentRules, '.bar-chart-data .data-table tbody th', 'text-transform')).toBe(
      'none',
    );
    expect(declared(componentRules, '.bar-chart-data .data-table tbody th', 'position')).toBe(
      'sticky',
    );
    expect(declared(componentRules, '.bar-chart-data .data-table a', 'min-height')).toBe('44px');
    // The words underline on hover, never the chevron (UAT-RM RM-9).
    expect(
      declared(
        componentRules,
        '.bar-chart-data > summary:hover .bar-chart-data-label',
        'text-decoration',
      ),
    ).toBe('underline');
    // A table wider than its card says so (UAT-RM RM-8); its Total scrolls with its row, so it
    // never covers the column under it (T7-R1 replaces RM-8's pinned Total).
    expect(
      declared(componentRules, '.bar-chart-data .data-table .is-total', 'position'),
    ).toBeUndefined();
    expect(
      declared(componentRules, '.bar-chart-data[data-scrolls] > .data-table-hint', 'display'),
    ).toBe('block');
    // A narrow card leaves its Total unpinned, so the last day is never under it (T5-6).
    expect(
      declared(componentRules, '.bar-chart-data .data-table .is-total', 'position', (rule) =>
        rule.media.some((query) => /chart-table \(max-width: 419px\)/.test(query)),
      ),
    ).toBe('static');
    // ...and its pinned row names wrap, so every other column can be read by scrolling (T5-R1).
    for (const property of ['white-space', 'min-width']) {
      expect(
        declared(componentRules, '.bar-chart-data .data-table tbody th', property, (rule) =>
          rule.media.some((query) => /chart-table \(max-width: 419px\)/.test(query)),
        ),
        property,
      ).toBe(property === 'white-space' ? 'normal' : '6em');
    }
    // A drawer's header scrolls with its content while you type on a short screen (T5-5).
    for (const selector of [
      '.drawer:has(textarea:focus) .drawer-header',
      '.drawer:has(select:focus) .drawer-header',
    ]) {
      expect(
        declared(componentRules, selector, 'position', (rule) =>
          rule.media.some((query) => /max-height: 640px/.test(query)),
        ),
        selector,
      ).toBe('static');
    }
    // One shade a row (T1-18): a hovered row's sticky name and total take its shade, over the
    // wrap's paper so the cells that scroll under them never show through.
    for (const selector of [
      '.bar-chart-data .data-table tbody tr:hover > th',
      '.bar-chart-data .data-table tbody tr.is-hover > th',
      '.bar-chart-data .data-table tbody tr:hover > .is-total',
      '.bar-chart-data .data-table tbody tr.is-hover > .is-total',
    ]) {
      expect(declared(componentRules, selector, 'background'), selector).toBe(
        'linear-gradient(var(--surface-strong), var(--surface-strong)), var(--paper)',
      );
    }
    expect(declared(componentRules, '.data-table tbody tr:hover > td', 'background')).toBe(
      'var(--surface-strong)',
    );
  });

  it('names a background notice once, with one full stop (UAT-D D-8)', () => {
    const loaded = load();
    loaded.api.notice({
      text: 'Version 3 did not pass, so version 2 stays in use.',
      kind: 'stopped',
    });
    expect(loaded.document.querySelector('.bg-toast-open .sr-only')?.textContent).toBe(
      ': Version 3 did not pass, so version 2 stays in use. Show the notice',
    );
    expect(loaded.document.querySelector('.bg-toast-open')?.textContent).toMatch(/^A job stopped:/);
  });

  it('folds into the page’s own words where it gives them (AP-8, T6b-3)', () => {
    const loaded = load();
    loaded.api.notice({ text: 'Signed. Your deputy carries on.', kind: 'done', pill: 'Signed' });
    expect(loaded.document.querySelector('.bg-toast-open')?.textContent).toBe(
      'Signed: Signed. Your deputy carries on. Show the notice',
    );
  });
});

// ------------------------------------------------------------------ round 6 acceptance (UAT-M)

describe('app-components · round 6 acceptance fixes (UAT-M)', () => {
  const options = [
    { value: 'google', label: 'Google', count: 3 },
    { value: 'stripe', label: 'Stripe', count: 5 },
  ];

  it('M-1: a press inside the filter never closes it, even when a card around it takes focus', () => {
    const loaded = load({
      build: (body) =>
        body.append(
          h('aside', { id: 'card', tabindex: '-1' }, h('div', { id: 'host' })),
          h('a', { id: 'away', href: '#x' }, 'Away'),
        ),
    });
    const filter = loaded.api.multiSelect(loaded.document.querySelector('#host'), {
      label: 'Sources',
      options,
    });
    filter?.open();
    const input = loaded.document.querySelector(
      '.multi-select input[type="search"]',
    ) as FakeElement;
    const label = loaded.document.querySelector('.multi-select-option') as FakeElement;
    const card = loaded.document.querySelector('#card') as FakeElement;
    // The press: the card takes focus on pointerdown, before the click reaches the box.
    label.dispatchEvent(new FakeEvent('pointerdown', { bubbles: true }));
    input.dispatchEvent(new FakeEvent('focusout', { bubbles: true, relatedTarget: card }));
    expect(filter?.isOpen).toBe(true);
    // Focus going to an ancestor without a press is not leaving either.
    loaded.document.dispatchEvent(new FakeEvent('pointerup', { bubbles: true }));
    flush(loaded);
    input.dispatchEvent(new FakeEvent('focusout', { bubbles: true, relatedTarget: card }));
    expect(filter?.isOpen).toBe(true);
    // Focus leaving for something outside the filter closes it.
    const away = loaded.document.querySelector('#away') as FakeElement;
    input.dispatchEvent(new FakeEvent('focusout', { bubbles: true, relatedTarget: away }));
    expect(filter?.isOpen).toBe(false);
  });

  const day = (date: string, groups: Array<Record<string, unknown>>) => ({
    date,
    label: date,
    groups,
  });
  const task = (label: string, tokens: number) => ({
    label,
    short: label,
    groups: [{ id: 'gpt-5-mini', label: 'gpt-5-mini', tokens }],
  });

  it('M-10: heads the table Task for rows of tasks, Day for days, or the page’s own word', () => {
    const loaded = load({
      build: (body) =>
        body.append(h('div', { id: 'a' }), h('div', { id: 'b' }), h('div', { id: 'c' })),
    });
    loaded.api.usageChart(loaded.document.querySelector('#a'), {
      series: [task('Searches', 7180), task('Tailored résumés', 27180)],
    });
    loaded.api.usageChart(loaded.document.querySelector('#b'), {
      series: [day('2026-10-01', [{ id: 'm', label: 'Model', tokens: 10 }])],
    });
    loaded.api.usageChart(loaded.document.querySelector('#c'), {
      series: [task('Searches', 7180)],
      rowLabel: 'Kind of work',
    });
    const heads = ['#a', '#b', '#c'].map(
      (id) => loaded.document.querySelector(`${id} .usage-chart-data thead th`)?.textContent,
    );
    expect(heads).toEqual(['Task', 'Day', 'Kind of work']);
    // The names under the bars wrap between their words.
    expect(
      loaded.document
        .querySelectorAll('#a .usage-chart-label')
        .every((label) => label.hasAttribute('data-words')),
    ).toBe(true);
    expect(declared(componentRules, '.usage-chart-label[data-words]', 'white-space')).toBe(
      'normal',
    );
  });

  it('M-16: names a fallback mark’s days with their unit, in words you can see', () => {
    const loaded = load({ build: (body) => body.append(h('div', { id: 'a' })) });
    loaded.api.usageChart(loaded.document.querySelector('#a'), {
      series: [
        { ...day('2026-10-01', [{ id: 'm', label: 'Model', tokens: 10 }]), fallback: true },
        { ...day('2026-10-02', [{ id: 'm', label: 'Model', tokens: 10 }]), fallback: true },
      ],
    });
    expect(
      loaded.document.querySelector('.usage-chart-mark-key .chart-key-count')?.textContent,
    ).toBe('2 days');
  });

  it('M-19: on a phone, the deputy’s chip carries a notice and no toast floats over the page', () => {
    const calls: unknown[] = [];
    const loaded = load({
      media: ['(max-width: 720px)', '(max-width: 1100px)'],
      deputy: { paused: false, notice: (notice: unknown) => calls.push(notice) },
      build: (body) =>
        body.append(h('div', { class: 'app-sidebar-deputy' }, h('aside', { 'data-deputy': true }))),
    });
    loaded.api.notice({
      id: 'n1',
      text: 'Version 3 did not pass',
      kind: 'stopped',
      href: '#rank',
      record: false,
    });
    expect(loaded.document.querySelector('.bg-toast')).toBe(null);
    // Whatever record says (UAT-RM RM-3), marked as handed over by a page.
    expect(calls).toEqual([
      { id: 'n1', kind: 'stopped', text: 'Version 3 did not pass', href: '#rank', source: 'page' },
    ]);
    flush(loaded);
    expect(loaded.document.querySelector('.jd-status')?.textContent).toBe(
      'Version 3 did not pass.',
    );
    // Wider screens keep the toast.
    const wide = load({
      deputy: { paused: false, notice: (notice: unknown) => calls.push(notice) },
      build: (body) =>
        body.append(h('div', { class: 'app-sidebar-deputy' }, h('aside', { 'data-deputy': true }))),
    });
    wide.api.notice({ id: 'n2', text: 'Done', kind: 'done' });
    expect(wide.document.querySelector('.bg-toast')).not.toBe(null);
  });

  it('RD-7: a notice while a modal dialog is open is said in the dialog, and its toast waits', () => {
    const loaded = load({
      build: (body) =>
        body.append(h('dialog', { id: 'panel' }, h('button', { type: 'button' }, 'Close'))),
    });
    const panel = loaded.document.querySelector('#panel') as FakeElement;
    panel.showModal();
    const shown = loaded.api.notice({ id: 'n1', text: 'Applied', detail: 'Sample: nothing sent' });
    // Nothing under the backdrop; the words are said where a screen reader can reach them.
    expect(shown.element).toBe(null);
    expect(loaded.document.querySelector('.bg-toast')).toBe(null);
    flush(loaded);
    expect(panel.querySelector('.jd-status')?.textContent).toBe('Applied. Sample: nothing sent.');
    // The toast shows once the dialog closes, and is not said twice.
    panel.close();
    flush(loaded, { timers: false });
    expect(loaded.document.querySelector('.bg-toast .bg-toast-title')?.textContent).toBe('Applied');
    expect(
      loaded.document.body.children.some(
        (child) => child.classList.contains('jd-status') && child.textContent,
      ),
    ).toBe(false);
    // Closed while the dialog is open, it never shows.
    loaded.api.notice.close();
    panel.showModal();
    loaded.api.notice({ id: 'n2', text: 'Stopped', kind: 'stopped' }).close();
    panel.close();
    flush(loaded, { timers: false });
    expect(loaded.document.querySelector('.bg-toast')).toBe(null);
  });
});

describe('app-components.js · boot without flicker (round 7, R10-1)', () => {
  interface BootApi {
    boot: {
      ready: () => boolean;
      whenReady: (run: () => void) => void;
      split: (steps: Array<() => void>, options?: { budget?: number }) => Promise<void>;
      chunks: (
        items: unknown[],
        render: (item: unknown, index: number) => void,
        options?: { first?: number; budget?: number },
      ) => Promise<void>;
      yield: () => Promise<void>;
      readonly state: string;
    };
    skeleton: {
      show: (
        host: FakeElement,
        options?: Record<string, unknown>,
      ) => { block: FakeElement; hide: () => boolean } | null;
      hide: (host: FakeElement) => boolean;
    };
  }
  const bootOf = (loaded: Loaded): BootApi => loaded.api as unknown as BootApi;
  const held = (body: FakeElement): void => {
    body.append(
      h('main', {}, h('section', { id: 'board', 'data-skeleton': 'rows' }, h('p', {}, 'Seed'))),
    );
  };

  it('is ready at once on a page with nothing to hold, with no failsafe waiting', () => {
    const loaded = load();
    expect(bootOf(loaded).boot.state).toBe('ready');
    expect(attribute(loaded.document.documentElement, 'data-boot')).toBe('ready');
    expect(loaded.timers.filter((timer) => timer.ms === 2500)).toHaveLength(0);
  });

  it('holds every data-skeleton region busy until the page says ready, then reveals them at once', () => {
    const loaded = load({ build: held });
    const { boot } = bootOf(loaded);
    const region = loaded.document.querySelector('#board');
    expect(boot.state).toBe('hold');
    expect(attribute(loaded.document.documentElement, 'data-boot')).toBe('hold');
    expect(attribute(region, 'aria-busy')).toBe('true');
    const events: unknown[] = [];
    loaded.document.addEventListener('jobdeputy:boot', (event) => events.push(event.detail));
    const after: string[] = [];
    boot.whenReady(() => after.push('ran'));
    expect(after).toEqual([]);
    expect(boot.ready()).toBe(true);
    expect(boot.state).toBe('ready');
    expect(attribute(loaded.document.documentElement, 'data-boot')).toBe('ready');
    expect(region?.hasAttribute('aria-busy')).toBe(false);
    expect(after).toEqual(['ran']);
    expect(events).toHaveLength(1);
    expect((events[0] as { failsafe: boolean }).failsafe).toBe(false);
    // Twice is harmless; whenReady after the reveal runs at once.
    expect(boot.ready()).toBe(false);
    boot.whenReady(() => after.push('again'));
    expect(after).toEqual(['ran', 'again']);
    expect(events).toHaveLength(1);
  });

  it('reveals a page that never says ready after 2.5s, and says so in the event', () => {
    const loaded = load({ build: held });
    const events: Array<{ failsafe: boolean }> = [];
    loaded.document.addEventListener('jobdeputy:boot', (event) =>
      events.push(event.detail as { failsafe: boolean }),
    );
    const failsafe = loaded.timers.find((timer) => timer.ms === 2500);
    expect(failsafe).toBeDefined();
    failsafe?.run();
    expect(bootOf(loaded).boot.state).toBe('ready');
    expect(events).toEqual([expect.objectContaining({ failsafe: true })]);
  });

  it('keeps an aria-busy the page set itself', () => {
    const loaded = load({
      build: (body) =>
        body.append(h('section', { id: 'own', 'data-skeleton': '', 'aria-busy': 'false' })),
    });
    bootOf(loaded).boot.ready();
    expect(attribute(loaded.document.querySelector('#own'), 'aria-busy')).toBe('false');
  });

  it('has the deputy gather your numbers while a hold lasts past 400ms, and lets go at the reveal', () => {
    const calls: Array<[string, ...unknown[]]> = [];
    const deputy: Record<string, unknown> = {
      held: null,
      hold: (state: string, options: unknown) => {
        calls.push(['hold', state, options]);
        deputy.held = state;
      },
      release: () => {
        calls.push(['release']);
        deputy.held = null;
      },
    };
    const loaded = load({ build: held, deputy });
    loaded.timers.find((timer) => timer.ms === 400)?.run();
    expect(calls).toEqual([
      ['hold', 'pending', { speech: 'Gathering your numbers.', duty: 'Gathering', working: true }],
    ]);
    bootOf(loaded).boot.ready();
    expect(calls.at(-1)).toEqual(['release']);
  });

  it('never takes the deputy from a tour or another hold', () => {
    const calls: string[] = [];
    const deputy = {
      held: 'guide',
      hold: () => calls.push('hold'),
      release: () => calls.push('release'),
    };
    const loaded = load({ build: held, deputy });
    loaded.timers.find((timer) => timer.ms === 400)?.run();
    bootOf(loaded).boot.ready();
    expect(calls).toEqual([]);
  });

  it('splits a first render: the first step at once, the rest after yields, in order', async () => {
    const loaded = load();
    const { boot } = bootOf(loaded);
    const order: string[] = [];
    const done = boot.split(
      [() => order.push('tiles'), () => order.push('charts'), () => order.push('lists')],
      {
        budget: 0,
      },
    );
    expect(order).toEqual(['tiles']);
    for (let round = 0; round < 4; round += 1) {
      for (const timer of loaded.timers.filter((item) => item.ms === 0 && !item.cleared)) {
        timer.cleared = true;
        timer.run();
      }
      await settled();
    }
    await done;
    expect(order).toEqual(['tiles', 'charts', 'lists']);
  });

  it('renders the first items of a long list at once and the rest in chunks', async () => {
    const loaded = load();
    const { boot } = bootOf(loaded);
    const drawn: number[] = [];
    const done = boot.chunks(
      Array.from({ length: 10 }, (_, index) => index),
      (item) => drawn.push(item as number),
      { first: 4, budget: 0 },
    );
    expect(drawn).toEqual([0, 1, 2, 3]);
    for (let round = 0; round < 12; round += 1) {
      for (const timer of loaded.timers.filter((item) => item.ms === 0 && !item.cleared)) {
        timer.cleared = true;
        timer.run();
      }
      await settled();
    }
    await done;
    expect(drawn).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('shows a skeleton block for a later load, busy, and takes it away again', () => {
    const loaded = load({
      build: (body) => body.append(h('div', { id: 'host' }, h('p', {}, 'Old'))),
    });
    const host = loaded.document.querySelector('#host') as FakeElement;
    const shown = bootOf(loaded).skeleton.show(host, { kind: 'rows', rows: 4, label: 'Loading' });
    expect(shown).not.toBeNull();
    expect(host.children[0]?.classList.contains('skeleton-block')).toBe(true);
    expect(attribute(host.children[0], 'data-skeleton-kind')).toBe('rows');
    expect(attribute(host.children[0], 'aria-hidden')).toBe('true');
    expect(attribute(host, 'aria-busy')).toBe('true');
    expect(host.hasAttribute('data-skeleton-shown')).toBe(true);
    expect(shown?.hide()).toBe(true);
    expect(host.querySelector('.skeleton-block')).toBeNull();
    expect(host.hasAttribute('aria-busy')).toBe(false);
    expect(host.hasAttribute('data-skeleton-shown')).toBe(false);
    expect(bootOf(loaded).skeleton.hide(host)).toBe(false);
  });

  it('styles the hold, the shimmer, its still forms, and forced colours', () => {
    const scripting = (rule: StyleRule): boolean =>
      rule.media.some((query) => /scripting: enabled/.test(query));
    expect(
      declared(
        componentRules,
        'html:not([data-boot="ready"]) [data-skeleton]',
        'visibility',
        scripting,
      ),
    ).toBe('hidden');
    expect(
      declared(
        componentRules,
        'html:not([data-boot="ready"]) [data-skeleton]',
        'min-height',
        scripting,
      ),
    ).toBe('var(--skeleton-min, 0)');
    expect(
      declared(
        componentRules,
        'html:not([data-boot="ready"]) [data-skeleton]::after',
        'visibility',
        scripting,
      ),
    ).toBe('visible');
    expect(
      declared(
        componentRules,
        'html:not([data-boot="ready"]) [data-skeleton]::after',
        'border',
        isForced,
      ),
    ).toBe('1px dashed GrayText');
    expect(declared(componentRules, '.skeleton-block::after', 'animation', isReduce)).toBe('none');
  });
});

describe('app-components.js · return to where you were (round 7, R10-3)', () => {
  interface PlaceApi {
    place: {
      remember: (run: () => unknown) => void;
      restore: (run: (extra: unknown) => void) => void;
      href: (target: string) => string;
      save: () => Record<string, unknown> | null;
      readonly back: { href: string; name: string } | null;
      names: Record<string, string>;
    };
  }
  const placeOf = (loaded: Loaded): PlaceApi['place'] => (loaded.api as unknown as PlaceApi).place;
  const fakeSession = () => {
    const values = new Map<string, string>();
    return {
      values,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
    };
  };
  const intro = (body: FakeElement): void => {
    body.append(
      h(
        'main',
        {},
        h(
          'section',
          { class: 'page-intro', 'data-page-back': '' },
          h(
            'div',
            { class: 'page-intro-copy' },
            h('p', { class: 'eyebrow' }, 'Settings'),
            h('h1', {}, 'Prompts.'),
          ),
        ),
      ),
    );
  };
  const at = (loaded: Loaded, path: string): void => {
    (loaded.window.location as { pathname: string }).pathname = `/brand/${path}`;
  };

  it('brings the focus ring back with focus when Back was pressed from the keyboard (T4-21, T4-22)', () => {
    // The press's kind travels with the return mark; restoring uses it for the ring.
    expect(script).toContain(
      'JSON.stringify({ file: target.file, at: Date.now(), keyboard: inputModality.keyboard })',
    );
    expect(script).toContain('focusWithRing(target, Boolean(marker.keyboard));');
    expect(script).toContain('target.focus?.({ preventScroll: true, focusVisible: ring });');
    const chrome = readFileSync(resolve(brandDirectory, 'app-chrome.css'), 'utf8').replace(
      /\s+/g,
      ' ',
    );
    // One green ring for what is focused for you, never the browser's blue one.
    expect(chrome).toContain('main [tabindex="-1"]:focus { outline: none; }');
    expect(chrome).toContain(
      'main [tabindex="-1"]:focus-visible, [data-focus-ring]:focus { outline: 2px solid var(--green); outline-offset: 3px; }',
    );
  });

  it('builds a link to a home with return= this page and its state, never chaining returns', () => {
    const loaded = load({ search: '?page=2&return=.%2Fhome-preview.html' });
    at(loaded, 'searches-preview.html');
    expect(placeOf(loaded).href('./prompts-preview.html?prompt=rank')).toBe(
      './prompts-preview.html?prompt=rank&return=.%2Fsearches-preview.html%3Fpage%3D2',
    );
    expect(placeOf(loaded).href('./usage-preview.html#keys')).toBe(
      './usage-preview.html?return=.%2Fsearches-preview.html%3Fpage%3D2#keys',
    );
  });

  it('puts Back to <page> at the start of the home’s eyebrow line, from a safe return= only', () => {
    const loaded = load({
      build: intro,
      search: '?prompt=rank&return=.%2Fsearches-preview.html%3Fpage%3D2%23sources',
    });
    const eyebrow = loaded.document.querySelector('.eyebrow');
    const link = eyebrow?.children[0];
    expect(link?.classList.contains('page-back')).toBe(true);
    expect(attribute(link, 'href')).toBe('./searches-preview.html?page=2#sources');
    expect(link?.textContent).toBe('Back to Searches');
    expect(placeOf(loaded).back).toEqual({
      href: './searches-preview.html?page=2#sources',
      name: 'Searches',
    });
    for (const unsafe of [
      'https://evil.example.com/searches-preview.html',
      '//evil.example.com',
      'javascript:alert(1)',
      './unknown-preview.html',
      '../other/searches-preview.html',
      './components-preview.html',
    ]) {
      const other = load({ build: intro, search: `?return=${encodeURIComponent(unsafe)}` });
      expect(other.document.querySelector('.page-back'), unsafe).toBeNull();
      expect(placeOf(other).back, unsafe).toBeNull();
    }
    // Only a home that asks for it (data-page-back) shows the link.
    const plain = load({
      build: (body) =>
        body.append(
          h(
            'main',
            {},
            h('section', { class: 'page-intro' }, h('p', { class: 'eyebrow' }, 'Settings')),
          ),
        ),
      search: '?return=.%2Fsearches-preview.html',
    });
    expect(plain.document.querySelector('.page-back')).toBeNull();
  });

  it('saves your place when you press a link to a home, and restores it on the way back', () => {
    const loaded = load({
      build: (body) =>
        body.append(
          h(
            'main',
            {},
            h('h1', {}, 'Searches.'),
            h('details', { id: 'keep-watch', open: true }, h('summary', {}, 'Keep watch')),
            h(
              'a',
              {
                href: './prompts-preview.html?prompt=read',
                'data-return-link': '',
                id: 'see-read',
              },
              'Open in Prompts',
            ),
          ),
        ),
      search: '?page=2',
    });
    at(loaded, 'searches-preview.html');
    const session = fakeSession();
    loaded.window.sessionStorage = session;
    loaded.window.scrollY = 640;
    placeOf(loaded).remember(() => ({ chosen: 'r9' }));
    const link = loaded.document.querySelector('#see-read') as FakeElement;
    link.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(attribute(link, 'href')).toBe(
      './prompts-preview.html?prompt=read&return=.%2Fsearches-preview.html%3Fpage%3D2',
    );
    const saved = JSON.parse(session.values.get('jobdeputy.place.searches-preview.html') ?? '{}');
    expect(saved).toMatchObject({
      address: './searches-preview.html?page=2',
      scroll: 640,
      open: ['keep-watch'],
      extra: { chosen: 'r9' },
    });

    // Back on Searches through the Back link: the page's own restore, then the scroll.
    const back = load({
      build: (body) => body.append(h('main', {}, h('h1', {}, 'Searches.'))),
      search: '?page=2',
    });
    at(back, 'searches-preview.html');
    back.window.sessionStorage = session;
    session.setItem(
      'jobdeputy.place.returning',
      JSON.stringify({ file: 'searches-preview.html', at: Date.now() }),
    );
    const restored: unknown[] = [];
    placeOf(back).restore((extra) => restored.push(extra));
    for (let round = 0; round < 3; round += 1) for (const frame of back.frames.splice(0)) frame();
    expect(restored).toEqual([{ chosen: 'r9' }]);
    expect(back.scrolls.at(-1)).toEqual({ top: 640, behavior: 'instant' });
    expect(session.values.has('jobdeputy.place.returning')).toBe(false);
  });

  it('lands on the nearest surviving control when the one you left from is gone (T4-24)', () => {
    const list = (keys: string[]) =>
      h(
        'main',
        {},
        h('h1', {}, 'Dashboard.'),
        h(
          'section',
          { id: 'todo' },
          h('h2', { id: 'todo-title' }, 'To-do'),
          h(
            'ul',
            {},
            ...keys.map((key) =>
              h('li', {}, h('a', { href: `./x.html#${key}`, 'data-focus-key': key }, key)),
            ),
          ),
        ),
      );
    const loaded = load({ build: (body) => body.append(list(['sign', 'approve', 'fix'])) });
    at(loaded, 'home-preview.html');
    const session = fakeSession();
    loaded.window.sessionStorage = session;
    (loaded.document.querySelector('[data-focus-key="approve"]') as FakeElement).focus();
    const saved = placeOf(loaded).save() as { focus: string; near: string[]; heading: string };
    expect(saved.focus).toBe('key:approve');
    // Nearest first: the next item, then the one before; the region's heading last.
    expect(saved.near.slice(0, 2)).toEqual(['key:fix', 'key:sign']);
    expect(saved.heading).toBe('id:todo-title');

    // Back after signing: "approve" is gone, so focus goes to its neighbour, with its ring.
    const back = load({ build: (body) => body.append(list(['sign', 'fix'])) });
    at(back, 'home-preview.html');
    back.window.sessionStorage = session;
    session.setItem(
      'jobdeputy.place.returning',
      JSON.stringify({ file: 'home-preview.html', at: Date.now(), keyboard: true }),
    );
    session.values.set(
      'jobdeputy.place.home-preview.html',
      JSON.stringify({ ...saved, near: ['key:approve-gone', ...saved.near] }),
    );
    placeOf(back).restore(() => {});
    for (let round = 0; round < 3; round += 1) for (const frame of back.frames.splice(0)) frame();
    const now = back.document.activeElement as FakeElement;
    expect(attribute(now, 'data-focus-key')).toBe('fix');
    // Its ring shows: the browser's :focus-visible here, else data-focus-ring.
    expect(now.matches(':focus-visible') || now.hasAttribute('data-focus-ring')).toBe(true);
  });

  it('restores nothing on a plain visit', () => {
    const loaded = load({ build: (body) => body.append(h('main', {}, h('h1', {}, 'Searches.'))) });
    at(loaded, 'searches-preview.html');
    const session = fakeSession();
    loaded.window.sessionStorage = session;
    session.setItem(
      'jobdeputy.place.searches-preview.html',
      JSON.stringify({ at: Date.now(), scroll: 900, extra: { chosen: 'x' } }),
    );
    const restored: unknown[] = [];
    placeOf(loaded).restore((extra) => restored.push(extra));
    for (let round = 0; round < 3; round += 1) for (const frame of loaded.frames.splice(0)) frame();
    expect(restored).toEqual([]);
    expect(loaded.scrolls).toEqual([]);
  });

  it('styles Back without moving the line: a 44px target over the eyebrow’s own height', () => {
    expect(declared(chromeRules, '.page-back', 'min-height')).toBe('44px');
    expect(declared(chromeRules, '.page-back', 'margin-block')).toBe('-15px');
    expect(declared(chromeRules, '.page-back', 'text-transform')).toBe('none');
    expect(declared(chromeRules, '.page-back:focus-visible', 'outline')).toBe(
      '2px solid var(--green)',
    );
  });
});

describe('app-components.js · lists keep your place (round 7, R10-6)', () => {
  const listed = (options: Record<string, unknown>, { search = '' } = {}) => {
    const loaded = load({
      search,
      build: (body) =>
        body.append(
          h(
            'section',
            { id: 'list' },
            h('h2', { id: 'list-heading' }, 'Your roles'),
            h('div', { id: 'top' }),
            h('ul', { id: 'rows' }),
            h('div', { id: 'bottom' }),
          ),
        ),
    });
    const $ = (selector: string) => loaded.document.querySelector(selector) as FakeElement;
    const pager = loaded.api.pagination($('#bottom'), {
      top: $('#top'),
      list: $('#list'),
      heading: $('#list-heading'),
      ...options,
    }) as unknown as {
      render: (next?: Record<string, unknown>) => unknown;
      page: number;
      size: number;
    };
    return { loaded, $, pager };
  };

  it('says the range in words at the top and the bottom, with Per page at the bottom', () => {
    const { $ } = listed({
      total: 40,
      pageSize: 12,
      page: 2,
      noun: ['role', 'roles'],
      sizes: [12, 24, 48],
      onChange: () => {},
    });
    expect($('#top nav.pagination')?.classList.contains('is-top')).toBe(true);
    expect(attribute($('#top nav'), 'aria-label')).toBe('Pages, at the top of the list');
    expect($('#top .pagination-range')?.textContent).toBe('13 to 24 of 40 roles');
    expect($('#bottom .pagination-range')?.textContent).toBe('13 to 24 of 40 roles');
    expect($('#top .pagination-numbers')).toBeNull();
    expect($('#bottom .pagination-numbers')).not.toBeNull();
    const select = $('#bottom .pagination-size-select');
    expect($('#bottom .pagination-size-label')?.textContent).toBe('Per page');
    expect(attribute($('#bottom .pagination-size-label'), 'for')).toBe(attribute(select, 'id'));
    expect(select.querySelectorAll('option').map((option) => option.textContent)).toEqual([
      '12',
      '24',
      '48',
    ]);
    expect(select.querySelector('option[selected]')?.textContent).toBe('12');
  });

  it('brings the list’s top into view only when it is above the viewport, then focuses its heading', () => {
    const changes: number[] = [];
    const { loaded, $ } = listed({
      total: 40,
      pageSize: 12,
      page: 1,
      noun: ['role', 'roles'],
      onChange: (page: number) => changes.push(page),
    });
    const list = $('#list');
    list.rect = { top: -600, left: 0, width: 800, height: 1400 };
    loaded.window.scrollY = 1400;
    $('#bottom [data-page-step="next"]').dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(changes).toEqual([2]);
    expect(loaded.scrolls.at(-1)?.top).toBe(1400 - 600 - 13);
    const heading = $('#list-heading');
    expect(attribute(heading, 'tabindex')).toBe('-1');
    expect(loaded.document.activeElement).toBe(heading);
    flush(loaded);
    expect(loaded.document.querySelector('.jd-status')?.textContent).toBe(
      'Page 2 of 4. Roles 13 to 24 of 40.',
    );
    // T3-6: the heading above the list (and the top pager) comes into view with it.
    heading.rect = { top: -700, left: 0, width: 800, height: 40 };
    loaded.window.scrollY = 1400;
    $('#bottom [data-page-step="next"]').dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(loaded.scrolls.at(-1)?.top).toBe(1400 - 700 - 13);
    heading.rect = { top: 0, left: 0, width: 0, height: 0 };
    // From the top pager, with the list in view: no scroll, focus still on the heading.
    const before = loaded.scrolls.length;
    list.rect = { top: 200, left: 0, width: 800, height: 1400 };
    $('#top [data-page-step="next"]').dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(changes).toEqual([2, 3, 4]);
    expect(loaded.scrolls.length).toBe(before);
    expect($('#top .pagination-range')?.textContent).toBe('37 to 40 of 40 roles');
  });

  it('keeps the first item you were reading when the page size changes', () => {
    const sized: Array<[number, number]> = [];
    const { $, pager } = listed({
      total: 100,
      pageSize: 12,
      page: 3,
      noun: ['entry', 'entries'],
      sizes: [12, 24, 48],
      onChange: () => {},
      onSize: (size: number, page: number) => sized.push([size, page]),
    });
    const select = $('#bottom .pagination-size-select');
    select.value = '48';
    select.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    // Item 25 was first on page 3 of 12; with 48 a page it is on page 1.
    expect(sized).toEqual([[48, 1]]);
    expect(pager.size).toBe(48);
    expect($('#bottom .pagination-range')?.textContent).toBe('1 to 48 of 100 entries');
  });

  it('reads and keeps the page in the address', () => {
    const { loaded } = listed(
      { total: 10, pageSize: 12, onChange: () => {} },
      { search: '?page=3&size=24&q=x' },
    );
    const fromAddress = (
      loaded.api.pagination as unknown as {
        fromAddress: (options: Record<string, unknown>) => { page: number; size: number | null };
      }
    ).fromAddress;
    expect(fromAddress({ sizes: [12, 24, 48] })).toEqual({ page: 3, size: 24 });
    expect(fromAddress({ sizes: [12, 24, 48], sizeParam: 'per' })).toEqual({ page: 3, size: 12 });
    expect(script).toContain('window.history.replaceState(');
  });

  it('draws exactly what it drew for a page that opts into nothing', () => {
    const loaded = load({ build: (body) => body.append(h('div', { id: 'pages' })) });
    loaded.api.pagination(loaded.document.querySelector('#pages'), {
      total: 30,
      pageSize: 10,
      page: 2,
    });
    const nav = loaded.document.querySelector('nav.pagination');
    expect(nav?.querySelector('.pagination-count')?.textContent).toBe('Page 2 of 3');
    expect(nav?.querySelector('.pagination-range')).toBeNull();
    expect(nav?.querySelector('.pagination-size')).toBeNull();
    expect(loaded.document.querySelectorAll('nav.pagination')).toHaveLength(1);
  });
});

describe('app-components.js · time range, filter bar, and usage (round 7, D9, D10, R10-7)', () => {
  type Api = {
    [K in
      | 'timeRange'
      | 'filterBar'
      | 'usageChart'
      | 'permutationsTable'
      | 'allowanceRings'
      | 'runwayLine']: (...args: unknown[]) => Record<string, unknown> | null;
  };
  const apiOf = (loaded: Loaded): Api => loaded.api as unknown as Api;
  const clock = new Date('2026-10-02T14:00:00-07:00');
  const usageStore = () => {
    const store = fakeStore({});
    store.now = () => clock;
    store.usage = ({ range }: { range?: string } = {}) => ({
      range,
      from: '2026-09-25T14:00:00-07:00',
      to: '2026-10-02T14:00:00-07:00',
      step: range === '1d' ? 'hour' : 'day',
      buckets: [
        {
          at: '2026-10-01T00:00:00-07:00',
          to: '2026-10-02T00:00:00-07:00',
          label: 'Thu, Oct 1',
          parts: [{ id: 'platform', label: 'Platform credits', tokens: 10900 }],
        },
        {
          at: '2026-10-02T00:00:00-07:00',
          to: '2026-10-03T00:00:00-07:00',
          label: 'Fri, Oct 2',
          parts: [{ id: 'openai', label: 'Your OpenAI key', tokens: 49810 }],
        },
      ],
      groups: [
        { id: 'openai', label: 'Your OpenAI key', tokens: 49810 },
        { id: 'platform', label: 'Platform credits', tokens: 10900 },
      ],
      settings: [
        {
          at: '2026-10-01T09:15:00-07:00',
          kind: 'one-off',
          text: 'You ran Google Careers again on platform credits',
        },
        { at: '2026-07-04T09:00:00-07:00', kind: 'key', text: 'Outside the range' },
      ],
    });
    store.runway = () => ({
      runs: {
        left: 4,
        free: 10,
        bought: 0,
        used: 6,
        days: 1,
        usesText: 'Keep watch 2 sources nightly and Gmail’s daily scan: 3 runs a day',
      },
      tokens: {
        payer: 'own',
        payerLabel: 'Your OpenAI key',
        limit: 250000,
        used: 49810,
        left: 200190,
        period: 'month',
      },
      text: 'At your settings your 4 runs last through Sat, Oct 3; your OpenAI key’s tokens through Wed, Oct 14',
    });
    store.metricText = (key: string) =>
      ({ 'runs.left': '4', 'runs.all': '10', 'runs.used': '6', 'tokens.left': '200,190' })[key] ??
      '';
    return store;
  };

  it('resolves a range against the sample clock with the store’s step, and names it in words', () => {
    const loaded = load({
      store: usageStore(),
      build: (body) => body.append(h('div', { id: 'range' })),
    });
    const resolve = (
      loaded.api as unknown as {
        timeRange: { resolve: (value: unknown) => Record<string, string> };
      }
    ).timeRange.resolve;
    expect(resolve('1w')).toMatchObject({ preset: '1w', step: 'day', label: 'Last 7 days' });
    expect(resolve('1d')).toMatchObject({ preset: '1d', step: 'hour', label: 'Last day' });
    const custom = resolve({ from: '2026-09-20T00:00:00-07:00', to: '2026-09-27T00:00:00-07:00' });
    expect(custom.preset).toBe('custom');
    expect(custom.label).toBe('Sep 20 to Sep 27');
  });

  it('opens a popover of presets, applies a choice at once, and says the range on its button', () => {
    const changes: Array<Record<string, unknown>> = [];
    const loaded = load({
      store: usageStore(),
      build: (body) => body.append(h('div', { id: 'range' })),
    });
    const host = loaded.document.querySelector('#range') as FakeElement;
    const picker = apiOf(loaded).timeRange(host, {
      value: '1w',
      onChange: (detail: Record<string, unknown>) => changes.push(detail),
    }) as unknown as {
      open: () => void;
      readonly isOpen: boolean;
      set: (value: string) => Record<string, unknown>;
    };
    const trigger = host.querySelector('.time-range-trigger') as FakeElement;
    expect(trigger.querySelector('.time-range-value')?.textContent).toBe('Last 7 days');
    expect(attribute(trigger, 'aria-expanded')).toBe('false');
    trigger.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(attribute(trigger, 'aria-expanded')).toBe('true');
    expect(host.querySelector('.time-range-popover')?.hasAttribute('hidden')).toBe(false);
    const labels = host.querySelectorAll('.time-range-preset').map((label) => label.textContent);
    expect(labels).toEqual([
      'Last hour',
      'Last 3 hours',
      'Last 12 hours',
      'Last day',
      'Last 3 days',
      'Last 7 days',
      'Last 14 days',
      'Last 30 days',
      'This month',
      'Custom',
    ]);
    const day = host
      .querySelectorAll('input[type="radio"]')
      .find((radio) => radio.getAttribute('value') === '1d') as FakeElement;
    day.checked = true;
    day.value = '1d';
    day.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    expect(changes.at(-1)).toMatchObject({ preset: '1d', step: 'hour', label: 'Last day' });
    expect(trigger.querySelector('.time-range-value')?.textContent).toBe('Last day');
    // Escape closes it and returns focus to the button.
    host
      .querySelector('.time-range')
      ?.dispatchEvent(new FakeEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(picker.isOpen).toBe(false);
    expect(loaded.document.activeElement).toBe(trigger);
  });

  it('checks a custom range: From before To, from the first day there is data, not in the future', () => {
    const loaded = load({
      store: usageStore(),
      build: (body) => body.append(h('div', { id: 'range' })),
    });
    const host = loaded.document.querySelector('#range') as FakeElement;
    apiOf(loaded).timeRange(host, { value: '1w', earliest: '2026-07-04T00:00:00-07:00' });
    const [from, to] = host.querySelectorAll('.time-range-input');
    const error = host.querySelector('.time-range-error') as FakeElement;
    (from as FakeElement).value = '2026-09-27T00:00';
    (to as FakeElement).value = '2026-09-20T00:00';
    from?.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    expect(error.textContent).toBe('Choose a To after the From.');
    expect(error.hasAttribute('hidden')).toBe(false);
    expect(attribute(from, 'aria-invalid')).toBe('true');
    (from as FakeElement).value = '2026-06-01T00:00';
    (to as FakeElement).value = '2026-06-20T00:00';
    to?.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    expect(error.textContent).toMatch(/^Choose dates from Jul 4 on\.$/);
    (from as FakeElement).value = '2026-09-20T00:00';
    (to as FakeElement).value = '2026-10-20T00:00';
    to?.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    expect(error.textContent).toBe('Choose a To that isn’t in the future.');
    expect(script).not.toMatch(/Apply<\/|'Apply'/);
  });

  it('filters live: typing after a pause, a choice at once, Clear, the result said once', () => {
    const changes: Array<Record<string, unknown>> = [];
    const loaded = load({ build: (body) => body.append(h('div', { id: 'bar' })) });
    const host = loaded.document.querySelector('#bar') as FakeElement;
    const bar = apiOf(loaded).filterBar(host, {
      label: 'Filter your activity',
      search: { label: 'Search activity' },
      facets: [
        {
          name: 'who',
          label: 'Who',
          kind: 'choice',
          primary: true,
          options: [
            { value: 'all', label: 'All' },
            { value: 'you', label: 'You', metric: 'activity.last30.you' },
            { value: 'deputy', label: 'Your deputy' },
          ],
        },
      ],
      sort: {
        label: 'Sort',
        options: [
          { value: 'new', label: 'Newest first' },
          { value: 'old', label: 'Oldest first' },
        ],
      },
      noun: ['entry', 'entries'],
      onChange: (state: Record<string, unknown>) => changes.push(state),
    }) as unknown as {
      setResult: (shown: number, total: number) => void;
      setCounts: (counts: Record<string, Record<string, number>>) => void;
      clear: () => void;
      readonly state: Record<string, unknown>;
    };
    expect(attribute(host.querySelector('.filter-bar'), 'role')).toBe('search');
    expect(host.querySelector('.filter-bar-clear')?.hasAttribute('hidden')).toBe(true);
    const input = host.querySelector('.filter-bar-input') as FakeElement;
    input.value = 'gmail';
    input.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    expect(changes).toHaveLength(0);
    loaded.timers.find((timer) => timer.ms === 250 && !timer.cleared)?.run();
    expect(changes.at(-1)).toMatchObject({ q: 'gmail', who: 'all', sort: 'new' });
    expect(host.querySelector('.filter-bar-clear')?.hasAttribute('hidden')).toBe(false);
    const you = host.querySelectorAll('input[type="radio"]')[1] as FakeElement;
    you.value = 'you';
    you.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    expect(changes.at(-1)).toMatchObject({ q: 'gmail', who: 'you' });
    bar.setResult(42, 3120);
    expect(host.querySelector('.filter-bar-result')?.textContent).toBe('42 of 3,120 entries');
    bar.setCounts({ who: { all: 3120, you: 120, deputy: 2900 } });
    expect(
      host
        .querySelectorAll('[data-facet="who"] .filter-bar-count')
        .map((count) => count.textContent),
    ).toEqual(['3,120', '120', '2,900']);
    // No Apply button: every change applies at once.
    expect(host.querySelectorAll('button').map((button) => button.textContent)).not.toContain(
      'Apply',
    );
    bar.clear();
    expect(changes.at(-1)).toMatchObject({ q: '', who: 'all' });
    expect(input.value).toBe('');
    flush(loaded);
    expect(loaded.document.querySelector('.jd-status')?.textContent).toBe('42 of 3,120 entries.');
  });

  it('keeps one compact row: menus for facets, the sort too, a Filters fold, and a quiet result', () => {
    const loaded = load({ build: (body) => body.append(h('div', { id: 'bar' })) });
    const host = loaded.document.querySelector('#bar') as FakeElement;
    const changes: Array<Record<string, unknown>> = [];
    const bar = apiOf(loaded).filterBar(host, {
      search: { label: 'Find a role' },
      facets: [
        {
          name: 'fit',
          label: 'Fit',
          kind: 'choice',
          options: [
            { value: 'all', label: 'Any fit' },
            { value: 'strong', label: 'Strong fit', count: 4 },
            { value: 'good', label: 'Good fit', count: 9 },
          ],
        },
      ],
      sort: {
        label: 'Order',
        options: [
          { value: 'best', label: 'Best fit first' },
          { value: 'new', label: 'Newest first' },
        ],
      },
      noun: ['role', 'roles'],
      onChange: (state: Record<string, unknown>) => changes.push(state),
    }) as unknown as { setResult: (shown: number | null, total?: number) => void };
    const triggers = host.querySelectorAll('.filter-menu-trigger');
    expect(triggers.map((trigger) => trigger.textContent)).toEqual([
      'FitAny fit',
      'OrderBest fit first',
    ]);
    expect(host.querySelector('.filter-bar-chip')).toBeNull();
    const fit = triggers[0] as FakeElement;
    fit.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(attribute(fit, 'aria-expanded')).toBe('true');
    const strong = host.querySelectorAll('.filter-menu-option input')[1] as FakeElement;
    strong.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    expect(changes.at(-1)).toMatchObject({ fit: 'strong', sort: 'best' });
    expect(fit.textContent).toBe('FitStrong fit');
    // The fold says how many filters are set.
    const fold = host.querySelector('.filter-bar-fold') as FakeElement;
    expect(fold.textContent).toBe('Filters · 1');
    fold.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(attribute(host.querySelector('.filter-bar'), 'data-fold')).toBe('open');
    expect(attribute(fold, 'aria-expanded')).toBe('true');
    // The result line says itself only while something narrows the list, or never with null.
    bar.setResult(4, 27);
    expect(host.querySelector('.filter-bar-result')?.textContent).toBe('4 of 27 roles');
    bar.setResult(null);
    expect(host.querySelector('.filter-bar-result')?.textContent).toBe('');
    const quiet = load({ build: (body) => body.append(h('div', { id: 'bar' })) });
    const plain = apiOf(quiet).filterBar(quiet.document.querySelector('#bar'), {
      search: { label: 'Find' },
      noun: ['role', 'roles'],
    }) as unknown as { setResult: (shown: number, total: number) => void };
    plain.setResult(27, 27);
    expect(quiet.document.querySelector('.filter-bar-result')?.textContent).toBe('');
  });

  it('drops the range’s name from view where it does not fit, never the range (T2b-2)', () => {
    // Measured in the browser (the fake DOM has no layout): the name goes to screen readers only.
    expect(script).toContain("if (tight) root.setAttribute('data-compact', '');");
    expect(script).toContain('new ResizeObserver(() => fitTrigger()).observe(host);');
    expect(
      declared(componentRules, '.time-range[data-compact] .time-range-name', 'clip-path'),
    ).toBe('inset(50%)');
    expect(declared(componentRules, '.time-range-name', 'white-space')).toBe('nowrap');
  });

  it('fits the combinations table in a tablet’s column: wrapping headers, whole models (T2b-5)', () => {
    const tablet = (rule: { media: string[] }) =>
      rule.media.some((query) => /permutations \(max-width: 799px\)/.test(query));
    expect(
      declared(
        componentRules,
        '.permutations-wrap > .data-table .data-table-sort',
        'white-space',
        tablet,
      ),
    ).toBe('normal');
    expect(
      declared(
        componentRules,
        '.permutations-wrap > .data-table .data-table-sort',
        'flex-wrap',
        tablet,
      ),
    ).toBe('wrap');
    expect(
      declared(
        componentRules,
        '.permutations-wrap > .data-table td[data-label="Model"]',
        'white-space',
        tablet,
      ),
    ).toBe('nowrap');
  });

  it('shows only the value on a compact facet’s button, its name for screen readers (SJ 8)', () => {
    const loaded = load({ build: (body) => body.append(h('div', { id: 'bar' })) });
    const host = loaded.document.querySelector('#bar') as FakeElement;
    apiOf(loaded).filterBar(host, {
      search: { label: 'Find a source' },
      facets: [
        {
          name: 'sort',
          label: 'Order',
          kind: 'choice',
          compact: true,
          options: [
            { value: 'last-run', label: 'Running first' },
            { value: 'name', label: 'By name' },
          ],
        },
      ],
      noun: ['source', 'sources'],
    });
    const name = host.querySelector('.filter-menu-trigger .filter-menu-name') as FakeElement;
    expect(name.classList.contains('sr-only')).toBe(true);
    expect(name.textContent).toBe('Order: ');
    expect(host.querySelector('.filter-menu-trigger')?.textContent).toBe('Order: Running first');
    expect(declared(componentRules, '.filter-bar-search', 'flex')).toBe('1 1 200px');
  });

  it('returns the range to the page’s default preset on Clear, never a fixed end (T3-14)', () => {
    const loaded = load({ build: (body) => body.append(h('div', { id: 'bar' })) });
    const host = loaded.document.querySelector('#bar') as FakeElement;
    const bar = apiOf(loaded).filterBar(host, {
      search: { label: 'Find a receipt' },
      range: { value: 'year', default: 'all', presets: ['30d', '90d', 'year', 'all'] },
      noun: ['receipt', 'receipts'],
    }) as unknown as { clear: () => void; readonly state: { range?: { preset?: string } } };
    expect(bar.state.range?.preset).toBe('year');
    bar.clear();
    expect(bar.state.range?.preset).toBe('all');
    expect(script).toContain(
      'const rangeDefault = () => settings.range?.default ?? settings.range?.value ?? null;',
    );
  });

  it('updates a multi facet’s options in place, never building the bar again (T3-19, T3-3)', () => {
    const loaded = load({ build: (body) => body.append(h('div', { id: 'bar' })) });
    const host = loaded.document.querySelector('#bar') as FakeElement;
    const bar = apiOf(loaded).filterBar(host, {
      search: { label: 'Find a draft' },
      facets: [
        {
          name: 'company',
          label: 'Company',
          kind: 'multi',
          options: [
            { value: 'google', label: 'Google', count: 2 },
            { value: 'stripe', label: 'Stripe', count: 1 },
          ],
        },
      ],
      noun: ['draft', 'drafts'],
    }) as unknown as {
      setOptions: (name: string, options: unknown[]) => boolean;
      state: Record<string, unknown>;
    };
    const input = host.querySelector('.filter-bar-input') as FakeElement;
    const trigger = host.querySelector('.multi-select-trigger') as FakeElement;
    input.focus();
    expect(
      bar.setOptions('company', [
        { value: 'google', label: 'Google', count: 3 },
        { value: 'stripe', label: 'Stripe', count: 1 },
        { value: 'acme', label: 'Acme', count: 1 },
      ]),
    ).toBe(true);
    // The same elements, focus where it was, and the new company is there to choose.
    expect(host.querySelector('.filter-bar-input')).toBe(input);
    expect(host.querySelector('.multi-select-trigger')).toBe(trigger);
    expect(loaded.document.activeElement).toBe(input);
    trigger.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(
      host.querySelectorAll('.multi-select-option-name').map((name) => name.textContent),
    ).toEqual(['Google', 'Acme', 'Stripe']);
    expect(bar.setOptions('nope', [])).toBe(false);
  });

  it('draws the store’s usage at its step: the buckets, the groups, a setting change marked in words', () => {
    const store = usageStore();
    const loaded = load({ store, build: (body) => body.append(h('div', { id: 'chart' })) });
    const result = apiOf(loaded).usageChart(loaded.document.querySelector('#chart'), {
      usage: (store.usage as (o: unknown) => unknown)({ range: '1w' }),
      title: 'Tokens by key',
    }) as { total: number } | null;
    expect(result?.total).toBe(60710);
    const marks = loaded.document
      .querySelectorAll('.usage-chart-mark-key')
      .map((item) => item.textContent);
    expect(marks).toEqual(['You ran Google Careers again on platform credits Oct 1']);
    // A ledger draws runs by what used them.
    const runs = load({ build: (body) => body.append(h('div', { id: 'runs' })) });
    const drawn = apiOf(runs).usageChart(runs.document.querySelector('#runs'), {
      ledger: {
        step: 'day',
        features: [
          { id: 'watch', label: 'Keep watch' },
          { id: 'gmail', label: 'Gmail scans' },
        ],
        buckets: [
          {
            at: '2026-10-02T00:00:00-07:00',
            label: 'Fri, Oct 2',
            parts: [
              { id: 'watch', label: 'Keep watch', runs: 2 },
              { id: 'gmail', label: 'Gmail scans', runs: 1 },
            ],
          },
        ],
      },
    }) as { total: number } | null;
    expect(drawn?.total).toBe(3);
  });

  it('sorts every combination by any column, with a Total row and the estimate said', () => {
    const loaded = load({ build: (body) => body.append(h('div', { id: 'table' })) });
    const rows = [
      {
        id: 'a',
        keyLabel: 'Your OpenAI key',
        modelLabel: 'gpt-5-mini',
        taskLabel: 'Tailor the résumé',
        calls: 2,
        tokens: 27180,
        cost: 11415,
        costEstimate: true,
        kept: 2,
        decided: 2,
        keptPct: 100,
      },
      {
        id: 'b',
        keyLabel: 'Platform credits',
        modelLabel: 'Ministral 3 14B',
        taskLabel: 'Read job listings',
        calls: 7,
        tokens: 6500,
        cost: 1400,
        kept: 3,
        decided: 4,
        keptPct: 75,
      },
    ];
    apiOf(loaded).permutationsTable(loaded.document.querySelector('#table'), { rows });
    const names = () =>
      loaded.document.querySelectorAll('.permutations-name').map((cell) => cell.textContent);
    expect(names()).toEqual(['Your OpenAI key', 'Platform credits']);
    expect(attribute(loaded.document.querySelector('th[aria-sort]'), 'aria-sort')).toBe(
      'descending',
    );
    loaded.document
      .querySelector('[data-sort="calls"]')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(names()).toEqual(['Platform credits', 'Your OpenAI key']);
    loaded.document
      .querySelector('[data-sort="calls"]')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(names()).toEqual(['Your OpenAI key', 'Platform credits']);
    const total = loaded.document.querySelector('.permutations-total');
    expect(total?.children.map((cell) => cell.textContent)).toEqual([
      'Total, 2 combinations',
      '9',
      '33,680',
      expect.stringMatching(/\(estimate\)$/),
      '83%',
    ]);
    expect(loaded.document.querySelector('.permutations-note')?.textContent).toMatch(/estimate/);
  });

  it('pages the combinations top and bottom, with Per page, and says an exact total (SP 14, T5-20)', () => {
    const loaded = load({ build: (body) => body.append(h('div', { id: 'table' })) });
    const rows = Array.from({ length: 30 }, (_, index) => ({
      id: `r${index}`,
      keyLabel: 'Platform credits',
      modelLabel: 'gpt-5-mini',
      taskLabel: `Task ${index}`,
      calls: 1,
      tokens: 100 + index,
      // $0.0817 a row (three significant digits under $0.10); thirty make $2.451, said in cents.
      cost: 81700,
      kept: 1,
      decided: 1,
      keptPct: 100,
    }));
    const table = apiOf(loaded).permutationsTable(loaded.document.querySelector('#table'), {
      rows,
      pageSize: 12,
      sizes: [12, 24, 48],
      top: true,
    }) as unknown as { page: number; size: number };
    const host = loaded.document.querySelector('#table') as FakeElement;
    // A compact pager over the table and the full one under it.
    expect(host.querySelector('.permutations-pages.is-top nav.pagination.is-top')).not.toBeNull();
    expect(host.querySelector('.permutations-pages.is-top .pagination-range')?.textContent).toBe(
      '1 to 12 of 30 combinations',
    );
    expect(host.querySelectorAll('.permutations-table tbody tr')).toHaveLength(12);
    host
      .querySelector('.permutations-pages.is-top [data-page-step="next"]')
      ?.dispatchEvent(new FakeEvent('click', { bubbles: true }));
    expect(table.page).toBe(2);
    expect(host.querySelector('.permutations-name')?.textContent).toBe('Platform credits');
    const select = host.querySelector('.pagination-size-select') as FakeElement;
    select.value = '48';
    select.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    expect(table.size).toBe(48);
    expect(host.querySelectorAll('.permutations-table tbody tr')).toHaveLength(30);
    expect(host.querySelector('.permutations-pages.is-top')?.hasAttribute('hidden')).toBe(true);
    // One money rule for rows and Total (T3-28): cents from $0.10, three significant digits below.
    const cost = host.querySelector('.permutations-total [data-label="Cost"]')?.textContent;
    expect(cost).toBe('$2.45');
    expect(host.querySelector('.permutations-table tbody [data-label="Cost"]')?.textContent).toBe(
      '$0.0817',
    );
  });

  it('draws the runs ring in R9-1’s words and the tokens ring for the payer, keyed, and the runway', () => {
    const store = usageStore();
    const loaded = load({
      store,
      build: (body) => body.append(h('div', { id: 'rings' }), h('div', { id: 'runway' })),
    });
    apiOf(loaded).allowanceRings(loaded.document.querySelector('#rings'), {});
    const runs = loaded.document.querySelector('[data-ring="runs"]');
    expect(runs?.querySelector('.allowance-ring-centre')?.textContent).toBe('4 of 10 left');
    expect(attribute(runs?.querySelector('[data-ring-value="left"]'), 'data-metric')).toBe(
      'runs.left',
    );
    expect(attribute(runs?.querySelector('[data-ring-value="all"]'), 'data-metric')).toBe(
      'runs.all',
    );
    const tokens = loaded.document.querySelector('[data-ring="tokens"]');
    expect(tokens?.querySelector('.allowance-ring-centre')?.textContent).toBe(
      '200,190 tokens left',
    );
    // The key's limit names its period (DB's request 13).
    expect(tokens?.querySelector('.allowance-note')?.textContent).toBe(
      'Of 250,000 a month on your OpenAI key',
    );
    expect(attribute(tokens?.querySelector('[data-ring-value="left"]'), 'data-metric')).toBe(
      'tokens.left',
    );
    // metrics: false leaves the keys off.
    const plain = load({ store, build: (body) => body.append(h('div', { id: 'rings' })) });
    apiOf(plain).allowanceRings(plain.document.querySelector('#rings'), { metrics: false });
    expect(plain.document.querySelectorAll('[data-metric]')).toHaveLength(0);
    apiOf(loaded).runwayLine(loaded.document.querySelector('#runway'), { uses: true });
    expect(loaded.document.querySelector('.runway-line')?.textContent).toBe(
      'At your settings your 4 runs last through Sat, Oct 3; your OpenAI key’s tokens through Wed, Oct 14.',
    );
    expect(loaded.document.querySelector('.runway-uses')?.textContent).toBe(
      'Keep watch 2 sources nightly and Gmail’s daily scan: 3 runs a day.',
    );
    const countless = load({ store, build: (body) => body.append(h('div', { id: 'runway' })) });
    apiOf(countless).runwayLine(countless.document.querySelector('#runway'), { counts: false });
    expect(countless.document.querySelector('.runway-line')?.textContent).toBe(
      'At your settings your runs last through Sat, Oct 3; your OpenAI key’s tokens through Wed, Oct 14.',
    );
  });

  it('saves a CSV the store made, as text/csv in UTF-8, named for its title', () => {
    const loaded = load();
    const build = (
      loaded.api as unknown as {
        download: { build: (doc: unknown, format: string) => DownloadFile };
      }
    ).download.build;
    const file = build(
      { title: 'JobDeputy activity, Fri, Oct 2', csv: 'When,Who\n2026-10-02,You' },
      'csv',
    );
    expect(file).toMatchObject({
      ok: true,
      name: 'JobDeputy activity, Fri, Oct 2.csv',
      type: 'text/csv;charset=utf-8',
    });
    expect(file.text).toBe('When,Who\n2026-10-02,You\n');
    expect(build({ title: 'Empty', csv: '  ' }, 'csv')).toEqual({ ok: false, reason: 'empty' });
  });
});
