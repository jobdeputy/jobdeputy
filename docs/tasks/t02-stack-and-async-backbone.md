# T02: Tech stack and async backbone decision

- **Status:** awaiting-alignment
- **Depends on:** T01
- **Branch / PR:** `t02-stack-and-async-backbone`

## Goal

An agreed serverless AWS stack for the API, worker, database, async backbone, UI, infrastructure as code, and CI/CD, recorded as a decision.

## Scope

- In: language and framework, database, queue or worker mechanism, UI framework, local development approach, hosting direction, monorepo layout.
- Out: crawler design (T06), relevance approach (T08), and AWS account, Region, and budget setup (T03).

## Research

Library versions and maintenance were checked on 2026-09-27 on npm and PyPI. Every candidate below was updated within the last few weeks and uses a license compatible with AGPL-3.0 (MIT, Apache-2.0, or BSD).

### 1. Language

| Option | Strengths | Weaknesses |
|---|---|---|
| **TypeScript everywhere** | One language for UI, API, worker, and shared schemas, so types flow from the database to the UI. Playwright and Crawlee (a crawling framework) are TypeScript-first. Strong official AI SDKs. Easier for agents: one toolchain and one test runner. | Fewer mature HTML extraction and PDF libraries than Python. |
| Python backend and TypeScript UI | Best scraping and extraction ecosystem (Scrapy, trafilatura, extruct, pypdf). FastAPI is excellent. | Two languages, two toolchains, and API types duplicated between backend and UI. More setup for contributors and agents. `extruct` has not been released since 2024. |

**Recommendation: TypeScript everywhere.** The UI must be TypeScript anyway, and one language keeps the repo simpler for contributors and agents. The extraction gaps are small: Playwright or Crawlee handle crawling, and schema.org `JobPosting` data is plain JSON-LD that can be parsed directly. If T07 finds a real gap, a single Python extraction worker can be added behind the queue later without changing anything else.

### 2. Constraint: fully serverless on AWS (set by the maintainer on 2026-09-27)

Everything runs on AWS managed and serverless services: no servers, no always-on containers, and nothing to patch. The earlier Postgres and pg-boss option is dropped.

### 3. Async backbone

The maintainer's baseline: API Gateway → Lambda → SQS → Lambda worker, with status reads through API Gateway → Lambda.

**Problem with the baseline:** if the API Lambda writes the crawl request to the database and then sends to SQS, those are two separate steps. A crash between them leaves a request stuck in `queued`. A retried send creates a duplicate job.

| Option | How it works | Assessment |
|---|---|---|
| A. Lambda writes to the database, then sends to SQS | Two calls in the API Lambda. | Simple, but has the stuck or duplicate problem above. |
| **B. Database write drives the queue (recommended)** | The API Lambda only writes the crawl request item (`status=queued`). A DynamoDB Stream, through **EventBridge Pipes**, delivers it to **SQS**. The worker Lambda consumes SQS. | The write is the only commit point, so nothing is lost or double-queued, with no outbox code. SQS keeps its benefits: buffering, a dead-letter queue, a cap on worker concurrency (protecting target sites and the user's tokens), and retries. |
| C. API Lambda starts a Step Functions workflow | Step Functions runs the steps with per-step retries, timeouts, and a visual history. | Strong for multi-step pipelines (fetch → extract → relevance) and for enforcing hard loop limits (decision 0002). Heavier than needed for the first single-step crawl. |

**Recommendation: B now, with Step Functions as a planned upgrade point.** T06 starts with Stream → Pipes → SQS → worker Lambda. If T06 or T07 turns the crawl into several steps (fetch, extract, relevance, a possible LLM repair loop), the Pipe can target a Step Functions workflow instead, without changing the API or the data model.

Worker details (confirmed in T06):

- SQS redrive to a dead-letter queue after a set number of receives. The final `failed` status is written with a reason.
- Idempotent handlers through Powertools for AWS Lambda (TypeScript) idempotency, so a retried message never repeats side effects or LLM spend.
- Reserved concurrency on the worker to cap parallel crawls.
- Lambda limits: 15 minutes and up to 10 GB memory per run. Headless-browser crawling in Lambda needs a container-image Lambda. If a crawl needs more time, Step Functions can run a Fargate task for that step. T06 decides.
- Status: the UI polls `GET /crawl-requests/{id}` through API Gateway → Lambda → DynamoDB. Push updates (WebSocket API or AppSync) are a T09 decision.

### 4. Database

| Option | Assessment |
|---|---|
| **DynamoDB (recommended)** | Truly serverless: on-demand, pay per request, and no VPC or connection pooling for Lambda. Streams power the async flow above. Access patterns are simple and known: profile by user, crawl requests by user, jobs by user and crawl, and deduplication through conditional writes. |
| Aurora PostgreSQL Serverless v2 | Flexible SQL and pgvector. It can scale to zero, but resuming takes seconds and the first request after idle is slow. Lambda needs the Data API or a VPC with RDS Proxy. It costs more at idle, and there is no stream to drive the queue. |

**Recommendation: DynamoDB.** The access patterns are designed per task. If T08 (relevance) needs vector search, that is decided there (for example S3 Vectors or a separate store). Access goes through a small repository layer in `packages/db`, so domain code does not depend on DynamoDB APIs directly.

Files (résumés) go to **S3** through presigned upload URLs. Files are never sent through the API.

### 5. API, auth, and UI hosting

- **API Gateway HTTP API** (cheaper and simpler than a REST API) with Lambda handlers. Validation uses Zod schemas shared from `packages/shared`.
- **Auth:** Amazon Cognito user pool with the HTTP API JWT authorizer. It is added when the first user-owned data arrives (T04 or T05).
- **UI:** React, Vite, and TanStack Query, served as static files from **S3 behind CloudFront**.

### 6. Infrastructure as code

| Option | Assessment |
|---|---|
| **AWS CDK in TypeScript (recommended)** | Same language as the app, first-party, and high-level constructs for Lambda, SQS, Pipes, DynamoDB, and CloudFront. |
| AWS SAM | Good for Lambda, but YAML and weaker for the wider stack. |
| Terraform or OpenTofu | Great multi-cloud tooling, but a second language, and we are AWS-only. |
| SST | Good developer experience, but newer versions are no longer CloudFormation or CDK-based, which adds another abstraction. |

### 7. CI/CD: GitHub Actions or AWS CodeBuild/CodePipeline

| Option | Assessment |
|---|---|
| **GitHub Actions with OIDC to AWS (recommended)** | The code, PRs, and required checks are already on GitHub. Standard runners are free for public repositories. OIDC lets a workflow assume a narrowly scoped IAM role, so no AWS keys are stored anywhere. GitHub Environments add a manual approval before production. |
| AWS CodeBuild / CodePipeline | Runs inside AWS, with VPC access and deeper AWS integration. It costs per build minute, is a second CI system alongside GitHub checks, and is less visible to open-source contributors. |

**Recommendation: GitHub Actions + OIDC.** Pull requests (including from forks) run tests only and never get AWS credentials. Deploys run only from `main` or through a protected GitHub Environment. If a build ever needs to run inside AWS, CodeBuild can be used as a GitHub Actions runner without changing workflows.

### 8. Repository layout

A pnpm workspace monorepo:

```text
apps/
  api/        Lambda handlers for API Gateway
  worker/     Lambda handlers for SQS (crawl, extract, relevance)
  web/        React and Vite UI (static, S3 + CloudFront)
packages/
  shared/     Zod schemas, types, constants
  db/         DynamoDB table design and repository layer
infra/        AWS CDK app (stacks per environment)
```

Testing: **Vitest** for unit tests. Integration tests run against a real deployed stack, and **Playwright** handles end-to-end later. Node 22 LTS on Lambda.

### 9. Development environments

- **Unit tests** run locally with no AWS access (handlers are tested with mocked AWS clients).
- **Personal dev stacks:** each developer deploys their own isolated copy (`cdk deploy` with a stage name, for example `dev-nava`). Serverless costs are close to zero when idle, and it tests real AWS behaviour instead of emulators.
- **Environments:** `dev` (auto-deploys from `main`) and `prod` (manual approval). The AWS account structure, Region, budgets, and alarms are set in T03.

## Open questions for alignment

1. TypeScript everywhere: **agreed** (2026-09-27).
2. Async: DynamoDB write → Stream → EventBridge Pipes → SQS → worker Lambda, with Step Functions as the upgrade path?
3. Database: DynamoDB instead of Aurora Serverless?
4. CI/CD: GitHub Actions with OIDC instead of CodeBuild/CodePipeline? (Maintainer delegated this choice.)

## Decision

Pending alignment.

## Done when

- [ ] A decision record is accepted.
- [ ] The repository layout (`apps/`, `packages/`, `infra/`) is agreed.
- [ ] `CLAUDE.md` is updated with the stack.
