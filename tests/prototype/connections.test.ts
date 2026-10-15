import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Page guarantees for Settings, Connections (brand/connections-preview.html, round 6, T1): what
// your deputy connects to. Gmail (#gmail: read-only, its scopes, what it reads and never does,
// Disconnect asking first, Connect's consent step, the October agreement gate, and the mail watch
// once the store has mailWatch()), LinkedIn (#linkedin: Import from LinkedIn with the review list
// and the agreement asked in place, and Sign in with LinkedIn), Site accounts (#site-accounts:
// every password masked in the shared secret field, Show and Copy logged in the vault log, Remove
// asking first), and a summary of your AI keys (#keys, managed in AI & credits). Gmail, LinkedIn,
// and Site accounts moved here from Profile with their behaviour; their round 5 tests moved from
// profile.test.ts and changed only where the page did (the ids' prefix, the section headings,
// where Review and sign returns, and the deputy's first-person tour, R6-2). The page keeps its
// pure rules between `/* connections-rules: start */` and `end` markers; they run here on their
// own. The rendered checks (contrast, targets, overflow, focus) run in scripts/ui-audit.mjs.
// Round 6 part 2: Gmail shows the connection only (P-12: when it last checked, counting up, and the
// next check; this week's counts are Applications'), one notice for 2026.10 sits under the tabs
// (P-6), the AI keys are one line (P-22), and one Sample data note covers the page (P-16).

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');
const page = sourceFor('connections-preview.html');

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

// The element that carries `id`, from its opening tag to the matching close.
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

const words = (text: string): number =>
  text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

// A page's pure rules: the block between its markers, evaluated on its own in a fresh context.
function rulesOf<T>(source: string, name: string, global: string): T {
  const start = source.indexOf(`/* ${name}-rules: start */`);
  const end = source.indexOf(`/* ${name}-rules: end */`);
  if (start < 0 || end < start) throw new Error(`${name}-rules markers not found`);
  const block = source.slice(start, end);
  return new Script(`${block}\n${global};`, { filename: `${name}-rules` }).runInNewContext({}) as T;
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// One item of the sample LinkedIn export (linkedinImport().items).
type ImportItem = {
  key: string;
  kind: string;
  label: string;
  section: string;
  group: string;
  value: string;
  compare: 'new' | 'same' | 'differs';
  current: string | null;
};
type ConnectionsRules = {
  PROFILE_SECTIONS: Record<string, string>;
  PROFILE_GROUPS: Record<string, string>;
  whereIn(entry: { section: string; group: string }): string;
  IMPORT_WORDS: Record<string, string>;
  importGroups(items: ImportItem[]): Array<{ compare: string; title: string; items: ImportItem[] }>;
  importDefaults(items: ImportItem[]): string[];
  importLabel(count: number): string;
  PROVIDERS: Array<[string, string]>;
  keysLine(keys: unknown): string;
  GATE_WORDS: Record<string, string>;
  agreementNotice(gates: unknown[]): { version: string; title: string; message: string } | null;
};
const rules = rulesOf<ConnectionsRules>(page, 'connections', 'connectionsRules');

// The profile rules, for the places an imported detail joins (they must agree).
type ProfileRules = {
  SECTIONS: Array<[string, string]>;
  GROUPS: Record<string, { title: string }>;
  COLLECTIONS: Record<string, { title: string }>;
};
const profileRules = rulesOf<ProfileRules>(
  sourceFor('profile-preview.html'),
  'profile',
  'profileRules',
);

type Found = { key: string; source: string; kind: string; tag: string; raw: unknown };
type Store = {
  get(): Record<string, unknown> & { connections: unknown; ai: { keys: unknown } };
  metric(key: string): unknown;
  metricText(key: string): string;
  connectGmail(): Record<string, unknown>;
  disconnectGmail(): { status: string };
  connections(): {
    linkedin: {
      status: string;
      shares: string[];
      never: string[];
      import: { imported: number; lastImportAt: string | null };
    };
  };
  connectLinkedin(): { status: string };
  disconnectLinkedin(): { status: string };
  linkedinImport(): {
    file: string;
    note: string;
    items: ImportItem[];
    counts: Record<string, number>;
  };
  applyLinkedinImport(keys: string[]): {
    ok: boolean;
    reason?: string;
    applied?: string[];
    unchanged?: string[];
  };
  discoveredFields(): Found[];
  requiresAgreement(feature: string): { version: string; label: string } | null;
  signAgreement(fields: Record<string, unknown>): { ok: boolean };
  siteAccounts(): Array<Record<string, unknown> & { id: string; site: string }>;
  createSiteAccount(fields: Record<string, unknown>): { ok: boolean; reason?: string };
  revealSitePassword(id: string, options?: { action: string }): { ok: boolean; password?: string };
  removeSiteAccount(id: string): { ok: boolean };
  vaultLog(): Array<{ action: string; label: string; at: string }>;
  aiChoice(): { source: string; summary: string };
  mailWatch?: () => Record<string, unknown>;
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
const signOctober = (store: Store) =>
  store.signAgreement({
    version: '2026.10',
    name: 'Alex Morgan',
    consents: ['read', 'act', 'keep'],
  });

const main = mainOf(page);
const SECTION_IDS = ['gmail', 'linkedin', 'site-accounts', 'keys'];

describe('Connections page frame', () => {
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

  it('opens with the Settings intro, the tab strip, and the hold-key deputy', () => {
    expect(page).toContain('<title>JobDeputy · Settings · Connections</title>');
    expect(textOf(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')).toBe(
      'What your deputy connects to.',
    );
    expect(main).toContain('<p class="eyebrow">Settings</p>');
    const lede = textOf(main.match(/<p class="intro-copy">([\s\S]*?)<\/p>/)?.[1] ?? '');
    expect(words(lede)).toBeGreaterThan(0);
    expect(words(lede)).toBeLessThanOrEqual(16);
    expect(page).toContain('data-deputy-page="connections"');
    expect(page).toContain('data-deputy-state="hold-key"');
    // The tab strip sits right after the page intro, with Connections current.
    const intro = main.indexOf('<section class="page-intro');
    const tabs = main.indexOf('<!-- SettingsTabs: start -->');
    expect(intro).toBeGreaterThan(-1);
    expect(tabs).toBeGreaterThan(intro);
    expect(main.slice(main.indexOf('</section>', intro), tabs).trim()).toBe('</section>');
    expect(main).toContain(
      '<a class="settings-tab" href="./connections-preview.html" aria-current="page">Connections</a>',
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
      '<section class="page-intro connections-intro" aria-labelledby="page-title" data-page-back>',
    );
    // The scaffold's placeholder is gone.
    expect(page).not.toContain('connections-building');
    expect(page).not.toMatch(/Being built/);
  });

  it('shows four section cards in order, each with an icon, a heading, and one short line', () => {
    const sections = [
      ...main.matchAll(/<section\s+class="task-surface conn-section"\s+id="([\w-]+)"/g),
    ].map((match) => match[1]);
    expect(sections).toEqual(SECTION_IDS);
    const headings = SECTION_IDS.map((id) =>
      textOf(elementById(page, id).match(/<h2 id="[\w-]+">([\s\S]*?)<\/h2>/)?.[1] ?? ''),
    );
    expect(headings).toEqual(['Gmail', 'LinkedIn', 'Site accounts', 'Your AI keys']);
    for (const id of SECTION_IDS) {
      const section = elementById(page, id);
      expect(section, `#${id} icon`).toContain(
        '<span class="conn-section-icon" aria-hidden="true"',
      );
      const line = section.match(/<p class="conn-section-line">([\s\S]*?)<\/p>/)?.[1] ?? '';
      expect(words(textOf(line)), `#${id} line`).toBeGreaterThan(0);
      expect(words(textOf(line)), `#${id} line`).toBeLessThanOrEqual(14);
      expect(section, `#${id} sample note`).not.toContain(
        '<p class="sample-note">Sample data · not connected</p>',
      );
    }
    // Round 6 part 2 (P-16): one Sample data note for the page, under the lede; each card keeps
    // only what differs (Planned, and its prototype line).
    expect(main.match(/>Sample data · not connected</g)).toHaveLength(1);
    expect(main).toMatch(
      /<p class="intro-copy">[^<]+<\/p>\s*<p class="sample-note conn-page-note">Sample data · not connected<\/p>/,
    );
    // Planned, where the backend does not keep them yet.
    for (const id of ['gmail', 'linkedin', 'site-accounts']) {
      expect(elementById(page, id), id).toMatch(
        /<h2 id="[\w-]+">[^<]+<\/h2>\s*<span class="tag">Planned<\/span>/,
      );
    }
    // One h1, then h2 sections; the vault log is an h3 under Site accounts.
    expect(page.match(/<h1\b/g)).toHaveLength(1);
    expect(elementById(page, 'site-accounts')).toContain(
      '<h3 class="conn-vault-title" id="conn-vault-title">Vault log</h3>',
    );
  });

  it('answers the deep links other pages use, Profile’s forwards among them', () => {
    const ids = new Set([...page.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? ''));
    for (const id of [...SECTION_IDS, 'page-title']) expect(ids.has(id), `#${id}`).toBe(true);
    // Profile forwards its moved anchors here (round 6, T1).
    const profile = sourceFor('profile-preview.html');
    for (const id of ['gmail', 'linkedin', 'site-accounts']) {
      const key = /^\w+$/.test(id) ? id : `'${id}'`;
      expect(profile, id).toContain(`${key}: \`\${CONNECTIONS_PAGE}#${id}\``);
    }
    // The page lands on a deep link once it has drawn.
    expect(scriptOf(page)).toContain(
      'const id = decodeURIComponent(window.location.hash.slice(1));',
    );
    expect(scriptOf(page)).toContain("if (target) target.scrollIntoView({ block: 'start' });");
  });
});

describe('Connections LinkedIn (#linkedin, moved from Profile; round 5 G2 and R2)', () => {
  const group = elementById(page, 'linkedin');

  it('offers Import from LinkedIn and sign-in, each saying what LinkedIn shares and never does', () => {
    const store = sampleStore();
    // The row's title says what it imports, so the button reads Import; its accessible name keeps
    // the whole phrase, which also fits a 320px phone with WCAG 1.4.12 text spacing (UAT-A).
    expect(textOf(group)).toContain(
      'Import from LinkedIn Your data export (ZIP) or profile PDF · you choose what joins Import from LinkedIn',
    );
    expect(elementById(page, 'conn-linkedin-import-open')).toBe(
      '<button class="secondary-action" id="conn-linkedin-import-open" type="button">Import<span class="sr-only"> from LinkedIn</span></button>',
    );
    expect(textOf(group)).toContain(
      'Sign in with LinkedIn LinkedIn shares only your name, email, and photo Not connected',
    );
    expect(textOf(group)).toContain(
      'Prototype: nothing is uploaded, and no LinkedIn request is made.',
    );
    // Both LinkedIn drawers name the LinkedIn section they open from.
    for (const id of ['conn-linkedin-drawer', 'conn-import-drawer']) {
      expect(elementById(page, id), id).toMatch(
        /<div class="drawer-header">\s*<p class="eyebrow">LinkedIn<\/p>/,
      );
    }
    // Connect is JobDeputy's own consent step, from connections().linkedin.
    const drawer = textOf(elementById(page, 'conn-linkedin-drawer'));
    const linkedin = store.connections().linkedin;
    expect(drawer).toContain(
      `LinkedIn shares with JobDeputy ${linkedin.shares.join(' ')} Nothing else.`,
    );
    expect(drawer).toContain(`Your deputy never ${linkedin.never.join(' ')}`);
    expect(drawer).toContain('Prototype: no LinkedIn request is made.');
    expect(drawer).toContain('You can disconnect any time in Settings, Connections.');
    const script = scriptOf(page);
    for (const call of ['store?.connectLinkedin?.();', 'store?.disconnectLinkedin?.();']) {
      expect(script, call).toContain(call);
    }
    expect(store.connectLinkedin().status).toBe('connected');
    expect(store.metricText('linkedin.connectedAt')).toBe('Fri, Oct 2');
    expect(store.disconnectLinkedin().status).toBe('disconnected');
    // Disconnect asks first, beside the button.
    expect(elementById(page, 'conn-linkedin-confirm')).toMatch(
      /^<section\s+class="feedback-panel conn-confirm"\s+id="conn-linkedin-confirm"\s+data-kind="warning"\s+hidden/,
    );
    // Round 6 (UAT-RM-13): the question has a clear answer each way, the safe one focused first.
    expect(textOf(elementById(page, 'conn-linkedin-confirm'))).toContain(
      'Disconnect LinkedIn? You sign in with your email or Google instead. What you imported stays in your profile. Disconnect LinkedIn Keep connected',
    );
    expect(elementById(page, 'conn-linkedin-keep')).toContain('data-confirm-cancel');
    expect(elementById(page, 'conn-linkedin-disconnect')).toContain(
      'aria-controls="conn-linkedin-confirm"',
    );
  });

  it('reviews every item as new, different (with your value), or the same, ticked or not', () => {
    const store = sampleStore();
    const parsed = store.linkedinImport();
    expect(parsed.note).toBe(
      'Sample export: nothing was uploaded, and nothing was read from LinkedIn.',
    );
    const groups = plain(rules.importGroups(parsed.items));
    expect(groups.map((entry) => [entry.compare, entry.title, entry.items.length])).toEqual([
      ['new', 'New to your profile', 6],
      ['differs', 'Different from yours', 2],
      ['same', 'Already in your profile', 11],
    ]);
    expect(groups[1]?.items.map((item) => [item.key, item.current])).toEqual([
      ['career.experience.litware', 'Software Engineer at Litware · Jun 2017 to Mar 2021'],
      ['profile.languages.spanish', 'Spanish (Conversational)'],
    ]);
    expect(rules.importDefaults(parsed.items)).toHaveLength(8);
    expect([rules.importLabel(0), rules.importLabel(1), rules.importLabel(8)]).toEqual([
      'Choose what to import',
      'Import 1 detail',
      'Import 8 details',
    ]);
    // Each item says where it joins Profile, in Profile's own names (round 6: the review moved).
    expect(rules.whereIn({ section: 'career', group: 'career-experience' })).toBe(
      'Career, Work history',
    );
    const profileSections = Object.fromEntries(profileRules.SECTIONS);
    for (const item of parsed.items) {
      expect(rules.PROFILE_SECTIONS[item.section], item.key).toBe(profileSections[item.section]);
      const title =
        profileRules.GROUPS[item.group]?.title ?? profileRules.COLLECTIONS[item.group]?.title;
      expect(rules.PROFILE_GROUPS[item.group], item.key).toBe(title);
    }
    const script = scriptOf(page);
    expect(script).toContain("el('span', { class: 'choice-card-label', text: item.label }),");
    expect(script).toContain(`? \`Yours now: \${item.current}\``);
    expect(script).toContain(`: \`Joins \${rules.whereIn(item)} in your profile\`,`);
    expect(script).toContain("el('details', { class: 'conn-import-same' }, [");
    const drawer = elementById(page, 'conn-import-drawer');
    expect(drawer).toContain(
      '<input id="conn-import-file" type="file" accept=".zip,.pdf,application/zip,application/pdf" hidden />',
    );
    expect(textOf(drawer)).toContain(
      'On LinkedIn, open Settings, Data privacy, Get a copy of your data, and download the ZIP. Or save your profile as a PDF.',
    );
    expect(script).toContain(`startReview(\`\${file.name} · read as the sample export\`);`);
  });

  it('asks for the October agreement in place, then saves only the ticked items, tagged (W6, W9)', () => {
    const store = sampleStore();
    const script = scriptOf(page);
    expect(store.requiresAgreement('linkedin-import')).toMatchObject({
      version: '2026.10',
      label: 'Importing from LinkedIn',
    });
    // Review and sign comes back to this page's review (round 6: it moved from Profile, whose old
    // ?import=linkedin address forwards here).
    expect(script).toContain(
      `\`./agreement-preview.html?mode=update&return=\${encodeURIComponent('connections-preview.html?import=linkedin#linkedin')}\`;`,
    );
    expect(script).toContain("if (parameters.get('import') !== 'linkedin') return;");
    expect(script).toContain("const IMPORT_KEY = 'jobdeputy.profile.import';");
    const ticked = rules
      .importDefaults(store.linkedinImport().items)
      .filter((key) => !['profile.summary', 'profile.skills.terraform'].includes(key));
    expect(store.applyLinkedinImport(ticked)).toMatchObject({
      ok: false,
      reason: 'agreement-required',
    });
    expect(signOctober(store).ok).toBe(true);
    expect(store.requiresAgreement('linkedin-import')).toBeNull();
    const result = store.applyLinkedinImport(ticked);
    expect(result).toMatchObject({ ok: true });
    expect(result.applied).toHaveLength(6);
    expect(result.applied).not.toContain('profile.summary');
    const linkedin = store.discoveredFields().filter((entry) => entry.source === 'linkedin');
    expect(linkedin.map((entry) => entry.key).sort()).toEqual([...ticked].sort());
    expect(new Set(linkedin.map((entry) => entry.tag))).toEqual(
      new Set(['New · from LinkedIn, Oct 2']),
    );
    expect(store.metricText('linkedin.imported')).toBe('6');
    // After an import the row says what was saved and links to Profile, where it joined; focus
    // lands on that link.
    expect(script).toContain("href: './profile-preview.html#found' }, [");
    expect(script).toContain(
      "($('#conn-linkedin-imported') ?? $('#conn-linkedin-import-open')).focus();",
    );
  });
});

describe('Connections site accounts and the vault log (#site-accounts, moved from Profile; round 5 A2 and R5-6)', () => {
  const group = elementById(page, 'site-accounts');

  it('leads with the store’s figures, says where accounts come from, and asks for 2026.10 first', () => {
    const store = sampleStore();
    for (const key of ['sites.accounts', 'vault.reveals']) {
      expect(group, key).toContain(
        `<strong data-metric="${key}">${store.metricText(key)}</strong>`,
      );
    }
    expect(group).toContain(
      '<ul class="conn-items" id="conn-sites-list" aria-labelledby="site-accounts-title" hidden></ul>',
    );
    expect(group).toContain(
      '<span id="conn-reveals-lead">Shown or copied</span> <strong data-metric="vault.reveals">0</strong> <span id="conn-reveals-unit">times</span>',
    );
    const script = scriptOf(page);
    expect(script).toContain(
      "const reveals = Number(metricText('vault.reveals').replace(/[^0-9]/g, ''));",
    );
    expect(script).toContain("const word = reveals === 1 ? 'time' : 'times';");
    expect(textOf(group)).toContain(
      'No site accounts yet When an employer’s site needs an account, your deputy creates one in Autofill with your email. Passwords stay in your vault.',
    );
    expect(group).toContain('data-deputy-prop="key"');
    expect(textOf(group)).toContain(
      'Vault log Nothing yet. Every Show and Copy of a password is listed here, with when.',
    );
    expect(textOf(group)).toContain(
      'Sample only: passwords are kept in this browser, never sent anywhere.',
    );
    expect(group).toMatch(/data-tour-step="5"\s+data-tour-title="I keep site passwords safe\."/);
    // Keeping site passwords is new in 2026.10: the page's one notice says so (P-6), not a line here.
    expect(store.requiresAgreement('site-accounts')).toMatchObject({ version: '2026.10' });
    expect(group).not.toMatch(/New in agreement version|Review and sign/);
  });

  it('shows each password in the shared secret field, logs every reveal, and removes on request', () => {
    const script = scriptOf(page);
    expect(script).toContain(
      'reveal: ({ action } = {}) => store?.revealSitePassword?.(account.id, { action })?.password ?? null,',
    );
    expect(script).toContain('components?.secretField?.(secret, {');
    expect(script).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the page's own source text, matched as written
      "const secret = el('div', { class: 'conn-secret-field', id: `${slugId}-secret` });",
    );
    expect(script).not.toMatch(/class: 'secret-field'/);
    expect(script).toContain('const siteCards = new Map();');
    expect(script).toContain('updateSiteCard(card, account);');
    expect(script).toContain('const result = store?.removeSiteAccount?.(id);');
    expect(script).toContain(
      `text: \`Its password leaves your vault. The account on \${account.site} stays: close it on the site.\`,`,
    );
    const store = sampleStore();
    expect(signOctober(store).ok).toBe(true);
    expect(
      store.createSiteAccount({
        site: 'careers.google.example',
        company: 'Google',
        passwordMode: 'generated',
        appId: 'search-infra',
      }),
    ).toMatchObject({ ok: true });
    const [account] = store.siteAccounts();
    expect(account).toMatchObject({ site: 'careers.google.example', createdBy: 'deputy' });
    expect(JSON.stringify(store.siteAccounts())).not.toMatch(/password"?:\s*"[^"]{12,}/);
    const shown = store.revealSitePassword(account?.id ?? '', { action: 'show' });
    expect(shown.password).toHaveLength(20);
    store.revealSitePassword(account?.id ?? '', { action: 'copy' });
    expect(store.vaultLog().map((entry) => entry.action)).toEqual(['copy', 'show', 'created']);
    expect(store.metricText('vault.reveals')).toBe('2');
    expect(store.removeSiteAccount(account?.id ?? '').ok).toBe(true);
    expect(store.siteAccounts()).toEqual([]);
    expect(store.vaultLog()[0]?.action).toBe('removed');
  });
});

describe('Connections growing lists (R6-4)', () => {
  it('shows the first five site accounts and the newest five log entries, with the rest one step away', () => {
    const group = elementById(page, 'site-accounts');
    expect(group).toContain(
      '<button class="compact-action conn-list-more" id="conn-sites-more" type="button" aria-expanded="false" aria-controls="conn-sites-list" hidden>Show all site accounts</button>',
    );
    expect(group).toContain(
      '<button type="button" class="chart-action see-all-open conn-vault-all" id="conn-vault-all" hidden>See all<span class="sr-only"> vault log entries</span></button>',
    );
    const script = scriptOf(page);
    for (const part of [
      'const SITES_FIRST = 5;',
      'const VAULT_FIRST = 5;',
      'node.hidden = !sitesOpen && index >= SITES_FIRST;',
      'log.slice(0, VAULT_FIRST).map((entry) =>',
      "seeAll.hidden = log.length <= VAULT_FIRST || typeof components?.seeAll?.open !== 'function';",
      'components?.seeAll?.open(',
      "sorts: [{ id: 'given', label: 'Newest first' }],",
      'count: null,',
    ]) {
      expect(script, part).toContain(part);
    }
  });
});

describe('Connections Gmail (#gmail, moved from Profile)', () => {
  const store = sampleStore();
  const gmail = store.get().connections as unknown as {
    gmail: { email: string; scopes: Array<{ label: string }>; reads: string[]; never: string[] };
  };

  it('shows the connection, read-only, with its scopes, what it reads, and what it never does', () => {
    const group = elementById(page, 'gmail');
    const text = textOf(group);
    // Round 6 part 2 (P-12): the connection, when it last scanned counting up (the style
    // Applications uses); round 7 (D3): the next scan is the daily scan's own line.
    expect(text).toContain(
      `${gmail.gmail.email} Read-only · connected ${store.metricText('gmail.connectedAt')} · last scan 7 hours ago Connected Disconnect`,
    );
    // Round 6 part 3: Gmail was connected on Mon, Sep 28 (a week of job email since).
    expect(group).toContain('<span data-metric="gmail.connectedAt">Mon, Sep 28</span>');
    expect(group).toContain(
      '<time data-gmail-ago datetime="2026-10-02T07:00:00-07:00">7 hours ago</time>',
    );
    expect(store.metricText('gmail.lastCheckedAt')).toBe('Fri, Oct 2, 07:00');
    expect(elementById(page, 'conn-gmail-meta')).not.toContain('gmail.nextCheckAt');
    expect(scriptOf(page)).toContain(
      'const dated = (words, key) => (metricText(key) ? [words, metricSpan(key)] : null);',
    );
    expect(text).toContain(`Access ${gmail.gmail.scopes.map((scope) => scope.label).join(' ')}`);
    expect(text).toContain(`Reads only ${gmail.gmail.reads.join(' ')}`);
    expect(text).toContain(`Never ${gmail.gmail.never.join(' ')}`);
    expect(text).toContain('Prototype: no Google request is made, and no email is read.');
    expect(group).toMatch(/data-tour-step="2"\s+data-tour-title="I read only job email\."/);
    expect(text).toContain(
      'One-time codes from job sites, and status emails: your deputy updates your applications and drafts replies you send yourself.',
    );
    expect(text).toContain(
      'Uses them to Sign in to sites that send a code Update your applications, with Undo Draft replies you edit and send yourself Updates from your email in Applications',
    );
    // Moving cards and drafting replies are new in 2026.10: the page's one notice says so (P-6).
    expect(store.requiresAgreement('mail-updates')).toMatchObject({ version: '2026.10' });
    expect(group).not.toMatch(/New in agreement version|Review and sign/);
  });

  it('asks before Disconnect, and Connect opens a consent step that lists the scopes', () => {
    const confirm = elementById(page, 'conn-gmail-confirm');
    expect(confirm).toMatch(
      /^<section\s+class="feedback-panel conn-confirm"\s+id="conn-gmail-confirm"\s+data-kind="warning"\s+hidden/,
    );
    expect(textOf(confirm)).toBe(
      '! Disconnect Gmail? Your deputy stops reading one-time codes and status emails. Forms that send a code wait for you. Disconnect Gmail Keep connected',
    );
    // Round 6 (UAT-RM-13): never two identical Disconnect buttons. The question's answers are
    // Disconnect Gmail (danger) and Keep connected (focused first); Keep connected and Escape
    // close it and return focus to Disconnect.
    expect(elementById(page, 'conn-gmail-confirm-action')).toContain(
      'class="compact-action conn-danger" id="conn-gmail-confirm-action" type="button">Disconnect Gmail</button>',
    );
    expect(elementById(page, 'conn-gmail-keep')).toBe(
      '<button class="compact-action" id="conn-gmail-keep" type="button" data-confirm-cancel>Keep connected</button>',
    );
    const asks = scriptOf(page);
    for (const part of [
      "if (open) panel.querySelector('[data-confirm-cancel]')?.focus();",
      "if (event.key !== 'Escape' || panel.hidden) return;",
      'trigger.focus();',
      'wireAsk(gmailDisconnect, gmailConfirm, {',
      'wireAsk(linkedinDisconnect, linkedinConfirm, {',
      "el('button', { class: 'compact-action', type: 'button', 'data-confirm-cancel': '', 'data-site-remove-keep': account.id, text: 'Keep it' }),",
    ]) {
      expect(asks, part).toContain(part);
    }
    expect(elementById(page, 'conn-gmail-disconnect')).toContain(
      'aria-controls="conn-gmail-confirm"',
    );
    expect(elementById(page, 'conn-gmail-connect')).toContain(
      'data-drawer-open="conn-gmail-drawer"',
    );
    const drawer = elementById(page, 'conn-gmail-drawer');
    expect(drawer).toMatch(/^<dialog\s+class="drawer"/);
    expect(drawer).toMatch(/<div class="drawer-header">\s*<p class="eyebrow">Connections<\/p>/);
    const copy = textOf(drawer);
    expect(copy).toContain(
      'Connect Gmail, read-only? Prototype: no Google request is made, and no email is read.',
    );
    expect(copy).toContain(
      `Your deputy asks Google for ${gmail.gmail.scopes.map((scope) => scope.label).join(' ')}`,
    );
    expect(copy).toContain(`It reads only ${gmail.gmail.reads.join(' ')}`);
    expect(copy).toContain(`It never ${gmail.gmail.never.join(' ')}`);
    expect(copy).toContain('You can disconnect any time in Settings, Connections.');
    expect(copy).toContain('Allow read-only access Cancel');
    const script = scriptOf(page);
    expect(script).toContain("lines($('#conn-gmail-scopes'), scopes);");
    expect(script).toContain('const gmailOf = () => store?.get?.()?.connections?.gmail ?? null;');
    const local = sampleStore();
    expect(local.disconnectGmail().status).toBe('disconnected');
    expect([local.metricText('gmail.connectedAt'), local.metricText('gmail.nextCheckAt')]).toEqual([
      '',
      '',
    ]);
    expect(local.connectGmail().status).toBe('connected');
    expect(local.metricText('gmail.connectedAt')).not.toBe('');
  });

  it('scans once a day over the last 48 hours, and Scan now says it uses 1 run (D3, R10-9)', () => {
    const scan = elementById(page, 'conn-gmail-scan');
    // Inside the Gmail card, after the connection and its question, before the facts.
    const group = elementById(page, 'gmail');
    expect(group.indexOf('id="conn-gmail-scan"')).toBeGreaterThan(
      group.indexOf('id="conn-gmail-confirm"'),
    );
    expect(group.indexOf('id="conn-gmail-scan"')).toBeLessThan(
      group.indexOf('id="conn-gmail-facts"'),
    );
    expect(scan).toMatch(
      /^<section\s+class="conn-scan"\s+id="conn-gmail-scan"\s+aria-labelledby="conn-gmail-scan-title"\s+data-skeleton="lines"/,
    );
    expect(textOf(elementById(page, 'conn-gmail-scan-when'))).toBe(
      `Every day at 07:00 your time, over the last 48 hours of mail. Next scan ${store.metricText('gmail.scan.nextAt')} .`,
    );
    expect(textOf(elementById(page, 'conn-gmail-scan-runs'))).toBe(
      `Each scan uses one run; Gmail used ${store.metricText('gmail.runs.month')} runs this month.`,
    );
    // The cost is said before you press it, and is the button's description (R10-9).
    expect(elementById(page, 'conn-gmail-scan-now')).toBe(
      '<button class="secondary-action" id="conn-gmail-scan-now" type="button" aria-describedby="conn-gmail-scan-cost">Scan now</button>',
    );
    expect(textOf(elementById(page, 'conn-gmail-scan-cost')).replace(/\s+\./g, '.')).toBe(
      `Uses 1 run. ${store.metricText('gmail.scan.unread')} job emails came after the last scan.`,
    );
    expect(scan).toContain(
      '<h4 class="conn-scan-subtitle" id="conn-gmail-scans-title">Last scans</h4>',
    );
    expect(scan).toContain(
      '<ol class="conn-scans" id="conn-gmail-scans" aria-labelledby="conn-gmail-scans-title"></ol>',
    );
    const script = scriptOf(page);
    for (const part of [
      "const scansOf = () => (typeof store?.gmailScans === 'function' ? store.gmailScans() : null);",
      "const result = typeof store?.gmailScan === 'function' ? store.gmailScan() : null;",
      'replaceIfChanged(scanList, history.slice(0, SCANS_FIRST).map(scanRow));',
      "if (blocked) scanNow.setAttribute('aria-disabled', 'true');",
      "$('#conn-gmail-scan-now-row').hidden = !connected;",
      "react('saved', { speech: 'Scanned. Updates are in Applications.' });",
    ]) {
      expect(script, part).toContain(part);
    }
    // The store: the daily scan at 07:00 over 48 hours, one run each, and its refusals.
    const local = sampleStore() as Store & {
      gmailScans(): Record<string, unknown> & { history: Array<{ kind: string }> };
      gmailScan(): Record<string, unknown> & { ok: boolean; reason?: string; text?: string };
    };
    const scans = local.gmailScans();
    expect(scans).toMatchObject({ time: '07:00', windowHours: 48, runsEach: 1, unread: 2 });
    expect(scans.scanNow).toMatchObject({ label: 'Scan now', cost: 'uses 1 run', available: true });
    expect(scans.history.map((entry) => entry.kind)).toEqual(['daily', 'daily', 'daily', 'daily']);
    const left = Number(local.metric('runs.left'));
    expect(local.gmailScan()).toMatchObject({ ok: true });
    expect(Number(local.metric('runs.left'))).toBe(left - 1);
    expect(local.metricText('gmail.runs.month')).toBe('3');
    expect(local.gmailScans().history[0]?.kind).toBe('manual');
    local.disconnectGmail();
    expect(local.gmailScan()).toMatchObject({ ok: false, reason: 'gmail-not-connected' });
    expect(Number(local.metric('runs.left'))).toBe(left - 1);
  });

  it('leaves what Gmail did to Applications, and counts up from the last check (P-12)', () => {
    // This week's emails read and cards moved are Applications' (its activity); here, the
    // connection only.
    expect(page).not.toMatch(/mail\.week\.|emails? read this week|cards? moved/);
    expect(page).not.toContain('conn-mail-watch');
    const script = scriptOf(page);
    for (const part of [
      "const scans = typeof store?.gmailScans === 'function' ? store.gmailScans() : null;",
      'if (scans?.connected && scans.last?.at) return scans.last.at;',
      "const sync = typeof store?.gmailSync === 'function' ? store.gmailSync() : null;",
      'if (sync?.connected && sync.last?.at) return sync.last.at;',
      "['last scan ', el('time', { 'data-gmail-ago': '', datetime: lastAt, text: store.format.ago(lastAt) })]",
      // The words count up quietly: never a live region.
      'const words = store.format.ago(at);',
    ]) {
      expect(script, part).toContain(part);
    }
    expect(elementById(page, 'conn-gmail-meta')).not.toMatch(/role=|aria-live/);
  });
});

describe('Connections agreement notice (round 6 part 2, P-6)', () => {
  it('says once, after the first card, what 2026.10 adds here, with Review and sign back to this page', () => {
    const notice = elementById(page, 'conn-agreement');
    expect(notice).toMatch(
      /^<section\s+class="feedback-panel has-action conn-agreement"\s+id="conn-agreement"\s+data-kind="warning"/,
    );
    expect(textOf(notice)).toBe(
      '! Version 2026.10 waits for your signature It covers moving cards from your email, reply drafts, site accounts, and importing from LinkedIn. Review and sign',
    );
    expect(notice).toContain(
      '<a class="feedback-panel-action" id="conn-agreement-sign" href="./agreement-preview.html?mode=update&amp;return=connections-preview.html">Review and sign</a>',
    );
    // It sits after the first card (Gmail), so a phone's first screen starts with that card (the
    // audit's first view at 375x667 and 360x740), and before LinkedIn and Site accounts.
    expect(main.indexOf('id="conn-agreement"')).toBeGreaterThan(main.indexOf('id="gmail"'));
    expect(main.indexOf('id="conn-agreement"')).toBeLessThan(main.indexOf('id="linkedin"'));
    // The words follow the gates still open; signed, it goes.
    const store = sampleStore();
    const gates = Object.keys(rules.GATE_WORDS)
      .map((feature) => store.requiresAgreement(feature))
      .filter(Boolean);
    expect(plain(rules.agreementNotice(gates))).toEqual({
      version: '2026.10',
      title: 'Version 2026.10 waits for your signature',
      message:
        'It covers moving cards from your email, reply drafts, site accounts, and importing from LinkedIn.',
    });
    expect(rules.agreementNotice([gates[1]])?.message).toBe('It covers site accounts.');
    expect(signOctober(store).ok).toBe(true);
    expect(
      rules.agreementNotice(
        Object.keys(rules.GATE_WORDS)
          .map((feature) => store.requiresAgreement(feature))
          .filter(Boolean),
      ),
    ).toBeNull();
    expect(scriptOf(page)).toContain('notice.hidden = !words;');
    // The LinkedIn review keeps its own gate where the work waits (in the drawer).
    expect(elementById(page, 'conn-import-gate')).toContain('Sign the updated agreement first');
  });
});

describe('Connections AI keys (#keys)', () => {
  it('says in one line which keys you saved, never the key, and links AI & credits (P-22)', () => {
    const store = sampleStore();
    expect(rules.keysLine(store.get().ai.keys)).toBe('OpenAI ready · Anthropic not added');
    expect(rules.keysLine({ openai: { status: 'limit' }, anthropic: { status: 'ready' } })).toBe(
      'OpenAI at its limit · Anthropic ready',
    );
    expect(rules.keysLine(null)).toBe('OpenAI not added · Anthropic not added');
    const keys = elementById(page, 'keys');
    expect(textOf(elementById(page, 'conn-keys'))).toBe(
      'OpenAI ready · Anthropic not added Manage in AI & credits : your AI keys',
    );
    expect(keys).toContain(
      '<a class="chart-action" id="conn-keys-manage" href="./ai-preview.html#keys">Manage in AI &amp; credits<span class="sr-only">: your AI keys</span></a>',
    );
    expect(keys).not.toContain('data-key-provider');
    expect(sourceFor('ai-preview.html')).toContain('id="keys"');
    // Never a key: only the last four digits the store keeps.
    expect(JSON.stringify(store.get().ai.keys)).not.toMatch(/sk-|secret/);
  });
});

describe('Connections figures, tour, and reactions', () => {
  it('carries every figure as data-metric, once, equal to the store on the seed (R3-3, R3-4)', () => {
    const store = sampleStore();
    const shown = [...main.matchAll(/data-metric="([\w.]+)">([^<]*)</g)].map(
      (match): [string, string] => [match[1] ?? '', match[2] ?? ''],
    );
    const keys = shown.map(([key]) => key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        'gmail.connectedAt',
        'gmail.scan.nextAt',
        'gmail.runs.month',
        'gmail.scan.unread',
        'sites.accounts',
        'vault.reveals',
      ]),
    );
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
      ['1', 'I connect to these for you.'],
      ['2', 'I read only job email.'],
      // Round 7 (D3): the daily scan.
      ['3', 'I scan once a day.'],
      ['4', 'I import what you choose.'],
      ['5', 'I keep site passwords safe.'],
      ['6', 'Your keys stay yours.'],
    ]);
    for (const [, title, text] of steps) {
      expect(words(title ?? ''), title).toBeLessThanOrEqual(6);
      expect(words(text ?? ''), text).toBeLessThanOrEqual(30);
      expect(`${title} ${text}`, 'no dashes').not.toMatch(/[–—]/);
      expect(`${title} ${text}`, 'first person').toMatch(
        /\b(I|I’m|I’ll|me|my)\b|Your keys stay yours/,
      );
    }
    // The tour button is the shared page intro's (R6-3); the page starts no tour by itself.
    expect(main).toContain(
      '<button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour</button>',
    );
    expect(scriptOf(page)).not.toMatch(/tour\.(start|maybeStart)\(/);
  });

  it('reacts once to each action, through react(), never a success flash', () => {
    const script = scriptOf(page);
    expect(script).toContain('const react = (name, options) => deputy?.react?.(name, options);');
    expect(script).not.toMatch(/flash\('(success|error)'/);
    for (const call of [
      "react('saved', { speech: 'Connected here. Nothing is read.' });",
      "react('saved', { speech: 'Disconnected. Codes wait for you.' });",
      "react('saved', { speech: 'Connected. Name, email, photo.' });",
      "react('saved', { speech: 'Disconnected. Imports stay.' });",
      "react('copied', { speech: 'Copied. It stays hidden.' })",
      "react('deleted', { speech: 'Removed. Close it there too.' });",
      "react('saved', { speech: 'Scanned. Updates are in Applications.' });",
      "react('error');",
    ]) {
      expect(script, call).toContain(call);
    }
    for (const [, speech] of script.matchAll(/speech: '([^']+)'/g)) {
      expect(words(speech ?? ''), speech).toBeLessThanOrEqual(6);
    }
  });

  it('keeps its announcements in visually hidden channels and never restyles shared parts', () => {
    for (const id of [
      'conn-status',
      'conn-gmail-status',
      'conn-import-status',
      'conn-linkedin-status',
    ]) {
      expect(elementById(page, id), id).toMatch(
        /^<p class="sr-only" id="[\w-]+" role="status" aria-live="polite"><\/p>$/,
      );
    }
    const css = stylesOf(page);
    expect(css).not.toMatch(
      /(^|[\s,}])\.(need-(pill|add|summary)|page-intro|page-tour|settings-tab)[^{]*\{/m,
    );
    // Its own rules are prefixed .conn- (the chrome's own are in app-chrome.css).
    expect(css).not.toMatch(/(^|[\s,}])\.profile-[\w-]+[^{]*\{/m);
  });
});
