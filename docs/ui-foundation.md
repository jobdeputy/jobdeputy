# JobDeputy UI foundation

**Status: LOCKED — approved October 1, 2026.** Amended October 1, 2026 with the user-approved
cross-page consistency contract ([ui-consistency-audit.md](ui-consistency-audit.md)). Amended
October 3, 2026 with the signed-in app redesign the product owner asked for on October 2, 2026:
the sidebar app shell, the deputy companion on every signed-in page, and the Applications,
Résumés, AI & credits, Searches, and onboarding routes ([ui-app-redesign.md](ui-app-redesign.md)).
Amended again on October 3, 2026 with round 2, which answers the owner's review of round 1: the
phone layout of the entry pages and onboarding, first-time and returning sign-in, the visual
Dashboard, Searches, and AI & credits, Job matches (renamed from Jobs), the autofill preview,
Invite friends, Feedback, and the full Profile
([ui-app-redesign.md, round 2](ui-app-redesign.md#round-2-the-owners-review-october-3-2026)).
Amended on October 4, 2026 with round 3, which answers the owner's review of round 2: chrome that
stays in view on phones and tablets, a strict Pause motion and a companion that reacts, one sample
world behind every number, the regrouped Dashboard with its tour, Searches with live runs, archive,
and Keep watch's nightly allowance, résumé templates and previews, visible and customizable
prompts, model changes on a saved key, voluntary self-identification, the Gmail connection, and
public Help
([ui-app-redesign.md, round 3](ui-app-redesign.md#round-3-the-owners-second-review-october-4-2026)).
Amended on October 4, 2026 with round 4, which answers the owner's review of round 3: ring tiles
on the Dashboard, a live run tracker that counts up, one AI setting for the whole account with a
token limit on your own key, Deputy Assist as the name of the AI work, Keywords on the Dashboard,
the Shop, Job matches pages, and the résumé preview's Pages and Text
([ui-app-redesign.md, round 4](ui-app-redesign.md#round-4-the-owners-third-review-october-4-2026)).
Amended on October 7, 2026 with round 7, on two of the owner's asks in their sixth review: the
authentication story is the brand line and three steps instead of the eleven-chapter narrative
(G1), and signing the User Agreement is one step (G3)
([ui-app-redesign.md, round 7](ui-app-redesign.md#round-7-the-owners-sixth-review-october-6-and-7-2026)).
**Amended October 25, 2026 with AI Boost**, the product owner's explicit approval, given in the
current task, to depart from three rules below for one named exception: a larger, more detailed
panda deputy on the right of the Dashboard only, titled AI Boost, instead of the dock alone. See
[AI Boost (round 8)](#ai-boost-round-8) for the exact exception and what still holds everywhere
else.
**Amended October 26, 2026 with AI Boost, round 9**: the product owner reviewed round 8's panel
against a screenshot of a small floating "talk to us" corner bubble and asked for that shape
instead, keeping the panda character. Round 8's panel placement is superseded; see
[AI Boost (round 9)](#ai-boost-round-9) for the current exception.
The owner reviews the result before it is locked.

This document is the composition and continuity contract for every JobDeputy product page. It
locks the approved foundation established by `brand/login-preview.html` so future screens feel like
one connected product rather than unrelated page designs.

`docs/design-system.md` remains the source of truth for tokens, voice, motion, panda behavior, and
accessibility. This document defines how those parts MUST be assembled across pages.

## Lock governance

- Future UI work MUST preserve this foundation unless the user explicitly approves a foundation
  change in the current task.
- Agents MUST NOT alter a locked reference pattern merely to make one page easier to implement,
  because local convenience creates product-wide drift.
- If a requirement conflicts with this document, the agent MUST stop, identify the conflict, and
  request direction before changing the foundation.
- An approved foundation change MUST update this document, `docs/design-system.md`, relevant brand
  guidance, and the UI SOP in the same change.
- Feature-specific content, data, controls, and task flows MAY vary. The identity, shell,
  interaction language, responsive behavior, and accessibility baseline MUST remain connected.

## Locked product signature

### Identity

- The panda perched on the `JD` monogram is the canonical identity.
- Persistent headers MUST use `brand/jobdeputy-mark.svg` with the `JobDeputy` wordmark when space
  permits.
- The full `brand/jobdeputy-animated.svg` MUST be reserved for initial application or
  authentication bootstrap, onboarding, and dedicated brand moments.
- Persistent navigation MUST remain calm and MUST NOT loop the full logo animation.
- The warm paper canvas, black ink, bamboo green, restrained orange, serif narrative type, and
  system-sans operational type are locked as the recognizable visual language.

### Opening experience

- Initial bootstrap MUST use the approved animated logo and its host-controlled progress line.
- Each new document load MUST create a fresh animated-SVG instance so a normal refresh starts the
  story at its beginning instead of resuming a cached animation clock.
- The standard opening story MUST retain its approved `2.605s` timing and bounded failure-safe.
- Ordinary client-side page changes MUST NOT replay the opening loader because repeated entry
  sequences make the product feel slower. This includes the hand-off from sign-in to Search home.
- Reduced-motion users MUST receive the approved near-immediate static completion state.

### Persistent header

- The header MUST remain compact, quiet, and visually stable.
- The left side MUST carry the compact panda-on-`JD` identity, `JobDeputy` wordmark, and
  `Your search partner` descriptor while horizontal space permits.
- The right side MAY contain one concise page-level destination or action.
- Header controls MUST remain at least `44px` high and work without clipping at `320px`.
- Hover and press feedback MUST be subtle translation, border, or surface changes. The header MUST
  NOT use glow, large scaling, or looping motion because it is persistent product chrome.

## Locked page composition

### Entry and authentication pages

- Desktop MUST use a true full-screen golden-ratio story/task split beneath the header.
- Tablet MUST retain two columns only while the task panel remains at least `390px` wide.
- Mobile MUST stack the story before the task and preserve the narrative-to-action relationship.
- The story area MAY introduce the deputy and product purpose. It MUST NOT be duplicated on every
  internal work page.
- The task panel MUST use the same warm editorial surface, restrained hierarchy, persistent labels,
  and dark primary action established by the login reference.
- On split layouts the story column is one viewport tall and sticks under the header while the
  task scrolls past it, so task changes never move the stage. Short viewports shrink the stage,
  never the copy, and the task starts at least `21px` below the header.
- Split layouts no taller than `800px` use a tighter task rhythm (control spacing only) so the
  primary action clears the fold at `1280×720` and `1366×768`. Account access keeps its card exactly
  as tall as sign-in's, so both routes share one story-shell geometry.

### Internal product pages

- Internal pages MUST reuse the persistent header and warm paper canvas inside the shared app
  frame. A fixed sidebar holds the eight sections and the deputy dock, and becomes an `89px` rail
  from `721px` to `1100px` and an app bar with a Menu disclosure at `720px` and narrower. The
  header and the sidebar, rail, or app bar MUST stay in view while the page scrolls, so a person
  never scrolls back to the top to change pages (see [App shell](design-system.md#app-shell)).
- Each page MUST begin with a clear eyebrow or context label, serif page heading, and concise
  supporting sentence when explanation is needed.
- Primary work MUST live in a clearly bounded task region using approved surfaces, borders, radii,
  spacing, and shadows.
- Pages SHOULD retain generous negative space and one obvious primary action rather than filling
  the canvas with dashboard cards. The Dashboard is the one visual snapshot of the search, one
  glance per area (**round 7, D1, D7, and R10-2**): three tiles (Job matches, with the search
  status and a live tracker only while a search runs; Applications, with who did each step and how
  many roles need you; and Runs and tokens, with the runs and tokens rings and how long they last),
  To-do and What's new, Prompts (every prompt as a summary row), Gmail's daily scan, Usage, and
  Keywords by role, each in its own bounded surface. Matches by source and roles found per search
  open Searches instead, and every other screen opens with its own metrics band. Every number on
  the Dashboard links to the page and filter that shows the same name, colour, and count, and no
  fact appears twice.
- Every number on a signed-in page MUST come from the shared sample world
  (`brand/sample-store.js`), carry `data-metric`, and appear once per page; when two surfaces would
  show the same figure, they merge.
- Every chart colour MUST explain itself: a tooltip on hover and focus, and a visible key on touch
  screens.
- Every signed-in page with a tour marks its steps with `data-tour-step`; tours start after setup,
  from Show me around, from `?tour=1`, and from Help's Demos, never on a plain load.
- Wherever an LLM task runs, the page shows its prompt as the shared, read-only prompt summary,
  whose name opens that prompt on Settings, Prompts (`prompts-preview.html?prompt=<id>&return=`)
  with Back to the page you came from, your place restored; the Prompt drawer is the Prompts page's
  editor only (**round 7, R10-3 and R10-5**). Customizing never removes the locked safety rules.
- The deputy MUST react once to each action the person completes (`react()`), and Pause motion MUST
  stop every animation on the page.
- Pages lead with figures (numbers, charts, rings, status) and at most one supporting line per
  section; explanations move into a disclosure or the Help centre.
- The deputy companion appears in the sidebar dock on every signed-in page. Its pose MUST name the
  page's work or the operation under way, using the named states in
  [Deputy companion](design-system.md#deputy-companion-signed-in-pages). It MUST NOT appear as
  unrelated decoration, repeat the introductory story, or appear twice in one viewport. **AI Boost
  on the Dashboard is the one named exception**; see below.

### AI Boost (round 8)

**Approved October 25, 2026** by the product owner's explicit instruction in the current task: "I
want realistic panda as AI Boost and that need to be at right side of dashboard not in one small
section." This departs from three rules above, for the Dashboard only:

- The panda is normally the cartoon panda-on-JD character everywhere; AI Boost MAY draw a more
  detailed, more naturalistic panda (soft fur shading, layered parts, natural proportions) instead
  of the compact dock drawing, because the owner asked for "realistic." It MUST still be
  recognizably the same JobDeputy deputy: the same markings, the same bamboo companion, the same
  named states and reactions, drawn in more detail rather than as a different character.
- The deputy companion normally lives only in the sidebar dock; on the Dashboard only, it MAY also
  appear as a larger panel on the right of the page content (`#ai-boost`, `brand/ai-boost.js` and
  `brand/ai-boost.css`), titled **AI Boost**, from `1280px` wide; a compact card under the page
  intro from `721px` to `1279px`; hidden on phones, where the app bar's deputy chip keeps the
  panda. No other page gets this panel.
- A page with the dock normally MUST NOT draw a second panda. On the Dashboard the dock steps out
  (the same mechanism as a tour: `JobDeputyDeputy.lend()`/`unlend()`) while AI Boost's panel shows,
  so one panda is drawn at a time; the dock keeps its real duty text and comes back the moment the
  panel is hidden or a tour starts (which steps AI Boost's own panda out in turn), so one panda per
  viewport still holds at every width.

Everything else in this document, `docs/design-system.md`, and the UI SOP applies to AI Boost
unchanged: its states map to the deputy's real named states and reactions (it invents no state and
no progress of its own), its loops run only while real work is pending or in progress, Pause
motion and `prefers-reduced-motion: reduce` stop every one of its animations exactly as elsewhere,
its speech and duty are plain visible text connected to the real action, and it keeps the warm
paper canvas, tokens, and voice rules. "AI Boost" is a label on this one panel; the AI work itself
is still named **Deputy Assist** everywhere, including inside the panel, which names both (see
[Deputy companion](design-system.md#deputy-companion-signed-in-pages) for the full behavior).

### AI Boost (round 9)

**Approved October 26, 2026** by the product owner's explicit instruction, given two screenshots of
a small round "talk to us" bubble fixed to a page's bottom-right corner: "i want ai boost like
this" — then, asked whether the panda should stay or the bubble should use a generic icon like the
screenshot: "Panda, small and round"; then, asked whether the bubble should replace round 8's panel
everywhere or only at narrower widths: "Replace the panel everywhere". This **supersedes round 8's
placement only**; round 8's permission to draw a more detailed, naturalistic panda still holds
(round 9 uses the same drawing, just smaller and cropped), and nothing else approved in round 8 is
withdrawn:

- AI Boost no longer appears as a panel beside the page content at any width. It is a small
  (`72px`) circular bubble fixed to the viewport's bottom-right corner, on top of the page, at
  every width including phones — the one-exception panda no longer needs the app bar's deputy chip
  as a narrow-width fallback, because the bubble itself is the fallback.
- Because the bubble is on screen for the page's whole life, the dock steps out for good the
  moment AI Boost's script runs (`JobDeputyDeputy.lend()`, never `unlend()`'d back, except that a
  tour still steps AI Boost's own panda out in turn, exactly as round 8 specified). One panda per
  viewport still holds; it is simply always AI Boost's bubble now, not the dock, on every
  signed-in Dashboard view.
- The panel's visible title, kicker, and duty text have no room on a `72px` bubble; they stay in
  the markup for assistive technology (the stage button's accessible name and
  `aria-describedby`), and the deputy's speech line shows instead as a tooltip to the bubble's
  left on hover, keyboard focus, and while a one-time pose (`[data-boost-play]`) is playing — the
  same real, unmodified deputy.js speech as round 8, just shown differently.

Everything else in round 8's text above still applies unchanged: the character, its named states,
real-state-only motion, Pause motion and reduced motion, and the Deputy Assist naming.

### Connected navigation and state

- Every page MUST make the current task, the next available action, and what remains under the
  person’s control understandable without relying on animation.
- Navigation labels and primary actions MUST use direct human language.
- Loading, empty, success, warning, and error states MUST preserve the same calm voice and visible
  status hierarchy.
- Consequential actions MUST continue to require informed user approval.
- Generic authentication errors MUST never reveal whether an email or account exists.

## Locked interaction primitives

Future production components SHOULD extract these patterns instead of copying prototype markup:

| Primitive | Locked responsibility |
|---|---|
| `AppHeader` | Sticky panda-on-`JD` identity, optional contextual Back action, and authenticated account menu |
| `ContextBackAction` | Destination-specific Back action that remains reachable in the sticky authenticated header |
| `AppFooter` | Dark ink closing surface with purposeful product navigation, home-Region context, help, privacy, and accessibility |
| `OpeningLoader` | Approved animated identity, fresh per-document instance, accessible progress, failure-safe |
| `EditorialIntro` | Short uppercase context, serif heading, concise sans-serif support copy |
| `TaskSurface` | Warm bounded work region with restrained border, radius, and shadow |
| `PrimaryAction` | Dark high-contrast action with subtle hover, press, focus, loading, and success feedback |
| `FormField` | Persistent label, example-only placeholder, helper/error relationship, autofill-safe surface |
| `HomeRegionSelector` | Automatic suggestion, compact visible summary, optional accessible disclosure |
| `PandaStatus` | Named semantic panda state paired with independent text status |
| `FeedbackPanel` | Shared visible notice, warning, validation, operation-error, or success treatment with concise recovery |
| `FieldFeedback` | Persistent helper or validation text connected directly to one control |
| `StatusAnnouncement` | Visually hidden polite or assertive announcement channel, separate from visible feedback |
| `AppShell` | Sticky sidebar with the eight sections and the deputy slot; rail and app-bar variants; the footer in the same two columns |
| `DeputyCompanion` | The panda deputy in the sidebar dock (or a scene host), in the named state for the page's work, with Pause motion and Activity |
| `SampleNote` | The shared `Sample data · not connected` marker on every surface that shows sample data |

New pages MUST reuse or extend these responsibilities. They MUST NOT create page-specific
alternatives with near-duplicate styling.

Each primitive's exact rendered values (sizes, weights, colors, radii, heights, and shadows) are
locked in the [Component contract](design-system.md#component-contract). Every brand page declares
the same canonical `:root` token block, uses one page-shell width, and renders the same header,
editorial intro, actions, form fields, pills, and footer. `tests/prototype/ui-consistency.test.ts`
and the rendered audit in [ui-consistency-audit.md](ui-consistency-audit.md) enforce this.

### Contextual back navigation

- A page that needs a Back path MUST place one `ContextBackAction` in the sticky authenticated
  header, immediately before the account menu, so it remains reachable on long pages.
- The label MUST name the destination, such as `← Search home` or `← Recent searches`; generic
  `Back` copy is not sufficient.
- The action MUST provide a `44px` minimum interaction target and remain visible on mobile.
- At narrow widths, supporting brand and account text MAY collapse before the Back action is hidden.
- The public trust page names the entry route the person came from (`?from=login`, `create`,
  `reset`, or `set`); an unknown value falls back to `← Sign in`. Links MUST NOT carry a recovery
  token to another page.

### Persistent product footer

- Internal product pages MUST use the shared `AppFooter` after the primary content.
- The signed-in footer uses the ink surface with white primary links and muted high-contrast
  supporting copy. Its content aligns to the same maximum-width shell as the page above.
- The footer MUST provide direct paths to Dashboard, Searches, Job matches, Applications, Résumés,
  Profile, Settings, AI & credits, Purchases, Invite friends, and the trust and support
  destinations (Privacy, Security, Accessibility, Help). (**Corrected in round 7** to match the
  build, following round 6's R6-6: Settings replaced AI & credits in the navigation.)
- Every authenticated page MUST use the same avatar account menu for identity, access tier,
  Profile, Settings, AI & credits, Purchases, Invite friends, Help & support, Show me around (only
  on a page with a tour), Send feedback, and Sign out (**corrected in round 7**, following R6-6).
  Sign out MUST NOT appear in the footer.
- Every authenticated header carries Feedback (it opens the shared Feedback drawer) and Invite
  friends before the account menu.
- It MUST state the current home Region and which account data remains there.
- Privacy, security, accessibility, and help destinations MUST use direct labels rather than a
  product slogan.
- Sign-in, account creation, recovery request, and verified-link password entry MUST NOT render a
  footer. These focused entry routes use the shared header as their only navigation surface.
- Footer links MUST remain at least `44px` high, wrap without overflow, and stack cleanly on mobile.
- Product-specific status, errors, promotional copy, and decorative panda marks MUST NOT be placed
  in the footer.

## Search history and found jobs

- Searches (`searches-preview.html`) holds the source form and Recent searches. The Dashboard links
  to it and never repeats the form.
- A saved source and an individual crawl attempt are different objects. Recent searches MUST group
  the latest state by source while preserving earlier attempts as history.
- Retrying the same normalized URL creates a new crawl attempt for the existing source. Searching a
  different URL creates a new source. Recovery copy and actions MUST distinguish those outcomes.
- A failed crawl MAY say that no jobs were saved. It MUST NOT say that no data was stored because
  source, crawl, and audit history remain.
- Searches find roles, Job matches (`jobs-preview.html`) is where the person decides, and
  Applications tracks only the roles they chose. A flow ribbon on all three pages shows that order.
  Job matches does not repeat the application workflow: a tracked role links to Applications.
- A completed source links to Job matches, the found-jobs page. Until relevance fields are returned by
  the jobs API, fit labels (Strong fit, Good fit, Stretch) and Why it fits reasons are launch
  previews. They MUST carry the sample marker and MUST NOT appear without it.
- Data-heavy lists MUST place search and status controls before rows and pagination after the
  complete results surface. Job preview selection and bulk checkbox selection are separate states.
- A select-all or select-visible control MUST sit immediately above the rows and inside the list
  column it controls. Its copy MUST state whether selection applies to the current page, filtered
  results, or the entire dataset.
- The current crawl and jobs APIs use cursor pagination and do not yet provide server-side search,
  filters, sorting, totals, or bulk mutations. Prototype controls MUST NOT imply those operations
  are connected until the contracts are extended. Job matches' numbered pages (round 4: 8, 10, or
  12 roles by screen width, "Page 2 of 3") are local; production needs a total count for them, or
  shows Previous and Next only.

## Application tracking

- Applications (`applications-preview.html`) follows each role through seven stages: Shortlisted,
  Tailoring, Approval, Applied, Interviewing, Offer, and Closed, on **one board** (**round 7, A1
  and R10-4**): the lanes in flow order with Closed folded, every step on the card with who did it,
  and no List view, stage strip, or separate approval queue. `?stage=` shows that lane alone,
  `?show=need` shows the roles that need you, and `?open=` opens one role's details.
- A stage changes by the person's choice (the labelled `Move to` select in the role panel, or a
  confirmed action) or by your deputy's work within your rules (tailoring finished, an approval by
  your rules, an application sent, an employer's email after you signed), and the card says who
  did it (**round 7, R10-4**). Each change is announced once; a move you made and an email's move
  can be undone.
- An Approval card waits for the person with your deputy's review score and **Approve and apply**;
  after approval your deputy applies in the background within your rules (round 6, A1 to A3;
  **round 7, R10-4**: the card is where it happens, and Watch opens the live autofill view). In the
  prototype nothing is sent, and the person can still mark a role applied after applying on the
  employer's site.
- Closing a role asks for a reason (Not selected, Withdrew, Accepted offer). Roles found elsewhere
  can be added by hand.
- The autofill preview (`autofill-preview.html?app=<id>`, planned for launch) shows how the deputy
  fills an employer's form: every field names its source (Profile, Résumé, Saved answer, Deputy
  draft, or Needs you), the person answers what the deputy does not know, and nothing is submitted
  until they confirm "I checked this application". It stays gated until the materials are
  approved, and the prototype sends nothing.

## Application-material review

- Generation controls MUST expose a visible pending state and prevent duplicate generation.
- Review actions MUST remain hidden until the selected job's material state is ready.
- Tailored résumé/CV and cover-letter drafts share one review workspace but retain independent
  content, save state, and download names.
- The workspace MUST preserve the selected job context and identify the base document and model
  used when that metadata exists.
- Editing, saving, copying, downloading, or printing a draft MUST NOT imply employer contact or an
  application submission.
- Until the generation and generated-document contracts exist, prototype material state remains
  local and MUST explicitly say that no API was called.
- The editor shows each draft beside a live page preview, a Job match count of the posting's
  keywords found in the current draft, and the Changes the deputy made against the base résumé,
  each to be checked. `Approve materials` confirms what approval means before it updates the
  application.

## Prototype route lock

The canonical browser journey and route responsibilities live in `docs/prototype-map.md`. Visible
navigation MUST resolve to those destinations or to a clearly scoped local interaction. Privacy,
Security, Accessibility, Help, Create account, Forgot password, and material Review actions MUST
NOT regress to decorative anchors or unavailable notices while their prototype destinations exist.

## Profile, documents, and AI settings

- Profile holds who the person is and what they want: an overview (how complete it is and the
  details to add), About you, Career, Job preferences, Application answers, and Found while
  applying (**corrected in round 7** to match the build, following round 6's P4 and T1: the
  account, with its read-only email, locked home Region, sign-in methods, password change, and
  account deletion, moved to Settings, Account, and How your deputy applies moved to
  Applications; Profile is locked since round 7, P1). It captures every field of the backend
  design or shows it as planned
  ([profile-data-coverage.md](profile-data-coverage.md)). Start timing lives in Application answers
  and is used only for application forms; it never affects ranking. Résumés (`documents-preview.html`) holds the document
  library and the tailored drafts. AI & credits (`ai-preview.html`) holds the default AI source,
  provider keys, and platform credits; usage over time moved to Settings, Usage
  (`usage-preview.html`, **round 7, D10**).
- Workplace preference uses independent `remote`, `hybrid`, and `onsite` choices because the search
  contract accepts any combination.
- The current document contract supports up to 10 uploaded PDF or DOCX documents in the broad
  `kind: resume` family. Optional `resumeVariant` metadata labels each one as a résumé or CV without
  changing its functional family. Cover-letter management and admin-configurable document limits
  are future backend work and MUST NOT be presented as available.
- AI access supports one encrypted key per provider. OpenAI and Anthropic keys MAY coexist; adding a
  second provider does not create multiple keys for one provider.
- Default AI source, provider status, platform allowance, and token usage SHOULD live in one
  connected settings section even when backed by separate endpoints.
- Choosing a default AI source MUST provide pending and saved feedback and update every place that
  names what it runs. Round 4 makes it **one setting for the account**: it runs every search, Keep
  watch check, and draft, with one model, and no page offers a choice per source or per task
  (Searches, the Prompt drawer, and Help state it once, with Change to `ai-preview.html#ai`). The
  static prototype persists this choice locally; production uses the AI-settings API.
- A person using their own key MAY set a token limit (`ai-preview.html#limit`): an amount, a day, a
  week, or a month (UTC, like the usage counters), and what happens when it is reached (pause AI
  work, or use free platform runs while any are left). A refused run says why and when the limit
  resets, and a To-do item appears. This is a prototype proposal; production needs a decision
  record and enforcement in the API.
- An authenticated account's Home Region is immutable profile information, not a form control.
  Region migration requires a future dedicated workflow.
- Profile-photo controls remain prototype-only until the strict profile schema and storage contract
  add a persisted photo field. Product chrome MAY demonstrate the intended shared avatar treatment,
  but implementation notes MUST retain this backend gap.

## Authentication foundation

- Email and password remain the primary credential fields; Google is a clearly separated
  alternative with the same button and divider on Sign in and Create account. In the prototype,
  `Continue with Google` opens a JobDeputy account chooser (never a copy of Google's interface)
  without any Google request.
- First-time and returning people take different paths. Creating an account (email or Google)
  leads to setup. Signing in (email, Google, or the one-tap card of a remembered browser) leads
  straight to the Dashboard, without setup and without replaying the opening loader. "Use another
  account" is the honest new-account branch to setup, and "Not you?" forgets the remembered
  browser. `?google=unavailable` keeps the provider-unavailable notice reviewable.
- Account creation and password recovery MUST remain separate route states rather than appearing
  as peer tabs. Create account leads with product value and collects only secure access plus home
  Region; profile identity is completed after access is established.
- The recovery-request state MUST contain only email and account home Region. New password and
  confirmation controls belong exclusively to the verified recovery-link state and MUST never
  flash or render in the request state.
- The verified-link state MUST validate its token before rendering password controls. Missing,
  invalid, expired, and already-consumed tokens MUST provide a path to request a fresh link.
- Account-access story panels MUST use the warm product canvas. Black campaign slabs, inverted
  identity marks, and oversized decorative logos are not part of the locked application language.
- Sign-in, account creation, recovery request, and verified-link password entry MUST reuse the same
  left-side story shell: identical split, copy anchor, panda stage, controls, progress treatment,
  responsive breakpoints, and complete deputy narrative from introduction through Search, Filter,
  Rank, user choice, tailoring, approval, and ongoing watch. Chapter order, timing, and initial
  state MUST remain identical; only the right-side account task changes between these routes.
- **Amended in round 7 (the owner's G1: "We are the first agentic platform in this job application
  market; brand it in our login screen").** The narrative is now the brand line and three steps,
  in place of the eleven chapters: the eyebrow "Agentic job applications", the line "You set it up.
  Your deputy applies." (story copy, not the page's `h1`), the lede "Agents already help you work.
  Now one finds roles, tailors your résumé, and applies for you, with your approval.", and the
  chapters **1 Set it up**, **2 It finds**, and **3 It applies**, each a short line with the tool of
  the moment in the deputy's right paw. The three steps form the strip under the stage, each a
  button, and replace the chapter bars. The story plays once and holds on its last step with
  Replay story; a saved Pause motion holds it on the first. The copy MUST NOT claim to be the
  world's first or any other unprovable superlative (the owner's choice). The shell, its geometry,
  and the rule that every entry route shares one story stay as above.
- On phones (`720px` and narrower) the form owns the first viewport: the story becomes a compact
  band above the form that keeps the animated panda and its reactions, folds into a slim strip
  while a field has focus, and opens the full story on request. The form heading and first field
  MUST be visible without scrolling at `390x844`, `375x667`, and `360x740`. Round 7 (G1): the band
  shows the brand line beside the panda, with the eyebrow above it from `360px` wide; the three
  steps show in the full story. On tablets in one column (`721px` to `880px`) the story is compact
  (the brand line beside the deputy, the three steps under both), so the form starts in the first
  view (T2-13).
- Account creation and password recovery omit the product footer to match sign-in. Trust links
  remain available from the product trust destination after entry rather than forming a second
  navigation surface below authentication.
- On account access, panda motion MAY acknowledge email, protect password entry, explain Region,
  and confirm pending, error, or success state. It MUST remain bounded, useful, text-equivalent,
  and reduced-motion safe.
- The capability story MUST pause while an account field has focus or while form feedback is active.
  Reduced-motion mode MUST not autoplay; the same previous, next, and play control becomes a manual
  chapter advance.
- Social sign-in controls MUST use recognizable accessible provider identity and MUST remain
  visually secondary to the page purpose.
- Home Region MUST be automatically suggested and treated as valid without requiring routine user
  confirmation.
- The selected home Region MUST remain visible in a compact summary with a `Change` disclosure for
  travelers or accounts created elsewhere.
- Expanded Region choices MUST use native radio semantics, full-width `44px` minimum rows, a
  visible selected state, keyboard focus, a `Done` path, and Escape-to-close behavior.
- Location copy MUST say “approximate location” rather than claiming precise IP detection.
- If a reliable suggestion is unavailable, the UI MUST identify the selection as a default rather
  than presenting it as detected.
- Pending authentication copy MUST emphasize the action, such as `Signing in…`, rather than making
  Region routing sound like the primary task.
- Browser autofill MUST retain the warm surface and readable text instead of showing clashing
  browser-yellow fields.

The Region change disclosure above applies only while establishing which account Region to sign
into. After authentication, Home Region is shown as locked account information.

**Signing the User Agreement in one step (amended in round 7, the owner's G3: "User agreement
signature should be very easy, like a button saying you have digitally signed, then go to the next
screen. Some animation to make it intuitive.").** Every path that signs (a new account by any door,
an updated version, Settings, Account, a held email move, setup's LinkedIn gate) uses the same one
step:

- One sentence says what a signature confirms (the version, that your deputy may act for you as it
  describes, and that JobDeputy keeps a permanent copy even after you delete your account), above
  one primary **Sign and continue** with **Not now** as the secondary action. The signer's name,
  email, the date, and the home Region show read only. There are no consent ticks and no typed
  name; the account's name is the signature.
- The full agreement stays readable on the page (what changed, the key points, the full text).
- Pressing it plays one short signing moment (about `1.2s`: the name writes on the signature line,
  a seal stamps with a check, and the deputy cheers with the pen), brought into view first, then
  the page goes on to setup, the page that sent you, or the Dashboard. The way on is a link from
  the first frame. With a mouse or touch the page goes on by itself after about `2s`, once a screen
  reader has said "Signed"; after a keyboard press it waits for Continue. Reduced motion and Pause
  motion show the signed state at once.
- A version is signed once (R9-7); the record keeps the version, its fingerprint, the name, the
  email, the time, the home Region, and the method (`one-step`), permanently. Back or a reload shows
  the signed record, never the form again.

## Onboarding

- After a first sign-up, onboarding (`onboarding-preview.html`) asks one question per screen in the
  entry header, with no sidebar or footer. The deputy scene asks each question. The answer uses
  large choice cards or quick picks with the one selected style, and the step progress sits in the
  header.
- Phone first: at `720px` and narrower the deputy becomes an `89px` row beside its line, the
  question and options follow, and Back and Continue stay in a sticky bar with safe-area padding
  that never covers the focused control (it rejoins the flow while a text field has focus). Every
  step's options and a reachable Continue fit the first viewport at `390x844`, `375x667`, and
  `360x740`.
- The questions are where to help (Finding roles, Tailoring résumés, Filling in applications
  (planned; it needs read-only Gmail access for one-time codes and status emails), Tracking
  applications), target roles, workplace, how often to look (When I ask, or Every night with Keep
  watch: 10 free nightly runs a month, then get more, planned), résumé, the first source, and the
  AI choice. Only questions whose answer the deputy uses are asked.
- Continue stays `aria-disabled` until a step is answered. Optional steps offer Skip, and every
  step offers Back. Each question explains why the deputy asks.
- Answers write the profile, the setup checklist, and the AI choice. Finish starts the first
  source's run and opens the Dashboard (`home-preview.html?skipLoader&state=new&from=onboarding`),
  where the first-run tour starts; when the run could not start (no free platform run left, or the
  key is not ready), the Dashboard says why and links to AI & credits. Skipping setup opens the
  honest first run, which asks for a first source. Help's Run setup again (`?rerun=1`) prefills the
  saved answers.

## Locked feedback and alert system

Every page MUST use the same feedback hierarchy so people can identify the affected task and a safe
next step without searching the page.

| Variant | Use | Treatment |
|---|---|---|
| `notice` | An option is temporarily unavailable or has a neutral constraint | Quiet rule, information icon, warm surface |
| `static information` | Persistent context needed before acting | Neutral surface near the related control |
| `warning` | A condition may affect the result but does not block progress yet | Orange rule and explicit preventive action |
| `validation` | One or more user-correctable details block submission | Orange rule, summary title, highlighted fields |
| `operation error` | An attempted operation failed | Orange rule, generic explanation, safe recovery |
| `success` | An operation completed | Green rule and concise next outcome |

- Field-specific feedback MUST remain directly connected to its field.
- Provider or control-specific feedback MUST appear immediately after the initiating control.
- Section-level feedback MUST appear beneath the section heading; form-wide feedback MUST appear
  near the beginning of the form.
- Toasts MUST be reserved for noncritical background outcomes. Blocking errors and recovery actions
  MUST remain visible in the task flow.
- A `FeedbackPanel` MUST contain an icon, short title, concise explanation, and a recovery action
  when a useful immediate action exists.
- Visible feedback MUST NOT also carry a live-region role by default. Reusable
  `StatusAnnouncement` channels MUST announce dynamic changes separately so repeated actions can be
  announced without duplicating focused content.
- Contextual notices MUST keep focus on the initiating control. A validation or operation-error
  summary MAY receive focus after submission so its title and recovery are read once.
- Dismissal MUST NOT be required for contextual or blocking feedback. Feedback SHOULD clear when
  the person begins the relevant recovery action or the state becomes stale.
- Copy MUST use the templates `[Option] isn’t available. [Alternative].`,
  `Check [one detail / N details] before continuing.`, and
  `We couldn’t [complete action]. [Safe recovery step].` when applicable.
- Copy MUST NOT use blame, raw technical details, account-enumerating authentication language,
  “Oops,” or an unexplained “Something went wrong.”
- Panels and actions MUST wrap without overflow at `320px`; every panel action MUST remain at least
  `44px` high.

## Provider model selection

- Own-key setup MUST use a provider-scoped searchable picker, never an unrestricted model-name
  field.
- The picker MUST show only the provider's allowlist and MUST reject a typed value that is not in
  it. The recommended model (the one JobDeputy tested: `gpt-5-mini` for OpenAI, Claude Haiku 4.5
  for Anthropic) comes first and is marked Recommended. Choosing any other current model of that
  provider MUST show "Larger models cost more per run on your key and can use more tokens. Results
  may differ from the model we tested." and ask for confirmation before saving.
- Change model on a saved key keeps the key; it never asks for the key again.
- The prototype currently exposes the established model for each supported provider. Production
  MUST source the allowlist from shared configuration and enforce the same values in the API.
- Changing provider MUST reset the model to that provider's tested default.

## Responsive and accessibility lock

- No supported viewport may introduce horizontal overflow, clipped controls, overlapping status,
  or unreadable copy.
- Required review widths are desktop, tablet at the two-column threshold, `390px`, and `320px`.
- Both short and tall mobile viewports MUST be tested.
- Interactive controls MUST be at least `44px` high.
- Focus MUST remain visible and use the approved green treatment.
- Persistent labels, semantic landmarks, native form controls, accessible names, and live text
  status MUST remain available independent of the panda.
- Disclosure content MUST be removed from keyboard navigation while collapsed.
- Color, icons, and motion MUST NOT be the only way meaning is communicated.
- Every new motion treatment MUST preserve a complete reduced-motion state.

## Foundation review checklist

Before a future page is considered complete, the implementer MUST confirm:

1. The canonical identity and compact header remain consistent.
2. The page declares the canonical `:root` block, matches the component contract, and passes
   `tests/prototype/ui-consistency.test.ts` and the rendered audit with no near-duplicate values.
3. The hierarchy follows editorial context → clear task → one primary action.
4. Panda presence communicates a named purpose rather than decoration; the deputy dock uses the
   page's work state and the page never draws a second panda.
5. Sample data carries the shared sample marker, and nothing claims a disconnected operation
   succeeded.
6. Loading and status patterns connect to the rest of the product.
7. Keyboard, focus, errors, autofill, reduced motion, and responsive widths are verified.
8. The new page does not modify a locked reference pattern without explicit approval.

## Locked references

- `brand/login-preview.html` — approved entry/authentication composition and interaction reference.
- `brand/preview.html` — approved standalone identity and golden-ratio presentation reference.
- `brand/jobdeputy-animated.svg` — approved animated identity.
- `brand/jobdeputy-mark.svg` — approved compact persistent identity.
- `brand/app-chrome.css`, `brand/app-components.css`, and `brand/deputy.css`: the shared shell,
  components, and deputy companion, with `brand/components-preview.html` and
  `brand/deputy-preview.html` as their references.
- `docs/design-system.md` — normative tokens, voice, motion, panda, accessibility rules, and the
  component contract.
- `docs/ui-consistency-audit.md` — cross-page consistency findings, resolutions, and verification.
- `agent-sops/build-jobdeputy-ui.sop.md` — required implementation and validation workflow.
