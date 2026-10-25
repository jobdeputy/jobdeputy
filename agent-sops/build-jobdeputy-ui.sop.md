# Build JobDeputy UI

## Overview

Use this SOP whenever creating or changing a JobDeputy web screen, component, loading state, form,
illustration, or product-facing message. It ensures every feature reuses the approved visual tokens,
locked composition, opening loader, panda teammate behavior, accessibility rules, and human-first
product voice.

## Parameters

- **feature_name** (required): Short name of the UI feature or screen, such as `login`, `profile`,
  or `crawl status`.
- **feature_scope** (required): User-visible behavior, states, and boundaries the change must cover.
- **target_files** (optional): Existing or planned file paths to inspect or modify.
- **reference_screen** (optional, default: `brand/login-preview.html`): Approved screen whose visual
  and interaction patterns are closest to the requested work.
- **verification_command** (optional, default: `pnpm verify`): Repository command required to
  validate the finished implementation.

**Constraints for parameter acquisition:**

- If all required parameters are already provided, You MUST proceed to the Steps
- If any required parameters are missing, You MUST ask for them before proceeding
- When asking for parameters, You MUST request all parameters in a single prompt
- When asking for parameters, You MUST use the exact parameter names as defined

## Steps

### 1. Load the product and design constraints

Read the project instructions and the design source of truth before inspecting implementation files.

**Constraints:**

- You MUST read `CLAUDE.md`, `docs/ui-foundation.md`, `docs/design-system.md`, and
  `docs/code-map.md`
- You MUST read the task file in `docs/tasks/` when the work belongs to an existing task
- You MUST read `reference_screen` and only the source files relevant to `feature_scope`
- You MUST NOT begin implementation before reading the required references because visual guesses
  cause inconsistent composition, identity, typography, color, motion, and copy; the required
  references are `docs/ui-foundation.md` and `docs/design-system.md`
- If `feature_scope` conflicts with the locked foundation, You MUST stop and request explicit user
  approval because agents are not authorized to silently redefine the product-wide baseline
- You MUST confirm that the task's Decision section is agreed before production implementation
- If the Decision is pending, You MAY build a clearly labeled prototype, but You MUST NOT wire it into production authentication because the architecture has not been approved

### 2. Inventory reusable patterns

Identify the approved tokens, components, and panda states that already satisfy the feature.

**Constraints:**

- You MUST search with `rg` for existing tokens, controls, loaders, and interaction states
- You MUST map the feature to the reusable interaction primitives in `docs/ui-foundation.md`
- You MUST reuse `brand/jobdeputy-animated.svg` for initial application loading
- You MUST reuse the panda-on-JD identity: `brand/jobdeputy-mark.svg` for compact persistent chrome
  and `brand/jobdeputy-animated.svg` for full-size brand motion
- You MUST map each requested panda behavior to a named state in `docs/design-system.md`; on
  signed-in pages, the deputy dock rests in the state that names the page's work and uses
  `JobDeputyDeputy.set` and `flash` for operations
- You MUST reuse the shared components in `brand/app-components.css` (see
  `brand/components-preview.html`) and MUST NOT restyle their selectors in a page
- You MUST read and write sample data through `brand/sample-store.js` so that every signed-in page
  stays in step, and mark sample surfaces with `.sample-note`
- You MUST reuse existing colors, font stacks, spacing values, radii, shadows, and motion curves
- You MUST copy the canonical `:root` block verbatim and implement shared components to the
  component contract in `docs/design-system.md`, because exact values keep pages identical
- You MUST NOT add a new visual token because a similar-looking value feels convenient; duplicate
  values make future screens drift apart
- If no approved token can satisfy a real requirement, You MUST update `docs/design-system.md` with
  the new semantic token and rationale before using it

### 3. Define the screen's human interaction

Write a compact implementation mapping from user events to visible UI and panda behavior.

**Constraints:**

- You MUST identify loading, empty, focused, success, error, and reduced-motion states when relevant
- You MUST classify each feedback state as field feedback, notice, static information, warning,
  validation, operation error, or success
- You MUST place feedback at the narrowest useful scope: field, initiating control, section, form,
  then page
- You MUST define the short title, explanation, safe recovery, focus behavior, and announcement
  priority for each dynamic feedback state
- You MUST state what the person controls and what JobDeputy will do
- You MUST keep panda speech concise, factual, and connected to the current action
- You MUST NOT use the panda as the only source of instructions or errors because animation and
  speech bubbles are supplementary accessibility content
- You SHOULD use motion to notice, explain, confirm, or protect
- You MUST NOT add ambient motion that competes with the person's primary task because it creates
  distraction instead of useful communication

### 4. Implement with approved primitives

Build the feature using the existing project stack and the patterns identified above.

**Constraints:**

- You MUST preserve the identity, header, page hierarchy, task surfaces, state language, and
  responsive behavior locked in `docs/ui-foundation.md`
- Internal product pages MUST reuse the shared app frame (sidebar, rail, and app bar), the
  `AppNav` and `DeputyDock` blocks unchanged apart from their per-page attributes, and the shared
  `AppFooter` navigation and home-Region context; entry pages MAY use its reduced signed-out variant
- A page with the deputy dock MUST NOT draw a second panda; empty states use prop-only deputy
  illustrations. The Dashboard's AI Boost panel is the one named exception, approved October 25,
  2026 (`docs/ui-foundation.md#ai-boost-round-8`): it lends the dock's panda while it shows, so one
  panda is still drawn per viewport
- Internal pages MUST also reuse the `HeaderActions` block (Feedback and Invite friends) and load
  `feedback.js` and then `app-panels.js` after `deputy.js`
- Every number, date, and list a signed-in page shows MUST come from `brand/sample-store.js` (the
  one sample world); you MUST NOT hardcode counts, job lists, or source totals in a page. Each
  figure carries `data-metric="<key>"` with the text of `JobDeputyStore.metricText(key)`, and a key
  appears once per page (the flow ribbon and nav badges aside), because the owner reads a repeated
  or disagreeing number as a broken product. The audit's `data.metric-matches` and
  `data.metric-once` checks (`scripts/ui-audit.mjs`) enforce it
- When two surfaces would show the same figure or split, you MUST merge them instead of repeating
  it, and every chart colour MUST carry a tooltip (name, count, meaning, where a click goes) and a
  touch key; fit and stage words and tones come from `JobDeputyStore.FITS` and `STAGES`
- Each completed action MUST call `JobDeputyDeputy.react(name)` once (added, dismissed, saved, sent,
  copied, archived, deleted, started, found, approved, submitted, celebrate, error), never also a
  success flash
- A page that runs an LLM task MUST offer See the prompt (`[data-prompt-open="<task id>"]`); a page
  with a tour marks its steps with `data-tour-step` and never starts the tour on a plain load
- Script-driven motion MUST stop when `html[data-motion="paused"]`; you MUST NOT hard-code a header
  offset, because the fixed chrome is taller on phones (read `scroll-padding-top` instead)
- Prices MUST come from the store (`PRICING`, `models()`, `shopItems()`) and carry "Sample prices ·
  nothing is charged"; AI credits show as tokens on the account's model; nothing says AI runs (round 5)
- An allowance meter shown as a block MUST be the shared ring meter, and its centre figure MUST NOT
  repeat in its key (round 4)
- A page MUST NOT offer an AI or model choice per source or per task: one AI setting runs every
  search, Keep watch check, and draft; state it once with Change to `ai-preview.html#ai` (round 4)
- Name the AI work Deputy Assist and the nightly searching Keep watch, with the unit (tokens of AI
  credits, nightly runs) next to every count (rounds 4 and 5)
- A capability that acts for the person, reads email, spends money, or imports data MUST ask for the
  current User Agreement in place (`requiresAgreement(feature)`) and come back; disabled controls MUST
  say why in visible text (round 5)
- A running search MUST show its time counting up through the shared run tracker, never time left,
  and its ticking time MUST NOT be a live region (round 4)
- Donations MUST be an interest only, with no amount (round 4)
- You MUST lead each section with a figure (a number, chart, ring, status, or icon) and at most one
  supporting line; explanations go in a disclosure or the Help centre. Charts and tiles that show a
  number MUST link to the page and filter behind it, with a keyboard path and an accessible name
- Choice controls MUST use the shared controls and their one selected style, never a page-made
  selected state
- You MUST use the typography, color, spacing, shape, and motion values from
  `docs/design-system.md`
- You MUST use `brand/jobdeputy-mark.svg` for persistent headers or navigation when the full lockup
  is too tall to remain legible
- You MUST use the animated JD logo only for initial app or authentication bootstrap, onboarding,
  or a dedicated brand presentation with bounded or user-controlled replay
- You MUST provide a bounded failure-safe for every blocking loading state
- You MUST implement panda states as named CSS classes or component variants, not anonymous
  one-off keyframes, because other features need to reuse and test the behavior
- You MUST preserve visible labels, keyboard operation, focus indication, and semantic landmarks
- You MUST preserve the home-Region explanation on authentication screens
- You MUST use the compact automatic home-Region summary and optional accessible `Change`
  disclosure on authentication screens
- You MUST use the locked `FeedbackPanel`, `FieldFeedback`, and `StatusAnnouncement` responsibilities
  for visible and announced feedback
- You MUST place provider- or control-specific feedback immediately after the initiating control
- You MUST NOT put contextual feedback in a distant generic status line because people may not
  understand which action caused it
- You MUST keep contextual-notice focus on its trigger and focus a validation or operation-error
  summary only when the submission result needs one clear announcement
- You MUST keep visible dynamic panels separate from permanent visually hidden live regions unless
  a semantic exception is documented, because duplicate live and focus announcements create noise
- You MUST NOT create a page-specific replacement for a foundation primitive because near-duplicate
  patterns make future screens feel disconnected
- You MUST NOT connect a prototype form to real credentials or external systems because prototypes
  are not authorized for production integration unless `feature_scope` explicitly says otherwise

### 5. Verify accessibility and motion

Validate that the feature remains complete without animation and works through keyboard interaction.

**Constraints:**

- You MUST test `prefers-reduced-motion: reduce`
- You MUST verify every field has a persistent label and every control has an accessible name
- You MUST verify color is not the only way status is communicated
- You MUST verify content remains readable at mobile and desktop widths
- You MUST verify the page's main task is in the first viewport at `390x844`, `375x667`, and
  `360x740` (`node scripts/ui-audit.mjs --firstview`), and that a sticky bar never covers the
  focused element
- You MUST check tablets (`768x1024`, `820x1180`, `1024x768`) for stretched single columns
- You MUST verify loading, success, and error states cannot trap keyboard or screen-reader users
- You MUST verify contextual feedback appears beside its trigger, repeat activation is announced,
  and any recovery action moves focus only when its label promises that move
- You MUST verify validation and operation-error summaries are announced once without competing
  live regions
- You MUST verify feedback panels and their actions wrap without overflow at `320px`
- You MUST check every page you change at a desktop, a tablet, and a phone size for: every control
  named in the accessibility tree, focus never hidden under the fixed chrome during a full Tab
  pass, no live region that changes more than once a second, and WCAG 1.4.12 text spacing without
  overflow or clipping (round 4)
- If any required accessibility behavior fails, You MUST fix it before proceeding

### 6. Run deterministic and visual verification

Run repository checks and inspect rendered output.

**Constraints:**

- You MUST run `verification_command`
- You MUST run `git diff --check`
- You MUST confirm `tests/prototype/ui-consistency.test.ts` passes and `node scripts/ui-audit.mjs
  --parity` (see `docs/ui-consistency-audit.md`) reports no failing checks at 1440, 1024, 768, 390,
  and 320 pixels; without a local server, set
  `JD_BASE=file:///<repo>/brand/` so the audit loads the files directly
- For signed-in pages, You MUST also run the audit with `--focus` and check the rail (1024) and the
  phone Menu (390 and 320)
- You MUST render or open the feature at desktop and mobile widths
- You MUST inspect the completed animation state, not only its first frame
- You MUST compare the rendered result with `docs/ui-foundation.md`, `docs/design-system.md`, and
  `reference_screen`
- If a check fails because the local environment is missing dependencies, You MUST run the closest
  available file-level validator and report the unrun check accurately
- You MUST NOT claim the full repository passed when only a file-level check ran because reviewers
  need precise test evidence

### 7. Update project guidance

Keep discovery and reuse documentation synchronized with the implementation.

**Constraints:**

- You MUST update `docs/code-map.md` when adding, moving, or splitting source files
- You MUST update `docs/design-system.md` when introducing an approved new pattern or token
- You MUST update `docs/ui-foundation.md` only when the user explicitly approves a foundation
  change, because this file is a locked cross-page contract
- You SHOULD update `brand/README.md` when changing a reference prototype
- You MUST record screenshots or a short recording for production UI pull requests
- You MUST report changed files, validation performed, and any remaining prototype-only behavior

## Examples

### Example 1: Login screen prototype

**Input:**

- feature_name: `login`
- feature_scope: `Email, password, home-Region choice, opening loader, and panda field reactions`
- reference_screen: `brand/login-preview.html`

**Expected behavior:**
The agent uses the JD loader, warm paper canvas, serif narrative headings, sans-serif controls, green
focus states, home-Region explanation, and named panda states. The form remains disconnected from
Cognito until the T09 authentication decision is agreed.

### Example 2: Crawl status screen

**Input:**

- feature_name: `crawl status`
- feature_scope: `Queued, running, partial, succeeded, and failed states`

**Expected behavior:**
The agent does not replay the JD opening loader during polling. The panda notices meaningful state
changes, communicates what is happening in plain language, and uses a calm recovery state for
failures. Operational status remains visible as text independent of the panda.

## Troubleshooting

### The new screen looks close but not consistent

Compare its shell and hierarchy with `docs/ui-foundation.md`, then compare every color, font,
spacing value, radius, shadow, and duration with `docs/design-system.md`. Replace page-specific
alternatives and near-duplicate values with the documented foundation primitive and token.

### A feature appears to require changing the locked foundation

Stop implementation and explain the exact conflict to the user. Do not modify the foundation or
reference screen until the user explicitly approves that product-wide change.

### The panda feels decorative

Remove motion that does not communicate notice, protection, explanation, confirmation, or recovery.
Map the remaining behavior to a named panda state.

### The loader makes navigation feel slow

Limit the animated JD loader to initial application or authentication bootstrap. Use an inline
progress state for later navigation.

### Feedback is visible but feels disconnected from the action

Move it to the narrowest useful scope and use the locked `FeedbackPanel`. Keep provider or
control-specific notices immediately after their trigger, include one safe recovery when available,
and announce the update through the shared `StatusAnnouncement` channel. Do not duplicate the same
message in a generic form status line.

### Full verification cannot run

Run the closest file-level formatter, parser, and visual render. Report exactly which full command
could not run and why; do not represent partial checks as the full suite.
