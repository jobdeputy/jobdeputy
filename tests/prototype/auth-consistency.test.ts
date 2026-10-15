import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const login = readFileSync(new URL('../../brand/login-preview.html', import.meta.url), 'utf8');
const access = readFileSync(new URL('../../brand/access-preview.html', import.meta.url), 'utf8');

function compact(value: string): string {
  return value.replace(/\s+/g, '');
}

function arrayLiteral(source: string, declaration: string): string {
  const declarationStart = source.indexOf(declaration);
  expect(declarationStart, `${declaration} must exist`).toBeGreaterThanOrEqual(0);

  const start = source.indexOf('[', declarationStart);
  expect(start, `${declaration} must contain an array`).toBeGreaterThanOrEqual(0);

  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character;
    } else if (character === '[') {
      depth += 1;
    } else if (character === ']') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`${declaration} has no closing bracket`);
}

// The object literal that follows a declaration, matched brace for brace (strings skipped).
function objectLiteral(source: string, declaration: string): string {
  const declarationStart = source.indexOf(declaration);
  expect(declarationStart, `${declaration} must exist`).toBeGreaterThanOrEqual(0);

  const start = source.indexOf('{', declarationStart);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`${declaration} has no closing brace`);
}

interface StoryChapter {
  scene: string;
  word: string;
  title: string;
  body: string;
  speech: string;
  duty: string;
  duration: number;
}

const evaluate = <T>(literal: string): T => runInNewContext(`(${literal})`) as T;
const plain = (text: string): string => text.replace(/\s+/g, ' ').trim();
const wordCount = (text: string): number => plain(text).split(' ').length;

// Every string a shared literal can render, including the template lines (called with a sample).
function renderedStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') return [String(value('India'))];
  if (Array.isArray(value)) return value.flatMap(renderedStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(renderedStrings);
  return [];
}

// The text from a start marker through its end marker; the start must appear exactly once.
function block(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `${start} must exist`).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(start, from + start.length), `${start} must appear once`).toBe(-1);
  const to = source.indexOf(end, from);
  expect(to, `${end} must follow ${start}`).toBeGreaterThan(from);
  return source.slice(from, to + end.length);
}

function ruleBodies(source: string, selector: string): string[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...source.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g'))].map(
    (match) => match[1] ?? '',
  );
}

function expectRule(source: string, selector: string, declarations: Record<string, string>): void {
  const expected = Object.entries(declarations).map(([property, value]) =>
    compact(`${property}:${value}`),
  );
  const matchingRule = ruleBodies(source, selector).find((body) => {
    const normalizedBody = compact(body);
    return expected.every((declaration) => normalizedBody.includes(declaration));
  });

  expect(matchingRule, `${selector} must retain ${expected.join(', ')}`).toBeDefined();
}

describe('authentication prototype foundation', () => {
  it('keeps the complete story sequence identical on sign-in, create-account, and recovery', () => {
    expect(compact(arrayLiteral(access, 'const stories ='))).toBe(
      compact(arrayLiteral(login, 'const stories =')),
    );
    // Round 7 (G1): the story is the owner's three steps, one chapter each.
    expect(access.match(/data-story-target=/g)).toHaveLength(3);
    expect(login.match(/data-story-target=/g)).toHaveLength(3);
  });

  it('renders the same story-panel copy, including screen-reader text and initial status', () => {
    const storyText = (source: string): string[] =>
      (source.match(/<section class="story-panel"[\s\S]*?<\/section>/)?.[0] ?? '')
        .replace(/<svg[\s\S]*?<\/svg>/g, '')
        .split(/<[^>]+>/)
        .map((text) => text.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    expect(storyText(access)).toEqual(storyText(login));
  });

  it.each([
    ['--ink', '#1b1a18'],
    ['--muted', '#706d66'],
    ['--paper', '#faf8f3'],
    ['--paper-deep', '#f0ece3'],
    ['--green', '#2f9e77'],
    ['--green-ink', '#23795b'],
    [
      '--font-display',
      '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
    ],
    [
      '--font-text',
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif',
    ],
  ])('uses the locked %s token in both entry prototypes', (property, value) => {
    for (const source of [login, access]) {
      expect(compact(source)).toContain(compact(`${property}: ${value};`));
    }
  });

  it('keeps the story typography on the locked scale', () => {
    for (const source of [login, access]) {
      expectRule(source, '.story-title', {
        'font-size': 'clamp(48px, 4.5vw, 72px)',
        'font-weight': '500',
        'letter-spacing': '-0.055em',
        'line-height': '0.98',
      });
      expectRule(source, '.story-body', {
        'font-size': 'clamp(17px, 1.6vw, 21px)',
        'letter-spacing': '-0.02em',
        'line-height': '1.5',
      });
      expectRule(source, '.eyebrow', { 'font-size': '13px' });
      expectRule(source, '.eyebrow', { 'letter-spacing': '0.12em' });
      expectRule(source, '.story-title', { 'text-wrap': 'balance' });
    }
    expectRule(access, '.story-title', { 'min-height': '1.05em' });
  });

  it('keeps the shared shell spacing and responsive dimensions locked', () => {
    expectRule(access, '.story-copy', {
      'align-self': 'center',
      'margin-top': '0',
    });
    // Split layouts: one viewport-tall column that sticks under the header, so a growing task
    // never moves the stage; the copy row never shrinks below its content.
    expectRule(access, '.story-panel', {
      position: 'sticky',
      top: '72px',
      height: 'calc(100vh - 72px)',
      padding: '55px clamp(34px, 5.3vw, 89px) 34px',
      // Round 7 (G1): the step strip has the third row, under the stage.
      'grid-template-rows': 'minmax(auto, 0.68fr) minmax(0, 1.32fr) auto',
    });
    expectRule(access, '.story-panel', { 'padding-inline': '34px' });
    expectRule(access, '.story-panel', { 'padding-block': '34px 21px' });
    expectRule(access, '.story-panel', { 'padding-block': '21px' });
    // Stacked layouts: the copy row sizes to the brand line, the stage has its own height, and
    // the step strip follows it.
    expectRule(access, '.story-panel', {
      '--story-stage-h': '272px',
      padding: '34px 34px 0',
      'grid-template-rows': 'auto var(--story-stage-h) auto',
    });
    expectRule(access, '.story-panel', { '--story-stage-h': '320px' });
    expectRule(access, '.story-panel', { '--story-stage-h': '220px', padding: '21px 21px 0' });
    expectRule(access, '.story-panel', {
      '--story-stage-h': '250px',
      padding: '21px',
      'border-radius': '22px',
    });
    // The copy never changes (round 7, G1), so it needs no ghost rows for the longest chapter.
    expectRule(access, '.story-copy', {
      display: 'grid',
      'grid-template-rows': 'auto auto auto',
    });
    for (const source of [login, access]) expect(source).not.toContain('story-ghost');
    expectRule(access, '.panda-stage', {
      '--stage-nav': '52px',
      '--stage-band': '47px',
      '--art-max': '360px',
      'container-type': 'size',
    });
    expectRule(access, '.panda-stage', { '--stage-nav': '16px', '--art-max': '160px' });
    expectRule(access, '.story-title', {
      'max-width': '650px',
      'min-height': 'auto',
      'font-size': 'clamp(40px, 7.5vw, 58px)',
    });
    expectRule(access, '.story-body', {
      'min-height': 'auto',
      'margin-top': '13px',
      'font-size': '16px',
    });
    expectRule(access, '.task-panel', {
      padding: '34px 21px 55px',
      'border-radius': '22px',
    });
    expectRule(access, '.form-heading h1', {
      'font-size': 'clamp(40px, 4vw, 52px)',
      'letter-spacing': '-0.05em',
      'line-height': '1',
    });
    expectRule(access, '.form-heading p:last-child', {
      'font-size': '15px',
      'line-height': '1.5',
    });
    expectRule(access, '.access-form', { gap: '8px' });
    expectRule(access, '.field', { gap: '6px' });
    expectRule(access, '.field-meta', {
      'font-size': '12px',
      'line-height': '1.4',
    });
    expectRule(access, '.field-control', {
      'font-size': '15px',
      'border-radius': '14px',
    });
    expectRule(access, '.primary-button', {
      'font-size': '15px',
      'font-weight': '680',
      'border-radius': '15px',
    });
  });

  it('tightens both task panels alike on short split layouts, keeping the card heights coupled', () => {
    // Split layouts up to 940px tall use control spacing only, so the primary action clears the
    // fold at 1280x720 and 1366x768, and Create account's last line at 1440x900 (round 6 part 3,
    // T1-14). The story's own padding still tightens only at 800px and below.
    const splitBlock = (source: string, media: string): string => {
      const start = source.indexOf(media);
      expect(start, media).toBeGreaterThan(-1);
      return source.slice(start, source.indexOf('\n      }\n', start));
    };
    const shortSplit = (source: string): string =>
      splitBlock(source, '@media (min-width: 881px) and (max-height: 940px) {');
    for (const source of [login, access]) {
      expectRule(
        splitBlock(source, '@media (min-width: 881px) and (max-height: 800px) {'),
        '.story-panel',
        { 'padding-block': '34px 21px' },
      );
    }
    expectRule(shortSplit(login), '.auth-intro', { 'margin-bottom': '13px' });
    expectRule(shortSplit(login), '.login-form', { gap: '4px' });
    expectRule(shortSplit(login), '.auth-divider', { 'margin-block': '0' });
    expectRule(shortSplit(access), '.form-heading p:last-child', { 'margin-top': '4px' });
    expectRule(shortSplit(access), '.region-summary', { 'margin-top': '4px' });
    expectRule(shortSplit(access), '.auth-divider', { 'margin-block': '0' });
    expectRule(shortSplit(access), '.task-card', { gap: '13px' });
    expect(compact(shortSplit(access))).toContain(
      compact('.access-form, .region-field { gap: 4px; }'),
    );
    // Every task card shares Create account's height (the tallest content: Continue with Google,
    // Continue with LinkedIn under it, and a two-line heading) from one block on both routes, so
    // the story shell and the heading sit at the same place on every entry route. Split layouts
    // up to 940px tall use the tighter rhythm (51px less); those no taller than 800px also put the
    // two providers in one row. No card is taller than the window leaves (100vh less the 72px
    // header and the panel's 21px twice), so a short form never scrolls (T1-14).
    const cards = (source: string): string =>
      block(source, '/* Card heights: start', '/* Card heights: end */');
    expect(cards(access)).toBe(cards(login));
    const minimum = (media: string): string | undefined =>
      compact(cards(login))
        .split(compact(media))[1]
        ?.match(/^:is\(\.auth-card,\.task-card\)\{min-height:([^;]+);\}/)?.[1];
    const capped = (content: string): string => compact(`min(${content}, calc(100vh - 114px))`);
    expect(minimum('@media (min-width: 881px) {')).toBe(
      capped('calc(720.781px + 2 * clamp(40px, 4vw, 52px))'),
    );
    expect(minimum('@media (min-width: 1051px) and (max-width: 1193px) {')).toBe(
      capped('calc(726.766px + 2 * clamp(40px, 4vw, 52px))'),
    );
    expect(minimum('@media (min-width: 881px) and (max-width: 1050px) {')).toBe(
      capped('calc(743.281px + 2 * 42px)'),
    );
    expect(minimum('@media (min-width: 881px) and (max-height: 940px) {')).toBe(
      capped('calc(669.781px + 2 * clamp(40px, 4vw, 52px))'),
    );
    expect(
      minimum('@media (min-width: 1051px) and (max-width: 1193px) and (max-height: 940px) {'),
    ).toBe(capped('calc(675.766px + 2 * clamp(40px, 4vw, 52px))'));
    expect(
      minimum('@media (min-width: 881px) and (max-width: 1050px) and (max-height: 940px) {'),
    ).toBe(capped('calc(692.281px + 2 * 42px)'));
    expect(minimum('@media (min-width: 881px) and (max-height: 800px) {')).toBe(
      capped('calc(609.781px + 2 * clamp(40px, 4vw, 52px))'),
    );
    expect(
      minimum('@media (min-width: 1051px) and (max-width: 1193px) and (max-height: 800px) {'),
    ).toBe(capped('calc(615.766px + 2 * clamp(40px, 4vw, 52px))'));
    expect(
      minimum('@media (min-width: 881px) and (max-width: 1050px) and (max-height: 800px) {'),
    ).toBe(capped('calc(632.281px + 2 * 42px)'));
    // Each taller tier comes first, so the shorter one wins where both match.
    const order = [
      '@media (min-width: 881px) {',
      '@media (min-width: 881px) and (max-height: 940px) {',
      '@media (min-width: 881px) and (max-height: 800px) {',
    ].map((media) => cards(login).indexOf(media));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // No other card minimum competes with the shared one (stacked layouts reset it to 0).
    for (const source of [login, access]) {
      const outside = source.replace(cards(source), '');
      expect(outside).not.toMatch(/\.(?:auth|task)-card\s*\{[^}]*min-height:\s*calc/);
    }
  });

  it('declares the same stage box and keeps the speech bubble visible on both routes', () => {
    // Every stage-box property, as declared: tunables, derived values, and breakpoint overrides.
    const stageBox = (source: string): string[] =>
      [...source.matchAll(/(--(?:stage|art|head|speech|story-stage)[\w-]*)\s*:\s*([^;{}]+);/g)]
        .map((match) => compact(`${match[1]}:${match[2]}`))
        .sort();
    expect(stageBox(login).length).toBeGreaterThan(30);
    expect(stageBox(login)).toEqual(stageBox(access));
    for (const source of [login, access]) {
      for (const body of ruleBodies(source, '.panda-speech')) {
        expect(compact(body), '.panda-speech must never be hidden').not.toContain('display:none');
      }
      expect(compact(source)).toContain(compact('@container (min-width: 480px)'));
      expect(compact(source)).toContain(compact('@container (max-width: 639px)'));
    }
  });

  it('builds the password toggle from the same code on both routes', () => {
    // The password input is `passwordInput` on account access and `password` on sign-in.
    expect(
      compact(objectLiteral(access, 'const setPasswordVisible =')).replace(
        /\bpasswordInput\b/g,
        'password',
      ),
    ).toBe(compact(objectLiteral(login, 'const setPasswordVisible =')));
    for (const source of [login, access]) {
      expect(source).not.toContain('aria-pressed');
      expect(source).toContain("visible ? 'Hide password' : 'Show password'");
      expect(source).toContain("'Password shown.' : 'Password hidden.'");
      // The decorative arrow stays out of the "How JobDeputy works" link's accessible name.
      expect(source).toContain('content: "→" / "";');
    }
  });

  it('tells the public trust page which entry route to return to', () => {
    expect(login).toContain('href="./trust-preview.html?public&amp;from=login"');
    expect(access).toContain('href="./trust-preview.html?public&amp;from=create"');
    expect(access).toMatch(/'href', `\.\/trust-preview\.html\?public&from=\$\{mode\}`/);
  });

  it('retains the shared interaction and accessibility safeguards', () => {
    for (const source of [login, access]) {
      expect(source).toContain('prefers-reduced-motion: reduce');
      expect(source).toMatch(/\.addEventListener\('focusin'/);
      expect(source).toContain('aria-live="polite"');
      // The steps and the controls change the stage (the deputy and the strip); the copy stays.
      expect(source).toContain('aria-controls="story-stage"');
      expect(source).toContain('<div class="panda-stage" id="story-stage">');
      expect(source).toContain('min-height: 44px');
    }

    expect(access).toContain("? 'Advance story'");
    expect(access).toContain('aria-labelledby="form-title"');
    expect(access).toContain('<h1 id="form-title" tabindex="-1">');
    expectRule(access, '.skip-link', {
      display: 'flex',
      'min-height': '44px',
      'align-items': 'center',
    });
    expect(login).toContain('aria-labelledby="login-title"');
    expect(access).toContain('This reset link can’t be used.');
    expect(access).toContain('aria-label="Change home Region, currently United States"');
    expect(access).toContain('resetTransientFormState');
    expect(login).toContain('resetTransientLoginState');
    // Round 7 (T4-19): the three steps are plain buttons, each a Tab stop (no roving tabindex).
    for (const source of [login, access]) {
      const steps = [
        ...source.matchAll(/<button\s+type="button"\s+class="story-strip-step"[^>]*>/g),
      ].map((match) => match[0]);
      expect(steps).toHaveLength(3);
      for (const step of steps) expect(step).not.toContain('tabindex');
      expect(source).not.toContain('compactStoryNavigation');
      expect(source).not.toMatch(/step\.tabIndex =/);
    }
    expect(access).toContain('strengthText.textContent !== nextStrength');
    expect(access).not.toMatch(/<footer[\s>]/);
    expect(access).toContain('How JobDeputy works');
    expect(access).toContain("window.addEventListener('pageshow'");
  });
});

describe('shared entry copy', () => {
  const stories = evaluate<StoryChapter[]>(arrayLiteral(login, 'const stories ='));
  const sharedLiterals = ['const pandaLines =', 'const regionCopy ='];

  it('declares byte-identical pandaLines and regionCopy on sign-in and account access', () => {
    for (const declaration of sharedLiterals) {
      expect(objectLiteral(access, declaration), declaration).toBe(
        objectLiteral(login, declaration),
      );
    }
  });

  it('times every chapter from its visible title, body, and speech words', () => {
    expect(stories).toHaveLength(3);
    for (const chapter of stories) {
      const visibleWords =
        wordCount(chapter.title) + wordCount(chapter.body) + wordCount(chapter.speech);
      const expected = Math.max(3400, Math.round((1000 + 240 * visibleWords) / 100) * 100);
      expect(chapter.duration, chapter.scene).toBe(expected);
      expect(wordCount(chapter.speech), `${chapter.scene} speech`).toBeLessThanOrEqual(6);
    }
  });

  it('mirrors every chapter in the screen-reader summary and the step strip', () => {
    for (const source of [login, access]) {
      const summary = source.match(/<ol class="sr-only" id="story-summary">([\s\S]*?)<\/ol>/)?.[1];
      const items = [...(summary ?? '').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) =>
        plain(match[1] ?? ''),
      );
      expect(items).toEqual(
        stories.map((chapter, index) =>
          plain(`Step ${index + 1}, ${chapter.title}: ${chapter.body}`),
        ),
      );
      // Round 7 (G1): each step button says its number, its label, and its line (its name), the
      // first one current; the tool shows beside them.
      const steps = [
        ...source.matchAll(
          /<button\s+type="button"\s+class="story-strip-step"\s+data-story-target="(\d+)"[\s\S]*?<span class="story-strip-label"><span class="story-strip-number">(\d)<\/span> ([^<]+)<\/span>\s*<span class="story-strip-line">([^<]+)<\/span>/g,
        ),
      ].map((match) => [match[1], match[2], match[3], match[4]]);
      expect(steps).toEqual(
        stories.map((chapter, index) => [
          String(index),
          String(index + 1),
          chapter.title,
          chapter.body,
        ]),
      );
      expect(source.match(/class="story-strip-step"[^>]*aria-current="step"/g)).toHaveLength(1);
      expect(
        source.match(
          /<span class="story-strip-tool" aria-hidden="true">\s*<svg viewBox="0 0 48 48"/g,
        ),
      ).toHaveLength(3);
      expect(source).toContain('<ol class="story-strip" aria-label="How your deputy works">');
    }
    expect(stories.map((chapter) => chapter.title)).toEqual([
      'Set it up',
      'It finds',
      'It applies',
    ]);
  });

  it('leads with the brand line the owner chose, on every entry route (round 7, G1)', () => {
    for (const source of [login, access]) {
      expect(source).toContain(
        '<p class="eyebrow" id="story-eyebrow">Agentic job applications</p>',
      );
      expect(source).toContain(
        '<p class="story-title" id="story-title"><span class="story-title-line">You set it up.</span> <span class="story-title-line">Your deputy applies.</span></p>',
      );
      expect(source).toContain(
        '<p class="story-body" id="story-body">Agents already help you work. Now one finds roles, tailors your résumé, and applies for you, with your approval.</p>',
      );
      // The phone band says it too.
      expect(source).toContain(
        '<p class="story-band-line" aria-hidden="true"><span class="story-band-eyebrow"><span class="story-band-eyebrow-long">Agentic job applications</span><span class="story-band-eyebrow-short">Agentic applying</span></span><span class="story-title-line">You set it up.</span> <span class="story-title-line">Your deputy applies.</span></p>',
      );
      // No superlative claims: other AI tools apply too, and "first" can't be proven.
      expect(source).not.toMatch(/world[’']s first|first agentic|the first platform|only agentic/i);
    }
    // The copy is the brand line: no chapter rewrites the title or the body.
    const code = block(login, '// Panda teammate script: start', '// Panda teammate script: end');
    expect(code).not.toMatch(/storyTitle|storyBody|story-copy.*is-changing/);
  });

  it('keeps em and en dashes out of the shared story, panda, and Region copy', () => {
    const copy = [
      ...renderedStrings(stories),
      ...sharedLiterals.flatMap((declaration) =>
        renderedStrings(evaluate(objectLiteral(login, declaration))),
      ),
    ];
    expect(copy.filter((text) => /[–—]/.test(text))).toEqual([]);
  });

  it('presents finding and applying as the person’s choice, never as automatic by default', () => {
    // It finds on the sites you choose; it applies once you approve (design-system: automatic
    // lookup is something you turn on, and copy never mentions pricing or plans).
    const finds = stories.find((chapter) => chapter.scene === 'search');
    const applies = stories.find((chapter) => chapter.scene === 'apply');
    expect(finds?.body).toMatch(/sites you choose/);
    expect(`${applies?.body} ${applies?.speech}`).toMatch(/once you approve/);
    const copy = stories
      .map((chapter) => `${chapter.title} ${chapter.body} ${chapter.speech}`)
      .join(' ');
    expect(copy).not.toMatch(
      /every night|nightly|automatically|premium|tier|plan|price|pricing|paid/i,
    );
  });

  it('keeps visible feedback off live regions and announces through one channel', () => {
    expect(login).toMatch(/<span class="caps-lock-note" id="caps-lock-note">/);
    expect(access).toMatch(
      /<span class="password-strength" id="password-strength" data-level="0">/,
    );
    expect(login).not.toContain('id="region-selection-status"');
    expect(access).not.toContain('id="region-selection-status"');
    expect(login).toContain('aria-describedby="password-meta"');
  });

  it('loads the opening loader once and hands sign-in to Search home without it', () => {
    expect(login).toMatch(/<img class="loader-logo" id="loader-logo" alt="" /);
    expect(login).not.toMatch(/id="loader-logo"[^>]*\ssrc=/);
    expect(login).toContain("searchParams.set('instance'");
    // A returning sign-in by email opens the Dashboard with its welcome-back note.
    expect(login).toContain('./home-preview.html?skipLoader&signin=email');
    expect(login).not.toContain('./home-preview.html?skipLoader&from=login');
    expect(login).toContain('role="status"');
  });
});

describe('shared panda teammate', () => {
  const layer = (source: string): string =>
    block(source, '/* Panda teammate layer: start', '/* Panda teammate layer: end */');
  const script = (source: string): string =>
    block(source, '// Panda teammate script: start', '// Panda teammate script: end');
  const drawing = (source: string): string =>
    block(source, '<svg\n            class="panda-art"', '</svg>');

  it('declares the panda styles, script, and drawing byte-identically on both entry routes', () => {
    expect(layer(login).length).toBeGreaterThan(20000);
    expect(layer(access)).toBe(layer(login));
    expect(script(login).length).toBeGreaterThan(10000);
    expect(script(access)).toBe(script(login));
    expect(drawing(access)).toBe(drawing(login));
  });

  it('exposes one named state on the root and styles every interaction state', () => {
    const interactionStates = evaluate<string[]>(
      arrayLiteral(script(login), 'const interactionStates ='),
    );
    expect(interactionStates).toEqual([
      'notice',
      'protect-password',
      'explain-region',
      'pending',
      'success',
      'error',
    ]);
    for (const state of ['arrive', 'story', 'idle', ...interactionStates]) {
      expect(layer(login), state).toContain(`[data-panda-state="${state}"]`);
    }
    expect(login).toMatch(/<main\s+class="login-page"[^>]*\sdata-panda-state="arrive"/);
    expect(access).toMatch(/<main\s+class="access-page"[^>]*\sdata-panda-state="arrive"/);
    // Pupils stay inside the eye-whites.
    expect(script(login)).toContain('Math.max(-5, Math.min(5, x))');
    expect(script(login)).toContain('Math.max(-3, Math.min(3, y))');
  });

  it('keeps the panda rules out of the page styles', () => {
    for (const source of [login, access]) {
      const outside = source.replace(layer(source), '');
      expect(outside, 'panda state rules belong to the shared layer').not.toContain(
        '[data-panda-state=',
      );
      expect(outside, 'panda keyframes belong to the shared layer').not.toMatch(
        /@keyframes panda-/,
      );
    }
  });
});

describe('phone story band', () => {
  const css = (source: string): string =>
    block(source, '/* Story band: start', '/* Story band: end */');
  const script = (source: string): string =>
    block(source, '// Story band script: start', '// Story band script: end');
  const phone = (source: string): string => {
    const styles = css(source);
    const start = styles.indexOf('@media (max-width: 720px) {');
    expect(start, 'phone media block').toBeGreaterThan(-1);
    return styles.slice(start, styles.indexOf('\n      }\n', start));
  };

  it('declares the band styles and script byte-identically on both entry routes', () => {
    expect(css(login).length).toBeGreaterThan(4000);
    expect(css(access)).toBe(css(login));
    expect(script(login).length).toBeGreaterThan(3000);
    expect(script(access)).toBe(script(login));
    for (const source of [login, access]) {
      // Every entry route opens as the band; the story stays one control away.
      expect(source).toMatch(/<main\s[^>]*\sdata-story-view="band"/);
      expect(source).toContain(
        '<button class="story-hide" id="story-hide" type="button" aria-controls="story-copy">',
      );
      // The strip follows the stage and comes before Hide the story.
      expect(source.indexOf('<ol class="story-strip"')).toBeGreaterThan(
        source.indexOf('id="story-stage"'),
      );
      expect(source.indexOf('<ol class="story-strip"')).toBeLessThan(
        source.indexOf('id="story-hide"'),
      );
      // Hide the story belongs to the story panel, before the task.
      expect(source.indexOf('id="story-hide"')).toBeLessThan(
        source.search(/<section class="(?:auth|task)-panel">/),
      );
    }
  });

  it('starts the form high on phones: a 134px band, a 64px strip while typing', () => {
    const rules = phone(login);
    expectRule(
      rules,
      'main:is([data-story-view="band"], [data-story-view="mini"]) > .story-panel',
      {
        height: '134px',
        'grid-template-rows': 'minmax(0, 1fr)',
      },
    );
    expectRule(rules, 'main[data-story-view="mini"] > .story-panel', {
      position: 'sticky',
      top: '64px',
      height: '64px',
    });
    // The copy leaves the band visually but stays in the accessibility tree.
    expectRule(rules, 'main:is([data-story-view="band"], [data-story-view="mini"]) .story-copy', {
      position: 'absolute',
      clip: 'rect(0, 0, 0, 0)',
    });
    expect(compact(rules)).not.toMatch(/\.story-copy\{[^}]*display:none/);
    // The full story keeps the stacked stage and adds Hide the story, which only it shows.
    expectRule(rules, 'main[data-story-view="full"] > .story-panel', {
      'grid-template-rows': 'auto var(--story-stage-h) auto auto',
    });
    // Round 7 (G1): the band shows the brand line beside the deputy; the strip waits for the full
    // story.
    expectRule(rules, 'main[data-story-view="band"] .story-band-line', {
      position: 'absolute',
      top: '4px',
      left: 'calc(var(--speech-tip) + 10px)',
      'font-size': '15px',
    });
    expect(compact(rules)).toContain(
      compact(
        'main:is([data-story-view="band"], [data-story-view="mini"]) > .story-panel > .story-strip {',
      ),
    );
    expectRule(rules, 'main[data-story-view="full"] .story-hide', {
      display: 'inline-flex',
      'min-height': '44px',
    });
    // Hide the story and the band's brand line show only where their views ask for them.
    expect(compact(css(login))).toContain(
      compact('.story-hide, .story-band-line { display: none; }'),
    );
    // Folding animates with the shared curve; out of sight it is instant; focus clears the strip.
    expect(compact(rules)).toContain(compact('transition: height 380ms var(--ease-settle);'));
    expect(compact(rules)).toContain(
      compact(
        'main.story-view-instant > .story-panel, main.story-view-instant .panda-stage > * { transition: none; }',
      ),
    );
    expectRule(rules, 'html:has(main[data-story-view="mini"])', { 'scroll-padding-top': '144px' });
    expectRule(rules, 'main[data-story-view="mini"]', {
      'padding-bottom': 'calc(13px + var(--keyboard-inset))',
    });
  });

  it('folds while a field has focus and keeps the field above the keyboard', () => {
    const code = script(login);
    expect(code).toContain("window.matchMedia('(max-width: 720px)')");
    for (const part of [
      "storyForm.addEventListener('focusin'",
      "setStoryView('mini');",
      "storyForm.addEventListener('focusout'",
      "setStoryView('band');",
      "window.visualViewport?.addEventListener('resize'",
      'keepFieldInSight();',
      'document.documentElement.clientHeight - viewport.height',
      "page.style.setProperty('--keyboard-inset'",
      // A tap on Show or Change inside the form keeps the strip (Safari does not focus buttons).
      'performance.now() - formPointerAt > 600',
      // Out of sight the change is instant and the page keeps the person's place.
      'window.scrollBy(0, anchor.getBoundingClientRect().top - before);',
    ]) {
      expect(code, part).toContain(part);
    }
  });

  it('opens the whole story from a chapter step and folds it again from Hide the story', () => {
    const code = script(login);
    expect(code).toMatch(
      /for \(const step of \[storyPrevious, storyNext\]\) \{\s*step\.addEventListener\(\s*'click',[\s\S]*?openFullStory\(\);[\s\S]*?\{ capture: true \},/,
    );
    expect(code).toMatch(/if \(prefersReducedMotion\) \{\s*openFullStory\(\);/);
    expect(code).toMatch(
      /storyHide\.addEventListener\('click', \(\) => \{\s*setStoryView\('band'\);\s*storyToggle\.focus\(\);/,
    );
  });

  it('uses the tighter task rhythm on phones on both routes', () => {
    const phoneRhythm = (source: string, marker: string): string => {
      const start = source.indexOf(marker);
      expect(start, marker).toBeGreaterThan(-1);
      return source.slice(start, source.indexOf('\n      }\n', start));
    };
    const loginRhythm = phoneRhythm(
      login,
      'so the\n         Sign in button stays in the first viewport',
    );
    expectRule(loginRhythm, '.auth-panel', { 'padding-top': '21px' });
    expectRule(loginRhythm, '.auth-intro', { 'margin-bottom': '13px' });
    expectRule(loginRhythm, '.login-form', { gap: '4px' });
    expectRule(loginRhythm, '.auth-divider', { 'margin-block': '0' });
    const accessRhythm = phoneRhythm(
      access,
      'so the\n         form starts high under the story band',
    );
    expectRule(accessRhythm, '.task-panel', { 'padding-top': '21px' });
    expectRule(accessRhythm, '.task-card', { gap: '13px' });
    expectRule(accessRhythm, '.auth-divider', { 'margin-block': '0' });
    expect(compact(accessRhythm)).toContain(compact('.access-form, .region-field { gap: 4px; }'));
  });
});

describe('reset-link hygiene', () => {
  it('drops the recovery token from the address bar and every link after the set page loads', () => {
    expect(access).toContain('<meta name="referrer" content="no-referrer" />');
    expect(access).toContain("new URLSearchParams(part).keys().next().value !== 'token'");
    expect(access).toContain('window.history.replaceState(');
    expect(access).toContain("window.sessionStorage.setItem('jobdeputy.resetLink', 'used');");
    // Only the reset request's simulated email link carries a token.
    expect(access.match(/[?&]token=/g)).toHaveLength(1);
    expect(access).toContain("? './access-preview.html?mode=set&token=prototype&skipLoader'");
    const trust = readFileSync(new URL('../../brand/trust-preview.html', import.meta.url), 'utf8');
    expect(trust).toContain(
      "['set', ['./access-preview.html?mode=set&skipLoader', '← Choose new password']]",
    );
    expect(trust).not.toMatch(/[?&]token=/);
  });
});

// Finding 34 (round 3): the four entry routes behave identically. One story panel, one panda layer
// and script, one bootstrap, and one way of giving form feedback.
describe('four entry routes, one behaviour', () => {
  const panel = (source: string): string =>
    block(source, '<!-- Story panel: start', '<!-- Story panel: end -->');
  const script = (source: string): string =>
    block(source, '// Panda teammate script: start', '// Panda teammate script: end');
  const layer = (source: string): string =>
    block(source, '/* Panda teammate layer: start', '/* Panda teammate layer: end */');

  it('declares the story panel markup byte-identically on both entry routes', () => {
    expect(panel(login).length).toBeGreaterThan(10000);
    expect(panel(access)).toBe(panel(login));
    // One name for the duty status and the chapter steps on every route.
    expect(panel(login)).toContain('<div class="duty-status" id="duty-status">Setting up</div>');
    expect(panel(login)).toContain('class="story-step story-previous"');
    expect(panel(login)).toContain('class="story-step story-next"');
    for (const source of [login, access]) {
      expect(source).not.toMatch(/\.panda-status\s*\{|id="panda-status"/);
      expect(source).toContain("const dutyStatus = document.querySelector('#duty-status');");
    }
  });

  it('shows the three steps the same way on every route: one strip, its bars, its tools (G1)', () => {
    const strip = (source: string): string =>
      block(source, '/* Story strip: start', '/* Story strip: end */');
    expect(strip(login).length).toBeGreaterThan(3000);
    expect(strip(access)).toBe(strip(login));
    const rules = strip(login);
    // One row of three under the stage; a column in the phone's full story.
    expectRule(rules, '.story-strip', {
      display: 'grid',
      'grid-template-columns': 'repeat(3, minmax(0, 1fr))',
      'list-style': 'none',
    });
    expectRule(rules, 'main[data-story-view="full"] > .story-panel > .story-strip', {
      'grid-template-columns': 'minmax(0, 1fr)',
    });
    // Each step is a 44px target; the current one is marked in more than colour (its bar fills).
    expectRule(rules, '.story-strip-step', { 'min-height': '44px' });
    expectRule(rules, '.story-strip-step[aria-current="step"]::after', { transform: 'scaleX(1)' });
    expectRule(rules, '.story-strip-line', { 'font-size': '13px', color: 'var(--muted)' });
    // The tools in the strip are the ones in the deputy's right paw, chapter by chapter.
    const layer = block(login, '/* Panda teammate layer: start', '/* Panda teammate layer: end */');
    for (const [scene, tool] of [
      ['setup', 'panda-pencil'],
      ['search', 'panda-magnifier'],
      ['apply', 'deputy-approval'],
    ]) {
      expect(layer).toContain(`[data-scene="${scene}"] .${tool},`.replace(/,$/, ''));
    }
    // Phones (T2-13): the band says "agentic" too, from 360px, above the brand line.
    for (const source of [login, access]) {
      expect(source).toContain(
        '<span class="story-band-eyebrow"><span class="story-band-eyebrow-long">Agentic job applications</span><span class="story-band-eyebrow-short">Agentic applying</span></span>',
      );
    }
    const band = block(login, '/* Story band: start', '/* Story band: end */');
    expectRule(band, 'main[data-story-view="band"] .story-band-eyebrow', {
      'font-size': '12px',
      'text-transform': 'uppercase',
      color: 'var(--green-ink)',
    });
    // At 320 (T2-13) the eyebrow says it shorter, so "agentic" shows on every phone.
    expect(compact(band)).toContain(
      compact(
        '@media (max-width: 359px) { main[data-story-view="band"] .story-band-eyebrow-long { display: none; } main[data-story-view="band"] .story-band-eyebrow-short { display: inline; }',
      ),
    );
    expect(band).not.toMatch(/\.story-band-eyebrow\s*\{\s*display:\s*none/);
    // Tablets (T2-13): a compact story, the copy beside the deputy and the steps under both.
    expect(compact(rules)).toContain(compact('@media (min-width: 721px) and (max-width: 880px) {'));
    expectRule(rules, '.story-panel', {
      'grid-template-columns': 'minmax(0, 1.15fr) minmax(0, 1fr)',
    });
    expectRule(rules, '.story-strip', { 'grid-column': '1 / -1' });
    // Forced colours (T4-11): room for each line's backplate, and no orbits across the copy.
    expectRule(rules, '.story-panel .story-title', { 'line-height': '1.16' });
    expect(compact(rules)).toContain(
      compact(
        '.panda-stage::before, .panda-stage::after, .panda-stage .panda-halo { display: none; }',
      ),
    );
    // The old chapters, their props, and the capability label are gone.
    for (const source of [login, access]) {
      for (const gone of [
        'question-cloud',
        'rank-rig',
        'watch-rig',
        'capability-word',
        'capability-progress',
      ]) {
        expect(source, gone).not.toContain(gone);
      }
    }
  });

  it('holds the story still with Play story when Pause motion is saved, as reduced motion does', () => {
    const code = script(login);
    expect(code).toContain("const motionKey = 'jobdeputy.deputyMotion';");
    expect(code).toContain("return window.localStorage.getItem(motionKey) === 'paused';");
    expect(code).toContain("prefersReducedMotion || motionPaused ? 'paused' : 'on';");
    // No arrive wave, no autoplay, no blink, and no fade while paused.
    expect(code).toMatch(
      /const transitionsEnabled = \(\) =>\s*!prefersReducedMotion && !motionPaused && !previewParameters\.has\('static'\);/,
    );
    expect(code).toMatch(/const holdStill =\s*prefersReducedMotion \|\|\s*motionPaused \|\|/);
    // Held still it opens on the first step, Set it up (round 7, G1).
    expect(code).toContain(
      'if ((prefersReducedMotion || motionPaused) && !hasPreviewRequest()) {\n          showStory(0);',
    );
    // The play label stays Play story (Advance story belongs to reduced motion).
    expect(code).toContain("play: prefersReducedMotion ? 'Advance story' : 'Play story',");
    // Play story lifts the hold on this page only; the saved choice is never written here.
    expect(code).toMatch(/if \(motionPaused\) \{\s*motionPaused = false;\s*syncMotionRoot\(\);/);
    expect(code).not.toMatch(/localStorage\.(?:setItem|removeItem)\(motionKey/);
    // Pause motion in another tab holds the story here too.
    expect(code).toMatch(
      /window\.addEventListener\('storage', \(event\) => \{[\s\S]*?if \(paused && storyPlaying\) \{\s*pauseStorySequence\(\);\s*page\.classList\.add\('story-is-frozen'\);/,
    );
    // The reset that stops every animation and transition lives in the shared layer.
    const css = compact(layer(login));
    expect(css).toContain(
      compact(
        '[data-motion="paused"], [data-motion="paused"] *, [data-motion="paused"] *::before, [data-motion="paused"] *::after, [data-motion="paused"] ::backdrop {',
      ),
    );
    expect(css).toContain(compact('animation-iteration-count: 1 !important;'));
    expect(css).toContain(compact('transition-duration: 0.01ms !important;'));
    expect(css).toContain(compact('animation-delay: 0s !important;'));
    expect(css).toContain(compact('transition-delay: 0s !important;'));
  });

  it('plays on after the page was hidden, unless the person, a field, or motion settings hold it', () => {
    const code = script(login);
    expect(code).toMatch(
      /document\.addEventListener\('visibilitychange', \(\) => \{\s*if \(!document\.hidden\) \{\s*resumeAfterHidden\(\);\s*\} else if \(storyPlaying\) \{\s*pauseStorySequence\(\);\s*storyPausedByVisibility = true;/,
    );
    const resume = code.slice(code.indexOf('const resumeAfterHidden = () => {'));
    for (const guard of [
      '!storyPlaying &&',
      '!storyInterruptedByForm &&',
      '!prefersReducedMotion &&',
      '!motionPaused &&',
      "page.dataset.pandaState === 'idle' &&",
      "!page.classList.contains('story-is-frozen')",
    ]) {
      expect(resume, guard).toContain(guard);
    }
    // The page cache restores a page without a fresh load, so it resumes the same way.
    expect(code).toMatch(
      /window\.addEventListener\('pageshow', \(event\) => \{\s*if \(event\.persisted\) \{\s*resumeAfterHidden\(\);/,
    );
  });

  it('gives account access the same form feedback as sign-in', () => {
    // The summary sits directly above the first field: after the Google divider on Create
    // account, at the top of the form for the reset request and the new password.
    const form = access.slice(access.indexOf('id="access-form"'), access.indexOf('</form>'));
    expect(form.indexOf('or create your account with email')).toBeLessThan(
      form.indexOf('id="form-feedback"'),
    );
    expect(form.indexOf('id="form-feedback"')).toBeLessThan(form.indexOf('id="email-field"'));
    const loginForm = login.slice(login.indexOf('id="login-form"'), login.indexOf('</form>'));
    expect(loginForm.indexOf('or sign in with email')).toBeLessThan(
      loginForm.indexOf('id="form-error-summary"'),
    );
    expect(loginForm.indexOf('id="form-error-summary"')).toBeLessThan(
      loginForm.indexOf('id="email-field"'),
    );
    // A validation summary on both routes, recounted after each edit and cleared, with the
    // panda's error state, once nothing needs attention.
    expect(access).toContain("showFeedback(\n          'validation',");
    expect(access).toMatch(/id="form-feedback"\s+data-kind="validation"/);
    const recount = access.slice(access.indexOf('const refreshValidationSummary = () => {'));
    expect(recount).toMatch(
      /if \(count === 0\) \{\s*hideFeedback\(\);\s*if \(page\.dataset\.pandaState === 'error'\) \{\s*restoreStoryLayer\(\);/,
    );
    expect(recount).toMatch(
      /feedbackTitle\.textContent = count === 1 \? 'Check one detail' : `Check \$\{count\} details`;/,
    );
    expect(login).toMatch(
      /if \(page\.dataset\.pandaState === 'error'\) \{\s*restoreStoryLayer\(\);\s*\}\s*\};\s*const refreshValidationSummary/,
    );
    // A field is checked when it is left with a value, on both routes.
    expect(access).toMatch(
      /check\.input\.addEventListener\('blur', \(\) => \{\s*check\.input\.dataset\.touched = 'true';\s*if \(check\.input\.value\.length > 0 \|\| validationAttempted\) \{\s*checkField\(check\);/,
    );
    expect(login).toMatch(
      /email\.addEventListener\('blur', \(\) => \{\s*email\.dataset\.touched = 'true';\s*if \(email\.value\.trim\(\)\.length > 0 \|\| validationAttempted\) \{\s*validateEmail\(\);/,
    );
  });

  it('makes the logo the entry home, Sign in, on every route', () => {
    // Never the old brand concept page (preview.html).
    expect(login).toContain(
      '<a class="mini-brand" href="./login-preview.html?skipLoader" aria-label="JobDeputy, Sign in">',
    );
    expect(access).toContain(
      '<a class="brand" href="./login-preview.html?skipLoader" aria-label="JobDeputy, Sign in">',
    );
    for (const source of [login, access]) expect(source).not.toContain('href="./preview.html"');
  });

  it('stacks the header, the skip link, and the folded strip the same way on both routes', () => {
    for (const source of [login, access]) {
      expectRule(source, '.site-header', { 'z-index': '20' });
      expectRule(source, '.skip-link', { position: 'fixed', 'z-index': '120' });
      expectRule(source, '.skip-link:focus', { transition: 'none' });
      expect(source).toContain('<body class="loader-active">');
    }
  });
});
