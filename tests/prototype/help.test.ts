import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Page guarantees for Help (brand/trust-preview.html), round 3: topic cards that filter the
// answers, Demos of every page's tour, a complete FAQ, one Contact section, the trust sections, and
// Reset sample data; plus the public variant (?public) that shows only what needs no account.
// Round 4: answers for Deputy Assist (what it is, the one AI setting, the own-key token limit),
// the Shop and donations, and Job matches pages; the nightly runs answer's ring meter; the Shop's
// tour in Demos; and a reset that also clears the limit, added runs, and pledges. Round 5 (brief
// 4.7, G1 to G5, H1): Your agreements (every signed copy to view and download, the version waiting
// with its reminders, the pause date, what pauses and what never does, and Sign now), the overdue
// demo, answers for AI credits and their prices (the AWS rate plus the margin, tax at checkout,
// from PRICING and models()), the three models, LinkedIn, email reading, site accounts and
// passwords, the agreement, and supporter benefits; AI runs are retired. Round 6 (G8, G7, T1,
// R6-2, R6-3): Guides (#guides) from guides(), with ?guide=<id>#guides opening one as an article;
// the large account demo in Demos (See a large account, Back to the usual sample); answers for
// Settings and its tabs, skipping setup, the large demo, Review then auto-apply, prompt tests and
// rollback, and Gmail watching the board; the Shop is Purchases; links to what moved out of
// Profile go to Account and Connections; the shared page intro with Take the tour, and a five-step
// tour in the deputy's first person. Round 6 part 2 (N3, P-6, P-10, P-14, M-11): one Runs
// allowance for every search (nightly runs read runs; Keep watch is the nightly schedule), Your
// agreements as a short card whose home is Settings, Account, How prices are made in Purchases,
// Kept by you for the prompt measure, and Demos described as each page is now. The rendered flows
// are checked in headless Chrome; these static guards keep the contract from drifting.

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const sourceFor = (file: string): string => readFileSync(resolve(brandDirectory, file), 'utf8');

const trust = sourceFor('trust-preview.html');
const inlineScripts = [...trust.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
  (match) => match[1] ?? '',
);
const headScript = inlineScripts[0] ?? '';
const pageScript = inlineScripts[1] ?? '';
const main = trust.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? '';
const styles = trust.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

// The element that starts at `from` (an index of "<tag"), through its matching closing tag.
function elementAt(source: string, from: number): string {
  const tag = source.slice(from + 1).match(/^[a-z0-9-]+/)?.[0] ?? '';
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'g');
  pattern.lastIndex = from;
  let depth = 0;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    if (match[2] === '/') continue;
    depth += match[1] ? -1 : 1;
    if (depth === 0) return source.slice(from, match.index + match[0].length);
  }
  return source.slice(from);
}

const byId = (id: string): string => {
  const at = main.search(new RegExp(`<[a-z0-9]+\\b[^>]*\\sid="${id}"`));
  return at < 0 ? '' : elementAt(main, at);
};

// Every element with the attribute, as its whole markup.
const elementsWith = (source: string, attribute: string): string[] =>
  [...source.matchAll(new RegExp(`<[a-z0-9]+\\b[^>]*\\s${attribute}(?![\\w-])`, 'g'))].map(
    (match) => elementAt(source, match.index ?? 0),
  );

interface Item {
  id: string;
  label: string;
  tone: string | null;
  meaning: string;
}

interface Limit {
  tokens: number | null;
  period: string;
  onReach: string;
  state: string;
  periodLabel: string;
  appliesTo: unknown;
  usingPlatform: boolean;
}

interface Reminder {
  day: number;
  at: string;
  via: string[];
  sent: boolean;
}

interface SignedRecord {
  version: string;
  signedAt: string;
  name: string;
  email: string;
  fingerprint: string | null;
  kept: string;
  consents: string[];
  href: string;
}

interface Agreements {
  current: string;
  signed: SignedRecord[];
  pending: {
    version: string;
    publishedAt: string;
    changes: string[];
    reminders: Reminder[];
    remindersSent: number;
    nextReminderAt: string | null;
    pauseAt: string;
    daysLeft: number;
    overdue: boolean;
    demo: boolean;
    href: string;
  } | null;
  paused: boolean;
  demo: boolean;
  pauses: string[];
  neverPauses: string[];
}

interface Model {
  id: string;
  name: string;
  speed: string;
  recommended: boolean;
}

interface SampleStore {
  FITS: Item[];
  STAGES: Item[];
  TERMS: Record<string, string>;
  PRICING: Record<string, string | number>;
  CREDITS: { freeTokens: number; freeModel: string };
  format: { tokens(value: number): string };
  metricText(key: string): string;
  reset(): void;
  addApplication(entry: Record<string, unknown>): unknown;
  setPrompt(id: string, text: string | null): { ok?: boolean } | null;
  markTourSeen(page: string): unknown;
  disconnectGmail(): unknown;
  startRun(sourceId: string, options?: Record<string, unknown>): { ok: boolean; reason?: string };
  get(): { connections: { gmail: { status: string } } };
  aiChoice(): { source: string; summary: string; href: string; limited: string | null };
  setAiChoice(source: string): unknown;
  aiLimit(): Limit;
  setAiLimit(fields: Record<string, unknown>): Limit | null;
  support(): {
    pledged: boolean;
    cadence: string | null;
    benefits: { id: string; title: string; text: string; planned: boolean }[];
    listing: { optIn: boolean; display: string };
    note: string;
  };
  pledgeSupport(cadence: string): unknown;
  setSupporterListing(fields: Record<string, unknown>): unknown;
  allowance(): { nightly: Record<string, unknown>; runs: Record<string, unknown> };
  models(): Model[];
  setPlatformModel(id: string): unknown;
  credits(): { model: { id: string } };
  buy(itemId: string): { ok: boolean; reason?: string };
  purchases(): unknown[];
  markUpdateRead(id: string): unknown;
  agreements(): Agreements;
  signAgreement(fields: Record<string, unknown>): { ok: boolean; reason?: string };
  setAgreementDemo(mode: string | null): Agreements | null;
  requiresAgreement(feature: string): { version: string } | null;
  connections(): { linkedin: { status: string } };
  connectLinkedin(): unknown;
}

// The shared sample store on its seed, run in a sandbox with its own storage. It loads the prompt
// guard (saving a prompt fails closed without it) and the agreement's text (its fingerprints)
// first, as the page does.
function seedStore(): SampleStore {
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  const sandbox: Record<string, unknown> = {
    addEventListener: () => {},
    location: { search: '' },
    localStorage,
  };
  const context = {
    window: sandbox,
    localStorage,
    JSON,
    Date,
    Intl,
    Math,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    console,
    crypto: globalThis.crypto,
    TextEncoder,
  };
  for (const file of ['prompt-guard.js', 'agreement-text.js', 'sample-store.js']) {
    runInNewContext(sourceFor(file), context);
  }
  return sandbox.JobDeputyStore as SampleStore;
}

const topicCards = (() => {
  const fieldset = main.match(
    /<fieldset class="choice-cards help-topics"[\s\S]*?<\/fieldset>/,
  )?.[0];
  return [
    ...(fieldset ?? '').matchAll(
      /<label class="choice-card help-topic"([^>]*)>([\s\S]*?)<\/label>/g,
    ),
  ].map((match) => ({
    signedIn: /data-signed-in/.test(match[1] ?? ''),
    value: match[2]?.match(/value="([^"]+)"/)?.[1] ?? '',
    type: match[2]?.match(/type="([^"]+)"/)?.[1] ?? '',
    label: textOf(match[2]?.match(/<span class="choice-card-label">([\s\S]*?)<\/span>/)?.[1] ?? ''),
    count: (() => {
      const markup = match[2] ?? '';
      const at = markup.indexOf('<span class="list-toolbar-count">');
      return at < 0
        ? ''
        : elementAt(markup, at).replace(/^<span class="list-toolbar-count">|<\/span>$/g, '');
    })(),
    markup: match[0],
  }));
})();

const answers = elementsWith(main, 'data-list-item').map((markup) => ({
  id: markup.match(/\sid="([^"]+)"/)?.[1] ?? '',
  topic: markup.match(/data-filter-topic="([^"]+)"/)?.[1] ?? '',
  question: textOf(markup.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? ''),
  signedIn: /^<details[^>]*\sdata-signed-in\b/.test(markup),
  markup,
}));

// main as one variant leaves it: the page removes the other variant's parts before it draws
// (signed in: every [data-public-only] part; public: every [data-signed-in] part).
const withoutParts = (html: string, attribute: string): string => {
  const pattern = new RegExp(`<[a-z0-9]+\\b[^>]*\\s${attribute}(?![\\w-])`);
  let rest = html;
  for (let at = rest.search(pattern); at >= 0; at = rest.search(pattern)) {
    rest = rest.slice(0, at) + rest.slice(at + elementAt(rest, at).length);
  }
  return rest;
};
const signedInMain = withoutParts(main, 'data-public-only');
const publicMain = withoutParts(main, 'data-signed-in');
const figuresIn = (html: string) =>
  [...html.matchAll(/data-metric="([^"]+)"[^>]*>([^<]*)</g)].map((match) => ({
    key: match[1] ?? '',
    text: (match[2] ?? '').trim(),
  }));

describe('Help: the page and its sections', () => {
  it('opens with the page title and keeps every anchor the shell links to', () => {
    expect(trust).toContain('<title>JobDeputy · Help</title>');
    expect(trust).toContain('<h1 id="trust-title">Answers, privacy, and support.</h1>');
    expect(trust).toContain('<a class="skip-link" href="#trust-title">Skip to help</a>');
    // The account menu and footer link #help, #privacy, #security, and #accessibility; onboarding
    // links #keep-watch; the agreement page links #agreements (round 5); Demos, the FAQ, Contact,
    // and the overdue demo have their own.
    for (const id of [
      'help',
      'faq',
      'guides',
      'guide-article',
      'agreements',
      'demos',
      'help-overdue',
      'help-scale',
      'contact',
      'privacy',
      'security',
      'accessibility',
      'keep-watch',
      'sample-data',
      'contact-form',
    ]) {
      expect(main.match(new RegExp(`\\sid="${id}"`, 'g')), id).toHaveLength(1);
    }
    const links = [
      ...(main.match(/<nav class="section-links"[\s\S]*?<\/nav>/)?.[0] ?? '').matchAll(
        /<a class="compact-action" href="([^"]+)"/g,
      ),
    ].map((match) => match[1]);
    // Round 6 (G8): Guides joins the section links, after the answers.
    expect(links).toEqual([
      '#faq',
      '#guides',
      '#agreements',
      '#demos',
      '#contact',
      '#privacy',
      '#security',
      '#accessibility',
    ]);
    // Your agreements is the account's: the link and the section are signed-in only.
    expect(main).toContain(
      '<a class="compact-action" href="#agreements" data-signed-in>Your agreements</a>',
    );
  });

  it('keeps no section the menu already reaches or round 2 retired', () => {
    // No "Open Searches" style links, no separate Feedback card, and no "04 · Help".
    expect(main).not.toContain('trust-topic-link');
    expect(main).not.toMatch(/>\s*Open (?:Searches|Job matches|Applications|Résumés|AI)/);
    expect(main).not.toMatch(/\d\d · (?:Privacy|Security|Accessibility|Help)/);
    expect(main).not.toContain('id="questions"');
    expect(main).not.toContain('id="feedback"');
    // Every section leads with its label and heading, then one short line at most.
    for (const id of [
      'help',
      'guides',
      'agreements',
      'demos',
      'privacy',
      'security',
      'accessibility',
      'sample-data',
    ]) {
      const copy = textOf(byId(id).match(/<p class="section-copy">([\s\S]*?)<\/p>/)?.[1] ?? '');
      expect(copy.split(' ').length, id).toBeLessThanOrEqual(14);
    }
  });

  it('writes its copy without dashes, and shows only the store’s prices, each marked a sample', () => {
    const copy = textOf(main);
    expect(copy).not.toMatch(/\s[–—]\s|[–—]/);
    // Round 5 (R5-1): prices are shown, and each one is a store figure (data-metric), never typed
    // into the page; without those figures no amount is left anywhere in the copy.
    const store = seedStore();
    const withoutFigures = main.replace(
      /<([a-z]+)\b[^>]*\sdata-metric="[^"]+"[^>]*>[^<]*<\/\1>/g,
      '',
    );
    expect(textOf(withoutFigures)).not.toMatch(/[$€£]\s?\d|per month|\/mo\b/i);
    const prices = figuresIn(main).filter((figure) => /^\$/.test(figure.text));
    expect(prices.map((figure) => figure.key)).toEqual([
      'ai.price.ministral-3-14b.awsIn',
      'ai.price.ministral-3-14b.in',
    ]);
    for (const price of prices) expect(price.text, price.key).toBe(store.metricText(price.key));
    // Next to them: the margin, tax at checkout, the AWS source and the date it was checked, the
    // Region, and "Sample prices · nothing is charged", all from PRICING.
    const credits = byId('faq-credits');
    expect(credits).toContain('<span data-metric="ai.price.marginPct">10</span>% margin');
    for (const field of ['regionName', 'tax', 'source', 'note']) {
      expect(credits, field).toContain(
        `data-help-pricing="${field}">${String(store.PRICING[field])}</`,
      );
    }
    expect(credits).toContain(
      `href="${String(store.PRICING.sourceUrl)}" target="_blank" rel="noopener"`,
    );
    expect(credits).toContain('<span data-metric="ai.price.checkedOn">');
    expect(pageScript).toContain('const pricing = store.PRICING;');
    expect(pageScript).toContain("source.setAttribute('href', pricing.sourceUrl);");
    // Round 4's "Pricing isn't set" and every AI run are retired (G3, G4).
    expect(copy).not.toContain("Pricing isn't set");
    expect(copy).not.toMatch(
      // Round 6 part 2 (N3): Get more runs is back, for the one Runs allowance every search uses.
      /\bAI runs?\b|free (?:AI )?runs? a week|run packs?|More AI runs/i,
    );
  });
});

describe('Help: topic cards and answers', () => {
  it('filters the answers with the shared list toolbar and topic cards, not links', () => {
    const toolbar = main.match(/<search\s+class="list-toolbar help-toolbar"[\s\S]*?>/)?.[0] ?? '';
    for (const attribute of [
      'data-list-toolbar',
      'data-list-target="faq-list"',
      'data-list-empty="faq-empty"',
      'data-list-noun="answer"',
      'data-list-nouns="answers"',
    ]) {
      expect(toolbar, attribute).toContain(attribute);
    }
    expect(main).toContain('data-list-search');
    expect(main).toContain('<fieldset class="choice-cards help-topics" data-list-filter="topic">');
    expect(topicCards.map((card) => card.value)).toEqual([
      'start',
      'matches',
      'applications',
      'searches',
      'ai',
      'credits',
      'privacy',
      'access',
      'signin',
    ]);
    for (const card of topicCards) {
      expect(card.type, card.value).toBe('checkbox');
      expect(card.markup, card.value).not.toMatch(/<a\b/);
    }
  });

  it('groups every answer under one topic, with the counts each card shows', () => {
    const values = topicCards.map((card) => card.value);
    const headings = [
      ...main.matchAll(/<h3 class="help-faq-group" data-faq-group="([a-z]+)"/g),
    ].map((match) => match[1]);
    expect(headings).toEqual(values);
    // Round 6: five answers join (Settings, skipping setup, the large demo, Review then
    // auto-apply, and prompt tests), one of them public.
    expect(answers.length).toBe(41);
    for (const answer of answers) expect(values, answer.id).toContain(answer.topic);
    // A card's signed-in count and its public count match the answers each variant keeps.
    for (const card of topicCards) {
      const all = answers.filter((answer) => answer.topic === card.value);
      const open = all.filter((answer) => !answer.signedIn);
      const signedInCount = card.count.match(/<span data-signed-in>(\d+)<\/span>/)?.[1];
      const publicCount = card.count.match(/<span data-public-only>(\d+)<\/span>/)?.[1];
      expect(Number(signedInCount ?? card.count), card.value).toBe(all.length);
      if (publicCount !== undefined) expect(Number(publicCount), card.value).toBe(open.length);
      // A topic with no public answer is signed-in as a whole.
      expect(card.signedIn, card.value).toBe(open.length === 0);
    }
    expect(main).toContain(
      '<p class="list-toolbar-result" data-list-count><span data-signed-in>41 answers</span><span data-public-only>24 answers</span></p>',
    );
    // The page refreshes the shared list and hides a topic's heading once none of its answers show.
    expect(pageScript).toContain('components?.list?.refresh(helpToolbar, options);');
    expect(pageScript).toContain(
      "helpToolbar?.addEventListener('jobdeputy:listchange', syncAnswerGroups);",
    );
    expect(pageScript).toContain('heading.hidden = ![...items].some((item) => !item.hidden);');
    // Show all answers clears the search and the topics, then returns focus to the search.
    expect(pageScript).toMatch(
      /helpClear\?\.addEventListener\('click', \(\) => \{\s*helpQuery\.value = '';[\s\S]*?topic\.checked = false;[\s\S]*?refreshAnswers\(\{ announce: true \}\);\s*helpQuery\.focus\(\);/,
    );
  });

  it('answers what a new person and the owner ask, each at its own anchor', () => {
    expect(Object.fromEntries(answers.map((answer) => [answer.id, answer.question]))).toEqual({
      'faq-how': 'How does JobDeputy work?',
      'faq-apply': 'Does JobDeputy apply for jobs without asking me?',
      'faq-agreement': 'Why do I sign an agreement, and what if a new version comes?',
      'faq-replay': 'How do I replay a tour or change my setup?',
      'faq-skip-setup': 'Can I skip setup and finish it later?',
      'faq-settings': "What's in Settings, and where did things move?",
      'faq-large-demo': 'What does the large account demo show?',
      // Round 7 (J2): Job matches is a review queue.
      'faq-counts': 'What do Roles found, To review, In Applications, and Not for me mean?',
      'faq-fit': 'What do the fit colours mean?',
      'faq-pages': 'Why does Job matches show a page at a time?',
      'faq-stages': 'What do the application stages and colours mean?',
      'faq-approve': 'What does Approve materials mean?',
      'faq-auto-apply': 'What is Review, then auto-apply?',
      'faq-autofill': 'What does the autofill preview submit, and when is the form read?',
      'faq-templates': 'Which résumé template should I use, and how many pages?',
      'faq-default-resume': 'Which résumé does my deputy tailor from?',
      'faq-runs': 'What is a run?',
      'faq-attention': 'Why does a source need attention?',
      'keep-watch': 'What is Keep watch?',
      // Round 6 part 2 (N3): runs.
      'faq-nightly': 'How long do my runs last, and how do I get more?',
      'faq-assist': 'What is Deputy Assist?',
      'faq-ai-setting': 'What runs Deputy Assist, and can one search use a different AI?',
      'faq-models': 'Which models can AI credits use?',
      'faq-keys': 'Can I use my own AI key, and change its model?',
      'faq-limit': 'Can I limit the tokens my own key uses?',
      'faq-prompts': 'Can I see and change the prompts your deputy uses?',
      'faq-prompt-tests': 'How is a new prompt version tested, and when does it roll back?',
      'faq-credits': 'How do AI credits work, and what do they cost?',
      'faq-shop': 'What can I buy in Purchases?',
      'faq-support': 'Can I support JobDeputy, and what do supporters get?',
      'faq-data': 'Where is my data stored?',
      'faq-region': 'Can I change my home Region?',
      'faq-delete': 'How do I delete my account or export my data?',
      'faq-gmail': 'What does your deputy read in my email?',
      'faq-site-accounts':
        "Can my deputy create accounts on employers' sites, and where are the passwords?",
      'faq-self-id': 'Why does Profile ask for self-identification?',
      'faq-motion': 'How do I stop the animations?',
      'faq-access': 'Can I use JobDeputy with a keyboard, a screen reader, or zoom?',
      'faq-forgot': 'What if I forget my password?',
      'faq-sign-in': "Why can't I sign in?",
      'faq-linkedin': 'Can I sign in with LinkedIn, or import my details from it?',
    });
    // A link to one answer opens it, clearing a filter that hides it.
    expect(pageScript).toContain(
      "if (target instanceof HTMLDetailsElement && target.hasAttribute('data-list-item')) {",
    );
    expect(pageScript).toContain('target.open = true;');
    expect(pageScript).toContain("window.addEventListener('hashchange', openLinkedPart);");
    // The answers name what the decisions and the brief promise, in words a person uses.
    const words = (id: string): string =>
      textOf(answers.find((answer) => answer.id === id)?.markup ?? '');
    expect(words('faq-counts')).toMatch(/always add up to Roles found/);
    // Round 6 (T1): the Shop is Purchases.
    expect(words('faq-nightly')).toMatch(
      // UAT-RM-4: the ring and its button left this answer, so Purchases is named as the place.
      /Purchases adds runs by count, in packs or in bundles with AI credits/,
    );
    expect(words('faq-keys')).toMatch(
      /Larger models cost more per token on your key and can use more tokens/,
    );
    expect(words('faq-prompts')).toMatch(/safety rules stay locked/i);
    expect(words('faq-gmail')).toMatch(/read-only/);
    expect(words('faq-gmail')).toMatch(/disconnect it any time/);
    // Round 5 (A3): what is read, never read, never sent, and never kept, as the agreement says.
    expect(words('faq-gmail')).toMatch(
      /It reads One-time sign-in codes from job sites Emails from employers about your applications/,
    );
    expect(words('faq-gmail')).toMatch(
      /It never Reads other email, such as personal messages or newsletters Sends email: you send every reply yourself Keeps a one-time code: it’s shown once, then deleted/,
    );
    expect(words('faq-gmail')).toMatch(
      /your deputy moves it in Applications and tells you, and you can undo the move/,
    );
    expect(words('faq-gmail')).toMatch(
      /draft a reply for you to edit and send from your own email/,
    );
    expect(words('faq-self-id')).toMatch(/never used to rank or filter roles/);
    expect(words('faq-self-id')).toMatch(/Prefer not to say/);
    expect(words('faq-autofill')).toMatch(/exact answers your deputy would submit/);
    expect(words('faq-autofill')).toMatch(
      /when you add a role to Applications, and again just before filling/,
    );
    expect(words('faq-templates')).toMatch(/one-page résumé/);
    expect(words('faq-data')).toMatch(/home Region/);
    expect(words('faq-delete')).toMatch(/Export, a download of everything, is planned for launch/);
    // Round 5 (G1): deleting keeps only the agreements you signed, and a new account signs again.
    expect(words('faq-delete')).toMatch(
      /except the agreements you signed: we keep those permanently, apart from your account, and a new account signs the agreement again/,
    );
    expect(words('faq-motion')).toMatch(/Pause motion/);
    expect(words('keep-watch')).toMatch(/planned for launch/);
    // Round 4: Deputy Assist and its unit, the one AI setting, the token limit on your own key,
    // the Shop and donations, and Job matches pages, in the decisions' words (R4-2, R4-3, R4-5).
    expect(words('faq-assist')).toMatch(
      /^What is Deputy Assist\? Deputy Assist is your deputy's AI work/,
    );
    expect(words('faq-assist')).toMatch(
      // Round 6 part 2 (N3): every search, Keep watch's too, uses runs.
      // Round 7 (R10-9): everything is runs or tokens.
      /It's counted in tokens: on your own key, or on AI credits on our platform\. Each search, Keep watch check, Gmail scan, and daily email is counted in runs\. You can see both over any time in Usage/,
    );
    expect(words('faq-ai-setting')).toMatch(
      /One setting for your account runs every search, Keep watch check, and draft, with one model/,
    );
    // Round 7 (T5-18): what is true, the one-off Run again on AI credits and the fallback named.
    expect(words('faq-ai-setting')).toMatch(
      /There's no separate setting for a source or a task\. A single run differs only when it says so: Run again can use AI credits for that one run, and a key that reaches its limit can fall back to them/,
    );
    expect(words('faq-ai-setting')).toMatch(/Each run keeps what it ran with in its history/);
    expect(words('faq-limit')).toMatch(
      /set an amount of tokens for a day, a week, or a month, counted in UTC/,
    );
    expect(words('faq-limit')).toMatch(
      /Pause AI work until the limit resets, or Use platform credits, so Deputy Assist switches to your AI credits while at least a search's worth is left/,
    );
    expect(words('faq-limit')).toMatch(/A run already going finishes, and its tokens still count/);
    expect(words('faq-shop')).toMatch(
      // Round 6 part 2 (N3): runs for every search.
      /AI credits for Deputy Assist, runs for every search, and bundles of both\. A bundle's discount is on its runs only, so credits always cost the AWS rate plus the margin/,
    );
    expect(words('faq-shop')).toMatch(/Every price is a sample: nothing is charged/);
    expect(words('faq-support')).toMatch(
      /Support isn't open yet\. In Purchases, Support JobDeputy , choose once or monthly/,
    );
    // Round 5 (G1 to G5): the agreement and its pause, the models, credits, site accounts, and
    // LinkedIn, in the agreement's own terms.
    // Round 7 (G3, R10-8): signing is one step, with nothing to type.
    expect(words('faq-agreement')).toMatch(
      /You sign it in one step when you create your account: one sentence, then Sign and continue, as the name on your account, with nothing to type\. You sign each new version the same way, after reading what changed/,
    );
    expect(words('faq-agreement')).not.toMatch(/typing your full name/);
    expect(words('faq-agreement')).toMatch(
      /if a new version still isn’t signed 14 days after it’s published, your deputy’s work pauses until you sign: searches, Keep watch checks, filling in applications, and drafting/,
    );
    expect(words('faq-agreement')).toMatch(
      /Signing in, seeing everything, exporting your data, deleting your account, Help, and signing never pause/,
    );
    expect(words('faq-agreement')).toMatch(
      /We keep every copy you sign permanently, apart from your account/,
    );
    expect(words('faq-models')).toMatch(
      /Three models we tested for your deputy's work, each on Amazon Bedrock in your home Region/,
    );
    expect(words('faq-models')).toMatch(
      /Your account uses one of them for all its work on AI credits, chosen in the same one setting/,
    );
    expect(words('faq-credits')).toMatch(
      /They're prepaid value, shown as tokens on your account's model/,
    );
    expect(words('faq-credits')).toMatch(
      /Free credits are used first, then bonus, then bought ones/,
    );
    expect(words('faq-credits')).toMatch(
      /Credits cost what Amazon Bedrock charges for your model in your home Region, plus a 10 % margin/,
    );
    expect(words('faq-credits')).toMatch(/Your own key never uses credits/);
    expect(words('faq-site-accounts')).toMatch(
      /a strong one your deputy generates \(20 random characters\), or your own \(at least 12 characters, and not a common one\)/,
    );
    expect(words('faq-site-accounts')).toMatch(
      /read from your Gmail, shown once, and never stored/,
    );
    expect(words('faq-site-accounts')).toMatch(
      /each stays hidden until you choose Show, and the vault log records every time one is shown/,
    );
    expect(words('faq-site-accounts')).toMatch(
      /At a CAPTCHA your deputy stops and asks you; it never gets around one/,
    );
    expect(words('faq-linkedin')).toMatch(
      /LinkedIn shares your name, email address, and profile photo with us, and nothing else/,
    );
    expect(words('faq-linkedin')).toMatch(
      /the ZIP file from Settings, Data privacy, Get a copy of your data\) or save your profile as a PDF/,
    );
    expect(words('faq-linkedin')).toMatch(/saves only the ones you choose; the file isn't kept/);
    expect(words('faq-sign-in')).toMatch(/use Continue with Google or Continue with LinkedIn/);
    // Round 7 (R10-6): the shared pagination keeps your place.
    expect(words('faq-pages')).toMatch(
      /Every long list shows where you are \("13 to 24 of 40"\), Previous and Next above and below it, and a page size you choose: 12, 24, or 48\. The page is kept in the address, and changing it brings the list's top into view/,
    );
    expect(words('faq-pages')).toMatch(/Changing the view or a filter starts again on page 1/);
  });
});

describe('Help: figures from the shared sample', () => {
  it('shows each figure once in each variant, with the seed text until the page reads the store', () => {
    const store = seedStore();
    // Each variant is one page: the signed-in Help and the public Help each show a key once.
    for (const [name, html] of [
      ['signed in', signedInMain],
      ['public', publicMain],
    ] as const) {
      const keys = figuresIn(html).map((figure) => figure.key);
      expect(
        keys.filter((key, index) => keys.indexOf(key) !== index),
        name,
      ).toEqual([]);
    }
    expect(figuresIn(signedInMain).length).toBeGreaterThan(35);
    for (const figure of figuresIn(main))
      expect(figure.text, figure.key).toBe(store.metricText(figure.key));
    // The free runs a month: in the public answer, and in the signed-in runs line (N3: one
    // allowance for every search; Keep watch uses one run a source it checks).
    expect(figuresIn(publicMain).map((figure) => figure.key)).toContain('watch.nightly.limit');
    expect(byId('help-runs-line')).toContain('<span data-metric="watch.nightly.limit">10</span>');
    expect(byId('keep-watch')).toMatch(
      /<span data-public-only>You get <span data-metric="watch\.nightly\.limit">10<\/span>\s+free runs a month for every search, and Keep watch<\/span><span data-signed-in>Free\s+runs return every month, and Keep watch<\/span>\s+uses one run for each source it checks\./,
    );
    // The page writes every figure from the store and again after each change.
    expect(pageScript).toContain('setText(element, store.metricText(element.dataset.metric));');
    expect(pageScript).toContain('store?.subscribe(renderFigures);');
  });

  it('names the models, the free credits, and the supporters’ benefits as the store holds them', () => {
    const store = seedStore();
    // The three platform models (models()): each name, Recommended on one, and its speed.
    const models = [...byId('help-models').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) =>
      textOf(match[1] ?? ''),
    );
    expect(models).toEqual(
      store
        .models()
        .map((model) =>
          [model.name, model.recommended ? 'Recommended' : '', model.speed]
            .filter(Boolean)
            .join(' '),
        ),
    );
    expect(pageScript).toContain('const models = store.models?.() ?? [];');
    expect(pageScript).toContain(
      "if (model.recommended) item.append(' ', make('span', 'status-pill', 'Recommended'));",
    );
    // The free credits each month: the plan's (CREDITS), as tokens on the free model.
    expect(byId('faq-credits')).toContain(
      `<span data-help-credits="free">${store.format.tokens(store.CREDITS.freeTokens)}</span>`,
    );
    expect(byId('faq-credits')).toContain(
      `<span data-help-credits="model">${store.models().find((model) => model.id === store.CREDITS.freeModel)?.name}</span>`,
    );
    // The supporters' benefits (support().benefits), all planned, with the store's note.
    const support = store.support();
    expect(support.benefits.every((benefit) => benefit.planned)).toBe(true);
    const benefits = [...byId('help-benefits').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) =>
      textOf(match[1] ?? ''),
    );
    expect(benefits).toEqual(support.benefits.map((benefit) => `${benefit.title} ${benefit.text}`));
    expect(textOf(byId('faq-support'))).toContain(
      'As thanks, supporters can have these benefits, all planned',
    );
    expect(byId('faq-support')).toContain(`<p data-help-support-note>${support.note}</p>`);
    expect(support.note).toMatch(/isn’t tax deductible/);
    expect(pageScript).toContain('const renderBenefits = (support) => {');
  });

  it('names the fit levels and stages with the store’s words and tones', () => {
    const store = seedStore();
    const rows = (attribute: string) =>
      [
        ...main.matchAll(
          new RegExp(`<li data-tone="([a-z]+)" ${attribute}="([a-z]+)">([\\s\\S]*?)</li>`, 'g'),
        ),
      ].map((match) => ({
        tone: match[1],
        id: match[2],
        name: textOf(
          match[3]?.match(/<span class="chart-key-name" data-key-name>([^<]*)</)?.[1] ?? '',
        ),
        meaning: textOf(match[3]?.match(/<span data-key-meaning>([^<]*)</)?.[1] ?? ''),
      }));
    const check = (attribute: string, items: Item[]) => {
      const shown = rows(attribute);
      expect(shown.length).toBeGreaterThan(2);
      for (const row of shown) {
        const item = items.find((entry) => entry.id === row.id);
        expect(item, row.id).toBeDefined();
        expect(row.tone, row.id).toBe(item?.tone);
        expect(row.name, row.id).toBe(item?.label);
        expect(row.meaning, row.id).toBe(item?.meaning.replace(/\.$/, ''));
      }
    };
    check('data-fit', store.FITS);
    for (const match of main.matchAll(
      /data-metric="([^"]+)">(\d+)<\/span><span class="sr-only" data-key-noun>([^<]*)<\/span>/g,
    )) {
      const [, key, count, noun] = match;
      expect(noun, key).toBe(count === '1' ? ' role.' : ' roles.');
      expect(count, key).toBe(store.metricText(key ?? ''));
    }
    expect(main.match(/data-key-noun/g)).toHaveLength(9);
    expect(pageScript).toContain(
      "setText(row.querySelector('[data-key-noun]'), count === '1' ? ' role.' : ' roles.');",
    );
    // Closed has no tone: it stays out of the active key and is named in words.
    check(
      'data-stage',
      store.STAGES.filter((stage) => stage.tone),
    );
    expect(pageScript).toContain("['[data-fit]', store.FITS ?? []],");
    expect(pageScript).toContain("['[data-stage]', store.STAGES ?? []],");
  });
});

describe('Help: Your agreements (round 5, G1 and H1; round 6 part 2, P-6)', () => {
  const section = byId('agreements');
  const consents = ['read', 'act', 'keep'];

  it('keeps a short card that says where your agreements are, with the version waiting and its pause date', () => {
    // Round 6 part 2 (P-6): the home is Settings, Account #agreements (what changed, the
    // reminders, what pauses and never does, Sign now, and every copy you signed, to view and
    // download). Help keeps one card, and trust-preview.html#agreements still lands on it.
    const store = seedStore();
    const pending = store.agreements().pending;
    expect(section).toMatch(
      /^<section\s+class="task-surface"\s+id="agreements"\s+aria-labelledby="agreements-title"\s+data-signed-in\b/,
    );
    expect(section).toContain(
      '<h2 id="agreements-title">Your agreements are in Settings, Account.</h2>',
    );
    // One line: the version waiting and when your deputy's work would pause.
    expect(pending).toMatchObject({ version: '2026.10', daysLeft: 13 });
    expect(textOf(byId('agreements-line'))).toContain(
      'Version 2026.10 waits for your signature; your deputy’s work pauses on Thu, Oct 15 if it isn’t signed.',
    );
    expect(figuresIn(section).map((figure) => figure.key)).toEqual(['agreement.pauseAt']);
    expect(store.metricText('agreement.pauseAt')).toBe('Thu, Oct 15');
    // Review and sign comes back here; the link opens the home.
    expect(section).toContain(
      '<a class="primary-action" id="agreements-sign" href="./agreement-preview.html?mode=update&amp;return=trust-preview.html%23agreements">Review and sign<span class="sr-only"> version <span data-agreements-version>2026.10</span></span></a>',
    );
    expect(section).toContain(
      '<a class="compact-action" id="agreements-open" href="./account-preview.html#agreements">Open your agreements</a>',
    );
    // The full block left: no reminders timeline, copies, or what pauses here.
    expect(section).not.toMatch(
      /agreements-copies|agreements-reminders|data-agreements-list|Copies you signed/,
    );
    expect(pageScript).not.toMatch(/downloadMenu\(|signedCopyOf|agreementsCopies/);
    for (const part of [
      "const state = !pending ? 'signed' : pending.overdue ? 'overdue' : 'pending';",
      'part.hidden = part.dataset.helpAgreement !== state;',
      "const href = withReturn(pending?.href ?? './agreement-preview.html?mode=update');",
    ]) {
      expect(pageScript, part).toContain(part);
    }
    // Once 2026.10 is signed, the card says so and Review and sign leaves.
    expect(store.signAgreement({ version: '2026.10', name: 'Alex Morgan', consents }).ok).toBe(
      true,
    );
    expect(store.agreements().pending).toBeNull();
    // The signed line names the version (round 5's Help did); the version is its own span.
    expect(textOf(section)).toMatch(
      /You signed the current version, 2026\.10 ?\. Every copy you signed is kept for good\./,
    );
    expect(pageScript).toContain('sign.hidden = !pending;');
    // Links that named Help's block now open the home in Account.
    expect(byId('faq-agreement')).toContain(
      '<a href="./account-preview.html#agreements">Settings, Account</a>',
    );
    expect(byId('help-overdue')).toContain(
      '<a href="./account-preview.html#agreements">your agreements in Account</a>',
    );
  });

  it('shows the overdue state in Demos and ends it, and once signed says there is nothing to show', () => {
    const store = seedStore();
    const demo = byId('help-overdue');
    expect(byId('demos')).toContain('<div class="help-setup help-overdue" id="help-overdue">');
    expect(demo).toContain(
      '<button class="compact-action" id="help-overdue-toggle" type="button" aria-describedby="help-overdue-copy">See the overdue state</button>',
    );
    // The reason a disabled button can't be used is in words beside it (R5-4).
    expect(textOf(demo)).toContain(
      'The current version is signed, so nothing is overdue. Reset sample data to see this again.',
    );
    for (const part of [
      "const result = store.setAgreementDemo?.(showing ? null : 'overdue');",
      "setText(overdueToggle, state === 'on' ? 'End the overdue demo' : 'See the overdue state');",
      "overdueToggle.disabled = !available || state === 'signed';",
      "announceTo(agreementsAnnouncement, 'Showing the overdue state: your deputy is paused until you sign.');",
      "announceTo(agreementsAnnouncement, 'The overdue demo ended. Your deputy is working again.');",
    ]) {
      expect(pageScript, part).toContain(part);
    }
    // The store's demo: paused without moving the clock, work refused, then ended by the button
    // or by signing; with nothing pending there is nothing to show.
    const on = store.setAgreementDemo('overdue');
    expect(on).toMatchObject({ paused: true, demo: true });
    expect(on?.pending).toMatchObject({ overdue: true, daysLeft: 0, remindersSent: 5 });
    expect(store.startRun('microsoft')).toMatchObject({ ok: false, reason: 'agreement-required' });
    expect(store.setAgreementDemo(null)?.paused).toBe(false);
    store.setAgreementDemo('overdue');
    expect(store.signAgreement({ version: '2026.10', name: 'Alex Morgan', consents }).ok).toBe(
      true,
    );
    expect(store.agreements()).toMatchObject({ paused: false, demo: false, pending: null });
    expect(store.setAgreementDemo('overdue')).toBeNull();
  });
});

describe('Help: Demos', () => {
  const pages: Array<[string, string, string]> = [
    ['dashboard', 'home-preview.html', './home-preview.html?skipLoader&amp;tour=1'],
    ['searches', 'searches-preview.html', './searches-preview.html?tour=1'],
    ['jobs', 'jobs-preview.html', './jobs-preview.html?tour=1'],
    ['applications', 'applications-preview.html', './applications-preview.html?tour=1'],
    ['resumes', 'documents-preview.html', './documents-preview.html?tour=1'],
    ['materials', 'materials-preview.html', './materials-preview.html?app=search-infra&amp;tour=1'],
    ['profile', 'profile-preview.html', './profile-preview.html?tour=1'],
    // Round 6 (T1, R6-3): the new Settings tabs and Invite friends have tours too.
    ['account', 'account-preview.html', './account-preview.html?tour=1'],
    ['connections', 'connections-preview.html', './connections-preview.html?tour=1'],
    ['prompts', 'prompts-preview.html', './prompts-preview.html?tour=1'],
    ['ai-credits', 'ai-preview.html', './ai-preview.html?tour=1'],
    // Round 7: the Usage and Activity tabs have tours.
    ['usage', 'usage-preview.html', './usage-preview.html?tour=1'],
    ['shop', 'shop-preview.html', './shop-preview.html?tour=1'],
    ['activity', 'activity-preview.html', './activity-preview.html?tour=1'],
    ['invite', 'invite-preview.html', './invite-preview.html?tour=1'],
  ];
  const demos = elementsWith(byId('demos'), 'data-demo');

  it('lists every page’s tour with what it shows and a start link', () => {
    expect(byId('demos')).toMatch(/^<section[^>]*\sdata-signed-in\b/);
    expect(demos.map((demo) => demo.match(/data-demo="([^"]+)"/)?.[1])).toEqual(
      pages.map(([key]) => key),
    );
    demos.forEach((demo, index) => {
      const [key, file, href] = pages[index] ?? ['', '', ''];
      // The key is the page's own tour name: its DeputyDock's data-deputy-page.
      expect(sourceFor(file), key).toContain(`data-deputy-page="${key}"`);
      expect(demo, key).toContain(`href="${href}"`);
      const title = textOf(demo.match(/<h3 class="help-demo-title">([\s\S]*?)<\/h3>/)?.[1] ?? '');
      expect(
        textOf(
          demo.match(/<a class="compact-action help-demo-start"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '',
        ),
      ).toBe(`Start the ${title} tour`);
      expect(
        textOf(demo.match(/<p class="help-demo-about">([\s\S]*?)<\/p>/)?.[1] ?? '').length,
      ).toBeGreaterThan(20);
      // No step count: tours change length with the width and with their page's work.
      expect(textOf(demo), key).not.toMatch(/\d+\s*steps?\b/i);
      expect(demo, key).toContain('<span class="status-pill" data-demo-seen hidden>Seen</span>');
    });
    expect(pageScript).toContain('const seen = Boolean(store.tourSeen?.(demo.dataset.demo));');
    // UAT-M-11 (round 6 part 2): each description says what its page holds now: Profile without
    // Gmail or Keep watch (P-1, T1); AI & credits without prompts, runs, or prices (T1, P-2,
    // P-10); Purchases with runs and How prices are made.
    const about = (key: string) =>
      textOf(
        demos
          .find((demo) => demo.includes(`data-demo="${key}"`))
          ?.match(/<p class="help-demo-about">([\s\S]*?)<\/p>/)?.[1] ?? '',
      );
    expect(about('profile')).not.toMatch(/Gmail|Keep watch/);
    expect(about('ai-credits')).not.toMatch(/prompt|runs|price/i);
    expect(about('shop')).toBe(
      // Round 7 (SE3): balances first, one quick buy, the fold, and every receipt.
      'Your balances, one quick buy, how prices are made, and every receipt.',
    );
    expect(about('prompts')).toMatch(/test scores/);
    for (const demo of demos) expect(textOf(demo)).not.toMatch(/nightly runs?/i);
    expect(byId('demos')).toContain(
      '<a class="compact-action" href="./onboarding-preview.html?rerun=1">Run setup again</a>',
    );
  });
});

describe('Help: Contact', () => {
  const contact = byId('contact');

  it('offers one Contact section with two paths: Feedback and a support request', () => {
    // Both paths sit side by side in one section; neither repeats the other.
    const paths = contact.match(/<div class="help-paths" data-signed-in>[\s\S]*$/)?.[0] ?? '';
    const feedback = paths.match(/<button\b([^>]*)>\s*Send feedback\s*<\/button>/);
    expect(feedback?.[1]).toContain('data-feedback-open');
    expect(feedback?.[1]).toContain('aria-haspopup="dialog"');
    expect(paths).toMatch(
      /<section class="help-path help-path-request" id="contact-form" aria-labelledby="help-path-request">[\s\S]*?<h3 id="help-path-request">Get help with a problem<\/h3>[\s\S]*?<form class="support-form" id="support-form" novalidate>/,
    );
    // The request stays in view (no disclosure), with its primary action.
    expect(byId('contact-form')).not.toMatch(/^<[^>]*\shidden\b/);
    expect(contact).toMatch(
      /<button class="primary-action support-submit" type="submit">\s*Prepare support request\s*<\/button>/,
    );
    expect(main).not.toContain('id="support-open"');
    // The page's only feedback trigger outside the shell is this one.
    expect(main.match(/data-feedback-open/g)).toHaveLength(1);
    // A short message gets FieldFeedback beside the field, not the browser's bubble.
    expect(contact).toContain('id="support-message-error" hidden');
    expect(pageScript).toContain("supportMessage.setAttribute('aria-invalid', String(invalid));");
    expect(pageScript).not.toContain('reportValidity');
    // #contact-form (the empty answers' Ask for help) lands on the request and its first field.
    expect(main).toContain(
      '<a class="compact-action" href="#contact-form" data-signed-in>Ask for help</a>',
    );
    expect(pageScript).toContain('supportTopic.focus({ preventScroll: true });');
    // The deputy answers the request honestly: nothing leaves the browser.
    expect(pageScript).toContain(
      "deputy?.react('sent', { speech: 'Prepared. Nothing was sent.' });",
    );
    expect(textOf(contact)).toMatch(/Prototype only: nothing is sent/);
  });
});

describe('Help: the public variant (?public)', () => {
  const publicBlock = pageScript.match(/if \(publicView\) \{([\s\S]*?)\n {6}\}/)?.[1] ?? '';

  it('decides the variant before the body is parsed, so nothing signed-in flashes', () => {
    expect(trust.indexOf('<script>')).toBeLessThan(trust.indexOf('</head>'));
    expect(headScript).toContain("root.dataset.helpView = publicVisit ? 'public' : 'signed-in';");
    expect(styles).toMatch(
      /html\[data-help-view="public"\] \[data-signed-in\],\s*html\[data-help-view="public"\] \.agreement-banner,\s*html:not\(\[data-help-view="public"\]\) \[data-public-only\] \{[\s\S]*?display: none !important;/,
    );
    // Run the head script on a stand-in document: the observer hides the shell's signed-in parts
    // as the parser adds them, and shows Back with the entry route's address.
    const root = { dataset: {} as Record<string, string> };
    let observe: ((records: Array<{ addedNodes: unknown[] }>) => void) | undefined;
    class Element {
      hidden = false;
      href = '';
      attributes: Record<string, string> = {};
      constructor(
        readonly id: string,
        readonly selectors: string[],
      ) {}
      matches(list: string) {
        return list.split(',').some((selector) => this.selectors.includes(selector.trim()));
      }
      querySelectorAll() {
        return [];
      }
      setAttribute(name: string, value: string) {
        this.attributes[name] = value;
      }
    }
    runInNewContext(headScript, {
      window: { location: { search: '?public&from=set' } },
      URLSearchParams,
      Map,
      Element,
      document: { documentElement: root, addEventListener: () => {} },
      MutationObserver: class {
        constructor(callback: (records: Array<{ addedNodes: unknown[] }>) => void) {
          observe = callback;
        }
        observe() {}
        disconnect() {}
      },
    });
    expect(root.dataset).toMatchObject({
      helpView: 'public',
      helpBack: './access-preview.html?mode=set&skipLoader',
      helpBackLabel: '← Choose new password',
    });
    const parts = [
      new Element('', ['.header-feedback']),
      new Element('', ['.header-invite']),
      new Element('', ['.account-menu']),
      new Element('app-sidebar', ['#app-sidebar']),
      new Element('signed-in-footer-row', ['#signed-in-footer-row']),
      new Element('', ['.footer-secondary > span:first-child']),
    ];
    const back = new Element('trust-back', []);
    back.hidden = true;
    // The logo: on a signed-out visit it leads back to the entry route, never into the app.
    const brand = new Element('', ['.app-header .brand']);
    brand.href = './home-preview.html?skipLoader';
    observe?.([{ addedNodes: [...parts, back, brand] }]);
    expect(parts.map((part) => part.hidden)).toEqual(parts.map(() => true));
    expect(back.hidden).toBe(false);
    expect(back.href).toBe('./access-preview.html?mode=set&skipLoader');
    expect(brand.href).toBe('./access-preview.html?mode=set&skipLoader');
    expect(brand.attributes['aria-label']).toBe('JobDeputy, Choose new password');
    expect(brand.hidden).toBe(false);
  });

  it('takes the Region the visitor came with back to the entry route (round 6 part 3, T1-8)', () => {
    // ?region= on the way in (the entry pages add it once a Region is chosen by hand) comes back
    // on Back and on the logo; the new-password step has no Region to choose, so it takes none.
    const backFor = (search: string): string => {
      const root = { dataset: {} as Record<string, string> };
      runInNewContext(headScript, {
        window: { location: { search } },
        URLSearchParams,
        Map,
        Element: class {},
        document: { documentElement: root, addEventListener: () => {} },
        MutationObserver: class {
          observe() {}
          disconnect() {}
        },
      });
      return root.dataset.helpBack ?? '';
    };
    expect(backFor('?public&from=login&region=uk')).toBe(
      './login-preview.html?skipLoader&region=uk',
    );
    expect(backFor('?public&from=create&region=in')).toBe(
      './access-preview.html?mode=create&skipLoader&region=in',
    );
    expect(backFor('?public&from=reset&region=us')).toBe(
      './access-preview.html?mode=reset&skipLoader&region=us',
    );
    expect(backFor('?public&from=set&region=uk')).toBe('./access-preview.html?mode=set&skipLoader');
    expect(backFor('?public&from=login&region=mars')).toBe('./login-preview.html?skipLoader');
    expect(backFor('?public')).toBe('./login-preview.html?skipLoader');
  });

  it('keeps only public content: no reset, setup, feedback, support request, demos, or account', () => {
    // The shell's signed-in parts go, and every signed-in part of main leaves the page.
    for (const part of [
      'appSidebar.hidden = true;',
      'trustBack.hidden = false;',
      'accountMenu.hidden = true;',
      'signedInFooterRow.hidden = true;',
      'footerRegion.hidden = true;',
      'for (const action of headerActions) action.hidden = true;',
      "for (const part of document.querySelectorAll('main [data-signed-in]')) part.remove();",
      // Any link left that would open a signed-in page goes back to the entry route.
      "for (const link of document.querySelectorAll('a[href]')) {",
      "const publicHelp = file === 'trust-preview.html' && target.searchParams.has('public');",
      "const entry = ['login-preview.html', 'access-preview.html'].includes(file);",
      'link.href = backHref;',
    ]) {
      expect(publicBlock, part).toContain(part);
    }
    for (const id of ['demos', 'sample-data']) {
      expect(byId(id), id).toMatch(/^<[a-z]+[^>]*\sdata-signed-in\b/);
    }
    // Both Contact paths, the support request included, are signed-in.
    expect(contact()).toMatch(/<div class="help-paths" data-signed-in>[\s\S]*?id="contact-form"/);
    // What stays: the public answers, Privacy, Security, Accessibility, and help signing in.
    const open = answers.filter((answer) => !answer.signedIn).map((answer) => answer.id);
    expect(open).toEqual([
      'faq-how',
      'faq-apply',
      'faq-agreement',
      'faq-runs',
      'keep-watch',
      'faq-assist',
      'faq-ai-setting',
      'faq-models',
      'faq-keys',
      'faq-limit',
      'faq-prompts',
      'faq-prompt-tests',
      'faq-credits',
      'faq-data',
      'faq-region',
      'faq-delete',
      'faq-gmail',
      'faq-site-accounts',
      'faq-self-id',
      'faq-motion',
      'faq-access',
      'faq-forgot',
      'faq-sign-in',
      'faq-linkedin',
    ]);
    // Your agreements, the overdue demo, Buy credits, and the Shop and support answers are the
    // account's; so is the shell's pause banner, which the public variant never shows.
    for (const id of ['agreements', 'faq-shop', 'faq-support']) {
      expect(byId(id), id).toMatch(/^<[a-z]+[^>]*\sdata-signed-in\b/);
    }
    expect(publicMain).not.toContain('data-topup-open');
    expect(publicMain).not.toContain('id="help-overdue"');
    expect(styles).toMatch(
      /html\[data-help-view="public"\] \[data-signed-in\],\s*html\[data-help-view="public"\] \.agreement-banner,/,
    );
    for (const id of ['privacy', 'security', 'accessibility']) {
      expect(byId(id), id).not.toMatch(/^<[a-z]+[^>]*\sdata-signed-in\b/);
    }
    expect(contact()).toMatch(
      /<div data-public-only>\s*<p class="section-copy">Sign in to send feedback or get help with your searches\.<\/p>/,
    );
    // Signing in is the public Help's one primary action.
    expect(contact()).toContain(
      '<a class="primary-action" href="./login-preview.html?skipLoader">Sign in</a>',
    );
    // The only figures a signed-out visitor sees are the plan's limits, never the sample account's.
    // main without its signed-in parts, as the public variant leaves it.
    const publicFigures = (html: string): string[] => {
      let rest = html;
      for (let at = rest.search(/<[a-z0-9]+\b[^>]*\sdata-signed-in\b/); at >= 0; ) {
        rest = rest.slice(0, at) + rest.slice(at + elementAt(rest, at).length);
        at = rest.search(/<[a-z0-9]+\b[^>]*\sdata-signed-in\b/);
      }
      return [...rest.matchAll(/data-metric="([^"]+)"/g)].map((match) => match[1] ?? '');
    };
    expect(publicFigures(main)).toEqual([
      'watch.nightly.limit',
      'prompts.total',
      'ai.price.marginPct',
      'ai.price.ministral-3-14b.awsIn',
      'ai.price.ministral-3-14b.in',
      'ai.price.checkedOn',
    ]);
  });

  function contact(): string {
    return byId('contact');
  }
});

describe('Help: round 6 (G7, G8, T1, R6-2, R6-3)', () => {
  it('opens with the shared page intro, with Take the tour at its end (R6-3)', () => {
    const intro =
      main.match(/<section class="page-intro trust-intro"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(intro).toMatch(
      /^<section class="page-intro trust-intro" aria-labelledby="trust-title">\s*<div class="page-intro-copy">\s*<p class="eyebrow">Help &amp; support<\/p>\s*<h1 id="trust-title">/,
    );
    expect(intro).toMatch(
      /<div class="page-intro-actions">\s*<button type="button" class="secondary-action page-tour" data-tour-open hidden>Take the tour<\/button>\s*<\/div>\s*<\/section>$/,
    );
    expect(textOf(intro)).toContain(
      'Find an answer, read a guide, replay a tour, or tell us where something stopped.',
    );
    // The page's own intro width rule is gone, so the button sits at the row's end.
    expect(styles).not.toMatch(/\.trust-intro\s*\{|\.page-intro|\.page-tour/);
  });

  it('gives a five-step tour in the deputy’s first person, signed in only (R6-2)', () => {
    const steps = [
      ...main.matchAll(
        /<section\s+class="task-surface"\s+id="([\w-]+)"[^>]*?\sdata-tour-step="(\d+)"\s+data-tour-title="([^"]+)"\s+data-tour-text="([^"]+)"/g,
      ),
    ].map((match) => ({
      id: match[1],
      step: Number(match[2]),
      title: match[3] ?? '',
      text: match[4] ?? '',
    }));
    expect(steps.map(({ id, step, title }) => [id, step, title])).toEqual([
      ['help', 1, 'Ask me anything here.'],
      ['guides', 2, 'I explain what’s new here.'],
      // Round 6 part 2 (P-6): the agreements' home is Account, and Help's card says so.
      ['agreements', 3, 'Your agreements are in Account.'],
      ['demos', 4, 'Watch me show each page.'],
      ['sample-data', 5, 'Start the sample over.'],
    ]);
    for (const { title, text } of steps) {
      expect(title.split(/\s+/).length, title).toBeLessThanOrEqual(6);
      expect(`${title} ${text}`, title).toMatch(/\b(?:I|me|my)\b/);
      expect(`${title} ${text}`).not.toMatch(/[–—]/);
    }
    // A signed-out visit has no tour: the public branch drops every step.
    const publicBlock = pageScript.match(/if \(publicView\) \{([\s\S]*?)\n {6}\}/)?.[1] ?? '';
    expect(publicBlock).toContain(
      "for (const step of document.querySelectorAll('main [data-tour-step]')) {",
    );
    expect(publicBlock).toContain("step.removeAttribute('data-tour-step');");
    expect(pageScript).not.toMatch(/tour\.start|maybeStart/);
  });

  it('lists every guide from guides(), and opens one as an article from ?guide= (G8)', () => {
    const guides = byId('guides');
    expect(guides).toMatch(
      /^<section\s+class="task-surface"\s+id="guides"\s+aria-labelledby="guides-title"\s+data-help-guides\b/,
    );
    expect(guides).not.toMatch(/^<section[^>]*\sdata-signed-in\b/);
    expect(guides).toContain('<h2 id="guides-title">How the new things work.</h2>');
    expect(guides).toContain(
      '<ol class="help-guides" id="help-guides" aria-label="Guides, newest first"></ol>',
    );
    // The article: what changed, why it matters, the numbered steps, Try it, Back to all guides.
    const article = byId('guide-article');
    expect(article).toMatch(
      /^<article class="help-guide" id="guide-article" aria-labelledby="guide-article-title" tabindex="-1" hidden>/,
    );
    for (const field of ['dateText', 'title', 'summary', 'whatChanged', 'whyItMatters']) {
      expect(article, field).toContain(`data-guide-field="${field}"`);
    }
    expect(textOf(article)).toContain('What changed Why it matters How to do it');
    expect(article).toContain('<ol class="help-guide-steps" id="guide-article-steps"></ol>');
    expect(article).toContain('<a class="primary-action" id="guide-article-try"');
    expect(article).toContain(
      '<a class="compact-action" id="guide-article-back" href="./trust-preview.html#guides">Back to all guides</a>',
    );
    // Every word is the store's, as text; the first six, then See all.
    expect(pageScript).toContain(
      "all = typeof store?.guides === 'function' ? (store.guides() ?? []) : [];",
    );
    expect(pageScript).toContain("const wantedGuide = pageParameters.get('guide');");
    expect(pageScript).toContain('const GUIDES_FIRST = 6;');
    expect(pageScript).toContain("setText(field, String(open[field.dataset.guideField] ?? ''));");
    // Only the app's own pages become Try it links.
    expect(pageScript).toContain(String.raw`/^\.\/[\w-]+\.html(?:[?#][^\s"'<>]*)?$/`);
    // Public Help lists only the guides marked public; with none, the section and its link go.
    expect(pageScript).toContain('(!publicView || guide.public === true)');
    expect(pageScript).toContain('guidesSection.hidden = none;');
    expect(main).toContain(
      '<a class="compact-action" href="#guides" data-help-guides-link>Guides</a>',
    );
    // The store's guides have what the article shows (A2's contract, G8).
    const store = seedStore() as unknown as SampleStore & {
      guides(): Array<Record<string, unknown>>;
      guide(id: string): Record<string, unknown> | null;
    };
    const list = store.guides();
    expect(list.length).toBeGreaterThan(0);
    for (const guide of list) {
      for (const field of ['id', 'title', 'summary', 'dateText', 'whatChanged', 'whyItMatters']) {
        expect(typeof guide[field], `${String(guide.id)} ${field}`).toBe('string');
      }
      expect(Array.isArray(guide.steps)).toBe(true);
      expect(String((guide.tryIt as { href?: string })?.href)).toMatch(/^\.\/[\w-]+\.html/);
      expect(String(guide.href)).toBe(`./trust-preview.html?guide=${String(guide.id)}#guides`);
    }
    expect(store.guide('nope')).toBeNull();
    // Each guide's honest label shows in its article, in place of the section's note.
    expect(article).toContain('<p class="sample-note" data-guide-field="note"></p>');
    for (const guide of list) expect(String(guide.note), String(guide.id)).toMatch(/\S/);
    expect(pageScript).toContain('if (sectionNote) sectionNote.hidden = Boolean(open);');
    // Public Help lists the guides a visitor can read without an account (B8's request to A2).
    expect(list.filter((guide) => guide.public === true).map((guide) => guide.id)).toEqual([
      'credits-at-aws-prices',
      'linkedin-import',
    ]);
    expect(byId('guide-missing')).toContain('That guide isn’t here. Here is every guide.');
  });

  it('shows the large account demo in Demos, and Back to the usual sample (G7)', () => {
    const row = byId('help-scale');
    expect(row).toMatch(/^<div class="help-setup help-scale" id="help-scale" hidden>/);
    expect(row).toContain(
      '<button class="compact-action" id="help-scale-toggle" type="button" aria-describedby="help-scale-copy">See a large account</button>',
    );
    expect(textOf(row)).toContain(
      'Every chart shows its top five plus Other, and long lists open with See all.',
    );
    expect(textOf(row)).toContain('Back to the usual sample returns yours, as you left it.');
    // The sizes are the store's, and the same button returns to the usual sample.
    expect(row).toContain('<span data-help-scale-sizes></span>');
    expect(pageScript).toContain('store.SCALE_DEMOS?.large?.sizes');
    expect(pageScript).toContain("store.setScaleDemo(on ? null : 'large');");
    expect(pageScript).toContain(
      "setText(scaleToggle, on ? 'Back to the usual sample' : 'See a large account');",
    );
    // T5-9 (round 6 part 3): the state shows on Help itself, not only to a screen reader: the
    // visible line swaps with the button, both ways, and on every render (so after a reload too).
    expect(row).toContain(
      '<span data-help-scale="on" hidden>Showing the large account on every page.',
    );
    expect(pageScript).toContain("part.hidden = (part.dataset.helpScale === 'on') !== on;");
    expect(pageScript).toMatch(/renderGuides\(\);\s*renderScale\(\);/);
    // Every round 5 demo stays.
    expect(byId('demos')).toContain('id="help-overdue"');
    expect(byId('demos')).toContain('href="./onboarding-preview.html?rerun=1"');
  });

  it('answers what round 6 changes, with the rollout rule from the store', () => {
    const words = (id: string): string =>
      textOf(answers.find((answer) => answer.id === id)?.markup ?? '');
    expect(words('faq-settings')).toMatch(
      // Round 7: seven tabs, with Usage and Activity.
      /Settings has seven tabs, each its own page: Account .* Connections .* Prompts .* AI & credits .* Usage .* Purchases .* and Activity \(everything you, your deputy, and JobDeputy did\)/,
    );
    expect(words('faq-settings')).toMatch(/Old links still open the right place/);
    expect(words('faq-skip-setup')).toMatch(/Your deputy adds each step you skipped to your To-do/);
    expect(words('faq-large-demo')).toMatch(/Charts show their top five plus Other/);
    expect(words('faq-auto-apply')).toMatch(
      /You approve each one in a single step, then your deputy applies in the background within your rules/,
    );
    expect(words('faq-auto-apply')).toMatch(/Auto-approve rules come set up but off/);
    expect(words('faq-auto-apply')).toMatch(
      /Planned for launch, Phase 2: nothing is sent in this prototype/,
    );
    // Round 7 (D3): the daily scan over the last 48 hours, and Scan now, each one run.
    expect(words('faq-gmail')).toMatch(
      /your deputy scans it once a day, at 07:00 your time, over the last 48 hours of mail, and Scan now reads what came since\. Each scan uses one run/,
    );
    expect(words('faq-prompt-tests')).toMatch(
      /replays the version on your last 40 decisions, scores how often it agrees with what you decided \(its Test score\)/,
    );
    expect(words('faq-prompt-tests')).toMatch(
      // Round 6 part 2 (P-14): the measure is Kept by you.
      /tried on 20 % of runs for 3 days first\. Then Kept by you \(of what it produced in real use, the share you kept\) decides: below 80 %, or more than 5 points below the version in use/,
    );
    // R9-8 and R9-9 (round 6 part 3): one fail rule on Test score only, and a failed test is never
    // a rollback: the version in use stays, and only a trial or in-use version is rolled back.
    expect(words('faq-prompt-tests')).toMatch(
      /It fails if its Test score is below 80 %, or more than 5 points below the Test score of the version in use\. A version that fails never goes live: it reads Did not pass, with the reason, and the version in use stays\./,
    );
    expect(words('faq-prompt-tests')).toMatch(
      /Only a version on trial or in use is ever rolled back, by these rules or by you\./,
    );
    expect(words('faq-prompt-tests')).not.toMatch(/fails is rolled back|version before/);
    // The seed's words are the system default, and the page fills in the store's rule.
    const store = seedStore() as unknown as SampleStore & {
      rolloutSettings(): Record<string, unknown> & { systemDefault?: Record<string, unknown> };
    };
    const rule = store.rolloutSettings();
    expect([
      rule.canarySharePct,
      rule.canaryDays,
      rule.minAgreementPct,
      rule.maxDropPoints,
    ]).toEqual([20, 3, 80, 5]);
    expect(pageScript).toContain(
      'const rule = publicView ? (settings?.systemDefault ?? settings) : settings;',
    );
    // What moved out of Profile is linked at its new home (T1).
    expect(main).not.toMatch(
      /profile-preview\.html#(?:gmail|site-accounts|linkedin|account|applying)/,
    );
    expect(byId('faq-delete')).toContain('<a href="./account-preview.html">Settings, Account</a>');
    expect(byId('faq-gmail')).toContain(
      '<a href="./connections-preview.html#gmail">Settings, Connections</a>',
    );
    expect(byId('faq-site-accounts')).toContain(
      '<a href="./connections-preview.html#site-accounts">Settings, Connections</a>',
    );
    expect(byId('faq-linkedin')).toContain(
      '<a href="./connections-preview.html#linkedin">Import from LinkedIn</a>',
    );
    // Round 6 part 2 (P-10): one How prices are made, in Purchases.
    expect(byId('faq-credits')).toContain(
      '<a class="compact-action" href="./shop-preview.html#prices">How prices are made</a>',
    );
    expect(main).not.toContain('ai-preview.html#prices');
    expect(textOf(main)).not.toMatch(/\bthe Shop\b(?!\))|Shop &/);
  });
});

describe('Help: Reset sample data', () => {
  it('resets the shared sample data locally and says so', () => {
    expect(byId('sample-data')).toMatch(/^<section[^>]*\sdata-signed-in\b/);
    expect(pageScript).toContain('store?.reset();');
    // reset() puts the one AI setting back itself (R4-2): the page never writes its key.
    expect(pageScript).not.toContain('jobdeputy-ai-source');
    expect(pageScript).toContain("window.sessionStorage.removeItem('jobdeputy.onboarding');");
    expect(pageScript).toContain("window.localStorage.removeItem('jobdeputy.lastAccount');");
    expect(pageScript).toContain(
      "announceTo(sampleAnnouncement, 'Sample data reset. Nothing was sent.');",
    );
    expect(pageScript).toContain(
      "deputy?.set('pending', { working: true, duty: 'Resetting', speech: 'Restoring the sample now.' });",
    );
    expect(pageScript).toContain("deputy?.react('saved', { speech: 'I restored the sample.' });");
    // The summary's figures are the store's, one key each.
    const summary = [...byId('sample-stats').matchAll(/data-metric="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(summary).toEqual([
      'apps.tracked',
      'runs.total',
      'tours.seen',
      'prompts.customized',
      'shop.purchases',
      'agreements.signed',
    ]);
    // T6-R5 (round 6 part 3): the prompts figure says what it counts, in Settings, Prompts' words
    // (a version of yours in use), so it reconciles with that page.
    expect(byId('sample-stats')).toMatch(
      /<dt class="stat-label">Prompts with your version in use<\/dt>\s*<dd class="stat-figure" data-metric="prompts.customized">/,
    );
    // Round 5: the prompt guard and the agreement's text load before the store (the orchestrator's
    // script tags), so saved prompts are checked and the signed copies have their text.
    const scripts = [
      'app-shell.js',
      'app-components.js',
      'prompt-guard.js',
      'agreement-text.js',
      'sample-store.js',
      'deputy.js',
      'feedback.js',
      'app-panels.js',
    ].map((name) => trust.indexOf(`<script src="./${name}"></script>`));
    expect([...scripts].sort((a, b) => a - b)).toEqual(scripts);
    expect(scripts[0]).toBeGreaterThan(-1);
  });

  it('puts runs, tours, prompts, purchases, the agreement, and Gmail back with everything else', () => {
    const store = seedStore();
    // What a reset puts back, in the page's words (round 5 adds the platform model, purchases, the
    // supporters list, the agreement signed here and the demo, prompt versions, What's new,
    // site accounts, LinkedIn imports, and email updates).
    expect(textOf(byId('sample-data'))).toMatch(
      /the AI setting, the platform model, and your key's token limit; what you bought, your Support JobDeputy interest, and the supporters list; the agreement you signed here and the overdue demo \(the sample's own signed copy stays\); prompts, their versions, tests, and rollbacks; how your deputy applies and your approvals; What's new; tours; Gmail, site accounts, LinkedIn imports, and email updates;/,
    );
    // Round 6 (G4, S1, A1, G7): the steps you skipped, prompt tests and rollbacks, how your
    // deputy applies, and which sample a reset puts back in the large account demo.
    expect(textOf(byId('sample-data'))).toMatch(
      /the setup checklist and the steps you skipped,[\s\S]*In the large account demo, a reset puts back the large sample; Back to the usual sample, in Demos, returns yours\./,
    );
    const keys = [
      'apps.tracked',
      'tours.seen',
      'prompts.customized',
      'watch.nightly.left',
      'ai.credits.bought',
      'ai.model.name',
      'shop.purchases',
      'agreements.signed',
      'agreement.pauseAt',
      'updates.unread',
    ];
    const seed = keys.map((key) => store.metricText(key));
    store.addApplication({
      id: 'help-test-role',
      role: 'Staff Engineer',
      company: 'Fabrikam',
      stage: 'shortlisted',
    });
    store.markTourSeen('dashboard');
    // A prompt still on the system default, so prompts.customized changes (round 7: every prompt
    // has a history, and six already run a tested version of yours; Draft a reply does not).
    expect(store.setPrompt('reply', 'Keep each reply to three lines.')?.ok).toBe(true);
    expect(store.setAgreementDemo('overdue')?.paused).toBe(true);
    expect(
      store.signAgreement({
        version: '2026.10',
        name: 'Alex Morgan',
        consents: ['read', 'act', 'keep'],
      }).ok,
    ).toBe(true);
    expect(store.buy('bundle-month').ok).toBe(true);
    store.setPlatformModel('deepseek-v3-2');
    store.pledgeSupport('monthly');
    store.setSupporterListing({ optIn: true, display: 'initial' });
    store.markUpdateRead('bundle-offer');
    store.connectLinkedin();
    store.disconnectGmail();
    const changed = keys.map((key) => store.metricText(key));
    for (const [index, key] of keys.entries()) {
      expect(changed[index], key).not.toBe(seed[index]);
    }
    expect(store.get().connections.gmail.status).not.toBe('connected');
    store.reset();
    expect(keys.map((key) => store.metricText(key))).toEqual(seed);
    expect(store.get().connections.gmail.status).toBe('connected');
    expect(store.connections().linkedin.status).toBe('disconnected');
    expect(store.purchases()).toEqual([]);
    expect(store.credits().model.id).toBe('ministral-3-14b');
    expect(store.support().listing.optIn).toBe(false);
    // The agreement as the sample starts: 2026.09 signed, 2026.10 waiting, no demo.
    const agreements = store.agreements();
    expect(agreements.signed.map((record) => record.version)).toEqual(['2026.09']);
    expect(agreements.pending?.version).toBe('2026.10');
    expect([agreements.paused, agreements.demo]).toEqual([false, false]);
    expect(store.requiresAgreement('buy')).toMatchObject({ version: '2026.10' });
  });

  it('also clears the token limit, what you bought, your pledge, and the AI setting (round 4)', () => {
    const store = seedStore();
    const seedLimit = store.aiLimit();
    expect([seedLimit.tokens, seedLimit.period, seedLimit.onReach]).toEqual([
      250000,
      'month',
      'pause',
    ]);
    expect(store.setAiLimit({ tokens: 10000, period: 'day', onReach: 'platform' })).not.toBeNull();
    // Round 5: nightly runs are bought (buy() needs 2026.10 signed), never added free.
    store.signAgreement({
      version: '2026.10',
      name: 'Alex Morgan',
      consents: ['read', 'act', 'keep'],
    });
    expect(store.buy('nightly-30').ok).toBe(true);
    store.pledgeSupport('monthly');
    store.setAiChoice('none');
    expect(store.purchases()).toHaveLength(1);
    expect(store.support()).toMatchObject({ pledged: true, cadence: 'monthly' });
    expect(store.aiChoice().source).toBe('none');
    store.reset();
    const limit = store.aiLimit();
    expect([limit.tokens, limit.period, limit.onReach, limit.state]).toEqual([
      250000,
      'month',
      'pause',
      'ok',
    ]);
    expect(store.purchases()).toEqual([]);
    expect(store.support()).toMatchObject({ pledged: false, cadence: null });
    expect(store.aiChoice()).toMatchObject({
      source: 'openai',
      summary: 'Every search and draft uses gpt-5-mini on your OpenAI key',
    });
    for (const key of [
      'ai.limit.tokens',
      'ai.limit.used',
      'ai.limit.resetsAt',
      'watch.nightly.topups',
    ]) {
      expect(store.metricText(key), key).toBe(seedStore().metricText(key));
    }
  });
});

describe('Help: your runs in one line (round 6 part 2, N3, UAT-RM-4)', () => {
  const answer = byId('faq-nightly');

  it('says the runs left and how long they last in one line, and links Purchases’ runs', () => {
    // The runs ring lives in Purchases (its home), with snapshots on the Dashboard and Searches
    // (P-2); Help's answer said it a fourth time as a ring, so it is one line from the store now.
    expect(answer).not.toMatch(/class="allowance\b|allowance-ring|data-topup-open/);
    expect(textOf(byId('help-runs-line')).replace(/\s+([.;,])/g, '$1')).toBe(
      // Round 7 (R10-9): the Gmail scans count too, so 4 are left and they last through Oct 3.
      'You have 4 of 10 runs left this month; they last through Sat, Oct 3.',
    );
    expect(figuresIn(byId('help-runs-line')).map((figure) => figure.key)).toEqual([
      'watch.nightly.freeLeft',
      'watch.nightly.limit',
      'watch.nightly.lastsThrough',
    ]);
    expect(answer).toContain(
      '<a class="compact-action" href="./shop-preview.html#nightly">Your runs in Purchases</a>',
    );
    expect(textOf(answer)).toContain(
      'Purchases adds runs by count, in packs or in bundles with AI credits.',
    );
    expect(textOf(answer)).toContain(
      'Every search, Keep watch check, Gmail scan, and daily summary email uses one run, so that date counts everything you turned on.',
    );
    expect(answer).toContain(
      '<a href="./usage-preview.html#runway">Usage</a> shows what used each run.',
    );
    expect(pageScript).toContain(
      'renderRunsLine(store.allowance?.()?.runs ?? store.allowance?.()?.nightly);',
    );
    expect(pageScript).not.toMatch(/nightlyMeter|nightlyTip|allowance\?\.set\(/);
  });

  it('follows the store: the free runs, the runs you bought, how long they last, and none left', () => {
    const store = seedStore();
    // Round 6, part 2 (N3, A2's world P2.5): every run uses one run; round 7 (R10-9): the two
    // October Gmail scans too, so 6 of 10 are used.
    expect(store.allowance().runs).toMatchObject({
      freeLeft: 4,
      left: 4,
      used: 6,
      topups: 0,
      limit: 10,
    });
    expect(
      ['watch.nightly.freeLeft', 'watch.nightly.limit', 'watch.nightly.lastsThrough'].map((key) =>
        store.metricText(key),
      ),
    ).toEqual(['4', '10', 'Sat, Oct 3']);
    // The line the page writes in each case (once you bought runs: every run left, and the free
    // ones among them; none left: says so, and the month line says when the free runs return).
    for (const part of [
      "? ['You have no runs left this month.']",
      "? ['You have ', metricSpan('runs.left'), ' runs left this month, ', metricSpan('watch.nightly.freeLeft'), ' of your ', metricSpan('watch.nightly.limit'), ' free ones']",
      ": ['You have ', metricSpan('watch.nightly.freeLeft'), ' of ', metricSpan('watch.nightly.limit'), ' runs left this month']),",
      "...(lasts ? ['; they last through ', metricSpan('watch.nightly.lastsThrough'), '.'] : ['.']),",
    ]) {
      expect(pageScript, part).toContain(part);
    }
    store.signAgreement({
      version: '2026.10',
      name: 'Alex Morgan',
      consents: ['read', 'act', 'keep'],
    });
    expect(store.buy('nightly-30').ok).toBe(true);
    expect(
      ['runs.left', 'watch.nightly.freeLeft', 'watch.nightly.limit'].map((key) =>
        store.metricText(key),
      ),
    ).toEqual(['34', '4', '10']);
    // The figures and dates come from the store, never from the page.
    expect(pageScript).not.toMatch(/Tue, Oct 6|Mon, Oct 5|Oct 31|Nov 1/);
  });
});

describe('Help: Deputy Assist, the one AI setting, and the limit (R4-2, R4-3)', () => {
  it('states the one AI setting once, from aiChoice().summary, with Change', () => {
    expect(main.match(/data-help-ai-summary/g)).toHaveLength(1);
    expect(main).not.toContain('data-help-ai-choice');
    expect(byId('faq-ai-setting')).toMatch(
      /<p class="help-answer-setting" data-signed-in>\s*<span><span data-help-ai-summary>Every search and draft uses gpt-5-mini on your OpenAI key<\/span>\.<\/span>\s*<a class="chart-action" id="help-ai-change" href="\.\/ai-preview\.html#ai">Change<span class="sr-only"> the AI setting<\/span><\/a>/,
    );
    expect(pageScript).toContain(
      "setText(document.querySelector('[data-help-ai-summary]'), choice?.summary ?? '');",
    );
    // A reached limit: the summary says so, and the link becomes Change limit (#limit).
    expect(pageScript).toContain(
      "const href = limited ? './ai-preview.html#limit' : (choice.href ?? './ai-preview.html#ai');",
    );
    expect(pageScript).toContain("const words = limited ? 'Change limit' : 'Change';");
    expect(seedStore().aiChoice().summary).toBe(
      'Every search and draft uses gpt-5-mini on your OpenAI key',
    );
    // No per-source or per-task AI anywhere on the page.
    expect(textOf(main)).not.toMatch(/each source can use|per source|its own AI choice/i);
    // The names (R4-3) as the store holds them.
    const terms = seedStore().TERMS;
    expect(textOf(byId('faq-assist'))).toContain(`${terms.assist} is your deputy's AI work`);
    expect(textOf(byId('faq-assist'))).toContain(`counted in ${terms.tokens}`);
    expect(textOf(byId('faq-assist'))).toContain(`on ${terms.credits} on our platform`);
    expect(textOf(byId('faq-assist'))).toContain(`is counted in ${terms.nightlyRuns}`);
    expect(terms.aiRuns).toBeUndefined();
  });

  it('shows your limit from aiLimit(), with what happens when it is reached', () => {
    const store = seedStore();
    const limit = byId('faq-limit');
    expect(figuresIn(limit).map((figure) => [figure.key, figure.text])).toEqual([
      ['ai.limit.tokens', store.metricText('ai.limit.tokens')],
      ['ai.limit.used', store.metricText('ai.limit.used')],
      ['ai.limit.resetsAt', store.metricText('ai.limit.resetsAt')],
    ]);
    expect(textOf(limit)).toContain(
      'Your limit is 250,000 tokens a month , with 49,810 used this month ; it resets Sun, Nov 1 , 00:00 UTC.',
    );
    expect(limit).toContain(
      '<a class="compact-action" id="help-limit-action" href="./ai-preview.html#limit">Change limit</a>',
    );
    for (const part of [
      'const limit = store.aiLimit?.();',
      "const PERIOD_WORDS = { day: 'a day', week: 'a week', month: 'a month' };",
      "next = 'It counts only while one of your keys runs Deputy Assist.';",
      "} else if (set && limit.state === 'reached' && choice?.limited) {",
      `next = \`\${choice.summary}.\`;`,
      '? "When it\'s reached, Deputy Assist switches to platform credits."',
      ': "When it\'s reached, AI work pauses."',
      "setText(document.querySelector('#help-limit-action'), set ? 'Change limit' : 'Set a limit');",
    ]) {
      expect(pageScript, part).toContain(part);
    }
    // The store's states the answer names: a week's limit, and one already reached.
    // A week now counts Sep 28 to 30 too (82,380 tokens on the seed), so 200,000 is well under it.
    expect(store.setAiLimit({ tokens: 200000, period: 'week' })).toMatchObject({
      period: 'week',
      periodLabel: 'this week',
      state: 'ok',
    });
    expect(store.setAiLimit({ tokens: 10000, period: 'month', onReach: 'platform' })).toMatchObject(
      {
        state: 'reached',
        usingPlatform: true,
      },
    );
    expect(store.setAiLimit({ tokens: 5000 })).toBeNull();
    // A reached limit reads in the store's own words, the same on every page (UAT-D-3): what
    // runs instead, or that AI work is paused and until when.
    expect(store.aiChoice()).toMatchObject({
      limited: 'platform',
      summary:
        'Your OpenAI key reached your limit: searches and drafts use Ministral 3 14B on platform credits until Sun, Nov 1',
    });
    store.setAiLimit({ onReach: 'pause' });
    expect(store.aiChoice()).toMatchObject({
      limited: 'paused',
      summary: 'Your OpenAI key reached your limit: AI work is paused until Sun, Nov 1',
    });
  });

  it('answers the Shop and support without an amount, and names a pledge you recorded', () => {
    const shop = byId('faq-shop');
    const support = byId('faq-support');
    expect(shop).toMatch(/^<details[^>]*\sdata-signed-in\b/);
    expect(support).toMatch(/^<details[^>]*\sdata-signed-in\b/);
    // Round 6 (T1): the Shop is Purchases, in Settings.
    expect(shop).toContain('<a href="./shop-preview.html">Purchases</a>');
    expect(support).toContain('<a href="./shop-preview.html#support">Support JobDeputy</a>');
    // Prices live in the credits answer (store figures); support never has an amount (G5).
    expect(textOf(shop)).not.toMatch(/[$€£]\s?\d|per month/i);
    expect(textOf(support)).not.toMatch(/[$€£]\s?\d|per month/i);
    expect(textOf(support)).toMatch(/you'll choose an amount when it opens/);
    expect(support).toContain('<span data-help-support hidden>');
    expect(pageScript).toContain('const support = store.support?.();');
    expect(pageScript).toContain('if (pledged) pledged.hidden = !support?.pledged;');
    // Job matches pages are signed-in too: Job matches is the account's.
    expect(byId('faq-pages')).toMatch(/^<details[^>]*\sdata-signed-in\b/);
  });
});

describe('Help: round 7, the answers the decisions changed', () => {
  const words = (id: string): string =>
    textOf(answers.find((answer) => answer.id === id)?.markup ?? '');
  const markupOf = (id: string): string => answers.find((answer) => answer.id === id)?.markup ?? '';

  it('says everything is runs or tokens: searches, Keep watch, Gmail scans, and the daily email (R10-9)', () => {
    expect(words('faq-runs')).toMatch(
      /Each Gmail scan uses one too, the daily scan and Scan now, and so does each daily summary email if you turn it on\. AI work is counted in tokens/,
    );
    expect(words('faq-nightly')).toMatch(
      /Every search, Keep watch check, Gmail scan, and daily summary email uses one run, so that date counts everything you turned on/,
    );
    expect(words('faq-nightly')).toMatch(/more keep everything running through/);
    expect(words('faq-nightly')).not.toMatch(/every watched source checked/);
  });

  it('names the seven Settings tabs, with Usage and Activity, each a link (Usage, Activity)', () => {
    const settings = markupOf('faq-settings');
    for (const href of [
      './account-preview.html',
      './connections-preview.html',
      './prompts-preview.html',
      './ai-preview.html',
      './usage-preview.html',
      './shop-preview.html',
      './activity-preview.html',
    ]) {
      expect(settings, href).toContain(`href="${href}"`);
    }
    expect(words('faq-settings')).toMatch(/Account \(how you sign in, the emails we send you,/);
    expect(words('faq-settings')).toMatch(
      /Purchases \(your balances, one quick buy, and every receipt\)/,
    );
    expect(words('faq-shop')).toMatch(/with its receipt in Receipts/);
    expect(markupOf('faq-shop')).toContain('<a href="./shop-preview.html#receipts">Receipts</a>');
  });

  it('says prompts are edited only on the Prompts page, with Open in Prompts (R10-3, R10-5)', () => {
    expect(words('faq-prompts')).toMatch(
      /Prompts is the one place to edit them; every other page shows a short summary with Open in Prompts/,
    );
    expect(markupOf('faq-prompts')).toContain(
      '<a class="compact-action" id="help-prompt-open" href="./prompts-preview.html?prompt=rank" data-return-link>Open Score fit in Prompts</a>',
    );
    // No page but Prompts opens the prompt drawer (it is the Prompts page's editor now).
    expect(main).not.toContain('data-prompt-open=');
  });

  it('describes Job matches as a queue and Applications as one board (J2, A1)', () => {
    const sum = markupOf('faq-counts');
    expect(sum).toContain(
      '<a class="help-sum-term" href="./jobs-preview.html"><span class="help-sum-figure" data-metric="jobs.toReview">20</span><span class="help-sum-name">To review</span></a>',
    );
    expect(sum).toContain('data-metric="jobs.notForMe"');
    expect(words('faq-counts')).toMatch(
      /Job matches is a queue: adding a role or setting it aside takes it out and opens the next one/,
    );
    expect(words('faq-stages')).toMatch(
      /Applications is one board of the roles you chose, and each card moves along it as the work happens\. Every card says who did each step: you, or your deputy when your rules let it approve or apply by itself/,
    );
    expect(words('faq-approve')).toMatch(/Watch shows the form as it fills, if you want to see it/);
    expect(words('faq-auto-apply')).toMatch(/in Your rules , at the top of Applications/);
  });

  it('lists the Usage and Activity tours in Demos', () => {
    for (const [key, href] of [
      ['usage', './usage-preview.html?tour=1'],
      ['activity', './activity-preview.html?tour=1'],
    ]) {
      expect(byId('demos'), key).toMatch(
        new RegExp(
          `<li class="help-demo" data-demo="${key}">[\\s\\S]*?href="${String(href).replace(/[.?]/g, '\\$&')}"`,
        ),
      );
    }
  });
});
