# Task board

Current slice: profile → submit URL → asynchronous crawl → store relevant jobs. See [scope](../scope-current-slice.md).

Every task goes through these statuses: `planned` → `researching` → `awaiting-alignment` → `in-progress` → `in-review` → `done`.

| ID | Task | Status | Depends on |
|---|---|---|---|
| T01 | [Agentic workspace and GitHub repository](t01-agentic-workspace.md) | done | — |
| T02 | [Tech stack and async backbone decision](t02-stack-and-async-backbone.md) | done | T01 |
| T03 | [AWS foundation, monorepo, and CI/CD](t03-infrastructure-foundation.md) | done | T02 |
| T04 | [Serverless backend skeleton](t04-backend-skeleton.md) | done | T03 |
| T11 | [Integration tests on every PR (before merge)](t11-pr-integration-tests.md) | done | T04 |
| T05 | [Sign-up, sign-in, and profile API](t05-profile-api.md) | done | T04 |
| T12 | [Delete my account](t12-account-deletion.md) ([#17](https://github.com/jobdeputy/jobdeputy/issues/17)) | done | T05 |
| T13 | [No orphaned user data](t13-no-orphaned-data.md) | done | T12 |
| T14 | [Security and hygiene](t14-security-hygiene.md) | done | T13 |
| T06 | [Asynchronous crawl request pipeline](t06-async-crawl-pipeline.md) | done | T04, T05 |
| T06a | [Safe fetcher](t06a-safe-fetcher.md) | done | T06 |
| T06b | [Crawl pipeline](t06b-crawl-pipeline.md) | done | T06a |
| T06c | [Crawl limits](t06c-crawl-limits.md) | done | T06b |
| T06d | [Audit for existing actions](t06d-audit-existing-actions.md) | done | T06b |
| T07 | [Job extraction, normalization, and storage](t07-job-extraction-storage.md) | done (T07d planned) | T06 |
| T07a | [Job readers](t07a-job-readers.md) | done | T07 |
| T07b | [Jobs table and storage](t07b-jobs-storage.md) | done | T07a |
| T07c | [Paging, crawl limits, and closed jobs](t07c-paging-and-closed-jobs.md) | done | T07b |
| T07d | [LLM extraction](t07d-llm-extraction.md) ([#41](https://github.com/jobdeputy/jobdeputy/issues/41)) | planned | T07b, T08b |
| T08 | [Relevance filter](t08-relevance-filter.md) | in-progress | T05, T07 |
| T08a | [Platform AI model](t08a-ai-model.md) | done | T08 |
| T08b | [LLM foundation, own keys, and token usage](t08b-llm-foundation.md) (T08b1–T08b3) | done | T08a |
| T08c | [Code filter, per-company limit, and expiry](t08c-code-filter.md) | done | T07 |
| T08d | [LLM relevance scoring](t08d-llm-relevance.md) (T08d1–T08d3) | done | T08b, T08c |
| T08e | [Research: how well prompts and models work on live data](t08e-live-effectiveness.md) | done | T08b |
| T09 | [User interface for the slice](t09-ui.md) | planned | T05, T06, T08 |
| T10 | [End-to-end tests and hardening](t10-end-to-end-hardening.md) | planned | T09 |

## Backlog (open issues, in order)

Every open piece of work is a GitHub issue. Agreed with the maintainer (2026-10-02): finish the backend in dev first, then monitoring, and park prod until later (prod launches in the US cell first). Work goes top to bottom; each item still runs research → align → build.

**1. Backend in dev** (label `enhancement`, except the first)

| Order | Issue | Summary |
|---|---|---|
| 1 | [#61](https://github.com/jobdeputy/jobdeputy/issues/61) | Flaky PR deploys: a Pipe fails to validate its dead-letter queue (IAM race). First, because every PR below hits it. |
| 2 | [#71](https://github.com/jobdeputy/jobdeputy/issues/71) | Job actions API: save, dismiss, applied, star, notes, and feedback on a score |
| 3 | [#73](https://github.com/jobdeputy/jobdeputy/issues/73) | Jobs list: sort by score or date, filter by status, company, and page |
| 4 | [#57](https://github.com/jobdeputy/jobdeputy/issues/57) | Re-filter stored jobs right after a target-role or search change |
| 5 | [#72](https://github.com/jobdeputy/jobdeputy/issues/72) | Saved pages API: list, rename, and remove saved pages |
| 6 | [#77](https://github.com/jobdeputy/jobdeputy/issues/77) | More job-board readers (beyond Greenhouse, Lever, Ashby, Workday) |
| 7 | [#41](https://github.com/jobdeputy/jobdeputy/issues/41) | T07d: LLM extraction for pages without structured job data |
| 8 | [#74](https://github.com/jobdeputy/jobdeputy/issues/74) | Scheduled re-crawls of saved pages (needs a product decision first) |
| 9 | [#75](https://github.com/jobdeputy/jobdeputy/issues/75) | Data export: `GET /me/export` |
| 10 | [#51](https://github.com/jobdeputy/jobdeputy/issues/51) | Own keys: recommended default model per provider and task |
| 11 | [#40](https://github.com/jobdeputy/jobdeputy/issues/40) | Shared companies and company-aliases tables |
| 12 | [#78](https://github.com/jobdeputy/jobdeputy/issues/78) | Scanned PDF résumés: text by OCR (decide first) |
| 13 | [#79](https://github.com/jobdeputy/jobdeputy/issues/79) | Decide on a browser for JavaScript-only pages (needs counts first) |
| 14 | [#80](https://github.com/jobdeputy/jobdeputy/issues/80) | Own keys: more providers, and costs shown per model |
| 15 | [#47](https://github.com/jobdeputy/jobdeputy/issues/47) | AI quotas for premium users (only if premium is wanted) |

**2. Dev upkeep** (label `upkeep`; whenever convenient): [#35](https://github.com/jobdeputy/jobdeputy/issues/35) (dev Lambda concurrency 10 → 1000), [#24](https://github.com/jobdeputy/jobdeputy/issues/24) (CDK asset clean-up), [#49](https://github.com/jobdeputy/jobdeputy/issues/49) (monthly new-model eval), [#50](https://github.com/jobdeputy/jobdeputy/issues/50) (monthly prompt-injection review), [#23](https://github.com/jobdeputy/jobdeputy/issues/23) (Node.js 24 before 2027-04-30).

**3. Monitoring, after the backend** (label `monitoring`): [#70](https://github.com/jobdeputy/jobdeputy/issues/70) (every failure mode and what catches it; decide how to catch each first), [#65](https://github.com/jobdeputy/jobdeputy/issues/65) (PR [#68](https://github.com/jobdeputy/jobdeputy/pull/68) on hold until #70 is agreed), [#66](https://github.com/jobdeputy/jobdeputy/issues/66) (T08e2), [#34](https://github.com/jobdeputy/jobdeputy/issues/34) (safe prod deploys).

**4. Prod, parked:** the release blockers below.

Then T09 (the UI) and T10.

## Release blockers

Must be fixed before the prod launch. Tracked as GitHub issues with the [`release-blocker`](https://github.com/jobdeputy/jobdeputy/labels/release-blocker) label; the launch task cannot close while any are open.

| Issue | Summary |
|---|---|
| [#8](https://github.com/jobdeputy/jobdeputy/issues/8) | Narrow the CDK deploy execution role (`AdministratorAccess`) and add a permissions boundary |
| [#13](https://github.com/jobdeputy/jobdeputy/issues/13) | Send Cognito emails through SES in each prod Region |
| [#21](https://github.com/jobdeputy/jobdeputy/issues/21) | CloudTrail: organization trail with permanent audit logs |
| [#22](https://github.com/jobdeputy/jobdeputy/issues/22) | Production wiring: prod accounts, approval-gated deploys, prod alerts |
| [#34](https://github.com/jobdeputy/jobdeputy/issues/34) | Safe prod deploys: gradual rollout with automatic rollback, error-rate 5xx alarm, a second alert channel, Lambda concurrency quotas |

## Future (after this slice)

Captured so they are not forgotten. Not started until the current slice is done.

| Task | Notes |
|---|---|
| Premium AI credentials | Own keys and the free platform allowance are built (T08b); premium quotas are [#47](https://github.com/jobdeputy/jobdeputy/issues/47). Premium users use JobDeputy's credentials. Keys are encrypted in the user's home Region ([0004](../decisions/0004-regional-cells-and-data-residency.md)), never logged or returned. Every AI call follows [0002](../decisions/0002-llm-loop-and-token-budget.md). Storage and encryption are researched then. |
| Tailored résumé and cover-letter generation | Depends on AI credentials. |
| LinkedIn discovery | Phase 1 requirement from the [problem statement](../problem-statement.md). |
| Shared job postings | A per-Region `postings` table so a page saved by many users is extracted once; jobs reference it. See [0006](../decisions/0006-data-model.md). |
| Prod launch: `us` first, then `in` and `uk` | Agreed 2026-10-02: the US cell first (US users only), the other Regions when funded. Deploy the prod cells, domain and subdomains, per-Region audit trails, and WAF. |
| Phase 2: application automation | See the problem statement. |

## Adding a task

Copy [_template.md](_template.md) to `tNN-short-slug.md`, add a row above, and link the dependencies.
