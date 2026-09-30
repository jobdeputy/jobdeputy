# Testing

Three layers, each with one job. A case is tested at the **lowest layer that can prove it**.

| Layer | Where | Runs | Covers | Aim |
|---|---|---|---|---|
| **Unit** | `*/test/*.test.ts` | Every PR (`pnpm verify`), no AWS | Every branch of the logic: valid and invalid input, each error path, retries, timeouts, duplicates, limits. Dependencies are faked. | **As thorough as possible.** Fast (seconds) and deterministic. |
| **Infrastructure** | `infra/test/` | Every PR, no AWS | The synthesized CloudFormation: Region and cost guards, auth on every route, queue and retry settings, filters, alarms. | Every setting a decision record depends on. |
| **Integration** | `tests/integration/` | Against a deployed stack (see below) | Only what needs real AWS: wiring between services, IAM permissions, event flow, retries and dead-lettering end to end, and the deployed contract. | **Balanced: few, meaningful, and never flaky.** |

## What belongs in integration tests

Per feature, usually:

- **One happy path** through the deployed flow.
- **One failure path** that proves failures end in a clear state (and dead-letter where relevant).
- **Security wiring** that only AWS enforces (for example, an unsigned or unauthenticated request is rejected).
- **Cross-service behaviour** a unit test fakes (for example, duplicate delivery through the real queue).

**Not** in integration tests: input-validation permutations, error-message wording, or business-rule edge cases. Those are unit tests. If a new integration test only repeats a unit test through HTTP, remove it.

Crawl tests fetch only the stack's own **dev-only test site** (`GET /test-site/{page}` on a separate small API, output `TestSiteUrl`; no token, never deployed to prod, watched by no alarm, so its deliberate 503 page never pages anyone), never someone else's site, so they do not depend on or burden anyone else. They poll one list call for all their crawls, to stay well within the dev API's throttle.

**Concurrency** (`concurrency.test.ts`): only real DynamoDB shows transaction conflicts, so requests sent at the same moment (parallel crawl submits, the same page twice, a double-clicked save, two first uploads, two default switches, creates at the role and résumé caps) are tested on the deployed stack. None may return a 5xx, and every cap and "exactly one" rule must hold.

## Rules against flaky tests

1. **Never sleep for a fixed time.** Poll for an observable fact (a status, a counter) with `waitFor`.
2. **Generous timeouts.** A new stack's Pipe can take minutes to start. Timeouts are minutes, not seconds; a passing test finishes as soon as the fact is true, so the buffer costs nothing.
3. **Each test creates its own data** (new IDs) and never depends on another test or on leftover data.
4. **Clean up what you read from shared queues** (for example, delete the dead-letter message you found).
5. **A flaky test is a bug.** Fix it or delete it in the next PR; never retry a whole suite to make it pass.

## Regressions

Every feature PR adds integration tests for its own feature, and the **whole** suite runs each time, so earlier features are re-checked by every change. Existing tests are only changed when behaviour is meant to change, and the PR says why.

## LLM tasks

- Unit and integration tests use the stub model (`@jobdeputy/llm/testing`) and never call a paid model. Every task has prompt-injection cases ([0010](decisions/0010-platform-ai-model.md)).
- **Eval against the real model:** `AWS_PROFILE=jobdeputy-dev-iad pnpm --filter @jobdeputy/llm eval`. It compares the result with the saved baseline for the prompt version (`packages/llm/eval/baselines/<task>@v<N>.json`) and fails on a regression; any successful injection always fails.
  - Integration runs it on a PR that changes `packages/llm` or the model ID, and posts the result on the PR.
  - Nightly runs it once and emails the result.
- **Prompt versions:** a change to a task's system prompt, prompt, schema, or limits needs a new `version`. `test/versions.test.ts` compares each task's fingerprint with `packages/llm/eval/versions.json` and fails with the line to add. Keep old entries.
- **A new prompt version** starts without a baseline, and the same test fails until it has one. Save one with `--update-baseline` in the same PR, and say in the PR how it compares with the previous version. Never update a baseline to hide a regression.

## Test data clean-up

- Each test user is deleted through `DELETE /me`, which erases all of its data. If that fails, the login is still removed and the run fails (`tests/integration/src/cleanup.ts`).
- PR stacks are deleted whole. The shared dev and personal stacks also run a daily reaper that requests deletion of stale test logins and orphaned data ([runbook](runbooks/account-deletion.md)).

## Running

| Command | What |
|---|---|
| `pnpm verify` | Lint, typecheck, unit and infrastructure tests |
| `JD_OWNER=<you> JD_FULL=1 AWS_PROFILE=jobdeputy-dev-iad pnpm test:integration` | Integration tests against your personal stack; `JD_FULL=1` adds the queue-level tests |

The full suite (`JD_FULL=1`) runs automatically:

- **Every night** against the shared dev stack, even with no code changes (T13). A failure emails the alert list ([alarms runbook](runbooks/alarms.md)).

- **On every PR, before merge** (required check **Integration**, T11). Dependabot PRs run only after a maintainer adds the `safe-to-test` label ([CONTRIBUTING.md](../CONTRIBUTING.md#integration-tests-on-prs)): the PR's code is deployed to its own stack `jobdeputy-dev-pr<N>-iad`, tested, and deleted. PRs that change only Markdown pass without deploying, and a push that changes only Markdown **reuses** the previous commit's passing result instead of running again (the code is identical). PRs from forks get no AWS access; a maintainer pushes the branch to this repo after review.
- **After every merge to `main`**, against the shared `jobdeputy-dev-iad`.

The CI roles that run these tests can do only what the tests need (`infra/lib/cicd-stack.ts`): read stack outputs, manage throwaway test users, send to and clear the stack's queues, and (dev only, T07c) `PutItem`/`UpdateItem` on the tested stacks' `-jobs` and `-sources` tables, to seed data no test page can produce, such as a job a page listed before. They never read or delete table data, and the prod role gets none of this.

Leftover PR stacks are deleted when the PR closes, and a daily job deletes any older than 24 hours.
