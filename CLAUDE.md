# JobDeputy — agent guide

Read this first in every session. Keep it short; details live in `docs/`.

## What we are building

JobDeputy discovers jobs from any URL a user gives, keeps the relevant ones, and (later) prepares tailored application materials. Users bring their own AI/API credentials (BYOT). Full statement: [docs/problem-statement.md](docs/problem-statement.md).

**Current slice:** profile (basic details, résumé, target roles) → user submits a URL → **asynchronous** crawl job → relevant jobs stored in the database. Scope and non-goals: [docs/scope-current-slice.md](docs/scope-current-slice.md).

## Where things are

| Need | Location |
|---|---|
| Task board and current status | [docs/tasks/README.md](docs/tasks/README.md) |
| One task's goal, research, decision, done criteria | `docs/tasks/tNN-*.md` |
| Agreed decisions (do not re-litigate) | [docs/decisions/](docs/decisions/README.md) |
| Contribution and branch rules | [CONTRIBUTING.md](CONTRIBUTING.md) |

## How every task runs

1. **Research** — investigate options, write findings into the task file's *Research* section. Use `/research-task`.
2. **Align** — present a recommendation to the human and **wait for agreement**. Record the outcome in the task's *Decision* section (and a `docs/decisions/` record if it affects the architecture).
3. **Implement** — on a branch, then open a PR using the template. Use `/implement-task` and `/prepare-pr`.

Do not design ahead of the task that needs it. For example, the crawler's architecture is decided in its own task, not earlier.

## Rules

- Never commit to `main`. Branch `tNN-short-slug` (or `fix/…`, `chore/…`) → PR → squash merge.
- Long-running work (crawling, parsing, AI calls) is **asynchronous**: accept the request, return a job ID, and process it in a worker.
- Never commit secrets, real résumés, or personal data. Use `.env` (git-ignored) and `.env.example`. The repo is intended to be public.
- User credentials (BYOT) are the user's: never log them, never share them across users.
- Every PR fills in the template: what changed, how it was tested and the proof, error cases, and security review.
- Update the task file and task board status in the same PR as the work.

## Commands

No application code yet. The stack is chosen in T02; add the build, test and run commands here when they exist.
