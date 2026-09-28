# T04: Serverless backend skeleton (API, async pipeline, and worker)

- **Status:** in-review
- **Branch / PR:** `t04-backend-skeleton`
- **Depends on:** T03

## Goal

The serverless backbone from [0003](../decisions/0003-serverless-aws-stack.md) runs in each cell. A request to the API writes to DynamoDB, the Stream → EventBridge Pipes → SQS path delivers it, and a worker Lambda processes it to a final status. A test proves this end to end in `dev-us`.

## Scope

- In: the cell stack resources (HTTP API, API Lambda, DynamoDB table with Stream, EventBridge Pipe, SQS with dead-letter queue, worker Lambda with reserved concurrency), shared handler conventions (Zod validation, error format, structured logging with Powertools, idempotency), a sample "ping" job, and integration test setup against a deployed stack.
- Out: real authentication (T05), and crawl logic (T06).

## Research

Constraints already decided: [0002](../decisions/0002-llm-loop-and-token-budget.md), [0003](../decisions/0003-serverless-aws-stack.md) (the async path), [0004](../decisions/0004-regional-cells-and-data-residency.md) (cells), and [0005](../decisions/0005-pre-launch-cost-guardrails.md) (cost). This task only picks the details.

### Findings that change the plan

1. **The dev account's Lambda concurrency limit is 10** (checked with `aws lambda get-account-settings`). AWS requires at least 10 to stay unreserved, so **reserved concurrency cannot be set at all**. Instead, cap the worker with the SQS event source's **maximum concurrency** (minimum 2). This is also the AWS-recommended way to cap SQS consumers, because it avoids throttled messages bouncing into the dead-letter queue. A raise to 1,000 can be requested for free later if needed.
2. **The EventBridge Pipes L2 construct is still alpha** (`@aws-cdk/aws-pipes-alpha` 2.271.0-alpha.0). Stable `aws-cdk-lib` has only the L1 `CfnPipe`. Recommendation: use `CfnPipe` behind our own small construct. It avoids an alpha dependency that can break on upgrades, and a Pipe is only about 30 lines of L1 code.
3. **Every write fires the stream**, including the worker's own status updates. The Pipe filter must pass only new requests (`eventName = INSERT` and `status = queued`). Filtered-out events are not billed by Pipes.

### 1. DynamoDB key design

| Option | Assessment |
|---|---|
| **One table per cell, generic keys `pk`/`sk` (recommended)** | One stream and one Pipe per cell. Entities use prefixes, for example `pk=USER#<id>`, `sk=CRAWL#<id>`. Indexes are added per feature. T04 adds a `ping` entity only. |
| One table per entity | Easy to read, but each table needs its own stream and Pipe, so more resources and more wiring per feature. |

Conventions:

- Every item has `pk`, `sk`, `type` (entity name), `createdAt`, and `updatedAt`. Temporary items get a `ttl` attribute; ping jobs expire after 7 days.
- IDs use `crypto.randomUUID()` (built into Node, no dependency).
- Stream view `NEW_IMAGE`. Point-in-time recovery is off in dev and on in prod (it stays in the same Region).
- All access goes through `packages/db` (0003).

### 2. Pipe and SQS settings

- **Pipe source:** the table's stream, starting position `TRIM_HORIZON` (changed from `LATEST` during implementation: `LATEST` lost a request written while the Pipe was starting), batch size 1 (each request is its own message), and a filter on `INSERT` with `status = queued`. Two retries, then the record goes to the dead-letter queue.
- **Pipe target:** the jobs queue. An input template sends only `{ "type", "id", "pk", "sk" }`, never the full item, so no user data sits in queue messages.
- **Jobs queue:** SQS-managed encryption (free). Visibility timeout is 6 × the worker timeout, as AWS recommends. **3 receives, then the dead-letter queue.** This matches the "max 3" rule.
- **Dead-letter queue:** one per cell, messages kept 14 days. The CloudWatch alarm "DLQ not empty" is within the free tier (10 alarms). Failed messages are redriven with the built-in SQS redrive button; no custom code.

### 3. Worker behaviour, failures, and retries

- A Powertools batch processor gives **partial batch responses**, so one bad message does not retry the others.
- Status moves `queued → running → succeeded | failed` with **conditional writes**. An update never goes backwards, and an item that already finished is skipped.
- **Failure:** each failed attempt records `lastError`. On the 3rd receive (`ApproximateReceiveCount`), the worker sets `status = failed` with the reason, then throws so SQS moves the message to the dead-letter queue. That meets the done criterion.
- **Timeout safety:** the worker stops work when less than 5 seconds remain, so a timeout is recorded as a failure instead of leaving the item stuck in `running`. A reaper for stuck items is not needed yet; it is revisited in T06.
- The ping job has a `fail: true` test flag to force failure. The flag is accepted only when the stage is `dev`.

### 4. Idempotency

| Option | Assessment |
|---|---|
| **Powertools idempotency, separate small table with TTL (recommended)** | This is the standard pattern named in 0003. The key is the job ID, records expire after 1 hour, and the table is on-demand and free when idle. A separate table keeps its records out of the main table's stream. |
| Powertools idempotency in the main table | One fewer table, but every idempotency write fires the stream and the Pipe filter has to discard it. |
| Conditional writes only | Enough for status changes, but not for side effects such as an HTTP call or an LLM call. That is where T06 needs it. |

Test: deliver the same SQS message twice and assert that the side effect ran once. The ping side effect increments a counter on the item.

### 5. API conventions

- **Validation:** Zod 4 (`zod` 4.6.5) at every handler boundary.
- **Error format:** RFC 9457 `application/problem+json`. Internal details are never returned; they are logged with the request ID.
- **Logging:** Powertools Logger (2.35.0), JSON, with request and job IDs. INFO by default, 14-day log retention (0005). Request bodies are never logged.
- **Routes:** `POST /ping-jobs` returns `202 { id, status: "queued" }`. `GET /ping-jobs/{id}` returns the status.
- **Auth until T05:** routes use **IAM authorization** (SigV4). They are not public, so nobody can run up costs before Cognito exists. Integration tests sign requests with the developer's AWS profile. T05 swaps to the Cognito JWT authorizer.
- **Throttling on dev:** 5 requests per second, burst 10.
- **Lambda:** Node 22 on ARM64 (about 20% cheaper), bundled by the CDK `NodejsFunction` with esbuild (already approved). API timeout 10 seconds, worker timeout 30 seconds.

### 6. Code layout (from 0003)

```text
apps/api        HTTP handlers (ping-jobs create/get)
apps/worker     SQS worker (ping job)
packages/shared Zod schemas, problem+json errors, logger setup
packages/db     table client and ping repository
infra/          cell stack: table, idempotency table, API, Pipe, queues, alarm
```

### 7. How integration tests find a stack

| Option | Assessment |
|---|---|
| **Read CloudFormation outputs by stack name (recommended)** | Tests take `JD_STACK` (default `jobdeputy-dev-<owner>-iad`) and the AWS profile, then call `DescribeStacks` for the API URL. Nothing is written to disk and nothing can go stale. |
| `cdk deploy --outputs-file` | Writes a local JSON file, which drifts when someone deploys from another machine. |

- `pnpm test` stays unit-only and needs no AWS. A new `pnpm test:integration` runs against a deployed stack.
- **PRs never get AWS credentials** (0003), so the PR proof is a local run against the developer's personal stack. The dev deploy workflow runs the integration tests against `jobdeputy-dev-iad` after every deploy to `main`.

### Cost

Nothing costs money while idle. Per ping: API Gateway $1 per million requests, Lambda within the free tier, DynamoDB on-demand fractions of a cent, Pipes $0.40 per million, and SQS within the free tier. One alarm is within the free tier. **Expected: $0.00 per month in dev.**

### Open questions

1. Is IAM auth on the ping routes until T05 OK? The alternative is leaving the routes open with throttling only; that is cheaper to test but anyone could call them.
2. Is 3 SQS receives before the dead-letter queue OK? Everything else follows from it.
3. The "DLQ not empty" alarm: should it only show in the console for now, or email you through a free SNS topic?

## Decision

Agreed with the maintainer on 2026-09-28:

- **Data model:** [0006](../decisions/0006-data-model.md) (15 tables per cell, one per category), with the living schema in [docs/data-model.md](../data-model.md). Research option 1 above (one generic table) was replaced by this. T04 builds only `ping-jobs` and `idempotency`.
- **Async path:** as researched. The Pipe (L1 `CfnPipe`) passes only `INSERT` with `status = queued` and sends IDs only. The worker is capped by SQS event source maximum concurrency 2 (reserved concurrency is impossible at the account limit of 10).
- **Retries:** 3 SQS receives, then the dead-letter queue. The 3rd failure marks the item `failed` with the reason.
- **Idempotency:** Powertools with its own table, plus conditional status writes.
- **Auth:** IAM authorization on the ping routes until Cognito arrives in T05, which now starts with sign-up and sign-in.
- **Alarm:** "dead-letter queue not empty" alarm emails the maintainer through an SNS topic. The email address comes from the `JD_ALERT_EMAIL` environment variable (a GitHub secret in CI), never from the repository.
- **Integration tests:** find the stack by name through CloudFormation outputs; `pnpm test:integration` runs locally against a personal stack and in the dev deploy workflow after each deploy.

## Done when

- [x] `POST /ping-jobs` returns a job ID immediately. The worker marks it `succeeded`, and a forced failure ends as `failed` with a reason after retries and lands in the dead-letter queue.
- [x] A duplicate SQS delivery does not repeat side effects (idempotency test).
- [x] The same stack synthesizes for every cell, and residency tests pass.
