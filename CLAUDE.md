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
| Tables, attributes, and S3 paths | [docs/data-model.md](docs/data-model.md) |
| Agreed decisions (do not re-litigate) | [docs/decisions/](docs/decisions/README.md) |
| Contribution and branch rules | [CONTRIBUTING.md](CONTRIBUTING.md) |

## How every task runs

1. **Research** — investigate options, write findings into the task file's *Research* section. Use `/research-task`.
2. **Align** — present a recommendation to the human and **wait for agreement**. Record the outcome in the task's *Decision* section (and a `docs/decisions/` record if it affects the architecture).
3. **Implement** — on a branch, then open a PR using the template. Use `/implement-task` and `/prepare-pr`.

Do not design ahead of the task that needs it. For example, the crawler's architecture is decided in its own task, not earlier.

## Rules

- Never commit to `main`. Branch `tNN-short-slug` (or `fix/…`, `chore/…`) → PR → squash merge.
- **Agents never merge PRs.** Open or update the PR, get CI green, report the link, and stop. The maintainer reviews and merges.
- Long-running work (crawling, parsing, AI calls) is **asynchronous**: accept the request, return a job ID, and process it in a worker.
- Never commit secrets, real résumés, or personal data. Use `.env` (git-ignored) and `.env.example`. The repo is intended to be public.
- **User data never leaves its home Region** (US `us-east-1`, India `ap-south-1`, UK `eu-west-2`). Each Region is a self-contained cell. See [0004](docs/decisions/0004-regional-cells-and-data-residency.md).
- **Strict cost control until launch** ([0005](docs/decisions/0005-pre-launch-cost-guardrails.md)): pay-per-use services only, nothing that costs money while idle. Set throttles, concurrency caps, and log retention. Spend is blocked automatically at $20.
- User credentials (BYOT) are the user's: never log them, never share them across users.
- **LLM and agent loops are capped at 3 iterations.** When the cap is hit, stop and return the best result so far, marked as partial. Every call has a maximum output token limit and a timeout, and job retries must not multiply LLM calls. See [0002](docs/decisions/0002-llm-loop-and-token-budget.md).
- Every PR fills in the template: what changed, how it was tested and the proof, error cases, LLM and agent call safety, and security review.
- Update the task file and task board status in the same PR as the work.
- **Schema changes are documented in the same PR:** update [docs/data-model.md](docs/data-model.md) and its change log whenever an attribute, item kind, or S3 path changes. New tables or key changes need a decision record ([0006](docs/decisions/0006-data-model.md)).

## Stack

Everything runs on AWS serverless services. See [0003](docs/decisions/0003-serverless-aws-stack.md).

- TypeScript everywhere on Node 22, in a pnpm monorepo: `apps/api`, `apps/worker`, `apps/web`, `packages/shared`, `packages/db`, `infra/` (AWS CDK).
- API: API Gateway HTTP API → Lambda, with Zod validation from `packages/shared`.
- Async: the API writes to DynamoDB (`status=queued`) → Stream → EventBridge Pipes → SQS → worker Lambda. Never send to SQS directly from the API. Workers must be idempotent.
- Data: DynamoDB, accessed only through `packages/db`. Files go to S3 through presigned URLs.
- UI: React, Vite, and TanStack Query on S3 and CloudFront. Auth is Cognito.
- CI/CD: GitHub Actions with OIDC. No AWS keys anywhere.

## Commands

Node 22 and pnpm (through corepack). Run from the repo root unless noted.

| Command | What it does |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm verify` | Biome lint and format check, typecheck, and all tests. **Run before every PR.** |
| `pnpm format` | Auto-fix formatting and safe lint issues |
| `pnpm synth` | Synthesize all dev and prod cells (no AWS access needed) |
| `cd infra && pnpm cdk deploy -c stage=dev -c owner=<you> --profile jobdeputy-dev-iad` | Deploy your personal dev stack |
| `cd infra && pnpm cdk destroy -c stage=dev -c owner=<you> --profile jobdeputy-dev-iad` | Remove your personal dev stack |

- The shared `dev-iad` stack deploys automatically from `main`. Never deploy it by hand.
- Guard tests in `infra/test/` enforce decisions 0004 and 0005 (Region isolation and cost). Never weaken them to make a build pass.
- One-time AWS organization setup lives in `infra/bootstrap/` (maintainers only).
