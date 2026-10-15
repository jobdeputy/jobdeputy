#!/usr/bin/env node
// Rendered UI-consistency audit for the brand prototypes (docs/ui-consistency-audit.md).
// Loads every route in headless Chrome and compares computed styles with the component contract
// in docs/design-system.md, plus global text-size, contrast, palette, target, wrapping, and
// overflow checks. Not part of CI: it needs a local Chrome and a static server.
//
//   python3 -m http.server 8767        # from the repository root, in another terminal
//   node scripts/ui-audit.mjs [--pages=login,home] [--widths=1440,768,390,320] [--parity]
//        [--reduced] [--scene=search] [--shots] [--full] [--json=out.json] [--quiet]
//        [--sizes=1440x900,768x1024] [--states] [--motion] [--scenes] [--focus] [--fit]
//        [--loader] [--skip-base] [--all] [--touch=off|all]
//
// Widths under 1024px run as touch devices (a mobile viewport with touch emulation: hover: none and
// pointer: coarse match, and overflow widens the layout viewport as on a phone); --touch=off runs
// them with a mouse, --touch=all runs every width with touch.
//
// The default run (no opt-in flag) stays fast. Opt-in checks, each limited by --pages:
//   --states     every alternate entry state (login ?state=password|password-visible|region|error|
//                loading|success; access Region Change open, empty submit, valid submit; set mode with
//                a bad token) through text.min-size-12, text.contrast-AA, text.palette, target.min-44,
//                control.no-wrap, and layout.no-overflow-x.
//   --reduced    also adds motion.reduced-no-loops to every page: 1s after load, no running or pending
//                animation loops or lasts over 50ms, and no story or panda transition exceeds 50ms.
//   --motion     motion.pause-stops-all (WCAG 2.2.2), without ?static: no infinite animation runs
//                600ms after Pause, or 3s after the story reaches its last chapter.
//   --scenes     for every story scene and every login ?state=: text.no-overlap (story text versus the
//                capability word and its rule, story controls, speech, and duty status),
//                stage.face-clear (warning; props cover at most 10% of the head and none of the eyes),
//                and speech.visible (the speech renders, inside the viewport and unclipped).
//   --focus      focus.not-obscured (WCAG 2.4.11; Shift+Tab from the end of each internal page; the
//                sticky header must not cover the focused element) and focus.not-lost (WCAG 2.4.3;
//                Enter on story Next and Previous to the ends, and on create-account submit).
//   --fit        layout.fits-viewport: on split entry layouts the story panel is no taller than
//                max(viewport - header, task panel). Uses --sizes, or 1440x900, 1366x768, 1280x720,
//                1024x768, 1024x600, and 768x1024.
//   --loader     loader.timeline for login and home without skipLoader, normal and with the SVG
//                blocked: monotonic fill without 15-point jumps, fill within 2 points of aria-valuenow,
//                reveal by 4.5s (400ms with --reduced), one loading and one ready live announcement,
//                and one SVG request.
//   --firstview  layout.first-view at 390x844, 375x667, and 360x740 (or --sizes): the page's main task
//                is in the first viewport without scrolling. Entry routes: the form heading and the
//                first field are fully visible (and Sign in's primary action at 390x844). Setup: the
//                first answer or field and the Continue action are visible. Internal pages: the h1 is
//                fully visible and the first visual block or task surface starts inside the viewport.
//                Storage is cleared first, so each page opens as it does for a new person.
//   --parity     also runs parity.panda-states: login and create at 1440 and 390 in seven interaction
//                states (real clicks and typing) must settle on the same panda pose (0.5px, 0.5°) and
//                speech; the signIn and create variants of one shared pandaLines entry count as one.
//   --sizes      explicit WxH viewports for the default pass and the opt-in checks. Without it, each
//                --widths width uses a 900px height (844px at 400px and narrower).
//   --large      (round 7, R10-10) also measures the budgets on ?demo=large for every page.
//   --budgets-only  only the budgets: each page at each width, usual (and with --large, large).
//   --skip-base  skip the default computed-style pass and run only the opt-in checks.
//   --all        every opt-in check above, plus a reduced-motion pass at 1440 and 390 when --reduced
//                is not set.
// --motion, --focus, and the --all reduced pass use 1440 and 390 unless --widths or --sizes is given.
//
// Pages are entry routes (sign-in and account access), internal pages (the signed-in app shell),
// or setup routes (onboarding: the entry header, no app sidebar, no footer). The default pass also
// checks the app shell on every internal page, at every width:
//   int.shell        .page-shell is min(1280px, main − 42px) wide (main − 26px at 720px and
//                    narrower) and centred in main (setup routes too).
//   int.footer.inner the footer content's edges match the page shell's.
//   int.sidebar      a fixed 233px sidebar (89px rail at 721–1100px) under the 72px header, as
//                    tall as the rest of the viewport, with a 207px (rail: 81px) deputy slot, that
//                    stays put to the end of the page; at 720px and narrower a full-width app bar
//                    sticky under the 64px header (one unit of at most 120px) that stays at the
//                    top while the page scrolls; none on the public Help page.
//   int.nav          eight links, 48px rows (44px when the viewport is 820px tall or less, at least
//                    64px in the rail), one visibly current link, and no clipped label.
//   int.mobile-menu  at 720px and narrower, real clicks and keys: collapsed by default, opens and
//                    closes, Escape closes it and returns focus to the Menu button, choosing a link
//                    closes it, and crossing the breakpoint collapses it; wider, the Menu button is
//                    hidden and the list is shown.
// Every page also gets perf.budgets (round 7, R10-10), measured from the navigation: the layout
// shift after the first paint sums to at most 0.02 (shifts within 500ms of input excluded) and no
// task runs over 200ms. A failure names the shifting nodes (their rects before and after) and the
// long tasks. --large measures ?demo=large too (perf.budgets-large).
// Every page with the shared sample store also gets data.metric-matches (each [data-metric] figure
// in main reads exactly JobDeputyStore.metricText(key)) and data.metric-once (no key twice on a
// page, outside the flow ribbon and nav badges): the round 3 duplicate-data critic.
//
// JD_BASE overrides the pages URL, CHROME the browser binary, and JD_SHOTS the screenshot folder.
// The process exits with 1 when any check fails.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.JD_BASE || 'http://127.0.0.1:8767/brand/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS_DIR = process.env.JD_SHOTS || join(tmpdir(), 'jobdeputy-ui-audit');
const PAGES = {
  login: 'login-preview.html?skipLoader&static',
  create: 'access-preview.html?mode=create&skipLoader&static',
  reset: 'access-preview.html?mode=reset&skipLoader&static',
  set: 'access-preview.html?mode=set&token=prototype&skipLoader&static',
  home: 'home-preview.html?skipLoader&static',
  searches: 'searches-preview.html?skipLoader',
  jobs: 'jobs-preview.html?skipLoader',
  // A role opened from the list (on phones and narrow tablets it is its own view).
  'jobs-role': 'jobs-preview.html?skipLoader&job=internal-platforms',
  applications: 'applications-preview.html?skipLoader',
  documents: 'documents-preview.html?skipLoader',
  materials: 'materials-preview.html?skipLoader',
  profile: 'profile-preview.html?skipLoader',
  ai: 'ai-preview.html?skipLoader',
  trust: 'trust-preview.html?skipLoader',
  'trust-public': 'trust-preview.html?public&skipLoader',
  onboarding: 'onboarding-preview.html?skipLoader',
  // The User Agreement after Create account (round 5): setup chrome, like onboarding.
  agreement: 'agreement-preview.html?mode=new&skipLoader',
  invite: 'invite-preview.html?skipLoader',
  shop: 'shop-preview.html?skipLoader',
  // Round 6: the Settings tabs that are new pages (Account, Connections, Prompts).
  account: 'account-preview.html?skipLoader',
  connections: 'connections-preview.html?skipLoader',
  prompts: 'prompts-preview.html?skipLoader',
  autofill: 'autofill-preview.html?app=search-infra&skipLoader',
  // Round 7: two new Settings tabs (Usage, SP; Activity, SA), and the sample daily email (DB), an
  // email preview rather than an app page.
  usage: 'usage-preview.html?skipLoader',
  activity: 'activity-preview.html?skipLoader',
  'summary-email': 'summary-email-preview.html?skipLoader',
};
// A page that is not built yet is left out when the pages are read from the folder.
for (const [name, path] of Object.entries(PAGES)) {
  if (BASE.startsWith('file:') && !existsSync(new URL(path.split('?')[0], BASE)))
    delete PAGES[name];
}
const ENTRY = ['login', 'create', 'reset', 'set'];
// Setup routes use the shared chrome with the entry header and no app shell or footer.
const SETUP = ['onboarding', 'agreement'];
// Previews of what leaves the app (the daily summary email, round 7): no app chrome; the global
// checks (text, contrast, targets, overflow) and the budgets still apply.
const PREVIEW = ['summary-email'];
const groupOf = (name) =>
  ENTRY.includes(name)
    ? 'entry'
    : SETUP.includes(name)
      ? 'setup'
      : PREVIEW.includes(name)
        ? 'preview'
        : 'internal';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const pageNames = args.pages ? String(args.pages).split(',') : Object.keys(PAGES);
const widths = args.widths ? String(args.widths).split(',').map(Number) : [1440, 390, 320, 768];
const parseSizes = (value) =>
  String(value)
    .split(',')
    .map((size) => size.toLowerCase().split('x').map(Number));
// Without --sizes every width keeps the historical fixed height.
const viewports = args.sizes
  ? parseSizes(args.sizes)
  : widths.map((width) => [width, width <= 400 ? 844 : 900]);
const viewportLabel = (width, height) => (args.sizes ? `${width}x${height}` : String(width));
const optIn = (flag) => Boolean(args[flag] || args.all);
// Phones and tablets run as touch devices (round 7, T2): a mobile viewport with touch emulation,
// so hover: none and pointer: coarse match, and a page wider than the screen widens the layout
// viewport (window.innerWidth grows) as it does on a real phone. Every width under 1024px is
// touch; --touch=off runs every width with a mouse, --touch=all every width with touch.
const touchAt = (width) => args.touch === 'all' || (args.touch !== 'off' && width < 1024);
async function emulate(cdp, width, height) {
  const touch = touchAt(width);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: touch,
  });
  await cdp.send(
    'Emulation.setTouchEmulationEnabled',
    touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
  );
}
const OPT_IN = ['states', 'scenes', 'motion', 'focus', 'fit', 'loader', 'parity', 'firstview'];

const INTERNAL = Object.keys(PAGES).filter((name) => groupOf(name) === 'internal');
// The entry story's chapters (round 7, G1: the three steps Set it up, It finds, It applies).
const SCENES = ['setup', 'search', 'apply'];
const LOGIN_STATES = ['password', 'password-visible', 'region', 'error', 'loading', 'success'];
// The global checks re-run in every alternate entry state.
const STATE_CHECKS = [
  'text.min-size-12',
  'text.contrast-AA',
  'text.palette',
  'target.min-44',
  'control.no-wrap',
  'layout.no-overflow-x',
];
const ACCESS_REQUEST_STATES = [
  { state: 'region', act: 'region' },
  { state: 'error', act: 'submit-empty' },
  { state: 'success', act: 'submit-valid' },
];
// A login ?state= query, an in-page action on account access, or a different URL.
const ENTRY_STATES = {
  login: LOGIN_STATES.map((state) => ({ state, query: `&state=${state}` })),
  create: ACCESS_REQUEST_STATES,
  reset: ACCESS_REQUEST_STATES,
  set: [
    { state: 'error', act: 'submit-empty' },
    { state: 'success', act: 'submit-valid' },
    { state: 'bad-token', url: 'access-preview.html?mode=set&token=invalid&skipLoader&static' },
  ],
};
const FIT_SIZES = [
  [1440, 900],
  [1366, 768],
  [1280, 720],
  [1024, 768],
  [1024, 600],
  [768, 1024],
];
const PANDA_STATES = [
  'email-focus',
  'password-focus',
  'password-visible',
  'region-open',
  'validation-error',
  'submitting',
  'success',
];
const NEW_CHECKS = [
  'motion.reduced-no-loops',
  'motion.pause-stops-all',
  'text.no-overlap',
  'stage.face-clear',
  'speech.visible',
  'focus.not-obscured',
  'focus.not-lost',
  'layout.fits-viewport',
  'loader.timeline',
  'parity.panda-states',
  'int.sidebar',
  'int.nav',
  'int.mobile-menu',
  'layout.first-view',
  'perf.budgets',
  'perf.budgets-large',
];

// The budgets (round 7, R10-10): installed before any page script runs, on every navigation.
const BUDGET_CLS = 0.02;
const BUDGET_TASK_MS = 200;
const BUDGET_PROBE = `(() => {
  const budget = { shifts: [], tasks: [] };
  window.__jdBudget = budget;
  const name = (node) => {
    if (!node) return '?';
    if (node.nodeType !== 1) return node.nodeName;
    let label = node.tagName.toLowerCase();
    if (node.id) return label + '#' + node.id;
    const kind = typeof node.className === 'string' ? node.className.trim().split(/\\s+/)[0] : '';
    return kind ? label + '.' + kind : label;
  };
  const rect = (r) => r ? [r.x, r.y, r.width, r.height].map(Math.round).join(',') : '';
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        budget.shifts.push({
          t: Math.round(entry.startTime),
          v: entry.value,
          nodes: (entry.sources || []).slice(0, 3).map((s) => name(s.node) + ' ' + rect(s.previousRect) + '>' + rect(s.currentRect)),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) budget.tasks.push({ t: Math.round(entry.startTime), d: Math.round(entry.duration) });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
})();`;

// Reads the budgets the probe gathered on this page.
function budgetRead() {
  const budget = window.__jdBudget ?? { shifts: [], tasks: [] };
  const cls = budget.shifts.reduce((sum, shift) => sum + shift.v, 0);
  const longest = budget.tasks.reduce((max, task) => Math.max(max, task.d), 0);
  return {
    cls: Math.round(cls * 10000) / 10000,
    longest,
    shifts: budget.shifts
      .filter((shift) => shift.v >= 0.001)
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .map((shift) => `${shift.v.toFixed(4)} at ${shift.t}ms: ${shift.nodes.join('; ')}`),
    tasks: budget.tasks.filter((task) => task.d > 200).map((task) => `${task.d}ms at ${task.t}ms`),
  };
}

function budgetResult(id, read) {
  const problems = [];
  if (read.cls > BUDGET_CLS)
    problems.push(`layout shift ${read.cls} (over ${BUDGET_CLS}): ${read.shifts.join(' | ')}`);
  if (read.longest > BUDGET_TASK_MS)
    problems.push(
      `long task ${read.longest}ms (over ${BUDGET_TASK_MS}ms): ${read.tasks.join(', ')}`,
    );
  return problems.length
    ? { id, ok: false, detail: problems.join(' · ') }
    : { id, ok: true, detail: `CLS ${read.cls}, longest task ${read.longest}ms` };
}

const FOOTER_LINKS = [
  'Dashboard',
  'Searches',
  'Job matches',
  'Applications',
  'Résumés',
  'Profile',
  // Round 6 (T1): Settings holds Account, Connections, Prompts, AI & credits, and Purchases (the
  // Shop, renamed); the footer names Settings and its two most used tabs.
  'Settings',
  'AI & credits',
  'Purchases',
  'Invite friends',
  'Privacy',
  'Security',
  'Accessibility',
  'Help',
];
const SHADOW_CONTROL = 'rgba(27, 26, 24, 0.15) 0px 10px 21px 0px';
const EYEBROW = {
  fontSize: '12px',
  fontWeight: '750',
  color: 'ink',
  letterSpacing: '1.44px',
  textTransform: 'uppercase',
  'before.width': '13px',
  'before.height': '3px',
  'before.backgroundColor': 'green',
};
const H1 = {
  fontFamily: 'serif',
  fontSize: '52px',
  fontWeight: '500',
  lineHeight: '52px',
  letterSpacing: '-2.6px',
  color: 'ink',
};
const INTRO = { fontSize: '15px', lineHeight: '22.5px', letterSpacing: '-0.15px', color: 'muted' };

// group: all | entry | internal | setup, or a list of them. desktop = 1440 only, mobile = 390 only,
// any = every width. optional: true or the pages where no element is fine; required: the only pages
// that must have one (optional everywhere else). skipWhen: a selector; while it matches, the check
// does not apply (for example the story copy, which the phone band does not show).
const SPEC = [
  { id: 'body.base', group: 'all', at: 'any', sel: 'body', expect: { fontSize: '16px' } },
  {
    id: 'header.surface',
    group: 'all',
    at: 'any',
    sel: '.site-header, .app-header',
    expect: {
      backgroundColor: 'paper@0.82',
      borderBottomColor: 'ink@0.08',
      borderBottomWidth: '1px',
    },
  },
  {
    id: 'wordmark.job',
    group: 'all',
    at: 'desktop',
    sel: '.brand-name > span:first-child, .mini-wordmark-name > span:first-child',
    expect: {
      fontFamily: 'sans-text',
      fontSize: '19px',
      fontWeight: '620',
      letterSpacing: '-0.95px',
      color: 'ink',
    },
  },
  {
    id: 'wordmark.deputy',
    group: 'all',
    at: 'desktop',
    sel: '.brand-name > span:last-child, .mini-wordmark-name > span:last-child',
    expect: { fontFamily: 'sans-text', fontSize: '19px', fontWeight: '720', color: 'ink' },
  },
  {
    id: 'wordmark.mobile',
    group: 'all',
    at: 'mobile',
    optional: true,
    sel: '.brand-name, .mini-wordmark-name',
    expect: { fontSize: '18px' },
  },
  {
    id: 'wordmark.tagline',
    group: 'all',
    at: 'desktop',
    sel: '.brand-note, .mini-wordmark-note',
    expect: { fontSize: '8.5px', fontWeight: '680', color: 'muted', textTransform: 'uppercase' },
  },
  {
    id: 'skip-link',
    group: 'all',
    at: 'desktop',
    sel: '.skip-link',
    expect: {
      fontSize: '13px',
      fontWeight: '680',
      hMin: 44,
      borderRadius: '11px',
      backgroundColor: 'ink',
      color: 'white',
    },
  },
  // ---- entry routes
  {
    id: 'entry.header-link',
    group: 'entry',
    at: 'desktop',
    sel: '.site-header .about-link, .site-header .header-action',
    expect: {
      fontSize: '13px',
      fontWeight: '400',
      color: 'muted',
      // The arrow is decorative, so its empty alt text keeps it out of the accessible name.
      'after.content': '"→" / ""',
      'after.color': 'green',
    },
  },
  {
    id: 'entry.story-eyebrow',
    group: 'entry',
    at: 'desktop',
    sel: '.story-copy .eyebrow',
    expect: {
      fontSize: '13px',
      fontWeight: '750',
      color: 'green-ink',
      letterSpacing: '1.56px',
      textTransform: 'uppercase',
    },
  },
  {
    id: 'entry.story-eyebrow.mobile',
    group: 'entry',
    at: 'mobile',
    skipWhen: 'main[data-story-view="band"], main[data-story-view="mini"]',
    sel: '.story-copy .eyebrow',
    expect: { fontSize: '12px', color: 'green-ink' },
  },
  {
    id: 'entry.story-title',
    group: 'entry',
    at: 'any',
    skipWhen: 'main[data-story-view="band"], main[data-story-view="mini"]',
    sel: '.story-title',
    expect: { fontFamily: 'serif', textWrapStyle: 'balance' },
  },
  {
    id: 'entry.story-steps',
    group: 'entry',
    at: 'any',
    all: true,
    sel: '#story-previous, #story-next',
    expect: { 'before.content': 'none' },
  },
  {
    id: 'entry.form-eyebrow',
    group: 'entry',
    at: 'any',
    sel: '.auth-kicker, .form-heading .eyebrow',
    expect: EYEBROW,
  },
  {
    id: 'entry.h1',
    group: 'entry',
    at: 'desktop',
    sel: '.auth-title, .form-heading h1',
    expect: H1,
  },
  {
    id: 'entry.h1.mobile',
    group: 'entry',
    at: 'mobile',
    sel: '.auth-title, .form-heading h1',
    expect: { fontSize: '40.95px' },
  },
  {
    id: 'entry.intro',
    group: 'entry',
    at: 'any',
    sel: '.auth-subtitle, #form-intro',
    expect: INTRO,
  },
  {
    id: 'entry.labels',
    group: 'entry',
    at: 'any',
    all: true,
    sel: '.login-form .field-label, .access-form .field > label, .region-label, .access-form legend',
    expect: { fontSize: '13px', fontWeight: '680', letterSpacing: '0.13px', color: 'ink' },
  },
  {
    id: 'entry.inputs',
    group: 'entry',
    at: 'any',
    all: true,
    sel: '.login-form input.text-input, .access-form input.field-control',
    expect: {
      fontFamily: 'sans-text',
      fontSize: '15px',
      h: 52,
      borderRadius: '14px',
      backgroundColor: 'white@0.82',
      borderTopColor: 'ink@0.12',
      borderTopWidth: '1px',
    },
  },
  {
    id: 'entry.hints',
    group: 'entry',
    at: 'any',
    all: true,
    sel: '.field-hint',
    expect: { fontSize: '12px', color: 'muted' },
  },
  {
    id: 'entry.password-toggle',
    group: 'entry',
    at: 'any',
    optional: true,
    sel: '.password-toggle',
    expect: { fontSize: '14px', fontWeight: '680', hMin: 44 },
  },
  {
    id: 'entry.region-summary',
    group: 'entry',
    at: 'any',
    optional: true,
    sel: '.region-summary',
    expect: { borderRadius: '14px', backgroundColor: 'white@0.82', borderTopColor: 'ink@0.12' },
  },
  {
    id: 'entry.region-change',
    group: 'entry',
    at: 'any',
    optional: true,
    sel: '#region-change-button, #region-change',
    expect: {
      fontSize: '14px',
      fontWeight: '680',
      h: 44,
      borderRadius: '11px',
      backgroundColor: 'white@0.82',
      borderTopColor: 'ink@0.12',
    },
  },
  {
    id: 'entry.region-copy',
    group: 'entry',
    at: 'any',
    optional: true,
    all: true,
    sel: '#region-selection-source, #region-source, #region-note',
    expect: { fontSize: '12px', color: 'muted' },
  },
  {
    id: 'entry.submit',
    group: 'entry',
    at: 'any',
    sel: '#submit-button',
    expect: {
      fontSize: '15px',
      fontWeight: '680',
      h: 52,
      borderRadius: '15px',
      backgroundColor: 'ink',
      color: 'white',
      borderTopWidth: '0px',
      boxShadow: SHADOW_CONTROL,
    },
  },
  {
    id: 'entry.text-links',
    group: 'entry',
    at: 'any',
    all: true,
    sel: '.auth-panel .text-link, .task-panel .text-link',
    expect: { fontSize: '13px', fontWeight: '680', color: 'ink' },
  },
  {
    id: 'entry.disclosure',
    group: 'entry',
    at: 'any',
    optional: true,
    sel: '#form-disclosure',
    expect: { fontSize: '12px', color: 'muted' },
  },
  {
    id: 'entry.panda-status',
    group: 'entry',
    at: 'any',
    // Round 7 (G1, EN's request 7): the phone band at rest shows the brand line where the duty
    // chip was; the chip comes back whenever the panda reacts to the form.
    skipWhen:
      'main[data-story-view="band"]:is([data-panda-state="arrive"], [data-panda-state="story"], [data-panda-state="idle"])',
    sel: '#duty-status, #panda-status',
    expect: { fontSize: '12px', fontWeight: '650' },
  },
  {
    id: 'entry.task-panel',
    group: 'entry',
    at: 'desktop',
    sel: '.auth-panel, .task-panel',
    expect: { backgroundColor: 'black@0' },
  },
  // ---- internal routes
  {
    id: 'int.back-action',
    group: 'internal',
    at: 'any',
    required: ['materials', 'autofill', 'trust-public'],
    // The Back pill, not the Feedback and Invite header actions beside it.
    sel: '.app-header .header-action:not(.header-feedback, .header-invite)',
    expect: {
      fontSize: '13px',
      fontWeight: '680',
      color: 'ink',
      h: 44,
      borderRadius: '999px',
      backgroundColor: 'white@0.82',
      borderTopColor: 'ink@0.12',
      whiteSpace: 'nowrap',
    },
  },
  {
    id: 'int.account-chip',
    skipPages: ['trust-public'],
    group: 'internal',
    at: 'any',
    sel: '.account-link',
    expect: {
      h: 44,
      borderRadius: '999px',
      backgroundColor: 'white@0.82',
      borderTopColor: 'ink@0.12',
    },
  },
  {
    id: 'int.account-name',
    skipPages: ['trust-public'],
    group: 'internal',
    at: 'desktop',
    sel: '.account-copy strong',
    expect: { fontSize: '13px', fontWeight: '700', color: 'ink' },
  },
  {
    id: 'int.account-tier',
    skipPages: ['trust-public'],
    group: 'internal',
    at: 'desktop',
    sel: '.account-copy > span',
    expect: { fontSize: '12px', fontWeight: '400', color: 'muted' },
  },
  {
    id: 'int.eyebrow',
    group: ['internal', 'setup'],
    at: 'any',
    sel: '.page-intro .eyebrow, .home-intro .eyebrow',
    expect: EYEBROW,
  },
  { id: 'int.h1', group: ['internal', 'setup'], at: 'desktop', sel: 'main h1', expect: H1 },
  {
    id: 'int.h1.mobile',
    group: ['internal', 'setup'],
    at: 'mobile',
    sel: 'main h1',
    expect: { fontSize: '40.95px' },
  },
  {
    id: 'int.intro',
    group: ['internal', 'setup'],
    at: 'any',
    sel: '.intro-copy',
    expect: INTRO,
  },
  {
    id: 'int.section-heading',
    group: ['internal', 'setup'],
    at: 'desktop',
    all: true,
    // The visual Dashboard titles its rows for screen readers only; its cards use chart titles.
    optional: ['home', 'jobs'],
    // The paper pages are pictures of a document (aria-hidden), not page headings.
    sel: 'main h2:not(.paper-content h2)',
    expect: {
      fontFamily: 'serif',
      fontSize: '34px',
      fontWeight: '500',
      letterSpacing: '-1.36px',
      lineHeight: '35.7px',
      color: 'ink',
    },
  },
  {
    id: 'int.section-heading.mobile',
    group: ['internal', 'setup'],
    at: 'mobile',
    all: true,
    optional: ['home', 'jobs'],
    sel: 'main h2:not(.paper-content h2)',
    expect: { fontSize: '28px' },
  },
  {
    id: 'int.section-label',
    group: ['internal', 'setup'],
    at: 'any',
    all: true,
    optional: true,
    sel: '.section-label, .surface-number, .section-number, .trust-card > .eyebrow, #material-kind, .detail-heading .eyebrow',
    expect: {
      fontSize: '12px',
      fontWeight: '750',
      color: 'green-ink',
      letterSpacing: '1.44px',
      textTransform: 'uppercase',
    },
  },
  {
    id: 'int.labels',
    group: ['internal', 'setup'],
    at: 'any',
    all: true,
    optional: true,
    sel: 'main label:not(:has(input[type=checkbox])):not(:has(input[type=radio])):not(.sr-only), main legend:not(.sr-only), main .field-label',
    expect: { fontSize: '13px', fontWeight: '680', letterSpacing: '0.13px', color: 'ink' },
  },
  {
    id: 'int.fields',
    group: ['internal', 'setup'],
    at: 'any',
    all: true,
    optional: true,
    sel: 'main input[type=text], main input[type=email], main input[type=url], main input[type=search], main select, main textarea:not(.document-editor)',
    expect: {
      fontFamily: 'sans-text',
      fontSize: '15px',
      hMin: 52,
      borderRadius: '14px',
      borderTopColor: 'ink@0.12',
    },
  },
  {
    id: 'int.primary',
    group: ['internal', 'setup'],
    at: 'any',
    all: true,
    // Job matches on phones and narrow tablets opens on its list, which has no primary action.
    // The round 3 Dashboard has none by design: its tiles are the links (finding 9). Profile's
    // first actions are the red and blue need markers the owner asked for (finding 24). The
    // round 4 Shop leads with your balances; its packs and the donation interest are secondary.
    // Round 6: Settings, Account and Connections are settings lists; each change is its own
    // secondary action, so neither page has one main action.
    // Round 7 (SP's request 11, agreed by the orchestrator): Prompts lists every prompt as the
    // shared read only summary, each prompt's actions inside its Details (one prompt at a time,
    // its next step primary there); Usage is a report (the range, the filters, the rings, the
    // charts, the table), its changes the filter bar's own. The email preview has no app action.
    optional: [
      'jobs',
      'home',
      'profile',
      'shop',
      'account',
      'connections',
      'prompts',
      'usage',
      // SA's request 8 (agreed): Activity is a log; Export is secondary.
      'activity',
      'summary-email',
    ],
    sel: '.primary-action, .search-button, .button.primary, .button-primary',
    expect: {
      fontSize: '15px',
      fontWeight: '680',
      h: 52,
      borderRadius: '15px',
      backgroundColor: 'ink',
      color: 'white',
      boxShadow: SHADOW_CONTROL,
      whiteSpace: 'nowrap',
    },
  },
  {
    id: 'int.secondary',
    group: ['internal', 'setup'],
    at: 'any',
    all: true,
    optional: true,
    // Take the tour has its own two rules below (round 7, T2-12).
    sel: '.secondary-action:not(.page-tour), .secondary-link, .button-secondary, .button:not(.primary):not(.primary-action):not(.compact-action)',
    expect: {
      fontSize: '15px',
      fontWeight: '680',
      h: 52,
      borderRadius: '15px',
      color: 'ink',
      backgroundColor: 'white@0.82',
      borderTopColor: 'ink@0.12',
      whiteSpace: 'nowrap',
    },
  },
  // Take the tour (round 7, T2-12, the orchestrator's decision): the shared secondary action, but
  // on phones (720px and narrower), where the intro starts with an eyebrow, compact at the end of
  // the eyebrow's line: 13px words, at least 44px tall, the secondary's radius and surface.
  {
    id: 'int.tour',
    group: ['internal', 'setup'],
    at: 'wide',
    all: true,
    optional: true,
    sel: '.page-tour',
    expect: {
      fontSize: '15px',
      fontWeight: '680',
      h: 52,
      borderRadius: '15px',
      color: 'ink',
      backgroundColor: 'white@0.82',
      borderTopColor: 'ink@0.12',
      whiteSpace: 'nowrap',
    },
  },
  {
    id: 'int.tour-phone',
    group: ['internal', 'setup'],
    at: 'phone',
    all: true,
    optional: true,
    sel: '.page-intro:has(> .page-intro-copy > .eyebrow:first-child) > .page-intro-actions > .page-tour',
    expect: {
      fontSize: '13px',
      fontWeight: '680',
      hMin: 44,
      borderRadius: '15px',
      color: 'ink',
      backgroundColor: 'white@0.82',
      borderTopColor: 'ink@0.12',
      whiteSpace: 'nowrap',
    },
  },
  {
    id: 'int.tour-row',
    group: ['internal', 'setup'],
    at: 'phone',
    all: true,
    optional: true,
    sel: '.page-intro:not(:has(> .page-intro-copy > .eyebrow:first-child)) .page-tour',
    expect: {
      fontSize: '15px',
      fontWeight: '680',
      h: 52,
      borderRadius: '15px',
      color: 'ink',
      backgroundColor: 'white@0.82',
      borderTopColor: 'ink@0.12',
      whiteSpace: 'nowrap',
    },
  },
  {
    id: 'int.compact',
    group: ['internal', 'setup'],
    at: 'any',
    all: true,
    optional: true,
    sel: '.compact-action, .compact-button, .pager-button',
    expect: {
      fontSize: '14px',
      fontWeight: '680',
      hMin: 44,
      borderRadius: '11px',
      whiteSpace: 'nowrap',
    },
  },
  {
    id: 'int.pills',
    group: ['internal', 'setup'],
    at: 'any',
    all: true,
    optional: true,
    sel: '.status-pill, .tag, .summary-state, .activity-status, .material-status, .editor-status, .document-default, .choice-current, .document-type',
    expect: { fontSize: '12px', whiteSpace: 'nowrap' },
  },
  {
    id: 'int.footer.surface',
    group: 'internal',
    at: 'any',
    sel: '.site-footer',
    expect: { backgroundColor: 'ink', borderTopWidth: '0px' },
  },
  {
    id: 'int.footer.brand',
    group: 'internal',
    at: 'any',
    sel: '.footer-brand strong',
    expect: { fontSize: '13px', fontWeight: '700', color: 'white' },
  },
  {
    id: 'int.footer.copy',
    group: 'internal',
    at: 'any',
    sel: '.footer-brand span',
    expect: { fontSize: '12px', color: 'white@0.68' },
  },
  {
    id: 'int.footer.links',
    group: 'internal',
    at: 'any',
    all: true,
    sel: '.footer-link',
    expect: { fontSize: '13px', fontWeight: '620', color: 'white', hMin: 44 },
  },
  {
    id: 'int.footer.nav',
    skipPages: ['trust-public'],
    group: 'internal',
    at: 'desktop',
    sel: 'footer',
    expect: { linkTexts: FOOTER_LINKS },
  },
];

// ---------------------------------------------------------------- in-page audit
function pageAudit(ctx) {
  const TOK = {
    '#1b1a18': 'ink',
    '#2d2b27': 'ink-soft',
    '#706d66': 'muted',
    '#98948b': 'quiet',
    '#faf8f3': 'paper',
    '#f0ece3': 'paper-deep',
    '#2f9e77': 'green',
    '#ccebdc': 'green-soft',
    '#23795b': 'green-ink',
    '#f36b3f': 'orange',
    '#ffd5c6': 'orange-soft',
    '#9c4028': 'danger-ink',
    '#526fe5': 'blue',
    '#d9def8': 'blue-soft',
    '#ffffff': 'white',
    '#000000': 'black',
  };
  const ALLOWED_TEXT = new Set([
    'ink',
    'ink-soft',
    'muted',
    'white',
    'white@0.68',
    'green-ink',
    'danger-ink',
  ]);
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (t, b) => {
    const a = t.a + b.a * (1 - t.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const ch = (k) => (t[k] * t.a + b[k] * b.a * (1 - t.a)) / a;
    return { r: ch('r'), g: ch('g'), b: ch('b'), a };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const hex = (c) =>
    c
      ? `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}${c.a < 1 ? `@${+c.a.toFixed(2)}` : ''}`
      : null;
  const tok = (v) => {
    const h = hex(parse(v));
    if (!h) return String(v);
    const [base, alpha] = h.split('@');
    return (TOK[base] || `RAW ${base}`) + (alpha !== undefined ? `@${alpha}` : '');
  };
  const fam = (f) => {
    const first = f.split(',')[0].replace(/["']/g, '').trim();
    return { 'Iowan Old Style': 'serif', '-apple-system': 'sans-text' }[first] || `OTHER ${first}`;
  };
  const opac = (el) => {
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= Number.parseFloat(getComputedStyle(e).opacity);
    return o;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    if (opac(el) < 0.05) return false;
    if (el.closest('details:not([open])') && !el.closest('summary') && !el.matches('details'))
      return false;
    return !el.closest('svg');
  };
  const srOnly = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') return true;
      const r = e.getBoundingClientRect();
      if (s.position === 'absolute' && r.width <= 1 && r.height <= 1) return true;
    }
    return false;
  };
  const closedDetails = (el) => {
    const d = el.closest('details:not([open])');
    return !!d && !el.closest('summary');
  };
  const exempt = (el) =>
    !!el.closest('[aria-hidden="true"], svg') || srOnly(el) || closedDetails(el);
  const sel = (el) =>
    el.tagName.toLowerCase() +
    (el.id ? `#${el.id}` : '') +
    (el.classList.length ? `.${[...el.classList].join('.')}` : '');
  const text = (el) => (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 36);
  const effBg = (el) => {
    const chain = [];
    let img = false;
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      chain.push(parse(s.backgroundColor));
      if (s.backgroundImage !== 'none' && e !== document.body && e !== document.documentElement)
        img = true;
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = chain.length - 1; i >= 0; i--)
      if (chain[i] && chain[i].a > 0) bg = over(chain[i], bg);
    return { bg, img };
  };
  const value = (el, key) => {
    let pseudo = null;
    let prop = key;
    if (key.startsWith('before.') || key.startsWith('after.')) {
      [pseudo, prop] = key.split('.');
      pseudo = `::${pseudo}`;
    }
    const s = getComputedStyle(el, pseudo);
    const r = el.getBoundingClientRect();
    if (prop === 'h' || prop === 'hMin') return Math.round(r.height);
    if (prop === 'w') return Math.round(r.width);
    if (prop === 'linkTexts') return [...el.querySelectorAll('a')].map((a) => a.innerText.trim());
    let v = s[prop];
    if (prop === 'fontFamily') v = fam(v);
    if (/color$/i.test(prop) || prop === 'color' || prop === 'backgroundColor') v = tok(v);
    return v;
  };
  const results = [];
  const fail = (id, detail) => results.push({ id, ok: false, detail });
  const pass = (id) => results.push({ id, ok: true });

  // readiness
  if (
    document.querySelector(
      'main[aria-hidden="true"], header[aria-hidden="true"], .app-sidebar[aria-hidden="true"], footer[aria-hidden="true"]',
    )
  )
    fail('page.ready', 'main/header/sidebar/footer still aria-hidden (loader not skipped)');
  else pass('page.ready');

  // component spec
  // 'phone' is every width of 720px and narrower, 'wide' every width over it.
  const atMatch = (at) =>
    at === 'any' ||
    (at === 'desktop' && ctx.width === 1440) ||
    (at === 'mobile' && ctx.width === 390) ||
    (at === 'phone' && ctx.width <= 720) ||
    (at === 'wide' && ctx.width > 720);
  for (const spec of ctx.spec) {
    const groups = [spec.group].flat();
    const group = ctx.group || (ctx.entry ? 'entry' : 'internal');
    if (!groups.includes('all') && !groups.includes(group)) continue;
    if (spec.skipPages?.includes(ctx.page)) continue;
    if (!atMatch(spec.at)) continue;
    if (spec.skipWhen && document.querySelector(spec.skipWhen)) continue;
    const els = [...document.querySelectorAll(spec.sel)].filter((e) =>
      spec.sel === 'body' ? true : visible(e) || e.classList.contains('skip-link'),
    );
    const optional =
      spec.optional === true ||
      // An email preview has no app chrome: its shared parts are checked only where present.
      ctx.group === 'preview' ||
      (Array.isArray(spec.optional) && spec.optional.includes(ctx.page)) ||
      (Array.isArray(spec.required) && !spec.required.includes(ctx.page));
    if (!els.length) {
      if (optional) continue;
      fail(spec.id, `no visible element for ${spec.sel}`);
      continue;
    }
    const targets = spec.all ? els : [els[0]];
    const problems = [];
    for (const el of targets) {
      for (const [k, want] of Object.entries(spec.expect)) {
        const got = value(el, k);
        let ok;
        if (k === 'hMin') ok = got >= want;
        else if (k === 'h' || k === 'w') ok = Math.abs(got - want) <= 1;
        else if (k === 'linkTexts') ok = JSON.stringify(got) === JSON.stringify(want);
        else ok = String(got) === String(want);
        if (!ok)
          problems.push(
            `${sel(el)}«${text(el)}» ${k}=${JSON.stringify(got)} want ${JSON.stringify(want)}`,
          );
      }
    }
    if (problems.length)
      fail(
        spec.id,
        problems.slice(0, 8).join(' | ') +
          (problems.length > 8 ? ` …(+${problems.length - 8})` : ''),
      );
    else pass(spec.id);
  }

  // global: text size, contrast, color palette
  const small = [];
  const contrast = [];
  const palette = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION'].includes(el.tagName)) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (!visible(el) || exempt(el)) continue;
    const s = getComputedStyle(el);
    const fs = Number.parseFloat(s.fontSize);
    const isTagline = el.matches('.brand-note, .mini-wordmark-note');
    if (fs < 12 && !isTagline) small.push(`${sel(el)}«${text(el)}» ${s.fontSize}`);
    const col = parse(s.color);
    const { bg, img } = effBg(el);
    const cr = ratio(over(col, bg), bg);
    const large = fs >= 24 || (fs >= 18.66 && Number.parseInt(s.fontWeight, 10) >= 700);
    if (cr < (large ? 3 : 4.5))
      contrast.push(
        `${sel(el)}«${text(el)}» ${tok(s.color)} on ${hex(bg)}${img ? '(+img)' : ''} = ${cr.toFixed(2)}`,
      );
    const t = tok(s.color);
    if (!ALLOWED_TEXT.has(t)) palette.push(`${sel(el)}«${text(el)}» ${t}`);
  }
  small.length
    ? fail(
        'text.min-size-12',
        small.slice(0, 12).join(' | ') + (small.length > 12 ? ` …(+${small.length - 12})` : ''),
      )
    : pass('text.min-size-12');
  contrast.length
    ? fail(
        'text.contrast-AA',
        contrast.slice(0, 10).join(' | ') +
          (contrast.length > 10 ? ` …(+${contrast.length - 10})` : ''),
      )
    : pass('text.contrast-AA');
  palette.length
    ? fail(
        'text.palette',
        palette.slice(0, 10).join(' | ') +
          (palette.length > 10 ? ` …(+${palette.length - 10})` : ''),
      )
    : pass('text.palette');

  // global: targets
  const targets = [];
  for (const el of document.querySelectorAll(
    'a[href], button, summary, select, textarea, input:not([type=hidden])',
  )) {
    if (!visible(el) || exempt(el)) continue;
    let box = el.getBoundingClientRect();
    if (el.matches('input[type=checkbox], input[type=radio]')) {
      const label =
        el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`));
      if (label) box = label.getBoundingClientRect();
    }
    if (el.matches('.skip-link')) continue;
    // A stretched link's ::after covers its positioned row (the live table), so the row is the
    // target.
    const after = getComputedStyle(el, '::after');
    if (
      after.content !== 'none' &&
      after.position === 'absolute' &&
      ['top', 'right', 'bottom', 'left'].every((side) => after[side] === '0px')
    ) {
      let host = el.parentElement;
      while (host && getComputedStyle(host).position === 'static') host = host.parentElement;
      if (host) box = host.getBoundingClientRect();
    }
    if (Math.round(box.height) < 44)
      targets.push(`${sel(el)}«${text(el)}» ${Math.round(box.height)}px`);
  }
  targets.length ? fail('target.min-44', targets.slice(0, 10).join(' | ')) : pass('target.min-44');

  // global: single-line controls must not wrap
  const wrapped = [];
  const controlSel =
    'button, .button, .primary-action, .secondary-action, .compact-action, .header-action, .footer-link, .text-link, .secondary-link, .compact-button, .pager-button, .summary-state, .status-pill, .tag, .activity-status, .material-status, .editor-status, .document-default, .document-type, .choice-current, .role-chip, .choice-chip, .feedback-panel-action';
  for (const el of document.querySelectorAll(controlSel)) {
    if (!visible(el) || exempt(el)) continue;
    // Round 7 (T2-21, SJ's request 9): a Searches source's toggle carries the source's name, which
    // wraps on purpose rather than being cut short; (T2b-5) the combinations table's sort headers
    // wrap between their words on a tablet so the seven columns fit.
    if (
      el.matches(
        '.account-link, .job-select, .activity-item, .source-summary, .story-toggle, .story-step, .srch-toggle, .permutations-wrap .data-table-sort',
      )
    )
      continue;
    const t = (el.innerText || '').trim();
    if (!t || t.includes('\n') || t.length > 44) continue;
    // Lines are counted from the control's text. Every other box in it (an icon, for example) must
    // overlap that line, so an icon beside one line of text is not a wrap but one below it is.
    const range = document.createRange();
    range.selectNodeContents(el);
    const boxes = [...range.getClientRects()].filter((x) => x.width > 1);
    const textBoxes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const part = document.createRange();
      part.selectNodeContents(node);
      textBoxes.push(...[...part.getClientRects()].filter((x) => x.width > 1));
    }
    const tops = new Set(textBoxes.map((x) => Math.round(x.top / 3)));
    const line = textBoxes[0];
    const offLine =
      line &&
      boxes.some(
        (x) =>
          Math.min(x.bottom, line.bottom) - Math.max(x.top, line.top) <
          0.5 * Math.min(x.height, line.height),
      );
    if (tops.size > 1 || offLine) wrapped.push(`${sel(el)}«${text(el)}»`);
  }
  wrapped.length
    ? fail('control.no-wrap', wrapped.slice(0, 10).join(' | '))
    : pass('control.no-wrap');

  // global: data.metric-matches and data.metric-once (round 3, R3-3 and R3-4). Every figure in
  // main equals the shared sample world's text for its key, and no key repeats on the page outside
  // the flow ribbon and nav badges. Live-run counters (runs.*, sources.live) change between a page's
  // once-a-second redraw and this read, so they are not compared.
  const sampleStore = window.JobDeputyStore;
  if (sampleStore?.metricText) {
    const norm = (value) =>
      String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    const figures = [...document.querySelectorAll('main [data-metric]')].filter(
      (el) =>
        visible(el) && !el.closest('.flow-ribbon, .app-nav-count, [hidden], dialog:not([open])'),
    );
    const mismatched = [];
    const seen = new Map();
    for (const el of figures) {
      const key = el.dataset.metric;
      seen.set(key, (seen.get(key) || 0) + 1);
      if (/^runs\./.test(key) || key === 'sources.live') continue;
      const want = norm(sampleStore.metricText(key));
      const shown = norm(el.textContent);
      if (shown !== want) mismatched.push(`${key} shows «${shown}» want «${want}»`);
    }
    const repeated = [...seen].filter(([, count]) => count > 1).map(([k, n]) => `${k} ×${n}`);
    mismatched.length
      ? fail('data.metric-matches', mismatched.slice(0, 8).join(' | '))
      : pass('data.metric-matches');
    repeated.length
      ? fail('data.metric-once', repeated.slice(0, 8).join(' | '))
      : pass('data.metric-once');
  }

  // global: overflow, favicon
  const de = document.scrollingElement;
  de.scrollWidth > de.clientWidth + 1
    ? fail('layout.no-overflow-x', `${de.scrollWidth - de.clientWidth}px`)
    : pass('layout.no-overflow-x');
  document.querySelector('link[rel~="icon"]')
    ? pass('head.favicon')
    : fail('head.favicon', 'no <link rel="icon">');
  // --states re-runs only the global checks in alternate states.
  return ctx.only ? results.filter((r) => ctx.only.includes(r.id)) : results;
}

// App shell checks for internal and setup pages: int.shell, and on internal pages int.footer.inner,
// int.sidebar, int.nav, and (wider than 720px) int.mobile-menu. Serialized into the page, so it
// must be self-contained. It scrolls to test stickiness and opens the phone menu to measure rows,
// and restores both.
function shellAudit(ctx) {
  const results = [];
  const verdict = (id, problems) =>
    results.push(
      problems.length
        ? {
            id,
            ok: false,
            detail:
              problems.slice(0, 8).join(' | ') +
              (problems.length > 8 ? ` …(+${problems.length - 8})` : ''),
          }
        : { id, ok: true },
    );
  const box = (el) => el.getBoundingClientRect();
  const shown = (el) =>
    !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const px = (value) => Math.round(value * 10) / 10;
  const phone = innerWidth <= 720;
  const rail = innerWidth > 720 && innerWidth <= 1100;
  const short = innerWidth > 1100 && innerHeight <= 820;
  const rgb = (value) => (String(value).match(/[\d.]+/g) || []).map(Number);
  const luminance = ([r, g, b]) => {
    const f = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  // The colour an element's translucent background composites to over its ancestors and white.
  const backdrop = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) layers.push(rgb(getComputedStyle(e).backgroundColor));
    let [r, g, b] = [255, 255, 255];
    for (const [lr, lg, lb, la = 1] of layers.reverse()) {
      if (lr === undefined || !la) continue;
      [r, g, b] = [lr * la + r * (1 - la), lg * la + g * (1 - la), lb * la + b * (1 - la)];
    }
    return [r, g, b];
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // int.shell: min(1280px, main − 42px) wide, main − 26px on phones, centred in main.
  const main = document.querySelector('main');
  const shell = document.querySelector('main .page-shell');
  const shellProblems = [];
  if (!main || !shell) shellProblems.push('no main .page-shell');
  else {
    const m = box(main);
    const s = box(shell);
    const want = Math.min(1280, m.width - (phone ? 26 : 42));
    if (Math.abs(s.width - want) > 1)
      shellProblems.push(`width ${px(s.width)} want ${px(want)} (main ${px(m.width)})`);
    if (Math.abs(s.left - m.left - (m.right - s.right)) > 1)
      shellProblems.push(`not centred in main (${px(s.left - m.left)} | ${px(m.right - s.right)})`);
  }
  verdict('int.shell', shellProblems);
  if (ctx.group !== 'internal') return results;

  // int.footer.inner: the footer content shares the page shell's edges.
  const inner = document.querySelector('.site-footer .footer-inner');
  const footerProblems = [];
  if (!inner || !shell) footerProblems.push('no .footer-inner or .page-shell');
  else {
    const a = box(inner);
    const b = box(shell);
    if (Math.abs(a.left - b.left) > 1 || Math.abs(a.right - b.right) > 1)
      footerProblems.push(
        `footer ${px(a.left)}–${px(a.right)} vs shell ${px(b.left)}–${px(b.right)}`,
      );
  }
  verdict('int.footer.inner', footerProblems);

  const sidebar = document.querySelector('.app-sidebar');
  const toggle = document.querySelector('.app-menu-toggle');
  const header = document.querySelector('.app-header');
  if (ctx.page === 'trust-public') {
    // The public Help page is an entry destination: no sidebar, no deputy, no menu.
    const problems = [];
    if (shown(sidebar)) problems.push('sidebar visible');
    if ([...document.querySelectorAll('[data-deputy]')].some(shown))
      problems.push('deputy visible');
    verdict('int.sidebar', problems);
    return results;
  }

  // int.sidebar
  const sidebarProblems = [];
  if (!shown(sidebar)) sidebarProblems.push('no visible .app-sidebar');
  else {
    const s = box(sidebar);
    const style = getComputedStyle(sidebar);
    // Scroll to the middle and to the end of the page and read the chrome again each time.
    const scrollTargets = () => {
      const max = document.scrollingElement.scrollHeight - innerHeight;
      return max > 21 ? [Math.round(max / 2), max] : [];
    };
    const before = scrollY;
    if (phone) {
      if (style.position !== 'sticky' && style.position !== 'fixed')
        sidebarProblems.push(`app bar is ${style.position}, want sticky`);
      if (style.position === 'sticky' && style.top !== '64px')
        sidebarProblems.push(`app bar top ${style.top}, want 64px`);
      if (Math.abs(s.width - document.documentElement.clientWidth) > 1)
        sidebarProblems.push(`app bar ${px(s.width)}px wide`);
      if (header && Math.abs(s.top - box(header).bottom) > 1)
        sidebarProblems.push(`app bar top ${px(s.top)} under header ${px(box(header).bottom)}`);
      if (s.bottom > 120.5)
        sidebarProblems.push(`fixed chrome ends at ${px(s.bottom)}, want 120 or less`);
      for (const top of scrollTargets()) {
        window.scrollTo({ top, behavior: 'instant' });
        const now = box(sidebar);
        const headerNow = header ? box(header) : null;
        if (headerNow && Math.abs(headerNow.top) > 1)
          sidebarProblems.push(`header top ${px(headerNow.top)} after scrolling to ${top}`);
        if (headerNow && Math.abs(now.top - headerNow.bottom) > 1)
          sidebarProblems.push(`app bar top ${px(now.top)} after scrolling to ${top}`);
      }
    } else {
      const width = rail ? 89 : 233;
      if (Math.abs(s.width - width) > 0.5)
        sidebarProblems.push(`width ${px(s.width)} want ${width}`);
      if (style.position !== 'fixed' || style.top !== '72px')
        sidebarProblems.push(`position ${style.position} top ${style.top}, want fixed 72px`);
      if (Math.abs(s.height - (innerHeight - 72)) > 1)
        sidebarProblems.push(`height ${px(s.height)} want ${innerHeight - 72}`);
      const slot = sidebar.querySelector('.app-sidebar-deputy');
      const slotWidth = rail ? 81 : 207;
      if (!slot) sidebarProblems.push('no .app-sidebar-deputy');
      else if (Math.abs(box(slot).width - slotWidth) > 0.5)
        sidebarProblems.push(`deputy slot ${px(box(slot).width)} want ${slotWidth}`);
      // The sidebar stays at 72px to the very end of the page, footer included.
      for (const top of scrollTargets()) {
        window.scrollTo({ top, behavior: 'instant' });
        const now = box(sidebar);
        if (Math.abs(now.top - 72) > 1 || Math.abs(now.bottom - innerHeight) > 1)
          sidebarProblems.push(`at ${px(now.top)}–${px(now.bottom)} after scrolling to ${top}`);
      }
    }
    window.scrollTo({ top: before, behavior: 'instant' });
  }
  verdict('int.sidebar', sidebarProblems);

  // int.nav: open the phone menu to measure its rows, then restore it.
  const navProblems = [];
  const opened = phone && toggle && toggle.getAttribute('aria-expanded') === 'false';
  if (opened) toggle.click();
  const links = [...document.querySelectorAll('.app-nav .app-nav-link')];
  if (links.length !== 8) navProblems.push(`${links.length} nav links`);
  const height = phone ? 48 : rail ? 64 : short ? 44 : 48;
  for (const link of links) {
    const label = link.querySelector('.app-nav-label');
    const name = (label?.textContent || '?').trim();
    if (!shown(link) || !label) {
      navProblems.push(`${name} not shown`);
      continue;
    }
    const r = box(link);
    if (rail ? r.height < height - 0.5 : Math.abs(r.height - height) > 0.5)
      navProblems.push(`${name} ${px(r.height)}px want ${rail ? 'at least ' : ''}${height}px`);
    // Not clipped: the label's text lies inside its link and inside the sidebar's visible box.
    const range = document.createRange();
    range.selectNodeContents(label);
    const t = range.getBoundingClientRect();
    const clip = box(sidebar);
    if (
      t.left < r.left - 0.5 ||
      t.right > r.right + 0.5 ||
      t.left < clip.left - 0.5 ||
      t.right > clip.right + 0.5 ||
      label.scrollWidth > label.clientWidth + 1
    )
      navProblems.push(
        `${name} label clipped (${px(t.left)}–${px(t.right)} in ${px(r.left)}–${px(r.right)})`,
      );
  }
  // One current link, visibly different: a 3px green leading border (3:1 against the sidebar),
  // the surface fill, and an ink 700 label.
  const current = links.filter((link) =>
    link.matches('[aria-current="page"], [aria-current="true"]'),
  );
  // Invite friends has no nav item: its header link is the current place instead. Round 6 (T1):
  // the Shop is Purchases, a Settings tab, so it marks Settings like the other tabs.
  const headerCurrent = ctx.page === 'invite';
  if (headerCurrent) {
    if (current.length)
      navProblems.push(`${current.length} current links on a page without a nav item`);
    if (headerCurrent && !document.querySelector('.app-header .header-invite[aria-current="page"]'))
      navProblems.push('the header Invite link is not marked current');
  } else if (current.length !== 1) navProblems.push(`${current.length} current links`);
  else {
    const style = getComputedStyle(current[0]);
    const lead = rgb(style.borderLeftColor);
    if (style.borderLeftWidth !== '3px' || style.borderLeftStyle !== 'solid')
      navProblems.push(`current border ${style.borderLeftWidth} ${style.borderLeftStyle}`);
    if (lead.slice(0, 3).join() !== '47,158,119')
      navProblems.push(`current border ${style.borderLeftColor}`);
    else if (contrast(lead, backdrop(sidebar)) < 3)
      navProblems.push(`current border contrast ${contrast(lead, backdrop(sidebar)).toFixed(2)}`);
    if (style.backgroundColor !== 'rgba(255, 255, 255, 0.82)')
      navProblems.push(`current background ${style.backgroundColor}`);
    if (style.fontWeight !== '700' || style.color !== 'rgb(27, 26, 24)')
      navProblems.push(`current label ${style.fontWeight} ${style.color}`);
    const idle = links.find((link) => link !== current[0]);
    if (idle && getComputedStyle(idle).borderLeftWidth !== '1px')
      navProblems.push(`idle border ${getComputedStyle(idle).borderLeftWidth}`);
  }
  if (opened) toggle.click();
  verdict('int.nav', navProblems);

  // int.mobile-menu, wide half: no Menu button, and the list is always shown. (720px and narrower
  // are driven with real input in main().)
  if (!phone) {
    const problems = [];
    if (shown(toggle)) problems.push('Menu button visible');
    if (!shown(document.querySelector('#app-nav'))) problems.push('list hidden');
    verdict('int.mobile-menu', problems);
  }
  return results;
}

// Story-shell geometry for login-versus-access parity (rounded CSS pixels).
function storyGeometry() {
  const box = (q) => {
    const e = document.querySelector(q);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.x, r.y + window.scrollY, r.width, r.height].map((v) => Math.round(v));
  };
  return {
    rows: getComputedStyle(document.querySelector('.story-panel')).gridTemplateRows,
    panel: box('.story-panel'),
    copy: box('.story-copy'),
    title: box('.story-title'),
    stage: box('.panda-stage'),
    task: box('.auth-panel, .task-panel'),
    heading: box('.auth-title, .form-heading h1'),
  };
}

// ---------------------------------------------------------------- opt-in in-page probes
// Each probe is serialized with toString() and evaluated in the page, so it must be self-contained.

// Running or pending animations that loop or outlast opts.maxMs, and (with opts.transitions) story
// and panda transitions longer than opts.maxMs.
function motionAudit(opts) {
  const name = (el) =>
    el
      ? el.tagName.toLowerCase() +
        (el.id ? `#${el.id}` : '') +
        (el.classList?.length ? `.${[...el.classList].join('.')}` : '')
      : '?';
  const loops = [];
  const long = [];
  for (const animation of document.getAnimations()) {
    if (animation.playState !== 'running' && !animation.pending) continue;
    const effect = animation.effect;
    const timing = effect?.getComputedTiming ? effect.getComputedTiming() : {};
    const label =
      animation.animationName ||
      (animation.transitionProperty ? `transition:${animation.transitionProperty}` : '') ||
      animation.id ||
      'script animation';
    const where = `${name(effect?.target)}${effect?.pseudoElement || ''}`;
    if (timing.iterations === Number.POSITIVE_INFINITY)
      loops.push(`${where} ${label} ${Math.round(Number(timing.duration) || 0)}ms×∞`);
    else if (timing.activeDuration > opts.maxMs)
      long.push(`${where} ${label} ${Math.round(timing.activeDuration)}ms`);
  }
  const transitions = [];
  if (opts.transitions) {
    const ms = (value) =>
      value.trim().endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
    const seen = new Set();
    for (const el of document.querySelectorAll('.story-panel, .story-panel *')) {
      if (!el.getClientRects().length) continue;
      for (const pseudo of [null, '::before', '::after']) {
        const style = getComputedStyle(el, pseudo);
        if (pseudo && style.content === 'none') continue;
        const durations = style.transitionDuration.split(',').map(ms);
        const properties = style.transitionProperty.split(',').map((p) => p.trim());
        for (const [index, property] of properties.entries()) {
          const duration = durations[index % durations.length];
          if (property === 'none' || !(duration > opts.maxMs)) continue;
          const item = `${name(el)}${pseudo || ''} ${property} ${Math.round(duration)}ms`;
          if (!seen.has(item)) {
            seen.add(item);
            transitions.push(item);
          }
        }
      }
    }
  }
  return { loops, long, transitions };
}

// text.no-overlap, stage.face-clear, and speech.visible for the current entry scene or state.
function sceneAudit() {
  const q = (s) => document.querySelector(s);
  const name = (el) =>
    el.tagName.toLowerCase() +
    (el.id ? `#${el.id}` : '') +
    (el.classList?.length ? `.${[...el.classList].join('.')}` : '');
  const px = (v) => Number.parseFloat(v) || 0;
  const opacity = (el) => {
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= Number.parseFloat(getComputedStyle(e).opacity);
    return o;
  };
  const shown = (el) => {
    if (!el?.getClientRects().length) return false;
    for (let e = el; e; e = e.parentElement)
      if (getComputedStyle(e).display === 'none') return false;
    return getComputedStyle(el).visibility === 'visible' && opacity(el) > 0.05;
  };
  const textRects = (el) => {
    const rects = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || node.parentElement.closest('.sr-only')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) rects.push(r);
    }
    return rects;
  };
  const overlap = (a, b) => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 1 && h > 1 ? `${Math.round(w)}×${Math.round(h)}px` : '';
  };
  // A pseudo-element rule is measurable when it is absolutely positioned or a flex-row item of an
  // element without a scale or rotation.
  const pseudoRect = (el, pseudo) => {
    const host = getComputedStyle(el);
    const rule = getComputedStyle(el, pseudo);
    const w = px(rule.width);
    const h = px(rule.height);
    if (rule.content === 'none' || rule.display === 'none' || !(w > 0 && h > 0)) return null;
    const matrix = host.transform.match(/^matrix\(([^)]+)\)$/);
    const linear = matrix ? matrix[1].split(',').slice(0, 4).map(Number).join() : '1,0,0,1';
    if (host.transform !== 'none' && linear !== '1,0,0,1') return null;
    const r = el.getBoundingClientRect();
    const left = r.left + px(host.borderLeftWidth);
    const top = r.top + px(host.borderTopWidth);
    if (rule.position === 'absolute') {
      const x = left + px(rule.left);
      const y = top + px(rule.top);
      return { left: x, top: y, right: x + w, bottom: y + h };
    }
    if (rule.position !== 'static' || !/flex/.test(host.display) || host.flexDirection !== 'row')
      return null;
    const x = left + px(host.paddingLeft);
    const contentTop = top + px(host.paddingTop);
    const contentHeight =
      r.height -
      px(host.borderTopWidth) -
      px(host.borderBottomWidth) -
      px(host.paddingTop) -
      px(host.paddingBottom);
    const y = host.alignItems === 'center' ? contentTop + (contentHeight - h) / 2 : contentTop;
    return { left: x, top: y, right: x + w, bottom: y + h };
  };
  const results = [];

  // text.no-overlap: story copy text boxes against everything else drawn in the story panel.
  const obstacles = [];
  const word = q('#capability-word');
  if (shown(word)) {
    for (const r of textRects(word)) obstacles.push(['capability-word', r]);
    const rule = pseudoRect(word, '::before');
    if (rule) obstacles.push(['capability-word::before', rule]);
  }
  for (const [label, selector] of [
    ['story-controls', '.story-controls'],
    ['chapter-steps', '.capability-progress, .story-strip'],
    ['panda-speech', '#panda-speech'],
    ['duty-status', '#duty-status, #panda-status'],
  ]) {
    const el = q(selector);
    if (shown(el) && (label !== 'panda-speech' || el.textContent.trim()))
      obstacles.push([label, el.getBoundingClientRect()]);
  }
  const roles = { eyebrow: 'eyebrow', 'story-title': 'title', 'story-body': 'body' };
  const clashes = new Set();
  for (const item of q('#story-copy')?.children || []) {
    if (!shown(item) || item.matches('.sr-only')) continue;
    const label = roles[[...item.classList].find((c) => roles[c])] || name(item);
    for (const r of textRects(item))
      for (const [what, o] of obstacles) {
        const hit = overlap(r, o);
        if (hit) clashes.add(`${label}×${what} ${hit}`);
      }
  }
  results.push(
    clashes.size
      ? { id: 'text.no-overlap', ok: false, detail: [...clashes].slice(0, 8).join(' | ') }
      : { id: 'text.no-overlap', ok: true },
  );

  // speech.visible: measured before stage.face-clear may scroll the stage into view.
  const speech = q('#panda-speech');
  const said = speech ? speech.textContent.replace(/\s+/g, ' ').trim() : '';
  if (speech && said) {
    const problems = [];
    let hidden = !speech.getClientRects().length;
    for (let e = speech; e && !hidden; e = e.parentElement)
      if (getComputedStyle(e).display === 'none') hidden = true;
    if (hidden) problems.push('display:none');
    else {
      const own = getComputedStyle(speech);
      if (own.visibility !== 'visible') problems.push(`visibility:${own.visibility}`);
      const o = opacity(speech);
      if (o <= 0.5) problems.push(`opacity ${o.toFixed(2)}`);
      const r = speech.getBoundingClientRect();
      if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)
        problems.push(
          `outside the ${innerWidth}×${innerHeight} viewport at [${[r.left, r.top, r.right, r.bottom].map(Math.round)}]`,
        );
      for (let e = speech.parentElement; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e);
        const clips = s.clipPath !== 'none';
        const clipX = clips || s.overflowX !== 'visible';
        const clipY = clips || s.overflowY !== 'visible';
        if (!clipX && !clipY) continue;
        const b = e.getBoundingClientRect();
        const outX =
          clipX &&
          (r.left < b.left + px(s.borderLeftWidth) - 1 ||
            r.right > b.right - px(s.borderRightWidth) + 1);
        const outY =
          clipY &&
          (r.top < b.top + px(s.borderTopWidth) - 1 ||
            r.bottom > b.bottom - px(s.borderBottomWidth) + 1);
        if (outX || outY) {
          problems.push(`clipped by ${name(e)}`);
          break;
        }
      }
      const overflows =
        (own.overflowX !== 'visible' && speech.scrollWidth > speech.clientWidth + 1) ||
        (own.overflowY !== 'visible' && speech.scrollHeight > speech.clientHeight + 1);
      const spills = textRects(speech).some(
        (t) =>
          t.left < r.left - 1 ||
          t.right > r.right + 1 ||
          t.top < r.top - 1 ||
          t.bottom > r.bottom + 1,
      );
      if (overflows || spills) problems.push('text does not fit its bubble');
    }
    results.push(
      problems.length
        ? {
            id: 'speech.visible',
            ok: false,
            detail: `«${said.slice(0, 48)}» ${problems.join(', ')}`,
          }
        : { id: 'speech.visible', ok: true },
    );
  }

  // stage.face-clear: hit-test the head and eyes; a sample point is covered when a visible, painted
  // scene-prop element is stacked above the panda shape there.
  const head = q('.panda-head');
  if (head && shown(head)) {
    const eyes = [...new Set([...head.querySelectorAll('.pupil')].map((p) => p.parentElement))]
      .filter((e) => e && e !== head)
      .concat(head.querySelector('.pupil') ? [] : [...head.querySelectorAll('.eye, .panda-eye')]);
    const props = [...document.querySelectorAll('.capability-prop, .scene-object')];
    const propOf = (el) => props.find((p) => p.contains(el)) || null;
    const alpha = (c) => {
      const m = String(c).match(/rgba?\(([^)]+)\)/);
      if (!m) return 0;
      const p = m[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return p.length > 3 ? p[3] : 1;
    };
    const painted = new Map();
    const paints = (el) => {
      if (!painted.has(el)) {
        const s = getComputedStyle(el);
        painted.set(
          el,
          s.visibility === 'visible' &&
            opacity(el) > 0.05 &&
            (alpha(s.backgroundColor) > 0.05 ||
              s.backgroundImage !== 'none' ||
              (px(s.borderTopWidth) > 0 && alpha(s.borderTopColor) > 0.05) ||
              el instanceof SVGElement ||
              el.tagName === 'IMG' ||
              [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())),
        );
      }
      return painted.get(el);
    };
    const hr = head.getBoundingClientRect();
    if (hr.top < 0 || hr.bottom > innerHeight) head.scrollIntoView({ block: 'center' });
    const lift = document.createElement('style');
    lift.textContent = '.panda-stage, .panda-stage * { pointer-events: auto !important; }';
    document.head.append(lift);
    const cover = (part, steps) => {
      const r = part.getBoundingClientRect();
      let seen = 0;
      let covered = 0;
      const by = new Set();
      for (let i = 0; i < steps; i += 1)
        for (let j = 0; j < steps; j += 1) {
          const x = r.left + ((i + 0.5) / steps) * r.width;
          const y = r.top + ((j + 0.5) / steps) * r.height;
          if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
          const stack = document.elementsFromPoint(x, y);
          const at = stack.findIndex((e) => part.contains(e));
          if (at < 0) continue;
          seen += 1;
          const above = stack.slice(0, at).find((e) => propOf(e) && paints(e));
          if (above) {
            covered += 1;
            by.add(name(propOf(above)));
          }
        }
      return { share: seen ? covered / seen : 0, by: [...by].join(', ') };
    };
    try {
      const problems = [];
      const face = cover(head, 36);
      if (face.share > 0.1)
        problems.push(`head ${Math.round(face.share * 100)}% covered by ${face.by}`);
      for (const [index, eye] of eyes.entries()) {
        const e = cover(eye, 12);
        if (e.share > 0)
          problems.push(`eye ${index + 1} ${Math.round(e.share * 100)}% covered by ${e.by}`);
      }
      results.push(
        problems.length
          ? { id: 'stage.face-clear', ok: false, level: 'warning', detail: problems.join(' | ') }
          : { id: 'stage.face-clear', ok: true },
      );
    } finally {
      lift.remove();
    }
  }
  return results;
}

// Story panel height and the height the task actually needs, for layout.fits-viewport. A grid row
// stretches the task panel to the story panel, so the task's need is its content extent (in-flow
// children with margins) plus its own padding and borders, not its box.
function fitAudit() {
  const story = document.querySelector('.story-panel');
  const task = document.querySelector('.auth-panel, .task-panel');
  if (!story || !task) return { applicable: false };
  const px = (v) => Number.parseFloat(v) || 0;
  const header = document.querySelector('.site-header, .app-header');
  const s = story.getBoundingClientRect();
  const k = task.getBoundingClientRect();
  const kids = [...task.children].filter(
    (el) => el.getClientRects().length && !/absolute|fixed/.test(getComputedStyle(el).position),
  );
  let need = k.height;
  if (kids.length) {
    const top = Math.min(
      ...kids.map((el) => el.getBoundingClientRect().top - px(getComputedStyle(el).marginTop)),
    );
    const bottom = Math.max(
      ...kids.map(
        (el) => el.getBoundingClientRect().bottom + px(getComputedStyle(el).marginBottom),
      ),
    );
    const c = getComputedStyle(task);
    need =
      bottom -
      top +
      px(c.paddingTop) +
      px(c.paddingBottom) +
      px(c.borderTopWidth) +
      px(c.borderBottomWidth);
  }
  return {
    applicable: true,
    split: s.right <= k.left + 1 || k.right <= s.left + 1,
    story: Math.round(s.height),
    task: Math.round(need),
    header: header ? Math.round(header.getBoundingClientRect().height) : 0,
    inner: innerHeight,
  };
}

// The focused element after a Shift+Tab, and how many of five sample points the sticky header covers.
async function focusProbe() {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const start = performance.now();
  let last = Number.NaN;
  let still = 0;
  while (still < 3 && performance.now() - start < 900) {
    await frame();
    still = window.scrollY === last ? still + 1 : 0;
    last = window.scrollY;
  }
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { done: true };
  window.__jdFocusSeen = window.__jdFocusSeen || new WeakSet();
  if (window.__jdFocusSeen.has(el)) return { done: true };
  window.__jdFocusSeen.add(el);
  const label =
    el.tagName.toLowerCase() +
    (el.id ? `#${el.id}` : '') +
    (el.classList.length ? `.${[...el.classList].join('.')}` : '');
  const text = (el.innerText || el.getAttribute('aria-label') || el.value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 30);
  const header = [...document.querySelectorAll('header, .app-header, .site-header')].find((h) => {
    const position = getComputedStyle(h).position;
    return (position === 'sticky' || position === 'fixed') && h.getBoundingClientRect().height > 0;
  });
  if (!header || header.contains(el)) return { label, text, covered: 0 };
  const passThrough = getComputedStyle(header).pointerEvents === 'none';
  const r = el.getBoundingClientRect();
  const h = header.getBoundingClientRect();
  let covered = 0;
  for (const [fx, fy] of [
    [0.5, 0.5],
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ]) {
    const x = r.left + r.width * fx;
    const y = r.top + r.height * fy;
    if (x < h.left || x > h.right || y < h.top || y > h.bottom) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === el || el.contains(hit))) continue;
    if (passThrough || header.contains(hit)) covered += 1;
  }
  return { label, text, covered, top: Math.round(r.top), headerBottom: Math.round(h.bottom) };
}

// DOM-level actions that put an account-access route into an alternate state for --states.
async function entryAction(act) {
  const q = (s) => document.querySelector(s);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const submit = q('form button[type="submit"]');
  if (act === 'region') {
    const change = q('[aria-controls="region-choices"]');
    if (!change) return 'no Region Change button';
    change.click();
    await wait(800);
    return '';
  }
  if (!submit) return 'no submit button';
  if (act === 'submit-valid') {
    const put = (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const el of document.querySelectorAll('form input[type="email"]'))
      put(el, 'audit@example.com');
    for (const el of document.querySelectorAll('form input[type="password"]'))
      put(el, 'Audit-Passphrase-2026');
  }
  submit.click();
  const start = performance.now();
  await wait(100);
  while (performance.now() - start < 4000 && q('[aria-busy="true"]')) await wait(100);
  await wait(800);
  return '';
}

// Settled panda pose (computed transforms of the head, arms, and pupils) and speech text. Waits up to
// opts.maxWait for finite animations and transitions on those parts to finish.
async function poseProbe(opts) {
  const parts = [
    ...document.querySelectorAll('.panda-head, .panda-arm, .arm-left, .arm-right, .pupil'),
  ];
  const looping = (a) => a.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY;
  const finite = parts
    .flatMap((el) => el.getAnimations())
    .filter((a) => a.playState === 'running' && !looping(a));
  await Promise.race([
    Promise.all(finite.map((a) => a.finished.catch(() => null))),
    new Promise((resolve) => setTimeout(resolve, opts.maxWait)),
  ]);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const matrix = (el) => {
    const value = getComputedStyle(el).transform;
    if (!value || value === 'none') return [1, 0, 0, 1, 0, 0];
    const n = value
      .slice(value.indexOf('(') + 1, -1)
      .split(',')
      .map(Number);
    return value.startsWith('matrix3d') ? [n[0], n[1], n[4], n[5], n[12], n[13]] : n;
  };
  const pose = {};
  let arm = 0;
  let pupil = 0;
  for (const el of parts) {
    let part;
    if (el.classList.contains('panda-head')) part = 'head';
    else if (el.classList.contains('pupil')) {
      pupil += 1;
      part = `pupil-${pupil}`;
    } else if (el.classList.contains('arm-left')) part = 'arm-left';
    else if (el.classList.contains('arm-right')) part = 'arm-right';
    else {
      arm += 1;
      part = `arm-${arm}`;
    }
    const [a, b, c, d, e, f] = matrix(el);
    const scaleX = Math.hypot(a, b);
    pose[part] = {
      tx: e,
      ty: f,
      rotate: (Math.atan2(b, a) * 180) / Math.PI,
      scaleX,
      scaleY: scaleX ? (a * d - b * c) / scaleX : 0,
      looping: el.getAnimations().some((x) => x.playState === 'running' && looping(x)),
    };
  }
  const speech = (document.querySelector('#panda-speech')?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
  // The page's shared speech table, when it declares one (a global lexical binding).
  const lines = typeof pandaLines === 'undefined' ? null : pandaLines;
  return { pose, speech, lines };
}

// Installed with Page.addScriptToEvaluateOnNewDocument: samples the opening loader every 50ms and
// logs every text change of a live region.
function loaderSampler() {
  if (window.top !== window) return;
  const log = { samples: [], live: [], reveal: null };
  window.__jdLoader = log;
  const liveSelector =
    '[role="status"], [role="alert"], [role="log"], [aria-live]:not([aria-live="off"])';
  const lastText = new Map();
  const noteLive = () => {
    for (const el of document.querySelectorAll(liveSelector)) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (lastText.get(el) === text) continue;
      lastText.set(el, text);
      if (text)
        log.live.push({
          t: Math.round(performance.now()),
          where: el.id || el.getAttribute('class') || el.tagName,
          role: el.getAttribute('role') || `aria-live=${el.getAttribute('aria-live')}`,
          text,
        });
    }
  };
  new MutationObserver(noteLive).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['role', 'aria-live'],
  });
  const sample = () => {
    const loader = document.querySelector('#page-loader, .page-loader');
    const fill = document.querySelector('#loader-progress-fill, .loader-progress-fill');
    const bar = document.querySelector('[role="progressbar"]');
    const main = document.querySelector('main');
    let present = false;
    if (loader?.isConnected) {
      const s = getComputedStyle(loader);
      present = s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
    }
    let visual = null;
    const track = fill?.parentElement;
    if (fill && track) {
      const width = track.getBoundingClientRect().width;
      if (width > 0) visual = (fill.getBoundingClientRect().width / width) * 100;
    }
    const now = bar?.getAttribute('aria-valuenow');
    const locked =
      !main || main.hasAttribute('inert') || main.getAttribute('aria-hidden') === 'true';
    log.samples.push({
      t: Math.round(performance.now()),
      present,
      visual,
      aria: now === null || now === undefined ? null : Number(now),
      status: document.querySelector('#loader-status')?.textContent.trim() ?? null,
      locked,
    });
    if (log.reveal === null && main && !locked && !present)
      log.reveal = Math.round(performance.now());
  };
  sample();
  setInterval(sample, 50);
}

// ---------------------------------------------------------------- CDP plumbing
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = (e) => reject(new Error(`WebSocket error: ${e.message || e.type}`));
      this.ws.onclose = (e) => {
        for (const { reject: no } of this.pending.values())
          no(new Error(`WebSocket closed ${e.code}`));
      };
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: ok, reject: no } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? no(new Error(msg.error.message)) : ok(msg.result);
        } else if (msg.method) for (const l of this.listeners) l(msg);
      };
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  once(method, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeout);
      const listener = (msg) => {
        if (msg.method !== method) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(msg.params);
      };
      this.listeners.add(listener);
    });
  }
}

// ---------------------------------------------------------------- opt-in check runners
// Each runner receives the toolkit built in main(): cdp, evaluate, navigate, viewport, setReduced,
// press, clickAt, record, label, pages, and the viewport lists.
const summarize = (items, limit = 8) =>
  items.slice(0, limit).join(' | ') + (items.length > limit ? ` …(+${items.length - limit})` : '');
const verdict = (id, problems) =>
  problems.length ? { id, ok: false, detail: summarize(problems) } : { id, ok: true };
const reducedMotionResult = (motion) =>
  verdict('motion.reduced-no-loops', [
    ...motion.loops.map((item) => `loops ${item}`),
    ...motion.long.map((item) => `runs ${item}`),
    ...motion.transitions.map((item) => `transition ${item}`),
  ]);
const entryPages = (t) => ENTRY.filter((name) => t.pages.includes(name));
const withoutStatic = (name) => BASE + PAGES[name].replace('&static', '');

// int.mobile-menu at 720px and narrower, with real clicks and key presses: collapsed by default,
// opens and closes from the Menu button, Escape from inside closes it and returns focus to the
// button, activating a link closes it, and crossing the breakpoint collapses it again.
async function mobileMenuProblems(t, width, height) {
  const read = () =>
    t.evaluate(
      () => {
        const toggle = document.querySelector('.app-menu-toggle');
        const list = document.querySelector('#app-nav');
        const shown = (el) => !!el && el.getClientRects().length > 0;
        const bar = document.querySelector('.app-sidebar')?.getBoundingClientRect();
        const style = bar && getComputedStyle(document.querySelector('.app-sidebar'));
        const inset = style
          ? Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
          : 0;
        return {
          toggle: shown(toggle),
          height: toggle ? Math.round(toggle.getBoundingClientRect().height) : 0,
          expanded: toggle?.getAttribute('aria-expanded') ?? null,
          list: shown(list),
          rows: [...document.querySelectorAll('.app-nav-link')].filter(shown).map((link) => {
            const r = link.getBoundingClientRect();
            return [Math.round(r.height), Math.round(bar ? bar.width - inset - r.width : 0)];
          }),
          focus:
            document.activeElement === toggle
              ? 'Menu button'
              : document.activeElement?.className || 'body',
        };
      },
      null,
      'menu state',
    );
  const problems = [];
  let s = await read();
  if (!s.toggle) return ['no visible Menu button'];
  if (s.height < 44) problems.push(`Menu button ${s.height}px`);
  if (s.expanded !== 'false' || s.list)
    problems.push(
      `not collapsed on load (aria-expanded=${s.expanded}, list ${s.list ? 'shown' : 'hidden'})`,
    );
  await t.clickAt('.app-menu-toggle');
  s = await read();
  if (s.expanded !== 'true' || !s.list)
    problems.push(`click did not open (aria-expanded=${s.expanded})`);
  // Full-width 48px rows.
  const rows = s.rows.filter(([rowHeight, gap]) => rowHeight !== 48 || Math.abs(gap) > 1);
  if (s.rows.length !== 8 || rows.length)
    problems.push(
      `rows ${s.rows.map(([h, gap]) => `${h}px${gap ? ` (${gap}px short)` : ''}`).join(' ')}`,
    );
  await t.clickAt('.app-menu-toggle');
  s = await read();
  if (s.expanded !== 'false' || s.list) problems.push('a second click did not close');
  await t.clickAt('.app-menu-toggle');
  await t.evaluate(() => document.querySelector('.app-nav-link')?.focus(), null, 'focus a link');
  await t.press('Escape');
  s = await read();
  if (s.expanded !== 'false' || s.list) problems.push('Escape did not close');
  if (s.focus !== 'Menu button') problems.push(`Escape left focus on ${s.focus}`);
  // Activating a link closes the menu; this link's own listener cancels the navigation.
  await t.clickAt('.app-menu-toggle');
  await t.evaluate(
    () => {
      const link = document.querySelector('.app-nav-link:not([aria-current])');
      link.addEventListener('click', (event) => event.preventDefault(), { once: true });
      link.click();
    },
    null,
    'activate a link',
  );
  s = await read();
  if (s.expanded !== 'false' || s.list) problems.push('activating a link left the menu open');
  await t.clickAt('.app-menu-toggle');
  await t.viewport(1024, height);
  await sleep(120);
  await t.viewport(width, height);
  await sleep(120);
  s = await read();
  if (s.expanded !== 'false' || s.list) problems.push('crossing the breakpoint left the menu open');
  return problems;
}

async function runStates(t) {
  const release = await holdSuccessNavigation(t);
  try {
    await statesAtEveryWidth(t);
  } finally {
    await release();
  }
}

async function statesAtEveryWidth(t) {
  for (const [width, height] of t.viewports) {
    await t.viewport(width, height);
    for (const name of entryPages(t)) {
      for (const { state, query = '', act, url } of ENTRY_STATES[name]) {
        await t.navigate(BASE + (url || PAGES[name]) + query, 1400);
        const problem = act ? await t.evaluate(entryAction, act, `${name} ${state}`) : '';
        const ctx = {
          page: name,
          width,
          entry: true,
          group: 'entry',
          spec: [],
          only: STATE_CHECKS,
        };
        const results = await t.evaluate(pageAudit, ctx, `${name} ${state}`);
        if (problem) results.push({ id: 'states.setup', ok: false, detail: problem });
        t.record(`states: ${name}[${state}]@${t.label(width, height)}`, results);
      }
    }
  }
}

async function runScenes(t) {
  for (const [width, height] of t.viewports) {
    await t.viewport(width, height);
    for (const name of entryPages(t)) {
      const variants = SCENES.map((scene) => `scene=${scene}`);
      if (name === 'login') variants.push(...LOGIN_STATES.map((state) => `state=${state}`));
      for (const variant of variants) {
        await t.navigate(`${BASE + PAGES[name]}&${variant}`, 1000);
        const results = await t.evaluate(sceneAudit, null, `${name} ${variant}`);
        t.record(`scenes: ${name}[${variant}]@${t.label(width, height)}`, results);
      }
    }
  }
}

async function runMotionPause(t) {
  await t.setReduced(false);
  const audit = { maxMs: 1e9, transitions: false };
  for (const [width, height] of t.motionViewports) {
    await t.viewport(width, height);
    for (const name of entryPages(t)) {
      const problems = [];
      await t.navigate(withoutStatic(name), 2600);
      const mode = await t.evaluate(
        () => {
          const toggle = document.querySelector('#story-toggle');
          const was = toggle?.dataset.mode ?? 'missing';
          if (was === 'pause') toggle.click();
          return was;
        },
        null,
        `${name} pause`,
      );
      await sleep(600);
      const paused = await t.evaluate(motionAudit, audit, `${name} paused`);
      const note = mode === 'pause' ? '' : ` (story was not playing: toggle ${mode})`;
      for (const loop of paused.loops) problems.push(`after Pause${note}: ${loop}`);
      await t.navigate(withoutStatic(name), 1200);
      const chapter = await t.evaluate(
        async () => {
          const next = document.querySelector('#story-next');
          for (let i = 0; i < 14 && next && !next.disabled; i += 1) {
            next.click();
            await new Promise((resolve) => setTimeout(resolve, 260));
          }
          return document.querySelector('[data-story-index]')?.dataset.storyIndex ?? '?';
        },
        null,
        `${name} last chapter`,
      );
      await sleep(3000);
      const settled = await t.evaluate(motionAudit, audit, `${name} last chapter`);
      for (const loop of settled.loops)
        problems.push(`chapter ${Number(chapter) + 1} after 3s: ${loop}`);
      t.record(`motion: ${name}@${t.label(width, height)}`, [
        verdict('motion.pause-stops-all', problems),
      ]);
    }
  }
  await t.setReduced(Boolean(args.reduced));
}

async function runFocus(t) {
  await t.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  try {
    for (const [width, height] of t.focusViewports) {
      await t.viewport(width, height);
      for (const name of [...INTERNAL, ...SETUP].filter((page) => t.pages.includes(page))) {
        await t.navigate(BASE + PAGES[name], 1400);
        await t.evaluate(
          () => {
            document.activeElement?.blur();
            window.scrollTo({ top: document.scrollingElement.scrollHeight, behavior: 'instant' });
            return true;
          },
          null,
          `${name} focus start`,
        );
        const problems = [];
        let stops = 0;
        for (; stops < 400; stops += 1) {
          await t.press('Tab', 8);
          const probe = await t.evaluate(focusProbe, null, `${name} focus`);
          if (probe.done) break;
          if (probe.covered)
            problems.push(
              `${probe.label}«${probe.text}» ${probe.covered}/5 points under the header (top ${probe.top}px, header bottom ${probe.headerBottom}px)`,
            );
        }
        const result = verdict('focus.not-obscured', problems);
        result.detail = result.detail ? `${result.detail} · ${stops} stops` : `${stops} stops`;
        t.record(`focus: ${name}@${t.label(width, height)}`, [result]);
      }
      for (const name of entryPages(t)) {
        await t.navigate(BASE + PAGES[name], 1400);
        t.record(`focus: ${name}@${t.label(width, height)}`, [
          verdict('focus.not-lost', await focusLostProblems(t, name)),
        ]);
      }
    }
  } finally {
    await t.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  }
}

// Enter on story Next to the last chapter and Previous back to the first, then (create) Enter on a
// valid submit; document.activeElement must never fall back to <body>.
async function focusLostProblems(t, name) {
  const problems = [];
  const state = (selector) => ({
    disabled: document.querySelector(selector)?.disabled ?? true,
    index: Number(document.querySelector('[data-story-index]')?.dataset.storyIndex ?? -1),
    last: document.querySelectorAll('[data-story-target]').length - 1,
    body: !document.activeElement || document.activeElement === document.body,
  });
  for (const [selector, label, forward] of [
    ['#story-next', 'Next', true],
    ['#story-previous', 'Previous', false],
  ]) {
    const focused = await t.evaluate(
      (s) => {
        const button = document.querySelector(s);
        button?.focus();
        return Boolean(button) && document.activeElement === button;
      },
      selector,
      `${name} ${label}`,
    );
    if (!focused) {
      problems.push(`story ${label} could not take focus`);
      continue;
    }
    for (let press = 0; press < 14; press += 1) {
      const before = await t.evaluate(state, selector, `${name} ${label}`);
      if (before.disabled || (forward ? before.index >= before.last : before.index <= 0)) break;
      await t.press('Enter');
      let after = null;
      for (let sample = 0; sample < 3 && !after?.body; sample += 1) {
        await sleep(100);
        after = await t.evaluate(state, selector, `${name} ${label}`);
      }
      if (after?.body) {
        problems.push(
          `story ${label}: focus fell to <body> after Enter on chapter ${before.index + 1} (now ${after.index + 1})`,
        );
        break;
      }
    }
  }
  if (name !== 'create') return problems;
  const ready = await t.evaluate(
    () => {
      const put = (el, value) => {
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      for (const el of document.querySelectorAll('form input[type="email"]'))
        put(el, 'audit@example.com');
      for (const el of document.querySelectorAll('form input[type="password"]'))
        put(el, 'Audit-Passphrase-2026');
      const submit = document.querySelector('form button[type="submit"]');
      submit?.focus();
      return Boolean(submit) && document.activeElement === submit;
    },
    null,
    'create submit',
  );
  if (!ready) return [...problems, 'create submit could not take focus'];
  await t.press('Enter');
  // Round 5: a new account by email shows one success line, then opens the agreement, like
  // sign-in opens Search home; the new page's focus starts fresh, so the watch ends there.
  const watch = () => ({
    left: !/access-preview\.html$/.test(location.pathname),
    body: !document.activeElement || document.activeElement === document.body,
    done:
      !document.querySelector('[aria-busy="true"]') &&
      (Boolean(document.querySelector('.feedback-panel[data-kind="success"]:not([hidden])')) ||
        document.querySelector('#access-page')?.dataset.pandaState === 'success'),
  });
  let settled = 0;
  for (let ms = 100; ms <= 4000 && settled < 3; ms += 100) {
    await sleep(100);
    const now = await t.evaluate(watch, null, 'create submit');
    if (now.left) break;
    if (now.body) {
      problems.push(
        `create submit: focus fell to <body> ${ms}ms after Enter${now.done ? ' (result shown)' : ''}`,
      );
      break;
    }
    if (now.done) settled += 1;
  }
  return problems;
}

async function runFit(t) {
  const id = 'layout.fits-viewport';
  for (const [width, height] of t.fitSizes) {
    await t.viewport(width, height);
    for (const name of entryPages(t)) {
      await t.navigate(BASE + PAGES[name], 1200);
      const m = await t.evaluate(fitAudit, null, `${name} fit`);
      let result = { id, ok: true, detail: 'no story or task panel' };
      if (m.applicable && !m.split)
        result = { id, ok: true, detail: 'stacked layout, not checked' };
      else if (m.applicable) {
        const limit = Math.max(m.inner - m.header, m.task);
        result =
          m.story <= limit + 1
            ? { id, ok: true }
            : {
                id,
                ok: false,
                detail: `story panel ${m.story}px > max(${m.inner} − header ${m.header}, task ${m.task}) = ${limit}px`,
              };
      }
      t.record(`fit: ${name}@${width}x${height}`, [result]);
    }
  }
}

const FIRST_VIEW_SIZES = [
  [390, 844],
  [375, 667],
  [360, 740],
];

// Runs in the page: where the page's main task sits in the first viewport.
function firstViewAudit(input) {
  const group = typeof input === 'string' ? input : input.group;
  const pageName = typeof input === 'string' ? '' : input.page;
  const shown = (e) => {
    if (!e) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !e.closest('[hidden], .sr-only');
  };
  const first = (selector) => [...document.querySelectorAll(selector)].find(shown) || null;
  const box = (e) => {
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      inside: r.top >= 0 && r.bottom <= innerHeight + 0.5,
    };
  };
  const header = document.querySelector('.site-header, .app-header');
  const headerBottom = header ? Math.round(header.getBoundingClientRect().bottom) : 0;
  const out = { headerBottom, height: innerHeight };
  if (group === 'entry') {
    const form = first('main form');
    out.heading = box(first('main .task-panel h1, main .auth-panel h1, main h1'));
    // Round 6 (G3): the home Region comes first, above every sign-in method, so the first field
    // is the Region control when the form has one; the first method (a provider or the email
    // field) must also start in the first view.
    out.field = box(
      form &&
        [
          ...form.querySelectorAll(
            '.region-field, input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea',
          ),
        ].find(shown),
    );
    out.method = box(
      [
        ...document.querySelectorAll(
          'main button, main input[type=email], main input:not([type=hidden]):not([type=radio]):not([type=checkbox])',
        ),
      ].find(
        (e) =>
          shown(e) &&
          !e.closest('.region-field, .region-choices') &&
          (e.tagName === 'INPUT' || /Continue with|Continue as/.test(e.textContent)),
      ),
    );
    out.primary = box(
      form && [...form.querySelectorAll('button[type=submit], .primary-action')].find(shown),
    );
  } else if (group === 'setup') {
    out.heading = box(first('main h1'));
    out.field = box(
      first(
        'main label.choice-card, main label.quick-pick, main form input:not([type=hidden]):not([type=radio]):not([type=checkbox])',
      ),
    );
    out.primary = box(first('main .primary-action, main button[type=submit]'));
  } else {
    // A role opened from the list on a phone is its own view: it opens so that the role's title is
    // in view (round 5's rule, kept), so its title is the heading that must show.
    out.heading = box((pageName === 'jobs-role' && first('#detail-title')) || first('main h1'));
    out.visual = box(
      first(
        'main .kpi, main figure, main .flow-ribbon, main .board, main .data-table-wrap, main label.choice-card, main .ring, main .stat-row, main .meter, main .quick-pick, main .upload-zone, main .task-surface',
      ),
    );
  }
  return out;
}

async function runFirstView(t) {
  const id = 'layout.first-view';
  const sizes = args.sizes ? t.viewports : FIRST_VIEW_SIZES;
  for (const [width, height] of sizes) {
    await t.viewport(width, height);
    for (const name of t.pages) {
      const group = groupOf(name);
      // An email preview has no app task to find in the first view (round 7).
      if (group === 'preview') continue;
      // The first visit of a new person: no remembered sign-in or earlier sample changes.
      await t.evaluate(
        () => {
          try {
            localStorage.clear();
            sessionStorage.clear();
          } catch {}
        },
        null,
        'clear storage',
      );
      await t.navigate(BASE + PAGES[name], 1400);
      const m = await t.evaluate(firstViewAudit, { group, page: name }, `${name} first view`);
      const problems = [];
      const need = (key, label, rule = 'inside') => {
        const b = m[key];
        if (!b) problems.push(`no visible ${label}`);
        else if (rule === 'inside' && !b.inside)
          problems.push(`${label} at ${b.top} to ${b.bottom}px, viewport ${m.height}px`);
        else if (rule === 'starts' && b.top >= m.height)
          problems.push(`${label} starts at ${b.top}px, below the ${m.height}px viewport`);
      };
      if (group === 'entry') {
        need('heading', 'form heading');
        need('field', 'first field');
        need('method', 'first sign-in method', 'starts');
        if (name === 'login' && width === 390 && height === 844) need('primary', 'primary action');
      } else if (group === 'setup') {
        need('heading', 'question heading');
        if (m.field) need('field', 'first answer');
        need('primary', 'Continue action');
      } else {
        need('heading', 'h1');
        need('visual', 'first visual block', 'starts');
      }
      t.record(`first-view: ${name}@${width}x${height}`, [
        problems.length ? { id, ok: false, detail: problems.join('; ') } : { id, ok: true },
      ]);
    }
  }
}

async function runLoader(t, reduced) {
  const pages = ['login', 'home'].filter((name) => t.pages.includes(name));
  if (!pages.length) return;
  const switched = reduced !== Boolean(args.reduced);
  if (switched) await t.setReduced(reduced);
  await t.viewport(...t.viewports[0]);
  const requests = [];
  const listener = (msg) => {
    if (
      msg.method === 'Network.requestWillBeSent' &&
      msg.params.request.url.includes('jobdeputy-animated.svg')
    )
      requests.push(msg.params.request.url);
  };
  t.cdp.listeners.add(listener);
  await t.cdp.send('Network.enable');
  await t.cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const { identifier } = await t.cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(${loaderSampler.toString()})()`,
  });
  try {
    for (const name of pages) {
      for (const blocked of [false, true]) {
        await t.cdp.send('Network.setBlockedURLs', {
          urls: blocked ? ['*jobdeputy-animated.svg*'] : [],
        });
        requests.length = 0;
        const loaded = t.cdp.once('Page.loadEventFired', 15000).catch(() => null);
        await t.cdp.send('Page.navigate', { url: BASE + PAGES[name].split('?')[0] });
        await loaded;
        let log = null;
        for (let waited = 0; waited < 7000; waited += 250) {
          await sleep(250);
          log = await t.evaluate(() => window.__jdLoader ?? null, null, `${name} loader`);
          if (typeof log?.reveal === 'number' && log.samples.at(-1).t > log.reveal + 1000) break;
        }
        const variant = [blocked && 'SVG blocked', reduced && 'reduced motion']
          .filter(Boolean)
          .join(', ');
        t.record(`loader: ${name}${variant ? ` [${variant}]` : ''}`, [
          loaderResult(log, [...requests], { reduced, blocked }),
        ]);
      }
    }
  } finally {
    t.cdp.listeners.delete(listener);
    await t.cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await t.cdp.send('Network.setBlockedURLs', { urls: [] });
    await t.cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    await t.cdp.send('Network.disable');
    if (switched) await t.setReduced(Boolean(args.reduced));
  }
}

function loaderResult(log, requests, { reduced, blocked }) {
  const id = 'loader.timeline';
  if (!log) return { id, ok: false, detail: 'the loader sampler did not run' };
  const problems = [];
  const limit = reduced ? 400 : 4500;
  if (log.reveal === null) problems.push(`no reveal within ${log.samples.at(-1)?.t ?? 0}ms`);
  else if (log.reveal > limit) problems.push(`reveal at ${log.reveal}ms (limit ${limit}ms)`);
  const shown = log.samples.filter((s) => s.present && s.visual !== null);
  if (!shown.length && !reduced) problems.push('no visible progress fill was sampled');
  const mismatch = shown.find((s) => s.aria !== null && Math.abs(s.visual - s.aria) > 2);
  if (mismatch)
    problems.push(
      `fill ${mismatch.visual.toFixed(1)} vs aria-valuenow ${mismatch.aria} at ${mismatch.t}ms`,
    );
  // The first fall and the first jump; reduced motion may complete in one step.
  const steps = shown.slice(1).map((s, i) => ({ t: s.t, step: s.visual - shown[i].visual }));
  const fell = steps.find((s) => s.step < -0.5);
  const jumped = reduced ? null : steps.find((s) => s.step > 15);
  if (fell) problems.push(`fill fell ${(-fell.step).toFixed(1)} points at ${fell.t}ms`);
  if (jumped) problems.push(`fill jumped ${jumped.step.toFixed(1)} points at ${jumped.t}ms`);
  // Live announcements that belong to the loader: loading, ready, or a percentage.
  const until = (log.reveal ?? Number.POSITIVE_INFINITY) + 1000;
  const related = log.live.filter((e) => e.t <= until && /load|ready|\d\s*%/i.test(e.text));
  const ready = related.filter((e) => /ready|loaded|complete/i.test(e.text));
  const loading = related.filter((e) => /load/i.test(e.text) && !ready.includes(e));
  if (loading.length !== 1 || ready.length !== 1 || related.length > 2) {
    const heard = related
      .slice(0, 3)
      .map((e) => `«${e.text}» ${e.role}`)
      .join(', ');
    problems.push(
      `${loading.length} loading and ${ready.length} ready live announcements in ${related.length} updates${heard ? ` (${heard}${related.length > 3 ? ', …' : ''})` : ''}; want one of each`,
    );
  }
  if (reduced ? requests.length > 1 : requests.length !== 1)
    problems.push(
      `${requests.length} SVG requests${blocked ? ' (blocked)' : ''}: ${requests.map((u) => u.replace(/^.*\//, '')).join(', ')}`,
    );
  return verdict(id, problems);
}

// Sign-in success navigates to Search home after 987ms, and Create account by email to the
// agreement after the same beat (round 5); a 204 answer cancels those navigations so the settled
// success state can be measured. Returns the function that lets navigations through again.
async function holdSuccessNavigation(t) {
  const cancel = (msg) => {
    if (msg.method !== 'Fetch.requestPaused') return;
    t.cdp
      .send('Fetch.fulfillRequest', {
        requestId: msg.params.requestId,
        responseCode: 204,
        responseHeaders: [],
      })
      .catch(() => null);
  };
  t.cdp.listeners.add(cancel);
  await t.cdp.send('Fetch.enable', {
    patterns: [
      { urlPattern: '*home-preview.html*', resourceType: 'Document' },
      { urlPattern: '*agreement-preview.html*', resourceType: 'Document' },
    ],
  });
  return async () => {
    await t.cdp.send('Fetch.disable');
    t.cdp.listeners.delete(cancel);
  };
}

async function runPandaParity(t) {
  const release = await holdSuccessNavigation(t);
  try {
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      await t.viewport(width, height);
      for (const state of PANDA_STATES) {
        const login = await pandaPose(t, 'login', state);
        const create = await pandaPose(t, 'create', state);
        t.record(`parity: panda ${state}@${width}`, [
          verdict('parity.panda-states', comparePoses(login, create)),
        ]);
      }
    }
  } finally {
    await release();
  }
}

// Drives one interaction state with real clicks and typing, then reads the settled pose.
async function pandaPose(t, name, state) {
  await t.navigate(BASE + PAGES[name], 1400);
  const email = 'form input[type="email"]';
  const password = 'form input[type="password"]';
  const submit = 'form button[type="submit"]';
  const missing = [];
  const click = async (selector) => {
    if (!(await t.clickAt(selector))) missing.push(selector);
  };
  let settle = 900;
  let maxWait = 3000;
  if (state === 'email-focus') await click(email);
  else if (state === 'password-focus') await click(password);
  else if (state === 'password-visible') {
    await click(password);
    await click('.password-toggle');
  } else if (state === 'region-open') await click('[aria-controls="region-choices"]');
  else if (state === 'validation-error') await click(submit);
  else {
    await click(email);
    await t.cdp.send('Input.insertText', { text: 'audit@example.com' });
    await click(password);
    await t.cdp.send('Input.insertText', { text: 'Audit-Passphrase-2026' });
    await click(submit);
    settle = 2200;
    if (state === 'submitting') {
      // Both routes stay pending for about 900ms; read the pose before the result arrives.
      settle = args.reduced ? 30 : 700;
      maxWait = 100;
    }
  }
  await sleep(settle);
  const pose = await t.evaluate(poseProbe, { maxWait }, `${name} ${state}`);
  return { ...pose, missing };
}

// Speech must match, except the sign-in and create variants of one entry in the shared pandaLines
// table (for example email.signIn and email.create), which differ by design.
function sameSpeech(login, create) {
  const plain = (text) => text.replace(/[.!…]+$/u, '').trim();
  if (plain(login.speech) === plain(create.speech)) return true;
  if (!login.lines || JSON.stringify(login.lines) !== JSON.stringify(create.lines)) return false;
  const flat = new Map();
  const walk = (node, path) => {
    if (typeof node === 'string') flat.set(path.join('.'), plain(node));
    else if (node && typeof node === 'object')
      for (const [key, value] of Object.entries(node)) walk(value, [...path, key]);
  };
  walk(login.lines, []);
  for (const [path, value] of flat) {
    const segments = path.split('.');
    const at = segments.indexOf('signIn');
    if (at < 0 || value !== plain(login.speech)) continue;
    segments[at] = 'create';
    if (flat.get(segments.join('.')) === plain(create.speech)) return true;
  }
  return false;
}

function comparePoses(login, create) {
  const problems = [];
  if (login.missing.length) problems.push(`login has no ${login.missing.join(', ')}`);
  if (create.missing.length) problems.push(`create has no ${create.missing.join(', ')}`);
  if (!sameSpeech(login, create)) problems.push(`speech «${login.speech}» vs «${create.speech}»`);
  const f = (n) => String(Math.round(n * 10) / 10);
  for (const part of new Set([...Object.keys(login.pose), ...Object.keys(create.pose)])) {
    const a = login.pose[part];
    const b = create.pose[part];
    if (!a || !b) {
      problems.push(`${part} only on ${a ? 'login' : 'create'}`);
      continue;
    }
    if (a.looping || b.looping) {
      if (a.looping !== b.looping)
        problems.push(`${part} loops on ${a.looping ? 'login' : 'create'} only`);
      continue;
    }
    const turn = ((a.rotate - b.rotate + 540) % 360) - 180;
    const diffs = [];
    if (Math.abs(a.tx - b.tx) > 0.5 || Math.abs(a.ty - b.ty) > 0.5)
      diffs.push(`translate ${f(a.tx)},${f(a.ty)} vs ${f(b.tx)},${f(b.ty)}`);
    if (Math.abs(turn) > 0.5) diffs.push(`rotate ${f(a.rotate)}° vs ${f(b.rotate)}°`);
    if (Math.abs(a.scaleX - b.scaleX) > 0.01 || Math.abs(a.scaleY - b.scaleY) > 0.01)
      diffs.push(
        `scale ${a.scaleX.toFixed(2)},${a.scaleY.toFixed(2)} vs ${b.scaleX.toFixed(2)},${b.scaleY.toFixed(2)}`,
      );
    if (diffs.length) problems.push(`${part} ${diffs.join(', ')}`);
  }
  return problems;
}

async function runReducedPass(t) {
  await t.setReduced(true);
  for (const [width, height] of t.motionViewports) {
    await t.viewport(width, height);
    for (const name of t.pages) {
      await t.navigate(BASE + PAGES[name], 1600);
      const motion = await t.evaluate(motionAudit, { maxMs: 50, transitions: true }, name);
      t.record(`reduced: ${name}@${t.label(width, height)}`, [reducedMotionResult(motion)]);
    }
  }
  await t.setReduced(false);
}

async function main() {
  // Node's WebSocket client does not keep the event loop alive on its own.
  const keepAlive = setInterval(() => {}, 1000);
  // Each opt-in family adds navigations, so each one extends the budget.
  const budget = 15 + 10 * OPT_IN.filter(optIn).length + (args.all ? 10 : 0);
  const watchdog = setTimeout(() => {
    console.error(`audit timed out after ${budget} minutes`);
    process.exit(3);
  }, budget * 60000);
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = join(tmpdir(), `jobdeputy-ui-audit-chrome-${port}-${process.pid}`);
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--mute-audio',
      '--force-color-profile=srgb',
      '--remote-allow-origins=*',
      // Chrome's own sandbox and GPU process cannot start inside the agent sandbox.
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const cleanup = () => {
    try {
      chrome.kill('SIGKILL');
    } catch {}
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  };
  process.on('exit', cleanup);
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(150);
    try {
      target = await (
        await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
      ).json();
    } catch {}
  }
  if (!target) throw new Error('Chrome did not start');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: BUDGET_PROBE });
  if (args.reduced)
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
  if (args.shots) mkdirSync(SHOTS_DIR, { recursive: true });
  const report = {};
  let failures = 0;
  let optInRan = false;
  const evaluate = async (fn, arg, label) => {
    const out = await cdp.send('Runtime.evaluate', {
      expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (out.exceptionDetails)
      throw new Error(
        `${label}: ${out.exceptionDetails.exception?.description || out.exceptionDetails.text}`,
      );
    return out.result.value;
  };
  const keyCodes = { Tab: 9, Enter: 13, Escape: 27 };
  const t = {
    cdp,
    evaluate,
    label: viewportLabel,
    pages: pageNames,
    viewports,
    motionViewports:
      args.sizes || args.widths
        ? viewports
        : [
            [1440, 900],
            [390, 844],
          ],
    fitSizes: args.sizes ? viewports : FIT_SIZES,
    async navigate(url, settle) {
      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url });
      await loaded;
      await sleep(settle);
    },
    viewport: (width, height) => emulate(cdp, width, height),
    setReduced: (on) =>
      cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }],
      }),
    // A real key press; modifiers 8 is Shift.
    async press(key, modifiers = 0) {
      const code = keyCodes[key];
      const base = { key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
      const typed = key === 'Enter' ? { type: 'keyDown', text: '\r', unmodifiedText: '\r' } : {};
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        ...base,
        modifiers,
        ...typed,
      });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base, modifiers });
      // Headless Chrome stops producing frames after a dispatched Escape (the page still gets the
      // keydown). Bringing the page to the front resumes them, so requestAnimationFrame and media
      // query changes keep working for every later check.
      if (key === 'Escape') await cdp.send('Page.bringToFront');
    },
    // A real mouse click at the centre of the first match, scrolled into view first.
    async clickAt(selector) {
      const point = await evaluate(
        (s) => {
          const el = document.querySelector(s);
          if (!el) return null;
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
          const r = el.getBoundingClientRect();
          return [r.left + r.width / 2, r.top + r.height / 2];
        },
        selector,
        `click ${selector}`,
      );
      if (!point) return false;
      const [x, y] = point;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      for (const type of ['mousePressed', 'mouseReleased'])
        await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      await sleep(80);
      return true;
    },
    record(key, results) {
      optInRan = true;
      report[key] = results;
      const bad = results.filter((r) => !r.ok);
      failures += bad.length;
      if (!args.quiet || bad.length) {
        console.log(
          `\n${bad.length ? '✗' : '✓'} ${key} — ${results.length - bad.length}/${results.length} checks pass`,
        );
        for (const r of bad)
          console.log(`   FAIL ${r.id}${r.level ? ` (${r.level})` : ''}: ${r.detail}`);
      }
    },
  };
  t.focusViewports = t.motionViewports;
  // --budgets-only: each page at each width, usual (and large with --large), nothing else.
  if (args['budgets-only']) {
    for (const [width, height] of viewports) {
      await t.viewport(width, height);
      for (const name of pageNames) {
        const results = [];
        for (const large of args.large ? [false, true] : [false]) {
          const url = BASE + PAGES[name] + (large ? '&demo=large' : '');
          await t.navigate(url, 1600);
          const read = await evaluate(budgetRead, null, `${name}@${width} budgets`);
          results.push(budgetResult(large ? 'perf.budgets-large' : 'perf.budgets', read));
        }
        report[`${name}@${viewportLabel(width, height)}`] = results;
        const bad = results.filter((r) => !r.ok);
        failures += bad.length;
        if (!args.quiet || bad.length) {
          console.log(
            `\n${bad.length ? '✗' : '✓'} ${name} @${viewportLabel(width, height)} budgets: ${results.map((r) => r.detail).join(' · ')}`,
          );
        }
      }
    }
  }
  // --skip-base runs only the opt-in checks.
  for (const [width, height] of args['skip-base'] || args['budgets-only'] ? [] : viewports) {
    await emulate(cdp, width, height);
    for (const name of pageNames) {
      const scene = args.scene && ENTRY.includes(name) ? `&scene=${args.scene}` : '';
      const url = BASE + PAGES[name] + scene;
      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url });
      await loaded;
      await sleep(1600);
      const group = groupOf(name);
      const ctx = { page: name, width, entry: group === 'entry', group, spec: SPEC };
      const out = await cdp.send('Runtime.evaluate', {
        expression: `(${pageAudit.toString()})(${JSON.stringify(ctx)})`,
        returnByValue: true,
        awaitPromise: true,
      });
      if (out.exceptionDetails)
        throw new Error(
          `${name}@${width}: ${out.exceptionDetails.exception?.description || out.exceptionDetails.text}`,
        );
      const results = out.result.value;
      // The budgets (R10-10), from this navigation; read before anything else touches the page.
      results.push(
        budgetResult('perf.budgets', await evaluate(budgetRead, null, `${name}@${width} budgets`)),
      );
      // The Dashboard's seeded live run can finish inside this read: the store commits it when
      // the check asks for a figure, and the page redraws a moment later. A mismatch is read once
      // more after the redraw, and only a figure still wrong then fails.
      const metricAt = results.findIndex((r) => r.id === 'data.metric-matches' && !r.ok);
      if (metricAt >= 0) {
        await sleep(1500);
        const again = await cdp.send('Runtime.evaluate', {
          expression: `(${pageAudit.toString()})(${JSON.stringify(ctx)})`,
          returnByValue: true,
          awaitPromise: true,
        });
        const retry = again.result?.value?.find((r) => r.id === 'data.metric-matches');
        if (retry) results[metricAt] = retry;
      }
      // The page has been settled for 1.6s, past the "load + 1s" the reduced-motion check needs.
      if (args.reduced)
        results.push(
          reducedMotionResult(
            await evaluate(motionAudit, { maxMs: 50, transitions: true }, `${name}@${width}`),
          ),
        );
      if (group !== 'entry' && group !== 'preview')
        results.push(...(await evaluate(shellAudit, ctx, `${name}@${width} shell`)));
      if (args.shots) {
        let clip;
        if (args.full) {
          const m = await cdp.send('Page.getLayoutMetrics');
          clip = { x: 0, y: 0, width, height: Math.min(m.cssContentSize.height, 12000), scale: 1 };
        }
        const shot = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: !!args.full,
          ...(clip ? { clip } : {}),
        });
        const file = `${SHOTS_DIR}/${name}${scene ? `-${args.scene}` : ''}-${viewportLabel(width, height)}${args.full ? '-full' : ''}.png`;
        writeFileSync(file, Buffer.from(shot.data, 'base64'));
      }
      // The large demo's budgets (--large): its own navigation, after the read-only checks.
      if (args.large) {
        await t.navigate(`${url}&demo=large`, 1600);
        results.push(
          budgetResult(
            'perf.budgets-large',
            await evaluate(budgetRead, null, `${name}@${width} budgets large`),
          ),
        );
        await t.navigate(url, 1600);
      }
      // The phone menu takes real input, so it runs after the read-only checks and screenshots.
      if (group === 'internal' && name !== 'trust-public' && width <= 720)
        results.push(verdict('int.mobile-menu', await mobileMenuProblems(t, width, height)));
      report[`${name}@${viewportLabel(width, height)}`] = results;
      const bad = results.filter((r) => !r.ok);
      failures += bad.length;
      if (!args.quiet || bad.length) {
        console.log(
          `\n${bad.length ? '✗' : '✓'} ${name}${scene ? ` [scene=${args.scene}]` : ''} @${args.sizes ? `${width}×${height}` : `${width}px`} — ${results.length - bad.length}/${results.length} checks pass`,
        );
        for (const r of bad) console.log(`   FAIL ${r.id}: ${r.detail}`);
      }
    }
  }
  if (optIn('parity')) {
    const sizes = [
      [1920, 1080],
      [1440, 900],
      [1440, 780],
      [1280, 720],
      [1200, 800],
      [1200, 1200],
      [1050, 900],
      [1024, 768],
      [960, 900],
      [900, 700],
      [768, 1024],
      [390, 844],
      [320, 640],
    ];
    const tolerance = 1;
    let parityFailures = 0;
    for (const [width, height] of sizes) {
      await emulate(cdp, width, height);
      const geometry = {};
      for (const name of ENTRY) {
        const loaded = cdp.once('Page.loadEventFired');
        await cdp.send('Page.navigate', { url: `${BASE + PAGES[name]}&scene=search` });
        await loaded;
        await sleep(1200);
        const out = await cdp.send('Runtime.evaluate', {
          expression: `(${storyGeometry.toString()})()`,
          returnByValue: true,
        });
        geometry[name] = out.result.value;
      }
      const problems = [];
      for (const name of ENTRY.slice(1)) {
        // The story shell must match exactly; the task differs by route, so only its origin is compared.
        for (const key of ['panel', 'copy', 'title', 'stage', 'task', 'heading']) {
          const a = geometry.login[key];
          const b = geometry[name][key];
          const fields = key === 'task' || key === 'heading' ? 2 : 4;
          if (!a || !b || a.slice(0, fields).some((v, i) => Math.abs(v - b[i]) > tolerance))
            problems.push(`${name}.${key} ${JSON.stringify(b)} vs login ${JSON.stringify(a)}`);
        }
      }
      parityFailures += problems.length;
      if (!args.quiet || problems.length) {
        console.log(`\n${problems.length ? '✗' : '✓'} story-shell parity @${width}×${height}`);
        for (const p of problems) console.log(`   FAIL ${p}`);
      }
    }
    failures += parityFailures;
    await runPandaParity(t);
  }
  if (optIn('states')) await runStates(t);
  if (optIn('scenes')) await runScenes(t);
  if (optIn('motion')) await runMotionPause(t);
  if (optIn('focus')) await runFocus(t);
  if (optIn('fit')) await runFit(t);
  if (optIn('firstview')) await runFirstView(t);
  if (optIn('loader')) await runLoader(t, Boolean(args.reduced));
  if (args.all && !args.reduced) {
    await runReducedPass(t);
    await runLoader(t, true);
  }
  if (optInRan) {
    const byCheck = new Map();
    for (const results of Object.values(report))
      for (const r of results) {
        const count = byCheck.get(r.id) || { fail: 0, total: 0 };
        count.total += 1;
        if (!r.ok) count.fail += 1;
        byCheck.set(r.id, count);
      }
    console.log('\nBY CHECK (failing / evaluated):');
    for (const [id, count] of [...byCheck].sort(([a], [b]) => a.localeCompare(b)))
      if (count.fail || NEW_CHECKS.includes(id))
        console.log(`   ${id}: ${count.fail} / ${count.total}`);
  }
  if (args.json) writeFileSync(String(args.json), JSON.stringify(report, null, 1));
  console.log(
    `\nTOTAL FAILING CHECKS: ${failures}${args.shots ? ` · screenshots in ${SHOTS_DIR}` : ''}`,
  );
  clearInterval(keepAlive);
  clearTimeout(watchdog);
  cleanup();
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
