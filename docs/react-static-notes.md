# React static development notes

**Status:** notes only (round 7, October 7, 2026), on the owner's L2 ask: "Take notes for React
static development (before the backend): different logins, new user, small account and large
account at minimum, also some non-happy paths if possible. Don't create React code until the design
is approved." No React code is written or planned until the owner approves the design. These notes
are for the build that comes after this design.

**What "React static" means here:** the screens of the brand prototypes rebuilt in `apps/web`
(React, Vite, and TanStack Query, as the stack in `CLAUDE.md` says), fed by fixtures instead of the
API, before the backend exists. Today the prototypes read one sample world from
`brand/sample-store.js` (`window.JobDeputyStore`); its API and data shapes are the contract the
fixtures answer, and `tests/prototype/sample-store.test.ts` is their executable description. The
sample clock is fixed: Fri, Oct 2, 2026, 14:00 Pacific (the fixtures should be too, so every date
and "lasts through" reads the same in every run).

## 1. Fixture accounts as logins

The same person, Alex Morgan (`alex.morgan@example.com`), in three fixture worlds, each chosen as a
login. Today the prototype switches worlds with `?demo=large` and `?demo=usual` (saved apart:
`jobdeputy.sample.v3` and `jobdeputy.sample.v3.large3`), and a new account starts from Create
account; in React static, each is an entry in the sign-in screen's account chooser.

| Login | Today in the prototype | What it must show |
|---|---|---|
| **New user** | Create account by any door (`access-preview.html?mode=create`), the one-step agreement (`agreement-preview.html?mode=new&via=<door>`), setup (`onboarding-preview.html`), then the first run (`home-preview.html?skipLoader&state=new`) | No sources yet ("Add your first source"), nothing found, no applications, no receipts, an empty Activity, the setup steps left as To-do items, the 10 free runs of the month, and the first-run tour. Setup's Skip the rest and Finish both land here |
| **Small** (the usual sample) | Sign in as Alex (`login-preview.html`, then `home-preview.html`); `?demo=usual` | 16 active sources (Google and Microsoft watched nightly), 27 found roles (20 to review, 2 not for me), 8 applications (7 active, 1 closed; 3 need you), agreement 2026.10 **unsigned** (so email moves wait), your OpenAI key with gpt-5-mini and a 250,000-token monthly limit that pauses AI work, 4 of 10 runs left (through Sat, Oct 3), Gmail connected since Mon, Sep 28, the daily email off, auto approve off, and nothing ever bought |
| **Large** | `?demo=large` on any page, or Help, Demos, See a large account | 124 sources across 118 companies (30 watched), 1,008 found roles (963 to review), 46 applications, 95 drafts across 58 companies, 123 of 192 runs left, a 400,000-token daily limit that falls back to platform credits, a live tailoring queue, the daily email subscribed since Sun, Sep 20 (12 sent), 5 auto approvals, 13 receipts (2 refunded), and over 1,500 Activity entries in the last 30 days |

Each fixture keeps its own saved state (the round 6 lesson: the AI setting once leaked between the
two samples), and switching back returns exactly its own figures.

## 2. The non-happy paths to build as fixtures

Each path below is a fixture state the screens must render and recover from. Where the prototype
already shows it, the words and the store's answer are the reference; the last rows are not in the
prototype yet and need their design first.

| Path | How the prototype shows it today | What the fixture must answer |
|---|---|---|
| **Out of runs** | `runs.left` 0: Run again and new searches are off with the reason, Keep watch skips its check and says so, Scan now is refused, and Get more runs goes to Purchases (`shop-preview.html#buy`) | `allowance().runs`, `runway()` (`lastsText` "No runs left this month"), and the refusal `{ ok: false, reason: 'no-runs', text: 'No runs are left this month. Get more runs, or wait for Sun, Nov 1.', action: 'Get more runs', href, refreshesOn }` from `gmailScan()` and the run calls |
| **A key's limit reached, and the fallback** | With "Pause AI work" (the usual sample's limit) AI work pauses and a refused run says why and when the limit resets; with "Use platform credits" (the large account's) the rest of the day runs on Ministral 3 14B, marked as a fallback day in Usage and the charts | `aiLimit()` per key in use (`key`, `byKey`), `usageSettings()` fallback items with their `line` ("Your OpenAI key reached its daily limit at 11:30, so Ministral 3 14B on platform credits ran until the limit reset at 17:00"), and `runway().tokens` |
| **A key rejected** | A key whose check fails reads "Needs attention · replace the key" (`ai-preview.html?keycheck=invalid` makes the next check fail, to review it) | The key's `status: 'invalid'`; the AI setting can't name it while invalid (the API's own rule) |
| **Gmail disconnected** | After Disconnect: the Gmail cards say so with Connect Gmail, Scan now and Sync from Gmail are refused, and moves already read still wait for your signature | `gmailScans()` with `connected: false`, `last: null`, `next: null`, `scanNow.available: false`, and the refusal `reason: 'gmail-not-connected'` ("Connect Gmail so your deputy can read job emails.") |
| **Gmail expired** | Not in the prototype | Design first: the same refusal with its own reason and a Reconnect action |
| **A source failing** | The usual sample's Acme source: "Stopped Sep 28: The page took too long to load", with Retry, and a To-do item | A run with `error { code, message }` (here `timeout`) and the source's needs-attention state (`sources.attention`) |
| **The agreement unsigned** | 2026.10 pending on the usual sample: the To-do leads with Review and sign; email moves wait (R9-12: "It moves to Interviewing once you sign"), Sync moves nothing and says how many cards will move, an apply job waits at its first stage, and tailoring or drafting is refused (`agreement-required`); past the pause date every page shows "Your deputy is paused until you sign the updated agreement" (Help's overdue demo) | `agreements()` (pending version, `paused`), `needYou()` reasons `email-waits`, `startTailoring()` failures `agreement-required` and `ai-paused`, `sign()` once per version (`already-signed`) |
| **A payment refunded** | The large account's receipts JD-2026-0007 and one runs pack: "Refunded" with the date and reason, the tax refunded too, and totals for paid and refunded | `receipts()` rows with `status: 'refunded'`, `refundedAt`, `refundReason`; `receipt(id)` notes |
| **A payment failed** | Not in the prototype (checkout always succeeds; "Nothing is charged") | Design first: the checkout's operation error, nothing added, a safe retry |
| **Empty states** | Receipts: "No payments yet. When you buy runs or AI credits, each receipt is kept here, ready to download."; Activity: "Nothing matches these filters." with Clear; a prompt with no runs: "No runs"; the new user's Dashboard, Job matches, and Applications | Empty lists and `null` figures, said in words (R9-4: never a dash) |
| **Huge data** | The large account on every page | Paged queries (`activityLog({ page, size })`, `receipts({ page, size })`), top N plus Other (`topWithOther`, `seeAll`), and facet counts with the other filters applied |
| **Slow network** | Not in the prototype (the store answers at once); the skeletons and the boot hold are the pattern | Fixture delays per query, so each region shows its skeleton of the final size and reveals once; the deputy says "Gathering your numbers." past 400 ms |
| **Offline** | Not in the prototype | Design first: what still shows (the last figures, said as of when) and what is off (searches, scans, buying), with its reason |

## 3. What each screen reads from the store

The prototype's store calls by screen (the fixtures answer the same shapes). Shared parts read for
themselves on every page: the nav badge (`apps.needYou`), the flow ribbon (`flowCounts()`), the
footer's Region (`homeRegion()`), the deputy's Activity (`activity()`), the pause banner
(`agreements().paused`), the prompt summary (`promptsOverview()` and `usage({ range: '30d' })`),
and the rings and runway line (`runway()`, `allowance()`). Every figure on a page is a
`metricText(key)` with its `data-metric` key.

| Screen | Reads | Writes |
|---|---|---|
| Sign in, Create account | The remembered account (`localStorage['jobdeputy.lastAccount']`) and `homeRegion()` | None until the agreement |
| The agreement | `agreements()`, `homeRegion()`, `JobDeputyAgreementText` (the versions, `sentence()`, `signedCopy()`) | `sign()` |
| Setup | `get()`, `models()`, `setupTodos()`, `requiresAgreement()`, `linkedinImport()` | `update()`, `addSource()`, `updateSource()`, `startRun()`, `skipSetup()`, `completeSetupStep()`, `setAiChoice()` |
| Dashboard | `catalog()`, `runs()` and `run()` (the search status), `allowance()`, `runway()`, `runsLedger({ range })`, `gmailScans()`, `gmailSync()`, `usage({ range, group })` and its `settings`, `promptsOverview()`, `promptTests()`, `keywordStats({ role })`, `seeAll()`, `todo()`, `updates()`, `agreements()`, `aiChoice()`, `summarySubscription()`; metrics `apps.auto.*`, `apps.needYou`, `apps.outcome.*`, `activity.week.*`, `jobs.*`, `runs.*`, `tokens.*` | `gmailScan()`, `setSummarySubscription()`, `markUpdateRead()` |
| The sample daily email | `summaryEmail({ date })` | None |
| Searches | `catalog()`, `source()`, `runs()`, `run()`, `newRolesSeries()`, `allowance()`, `aiLimit()`, `credits()`, `aiChoice()`, `seeAll('sources')`; metrics `sources.*`, `jobs.new.source.<id>` | `startRun()`, `retryRun()`, `stopRun()`, `addSource()`, `updateSource()`, `archiveSource()`, `restoreSource()`, `deleteSource()` |
| Job matches | `catalog()`, `job()`, `run()`, `source()`, `liveRun()`, `keywordStats()`, `newRolesSeries()`, `seeAll()`; metrics `jobs.toReview`, `jobs.notForMe`, `jobs.foundToday`, `jobs.foundWeek` | `addToApplications()`, `undoAddToApplications()`, `notForMe()`, `undoNotForMe()` |
| Applications | `get()`, `application()`, `provenance()`, `needYou()`, `tailorJob()`, `tailorQueue()` (`laneOrder`), `applyJob()`, `review()`, `drafts()`, `gmailScans()`, `gmailSync()`, `mailEvents()`, `mailWatch()`, `applyRules()`, `agreements()`, `runway()` | `startTailoring()`, `stopTailoring()`, `approveAndApply()`, `answerApplyQuestion()`, `moveApplication()`, `addApplication()`, `gmailScan()`, `undoMailEvent()`, `ignoreMailEvent()`, `draftReply()`, `setApplyRules()`, `resetApplyRules()` |
| Autofill | `application()`, `applyJob()`, `siteFor()`, `review()` | `answerApplyQuestion()`, `submitApplyJob()`, `createSiteAccount()` |
| Résumés | `drafts()`, `templates()`, `keywordStats({ role })`, `seeAll('keywords', { role })`, `readinessGaps({ role })` | `setDefaultDocument()`, `setPageLimit()`, `addTemplate()`, `removeTemplate()`, `draftFromAnswers()`, `acceptDraftLine()` |
| Materials | `drafts()`, `draftMaterials()`, `review()`, `applyJob()`, `agreements()`, `aiChoice()`, `aiLimit()`, `credits()` | `approve()`, `approveAndApply()`, `setDraftTemplate()` |
| Profile (locked) | `get()`, `fieldStatus()`, `discoveredFields()`, `homeRegion()` | `update()`, `saveDiscoveredField()`, `setSelfId()` |
| Account | `agreements()`, `homeRegion()`, `summarySubscription()`, `applyRules()` (Email me when my deputy applies) | `setSummarySubscription()`, `setApplyRules()` |
| Connections | `connections()`, `gmailScans()`, `gmailSync()`, `mailWatch()`, `siteAccounts()`, `vaultLog()`, `linkedinImport()`, `requiresAgreement()` | `gmailScan()`, `connectGmail()`, `disconnectGmail()`, `connectLinkedin()`, `applyLinkedinImport()`, `revealSitePassword()`, `removeSiteAccount()` |
| Prompts | `promptTests()`, `prompt(id)` (the full control), `promptVersionModels(id)`, `promptBurn(id)`, `usage()` (what ran them), `rolloutSettings()`, `rollbacks()`, `aiChoice()` | `testPrompt()`, `usePromptVersion()`, `savePromptDraft()`, `rollback()`, `setRolloutSettings()`, `restorePrompt()`, `resetPrompt()` |
| AI & credits | `aiChoice()`, `aiLimit()`, `credits()`, `models()`, `get()` (the keys) | `setAiChoice()`, `setAiLimit()`, `setPlatformModel()` |
| Usage | `usage({ range, from, to, step, group, filter })` (`buckets`, `groups`, `totals`, `permutations`, `facets`, `settings`), `runsLedger({ range })`, `runway()`, `USAGE_RANGES`, `usageStep()` | None |
| Purchases | `allowance()`, `runway()`, `credits()`, `shopItems()` (each pack's `runway`), `receipts({ range, kind, status, q, page, size })`, `receipt(id)`, `purchases()` | `buy()` (adds a receipt), `pledgeSupport()`, `withdrawSupport()` |
| Activity | `activityLog({ who, area, range, from, to, q, page, size })` (`rows`, `total`, `facets`), `activityLogCsv(query)`; metrics `activity.last30.*` | None |
| Help | `scaleDemo()`, `guides()`, `guide()`, `agreements()`, the answers' metrics | `setScaleDemo()`, `reset()`, `setAgreementDemo()` |

Events: a write that changes something tells `subscribe(listener)` once, with `change.type` (for
example `gmail-scan`, `summary-email`, `queue`, `tailor-job`), `change.areas` (what it touched), and
`change.progress` for a live work tick that saves nothing. In React these become query invalidations
by area, never a refetch of everything on a tick.

## 4. The patterns React must keep

- **Boot without flicker (R10-1).** The first view renders with its data before the first paint
  (fixtures answer synchronously); anything that arrives later waits behind a skeleton of its final
  size, and every held region reveals in one frame. Nothing is drawn twice, and the dock, the flow
  ribbon, the nav badge, and the footer are right in the first frame.
- **The budgets (R10-10).** Every screen, every fixture, at 1440, 1024, 768, 390, and 320: layout
  shift at most 0.02 after the first paint, no task over 200 ms (split heavy renders and yield),
  the first view within 1 s. The prototype's audit (`scripts/ui-audit.mjs`, `perf.budgets`, touch
  below 1024px) is the bar to meet.
- **Morph in place (R9-3).** A part that updates while you look changes text and attributes in
  place: stable keys on every list row, never a remount of a focused control, focus returned by a
  stable key when a control must be drawn again, and a form with unsaved edits never overwritten by
  a refetch.
- **One home per thing (R10-3).** Each fact is edited at its home (the table in
  [design-system.md](design-system.md#shared-patterns-round-7)); elsewhere a read-only summary and
  one link that carries `return=`. The home shows Back to \<page>, and coming back restores the
  scroll, the open panels, the filters, the chosen item, and focus. `return=` names only a route of
  the app.
- **The address is the state (R10-6, R10-7).** A list's page and size, its filters, a time range, a
  grouping, a keyword role, and an open drawer live in the address, written with replace (not push,
  so Back leaves the page instead of stepping through filters), and read back on load.
- **One component for each shared thing:** the prompt summary (one window, the name as its only
  link), the pagination with both pagers, the live filter bar, the time range picker, the rings and
  runway line, and the switch, with the same words and spacing on every screen.
- **Everything is runs or tokens (R10-9):** every control that spends a run says so before you press
  it ("uses 1 run").
- **The rules that carry over:** each figure once per screen, from the store, with its key; top N
  plus Other and See all for lists that grow; a link to something missing says so (R9-2); empty
  values read a word (R9-4); the home Region everywhere (R9-6); reduced motion and the dock's Pause
  motion stop every animation; one panda per viewport; Sample data labels until the data is real.

## 5. Backend notes for later

Notes for the design after this one, not decisions: each needs its task, a decision record for any
new table or key ([0006](decisions/0006-data-model.md)), and its lines in
[data-model.md](data-model.md), within the cost guardrails
([0005](decisions/0005-pre-launch-cost-guardrails.md)).

- **Usage rollups.** Usage answers any range from 1 hour to all time, grouped and filtered by key,
  model, task, prompt version, and payer (your key, platform credits, or included in a run). Keep
  rollups **per hour and per day for each dimension** (key, model, task, prompt, payer), with calls,
  input and output tokens, cost, seconds, and kept and decided counts, written in the same
  transaction as the call's result (as the `usage` table's monthly `AI#<month>#...` items are
  today), so a query reads a bounded set of buckets instead of every call. Hourly buckets can expire
  after the longest hourly range (3 days today) plus a margin; daily ones live with the account. The
  key x model x task combinations need their own rollup, or a bounded read of the daily buckets.
  Days are the home Region's local days in the views, while a key's daily limit counts the
  provider's day (UTC): store both, or store hours and roll the day up in the view.
- **The runs ledger.** One entry per run used: when, what used it (a search you started, a Keep
  watch check of one source, a Gmail scan, a daily email), by whom (you or your deputy), its source,
  run, scan, or email, and what paid for it (the month's free runs first, then the oldest bought
  pack, a refund taking back what its pack had left). The runway (how long runs and tokens last at
  your settings, what uses them each day, the first use they can't cover) is computed from it and
  the schedule of what is enabled; it never needs storing.
- **The activity log with who.** The `audit` table already records `actor` (`user`, `system`, or
  `automation`); Activity's who maps to it (You, JobDeputy, and Your deputy), plus an area, a short
  text, and a link to the thing, in the same transaction as the action. Activity filters by who,
  area, range, and words with facet counts, and exports every match as CSV, so it needs an index or
  rollup per who and area by day, and a paged query; its "All time" outlasts the table's one-year
  `ttl`, which is a decision to make.
- **Receipts.** One receipt per payment: a number counting up within each year, the item, amount,
  tax (the rate and the place), total, the method, the status (paid or refunded, with when and why),
  and the purchase it paid for; receipts are kept with the payment records the law requires (the
  agreement's text already says payment records for tax outlive account deletion), and each is
  printable.
