import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Page guarantees for Invite friends (brand/invite-preview.html), new in round 2 (brief 4.8, the
// owner's F12): an internal page with no current nav item, the share card (Copy link with a
// select-text fallback, and a simulated Invite by email through JobDeputyStore.addInvite), three
// visual steps, progress (a meter, KPI tiles, and the invites list), and the rules in short. The
// rewards are counts of platform AI runs, never money, and they are planned for launch. Round 3
// changes only what the shared chrome and the store need (findings 14 and 28): every figure
// carries data-metric with the store's text and shows once (R3-4), and Copy link and Invite by
// email get the deputy's reactions (R3-8). Round 4 changes only the names (R4-3). Round 5 retires
// AI runs (G3, G4; brief 4.3): a friend's first search earns you both bonus AI credits, 100,000
// tokens' worth each at Ministral 3 14B's rate for up to 5 friends a year, shown as tokens on your
// platform model (R5-2, from JobDeputyStore.credits()), never runs, money, or discounts. The page
// keeps its pure rules between `/* invite-rules: start */` and `end` markers; they run here on
// their own. Round 6 (I1, "a better UX, concise"; R6-2, R6-3, R6-4): one screen with the same
// facts in fewer words: the reward in one line in the shared page intro (with Planned for launch
// and never money beside it, and Take the tour), two cards (Share your link; Your progress: the
// bonus meter, one line of counts, and the newest five invites with See all), and How it works
// and the rules folded under one disclosure that #how and #rules open; a three-step tour in the
// deputy's first person. The rendered checks (contrast, targets, overflow, focus) run in
// scripts/ui-audit.mjs.

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');
const invite = sourceFor('invite-preview.html');
// The internal page whose shell blocks the Invite page copies byte for byte.
const reference = sourceFor('ai-preview.html');

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
const inlineScript = (source: string): string =>
  [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '').join('\n');

// The markup between `<!-- name: start -->` and `<!-- name: end -->`, markers included.
function markedBlock(source: string, name: string): string {
  const start = `<!-- ${name}: start -->`;
  const end = `<!-- ${name}: end -->`;
  const from = source.indexOf(start);
  const to = source.indexOf(end);
  return from < 0 || to < from ? '' : source.slice(from, to + end.length);
}

const between = (source: string, start: string, end: string): string => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  return from < 0 || to < from ? '' : source.slice(from, to + end.length);
};

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

const attributesOf = (tag: string): Record<string, string> =>
  Object.fromEntries(
    [...tag.matchAll(/\s([\w:-]+)(?:="([^"]*)")?/g)].map((match) => [
      match[1] ?? '',
      match[2] ?? '',
    ]),
  );

function rulesOf<T>(source: string, name: string, global: string): T {
  const start = source.indexOf(`/* ${name}-rules: start */`);
  const end = source.indexOf(`/* ${name}-rules: end */`);
  if (start < 0 || end < start) throw new Error(`${name}-rules markers not found`);
  const block = source.slice(start, end);
  return new Script(`${block}\n${global};`, { filename: `${name}-rules` }).runInNewContext({}) as T;
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type Invite = { id: string; name: string | null; email: string; status: string; date: string };
type Referrals = {
  code: string;
  link: string;
  rewardTokens: number;
  capFriends: number;
  invites: Invite[];
};
type Credits = {
  model: { id: string; name: string };
  free: { tokens: number };
  bonus: { tokens: number; earned: number; friends: number };
};
type InviteRules = {
  DEFAULTS: Referrals;
  STATUSES: string[];
  STATUS_LABELS: Record<string, string>;
  OWN_EMAIL: string;
  FREE_TOKENS: number;
  normalize(raw: unknown): Referrals;
  counts(referrals: Referrals): { invited: number; joined: number; rewarded: number; cap: number };
  rewardOnModel(referrals: Referrals, credits: unknown, freeTokens?: number): number;
  meterView(
    referrals: Referrals,
    words?: { earned?: string; model?: string },
  ): { now: number; max: number; value: number; steps: number; text: string };
  initials(invite: { name: string | null; email: string }): string;
  formatDate(iso: string): string;
  ordered(invites: Invite[]): Invite[];
  emailProblem(value: string, invites: Invite[]): string | null;
  progressTour(cap: number): string;
  FIRST_PAGE: number;
  firstPage(
    invites: Invite[],
    all?: boolean,
  ): { shown: Invite[]; total: number; more: boolean; seeAll: string };
};

const inviteRules = rulesOf<InviteRules>(invite, 'invite', 'inviteRules');

// The shared sample store, run the way the pages run it, with its API.
function loadStore(): {
  get(): { referrals: Referrals };
  addInvite(entry: { email: string; name?: string | null }): Invite;
  metric(key: string): unknown;
  metricText(key: string): string;
  credits(): Credits;
  setPlatformModel(id: string): unknown;
  CREDITS: { freeTokens: number; referralTokens: number; referralFriendsPerYear: number };
  format: { tokens(count: number): string };
} {
  const storage = new Map<string, string>();
  const window: Record<string, unknown> = { addEventListener: () => {} };
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  runInNewContext(sourceFor('sample-store.js'), { window, localStorage, JSON });
  return window.JobDeputyStore as ReturnType<typeof loadStore>;
}

const store = loadStore();
const seed = plain(store.get().referrals);
const main = mainOf(invite);
const script = inlineScript(invite);

describe('Invite friends page frame', () => {
  it('loads the shell scripts in order, app-panels.js last, before its own script', () => {
    const order = [
      'app-shell.js',
      'app-components.js',
      'sample-store.js',
      'deputy.js',
      'feedback.js',
      'app-panels.js',
    ].map((name) => invite.indexOf(`<script src="./${name}"></script>`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order[5]).toBeLessThan(invite.indexOf('<script>'));
  });

  it('copies the head, header, app frame, footer, and scripts from an internal page', () => {
    const rootOf = (source: string) => source.match(/:root\s*\{[^}]*\}/)?.[0];
    expect(rootOf(invite)).toBe(rootOf(reference));
    const links = (source: string) =>
      between(source, '<link rel="icon"', '<link rel="stylesheet" href="./deputy.css" />');
    expect(links(invite)).toBe(links(reference));
    // The account menu, the footer, and the script tags are byte for byte.
    const menu = (source: string) =>
      between(source, '<details class="account-menu">', '</details>');
    expect(menu(invite)).toBe(menu(reference));
    const footer = (source: string) => between(source, '<footer class="site-footer">', '</footer>');
    expect(footer(invite)).toBe(footer(reference));
    const scripts = (source: string) =>
      between(
        source,
        '<script src="./app-shell.js"></script>',
        '<script src="./feedback.js"></script>',
      );
    expect(scripts(invite)).toBe(scripts(reference));
    expect(invite).toContain('<a class="skip-link" href="#page-title">Skip to Invite friends</a>');
    expect(invite).toContain('<title>JobDeputy · Invite friends</title>');
  });

  it('marks its own header link as current and no nav item, since Invite has none', () => {
    const actions = markedBlock(invite, 'HeaderActions');
    // The shared block may gain attributes (round 3 added tooltips); the link stays current.
    const link = actions.match(/<a class="header-action header-invite"[^>]*>/)?.[0] ?? '';
    expect(attributesOf(link)).toMatchObject({
      href: './invite-preview.html',
      'aria-current': 'page',
    });
    expect(actions.replace(' aria-current="page"', '')).toBe(
      markedBlock(reference, 'HeaderActions'),
    );
    const nav = markedBlock(invite, 'AppNav');
    expect(nav).not.toContain('aria-current');
    // Round 6 (T1): the reference (AI & credits) marks Settings with aria-current="true".
    expect(nav).toBe(markedBlock(reference, 'AppNav').replace(/ aria-current="(?:page|true)"/, ''));
    expect(
      textOf(
        invite.match(/<button\s+class="compact-action app-menu-toggle"[\s\S]*?<\/button>/)?.[0] ??
          '',
      ),
    ).toBe('Menu · Invite friends');
  });

  it('hosts the deputy in the invite state, with that state’s duty and speech', () => {
    const dock = markedBlock(invite, 'DeputyDock');
    expect(dock).toContain('data-deputy-page="invite"');
    expect(dock).toContain('data-deputy-state="invite"');
    expect(dock).toContain('<p class="deputy-speech" data-deputy-speech>Bring a friend along.</p>');
    expect(dock).toContain('<span data-deputy-duty>Inviting friends</span>');
    const normalize = (block: string) =>
      block
        .replace(/data-deputy-page="[^"]*"/, '')
        .replace(/data-deputy-state="[^"]*"/, '')
        .replace(/(<p class="deputy-speech" data-deputy-speech>)[^<]*(<\/p>)/, '$1$2')
        .replace(/(<span data-deputy-duty>)[^<]*(<\/span>)/, '$1$2');
    expect(normalize(dock)).toBe(normalize(markedBlock(reference, 'DeputyDock')));
    // One panda per viewport: the dock is the only drawing; the empty state uses a prop.
    expect(main).not.toMatch(/data-deputy(?:-art)?[\s>=]/);
    expect(main).toContain('data-deputy-prop="envelope"');
  });

  it('opens with the reward in one line, planned for launch and never money (I1)', () => {
    expect(textOf(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')).toBe(
      'Invite friends, earn AI credits.',
    );
    // The reward is tokens on your model: 100,000 on the seed's Ministral 3 14B. Round 6 (I1):
    // the one line says "tokens' worth", as the rule is worded (the value, shown as tokens).
    expect(textOf(main.match(/<p class="intro-copy">([\s\S]*?)<\/p>/)?.[1] ?? '')).toBe(
      'When a friend runs a first search, you both get 100,000 tokens’ worth of AI credits.',
    );
    expect(main).toContain(
      'you both get <span data-invite-reward data-metric="referrals.reward">100,000</span> tokens’ worth',
    );
    expect(main).toMatch(/<p class="eyebrow">Invite friends<\/p>/);
    // Round 6 (I1): the two honest facts sit with the reward; one sample note per card.
    expect(textOf(main.match(/<p class="invite-planned">([\s\S]*?)<\/p>/)?.[1] ?? '')).toBe(
      'Planned for launch AI credits only, never money',
    );
    expect(main.match(/class="sample-note"/g)).toHaveLength(3);
    for (const id of ['share', 'progress']) {
      expect(main, `#${id}`).toMatch(
        new RegExp(`<section\\s+class="task-surface invite-surface"\\s+id="${id}"`),
      );
    }
    // How it works and the rules are folded under one disclosure, closed by default.
    expect(main).toMatch(/<details\s+class="invite-more"\s+id="how"/);
    expect(elementById(invite, 'how')).toContain('id="rules"');
    expect(elementById(invite, 'how')).not.toMatch(/^<details[^>]*\sopen\b/);
  });

  it('uses the shared page intro with Take the tour, and leaves its layout to the chrome (R6-3)', () => {
    const intro =
      main.match(/<section class="page-intro invite-intro"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(intro).toMatch(
      /^<section class="page-intro invite-intro" aria-labelledby="page-title">\s*<div class="page-intro-copy">\s*<p class="eyebrow">/,
    );
    expect(intro).toContain(
      '<div class="page-intro-actions">\n            <button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour</button>\n          </div>',
    );
    const styles = invite.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(styles).not.toMatch(/\.invite-intro\s*\{/);
    expect(styles).not.toMatch(/\.page-intro|\.page-tour/);
  });

  it('never shows money, prices, or discounts as a reward', () => {
    expect(textOf(main)).not.toMatch(/[$€£]\s?\d|\bUSD\b|\bcredit card\b|\b\d+% off\b|per month/i);
    expect(textOf(elementById(invite, 'rules'))).toContain(
      'AI credits only, never money or discounts.',
    );
    expect(textOf(main)).not.toMatch(/[–—]/);
    expect(script).not.toMatch(/'[^'\n]*[–—][^'\n]*'|`[^`\n]*[–—][^`\n]*`/);
  });

  it('announces through one visually hidden channel and keeps visible feedback quiet', () => {
    const live = [
      ...invite.matchAll(
        /<([a-z]+)\b([^>]*(?:role="(?:status|alert|log)"|aria-live="(?!off)[^"]*")[^>]*)>/g,
      ),
    ].map((match) => match[0]);
    expect(live).toEqual([
      '<p class="sr-only" data-deputy-announce role="status">',
      '<p class="sr-only" id="invite-status" role="status" aria-live="polite">',
    ]);
  });
});

describe('Invite friends · AI credits, never runs (round 5, brief 4.3)', () => {
  it('calls the bonus AI credits, tokens on your model, and never AI runs', () => {
    const shown = textOf(main);
    expect(shown).toContain('Bonus AI credits this year');
    expect(shown).toContain('You both get bonus AI credits');
    // Round 5 retires AI runs everywhere (G3, G4).
    expect(shown).not.toMatch(/\bAI runs?\b|\bbonus runs?\b|\bget \d+ runs\b/i);
    expect(script).not.toMatch(/rewardRuns|capRuns|bonusRuns|AI runs?\b/);
    // UAT-D-25: a friend's first search earns the credits, as the steps say.
    expect(shown).toContain('When a friend runs a first search');
    expect(shown).not.toContain('sets up their deputy');
    expect(invite).toContain(
      'content="JobDeputy Invite friends: share your link, and you and your friend each get bonus AI credits for Deputy Assist."',
    );
    // The store's rule: 100,000 tokens' worth each at the free credits' model, 5 friends a year.
    expect([seed.rewardTokens, seed.capFriends]).toEqual([100000, 5]);
    expect([store.CREDITS.referralTokens, store.CREDITS.referralFriendsPerYear]).toEqual([
      100000, 5,
    ]);
    expect(inviteRules.FREE_TOKENS).toBe(store.CREDITS.freeTokens);
  });

  it('says the reward in tokens on your model, and follows a change of model (W11)', () => {
    const credits = store.credits();
    expect(inviteRules.rewardOnModel(inviteRules.normalize(seed), credits)).toBe(100000);
    // On DeepSeek V3.2 the same value buys fewer tokens: the reward and the bonus earned agree.
    const deepseek = loadStore();
    deepseek.setPlatformModel('deepseek-v3-2');
    const onDeepseek = deepseek.credits();
    const reward = inviteRules.rewardOnModel(
      inviteRules.normalize(plain(deepseek.get().referrals)),
      onDeepseek,
      deepseek.CREDITS.freeTokens,
    );
    expect(reward).toBe(onDeepseek.bonus.earned);
    expect(deepseek.format.tokens(reward)).toBe('26,795');
    expect(deepseek.metricText('referrals.bonus')).toBe('26,795');
    expect(deepseek.metricText('ai.model.name')).toBe('DeepSeek V3.2');
    // Before any friend is rewarded, the reward reads in proportion to the free credits' tokens.
    expect(
      inviteRules.rewardOnModel(inviteRules.normalize(seed), {
        bonus: { friends: 0, earned: 0 },
        free: { tokens: onDeepseek.free.tokens },
      }),
    ).toBe(26795);
    expect(inviteRules.rewardOnModel(inviteRules.normalize(seed), null)).toBe(100000);
    // The page writes it with the store's token words, and redraws on every change.
    expect(script).toContain(
      'tokensText(rules.rewardOnModel(current, credits, store?.CREDITS?.freeTokens)),',
    );
  });
});

describe('Invite friends · share card', () => {
  const share = elementById(invite, 'share');

  it('shows the store’s link read only, with Copy link as the one primary action', () => {
    const input = attributesOf(
      share.match(/<input\s+class="field-control invite-link"[^>]*\/>/)?.[0] ?? '',
    );
    expect(input).toMatchObject({
      id: 'invite-link',
      type: 'text',
      value: seed.link,
      readonly: '',
      'aria-describedby': 'invite-copy-help',
    });
    expect(seed.link).toBe('https://jobdeputy.example/invite/ALEX-7Q2K');
    expect(share).toContain(
      '<label class="field-label" for="invite-link">Your invite link</label>',
    );
    expect(main.match(/class="primary-action"/g)).toHaveLength(1);
    expect(share).toContain(
      '<button class="primary-action" id="invite-copy" type="button">Copy link</button>',
    );
  });

  it('copies with the clipboard, falls back to selected text, and says what happened', () => {
    expect(script).toContain('await navigator.clipboard.writeText(linkInput.value);');
    expect(script).toContain('linkInput.select();');
    expect(script).toContain("copied = document.execCommand('copy');");
    expect(script).toContain("announce('Invite link copied.');");
    expect(script).toContain(
      "copyHelp.textContent = 'Selected. Press Ctrl+C, or ⌘C on a Mac, to copy it.';",
    );
    // The result is contextual: focus returns to Copy link after a fallback copy.
    expect(script).toContain('if (document.activeElement !== copyButton) copyButton.focus();');
    // The deputy reacts once to the copy (R3-8), then settles back into its invite pose.
    expect(script).toMatch(/announce\('Invite link copied\.'\);\s*deputy\?\.react\('copied'\);/);
    expect(script).not.toContain("deputy?.set('invite');");
  });

  it('invites by email through the store, simulated, with field feedback', () => {
    const form = elementById(invite, 'invite-form');
    expect(form).toMatch(/^<form class="invite-field" id="invite-form" novalidate>/);
    const email = attributesOf(form.match(/<input\s+class="field-control"[\s\S]*?\/>/)?.[0] ?? '');
    expect(email).toMatchObject({
      id: 'invite-email',
      type: 'email',
      'aria-describedby': 'invite-email-error invite-email-note',
    });
    expect(form).toContain('<label class="field-label" for="invite-email">Invite by email</label>');
    expect(form).toContain(
      '<button class="secondary-action" id="invite-send" type="submit">Invite</button>',
    );
    expect(form).toContain('<p class="invite-field-error" id="invite-email-error" hidden></p>');
    expect(form).toContain(
      '<p class="sample-note" id="invite-email-note">Prototype · no email is sent</p>',
    );
    expect(form).toMatch(
      /<section\s+class="feedback-panel"\s+id="invite-result"\s+data-kind="success"\s+hidden/,
    );
    expect(script).toContain('store.addInvite({ email: address });');
    expect(script).toMatch(
      /`\$\{address\} is on your list as Invited\. Prototype: no email was sent\.`/,
    );
    // Nothing leaves the browser, so the deputy says so (handoff section 2).
    expect(script).toContain("deputy?.react('sent', { speech: 'Prepared. Nothing was sent.' });");
    // Typed text is shown as text, never as HTML.
    expect(script).not.toMatch(/innerHTML|insertAdjacentHTML/);
  });

  it('adds an invite to the store as Invited, once per address, and the list shows it first', () => {
    const store = loadStore();
    const before = store.get().referrals.invites.length;
    const added = store.addInvite({ email: 'Casey.Nguyen@example.com' });
    expect(plain(added)).toMatchObject({
      email: 'casey.nguyen@example.com',
      status: 'invited',
      date: '2026-10-02',
    });
    expect(store.addInvite({ email: 'casey.nguyen@example.com' }).id).toBe(added.id);
    const after = inviteRules.normalize(plain(store.get().referrals));
    expect(after.invites).toHaveLength(before + 1);
    expect(inviteRules.ordered(after.invites)[0]?.email).toBe('casey.nguyen@example.com');
    expect(inviteRules.counts(after)).toEqual({ invited: 4, joined: 2, rewarded: 1, cap: 5 });
    expect(inviteRules.emailProblem('casey.nguyen@example.com', after.invites)).toBe(
      'You already invited casey.nguyen@example.com.',
    );
  });
});

describe('Invite friends · how it works', () => {
  it('shows three visual steps: share, your friend searches, you both get bonus credits', () => {
    const steps = [
      ...elementById(invite, 'how').matchAll(
        /<li class="invite-step">[\s\S]*?<use href="#invite-icon-(\w+)" \/>[\s\S]*?<span class="invite-step-number">([^<]+)<\/span>\s*<span class="invite-step-title">([^<]+)<\/span>/g,
      ),
    ].map((match) => [match[1], match[2], match[3]]);
    expect(steps).toEqual([
      ['link', 'Step 1', 'Share your link'],
      ['search', 'Step 2', 'Your friend runs a first search'],
      ['gift', 'Step 3', 'You both get bonus AI credits'],
    ]);
  });
});

describe('Invite friends · progress', () => {
  const progress = elementById(invite, 'progress');
  const counts = inviteRules.counts(inviteRules.normalize(seed));

  it('shows the bonus credits earned this year as a meter in Your progress, one step a friend', () => {
    // Round 6 (I1): progress is one card (the meter, the counts, the list), so the meter moved
    // from the intro into Your progress; the intro's figure is the reward itself.
    expect(progress).toContain('<div class="meter-group invite-meter">');
    expect(main.match(/class="meter[ "]/g)).toHaveLength(1);
    const meter = attributesOf(
      progress.match(/<div\s+class="meter is-stepped"[\s\S]*?>/)?.[0] ?? '',
    );
    const view = inviteRules.meterView(inviteRules.normalize(seed), {
      earned: store.metricText('referrals.bonus'),
      model: store.metricText('ai.model.name'),
    });
    expect(plain(view)).toEqual({
      now: 1,
      max: 5,
      value: 20,
      steps: 5,
      text: '1 of 5 friends this year: 100,000 tokens of bonus AI credits on Ministral 3 14B',
    });
    expect(meter).toMatchObject({
      role: 'meter',
      'aria-labelledby': 'invite-meter-label',
      'aria-valuemin': '0',
      'aria-valuemax': String(view.max),
      'aria-valuenow': String(view.now),
      'aria-valuetext': view.text,
      style: `--value: ${view.value}; --steps: ${view.steps}`,
    });
    expect(textOf(elementById(invite, 'invite-meter-label'))).toBe('Bonus AI credits this year');
    expect(textOf(elementById(invite, 'invite-meter-value'))).toBe(
      '100,000 tokens on Ministral 3 14B',
    );
    // The bonus earned (tokens on your model) and the model are the store's figures; the friends
    // and the cap are in the meter's steps and words, and the cap in the rules.
    expect(elementById(invite, 'invite-meter-value')).toContain(
      '<span data-metric="referrals.bonus">100,000</span> tokens on <span data-metric="ai.model.name">Ministral 3 14B</span>',
    );
    expect([counts.rewarded, counts.cap]).toEqual([1, 5]);
    expect(store.metricText('referrals.bonus')).toBe(
      store.format.tokens(store.credits().bonus.earned),
    );
    expect(script).toContain("meter.setAttribute('aria-valuetext', view.text);");
  });

  it('counts the friends rewarded, invited, and joined from the store in one line', () => {
    // Round 6 (I1): one line of counts replaces round 5's two KPI tiles, which were about 536px
    // wide each for "3" and "2" and only linked to the list right below them.
    expect(progress).not.toContain('class="kpi');
    const tally = elementById(invite, 'invite-tally');
    expect(textOf(tally)).toBe('1 of 5 friends this year 3 invited 2 joined');
    const parts = [
      ...tally.matchAll(
        /<strong(?: data-invite-count="(\w+)")? data-metric="([\w.]+)">(\d+)<\/strong>/g,
      ),
    ].map((match) => [match[1] ?? '', match[2], match[3]]);
    expect(parts).toEqual([
      ['', 'referrals.rewarded', '1'],
      ['invited', 'referrals.invites', '3'],
      ['joined', 'referrals.joined', '2'],
    ]);
    for (const [, key, shown] of parts) expect(shown).toBe(store.metricText(String(key)));
    expect(tally).toContain('<span data-invite-cap>5</span> friends this year');
    expect([counts.invited, counts.joined, counts.rewarded]).toEqual([3, 2, 1]);
    // The bonus earned is the meter's figure above, so no tile repeats it (R3-4).
    expect(store.credits().bonus.friends).toBe(counts.rewarded);
    expect(tally).not.toMatch(/Runs earned|Credits earned|referrals\.bonus/);
  });

  it('shows every figure once, with the store’s text for its key', () => {
    const figures = [
      ...main.matchAll(/<([a-z]+)\b[^>]*\sdata-metric="([^"]+)"[^>]*>([^<]*)<\/\1>/g),
    ].map((match) => [match[2], (match[3] ?? '').trim()]);
    expect(figures.map(([key]) => key)).toEqual([
      'referrals.reward',
      'referrals.bonus',
      'ai.model.name',
      'referrals.rewarded',
      'referrals.invites',
      'referrals.joined',
    ]);
    for (const [key, shown] of figures) expect(shown, key).toBe(store.metricText(String(key)));
    expect(script).toContain(
      'return value === null || value === undefined ? String(fallback) : store.metricText(key);',
    );
  });

  it('lists everyone invited, newest first, with initials, email, and a status pill', () => {
    const rows = [
      ...elementById(invite, 'invite-list').matchAll(
        /<li class="invite-item" data-invite="(\w+)">[\s\S]*?<span class="invite-initials" aria-hidden="true">(\w+)<\/span>([\s\S]*?)<span class="status-pill([^"]*)">([^<]+)<\/span>\s*<span class="invite-date">([^<]+)<\/span>/g,
      ),
    ].map((match) => [
      match[1],
      match[2],
      textOf(match[3] ?? ''),
      (match[4] ?? '').trim(),
      match[5],
      match[6],
    ]);
    expect(rows).toEqual([
      ['taylor', 'TK', 'taylor.kim@example.com', 'is-neutral', 'Invited', 'Oct 1'],
      ['sam', 'SR', 'Sam Rivera sam.rivera@example.com', 'is-neutral', 'Joined', 'Sep 29'],
      ['jordan', 'JL', 'Jordan Lee jordan.lee@example.com', '', 'Credits added', 'Sep 20'],
    ]);
    // The markup is what the script renders from the store's seed.
    const ordered = inviteRules.ordered(inviteRules.normalize(seed).invites);
    expect(
      ordered.map((entry) => [
        entry.id,
        inviteRules.initials(entry),
        inviteRules.STATUS_LABELS[entry.status],
        inviteRules.formatDate(entry.date),
      ]),
    ).toEqual(rows.map((row) => [row[0], row[1], row[4], row[5]]));
    expect(script).toContain('const page = rules.firstPage(current.invites, showAll);');
    expect(script).toContain('list.replaceChildren(...page.shown.map(itemFor));');
    expect(script).toContain('store?.subscribe(() => render());');
  });

  it('shows the newest five invites, then See all with the count (R6-4)', () => {
    expect(inviteRules.FIRST_PAGE).toBe(5);
    const many = inviteRules.normalize({
      ...seed,
      invites: Array.from({ length: 8 }, (_, index) => ({
        id: `friend-${index}`,
        name: null,
        email: `friend${index}@example.com`,
        status: 'invited',
        date: `2026-09-${String(10 + index).padStart(2, '0')}`,
      })),
    });
    const page = inviteRules.firstPage(many.invites);
    expect(page.shown.map((entry) => entry.id)).toEqual([
      'friend-7',
      'friend-6',
      'friend-5',
      'friend-4',
      'friend-3',
    ]);
    expect([page.total, page.more, page.seeAll]).toEqual([8, true, 'See all 8']);
    expect(inviteRules.firstPage(many.invites, true).shown).toHaveLength(8);
    // The seed's three need no See all, which waits hidden.
    expect(inviteRules.firstPage(inviteRules.normalize(seed).invites).more).toBe(false);
    expect(progress).toMatch(
      /<p class="invite-see-all" id="invite-see-all-row" hidden>\s*<button type="button" class="chart-action see-all-open" id="invite-see-all" aria-haspopup="dialog">See all<\/button>/,
    );
    // The shared See all panel when the page has it, else the list grows in place.
    expect(script).toContain("return typeof panel?.open === 'function' ? panel : null;");
    expect(script).toContain('showAll = !showAll;');
  });
});

describe('Invite friends · rules', () => {
  it('says the rules in four short lines, planned for launch, folded with how it works', () => {
    const rules = elementById(invite, 'rules');
    expect(rules).toMatch(
      /^<div class="invite-rules" id="rules">\s*<h3 class="invite-rules-title">The rules<\/h3>/,
    );
    expect(
      [...rules.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => textOf(match[1] ?? '')),
    ).toEqual([
      'Deputy Assist uses bonus credits after your free ones.',
      'They show as tokens on your model, like all credits.',
      `You can earn them for up to ${seed.capFriends} friends a year.`,
      'AI credits only, never money or discounts.',
    ]);
    // Each rule's words are one grid item beside the check mark, so the cap's figure never lands
    // in the check mark's column (round 5 acceptance, fix 9).
    for (const match of rules.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
      expect(match[1]).toMatch(/^<span class="invite-rule-text">[\s\S]*<\/span>$/);
    }
    // Expiry is the owner's to decide (A4's agreement text), so the page names none.
    expect(textOf(rules)).not.toMatch(/\bdays\b|expire/);
    expect(elementById(invite, 'how')).toContain(
      '<p class="sample-note">Planned for launch · sample data</p>',
    );
    // Round 5's #how and #rules links open the disclosure.
    expect(elementById(invite, 'how')).toContain(
      '<summary id="invite-more-title">How it works and the rules</summary>',
    );
    expect(script).toContain("if (id !== 'how' && id !== 'rules') return;");
    expect(script).toContain('more.open = true;');
    expect(script).toContain("window.addEventListener('hashchange', openMore);");
  });
});

describe('Invite friends · tour (R6-2)', () => {
  const steps = [
    ...main.matchAll(
      /<(section|details)\s+class="([^"]+)"\s+id="([\w-]+)"[^>]*?\sdata-tour-step="(\d+)"\s+data-tour-title="([^"]+)"\s+data-tour-text="([^"]+)"/g,
    ),
  ].map((match) => ({
    id: match[3],
    step: Number(match[4]),
    title: match[5] ?? '',
    text: match[6] ?? '',
  }));

  it('gives three steps in the deputy’s first person: the link, the progress, the rules', () => {
    expect(steps.map(({ id, step, title }) => [id, step, title])).toEqual([
      ['share', 1, 'Share this link with friends.'],
      ['progress', 2, 'I keep score for you.'],
      ['how', 3, 'The rules are in here.'],
    ]);
    for (const { title, text } of steps) {
      expect(title.split(/\s+/).length, title).toBeLessThanOrEqual(6);
      expect(text, title).toMatch(/\b(?:I|my|me)\b/);
      expect(`${title} ${text}`).not.toMatch(/[\u2013\u2014]/);
    }
    // The progress step names the store's yearly cap and follows it.
    expect(steps[1]?.text).toBe(inviteRules.progressTour(seed.capFriends));
    expect(inviteRules.progressTour(3)).toContain('up to 3 friends a year');
    expect(inviteRules.progressTour(0)).not.toContain('up to');
    // The tour starts only when asked (R3-6).
    expect(script).not.toMatch(/tour\.start|maybeStart/);
  });
});

describe('Invite friends rules', () => {
  it('normalizes saved referrals and keeps the defaults for anything missing', () => {
    expect(plain(inviteRules.normalize(undefined))).toEqual(plain(inviteRules.DEFAULTS));
    const odd = plain(
      inviteRules.normalize({
        capFriends: -1,
        rewardTokens: 2.5,
        invites: [{ email: 'riley@example.com', status: 'sent', name: '  ' }, { name: 'No email' }],
      }),
    );
    expect(odd.capFriends).toBe(5);
    expect(odd.rewardTokens).toBe(100000);
    expect(odd.invites).toEqual([
      {
        id: 'riley@example.com',
        name: null,
        email: 'riley@example.com',
        status: 'invited',
        date: '',
      },
    ]);
    expect(plain(inviteRules.STATUSES)).toEqual(['invited', 'joined', 'rewarded']);
    expect(plain(inviteRules.STATUS_LABELS)).toEqual({
      invited: 'Invited',
      joined: 'Joined',
      rewarded: 'Credits added',
    });
  });

  it('caps the friends rewarded at the yearly limit', () => {
    const many = inviteRules.normalize({
      ...seed,
      invites: Array.from({ length: 7 }, (_, index) => ({
        id: `friend-${index}`,
        name: null,
        email: `friend${index}@example.com`,
        status: 'rewarded',
        date: '2026-09-01',
      })),
    });
    expect(inviteRules.counts(many)).toEqual({ invited: 7, joined: 7, rewarded: 5, cap: 5 });
    expect(inviteRules.meterView(many).text).toBe('5 of 5 friends this year');
  });

  it('makes initials from a name, or from an address without one', () => {
    expect(inviteRules.initials({ name: 'Jordan Lee', email: 'jordan.lee@example.com' })).toBe(
      'JL',
    );
    expect(inviteRules.initials({ name: null, email: 'taylor.kim@example.com' })).toBe('TK');
    expect(inviteRules.initials({ name: null, email: 'casey@example.com' })).toBe('CA');
    expect(inviteRules.initials({ name: 'Mary Ann de Silva', email: 'm@example.com' })).toBe('MS');
  });

  it('checks an address: empty, malformed, your own, and already invited', () => {
    const invites = inviteRules.normalize(seed).invites;
    expect(inviteRules.emailProblem('', invites)).toBe('Enter your friend’s email address.');
    expect(inviteRules.emailProblem('casey@', invites)).toBe(
      'Enter an email address like friend@example.com.',
    );
    expect(inviteRules.emailProblem(' Alex.Morgan@example.com ', invites)).toBe(
      'That’s your own address. Enter a friend’s email.',
    );
    expect(inviteRules.OWN_EMAIL).toBe('alex.morgan@example.com');
    expect(inviteRules.emailProblem('TAYLOR.KIM@example.com', invites)).toBe(
      'You already invited taylor.kim@example.com.',
    );
    expect(inviteRules.emailProblem('casey.nguyen@example.com', invites)).toBeNull();
  });

  it('orders the newest first and dates them like the rest of the app', () => {
    expect(inviteRules.formatDate('2026-10-02')).toBe('Oct 2');
    expect(inviteRules.formatDate('')).toBe('');
    const sameDay = [
      { id: 'a', name: null, email: 'a@example.com', status: 'invited', date: '2026-10-02' },
      { id: 'b', name: null, email: 'b@example.com', status: 'invited', date: '2026-10-02' },
      { id: 'c', name: null, email: 'c@example.com', status: 'joined', date: '2026-09-29' },
    ];
    expect(inviteRules.ordered(sameDay).map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
  });
});
