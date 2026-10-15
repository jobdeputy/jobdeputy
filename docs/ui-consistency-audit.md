# UI consistency audit — brand prototypes

**Audited:** October 1, 2026 · **Status:** all findings fixed and verified on October 1, 2026.
A second review on October 2, 2026 (panda, wording, motion, accessibility, and layout) is fixed
and verified; see [Second review](#second-review-october-2-2026).

This record documents a cross-page review of fonts, colors, sizes, spacing, and shared components
in the `brand/*-preview.html` prototypes. It also explains how each finding was resolved and how
the result is verified. The canonical values live in [design-system.md](design-system.md); this
file explains why they were chosen.

## Scope and method

- **Routes:** sign-in, create account, recovery request, verified-link password, Search home,
  Found jobs, Materials, Profile, and Trust (all nine routes in [prototype-map.md](prototype-map.md)).
- **Widths:** 1440, 768, 390, and 320 pixels.
- **Static scan:** every `:root` token, `font-*`, `letter-spacing`, `line-height`, `border-radius`,
  `box-shadow`, spacing, motion, and color literal in each page's CSS.
- **Rendered scan:** computed styles of every visible text element and shared component, WCAG AA
  contrast against the effective background, interactive target heights, wrapping controls, and
  horizontal overflow.

## Resolution rule

1. Where `design-system.md` defines a value, every page conforms to it.
2. Where the document is silent, the approved sign-in reference (`brand/login-preview.html`)
   decides, and the value is added to the document.
3. Where the document and the test-locked sign-in reference disagree, the rendered reference wins
   and the document is corrected (story display `72px` maximum, page heading `52px` maximum).
4. Accessibility requirements (WCAG AA, `44px` targets, the `12px` floor) override both.

The user approved this foundation change on October 1, 2026 by asking for every finding to be
documented and fixed. `ui-foundation.md`, `design-system.md`, `brand/README.md`, and the UI SOP were
updated together, as the lock governance requires.

## Findings and resolutions

### Tokens and color

| # | Finding | Resolution |
|---|---|---|
| T1 | `--font-display` was a sans-serif Helvetica stack on sign-in and access but the serif stack on internal pages; access and sign-in also used `--font-human` | Two stacks only: `--font-display` (serif) and `--font-text` (system sans). Literal stacks, Helvetica, and Georgia removed |
| T2 | `--surface` was 0.82, 0.84, or 0.86; `--shadow` had three values; header opacity was 0.78 to 0.88 | One canonical `:root` block on every page; `header-surface` token |
| T3 | `--spring` held the "standard settle" curve and `--bounce` held the "friendly spring" curve | Renamed `--ease-settle` and `--ease-spring` |
| T4 | Green text (`#2f9e77`) measured about 3.2:1, failing WCAG AA, on eyebrows, section numbers, and pills | `green-ink` (`#23795b`, about 5:1) for all green text; `green` stays for fills, rules, and icons |
| T5 | Three untokenized error/destructive colors: `#9c4028`, `#a2472c`, and plain ink; Materials also added `#23795b` | `danger-ink` for Sign out; field errors use `ink` beside an orange icon (the sign-in reference); `green-ink` tokenized |
| T6 | Muted text on `paper-deep` tags measured 4.38:1; `quiet` metadata measured about 2.9:1 | Neutral pills and tags use `ink-soft` on `paper-deep`; `quiet` is non-text only |
| T7 | 165 distinct `rgba()` literals, including 14 white and 12 ink opacities | UI chrome uses `surface`, `surface-strong`, `line`, `line-soft`, `line-strong`, `green-wash`, `green-line`, and `on-ink-muted`; only the illustration art keeps local values |

### Typography

| # | Finding | Resolution |
|---|---|---|
| Y1 | Page heading was 52px on entry pages, 62px on Home/Jobs/Profile, and 68px on Materials/Trust, with four letter-spacings | Every `h1`: `clamp(40px, 4vw, 52px)`, `-0.05em`, line-height 1 |
| Y2 | Eyebrows were 13/12/11px, colored green on some pages and ink on others, with or without the leading rule | Page eyebrow: 12px, 750, ink, green leading rule. Story eyebrow: 13px `green-ink`. Section labels: 12px `green-ink` |
| Y3 | Intro copy was 14, 15, 16, or 17px; Materials and Trust set the body to 14px | Intro 15px/1.5, `-0.01em`; body base 16px everywhere |
| Y4 | Section headings ranged from 27px to 45px; `h3` was a 12px label on Jobs and a 25px serif on Profile | Section heading `clamp(28px, 2.6vw, 34px)`; `h3` and item titles 15px/700 |
| Y5 | Internal pages had 41 to 91 visible text elements at 8 to 11px | 12px floor for all visible text; helper and metadata 12px; body 15px |
| Y6 | Wordmark used Helvetica with split weights on sign-in, system sans with split weights on access, and a flat 720 on internal pages | `<span>Job</span><span>Deputy</span>` at 620/720 in system sans everywhere |
| Y7 | Field labels were 13, 12, 11, or 10px; Profile's "Home Region" label was 16px/400 because `.field-label` was unstyled | Field labels 13px/680/`0.01em` on every page |

### Components and layout

| # | Finding | Resolution |
|---|---|---|
| C1 | No shared primary action: 15px/52px/r15, 14px/55px/r14, or 11 to 12px/46px/r12; four different shadows | Primary action contract: 52px, r15, 15px/680, `--shadow-control`, no wrapping |
| C2 | Inputs were 46, 52, or 55px tall with 0.72 to 1.0 background opacity and radius 12 to 14; Home's select fell back to Arial 13.3px | Form-field contract: at least 52px, r14, `surface`, 15px; controls inherit the page font |
| C3 | Page shells were 1280, 1240, or 1160px wide, so content and footer started at a different x on each page | One shell, `min(1280px, calc(100% - 42px))`; footer inner matches |
| C4 | Footer brand 12px or 10px, links 10/620 or 11/680, an extra top border on Profile, and different link sets (Jobs lacked Found jobs, Profile lacked Recent searches) | Footer contract with one canonical link list on every internal page |
| C5 | Skip link was 13, 14, or 16px at weight 400, 680, or 700 | Skip-link contract |
| C6 | Status pills were 9 or 10px with untokenized colors | Status pill and tag contract |
| C7 | Missing favicon (404 on every page) | Compact mark linked as the favicon |

### Sign-in and account-access parity

| # | Finding | Resolution |
|---|---|---|
| P1 | The story headline wrapped differently because only sign-in had `text-wrap: balance` | Both pages balance the story headline |
| P2 | Sign-in's ←/→ story buttons showed stray 2px bars from a leftover `.story-step::before` | Leftover rule removed |
| P3 | Source cards showed A/G/W letters only on access, and the magnifier lens rendered differently | Access story stage matches the sign-in reference |
| P4 | The form panel was transparent on sign-in but a white 0.76 surface with 55px top padding on access | Access matches the sign-in panel and canvas |
| P5 | Form eyebrow was ink with a rule on sign-in and green without a rule on access; header link weight and arrow differed | Shared page eyebrow and entry header-link contracts |
| P6 | Access's password "Show" button was 40px tall | Compact action, 44px |
| P7 | The Region Change button, Region summary, Region note, alternate link, submit shadow and border, and field-error color all differed slightly | Shared compact action, Region summary r14, 12px helper text, 13px/680 text links, the primary-action contract, and ink field errors |

### Other defects

| # | Finding | Resolution |
|---|---|---|
| D1 | Jobs "View posting ↗" wrapped onto two lines | Primary action never wraps |
| D2 | Profile document actions wrapped inside their buttons at 390px and below and crowded the metadata line | Compact actions never wrap; the action group wraps as a row |
| D3 | `design-system.md` said story display `clamp(48px, 5.1vw, 82px)` and page heading max 55px, but the locked tests and rendered reference used 72px and 52px | Document corrected |

## Verification

- **Static:** `tests/prototype/ui-consistency.test.ts` checks the canonical `:root` block, the two
  font stacks, raw hex colors, undefined or retired custom properties, the favicon, the wordmark
  markup, the footer link list, and the page shell. `auth-consistency.test.ts` keeps the entry
  story shell locked, including the balanced headline.
- **Rendered:** `scripts/ui-audit.mjs` loads every route (including Trust's public mode) in
  headless Chrome at 1440, 768, 390, and 320 pixels and compares computed styles with the
  component contract. It also checks the 12px floor, WCAG AA contrast, the text palette, 44px
  targets, controls that wrap, horizontal overflow, and the favicon. `--parity` compares the
  sign-in story shell with every account-access route at 13 viewport sizes, and `--reduced`
  repeats the run with reduced motion.

```sh
python3 -m http.server 8767   # repository root, separate terminal
node scripts/ui-audit.mjs --parity
node scripts/ui-audit.mjs --reduced
```

The access task card's minimum height mirrors the sign-in card's measured height so that both
pages give the shared row the same height on short viewports. If sign-in's card content changes,
`--parity` fails until the constant in `access-preview.html` is updated.

## Status

| Route | Static test | Rendered audit | Notes |
|---|---|---|---|
| Baseline (before fixes) | 44 of 93 prototype tests failing | 698 failing checks | |
| Search home (pilot) | Passing | 0 failing checks at 1440, 768, 390, 320 | Reference implementation; shared chrome moved to `brand/app-chrome.css` |
| Trust (signed-in and public) | Passing | 0 failing checks at 1440, 768, 390, 320 | Side navigation follows the contract; support success uses the shared feedback panel |
| Materials | Passing | 0 failing checks at 1440, 768, 390, 320 | Notice, save, copy, and download feedback use the shared panel; editor uses the display stack |
| Found jobs | Passing | 0 failing checks at 1440, 768, 390, 320 | Primary actions no longer wrap; tags and material states use the shared pill and tag |
| Profile | Passing | 0 failing checks at 1440, 768, 390, 320 | Document actions wrap as a row; settings rail matches Trust's side navigation; footer link set complete |
| Sign-in, create, recovery, set password | Passing | 0 failing checks at 1440, 768, 390, 320; story-shell parity at 13 sizes | Story text, initial status, tablet and desktop geometry, and stacked gaps now match sign-in |
| Identity preview | Passing | Not an application route | Canonical tokens and favicon only; renders unchanged |
| **Final** | **101 of 101 prototype tests pass** | **1,056 checks, 0 failing; 0 with reduced motion** | Biome: no errors, 76 warnings (from 88 at the start of this pass), all `noDescendingSpecificity` in `login-preview.html`. The committed version had 1 error and 3 warnings; 74 of the 76 arrived with the uncommitted sign-in work, not with this pass |

### Remaining by design

- Story and panda illustration art in the sign-in and access pages keeps its own colors and sizes
  (57 distinct `rgba()` values across all pages, down from 165). Internal pages and
  `app-chrome.css` contain none.
- The opening loader's progress track keeps `rgba(27, 26, 24, 0.1)` because the loader is locked
  and no token matches it.
- `[hidden] { display: none !important; }` in `app-chrome.css` is the one intentional `!important`;
  it guarantees the `hidden` attribute beats component display values.

## Second review: October 2, 2026

Five reviewers covered wording, motion, automated tests, accessibility, and visual layout. Each
blocker was confirmed in code or in captured frames before it was listed. The first review checked
computed styles in each page's default state; this one adds alternate states, motion, focus,
announcements, overlap, and short viewports.

The user approved fixing every finding, with these decisions:

- The entry story describes the launch product, because both phases ship before launch. Automatic
  role lookup is an optional premium feature that the person turns on.
- The panda is redesigned to be cuter, as one character across the story, the opening loader, and
  the header mark. The user reviewed ten rendered directions and chose variant A ("Polished": the
  same character with rounder, livelier eyes, blush, and shorter arms) with the ears from variant P
  ("Plush").
- Story chapters stay on screen long enough to read, panda speech stays visible at every width, and
  sign-in hands off to Search home without replaying the loader.
- Personal data in the prototypes is replaced with a placeholder persona.

| ID | Area | Finding | Status |
|---|---|---|---|
| R1 | Motion | Reduced motion leaves infinite loops running because the universal reset loses the cascade | Fixed and verified |
| R2 | Motion | Pause and the finished story leave ambient and watch loops running (WCAG 2.2.2) | Fixed and verified |
| R3 | Layout | The capability label prints over the story body at 680–880px | Fixed and verified |
| R4 | Speech | All speech is hidden at 540px and below; chapters 5–11 never show their speech | Fixed and verified |
| R5 | Region | A default Region is presented as a suggestion from approximate location | Fixed and verified |
| R6 | Contrast | Expanded Region rows measure 4.38:1; chapter bars measure 1.6–2.6:1 | Fixed and verified |
| R7 | Focus | Focus hides under the sticky header and is lost on account-access submit and at the first and last chapter | Fixed and verified |
| R8 | Panda | Eyes go blank on email focus; props float away from the paws; props cover the face | Fixed and verified (new character) |
| R9 | Data | A real name and email address appear in the prototypes | Fixed and verified |
| R10 | Motion | The success bounce never plays; chapter changes snap; manual navigation freezes poses; the arrive wave snaps; the blink is invisible | Fixed and verified |
| R11 | Loader | Sign-in replays the loader on Search home; no screen-reader status; the fill jumps; the SVG loads twice; the failure-safe reveal lands at 5.08s | Fixed and verified; sign-in and Search home share one loader block |
| R12 | Parity | Sign-in and account access run different panda state layers and copy | Fixed and verified (one byte-identical panda layer) |
| R13 | Layout | Short laptops overflow; mobile controls hide props; opening Region shifts the stage; the phone story is too tall | Fixed and verified |
| R14 | Screen readers | Visible feedback carries live roles; descriptions reference hidden text; visible labels are missing from names; forced colors lose controls | Fixed and verified |
| R15 | Wording | Interjection speech, routing-centred pending copy, certainty claims, backwards watch logic, and chapters too fast to read | Fixed and verified |
| R16 | Visual | The entry header departs from the Header contract at 720px and below; footer orphans; side-navigation widths differ; home and jobs density | Fixed and verified |
| R17 | Appeal | The panda is friendly but not cute enough to attract clients (about 5 out of 10) | Fixed and verified (A with P's ears, in the story, loader, and header mark) |
| R18 | Polish | Remaining minor copy, spacing, dead-CSS, focus-ring, and menu-dismissal items | Fixed and verified (dead CSS removed; Biome warnings 74 to 0) |

Verification on October 2, 2026, after the fixes: 193 of 193 prototype tests and 1,202 tests across
all eight workspace packages pass; the type check is clean; Biome reports no errors or warnings; and
`node scripts/ui-audit.mjs --all` reports 0 failing checks. The full audit found one last defect, now
fixed: under reduced motion the universal reset gave every property a `0.01ms` transition, so the
loader fill lagged `aria-valuenow` by a frame. The shared loader block now sets `transition: none` on
the fill.

## Third review: signed-in app redesign

**Date:** October 3, 2026.

The product owner asked for the signed-in pages to be redesigned with Teal as inspiration, with the
panda deputy carried across every page ([ui-app-redesign.md](ui-app-redesign.md)).

**How the work ran:**

- Sub-agents built the redesign in two phases, each owning separate files.
  - Phase 1 built the shell, the components, and the deputy.
  - Phase 2 built six page groups.
- The orchestrator acted as critic. Before accepting each part, it re-ran the tests and the
  rendered audit, viewed screenshots at six viewports, and read the code.

| ID | Area | Finding | Status |
|---|---|---|---|
| S1 | Shell | Signed-in pages had no app navigation beyond Back and the footer | Fixed and verified: sidebar, rail, and phone app bar with a Menu disclosure |
| S2 | Deputy | The panda disappeared after sign-in | Fixed and verified: the deputy dock on every page, in 17 named states |
| S3 | Data | The sample data contradicted itself in four places. Setup said no source or AI choice despite six searches and an OpenAI default. Two sources needed attention, but the dashboard said one. The weekly free run showed unused although Thursday's search used it (decision 0009). The upload limit read 10 MB, not 5 MB | Fixed and verified: one shared sample store; Workday resolved; the weekly run used; 5 MB everywhere |
| S4 | Continuity | A source fixed on Searches stayed in the Dashboard's Needs you list. The Applications nav count and the deputy's Activity never changed after an approval | Fixed and verified: a source slice in the store; the count and Activity follow the store on every page |
| S5 | Layout | Visually hidden text inside the board and table scroll regions widened the page to 2160px | Fixed and verified: the scroll regions position their content |
| S6 | Forced colors | Filled priority dots looked hollow | Fixed and verified |
| S7 | Keyboard | Tab panels added a tab stop even when they held controls | Fixed and verified: a panel is a stop only while nothing inside it can take focus |
| S8 | Print | Printing a page with the app frame printed the footer | Fixed and verified |
| S9 | Chrome | The retired side-navigation styles stayed in the chrome. Removing them also removed two shared rules (the account-menu focus ring and part of the reduced-motion list) | Fixed and verified: both rules restored from the shell's copy and re-audited |
| S10 | Duplication | Onboarding styled its own disabled Continue | Fixed and verified: `aria-disabled` primary actions in the shared chrome |
| S11 | Gallery | The gallery named a stage "Ready for approval", while the store says "Approval" | Fixed and verified |
| S12 | Guards | Nothing stopped a page from restyling the new shared components, and the placeholder checks described skeleton pages | Fixed and verified: a guard against restyling shared components, and final-state checks for every rebuilt page |

### Verification

The final state on October 3, 2026 passes every check below.

#### Tests, types, and lint

- 642 of 642 prototype tests pass, in 14 files.
- 1,651 tests pass across all eight workspace packages.
- Every package's type check is clean.
- Biome reports no errors or warnings across the repository.
- `git diff --check` is clean.

#### Rendered audit

- `node scripts/ui-audit.mjs --all` (file URLs) reports 0 failing checks:
  - `int.sidebar` 0 of 40, `int.nav` 0 of 36, `int.mobile-menu` 0 of 36;
  - `focus.not-obscured` 0 of 22, `focus.not-lost` 0 of 8;
  - `motion.reduced-no-loops` 0 of 30, `motion.pause-stops-all` 0 of 8;
  - `loader.timeline` 0 of 8, `parity.panda-states` 0 of 14;
  - `layout.fits-viewport` 0 of 24;
  - `speech.visible`, `stage.face-clear`, and `text.no-overlap` 0 of 200 each.
- The eight signed-in pages also pass the audit at 1440, 1024, 768, 390, and 320 with `--focus`.

**End-to-end journey (13 of 13 checks, no console errors)**
An independent check drives a real mouse and keyboard through the whole journey:

1. Google sign-up;
2. all of onboarding;
3. the Dashboard hand-off, with the first search running;
4. a shortlist that reaches Applications;
5. approving materials, which clears the nav count, the deputy's Activity, and the Dashboard;
6. Reset sample data.

**Screens**
Every page was reviewed at 390 and at the 1024 rail with no horizontal overflow. Key pages were
reviewed at 1440, 1280×720, and in reduced motion.

## Fourth review: round 2 of the signed-in redesign

**Date:** October 3, 2026.

The owner reviewed round 1 and sent thirteen findings
([ui-app-redesign.md, round 2](ui-app-redesign.md#round-2-the-owners-review-october-3-2026)).
Eleven agents built round 2 in two phases with separate file ownership: Phase A built the shared
components, the deputy's new states, the shell and sample store, and the entry pages (after a
mobile research note); Phase B rebuilt seven page groups. The orchestrator reviewed every report,
rendered every page at nine sizes, and then made these cross-page fixes itself.

| # | Area | Finding | Resolution |
|---|---|---|---|
| R1 | Counts | The flow ribbon's seed text said "6 found" while the store and the Dashboard said 27 | Fixed: the store counts the 27 found (minus roles set aside) and every ribbon copy says 27 |
| R2 | Titles | Page titles mixed "JobDeputy —" and "JobDeputy ·" | Fixed: every page uses "JobDeputy · Page" |
| R3 | Deep links | The deputy's Activity still linked the old destinations | Fixed: "Review 4 strong fits" opens `?fit=strong` and the Acme fix opens `?source=acme`; the store hides the item by its new link |
| R4 | Honesty | Skipping setup opened a first run that showed a search running | Fixed: skipping records no first source, so the Dashboard asks for one |
| R5 | Phones | Job matches' three views wrapped onto two rows | Fixed: the shared `.tabs.is-even` keeps them on one row with the count under each label |
| R6 | Deputy | The phone scene grew 14px taller in reduced motion | Fixed in the shared deputy CSS (two grid rows when Pause motion is hidden) |
| R7 | Forced colours | The panda's black faded into a dark system canvas | Fixed: the drawing keeps its colours, like an image; its words still follow the system |
| R8 | Store | Profile and Job matches needed seed values (last-used dates, crawl settings, the quiet-hours time zone, match feedback, the 12 sample jobs) | Fixed in the store and its tests; the catalog always comes from the seed |
| R9 | Help | "What is Keep watch?" landed on a list, and reset kept the remembered sign-in | Fixed: `#keep-watch` opens its answer; reset also forgets the remembered browser and says it clears notes and invites |
| R10 | Consistency | Résumés and Materials still opened with two-sentence intros | Fixed: one line each, like the other pages |
| R11 | Audit | The audit still expected round 1's footer, Back pill position, story copy on phones, and one nav item on every page | Fixed: round 2 expectations, plus Invite's header link, Job matches' list-first view, and a new `--firstview` check |

### Verification

The final state on October 3, 2026 passes every check below.

#### Tests, types, and lint

- 971 of 971 prototype tests pass, in 20 files (one per page, plus the shared guards).
- `tsc --noEmit` in `tests/prototype` is clean, Biome reports no errors or warnings in `brand`,
  `tests/prototype`, and `scripts`, and `git diff --check` is clean. Backend packages were not
  changed.

**Rendered audit** (file URLs, 1440, 1024, 768, 390, and 320)

- Entry pages with `--all`: 0 failing, including `parity.panda-states` 0 of 14,
  `layout.fits-viewport` 0 of 24, `focus.not-lost` 0 of 20, `motion.pause-stops-all` 0 of 20,
  `loader.timeline` 0 of 4, and `speech.visible`, `stage.face-clear`, and `text.no-overlap` 0 of
  250 each.
- The fourteen signed-in and setup routes (including the Job matches role view, the autofill
  preview, Invite friends, and public Help) with `--focus --reduced --loader`: 0 failing, including
  `int.sidebar` 0 of 65, `int.nav` 0 of 60, `int.mobile-menu` 0 of 60, `focus.not-obscured` 0 of
  70, and `motion.reduced-no-loops` 0 of 70.
- `--firstview` on all eighteen routes at 390×844, 375×667, and 360×740: 0 of 54 failing.

**End-to-end journey (28 of 28 checks at 1440×900 and at 390×844, no console errors)**
Real mouse and keyboard events, from a cleared browser:

1. Create account, Continue with Google, choose Alex: setup opens;
2. every setup step, with the chosen source highlighted and confirmed and the answers saved;
3. the first run with the first search running;
4. the Dashboard's Strong fits tile opening Job matches filtered;
5. Add to Applications, then the role on Applications;
6. "Was this match right?" with No, then Feedback with the role as context, saved;
7. approving materials, the autofill run, both answers, and Submit: Applied by your deputy, with
   the salary saved to the profile;
8. an invite by email, and Platform credits chosen on AI & credits;
9. one tap and Google sign-in, both straight to the Dashboard;
10. Reset sample data, which also forgets the remembered sign-in.

**Guideline pass** (every route, rendered): one `h1`, the landmarks, named links and buttons, image
alternatives, new-tab links announced, an honest sample or prototype label, no prices, only
`example.com` addresses, and no dashes in the copy: 0 problems.

**Screens**
Every route was reviewed at 1440×900, 768×1024, and 390×844 side by side, and each agent reviewed
its pages at all nine sizes (1440×900, 1280×720, 1024×768, 820×1180, 768×1024, 390×844, 375×667,
360×740, 320×568) in normal and reduced motion. Nothing overflows from 320 to 1440.

**Not verified:** iOS Safari and its safe areas, and a manual screen-reader pass.

## Fifth review: round 3 of the signed-in redesign

**Date:** October 4, 2026.

The owner reviewed round 2 and sent 37 findings
([ui-app-redesign.md, round 3](ui-app-redesign.md#round-3-the-owners-second-review-october-4-2026)).
The orchestrator reproduced the reported bugs by measurement first (the phone app bar was
`position: static`; the rail slid under the header at the page end; nothing animated at rest, so
Pause motion changed nothing; the account menu was 92% opaque; every page carried its own sample
numbers). Twelve agents then built round 3 in two phases with separate file ownership: Phase A built
the shell and panels, the deputy, the shared components, and one sample world; Phase B rebuilt eight
page groups. The orchestrator reviewed every report, rendered every page, relayed interface notes
between parallel agents, and made these cross-page fixes itself.

| # | Area | Finding | Resolution |
|---|---|---|---|
| R1 | Words | The store's stage tones and meanings differed from the table the pages were told to use, and the first fit words promised checks the deputy does not make | One set in the store (`FITS`, `STAGES`), read by every page; fit words follow the data (role, place, keywords) |
| R2 | Allowances | "8 left" meant free runs on one page and free plus added runs on another, so a top-up broke the agreement | One meter convention: used, free left of the limit, and added, each with its own key (`watch.nightly.freeLeft`, `ai.topups` added) |
| R3 | Drafts | Drafts ignored the résumé chosen in Add a role, the editor's page count, and a role's template | The store prefers the chosen résumé, reads the editor's pages, and adds `setDraftTemplate` |
| R4 | Landing | The Dashboard's "7 active" opened Applications, which showed no active count | Applications' summary reads "7 active · 5 from Job matches · 3 added by you" |
| R5 | Colours | Profile's first required detail was a black primary button, not red | Both required details are red need markers; the audit allows no primary action on Profile and the Dashboard |
| R6 | First run | When setup's first search could not start, the Dashboard said it had finished | Not-started and stopped states with the reason and a link to fix it |
| R7 | Feedback | A chosen "Frustrated" face sat on the green selected card; orange "Okay" could not reach 3:1 | The chosen card follows its rating; Okay is blue |
| R8 | Drawers | A focused field could sit under a drawer's sticky header or footer, and fixing that lost pointer clicks | Keyboard focus and typed fields scroll clear; pointer presses on buttons and choices never scroll |
| R9 | Motion | The opening loader still played its story for a person who had saved Pause motion | Sign in, account access, and the Dashboard show the settled mark with the reduced-motion timing |
| R10 | Data | The account menu's allowance sentence carried a figure key outside `main` | Removed; `app-shell.js` keeps the sentence in step |
| R11 | Store | Pages needed a few more keys and a local-time clock text | `gmail.connectedAt`, `gmail.lastCheckedAt`, `watch.nightly.monthEnd`, `referrals.joined`, and `nowIso()`; the Modern template's sections became `##` |
| R12 | Audit | The audit still expected round 2's sticky sidebar and static phone bar, read the paper pages' headings, measured the live table's stretched links by their text, and had no duplicate-data check | `int.sidebar` expects the fixed chrome; paper headings and stretched rows are handled; new `data.metric-matches` and `data.metric-once` on every page that loads the store |
| R13 | Deputy | On tablets and desktops the Activity panel often opened above the viewport (a Chrome layout quirk with the fixed panel inside a just-opened `<details>`), so Pause motion and Show me around were out of reach (found by UAT) | `deputy.js` forces one re-layout when a panel first opens outside the viewport |
| R14 | Merges | Page agents rebuilt whole files from earlier copies while the shell changed under them, undoing shared edits on three pages | The shared chrome and the loader change were re-applied by script and verified by the consistency tests; page agents now edit files in place |

### User acceptance

Two independent testers, who had not built any page, walked every check in `uat.md` (U1 to U35)
from a cleared browser with real input events: one on phones and tablets (390×844, 375×667,
360×740, 768×1024, and 820×1180, touch) and one on desktops and laptops (1440×900, 1280×720, and
1024×768, mouse and keyboard only, plus reduced motion and forced colours). Together they took about
2,400 screenshots, and every journey ran with a clean console.

- **Phones and tablets:** 31 rows passed. U2 failed on tablets (R13) and U20 on phones (Searches'
  first card sat below the fold); U15 differs from its wording by decision (Okay is blue).
- **Desktops:** 31 rows passed. U5 failed (tour steps ringed only a section heading) and U35 had
  a few narrow targets; three major findings (the tour targets, public Help's logo leading into
  the signed-in app, and an Applications summary that did not add up on screen) and twelve minor
  ones.

Every reported defect went back to its owner and was fixed, then rechecked: the Activity panel in
view at 820, 1024, and 1440; public Help's logo and links back to the entry route and the entry
logo no longer pointing at the old concept page; "8 tracked: 5 from Job matches, 3 added by you ·
7 active, 1 closed"; every tour step's target visible above or beside its card on all eight
toured pages at 1440, 1280, and 390; the model warning following the model's size; singular forms;
Searches' first source card in the first viewport at 390, 375, and 360; the deep-linked postal
code focused in view on short phones; print without the on-screen page-limit line; 44px values in
split tiles; tooltips on the rail's icon-only header buttons; and a feedback thank-you that follows
the rating. Kept by decision and listed as open questions: Offer shares Interviewing's green, a
sixth source shares a tone in the donut, colours mean different things in different charts, and
the first run previews the sample world rather than an empty account.

### Verification

The final state on October 4, 2026 passes every check below.

#### Tests, types, and lint

- 1,272 of 1,272 prototype tests pass, in 21 files (one per page, plus the shared guards, and a
  new `materials.test.ts`).
- `tsc --noEmit` in `tests/prototype` is clean, Biome reports no errors or warnings in `brand`,
  `tests/prototype`, and `scripts`, and `git diff --check` is clean. Backend packages were not
  changed.

**Rendered audit** (file URLs, 1440, 1024, 768, 390, and 320)

- The twelve signed-in routes (Dashboard, Searches, Job matches and its role view, Applications,
  autofill, Résumés, Materials, Profile, AI & credits, Invite friends, and Help) with `--focus
  --reduced --loader --firstview`: 0 failing, including `int.sidebar` 0 of 60 (the fixed chrome),
  `int.nav` 0 of 60, `int.mobile-menu` 0 of 60, `focus.not-obscured` 0 of 60,
  `motion.reduced-no-loops` 0 of 60, `layout.first-view` 0 of 36, and the new
  `data.metric-matches` and `data.metric-once` on every page that loads the store.
- The entry routes, onboarding, and public Help with `--all`: 0 failing, including
  `parity.panda-states`, `motion.pause-stops-all`, `loader.timeline`, `layout.fits-viewport`, and
  `speech.visible`, `stage.face-clear`, and `text.no-overlap` 0 of 250 each.

#### Probes

- One sample world: on all fourteen signed-in views, every `data-metric` figure equals the store
  and none repeats, at 1440×900 and 390×844, before and after the live search completes.
- Fixed chrome: 99 of 99 (11 pages × 9 sizes, middle and bottom of each page).
- Pause motion: every signed-in page at 390×844 (touch) and 1440×900, and under reduced motion,
  stops every animation, holds across pages, and resumes on Play; a saved Pause also gives the
  settled opening loader on Sign in, account access, and the Dashboard.
- Tours: every step of the eight page tours and the first-run tour shows its ringed content at
  1440, 1280, and 390.

**End-to-end journey (48 of 48 checks at 1440×900, 820×1180 touch, and 390×844 touch, no console
errors)**, from a cleared browser with real pointer, touch, and keyboard events: Create account,
Google, every setup step, and the first-run tour; the Dashboard's Strong fit landing on 4, the live
search moving every page from 27 to 29; Get more runs moving "lasts through" to Sat, Oct 31 on four
pages; Retry, archive, restore, and delete on Searches; Add a role with Read the posting; a
document preview and the 12 drafts; the postal-code deep link; Change model with its disclaimer;
customizing the rank prompt; the autofill statements; public and signed-in Help; Pause motion
across pages; the opaque account menu; and one-tap sign-in.

**Not verified:** iOS Safari and Android Chrome on real devices (all checks ran in headless Chrome
with touch emulation), the safe areas (`viewport-fit=cover`), and a manual screen-reader pass.

## Sixth review: round 4 of the signed-in redesign

**Date:** October 4, 2026.

The owner reviewed round 3 and sent notes on the Dashboard, Help, Searches, Résumés, a purchase page,
and Job matches
([ui-app-redesign.md, round 4](ui-app-redesign.md#round-4-the-owners-third-review-october-4-2026)).
The orchestrator reproduced the broken Read the text first (opening it squeezed the page to a sliver
and spilled the words under the dialog's footer) and read the Dashboard for repeated facts (three
found). Eight agents built round 4 in two phases with separate file ownership: the sample world, the
shared components, the Shop, and Job matches first; then the Dashboard, Searches, AI & credits, and
Profile, Help, and setup. The orchestrator reviewed every report, rendered every page, wrote an
accessibility probe for the testers and the agents, and made these cross-page fixes itself.

| # | Area | Finding | Resolution |
|---|---|---|---|
| S1 | Chrome | The Shop needed a way in from every page | Account menu and footer links on every signed-in page; the Shop marks its own menu link current; the footer's third group split into two pairs so no row orphans a link |
| S2 | Phone app bar | The Menu label flipped between "Menu · Dashboard" and "Menu" as the deputy's duty changed during a run | The deputy's column keeps the width of its longest duty |
| S3 | Store | With your key's limit reached, every page still said "Every search and draft uses gpt-5-mini on your OpenAI key", the Prompt drawer named the key, and a 99.6% ring read 100% | `aiChoice()` carries `limited`, `until`, and a summary that says what runs instead or until when AI work is paused (a day limit says 00:00 UTC); `aiLimit()` adds `percent` (100 only once reached) and `pausedUntil` (the next free run when it comes first); the Prompt drawer names what really runs |
| S4 | Rings | After a top-up, Keep watch's centre showed the total left while Deputy Assist's showed the free runs | One rule for every ring: the centre shows the free runs left of the month; bonus and added runs are key parts with their counts |
| S5 | Token rings | A 1,000,000 limit overflowed the 88px ring | The centre shows the percent used |
| S6 | Components | Tours and the preview returned focus off screen; the page scrolled under the open preview; the attention dot and the ring keys had no explanation; forced colours made every donut segment the same; the focus ring measured 2.84:1 on paper-deep; a focused field in error lost its ring; the preview's Text was one paragraph; a one-page preview kept an empty pager | Focus returns in view; the page holds still while the preview is open; rings explain their marks with tips and screen-reader words and key items borrow their parts' tips; one system colour per tone in forced colours, the same on segment and swatch; green-ink rings on paper-deep; a green-ink ring on fields in error; the document's own headings, lists, and paragraphs; no pager for one page |
| S7 | Autofill | WCAG text spacing overflowed the self-identification actions at phone widths | The short label on phone-width forms |
| S8 | Audit | The audit did not know the Shop, the footer's new link, or a page with neither a nav item nor a primary action | The `shop` route, the footer list, and `int.nav` and `int.primary` for the Shop |

### User acceptance

Three fresh-eyes testers, who had not built any page, walked every check in `uat.md` (V1 to V24) and
round 3's U1 to U35 from cleared browsers with real input events: phones and tablets (390×844,
375×667, 360×740, 320×568, 768×1024, and 820×1180 with touch), desktops (1440×900, 1280×720,
1024×768, and 1920×1080), and accessibility to WCAG 2.2 AA on every page (the accessibility tree,
keyboard only, contrast, forced colours, 200% zoom, text spacing, reduced and paused motion, and
announcements during a live run).

- **Phones and tablets:** 10 defects, none major; every figure agreed across pages and nothing
  overflowed.
- **Desktops:** 24 defects, one major (Materials' Draft materials gave no visible reason when your
  key's limit was reached); all 35 round 3 rows passed.
- **Accessibility:** 15 defects, two major (autofill's sticky run panel hid its last link from
  keyboard focus at 1440×900, and the Applications list on phones kept its visually hidden sort
  buttons in the tab order). No keyboard traps, and focus was never hidden under the fixed chrome.

Every defect went back to its owner (a new agent took the pages that had none this round) or to
the orchestrator for the shared files, and was fixed and rechecked. Kept by decision: a ring's key
names the centre's part without repeating its count (the centre holds it; each figure once); Your
runs stacks its rings under 384px; the idle Search status line leaves the new count to its bar;
footer links already have 44px hit areas; the deputy dock's headings come before the page's h1 in
the DOM (one h1, no skipped levels); and the orange and grey segments measure 2.98:1 and 3.00:1
against the tile (a palette decision for the owner; every count is also text in the key).

### Verification

The final state on October 4, 2026 passes every check below.

#### Tests, types, and lint

- 1,451 of 1,451 prototype tests pass, in 22 files (a new `shop.test.ts`).
- `tsc --noEmit` in `tests/prototype` is clean, Biome reports no errors or warnings in `brand`,
  `tests/prototype`, and `scripts`, and `git diff --check` is clean. Backend packages were not
  changed.

**Rendered audit** (file URLs, 1440, 1024, 768, 390, and 320)

- The thirteen signed-in routes (round 3's twelve and the Shop), public Help, and setup with
  `--focus --reduced --loader --firstview`: 2,502 of 2,502 checks pass, including `int.sidebar`,
  `int.nav`, `int.mobile-menu`, `focus.not-obscured`, `motion.reduced-no-loops`,
  `layout.first-view`, `loader.timeline`, and `data.metric-matches` and `data.metric-once`.
- The entry routes with `--all`: 1,442 of 1,442.

#### Probes

- Accessibility (`a11y.mjs`: names in the accessibility tree, ids and references, headings,
  landmarks, live-region storms, a full Tab pass for focus hidden under the fixed chrome, and WCAG
  text spacing): 0 failing checks on 19 page variants at 1440×900, 820×1180, and 390×844 with
  touch, and the changed pages also at 320×568.
- One sample world: every `data-metric` figure equals the store and none repeats on every signed-in
  page at 1440×900 and 390×844, and on the Dashboard and AI & credits in every AI and limit state.
- Pause motion: all 24 rows pass (the twelve signed-in pages, the Shop included, at 390×844 with
  touch and 1440×900): every animation stops, the pause holds across pages, and Play resumes.
- Fixed chrome: all pass, the Shop included. Tours: every step of the nine page tours (Dashboard,
  Searches, Job matches, Applications, Résumés, Materials, Profile, AI & credits, and the Shop) and
  the first-run tour shows its content at 1440, 1280, and 390.

**End-to-end journeys** (1440×900, 820×1180 touch, and 390×844 touch, no console errors), from
cleared browsers with real pointer, touch, and keyboard events:

- Round 3's journey, 48 of 48 at every size: Create account, Google, setup, and the first-run tour;
  the live search moving every page from 27 to 29; Get more runs; Retry, archive, restore, and
  delete; Add a role; previews and drafts; Change model; prompts; autofill; Help; Pause motion; the
  account menu; one-tap sign-in.
- Round 4's journey, 39 of 39 at every size: the ring tiles; Search status counting up and turning
  idle; tokens by task; Change limit to 100,000 a week and a refused 5,000; a reached limit pausing
  Run again with a To-do item; Platform credits on the Deputy Assist tile; the preview's Text tab
  without moving the dialog; the Shop from the account menu and footer, with no price anywhere,
  adding 5 AI runs, and Count me in and Withdraw; and Job matches pages by width, Next, focus, and
  `?page=` clamping.

**Not verified:** iOS Safari and Android Chrome on real devices (every check ran in headless Chrome
with touch emulation), the safe areas, and a manual screen-reader pass (announcements were checked
as the status regions' text).

## Seventh review: round 5 of the signed-in redesign

**Date:** October 4 and 5, 2026.

The owner reviewed round 4 and asked for a signed User Agreement before any account exists,
LinkedIn sign-in and import, AI credits at AWS's price plus a margin instead of AI runs, supporter
benefits, Dashboard colour and layout changes, real times and pagination on Searches, versioned
prompts with guardrails, site accounts and email updates in Applications, a working Download, a
growing Profile, and the signed copies in Help, then added one note on October 5: What's new next
to To-do, in To-do's row style, and reorganize the Dashboard if needed
([ui-app-redesign.md, round 5](ui-app-redesign.md#round-5-the-owners-fourth-review-october-4-and-5-2026)).

The orchestrator reproduced the owner's timer bug before briefing anyone: in a browser whose sample
session began more than ten hours earlier, the sample clock stopped at 23:59:59, so every new run
read "Queued for 0 s" and "Finished in 0 s" (`/tmp/jd-r5/tools/timerbug3.mjs`, three cases). Ten
agents built round 5 in two phases with separate file ownership: the sample world, the shared
components, the prompt guard and drawer, and the agreement and entry routes first; then the
Dashboard, Searches, AI & credits, the Shop, Applications and Autofill, Profile and setup, and Help
and Résumés. **Every Phase B agent was cut off overnight by a connection failure**, so a second
session resumed each one from the files as they stood, reading its predecessor's transcript rather
than restarting (`/tmp/jd-r6/tools/predecessor.py`). The orchestrator checked every claim by
rendering, probing, and testing, and made these cross-page fixes itself.

| # | Area | Finding | Resolution |
|---|---|---|---|
| S1 | Chrome | The account menu still read "3 of 4 free AI runs left this month" from retired keys on every page | One `[data-account-credits]` line filled from `credits()` ("339,100 tokens of AI credits left") |
| S2 | Components | A masked password's Show and Copy both logged a reveal as a Show | `secretField` passes `{ action: 'show' \| 'copy' }` to its reveal callback, so the vault log says which happened |
| S3 | Store | The Gmail list said a one-time code "or the status" is saved, which the signed agreement contradicts | Two items instead: a code is shown once then deleted, and only the facts the deputy needs are kept from an email |
| S4 | Shell | With the overdue agreement demo on, the pause banner appeared on public Help, which is signed out | `mountBanner()` skips a page marked `data-help-view="public"` |
| S5 | Materials | "More AI runs" survived, and a draft refused for the overdue agreement or empty credits said nothing | Buy credits instead, and the reason beside Draft materials with Review and sign, which returns to the page |
| S6 | Components | In forced colours every segment of a stacked bar was painted `Highlight`, so the Dashboard's two models read as one block | `.stack-bar > .stack-bar-seg[data-tone]` takes the usage chart's per-tone forced-colours look |
| S7 | Store | Three figures had no metric key, so they could not be checked (a model's three months, a search's tokens and cost, a friend's reward) | `ai.months3.total`, `ai.months3.model.<id>`, `ai.search.tokens`, `ai.price.<id>.search`, `referrals.reward`, and `referrals.rewarded`, with Invite's reward tagged |
| S8 | Shop | Bonus from friends showed no figure, so a reader could not tell what a friend earns | One line from the store: a friend's first search earns both people 100,000 tokens, and what Jordan's earned so far |
| S9 | Dashboard | What's new carried titles only, which left an empty band beside To-do's seven rows and said nothing about each update | Each row carries the item's own words; the row shares its free height so both cards end level (521/521 at 1440, 590/590 at 1280, 676/676 at 1024); the prose budget is 360 |
| S10 | Dashboard | "in Deputy Assist", where a model's tokens would repeat the ring, read like a missing number | The words are a link that opens and focuses that ring |
| S11 | Tests | The agreement page was outside the shared setup-page rules | `agreement-preview.html` joins `setupPages` in `ui-consistency.test.ts` (chrome, script order, shared selectors) and the audit's setup group |
| S12 | Profile | The Gmail card's link pointed at Applications with no anchor | It opens `applications-preview.html#email` |

### User acceptance

Three fresh-eyes testers, who had not built any page, walked every row of round 5's `uat.md` (W1 to
W37 and the restated round 4 rows) and the round 3 and round 4 rows from cleared browsers with real
input events: phones and tablets with touch, desktops, and accessibility to WCAG 2.2 AA on every
page including the new agreement page.

A machine restart cut off the phone and desktop runs; two fresh testers with the same scopes walked
the rows those runs had not reached, then retested every fix. The orchestrator reproduced each
finding with its own probe before deciding it, and checked every fix by rendering and measuring.

| # | Area | Finding | Resolution |
|---|---|---|---|
| A-1 | Profile | At 320 under WCAG 1.4.12 text spacing the page scrolled 62px sideways (the long found-source tag, the section nav) | The tag wraps and the section nav's scroll region follows the links' measured width; 0px at 320, 375, and 390 |
| A-2 | Components | At 200% zoom a tooltip covered the focused "Keep watch" link | With no room above or below, the tip goes beside the trigger on the side with more room |
| A-3 | Components | The segmented control's selected state was 1.08:1 fill and 2.84:1 border | A green-ink 2px border (4.50:1) and the chips' check mark |
| A-4 | Colours | Brand orange marks with no words beside them measured 2.97:1 | Those marks use the data orange (3.61:1); marks with their words beside them keep the brand orange |
| A-5 | Shell | Tab reached 73 controls behind the open phone Menu and account sheet | The page and dock are inert while a panel is open on phones |
| A-6, A-7 | Text | "Bonus AI runs" in the deputy gallery; an em dash in `preview.html` | Both removed |
| A-8 | Components | A masked password read as twelve bullets | The mask is hidden from assistive technology, with a visually hidden "Hidden" |
| D-1 | Prompt guard | "Give a lower score if the posting mentions maternity leave." passed every check and saved | Blocked under Protected traits, with any benefit, policy, or statement tied to a protected trait; preferring a benefit and a company's location stay allowed; "candidates from China" is now blocked too |
| D-2, M-2 | Components | A password's Show never read Hide | Show and Hide, with no pressed state; Autofill and the gallery use the shared field |
| M-1 | Profile | "1 passwords shown or copied" | The word follows the figure |
| D-3 | Dashboard | At 1280 and 1024 To-do's title sat about 50px lower than What's new's, with a gap above its rows | Both titles 35px from the card top, 13px to the first row; the spare height goes inside the rows |
| D-4 | Rings | The ring on your own key's limit read four ways on four pages; the Shop never showed the used figure | One rule: percent in the centre, both figures in the key, one line for the limit and the reset |
| D-5 | Keep watch | "Running low" stayed after buying 30 nightly runs | Not a defect: 30 more still end Oct 21; the Month bundle covers the month and clears it (decision 11) |
| D-6, D-7 | Dashboard, AI & credits | "in Deputy Assist" where a number might be; two $0.0024 figures | Kept by decision (round 5 S10; decision 12) |
| D-8 | Entry | Create account by email needed an extra "Read the agreement" click | One success line, then the agreement, like Google and LinkedIn |
| D-9 | Dashboard | A band of about 100px in the Applications tile | The key is one column beside the ring and shares the height; 8px left at every desktop width |
| D-10 | Deputy | The dock said "Filling forms" and "Searching" while the deputy was paused for the agreement | Every duty reads "Paused until you sign" until the agreement is signed |
| M2-1 | Invite friends | "up to 5 friends a year" split into three pieces by the list's grid | Each rule's words are one item beside the check |
| M2-2 | AI & credits | Tour step 5's card covered the price rows it described | The step targets the whole price explanation; the card clears it at 1440, 820, and 390 |
| M2-3 | Profile | The LinkedIn drawers were labelled "Found while applying" | "LinkedIn" |
| M2-4 | AI & credits | The model choice said "cost per run" | "Per token", also on Help |
| D2-2 | Dashboard | Stripe and Acme shared one green in Matches by source | Seven distinct source colours (Acme indigo, Contoso wine), each 3:1 or better |
| D2-3 | Autofill | After both answers the scan still said "2 need you" | The scan follows the answers; the status region drops stale counts |
| D2-4 | Job matches | A run's "2 new roles" link showed 3 roles | The link names the run (`?run=`); the New view explains marked and earlier roles |
| D2-5 | Deputy | The invite ticket read "+2", from the retired AI runs | The AI credits sparkle (decision 16) |
| D2-6 | Résumés | About 140px of empty space under the library count | The count sits above a one-line upload area; no band |
| D2-7 | Applications | "2 optional  to add" with a double gap | One word space before "to add", here and in the shared need summary |
| D2-8 | Profile | "2  required" in the need summary: a gap between each figure and its word | The figure and its word are one item; a normal word space |
| D2-9 | Profile | "3 passwords shown or copied" with one account: the figure counts every Show and Copy | "Shown or copied 3 times" |
| M2-5 | AI & credits | The model switch's confirmation said "new runs can cost more" | "It can cost more per token" (and "results may be less accurate" for a smaller model) |

Both testers then retested every fix: 13 of 13 on desktops (1440, 1280, and the layout rows at 1920
and 1024) and 12 of 12 on phones and tablets (390 and 820 with touch, the layout rows at 320 and
768), with no console errors. Their adapted round 3 and round 4 journeys pass (the round 3 script's
two misses were its own stale wording and a scripted click, both checked by hand).

### Verification

The final state on October 5, 2026, after the acceptance fixes, passes every check below.

#### Tests, types, and lint

- 2,044 of 2,044 prototype tests pass, in 25 files (new: `agreement.test.ts`,
  `prompt-guard.test.ts`, `prompt-drawer.test.ts`).
- `tsc --noEmit` in `tests/prototype` is clean, Biome reports no errors or warnings in `brand`,
  `tests/prototype`, and `scripts`, and `git diff --check` is clean. Backend packages were not
  changed, apart from the résumé and CV label work already in this branch.

**Rendered audit** (file URLs, 1440, 1024, 768, 390, and 320)

- The thirteen signed-in routes with `--all`: 2,277 of 2,277 checks pass.
- The entry routes, setup, the agreement page, and public Help with `--all`: 2,101 of 2,101. The
  audit now holds the navigation to the agreement after Create account, as it already held the
  one to Search home after sign-in, so the success pose and focus are measured on the page.

#### Probes

- `metrics.mjs` on every signed-in page: 278 figures at 1440×900 and 266 at 390×844, 0 mismatched
  and 0 repeated.
- The round 5 end-to-end journey (`/tmp/jd-r6/probes/e2e-r5.mjs`): 25 of 25, no console errors.
  Create account with LinkedIn, the agreement before any account exists, a wrong name refused, the
  record kept with its fingerprint, setup, the Dashboard's order with no AI runs, the buy dialog
  (Continue with no pack says why) and a purchase, the model switch following every page, a run
  counting up with no time bar, email updates, Help's signed copies, and Delete account keeping the
  agreement records.
- The timer bug: a fresh session, a session started eleven hours earlier, and a clock pinned at
  23:59:59 all count up and finish with their real duration.
- Archive and Delete while a source runs: disabled with the reason in visible text, tied to both
  buttons, and available again when the run ends.
- The autofill account step: Gmail first, the agreement gate, a generated 20-character password
  with no look-alike characters, a one-time code shown once and absent from storage, the form scan,
  18 of 20 filled with 2 needing you, and three entries in the vault log.
- The LinkedIn import: 19 fields as new, different, or already the same; two unticked items are not
  saved, and the six ticked ones join their sections tagged with their source.
- Résumés' Download: a valid PDF 1.4 (US Letter, headings and bullets) and Markdown, named for the
  document.

## Eighth review: round 6 of the signed-in redesign

**Date:** October 5, 2026.

The owner reviewed round 5 and asked for a happy panda that holds its tool the same way everywhere,
the home Region before every sign-in method, a way out of setup, the deputy giving every tour, a
rule for lists that grow, What's new linking to a guide or a page, Dashboard changes, prompts with
versions, tests, and rollback, a stronger Applications, Résumés and Profile changes, Settings tabs,
and a concise Invite friends, with nothing they did not mention broken
([ui-app-redesign.md, round 6](ui-app-redesign.md#round-6-the-owners-fifth-review-october-5-2026)).

The orchestrator reproduced D1 before briefing anyone (`searches-preview.html?source=amazon` drew
the whole source card with the green selected outline and applied list filters) and measured the
tour button on every page (right on three pages, left on five, inside Profile's header card, and
none on Invite friends and the autofill preview). Round 5 was tagged `round-5` and round 6 began
on `design/round-6`. Twelve agents built round 6 in two phases with separate file ownership: the
happy deputy, the sample world, and the platform UI first, each writing its contract (the store,
the platform UI, and the guide API) before Phase B began; then the Dashboard, Searches, Prompts and
AI & credits, Applications, Résumés, Profile with Account and Connections, entry and setup, Invite
with Purchases and Help, and Job matches. Requests for another agent's files went through the
orchestrator. On the evening of October 5 the repository folder was moved away for about half an
hour and brought back unchanged; the agents stopped and resumed, and the build was checkpointed as
commit `9b6f9a4`. The orchestrator checked every claim by rendering, probing, and testing, and made
these cross-page fixes itself.

| # | Area | Finding | Resolution |
|---|---|---|---|
| I-1 | Dashboard | New roles per search skipped every other date at 1440 although they fit, and the bar of a run of several sources had no label | Every date shows while it fits the room between bars (thinned only where it does not, counted back from the last), and Oct 2 reads "Keep watch" under its date (`bars[].sublabel`) |
| I-2 | Purchases | The buy dialog still said "Shop" in five places, held by five assertions in `ui-consistency.test.ts` | Purchases in the dialog's eyebrow, See everything in Purchases, and its three messages, with the five assertions in the same change |
| I-3 | Prompts | The Prompts page was 6,142px tall at 1440 (9,934 at 390), and the two measures' definitions repeated eight times | One row per prompt with Details, the definitions once, one row open at a time: 2,768px at 1440 and 5,178 at 390 |
| O-1 | Store contract | Prompt versions' `status` was to take the lifecycle, which would change round 5's meaning (the guard's result) | `status` keeps its meaning; the lifecycle is a new field, `lifecycle` (R6-10) |
| O-2 | Prompt control | In narrow columns its buttons and status pills wrapped their own words, which the audit's `int.compact` and `int.pills` refuse | The rule stays: buttons and pills never wrap their words; the action row wraps between buttons, and a control narrower than `360px` uses short names |
| O-3 | Tests | `prototype-integrity.test.ts` read ids built in script templates (`id="${...}"`) as duplicates | Ids containing `${` skip the uniqueness check and still resolve their references |
| O-4 | Types | `tsc` failed on `jobs.test.ts`'s model type (`sourceSet`, the `pageItems` options) | Fixed; `tsc` is clean |
| O-5 | Tours | `tour-placement.test.ts` listed twelve pages as not yet migrated | Emptied after Phase B: every internal page uses the shared page intro (79 of 79) |
| O-6 | Audit | `scripts/ui-audit.mjs` still expected round 5: the footer's "Shop" and no "Settings", the Shop marking its account menu link instead of a nav item, a primary action on every settings list, and the email field as the first field of an entry form; and it did not know the three new pages | The footer list names Settings, AI & credits, and Purchases; `int.nav` treats Purchases like the other Settings tabs (it marks Settings; Invite friends is the one page without a nav item); `int.primary` is optional on Account and Connections; the entry first view takes the Region control as the first field and also needs the first sign-in method to start in view; `account`, `connections`, and `prompts` joined the routes |
| O-7 | Audit | The Job matches role view's first view at 375×667 found the page's `h1` above the viewport | Not a defect: the role view opens with the role's title in view (round 5's rule), now reached past the taller page intro; the audit checks `#detail-title` on that view |

### Part 2: the owner's mid-round notes

On the evening of October 5, during acceptance, the owner sent six more notes (N1 to N6: Prompt
tests on the Dashboard, Show the numbers, one Runs allowance, a calmer Prompts page, Gmail sync on
the Dashboard, and a judge of data placement;
[ui-app-redesign.md, part 2](ui-app-redesign.md#round-6-part-2-the-owners-mid-round-notes-october-5-2026)).
The orchestrator reproduced N2 first (a chart's table opened inside its card fell into the list
tables' stacked layout, about 2,000px tall), then ran a read-only placement critic, J1, which mapped
every figure and fact to the pages that show it and wrote 26 findings (P-1 to P-26). The
orchestrator decided a home for each fact and routed the notes, the placement changes, and the
testers' fixes to their owners together, then made these fixes itself.

| # | Area | Finding | Resolution |
|---|---|---|---|
| O-8 | Components | A point for a test still running (no score yet) drew at 0%, because `Number(null)` is 0 | `scoreTrend` treats a missing score as Testing now |
| O-9 | Store | Rollback reasons still said "Its agreement with you fell to 71%" after the measure became Kept by you | "Kept by you fell to ...", and Help's prompt-test answer finds both words |
| O-10 | Words | "Nightly runs" survived in store strings, What's new, and the Dashboard after N3 | Runs everywhere; Keep watch stays the schedule's name |
| O-11 | Help | Once 2026.10 was signed, Help's agreements card did not name the version | It names 2026.10 (the round 5 journey checks it) |
| O-12 | Profile | Searches said "Watching: N selected" and "No source yet" where Profile said "Watched" and "None yet" (UAT-A A-7) | One wording; then P-1 moved Keep watch to Searches only |

### User acceptance (round 6)

Three fresh-eyes testers, who had not built any page, walked round 6's rows in `uat.md` and the
earlier rounds' rows from cleared browsers with real input events: desktops (UAT-D: 15 findings, 1
major, 9 minor, 5 cosmetic), phones and tablets with touch (UAT-M: 19 findings, 3 major, 8 minor,
8 cosmetic; every round 5 row passed at 390), and accessibility to WCAG 2.2 AA (UAT-A: 8 findings,
1 major, 6 minor, 1 cosmetic; its probe passed 87 of 88 page and size runs on the usual sample,
the one failure being A-3, and 30 of 30 on the large demo). The orchestrator reproduced each
finding before deciding it and checked each fix by rendering and measuring. UAT-M's condensed
report names the severity only of its three major findings, so the others read "minor or
cosmetic" below.

| # | Severity | Page | Finding | Outcome |
|---|---|---|---|---|
| A-1 | Major | Searches, Profile | Keep watch's multi-select dropped focus to the page on every live tick, and Escape stopped working | Fixed: `setOptions` updates the open list in place |
| A-2 | Minor | Dashboard | In forced colours a green stacked part kept its green | Fixed: forced colours win on every part |
| A-3 | Minor | Applications | "Reset to the system default" could not wrap at 320 with text spacing (a 39px sideways scroll) | Fixed: "Reset to default", described by the line beside it |
| A-4 | Minor | Applications | Approve and apply was announced twice | Fixed: one announcement |
| A-5 | Minor | Prompts | "91% (36 of your last 40 decisions)": the score did not equal agreed of 40 | Fixed: scores are agreed of 40 exactly (88, 90, 75), saved worlds migrated |
| A-6 | Minor | Searches, Profile | Escape or Done from a popover opened by "+N more" returned focus to the filter's button | Fixed: focus returns to "+N more" |
| A-7 | Cosmetic | Searches, Profile | "Watching" and "No source yet" against "Watched" and "None yet" | Fixed (O-12) |
| A-8, D-1 | Minor, Major | Create account | Google as Alex with the UK chosen made a second account for an existing US identity, with no notice | Fixed: "Already signed up", Sign in instead, before anything happens |
| D-2 | Minor | Applications, autofill | The stepper's "Filled 2 of 18" stood still while "Fields filled" rose to 16 of 20 | Fixed: one fill count of 20 |
| D-3 | Minor | Applications | "Your deputy needs 2 answers" stayed after both were answered | Fixed: the notice closes on the answer |
| D-4, M-6 | Minor | Searches | The Prompts card named "Reading listings" and "Matching your roles", not the prompts' names | Fixed: the store's names |
| D-5 | Minor | Searches | The compact control had no Compare or Edit as a new version, and Roll back acted at once | Roll back asks first everywhere (fixed); the compact rows keep the next step only, with the rest in See the prompt (decided) |
| D-6, D-7 | Minor, Cosmetic | Dashboard | The Prompts card explained its measure differently, and its result ("passed its test with 90.") showed only in a tip | Replaced by N1: Prompt tests shows no Kept by you, and each result in words and shapes |
| D-8 | Cosmetic | Every page | A notice pill's name read "stays in use.. Show the notice" | Fixed: one full stop |
| D-9 | Minor | Prompts | The 90% score (A-5) | Fixed with A-5 |
| D-10 | Minor | Tours | Titles such as "These are your matches." are not first person | Not a defect: the orchestrator's own example of a title |
| D-11 | Minor | Résumés | The keyword bars showed a top 12 where the Dashboard shows 6 | Fixed: "Top 12 of 43 keywords" with See all; the Dashboard keeps 6 |
| D-12 | Cosmetic | Applications, Materials | The dock said "Approved. I'll apply now." while the row waited for the signature | Fixed: its line follows the job's state |
| D-13 | Cosmetic | Sign in | About 3.5 seconds into the story the waving left paw over the bamboo's top read as holding it | Fixed: the bamboo is 72% of its old size (its foot at x 48), and celebrate's cheer rises above it |
| D-14, M-3 | Minor, Major | Materials | After Approve and apply the page still said "apply on the employer site" and offered Let your deputy fill | Fixed: one approval place, at the top (P-13) |
| D-15 | Cosmetic | Dashboard, Searches, Job matches | On the large demo, "Top 5 of 112 sources", 123 active sources, and a filter of 113 | Fixed: "sources with matches" on the Dashboard and "Sources with roles" in Job matches' filter |
| M-1 | Major | Searches, Job matches | A tap or click on a multi-select option closed the popover without choosing, at 390, 820, and 1440 | Fixed: a press inside never closes it |
| M-2 | Major | Applications | A board card's stretched link covered the live apply controls and the email Undo | Fixed: the controls sit above the link, checked at 1440, 820, and 390 |
| M-4, M-5, M-7 | Minor or cosmetic | Dashboard | The Prompts card's tip figure, its definition's words, and a result shown only on hover | Replaced by N1 (the result is on the card) |
| M-8 | Minor or cosmetic | Dashboard | After Skip the rest the first run said "Your deputy is set up and ready" | Fixed: "Finish setup from your To-do when you like." |
| M-9 | Minor or cosmetic | Prompt drawer | A replaced trial version read "Draft" | Fixed: it is Retired |
| M-10 | Minor or cosmetic | AI & credits | The By task table's first column was headed "Day" | Fixed: "Task" |
| M-11 | Minor or cosmetic | Help | Two Demos descriptions were out of date | Fixed: Demos rewritten |
| M-12 | Minor or cosmetic | Applications | Ready for you's approved notice squeezed to about 100px at 390 | Fixed |
| M-13 | Minor or cosmetic | Dashboard | AI in October's key broke "gpt-5-mini · your key" across three lines at 820 | Fixed: model names stay whole |
| M-14 | Minor or cosmetic | Dashboard | On the large demo the axis read "Sep 29, Sep 29" | Fixed: a second search that day shows its start time under the date |
| M-15 | Minor or cosmetic | Every page | The large demo's "Example Labs 17 Careers" read as filler | Fixed: plausible fictional names, each once |
| M-16 | Minor or cosmetic | AI & credits, Dashboard | "Fell back to platform credits 1" had no unit | Fixed: "1 day" |
| M-17 | Minor or cosmetic | Dashboard, Searches | One run with two times ("today at 14:00" against "13:59") | Fixed |
| M-18 | Minor or cosmetic | AI & credits | By task's names touched at 390 | Fixed: they wrap between words, or thin |
| M-19 | Minor or cosmetic | Every page, phones | The chip's "Your deputy needs you" bubble covered the eyebrow and the heading | Fixed: at 720px and narrower the notice goes to the chip and no toast floats |

Notes the testers raised that were not defects: stacked-bar parts are pointer-only links, with Show
the numbers as the keyboard path (decided in round 6); the drawer's trend and its In use figure
named no window (fixed: each figure names its window); and the docs called the paw sides from the
panda's view (fixed: sides are the viewer's). The retests on desktops with accessibility (UAT-RD)
and on phones and tablets (UAT-RM) found 24 more (1 major, 13 minor, 10 cosmetic); all fixed:

| # | Area | Finding | Resolution |
|---|---|---|---|
| RD-1 (major) | Tours | With normal motion a tour could stop scrolling to its steps (card and Next off screen) | Jump when far or hidden; timed glide with a jump fallback; focus without scroll; 156 of 156 steps in every mode |
| RD-2 | Nav rail | Labels cut under text spacing at 1024 | Rail labels wrap |
| RD-3, RM-1 | Score trend | The minimum's label collides with a nearby point | Label kept clear; key dashed like the line |
| RD-4, RM-7 | Dashboard runs | No runs left: the tile named the next check | Says Keep watch skips, from the store |
| RD-5 | Dashboard | Large demo: a tested prompt with no result | Every tested prompt shows its last result |
| RD-6 | Applications | The applied line said twice | Said once |
| RD-7 | Notices | A toast under an open panel's backdrop | Said inside the panel |
| RD-8, RM-8 | Charts | AI in October's table wider than its card | Table flips for few days; scroll cue when truly wide |
| RD-9, RM-14 | Prompt rows | Kept by you without its window | "84% of 19 runs (version 2) · in use 79% of 57 runs" |
| RM-2 | Materials | Timeline said you apply while your deputy applied | Follows the job |
| RM-3 | Phones, tablets | Needs you never reached the chip, or cleared at once | Held on the chip or rail until you act; badge counts waiting jobs; notices go to the deputy up to 1100px |
| RM-4 | Help | A fourth runs ring | One line and a link to Purchases |
| RM-5 | Dashboard | Large demo model names overlapped counts at 768 and 820 | Counts wrap under names |
| RM-6 | Searches | A test showed only a Testing chip | Visible count and reason |
| RM-9 | Charts | Chevron underlined on hover | No underline |
| RM-10 | Prompts | A chevron on its own line at 390 | Inline |
| RM-11 | AI & credits | Tallest bar unlabelled at 320 | Names wrap instead of hiding |
| RM-12 | Purchases | Prices "checked" in the future | Checked Thu, Oct 1 |
| RM-13 | Connections | Disconnect asked with two identical buttons | Clear question, safe answer first, Escape cancels |
| RM-15 | Dashboard | A rolled-back version shown only as Passed | Says it rolled back in its trial |
| D-2 (rest), M-14, M-17 | Autofill, Dashboard | Schematic ahead of the job; repeated axis dates at 390; two times for one run | Fixed and rechecked |

### Verification

The state at the checkpoint commit `9b6f9a4` (October 5, 2026), before the testers' fixes, passes
every check below.

#### Tests, types, and lint

- 2,413 of 2,413 prototype tests pass, in 29 files (new: `account.test.ts`, `connections.test.ts`,
  `prompts.test.ts`, and `tour-placement.test.ts`).
- `tsc --noEmit` in `tests/prototype` is clean, Biome reports no errors or warnings in `brand`,
  `tests/prototype`, and `scripts` (68 files), and `git diff --check` is clean. The only dash
  characters in the prototypes are the empty-value placeholders kept since round 5. Backend
  packages were not changed.

**Rendered audit** (file URLs, 1440, 1024, 768, 390, and 320)

- The sixteen signed-in routes (round 5's thirteen and Account, Connections, and Prompts) with
  `--all`: 2,771 of 2,771 checks after the recheck, including `int.nav`, `int.sidebar`,
  `int.mobile-menu`, `focus.not-obscured`, and `motion.reduced-no-loops` 0 of 80 each,
  `parity.panda-states` 0 of 14, and, after the recheck, `layout.first-view` 0 of 48 and
  `loader.timeline` 0 of 4. The first run read 2,768 of
  2,771: the two Dashboard loader checks failed only because the folder vanished mid-run (they
  pass on recheck), and the role view's first view at 375×667 was the audit's expectation (O-7; 0
  failing on recheck).
- The entry routes, setup, the agreement page, and public Help with `--all`: 2,204 of 2,204,
  including `layout.first-view` 0 of 21 with the Region first, `parity.panda-states` 0 of 14,
  `motion.pause-stops-all` 0 of 20, and `speech.visible`, `stage.face-clear`, and
  `text.no-overlap` 0 of 250 each.

#### Probes

- `metrics.mjs` on the fifteen internal pages, the usual sample and the Large account demo, at
  1440×900 and 390×844: 60 of 60 runs with 0 mismatched and 0 repeated figures (usual: 314 figures
  at 1440×900 and 302 at 390×844; large: 319 and 307).
- The round 6 end-to-end journey (`/tmp/jd-r8/probes/e2e-r6.mjs`): 53 of 53, no console errors.
  The Region before Google and LinkedIn on Sign in and Create account (and both in the first
  viewport at 390×844); Skip setup for now and Skip the rest, with the skipped steps on the To-do;
  the nav and each Settings tab; six old links forwarding (Gmail, site accounts, LinkedIn,
  Account, applying, and prompts); the Dashboard's order, the Prompts card, What's new's
  destinations, "Top 6 of N keywords", and no keep rate anywhere; the Large account demo carried
  to Job matches and back to the usual sample; D1's landing; a prompt test from a draft to its
  outcome and the Activity line; Ready for you with Approve and apply, How your deputy applies on
  the system default, Gmail watching, and a background job starting; Résumés' company
  multi-select, gaps, and templates guide; Profile without Account and applying, and Keep watch's
  multi-select; the narrated tour with the dock stepped out; and a short Invite friends.
- The round 5 journey (`/tmp/jd-r6/probes/e2e-r5.mjs`): 25 of 25, no console errors (the rows that
  change on purpose: the nav's Settings, Profile's moved sections, the tour button's place, and
  Purchases).
- Tour placement (`/tmp/jd-r8/A3/tour-placement-probe.mjs`): the fifteen internal pages at
  1440×900, 1024×768, 768×1024, 721×900, 720×900, 390×844, and 320×568, 0 failures: the button
  within `1px` of the `h1`'s top and the intro's end from 721px, and at the `h1`'s start below the
  lede at 720px and below.
- The narrated tour: the panda in the card and the dock stepped out (the Dashboard at 1440 and
  Applications at 390, where the card docks at the bottom); the pointer's direction consistent with
  its rule on 98 steps of fifteen pages at 1440×900.
- D1 (`/tmp/jd-r8/probes/d1.mjs`): `?source=google&run=r9`, `?source=microsoft&run=r9`, and
  `?source=acme` land on the run row in the folded card, focus its heading, show no card outline
  and no filter chip, and the glow is gone by 3.7 seconds.

**Part 2** (the working tree after part 2 and the testers' fixes, October 6, 2026)

- 2,448 of 2,448 prototype tests pass, in the same 29 files.
- The sixteen signed-in routes with `--all`: 2,760 of 2,762. The two failures were Settings,
  Connections' first view at 375×667 and 360×740, where the 2026.10 notice under the intro pushed
  the Gmail card down; the notice moved after the Gmail card (which now starts at 576px at
  375×667), and the first view rechecks with 0 failing.
- The entry routes, setup, the agreement page, and public Help with `--all`: 2,204 of 2,204,
  including `layout.first-view` 0 of 21 and `parity.panda-states` 0 of 14.
- The round 6 journey (`/tmp/jd-r8/probes/e2e-r6.mjs`): 61 of 61, no console errors, now also
  checking Kept by you on Prompts with no Agreement with you, Profile's line to Keep watch on
  Searches, Keep watch's multi-select on Searches, Searches saying runs, Prompt tests right under
  the tiles with no agreement, the Gmail sync gist, and the Dashboard's Runs ring.
- The round 5 journey (`/tmp/jd-r8/probes/e2e-r5-r6.mjs`): 25 of 25, no console errors. Two steps
  change on purpose: Create account now chooses Use another account (Alex's identity already has
  an account, UAT-A A-8), and buying credits starts on AI & credits (the Dashboard's tile has one
  AI line, P-9).
- `metrics.mjs` on the fifteen internal pages, the usual sample and the Large account demo, at
  1440×900 and 390×844: 60 of 60 runs with 0 mismatched and 0 repeated figures (usual: 268
  figures at 1440×900 and 256 at 390×844; large: 271 and 259; the checkpoint counted 314 and 302
  on the usual sample).
- The retests (UAT-RD and UAT-RM): every earlier defect fixed or decided; 24 new findings, all
  fixed (table above).

**Final** (after the last retest fix, October 6, 2026)

- 2,455 of 2,455 prototype tests in 29 files; `tsc` 0 errors; Biome clean on 68 files;
  `git diff --check` clean.
- The audit with `--all` at five widths: the sixteen signed-in routes 2,762 of 2,762, 0 failing;
  the entry routes, setup, the agreement, and public Help 2,204 of 2,204, 0 failing.
- `metrics.mjs` on fifteen pages, usual and large, at 1440×900 and 390×844: 60 of 60 runs, 0
  mismatched and 0 repeated (usual 266 and 254 figures; large 270 and 258).
- The round 6 journey 60 of 60 and the round 5 journey 25 of 25, no console errors; the tour
  button's place 0 failures at seven sizes; every tour step (156 per mode) lands in view.

**Not verified:** iOS Safari and Android Chrome on real devices (every check ran in headless Chrome
with touch emulation), the safe areas, and a manual screen-reader pass.

### Part 3: end-to-end testing, prompt tests, and Gmail sync

**Date:** October 6, 2026.

The owner asked for end-to-end testing ("lot of things are buggy") and better prompt test and
Gmail sync views with data
([ui-app-redesign.md, part 3](ui-app-redesign.md#round-6-part-3-end-to-end-testing-prompt-tests-and-gmail-sync-october-6-2026)).
Parts 1 and 2 were committed first (`ea637ae`). Six fresh-eyes testers (T1 to T6) tested a frozen
copy of that commit, never the repository, while PG rebuilt prompt tests and Gmail sync; the
orchestrator reproduced each defect and routed it by file ownership to five fixers (FX-SJ, FX-AM,
FX-PS, FX-PLAT, and FX-EN) and to PG, under the shared rules R9-1 to R9-7. The testers then
retested on a second frozen copy, a seventh tester (T7) took the prompt test and Gmail sync views
with fresh eyes on the same copy, a second fix pass answered both under R9-8 to R9-12, and every
new finding was retested on a third frozen copy. The retests drove the main controls with real
mouse input (a press and release at the control's centre, never `element.click()`) and clicked
inside parts that update live several times each: a live search, a background apply, a running
prompt test, and a counting clock.

**The audit change.** With every page at five widths, `data.metric-matches` failed once, on the
Dashboard at 768 (27 found roles against the store's 29, and seven more figures from the same
run): the seeded live Amazon search finished inside the audit's read, so the store had committed
it before the page redrew. The same page and width passed alone, three times. `scripts/ui-audit.mjs`
now reads a failing `data.metric-matches` once more, 1.5 seconds later, after the page redraws;
only a figure still wrong then fails.

#### User acceptance (part 3)

| Tester | Scope and sizes | First pass | Retest (new) | Outcome |
|---|---|---|---|---|
| T1 | Entry, setup, and the Dashboard; 1920×1080, 1440×900, and 1280×720 (1366×768 and 1536×864 for the dock); usual and large; about 420 checks | 20: 3 major, 9 minor, 8 polish | 6: 1 major, 4 minor, 1 polish | All 26 fixed: T1-12 by decision ("new" means one thing; the chart is Roles found per search) and T1-16 in part (9px from level, accepted) |
| T2 | Searches and Job matches; 1920×1080, 1440×900, and 1280×720, with 820×1180 and 390×844 spot checks; usual and large; about 40 probes | 15: 5 major, 8 minor, 2 polish | 2: 1 minor, 1 polish | 14 fixed; T2-14 and T2-15 decided; T2-12 withdrawn |
| T3 | Applications, Materials, Autofill, and Résumés; 1920×1080, 1440×900, and 1280×720; usual and large; about 190 checks | 7: 5 minor, 2 polish | 5: 1 major, 3 minor, 1 polish | 10 fixed; T3-7 decided; T3-4 withdrawn |
| T4 | Profile, the Settings tabs, Invite friends, and Help; 1440×900, 1920×1080, and 1280×720; usual and large; over 150 checks | 8: 1 major, 5 minor, 2 polish | 5: 2 major, 1 minor, 2 polish | All 13 fixed, T4-3 in part (a new password equal to your email is refused; any current password still passes, decided) |
| T5 | Every page on tablets and phones with touch: 1024×768, 820×1180, 768×1024, 390×844, 375×667, and 320×568 | 17: 5 major, 10 minor, 2 polish | 1 minor | 12 fixed, T5-5 in part (the drawers; the page fields decided); T5-7, T5-8, T5-10, T5-12, and T5-13 decided; T5-9 withdrawn |
| T6 | Data, state, time, and accessibility on 22 routes; 1440×900 and 390×844; usual and large; about 320 checks | 12: 3 major, 6 minor, 3 polish | 5: 2 minor, 3 polish | All 17 fixed |
| T7 | Prompt tests and Gmail sync with fresh eyes, on the second copy; 1440×900, 1280×720, 1024×768, and 390×844; usual and large; about 450 checks | 21: 7 major, 8 minor, 6 polish | None (its one retest was the final one) | All 21 fixed |
| **All** | | **100: 24 major, 51 minor, 25 polish** | **24: 4 major, 12 minor, 8 polish** | **113 fixed, 8 decided, 3 withdrawn** |

The first pass found 0 console errors on every route the testers loaded, outside T5-2's repro;
T6's figures audit read 60 of 60 page runs with 0 mismatched and 0 repeated, and its
accessibility probe 73 of 73 route and size runs with 0 failing checks. The defects were in what no
probe covered: derived figures and words, deep links, live redraws, and state across pages.

- **Majors, first pass:** the Region lost after Create account (T1-1); signing the same version
  twice (T1-2); the Runs ring counting only free runs (T1-3, T5-3, T6-1); Job matches ignoring
  `?sort=` in the address and losing it on reload (T2-1, T2-2); old and unknown `?run=` and `?job=`
  links failing silently on Job matches and Searches (T2-3 to T2-5); "Applications" wrapping in the
  tablet rail (T5-1); the role panel's "Save to my profile" reverting with an `InvalidStateError`
  (T5-2); focus lost after a purchase from the Dashboard (T5-4); sticky drawer parts covering a
  focused field on a phone (T5-5, its page-field half decided); a held job saying "Waiting for
  you" and inventing two questions (T6-2); the AI setting shared by the usual sample and the large
  demo (T6-3); and T7's seven (Show the numbers stretching the neighbouring card, Gmail sync
  emptying after a sync that read nothing, a failed test shown as rolled back, a fail reason
  comparing a Test score with Kept by you, a tip calling 80% below an 80% minimum, the Tests stat's
  two lines on top of each other during a test, and an Amazon card saying to follow up beside its
  interview invitation). FX-SJ measured the live Searches cards at 0 of 40 real clicks landing on
  Watch live and on a card's name before its fix and 40 of 40 after, at 1440 and 390 (T2-8, filed
  as minor).
- **Majors, retest:** Show the numbers in Gmail sync drawn in the chart's narrow column (T1-R1, the
  same as T7-1); the daily limit not held at the moment of sending (T3-R2); a version that failed
  its test and never ran shown as Rolled back (T4-R2); and Gmail's week reading 5 on the Dashboard
  against 10 on Applications after reconnecting (T4-R3).
- **Decided, not a defect:** T2-14 and T5-12 (the landing glow is a Web Animation with a
  reduced-motion path), T2-15 (visually hidden text is 1px), T3-7 (Approve all that passed confirms
  even one role), T5-7 (the See all drawer's header stays put and opaque under a 700px drag, with
  Close in reach), T5-8 (the role panel's sheet keeps a Close at its top), T5-10 (Keep connected is
  Disconnect's cancel, and Escape returns focus to the opener), and T5-13 (below the wide layout
  the filters live in the Filters sheet, whose button says how many are on).
- **Withdrawn by their testers:** T2-12 (one chip read twice through its visually hidden text),
  T3-4 (focus after a move was right; a helper printed the whole option list), and T5-9 (Help's
  large-demo switch works; the probe called `demo()`, and the API is `scaleDemo()`). T2 and T3 also
  corrected parts of their first reports in their retests.

**Final retest** (the third frozen copy: each item from a fresh state, most of them twice, then a
regression pass with the main walkers and real mouse input; no regression in any scope):

| Tester | Retest items | New in the final retest |
|---|---|---|
| T1 | T1-R1 to T1-R6 fixed (Gmail's table now has 367px at 1440 for the 365 it needs; opening it grows only its card, 386 to 871px while Prompt tests stays 352), and T1-12, T1-15, and T1-20 fixed; T1-16 still 9 to 10px off, accepted | T1-F1 (polish): the tip of a version rolled back in its trial said only "Passed: at or above your 80% minimum."; fixed after (the tip adds "Then rolled back in its trial, Sun, Sep 27.") |
| T2 | T2-R1 fixed (a failed draft reads Did not pass everywhere, Rollbacks stays 2 while Tests goes 10 to 11) and T2-R2 fixed | T2-F1 (polish): with no runs left, Keep watch's card said so twice above a ring at 0 of 10; fixed after (the daily line reads "none until you have runs again") |
| T3 | T3-R1 to T3-R5 fixed (the daily limit: two applied, two held at Sending with "Your daily limit of 2 is reached: it goes on tomorrow."), and R9-12 on the Amazon card | T3-F1 (polish): the List row's Follow-up date beside a waiting move; fixed after ("After you sign") |
| T4 | T4-R1 to T4-R5 fixed (the week reads 10 before and after reconnecting, the next check 14:30) | None |
| T5 | T5-R1 fixed (24 of 24 tables have every column readable at some scroll position at 320, 375, and 390) | None |
| T6 | T6-R1 to T6-R5 fixed; metrics 60 of 60 page runs, accessibility 74 route and size runs with 0 failing checks, 0 console errors on 88 loads, 39 more real clicks in live parts | None |
| T7 | All 21 fixed (its repro 11 of 11, twice) | T7-F1 and T7-F2 (polish): a Latest job emails row starting its second line with "·", and Gmail's table wrapping its day column; both fixed after |

#### Verification (part 3)

The working tree after the final retest's fixes, October 6, 2026.

- Prototype tests: 2,496 of 2,496 in 29 files; `tsc --noEmit` in `tests/prototype`: 0 errors;
  Biome on `brand`, `tests/prototype`, and `scripts`: clean (68 files); `git diff --check`: clean.
  Backend packages were not changed.
- The audit with `--all` at 1440, 1024, 768, 390, and 320 (with the `data.metric-matches` reread
  above): 818 check groups across every route (the sixteen signed-in routes, the entry routes,
  setup, the agreement, and public Help), 0 failing. The Dashboard, Applications, Searches, and
  Prompts, edited after that run, were audited again at all five widths: 0 failing.
- `metrics.mjs` on the fifteen internal pages, the usual sample and the Large account demo, at
  1440×900 and 390×844: 60 of 60 runs, 0 mismatched and 0 repeated.
- The round 6 journey (`e2e-r6.mjs`): 60 of 60; the round 5 journey: 25 of 25; console errors: 0.
  T7's prompt and Gmail repro (`/tmp/jd-r9/T7/repro.mjs`): 11 of 11.

**Not verified:** iOS Safari and Android Chrome on real devices (every check ran in headless Chrome
with touch emulation, and T5's on-screen keyboard was emulated by shrinking the viewport), the safe
areas, and a manual screen-reader pass.

## Ninth review: round 7 of the signed-in redesign

**Date:** October 6 and 7, 2026.

The owner reviewed round 6 (they titled this review "Round 8") and asked for a better UX, concise
and easy without losing anything: a branded sign-in, no flicker and no hang, signing in one step, a
denser Dashboard, one prompt experience, one home per thing, lists that keep your place and filter
live, Job matches as a queue, Applications as one flow, an audit trail, a concise Purchases with
receipts, usage with every permutation, and notes for the React build, with nothing they did not
mention broken
([ui-app-redesign.md, round 7](ui-app-redesign.md#round-7-the-owners-sixth-review-october-6-and-7-2026)).

The orchestrator measured before briefing anyone. Layout shift after the first paint on phones:
Searches and Applications 0.97, Job matches and Prompts 0.92, the agreement 0.73; at 1440,
Applications 0.45, Searches 0.24, Prompts 0.15; and the deputy dock 0.0075 on every page. On the
large account the Dashboard ran one 1.4 s task (0.7 s on the usual sample at 390), because
`metrics()` copied the whole metrics object on every `metric()` read. The baseline: 2,496 of 2,496
prototype tests, `tsc` 0 errors, Biome clean, the audit `--all` at five widths 0 failing, and the
figures probe 0 mismatched and 0 repeated. ST (the store) and PL (the platform) wrote their
contracts first; seven page owners built by file ownership; seven fresh-eyes testers tested a
frozen copy; the same owners fixed what the testers found; and the testers retested a second frozen
copy.

### The audit's new checks (round 7)

- **`perf.budgets`** (R10-10), on every page the audit loads, at every width, measured from the
  navigation by a probe installed before any page script runs: the layout shift after the first
  paint sums to at most 0.02 (shifts within 500 ms of input excluded), and no task runs over 200
  ms. A failure names the shifting nodes (their boxes before and after) and the long tasks.
  `--large` (or `JD_LARGE=1`) measures `?demo=large` too (`perf.budgets-large`), and
  `--budgets-only` runs only the budgets. The third budget, the first view within 1 s, is not an
  audit check; T3 measured it with filmed loads.
- **Touch emulation below 1024px** (from T2's key finding: the audit had driven 390 with a desktop
  pointer): every width under 1024px runs as a touch device (`Emulation.setDeviceMetricsOverride`
  with `mobile: true`, and `Emulation.setTouchEmulationEnabled`), so `hover: none` and `pointer:
  coarse` match and a page wider than the screen widens the layout viewport as on a phone.
  `--touch=off` runs every width with a mouse, `--touch=all` every width with touch.
- **`int.tour`, `int.tour-phone`, and `int.tour-row`** (T2-12): Take the tour is the shared
  secondary action (`15px`/680, `52px`) from 721px and on phone intros without an eyebrow; on phones
  where the intro starts with an eyebrow it sits compact at the end of the eyebrow's line
  (`13px`/680, at least `44px`). `int.secondary` no longer covers `.page-tour`.
- **The new routes and exemptions:** Usage and Activity are internal pages (the full chrome and the
  seven tabs); the sample email is a `preview` group (the global checks and the budgets, with no
  shell and no first-view check). `int.primary` is optional on Prompts, Usage, Activity, and the
  email preview; `entry.panda-status` is skipped in the phone band at rest; `control.no-wrap` leaves
  Searches' `.srch-toggle` names alone, which wrap on purpose. The entry story's scenes are the three
  steps.

At the end of the build, before the testers' fixes, the audit `--all` at five widths read 0 failing,
`perf.budgets` 0 of 130 among them.

### User acceptance (round 7)

| Tester | Scope and sizes | First pass | Retest | Outcome |
|---|---|---|---|---|
| T1 | Desktop journeys, start to finish, at 1440×900 and 1024×768, usual sample | 26 | 17 rechecked FIXED (T1-1 to T1-16, T1-19); the agent ran out of context before its fresh pass | The rest (T1-17 to T1-26) fixed by their owners and checked with T1's probes and the other retests |
| T2 | Phones and tablets with real touch: 390×844, 320×568, and 768×1024, with 375×667 and 360×740 spot checks; usual and large | 25 | 21 fixed, 2 with leftovers, 2 still broken; 5 new (T2b-1 major, 4 polish) | All fixed after the retest (T2-13 at 320, T2-22, T2b-1 to T2b-5) |
| T3 | The large account and performance: every signed-in page at 1440×900 and 390×844, 4x CPU, filmed loads | 24 | 22 fixed; T3-5 partly (4x CPU only), T3-18 on Usage; 4 new (T3-25 to T3-28) | All fixed after the retest; T3-5 at 4x CPU accepted as a stress result (the budgets are at 1x) |
| T4 | Accessibility: keyboard only, screen reader semantics, reduced motion, forced colours, 200% zoom | 19 | 17 fixed; T4-6 half; T4-18 toast reach unchanged; 7 new (T4-20 to T4-26) | All fixed after the retest; T4-18's toast reach accepted (the notice is kept in Activity) |
| T5 | Data consistency: runs, tokens, prompts, the automation split, needs you, Gmail, receipts, across pages and both worlds | 20 | 17 fixed; T5-10 and T5-16 still broken; 6 new (T5-21 major, a regression from the T5-7 fix) | All fixed after the retest |
| T6 | The owner's UAT: every row of the brief, at 1440×900 and 390×844, usual and large | 19 | 19 fixed (T6-8 on Usage and T6-3 on Materials fixed after); G1 on phones changed by decision; 3 new polish | All fixed after the retest |
| T7 | Regression against round 6: the round 6 and round 5 journeys, round 6, part 3's repro, every deep link and old anchor, the R9 rules | 14 | 14 fixed or changed by decision; 7 new (T7-R1 major) | T7-R1 to R5 and R7 fixed; T7-R6 withdrawn (the wording it found is the signed 2026.09 text, which must not change) |
| **All** | | **147, before merging duplicates** | 32 new in the retest across the seven | Every first-pass and retest finding fixed, decided, or withdrawn; the fixes after the retest were checked by their owners with the testers' own probes and by the final verification below, not by a third tester pass |

- **Majors, first pass, by kind:** figures that disagreed between pages (T5-1 to T5-10: a new
  receipt hidden by a minute-cut range, the checkout counting Keep watch only, Kept by you computed
  three ways, a week line mixing windows, steps stamped at noon, September using more runs than
  existed, the large account's usage against its own AI setting, a key's tokens ring counting
  another key, a raw "no-runs" code under Scan now, and needs you disagreeing with the board);
  touch-only overflow and popovers off screen (T4-1, T2-1 to T2-4); accessibility (T4-2 the score
  trend's numbers missing for screen readers, T4-3 no word when tailoring finished, T4-4 a focus
  jump in the time range, T4-5 the signing moment below the fold); the prompt summary differing
  from page to page (T6-3) and a card disagreeing with its panel (T6-2); live updates replacing
  controls and losing focus or typing on the large account (T3-19, T3-2, T3-3, T7-1); stale first
  frames (T3-1); tasks over budget at 4x CPU (T3-5); Prompts' Details disagreeing with its row
  (T7-6); and Usage's runs counts ignoring the range (T1-2).
- **Decided, not defects:** the tokens ring follows the key's limit period (T6-19); the header Back
  pill stays on Materials and Autofill and every other page uses the intro's Back (T6-17); a move
  already read still waits for your signature after a Gmail disconnect (T5-10); on the unsigned
  usual sample Sync from Gmail moves nothing and says what will move once you sign (T6's A1 caveat).
- **Retest:** on a second frozen copy (`/tmp/jd-r10/snapshot2`) the same testers reran every probe
  behind their findings, then a short fresh pass (T1, T2, and T6 ran out of context; T2 and T6 were
  continued by fresh agents from their saved probes, T1's saved script was read). Per tester in the
  table above. The new majors were T2b-1 (Applications' Gmail line, notice, and drawer counting
  waiting moves and replies differently after Sync), T5-21 (the large account's relabelled platform
  calls kept other models' prices, a regression from the T5-7 fix), and T7-R1 (the Dashboard Usage
  card's Show the numbers hiding a column at 1280 and 1024); all three are fixed.

### Verification (round 7)

The working tree after the retest's fixes, October 7, 2026, frozen as `/tmp/jd-r10/snapshot4` for the final run.

- Prototype tests: 2,785 of 2,785 in 31 files (new: `usage.test.ts` and
  `activity.test.ts`); after the fix pass, before the retest, the suite read 2,765 of 2,765.
- `tsc --noEmit` in `tests/prototype`: 0 errors. Biome on `brand`, `tests/prototype`, and
  `scripts`: clean (73 files). `git diff --check`: clean. No em or en dash added outside the tests'
  own no-dash checks. Backend packages: not run; this round changed only `brand/`, `docs/`,
  `scripts/ui-audit.mjs`, and `tests/prototype/`.
- The audit with `--all` at 1440, 1024, 768, 390, and 320 (touch below 1024), every route: 691
  groups, 0 failing checks. `perf.budgets`: 0 of 130 failing. With `--large --budgets-only`: 0 of 130
  failing.
- `metrics.mjs` on the internal pages (with Usage, Activity, and the sample email), the usual sample
  and the large account, at 1440×900 and 390×844: 71 page runs, 0 mismatched, 0 repeated.
- Journeys (T7's suites on the final copy): the round 6 journey 50 of 60, the 10 misses all intended
  changes of this round (D7, D2, A1, D3); the round 5 and 6 journey adapted for round 7, 32 of 34, the
  2 misses the AI & credits buy drawer removed by decision (buying has one home); round 6, part 3's
  prompt and Gmail repro 12 of 12; deep links 172 of 184, the 12 misses probe expectations triaged by
  T7; return paths 8 of 9 at 1440 and 7 of 9 at 390, the misses probe artifacts (rechecked by hand:
  Autofill's Back reopens the role panel with focus on its link; on phones the probe's third control
  is Not for me); console: 120 loads, 0 errors. Load budgets on the heavy pages, usual and large,
  1440 and 390: CLS at most 0.005, longest task 138 ms.

**Not verified:** iOS Safari and Android Chrome on real devices (every check ran in headless Chrome,
with touch emulation below 1024px), the safe areas, and a manual screen-reader pass.
