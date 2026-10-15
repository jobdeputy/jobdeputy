# JobDeputy signed-in app redesign

**Status:** round 1 built and verified on October 3, 2026. The owner reviewed it the same day, and
[round 2](#round-2-the-owners-review-october-3-2026) answers that review; both wait for the owner's
final review. The locked UI foundation records both amendments ([ui-foundation.md](ui-foundation.md)).

## Why

On October 2, 2026 the product owner said the sign-in story was engaging, but the inside of the app
was "pretty basic". They asked to redesign the dashboard, application tracking, AI credits, and the
résumé and profile flow, using Teal's app as inspiration. The one unique ask was to carry the panda
across every page, animated by the kind of work being done, "so that it feels like their deputy is
always with them".

Before the redesign, the signed-in pages were forms on paper: no app navigation, no overview of
progress, and no deputy anywhere after sign-in.

## What we took from Teal, and what we did not

| Teal pattern | JobDeputy version |
|---|---|
| Sidebar navigation that collapses to icons | The app shell: a `233px` sidebar, an `89px` rail from `721px` to `1100px`, and a phone app bar with a Menu disclosure. The deputy lives at the bottom of the sidebar |
| Home with a goal and a "Getting started" checklist | The Dashboard: the deputy's report, Needs you, the pipeline, setup (it compacts once done), AI and credits, and recent activity |
| Job tracker with stage counts, table, and board | Applications: seven stages, Board and List views, a details drawer with a timeline, notes, follow-ups, approval, Mark as applied, Close with a reason, and Add a role |
| Résumé builder with live preview, analyzer score, and job matcher | Résumés (library, upload states, a readiness ring) and the materials editor (draft beside a live page, Job match counted from the draft, Changes to check, Approve materials) |
| Onboarding after Google sign-up, one question per screen | Onboarding: the deputy asks one question at a time, with large choice cards and a step line |
| Account settings, subscription, referrals | Profile (About you, Job preferences, Account) and AI & credits (default AI, free credits, usage, keys). No prices. Round 2 adds Invite friends, which earns bonus platform AI runs, never money |
| Help centre with search and topics | Help: topic search, popular questions, Privacy, Security, Accessibility, support, and Reset sample data |

We did not copy Teal's flat grey look, upsell banners, prices, contacts or companies trackers,
referrals, browser extension, "How did you hear about us", videos, or blurred paywalled content.
Every page keeps JobDeputy's warm paper, serif narrative, ink actions, green-for-progress, and
orange-for-attention language.

## The deputy, always with you

The deputy dock appears on every signed-in page. Its pose names the page's work:

| Page | Pose | Duty |
|---|---|---|
| Dashboard | Holds up a report card | Reporting in |
| Searches | Sweeps a magnifier while a search runs | Searching |
| Jobs | Ranks three cards, best on top | Ranking |
| Applications | Ticks a clipboard | Keeping track |
| Résumés and materials | Writes on a page | Tailoring |
| Profile | Guards the "US" Region shield | Guarding your data |
| AI & credits | Holds the key close | Holding your key |
| Help | Rests | Ready |

Moments show over these poses: a once-per-session greeting, pending work, success, and error. The
deputy also moves from the previous page's pose into the next one, and its Activity panel lists
what it is doing and what needs you. Pause motion stops it everywhere, and reduced motion keeps
every pose still. `brand/deputy-preview.html` is the cast sheet of every state and size. The rules
are in [Deputy companion](design-system.md#deputy-companion-signed-in-pages).

## Page tour

| Route | What it does now |
|---|---|
| `login-preview.html` | Unchanged, apart from `Continue with Google`, which simulates a first-time Google sign-up and opens onboarding. `?google=unavailable` keeps the old notice |
| `onboarding-preview.html` | Eight questions with the deputy, then the Dashboard with the first search running |
| `home-preview.html` | The Dashboard. `?state=new` is the first-run view |
| `searches-preview.html` | Add a source, then Recent searches grouped by source with history. Includes the Keep watch preview |
| `jobs-preview.html` | Ranked roles with Why it fits, keywords on and off your résumé, materials, Shortlist, Tailor, and Not for me |
| `applications-preview.html` | The tracker |
| `documents-preview.html` | Résumés: library, readiness, and tailored drafts |
| `materials-preview.html` | The editor and approval |
| `profile-preview.html` | What your deputy knows about you |
| `ai-preview.html` | AI & credits |
| `trust-preview.html` | The Help centre (`?public` from the entry pages) |

The pages share one sample store (`brand/sample-store.js`). A role shortlisted on Jobs appears in
Applications; approving materials updates Applications, the Dashboard, the nav count, and the
deputy's Activity; Help resets it all.

## Decisions made for this review

These were judgment calls; each can change.

1. **Shell:** a sidebar replaced header-only navigation on signed-in pages. The header itself is
   unchanged.
2. **Section names:** Dashboard, Searches, Jobs, Applications, Résumés, Profile, AI & credits, and
   Help. Search home became the Dashboard, and the search form moved to Searches.
3. **Deputy placement:** the dock sits at the bottom of the sidebar, so navigation comes first and
   the deputy never stacks under the logo's panda. A page with the dock never draws a second panda.
4. **Google sign-up:** simulated, and it leads to onboarding. The create-account page has no Google
   button, because that route's locked geometry is shared with sign-in. (Round 2: Create account
   now has Google too, and Sign in's Google path is the returning one.)
5. **Onboarding questions:** where to help, target roles, workplace and location, start timing,
   résumé, first source, and AI choice. Only the questions JobDeputy uses are asked.
6. **Application stages:** Shortlisted, Tailoring, Approval, Applied, Interviewing, Offer, and
   Closed. Approval waits for the person. In the prototype nothing is submitted, and the person
   marks a role applied.
7. **Fit labels and reasons:** shown as launch previews, always with the sample marker. The
   foundation rule now says so.
8. **Credits:** free platform AI runs (one a week and four a month, decision
   [0009](decisions/0009-llm-architecture-and-own-keys.md)). The sample's weekly run is used, so
   the next one is Monday, Oct 5. Own-key runs use no credits.
9. **Premium:** labels only Keep watch (automatic role lookup), always opt-in, planned for launch,
   with no price.
10. **Moves:** the résumé library moved from Profile to Résumés, and AI settings moved to
    AI & credits. Profile links to both.
11. **Upload limit:** 5 MB, matching `packages/shared/src/documents.ts`.

## Open questions for the owner

- Should Create account also offer `Continue with Google`? That changes the locked shared geometry.
  (Answered in round 2: yes.)
- Is "Premium" the right name for Keep watch, and should the app hint at the plan before launch?
- Teal also tracks contacts and companies. Should JobDeputy, later?
- Should tailoring move from a text editor with a live page to a structured section editor, like
  Teal's?
- Is interview preparation a future page?

## How to review

Open the pages straight from the folder (no server needed). Start at
`brand/login-preview.html?skipLoader` and choose `Continue with Google`, then:

1. answer the questions;
2. read the Dashboard;
3. open Jobs and shortlist a role;
4. open Applications;
5. approve the materials for Search Infrastructure;
6. look at Résumés, Profile, and AI & credits;
7. use Help, then `Reset sample data`.

Also open `brand/deputy-preview.html` (every deputy pose) and `brand/components-preview.html`
(every shared component). The before screenshots and the Teal references used for this work were
kept outside the repository.

## Verification

See [ui-consistency-audit.md](ui-consistency-audit.md#third-review-signed-in-app-redesign) for the
test, audit, and end-to-end results.

## Round 2: the owner's review (October 3, 2026)

The owner reviewed round 1 on a phone, a tablet, and a desktop and sent thirteen findings. Round 2
answers each one, built by agents and checked by the orchestrator page by page.

| # | The owner said | What changed | Where |
|---|---|---|---|
| F1 | On a phone the story fills the top and the form starts below the fold, "mainly for the new account creation flow" | Researched first ([25 sources](ui-research-mobile-entry.md): NN/g, web.dev, WCAG 2.2, Apple, Google Identity, Baymard, WebKit). On phones the story is now a short band above the form that keeps the animated panda and its reactions; it folds into a slim strip while you type and opens in full on request. Onboarding is phone first: a small deputy row, the question, the options, and a sticky Back and Continue | `login-preview.html`, `access-preview.html`, `onboarding-preview.html` |
| F2 | First-time people get setup; "show how the quick user login will look" | Two experiences. Create account (email or Google) goes to setup. Sign in (email, Google, or the one-tap "Continue as Alex" card of a remembered browser) goes straight to the Dashboard with a "Signed in" note. Help keeps Run setup again | Entry pages, Dashboard, onboarding |
| F3 | Step 1 is missing automatic application filling; "I want to see everything" | Step 1 offers "Filling in applications" (planned for launch). The new autofill preview shows the deputy filling a generic employer form from your profile, résumé, and saved answers, asking for what it does not know, and submitting only after you check it. Nothing is sent | `onboarding-preview.html`, `autofill-preview.html`, Applications, Materials |
| F4 | Is step 4 (start timing) relevant? Maybe premium scheduling | Start timing never affected ranking (jobs carry no start dates); the backend keeps it for application forms, so it moved to Profile, Application answers. Step 4 now asks how often to look: When I ask, or Every day with Keep watch (Premium, planned for launch) | Onboarding, Profile |
| F5 | Step 6's chosen example is not highlighted | Quick picks with one selected style for every choice control in the product, and a confirmation line ("First search: Amazon Jobs") | Onboarding, shared components |
| F6 | The Dashboard should be visual; clicking a graph should route | A snapshot of KPI tiles and charts (pipeline, matches by source, fit, searches, AI usage, upcoming dates); all 54 tiles, bars, segments, and legend items open their filtered page. 222 words instead of 392 | `home-preview.html` |
| F7 | Searches has too much text | Summary tiles, an omnibox with quick picks, a live run card, and source cards with checked → kept and run history. 198 words instead of 296 | `searches-preview.html` |
| F8 | What is the difference between Jobs and Applications? | Searches find roles, Job matches (renamed from Jobs) is where you decide, Applications tracks only what you chose. A flow ribbon on all three pages shows it; Job matches no longer repeats the application workflow | Shell, `jobs-preview.html`, `applications-preview.html` |
| F9 | Modernize Profile and capture everything the backend needs | Six sections in view mode with inline edits, covering every `users`, `preferences`, `answers`, and `vault` field or showing it as planned. The coverage table and sixteen backend gaps are in [profile-data-coverage.md](profile-data-coverage.md) | `profile-preview.html` |
| F10 | AI & credits is text-heavy | Source tiles, rings for this week and October, a bonus-runs tile, compact key cards, and usage tiles and charts. 287 words instead of 638 | `ai-preview.html` |
| F11 | Help is good | Kept. Added Send feedback, the Keep watch answer anchor, and Run setup again with saved answers | `trust-preview.html` |
| F12 | Referrals are missing (give platform credits) | Invite friends: share a link or invite by email; when a friend runs a first search you both get 2 bonus platform AI runs (at most 10 a year). Planned for launch, never money | `invite-preview.html`, AI & credits, Dashboard |
| F13 | No way to give feedback | A Feedback drawer from the header, the account menu, and Help (five faces, a topic, a note), plus "Was this match right?" on Job matches. Notes stay in this browser | `feedback.js`, Job matches |
| | Consistency on phone, tablet, and desktop | One header, nav, dock, footer, and selected style everywhere; every page checked at nine sizes; a guideline pass and the audit over every page | All pages |

### Decisions made for round 2

These are judgment calls; each can change.

1. **Job matches** is the new name for Jobs, and Invite friends has no sidebar item, so the rail
   still fits a 768px-tall screen. Feedback and Invite friends sit in the header instead.
2. **Step 4** asks how often to look, and "When I ask" is preselected, because that is how the
   deputy works today and Keep watch stays opt-in.
3. **Referral reward:** 2 bonus platform AI runs for each person when the friend runs a first search
   (signing up alone earns nothing), used after your free runs, lasting 90 days, at most 10 a
   year. This is a proposal: it needs a decision record against the cost guardrails (0005) and the
   weekly and monthly caps (0009) before it is built.
4. **Autofill** follows the data model's Phase 2 steps (open, fill, upload, answer, review,
   submit). Site sign-in is left out because site logins are future work. It is gated until the
   materials are approved, so the review path is Materials, approve, then fill.
5. **Profile** drops "what matters most" (no backend field and nothing ranks on it), shows
   equal-opportunity answers and site logins as planned without collecting them, and uses a
   sticky section list on the right of its sections (not a second rail beside the sidebar).
6. **The Dashboard** does not draw tokens by week (October has one week of data); its AI card links
   to the weekly chart on AI & credits.
7. **Searches** drops round 1's Recent searches filter and pager (six cards need neither); each
   card keeps its full history behind its name.
8. **Onboarding** puts the step progress in the header, runs edge to edge on phones, shows three
   quick picks, and opens "What is Keep watch?" in a new tab so setup keeps its place. Skipping
   setup shows the honest first run, which asks for a first source.
9. **Entry pages:** the phone band is 134px; every entry card now takes Create account's height,
   so on tall split screens Sign in's form sits 27px higher than in round 1.
10. **Page titles** read "JobDeputy · Page" (no dashes), and the panda keeps its own colours in
    forced colours, like an image.

### Open questions for the owner

- The bonus-run rule above, and whether a bonus run may be used in a week whose free run is spent.
- The sixteen backend gaps in [profile-data-coverage.md](profile-data-coverage.md#9-gaps-found-both-ways-and-recommended-backend-additions),
  for example a role's résumé (`resumeDocumentId` is not in the role input yet) and input schemas
  for application answers and apply settings.
- Is "Job matches" the right name, and should Invite friends ever get a sidebar item?
- Should the one-tap card carry a prototype note? At 1280×720, Create account's button now starts
  10px below the fold; is that acceptable?
- Should Searches bring back a filter and pager once a person has many sources?
- Autofill: should "Save to Profile" start checked, and should the preview be replayable without
  Reset sample data?
- Phones were checked in headless Chrome. iOS Safari, and the safe-area padding it needs
  (`viewport-fit=cover`), are not verified yet.

### How to review round 2

Open the pages straight from the folder. Start at Help and choose Reset sample data, then:

1. **First time:** `brand/access-preview.html?mode=create&skipLoader` → Continue with Google →
   Alex Morgan → answer setup (try Filling in applications, Every day with Keep watch, and the
   Amazon Jobs pick) → the Dashboard with the first search running. Try it at a phone width too.
2. **Returning:** `brand/login-preview.html?skipLoader&returning=1` → Continue as Alex, or Continue
   with Google → Alex Morgan; both land on the Dashboard with no setup.
3. **Dashboard:** click a tile, a bar, a donut segment, or a legend item; each opens its filtered
   page.
4. **Job matches:** Add to Applications, then answer "Was this match right?" with No and Tell us
   more.
5. **Autofill:** Materials for Search Infrastructure → Approve materials → Let your deputy fill the
   application → Start filling → answer the two questions → I checked this application → Submit.
6. **Invite friends** (the header gift), **AI & credits**, **Profile**, and **Feedback** (the
   header speech bubble).
7. `brand/components-preview.html` shows every shared component, and `brand/deputy-preview.html`
   every deputy pose, including the new fill and invite poses.

### Round 2 verification

See [ui-consistency-audit.md](ui-consistency-audit.md#fourth-review-round-2-of-the-signed-in-redesign).

## Round 3: the owner's second review (October 4, 2026)

The owner reviewed round 2 on a phone, a tablet, and a desktop and sent 37 findings (their
numbering; there is no 33, and the second "3" is 3b here). Round 3 answers each one. Twelve agents
built it in two phases: four shared foundations first (the shell and panels, the deputy, the
components, and one sample world), then eight page owners. The orchestrator checked every claim
by rendering, testing, and probing, and then ran user acceptance tests end to end.

| # | The owner said | What changed | Where |
|---|---|---|---|
| 1, 32 | On a phone and a tablet the menu and the panda scroll away | The phone header and app bar (Menu and the deputy chip) are one `119px` unit that stays at the top; the Menu opens as an overlay. From `721px` the sidebar and rail are fixed for the whole page, footer included | Shell, every signed-in page |
| 2, 25 | Pause motion "doesn't change anything"; the panda could react to what you do | At rest nothing used to move, so pausing showed nothing. The deputy now makes a small idle gesture every 13 to 21 seconds, shows "Motion paused", and Pause stops every animation on the page (`html[data-motion]`). It reacts once to each action: added, set aside, saved, sent, copied, archived, deleted, started, found, approved, submitted, celebrate, error | `deputy.js`, every page |
| 3 | "Roles found 27", but Job matches showed 12; a demo to explain it, replayable any time; "clarity on the data first" | Every page now reads one sample world: 27 found roles, all listed in Job matches (All = New 20 + In Applications 5 + Not for me 2), new roles per search add up to 27, and a live Amazon search adds 2 so every page moves to 29 together. A guided tour on each page, after setup and from Show me around (account menu, the deputy), Take the tour, and Help's Demos | `sample-store.js`, every page |
| 3b, 4 | What does each colour mean? Find it on hover, in the demo, and consistently after a click | Every chart colour has a tooltip (name, count, meaning, where a click goes) and a key on touch screens; fit and stage words and tones come from the store, so the page a click opens shows the same name, colour, and count | Dashboard, Job matches, Applications |
| 5 | Free AI runs: better colours for used and remaining | A shared allowance meter: hatched used, green left, blue bonus or added, every number in words | Dashboard, AI & credits |
| 6 | Combine the tiles that repeat; show nightly runs, the current search, and the free runs people pay beyond | Two split tiles (Job matches with the fit split; Applications with the stage split and the next interview), Free AI runs, and Keep watch (8 of 10 nightly runs left, lasts through Tue, Oct 6, Get more runs), plus Search status with the live run | Dashboard |
| 7, 8 | Remove Applications by stage and Fit mix; critique duplicate data | Removed. A figure appears once per page: every figure carries `data-metric` and the orchestrator's probe fails a repeat or a mismatch with the store | Dashboard, all pages |
| 9, 12 | No Review strong fits button; maybe a live table | The tiles are the links; a Latest matches table with a Live indicator shows the newest roles | Dashboard |
| 10, 36 | Remove the bottom cards; one To-do; alert on missing required details | One To-do of six: approve materials, follow up, nightly runs ending, interview prep, fix a source, and the 2 details applications need | Dashboard |
| 11 | Matches by source, roles per search, and token usage are good | Kept, from the store; the donut's centre no longer repeats the total | Dashboard |
| 13 | Feedback colours: red for bad, another for medium, green for good | Frustrated and Not great in danger red, Okay in blue (orange could not reach 3:1), Good and Love it in green, and the chosen card follows its rating | `feedback.js` |
| 14, 28 | Invite and the footer are good | Unchanged apart from the shared chrome; the footer now starts beside the fixed sidebar | |
| 15, 37 | The account menu is see-through and overlaps the content | Opaque with a border and shadow; a sheet with a scrim on phones | Shell |
| 16, 17, 18 | Searches: retry, archive or delete, archived view; expand all, edit, watch live; schedule nightly (Keep watch) with its free limit; Add a source too big | Your sources lead; Add a source is one row with Browse examples; Expand all; inline edits (roles, schedule, AI); Run again, Retry, Watch live with stages and counters; Archive, Delete with a confirmation, and an Archived view with Restore; a Keep watch panel with the allowance and Get more runs | `searches-preview.html` |
| 19 | Job matches: data consistency | Reads the store's catalog; All, New, In Applications, Not for me add up; fit words and colours match the Dashboard | `jobs-preview.html` |
| 20 | Applications: summary and Add a role on top; Add a role collects too little | Summary (7 active · 5 from Job matches · 3 added by you, and the stage strip) and Add a role on top, the Board and List switch above the cards, and Add a role with the posting link (a simulated read), the description, the facts, the résumé to tailor from, and required markers | `applications-preview.html` |
| 21, 22, 29 | Résumés: a default résumé and CV, drafts that are easy to find and search, previews; readiness with Looking for and Found and precise keywords; Markdown templates, live pages, page count, one-page advice | One default per kind; a preview for every document; a drafts library with search, filters, and sort; readiness with Looking for and Found and keywords counted across found roles ("in 18 of 27 roles", updated after each search); Classic, Modern, and Compact Markdown templates plus Upload your own; the page setting; Materials edits Markdown beside live pages that print exactly as shown | `documents-preview.html`, `materials-preview.html` |
| 23, 24 | Gender is missing; Keep watch's runs left everywhere; red required, blue optional | Voluntary self-identification (gender with Non-binary, Prefer to self-describe, and Prefer not to say; Hispanic or Latino; race; veteran; disability), never used to rank, never counted, never nudged; red and blue need markers from the store with a summary; Keep watch with the same allowance as every page | `profile-preview.html` |
| 26 | Change the model on a saved key; recommended models; a disclaimer | Change model keeps the key: the recommended model first, others behind "Larger models cost more per run on your key and can use more tokens…" and a confirmation; each figure once (the critique is in the agent notes) | `ai-preview.html` |
| 27, 35 | Help: drop what the menu already reaches, add the demos, complete FAQs, merge 04 Help with Feedback; hide signed-in content when signed out | Topic cards filter answers; Demos; a complete FAQ; one Contact section (Send feedback, or Get help with a problem); the public Help shows only public content | `trust-preview.html` |
| 30 | Show the prompts and let people customize them | A Prompt drawer for all six LLM tasks (read, rank, tailor, letter, answer, check): the locked safety rules, your instructions, the model, and Reset; opened wherever a task runs and listed on AI & credits | `app-panels.js` |
| 31 | Autofill: is it the replica of what is submitted, when is it read, self-identification from Profile with an override, Gmail for accounts, codes, and status | The page says these are the exact answers your deputy submits, when the form was read, fills self-identification from Profile with "Answer differently for this application", and shows the account step with the one-time code from Gmail; Profile shows the Gmail connection's scopes, what it reads, and what it never does | `autofill-preview.html`, Profile |
| 34 | The entry animation differs between Sign in, Forgot password, and Create account on phones and tablets | Recorded frame by frame on all four routes at four sizes: eight differences fixed (the loader played on Sign in only, a hidden tab froze the story, Pause motion was ignored, error recovery and field checks differed, the error summary sat elsewhere, stacking differed, and the story panel was two copies). All four now match | `login-preview.html`, `access-preview.html` |

### Decisions made for round 3

These are judgment calls; each can change.

1. **Keep watch's allowance:** 10 free nightly runs a month, where one nightly run is one watched
   source checked once (two sources use two a night). The free runs last through a date, and Get
   more runs offers packs counted in runs, with no price ("Pricing isn't set, and nothing is
   charged"). In the prototype the runs are added so the effect shows. "Premium" is gone.
2. **One sample world:** the store is the only source of every number, date, and list; pages use
   `metricText(key)`, so a figure reads the same everywhere. The prototype clock is Friday, Oct 2,
   2026, 14:00 Pacific, and a fresh browser starts the live Amazon search (about 100 seconds;
   `?runs=fast` makes it about 10).
3. **Fit words follow the data:** Strong is "A target role, with most of what it asks", Good "A
   target role, with a gap to check", and Stretch "A level, place, or field beyond your choices",
   because that is what the deputy checks. Sources are named in their charts, so the same-colour
   rule covers fit and stage, not sources (Amazon is orange in the donut).
4. **Feedback faces:** the chosen card follows its rating, the one documented exception to the
   shared selected style; Okay is blue because orange cannot reach 3:1.
5. **Self-identification** is collected only in this browser and labelled Planned; the deputy
   answers the employer's own options and declines when it cannot match. It is never marked
   missing, so nobody feels pushed to disclose.
6. **Profile's first actions** are the red and blue need markers, so Profile has no black primary
   action (the audit allows it).
7. **The Dashboard has no primary action:** its tiles are the links (finding 9), and Take the tour
   is a secondary action.
8. **Prompts:** the locked rules (decision 0010) always come first; your instructions are added
   after them and cannot turn them off.
9. **A saved Pause motion** is treated like reduced motion everywhere, including the entry story
   and the opening loader.
10. **The first run previews the sample world.** Right after setup the Dashboard shows Alex's sample
    data with a plain note that it is a preview of how the Dashboard fills up, because every other
    page shows the same world; a truly empty new account is an open question.
11. **Colours belong to their chart.** Only five tones exist, so green means Strong fit in the fit
    key, Interviewing (and Offer) in the stage key, runs left in an allowance meter, and Stripe in
    the source donut; every chart names its colours in its key and tooltips.

### Open questions for the owner

- **Keep watch's free allowance** (10 nightly runs a month) and per-source counting need a decision
  record against the cost guardrails (0005). Keep watch also runs your own key on a schedule, which
  0002 rule 5 and 0009 do not cover yet (a key is used only for runs you started).
- **Gmail access:** `gmail.readonly` is a restricted Google scope (it needs Google's security
  assessment), and it can read all mail; "never reads other mail" would be our code's promise, not
  the scope's. A per-person apply address (mail forwarded only from job sites) would avoid the
  restricted scope entirely. Which should launch use?
- **Self-identification** is sensitive data. Decision 0006 says nothing for the vault is collected
  before the vault exists; the prototype collects it locally only. Confirm it waits for the vault.
- **Setup spending a run:** finishing setup can now spend this week's free platform run or a bonus
  run, or turn on a nightly schedule, when you chose them. Is that right?
- **Prompt customization in production:** per-task caps (3 turns, output caps, timeouts) are the
  prototype's proposal.
- **The rate of top-ups and run packs** (no prices yet), and whether bonus runs can be used in a
  week whose free run is spent.
- **A brand-new account:** should setup lead to an empty Dashboard (a separate "new account"
  sample world) instead of previewing Alex's data? Both testers found the preview surprising.
- **Colours:** five tones carry several meanings across charts; do you want fewer charts on the
  Dashboard, patterns, or a sixth tone?
- Phones were checked in headless Chrome with touch emulation; iOS Safari and safe areas
  (`viewport-fit=cover`) are still not verified on a device.

### How to review round 3

Open the pages straight from the folder. Start at Help and choose Reset sample data (round 2's data
is dropped automatically), then:

1. **First time:** `brand/access-preview.html?mode=create&skipLoader` → Continue with Google →
   Alex Morgan → setup → the Dashboard, where the tour starts. Try a phone width too: the header and
   Menu stay at the top as you scroll.
2. **Dashboard:** hover a colour, click it, and compare the count on the page it opens. Watch the
   Amazon search finish (add `&runs=fast` to the address to make it quick) and every count move to
   29. Use Get more runs on Keep watch.
3. **Searches:** Expand all, change a schedule, Retry Acme, archive a source and restore it, and
   watch a run live.
4. **Résumés and Materials:** make the CV the default CV, preview a document, filter the drafts,
   switch a template, set two pages, and edit a draft past one page.
5. **Profile:** the red and blue markers, Voluntary self-identification, Keep watch, and Gmail.
6. **AI & credits:** Change model on the OpenAI key, then open a prompt and customize it.
7. **Applications and autofill:** Add a role with "Read the posting"; open the autofill preview for
   Search Infrastructure.
8. **Pause motion** in the deputy's Activity panel, then visit any page; **Help** signed in and
   from the entry header (`trust-preview.html?public`).
9. `brand/components-preview.html` shows every new component, and `brand/deputy-preview.html`
   every reaction, the guide pose, the idle gestures, and the paused state.

### Round 3 verification

Two independent testers ran the acceptance checks on phones, tablets, and desktops; every defect
they found was fixed and rechecked. Details, and the final test, audit, probe, and end-to-end
results, are in
[ui-consistency-audit.md](ui-consistency-audit.md#fifth-review-round-3-of-the-signed-in-redesign).

## Round 4: the owner's third review (October 4, 2026)

The owner reviewed round 3 and sent notes on the Dashboard, Help, Searches, Résumés, a purchase
page, and Job matches, and asked for a strict check that nothing broke, a duplicate-data check on
the Dashboard, and strict acceptance and accessibility testing. Our numbering below (D for the
Dashboard, S Searches, R Résumés, P purchase, J Job matches, G general). Eight agents built round 4
in two phases (the sample world, the shared components, the Shop, and Job matches first; then the
Dashboard, Searches, AI & credits, and Profile, Help, and setup), and three fresh-eyes testers
checked it on phones and tablets, on desktops, and for accessibility.

| # | The owner said | What changed | Where |
|---|---|---|---|
| D1 | The first row could be circular | Four ring tiles: Job matches and Applications as donuts with the found and active totals in the centre, then Your runs with the Deputy Assist and Keep watch rings side by side. Every allowance meter on every page is now the same ring (used hatched, left green, added blue), so the look is consistent | Dashboard, all pages with allowances |
| D2 | Search status more graphical, live only while something runs | A shared run tracker: the four stages as steps, the time counting up, Checked and New counting up, and Watch live. With nothing running it is one line about the last search and Run a search | Dashboard, Searches |
| D3 | Is Latest matches limited to 5? | Yes, the five newest, by design; its link to Job matches carries no repeated count | Dashboard |
| D4 | Subdivide token usage like New roles per search; let people set a limit on tokens | AI this month shows tokens by task as bars (searches, tailored résumés, cover letters, answers, readiness checks). A token limit on your own key: an amount, a day, a week, or a month, and what happens when it is reached (pause AI work, or use free platform runs); a refused run says why and when the limit resets, and a To-do item appears | Dashboard, AI & credits, Searches |
| D5 | Take the tour is good | Kept; every tour updated for the new layouts | All pages |
| D6 | Bring Matches by source up | It now sits right under To-do and Search status | Dashboard |
| D7 | A metric for the latest keywords in the roles you search | A Keywords card: the top keywords across found roles with how many roles ask for each, which are on your résumé, and the new ones this week, linking to readiness | Dashboard |
| D8 | A name for AI runs; show whether platform runs or your own key is in use, the limit, and where you are; one model for the whole platform; AI runs next to Keep watch with a way to buy more | The AI work is named **Deputy Assist** (counted in AI runs), beside **Keep watch** (nightly runs). The Deputy Assist tile names what runs the AI (your key and model, platform credits, or keyword filtering), shows your limit and where you are, and the free platform runs. One AI setting now runs every search, Keep watch check, and draft, with one model; the per-source and per-task choices are gone. More AI runs and More nightly runs sit under their rings, with the Shop | Dashboard, AI & credits, Searches, setup, Profile, Help |
| H1 | Help is amazing | Unchanged apart from answers for Deputy Assist, the one AI setting, the limit, the Shop, and Job matches pages, and the Shop's demo | Help |
| S1 | Count up ("running for the last 2 minutes") instead of down | Every live run counts up ("Queued for 8 s", "Running for 1 min 12 s", "Finished in 1 min 40 s"); no countdown anywhere | Searches, Dashboard |
| S2 | Keep watch circular | The ring meter | Searches |
| R1 | Read the text on a tailored résumé is broken | Reproduced: opening it squeezed the page to a sliver and spilled the text under the dialog's footer. The preview now has Pages and Text tabs; the text replaces the pages in the same region, and the dialog never changes size | Résumés, Materials |
| P1 | A purchase page for everything we sell, and donations | The Shop: your plan's rings, Deputy Assist and Keep watch run packs counted in runs, bonus runs from invites, what you added, and Support JobDeputy (donate once or monthly at launch). No price or amount anywhere; packs are added at once in the prototype; Count me in only records the interest | `shop-preview.html`, the account menu, the footer, every Get more runs dialog |
| J1 | Pagination in Job matches by screen size | 8 roles a page on phones, 10 on tablets, 12 on desktops; Previous, page numbers, Next; `?page=`; `?job=` opens the role's page; new roles from a live search join page 1 | Job matches |
| G2 | Check the Dashboard for duplicate information and add value | Three repeats found and removed: Free AI runs' "1 used" and AI in October's "Platform credits 1 run" were one fact; Search status repeated Keep watch's next check; AI in October's runs by key repeated the tiles. New value: Keywords, the limit, and the live tracker | Dashboard |

### Decisions made for round 4

These are judgment calls; each can change.

1. **The name.** Deputy Assist, beside Keep watch, with the unit always next to a count. Other
   candidates: Sparks (the AI icon is a spark) and Groundwork. The words live in
   `JobDeputyStore.TERMS` and a few headings, so a rename is small.
2. **One model for the whole platform:** yes. One AI setting (your OpenAI or Anthropic key with its
   one chosen model, platform credits on Ministral 3 14B, or keyword filtering) runs everything.
   Per-source and per-task choices made the product look complicated without helping; prompts stay
   customizable (round 3), and the model is named once above them.
3. **The limit is for your own key only.** Platform runs already have their free allowance. The
   seed is 250,000 tokens a month with Pause AI work (a proposal); limits reset on UTC boundaries,
   like the usage counters.
4. **Rings everywhere an allowance shows**, not only on the Dashboard and Searches, so one meter
   looks the same on every page. One rule for every ring: the centre shows the free runs left of
   this month's allowance ("8 of 10 left"), and bonus and added runs are parts of their own in the
   key with their counts. A ring of tokens against your limit shows the percent used, so any limit
   fits.
5. **The Shop is not in the sidebar:** the sidebar stays the job-search workflow. The Shop has no
   primary action (balances lead; packs and the donation interest are secondary), and donations are
   an interest only.
6. **Pages of 8, 10, and 12** follow the shell's breakpoints. Production's cursor pagination has no
   totals, so "Page 2 of 3" needs a count, or Previous and Next only.
7. **Tokens by task** looks the same on the Dashboard and AI & credits: blue bars, each its share
   of the month's tokens.
8. **The Dashboard's word budget** rises from 260 to 280 words of prose, because it gained
   Keywords, the limit, and the live tracker; chart keys, axes, and table cells are data (the round
   3 precedent for bar dates). It reads 276.
9. **The sample run's clock:** the live Amazon search was requested at 13:58, so a fresh browser
   reads "Queued for 2 min" before it runs.

### Open questions for the owner

- **The name:** keep Deputy Assist, or pick another?
- **The token limit** (default 250,000 a month, and the fallback to free platform runs) needs a
  decision record against the cost guardrails (0005) and the rule that a key runs only what you
  started (0002 rule 5), as Keep watch does (round 3).
- **Donations:** collecting money needs an entity, receipts, and tax decisions before launch; the
  prototype shows the interest only.
- **Pagination in production** needs a total count from the jobs API for numbered pages.
- **Colours:** the grey (Stretch, Shortlisted) and orange (Approval) donut segments are under 3:1
  against white; every count is also in the key as text. A darker grey and orange would change the
  palette.
- Still open from round 3: a truly empty first Dashboard for a brand-new account, Gmail's restricted
  scope versus an apply address, self-identification waiting for the vault, and real devices.

### How to review round 4

Open the pages straight from the folder. Start at Help and choose Reset sample data, then:

1. **Dashboard:** read the rings; hover a segment and click it; watch the Amazon search count up
   and finish (`home-preview.html?skipLoader&runs=fast`); read Keywords and AI this month; use More
   AI runs and More nightly runs.
2. **AI & credits:** switch What runs your deputy's AI between your key, Platform credits, and
   Keyword filtering, and watch the Dashboard's Deputy Assist tile follow. Change limit to 10,000 a
   month, then Run again on Searches; try Use free platform runs.
3. **Searches:** watch a run live; read Keep watch's ring; see that no card asks about AI.
4. **Résumés:** preview a tailored résumé and switch to Text.
5. **The Shop** from the account menu: add a pack, Count me in, Withdraw.
6. **Job matches:** page through All on a phone, a tablet, and a desktop width.

### Round 4 verification

The acceptance checks, the testers' findings, and the final test, audit, probe, and end-to-end
results are in
[ui-consistency-audit.md](ui-consistency-audit.md#sixth-review-round-4-of-the-signed-in-redesign).

## Round 5: the owner's fourth review (October 4 and 5, 2026)

The owner reviewed round 4 (their message is titled "Round 4") and asked for a signed User
Agreement before any account exists, LinkedIn sign-in and import, AI credits sold at AWS's price
plus a small margin instead of AI runs, supporter benefits, Dashboard colour and layout changes,
real times and pagination on Searches, versioned prompts with guardrails, site accounts and email
updates in Applications, a working Download, a growing Profile, and the signed copies in Help. On
October 5 they added one note: What's new belongs next to To-do, in To-do's row style, and the
Dashboard could be reorganized. Our numbering below (G general, D Dashboard, S Searches, A
Applications, R Résumés and Profile, C AI and credits, H Help). Ten agents built round 5 in two
phases (the sample world, the shared components, the prompt guard and drawer, and the agreement
first; then the pages), and three fresh-eyes testers checked it on phones and tablets, on
desktops, and for accessibility.

| # | The owner said | What changed | Where |
|---|---|---|---|
| G1 | Show the terms first; keep every signed copy forever; a new account and every new version signs again | A **User Agreement** comes before any account: Create account (email, Google, or LinkedIn) opens it, then setup. You read the key points and the full text, tick three consents, and type your full name to sign. The record (version, the text's SHA-256 fingerprint, name, email, date and time) is kept permanently, apart from the account: deleting the account deletes everything else. Version 2026.10 is pending for Alex: reminders on days 0, 3, 7, 10, and 13, then the deputy's work pauses on Oct 15 until signed (reading, export, delete, Help, and signing never pause). The text is a draft for counsel and says so | `agreement-preview.html`, entry routes, Help, To-do, every signed-in page (the pause banner) |
| G2 | Sign in with LinkedIn, and import from LinkedIn | Continue with LinkedIn on Sign in and Create account, identical on both routes, with JobDeputy's own small chooser ("LinkedIn shares your name, email, and photo"). Import from LinkedIn reads the person's data export (ZIP) or profile PDF and lists every field as new, different (with your current value), or the same, each with a checkbox; only the ticked ones are saved, tagged "from LinkedIn" | Sign in, Create account, Profile `#linkedin`, setup's résumé step |
| G3, G4 | No more AI runs: pick the model and buy credits at AWS's price plus a little margin; sell only credits, nightly runs, and bundles | **AI runs are retired everywhere.** One platform model for the account (Ministral 3 14B, gpt-oss-120b, or DeepSeek V3.2, the three decision 0010 tested), priced at the Amazon Bedrock on-demand rate for US East plus a **10% margin** (a placeholder), tax at checkout. Credits show as tokens on your model ("339,100 tokens on Ministral 3 14B"). The Shop sells credit packs ($5, $10, $20), nightly runs (30, 60, 120), and three bundles that take 25% off the nightly runs only. Every price is computed from the store and labelled "Sample prices · nothing is charged"; checkout adds the purchase to the sample world | Shop, the buy dialog, AI & credits, Dashboard, Searches, Profile, Help, Invite |
| G5 | Keep donations; add benefits for donors | Support stays interest only (no amount). Planned benefits: the supporters list on the website (opt in; full name, first name and initial, or anonymous), a quarterly Q&A, early access, and a vote on what we build. "Not tax deductible" is said | Shop `#support` |
| D1 | The colours of the data, mainly Keep watch's left colour | A data palette for every chart: Keep watch's left is **indigo**, Deputy Assist's **teal**, used a quiet hatched grey, bonus gold, bought wine; every part is at least 3:1 on its card and stays apart for colour-blind readers and in forced colours. Button and link colours are unchanged | Every chart and ring |
| D2 | Remove Search status into Job matches; bring Keywords there | The Search status card is gone: the Job matches tile shows a compact live tracker (stage, time counting up, new so far, Watch live), then one line for the last search | Dashboard |
| D3 | AI in October in Keywords' place | AI in October shows tokens by task and by model, each in the same colour as on AI & credits. With the October 5 order it runs across the full width at the end (see D6) | Dashboard |
| D4 | Place Latest matches and New roles per search better | Side by side, the chart growing to the table's height | Dashboard |
| D5 | Offers, launches, JobDeputy updates? | **What's new**: dated launches, an offer, and updates from the store, each linking to its page, with Mark read; never a To-do repeat | Dashboard |
| D6 (Oct 5) | What's new next to To-do, like To-do; reorganize if needed | The order now reads top to bottom as: what is happening (the tiles), what needs you (**To-do beside What's new**, in the same rows), what was found (Latest matches with New roles per search), why it matched (Matches by source with Keywords), and what the AI used (AI in October, full width) | Dashboard |
| S1 | Show AI credits as well as nightly runs | The side column shows Deputy Assist (your key's limit ring with platform credits as one line, or the credits ring) above Keep watch | Searches |
| S2 | The time never moves ("0 seconds"); is the bar just an animation? Disable Archive and Delete while live | Reproduced and fixed: the sample clock stopped at 23:59:59 in a browser whose session began more than 10 hours earlier. Times now come from real time. The bar was driven by time, so it is gone: each stage shows its own real counter (pages read of planned, roles read, roles scored, new found). Archive and Delete are off while a source runs, with "Available when this search finishes" beside them, and Stop this search is offered | Searches, Dashboard |
| S3 | No pagination or filters for many sources | Find a source (name or address), filters (running, needs you, nightly, not run yet; career site or job board), three orders, chips with Clear, 8, 10, or 12 a page by width, all in the address. The world has 16 active sources | Searches |
| S4 | System prompt and your versions, back to the default, guardrails on every prompt, no injection; metrics later | The Prompt drawer shows the read-only **system prompt** (version 2026.10.1), **your instructions** checked as you type, **versions** (restore any, back to the system default), and **How it performs** (labelled sample metrics). A blocked prompt cannot be saved, and nothing saves when the checker is missing. Eight prompts, including Read application emails and Draft a reply | Every page that opens a prompt |
| A1 | Save new details to the profile; show the crawl, the match, then the fill | Autofill's **form scan** finds each field on a schematic of the form, matches it (Profile, résumé, answers, or missing), then fills it. Missing details are asked inline with Save to my profile on by default | Autofill, Profile |
| A2 | Create the account, read the code (with permission), crawl, fill; generated or chosen password, shown any time; email permission first | The **account step**: Gmail permission first, the agreement if needed, Generate a strong password (default, 20 characters) or Choose my own (checked), create the account, read the one-time code from Gmail (shown once, never kept), then the scan. Passwords are viewable any time in Profile `#site-accounts` (masked until Show, Copy without showing, every reveal logged). Your deputy stops at a CAPTCHA | Autofill, Profile |
| A3 | Say we read email to update statuses and draft replies; put it in the terms | **Updates from your email**: the deputy moves a card when an employer's email says so (after 2026.10 is signed), with Undo, and drafts replies you edit and send yourself; it never sends. Covered in the agreement | Applications `#email` |
| R1 | Why is Download disabled? | Round 4 could not make a file in the browser, so Download was an honest placeholder. Round 5 adds a PDF and Markdown generator: Download works in every preview and on every document and draft | Résumés, Materials, Help, the agreement |
| R2 | The profile should grow as we find fields | **Found while applying**: fields found on forms or in a LinkedIn import join their sections, tagged with where they came from, and count in the need summary | Profile `#found` |
| C1 | Only credits; usage graphs by model (also on the Dashboard) | AI & credits: the setting with the model choice, the credits ring, How prices are made (AWS's rate + 10% = ours, Region, tax, source and date), the token limit, and usage by day (30 days, by model), by month, and by task, with Show the numbers | AI & credits, Dashboard |
| H1 | The signed copy in Help; changes go to the To-do, then operations pause | Help's **Your agreements**: signed copies (view, download), the pending version with what changed, the reminders, the pause date, what pauses and what never does, and Sign now; a demo of the overdue state | Help `#agreements` |

### Decisions made for round 5

These are judgment calls; each can change.

1. **The margin is 10%,** a placeholder for the owner. Credits are prepaid value shown as tokens
   on your model; bundles discount the nightly runs only, so credits always cost AWS's rate plus
   the margin. Your own key is never charged.
2. **Free credits:** 250,000 tokens' worth a month at Ministral 3 14B's rate, refreshing on the
   1st (UTC); a friend's first search earns both people 100,000 tokens' worth, for at most 5
   friends a year.
3. **The agreement pause comes 14 days after a new version**, after five reminders, and only
   pauses the deputy's work. Capabilities that are new in a version ask for the signature where
   they are first used (buying, site accounts, email moves, the LinkedIn import).
4. **What the guard can promise:** no filter can promise that nobody will ever inject
   instructions; the guard blocks the known patterns, explains each block, and will still miss
   some new phrasing. What keeps an injection from doing harm is decision 0010's design: the
   locked rules always win, page text and emails reach the model only as marked data, the deputy
   has no tools that send, apply, pay, or sign in, and every output must fit a strict format.
5. **The Dashboard's order (D6)** puts AI in October last, across the full width, below the place
   the owner chose in D3; swapping it with Matches by source and Keywords is one change.
6. **Word budgets** follow the content the owner asked for: Dashboard 360 prose words (What's new
   shows each item's text), AI & credits 450 prose and 520 in all, the Shop 315, Applications
   500 in all; Searches' source cards and Applications' email list count as list data, like table
   cells.
7. **Each rate appears once:** AI & credits shows AWS's rate and ours on the model cards where
   you choose; How prices are made explains the sum instead of repeating a table.
8. **"4 min 0 s"** stays the one duration format for counting timers and finished runs.

Decided after the acceptance run (October 5):

1. **Protected traits in prompts:** the guard also blocks marking a role down for a benefit,
   policy, or statement tied to a protected trait (maternity or parental leave, fertility support,
   religious or disability accommodation, veteran hiring, diversity and equal opportunity
   statements), because penalising it works as a filter on the trait. Preferring such a benefit is
   allowed, and so is a company's location ("Rank roles lower if the company is based in India or
   China"): where an employer is based is a job seeker's preference, not a person's nationality.
   A person's nationality or origin stays blocked ("candidates from China" now is too).
2. **One rule for the ring on your own key's limit:** the centre shows the percent used, the key
    gives both figures ("49,810 used", "200,190 tokens left"), and one line names the limit and
    the reset ("Of your 250,000-token limit · resets Sun, Nov 1") on every page. The hour
    (00:00 UTC) shows only for a day's limit.
3. **Keep watch after buying runs** keeps the round 4 rule (the centre shows the free runs left of
    the month, bought runs are their own part of the key). "Running low" and the To-do item mean
    the runs you have do not last the month: after 30 bought they still end Oct 21, so both stay;
    the Month bundle covers the month and clears both.
4. **Two equal prices on AI & credits** ($0.0024 for one search, and October's platform cost) are
    different figures that round alike, because October's platform use is about one search. They
    stay.
5. **"New" in Job matches** is every role still waiting on you; the New pill marks a role a search
    just found in this browser. A search's "new roles" link now names the run and lands on that
    run's roles only, and the New view says in one line how many are marked and how many were found
    earlier.
6. **Create account by email** now works like Google and LinkedIn: one success line ("Next, your
    agreement") during the same 987ms hand-off as sign-in, then the agreement, with no extra click.
7. **A password's Show button** reads Show or Hide and is not a pressed toggle (a name that changes
    must not also report a pressed state).
8. **The invite pose's ticket** shows the AI credits sparkle instead of "+2" (the retired AI runs).
    "+100K" cannot be read at the compact dock or the phone scene; a plus beside the sparkle is the
    other choice and is one change.
9. **Balanced cards:** the Dashboard's Applications key is one column beside its ring and shares
    the tile's height when four tiles share a row; the Résumés library stacks its count above a
    one-line upload area at desktop widths. Matches by source gives each of the seven sources its
    own colour (Acme indigo, Contoso wine).

### Open questions for the owner

- **The margin, refunds, credit expiry, and tax** need the owner's numbers and counsel's text; the
  agreement marks them as placeholders.
- **The agreement text** is a careful draft and must be reviewed by counsel before launch.
- **Gmail's restricted scope:** reading one-time codes and status emails needs Google's
  verification for `gmail.readonly`, or an apply-address alternative (still open from round 3).
- **Site passwords in production** need the vault design (KMS keys per cell) and a decision
  record; the prototype keeps them in the browser.
- **LinkedIn** shares only name, email, and photo with apps, so the import reads the data export
  the person downloads; a partner API would need LinkedIn's approval.
- **Prompt metrics** are sample data until runs are recorded per prompt version; a server-side
  classifier and red-team evals in CI would be the stronger layer at launch.
- **The invite ticket** (decision 16) and **the Applications key's spacing** (decision 17) are
  visual calls the owner may prefer differently.
- **A location preference in prompts** passes the guard by decision 9; the owner may prefer a
  warning there instead.
- **A run already under way when the agreement pause starts** finishes, and the pause stops new
  work; while it finishes, Searches shows it counting up beside a dock that says the deputy is
  paused. Stopping it at once is the other choice.

### How to review round 5

Open <http://127.0.0.1:8767/brand/> (or the files straight from the folder). Start at Help and
choose Reset sample data, then:

1. **Create account** with LinkedIn: read and sign the agreement, then setup (try Import from
   LinkedIn on the résumé step and Platform credits with the model choice).
2. **Dashboard:** the new order; What's new beside To-do (open one, mark one read); watch the
   Amazon search in the Job matches tile (`home-preview.html?skipLoader&runs=fast`); Buy credits.
3. **Help, Your agreements:** read the pending version, then Demos, See the overdue state, and
   visit Searches and Materials; then Sign now.
4. **Shop:** buy $5 of credits and the Month bundle; read How the price is made; Support, Count me
   in, and the supporters list.
5. **AI & credits:** switch the model to DeepSeek V3.2 and watch the token counts change on every
   page; read Usage by day, month, and task.
6. **Searches:** search "work", filter Not run yet, sort by Name, page 2; Run again and watch the
   time count up; open a prompt and try "Ignore previous instructions".
7. **Applications:** Updates from your email (after signing): Undo a move, Draft a reply.
8. **Autofill:** Approve the materials first, then fill: the account step, the code, the scan.
9. **Profile:** Found while applying, Import from LinkedIn (untick two), Site accounts (Show,
   Copy, the vault log), Delete account (do not confirm).
10. **Résumés:** Download a résumé as PDF and Markdown.

### Round 5 verification

The acceptance checks, the testers' findings, and the final test, audit, probe, and end-to-end
results are in
[ui-consistency-audit.md](ui-consistency-audit.md#seventh-review-round-5-of-the-signed-in-redesign).

## Round 6: the owner's fifth review (October 5, 2026)

The owner opened with "Much closer to our vision" and asked to keep everything they did not
mention working exactly as it does. They asked for a happy panda that holds its tool the same way
everywhere, the home Region before every sign-in method, a way out of setup that lands on the
To-do, the deputy giving every tour, a rule for lists that grow (and a large account to show it),
What's new linking to a guide or a page, a reordered Dashboard, prompts with versions you can act
on, tests, and rollback, a stronger Applications (review, one-step approval, background applying,
Gmail's watch in view), a better Résumés filter and gap list, template instructions, a calmer
optional colour, a reorganized Profile, Settings tabs, and a concise Invite friends. Their last
line: "Once it is working it should never be broken." Before work started they answered two
questions: the bamboo stands **beside him, not held**, and the applying default is **Review, then
auto-apply**. Our numbering below (G general, D Dashboard, S Searches, A Applications, R Résumés,
P Profile, T tabs, I Invite). Twelve agents built round 6 in two phases (the happy deputy, the
sample world, and the platform UI first; then nine page owners), and three fresh-eyes testers check
it on desktops, on phones and tablets, and for accessibility ([Acceptance](#acceptance-round-6)).

| # | The owner said | What changed | Where |
|---|---|---|---|
| G1 | Make the panda look happy everywhere we have him | Every panda **smiles**: an open smile with a small tongue, lifted lower lids and cheeks, and a second catchlight (smile A of three; B and C stay on the cast sheet for you). The calm states (`error`, `protect-password`) keep a gentle closed smile, never a frown | The deputy companion, the entry stage, setup, the cast sheet, the compact mark, the opening loader |
| G2, G5 | The tool shows in the hand on some pages and not others; consistent actions; the free hand without food; smiling | **One hand rule:** the right paw always holds the tool of the moment (every state, moment, reaction, story chapter, and size; `JobDeputyDeputy.tools` keeps it as data), the left paw is free, and the bamboo leans on the ledge or the ground beside him, never held, in the logo and the loader too. The rail medallion and the phone chip show the tool as a small badge | `deputy.js`, the entry routes, `jobdeputy-mark.svg`, `jobdeputy-animated.svg` |
| G3 | Make the home Region right for Google and LinkedIn, or for every sign-in | **Region first:** on Sign in and Create account the home Region sits above Google, LinkedIn, and email and applies to each; the choosers say it ("Signing in to your account in the United States (US)", with Change). On Sign in, a returning Google, LinkedIn, or one-tap account whose home Region differs gets a calm notice ("Your account is in the United States (US)", Switch to US and continue) before anything happens. The Region travels with you (`&region=`) to the agreement, whose signed record keeps it, and to setup. Forgot password keeps its Region | `login-preview.html`, `access-preview.html`, `agreement-preview.html`, setup |
| G4 | Offer to skip setup, and put what is left on the To-do | **Skip setup for now** on Welcome and **Skip the rest** on every question after it, beside "I’ll add what’s left to your To-do." Your answers are kept, the source you chose starts, and each step you left becomes its own To-do item that opens the right place (where to help, roles, workplace, how often, résumé, first source, AI setting) | Setup, the Dashboard's To-do |
| G6 | The panda should explain the tour, consistently | **The deputy gives every tour.** The card holds a small smiling panda whose right paw aims a pointer at the highlighted part (left, right, up, or down); the title is his speech line (first person, at most six words) and the body is first person. While the tour runs the dock's panda steps out (the ledge, the leaning bamboo, "Showing you around"); Done brings him back with one `celebrate`. On phones the card is the bottom sheet with the panda at its start | Every page with a tour |
| G7, G9 | Matches by source with 100+ companies (Other?); more than six keywords; "show me the case" | **One growing-list rule (R6-4):** charts show the top 5 (keyword bars 6) plus one hatched Other, capped lists have See all N (a searchable, sortable drawer), and filters over dynamic values are the searchable multi-select with at most 3 chips plus "+N more". The **Large account demo** (`?demo=large`, or Help, Demos, See a large account) shows the case: 124 sources across 118 companies, 1,008 found roles, 52 keywords, 30 watched sources, 7 models, 46 applications, and 95 drafts across 58 companies | Every page; Help |
| G8 | What's new could link to a guide or to a page | Each item says where it goes: **Read the guide** (an article in Help at `trust-preview.html?guide=<id>#guides`: what changed, why it matters, the steps, and Try it) or **Open** the page ("Open Prompts", "Open Purchases"). Help gains Guides | Dashboard, Help |
| D1 | Last search selects the whole card and a filter (only on Searches) | Reproduced on `searches-preview.html?source=amazon`. A link into a source now lands on its run inside the folded card: one glow that fades in about 2.6 seconds, focus on the run's heading, no outline, and no filter change. The same for every link into a source | Searches |
| D2 | New roles per search: several sources in colours, with the bar labels | **Stacked bars by source** in Matches by source's colours (top 5 plus Other), a key, each bar's total on top, every part named in its tip and in Show the numbers, and each part linking to its run. Keep watch's nightly check is now one run of both watched sources (Google 2 and Microsoft 1 on Fri, Oct 2, labelled "Keep watch" under the date), so the stacking shows on the usual sample | Dashboard, Searches |
| D3 | Matches by source and Keywords a row up; Latest matches and New roles per search a row down | Tiles; To-do and What's new; **Matches by source and Keywords**; **Latest matches and New roles per search**; AI in October and Prompts | Dashboard |
| D4 | Represent AI in October better, with models and combinations | Tokens **by day** for October to date, **stacked by model** (top 5 plus Other) with a model key and the month's total; tokens by task split by model; and the **combinations** the account really uses, in words ("Your OpenAI key runs Deputy Assist: 1 search, 2 tailored résumés, and 2 cover letters"; "Platform credits ran 1 search on Oct 1"). A day your key's limit was reached is marked as a fallback (the large demo has one, with 7 models) | Dashboard, AI & credits |
| D5 | The tour misses the interview | A step for the Interview line on the Applications tile | Dashboard |
| D6 | Prompt stats on the Dashboard too | A **Prompts** card: each prompt's version in use, its agreement with you, a test running or its result, and rollbacks this month, linking to Settings, Prompts | Dashboard |
| S1 | A version dropdown to act on; what is keep rate; show the test, tell people they will be notified, roll back on failure; configurable auto rollback; all the stats here and on the Dashboard | **Settings, Prompts** is the home, and one shared **prompt control** shows the same model there, on Searches, and in the Prompt drawer: a **Version** dropdown (every version and the system default, each with its status: In use, Testing, Trying on 20% of runs, Rolled back, Draft, Retired) and the actions for the chosen one (Use this version, Test it, Compare with the one in use, Edit as a new version, Roll back). "Keep rate" is gone: **Agreement with you** (of what the prompt produced in real use, the share you kept) and **Test score** (the version replayed on your last 40 decisions, with the guardrail checks). A test shows as it happens ("Replaying decision 23 of 40", the checks ticking, "You can leave. I'll tell you when it's done."), then a notice on whichever page you are on and a line in the deputy's Activity. A pass is tried on 20% of runs for 3 days; a fail keeps the version before in use and says why. **Rollback rules** for the account with per-prompt overrides (the share and days of a trial, a minimum agreement of 80%, a maximum drop of 5 points, auto rollback, auto promote). Stats per version, a 14-day trend with the minimum as a line, and the rollback history | `prompts-preview.html`, Searches, the Prompt drawer, Dashboard |
| A1 | A changeable default for auto approvals; auto apply with criteria after approval | The system default is **Review, then auto-apply**: your deputy drafts and reviews the materials itself (a score with named checks), you approve each in one step, and it applies in the background within your criteria (5 a day, quiet hours, only when no new answers are needed, the agreement signed). **Auto approve** rules come set up and off (Strong fit, a review score of 90 or more, no new answers, not an avoided company). Every rule changes, and **Reset to the system default** is one action. How your deputy applies moved from Profile to Applications (`#how-you-apply`) | Applications |
| A2 | Auto review and approval need research and minimal transitions | Researched first (job tools, approval inboxes, review queues, and background jobs). **Ready for you** leads Applications: each role with its fit, the review score, the checks that need a look, the materials as page thumbnails, and **Approve and apply** (one click, no page change), Preview, and Edit; Approve all that passed asks once with the list. The same actions sit at the top of the role panel and of Materials, never only at the bottom | Applications, Materials |
| A3 | Apply in the background; the preview on request; give information and see it fill; the agreement first | After approval your deputy applies **in the background**: the card shows the step (Step n of 5) and the time counting up, with Watch it and Stop, and the deputy's Activity says it too. **Watch it** opens the autofill preview live at the job's stage. When your deputy needs an answer the card shows **Needs you** with the questions inline; your answers fill in and the job carries on. The agreement comes first where it applies | Applications, autofill |
| A4 | Gmail's monitoring isn't shown | **Gmail: watching for employer emails** at the top of the board (connected, last checked counting up, emails read this week, cards moved, and Connect Gmail when it isn't); a card moved by an email says "Moved by an email, Oct 2", with Undo | Applications |
| A5 | A strong review of Applications | A critique of every part, then the fixes: Approve and apply is the primary action and Add a role is secondary, board lanes show five cards with See all N, the queue three, a Company multi-select, Up next leaves approvals to Ready for you, and every round 5 behaviour that still made sense stays | Applications |
| A6, R4, P1 | Take the tour sits on different sides | **Measured:** right on three pages, left on five, in a header card on Profile, none on Invite and autofill. **One rule (R6-3):** Take the tour sits in the shared page intro at the right end of the title row, top aligned with the h1, from 721px, and on its own row under the lede, at the start, at 720px and below. `tour-placement.test.ts` and a rendered probe (15 pages at 7 sizes) hold it. Invite friends and the autofill preview gained tours | Every internal page |
| R1 | The company filter adds a label per company; 100+ companies; invest only in what is valuable | The company filter is the shared **searchable multi-select** ("Company: Any", a search box, each company with its draft count, the selected first, Clear, and at most 3 chips plus "+N more"). The Kind chips went (drafts come in pairs, and search matches the kind). The same filter serves Job matches' sources, Keep watch's sources, and Applications' companies | Résumés, Job matches, Searches, Profile, Applications |
| R2 | Say what is missing, for what, and how to fix it, or let the AI ask | **What's missing, and for which roles:** each gap names the roles that ask for it ("Asked by 9 roles, including Workspace at Google"), See which roles, **Add it yourself**, or **Let your deputy ask you** (three short questions, then a drafted line for your approval: Use this line, Edit, Not now; sample) | Résumés `#readiness` |
| R3 | Instructions for custom templates | **How custom templates work:** four steps (start from a copy, the placeholders, the page size, upload), what your deputy does with a template, what it checks and its limits, what it never changes, and a worked example you can preview or download | Résumés `#template-guide` |
| P2 | The Optional colour doesn't suit us | The optional marker is the **green wash with a hollow green-ink ring**, shared by every optional marker; required keeps its filled danger-ink "!" | Profile and every need marker |
| P3 | Keep watch's list can grow a lot; show what is selected, not everything | The shared multi-select: the watched sources as at most 3 chips plus "+N more", every other source in the popover | Profile, Searches |
| P4 | Organize Profile better | Profile is **what your deputy uses to apply**: an overview (how complete it is, 12 of 14 required and 6 of 16 optional details on the usual sample, and Details to add with each reason in visible text), then About you, Career, Job preferences, Application answers, and Found while applying, last. Its old anchors forward, and a short Moved list closes the page. About 11,000px tall at 1440 instead of 14,600 | Profile |
| T1 | Separate Prompts, connections, and purchase tabs; pull out anything not relevant | **Settings** replaces AI & credits in the navigation and holds five tabs, each its own page under one tab strip: **Account** (`account-preview.html`, new: sign-in, home Region, agreements, Access and Deputy Assist, your data and Delete account), **Connections** (`connections-preview.html`, new: Gmail, LinkedIn, site accounts, your AI keys), **Prompts** (`prompts-preview.html`, new), **AI & credits** (without its prompts), and **Purchases** (the Shop, renamed). Every old link still works: Profile's moved anchors and AI & credits' `#prompts` forward to the new homes | Every internal page |
| I1 | Invite friends: a better, concise experience | One screen: the reward in one line, **Share your link** (Copy link, invite by email), **Your progress** (the meter, the tally, the five newest invites, and See all), and **How it works and the rules** in one closed disclosure (`#how` and `#rules` open it). 108 words instead of 174, and 1,155px tall at 1440 instead of 1,897; the same facts | Invite friends |
| G10, G11 | Commit, then start the new version; act as the orchestrator, validate end to end, break nothing | Round 5 is tag `round-5`; round 6 is on `design/round-6` (checkpoint commit `9b6f9a4`). The round 5 journey still passes 25 of 25, and a round 6 journey passes 53 of 53 | All pages |

### Decisions made for round 6

These are judgment calls; each can change.

1. **The smile** is option A (an open smile with a small tongue); B (a wide closed smile) and C (a
   soft smile with a happy squint) stay on the cast sheet for the owner. The rail and the chip show
   the right paw's tool as a small badge (`26px` and `19px`) so the hand rule reads at every size.
2. **Settings** is a section of the navigation whose link opens Account; its tab strip is links
   (each tab is its own page), not ARIA tabs. The account menu lists Profile, Settings, AI &
   credits, Purchases, Invite friends, and Help & support; the footer names Settings and its two
   most used tabs. Invite friends still has no nav item.
3. **Account and Connections have no primary action:** each is a list of settings whose changes are
   their own secondary actions, like Profile and Purchases; the audit allows it.
4. **The tour pointer** follows where the target sits against the card: in the card's column, up
   or down; in its row, left or right; off to a corner, the side with the wider gap. The pose aimed
   left reads weakest, so a target off to the left that is not level with the card is pointed at
   up or down.
5. **Optional is green, calmly:** the green wash with a hollow green-ink ring reads as "fine to skip"
   and keeps the shape apart from required (a filled "!"); ink on the wash measures 15.9:1 and the
   ring 4.9:1.
6. **Other is a hatched quiet grey,** so it reads as a group and never as Workday's plain grey. The
   five sources with the most found roles get colours by their catalog position, so the usual
   sample keeps round 5's colours (Google blue, Microsoft charcoal, Stripe green, Workday grey,
   Amazon orange).
7. **One nightly run:** Keep watch's 02:00 check is one run of both watched sources. Round 5's
   second run folded into it (an old `?run=r10` link opens it), and three found roles moved to it,
   so two colours stack while the found total stays 27. Two figures move on purpose: runs 23 to 22,
   and What's new unread 4 to 6 (two new items).
8. **One AI setting still holds on the usual sample** (round 4): Keep watch stays on your key, so
   October's combinations are your key and one platform search; the Large account demo shows a
   fallback day.
9. **Alex's quiet hours** (21:00 to 08:00, carried over from Profile) differ from the system default
   (22:00 to 07:00), so Reset to the system default visibly changes something.
10. **The approval queue** holds one role on the usual sample (Search Infrastructure, review 94,
    passed). Cloud Reliability's review warns at 81 (a line says you led 8 engineers; your profile
    says 6). Approve and apply asks for no confirmation (the owner's one step); Approve all that
    passed confirms with the list. On the usual sample the job waits at its first stage for
    agreement 2026.10, because creating an account on the employer's site needs it; signing lets it
    go on by itself.
11. **D1's "filter"** was the open card's green role chips and schedule cards: a link now lands in the
    folded card and never changes a filter; a source your filters hide says so, with Show it.
12. **The Dashboard's Prompts card** is a light list from the store's summary, not the full control;
    AI in October and Prompts share a row only where there is 1,080px of room.
13. **Prompts:** the two measures are defined once on the page; each prompt is one row (the
    dropdown, both figures, the next step, and Details). The drawer opens on the control, and its
    Save keeps a new draft and starts its test at once, so no version runs untested. A version's
    `status` keeps round 5's meaning (the guard's result); the lifecycle is a new field. The sample
    history sits on Read job listings (version 1 rolled back, version 2 on trial, version 3 a draft
    whose test fails at 75%), so round 5's drawer tests on Score fit keep their numbering.
14. **Buttons and pills never wrap their own words;** the prompt control's action row wraps between
    buttons and uses short names in a column under 360px.
15. **Résumés:** a gap names its roles without the count, because the count is the keyword bar's
    figure (each figure once). Drafts show 12 a page, keyword bars the top 12 with See all, and your
    own templates the newest 3. Markdown holds no fonts, so an uploaded template prints in the
    Classic look.
16. **Profile's order** keeps round 5's four core sections and moves Found while applying last,
    because its waiting items already show as Add buttons in the overview and their sections.
17. **The wrong-Region notice** covers Google, LinkedIn, and one tap; email sign-in never says whether
    an account exists, so it signs in as before. With the Region first, Create account's providers
    sit below the fold at 320×568.
18. **Setup's Done** also adds the optional steps you skipped one by one; a re-run closes the To-do
    items it answers.
19. **Help:** public Help lists only the guides marked public (two of four); five new answers (41
    signed in, 24 public); Demos gains the Account, Connections, Prompts, and Invite tours.
20. **Job matches:** a whole multi-source run is one chip ("Search at 02:02 · 2 sources"), a part of
    it shows that source's roles only, and the source filter's counts follow the current view.
21. **The large demo's drafts** are 95 across 58 companies, not the brief's 70: 46 applications
    reach at most 46 companies, so 23 tailored résumés started from Job matches make the company
    list long.
22. **After the orchestrator's review:** the buy dialog says Purchases (T1), and the Prompts page was
    compacted from 6,142px to 2,768px at 1440 (9,934 to 5,178 at 390).

### Round 6, part 2: the owner's mid-round notes (October 5, 2026)

On the evening of October 5, while round 6 was in acceptance, the owner sent six more notes (our
numbering N1 to N6). A read-only placement critic (J1) then mapped every figure and fact to the
pages that show it and wrote 26 findings (P-1 to P-26); the orchestrator chose a home for each fact,
and the page owners built the notes, the placement decisions, and the testers' fixes together.
Part 2 changes some of part 1 above: the Dashboard's Prompts card became **Prompt tests**,
"Agreement with you" is now **Kept by you**, nightly runs are **Runs**, Keep watch left Profile,
and the User Agreement's home is Settings, Account.

| # | The owner said | What changed | Where |
|---|---|---|---|
| N1 | Show how each prompt version's evaluation score is trending, not the agreement, and bring it to the top | **Prompt tests**, directly under the tiles: for each tested prompt, the Test score of every version in order (a point per version joined by a line, the minimum as a dashed line, passed a filled circle and did not pass a hollow diamond, the version in use ringed and a trial's ring dashed, each mark named in the key and in words), the version in use and any trial; tests this month, the pass rate, and rollbacks this month; one line for the prompts still on the system default and never tested ("7 on the system default, never tested: ..."). No Kept by you on the Dashboard. Open Prompts | Dashboard |
| N2 | Show the numbers looks broken everywhere | **Reproduced:** inside a chart card the table fell into the list tables' narrow stacked layout, about 2,000px tall. Every chart's table is now a compact table at any card width, with styled links, the figures at the end, and the row names held in view when a wide table scrolls inside its card; the stacked bars show one row per bar with its parts in one cell. New roles per search's table grows its card by 370px at 1440 | Every chart (Dashboard, AI & credits, Prompts, Searches) |
| N3 | A limit on every run, called runs: free ones, then buy more | **One Runs allowance:** every search run uses one run, whether you start it or Keep watch does at night (one for each source it checks): 10 free a month, refreshing on the 1st, plus runs you buy or get in a bundle. "Nightly runs" is now Runs everywhere; Keep watch stays the name of the nightly schedule. With none left, Run again and new runs are off with the reason and Get more runs ("No runs are left this month. Get more runs, or wait for Sun, Nov 1."), and Keep watch skips its check and says so. The usual sample now counts October honestly: 4 used (Oct 1's search, both sources of the nightly check, and the live Amazon search), 6 left, lasting through Mon, Oct 5 | Purchases (the home), Dashboard, Searches, setup, Help |
| N4 | The Prompts screen has too much; hide some, keep the stats | Prompts **leads with the stats**: tests this month, the pass rate, versions on trial, rollbacks; each tested prompt's Test score trend, larger, with the version in use, its Kept by you, the one next step, and Details for the rest; one line listing the untested prompts (each opens its prompt); and **More about your prompts** folding what the measures mean, the rollback rules, and how testing works. 1,887px tall at 1440 (2,768 in part 1) and 2,936 at 390 | Settings, Prompts |
| N5 | Gmail sync details on the Dashboard, a gist | **Gmail sync** beside Prompt tests: the last sync's time counting up, what happened in it in one or two lines ("Read 1 job email. 1 needs your reply."), the next sync, and See the emails (Applications `#email`); Connect Gmail when it isn't connected. A sync runs every hour at :30 | Dashboard |
| N6 | Judge the data placement: correct, concise, not duplicated | J1's 26 findings and the decisions below | Every page |

#### Placement decisions

The orchestrator decided J1's findings; each fact now has one **home** with its full detail and
controls, and other pages show a snapshot or a link.

- **Keep watch (P-1)** lives only on Searches `#keep-watch` (the watched sources, the schedule,
  Searches a day, and the runs it uses), because two editors for one list left people unsure which
  counted, and Profile holds only what applications use. Profile keeps one line linking there;
  `#watch` and `#pref-schedule` forward.
- **Runs (P-2, N3):** the home is Purchases, where the balance sits beside what you can buy; the
  Dashboard and Searches (where runs are spent) keep a ring. AI & credits drops it, because runs
  are not AI (`ai-preview.html#watch` forwards to Purchases), and so does Profile.
- **The AI limit and credits (P-3, P-9, P-11):** the home is AI & credits. The Dashboard's tile is
  now the Runs ring plus **one AI line** (what runs the AI, how much is left, Change), so AI in
  October's key shows every model's tokens (49,810 and 10,900, which add up to 60,710). Searches
  shows one AI line, with the ring only under 20% left or paused. Purchases drops the token-limit
  ring, because nothing about your own key can be bought, and shows the credits balance as one line
  above its packs (its Runs ring stays, as the allowance's home). Account's Access is one row; `#ai-access` forwards to AI & credits.
- **Searches leads with the sources (P-4):** Add a source folds behind a button in the Your
  sources header (open when there are no sources, with `?add=1`, or at `#add-source`); the side
  column is Keep watch, Prompts, then the AI line.
- **The flow ribbon (P-5):** the current step shows its name only, because the page shows the
  count right below; Job matches' In Applications view says how its count relates ("These came from
  here; the other 3 you added in Applications.").
- **The User Agreement (P-6):** the home is Settings, Account `#agreements` (the pending version,
  what changed, the reminders, what pauses and never pauses, Sign now, and every signed copy).
  Help keeps a short card that says where it is; Connections shows one notice for 2026.10.
- **Prompts (P-7, P-8, P-14):** one state per row (the dropdown names the version, one chip carries
  its state), one line for every untested prompt, and one place for the rollback rules. Searches'
  Prompts card is compact rows: the version with its state, Kept by you, the one next step, the
  small Test score trend, and Manage prompts. The measure **Agreement with you** is renamed **Kept
  by you** ("Of what this prompt produced in real use, the share you kept."), because "agreement"
  also meant the User Agreement on the same screens.
- **Prices (P-10):** one How prices are made, in Purchases beside the packs (`#prices`; AI &
  credits' `#prices` forwards); Purchases' model chooser is a link to AI & credits `#model`.
- **Gmail (P-12):** Connections owns the connection and its scopes (no week counts), Applications
  owns what it did (its scope disclosure became a link to Connections), and the Dashboard shows the
  last sync's gist. One counting-up time style, and each count names its window ("this week" in
  Applications, the last sync on the Dashboard).
- **Approvals (P-13):** Materials approves only in its top bar (Approve and apply, with Approve only
  beside it); Autofill drops its two chips at the approval gate and keeps the notice.
- **The Dashboard band (P-15):** Prompt tests and Gmail sync stay under about 300px at 1440 on the
  usual sample: the trend only for tested prompts, one line for the rest, two lines for the sync.
- **P-16 to P-26:** done: one Sample data note for the page on Account, Connections, and Profile,
  and one under AI & credits' rings (P-16); completeness said once on Profile (P-17); the sign-in
  email once on Account (P-18); the Dashboard's AI in October keeps the task bars and only the
  fallback combination (P-19); Connections' AI keys as one line linking to AI & credits (P-22); the
  referral as one line on Purchases, with no invite button on AI & credits (P-24); the notice
  period in the stored answer's words on Profile and Autofill (P-26). Left: P-20 (Résumés' What's
  missing beside the grey keyword bars, and the upload box leading the page), P-21 (the page
  setting is edited in Résumés and in Materials: an owner question), P-23 (the footer and the
  account menu name Settings with two of its tabs, and "Free access" shows in the header chip and
  the menu), and P-25 (accepted: the Approval lane card and Ready for you are two views of one
  role).

#### Decisions made in part 2

These are judgment calls; each can change.

1. **Runs, counted honestly:** every run is kept in a ledger, so deleting a source never gives one
   back and a stopped run still used its run. The run packs keep their ids, so old checkout links
   work, and the store keeps the old nightly names as aliases for pages and tests.
2. **Test scores are exact:** a score is the decisions agreed with out of 40 (version 1 88%, 35 of
   40; version 2 90%, 36 of 40; version 3 75%, 5 points below the 80% minimum), after UAT-A found
   36 of 40 shown as 91%.
3. **A replaced version is Retired,** never a Draft: a version that ran keeps its runs, Kept by
   you, and test when another takes its place (UAT-M M-9).
4. **The score trend says each result in a shape and words,** never colour alone. A test still
   running has no score; the Prompts page shows it in the prompt's state line instead of as a
   point.
5. **Gmail sync counts where each email stands now,** so after signing 2026.10 the same syncs read
   "Moved 1 card to Interviewing." instead of "1 move waits for the updated agreement."
6. **Roll back asks first** wherever it is offered ("Roll back to System default? Version 2's trial
   ends."), with Cancel focused; Escape cancels without closing the drawer.
7. **Every Kept by you figure names its window** ("84% of 19 runs so far"), and the drawer's trend
   names its 14 days.
8. **On phones a background notice goes to the deputy's chip** ("Needs you" with the attention dot)
   and nothing floats over the page; wider screens keep the toast, which never covers a control.
9. **The bamboo is smaller:** 72% of its old size with its foot at x 48, so the waving left paw
   never reads as holding it (UAT-D D-13); celebrate's cheer rises above it.
10. **Create account with an identity that already has an account** (Alex, by Google or LinkedIn)
    says "Already signed up", "You already have a JobDeputy account with this Google account, in
    the United States (US). Nothing has happened yet.", with Sign in instead, whatever Region is
    chosen; Use another account still creates one (UAT-A A-8, UAT-D D-1).
11. **The ribbon change is CSS only,** so the shared markup and the tests that compare it stay the
    same.
12. **The first run after Skip the rest** says "Your deputy is ready. Finish setup from your To-do
    when you like." instead of "set up and ready" (UAT-M M-8).
13. **Job matches' source filter** is "Sources with roles": it lists the sources with roles in the
    view, and a source you picked that has none stays listed with 0 (UAT-D D-15); the Dashboard says
    "sources with matches".
14. **The large demo's companies** have plausible fictional names, each used once (UAT-M M-15).

### Round 6, part 3: end-to-end testing, prompt tests, and Gmail sync (October 6, 2026)

On October 6 the owner wrote: "do end to end testing, lot of things are buggy and make the prompt
and gmail sync thing better (with some data) pls check everything thoroughly pls". Parts 1 and 2
were committed first (`ea637ae`), so every finding has a fixed starting point. Part 3 changes some
of part 2 above: Prompt tests and Prompts count the **last 30 days** instead of "this month", a
test that fails is **Did not pass** and never a rollback, the Runs ring counts **free plus bought**
runs, and New roles per search is now **Roles found per search**.

#### How it was run

- **Six testers on a frozen copy.** T1 to T6 tested a copy of `ea637ae`, never the repository,
  from cleared browsers, and wrote every defect with repro steps: entry, setup, and the Dashboard
  (T1); Searches and Job matches (T2); Applications, Materials, Autofill, and Résumés (T3); Profile,
  the Settings tabs, Invite friends, and Help (T4), each on desktops at 1920×1080, 1440×900, and
  1280×720, usual sample and large demo; every page on tablets and phones with touch at 1024×768,
  820×1180, 768×1024, 390×844, 375×667, and 320×568 (T5); and data, state, time, and accessibility
  at 1440×900 and 390×844 (T6).
- **A builder, PG,** rebuilt prompt tests and Gmail sync at the same time (the store's prompt and
  mail seeds, the Dashboard's band, Settings, Prompts, and the shared score trend).
- **Five fixers by file ownership,** no two agents in one file: FX-SJ (Searches, Job matches),
  FX-AM (Applications, Materials, Autofill, Résumés), FX-PS (Profile, Account, Connections, AI &
  credits, Purchases, Invite friends, Help), FX-PLAT (the shared components, panels, chrome, and
  the deputy), and FX-EN (Sign in, Create account, setup, the User Agreement). The orchestrator
  reproduced each defect, routed it to its file's owner, decided the shared rules below, and
  relayed every request for a file an agent did not own.
- **Retests** on a second frozen copy: each tester reran its repros, swept its scope again, and
  clicked with real mouse input, several times, inside parts that update while you look (a live
  search, a background apply, a running test, a counting clock). **A fresh-eyes tester, T7,** new
  to the round, took every view of prompt tests and Gmail sync on the same copy.
- **A second fix pass** for the retests' and T7's findings (rules R9-8 to R9-12), then **a final
  retest** of every new finding on a third frozen copy.

#### Prompt tests and Gmail sync, with data

**A sample history worth reading.** Five of the eight prompts were tested in the last 30 days: ten
tests, 8 passed and 2 did not pass (80%), 2 rollbacks, 1 version on trial. Read job listings keeps
round 6's history (its version 3 is still the draft the journeys test, which does not pass at 75%,
5 points below the 80% minimum).

| Prompt | Its tests (Test score) | Now |
|---|---|---|
| Read job listings | Version 1 88%, passed Thu, Sep 24, rolled back in its trial Sun, Sep 27; version 2 90%, passed Thu, Oct 1 | Version 2 on trial on 20% of runs until Sun, Oct 4; the system default in use |
| Score fit and give reasons | Version 1 78%, did not pass Tue, Sep 8 (2 points below the minimum); version 2 85%, passed Mon, Sep 14; version 3 93%, passed Tue, Sep 29 | Version 3 in use since Fri, Oct 2 |
| Tailor the résumé | Version 1 90%, passed Thu, Sep 10; version 2 83%, did not pass Wed, Sep 30 (7 points below version 1's 90%, more than the 5 allowed) | Version 1 in use |
| Write the cover letter | Version 1 83%, passed Sat, Sep 5; version 2 88%, passed Mon, Sep 28, rolled back in its trial Thu, Oct 1 | Version 1 in use |
| Draft application answers | Version 1 88%, passed Mon, Sep 21 | Version 1 in use since Thu, Sep 24 |
| Check résumé readiness, Read application emails, Draft a reply | Never tested | The system default |

**The window is the last 30 days** (Sep 3 to Oct 2; the sample's today is Fri, Oct 2, so "this
month" held two days, and "0 rollbacks this month" sat beside a September rollback). Tests, passes,
failures, the pass rate, and rollbacks are counted over it and said "Last 30 days" or "in the last
30 days" everywhere (`promptTests().window`; the metrics `prompts.tests.last30`,
`prompts.tests.passedLast30`, `prompts.tests.failedLast30`, `prompts.tests.passRateLast30`, and
`prompts.rollbacksLast30`). Every test is kept: a version tested again keeps its earlier test
(`promptTests()` gives each prompt `tests`, the latest of each version, and `history`, every test).

**A week of job email.** Gmail connected Mon, Sep 28 (Connections and Help say so). Ten job emails
since, each about a role on the board and none before its application (round 5's four, with their
ids and words, and six more), read by the hourly syncs at :30: Mon 1, Tue 1, Wed 2, Thu 1, Fri 5.
The last sync (Fri, Oct 2, 13:30) read three: Jamie Chen and Riley Park at Northwind Labs, who need
your reply, and Amazon Recruiting's interview invitation. Moving cards by email still waits for
agreement 2026.10 (2 moves wait; signing applies both, with Undo). The large demo has 23.

**The Dashboard band** (directly under the tiles, as in part 2):

- **Prompt tests:** the title, "Last 30 days", and Open Prompts; one line, "10 tests · 8 passed,
  2 failed (80% passed) · 2 rollbacks · 1 on trial"; a row per tested prompt in the store's order
  (the same order as Prompts and Searches): its name, linking to the version its line names on
  Prompts (`prompts-preview.html?version=tailor-v2#tailor` chooses version 2 in that row and opens
  Details), the latest outcome in words ("Version 2 failed its test Wed, Sep 30; version 1 stays"),
  and a small Test score trend; "3 on the system default, never tested: Check résumé readiness,
  Read application emails, and Draft a reply."; and one key and one Show the numbers for the card
  (a row a test: prompt, version, date, score, result). Still no Kept by you on the Dashboard (N1).
- **Gmail sync:** "Last sync 13:30 · 30 minutes ago · next 14:30" (counting up), what that sync
  found ("Read 3 job emails: 2 need your reply, 1 interview invitation."), the newest three job
  emails (who, the kind, its outcome; each opens its card), **Job emails by day** (a bar a day with
  its count, stacked by outcome: Moved, Move waits, Needs reply, Card updated, No change; a key and
  Show the numbers), the week in one line ("This week: 10 emails · 2 moves wait · 2 replies needed
  · 1 card updated · 0 moved"), and See the emails. After a sync that read nothing the card keeps
  the newest emails, named "Latest job emails" with when each was read, "and 7 more this week", and
  "No new job emails in that sync." (R9-10). Not connected: one short block with Connect Gmail.
- **Size:** 386px tall at 1440×900 on the usual sample and 390 on the large demo (PG's measure),
  each card ending at its own height (R9-11).

**Settings, Prompts** leads with the same stats (Tests, Pass rate with how many passed and failed,
On trial, and Rollbacks, each "Last 30 days"; "1 testing now" joins Tests while a test runs). Each
tested prompt is one compact row: its name and state line, its trend, and the row control (the
version menu with its chip, Kept by you, the one next step, and Details); the card has one key and
one Show the numbers; the untested prompts are one list.

**The score trend's sizes** (`scoreTrend`, its width following the number of versions):

- `row` (new, the Dashboard's rows, which show each prompt's latest six versions): about 48px tall
  on an 18px plot, 34px a version (76px at least), only the latest score labelled (every score is
  in its tip and the card's table).
- `medium` (new, the Prompts page's rows): a 56px plot, about 100px in all, 104px a version and
  240px at least, capped by its column (240 to 320px on Prompts), every score labelled where it
  fits.
- `compact` (Searches and the drawer) and `large` keep their part 2 shapes.
- `scoreTrend.key` and `scoreTrend.numbers` draw the one key and the one table for a card of row or
  medium trends. A score under the minimum draws at least 5px under the dashed line at every size,
  and a failed point's tip gives its own reason.

#### The shared rules (R9-1 to R9-12)

The orchestrator decided these while routing the defects; every fixer followed them.

- **R9-1 Runs ring:** the ring counts every run you can still use this month, free plus bought
  ("125 of 190 left"; the usual sample still "6 of 10 left"), its key gives Left and Used as
  numbers, and once anything was bought one quiet line gives the split ("10 free + 30 bought").
- **R9-2 Deep links to something missing:** a `?run=`, `?job=`, `?source=`, `?prompt=`, or
  `?stage=` that names nothing shows one calm notice in the page's own style over its default view.
- **R9-3 Live updates never replace controls:** a part that updates while you look changes its
  text and attributes in place; where a redraw cannot be avoided, focus returns by a stable key.
- **R9-4 Empty values** read a word ("None yet", "Not yet"), never a dash.
- **R9-5 Kept by you's window** is said one way: "84% of 19 runs", with "(version 2)" only where
  more than one version is on screen, and never "so far".
- **R9-6 Home Region everywhere:** the Region in the account's latest signed agreement record, else
  the United States, from `JobDeputyStore.homeRegion()`.
- **R9-7 Signing is once per version:** signing a version you already signed shows its record and
  never stores a second copy.
- **R9-8 A failed test is never a rollback:** a version that fails its test reads **Did not pass**
  and the version before stays; only a version on trial or in use is rolled back, so the Rollbacks
  figure and every rollback history agree.
- **R9-9 One fail rule, one reason:** a version fails if its Test score is below the minimum or
  more than 5 points (your setting) below the Test score of the version in use, never compared on
  Kept by you, and its reason names the rule with the chart's own figures.
- **R9-10 Gmail never empties:** the card always shows the latest job emails with when they were
  read, and the last sync's line says what it found.
- **R9-11 Cards in a band never stretch** to match a neighbour: Show the numbers grows only its own
  card, and its table spans that card.
- **R9-12 A waiting move is told on its card:** "An email invited you to interview, Thu, Oct 8,
  13:00. It moves to Interviewing once you sign.", and the card's follow-up gives way to it.

#### Defects by area

| Area (tester) | Found (first pass + retest) | Fixed | Decided | Withdrawn |
|---|---|---|---|---|
| Entry, setup, and the Dashboard on desktops (T1) | 26 (20 + 6) | 26 | 0 | 0 |
| Searches and Job matches (T2) | 17 (15 + 2) | 14 | 2 | 1 |
| Applications, Materials, Autofill, and Résumés (T3) | 12 (7 + 5) | 10 | 1 | 1 |
| Profile, the Settings tabs, Invite friends, and Help (T4) | 13 (8 + 5) | 13 | 0 | 0 |
| Every page on tablets and phones (T5) | 18 (17 + 1) | 12 | 5 | 1 |
| Data, state, time, and accessibility (T6) | 17 (12 + 5) | 17 | 0 | 0 |
| Prompt tests and Gmail sync, fresh eyes (T7) | 21 | 21 | 0 | 0 |
| **All** | **124** | **113** | **8** | **3** |

- **Fixed** includes three fixed in part: Latest matches' title now sits 9px from level with its
  neighbour's (T1-16, accepted by its tester); a new password equal to your email is refused while
  any current password still passes (T4-3, the rest decided); and a drawer's sticky parts never
  cover a focused field while a page's own fields are left to the phone (T5-5, the rest decided).
  Some defects were seen by more than one tester: the Runs ring by T1, T5, and T6, and a failed
  test shown as rolled back by T2, T4, T6, and T7.
- **Decided, not a defect:** the landing glow is a Web Animation with a reduced-motion path (T2-14,
  T5-12), visually hidden text is 1px by design (T2-15), Approve all that passed confirms even one
  role (T3-7), the See all drawer's header already stays put (T5-7), the role panel's sheet keeps a
  Close at its top (T5-8), Keep connected is Disconnect's cancel (T5-10), and the filters live in
  the Filters sheet below the wide layout, whose button says how many are on ("Filters · 1",
  T5-13).
- **Withdrawn** by their testers after rechecking: two filter chips that were one (T2-12), focus
  after a move that was right (T3-4), and Help's large-demo switch, read through an API that does
  not exist (T5-9).
- **The final retest** (the third frozen copy) found every one of the 24 retest findings and T7's
  21 fixed (T7's repro 11 of 11, twice), and nothing broken in any scope; T1-12, T1-15, and T1-20
  are fixed too, and T1-16 stays 9px off, accepted. It found five more polish items: T3-F1 (the List
  row's Follow-up date beside a waiting move, fixed: "After you sign"), T7-F1 (a row under Latest
  job emails starting its second line with "·", fixed), T7-F2 (Gmail's table wrapping its day
  column, fixed), T1-F1 (the tip of a version rolled back in its trial said only that it passed its
  test, fixed: it adds "Then rolled back in its trial, Sun, Sep 27."), and T2-F1 (with no runs
  left, Keep watch's card said so on two lines above a ring at 0 of 10, fixed: the daily line reads
  "Searches a day: up to 20 (the default), none until you have runs again").

#### The bugs that mattered most

- **Live Searches cards swallowed every click on Watch live** (T2-8): while a search ran, the whole
  Your sources section was drawn again on every tick, so 0 of 40 real clicks on Watch live or a
  card's name landed. Each card now changes in place, and a press holds the next redraw until it is
  released: 40 of 40 at 1440 and 390.
- **The Runs ring counted only free runs** (T1-3, T5-3, T5-11, T6-1): the large demo read "0 of 10
  left" with 125 runs left, and buying 30 runs left the usual sample at "6 of 10 left". Under R9-1
  the Dashboard, Searches, and Purchases read "125 of 190 left" on the large demo and "36 of 40
  left" after buying 30, with the split line, and the Get more runs dialog leads with the same
  figure ("125 of 190 runs left this month: 10 free, 180 bought.", T1-R3).
- **The AI setting leaked between the samples** (T6-3): both worlds shared one saved setting, so
  choosing Platform credits in the large demo changed the usual sample's Deputy Assist line. Each
  world now keeps its own (`jobdeputy-ai-source` and `jobdeputy-ai-source.large2`).
- **The Region was lost after Create account** (T1-1): with the United Kingdom or India chosen,
  setup, the deputy's shield, the footer, and Settings, Account all said the United States; only
  the signed record kept the choice. Every one now reads `homeRegion()` (setup reads the address's
  `region=` before the signature), and so does Profile's postal code check.
- **Signing twice** (T1-2): Back after signing at Create account showed the unsigned form again, and
  Sign and continue kept a second permanent copy of 2026.10. The store now refuses a duplicate
  (`already-signed`) and the page shows the signed record on Back or reload (R9-7).
- **The daily limit was not enforced while sending** (T3-R2): with a limit of 2 and four roles
  approved on the large demo, all four applied ("4 applied today"), because the limit was checked
  only as a job started. It now holds at the moment of sending too: two apply, and two wait with
  "Your daily limit of 2 is reached: it goes on tomorrow".
- **The checkbox reverted with a console error** (T5-2): unticking "Save to my profile" in the role
  panel was undone at the next store tick, which also threw an `InvalidStateError` (a caret restored
  on a checkbox). The panel now keeps your answers and the tick across redraws, redraws only when
  the job changes, restores a caret only where there is one, and Answer and continue saves nothing
  you unticked.
- **Also major:** a job held by quiet hours said "Waiting for you" and invented two questions (T6-2,
  now "Waiting for your quiet hours", On hold, "Nothing to do: your deputy goes on by itself."); Job
  matches ignored `?sort=` and old or unknown links (T2-1 to T2-5); "Applications" wrapped in the
  tablet rail (T5-1); focus fell to the page after a purchase (T5-4); Gmail sync emptied half an
  hour after a sync (T7-2); Show the numbers stretched the neighbouring card (T7-1, T1-R1); a failed
  test was shown as rolled back (T7-3, T4-R2); a fail reason compared a Test score with Kept by
  you (T7-4) and a tip called 80% below an 80% minimum (T7-5); the Tests stat's two lines overlapped
  during a test (T7-6); the Amazon card said to follow up beside an interview invitation (T7-7); and
  Gmail's week read 5 on the Dashboard and 10 on Applications after reconnecting (T4-R3).

#### Decisions made in part 3

These are judgment calls; each can change.

1. **"New" means one thing on the Dashboard** (T1-12): roles you have not acted on, as the Job
   matches tile says ("20 new"). The chart of what each search found is **Roles found per search**,
   with its tips, unit, tour words, and See all.
2. **Band cards end at their own heights** (R9-11), so the Dashboard's two-card rows have uneven
   bottoms rather than stretched rows.
3. **The Runs ring has two parts,** used and left (runs you bought are among the ones left), and
   its total is the store's `runs.all` (`runs.total` already counted the runs in the history).
4. **A hold is not attention:** quiet hours and the daily limit read "On hold" with the store's
   reason, no orange ring, no toast, and no nav count; a wait that needs you keeps them.
5. **Applications' email list shows the newest five** with See all 10 emails and Show fewer, the
   rows expanding in place (the page's own pattern, as Ready for you's), because the shared See all
   panel has no row actions for Draft a reply, Ignore, and Undo.
6. **After signing with a `return=`,** the signed record leads with its way back as the primary
   button ("Back to Applications"), and nothing redirects by itself (T5-14).
7. **The deputy's fill line** is "I fill what you approved.", true in both applying modes (T3-R5).
8. **Help counts "Prompts with your version in use"** (4), so Read job listings, with your version 2
   on trial and the system default in use, is not among them (T6-R5).

#### How to review part 3

Open <http://127.0.0.1:8767/brand/> (or the files straight from the folder), go to Help and choose
Reset sample data, then:

1. **The Dashboard band:** Prompt tests' line and five rows against the 80% minimum, the untested
   line, and Show the numbers (only its own card grows); choose Tailor the résumé: Prompts opens on
   version 2, "Didn’t pass Wed, Sep 30: 83%, 7 points below version 1’s Test score (90%), more than
   the 5 you allow." Gmail sync: the last sync, its three emails, Job emails by day, and the week's
   line; each email opens its card.
2. **Prompts:** the four stats; on Read job listings choose Version 3, then Test it: "1 testing
   now" under Tests, then Did not pass at 75%, with Tests 11 and Rollbacks still 2.
3. **Applications `#email`:** five emails and See all 10 emails; the Amazon card tells its waiting
   interview with Review and sign, and no "Follow up with Amazon" in Up next or the To-do.
4. **Runs:** `home-preview.html?demo=large` reads "125 of 190 left" with "10 free + 180 bought",
   and Get more runs says the same; then `?demo=usual`.
5. **Live clicks:** `searches-preview.html?runs=fast`, Run again on a source, and while it runs
   click Watch live and the card's name several times.
6. **Links to something missing or old:** `jobs-preview.html?sort=newest&view=all`,
   `jobs-preview.html?run=r10` (one chip, "Search at 02:02 · 2 sources"),
   `jobs-preview.html?job=unknown-role`, `searches-preview.html?run=r9` and `?run=r999`,
   `applications-preview.html?stage=bogus`, `prompts-preview.html?prompt=score-fit` and
   `?prompt=nope`, `documents-preview.html?company=Amazon,Google%20Cloud`, and
   `shop-preview.html#balances` (it becomes `#nightly`).
7. **The Region:** Create account, choose United Kingdom, Continue with Google, Use another account,
   sign, and Continue to setup: setup, the deputy's shield, the footer, and Settings, Account say
   United Kingdom, and the record and Account give the signing time in London with Pacific beside
   it; Back on the agreement shows the signed record, and Account lists one copy.
8. **Applying** (Reset sample data again first): on
   `applications-preview.html?demo=large#how-you-apply` set Daily limit to 2, Approve all that
   passed (4), and answer each card: two apply and two wait for tomorrow. On the usual sample
   (`?demo=usual`), sign 2026.10 in Settings, Account, set quiet hours from 13:00 to 15:00, and
   Approve and apply: the job reads "Waiting for your quiet hours". At 390, in the role panel of a
   job that needs you, untick "Save to my profile" and wait a minute: it stays unticked.

### Open questions for the owner

- **The agreement 2026.10 text** still says that how your deputy applies is your setting in Profile,
  with Review each one as the starting setting, and names Profile for disconnecting Gmail, seeing
  site passwords, export, deleting the account, and ending the agreement. Since part 2 it is also
  wrong about runs: it sells "nightly runs" that "pay for Keep watch", while every search now uses
  one run. The text is fingerprinted and signed as written, so correcting it means a new version
  that everyone signs again.
- **Keep watch on its own AI source:** D4's example ran Keep watch on platform credits while your key
  runs Deputy Assist, which round 4's one AI setting does not allow. Keep one setting, or let Keep
  watch have its own?
- **Alex's quiet hours** differ from the system default (decision 9). Keep it, or seed the sample on
  the default?
- **The Moved line** at the end of Profile (one line of links since part 2): keep it, or remove it
  once people know the new homes?
- **The page setting is edited in two places** (P-21): Résumés' Templates and the Materials editor
  both change it. One place, or a per-draft setting in Materials?
- **Run packs** still say "15 more nights" (30 runs), counting only Keep watch's two sources,
  though every search now uses a run.
- **Word budgets:** the Dashboard's prose budget rose from 360 to 420 words (600 in all) for what
  this round added; Applications now runs over round 5's 500 words in all, with the queue, Gmail's
  strip, and How your deputy applies moved in. Raise both, or cut?
- **The Prompts page length:** 1,887px at 1440 and 2,936 at 390 after part 2 (6,142 and 9,934
  before round 6's cuts); more is possible.
- **Tours on the entry routes:** Sign in, Create account, and Forgot password have none, and setup's
  tour runs on Welcome only.
- **The Résumés gap rows** name the roles without the count (decision 15). Is that clear enough?
- **Templates and fonts:** custom templates are Markdown, which holds no fonts, so "never changes
  your fonts" holds by printing in the Classic look. Should uploads accept Word files or fonts
  later?
- **Profile's deputy** still guards the Region shield, though Account now owns the Region.
- **Smaller visual calls:** the tool badge covers part of the face on the chip; the left pointing
  pose reads weaker than the others; Ready for you's rows are about 600px tall on phones; on the
  large demo the stacked bars' key wraps to four lines, and the Prompt tests and Gmail sync band
  runs over 300px because two prompts have trends there.
- **The Test scores over each point** of the Prompt tests trend carry no `data-metric`, so the
  duplicate-figure probe cannot check them yet (the store's keys exist; the chart's label and the
  key's text differ by the "%"). Part 3: on the Dashboard they carry their keys now
  (`prompts.test.<version>.score`); the Prompts page's trends still do not.
- **Figures and order in Help:** one FAQ answer types "40 decisions" rather than reading it from the
  store, and Guides come after the answers.
- **The downloaded signed agreement** (part 3): its Markdown and PDF still give the signing time in
  Pacific only ("14:00 Pacific"), while the record on the agreement page and Settings, Account give
  it in the account's home Region with Pacific beside it ("22:00 London (14:00 Pacific)"). The
  copy is built by the shared agreement text, so the change reaches every downloaded copy.
- **Applications' email list** (part 3) uses the page's own See all (the rows expand in place), not
  the shared See all panel, because the shared panel has no row actions (Draft a reply, Ignore,
  Undo, Review and sign). Keep it, or give the shared panel rows with actions?
- **The See all drawer was not rebuilt** into a fixed header, a scrolling body, and a footer (part
  3, T5-7): its header already stays put, opaque, with Close in reach, and a rebuild would change
  every drawer (the prompt, buy, feedback, See all, and document preview drawers) late in the round.
- **Fields under a phone's keyboard** (part 3, T5-5): the page fields (Account's Current password,
  Searches' Add a source, Help's feedback) are left to the phone's browser, which scrolls a focused
  field above its keyboard; only the drawers keep a focused field clear of their own sticky parts.
  Confirm on real devices.
- **Approve all that passed** still asks once even when only one role passed (part 3, T3-7). Keep
  the safety step, or approve a single role at once?
- **Change password** accepts any current password, because the prototype keeps no password to
  compare; the real product checks it on the server (part 3, T4-3).
- **Uneven card bottoms** (part 3, R9-11): the Dashboard's two-card rows end at their own heights
  instead of matching. Keep it?
- **Smaller calls left in part 3:** Latest matches' title sits 9px from level with Roles found per
  search's, because of its Live pill (T1-16); Create account still scrolls about 106px at 1280×720
  and 1366×768, for its own content (T1-14); the band is 390px tall at 1440 on the large demo
  (about 380 was the aim).
- **Still open:** prompt metrics are sample data until runs are recorded per version; Gmail's
  restricted scope versus an apply address; site passwords waiting for the vault; real devices.

### How to review round 6

Open <http://127.0.0.1:8767/brand/> (or the files straight from the folder). Start at Help and
choose Reset sample data, then:

1. **Region first:** `login-preview.html?skipLoader`, choose India above the sign-in methods, then
   Continue with Google and Alex Morgan: the notice says your account is in the United States (US)
   and nothing has happened yet; Switch to US and continue. Create account's choosers say
   "Creating your account in" the Region you chose, and choosing Alex there says "Already signed
   up", with Sign in instead.
2. **Skip the rest:** Create account by email (or Continue with Google and Use another account),
   sign the agreement, answer one question, then Skip the rest: the Dashboard's first run says
   "Finish setup from your To-do when you like", with one To-do item for each step you left.
3. **Dashboard:** the tiles, with **Your runs** (6 of 10 left, Get more runs) and one Deputy Assist
   line; **Prompt tests** and **Gmail sync** right under them (Read job listings' Test scores, 88
   then 90 on trial, against the 80% minimum; one line for the 7 untested prompts; the last sync's
   gist and the next sync); What's new's Read the guide and Open Prompts; New roles per search's Oct
   2 bar (Google and Microsoft, "Keep watch"), then click a part: Searches lands on that run with one
   fading glow; Show the numbers on any chart (a compact table); AI in October by day and model,
   with both models' tokens in its key; Take the tour (the panda in the card, the dock stepped out).
4. **Prompts:** Settings, Prompts opens on the stats. On Read job listings choose Version 3, then
   Test it; watch the replay count and the checks, then open another page: the notice says it
   didn't pass (75%, 5 points below your 80% minimum) and the system default stays in use. Open
   Score fit and give reasons from the untested list, write "Prefer remote roles and name the
   biggest gap first." in Your instructions, and save: it is tested at once and goes on trial on
   20% of runs. More about your prompts holds the definitions, the rollback rules, and how testing
   works; Roll back asks first.
5. **Approve and apply:** Applications, Ready for you, Search Infrastructure, Approve and apply. The
   card waits for agreement 2026.10; Review and sign, and the job runs on (Step n of 5, the time
   counting up). Watch it opens the autofill preview live; answer the two questions on the card;
   it ends Applied (sample: nothing was sent). Materials approves only in its top bar. Then How
   your deputy applies, Reset to default.
6. **Applications:** Gmail's strip at the top of the board (the last sync counting up, this week's
   emails and moves) and a card "Moved by an email" (after signing); the Company filter.
7. **Runs everywhere:** Purchases opens on Runs (6 of 10 left; 2 started by you, 2 by Keep watch)
   beside the run packs; Searches' Keep watch shows the same ring; no page says "nightly runs".
   With `searches-preview.html?runs=fast`, Run again until none are left: Run again turns off with
   the reason and Get more runs.
8. **Where things live now:** Searches leads with its sources (Add a source is a button in the
   header) and keeps Keep watch, Searches a day, Prompts, and one AI line in its side column;
   Account holds Your agreements (Help's card links there) with Access as one row; Connections
   shows one 2026.10 notice and the AI keys as one line; Job matches' In Applications view says
   where the other roles came from. Old links forward: `profile-preview.html#watch` (Searches),
   `ai-preview.html#watch` and `#prices` (Purchases), `account-preview.html#ai-access` (AI &
   credits), as well as round 6's `profile-preview.html#gmail` and `ai-preview.html#prompts`.
9. **Résumés:** "Top 12 of 43 keywords", the Company filter, What's missing with Let your deputy
   ask you, and How custom templates work. **Profile:** the overview, and one line pointing to Keep
   watch on Searches.
10. **The Large account demo:** add `?demo=large` to any page (or Help, Demos, See a large account):
    the Dashboard's top 5 sources plus Other and See all, two prompts' trends in Prompt tests, Job
    matches' 1,008 roles, Résumés' company filter, Applications' capped lanes; then Back to the
    usual sample (or `?demo=usual`) returns exactly your figures.
11. **Invite friends**, and `brand/deputy-preview.html` (the smiles, the hand rule, the smaller
    bamboo, the guide's four directions, and the dock stepped out).

### Acceptance (round 6)

Three fresh-eyes testers, who had not built any page, walked round 6's rows and the earlier rounds'
from cleared browsers with real input events: desktops (UAT-D, 15 findings), phones and tablets
with touch (UAT-M, 19), and accessibility to WCAG 2.2 AA (UAT-A, 8). Each finding went to its owner
or to the orchestrator, and the orchestrator checked each fix by rendering and measuring. The full
table is in
[ui-consistency-audit.md](ui-consistency-audit.md#user-acceptance-round-6).

- **Fixed (the majors first):** a multi-select that lost focus on every live tick (A-1) or closed on
  a tap without choosing (M-1); Create account with Alex's existing Google identity in another
  Region quietly making a second account (A-8, D-1: now "Already signed up", Sign in instead); the
  board card's stretched link covering the live apply controls and Undo (M-2); Materials still
  saying "apply on the employer site" after Approve and apply (M-3, D-14). Then forced colours on a
  stacked part (A-2), Reset at 320 with text spacing (A-3), one announcement after approving
  (A-4), Test scores that did not equal agreed of 40 (A-5, D-9), focus back to "+N more" (A-6),
  Searches and Profile wording (A-7), the autofill fill count (D-2), a toast that outlived its
  answers (D-3), Searches' prompt names (D-4, M-6), Roll back with no confirmation (D-5), a double
  full stop (D-8), "Top 12 of 43 keywords" on Résumés (D-11), the dock's "I'll apply now" before
  the signature (D-12), the left paw over the bamboo (D-13), source counts on the large demo
  (D-15), a replaced trial reading Draft (M-9), the By task table's first column (M-10), Help's
  Demos (M-11), the squeezed approved notice (M-12), AI in October's key at 820 (M-13), a repeated
  axis date (M-14), filler company names (M-15), "1 day" (M-16), one run with two times (M-17), By
  task labels touching (M-18), and the chip's bubble over the heading on phones (M-19). The first
  run after Skip the rest now says setup waits on the To-do (M-8).
- **Replaced by part 2:** the Dashboard's Prompts card findings (D-6, D-7, M-4, M-5, M-7) went with
  N1: Prompt tests shows no Kept by you, and each result is in words and shapes on the card, not
  only in a tip.
- **Decided:** Searches' compact prompt rows keep the next step only, with every other action,
  Compare, and the stats in See the prompt (the rest of D-5); stacked-bar parts stay pointer-only
  links, with Show the numbers as the keyboard path (a UAT-D note).
- **Not a defect:** D-10 (tour titles such as "These are your matches."), because that was the
  orchestrator's own example of a first-person title.
- **The docs:** "right paw" means the paw on the viewer's right (the panda's own left), and the
  bamboo leans behind him on the viewer's left (a UAT-M note).

### Retest (round 6)

Two fresh testers retested every earlier defect and the part 2 notes: one on desktops with
accessibility (UAT-RD: 1440, 1280, 1024, keyboard, forced colours, text spacing) and one on phones
and tablets (UAT-RM: 390, 320, 820, 768, touch).

- **Earlier defects:** on desktops 20 of 23 fixed at once, with D-10 not a defect and D-5's Compare
  and Edit resolved by decision (they live in the drawer); on phones 16 of 19 fixed at once. The
  rest (D-2's Watch it schematic, M-14 at 390, M-17's two times for one run, M-19's chip notice)
  were then fixed and rechecked.
- **New findings: 24** (1 major, 13 minor, 10 cosmetic), every one fixed:
  - **The major one, tours (UAT-RD-1):** with normal motion a tour could stop scrolling to its steps,
    leaving the card and its Next or Done off screen. The cause was a smooth scroll that waited for
    animation frames a background or headless page never draws (the same code as round 5). The
    engine now jumps when the target is far or the page is hidden, checks a glide on a timer with a
    jump fallback, and moves focus without scrolling; every step of the Dashboard, Applications,
    Prompts, Searches, and Profile tours lands at 1440, 1280, 1024, and 390, in every motion and
    input mode (156 of 156 steps each).
  - **Charts:** the trend's minimum label clears the points near it; Show the numbers tables flip
    (models as rows) when there are few days, with a scroll cue only when truly wide; no underline
    on the chevron; the tallest bar keeps its label at 320.
  - **Runs:** the Dashboard says Keep watch skips its check when no runs are left, as Searches does;
    Help's runs answer is one line with a link to Purchases (no fourth ring).
  - **Notices:** on phones and tablets a needs-you notice stays on the deputy's chip or rail until
    you act (the Applications badge counts a job waiting for you); a notice that arrives under an
    open panel is said inside the panel.
  - **Words and figures:** the Dashboard explains a version rolled back in its trial (without the
    Kept by you figure); every tested prompt shows its result; rows say whose runs Kept by you
    counts; a test started on Searches shows its count and its reason; Materials' timeline follows
    the job; the applied line is said once; AWS's prices were checked Thu, Oct 1 (not a future
    date); the rail's labels fit under text spacing; Gmail, LinkedIn, and site account removals ask
    a clear question with a safe answer first.
- **Regression, after the last fix:** 2,455 of 2,455 tests; the round 6 journey 60 of 60 and the
  round 5 journey 25 of 25 with no console errors; the audit 2,762 of 2,762 on the sixteen
  signed-in routes and 2,204 of 2,204 on entry and setup; figures 0 mismatched and 0 repeated on 60 of 60
  page runs.

### Round 6 verification

The acceptance checks, the testers' findings, and the final test, audit, probe, and end-to-end
results are in
[ui-consistency-audit.md](ui-consistency-audit.md#eighth-review-round-6-of-the-signed-in-redesign).
Part 3's testers, their defect counts and outcomes, the audit's change, and its final checks are in
[ui-consistency-audit.md, part 3](ui-consistency-audit.md#part-3-end-to-end-testing-prompt-tests-and-gmail-sync).

## Round 7: the owner's sixth review (October 6 and 7, 2026)

The owner opened with "We are mostly moving close to what we want, I am happy to see it" and "I
can see now the application is running on the back end, more of what I expected, just the UX
presentation needs to be better." The main ask: **improve the UX; keep things concise and easy for
users without losing anything**, and "Address all of them, I want to finalize it in this round."
(The owner titled this review "Round 8"; it is the repository's round 7, still on
`design/round-6`.) Everything the owner did not mention keeps working as it did, Profile is
**locked** (no change but the shared chrome), and every earlier rule (R6-1 to R6-10, N1 to N6, R9-1
to R9-12) still holds unless a decision below changes it on purpose. Before work started the owner
answered one question: the sign-in brand line makes **no "world's first" claim**, because other AI
auto-apply tools exist and an unprovable superlative is an advertising risk. Our numbering below (G
general, D Dashboard, S Searches, J Job matches, A Applications, R Résumés, P Profile, SE Settings, L
large account).

### How it was run

- **Contracts first.** Two agents wrote their contracts before any page changed, each marked "shape
  fixed" once pages could build on it and "done" once implemented: **ST**, the sample store
  (`brand/sample-store.js`: the runs ledger and runway, the daily Gmail scan, 90 days of usage,
  every prompt by version and model, who did each application step, the Job matches queue,
  keywords by role, the daily email, the activity log, receipts, and signing in one step), and
  **PL**, the platform (the shared components, panels, chrome, deputy, and audit: boot without
  flicker, the prompt summary, return to where you were, pagination, the filter bar, the time range
  picker, the usage charts and table, the rings and runway line, and the switch).
- **Seven page agents by file ownership,** one owner per file: DB (the Dashboard and the new sample
  daily email), SJ (Searches, Job matches), AP (Applications, Autofill), RS (Résumés, Materials), SP
  (Prompts, AI & credits, the new Usage), SA (Purchases, Account, Connections, Help, the new
  Activity), and EN (Sign in, Create account, the agreement, setup, Invite friends). Each wrote a
  plan first. Requests for another owner's file went through the orchestrator, who also made the
  cross-page edits (the nav badge's seed on 17 pages, the render hold on the pages that lacked it,
  and Profile's `#usage` forward).
- **Seven fresh-eyes testers on a frozen copy** of the working tree, never the repository, with real
  mouse and touch input: desktop journeys (T1), phones and tablets with real touch emulation (T2),
  the large account and performance (T3), accessibility (T4), data consistency across pages (T5),
  the owner's UAT against every row of the brief (T6), and regression against round 6 (T7).
- **A fix pass by the same owners:** the orchestrator routed each finding to its file's owner and
  decided the shared questions (buying has one home, the prompt summary's one link, Take the tour on
  phones, the unsigned Sync, the morning tailoring rule, Materials' page setting, and the amended
  agreement text).
- **A retest by the same testers** on a second frozen copy: each finding's probe again, then a
  fresh pass for anything the fixes broke.

### What the owner asked, and what was built

| # | The owner said | What was built | Where |
|---|---|---|---|
| G1 | Brand the login: the way we work is agentic, so why apply by hand? "You configure it, we will do it", by our deputy panda | The story leads with the eyebrow "Agentic job applications", the brand line "You set it up. Your deputy applies.", and the lede "Agents already help you work. Now one finds roles, tailors your résumé, and applies for you, with your approval." Three steps (**1 Set it up › 2 It finds › 3 It applies**, with the pencil, the magnifier, and the approval card) replace the eleven-chapter carousel; it plays once (about 13 seconds) and holds on step 3 with Replay story; on phones the band shows the brand line (and the eyebrow from 360px wide); on tablets in one column (721px to 880px) a compact story keeps the form in the first view; no "world's first" claim | Sign in, Create account |
| G2 | The screen flickers with `skipLoader`; the Dashboard hangs on huge data | Measured first (layout shift up to 0.97 on phones; a 1.4 s task on the large Dashboard). The store reads figures without copying them; every signed-in page, the agreement, setup, and Invite friends paint once, after their first render (the `#first-view` render hold; Sign in and Create account measured no shift); a region drawn later waits behind a skeleton of its final size, and every held region shows in one frame (`boot.ready()`); heavy renders are split under 200 ms; the shared shell's own shifts are gone; the audit checks the budgets | Every page |
| G3 | Signing should be one easy step, with some animation | One sentence, **Sign and continue**, and Not now, over the facts read only (signing as Alex Morgan, the email, the date, the home Region). Pressing it plays the signing moment (the name writes on the line, a seal stamps with a check, the panda cheers with the pen, "Signed. Taking you to setup."), then the page goes on; the record keeps `method: 'one-step'`, once per version | The agreement, every signing path |
| D1 | Use the space, a snapshot at a glance; what happened to the tokens graph? | Three tiles of one design (Job matches, Applications, **Runs and tokens**), each a head, a visual, a middle, and a foot; the tokens graph is back as a ring beside the runs ring; every figure once, with `data-metric` | Dashboard |
| D2 | Prompt tests is the worst one; show every prompt and how it does across versions | **Prompts**, full width: all 8 prompts as shared prompt summary rows (the version in use, the Test score trend, Kept by you, tokens, and Ran on, over the last 30 days) under "13 tests · 10 passed · 3 did not pass · 2 on trial"; each name opens the prompt on Prompts, with Back to Dashboard | Dashboard |
| D3 | Gmail: scan once a day over the last 48 hours, and on demand, each counted in runs | Gmail scans daily at **07:00** your time over the **last 48 hours**, and **Scan now** reads what came since; each scan uses one run. The Gmail card: the last scan and what it found, the next scan, Scan now ("uses 1 run"), and a 7 day chart by outcome; the same facts on Connections (`#conn-gmail-scan`) and in Applications' Sync from Gmail | Dashboard, Connections, Applications |
| D4 | To-do and What's new are good; don't change anything | **Locked:** the same markup and behaviour as round 6, part 3; only their place moved up, under the tiles | Dashboard |
| D5 | How many were auto applied, auto tailored, and need human approval | The Applications tile's **So far** table, your deputy against you: tailored 5 (1 edited by you), approved 0 and 4, applied 1 and 3; and **3 need you** in the tile's head, a link to the board filtered to them (`?show=need`) | Dashboard |
| D6 | Keywords don't say which role; what about several roles? | **Keywords by role** on the Dashboard and Résumés: All your roles, Software engineer, Product engineer, Engineering manager, each heading saying which ("Top keywords for Engineering manager roles, 5 found"), kept in the address (`?keywords=<role>`) | Dashboard, Résumés |
| D7 | Move Matches by source, New roles per search, and Latest matches to Searches; each screen its own metrics | Matches by source and Roles found per search open Searches (its band, `#srch-band`); Latest matches is gone (Job matches is that list, and its band says what is new); every screen opens with its own metrics band (R10-2) | Dashboard, Searches, Job matches |
| D8 | A daily summary email to subscribe to, counted in runs | Off by default, at 08:00 your time, **1 run each**: Email me this every morning on the Dashboard and in Settings, Account (`#emails`, its home), with See a sample (`summary-email-preview.html`: the glance as it stood when sent, the To-do, what changed since yesterday, and Open your live Dashboard) | Dashboard, Account, the sample email |
| D9 | AI in October needs more data: keys, models, every permutation | **Usage** replaces it: 90 days of usage (from Sat, Jul 4) that follow dated AI settings, one at a time, with fallback days when a key's limit is reached and a one-off Run again; over them the usual sample used five models across your OpenAI key, your Anthropic key, and platform credits. The Dashboard card: a range picker (Last 30 days by default), tokens by model, runs by what used them, and the settings of the range in words | Dashboard |
| D10 | How many tokens and runs do I have, and how long do they last with everything enabled? Very granular, ranges like CloudWatch | The **Runs and tokens** tile: two rings, the runway ("At your settings your 4 runs last through Sat, Oct 3; your OpenAI key’s tokens through Tue, Oct 13"), and what uses runs each day. It opens the new **Usage** tab (`usage-preview.html#runway`): a time range picker (Last hour to This month, and Custom), live filters (key, model, task, prompt, and what used a run), the runway, runs over time, tokens over time by key, model, task, or prompt, and every key x model x task combination. AI & credits keeps the AI setting, keys, and limits; its Tokens over time is one line linking to Usage | Dashboard, Usage, AI & credits |
| D11 | Is anything missing? | Two additions the orchestrator approved: **replies and interviews** ("4 applied · 3 replied (75%) · 1 interview") in the Applications tile, and **your deputy's week** under the intro ("This week your deputy checked 138 job listings, found 18 that fit, ..."), with See activity | Dashboard |
| S1 | Remove any duplicate screen and redirect to the existing one, with no data loss | **One home per thing (R10-3):** every See the prompt goes to `prompts-preview.html?prompt=<id>&return=<page>`, and the prompt drawer is now the Prompts page's editor only; buying goes to Purchases (`#buy`, `#credits`); usage to Usage; the full activity to Activity; Email after each application moved to Account. A home shows **Back to \<page>**, and coming back restores the scroll, the open panels and dialogs, the filters, the chosen item, and focus | Every page |
| S2 | Bring removed things here only if they add value | Only Matches by source and Roles found per search (D7) | Searches |
| S3 | Two prompts on Searches but one graph; how each prompt burns tokens | Both prompts as the shared prompt summary, card size: each with its trend, its window, Kept by you, its tokens with their share of every prompt's tokens, and Ran on, at one spacing | Searches |
| S4 | Capture model choice, tokens, and success for the same prompt | Per version and per model: the summary names the top two models ("gpt-5-mini 87%, Ministral 3 14B 13%"); Prompts' Details hold the **By version and model** table (runs, Kept by you, Test score, tokens per run, tokens, seconds per run) and tokens over time by version | Prompts, every prompt summary |
| S5 | Paging between pages makes me scroll a lot | **Shared pagination (R10-6),** researched first: a pager at the top and the bottom, the range in words ("13 to 24 of 40 roles"), Per page 12, 24, or 48, the page in the address, and after a change the list's top in view under the sticky header with focus on its heading | Every paged list |
| J1 | Prompts and tables differ from Applications; combine Job matches with Searches? | The same prompt summary, list, pagination, and metrics band everywhere; **not combined** (see below) | Job matches, Searches, Applications |
| J2 | Once added, take the role off and let me check the next | **A queue:** To review N and Not for me N (`?view=not-for-me`); Add to Applications or Not for me takes the role out and opens the next, with Open in Applications and Undo; a role already in Applications (`?job=`) and the old In Applications view (`?view=tracked`) open Applications | Job matches |
| A1 | One unified Applications flow; watch only if I want; Sync from Gmail should move the board | **One board (R10-4):** six lanes in flow order (Shortlisted, Tailoring, Approval, Applied, Interviewing, Offer) and Closed folded. The header holds the flow summary, the automation split, **N need you** (`?show=need`), Company, Add a role, Your rules, and the Gmail line with **Sync from Gmail** (uses 1 run) and **Emails (N)**. Ready for you, Up next, the stage strip, the List view, Approve all, and the emails and rules sections went; the emails and your rules are drawers (`#email`, `#how-you-apply`). Every step is on the card with who did it ("Auto-applied Sat, Sep 26, 10:12", "Approved by you"); cards glide to their new lanes; Watch opens the live autofill view | Applications, Autofill |
| A2 | One prompt experience, unified across | The shared summary for `mail` and `reply` in the Emails drawer and `answer` in Your rules | Applications |
| R1 | Align the prompt with all others | The shared summary for `check` (Résumés' readiness) and for `tailor` and `letter` (Materials); keywords by role (D6) | Résumés, Materials |
| P1 | It's good; lock it | **Locked:** only the shared chrome changed (the render hold, the nav badge, and `#usage` forwarding to Usage) | Profile |
| SE1 | An audit trail, with a filter between human and machine actions | **Activity**, a new Settings tab (`activity-preview.html`): every entry says who did it (You, Your deputy, or JobDeputy for the system), what, where, and when, with a link to the thing; the last 30 days by who; live filters (Who, Area, the time range, search); the shared pagination; grouped by day; Export as CSV. The deputy's Activity panel gains See all activity | Settings, the deputy |
| SE2 | Align the Prompts page with the rest | The summary stats, then all 8 prompts as summary rows, each expanding in place (Details) to its state line, the full prompt control, the By version and model table, tokens over time by version, and its rollback rules; `?prompt=<id>&return=<page>` opens one with Back; Edit as a new version opens the editor drawer, here only | Prompts |
| SE3 | Purchases concise, the buy quick; receipts of every payment, with filters | Balances first (the runs and tokens rings and the runway), **one quick buy** (`#buy`: Runs, AI credits, or Bundles; packs as choice cards with how long each lasts, a recommended pick, and one Buy), How prices are made folded (`#prices`), then **Receipts** (`#receipts`): every payment with live filters (search, the time range from All time, kind, status), totals for the filter, the shared pagination, and each receipt to view and download (`?receipt=`) | Purchases |
| L1 | Make sure we keep the large account | `?demo=large` on every page, and every new view filters, pages, and caps (top N plus Other) on it; the budgets are measured on it too | Every page |
| L2 | Notes for React static development: logins, non-happy paths; no React code yet | Notes only: [react-static-notes.md](react-static-notes.md) | Docs |

### The shared rules (R10-1 to R10-10)

- **R10-1 Boot without flicker, never hang (G2):** no visible second draw; a region a script redraws
  is drawn before the first paint or starts as a skeleton of its final size; reveal once; no task
  over 200 ms; layout shift at most 0.02.
- **R10-2 Each screen its own metrics, the Dashboard a glance (D7):** a screen opens with its metrics
  band (a stat row, at most two charts); the Dashboard has one glance per area, linking to its
  screen.
- **R10-3 One home per thing (S1):** edit where it lives; elsewhere a read-only summary and one link
  carrying `return=`; the home shows Back to \<page>; coming back restores the place.
- **R10-4 Applications is one flow (A1):** one board, every step on the card, who did it said,
  watching optional, live moves in place (R9-3).
- **R10-5 One prompt experience (A2, S3, R1):** the shared prompt summary, row or card, is the only
  way a page outside Prompts shows a prompt: the same parts, words, spacing, and chart everywhere.
- **R10-6 Lists keep your place (S5):** a top and a bottom pager, the range in words, the page size,
  the page in the address, and the list's top in view with focus on its heading after a change.
- **R10-7 Big lists filter live (SE3):** the shared filter bar (search, facets with counts, the time
  range where dates matter, Clear) updates as you type or choose, with its state in the address.
- **R10-8 Signing is one step (G3):** one sentence, one button, one short moment.
- **R10-9 Everything is runs or tokens (D3, D8, D10):** each search you start, each source a Keep
  watch check reads, each Gmail scan, and each daily email use one run; AI work uses tokens; every
  control that spends a run says so first ("uses 1 run"); the runway counts everything enabled.
- **R10-10 Budgets (G2):** every page, usual and large, at 1440, 1024, 768, 390, and 320: layout
  shift at most 0.02 after the first paint, no task over 200 ms, and the first view within 1 s on
  this machine; the audit enforces the first two.

### Job matches stays apart from Searches (J1)

The owner asked whether Job matches could be combined with Searches, "as this is part of Searches",
and asked for the right solution rather than a yes. We kept them apart because they are different
jobs. Searches is where your deputy looks: set up once and changed now and then. Job matches is a
**review queue**: daily, many quick decisions, each needing the detail pane. Applications is what
you are pursuing. Folding the queue into Searches would bury the daily task under the setup, and on
the large account its 1,008 found roles would drown the sources around them. What makes the three
one experience instead: the same prompt summary, the same list and pagination, the same metrics
band, and the flow strip (Searches › Job matches › Applications) on all three pages.

### The bugs that mattered most

- **The Dashboard froze for 1.4 seconds on the large account** (measured before work started; 0.7 s
  even on the usual sample at 390): `metrics()` copied the whole metrics object on every `metric()`
  read, thousands of times a render. The store now reads without copying and keeps its views
  between changes: the large Dashboard's metrics time fell from 971 ms to 79 ms and its longest task
  from 1,363 ms to about 75 ms. At 4x CPU, T3 still found the large Dashboard and Prompts over
  budget (356 to 688 ms); the eight prompt summaries now draw in one layout (354 to 167 ms at 4x on
  the large Dashboard), and a store tick that changes nothing a page shows no longer redraws it.
- **Layout shift up to 0.97 on phones** (Searches and Applications 0.97, Job matches and Prompts
  0.92, the agreement 0.73; Applications 0.45 at 1440): the first paint raced the scripts. The
  shared causes were fixed in the shared files (the phone Menu list open in the first paint, the
  deputy chip and the dock without their final room, Take the tour revealed late, the rail's duty
  line, bar charts that grew in height), and every page its script redraws now paints once, after
  its first render, with skeletons for anything later: Applications from 0.455 and 1.371 to 0 and
  0.001, the agreement from 0.744 to 0.002 at 390, and Materials from 0.249 and 0.519 to 0. Filming
  loads at 4x CPU, T3 then found stale first frames (an empty dock, the usual sample's nav badge on
  the large account) in 16 of 21 loads; the dock, the flow ribbon, the footer, and the nav badge are
  now drawn as the shared scripts run (0 of 8).
- **Touch-only overflow that desktop-pointer testing missed** (T2, T4): on touch screens the
  Dashboard's Applications key shows each colour's meaning, which widened the page to 807px, panned
  it sideways, and pushed the opening loader and every tour card off screen; the multi-select and
  time range popovers ran off the right edge. The key now takes the tile's width on touch, popovers
  measure the layout viewport, and the audit runs every width under 1024px as a touch device.
- **Live updates every 6 seconds replaced controls on the large account** (T3-19, T7-1): the live
  tailoring queue changed the store about every 6 seconds and pages rebuilt their controls each
  time, so Activity's pagers emptied and focus fell to the page, Prompts' unsaved rule edits reverted
  within 2 to 3 seconds, and Résumés' filter bar lost letters mid-word. The store now tells listeners
  only when something changed, and what (`change.areas`, `change.progress`); the pager, the filter
  bar (`setOptions`), and the prompt summaries change in place, and a form with unsaved edits is
  never redrawn.
- **A new receipt hidden by a minute-cut range** (T5-1): after a purchase, Receipts said "No receipts
  match these filters" while its header counted the receipt, because the default range ended at the
  minute the page was built. Receipts now default to All time, offer Last 90 days, Last 12 months,
  and All time, and Clear returns to the default preset, never a fixed end.
- **Kept by you computed three ways** (T5-3, T7-6): the Dashboard, Prompts, and Résumés said "100%
  of 2 runs" where Usage said 88% for the same prompt, and totals added rounded figures. Every
  call's Kept by you is now a whole decision; every percentage is kept over decided from the store's
  exact counts, says its count and window, and never shows without runs ("No runs").
- **Steps stamped at noon** (T5-5): seeded application steps were written at `12:<n>:00` on their
  day, so a card said "Auto-applied Sat, Sep 26, 10:12" while Activity said 12:02, and a tailoring
  start came after your pause. Every step now keeps its real moment, the same on the card, in
  Activity, in the daily email, and in the review.
- **September used more runs than existed** (T5-6): the usual sample spent 21 runs in September with
  10 free and none bought. `runsAccount()` now spends each month's 10 free runs first and bought runs
  only after a purchase: the usual sample's other searches moved to July and August (8, 10, 9, and 6
  runs from July to October), and two run packs pay for the large account's September (120 runs on
  Sep 6, 30 on Sep 23), which leaves it 123 of 192 runs.
- **Also major:** the checkout counted Keep watch only ("120 runs: 60 more nights at 2 runs a night",
  T5-2: buying now has one home, and every pack says how long it lasts at your settings); the
  signing moment played below the fold on phones (T4-5); the large account's usage contradicted its
  own AI setting (T5-7) and its key's tokens ring counted another key (T5-8); the needs-you count
  disagreed with the board after a Gmail disconnect (T5-10); the prompt summary differed from page
  to page (T6-3) and exposed only its title to screen readers (T4-2); nothing was said when a role
  finished tailoring (T4-3); choosing Custom by arrow moved focus into the time range's From
  (T4-4); and Cloud Reliability's card said you paused it while its panel said your deputy was
  drafting (T6-2).

### Testing

| Tester | Scope | Findings (first pass) |
|---|---|---|
| T1 | Desktop journeys, start to finish, at 1440×900 and 1024×768 on the usual sample | 26 |
| T2 | Phones and tablets with real touch (390×844, 320×568, and 768×1024; 375×667 and 360×740 spot checks), usual and large | 25 |
| T3 | The large account and performance at 1440×900 and 390×844, with 4x CPU and filmed loads | 24 |
| T4 | Accessibility: keyboard only, screen reader semantics, reduced motion, forced colours, 200% zoom | 19 |
| T5 | Data consistency: every figure you pay for or decide on, across pages, in both worlds | 20 |
| T6 | The owner's UAT: every row of the brief, at 1440×900 and 390×844, usual and large | 19 |
| T7 | Regression against round 6: its journeys, the deep links and old anchors, the R9 rules | 14 |
| **All** | | **147, before merging duplicates** |

Several findings were one defect seen by more than one tester: the checkout's nights by T5, T2, T7,
and T1; the noon timestamps by T5, T2, T3, and T1; the touch overflow by T4 and T2.

**Retest:** the same seven testers reran every probe behind their findings on a second frozen copy,
then a short fresh pass. Most first-pass findings were fixed (T5 17 of 20, T3 22 of 24, T4 17 of 19,
T2 21 of 25, T7 all 14, T6 all but two that were fixed right after); the retest found 32 new items,
three of them major (Applications' Gmail counts after Sync, the large account's platform prices, and
the Dashboard Usage numbers hiding a column). Every item was fixed, decided, or withdrawn, and the
final copy passed the full verification (2,785 of 2,785 tests, the audit at five widths with 0
failing checks, metrics 0 mismatched, the journeys, and 0 console errors); details in
`docs/ui-consistency-audit.md`.

The audit's new checks and the final test, audit, and probe figures are in
[ui-consistency-audit.md, round 7](ui-consistency-audit.md#ninth-review-round-7-of-the-signed-in-redesign).

### How to review round 7

Open <http://127.0.0.1:8767/brand/> (or the files straight from the folder), go to Help and choose
Reset sample data, then:

1. **Sign in:** `login-preview.html?skipLoader`: "Agentic job applications", "You set it up. Your
   deputy applies.", and the three steps playing once (about 13 seconds), then holding on step 3
   with Replay story; each step in the strip is a button. At 390 wide the band above the form shows
   the eyebrow and the brand line; at 768 the story is compact and the form starts in the first
   view. `access-preview.html?mode=create&skipLoader` tells the same
   story.
2. **Signing in one step:** Create account by email to reach the User Agreement: one sentence, Sign
   and continue, Not now, and the facts read only. Press Sign and continue with the mouse: the name
   writes on the line, the seal stamps, the panda cheers with the pen, "Signed. Taking you to
   setup.", and about 2 seconds later setup opens. Reset sample data and sign again with Tab and
   Enter: it waits, "Signed. Continue when you’re ready." Then Reset sample data once more, so the
   usual sample is unsigned for step 6.
3. **The Dashboard:** `home-preview.html` (the opening loader) and `home-preview.html?skipLoader`:
   one paint, no second draw. The three tiles; Applications' So far table and "3 need you"; Runs and
   tokens' two rings and the runway; To-do and What's new as before; Prompts' eight rows; Gmail's
   daily scan and Scan now ("uses 1 run": every runs figure and the runway follow it); Usage's range
   picker; Keywords' role chips. Turn on Email me this every morning (it says the run first), then
   See a sample.
4. **Searches:** the band (Matches by source, Roles found per search), the filter bar on one row,
   the pagers at the top and the bottom with Per page, and the two prompt cards: choose a name, and
   Prompts opens on it with Back to Searches; Back returns you to the same place and control.
5. **The Job matches queue:** To review and Not for me; Add to Applications on the open role: it
   leaves the list, the next role opens (the address names it, so a reload keeps it), and the
   notice offers Open in Applications and Undo.
   `jobs-preview.html?view=tracked` opens Applications.
6. **Applications:** one board in flow order with Closed folded; Needs you (`?show=need`); the
   Emails and Your rules drawers (`#email`, `#how-you-apply`). **Sign 2026.10 first to see Sync from
   Gmail move cards** (the To-do's Review and sign, or Settings, Account, Sign now): the moves that
   waited for it apply, and the cards glide to their lanes. Then Sync from Gmail (uses 1 run): it
   reads the two job emails that came after 07:00 and moves Staff Engineer, Developer Platform at
   Northwind Labs from Shortlisted to Applied, says what changed, and offers Undo. (Pressed before
   signing, Sync moves nothing: it says how many cards will move once you sign, with Sign now.)
   Watch on an applying card opens the live autofill view, and its Back returns to the board.
7. **Settings** (seven tabs: Account, Connections, Prompts, AI & credits, Usage, Purchases,
   Activity). **Prompts:** `prompts-preview.html?prompt=rank&return=home-preview.html` opens Score
   fit and give reasons with Back to Dashboard; Details shows By version and model, tokens over time
   by version, and its rollback rules; Edit as a new version opens the editor. **Usage:**
   `usage-preview.html`: the range (try Last hour and Custom), the filters, the runway (`#runway`),
   runs and tokens over time (By key, By model, By task, By prompt), and every combination (pagers
   at the top and the bottom, Per page);
   `usage-preview.html?range=month&group=model` keeps the choice. **Purchases:**
   `shop-preview.html#buy`: the balances, then one quick buy with its recommended pick; Receipts says
   "No payments yet"; buy a pack, and its receipt is listed, to view and download. **Activity:** the
   Dashboard's See activity (`activity-preview.html?who=deputy&range=1w`), the Who chips with their
   counts, Area, the range, search, both pagers, and Export.
8. **The sample daily email:** `summary-email-preview.html`, from See a sample (Back returns to where
   you were); on the large account, Activity's "Sent your daily summary email" rows open that day's
   email (`?date=`).
9. **The large account:** add `?demo=large` to any page (or Help, Demos, See a large account): the
   Dashboard without a freeze, Job matches' queue (963 to review), Activity's log (over 1,500
   entries), Receipts (13 payments, 2 refunded, with filters and totals), and Usage on every range;
   then `?demo=usual` returns your figures.

### Open questions for the owner (round 7)

The round 6 questions above stay open, except these, which this round answered or changed:

- **The agreement 2026.10 text** no longer names Profile for Gmail, export, or deleting the account,
  and no longer sells nightly runs: it was amended in place (the first new question below).
- **The page setting edited in two places** (P-21) is decided: Résumés' Templates is its home, and
  Materials shows it read only.
- **Run packs saying "15 more nights":** every pack now says how long it lasts at your settings
  ("Lasts through Tue, Oct 13").
- **Approve all that passed** went with Ready for you: one approval is one click on the card, and
  auto approve is the bulk path.
- **Latest matches' title** and **the Prompt tests and Gmail sync band's height:** both cards are
  gone.
- **Word budgets:** the Dashboard's prose budget rose again, to 458 words (630 in all), for D11's two
  lines and the testers' fixes.

New in round 7:

- **The 2026.10 agreement text was amended in place twice** as a pre-launch draft for counsel,
  instead of publishing 2026.11: first so its record lines are method-neutral for one-step signing
  ("the name you signed with", "how you signed"), then for runs for everything (each search, Keep
  watch check, Gmail check, and daily email uses one run) and Settings' new homes (Gmail in Settings,
  Connections; export, deletion, and your signed copies in Settings, Account). Its fingerprint
  changed with it. Keep amending the draft, or publish 2026.11 for everyone to sign?
- **Email moves wait for the 2026.10 signature** on the usual sample (R9-12), so Sync from Gmail moves
  nothing until you sign; it says how many cards will move and offers Sign now. A move already read
  still waits after you disconnect Gmail.
- **The Gmail scan runs at 07:00** in your home Region's time, so the 08:00 daily email includes it.
- **Your deputy tailors the roles you added each morning at 06:00** (a rule in Your rules, on by
  default, about 18,520 tokens a role on your AI setting) rather than at once; Tailor now still
  starts one at once.
- **Usage became a seventh Settings tab,** after AI & credits; where the seven don't fit, the strip
  is one row that scrolls sideways with a fade at the edge.
- **Buying has one home** (Purchases): Get more runs and Buy credits on other pages go to
  `shop-preview.html#buy` or `#credits`, and the checkout dialog opens only there.
- **Applications' List view was removed,** with its bulk Move selected and Sort by: a role moves from
  its panel, and phones get the lanes as a list with a stage index.
- **The sign-in brand headline is not the page's `h1`:** the `h1` stays "Welcome back." (Create
  account's "Set up your search desk."), so the form keeps its heading.
- **The signing moment goes on by itself** after about 2 seconds for mouse and touch (round 6, part
  3's "nothing redirects by itself" is reversed only here), but waits for Continue when you signed
  with the keyboard, so nobody using a screen reader or a switch is moved on early (WCAG 2.2.1).
- **The prompt summary's name is its only link** (with a chevron, and "open in Prompts" for screen
  readers); there is no separate Open in Prompts.
- **Materials shows the page setting read only,** with Change in Résumés.
- **The dock's Pause stops motion only;** your deputy's searches, scans, and tailoring go on.
- **The usual sample has never bought,** so its Receipts are empty ("No payments yet"); the large
  account has 13.
- **Decided in the fix pass, open to change:** the tokens ring follows the key's limit period ("Of
  250,000 a month on your OpenAI key" on the usual sample; a day on the large account, whose key has
  a daily limit); two Back patterns (the header pill on a role's two full-screen editors, Materials
  and Autofill; Back to \<page> in the intro everywhere else); Searches' per-search bars carry no
  `data-metric` (each run's figure keeps its key on its source card); reading job email is part of
  each scan's run and never counts in the tokens you pay for; the usual sample approves nothing
  automatically, because auto approve is off in its rules; and AI & credits counts credits as
  Ministral 3 14B tokens' worth, beside the platform tokens Usage counts.
