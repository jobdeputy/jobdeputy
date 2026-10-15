import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// The User Agreement (round 5 brief, section 3.4; decision G1): brand/agreement-text.js holds every
// published version (key points, full text, what changed, and the SHA-256 fingerprint), and
// brand/agreement-preview.html reads and signs it. The rendered flows (sign, the record, Download)
// are checked in headless Chrome; these guards keep the text and the contract from drifting.

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');

const textSource = sourceFor('agreement-text.js');
const page = sourceFor('agreement-preview.html');
const onboarding = sourceFor('onboarding-preview.html');

interface Point {
  id: string;
  number: number;
  title: string;
  point: string;
}
interface Section extends Point {
  anchor: string;
}
interface Change {
  id: string;
  title: string;
  text: string;
  sections: string[];
}
interface Version {
  version: string;
  title: string;
  publishedAt: string;
  publishedText: string;
  summary: Point[];
  sections: Section[];
  changes: Change[];
  markdown: string;
  sha256: string;
  words: number;
  readMinutes: number;
}
interface AgreementText {
  current: string;
  order: string[];
  consents: { id: string; label: string }[];
  versions: Record<string, Version>;
  sentence(version: string): string;
  signedCopy(
    record: Record<string, unknown>,
  ): { version: string; title: string; markdown: string } | null;
  dateText(value: string): string;
  dateTimeText(value: string): string;
}

// The text as a page loads it: a classic script that sets window.JobDeputyAgreementText.
function loadText(): AgreementText {
  const window: Record<string, unknown> = {};
  runInNewContext(textSource, { window });
  return window.JobDeputyAgreementText as AgreementText;
}

const text = loadText();
const current = text.versions['2026.10'] as Version;
const previous = text.versions['2026.09'] as Version;
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const allStrings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(allStrings);
  return [];
};
// One sentence: placeholders aside, a single terminal mark at the end.
const sentenceCount = (value: string): number =>
  value
    .replace(/\[[^\]]*\]/g, 'X')
    .split(/[.!?](?:\s+|$)/)
    .filter((part) => part.trim()).length;

// The text from a start marker through its end marker; the start must appear exactly once.
function block(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `${start} must exist`).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(start, from + start.length), `${start} must appear once`).toBe(-1);
  const to = source.indexOf(end, from);
  expect(to, `${end} must follow ${start}`).toBeGreaterThan(from);
  return source.slice(from, to + end.length);
}

describe('the agreement text (brand/agreement-text.js)', () => {
  it('loads as a classic script and as a Node module, frozen, with 2026.10 current', () => {
    expect(text.current).toBe('2026.10');
    expect(text.order).toEqual(['2026.10', '2026.09']);
    expect(Object.keys(text.versions).sort()).toEqual(['2026.09', '2026.10']);
    expect(Object.isFrozen(text)).toBe(true);
    expect(Object.isFrozen(current)).toBe(true);
    expect(Object.isFrozen(current.sections)).toBe(true);
    const module = { exports: {} as unknown };
    runInNewContext(textSource, { module, globalThis: {} });
    expect((module.exports as AgreementText).versions['2026.10']?.sha256).toBe(current.sha256);
  });

  it('fingerprints each version with the SHA-256 of its Markdown', () => {
    for (const version of Object.values(text.versions)) {
      expect(version.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(sha256(version.markdown), version.version).toBe(version.sha256);
    }
  });

  it('never changes a published text: an edit must ship as a new version', () => {
    expect(previous.sha256).toBe(
      '5eeeec084a223e8460acd4de98f34bfa7193763ad7abef7086c05b16889a0eed',
    );
    // Round 7: 2026.10's draft was amended before launch (an owner question). G3: signing became
    // one step, so its record section no longer says the name was typed. T7-13: runs pay for every
    // run (R10-9) and each setting is where the app keeps it. Any other edit fails here.
    expect(current.sha256).toBe('87e7340ddb4b8f260721877a70368beb335c319680f9ac1a0af0d48299014fd4');
    expect(current.markdown).toContain(
      '- the name you signed with, your email address, and the date and time;',
    );
    expect(current.markdown).toContain('- how you signed and the three things you confirmed.');
    expect(current.markdown).not.toMatch(/\btyp(?:ed|ing)\b/);
    // Runs are runs (R10-9): searches, Keep watch checks, Gmail checks, the daily email.
    expect(current.markdown).not.toMatch(/nightly runs/i);
    expect(current.markdown).toContain(
      'each search you start, each source Keep watch checks at night, each check of your job email (daily, or when you choose Scan now), and each daily summary email you subscribe to use one run.',
    );
    expect(current.markdown).toContain(
      'Your deputy checks your job email once a day, reading the last 48 hours of it, and whenever you choose Scan now. Each check uses one run',
    );
    // Where the app keeps each setting now (round 6: Settings, its tabs, and Applications).
    expect(current.markdown).not.toContain('in Profile');
    for (const place of [
      'You can disconnect Gmail at any time in Settings, Connections',
      'You can see any of these passwords at any time in Settings, Connections',
      'You can export your data at any time in Settings, Account.',
      'You can delete your account at any time in Settings, Account.',
      'You can see and download your signed copies at any time in Settings, Account.',
      'How your deputy applies is your setting in Applications. With Review, then auto-apply (the starting setting)',
    ]) {
      expect(current.markdown, place).toContain(place);
    }
    // Section 21's owner note too (T7-R6).
    expect(current.markdown).toContain('[Owner: what happens to unused bought credits and runs.]');
    expect(current.markdown).not.toMatch(/nightly/i);
    // 2026.09 keeps the words its signers saw.
    expect(previous.markdown).toContain('You can disconnect Gmail at any time in Profile');
    expect(previous.markdown).toContain(
      '[Owner: what happens to unused bought credits and nightly runs.]',
    );
  });

  it('dates each version at 00:00 Pacific, and says so at the top of its text', () => {
    expect(previous.publishedAt).toBe('2026-09-01T00:00:00-07:00');
    expect(current.publishedAt).toBe('2026-10-01T00:00:00-07:00');
    expect(current.markdown.split('\n').slice(0, 3)).toEqual([
      '# JobDeputy User Agreement',
      '',
      'Version 2026.10 · Published October 1, 2026',
    ]);
    expect(previous.markdown).toContain('Version 2026.09 · Published September 1, 2026');
  });

  it('says in its own text that it is a draft for counsel review and not legal advice', () => {
    for (const version of Object.values(text.versions)) {
      expect(version.markdown).toContain(
        'This is a draft for counsel review. It is not legal advice and is not final.',
      );
    }
  });

  it('keeps each section’s key point to one plain sentence, numbered like the text', () => {
    for (const version of Object.values(text.versions)) {
      expect(version.summary.map((entry) => entry.number)).toEqual(
        version.summary.map((_, index) => index + 1),
      );
      expect(version.sections.map((entry) => entry.id)).toEqual(
        version.summary.map((entry) => entry.id),
      );
      const headings = [...version.markdown.matchAll(/^## (\d+)\. (.+)$/gm)].map(
        (match) => `${match[1]}. ${match[2]}`,
      );
      expect(headings).toEqual(version.sections.map((entry) => `${entry.number}. ${entry.title}`));
      for (const entry of version.summary) {
        expect(entry.point, `${version.version} ${entry.id}`).toMatch(/\.$/);
        expect(sentenceCount(entry.point), `${version.version} ${entry.id}`).toBe(1);
      }
      const anchors = version.sections.map((entry) => entry.anchor);
      expect(new Set(anchors).size).toBe(anchors.length);
      for (const anchor of anchors) expect(anchor).toMatch(/^section-[a-z-]+$/);
    }
    expect(current.sections).toHaveLength(22);
    expect(previous.sections).toHaveLength(19);
  });

  it('covers everything the brief lists, in this order', () => {
    expect(current.sections.map((entry) => entry.id)).toEqual([
      'who',
      'eligibility',
      'account',
      'deputy',
      'responsibilities',
      'ai',
      'no-promise',
      'sites',
      'email',
      'site-accounts',
      'own-keys',
      'linkedin',
      'prices',
      'support',
      'privacy',
      'record',
      'changes',
      'acceptable-use',
      'liability',
      'law',
      'ending',
      'contact',
    ]);
    const md = current.markdown;
    for (const phrase of [
      'You must be 18 or older.',
      // What your deputy does.
      'searches the careers sites and job boards you add',
      'reads the job postings it finds',
      'scores how well each role fits you, with AI (Deputy Assist)',
      'tailors your résumé',
      'fills in application forms and applies for you, only as your settings allow',
      'creates accounts on employers’ sites in your name',
      'keeps their passwords in your vault',
      'reads one-time sign-in codes and employers’ status emails through read-only access to your Gmail',
      'moves your applications to their next stage',
      'drafts replies to employers’ emails, which you edit and send yourself',
      // Responsibilities, AI, no promise, other sites.
      'Give true, accurate, and current information about yourself.',
      'Review what your deputy prepares.',
      'Each careers site, job board, and employer has its own terms',
      'AI can be wrong, incomplete, or out of date',
      'We can’t promise that you’ll find a role, get an interview, receive an offer, or be hired',
      'We aren’t affiliated with them unless we say so',
      'A site may change, slow down, or block automated tools at any time.',
      'Your deputy stops at a CAPTCHA',
      'It never tries to get around one.',
      // Email: what is read, never read, never sent, kept.
      'What your deputy reads:',
      'What it never reads:',
      'What it never sends: anything.',
      'What it keeps:',
      'It never keeps one-time codes',
      // Vault, keys, money.
      'Passwords are kept encrypted in your vault',
      'every time one is shown, the vault log records when',
      'Your key stays yours.',
      'We never charge you for using your own key.',
      'the Amazon Bedrock on-demand rate for your model in your home Region, plus a margin',
      'Tax is added at checkout, based on your billing address.',
      'Bundles combine credits and runs. Their discount is on the runs only',
      'Refunds: [Owner: refund window and conditions].',
      'Expiry: [Owner: whether and when bought credits, bonus credits, and runs expire].',
      'support isn’t tax deductible',
      'Benefits are a thank-you, not something you buy.',
      // Privacy, the record, changes.
      'Your data stays in your home Region',
      'You can export your data at any time in Settings, Account.',
      'You can delete your account at any time in Settings, Account.',
      'We keep these records permanently, apart from your account.',
      'When you delete your account, we delete everything else, but never these records.',
      'If you create a new account later, you sign the agreement again.',
      'a SHA-256 hash',
      '3, 7, 10, and 13 days later',
      'if you haven’t signed it 14 days after it is published, your deputy’s work pauses until you sign',
      'some things never pause: you can always sign in, see everything, export your data, delete your account, use Help, and sign the new version',
      // Acceptable use, liability, law, ending, contact.
      'make your deputy break its rules',
      '[Counsel: limitation of liability',
      '[Counsel: indemnity',
      '[Counsel: disclaimers of warranties',
      '[Counsel: the governing law for each home Region.]',
      '[Counsel: where and how disputes are settled',
      'You can end this agreement at any time by deleting your account in Settings, Account.',
      '[Owner: contact email address]',
    ]) {
      expect(md, phrase).toContain(phrase);
    }
  });

  it('is 2026.09 plus what 2026.10 adds, with only the superseded lines left behind', () => {
    for (const id of ['site-accounts', 'linkedin', 'record']) {
      expect(previous.sections.map((entry) => entry.id)).not.toContain(id);
    }
    // Lines compared without section numbers, which shift when sections are added.
    const lines = (markdown: string): string[] =>
      markdown
        .split('\n')
        .map((line) =>
          line.replace(/^## \d+\. /, '## ').replace(/sections? \d+(?: and \d+)?/g, 'section N'),
        )
        .filter(Boolean);
    const now = new Set(lines(current.markdown));
    const left = lines(previous.markdown).filter((line) => !now.has(line));
    // Round 7 (T7-13) adds the lines that named Profile for what is now in Settings or
    // Applications, and the round 5 ways to apply.
    expect(left.map((line) => line.slice(0, 48))).toEqual([
      'Version 2026.09 · Published September 1, 2026',
      'You sign in with your email address and a passwo',
      'How your deputy applies is your setting in Profi',
      '- You can disconnect Gmail at any time in Profil',
      '- When your key is used, the text your deputy se',
      '## Free allowances and prices',
      'Some features have a free allowance each month, ',
      '- Your data stays in your home Region: the Unite',
      '- You can export your data at any time in Profil',
      '- You can delete your account at any time in Pro',
      'We may update this agreement. We’ll tell you wha',
      '- You can end this agreement at any time by dele',
      '- When this agreement ends, your deputy stops al',
    ]);
  });

  it('lists what 2026.10 changes, each linked to the sections that say it', () => {
    expect(previous.changes).toEqual([]);
    expect(current.changes.map((change) => change.id)).toEqual([
      'credits',
      'site-accounts',
      'email',
      'linkedin',
      'support',
      'record',
    ]);
    const ids = new Set(current.sections.map((entry) => entry.id));
    for (const change of current.changes) {
      expect(change.sections.length).toBeGreaterThan(0);
      for (const id of change.sections) expect(ids.has(id), `${change.id} → ${id}`).toBe(true);
      expect(sentenceCount(change.text)).toBe(1);
    }
  });

  it('resolves every cross-reference in each version', () => {
    for (const version of Object.values(text.versions)) {
      expect(version.markdown).not.toContain('{s:');
      for (const match of version.markdown.matchAll(/sections? (\d+)(?: and (\d+))?/g)) {
        for (const number of [match[1], match[2]].filter(Boolean)) {
          expect(Number(number)).toBeLessThanOrEqual(version.sections.length);
        }
      }
    }
    expect(previous.markdown).toContain('the AI your account uses (sections 6 and 10)');
    expect(current.markdown).toContain('the AI your account uses (sections 6 and 11)');
  });

  it('marks every placeholder for the owner or counsel', () => {
    for (const version of Object.values(text.versions)) {
      for (const bracket of version.markdown.match(/\[[^\]]*\]/g) ?? []) {
        expect(bracket).toMatch(/^\[(?:Owner|Counsel): .+\]$/);
      }
    }
    const md = current.markdown;
    for (const placeholder of [
      '[Owner: legal entity name]',
      '[Owner: margin, proposed 10%]',
      '[Owner: refund window and conditions]',
      '[Owner: payment provider]',
      '[Owner: contact email address]',
      '[Counsel: indemnity, if any, and its limits for consumers.]',
    ]) {
      expect(md).toContain(placeholder);
    }
    expect(md.match(/\[Owner: /g)?.length).toBeGreaterThanOrEqual(15);
    expect(md.match(/\[Counsel: /g)?.length).toBeGreaterThanOrEqual(15);
  });

  it('follows the writing rules: second person, no dashes, no real addresses or links', () => {
    const strings = allStrings(text);
    expect(strings.filter((value) => /[\u2013\u2014]/.test(value))).toEqual([]);
    for (const version of Object.values(text.versions)) {
      expect(version.markdown).not.toMatch(/@|https?:|www\./);
      expect(version.markdown).not.toMatch(/\bthe user\b|\busers\b/i);
      expect(version.markdown).toContain('your deputy');
    }
  });

  it('says what a signature confirms in the one sentence above Sign and continue (round 7, G3)', () => {
    expect(text.sentence('2026.10')).toBe(
      'By signing, you agree to User Agreement version 2026.10, allow your deputy to act for you as it describes, and understand JobDeputy keeps a permanent copy of what you sign, even after you delete your account.',
    );
    expect(sentenceCount(text.sentence('2026.10'))).toBe(1);
    expect(text.sentence('2026.10')).not.toMatch(/[\u2013\u2014]/);
  });

  it('holds the three things a signature confirms, in the brief’s words', () => {
    expect(text.consents).toEqual([
      { id: 'read', label: 'I read the agreement' },
      { id: 'act', label: 'I allow my deputy to act for me as it describes' },
      {
        id: 'keep',
        label:
          'I understand JobDeputy keeps a permanent copy of what I sign, even after I delete my account',
      },
    ]);
  });

  it('counts the words and the minutes to read the full text', () => {
    for (const version of Object.values(text.versions)) {
      const words = version.markdown.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
      expect(version.words).toBe(words.length);
      expect(version.readMinutes).toBe(Math.max(1, Math.ceil(words.length / 238)));
    }
    expect(current.readMinutes).toBe(16);
  });
});

// ---------------------------------------------------------------------------------- the page

const inlineScript = (page.match(/<script>([\s\S]*?)<\/script>/g) ?? []).join('\n');
const modelSource = block(inlineScript, '// AgreementModel: start', '// AgreementModel: end');
// Markup and CSS compared without the line breaks and indentation that carry no meaning.
const compact = (value: string): string => value.replace(/\s+/g, '');
const plain = (value: string): string => value.replace(/\s+/g, ' ').trim();

interface Model {
  modeOf(value: string | null): string;
  doorOf(value: string | null): string | null;
  regionOf(value: string | null): string | null;
  regionName(code: string | null): string;
  safeReturn(value: string | null): { href: string; page: string } | null;
  returnName(page: string): string;
  nextStep(options: {
    mode: string;
    door: string | null;
    isNew: boolean;
    returnTo: { href: string; page: string } | null;
    region?: string | null;
  }): { href: string; label: string; going: string };
  signedLine(next: { going: string }): string;
  readyLine(): string;
  methodName(method: string | null | undefined): string;
  parse(markdown: string): {
    type: string;
    text?: string;
    number?: number;
    items?: string[];
  }[];
  pieces(text: string): { text: string; placeholder: boolean }[];
  groups(hex: string): string;
  dateText(value: string): string;
  dateTimeText(value: string): string;
  signedTimeText(value: string, region: string | null): string;
}

const model = runInNewContext(`${modelSource}\nAgreementModel;`, { Intl, Date }) as Model;

describe('agreement-preview.html: the setup chrome', () => {
  it('copies onboarding’s entry header: the brand to the Dashboard, no app shell, no footer', () => {
    const brand = (source: string): string =>
      source.match(/<a class="brand"[\s\S]*?<\/a>/)?.[0] ?? '';
    expect(brand(page)).toBe(brand(onboarding));
    expect(brand(page)).toContain(
      '<a class="brand" href="./home-preview.html?skipLoader" aria-label="JobDeputy dashboard">',
    );
    expect(page).toMatch(/<header class="app-header">\s*<a class="brand"/);
    for (const shell of [
      'app-sidebar',
      '<!-- AppNav: start',
      '<!-- DeputyDock: start',
      'account-menu',
      // No resident panda: the deputy shows only in the signing moment (round 7, G3).
      'class="deputy-scene"',
      'data-deputy-page="',
      '<footer',
      'OpeningLoader',
    ]) {
      expect(page, shell).not.toContain(shell);
    }
  });

  it('links the shared styles before its own, and loads the text before the store', () => {
    const links = [
      '<link rel="stylesheet" href="./app-chrome.css" />',
      '<link rel="stylesheet" href="./app-components.css" />',
      '<link rel="stylesheet" href="./deputy.css" />',
    ];
    const at = links.map((link) => page.indexOf(link));
    expect(at.every((index) => index > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(at[2]).toBeLessThan(page.indexOf('<style>'));
    const scripts = [...page.matchAll(/<script src="\.\/([^"]+)"><\/script>/g)].map(
      (match) => match[1],
    );
    expect(scripts).toEqual([
      'app-components.js',
      'agreement-text.js',
      'sample-store.js',
      'deputy.js',
    ]);
    expect(page).toContain('<title>JobDeputy · User Agreement</title>');
    expect(page).toContain('<link rel="icon" href="./jobdeputy-mark.svg" type="image/svg+xml" />');
  });

  it('points the logo at Sign in for a new account, which has no Dashboard yet', () => {
    expect(inlineScript).toMatch(
      /if \(mode === 'new' && brand\) \{\s*brand\.href = '\.\/login-preview\.html\?skipLoader';\s*brand\.setAttribute\('aria-label', 'JobDeputy, Sign in'\);/,
    );
  });
});

describe('agreement-preview.html: what it shows', () => {
  it('gives the sections ids that no element of the page already uses', () => {
    const ids = new Set([...page.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
    for (const version of Object.values(text.versions)) {
      for (const section of version.sections) {
        expect(ids.has(section.anchor), section.anchor).toBe(false);
      }
    }
  });

  it('has one h1, a labelled focusable scroll region, and the draft label', () => {
    expect(page.match(/<h1\b/g)).toHaveLength(1);
    expect(page).toMatch(
      /<section\s+class="ag-region"\s+id="ag-region"\s+aria-label="The User Agreement, version 2026\.10"\s+tabindex="0"/,
    );
    expect(page).toContain('Draft for counsel review · not legal advice');
    expect(page).toMatch(/<h2 id="ag-changes-title">What changed<\/h2>/);
    expect(page).toMatch(/<h2 id="ag-points-title">Key points<\/h2>/);
    expect(page).toMatch(/<h2 id="ag-full-title">Full text<\/h2>/);
    expect(page).toMatch(
      /<details class="ag-index" id="ag-index">\s*<summary class="compact-action">Go to a section<\/summary>/,
    );
  });

  it('signs in one step: one sentence, then one Sign and continue (round 7, G3 and R10-8)', () => {
    const form = page.match(/<form[\s\S]*?id="ag-form"[\s\S]*?<\/form>/)?.[0] ?? '';
    // No ticks and no typed name any more.
    expect(form).not.toMatch(/type="checkbox"|name="consent"|id="ag-name"|<input\b/);
    expect(page).not.toContain('Tick all three');
    expect(page).not.toContain('Typing your name is your signature.');
    // The one sentence, word for word the text's, right above the one primary button, which it
    // describes for screen readers.
    const sentence = plain(
      form.match(/<p\s+class="ag-consent"[\s\S]*?>([\s\S]*?)<\/p>/)?.[1] ?? '',
    );
    expect(sentence).toBe(text.sentence('2026.10'));
    expect(inlineScript).toContain('consent.textContent = texts.sentence(text.version);');
    expect(form.match(/class="primary-action"/g)).toHaveLength(1);
    expect(form).toContain(
      '<button class="primary-action" id="ag-submit" type="submit" aria-describedby="ag-consent">Sign and continue</button>',
    );
    expect(form.indexOf('id="ag-consent"')).toBeLessThan(form.indexOf('id="ag-submit"'));
    // Round 6 part 3 (T5-16): Not now is the quiet alternative, the app's secondary button right
    // before Sign and continue, which takes the rest of the row (no bare link at the far side).
    expect(page).toMatch(
      /<a class="secondary-action ag-later" id="ag-later" href="[^"]+">Not now<\/a>\s*<button class="primary-action" id="ag-submit" type="submit" aria-describedby="ag-consent">Sign and continue<\/button>/,
    );
    expect(compact(page)).toContain(compact('.ag-actions > .primary-action { flex: 1 1 auto; }'));
    expect(page).not.toContain('.ag-actions > .ag-link');
  });

  it('shows who signs, the email, the date, and the home Region, read only, under the button', () => {
    const form = page.match(/<form[\s\S]*?id="ag-form"[\s\S]*?<\/form>/)?.[0] ?? '';
    const facts = form.match(/<dl[\s\S]*?id="ag-facts"[\s\S]*?<\/dl>/)?.[0] ?? '';
    expect(form.indexOf('id="ag-submit"')).toBeLessThan(form.indexOf('id="ag-facts"'));
    expect([...facts.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])).toEqual([
      'Signing up as',
      'Email',
      'Date',
      'Home Region',
    ]);
    expect(facts).toContain('<dd id="ag-signer">Alex Morgan</dd>');
    expect(facts).toContain('<dd id="ag-email">alex.morgan@example.com</dd>');
    expect(facts).toContain('<dd id="ag-date">Fri, Oct 2, 2026</dd>');
    expect(facts).toContain('<dd id="ag-home-region">United States (US)</dd>');
    // The account's name is the signature; update mode says Signing as.
    expect(inlineScript).toContain('signerOut.textContent = name;');
    expect(inlineScript).toContain("emailLabel.textContent = 'Signing as';");
    expect(page).toContain('Prototype · your signature stays in this browser');
    // Create account by email opens this page straight away, as Google and LinkedIn do, so the
    // note its form showed lives here: the details typed there were not kept (D-8).
    expect(page).toContain("const signNote = $('#ag-sign-note');");
    expect(page).toMatch(
      /if \(door === 'email'\) \{\s*signNote\.textContent =\s*'Prototype · the details you typed weren’t kept; your signature stays in this browser';\s*\}/,
    );
  });

  it('shows the signed record with Download and Continue', () => {
    const record =
      page.match(
        /<section class="task-surface ag-record" id="ag-record"[\s\S]*?<\/section>\s*<section/,
      )?.[0] ?? '';
    expect(record).toContain(
      '<button class="secondary-action" id="ag-download-pdf" type="button">Download PDF</button>',
    );
    expect(record).toContain(
      '<button class="secondary-action" id="ag-download-md" type="button">Download Markdown</button>',
    );
    // Round 6 part 3 (T5-14): the way on (Continue to setup, or Back to the page in ?return=) is
    // the card's primary button, right under its title and lead and above the record, so it is
    // in view on a phone. The record (Back, a reload, a signed copy) never redirects by itself;
    // only the signing moment goes on (round 7, G3), and only from playMoment.
    expect(record).toMatch(
      /<p class="ag-lead" id="ag-record-lead">[^<]*<\/p>\s*<!--[\s\S]*?-->\s*<a class="primary-action ag-continue" id="ag-continue" href="\.\/onboarding-preview\.html">Continue to setup<\/a>\s*<section\s+class="feedback-panel"\s+id="ag-record-mismatch"/,
    );
    expect(record.indexOf('id="ag-continue"')).toBeLessThan(record.indexOf('id="ag-record-facts"'));
    expect(inlineScript.match(/location\.(?:assign|replace)\(|location\.href\s*=/g)).toHaveLength(
      1,
    );
    const showRecordSource = block(
      inlineScript,
      'const showRecord = ',
      'if (justSigned) recordTitle.focus();',
    );
    expect(showRecordSource).not.toMatch(/location\.|setTimeout/);
    expect(showRecordSource).toContain('stopMoment();');
    // How it was signed: one step, or the typed name of the records signed before round 7.
    expect(inlineScript).toContain("factRow('Method', model.methodName(entry.method)),");
    // Round 6 part 3 (T1-19): the two downloads have their own row under the record, so neither
    // sits alone on a row.
    expect(compact(record)).toContain(
      compact(
        '<div class="ag-record-actions" id="ag-record-actions"><button class="secondary-action" id="ag-download-pdf" type="button">Download PDF</button><button class="secondary-action" id="ag-download-md" type="button">Download Markdown</button></div>',
      ),
    );
    expect(compact(page)).toContain(
      compact('.ag-record-actions { display: flex; min-width: 0; flex-wrap: wrap; gap: 8px;'),
    );
    for (const fact of [
      'Version',
      'Signed',
      'Name',
      'Email',
      'Method',
      'Fingerprint (SHA-256)',
      'Kept',
    ]) {
      expect(inlineScript).toContain(`factRow('${fact}'`);
    }
    expect(inlineScript).toContain("factRow('Kept', 'Permanently, apart from your account')");
    // Round 6 (G3): the record names the home Region (the new account's choice; the sample
    // account's, the United States, for a record without one), and so does the form. The same
    // Region writes the signing time's zone (round 6 part 3, T1-19).
    expect(inlineScript).toContain(
      'const region = entry.homeRegion ?? homeRegion ?? accountRegion();',
    );
    expect(inlineScript).toContain("factRow('Home Region', model.regionName(region)),");
    expect(inlineScript).toContain(
      "factRow('Signed', model.signedTimeText(entry.signedAt, region)),",
    );
    expect(page).toContain(
      '<dt>Home Region</dt>\n                <dd id="ag-home-region">United States (US)</dd>',
    );
    // Signed in, the account's home Region (R9-6); a new account, the one it chose.
    expect(inlineScript).toContain(
      'homeRegionOut.textContent = model.regionName(homeRegion ?? accountRegion());',
    );
    expect(inlineScript).toContain('return store?.homeRegion?.()?.code ?? null;');
    // And the page above it stops asking for a signature once there is one (T1-19).
    // Round 7 (T7-12): an updated version a later visit finds signed says so too.
    expect(inlineScript).toContain(
      "eyebrow.textContent = mode === 'new' ? 'Your account' : 'Your agreement';",
    );
    expect(inlineScript).toMatch(
      /introCopy\.textContent = `Version \$\{text\.version\} · you signed it \$\{model\.dateText\(entry\.signedAt\)\}\. We keep your copy permanently\.`;/,
    );
    expect(inlineScript).toContain(
      "if (mode !== 'update' || !text || (shownRecord && !record.hidden)) return;",
    );
  });

  it('shows the record of a version already signed, and never signs it twice (R9-7)', () => {
    // Round 6 part 3 (T1-2): a new account's Back or reload lands on the signed record, not on
    // the form again, so nothing can be signed a second time; update mode still shows the form
    // while a version waits for the signature.
    expect(inlineScript).toContain(
      "const signedCurrent = recordOf(version);\n          if (signedCurrent && (mode === 'new' || !pending())) {\n            showRecord(signedCurrent);",
    );
    // Another tab signing it keeps this one honest.
    expect(inlineScript).toContain(
      "if (!form.hidden && recordOf(version) && (mode === 'new' || !pending())) setSide();",
    );
    // Not now takes the Region back to Create account (T1-8).
    expect(inlineScript).toMatch(
      /later\.href = `\.\/access-preview\.html\?mode=create&skipLoader\$\{\s*homeRegion \? `&region=\$\{homeRegion\.toLowerCase\(\)\}` : ''\s*\}`;/,
    );
  });

  it('marks a tour of six steps, and never starts it on a plain load', () => {
    const steps = [
      ...page.matchAll(
        /data-tour-step="(\d+)"\s+data-tour-title="([^"]+)"\s+data-tour-text="([^"]+)"/g,
      ),
    ];
    expect(steps.map((step) => Number(step[1])).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(page).toContain('<main class="agreement-main" id="main" data-tour-page="agreement"');
    // Round 6 (R6-3): Take the tour sits in the shared page intro, at the end of the title row.
    expect(page).toMatch(
      /<div class="page-intro-actions">\s*<button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour<\/button>\s*<\/div>\s*<\/section>/,
    );
    expect(page.match(/data-tour-open/g)).toHaveLength(1);
    // Round 6 (R6-2): the deputy gives the tour, so each title is his speech line (six words at
    // most) and each body says what he does, in the first person, with no dashes.
    for (const [, , title = '', body = ''] of steps) {
      expect(title.split(/\s+/).length, title).toBeLessThanOrEqual(6);
      expect(body, title).toMatch(/\bI\b/);
      expect(`${title} ${body}`).not.toMatch(/[–—]/);
    }
    expect(inlineScript).not.toMatch(/tour\.start\(|maybeStart\(/);
  });
});

describe('agreement-preview.html: signing', () => {
  it('signs through the store in one step, the account’s name being the signature (R10-8)', () => {
    const signing = block(
      inlineScript,
      'const signWithStore = () => {',
      'consents: consentIds });',
    );
    // JobDeputyStore.sign (round 7, ST): no typed name and no ticks; a store without it signs
    // through signAgreement with the account's name and the three confirmations the sentence states.
    expect(signing).toContain("if (typeof store.sign === 'function') return store.sign(details);");
    expect(signing).toContain(
      'return store.signAgreement({ ...details, name: account().name, consents: consentIds });',
    );
    expect(signing).toContain("context: mode === 'new' ? 'new' : 'update',");
    // Round 6 (G3): a new account's record keeps the home Region chosen at Create account.
    expect(signing).toContain("...(mode === 'new' ? { homeRegion: homeRegion ?? 'US' } : {}),");
    expect(inlineScript).toContain(
      "if (typeof store?.sign !== 'function' && typeof store?.signAgreement !== 'function') {",
    );
    // Once per version (R9-7): signed already shows the record, and keeps nothing twice.
    expect(inlineScript).toMatch(
      /if \(result\?\.ok === false && result\.reason === 'already-signed'\) \{[\s\S]*?showRecord\(existing\);/,
    );
    expect(inlineScript).toContain(
      "showOperationError('Nothing was signed. Reload the page, then sign again.');",
    );
  });

  it('plays the signing moment, about 1.2s, then goes on by itself (G3)', () => {
    const moment =
      page.match(/<section class="task-surface ag-moment"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(moment).toContain('hidden');
    // The signature line writes the name, the seal stamps with a check, the line says where next.
    expect(moment).toContain('<p class="ag-signature-name" id="ag-signature-name">Alex Morgan</p>');
    expect(moment).toContain('<span class="ag-signature-line"></span>');
    expect(moment).toContain('<span class="ag-seal">');
    expect(moment).toContain(
      '<h2 class="ag-moment-title" id="ag-moment-title" tabindex="-1">Signed. Taking you to setup.</h2>',
    );
    // The way on is a link from the first frame.
    expect(moment).toContain(
      '<a class="primary-action ag-moment-next" id="ag-moment-next" href="./onboarding-preview.html">Continue to setup</a>',
    );
    const play = block(inlineScript, 'const playMoment = (entry) => {', '}, MOMENT_MS);');
    // The panda is drawn before the moment is scrolled into view, so it fits whole.
    expect(play.indexOf('cheer();')).toBeLessThan(play.indexOf('moment.scrollIntoView('));
    // About 1.2s of moment, then time to hear it (T4-14): the page goes on at 2s.
    expect(inlineScript).toContain('const MOMENT_MS = 2000;');
    expect(play).toContain('signatureName.textContent = entry.name;');
    expect(play).toContain('momentTitle.textContent = line;');
    expect(play).toContain('cheer();');
    expect(play).toContain('window.location.assign(next.href);');
    // Into view first (T4-5), under the sticky header, and the page above says you signed.
    expect(play).toContain("moment.scrollIntoView({ block: 'nearest', behavior: 'auto' });");
    expect(play).toContain('markSigned(entry);');
    expect(page).toContain('scroll-margin-block: 89px 13px;');
    // Heard first (T4-14): focus goes to the line, which a screen reader says at once; signed with
    // the keyboard, focus goes to the way on (described by the line) and the page waits for it.
    expect(play).toMatch(
      /if \(waits\) \{\s*momentNext\.setAttribute\('aria-describedby', 'ag-moment-title'\);\s*momentNext\.focus\(\{ preventScroll: true \}\);\s*\} else \{\s*momentNext\.removeAttribute\('aria-describedby'\);\s*momentTitle\.focus\(\{ preventScroll: true \}\);\s*goTimer = window\.setTimeout\(/,
    );
    expect(inlineScript).toMatch(
      /submit\.addEventListener\('click', \(event\) => \{\s*byKeyboard = event\.detail === 0;/,
    );
    expect(model.readyLine()).toBe('Signed. Continue when you’re ready.');
    // Nothing in it widens the page, the stamp's first frame included (T2-5).
    expect(page).toContain('overflow: clip;\n        overflow-clip-margin: 13px;');
    expect(page).toContain('transform: rotate(-8deg) scale(1.25);');
    // The moment keeps the card's height, so nothing under it moves.
    expect(play).toMatch(
      /moment\.style\.minHeight = `\$\{Math\.round\(form\.getBoundingClientRect\(\)\.height\)\}px`;/,
    );
    // Motion only while html[data-motion] is on: reduced motion and Pause motion show the signed
    // state at once. The way on never animates in.
    for (const rule of [
      'html[data-motion="on"] .ag-moment.is-playing .ag-signature-name {',
      'html[data-motion="on"] .ag-moment.is-playing .ag-seal {',
      'html[data-motion="on"] .ag-moment.is-playing .ag-moment-title {',
    ]) {
      expect(page).toContain(rule);
    }
    expect(page).not.toMatch(/\.ag-moment-next\s*\{[^}]*animation/);
    expect(page).toContain('animation: ag-write 618ms var(--ease-settle) 120ms both;');
    // The deputy cheers with the pen (the signed reaction, or submitted until deputy.js has it), on
    // a moment host that never takes Setup's greeting.
    const cheer = block(
      inlineScript,
      'const cheer = () => {',
      'deputy.get(host)?.react(reaction, { ms: MOMENT_MS * 2 });',
    );
    expect(cheer).toContain("(deputy.reactions ?? []).includes('signed') ? 'signed' : 'submitted'");
    expect(cheer).toContain("host.setAttribute('data-deputy-moment', '');");
    expect(cheer).toContain('deputy.init(momentHost);');
  });

  it('says where it goes in the words of the way on, for every path (G3)', () => {
    expect(
      model.signedLine(
        model.nextStep({ mode: 'new', door: 'email', isNew: false, returnTo: null }),
      ),
    ).toBe('Signed. Taking you to setup.');
    expect(
      model.signedLine(
        model.nextStep({
          mode: 'update',
          door: null,
          isNew: false,
          returnTo: model.safeReturn('applications-preview.html#email'),
        }),
      ),
    ).toBe('Signed. Taking you back to Applications.');
    expect(
      model.signedLine(
        model.nextStep({
          mode: 'update',
          door: null,
          isNew: false,
          returnTo: model.safeReturn('onboarding-preview.html?step=resume&import=linkedin'),
        }),
      ),
    ).toBe('Signed. Taking you back to setup.');
    expect(
      model.signedLine(
        model.nextStep({
          mode: 'update',
          door: null,
          isNew: false,
          returnTo: model.safeReturn('account-preview.html#agreements'),
        }),
      ),
    ).toBe('Signed. Taking you back to Account.');
    expect(
      model.signedLine(
        model.nextStep({ mode: 'update', door: null, isNew: false, returnTo: null }),
      ),
    ).toBe('Signed. Taking you to your dashboard.');
    expect(model.methodName('one-step')).toBe('Sign and continue (one step)');
    expect(model.methodName('typed-name')).toBe('Typed name');
    expect(model.methodName(undefined)).toBe('Typed name');
  });

  it('goes back to ?return= as a return through Back, so that page keeps your place (T4-24)', () => {
    // The moment's way on, the record's, and Not now carry data-page-back-link when they lead to
    // ?return=; the moment's own move marks the return before it goes.
    expect(inlineScript).toContain(
      'const isReturn = (href) => Boolean(returnTo) && href === returnTo.href;',
    );
    expect(inlineScript).toContain("link.toggleAttribute('data-page-back-link', isReturn(href));");
    expect(inlineScript).toContain('if (isReturn(href)) components?.place?.markReturn?.(href);');
    for (const call of [
      'asWayBack(continueLink, next.href);',
      'asWayBack(momentNext, next.href);',
      "asWayBack(later, returnTo?.href ?? './home-preview.html?skipLoader');",
    ]) {
      expect(inlineScript).toContain(call);
    }
    expect(inlineScript).toMatch(
      /markReturn\(next\.href\);\s*window\.location\.assign\(next\.href\);/,
    );
    expect(inlineScript).not.toMatch(/(?:continueLink|momentNext)\.href = /);
  });

  it('shows the signed record on Back from the page cache, never the moment again (R9-7)', () => {
    expect(inlineScript).toMatch(
      /window\.addEventListener\('pageshow', \(event\) => \{\s*if \(!event\.persisted\) return;\s*busy = false;\s*describeStatus\(\);\s*setSide\(\);/,
    );
    const side = block(
      inlineScript,
      'const setSide = () => {',
      'unsigned.hidden = true;\n        };',
    );
    expect(side).toContain('stopMoment();');
  });

  it('holds what it redraws until its first render, then shows it in one frame (R10-1)', () => {
    expect(page).toContain('<p class="intro-copy" id="ag-intro-copy" data-skeleton="lines">');
    expect(page).toContain('<div class="ag-intro-notes" data-skeleton="lines">');
    expect(page).toMatch(/id="ag-region"[\s\S]*?data-skeleton\n/);
    expect(page).toContain('<div class="ag-side" data-skeleton>');
    expect(inlineScript).toMatch(
      /setSide\(\);\s*syncDownloads\(\);[\s\S]*?components\?\.boot\?\.ready\?\.\(\);/,
    );
  });

  it('never forces scrolling: nothing waits for the end of the text', () => {
    expect(inlineScript).not.toMatch(/scrollTop|scrollHeight|IntersectionObserver/);
  });

  it('renders every string as text, never as HTML', () => {
    expect(inlineScript).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it('downloads the signed copy through the shared download, with Markdown working without it', () => {
    // One builder for the file (agreement-text.js), so Help's Your agreements saves the same one.
    expect(inlineScript).toContain('const copy = texts?.signedCopy?.(shownRecord);');
    expect(inlineScript).not.toMatch(/const signedCopy =|model\.signedCopy/);
    expect(inlineScript).toContain("if (typeof components?.download === 'function') {");
    expect(inlineScript).toContain('const result = components.download(copy, kind);');
    expect(inlineScript).toContain(
      "new Blob([copy.markdown], { type: 'text/markdown;charset=utf-8' })",
    );
    expect(inlineScript).toMatch(/a\.download = `\$\{copy\.title\}\.md`;/);
    expect(inlineScript).toContain(
      "'PDF needs the shared download, which isn’t loaded on this page. Markdown works now.'",
    );
  });
});

describe('AgreementModel (the page’s pure helpers)', () => {
  it('reads the mode and the door, defaulting to signing the current version', () => {
    expect(['new', 'update', 'view', 'other', null].map((value) => model.modeOf(value))).toEqual([
      'new',
      'update',
      'view',
      'update',
      'update',
    ]);
    expect(
      ['email', 'google', 'linkedin', 'facebook', null].map((value) => model.doorOf(value)),
    ).toEqual(['email', 'google', 'linkedin', null, null]);
  });

  it('returns only to a prototype page in this folder', () => {
    expect(model.safeReturn('shop-preview.html#credits')).toEqual({
      href: './shop-preview.html#credits',
      page: 'shop',
    });
    expect(model.safeReturn('./searches-preview.html?q=work&page=2')?.href).toBe(
      './searches-preview.html?q=work&page=2',
    );
    for (const unsafe of [
      'https://evil.example/jobs-preview.html',
      '//evil.example/x-preview.html',
      '../jobs-preview.html',
      'javascript:alert(1)',
      'agreement-preview.html?mode=update',
      'shop-preview.html#"onload=x',
      'shop.html',
      '',
      null,
    ]) {
      expect(model.safeReturn(unsafe), String(unsafe)).toBeNull();
    }
  });

  it('reads the home Region chosen at Create account, and names it (round 6, G3)', () => {
    expect(model.regionOf('uk')).toBe('UK');
    expect(model.regionOf('IN')).toBe('IN');
    expect(model.regionOf('us')).toBe('US');
    for (const unknown of ['mars', '', null, 'toString', '__proto__']) {
      expect(model.regionOf(unknown), String(unknown)).toBeNull();
    }
    expect(model.regionName('UK')).toBe('United Kingdom (UK)');
    expect(model.regionName('IN')).toBe('India (IN)');
    // Without one, the sample account's Region.
    expect(model.regionName(null)).toBe('United States (US)');
  });

  it('writes the signing time in the home Region’s time zone (round 6 part 3, T1-19)', () => {
    const signedAt = '2026-10-02T14:00:00-07:00';
    // The United States account, and a record without a Region, read as the sample world does.
    expect(model.signedTimeText(signedAt, 'US')).toBe('Fri, Oct 2, 2026, 14:00 Pacific');
    expect(model.signedTimeText(signedAt, null)).toBe(model.dateTimeText(signedAt));
    expect(model.signedTimeText(signedAt, 'mars')).toBe(model.dateTimeText(signedAt));
    // Another Region reads in its own zone, with the Pacific time the signed copy and Account
    // show beside it, and its own date when the day differs there.
    expect(model.signedTimeText(signedAt, 'uk')).toBe(
      'Fri, Oct 2, 2026, 22:00 London (14:00 Pacific)',
    );
    expect(model.signedTimeText(signedAt, 'IN')).toBe(
      'Sat, Oct 3, 2026, 02:30 Kolkata (Fri, Oct 2, 2026, 14:00 Pacific)',
    );
    // The seeded 2026.09 signature too (an evening in Pacific is the next morning in London).
    expect(model.signedTimeText('2026-09-14T19:20:00-07:00', 'UK')).toBe(
      'Tue, Sep 15, 2026, 03:20 London (Mon, Sep 14, 2026, 19:20 Pacific)',
    );
  });

  it('continues to setup with the door, or back where you were, or to the Dashboard', () => {
    expect(model.nextStep({ mode: 'new', door: 'linkedin', isNew: true, returnTo: null })).toEqual({
      href: './onboarding-preview.html?via=linkedin&new=1',
      label: 'Continue to setup',
      going: 'to setup',
    });
    // Round 6 (G3): the home Region chosen at Create account goes on to setup's Welcome.
    expect(
      model.nextStep({ mode: 'new', door: 'google', isNew: false, returnTo: null, region: 'UK' })
        .href,
    ).toBe('./onboarding-preview.html?via=google&region=uk');
    expect(
      model.nextStep({ mode: 'new', door: null, isNew: false, returnTo: null, region: 'in' }).href,
    ).toBe('./onboarding-preview.html?region=in');
    expect(
      model.nextStep({ mode: 'new', door: 'email', isNew: false, returnTo: null, region: 'mars' })
        .href,
    ).toBe('./onboarding-preview.html?via=email');
    expect(model.nextStep({ mode: 'new', door: 'email', isNew: false, returnTo: null }).href).toBe(
      './onboarding-preview.html?via=email',
    );
    expect(model.nextStep({ mode: 'new', door: null, isNew: false, returnTo: null }).href).toBe(
      './onboarding-preview.html',
    );
    expect(
      model.nextStep({
        mode: 'update',
        door: null,
        isNew: false,
        returnTo: model.safeReturn('shop-preview.html#credits'),
      }),
      // Round 6 (T1): the Shop is Purchases, under Settings.
    ).toEqual({
      href: './shop-preview.html#credits',
      label: 'Back to Purchases',
      going: 'back to Purchases',
    });
    expect(model.nextStep({ mode: 'update', door: null, isNew: false, returnTo: null })).toEqual({
      href: './home-preview.html?skipLoader',
      label: 'Go to your dashboard',
      going: 'to your dashboard',
    });
  });

  it('reads the Markdown back line for line, so the page shows exactly what is signed', () => {
    for (const version of Object.values(text.versions)) {
      const blocks = model.parse(version.markdown);
      const lines = blocks.flatMap((entry) =>
        entry.type === 'list'
          ? (entry.items ?? []).map((item) => `- ${item}`)
          : entry.type === 'section'
            ? [`## ${entry.number}. ${entry.text}`]
            : entry.type === 'title'
              ? [`# ${entry.text}`]
              : [entry.text ?? ''],
      );
      expect(lines).toEqual(version.markdown.split('\n').filter((line) => line.trim()));
      expect(blocks.filter((entry) => entry.type === 'section')).toHaveLength(
        version.sections.length,
      );
    }
  });

  it('marks placeholders without losing a character', () => {
    const sample = 'Refunds: [Owner: refund window]. See [Counsel: law] now.';
    const pieces = model.pieces(sample);
    expect(pieces.map((piece) => piece.text).join('')).toBe(sample);
    expect(pieces.filter((piece) => piece.placeholder).map((piece) => piece.text)).toEqual([
      '[Owner: refund window]',
      '[Counsel: law]',
    ]);
  });

  it('formats the fingerprint and the date', () => {
    expect(model.groups(current.sha256).split(' ')).toHaveLength(8);
    expect(model.dateText('2026-09-14T19:20:00-07:00')).toBe('Mon, Sep 14, 2026');
    expect(model.dateTimeText('2026-09-14T19:20:00-07:00')).toBe(
      'Mon, Sep 14, 2026, 19:20 Pacific',
    );
  });

  it('writes dates as the signed copy does, so the record and its file agree', () => {
    for (const value of [
      '2026-09-14T19:20:00-07:00',
      '2026-10-02T14:03:00-07:00',
      '2026-10-15T00:00:00-07:00',
      '2026-11-01T00:00:00Z',
    ]) {
      expect(model.dateText(value), value).toBe(text.dateText(value));
      expect(model.dateTimeText(value), value).toBe(text.dateTimeText(value));
    }
  });

  it('downloads the text you signed, then its signature record (agreement-text.js)', () => {
    const signed = text.signedCopy({
      version: '2026.10',
      signedAt: '2026-10-02T14:03:00-07:00',
      name: 'Alex Morgan',
      email: 'alex.morgan@example.com',
      fingerprint: current.sha256,
      consents: ['read', 'act', 'keep'],
    });
    expect(signed?.version).toBe('2026.10');
    // Named for the version, so the file saves as "JobDeputy User Agreement 2026.10, signed.pdf".
    expect(signed?.title).toBe('JobDeputy User Agreement 2026.10, signed');
    expect(Object.isFrozen(signed)).toBe(true);
    const copy = signed?.markdown ?? '';
    expect(copy.startsWith(current.markdown.trimEnd())).toBe(true);
    expect(copy.endsWith('\n')).toBe(true);
    const record = copy.slice(current.markdown.trimEnd().length);
    for (const line of [
      '## Signature record',
      '- Version: 2026.10',
      '- Signed: Fri, Oct 2, 2026, 14:03 Pacific',
      '- Name typed as the signature: Alex Morgan',
      '- Email: alex.morgan@example.com',
      '- Method: typed name',
      `- Fingerprint of the text above (SHA-256): ${current.sha256}`,
      '- Kept: permanently, apart from the account',
      '- I read the agreement',
      '- I allow my deputy to act for me as it describes',
    ]) {
      expect(record).toContain(line);
    }
    expect(copy).not.toMatch(/[\u2013\u2014]/);
    // A record without a home Region (the seed's) names none; a new account's names the one it
    // chose at Create account (round 6, G3).
    expect(record).not.toContain('Home Region');
    const chosen = text.signedCopy({
      version: '2026.10',
      signedAt: '2026-10-02T14:03:00-07:00',
      name: 'Alex Morgan',
      email: 'alex.morgan@example.com',
      homeRegion: 'UK',
      consents: ['read', 'act', 'keep'],
    });
    expect(chosen?.markdown).toContain(
      '- Email: alex.morgan@example.com\n- Home Region: United Kingdom (UK)\n- Method: typed name',
    );
    expect(
      text.signedCopy({
        version: '2026.10',
        signedAt: '2026-10-02T14:03:00-07:00',
        name: 'Alex Morgan',
        email: 'alex.morgan@example.com',
        // Only the three Regions, never an inherited property name.
        homeRegion: 'toString',
      })?.markdown,
    ).not.toContain('Home Region');
    // The seeded 2026.09 record (as agreements().signed lists it) builds its own copy; a version
    // the text lacks, or a record without a date, builds none.
    const older = text.signedCopy({
      version: '2026.09',
      signedAt: '2026-09-14T19:20:00-07:00',
      name: 'Alex Morgan',
      email: 'alex.morgan@example.com',
      fingerprint: previous.sha256,
      consents: ['read', 'act', 'keep'],
    });
    expect(older?.markdown.startsWith(previous.markdown.trimEnd())).toBe(true);
    expect(older?.markdown).toContain('- Signed: Mon, Sep 14, 2026, 19:20 Pacific');
    // Round 7 (G3): a one-step record says who signed and how, and repeats the one sentence it
    // was signed under instead of three ticks.
    const oneStep =
      text.signedCopy({
        version: '2026.10',
        signedAt: '2026-10-02T14:03:00-07:00',
        name: 'Alex Morgan',
        email: 'alex.morgan@example.com',
        method: 'one-step',
        homeRegion: 'US',
        consents: ['read', 'act', 'keep'],
      })?.markdown ?? '';
    const oneStepRecord = oneStep.slice(current.markdown.trimEnd().length);
    for (const line of [
      '- Signed as: Alex Morgan',
      '- Home Region: United States (US)',
      '- Method: Sign and continue (one step)',
      `What the signature confirms:\n\n${text.sentence('2026.10')}\n`,
    ]) {
      expect(oneStepRecord).toContain(line);
    }
    expect(oneStepRecord).not.toContain('typed');
    expect(oneStepRecord).not.toContain('- I read the agreement');
    expect(text.signedCopy({ version: '2025.01', signedAt: '2026-09-14T19:20:00-07:00' })).toBe(
      null,
    );
    expect(text.signedCopy({ version: '2026.09' })).toBe(null);
    expect(text.signedCopy({})).toBe(null);
  });
});
