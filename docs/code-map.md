# Code map

Where each part of the code lives, so you can open the right file instead of searching. Read this first. **Update it in the same PR** when you add, move, or split a source file.

Tests mirror the source: `apps/<app>/test/<name>.test.ts`, `packages/<pkg>/test/`, `infra/test/`, and deployed tests in `tests/integration/src/`.

## Common changes

| To change… | Edit |
|---|---|
| A table, grant, route, queue, Lambda, or alarm | `infra/lib/cell-stack.ts` (constructs in `infra/lib/constructs/`); guard tests in `infra/test/` |
| An API route's behaviour | `apps/api/src/<feature>.ts` (`route()` switches on `routeKey`); the route must also be added in `cell-stack.ts` |
| Request validation or shared limits | `packages/shared/src/<feature>.ts` (Zod schemas, limits, error codes) |
| How an item is read or written | `packages/db/src/<feature>-repository.ts`; every transaction goes through `transact.ts` |
| What a crawl fetches or refuses | `apps/worker/src/fetch/` |
| How jobs are read from a page or board | `apps/worker/src/jobs/` |
| Item attributes | the repository **and** `docs/data-model.md` (with a change-log line) |
| CI permissions | `infra/lib/cicd-stack.ts` |
| An LLM task, its prompt, or its limits | `packages/llm/src/tasks/<task>.ts` (raise its `version`, add it to `TASKS`); eval cases in `packages/llm/eval/cases/`, `eval/versions.json`, baseline in `eval/baselines/` |

## apps/api/src: one Lambda per feature (API Gateway HTTP API)

| File | Routes and role |
|---|---|
| `me.ts` | `GET /me`, `DELETE /me` (account deletion request, T12) |
| `profile.ts` | profile, search preferences, target roles |
| `documents.ts` | résumé upload (presigned POST), list, rename, default, delete |
| `crawls.ts` | `POST/GET /me/crawls` (with the crawl's `aiSource`; counts the free platform run, T08b3), `GET /me/crawls/{id}`, `/me/crawl-settings`; replaces stale active crawls |
| `crawl-limits.ts` | admin crawl limits from SSM, cached 5 minutes |
| `jobs.ts` | `GET /me/jobs`, `GET /me/jobs/{jobId}` (read-only) |
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
| `crawl-worker.ts` | crawl queue: fetch, read jobs, save, close missing jobs, finish |
| `document-worker.ts`, `extract.ts` | résumé processing after the malware scan; PDF/DOCX text |
| `key-check-worker.ts` | ai-keys queue: decrypts a key, one check call, records `valid` or `invalid` (T08b2) |
| `deletion-worker.ts` | erases every user table and S3 prefix (T12) |
| `test-data-reaper.ts` | dev only: requests deletion of old test users |
| `ping-worker.ts` | dev only: T04 async test |
| `deadline.ts` | stop before Lambda's timeout |
| `fetch/fetcher.ts` | the only way to fetch: limits, redirects, robots.txt, login detection, failure classes |
| `fetch/address.ts` | SSRF check at connect time (public addresses only), DNS |
| `fetch/robots.ts`, `fetch/detect.ts` | robots.txt parser; login pages and JavaScript shells |
| `jobs/crawl-jobs.ts` | what one crawl reads: order of sources, paging, `CRAWL_LIMITS`, partial reasons |
| `jobs/read-page.ts` | a fetched page: board redirect, schema.org, embedded board |
| `jobs/boards.ts`, `jobs/feeds.ts` | job-board detection and requests; readers for Greenhouse, Lever, Ashby, Workday |
| `jobs/schema-org.ts` | schema.org `JobPosting` |
| `jobs/job.ts`, `jobs/text.ts` | the normalized job, dedupe key, hashes; HTML to text, limits |

## packages

| File | Role |
|---|---|
| `db/src/transact.ts` | `transactWrite`: retries conflicts with jitter, then `ConcurrentUpdateError` |
| `db/src/crawl-repository.ts` | sources, crawls, daily and active limits, finish |
| `db/src/job-repository.ts` | save jobs (idempotent), close missing, list, get |
| `db/src/document-repository.ts`, `preferences-repository.ts`, `profile-repository.ts` | T05 items, with counters and audit |
| `db/src/ai-usage-repository.ts` | token use per month and model (`aiUsageUpdate` for the result transaction, `listAiUsage`) |
| `db/src/ai-key-repository.ts` | `ai-keys` (save, check, delete, results; daily check limit) and `preferences` `AI_SETTINGS` |
| `db/src/usage-counters.ts`, `versioned.ts`, `audit-repository.ts` | exact caps; optimistic versions; audit entries and paging |
| `db/src/account-repository.ts`, `crawl-settings-repository.ts`, `ping-repository.ts`, `client.ts` | deletion record; user crawl limit; ping; DynamoDB client and condition helpers |
| `shared/src/*.ts` | Zod schemas and constants per feature (`auth`, `crawl`, `documents`, `profile`, `ping`), `ai.ts` (the pinned platform model; own-key providers, schemas, and limits), `http.ts` (problem details), `logger.ts` |
| `test-fixtures/src/index.ts` | synthetic PDF, DOCX, zip bomb, EICAR |
| `llm/src/task.ts` | `defineTask`, `runTask`: 3 turns, token caps, timeout, strict zod output, `partial`, usage (the only Strands caller, 0009) |
| `llm/src/models.ts` | `resolveModel`: the platform model on Bedrock in the cell Region, or the user's OpenAI or Anthropic key; no client retries |
| `llm/src/metrics.ts` | `recordTaskMetrics`: one Embedded Metric Format line per task call (no user IDs) |
| `llm/src/key-check.ts`, `llm/src/logging.ts` | one small call checks a user's key (and the dev-only `stub`); Strands logs with keys masked |
| `llm/src/prompt.ts`, `llm/src/grounding.ts` | data blocks and the rules against prompt injection; keep only the IDs we sent (0010) |
| `llm/src/stub-model.ts` | `@jobdeputy/llm/testing`: scripted model for unit and integration tests |
| `llm/src/tasks/smoke.ts`, `llm/src/tasks/index.ts` | the fixed check Nightly and the eval run against the real model; `TASKS`, every task with a sample input |
| `llm/src/fingerprint.ts` | hash of a task's prompt, schema, and limits; must match `eval/versions.json` for its version |
| `llm/eval/` | eval harness (`harness.ts`), runner (`run.ts`, `pnpm --filter @jobdeputy/llm eval`), cases, saved baselines |

## infra

| File | Role |
|---|---|
| `bin/app.ts`, `lib/build-app.ts`, `config/` | which stacks exist per stage, cell, and owner |
| `lib/cell-stack.ts` | everything in one Region cell: tables, Lambdas, grants, routes, pipelines, alarms |
| `lib/keys-stack.ts` | the cell's KMS key for own AI keys, in its own stack (kept on delete); its ARN in SSM |
| `lib/constructs/` | `ai-keys` (key API, key-check worker, KMS grants), `llm-monitoring` (LLM dashboard, alarms, `llmMetricsEnvironment`), `async-pipeline` (stream → Pipe → queue → worker), `queue-worker`, `auth`, `documents` (bucket, malware scan), `node-function` |
| `lib/cicd-stack.ts` | GitHub OIDC roles (deploy, PR integration) |
| `lib/guards.ts` | cost and Region guard checks |

## tests/integration/src and scripts

| File | Role |
|---|---|
| `stack.ts`, `cleanup.ts` | stack outputs, test users, API calls, `waitFor`; test-user clean-up |
| `*.test.ts` | one file per deployed feature |
| `scripts/request-account-deletion.sh` | the only way to delete an account by hand |
| `scripts/cleanup-log-groups.sh`, `scripts/cloud-setup.sh` | orphaned log groups; cloud dev environment |
