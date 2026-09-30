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
| T08b | [LLM foundation, own keys, and token usage](t08b-llm-foundation.md) (T08b1–T08b3) | in-review | T08a |
| T08c | [Code filter, per-company limit, and expiry](t08c-code-filter.md) | planned | T07 |
| T08d | [LLM relevance scoring](t08d-llm-relevance.md) | planned | T08b, T08c |
| T08e | [Research: how well prompts and models work on live data](t08e-live-effectiveness.md) | planned | T08b |
| T09 | [User interface for the slice](t09-ui.md) | planned | T05, T06, T08 |
| T10 | [End-to-end tests and hardening](t10-end-to-end-hardening.md) | planned | T09 |

## Release blockers

Must be fixed before the prod launch. Tracked as GitHub issues with the [`release-blocker`](https://github.com/jobdeputy/jobdeputy/labels/release-blocker) label; the launch task cannot close while any are open.

| Issue | Summary |
|---|---|
| [#8](https://github.com/jobdeputy/jobdeputy/issues/8) | Narrow the CDK deploy execution role (`AdministratorAccess`) and add a permissions boundary |
| [#13](https://github.com/jobdeputy/jobdeputy/issues/13) | Send Cognito emails through SES in each prod Region |
| [#21](https://github.com/jobdeputy/jobdeputy/issues/21) | CloudTrail: organization trail with permanent audit logs |
| [#22](https://github.com/jobdeputy/jobdeputy/issues/22) | Production wiring: prod accounts, approval-gated deploys, prod alerts |
| [#34](https://github.com/jobdeputy/jobdeputy/issues/34) | Safe prod deploys: gradual rollout with automatic rollback, error-rate 5xx alarm, a second alert channel, Lambda concurrency quotas |

Deferred from T07: [#40](https://github.com/jobdeputy/jobdeputy/issues/40) (shared `companies` and `company-aliases` tables, built with company rules). AI quotas for premium users: [#47](https://github.com/jobdeputy/jobdeputy/issues/47). Other tracked maintenance: [#23](https://github.com/jobdeputy/jobdeputy/issues/23) (Node.js 24 before 2027-04-30), [#24](https://github.com/jobdeputy/jobdeputy/issues/24) (CDK asset garbage collection), [#35](https://github.com/jobdeputy/jobdeputy/issues/35) (restore the dev account's Lambda concurrency limit, 10 → 1000).

## Future (after this slice)

Captured so they are not forgotten. Not started until the current slice is done.

| Task | Notes |
|---|---|
| AI credentials (BYOT and premium) | Users store their own AI keys. Premium users use JobDeputy's credentials. Keys are encrypted in the user's home Region ([0004](../decisions/0004-regional-cells-and-data-residency.md)), never logged or returned. Every AI call follows [0002](../decisions/0002-llm-loop-and-token-budget.md). Storage and encryption are researched then. |
| Tailored résumé and cover-letter generation | Depends on AI credentials. |
| LinkedIn discovery | Phase 1 requirement from the [problem statement](../problem-statement.md). |
| Shared job postings | A per-Region `postings` table so a page saved by many users is extracted once; jobs reference it. See [0006](../decisions/0006-data-model.md). |
| Prod launch in `us`, `in`, and `uk` | Deploy the prod cells, domain and subdomains, per-Region audit trails, and WAF. |
| Phase 2: application automation | See the problem statement. |

## Adding a task

Copy [_template.md](_template.md) to `tNN-short-slug.md`, add a row above, and link the dependencies.
