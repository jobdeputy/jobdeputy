import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Guards for AI Boost (round 8, the owner's ask of October 25, 2026): the Dashboard's larger,
// detailed panda deputy (brand/ai-boost.js and brand/ai-boost.css). Static checks of the markup,
// the stylesheet, and deputy.js's lend API, and the state mapping run against the real script.
// Rendered behaviour (poses, layout at each width, Pause motion, reduced motion) is checked in
// headless Chrome.

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');
const home = sourceFor('home-preview.html');
const script = sourceFor('ai-boost.js');
const css = sourceFor('ai-boost.css');
const deputy = sourceFor('deputy.js');

const panel = home.slice(home.indexOf('<!-- AI Boost: start'), home.indexOf('<!-- AI Boost: end -->'));

type Detail = { state: string; working?: boolean; guided?: boolean; duty?: string; speech?: string };
type Boost = {
  states: readonly string[];
  stateFor: (detail: Detail | null, live?: number) => string;
  lineFor: (detail: Detail) => string;
};

const loadBoost = (): Boost => {
  const window: Record<string, unknown> = {
    JobDeputyDeputy: {
      defaults: {
        pending: { speech: 'On it.' },
        search: { speech: 'Checking your sources now.' },
        success: { speech: 'All set.' },
        report: { speech: 'Here’s what I found.' },
      },
    },
  };
  // No panel on the page: the script defines its mapping and stops.
  const document = { querySelector: () => null };
  runInNewContext(script, { window, document });
  return window.JobDeputyBoost as Boost;
};

describe('AI Boost on the Dashboard', () => {
  it('links its styles after the deputy’s and loads its script after the page’s own', () => {
    expect(home).toContain(
      '<link rel="stylesheet" href="./deputy.css" />\n    <link rel="stylesheet" href="./ai-boost.css" />',
    );
    expect(home.indexOf('<script src="./ai-boost.js"></script>')).toBeGreaterThan(
      home.lastIndexOf('</script>', home.indexOf('<script src="./ai-boost.js"></script>') - 1),
    );
    expect(home.split('<script src="./ai-boost.js"></script>')).toHaveLength(2);
  });

  it('is laid out by CSS from the first paint, and lends the dock’s panda only from the script', () => {
    expect(panel).toMatch(/<aside class="ai-boost" id="ai-boost"[^>]* data-boost data-boost-state="idle">/);
    expect(css).toMatch(/@media \(max-width: 720px\) \{\n {2}\.ai-boost \{\n {4}display: none;/);
    expect(deputy).not.toContain('[data-boost]');
    expect(script).toContain("deputy.lend({ speech: 'I’m in AI Boost.' });");
  });

  it('draws no deputy host of its own (one panda per viewport)', () => {
    expect(panel).not.toMatch(/data-deputy(?:-art)?[\s>=]/);
  });

  it('names the panda button and keeps speech and duty out of live regions', () => {
    expect(panel).toContain('<button class="ai-boost-stage" type="button" data-boost-stage aria-label="Your deputy: open Activity"');
    expect(panel).toContain('<h2 class="sr-only" id="ai-boost-title">AI Boost</h2>');
    expect(panel).not.toMatch(/aria-live|role="status"|role="alert"/);
  });

  it('stops its click from reaching the dock’s outside-click-closes-Activity handler', () => {
    // Without this, opening Activity from the panel (document.ts:FAIL comment reproduced in prose)
    // immediately closes again: the button lives outside the dock, so the same click event, once
    // it reaches document, reads as an outside click on the panel it just opened.
    const click = script.slice(script.indexOf("stage.addEventListener('click', (event) => {"));
    const body = click.slice(0, click.indexOf('});') + 3);
    expect(body).toContain('event.stopPropagation();');
    expect(body.indexOf('event.stopPropagation();')).toBeLessThan(body.indexOf('summary.click();'));
  });
});

describe('the AI Boost states', () => {
  const boost = loadBoost();

  it.each([
    [{ state: 'report' }, 0, 'idle'],
    [{ state: 'report' }, 1, 'processing'],
    [{ state: 'search', working: true }, 0, 'processing'],
    [{ state: 'tailor', working: true }, 0, 'processing'],
    [{ state: 'pending' }, 0, 'thinking'],
    [{ state: 'started' }, 0, 'thinking'],
    [{ state: 'success' }, 0, 'success'],
    [{ state: 'found' }, 0, 'success'],
    [{ state: 'celebrate' }, 1, 'celebrate'],
    [{ state: 'saved' }, 0, 'done'],
    [{ state: 'added' }, 0, 'done'],
    [{ state: 'error' }, 1, 'error'],
    [{ state: 'arrive' }, 0, 'hello'],
    [{ state: 'notice' }, 0, 'curious'],
    [{ state: 'report', guided: true }, 1, 'away'],
  ] as const)('%j with %d live runs shows %s', (detail, live, expected) => {
    expect(boost.stateFor(detail, live)).toBe(expected);
    expect(boost.states).toContain(expected);
  });

  it('adds personality only where the deputy says its default line', () => {
    expect(boost.lineFor({ state: 'pending', speech: 'On it.' })).toBe('On it. Thinking cap on.');
    expect(boost.lineFor({ state: 'search', speech: 'Checking your first source.' })).toBe(
      'Checking your first source.',
    );
    expect(boost.lineFor({ state: 'found', speech: '2 new roles for you.' })).toBe('2 new roles for you.');
    expect(boost.lineFor({ state: 'report', speech: 'Here’s what I found.' })).toBe('Here’s what I found.');
  });

  it('keeps every line first person or factual, six words or fewer, and never says Oops', () => {
    const block = script.slice(script.indexOf('const LINES = {'), script.indexOf('};', script.indexOf('const LINES = {')));
    const lines = [...block.matchAll(/^\s{4}[a-z]+: '([^']+)'/gm)].map((match) => match[1] ?? '');
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.split(/\s+/).length, line).toBeLessThanOrEqual(6);
    }
    expect(script).not.toMatch(/\bOops\b/i);
  });
});

describe('the AI Boost styles', () => {
  it('styles every state it can show', () => {
    for (const state of ['idle', 'curious', 'thinking', 'processing', 'success', 'celebrate', 'done', 'error', 'hello', 'away']) {
      expect(css, state).toContain(`[data-boost-state="${state}"]`);
    }
  });

  it('plays one-time motion only with data-boost-play and never holds a last frame', () => {
    for (const name of ['boost-bounce', 'boost-hops', 'boost-nod', 'boost-hello']) {
      const uses = css.match(new RegExp(`[^\\n]*\\n[^\\n]*animation: ${name} `, 'g')) ?? [];
      expect(uses.length, name).toBeGreaterThan(0);
    }
    expect(css).toMatch(/\[data-boost-play\]\[data-boost-state="success"\] \.boost-panda/);
    expect(css).toMatch(/\[data-boost-play\]\[data-boost-state="celebrate"\] \.boost-panda/);
    expect(css).not.toMatch(/forwards|both;/);
  });

  it('has a reduced-motion block that stops every animation and transition', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('animation: none !important;');
    expect(block).toContain('transition: none !important;');
  });

  it('pauses loops out of view, in a hidden tab, and behind the opening loader', () => {
    expect(css).toContain('.ai-boost[data-boost-still] *,\nbody.loader-active .ai-boost * {\n  animation-play-state: paused;');
    expect(script).toContain("document.addEventListener('visibilitychange', resume);");
    expect(script).toContain('new IntersectionObserver(');
  });

  it('reads the sticky offset from the chrome’s scroll padding instead of hard-coding it', () => {
    expect(script).toContain('window.getComputedStyle(root).scrollPaddingTop');
  });
});

describe('the deputy lends its panda to AI Boost', () => {
  it('offers lend and unlend, and tells the page each state it shows', () => {
    expect(deputy).toContain('lend(options = {}) {');
    expect(deputy).toContain('unlend() {');
    expect(deputy).toContain("new CustomEvent('jobdeputy:deputy', {");
    expect(deputy).toContain("const LENT_SPEECH = 'I’m in AI Boost.';");
  });

  it('keeps a lent dock stepped out after a tour ends', () => {
    expect(deputy).toContain('setAway(deputy, Boolean(lent));');
    expect(deputy).toContain("if (((guided || lent) && !demo) || (demo && host.hasAttribute('data-deputy-away'))) {");
  });
});
