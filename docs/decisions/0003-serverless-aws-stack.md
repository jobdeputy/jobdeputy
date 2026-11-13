# 0003: Serverless AWS stack, async backbone, and CI/CD

- **Status:** Accepted
- **Date:** 2026-09-27
- **Task:** t02

## Context

JobDeputy needs an API, asynchronous workers (crawl URLs, extract and filter jobs), storage for profiles, résumés, and jobs, a web UI, infrastructure as code, and CI/CD. The maintainer requires everything to run on AWS serverless services. Full research: [T02](../tasks/t02-stack-and-async-backbone.md).

## Decision

| Area | Choice |
|---|---|
| Language | TypeScript everywhere (Node 22 LTS) |
| API | API Gateway HTTP API → Lambda handlers, Zod validation |
| Async backbone | API Lambda writes the request to DynamoDB (`status=queued`) → DynamoDB Stream → EventBridge Pipes → SQS (dead-letter queue, capped concurrency) → worker Lambda |
| Status | Polling `GET /crawl-requests/{id}` (API Gateway → Lambda → DynamoDB). Push updates are decided in T09. |
| Multi-step upgrade | When a pipeline needs several steps or bounded LLM loops, the Pipe targets a Step Functions workflow instead of SQS. The API and data model stay the same. |
| Database | DynamoDB on-demand, accessed only through a repository layer in `packages/db` |
| Files | S3 with presigned uploads |
| Auth | Amazon Cognito and the HTTP API JWT authorizer |
| UI | React, Vite, and TanStack Query on S3 and CloudFront |
| Infrastructure as code | AWS CDK in TypeScript |
| CI/CD | GitHub Actions with OIDC to AWS: no stored keys, PRs never get AWS credentials, deploys only from `main`, and production behind a GitHub Environment approval |
| Tests | Vitest for unit tests; integration tests against real deployed stacks; Playwright end-to-end tests later |
| Environments | Personal dev stacks per developer, a shared `dev` deployed automatically from `main`, and `prod` deployed with manual approval |
| Repository | pnpm monorepo: `apps/api`, `apps/worker`, `apps/web`, `packages/shared`, `packages/db`, `infra/` |

## Why

- **Only the database write commits a request.** The stream drives the queue, so a request is never lost or double-queued, and there is no outbox code.
- **SQS** adds buffering, dead-lettering, retries, and a concurrency cap that protects target sites and users' tokens.
- **DynamoDB** is fully serverless for Lambda (no VPC, no connection pool, no cold resume), and the known access patterns fit it.
- **One language and first-party AWS tooling** keep the repository simple for contributors and agents.
- **GitHub Actions** is where our PRs and checks already live, is free for public repositories, and OIDC avoids long-lived AWS keys.

## Consequences

- DynamoDB access patterns must be designed per feature. Ad-hoc queries and vector search need a separate decision (T08 at the earliest).
- Workers must be idempotent (Powertools for AWS Lambda idempotency), because SQS delivers at least once.
- Lambda runs for 15 minutes at most. Long or browser-based crawls may need a container Lambda or Fargate through Step Functions (T06).
- Contributors need their own AWS account for integration tests. Unit tests need none.
- Rejected: Postgres with pg-boss, and Redis with BullMQ (not serverless); Aurora Serverless v2 (slow resume, idle cost, VPC complexity); CodeBuild/CodePipeline (a second CI system, with no need to build inside AWS); SAM, Terraform, and SST (see T02).
