# Task board

Current slice: profile → submit URL → asynchronous crawl → store relevant jobs. See [scope](../scope-current-slice.md).

Every task goes through these statuses: `planned` → `researching` → `awaiting-alignment` → `in-progress` → `in-review` → `done`.

| ID | Task | Status | Depends on |
|---|---|---|---|
| T01 | [Agentic workspace and GitHub repository](t01-agentic-workspace.md) | in-review | — |
| T02 | [Tech stack and async backbone decision](t02-stack-and-async-backbone.md) | planned | T01 |
| T03 | [Infrastructure foundation](t03-infrastructure-foundation.md) | planned | T02 |
| T04 | [Backend skeleton (API and worker)](t04-backend-skeleton.md) | planned | T03 |
| T05 | [Profile API](t05-profile-api.md) | planned | T04 |
| T06 | [Asynchronous crawl request pipeline](t06-async-crawl-pipeline.md) | planned | T04, T05 |
| T07 | [Job extraction, normalization, and storage](t07-job-extraction-storage.md) | planned | T06 |
| T08 | [Relevance filter](t08-relevance-filter.md) | planned | T05, T07 |
| T09 | [User interface for the slice](t09-ui.md) | planned | T05, T06, T08 |
| T10 | [End-to-end tests and hardening](t10-end-to-end-hardening.md) | planned | T09 |

## Adding a task

Copy [_template.md](_template.md) to `tNN-short-slug.md`, add a row above, and link the dependencies.
