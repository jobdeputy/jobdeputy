import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Guards for the deputy companion (brand/deputy.js, brand/deputy.css, and the cast sheet
// brand/deputy-preview.html): static checks of the drawing, the states, the reactions, the idle
// gestures, and the styles, and behaviour checks that run deputy.js against a small fake DOM with a
// controllable clock (round 3: R3-2 motion and Pause motion, R3-8 reactions, and the tour's hold and
// release). Rendered behaviour (end poses, layouts, real timing) is checked in headless Chrome
// (/tmp/jd-r3/A2/pausecheck.mjs).

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');

const script = sourceFor('deputy.js');
const css = sourceFor('deputy.css');
const castSheet = sourceFor('deputy-preview.html');
const login = sourceFor('login-preview.html');

// Every state in the round 1 brief (section 4), in its order, with round 2's fill and invite
// (section 3.8) after the last page state, round 6's test (the Prompts page) after them, and
// round 3's guide (section 3.5) last.
const briefStates = [
  'idle',
  'arrive',
  'report',
  'search',
  'filter',
  'rank',
  'choose',
  'tailor',
  'approve',
  'track',
  'watch',
  'protect-data',
  'hold-key',
  'fill',
  'invite',
  'test',
  'notice',
  'pending',
  'success',
  'error',
  'guide',
];

// The reactions in the round 3 brief (section 3.5), in its order.
const briefReactions = [
  'added',
  'dismissed',
  'saved',
  'sent',
  'copied',
  'archived',
  'deleted',
  'started',
  'found',
  'approved',
  'submitted',
  'celebrate',
  // Round 7 (G3): the signing moment.
  'signed',
  'error',
];

const canonicalTokens: Record<string, string> = {
  ink: '#1b1a18',
  'ink-soft': '#2d2b27',
  muted: '#706d66',
  quiet: '#98948b',
  paper: '#faf8f3',
  'paper-deep': '#f0ece3',
  surface: 'rgba(255, 255, 255, 0.82)',
  'surface-strong': 'rgba(255, 255, 255, 0.92)',
  'header-surface': 'rgba(250, 248, 243, 0.82)',
  line: 'rgba(27, 26, 24, 0.12)',
  'line-soft': 'rgba(27, 26, 24, 0.08)',
  'line-strong': 'rgba(27, 26, 24, 0.24)',
  green: '#2f9e77',
  'green-soft': '#ccebdc',
  'green-wash': 'rgba(204, 235, 220, 0.55)',
  'green-line': 'rgba(47, 158, 119, 0.36)',
  'green-ink': '#23795b',
  orange: '#f36b3f',
  'orange-soft': '#ffd5c6',
  'danger-ink': '#9c4028',
  blue: '#526fe5',
  'blue-soft': '#d9def8',
  'on-ink-muted': 'rgba(255, 255, 255, 0.68)',
};
const tokenNames = new Set([
  ...Object.keys(canonicalTokens),
  'shadow',
  'shadow-control',
  'ease-settle',
  'ease-spring',
  'font-display',
  'font-text',
]);

interface StateEntry {
  duty: string;
  speech: string;
  kind: 'page' | 'moment';
  motion: number;
  loop?: boolean;
  workingDuty?: string;
}

interface ReactionEntry {
  duty: string;
  speech: string;
  motion: number;
  pose?: string;
}

interface GestureSet {
  gestures: string[];
  glance: [number, number];
  turn: number;
}

// Evaluates deputy.js's pure declarations (timings, states, reactions, gestures, props, and the
// drawing) without a DOM.
const pure = runInNewContext(
  `(() => {${script.slice(
    script.indexOf('const MOTION_KEY'),
    script.indexOf('const instances = [];'),
  )}; return { timing: { REACT_MS, SETTLE_MS, GESTURE_MIN_MS, GESTURE_MAX_MS, GESTURE_FIRST_MAX_MS, QUIET_MS, PAUSED_DUTY }, states, reactions, gestures, gestureSets, motionIcons, regions, drawing, props }; })()`,
) as {
  timing: Record<string, number | string>;
  states: Record<string, StateEntry>;
  reactions: Record<string, ReactionEntry>;
  gestures: Record<string, { ms: number; body: boolean }>;
  gestureSets: Record<string, GestureSet>;
  motionIcons: Record<string, string>;
  regions: Record<string, string>;
  drawing: string;
  props: Record<string, string>;
};
// The data-deputy-state value a reaction shows.
const poseOf = (name: string): string => pure.reactions[name]?.pose ?? name;

const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;
const squash = (markup: string): string =>
  markup
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .replace(/\s*\/>/g, ' />')
    .trim();

// The balanced <g ...>...</g> element whose opening tag is `opening`, from `source`.
function group(source: string, opening: string): string {
  const start = source.indexOf(opening);
  expect(start, `${opening} must exist`).toBeGreaterThanOrEqual(0);
  const tags = /<g\b[^>]*>|<\/g>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let match = tags.exec(source); match; match = tags.exec(source)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return source.slice(start, match.index + match[0].length);
  }
  throw new Error(`${opening} is not closed`);
}

const entryDrawing = (() => {
  const start = login.indexOf('<svg\n            class="panda-art"');
  expect(start, 'the entry drawing').toBeGreaterThan(0);
  return login.slice(start, login.indexOf('</svg>', start) + 6).replaceAll('jdA-', '__NS__-');
})();

// ------------------------------------------------------------------ CSS model
interface Rule {
  selectors: string[];
  body: string;
  media: string[];
}

function rules(source: string): Rule[] {
  const found: Rule[] = [];
  const walk = (text: string, media: string[]): void => {
    let cursor = 0;
    let open = text.indexOf('{');
    while (open >= 0) {
      const prelude = (text.slice(cursor, open).split(';').pop() ?? '').trim();
      let depth = 0;
      let close = open;
      for (; close < text.length; close += 1) {
        if (text[close] === '{') depth += 1;
        else if (text[close] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const body = text.slice(open + 1, close);
      if (/^@(media|container|supports)\b/.test(prelude)) walk(body, [...media, prelude]);
      else if (!prelude.startsWith('@')) {
        found.push({
          selectors: prelude
            .split(/,(?![^(]*\))/)
            .map((part) => part.replace(/\s+/g, ' ').trim())
            .filter(Boolean),
          body,
          media,
        });
      }
      cursor = close + 1;
      open = text.indexOf('{', cursor);
    }
  };
  walk(source.replace(/\/\*[\s\S]*?\*\//g, ''), []);
  return found;
}

const declarations = (body: string): Array<{ property: string; value: string }> =>
  body
    .split(/;(?![^(]*\))/)
    .map((part) => part.trim())
    .filter((part) => part.includes(':'))
    .map((part) => {
      const colon = part.indexOf(':');
      return { property: part.slice(0, colon).trim(), value: part.slice(colon + 1).trim() };
    });

const cssRules = rules(css);
const isReduced = (rule: Rule): boolean =>
  rule.media.some((query) => /prefers-reduced-motion:\s*reduce/.test(query));

// The class names in a selector's last compound (outside :is() and :where()).
const lastClasses = (selector: string): string[] => {
  const last = selector.split(/\s+|>/).filter(Boolean).at(-1) ?? '';
  return [...last.replace(/:(?:is|where|not)\([^)]*\)/g, '').matchAll(/\.([\w-]+)/g)].map(
    (match) => match[1] ?? '',
  );
};

// The stops of one @keyframes block: each stop's percentages and its declarations.
const keyframes = (name: string): Array<{ at: number[]; body: string }> => {
  const open = css.indexOf(`@keyframes ${name} {`);
  expect(open, `@keyframes ${name}`).toBeGreaterThanOrEqual(0);
  const start = css.indexOf('{', open) + 1;
  let depth = 1;
  let end = start;
  for (; end < css.length && depth > 0; end += 1) {
    if (css[end] === '{') depth += 1;
    else if (css[end] === '}') depth -= 1;
  }
  return [...css.slice(start, end - 1).matchAll(/([^{}]+)\{([^}]*)\}/g)].map((match) => ({
    at: (match[1] ?? '').split(',').map((key) => Number.parseFloat(key.trim())),
    body: match[2] ?? '',
  }));
};
// The first percentage at which a keyframes block reaches a declaration.
const firstAt = (name: string, declaration: RegExp): number =>
  Math.min(
    ...keyframes(name)
      .filter((stop) => declaration.test(stop.body))
      .flatMap((stop) => stop.at),
  );
const ruleFor = (selector: string): Rule | undefined =>
  cssRules.find((rule) => !rule.media.length && rule.selectors.includes(selector));

// ------------------------------------------------------------------ the drawing
describe('deputy drawing', () => {
  it('copies the approved head unchanged: face, ears, patches, eyes, cheeks, nose, and mouths', () => {
    const head = (source: string): string => squash(group(source, '<g class="panda-head">'));
    expect(head(pure.drawing)).toBe(head(entryDrawing));
    for (const part of [
      'class="face-shape"',
      'class="face-shade"',
      'class="patch patch-left"',
      'class="patch patch-right"',
      'class="panda-cheeks"',
      'class="eye panda-eye eye-left"',
      'class="eye-lid"',
      'class="eye-happy"',
      'class="panda-nose"',
      'class="nose-shine"',
      'class="mouth mouth-idle"',
      'class="mouth mouth-happy"',
      'class="mouth mouth-concern"',
      'class="panda-ear ear-left"',
    ]) {
      expect(head(pure.drawing), part).toContain(part);
    }
  });

  it('keeps the viewBox, defs, shadow, torso, feet, left arm, and bamboo the same as the entry', () => {
    expect(pure.drawing).toContain('viewBox="0 0 420 420"');
    const defs = (source: string): string =>
      squash(source.slice(source.indexOf('<defs>'), source.indexOf('</defs>') + 7));
    expect(defs(pure.drawing)).toBe(defs(entryDrawing));
    const shadow = /<ellipse class="panda-shadow"[^>]*\/>/;
    expect(pure.drawing.match(shadow)?.[0]).toBe(entryDrawing.match(shadow)?.[0]);
    for (const opening of [
      '<g class="panda-torso">',
      '<g class="panda-feet">',
      '<g class="panda-arm panda-arm-left arm-left">',
      '<g class="bamboo-lean">',
    ]) {
      expect(squash(group(pure.drawing, opening)), opening).toBe(
        squash(group(entryDrawing, opening)),
      );
    }
  });

  it('keeps every right-arm shape and prop in order and adds new props only as new groups', () => {
    const children = (source: string): string[] => {
      const arm = group(source, '<g class="panda-arm panda-arm-right arm-right">');
      const inner = arm.slice(arm.indexOf('>') + 1, arm.lastIndexOf('</g>'));
      const parts: string[] = [];
      const tags = /<(\/?)(\w+)\b[^>]*?(\/?)>/g;
      let depth = 0;
      let start = 0;
      for (let match = tags.exec(inner); match; match = tags.exec(inner)) {
        if (match[1]) depth -= 1;
        else if (!match[3]) depth += 1;
        if (depth === 0) {
          parts.push(squash(inner.slice(start, match.index + match[0].length)));
          start = match.index + match[0].length;
        }
      }
      return parts;
    };
    const entry = children(entryDrawing);
    const deputy = children(pure.drawing);
    // Round 6 (R6-1): the entry's right paw holds a tool in every chapter and state, so its arm
    // carries the arm, the paw, the magnifier, pencil, and key, the ten shared tools (help card,
    // job card, report card, best card, fan, approval card, clock, hourglass, and pointer), and the
    // grip (was 6: the arm, the paw, three props, and the grip).
    expect(entry).toHaveLength(15);
    expect(deputy.filter((part) => entry.includes(part))).toEqual(entry);
    const added = deputy.filter((part) => !entry.includes(part));
    expect(added.length).toBeGreaterThanOrEqual(6);
    for (const part of added) {
      expect(part, 'a new prop is a wrapper group').toMatch(
        /^<g class="deputy-prop deputy-[\w-]+"/,
      );
    }
    // Held props sit under the paw grip, which stays the arm's last shape.
    expect(deputy.at(-1)).toBe(entry.at(-1));
  });

  it('draws the new props the brief names', () => {
    for (const prop of [
      'deputy-report',
      'deputy-best',
      'deputy-weak',
      'deputy-rank',
      'deputy-offer',
      'deputy-page',
      'deputy-approval',
      'deputy-clipboard',
      'deputy-clock',
      'deputy-shield',
      'deputy-glint',
      'deputy-form',
      'deputy-pen',
      'deputy-envelope',
      // Round 3: the reactions' props.
      'deputy-check',
      'deputy-copy',
      'deputy-archive',
      'deputy-drop',
      // Round 6 (R6-1): a tool for every state that had none (help card, job card, hourglass,
      // pointer, the tour pointer) and the Prompts page's test card. The guide's signpost is
      // retired: the guide holds the pointer.
      'deputy-help',
      'deputy-card',
      'deputy-hourglass',
      'deputy-pointer',
      'deputy-tour-pointer',
      'deputy-test',
    ]) {
      expect(pure.drawing, prop).toContain(`class="deputy-prop ${prop}"`);
    }
    expect(pure.drawing).toContain('class="deputy-region-code"');
    expect(Object.keys(pure.props).sort()).toEqual(
      ['cards', 'clipboard', 'envelope', 'form', 'key', 'magnifier', 'page', 'shield'].sort(),
    );
    // R9-6: the shield's code and protect-data's speech read the account's home Region from the
    // store (its latest signed agreement record), unless a page names the Region itself; the
    // public Help page shows no account state, so it keeps the US default.
    expect(script).toMatch(
      /element\.closest\('\[data-deputy-region\]'\)\?\.dataset\.deputyRegion \|\|\s+storeRegion\(\) \|\|\s+'US'/,
    );
    expect(script).toContain(
      "const code = typeof store?.homeRegion === 'function' ? store.homeRegion()?.code : '';",
    );
    expect(script).toContain(
      "if (document.documentElement?.dataset?.helpView === 'public') return '';",
    );
  });

  it('draws the round 2 props around the paw grip, and the form behind the panda', () => {
    const arm = group(pure.drawing, '<g class="panda-arm panda-arm-right arm-right">');
    for (const prop of ['deputy-pen', 'deputy-envelope']) {
      expect(squash(group(arm, `<g class="deputy-prop ${prop}"`)), prop).toMatch(
        new RegExp(
          `^<g class="deputy-prop ${prop}" opacity="0"><g transform="translate\\(281 326\\)">`,
        ),
      );
    }
    const scene = group(pure.drawing, '<g class="deputy-scene-props">');
    const form = group(scene, '<g class="deputy-prop deputy-form"');
    expect(arm).not.toContain('deputy-form');
    // A form card with three fields: each has a value line that draws and a tick.
    expect(form.match(/class="deputy-fill-value /g)).toHaveLength(3);
    expect(form.match(/class="deputy-fill-tick /g)).toHaveLength(3);
    for (const n of [1, 2, 3]) {
      expect(form).toMatch(
        new RegExp(`<g class="deputy-fill-value deputy-fill-value-${n}"><path [^>]*pathLength="1"`),
      );
      expect(form).toContain(`<g class="deputy-fill-tick deputy-fill-tick-${n}">`);
    }
    // The credits ticket sits between the envelope's back and its pocket, which hides it until it
    // rises. It carries the AI credits sparkle, not a figure: the bonus is credits now, no longer
    // two AI runs (round 5 acceptance, fix 15).
    const envelope = group(arm, '<g class="deputy-prop deputy-envelope"');
    const ticket = group(envelope, '<g class="deputy-ticket">');
    expect(ticket).toContain('<path class="deputy-ticket-mark" d="M45 -66.5');
    expect(ticket).not.toMatch(/<text|\+2/);
    const after = envelope.slice(envelope.indexOf(ticket) + ticket.length);
    expect(after, 'the pocket is drawn over the ticket').toMatch(/<path d="[^"]+Z" fill="#faf8f3"/);
  });

  it('draws the round 3 props around the paw grip, each with the part that moves', () => {
    const arm = group(pure.drawing, '<g class="panda-arm panda-arm-right arm-right">');
    for (const prop of [
      'deputy-check',
      'deputy-copy',
      'deputy-archive',
      'deputy-drop',
      'deputy-help',
      'deputy-card',
      'deputy-clock',
      'deputy-hourglass',
      'deputy-pointer',
      'deputy-tour-pointer',
      'deputy-test',
    ]) {
      expect(squash(group(arm, `<g class="deputy-prop ${prop}"`)), prop).toMatch(
        new RegExp(
          `^<g class="deputy-prop ${prop}" opacity="0"><g transform="translate\\(281 326\\)">`,
        ),
      );
    }
    // copied: the copy slides out from behind the first card, so it is drawn after it.
    const copy = group(arm, '<g class="deputy-prop deputy-copy"');
    expect(copy.indexOf('<g class="deputy-copy-front">')).toBeGreaterThan(copy.indexOf('<rect'));
    // archived: the card rests inside the box, so the box front and rim are drawn over it.
    const archive = group(arm, '<g class="deputy-prop deputy-archive"');
    const card = group(archive, '<g class="deputy-archive-card">');
    expect(archive.slice(archive.indexOf(card) + card.length)).toMatch(
      /<path d="M-8 -50H80[^"]*Z" fill="#f0ece3"[\s\S]*<rect x="-14" y="-62"/,
    );
    // deleted: a job card that drops into the bin; guide and rank: a pointer with a green tip.
    expect(group(arm, '<g class="deputy-prop deputy-drop"')).toContain(
      '<g class="deputy-drop-card">',
    );
    expect(pure.drawing).not.toContain('deputy-sign');
    expect(group(arm, '<g class="deputy-prop deputy-pointer"')).toMatch(
      /<path d="M0 10V-112"[^>]*>\s*<circle cx="0" cy="-118" r="8.5" fill="#2f9e77"/,
    );
    // test: three checks that tick in turn, each a drawn path.
    const test = group(arm, '<g class="deputy-prop deputy-test"');
    for (const n of [1, 2, 3]) {
      expect(test).toMatch(
        new RegExp(`<g class="deputy-test-tick deputy-test-tick-${n}"><path [^>]*pathLength="1"`),
      );
    }
    // approved: the approval card's check is a group of its own, so it can stamp.
    expect(group(arm, '<g class="deputy-prop deputy-approval"')).toContain(
      '<g class="deputy-approval-check"><circle cx="28" cy="-34" r="17"',
    );
  });

  it('namespaces every id per instance', () => {
    const ids = [...pure.drawing.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? '');
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^__NS__-/);
    for (const match of pure.drawing.matchAll(/url\(#([^)]+)\)/g)) {
      expect(ids).toContain(match[1]);
    }
    expect(script).not.toMatch(/jdA-/);
    expect(script).toContain("drawing.replaceAll('__NS__', ns)");
    for (const prop of Object.values(pure.props)) expect(prop).not.toMatch(/\sid="/);
  });

  it('paints only canonical tokens, each named by its data-token', () => {
    const valueTokens = new Map<string, string[]>();
    for (const [name, value] of Object.entries(canonicalTokens)) {
      valueTokens.set(value, [...(valueTokens.get(value) ?? []), name]);
    }
    const art = [pure.drawing, ...Object.values(pure.props)].join('\n');
    const elements = [...art.matchAll(/<(?:[a-z]+)\b[^>]*>/gi)].map((match) => match[0]);
    let painted = 0;
    for (const element of elements) {
      const paints = [...element.matchAll(/\s(fill|stroke|stop-color)="([^"]+)"/g)]
        .map((match) => match[2] ?? '')
        .filter((value) => value !== 'none' && !value.startsWith('url(#__NS__-'));
      if (!paints.length) continue;
      painted += 1;
      const named = (element.match(/\sdata-token="([^"]+)"/)?.[1] ?? '')
        .split(/[\s/()%]+/)
        .filter((word) => tokenNames.has(word));
      expect(named.length, `${element.slice(0, 80)} needs a data-token`).toBeGreaterThan(0);
      for (const paint of paints) {
        const tokens = valueTokens.get(paint) ?? [];
        expect(tokens.length, `${paint} is not a canonical token value`).toBeGreaterThan(0);
        expect(
          tokens.some((token) => named.includes(token)),
          `${paint} in ${element.slice(0, 80)} must be named by data-token`,
        ).toBe(true);
      }
    }
    expect(painted).toBeGreaterThan(100);
  });
});

// ------------------------------------------------------------------ the hand rule (round 6, R6-1)
// The owner (round 6, G1, G2, G5): the panda smiles everywhere; the right paw always holds the
// tool of the moment; the left paw is free; the bamboo leans beside him, never in a paw.
const toolsTable = runInNewContext(
  `(() => {${script.slice(script.indexOf('const MOTION_KEY'), script.indexOf('const instances = [];'))}; return tools; })()`,
) as Record<string, string>;
const toolGroup = (tool: string): string =>
  ['magnifier', 'pencil', 'key'].includes(tool) ? `panda-${tool}` : `deputy-${tool}`;
const shownIn = (source: string, state: string, cls: string): boolean =>
  new RegExp(`\\[data-deputy-state="${state}"\\] (?:\\.${cls}\\b|:is\\([^)]*\\.${cls}\\b)`).test(
    source,
  );

describe('the hand rule', () => {
  it('names one tool for every state and reaction', () => {
    expect(Object.keys(toolsTable).sort()).toEqual(
      [...new Set([...briefStates, ...briefReactions])].sort(),
    );
    expect(script).toContain('tools: Object.freeze({ ...tools })');
  });

  it('holds every tool in the right paw, and nothing in the left paw', () => {
    const right = group(pure.drawing, '<g class="panda-arm panda-arm-right arm-right">');
    const left = group(pure.drawing, '<g class="panda-arm panda-arm-left arm-left">');
    for (const [name, tool] of Object.entries(toolsTable)) {
      expect(right, `${name}: ${tool}`).toContain(
        `class="${tool.startsWith('panda') ? tool : toolGroup(tool).startsWith('panda') ? toolGroup(tool) : `deputy-prop ${toolGroup(tool)}`}"`,
      );
      expect(left, `${name}: the left paw holds nothing`).not.toContain(toolGroup(tool));
      // deputy.css shows the tool in that pose.
      expect(shownIn(css, name, toolGroup(tool)), `${name} shows ${toolGroup(tool)}`).toBe(true);
    }
    // The left arm is the arm and the paw, and nothing else.
    expect(left.match(/<(?:ellipse|path|circle|rect|g)\b/g)).toEqual([
      '<g',
      '<ellipse',
      '<ellipse',
    ]);
  });

  it('leans the bamboo beside the panda, outside both arms, on both drawings', () => {
    for (const source of [pure.drawing, entryDrawing]) {
      const lean = source.indexOf('<g class="bamboo-lean">');
      expect(lean, 'the leaning bamboo').toBeGreaterThan(0);
      expect(lean, 'drawn behind the body').toBeLessThan(source.indexOf('<g class="panda-body">'));
      for (const arm of ['panda-arm-left arm-left', 'panda-arm-right arm-right']) {
        expect(group(source, `<g class="panda-arm ${arm}">`)).not.toContain('bamboo');
      }
      expect(group(source, '<g class="bamboo-lean">')).toMatch(
        /<g class="bamboo">\s*<g transform="translate\(-69 0\) rotate\(13 117 386\) translate\(117 386\) scale\(0\.72\) translate\(-117 -386\)">/,
      );
    }
    expect(css).not.toContain('bamboo-park');
    expect(login).not.toContain('bamboo-park');
  });

  it('smiles: an open smile, lifted lower lids, and a gentle smile for the calm states', () => {
    const head = group(pure.drawing, '<g class="panda-head">');
    expect(head.match(/class="eye-lower"/g)).toHaveLength(2);
    expect(head.match(/class="catchlight catchlight-small"/g)).toHaveLength(2);
    const idle = group(head, '<g class="mouth mouth-idle">');
    expect(idle, 'an open mouth with a tongue').toMatch(/Z" fill="#1b1a18"[\s\S]*fill="#ffd5c6"/);
    // Every mouth curves up: each line's (or outline's) first curve has its control point below
    // its ends, so no mouth frowns. The tongue is not a mouth line.
    for (const name of ['mouth-idle', 'mouth-happy', 'mouth-concern']) {
      const mouth = group(head, `<g class="mouth ${name}"`);
      const lines = [...mouth.matchAll(/<path d="([^"]+)"([^>]*)>/g)].filter(
        (match) => !(match[2] ?? '').includes('fill="#ffd5c6"'),
      );
      let curves = 0;
      for (const [, d] of lines) {
        const curve = (d ?? '').match(/M[\d.]+ ([\d.]+)Q[\d.]+ ([\d.]+) [\d.]+ ([\d.]+)/);
        if (!curve) continue;
        curves += 1;
        expect(Number(curve[2]), `${name} curve`).toBeGreaterThan(Number(curve[1]));
      }
      expect(curves, `${name} has a curve`).toBeGreaterThan(0);
    }
  });

  it('keeps a tool in the right paw in every entry chapter and interaction state', () => {
    const layer = login.slice(
      login.indexOf('/* Panda teammate layer: start'),
      login.indexOf('/* Panda teammate layer: end */'),
    );
    const scenes = [...login.matchAll(/^\s+scene: '([\w-]+)',$/gm)].map((match) => match[1] ?? '');
    // Round 7 (G1): the story is the owner's three steps, Set it up, It finds, It applies.
    expect(scenes).toEqual(['setup', 'search', 'apply']);
    const entryArm = group(entryDrawing, '<g class="panda-arm panda-arm-right arm-right">');
    const tools = [
      ...entryArm.matchAll(/<g class="(?:deputy-prop )?((?:panda|deputy)-[\w-]+)" opacity="0">/g),
    ].map((match) => match[1] ?? '');
    expect(tools.length).toBeGreaterThanOrEqual(12);
    const shows = (selector: string): string[] =>
      tools.filter((tool) =>
        new RegExp(`${selector.replace(/[[\]().*+?^$|]/g, '\\$&')} \\.${tool}(?:,|\\s*\\{)`).test(
          layer,
        ),
      );
    for (const state of [
      'arrive',
      'notice',
      'protect-password',
      'explain-region',
      'pending',
      'success',
      'error',
    ]) {
      expect(shows(`[data-panda-state="${state}"]`), state).toHaveLength(1);
    }
    for (const scene of scenes) {
      expect(
        shows(`:is([data-panda-state="story"], [data-panda-state="idle"])[data-scene="${scene}"]`),
        scene,
      ).toHaveLength(1);
    }
    // The arrive wave is the left paw's; the right paw keeps the job card.
    expect(layer).toContain('[data-panda-state="arrive"].is-arriving .panda-arm-left {');
    expect(layer).not.toContain('.is-arriving .panda-arm-right');
  });
});

// ------------------------------------------------------------------ states and copy
describe('deputy states', () => {
  it('declares exactly the brief states, in order', () => {
    expect(Object.keys(pure.states)).toEqual(briefStates);
    const api = script.match(/states: Object\.freeze\(Object\.keys\(states\)\)/);
    expect(api, 'the API lists the states').not.toBeNull();
  });

  it('styles every state in deputy.css', () => {
    for (const state of briefStates) {
      expect(css, state).toContain(`[data-deputy-state="${state}"]`);
    }
  });

  it('keeps default speech to six words or fewer and duty to three words or fewer', () => {
    for (const [state, entry] of Object.entries(pure.states)) {
      expect(words(entry.speech), `${state} speech «${entry.speech}»`).toBeLessThanOrEqual(6);
      expect(words(entry.duty), `${state} duty «${entry.duty}»`).toBeLessThanOrEqual(3);
      expect(`${entry.speech} ${entry.duty}`, `${state} copy`).not.toMatch(/[–—]/);
    }
    for (const name of Object.values(pure.regions)) {
      expect(words(`Your data stays in ${name}.`)).toBeLessThanOrEqual(6);
    }
  });

  it('matches the brief table copy', () => {
    const copy = Object.fromEntries(
      Object.entries(pure.states).map(([state, entry]) => [state, [entry.duty, entry.speech]]),
    );
    expect(copy.idle).toEqual(['Ready', 'Here when you need me.']);
    expect(copy.arrive).toEqual(['Joining you', 'Hi, Alex. Let’s get going.']);
    expect(copy.report).toEqual(['Reporting in', 'Here’s what I found.']);
    expect(copy.search).toEqual(['Searching', 'Checking your sources now.']);
    expect(copy.filter).toEqual(['Filtering', 'I set weak fits aside.']);
    expect(copy.rank).toEqual(['Ranking', 'Best fits are on top.']);
    expect(copy.choose).toEqual(['Waiting on you', 'Your call on these.']);
    expect(copy.tailor).toEqual(['Tailoring', 'Drafting for this role.']);
    expect(copy.approve).toEqual(['Awaiting approval', 'Nothing sends without you.']);
    expect(copy.track).toEqual(['Keeping track', 'I log every step.']);
    expect(copy.watch).toEqual(['Keeping watch', 'I only watch if asked.']);
    expect(copy['protect-data']).toEqual(['Guarding your data', 'Your data stays in the US.']);
    expect(copy['hold-key']).toEqual(['Holding your key', 'Your key stays yours.']);
    expect(copy.fill).toEqual(['Filling forms', 'I fill what you approved.']);
    expect(copy.invite).toEqual(['Inviting friends', 'Bring a friend along.']);
    // Round 6 (S1): the Prompts page; while a prompt test runs the duty reads "Testing prompts".
    expect(copy.test).toEqual(['Checking prompts', 'I test before I switch.']);
    expect(pure.states.test).toMatchObject({
      kind: 'page',
      loop: true,
      workingDuty: 'Testing prompts',
    });
    expect(copy.notice?.[0]).toBe('Listening');
    expect(copy.pending).toEqual(['Working', 'On it.']);
    expect(copy.success).toEqual(['Done', 'All set.']);
    expect(copy.error).toEqual(['Needs attention', 'Let’s fix this together.']);
    expect(copy.guide).toEqual(['Showing you around', 'Let me show you around.']);
    expect(pure.states.guide).toMatchObject({ kind: 'moment', motion: 987 });
  });

  it('makes fill and invite page states with one-time motion of 1.618s and 987ms', () => {
    expect(pure.states.fill).toMatchObject({ kind: 'page', motion: 1618, loop: true });
    expect(pure.states.invite).toMatchObject({ kind: 'page', motion: 987 });
    expect(pure.states.invite?.loop).toBeUndefined();
  });

  it('loops only search, tailor, fill, test, and pending', () => {
    const looping = Object.entries(pure.states)
      .filter(([, entry]) => entry.loop)
      .map(([state]) => state);
    // Round 6 adds test: its checks tick in turn only while a prompt test runs.
    expect(looping).toEqual(['search', 'tailor', 'fill', 'test', 'pending']);
    for (const entry of Object.values(pure.states)) {
      expect(entry.motion).toBeLessThanOrEqual(2605);
    }
  });
});

// ------------------------------------------------------------------ motion
describe('deputy motion', () => {
  const animated = cssRules.filter(
    (rule) =>
      !isReduced(rule) &&
      declarations(rule.body).some(
        ({ property, value }) => property === 'animation' && value !== 'none !important',
      ),
  );

  it('neutralizes every animated selector in the reduced-motion block', () => {
    const reset = cssRules.filter(
      (rule) =>
        isReduced(rule) &&
        /animation:\s*none\s*!important/.test(rule.body) &&
        /transition:\s*none\s*!important/.test(rule.body),
    );
    expect(reset.length).toBeGreaterThan(0);
    const covered = new Set(
      reset.flatMap((rule) => rule.selectors.filter((selector) => /^\.[\w-]+$/.test(selector))),
    );
    expect(animated.length).toBeGreaterThan(30);
    for (const rule of animated) {
      for (const selector of rule.selectors) {
        const classes = lastClasses(selector);
        expect(
          classes.some((name) => covered.has(`.${name}`)),
          `${selector} must be reset under reduced motion`,
        ).toBe(true);
      }
    }
    // Pause motion stops every animated element too.
    const paused = cssRules.find(
      (rule) =>
        rule.selectors.some((selector) => selector.includes('[data-deputy-mode="paused"]')) &&
        /animation:\s*none\s*!important/.test(rule.body),
    );
    expect(paused?.body).toMatch(/animation:\s*none\s*!important/);
    expect(paused?.body).toMatch(/transition:\s*none\s*!important/);
    const pausedList = paused?.selectors.join(' ') ?? '';
    for (const rule of animated) {
      for (const selector of rule.selectors) {
        expect(
          lastClasses(selector).some((name) => new RegExp(`\\.${name}(?![\\w-])`).test(pausedList)),
          `${selector} must stop with Pause motion`,
        ).toBe(true);
      }
    }
  });

  it('uses only the canonical curves and the golden durations', () => {
    const durations = new Set(['180ms', '380ms', '618ms', '987ms', '1.35s', '1.618s', '2.605s']);
    const curves = new Set(['var(--ease-settle)', 'var(--ease-spring)', 'ease', 'linear']);
    for (const rule of cssRules.filter((item) => !isReduced(item))) {
      for (const { property, value } of declarations(rule.body)) {
        if (property !== 'animation' && property !== 'transition') continue;
        if (value.startsWith('none')) continue;
        for (const part of value.split(/,(?![^(]*\))/)) {
          const tokens = part.trim().split(/\s+(?![^(]*\))/);
          const times = tokens.filter((token) => /^\d*\.?\d+m?s$/.test(token));
          const duration = times[0] ?? '';
          const loops = tokens.includes('infinite');
          expect(
            loops ? ['5.236s', '987ms'].includes(duration) : durations.has(duration),
            `${rule.selectors[0]}: ${part.trim()}`,
          ).toBe(true);
          if (loops && duration === '987ms') {
            expect(rule.selectors.join(), 'only the spinner turns every 987ms').toMatch(
              /deputy-duty-dot/,
            );
          }
          const curve = tokens.find((token) => curves.has(token) || /ease|cubic|steps/.test(token));
          expect(curve && curves.has(curve), `${rule.selectors[0]}: ${part.trim()} curve`).toBe(
            true,
          );
        }
      }
    }
  });

  it('loops only while work is in progress, while pending, and while motion is on', () => {
    const loops = animated.filter((rule) => /\binfinite\b/.test(rule.body));
    expect(loops.length).toBeGreaterThan(0);
    for (const rule of loops) {
      for (const selector of rule.selectors) {
        expect(selector, selector).toContain('[data-deputy-mode="on"]');
        expect(
          /\[data-deputy-working\]\[data-deputy-state="(search|tailor|fill|test)"\]/.test(
            selector,
          ) || selector.includes('[data-deputy-state="pending"]'),
          selector,
        ).toBe(true);
      }
    }
    // One-time motion waits for data-deputy-play; the blink and the idle gestures have their own
    // attributes, and a gesture runs only while motion is on.
    for (const rule of animated.filter((item) => !/\binfinite\b/.test(item.body))) {
      for (const selector of rule.selectors) {
        expect(/\[data-deputy-(play|blink|gesture=[^\]]+)\]/.test(selector), selector).toBe(true);
        if (selector.includes('data-deputy-gesture')) {
          expect(selector, selector).toContain('[data-deputy-mode="on"]');
        }
      }
    }
  });

  it('fills the three fields in turn, each gaining its tick, once and in every working loop', () => {
    for (const part of ['value', 'tick']) {
      for (const n of [1, 2, 3]) {
        const name = `deputy-fill-${part}-${n}`;
        expect(ruleFor(`[data-deputy-play][data-deputy-state="fill"] .${name}`)?.body).toMatch(
          new RegExp(`animation:\\s*${name} 1\\.618s var\\(--ease-settle\\) 618ms 1 backwards`),
        );
        expect(
          ruleFor(`[data-deputy-mode="on"][data-deputy-working][data-deputy-state="fill"] .${name}`)
            ?.body,
        ).toMatch(
          new RegExp(
            `animation:\\s*${name}-loop 5\\.236s var\\(--ease-settle\\) 618ms infinite backwards`,
          ),
        );
      }
    }
    for (const suffix of ['', '-loop']) {
      // Field 1 fills, then gains its tick, then field 2 fills, and so on.
      const order = [1, 2, 3].flatMap((n) => [
        firstAt(`deputy-fill-value-${n}${suffix}`, /stroke-dashoffset:\s*0\b/),
        firstAt(`deputy-fill-tick-${n}${suffix}`, /opacity:\s*1\b/),
      ]);
      expect(order.every(Number.isFinite), `fill${suffix} stops`).toBe(true);
      expect(order, `fill${suffix} order`).toEqual([...order].sort((a, b) => a - b));
      expect(new Set(order).size, `fill${suffix} beats`).toBe(6);
      for (const n of [1, 2, 3]) {
        const start = keyframes(`deputy-fill-value-${n}${suffix}`).find((stop) =>
          stop.at.includes(0),
        );
        expect(start?.body, `value ${n} starts empty`).toMatch(/stroke-dashoffset:\s*1\b/);
        const tick = keyframes(`deputy-fill-tick-${n}${suffix}`).find((stop) =>
          stop.at.includes(0),
        );
        expect(tick?.body, `tick ${n} starts hidden`).toMatch(/opacity:\s*0\b/);
      }
    }
    // Each working pass fills within the first 1.618s of its 5.236s, holds, then clears for the next.
    expect(firstAt('deputy-fill-tick-3-loop', /opacity:\s*1\b/)).toBeLessThan((1618 / 5236) * 100);
    for (const n of [1, 2, 3]) {
      const end = keyframes(`deputy-fill-value-${n}-loop`).find((stop) => stop.at.includes(100));
      expect(end?.body).toMatch(/stroke-dashoffset:\s*1\b/);
      expect(end?.body).toMatch(/opacity:\s*0\b/);
    }
  });

  it('lifts the envelope while the credits ticket rises out of the pocket, once, in 987ms', () => {
    expect(
      ruleFor('[data-deputy-play][data-deputy-state="invite"] .panda-arm-right')?.body,
    ).toMatch(/animation:\s*deputy-invite-arm 987ms var\(--ease-settle\) 618ms 1;/);
    expect(ruleFor('[data-deputy-play][data-deputy-state="invite"] .deputy-ticket')?.body).toMatch(
      /animation:\s*deputy-ticket 987ms var\(--ease-settle\) 618ms 1 backwards/,
    );
    const start = keyframes('deputy-ticket').find((stop) => stop.at.includes(0));
    const drop = Number(start?.body.match(/translate\(0px,\s*([\d.]+)px\)/)?.[1] ?? 0);
    expect(drop, 'the ticket starts inside the pocket').toBeGreaterThan(25);
    expect(
      cssRules.filter(
        (rule) =>
          /\binfinite\b/.test(rule.body) &&
          rule.selectors.some((selector) => selector.includes('"invite"')),
      ),
    ).toEqual([]);
  });

  it('moves only wrapper groups, never a shape with a geometry transform', () => {
    const fixed = new Set(
      [...pure.drawing.matchAll(/<[a-z]+\b[^>]*\sclass="([^"]+)"[^>]*\stransform="/gi)].flatMap(
        (match) => (match[1] ?? '').split(/\s+/),
      ),
    );
    expect([...fixed].sort()).toEqual(['arm-shape', 'patch', 'patch-left', 'patch-right'].sort());
    for (const rule of cssRules) {
      const moves = declarations(rule.body).some(({ property }) =>
        ['transform', 'animation', 'translate', 'rotate', 'scale'].includes(property),
      );
      if (!moves) continue;
      for (const selector of rule.selectors) {
        for (const name of lastClasses(selector)) {
          expect(fixed.has(name), `${selector} moves a shape with a geometry transform`).toBe(
            false,
          );
        }
      }
    }
  });

  it('keeps the motion control and its announcements as the brief words them', () => {
    expect(script).toContain("stopped ? 'Play motion' : 'Pause motion'");
    expect(script).toContain("const PAUSED_DUTY = 'Motion paused';");
    expect(script).toContain("next ? 'Deputy motion paused.' : 'Deputy motion on.'");
    expect(script).toContain("const MOTION_KEY = 'jobdeputy.deputyMotion';");
    expect(script).toContain("window.localStorage.setItem(MOTION_KEY, 'paused')");
    expect(script).toContain("const ARRIVE_KEY = 'jobdeputy.deputyArrived';");
    expect(script).toContain("const LAST_KEY = 'jobdeputy.deputyLast';");
    expect(script).toContain('window.sessionStorage');
    expect(script).not.toContain('aria-pressed');
    expect(script).not.toMatch(/aria-live|setAttribute\(\s*'role'/);
    expect(script).not.toMatch(/pointermove|mousemove/);
  });
});

// ------------------------------------------------------------------ styles and sizes
describe('deputy styles', () => {
  it('uses only canonical tokens, its own properties, and the two font stacks', () => {
    const own = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1] ?? ''));
    for (const rule of cssRules) {
      for (const { property, value } of declarations(rule.body)) {
        expect(value, `${property}: ${value}`).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
        if (property === 'font-family') {
          expect(['var(--font-display)', 'var(--font-text)', 'inherit']).toContain(value);
        }
        if (property === 'font-size') {
          const sizes = [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
          expect(Math.min(...sizes), `${rule.selectors[0]} font-size`).toBeGreaterThanOrEqual(12);
        }
      }
    }
    for (const match of css.matchAll(/var\(\s*(--[\w-]+)/g)) {
      const name = match[1] ?? '';
      const known =
        tokenNames.has(name.slice(2)) ||
        own.has(name) ||
        name.startsWith('--deputy-look-') ||
        name === '--app-sidebar-width' ||
        // Round 6: the tour card sets the tour panda's size (guide(), 72px to 96px).
        name === '--deputy-guide-size';
      expect(known, `${name} is not a canonical token or a deputy property`).toBe(true);
    }
  });

  it('keeps every control and row at least 44px tall', () => {
    const minHeight = (selector: string): string | undefined =>
      cssRules
        .filter((rule) => rule.selectors.includes(selector))
        .flatMap((rule) => declarations(rule.body))
        .find(({ property }) => property === 'min-height')?.value;
    expect(minHeight('.deputy-activity-toggle')).toBe('44px');
    expect(minHeight('.deputy-motion')).toBe('44px');
    expect(minHeight('.deputy-activity-list a')).toBe('44px');
    expect(minHeight('.deputy-activity-list li')).toBe('44px');
    expect(minHeight('.deputy-panel-action')).toBe('44px');
  });

  it('uses the shell breakpoints, and each pinned size repeats its media block exactly', () => {
    const blocks: Array<[string, string]> = [
      ['@media (min-width: 1101px) and (max-height: 820px)', 'compact'],
      ['@media (min-width: 721px) and (max-width: 1100px)', 'rail'],
      ['@media (max-width: 720px)', 'chip'],
    ];
    for (const [query, size] of blocks) {
      const inMedia = cssRules
        .filter((rule) => rule.media.at(-1) === query && rule.media.length === 1)
        .filter((rule) => rule.selectors.every((s) => s.startsWith('.deputy-dock:not(')))
        .map((rule) =>
          squash(
            `${rule.selectors.join(', ')}{${rule.body}}`.replaceAll(
              '.deputy-dock:not([data-deputy-size])',
              `.deputy-dock[data-deputy-size="${size}"]`,
            ),
          ),
        );
      const pinned = cssRules
        .filter((rule) => !rule.media.length)
        .filter((rule) =>
          rule.selectors.every((s) => s.startsWith(`.deputy-dock[data-deputy-size="${size}"]`)),
        )
        .map((rule) => squash(`${rule.selectors.join(', ')}{${rule.body}}`));
      expect(inMedia.length, `${size} rules`).toBeGreaterThan(2);
      expect(pinned, `${size} pinned block`).toEqual(inMedia);
    }
  });

  it('lays the setup scene out as a phone row at 720px and narrower, pinned on the cast sheet', () => {
    const query = '@media (max-width: 720px)';
    const narrow = '@container (max-width: 289px)';
    const prefix = '.deputy-scene:not([data-deputy-size])';
    const pin = '.deputy-scene[data-deputy-size="row"]';
    const text = (rule: Rule): string => squash(`${rule.selectors.join(', ')}{${rule.body}}`);
    const block = (media: string[], start: string): Rule[] =>
      cssRules.filter(
        (rule) =>
          rule.media.join(' ') === media.join(' ') &&
          rule.selectors.every((selector) => selector.startsWith(start)),
      );
    const inMedia = block([query], prefix);
    expect(inMedia.length).toBeGreaterThan(4);
    // The pinned block, and its narrow-scene fallback, repeat the phone blocks exactly.
    expect(block([], pin).map(text)).toEqual(
      inMedia.map((rule) => text(rule).replaceAll(prefix, pin)),
    );
    const inNarrow = block([query, narrow], prefix);
    expect(inNarrow.length).toBe(2);
    expect(block([narrow], pin).map(text)).toEqual(
      inNarrow.map((rule) => text(rule).replaceAll(prefix, pin)),
    );
    // In a scene narrower than 290px, Pause motion takes its own line under the duty.
    expect(
      inNarrow.find((rule) => rule.selectors.includes(`${prefix} .deputy-actions`))?.body,
    ).toMatch(/grid-row:\s*3;/);
    const body = (suffix: string): string =>
      inMedia.find((rule) => rule.selectors.includes(`${prefix}${suffix}`))?.body ?? '';
    // An 89px panda beside the speech bubble; the duty and Pause motion under the bubble.
    expect(body('')).toMatch(/--deputy-scene-panda:\s*89px/);
    expect(body('')).toMatch(/grid-template-columns:\s*89px minmax\(0, 1fr\) auto/);
    expect(body(' .deputy-art')).toMatch(/width:\s*89px/);
    expect(body(' .deputy-art')).toMatch(/grid-row:\s*1 \/ -1/);
    expect(body(' .deputy-speech')).toMatch(/grid-row:\s*1;/);
    expect(body(' .deputy-speech')).toMatch(/grid-column:\s*2 \/ -1/);
    expect(body(' .deputy-duty')).toMatch(/grid-row:\s*2;/);
    expect(body(' .deputy-actions')).toMatch(/grid-row:\s*2;/);
    // Pause motion keeps its 44px target: nothing in the row resizes it.
    expect(
      [...inMedia, ...inNarrow].some((rule) =>
        rule.selectors.some((selector) => selector.includes('deputy-motion')),
      ),
    ).toBe(false);
    // Only onboarding and the cast sheet host a scene.
    const hosts = readdirSync(brandDirectory).filter(
      (name) => name.endsWith('.html') && sourceFor(name).includes('class="deputy-scene"'),
    );
    expect(hosts.sort()).toEqual(['deputy-preview.html', 'onboarding-preview.html']);
  });

  it('keeps the speech and duty as plain text and hides the dock in print', () => {
    expect(css).toMatch(/@media print\s*\{\s*\.deputy-dock\s*\{\s*display:\s*none;/);
    const speech = cssRules.find((rule) => rule.selectors.includes('.deputy-speech'));
    expect(speech?.body).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(speech?.body).toMatch(/font-style:\s*italic/);
    expect(speech?.body).toMatch(/font-size:\s*15px/);
  });
});

// ------------------------------------------------------------------ reactions (R3-8)
// The animation shorthands on rules for one pose's one-time motion, as [name, duration, delay] ms.
const oneShots = (pose: string): Array<[string, number, number]> =>
  cssRules
    .filter((rule) => !isReduced(rule))
    .filter((rule) =>
      rule.selectors.some((selector) =>
        selector.startsWith(`[data-deputy-play][data-deputy-state="${pose}"]`),
      ),
    )
    .flatMap((rule) => declarations(rule.body))
    .filter(({ property }) => property === 'animation')
    .map(({ value }) => {
      const times = [...value.matchAll(/(\d*\.?\d+)(m?s)\b/g)].map((match) =>
        match[2] === 's' ? Number(match[1]) * 1000 : Number(match[1]),
      );
      return [value.split(/\s+/)[0] ?? '', times[0] ?? 0, times[1] ?? 0];
    });

describe('deputy reactions', () => {
  it('declares exactly the brief reactions, in order, each with a pose deputy.css draws', () => {
    expect(Object.keys(pure.reactions)).toEqual(briefReactions);
    expect(script).toContain('reactions: Object.freeze(Object.keys(reactions))');
    for (const name of briefReactions) {
      const pose = poseOf(name);
      expect(css, `${name} pose`).toContain(`[data-deputy-state="${pose}"]`);
      // A reaction's pose is its own, or (error) the error state's.
      expect(pose === name || pure.states[pose]?.kind === 'moment', name).toBe(true);
    }
    expect(poseOf('error')).toBe('error');
  });

  it('keeps every line short, first person where it speaks, and dash free', () => {
    for (const [name, entry] of Object.entries(pure.reactions)) {
      expect(words(entry.speech), `${name} speech «${entry.speech}»`).toBeLessThanOrEqual(6);
      expect(words(entry.duty), `${name} duty «${entry.duty}»`).toBeLessThanOrEqual(3);
      expect(`${entry.speech} ${entry.duty}`, name).not.toMatch(/[–—]/);
    }
    const copy = Object.fromEntries(
      Object.entries(pure.reactions).map(([name, entry]) => [name, [entry.duty, entry.speech]]),
    );
    expect(copy.added).toEqual(['Added', 'Added to Applications.']);
    expect(copy.dismissed).toEqual(['Set aside', 'I set that one aside.']);
    expect(copy.saved).toEqual(['Saved', 'Saved. I’ll use this.']);
    expect(copy.found).toEqual(['Found roles', 'I found new roles.']);
    expect(copy.error).toEqual([pure.states.error?.duty, pure.states.error?.speech]);
  });

  it('plays each reaction once, from the moment it is shown, and ends by 1.618s', () => {
    for (const name of briefReactions) {
      const shots = oneShots(poseOf(name));
      expect(shots.length, `${name} moves`).toBeGreaterThan(0);
      const end = Math.max(...shots.map(([, duration, delay]) => duration + delay));
      expect(end, `${name} ends by 1.618s`).toBeLessThanOrEqual(1618);
      expect(pure.reactions[name]?.motion, `${name} motion`).toBe(end);
    }
    const reacting = cssRules.filter(
      (rule) =>
        /\binfinite\b/.test(rule.body) &&
        rule.selectors.some((selector) =>
          briefReactions.some((name) => selector.includes(`"${poseOf(name)}"`)),
        ),
    );
    expect(reacting).toEqual([]);
    // The pose and its line stay 2.605s (time to read it), then the deputy settles back.
    expect(pure.timing.REACT_MS).toBe(2605);
  });

  it('shares filter, search, approve, and fill poses with dismissed, started, approved, and submitted', () => {
    for (const [state, reaction, parts] of [
      ['filter', 'dismissed', ['.panda-head', '.panda-arm-right', '.deputy-best', '.deputy-weak']],
      ['search', 'started', ['.panda-head', '.panda-arm-right', '.panda-magnifier']],
      ['approve', 'approved', ['.panda-head', '.panda-arm-right', '.deputy-approval']],
      ['fill', 'submitted', ['.panda-head', '.panda-arm-right', '.deputy-pen', '.deputy-form']],
    ] as const) {
      for (const part of parts) {
        const rule = cssRules.find(
          (item) =>
            !item.media.length &&
            item.selectors.includes(`[data-deputy-state="${state}"] ${part}`) &&
            /transform:/.test(item.body),
        );
        expect(rule?.selectors, `${reaction} ${part}`).toContain(
          `[data-deputy-state="${reaction}"] ${part}`,
        );
      }
    }
  });

  it('keeps the still pose meaningful: sent and deleted keep their tool in the paw', () => {
    // Round 6 (R6-1, the hand rule): the right paw never ends empty. sent: the letter flies out of
    // the envelope (backwards, so it shows only while it flies) and the envelope stays in hand.
    expect(ruleFor('[data-deputy-play][data-deputy-state="sent"] .deputy-letter')?.body).toMatch(
      /animation:\s*deputy-send 987ms var\(--ease-settle\) 618ms 1 backwards/,
    );
    expect(css).not.toMatch(/\.deputy-envelope\s*\{[^}]*deputy-send/);
    // deleted: the card drops into the bin the paw holds (backwards); at rest it is inside, unseen.
    expect(ruleFor('[data-deputy-state="deleted"] .deputy-drop-card')?.body).toMatch(
      /opacity:\s*0/,
    );
    expect(
      ruleFor('[data-deputy-play][data-deputy-state="deleted"] .deputy-drop-card')?.body,
    ).toMatch(/backwards/);
    const drop = group(pure.drawing, '<g class="deputy-prop deputy-drop"');
    const card = group(drop, '<g class="deputy-drop-card">');
    expect(drop.slice(drop.indexOf(card) + card.length), 'the bin is drawn over the card').toMatch(
      /<path d="M-12 -46H80[^"]*Z" fill="#f0ece3"[\s\S]*<rect x="-18" y="-58"/,
    );
  });
});

// ------------------------------------------------------------------ idle gestures (R3-2)
const lookOf = (state: string): [number, number] => {
  const body = ruleFor(`[data-deputy-state="${state}"]`)?.body ?? '';
  return [
    Number(body.match(/--deputy-look-x:\s*(-?[\d.]+)/)?.[1] ?? 0),
    Number(body.match(/--deputy-look-y:\s*(-?[\d.]+)/)?.[1] ?? 0),
  ];
};

describe('deputy idle gestures', () => {
  it('makes one gesture every 13 to 21s, after 2.605s of quiet', () => {
    expect(pure.timing.GESTURE_MIN_MS).toBe(13000);
    expect(pure.timing.GESTURE_MAX_MS).toBe(21000);
    // The first after a page shows (or Play, or a shown tab) comes 13 to 17s in.
    expect(pure.timing.GESTURE_FIRST_MAX_MS).toBe(17000);
    expect(pure.timing.QUIET_MS).toBe(2605);
    expect(script).toContain('gestures: Object.freeze(Object.keys(gestures))');
  });

  it('draws every gesture once, only while motion is on, in a golden duration', () => {
    const rules: Record<string, string[]> = {
      glance: ['.pupil', '.panda-head'],
      tilt: ['.panda-head'],
      nod: ['.panda-head'],
      'ear-left': ['.ear-left'],
      'ear-right': ['.ear-right'],
      sway: ['.bamboo'],
      lift: ['.panda-arm-right'],
    };
    for (const [value, parts] of Object.entries(rules)) {
      const gesture = value.startsWith('ear') ? 'ear' : value;
      const ms = pure.gestures[gesture]?.ms ?? 0;
      for (const part of parts) {
        const body = ruleFor(
          `[data-deputy-mode="on"][data-deputy-gesture="${value}"] ${part}`,
        )?.body;
        expect(body, `${value} ${part}`).toMatch(
          new RegExp(
            `animation:\\s*deputy-[\\w-]+ ${ms === 1618 ? '1\\.618s' : `${ms}ms`} var\\(--ease-(settle|spring)\\) 1;`,
          ),
        );
      }
    }
    expect(Object.keys(pure.gestures)).toEqual(['glance', 'tilt', 'nod', 'ear', 'sway', 'lift']);
  });

  it('adds to any pose: gestures move rotate and translate, never the pose transform', () => {
    for (const name of [
      'deputy-glance-head',
      'deputy-tilt',
      'deputy-nod',
      'deputy-ear-left',
      'deputy-ear-right',
      'deputy-sway',
      'deputy-lift',
    ]) {
      const stops = keyframes(name);
      expect(stops.length, name).toBeGreaterThan(0);
      for (const stop of stops) expect(stop.body, name).not.toMatch(/(^|[;\s])transform:/);
    }
    // The eyes' glance goes to an aim the script keeps inside the eye-whites.
    expect(keyframes('deputy-glance-eyes')[0]?.body).toContain('var(--deputy-glance-x, 0)');
  });

  it('suits each resting state: a set for every page state and the guide, head gestures for small sizes', () => {
    const resting = [
      ...Object.entries(pure.states)
        .filter(([, entry]) => entry.kind === 'page')
        .map(([name]) => name),
      'guide',
    ];
    expect(Object.keys(pure.gestureSets).sort()).toEqual(resting.sort());
    for (const [state, set] of Object.entries(pure.gestureSets)) {
      for (const gesture of set.gestures)
        expect(pure.gestures, `${state} ${gesture}`).toHaveProperty(gesture);
      const head = set.gestures.filter((gesture) => !pure.gestures[gesture]?.body);
      expect(
        head.length,
        `${state} has head gestures for the rail and the chip`,
      ).toBeGreaterThanOrEqual(2);
      const [x, y] = set.glance;
      expect(Math.abs(x) <= 5 && Math.abs(y) <= 3, `${state} glance in the eye-whites`).toBe(true);
      const [lx, ly] = lookOf(state);
      expect(x !== lx || y !== ly, `${state} glances somewhere new`).toBe(true);
      expect(Math.abs(set.turn), `${state} turn`).toBeLessThanOrEqual(3);
    }
  });

  it('scales gestures up where the panda is small (rail, chip, phone row, compact dock)', () => {
    const gain = (selector: string, query: string): string | undefined =>
      cssRules
        .find((rule) => rule.media.at(-1) === query && rule.selectors.includes(selector))
        ?.body.match(/--deputy-gain:\s*([\d.]+)/)?.[1];
    expect(
      gain(
        '.deputy-dock:not([data-deputy-size])',
        '@media (min-width: 721px) and (max-width: 1100px)',
      ),
    ).toBe('1.4');
    expect(gain('.deputy-dock:not([data-deputy-size])', '@media (max-width: 720px)')).toBe('1.8');
    expect(gain('.deputy-scene:not([data-deputy-size])', '@media (max-width: 720px)')).toBe('1.4');
    expect(
      gain(
        '.deputy-dock:not([data-deputy-size])',
        '@media (min-width: 1101px) and (max-height: 820px)',
      ),
    ).toBe('1.2');
    expect(ruleFor('[data-deputy]')?.body).toMatch(/--deputy-gain:\s*1;/);
  });
});

// ------------------------------------------------------------------ the paused state (R3-2)
describe('deputy paused state', () => {
  it('turns the duty dot into a pause mark that keeps its shape in forced colours', () => {
    const mark = ruleFor('[data-deputy][data-deputy-mode="paused"] .deputy-duty-dot')?.body ?? '';
    expect(mark).toMatch(/border:\s*solid var\(--ink-soft\)/);
    expect(mark).toMatch(/border-width:\s*0 3px/);
    expect(mark).toMatch(/background:\s*transparent/);
    const forced = cssRules.find(
      (rule) =>
        rule.media.includes('@media (forced-colors: active)') &&
        rule.selectors.includes('[data-deputy][data-deputy-mode="paused"] .deputy-duty-dot'),
    );
    expect(forced?.body).toMatch(/border-color:\s*CanvasText/);
    // The still dot and its ellipsis belong to reduced motion only; paused shows the mark.
    expect(css).toContain(
      '[data-deputy][data-deputy-mode="reduce"][data-deputy-state="pending"] .deputy-duty-dot',
    );
    expect(css).not.toMatch(
      /:is\(\[data-deputy-mode="paused"\], \[data-deputy-mode="reduce"\]\)\[data-deputy-state="pending"\]/,
    );
  });

  it('gives Pause motion an icon for each state, drawn in the label colour', () => {
    expect(pure.motionIcons.pause).toBe('<path d="M9 6.5v11M15 6.5v11" />');
    expect(pure.motionIcons.play).toBe('<path d="M8.5 5.5v13l10-6.5Z" />');
    expect(script).toMatch(
      /<svg class="deputy-motion-icon" data-shape="\$\{shape\}"[^`]*stroke="currentColor"[^`]*aria-hidden="true" focusable="false">/,
    );
    expect(ruleFor('.deputy-motion-icon')?.body).toMatch(/pointer-events:\s*none/);
    // The dock's narrow row shows "Pause" or "Play"; the rest of the label stays in the name.
    expect(
      ruleFor('.deputy-dock .deputy-actions > .deputy-motion .deputy-motion-more')?.body,
    ).toMatch(/clip:\s*rect\(0, 0, 0, 0\)/);
  });

  it('keeps the Activity panel opaque, like the account menu', () => {
    const panel = ruleFor('.deputy-activity-panel')?.body ?? '';
    expect(panel).toMatch(/background:\s*white;/);
    expect(panel).not.toMatch(/backdrop-filter/);
  });
});

// ------------------------------------------------------------------ behaviour (a fake DOM)
// A small DOM: enough markup parsing and selector matching to run deputy.js against the real
// DeputyDock block, with a clock the tests advance.
type FakeNode = FakeElement | FakeText;
type Listener = (event: Record<string, unknown>) => void;

class FakeText {
  parent: FakeElement | null = null;
  constructor(public data: string) {}
  get textContent(): string {
    return this.data;
  }
  set textContent(value: string) {
    this.data = value;
  }
}

interface Compound {
  tag: string | null;
  classes: string[];
  attributes: Array<[string, string | null]>;
}

const compoundOf = (text: string): Compound => ({
  tag: text.match(/^[a-z][\w-]*/i)?.[0] ?? null,
  classes: [...text.matchAll(/\.([\w-]+)/g)].map((match) => match[1] ?? ''),
  attributes: [...text.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].map(
    (match): [string, string | null] => [match[1] ?? '', match[2] ?? null],
  ),
});

const chainsOf = (selector: string): Compound[][] =>
  selector.split(/,(?![^[]*\])/).map((part) =>
    part
      .trim()
      .split(/\s+(?![^[]*\])/)
      .map(compoundOf),
  );

class FakeElement {
  parent: FakeElement | null = null;
  childNodes: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly styles = new Map<string, string>();
  readonly style = {
    setProperty: (name: string, value: string) => this.styles.set(name, value),
    removeProperty: (name: string) => this.styles.delete(name),
    getPropertyValue: (name: string) => this.styles.get(name) ?? '',
  };
  readonly classList = {
    contains: (name: string) => this.className.split(/\s+/).includes(name),
    add: (name: string) => {
      if (!this.classList.contains(name)) this.className = `${this.className} ${name}`.trim();
    },
    remove: (name: string) => {
      this.className = this.className
        .split(/\s+/)
        .filter((item) => item && item !== name)
        .join(' ');
    },
  };
  readonly dataset: Record<string, string | undefined>;
  constructor(
    readonly page: FakePage,
    readonly tagName: string,
  ) {
    const key = (name: string): string =>
      `data-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    this.dataset = new Proxy({} as Record<string, string | undefined>, {
      get: (_target, name) =>
        typeof name === 'string' ? (this.getAttribute(key(name)) ?? undefined) : undefined,
      set: (_target, name, value) => {
        if (typeof name === 'string') this.setAttribute(key(name), String(value));
        return true;
      },
      deleteProperty: (_target, name) => {
        if (typeof name === 'string') this.removeAttribute(key(name));
        return true;
      },
    });
  }
  get children(): FakeElement[] {
    return this.childNodes.filter((node): node is FakeElement => node instanceof FakeElement);
  }
  get className(): string {
    return this.getAttribute('class') ?? '';
  }
  set className(value: string) {
    this.setAttribute('class', value);
  }
  get hidden(): boolean {
    return this.hasAttribute('hidden');
  }
  set hidden(value: boolean) {
    this.toggleAttribute('hidden', value);
  }
  get open(): boolean {
    return this.hasAttribute('open');
  }
  set open(value: boolean) {
    this.toggleAttribute('open', value);
  }
  set type(value: string) {
    this.setAttribute('type', value);
  }
  get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join('');
  }
  set textContent(value: string) {
    this.childNodes = [];
    if (value) this.appendChild(new FakeText(value));
  }
  set innerHTML(html: string) {
    this.childNodes = [];
    const stack: FakeElement[] = [this];
    const tokens = /<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
    for (let match = tokens.exec(html); match; match = tokens.exec(html)) {
      const top = stack.at(-1) ?? this;
      if (match[1]) {
        stack.pop();
      } else if (match[2]) {
        const element = new FakeElement(this.page, match[2]);
        for (const attribute of (match[3] ?? '').matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) {
          element.setAttribute(attribute[1] ?? '', attribute[2] ?? '');
        }
        top.appendChild(element);
        if (!match[4]) stack.push(element);
      } else if (match[5]?.trim()) {
        top.appendChild(new FakeText(match[5]));
      }
    }
  }
  appendChild(node: FakeNode): void {
    if (node.parent)
      node.parent.childNodes = node.parent.childNodes.filter((item) => item !== node);
    node.parent = this;
    this.childNodes.push(node);
  }
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) this.appendChild(node);
  }
  prepend(...nodes: FakeNode[]): void {
    const rest = this.childNodes;
    this.childNodes = [];
    for (const node of [...nodes, ...rest]) this.appendChild(node);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  toggleAttribute(name: string, force?: boolean): boolean {
    const on = force ?? !this.hasAttribute(name);
    if (on) this.setAttribute(name, '');
    else this.removeAttribute(name);
    return on;
  }
  is(compound: Compound): boolean {
    return (
      (!compound.tag || compound.tag === this.tagName) &&
      compound.classes.every((name) => this.classList.contains(name)) &&
      compound.attributes.every(([name, value]) =>
        value === null ? this.hasAttribute(name) : this.getAttribute(name) === value,
      )
    );
  }
  matches(selector: string): boolean {
    return chainsOf(selector).some((chain) => {
      const last = chain.at(-1);
      if (!last || !this.is(last)) return false;
      let ancestor = this.parent;
      for (const compound of chain.slice(0, -1).reverse()) {
        while (ancestor && !ancestor.is(compound)) ancestor = ancestor.parent;
        if (!ancestor) return false;
        ancestor = ancestor.parent;
      }
      return true;
    });
  }
  closest(selector: string): FakeElement | null {
    for (let node: FakeElement | null = this; node; node = node.parent) {
      if (node.matches(selector)) return node;
    }
    return null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  contains(node: FakeNode | null): boolean {
    for (let item = node; item; item = item.parent) if (item === this) return true;
    return false;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  focus(): void {
    this.page.activeElement = this;
  }
  remove(): void {
    if (this.parent) {
      this.parent.childNodes = this.parent.childNodes.filter((node) => node !== this);
      this.parent = null;
    }
  }
}

class FakePage {
  readyState = 'complete';
  hidden = false;
  activeElement: FakeElement | null = null;
  readonly listeners = new Map<string, Listener[]>();
  readonly documentElement: FakeElement;
  readonly body: FakeElement;
  constructor() {
    this.documentElement = new FakeElement(this, 'html');
    this.body = new FakeElement(this, 'body');
    this.documentElement.appendChild(this.body);
    Object.assign(this.documentElement, { clientWidth: 1440 });
  }
  createElement(tag: string): FakeElement {
    return new FakeElement(this, tag);
  }
  querySelector(selector: string): FakeElement | null {
    return this.documentElement.querySelector(selector);
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.documentElement.querySelectorAll(selector);
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  dispatch(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

// The real DeputyDock block, as every internal page ships it (the Dashboard's copy).
const dockMarkup = (() => {
  const home = sourceFor('home-preview.html');
  return home.slice(
    home.indexOf('<!-- DeputyDock: start -->') + '<!-- DeputyDock: start -->'.length,
    home.indexOf('<!-- DeputyDock: end -->'),
  );
})();

interface GuideHandle {
  readonly element: FakeElement | null;
  readonly point: string | null;
  readonly speech: string;
  readonly active: boolean;
  update(next: { point?: string; speech?: string }): void;
  release(options?: { finished?: boolean }): void;
}

interface DeputyApi {
  guide(host: unknown, options?: { point?: string; speech?: string; demo?: boolean }): GuideHandle;
  readonly guiding: string | null;
  readonly tools: Record<string, string>;
  notice(options: {
    id?: string;
    kind?: string;
    text: string;
    href?: string;
    source?: string;
  }): void;
  clearNotice(id: string): void;
  readonly noticed: { id: string; kind: string; text: string; href: string | null } | null;
  set(state: string, options?: object): void;
  flash(state: string, options?: object): void;
  react(name: string, options?: object): void;
  hold(state?: string, options?: object): void;
  release(): void;
  pause(): void;
  play(): void;
  renderProp(element: unknown, name: string): void;
  get(element: unknown): { gesture(name: string): void; state: string | null } | null;
  init(): void;
  readonly paused: boolean;
  readonly reduced: boolean;
  readonly held: string | null;
  pageState: string | null;
  readonly states: string[];
  readonly reactions: string[];
  readonly gestures: string[];
  readonly reactionDefaults: Record<string, ReactionEntry & { pose: string; hold: number }>;
}

function boot({
  stored = {},
  reduced = false,
  loading = false,
  dock = true,
  armsHidden = false,
  world = null,
}: {
  stored?: Record<string, string>;
  reduced?: boolean;
  loading?: boolean;
  dock?: boolean;
  armsHidden?: boolean;
  world?: Record<string, unknown> | null;
} = {}) {
  const store = (initial: Record<string, string>) => {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, String(value)),
      removeItem: (key: string) => map.delete(key),
      map,
    };
  };
  const page = new FakePage();
  page.readyState = loading ? 'loading' : 'complete';
  if (dock) page.body.innerHTML = dockMarkup;
  page.activeElement = page.body;
  let now = 0;
  let serial = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const windowListeners = new Map<string, Listener[]>();
  const motionQuery = { matches: reduced, listeners: [] as Listener[] };
  const warnings: string[] = [];
  const localStorage = store(stored);
  const windowStub: Record<string, unknown> = {
    localStorage,
    sessionStorage: store({ 'jobdeputy.deputyArrived': 'done' }),
    matchMedia: () => ({
      get matches() {
        return motionQuery.matches;
      },
      addEventListener: (_type: string, listener: Listener) => motionQuery.listeners.push(listener),
    }),
    addEventListener: (type: string, listener: Listener) =>
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener]),
    setTimeout: (run: () => void, ms = 0) => {
      serial += 1;
      timers.set(serial, { at: now + Number(ms), run });
      return serial;
    },
    clearTimeout: (id: number) => timers.delete(id),
    performance: { now: () => now },
    getComputedStyle: (element: FakeElement) => ({
      display: armsHidden && element.classList.contains('panda-arm-right') ? 'none' : 'inline',
    }),
  };
  if (world) windowStub.JobDeputyStore = world;
  runInNewContext(script, {
    window: windowStub,
    document: page,
    console: { warn: (message: string) => warnings.push(message) },
    MutationObserver: class {
      observe(): void {}
      disconnect(): void {}
    },
    // Gestures and blinks wait the midpoint of their range; picks take the first option.
    Math: Object.create(Math, { random: { value: () => 0.5 } }),
  });
  const api = windowStub.JobDeputyDeputy as DeputyApi;
  const advance = (ms: number): void => {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].run();
    }
    now = until;
  };
  const host = page.querySelector('[data-deputy]');
  const q = (selector: string) => host?.querySelector(selector) ?? null;
  return {
    api,
    page,
    host,
    q,
    warnings,
    advance,
    timers,
    localStorage,
    emit: (type: string, event: Record<string, unknown>) => {
      for (const listener of windowListeners.get(type) ?? []) listener(event);
    },
    setReduced: (on: boolean) => {
      motionQuery.matches = on;
      for (const listener of motionQuery.listeners) listener({ matches: on });
    },
    click: (target: FakeElement | null) => page.dispatch('click', { target }),
    html: () => page.documentElement.getAttribute('data-motion'),
    duty: () => q('[data-deputy-duty]')?.textContent ?? null,
    speech: () => q('[data-deputy-speech]')?.textContent ?? null,
    labels: () =>
      (host?.querySelectorAll('[data-deputy-motion]') ?? []).map((button) => button.textContent),
  };
}

describe('deputy behaviour', () => {
  it('exposes one frozen global with the round 3 API', () => {
    const { api } = boot({ dock: false });
    for (const name of [
      'set',
      'flash',
      'react',
      'hold',
      'release',
      'pause',
      'play',
      'renderProp',
      'get',
      'init',
    ]) {
      expect(typeof (api as unknown as Record<string, unknown>)[name], name).toBe('function');
    }
    expect([...api.states]).toEqual(briefStates);
    expect([...api.reactions]).toEqual(briefReactions);
    expect([...api.gestures]).toEqual(['glance', 'tilt', 'nod', 'ear', 'sway', 'lift']);
    expect(api.reactionDefaults.added).toMatchObject({ pose: 'added', duty: 'Added', hold: 2605 });
    expect(api.reactionDefaults.error?.pose).toBe('error');
    expect(api.paused).toBe(false);
    expect(api.held).toBeNull();
    expect(api.pageState).toBeNull();
    expect(Object.isFrozen(api)).toBe(true);
  });

  it('warns once and changes nothing for unknown states, reactions, and props', () => {
    const { api, warnings, host } = boot();
    const before = host?.getAttribute('data-deputy-state');
    api.set('dancing');
    api.flash('dancing');
    api.react('juggled');
    api.react('constructor');
    api.hold('dancing');
    api.renderProp({}, 'trophy');
    expect(warnings).toEqual([
      'JobDeputyDeputy: unknown state "dancing" was ignored.',
      'JobDeputyDeputy: unknown state "dancing" was ignored.',
      'JobDeputyDeputy: unknown reaction "juggled" was ignored.',
      'JobDeputyDeputy: unknown reaction "constructor" was ignored.',
      'JobDeputyDeputy: unknown state "dancing" was ignored.',
      'JobDeputyDeputy: unknown prop "trophy" was ignored.',
    ]);
    expect(host?.getAttribute('data-deputy-state')).toBe(before);
    expect(api.held).toBeNull();
  });

  it('injects Show me around (hidden for the tour engine) and the panel’s Pause motion', () => {
    const { q, host } = boot();
    const tour = q('.deputy-activity-panel [data-tour-open]');
    expect(tour?.tagName).toBe('button');
    expect(tour?.getAttribute('type')).toBe('button');
    expect(tour?.className).toBe('deputy-panel-action');
    expect(tour?.getAttribute('data-tour-open')).toBe('');
    expect(tour?.hidden).toBe(true);
    expect(tour?.textContent).toBe('Show me around');
    expect(host?.querySelectorAll('[data-tour-open]')).toHaveLength(1);
    // The panel's status: the speech line, then a row of Pause motion and Show me around.
    const status = q('.deputy-activity-panel')?.children[0];
    expect(status?.className).toBe('deputy-panel-status');
    expect(status?.children.map((child) => child.className)).toEqual([
      'deputy-panel-speech',
      'deputy-panel-actions',
    ]);
    expect(q('.deputy-panel-actions')?.children.map((child) => child.className)).toEqual([
      'deputy-motion deputy-panel-motion',
      'deputy-panel-action',
    ]);
    expect(q('.deputy-panel-speech')?.textContent).toBe('Here’s what I found.');
    expect(q('.deputy-toggle-duty')?.textContent).toBe('Reporting in, ');
  });

  it('keeps a moment’s host (data-deputy-moment) out of the page-wide calls and the greeting (round 7, G3)', () => {
    expect(script).toContain(
      "const demo = host.hasAttribute('data-deputy-demo') || host.hasAttribute('data-deputy-moment');",
    );
    expect(css).toContain('[data-deputy-moment] > .deputy-art[data-deputy-art] {');
  });

  it('ends the Activity panel with See all activity, to Settings, Activity, keeping your place (round 7, SE1)', () => {
    const { q } = boot();
    const link = q('.deputy-activity-panel .deputy-activity-all');
    expect(link?.tagName).toBe('a');
    expect(link?.getAttribute('href')).toBe('./activity-preview.html');
    expect(link?.getAttribute('data-return-link')).toBe('');
    expect(link?.textContent).toBe('See all activity');
    expect(script).toContain("here !== 'activity-preview.html'");
    expect(css).toMatch(/\.deputy-activity-all \{[^}]*min-height: 44px;/);
  });

  it('sets html[data-motion] and shows the paused state: duty, labels, icons, and one announcement', () => {
    const { api, html, duty, labels, q, host, click, localStorage } = boot();
    expect(html()).toBe('on');
    expect(labels()).toEqual(['Pause motion', 'Pause motion']);
    expect(host?.querySelectorAll('.deputy-motion-icon[data-shape="pause"]')).toHaveLength(2);
    expect(q('.deputy-actions > .deputy-motion .deputy-motion-more')?.textContent).toBe(' motion');
    // Pause motion from the panel, as a person presses it.
    click(q('.deputy-panel-motion .deputy-motion-label'));
    expect(api.paused).toBe(true);
    expect(localStorage.getItem('jobdeputy.deputyMotion')).toBe('paused');
    expect(html()).toBe('paused');
    expect(host?.getAttribute('data-deputy-mode')).toBe('paused');
    expect(duty()).toBe('Motion paused');
    expect(q('.deputy-toggle-duty')?.textContent).toBe('Motion paused, ');
    expect(labels()).toEqual(['Play motion', 'Play motion']);
    expect(host?.querySelectorAll('.deputy-motion-icon[data-shape="play"]')).toHaveLength(2);
    expect(q('[data-deputy-announce]')?.textContent).toBe('Deputy motion paused.');
    expect(host?.hasAttribute('data-deputy-play')).toBe(false);
    // The panel stays open: the click counted as inside it.
    const details = q('.deputy-activity');
    if (details) details.open = true;
    click(q('.deputy-panel-motion .deputy-motion-label'));
    expect(details?.open).toBe(true);
    expect(html()).toBe('on');
    expect(duty()).toBe('Reporting in');
    expect(labels()).toEqual(['Pause motion', 'Pause motion']);
    expect(q('[data-deputy-announce]')?.textContent).toBe('Deputy motion on.');
    expect(localStorage.getItem('jobdeputy.deputyMotion')).toBeNull();
  });

  it('opens paused when the choice was saved, and follows other tabs and reduced motion', () => {
    const { api, html, duty, emit, localStorage, setReduced, labels } = boot({
      stored: { 'jobdeputy.deputyMotion': 'paused' },
    });
    expect(api.paused).toBe(true);
    expect(html()).toBe('paused');
    expect(duty()).toBe('Motion paused');
    expect(labels()).toEqual(['Play motion', 'Play motion']);
    // Another tab plays motion.
    localStorage.removeItem('jobdeputy.deputyMotion');
    emit('storage', { key: 'jobdeputy.deputyMotion', newValue: null });
    expect(html()).toBe('on');
    expect(duty()).toBe('Reporting in');
    // Another tab pauses, then clears all storage.
    localStorage.setItem('jobdeputy.deputyMotion', 'paused');
    emit('storage', { key: 'jobdeputy.deputyMotion', newValue: 'paused' });
    expect(html()).toBe('paused');
    localStorage.map.clear();
    emit('storage', { key: null });
    expect(html()).toBe('on');
    // Reduced motion: motion is off, but the duty keeps naming the work (nothing was paused).
    setReduced(true);
    expect(api.reduced).toBe(true);
    expect(html()).toBe('paused');
    expect(duty()).toBe('Reporting in');
    setReduced(false);
    expect(html()).toBe('on');
  });

  it('reacts once: the pose, duty, and line, then back to the page state without a replay', () => {
    const { api, host, duty, speech, advance } = boot();
    advance(600);
    api.react('added');
    expect(host?.getAttribute('data-deputy-state')).toBe('added');
    expect(host?.hasAttribute('data-deputy-play')).toBe(true);
    expect(duty()).toBe('Added');
    advance(200);
    expect(speech()).toBe('Added to Applications.');
    advance(2404);
    expect(host?.getAttribute('data-deputy-state')).toBe('added');
    advance(1);
    expect(host?.getAttribute('data-deputy-state')).toBe('report');
    expect(duty()).toBe('Reporting in');
    // The page state's one-time motion already played; settling back does not replay it.
    expect(host?.hasAttribute('data-deputy-play')).toBe(false);
    // A line of the page's own, and error's shared pose.
    api.react('error', { speech: 'That link didn’t open.' });
    advance(200);
    expect(host?.getAttribute('data-deputy-state')).toBe('error');
    expect(speech()).toBe('That link didn’t open.');
    expect(duty()).toBe('Needs attention');
  });

  it('says it is paused until you sign while the agreement pause is on, whatever it shows (D-10)', () => {
    let paused = true;
    const listeners: Array<() => void> = [];
    const { api, host, duty, speech, advance, q } = boot({
      world: {
        agreements: () => ({ paused }),
        subscribe: (listener: () => void) => listeners.push(listener),
      },
    });
    // Resting on the page state: the banner's words in the duty, and why it waits in the line.
    expect(duty()).toBe('Paused until you sign');
    advance(700);
    expect(speech()).toBe('I wait until you sign.');
    expect(q('.deputy-toggle-duty')?.textContent).toBe('Paused until you sign, ');
    expect(host?.getAttribute('data-deputy-agreement')).toBe('paused');
    // A reaction keeps its own line, but every duty gives way to the pause.
    api.react('saved');
    expect(duty()).toBe('Paused until you sign');
    advance(200);
    expect(speech()).toBe('Saved. I’ll use this.');
    advance(2605);
    expect(speech()).toBe('I wait until you sign.');
    // A page state set meanwhile (a search page, a fill) names the pause too.
    api.set('search');
    expect(duty()).toBe('Paused until you sign');
    // Signing brings the page's own words back at once.
    paused = false;
    for (const listener of listeners) listener();
    expect(duty()).toBe('Searching');
    advance(700);
    expect(speech()).toBe('Checking your sources now.');
    expect(host?.hasAttribute('data-deputy-agreement')).toBe(false);
  });

  it('reacts at once while paused or under reduced motion, with no motion attribute', () => {
    for (const [options, resting] of [
      [{ stored: { 'jobdeputy.deputyMotion': 'paused' } }, 'Motion paused'],
      [{ reduced: true }, 'Reporting in'],
    ] as const) {
      const { api, host, duty, speech, advance } = boot(options);
      api.react('saved');
      expect(host?.getAttribute('data-deputy-state')).toBe('saved');
      expect(host?.hasAttribute('data-deputy-play')).toBe(false);
      expect(speech()).toBe('Saved. I’ll use this.');
      // A reaction names itself even while paused, so the chip still answers the action.
      expect(duty()).toBe('Saved');
      advance(2605);
      expect(host?.getAttribute('data-deputy-state')).toBe('report');
      expect(duty()).toBe(resting);
    }
  });

  it('holds the guide through a tour: reactions return to it, page states wait for release', () => {
    const { api, host, duty, advance } = boot();
    api.hold('guide');
    expect(api.held).toBe('guide');
    expect(host?.getAttribute('data-deputy-state')).toBe('guide');
    expect(host?.hasAttribute('data-deputy-held')).toBe(true);
    expect(duty()).toBe('Showing you around');
    api.react('copied');
    expect(host?.getAttribute('data-deputy-state')).toBe('copied');
    advance(2605);
    expect(host?.getAttribute('data-deputy-state')).toBe('guide');
    api.pageState = 'rank';
    expect(host?.getAttribute('data-deputy-state')).toBe('guide');
    api.set('track');
    expect(host?.getAttribute('data-deputy-state')).toBe('guide');
    api.release();
    expect(api.held).toBeNull();
    expect(host?.hasAttribute('data-deputy-held')).toBe(false);
    expect(host?.getAttribute('data-deputy-state')).toBe('track');
    expect(api.pageState).toBe('track');
    api.release();
    expect(host?.getAttribute('data-deputy-state')).toBe('track');
  });

  // Round 6 (G6, R6-2): the deputy gives the tour. guide() draws the tour panda in the tour card,
  // and the dock's panda steps out until release.
  it('steps the dock out while a guide shows, and returns with one celebrate when finished', () => {
    const { api, page, host, duty, speech, advance } = boot();
    const card = page.createElement('div');
    card.setAttribute('data-deputy-guide-card', '');
    const slot = page.createElement('span');
    const line = page.createElement('p');
    line.setAttribute('data-deputy-guide-speech', '');
    card.append(slot, line);
    page.body.append(card);
    const guide = api.guide(slot, { point: 'left', speech: 'Your sources live here.' });
    expect(guide.active).toBe(true);
    expect(api.guiding).toBe('left');
    expect(guide.element?.getAttribute('class')).toBe('deputy-guide');
    expect(guide.element?.getAttribute('aria-hidden')).toBe('true');
    expect(guide.element?.getAttribute('data-point')).toBe('left');
    expect(line.textContent).toBe('Your sources live here.');
    // Its ids are its own, never the dock's.
    const ids = (root: FakeElement | null | undefined): string[] =>
      (root?.querySelectorAll('clipPath') ?? []).map((clip) => clip.getAttribute('id') ?? '');
    const dockIds = ids(host?.querySelector('[data-deputy-art]'));
    expect(ids(guide.element).length).toBe(2);
    for (const id of ids(guide.element)) expect(dockIds).not.toContain(id);
    // One panda per viewport: the dock shows the ledge and the bamboo, with its own words.
    expect(host?.hasAttribute('data-deputy-away')).toBe(true);
    expect(duty()).toBe('Showing you around');
    expect(speech()).toBe('I’m in the tour card.');
    // Work meanwhile is remembered, never shown on the empty ledge.
    api.react('saved');
    expect(duty()).toBe('Showing you around');
    advance(2605);
    guide.update({ point: 'up', speech: 'I count your runs up here.' });
    expect(guide.element?.getAttribute('data-point')).toBe('up');
    expect(guide.point).toBe('up');
    expect(line.textContent).toBe('I count your runs up here.');
    guide.release({ finished: true });
    expect(guide.active).toBe(false);
    expect(api.guiding).toBeNull();
    expect(slot.querySelector('.deputy-guide')).toBeNull();
    expect(host?.hasAttribute('data-deputy-away')).toBe(false);
    expect(host?.getAttribute('data-deputy-state')).toBe('celebrate');
    expect(duty()).toBe('Well done');
    advance(2605);
    expect(host?.getAttribute('data-deputy-state')).toBe('report');
    guide.release({ finished: true });
    expect(host?.getAttribute('data-deputy-state')).toBe('report');
  });

  it('returns quietly when a tour is skipped, warns on a bad direction, and never throws', () => {
    const { api, page, host, warnings } = boot();
    const slot = page.createElement('span');
    page.body.append(slot);
    const guide = api.guide(slot, { point: 'right' });
    guide.update({ point: 'sideways' });
    expect(guide.point).toBe('right');
    expect(warnings.some((line) => line.includes('point "sideways"'))).toBe(true);
    guide.release();
    expect(host?.getAttribute('data-deputy-state')).toBe('report');
    expect(host?.hasAttribute('data-deputy-play')).toBe(false);
    // A second guide releases the first quietly; no host gives an inert handle.
    const first = api.guide(slot, { point: 'down' });
    const second = api.guide(slot, { point: 'up' });
    expect(first.active).toBe(false);
    expect(second.active).toBe(true);
    expect(slot.querySelectorAll('.deputy-guide')).toHaveLength(1);
    second.release();
    const inert = api.guide(null);
    expect(inert.active).toBe(false);
    expect(() => inert.update({ point: 'left' })).not.toThrow();
    // hold('guide') and release() keep working for callers that still use them.
    api.hold('guide');
    expect(host?.getAttribute('data-deputy-state')).toBe('guide');
    api.release();
    expect(api.held).toBeNull();
  });

  // Round 6 (UAT M-19): a background notice lives with the deputy, so on phones it sits in the
  // app bar's chip and never floats over the page.
  it('carries a background notice in its duty until Activity opens, and picks up new ones', () => {
    let data = {
      now: [],
      needsYou: [
        { id: 'old-notice', kind: 'notice', title: 'An older notice', href: './home-preview.html' },
      ],
      done: [],
    };
    const listeners: Array<() => void> = [];
    const { api, host, duty, advance, page } = boot({
      world: {
        activity: () => data,
        subscribe: (listener: () => void) => listeners.push(listener),
        onTick: (listener: () => void) => listeners.push(listener),
      },
    });
    // What was there when the page opened never shows again.
    expect(host?.hasAttribute('data-deputy-notice')).toBe(false);
    expect(duty()).toBe('Reporting in');
    data = {
      ...data,
      needsYou: [
        ...data.needsYou,
        {
          id: 'test-failed',
          kind: 'notice',
          title: 'Version 3 did not pass',
          href: './prompts-preview.html',
        },
      ],
    };
    for (const listener of listeners) listener();
    expect(host?.getAttribute('data-deputy-notice')).toBe('needs-you');
    expect(duty()).toBe('Needs you');
    expect(api.noticed?.text).toBe('Version 3 did not pass');
    // Opening Activity, where it is listed, clears it.
    const activity = host?.querySelector('.deputy-activity');
    activity?.setAttribute('open', '');
    page.dispatch('toggle', { target: activity });
    expect(host?.hasAttribute('data-deputy-notice')).toBe(false);
    expect(duty()).toBe('Reporting in');
    // A done notice clears on its own after 13s.
    api.notice({ id: 'saved', kind: 'done', text: 'Saved in the background' });
    expect(duty()).toBe('Done');
    advance(13000);
    expect(duty()).toBe('Reporting in');
  });

  // Round 6 (UAT RM-3, A3's request 7): a page's own notice stays until Activity opens or the page
  // clears it; the store clears only the notices it listed.
  it('keeps a page notice through store ticks and clears it only for its own id', () => {
    let data: { now: unknown[]; needsYou: Array<Record<string, string>>; done: unknown[] } = {
      now: [],
      needsYou: [],
      done: [],
    };
    const listeners: Array<() => void> = [];
    const { api, duty } = boot({
      world: {
        activity: () => data,
        subscribe: (listener: () => void) => listeners.push(listener),
        onTick: (listener: () => void) => listeners.push(listener),
      },
    });
    const tick = () => {
      for (const listener of listeners) listener();
    };
    api.notice({
      id: 'apply-x-waiting:questions',
      kind: 'needs-you',
      text: 'Two answers needed',
      source: 'page',
    });
    tick();
    tick();
    expect(duty()).toBe('Needs you');
    api.clearNotice('another-id');
    expect(duty()).toBe('Needs you');
    api.clearNotice('apply-x-waiting:questions');
    expect(duty()).toBe('Reporting in');
    // An apply job waiting for you, listed by the store, shows and clears when it leaves the list.
    data = {
      ...data,
      needsYou: [
        {
          id: 'apply-x',
          kind: 'apply-job',
          title: 'Answer 2 questions for X',
          href: './applications-preview.html',
        },
      ],
    };
    tick();
    expect(duty()).toBe('Needs you');
    expect(api.noticed?.id).toBe('apply-x');
    // A done notice that arrives meanwhile never hides it.
    data = { ...data, done: [{ id: 'saved-y', kind: 'done', text: 'Saved Y' }] };
    tick();
    expect(api.noticed?.id).toBe('apply-x');
    data = { ...data, needsYou: [] };
    tick();
    expect(duty()).toBe('Reporting in');
  });

  it('steps a dock out that is adopted after the tour started', () => {
    const { api, page, host, duty } = boot({ loading: true });
    const slot = page.createElement('span');
    page.body.append(slot);
    const guide = api.guide(slot, { point: 'down' });
    page.dispatch('DOMContentLoaded');
    expect(host?.hasAttribute('data-deputy-away')).toBe(true);
    expect(duty()).toBe('Showing you around');
    guide.release();
    expect(host?.hasAttribute('data-deputy-away')).toBe(false);
  });

  it('names the tool in the right paw on the host for every state and reaction', () => {
    const { api, host } = boot();
    for (const state of api.states.filter((name) => !['success', 'arrive'].includes(name))) {
      api.set(state);
      expect(host?.getAttribute('data-deputy-tool'), state).toBe(api.tools[state]);
    }
    for (const name of api.reactions) {
      api.react(name);
      expect(host?.getAttribute('data-deputy-tool'), name).toBe(
        api.tools[name === 'error' ? 'error' : name],
      );
    }
    // The badge (rail and chip) draws the same tool, with the paw at its grip.
    expect(host?.querySelector('.deputy-badge .deputy-badge-tool ellipse')).not.toBeNull();
  });

  it('applies a hold made before the dock is adopted (a tour that starts first)', () => {
    const { api, page, host } = boot({ loading: true });
    expect(host?.hasAttribute('data-deputy-state')).toBe(true);
    api.hold('guide');
    page.dispatch('DOMContentLoaded');
    expect(host?.getAttribute('data-deputy-state')).toBe('guide');
    expect(api.held).toBe('guide');
    // The Show me around button was in the markup before DOMContentLoaded.
    expect(host?.querySelector('[data-tour-open]')).not.toBeNull();
  });

  it('gestures at rest every 13 to 21s, picked for the state, never while paused or hidden', () => {
    const { api, host, advance, page } = boot();
    const gestures: string[] = [];
    const record = () => {
      const value = host?.getAttribute('data-deputy-gesture');
      if (value && gestures.at(-1) !== value) gestures.push(value);
    };
    // With Math.random at 0.5 the first gesture comes 15s after the page shows, then every 17s.
    for (let t = 0; t < 14900; t += 100) {
      advance(100);
      record();
    }
    expect(gestures).toHaveLength(0);
    for (let t = 0; t < 2200; t += 100) {
      advance(100);
      record();
    }
    expect(gestures).toHaveLength(1);
    expect(['lift', 'glance', 'nod', 'ear-left', 'ear-right']).toContain(gestures[0]);
    expect(host?.hasAttribute('data-deputy-play')).toBe(false);
    for (let t = 0; t < 40000; t += 100) {
      advance(100);
      record();
    }
    expect(gestures.length).toBeGreaterThanOrEqual(3);
    // Paused: no gesture and no timer, however long it waits.
    api.pause();
    expect(host?.hasAttribute('data-deputy-gesture')).toBe(false);
    const count = gestures.length;
    advance(60000);
    record();
    expect(gestures.length).toBe(count);
    // Play: no replay of finished motion; a blink soon, gestures again later.
    api.play();
    expect(host?.hasAttribute('data-deputy-play')).toBe(false);
    advance(400);
    expect(host?.hasAttribute('data-deputy-blink')).toBe(true);
    for (let t = 0; t < 21000; t += 100) {
      advance(100);
      record();
    }
    expect(gestures.length).toBe(count + 1);
    // Hidden: nothing until the page shows again.
    page.hidden = true;
    page.dispatch('visibilitychange');
    const hiddenCount = gestures.length;
    advance(60000);
    record();
    expect(gestures.length).toBe(hiddenCount);
  });

  it('picks head gestures only where the arms are hidden, and none during a work loop', () => {
    const small = boot({ armsHidden: true });
    const seen = new Set<string>();
    for (let t = 0; t < 120000; t += 100) {
      small.advance(100);
      const value = small.host?.getAttribute('data-deputy-gesture');
      if (value) seen.add(value);
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const value of seen) expect(['sway', 'lift']).not.toContain(value);
    const working = boot();
    working.api.set('search', { working: true });
    let any = false;
    for (let t = 0; t < 60000; t += 100) {
      working.advance(100);
      any ||= working.host?.hasAttribute('data-deputy-gesture') ?? false;
    }
    expect(any).toBe(false);
  });

  it('renders the Activity lists from the sample world and keeps them in step, in place', () => {
    interface Activity {
      now: Array<{ id: string; text: string; detail?: string; href: string }>;
      needsYou: Array<{ id: string; title: string; href: string }>;
      done: Array<{ id: string; text: string; when?: string; href?: string }>;
    }
    let data: Activity = {
      now: [
        {
          id: 'r11',
          text: 'Searching Amazon Jobs',
          detail: 'Queued',
          href: './searches-preview.html?source=amazon&live=1',
        },
      ],
      needsYou: [
        {
          id: 'approve-search-infra',
          title: 'Approve materials for Search Infrastructure',
          href: './materials-preview.html?app=search-infra&from=applications',
        },
      ],
      done: [{ id: 'r8', text: 'Saved 7 new roles from Google Careers', when: 'yesterday' }],
    };
    const listeners: Array<() => void> = [];
    const { host, page } = boot({
      world: {
        activity: () => data,
        subscribe: (listener: () => void) => listeners.push(listener),
        onTick: (listener: () => void) => listeners.push(listener),
      },
    });
    const lists = host?.querySelectorAll('.deputy-activity-panel .deputy-activity-list') ?? [];
    const text = () => lists.map((list) => list.children.map((row) => row.textContent));
    expect(text()).toEqual([
      ['Searching Amazon Jobs · Queued'],
      ['Approve materials for Search Infrastructure'],
      ['Saved 7 new roles from Google Careers · yesterday'],
    ]);
    expect(lists[0]?.querySelector('a')?.getAttribute('href')).toBe(
      './searches-preview.html?source=amazon&live=1',
    );
    expect(lists[2]?.querySelector('a')).toBeNull();
    expect(listeners).toHaveLength(2);
    // A live tick updates the same link in place, so focus on it stays.
    const link = lists[0]?.querySelector('a');
    link?.focus();
    data = { ...data, now: data.now.map((item) => ({ ...item, detail: 'Reading listings' })) };
    for (const listener of listeners) listener();
    expect(lists[0]?.querySelector('a')).toBe(link);
    expect(link?.textContent).toBe('Searching Amazon Jobs · Reading listings');
    expect(page.activeElement).toBe(link);
    // The run completes and nothing needs you.
    data = {
      now: [],
      needsYou: [],
      done: [
        { id: 'r11', text: 'Saved 2 new roles from Amazon Jobs', when: 'just now' },
        ...data.done,
      ],
    };
    for (const listener of listeners) listener();
    expect(text()).toEqual([
      ['Nothing running right now.'],
      ['Nothing needs you right now.'],
      [
        'Saved 2 new roles from Amazon Jobs · just now',
        'Saved 7 new roles from Google Careers · yesterday',
      ],
    ]);
  });

  it('draws the form and envelope props on their own', () => {
    const { api, warnings } = boot({ dock: false });
    for (const name of ['form', 'envelope']) {
      const attributes: Record<string, string> = {};
      const element = {
        innerHTML: '',
        setAttribute: (attribute: string, value: string) => {
          attributes[attribute] = value;
        },
        querySelector: () => null,
      };
      api.renderProp(element, name);
      expect(element.innerHTML).toMatch(
        /^<svg class="deputy-prop-art" viewBox="0 0 160 160" aria-hidden="true" focusable="false">/,
      );
      expect(attributes['data-deputy-prop-drawn']).toBe(name);
    }
    expect(warnings).toEqual([]);
    expect(pure.props.form).toContain('class="deputy-fill-tick deputy-fill-tick-3"');
    expect(pure.props.form, 'the pen rests beside the form').toContain('<path d="M-9 10L27 -26"');
    expect(pure.props.envelope).toContain('class="deputy-ticket-mark"');
  });
});

// ------------------------------------------------------------------ the cast sheet
describe('deputy cast sheet', () => {
  it('shows every state at dock size with its default duty and speech', () => {
    for (const [state, entry] of Object.entries(pure.states)) {
      const card = castSheet.match(
        new RegExp(
          `<article class="cast-card" aria-labelledby="cast-card-${state}">([\\s\\S]*?)</article>`,
        ),
      )?.[1];
      expect(card, `${state} card`).toBeDefined();
      expect(card).toContain(`data-deputy-size="dock"`);
      expect(card).toContain(`data-deputy-state="${state}"`);
      expect(card).toContain(`<span data-deputy-duty>${entry.duty}</span>`);
      expect(card).toContain(`data-deputy-speech>${entry.speech}</p>`);
      expect(card).toContain('data-cast-replay');
      expect(castSheet, `${state} legend row`).toContain(
        `<strong class="cast-legend-state">${state}</strong>`,
      );
      expect(castSheet, `${state} in the scene picker`).toContain(
        `name="cast-scene-state" value="${state}"`,
      );
    }
  });

  it('shows the five other sizes and the controls', () => {
    for (const size of ['compact', 'rail', 'chip', 'row']) {
      expect(castSheet).toContain(`data-deputy-size="${size}"`);
    }
    expect(castSheet).toMatch(/class="deputy-scene"[\s\S]*?data-deputy-demo/);
    expect(castSheet).toContain('id="cast-replay-all"');
    expect(castSheet).toMatch(/<button class="secondary-action" type="button" data-deputy-motion>/);
    expect(castSheet).toContain('id="cast-reduced"');
    expect(castSheet).toContain('<link rel="stylesheet" href="./app-chrome.css" />');
    expect(castSheet).toContain('<link rel="stylesheet" href="./deputy.css" />');
    expect(castSheet).toContain('<script src="./deputy.js"></script>');
    for (const prop of Object.keys(pure.props)) {
      expect(castSheet).toContain(`data-deputy-prop="${prop}"`);
    }
  });

  it('shows fill and invite at every size, and the phone scene with Pause motion', () => {
    for (const state of ['fill', 'invite']) {
      const strip =
        castSheet.match(
          new RegExp(
            `<article class="cast-strip" aria-labelledby="cast-strip-${state}">([\\s\\S]*?)</article>`,
          ),
        )?.[1] ?? '';
      expect(strip, `${state} strip`).not.toBe('');
      const hosts = [...strip.matchAll(/<div\s+class="(deputy-dock|deputy-scene)"[^>]*>/g)].map(
        (match) => match[0],
      );
      for (const host of hosts) expect(host).toContain(`data-deputy-state="${state}"`);
      const sizes = hosts.map(
        (host) =>
          `${host.includes('deputy-scene') ? 'scene' : 'dock'}:${host.match(/data-deputy-size="([^"]+)"/)?.[1] ?? 'auto'}`,
      );
      expect(sizes.sort()).toEqual(
        ['dock:chip', 'dock:compact', 'dock:dock', 'dock:rail', 'scene:auto', 'scene:row'].sort(),
      );
    }
    expect(castSheet).toContain('<input type="checkbox" data-cast-working />Filling in progress');
    const phone =
      castSheet.match(/<div class="cast-phone is-setup">([\s\S]*?)<figcaption>/)?.[1] ?? '';
    expect(phone).toMatch(/class="deputy-scene"[\s\S]*?data-deputy-size="row"/);
    expect(phone).toContain(
      '<div class="deputy-actions"><button class="deputy-motion" type="button" data-deputy-motion>Pause motion</button></div>',
    );
    expect(phone).toContain('<p class="sr-only" data-deputy-announce role="status"></p>');
  });

  it('shows every reaction at dock size with its default duty and speech, a Replay, and a legend row', () => {
    for (const [name, entry] of Object.entries(pure.reactions)) {
      const card = castSheet.match(
        new RegExp(
          `<article class="cast-card" aria-labelledby="cast-react-${name}">([\\s\\S]*?)</article>`,
        ),
      )?.[1];
      expect(card, `${name} card`).toBeDefined();
      expect(card).toContain('data-deputy-size="dock"');
      expect(card).toContain(`data-deputy-state="${name}"`);
      expect(card).toContain(`<span data-deputy-duty>${entry.duty}</span>`);
      expect(card).toContain(`data-deputy-speech>${entry.speech}</p>`);
      expect(card).toContain('data-cast-replay');
      expect(castSheet, `${name} on the scene`).toContain(`data-cast-scene-react="${name}"`);
    }
    const legend =
      castSheet.match(/<div class="cast-legend cast-legend-reactions">([\s\S]*?)<\/ol>/)?.[1] ?? '';
    for (const name of briefReactions) {
      expect(legend, `${name} legend row`).toContain(
        `<strong class="cast-legend-state">${name}</strong>`,
      );
    }
  });

  it('shows every idle gesture with a Play button, and a live strip that gestures at every size', () => {
    for (const name of Object.keys(pure.gestures)) {
      const card = castSheet.match(
        new RegExp(
          `<article class="cast-card" aria-labelledby="cast-gesture-${name}">([\\s\\S]*?)</article>`,
        ),
      )?.[1];
      expect(card, `${name} card`).toContain(`data-cast-gesture="${name}"`);
      const state = card?.match(/data-deputy-state="([^"]+)"/)?.[1] ?? '';
      expect(pure.gestureSets[state]?.gestures, `${name} rests in a state that uses it`).toContain(
        name,
      );
      expect(castSheet, `${name} on the scene`).toContain(`data-cast-scene-gesture="${name}"`);
    }
    const live =
      castSheet.match(/<article class="cast-strip cast-live"[\s\S]*?<\/article>/)?.[0] ?? '';
    const hosts = [...live.matchAll(/<div\s+class="(deputy-dock|deputy-scene)"[^>]*>/g)].map(
      (match) => match[0],
    );
    for (const host of hosts) expect(host).toContain('data-deputy-idle');
    expect(
      hosts
        .map(
          (host) =>
            `${host.includes('deputy-scene') ? 'scene' : 'dock'}:${host.match(/data-deputy-size="([^"]+)"/)?.[1] ?? 'auto'}`,
        )
        .sort(),
    ).toEqual(
      ['dock:chip', 'dock:compact', 'dock:dock', 'dock:rail', 'scene:auto', 'scene:row'].sort(),
    );
    // Only that strip gestures on its own; every other card holds still.
    expect(castSheet.match(/data-deputy-idle/g)).toHaveLength(6);
  });

  it('shows the paused state pinned at every size, each with its own Play motion', () => {
    const section =
      castSheet.match(
        /<section class="cast-section" aria-labelledby="cast-paused-title">[\s\S]*?<\/section>/,
      )?.[0] ?? '';
    const hosts = [...section.matchAll(/<div\s+class="(deputy-dock|deputy-scene)"[^>]*>/g)].map(
      (match) => match[0],
    );
    expect(hosts).toHaveLength(5);
    for (const host of hosts) expect(host).toContain('data-deputy-preview-mode="paused"');
    expect(section.match(/data-deputy-motion/g)).toHaveLength(5);
    expect(section.match(/data-deputy-announce role="status"/g)).toHaveLength(5);
    // A pinned demo toggles itself; the sheet's own Pause motion toggles the page.
    expect(script).toContain("deputy.pin = deputy.pin === 'paused' ? 'on' : 'paused';");
  });

  // Round 6: the hand rule, the tour, the test state, and the smile options.
  it('lists the tool in each paw for every state, moment, and reaction', () => {
    const rows = [...castSheet.matchAll(/<tr data-cast-tool="([\w-]+)">/g)].map(
      (match) => match[1],
    );
    expect([...rows].sort()).toEqual(Object.keys(toolsTable).sort());
    expect(castSheet).toContain('<h2 id="cast-hands-title">A tool in the right paw, always.</h2>');
  });

  it('shows the tour panda in four directions and the dock stepped out at every dock size', () => {
    const section =
      castSheet.match(
        /<section class="cast-section" aria-labelledby="cast-tour-title">[\s\S]*?\n {6}<\/section>/,
      )?.[0] ?? '';
    expect(section).not.toBe('');
    expect([...section.matchAll(/data-cast-guide="(\w+)"/g)].map((match) => match[1])).toEqual([
      'left',
      'right',
      'up',
      'down',
    ]);
    const away = [...section.matchAll(/<div\s+class="deputy-dock"[^>]*>/g)].map(
      (match) => match[0],
    );
    expect(away.map((host) => host.match(/data-deputy-size="([^"]+)"/)?.[1]).sort()).toEqual(
      ['chip', 'compact', 'dock', 'rail'].sort(),
    );
    for (const host of away) expect(host).toContain('data-deputy-away');
    expect(section.match(/<span data-deputy-duty>Showing you around<\/span>/g)).toHaveLength(4);
    expect(castSheet).toContain(
      'deputy.guide(slot, { point: slot.dataset.castGuide, demo: true })',
    );
    expect(castSheet).toContain('id="cast-tour-turn"');
  });

  it('shows test at every size, with Testing in progress', () => {
    const strip =
      castSheet.match(
        /<article class="cast-strip" aria-labelledby="cast-strip-test">([\s\S]*?)<\/article>/,
      )?.[1] ?? '';
    const hosts = [...strip.matchAll(/<div\s+class="(deputy-dock|deputy-scene)"[^>]*>/g)].map(
      (match) => match[0],
    );
    expect(hosts).toHaveLength(6);
    for (const host of hosts) expect(host).toContain('data-deputy-state="test"');
    expect(strip).toContain(
      '<input type="checkbox" data-cast-working="test" />Testing in progress',
    );
  });

  it('keeps the two other smiles for the owner on the cast sheet only', () => {
    const section =
      castSheet.match(
        /<section class="cast-section" aria-labelledby="cast-smiles-title">[\s\S]*?\n {6}<\/section>/,
      )?.[0] ?? '';
    expect(section).toContain('12 · Smile options (for the owner)');
    for (const key of ['a', 'b', 'c']) expect(section).toContain(`id="cast-smile-${key}"`);
    expect(section.match(/data-cast-smile="b"/g)).toHaveLength(4);
    expect(section.match(/data-cast-smile="c"/g)).toHaveLength(4);
    expect(castSheet.match(/data-cast-smile="/g)).toHaveLength(8);
    // Nothing else draws them: the shared drawing has one resting smile.
    for (const file of ['deputy.js', 'login-preview.html', 'access-preview.html']) {
      expect(sourceFor(file)).not.toContain('Q198 215.5 210 215.5');
    }
  });

  it('marks every cast-sheet deputy as a demo, so none arrives or replays on its own', () => {
    const hosts = [...castSheet.matchAll(/<(?:div|aside)\s[^>]*\sdata-deputy(?=[\s>])[^>]*>/g)].map(
      (match) => match[0],
    );
    expect(hosts.length).toBeGreaterThanOrEqual(briefStates.length + 4);
    for (const host of hosts) expect(host).toContain('data-deputy-demo');
  });
});

// ------------------------------------------------------------------ app pages
describe('deputy on app pages', () => {
  const pages = readdirSync(brandDirectory).filter(
    (name) =>
      name.endsWith('-preview.html') && sourceFor(name).includes('<!-- DeputyDock: start -->'),
  );

  it.each(pages)('%s loads the deputy styles and script', (file) => {
    const source = sourceFor(file);
    expect(source).toContain('<link rel="stylesheet" href="./deputy.css" />');
    expect(source).toContain('<script src="./deputy.js"></script>');
    const dock = source.slice(
      source.indexOf('<!-- DeputyDock: start -->'),
      source.indexOf('<!-- DeputyDock: end -->'),
    );
    const state = dock.match(/data-deputy-state="([^"]+)"/)?.[1] ?? '';
    expect(briefStates, `${file} starts in a brief state`).toContain(state);
    expect(dock).not.toContain('data-deputy-demo');
  });
});

describe('deputy Activity panel placement', () => {
  it('re-lays out a fixed panel that first opens outside the viewport (round 3 UAT D1)', () => {
    const keep = script.slice(script.indexOf('const keepPanelInView'));
    const body = keep.slice(0, keep.indexOf('\n  };') + 4);
    expect(body).toContain('if (rect.bottom <= 0 || rect.top >= window.innerHeight) {');
    expect(body).toContain("panel.style.display = 'none';");
    expect(body).toContain('void panel.offsetHeight;');
    expect(body).toContain("panel.style.removeProperty('display');");
  });
});
