import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Page guarantees for Settings, Account (brand/account-preview.html, round 6, T1): how you sign in
// (#acct-signin: the email read-only, once (P-18), your access with a link to AI & credits (P-11),
// the sign-in methods with LinkedIn when connected, and the password change with the shared toggle
// rules), the locked home Region (#acct-region), your agreements (#agreements, the agreement's
// home since part 2, P-6, moved from Help: the version that waits with what changed, the
// reminders, the pause date, what pauses and never pauses, and Sign now; then the copies you
// signed with View and Download), and your data (#acct-data: export, planned, and Delete account
// with what is erased and what is kept). One Sample data note for the page (P-16). Everything but the agreements moved here from Profile's
// Account section with its behaviour; those round 5 tests moved from profile.test.ts and changed
// only where the page did (the ids' prefix, the section headings, and the deputy's first-person
// tour, R6-2). The page keeps its pure rules between `/* account-rules: start */` and `end`
// markers; they run here on their own. The rendered checks run in scripts/ui-audit.mjs.

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');
const page = sourceFor('account-preview.html');

function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const mainOf = (source: string): string => source.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? '';
const stylesOf = (source: string): string =>
  [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1] ?? '')
    .join('\n');
const scriptOf = (source: string): string =>
  [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '').join('\n');

function elementById(source: string, id: string): string {
  const open = new RegExp(`<([a-z][\\w-]*)\\b[^>]*\\sid="${id}"[^>]*>`).exec(source);
  if (!open) return '';
  const tag = open[1] ?? '';
  const pattern = new RegExp(`<${tag}\\b|</${tag}\\s*>`, 'g');
  pattern.lastIndex = open.index + open[0].length;
  let depth = 1;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return source.slice(open.index, match.index + match[0].length);
  }
  return '';
}

const attributesOf = (tag: string): Record<string, string> =>
  Object.fromEntries(
    [...tag.matchAll(/\s([\w:-]+)(?:="([^"]*)")?/g)].map((match) => [
      match[1] ?? '',
      match[2] ?? '',
    ]),
  );

const words = (text: string): number =>
  text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

function rulesOf<T>(source: string, name: string, global: string): T {
  const start = source.indexOf(`/* ${name}-rules: start */`);
  const end = source.indexOf(`/* ${name}-rules: end */`);
  if (start < 0 || end < start) throw new Error(`${name}-rules markers not found`);
  const block = source.slice(start, end);
  return new Script(`${block}\n${global};`, { filename: `${name}-rules` }).runInNewContext({}) as T;
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type AccountRules = {
  summaryTitle(count: number): string;
  validatePassword(values: { current: string; next: string; confirm: string }): Array<{
    field: string;
    message: string;
  }>;
  DELETE_PHRASE: string;
  deletionConfirmed(text: string): boolean;
  reminderName(index: number, total: number): string;
  signedTimeText(value: string, region?: string | null): string;
  MOVED: Record<string, string>;
  movedTo(location: { hash?: string }): string | null;
};
const rules = rulesOf<AccountRules>(page, 'account', 'accountRules');

type Store = {
  metricText(key: string): string;
  aiChoice(): { summary: string; href: string };
  agreements(): unknown;
  connectLinkedin(): { status: string };
  signAgreement(fields: Record<string, unknown>): { ok: boolean };
};
function sampleStore(): Store {
  const storage = new Map<string, string>();
  const window: Record<string, unknown> = { addEventListener: () => {} };
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  window.crypto = globalThis.crypto;
  runInNewContext(sourceFor('sample-store.js'), { window, localStorage, JSON });
  return window.JobDeputyStore as Store;
}

const main = mainOf(page);
// Round 6 part 2 (P-11): Access and Deputy Assist is one row in Sign-in now.
// Round 7 (D8): Emails from JobDeputy joins after Sign-in.
const SECTION_IDS = ['acct-signin', 'emails', 'acct-region', 'agreements', 'acct-data'];

describe('Account page frame', () => {
  it('loads the sample store between the components and the deputy, and the panels last', () => {
    const order = [
      'app-shell.js',
      'app-components.js',
      'sample-store.js',
      'deputy.js',
      'feedback.js',
      'app-panels.js',
    ].map((name) => page.indexOf(`<script src="./${name}"></script>`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order[5]).toBeLessThan(page.indexOf('<script>'));
  });

  it('opens with the Settings intro, the tab strip, and the protect-data deputy', () => {
    expect(page).toContain('<title>JobDeputy · Settings · Account</title>');
    expect(textOf(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')).toBe('Your account.');
    expect(main).toContain('<p class="eyebrow">Settings</p>');
    const lede = textOf(main.match(/<p class="intro-copy">([\s\S]*?)<\/p>/)?.[1] ?? '');
    expect(words(lede)).toBeGreaterThan(0);
    expect(words(lede)).toBeLessThanOrEqual(16);
    expect(page).toContain('data-deputy-page="account"');
    expect(page).toContain('data-deputy-state="protect-data"');
    const intro = main.indexOf('<section class="page-intro');
    const tabs = main.indexOf('<!-- SettingsTabs: start -->');
    expect(tabs).toBeGreaterThan(intro);
    expect(main.slice(main.indexOf('</section>', intro), tabs).trim()).toBe('</section>');
    expect(main).toContain(
      '<a class="settings-tab" href="./account-preview.html" aria-current="page">Account</a>',
    );
    // Round 7: the seven Settings tabs, Usage after AI & credits and Activity last.
    expect(
      [...main.matchAll(/<a class="settings-tab" href="\.\/([\w-]+)\.html"/g)].map(
        (match) => match[1],
      ),
    ).toEqual([
      'account-preview',
      'connections-preview',
      'prompts-preview',
      'ai-preview',
      'usage-preview',
      'shop-preview',
      'activity-preview',
    ]);
    // Round 7 (R10-3): a home, so a link here with return= gets Back to its page.
    expect(main).toContain(
      '<section class="page-intro account-intro" aria-labelledby="page-title" data-page-back>',
    );
    expect(page).not.toContain('account-building');
    expect(page).not.toMatch(/Being built/);
  });

  it('shows five section cards in order, each with an icon, a heading, and one short line', () => {
    const sections = [
      ...main.matchAll(/<section\s+class="task-surface acct-section"\s+id="([\w-]+)"/g),
    ].map((match) => match[1]);
    expect(sections).toEqual(SECTION_IDS);
    const headings = SECTION_IDS.map((id) =>
      textOf(elementById(page, id).match(/<h2 id="[\w-]+">([\s\S]*?)<\/h2>/)?.[1] ?? ''),
    );
    expect(headings).toEqual([
      'Sign-in',
      'Emails from JobDeputy',
      'Home Region',
      'Your agreements',
      'Your data',
    ]);
    for (const id of SECTION_IDS) {
      const section = elementById(page, id);
      expect(section, `#${id} icon`).toContain(
        '<span class="acct-section-icon" aria-hidden="true"',
      );
      const line = section.match(/<p class="acct-section-line">([\s\S]*?)<\/p>/)?.[1] ?? '';
      expect(words(textOf(line)), `#${id} line`).toBeGreaterThan(0);
      expect(words(textOf(line)), `#${id} line`).toBeLessThanOrEqual(14);
      expect(section, `#${id} sample note`).not.toContain(
        '<p class="sample-note">Sample data · not connected</p>',
      );
    }
    // Round 6 part 2 (P-16): one Sample data note for the page, under the lede; the agreements
    // keep their own (a draft for counsel), which differs.
    expect(main.match(/>Sample data · not connected</g)).toHaveLength(1);
    expect(main).toMatch(
      /<p class="intro-copy">[^<]+<\/p>\s*<p class="sample-note acct-page-note">Sample data · not connected<\/p>/,
    );
    expect(elementById(page, 'agreements')).toContain(
      '<p class="sample-note">Draft for counsel review · not legal advice</p>',
    );
    expect(page.match(/<h1\b/g)).toHaveLength(1);
  });

  it('answers the deep links other pages use, Profile’s forwards among them', () => {
    const ids = new Set([...page.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? ''));
    for (const id of [...SECTION_IDS, 'account', 'page-title']) {
      expect(ids.has(id), `#${id}`).toBe(true);
    }
    const profile = sourceFor('profile-preview.html');
    expect(profile).toContain('account: ACCOUNT_PAGE,');
    for (const id of ['acct-signin', 'acct-region', 'acct-data']) {
      expect(profile, id).toContain(`'${id}': \`\${ACCOUNT_PAGE}#${id}\``);
    }
    // Round 6 part 2 (P-11): Access and Deputy Assist's old anchors go to AI & credits, from
    // Profile and from here, at once (location.replace).
    expect(profile).toContain("'ai-access': AI_PAGE,");
    expect(plain(rules.MOVED)).toEqual({
      'ai-access': './ai-preview.html#ai',
      // Round 7 (T7-9): usage has its own tab.
      usage: './usage-preview.html',
    });
    expect(rules.movedTo({ hash: '#ai-access' })).toBe('./ai-preview.html#ai');
    expect(rules.movedTo({ hash: '#usage' })).toBe('./usage-preview.html');
    for (const hash of ['', '#agreements', '#acct-signin', '#%E0%A4%A'])
      expect(rules.movedTo({ hash }), hash).toBeNull();
    expect(sourceFor('ai-preview.html')).toContain('id="ai"');
    const script = scriptOf(page);
    expect(script).toContain('const next = accountRules.movedTo(window.location);');
    expect(script).toContain('if (next) window.location.replace(next);');
    expect(script).toContain('if (accountAway) return;');
    expect(page).not.toContain('id="ai-access"');
    expect(page).not.toContain('id="usage"');
    expect(scriptOf(page)).toContain("window.addEventListener('load', placeHash, { once: true });");
  });
});

describe('Account sign-in and the home Region (moved from Profile)', () => {
  it('shows the email read-only, the sign-in methods, and the home Region as locked', () => {
    const signin = elementById(page, 'acct-signin');
    expect(signin).not.toMatch(/type="email"/);
    expect(textOf(signin)).toContain(
      'Email alex.morgan@example.com Read-only. You sign in with this address.',
    );
    // Round 6 part 2 (P-18): the address shows once, in the Email row.
    expect(textOf(signin).match(/alex\.morgan@example\.com/g)).toHaveLength(1);
    expect(textOf(signin)).toContain('Email and password Your email above, and a password Primary');
    // P-11: your access is one row, linking to AI & credits for the setting and the credits.
    expect(textOf(elementById(page, 'acct-access'))).toBe(
      'Access Free access Your AI setting and credits are in AI & credits. Open AI & credits',
    );
    expect(elementById(page, 'acct-access')).toContain(
      '<a class="chart-action" id="acct-access-ai" href="./ai-preview.html#ai">',
    );
    expect(textOf(signin)).toContain(
      'Google Connected in this prototype. No Google request is made. Connected',
    );
    // Signed in with LinkedIn shows here like Google once connected (in Settings, Connections).
    expect(textOf(elementById(page, 'acct-method-linkedin'))).toBe(
      'LinkedIn Connected in this prototype. No LinkedIn request is made. Connected',
    );
    expect(elementById(page, 'acct-method-linkedin')).toMatch(
      /^<li class="acct-method" id="acct-method-linkedin" hidden>/,
    );
    expect(scriptOf(page)).toContain("if (row) row.hidden = linkedin?.status !== 'connected';");
    const region = elementById(page, 'acct-region');
    expect(textOf(region)).toContain('United States home Region Locked to your account');
    // The Region's name and "home Region" are one flex item, so a word space (never the heading's
    // flex gap) separates them (T4-R5); R9-6 fills the name from homeRegion().
    expect(region).toContain(
      '<span><span data-home-region-name>United States</span> home Region</span>',
    );
    expect(region).toContain('data-deputy-prop="shield"');
  });

  it('follows the shared password-toggle rules', () => {
    const toggles = [
      ...page.matchAll(/<button\s+class="acct-toggle"([^>]*)>\s*Show\s*<\/button>/g),
    ].map((match) => attributesOf(match[1] ?? ''));
    expect(toggles.map((toggle) => toggle['aria-label'])).toEqual([
      'Show current password',
      'Show new password',
    ]);
    expect(page).not.toMatch(/\saria-pressed=/);
    expect(page).toContain('autocomplete="current-password"');
    expect(page.match(/autocomplete="new-password"/g)).toHaveLength(2);
    expect(page).toMatch(
      /button\.setAttribute\('aria-label', `\$\{show \? 'Hide' : 'Show'\} \$\{name\}`\);/,
    );
    expect(elementById(page, 'acct-password-open')).toContain('aria-controls="acct-password-form"');
    expect(page).toContain('placeholder="At least 12 characters"');
    expect(
      rules
        .validatePassword({ current: '', next: 'short', confirm: 'short' })
        .map((error) => error.field),
    ).toEqual(['current', 'next']);
    expect(
      rules.validatePassword({
        current: 'a-long-old-password',
        next: 'a-long-old-password',
        confirm: 'x',
      }),
    ).toEqual([
      { field: 'next', message: 'Choose a password that’s different from your current one.' },
      { field: 'confirm', message: 'Enter the same new password again.' },
    ]);
    expect(rules.summaryTitle(1)).toBe('Check one detail before continuing.');
    expect(rules.summaryTitle(3)).toBe('Check 3 details before continuing.');
    // Nothing is sent: the result says so where you asked.
    expect(textOf(elementById(page, 'acct-password-feedback'))).toContain('Nothing was changed');
  });
});

describe('Account agreements (#agreements, the agreement’s home since round 6 part 2, P-6)', () => {
  const section = elementById(page, 'agreements');

  it('shows the version that waits: what changed, the reminders, the pause, what pauses and never does, and Sign now', () => {
    const store = sampleStore();
    const pending = elementById(page, 'acct-agreements-pending');
    expect(pending).toMatch(
      /^<div class="acct-agreements-pending" id="acct-agreements-pending" data-state="pending">/,
    );
    expect(textOf(elementById(page, 'acct-agreements-pending-title'))).toBe(
      'Version 2026.10 is waiting for your signature',
    );
    expect(textOf(elementById(page, 'acct-agreements-pending-line'))).toBe(
      `Published ${store.metricText('agreement.publishedAt')} · ${store.metricText('agreement.daysLeft')} days left to sign`,
    );
    const agreements = store.agreements() as {
      pending: { changes: string[]; reminders: unknown[] };
      pauses: string[];
      neverPauses: string[];
    };
    expect(textOf(elementById(page, 'acct-agreements-changes'))).toBe(
      agreements.pending.changes.join(' '),
    );
    expect(textOf(elementById(page, 'acct-agreements-reminders-lead'))).toBe(
      `${store.metricText('agreement.remindersSent')} of ${agreements.pending.reminders.length} sent, each in the app and by email.`,
    );
    const timeline = elementById(page, 'acct-agreements-reminders');
    expect(
      [...timeline.matchAll(/<p class="timeline-title">([^<]+)<\/p>/g)].map((match) => match[1]),
    ).toEqual([
      'First reminder',
      'Second reminder',
      'Third reminder',
      'Fourth reminder',
      'Last reminder',
      'Your deputy pauses until you sign',
    ]);
    expect(timeline).toContain('<span data-metric="agreement.nextReminderAt">Sun, Oct 4</span>');
    expect(timeline).toContain('<span data-metric="agreement.pauseAt">Thu, Oct 15</span>');
    expect(rules.reminderName(0, 5)).toBe('First reminder');
    expect(rules.reminderName(4, 5)).toBe('Last reminder');
    expect(rules.reminderName(8, 10)).toBe('Reminder 9');
    expect(textOf(section)).toContain(`Pauses until you sign ${agreements.pauses.join(' ')}`);
    expect(textOf(section)).toContain(`Never pauses ${agreements.neverPauses.join(' ')}`);
    // Sign now comes back here, and the page keeps the link's return in step with the store.
    expect(elementById(page, 'acct-agreements-sign')).toMatch(
      /^<a class="primary-action" id="acct-agreements-sign" href="\.\/agreement-preview\.html\?mode=update&amp;return=account-preview\.html%23agreements">Sign now/,
    );
    const script = scriptOf(page);
    expect(script).toContain(
      "const RETURN_HERE = encodeURIComponent('account-preview.html#agreements');",
    );
    expect(script).toContain(
      "const href = withReturn(pending.href ?? './agreement-preview.html?mode=update');",
    );
    // Overdue (Help's demo) says so here too, and once signed the block says you are up to date.
    expect(script).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the page's own source text, matched as written
      'overdue ? `Version ${pending.version} is overdue` : `Version ${pending.version} is waiting for your signature`',
    );
    expect(textOf(elementById(page, 'acct-agreements-current'))).toBe(
      'You’re up to date: you signed the current version.',
    );
    expect(elementById(page, 'acct-agreements-demo-note')).toContain(
      'href="./trust-preview.html#help-overdue"',
    );
    expect(sourceFor('trust-preview.html')).toContain('id="help-overdue"');
  });

  it('lists every copy you signed with View and Download, kept permanently', () => {
    const copies = elementById(page, 'acct-agreements-copies');
    expect(textOf(copies)).toBe(
      'Version 2026.09 Signed Mon, Sep 14, 2026, 19:20 Pacific, as Alex Morgan · kept permanently View',
    );
    // Each copy's time is said the agreement record's way (T1-R2): in the record's home Region's
    // own time zone, with Pacific beside it where they differ; a record without a Region is the
    // sample account's, the US, as before.
    const at = '2026-10-02T14:00:00-07:00';
    expect([null, 'US', 'UK', 'IN'].map((region) => rules.signedTimeText(at, region))).toEqual([
      'Fri, Oct 2, 2026, 14:00 Pacific',
      'Fri, Oct 2, 2026, 14:00 Pacific',
      'Fri, Oct 2, 2026, 22:00 London (14:00 Pacific)',
      'Sat, Oct 3, 2026, 02:30 Kolkata (Fri, Oct 2, 2026, 14:00 Pacific)',
    ]);
    expect(rules.signedTimeText('2026-09-14T19:20:00-07:00', null)).toBe(
      'Mon, Sep 14, 2026, 19:20 Pacific',
    );
    expect(scriptOf(page)).toContain(
      'const signedText = (record) => rules.signedTimeText(record.signedAt, record.homeRegion);',
    );
    expect(copies).toContain(
      '<button type="button" class="compact-action" data-agreement-view="2026.09" aria-describedby="acct-agreements-copy-2026-09">View</button>',
    );
    expect(copies).toContain(
      '<div class="acct-agreements-copy-download" data-agreement-download="2026.09"></div>',
    );
    const script = scriptOf(page);
    for (const part of [
      'const agreementTexts = window.JobDeputyAgreementText ?? null;',
      "record && typeof agreementTexts?.signedCopy === 'function' ? agreementTexts.signedCopy(record) : null;",
      'const made = components.downloadMenu(kept ?? host, () => signedCopyOf(record), {',
      'components.preview.open(',
      'window.location.assign(withReturn(record.href));',
    ]) {
      expect(script, part).toContain(part);
    }
    expect(page).toContain('<script src="./agreement-text.js"></script>');
    // Help's block moved here: the page names it as the home, and Help's card links here (B8).
    expect(section).not.toContain('Your agreements in Help');
  });
});

describe('Account access, Deputy Assist, and your data (moved from Profile)', () => {
  it('confirms account deletion with what is erased, the typed phrase, and an honest result', () => {
    const trigger = page.match(
      /<button\s+class="compact-action acct-danger"[^>]*>([\s\S]*?)<\/button>/,
    );
    expect(textOf(trigger?.[1] ?? '')).toBe('Delete account');
    expect(trigger?.[0]).toContain('data-drawer-open="acct-delete-drawer"');
    expect(page).toMatch(/\.acct-danger \{\s*color: var\(--danger-ink\);\s*\}/);
    const drawer = elementById(page, 'acct-delete-drawer');
    expect(drawer).toMatch(/^<dialog\s+class="drawer"/);
    expect(drawer).toMatch(/<div class="drawer-header">\s*<p class="eyebrow">Your data<\/p>/);
    const copy = textOf(drawer);
    expect(copy).toContain('can’t be undone');
    expect(copy).toContain(
      'Every table and file for alex.morgan@example.com in the United States home Region',
    );
    expect(copy).toContain('Application answers and how your deputy applies');
    expect(copy).toContain('Type “delete my account” to confirm');
    expect(copy).toContain('Prototype only: nothing is deleted and no request is sent.');
    expect(copy).toContain(
      'This erases everything listed and can’t be undone. Your signed agreements are kept.',
    );
    expect(copy).toContain(
      'What is kept Your signed agreements, permanently and apart from your account: each version, its fingerprint, the name you signed as, your email, and when you signed. A new account signs the agreement again, even with the same email. Your agreements, above on this page, list every copy with View and Download.',
    );
    expect(copy).toContain('Site accounts your deputy created, their passwords, and the vault log');
    // Round 6 part 2 (P-6): the agreements' home is this page, so the drawer points up to it.
    expect(drawer).not.toContain('trust-preview.html#agreements');
    expect(textOf(elementById(page, 'acct-data'))).toContain('Your signed agreements are kept.');
    expect(textOf(elementById(page, 'acct-delete-feedback'))).toContain('Nothing was deleted');
    expect(drawer).toContain('<p class="sr-only" id="acct-delete-status" role="status"');
    expect(rules.DELETE_PHRASE).toBe('delete my account');
    expect(rules.deletionConfirmed('  Delete   my account ')).toBe(true);
    expect(rules.deletionConfirmed('delete account')).toBe(false);
    expect(scriptOf(page)).toContain(
      "deputy?.flash('protect-data', { speech: 'Nothing was deleted.', ms: 2605 });",
    );
  });

  it('says export is planned where you ask for it; the credits and the AI setting are AI & credits’ (P-11)', () => {
    expect(textOf(elementById(page, 'acct-export-feedback'))).toBe(
      'i Export isn’t available yet It’s planned for launch. Nothing was prepared or downloaded.',
    );
    expect(textOf(elementById(page, 'acct-data'))).toContain('Export Planned');
    // No credits, model, AI setting, or Buy credits here: AI & credits is their home.
    expect(page).not.toMatch(/data-metric="ai\./);
    expect(page).not.toContain('data-topup-open');
    expect(scriptOf(page)).not.toMatch(/aiChoice|renderAiSource/);
    expect(textOf(main)).not.toMatch(/\bAI runs?\b|free AI runs|More AI runs/);
    expect(textOf(page)).not.toMatch(/[$€£]\s?\d|\bper month\b|\/mo\b|Premium/);
  });
});

describe('Account emails (#emails, round 7, D8)', () => {
  it('offers the daily summary, off by default, with its time, its cost in runs, and a sample', () => {
    const section = elementById(page, 'emails');
    expect(section).toMatch(
      /^<section\s+class="task-surface acct-section"\s+id="emails"\s+aria-labelledby="emails-title"/,
    );
    // Its home: the switch, said in words before you turn it on (R10-9: it uses a run).
    expect(section).toContain(
      '<input type="checkbox" role="switch" id="acct-summary-on" name="summary" aria-checked="false" aria-describedby="acct-summary-about acct-summary-cost" />',
    );
    // The shared switch, as the Dashboard's "Email me this every morning" (PL's .switch).
    expect(section).toMatch(
      /<label class="switch acct-email-switch">\s*<input [^>]+>\s*<span class="switch-track" aria-hidden="true"><\/span>\s*<span class="switch-label">Email me a summary every morning<\/span>\s*<\/label>/,
    );
    expect(page).not.toMatch(/id="acct-summary-on"[^>]*\schecked/);
    expect(textOf(elementById(page, 'acct-summary'))).toContain(
      'Daily summary Email me a summary every morning Your glance figures, your To-do, and what changed since yesterday, with a link to your live Dashboard. Send it at',
    );
    expect(textOf(elementById(page, 'acct-summary-cost'))).toBe(
      'Your time. Uses 1 run each morning.',
    );
    expect(elementById(page, 'acct-summary-time')).toContain(
      '<option value="08:00" selected>08:00</option>',
    );
    expect(elementById(page, 'acct-summary-sample')).toBe(
      // T4-10: coming Back from the sample returns focus here.
      '<a class="chart-action" id="acct-summary-sample" href="./summary-email-preview.html" data-return-link data-focus-key="acct-summary-sample">See a sample<span class="sr-only"> of the daily summary email</span></a>',
    );
    // The email after each application moved here from Applications (the orchestrator's decision
    // on D8): the shared switch on the same setting, on as the store has it; it uses no run.
    expect(elementById(page, 'acct-after-apply')).toContain(
      '<input type="checkbox" role="switch" id="acct-after-apply-on" name="notify-email" aria-checked="true" aria-describedby="acct-after-apply-about" checked />',
    );
    expect(textOf(elementById(page, 'acct-after-apply'))).toBe(
      'After each application Email me when my deputy applies One email for each application your deputy sends for you, with the role and its materials. Uses no run.',
    );
    expect(page).not.toContain('acct-after-apply-change');
    const script = scriptOf(page);
    for (const part of [
      "const summaryOf = () => (typeof store?.summarySubscription === 'function' ? store.summarySubscription() : null);",
      'const saved = saveSummary({ subscribed: summaryOn.checked, time: summaryTime.value });',
      'const saved = saveSummary({ time: summaryTime.value });',
      'const notify = apply?.notifyEmail !== false;',
      'store.setApplyRules({ notifyEmail: afterApplyOn.checked })',
    ]) {
      expect(script, part).toContain(part);
    }
    // Without the store's subscription the switch is off and says why, never a made-up state.
    expect(script).toContain('summaryOn.disabled = !ready;');
    expect(script).toContain("'The daily summary isn’t available on this page yet.'");
  });
});

describe('Account figures, tour, and reactions', () => {
  it('carries every figure as data-metric, once, equal to the store on the seed (R3-3, R3-4)', () => {
    const store = sampleStore();
    const shown = [...main.matchAll(/data-metric="([\w.]+)">([^<]*)</g)].map(
      (match): [string, string] => [match[1] ?? '', match[2] ?? ''],
    );
    const keys = shown.map(([key]) => key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      'agreement.publishedAt',
      'agreement.daysLeft',
      'agreement.remindersSent',
      'agreement.nextReminderAt',
      'agreement.pauseAt',
    ]);
    for (const [key, text] of shown) expect(text, key).toBe(store.metricText(key));
    expect(scriptOf(page)).toContain("for (const node of $$('main [data-metric]')) {");
  });

  it('gives the tour in the deputy’s first person: six steps in page order (R6-2)', () => {
    const steps = [
      ...page.matchAll(
        /data-tour-step="(\d)"\s+data-tour-title="([^"]+)"\s+data-tour-text="([^"]+)"/g,
      ),
    ].map((match) => [match[1], match[2], match[3] ?? '']);
    expect(steps.map(([step, title]) => [step, title])).toEqual([
      ['1', 'I guard your account here.'],
      ['2', 'These are your sign-in methods.'],
      // Round 7 (D8): the daily summary email.
      ['3', 'I can email you each morning.'],
      ['4', 'Your data stays in the US.'],
      ['5', 'I keep what you signed.'],
      ['6', 'You can leave any time.'],
    ]);
    for (const [, title, text] of steps) {
      expect(words(title ?? ''), title).toBeLessThanOrEqual(6);
      expect(words(text ?? ''), text).toBeLessThanOrEqual(30);
      expect(`${title} ${text}`, 'no dashes').not.toMatch(/[–—]/);
      expect(text, 'first person').toMatch(/\bI\b/);
    }
    expect(main).toContain(
      '<button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour</button>',
    );
    expect(scriptOf(page)).not.toMatch(/tour\.(start|maybeStart)\(/);
  });

  it('reacts to what you do, and keeps its announcements in visually hidden channels', () => {
    const script = scriptOf(page);
    expect(script).toContain('const react = (name, options) => deputy?.react?.(name, options);');
    expect(script).toContain("react('error');");
    expect(script).not.toMatch(/flash\('(success|error)'/);
    for (const id of ['acct-status', 'acct-delete-status', 'acct-agreements-status']) {
      expect(elementById(page, id), id).toMatch(
        /^<p class="sr-only" id="[\w-]+" role="status" aria-live="polite"><\/p>$/,
      );
    }
    const css = stylesOf(page);
    expect(css).not.toMatch(
      /(^|[\s,}])\.(need-(pill|add|summary)|page-intro|page-tour|settings-tab)[^{]*\{/m,
    );
    expect(css).not.toMatch(/(^|[\s,}])\.profile-[\w-]+[^{]*\{/m);
    // .account- is the chrome's account menu: this page's own rules never use it.
    expect(css).not.toMatch(/(^|[\s,}])\.account-[\w-]+[^{]*\{/m);
  });
});
