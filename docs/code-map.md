# Code map

Where each part of the code lives, so you can open the right file instead of searching. Read this first. **Update it in the same PR** when you add, move, or split a source file (`infra/test/docs-code-map.test.ts` fails otherwise).

How the parts connect at run time, with sequence diagrams: [docs/flows/](flows/crawl.md) (crawl, relevance).

Tests mirror the source: `apps/<app>/test/<name>.test.ts`, `packages/<pkg>/test/`, `infra/test/`, and deployed tests in `tests/integration/src/`.

## Common changes

| To change… | Edit |
|---|---|
| Where the web app is served, its security headers (CSP), its `/config.json` (sign-in IDs, API address), or the origins it may call | `infra/config/web.ts`, `infra/lib/web-stack.ts` (the US cell writes them to SSM, `webSignInParameter` and `webConnectParameter` in `infra/lib/cell-stack.ts`; the web stack reads them at deploy time; the cell's API and documents bucket answer CORS for the site's origin, `siteOrigin`) |
| A table, grant, route, queue, Lambda, or alarm | `infra/lib/cell-stack.ts` (constructs in `infra/lib/constructs/`); guard tests in `infra/test/` |
| An API route's behaviour | `apps/api/src/<feature>.ts` (`route()` switches on `routeKey`); the route must also be added in `cell-stack.ts` |
| Request validation or shared limits | `packages/shared/src/<feature>.ts` (Zod schemas, limits, error codes) |
| How an item is read or written | `packages/db/src/<feature>-repository.ts`; every transaction goes through `transact.ts` |
| What a crawl fetches or refuses | `apps/worker/src/fetch/` |
| How jobs are read from a page or board | `apps/worker/src/jobs/` |
| Which crawled jobs are kept or shown, and why | `apps/worker/src/relevance/` (the code filter, the per-company limit), `apps/worker/src/relevance-worker.ts` (the LLM score, T08d) |
| UI colours, fonts, and motion | `apps/web/src/styles/tokens.css`, Tailwind's theme (carried over from the round 7 prototype, which stays in the archive repo; [0012](decisions/0012-web-ui-styling-and-testing.md)) |
| Words the UI shows | `apps/web/src/copy/en.ts`, read through `@/copy/index.ts` (never inline in components) |
| Item attributes | the repository **and** `docs/data-model.md` (with a change-log line) |
| CI permissions | `infra/lib/cicd-stack.ts` |
| An LLM task, its prompt, or its limits | `packages/llm/src/tasks/<task>.ts` (raise its `version`, add it to `TASKS`); eval cases in `packages/llm/eval/cases/`, `eval/versions.json`, baseline in `eval/baselines/` |

## apps/web: the web app (React, Vite, TanStack Query, Tailwind, shadcn/ui)

The public landing page so far (#14); screens come one at a time. Runs with `pnpm --filter @jobdeputy/web dev`. Styling and testing choices: [0012](decisions/0012-web-ui-styling-and-testing.md).

| File | Role |
|---|---|
| `index.html` (in `apps/web/`) | the page: links the stylesheet (so it blocks the first paint, in dev too) and holds the boot loader's markup, which shows before any script runs (an 8 s reload offer and a no-JavaScript line included); its words are `{{copy.boot.*}}` slots |
| `html-copy.ts` (in `apps/web/`) | the Vite plugin that fills an HTML page's `{{copy.<path>}}` slots from `en.ts`, escaped; an unknown slot fails the build |
| `main.tsx` | mounts the app inside `StrictMode` and the TanStack Query client |
| `App.tsx` | the app's root component: it checks the session (the boot loader waits for it), then shows the landing page or the signed-in page; owns the auth drawer's open state and returns focus to whichever button opened it |
| `components/landing/` | the landing page: `site-header.tsx` (sticky bar), `hero.tsx` (copy, ways in, layout), `story-stage.tsx` (the deputy (`deputy/panda.tsx`) on the story's current step: his pose and tool, his line, his status, and the step's props; the story controls at its bottom left), `story-strip.tsx` (the three steps), `auth-drawer.tsx` (the sign-in / sign-up drawer, holding `components/auth/`); `use-story.ts` (`useStory`: the story plays each step once by itself (1 s + 240 ms a word), then holds; pause, replay, choose a step; under reduced motion it only advances when asked), `story-controls.tsx` (back, play / pause / replay, forward, and the "Step 2 of 3" read-out), `story-props.tsx` (each step's props beside the deputy: the setup card ticking in, the search map with its sweeping pulse, the application flying to the portal); the strip's steps are buttons that show their chapter, and the current one's bar fills over the time its step plays (held on Pause); that bar is the story's clock (a Web Animation: play, pause, finish): when it is full, the next step comes on |
| `copy/index.ts`, `copy/en.ts` | every word the UI shows, plus `OnePer` (`index.ts`) for data paired one-to-one with a copy list, such as each step's icon; `Copy` keeps lists fixed-length, so a mismatch fails typecheck. Components import `copy` from `@/copy/index.ts` (Biome blocks importing `en.ts` directly); `en.ts` holds the English, and a future language adds a sibling typed as `Copy` |
| `components/ui/` | shadcn/ui components, restyled to the prototype (`button.tsx`: the pill buttons, with `pending` and `success` states; `sheet.tsx`: the right-hand drawer; `spinner.tsx`: the small turning ring; `progress.tsx`: a labelled progress bar, known or unknown length, reading out each quarter; `skeleton.tsx`: placeholder shapes (block, lines, rows, cards, chart) that keep a region's size; `query-region.tsx`: `QueryRegion`, a region filled by a TanStack query, with the first-load skeleton, the quiet "Updating…" refresh, and the hand-off to an error built in). Loading states (#17) live here: screens never hand-roll a spinner. Add more with `pnpm dlx shadcn@4.23.0 add <name>` from `apps/web`, then match them to the prototype |
| `lib/scroll-lock.ts` | `keepScrollLock` (started in `main.tsx`): keeps Radix's scroll lock working under the site's CSP, which blocks the `<style>` Radix injects; it measures the scrollbar and marks `<body>` for the rule in `styles/base.css` |
| `lib/use-reduced-motion.ts` | `useReducedMotion`: whether reduced motion is asked for, following changes |
| `lib/use-delayed-pending.ts` | `useDelayedPending`: the timing every loading state shares (nothing for the first 300 ms, then at least 500 ms); `useLongWait`: true once a wait passes 8 s ("Still working…") |
| `components/auth/` | sign-in and sign-up (#14 slice 2): `auth-panel.tsx` (the drawer's steps: sign in, create an account, the emailed 6-digit code, forgotten password and its code; checks fields first, focuses the first wrong one, shows the server's refusal in plain words), `fields.tsx` (`Field`, `PasswordField` with Show/Hide, `TextAreaField`), `sign-out-button.tsx` (Sign out, its wait read out, its failure said) |
| `components/setup/` | the guided set-up after the first sign-in (#33): `set-up.tsx` (`SetUp`: each step's frame, the deputy beside the step and the step bar in the header, and the welcome: signed in as, home Region), `step-you.tsx` (step 1: first and last name, city; saved through `profile/profile-form.tsx`), `step-roles.tsx` (step 2: target role titles, with `profile/roles-form.tsx`'s editor and Continue/Back), `step-resume.tsx` (step 3, optional: one résumé, dropped or chosen, checked here (PDF or DOCX, 5 MB), started with `POST /me/documents`, sent to its presigned form with progress, then followed every 2 s while the server checks it for malware and reads it; Remove to change it; the deputy works beside it meanwhile), `parts.tsx` (`StepIntro`, `Fact`, `refusalText`: the refusals every step words the same; `useSaying`: a step's status line; `LoadFailed`); `App.tsx` keeps which step is on |
| `components/signed-in-layout.tsx`, `components/header-aside.tsx` | the frame of every signed-in page: the brand, what the page puts there with `HeaderAside` (a portal, so it shows exactly while the page does), Sign out (always there, so loading or failing never traps anyone), and the page's `main` |
| `components/app-shell.tsx`, `lib/router.ts`, `components/profile/`, `components/page-intro.tsx`, `components/icons.tsx` | the app's pages once the set-up is done (#33): `AppNav` (the sidebar's page list, only pages that exist; across the top on phones; the current page marked; `SignedInLayout` places it beside `main`), `router.ts` (`usePath`, `navigate`, `followLink`: real URLs through the History API, any other path goes to `/profile` in `App.tsx`), `profile-page.tsx` (`ProfilePage`: About you's saved details in the prototype's groups, Not added for the rest; each group's Edit opens its form in place, Save or Cancel goes back), `profile-form.tsx` (`useProfileForm`: a form over part of the profile, shared with set-up step 1: checked with the API's schema, saved with `PUT /me/profile` keeping the rest, a lost or out-of-date save compared with what is saved), `roles-form.tsx` (`RolesForm`: target role titles, typed or picked as chips, up to 10; saving removes the dropped roles, then adds the new ones through `/me/roles`; roles changed elsewhere are taken in, never removed unseen; shared by set-up step 2 and the page's Job preferences → Target roles group), `fields.ts` (the About you fields: how each reads, is named when wrong, and is put back; `https://` added to typed addresses); `App.tsx` sends an unknown path to `/profile` on arrival and names the tab; `page-intro.tsx` (`PageIntro`, shared with the set-up's `StepIntro`), `icons.tsx` (shared line icons) |
| `components/brand-mark.tsx` | the logo mark and wordmark (the landing header and the signed-in layout's header) |
| `lib/auth/` | authentication behind our own `Auth` interface (`types.ts`, with plain-language error kinds): `amplify.ts` (Cognito through Amplify Auth v6, loaded only when needed; its config from `lib/config.ts`; `accessToken()` for the API), `fake.ts` (in-memory accounts for the test build only), `index.ts` (`appAuth`, `AuthContext`, `useAuth`) |
| `lib/live-region.ts` | `LIVE_REGION_BEAT_MS`: how far apart live-region updates are made so each is read on its own (DeputyWorking, the set-up's steps) |
| `lib/config.ts` | `readConfig`: the deployed app's `/config.json` (sign-in IDs and the API's address), null where there is none, `offline` for anything else |
| `lib/api/` | the app's calls to its cell's API (#33): `client.ts` (`createApiClient`: `upload` sends a file to a presigned form through XMLHttpRequest, for its progress; the access token on every call, a 20 s limit on reads only, the API's problem+json refusals as `ApiError` kinds with field errors and Retry-After; a taken change whose answer was lost is `unsure`, not offline), `fake.ts` (the test build's in-memory API: profile, target roles, and résumés with a simulated upload and server check), `profile.ts` (`useProfile`: version 0 until one is saved), `roles.ts` (`useRoles`: the target roles, oldest first), `documents.ts` (`checkFile`, `useDocuments`, `useDocument`: a résumé followed while the server checks it), `index.ts` (`useApi`: the client with the token of whoever `AuthContext` says is signed in; `ApiContext` lets a tree provide its own) |
| `components/deputy/` | the deputy: `panda.tsx` (the brand panda; poses `setup`, `search`, `apply` (the story's chapters: pencil, magnifier, approved page) and `pending` (hourglass), each moving the head, right arm, prop and eyes over 618 ms; pending also lifts the body; `alive` (the story playing where someone can see it) breathes (Web Animations, easing back to the pose when it stops) and blinks; the props are drawn around the paw and shared with the strip), `deputy-speech.tsx` (`DeputySpeech`, his speech bubble, and `DeputyStatus`, his status pill, shared with the landing story), `deputy-working.tsx` (`DeputyWorking`: the panda pending with his line, a turning status pill, the job's step, and after 8 s "Still working…" or, for a background job, that it carries on) |
| `lib/boot-loader.ts` | ends the boot loader (`index.html`) once the app has rendered (`useFinishBoot`, called by `App.tsx`): never seen, it goes at once; seen, it holds to its 500 ms, jumps to the logo's settled frame, says "ready", and fades while the page rises in under it on the same 618 ms (a CSS animation on `#root`, keyed to the loader's state), usable at once; it goes once its fade and the page's rise have settled (at once with nothing moving); `useRevealed` tells the story when the page shows |
| `gallery/gallery.tsx`, `gallery/main.tsx`, `gallery.html` | the component gallery: every shared component in every state, for review and PR screenshots. Built only by `--mode e2e` (into its own `dist-e2e/`, so a deploy of `dist/` can never carry it) and served by `dev` at `/gallery.html`. Its developer-only words stay in the file, not `en.ts`, which ships |
| `lib/utils.ts` | `cn()`: joins class names, a later Tailwind class wins. Lists the theme's shadow and easing names; `test/utils.test.ts` fails if tokens.css adds one it lacks |
| `styles/index.css`, `styles/base.css` | the only stylesheet the app loads (linked from `index.html`): Tailwind (scanning everything but the gallery), then `base.css`: the tokens, the files below, and the base page styles. `styles/gallery.css` is the gallery's twin, with its own classes |
| `styles/animations.css` | keyframes as `animate-*` utilities (the drawer's slide, the scrim's fade, the spinner's turn, the unknown-length progress sweep, the skeleton's highlight, the boot loader's reveal and track fill, the landing story's chapter flourishes, the deputy's blink) |
| `styles/story-stage.css` | the story stage's container-query layout: the deputy's size and place, the speech bubble's aim, the props' scale |
| `styles/tokens.css` | the design tokens as Tailwind's theme (colours, shadows, easing, fonts), and shadcn's role names mapped onto them |
| `vite.config.ts` | Vite build (React, Tailwind, the `html-copy.ts` plugin, the `@/` alias for `src/`; the gallery page only in `--mode e2e`) and the Vitest setup (happy-dom) |
| `playwright.config.ts` | browser tests on the built app across seven devices |
| `e2e/landing.spec.ts` | the landing page in real browsers: content, tokens, no sideways scroll, axe, drawer open/close by mouse and keyboard, reduced motion |
| `e2e/boot-loader.spec.ts` | the boot loader in real browsers, with the app's script held back: hand-over to the app (the track full), the 300 ms reveal, the 8 s reload offer, the no-JavaScript line, axe, no sideways scroll, reduced motion, forced colours |
| `e2e/auth.spec.ts` | sign-up with its code, sign-in, wrong fields and details, the pending button, signed in and out, on the test build's in-memory accounts |
| `e2e/gallery-long-wait.spec.ts` | the gallery's 8 s long wait on the page's clock (installed before the page loads, then fast-forwarded): "Still working…" read and shown, axe, no sideways scroll (also at 200% text) |
| `e2e/gallery.spec.ts` | the component gallery in real browsers: axe, no sideways scroll (also at 200% text), a pending button keeps focus and runs once, progress read-outs, skeleton shapes and shimmer, a query region from skeleton to data to refresh and to error, the deputy working with his hourglass and the background line, reduced motion |
| `e2e/scroll-lock.spec.ts` | the page behind an open drawer stays still (no scroll, no shift), with real scrollbars shown: under the site's CSP (styles from its own files only), and without a CSP, where Radix's own style works and ours stands aside |
| `e2e/checks.ts` | shared browser checks: no sideways scroll, no accessibility violations; `openHome` (the home page once the boot loader has handed over) |
| `e2e/screens.ts` | every screen to screenshot and how to reach its frame (add each new screen here); used by both specs below |
| `e2e/screenshots.spec.ts` | a shot of every screen on every device as PR proof; `screenshots-dir.ts` and `global-setup.ts` put them in `apps/web/screenshots/` and clear old ones |
| `e2e/visual.spec.ts`, `e2e/__screenshots__/` | visual baselines: home, sign-in and the gallery compared pixel for pixel (0.1% allowed) on desktop Chrome, iPad and iPhone, on Linux only; made by the `.github/workflows/screenshot-baselines.yml` workflow (run by hand), which pushes them to a new branch for review; skipped while a baseline is missing |

## apps/api/src: one Lambda per feature (API Gateway HTTP API)

| File | Routes and role |
|---|---|
| `me.ts` | `GET /me`, `DELETE /me` (account deletion request, T12) |
| `profile.ts` | profile, search preferences, target roles |
| `documents.ts` | résumé upload (presigned POST), list, rename, default, delete |
| `crawls.ts` | `POST/GET /me/crawls` (with the crawl's `aiSource`; counts the free platform run, T08b3), `GET /me/crawls/{id}`, `/me/crawl-settings` (daily and, T08c, jobs-per-company limits); replaces stale active crawls |
| `jobs.ts` | `GET /me/jobs` (shown jobs, or `view=all`, with each job's `fit` and why), `GET /me/jobs/{jobId}` (read-only) |
| `ai.ts` | `/me/ai-keys` (save with consent, list, check, delete; encrypts the key with KMS), `/me/ai-settings` (T08b2), `GET /me/ai-usage` (T08b3) |
| `audit.ts` | `GET /me/audit` |
| `account-guard.ts` | 410 on writes while a deletion is pending |
| `audited.ts`, `errors.ts` | audit entry builder; error-to-HTTP mapping (409 `try-again`) |
| `cognito.ts`, `pre-signup.ts` | email lookup; sign-up trigger (blocks reserved test domains) |
| `test-site.ts` | dev-only pages the integration tests crawl |
| `ping-jobs.ts` | dev-only T04 async test |

## apps/worker/src: queue and scheduled workers

| File | Role |
|---|---|
| `crawl-worker.ts` | crawl queue: fetch, read jobs, filter and rank them (T08c), save, close missing jobs, finish |
| `document-worker.ts`, `extract.ts` | résumé processing after the malware scan; PDF/DOCX text |
| `key-check-worker.ts` | ai-keys queue: decrypts a key, one check call, records `valid` or `invalid` (T08b2) |
| `deletion-worker.ts` | erases every user table and S3 prefix (T12) |
| `test-data-reaper.ts` | dev only: requests deletion of old test users |
| `relevance-worker.ts` | T08d: relevance queue: scores a crawl's candidates with the LLM (stored per call with its tokens), hides low scores, ranks each company by score |
| `queue-health.ts` | T08d1: every 5 minutes, checks each worker queue (dead letters, backlog) and emails the alarm topic on changes |
| `ping-worker.ts` | dev only: T04 async test |
| `deadline.ts` | stop before Lambda's timeout |
| `fetch/fetcher.ts` | the only way to fetch: limits, redirects, robots.txt, login detection, failure classes |
| `fetch/address.ts` | SSRF check at connect time (public addresses only), DNS |
| `fetch/robots.ts`, `fetch/detect.ts` | robots.txt parser; login pages and JavaScript shells |
| `jobs/crawl-jobs.ts` | what one crawl reads: order of sources, paging, `CRAWL_LIMITS`, partial reasons |
| `jobs/read-page.ts` | a fetched page: board redirect, schema.org, embedded board |
| `jobs/boards.ts`, `jobs/feeds.ts` | job-board detection and requests; readers for Greenhouse, Lever, Ashby, Workday |
| `jobs/descriptions.ts` | T08d3: reads top candidates' postings for the descriptions a board list leaves out; `DESCRIPTION_LIMITS`; 404/410 is gone |
| `jobs/schema-org.ts` | schema.org `JobPosting` |
| `jobs/job.ts`, `jobs/text.ts` | the normalized job, dedupe key, hashes; HTML to text, limits |
| `relevance/code-filter.ts` | T08c: the free code filter: title, level, place, workplace, type, salary, excluded words against the roles; `candidate` or `not_relevant`, with reasons |
| `relevance/company-limit.ts`, `relevance/fit.ts` | T08c: ranking each company's candidates within the limit (`counted`, `over_limit`; by score first since T08d); the crawl's filter-then-rank step; the loader of roles, profile, and limits both workers use |
| `relevance/llm-inputs.ts` | T08d: the user and each job as the model sees them (short IDs), and the inputs hash that skips unchanged jobs |

## packages

| File | Role |
|---|---|
| `db/src/transact.ts` | `transactWrite`: retries conflicts with jitter, then `ConcurrentUpdateError` |
| `db/src/crawl-repository.ts` | sources, crawls, daily and active limits, finish |
| `db/src/job-repository.ts` | save jobs (idempotent, with the filter verdict and expiry), close missing, mark over the limit, list (shown or all), get |
| `db/src/company-limit-repository.ts` | T08c: `usage` `COMPANY#`: each company's shown jobs, replaced at the version read |
| `db/src/relevance-repository.ts` | T08d: a crawl's scoring run: start, each task call with its tokens and scores in one transaction, end with an audit entry |
| `db/src/crawl-limits.ts` | the admin crawl limits from SSM, cached 5 minutes (API and crawl worker) |
| `db/src/document-repository.ts`, `preferences-repository.ts`, `profile-repository.ts` | T05 items, with counters and audit |
| `db/src/ai-usage-repository.ts` | token use per month and model (`aiUsageUpdate` for the result transaction, `listAiUsage`) |
| `db/src/ai-key-repository.ts` | `ai-keys` (save, check, delete, results; daily check limit) and `preferences` `AI_SETTINGS` |
| `db/src/usage-counters.ts`, `versioned.ts`, `audit-repository.ts` | exact caps; optimistic versions; audit entries and paging |
| `db/src/account-repository.ts`, `crawl-settings-repository.ts`, `ping-repository.ts`, `client.ts` | deletion record; user crawl and jobs-per-company limits; ping; DynamoDB client and condition helpers |
| `shared/src/*.ts` | Zod schemas and constants per feature (`auth`, `crawl`, `documents`, `profile`, `ping`), `ai.ts` (the pinned platform model; own-key providers, schemas, and limits), `http.ts` (problem details), `logger.ts` |
| `test-fixtures/src/index.ts` | synthetic PDF, DOCX, zip bomb, EICAR |
| `llm/src/task.ts` | `defineTask`, `runTask`: 3 turns, token caps, timeout, strict zod output, `partial`, usage (the only Strands caller, 0009) |
| `llm/src/models.ts` | `resolveModel`: the platform model on Bedrock in the cell Region, or the user's OpenAI or Anthropic key; no client retries |
| `llm/src/metrics.ts` | `recordTaskMetrics`: one Embedded Metric Format line per task call (no user IDs) |
| `llm/src/key-check.ts`, `llm/src/logging.ts` | one small call checks a user's key (and the dev-only `stub`); Strands logs with keys masked |
| `llm/src/prompt.ts`, `llm/src/grounding.ts` | data blocks and the rules against prompt injection; keep only the IDs we sent (0010) |
| `llm/src/stub-model.ts` | `@jobdeputy/llm/testing`: scripted model for unit and integration tests |
| `llm/src/tasks/smoke.ts`, `llm/src/tasks/index.ts` | the fixed check Nightly and the eval run against the real model; `TASKS`, every task with a sample input |
| `llm/src/tasks/relevance.ts` | T08d: the `relevance` task (score 0–100, best role, reasons) and `scoreRelevance` (batches of 10, one follow-up, at most 6 task calls) |
| `llm/src/tasks/relevance-stub.ts` | T08d: dev stacks only: the `stub` provider's fixed relevance answers, for integration tests |
| `llm/src/fingerprint.ts` | hash of a task's prompt, schema, and limits; must match `eval/versions.json` for its version |
| `llm/eval/` | eval harness (`harness.ts`), runner (`run.ts`, `pnpm --filter @jobdeputy/llm eval`), cases, saved baselines |

## infra

| File | Role |
|---|---|
| `bin/app.ts`, `lib/build-app.ts`, `config/` | which stacks exist per stage, cell, and owner |
| `lib/cell-stack.ts` | everything in one Region cell: tables, Lambdas, grants, routes, pipelines, alarms |
| `lib/keys-stack.ts` | the cell's KMS key for own AI keys, in its own stack (kept on delete); its ARN in SSM |
| `lib/web-stack.ts`, `lib/web-dns-stack.ts` | the web app (0011): private S3 bucket, CloudFront with security headers and SPA routing, certificate, DNS records, upload of `apps/web/dist`; the delegated zone (kept on delete). Domains in `config/web.ts` |
| `lib/constructs/` | `ai-keys` (key API, key-check worker, KMS grants), `llm-monitoring` (LLM dashboard, alarms, `llmMetricsEnvironment`), `async-pipeline` (stream → Pipe → queue → worker), `queue-worker`, `queue-health` (the scheduled check that watches every queue; T08d1), `relevance` (T08d: the relevance worker, its Pipe on the crawls stream, its grants), `auth`, `documents` (bucket, malware scan), `node-function` |
| `lib/cicd-stack.ts` | GitHub OIDC roles (deploy, PR integration) |
| `lib/guards.ts` | cost and Region guard checks |

## tests/integration/src and scripts

| File | Role |
|---|---|
| `stack.ts`, `cleanup.ts` | stack outputs, test users, API calls, `waitFor`; test-user clean-up |
| `*.test.ts` | one file per deployed feature |
| `scripts/request-account-deletion.sh` | the only way to delete an account by hand |
| `scripts/cleanup-log-groups.sh`, `scripts/cloud-setup.sh` | orphaned log groups; cloud dev environment |
| `scripts/delete-pr-stack.sh` | deletes a PR stack, retrying AWS internal delete failures (#61) |
| `scripts/publish-ui-screenshots.sh` | posts a PR's UI screenshots as one comment; images on the `ui-screenshots` branch (one commit: each PR's last 3 pushes, kept 30 days after close; retries when two PRs publish at once) (#14) |
