# Task board

Current slice: profile → submit URL → asynchronous crawl → store relevant jobs. See [scope](../scope-current-slice.md).

Every task goes through these statuses: `planned` → `researching` → `awaiting-alignment` → `in-progress` → `in-review` → `done`.

| ID | Task | Status | Depends on |
|---|---|---|---|
| T01 | [Agentic workspace and GitHub repository](t01-agentic-workspace.md) | done | — |
| T02 | [Tech stack and async backbone decision](t02-stack-and-async-backbone.md) | done | T01 |
| T03 | [AWS foundation, monorepo, and CI/CD](t03-infrastructure-foundation.md) | done | T02 |
| T04 | [Serverless backend skeleton](t04-backend-skeleton.md) | in-review | T03 |
| T05 | [Sign-up, sign-in, and profile API](t05-profile-api.md) | planned | T04 |
| T06 | [Asynchronous crawl request pipeline](t06-async-crawl-pipeline.md) | planned | T04, T05 |
| T07 | [Job extraction, normalization, and storage](t07-job-extraction-storage.md) | planned | T06 |
| T08 | [Relevance filter](t08-relevance-filter.md) | planned | T05, T07 |
| T09 | [User interface for the slice](t09-ui.md) | planned | T05, T06, T08 |
| T10 | [End-to-end tests and hardening](t10-end-to-end-hardening.md) | planned | T09 |

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
