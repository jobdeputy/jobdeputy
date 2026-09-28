# T04: Serverless backend skeleton (API, async pipeline, and worker)

- **Status:** planned
- **Depends on:** T03

## Goal

The serverless backbone from [0003](../decisions/0003-serverless-aws-stack.md) runs in each cell. A request to the API writes to DynamoDB, the Stream → EventBridge Pipes → SQS path delivers it, and a worker Lambda processes it to a final status. A test proves this end to end in `dev-us`.

## Scope

- In: the cell stack resources (HTTP API, API Lambda, DynamoDB table with Stream, EventBridge Pipe, SQS with dead-letter queue, worker Lambda with reserved concurrency), shared handler conventions (Zod validation, error format, structured logging with Powertools, idempotency), a sample "ping" job, and integration test setup against a deployed stack.
- Out: real authentication (T05), and crawl logic (T06).

## Research

To do. Includes the DynamoDB key design convention, the Pipe filter and batch settings, the dead-letter and redrive policy, and how integration tests locate a personal stack.

## Decision

Pending.

## Done when

- [ ] `POST /ping-jobs` returns a job ID immediately. The worker marks it `succeeded`, and a forced failure ends as `failed` with a reason after retries and lands in the dead-letter queue.
- [ ] A duplicate SQS delivery does not repeat side effects (idempotency test).
- [ ] The same stack synthesizes for every cell, and residency tests pass.
