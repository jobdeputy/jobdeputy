# T08b: LLM foundation, own keys, and token usage

- **Status:** in-progress (T08b1 done in #53; T08b2 in review in #54; next T08b3)
- **Depends on:** T08a ([0009](../decisions/0009-llm-architecture-and-own-keys.md))
- **Branch / PR:** T08b1 `t08b1-llm-package` (#53); T08b2 `t08b2-own-keys` (#54)
- **Files:** `packages/llm/src/`, `packages/llm/eval/`, `infra/lib/cicd-stack.ts`, `.github/workflows/nightly.yml`; T08b2: `apps/api/src/ai.ts`, `apps/worker/src/key-check-worker.ts`, `packages/db/src/ai-key-repository.ts`, `packages/llm/src/key-check.ts`, `infra/lib/keys-stack.ts`, `infra/lib/constructs/ai-keys.ts`

## Goal

Every LLM feature calls models through one package that enforces [0002](../decisions/0002-llm-loop-and-token-budget.md), uses the platform model or the user's own key, and records every token. Prompt quality is measured before a change merges.

## Scope

Three PRs, each working on its own (agreed 2026-09-29):

- **T08b1: `packages/llm`.**
  - `resolveModel` and `runTask` on `@strands-agents/sdk`: fixed limits, zod output, the best result marked `partial`, and no retries in Strands or in the provider clients. The platform model only; T08b2 adds the OpenAI and Anthropic providers.
  - A stub model for unit and integration tests.
  - The shared rules of [0010](../decisions/0010-platform-ai-model.md): data delimiters, the schema tool as the only tool, strict schemas, and a rejected-output count.
  - The platform model `mistral.ministral-3-14b-instruct` through Converse without streaming.
  - **Prompt quality:**
    - prompts are versioned (`relevance@v1`), and every result stores the prompt version and model. A test fails if a task's prompt, schema, or limits change without a new version (a fingerprint in `eval/versions.json`), or if a version has no baseline;
    - the eval harness moves from [#49](https://github.com/jobdeputy/jobdeputy/issues/49) into `packages/llm/eval`, with a golden-set format and a saved baseline;
    - a PR that changes a prompt, schema, or model runs the eval against the baseline, posts the comparison on the PR, and fails on a regression.
    - The golden set itself (100–200 real, anonymised, labelled jobs and about 20 real careers pages) grows with real crawls in T08d and T07d.
  - **Nightly real-model check:** one real call to the platform model (with an injection case). The dev CI role may invoke only that model. Nightly emails the result (pass or fail, tokens, time) every night, not only on failure.
- **T08b2: own keys** (details agreed with the maintainer on 2026-09-30).
  - The OpenAI and Anthropic providers in `resolveModel` (client retries off).
  - **KMS key in its own stack per cell** (`jobdeputy-<stage>-<cell>-keys`, kept on delete, rotation on). Deleting or replacing a cell stack must never make stored keys unreadable. The key's ARN is in SSM; the cell stack reads it. Personal and per-PR stacks use the shared dev key and never create one.
    - The dev keys stack is deployed once by hand; after that, Deploy dev (`--all`) keeps it up to date.
    - Not an AWS managed key: those are usable only by their AWS service, so anyone who can read the table would see keys in plain text. Not Secrets Manager: $0.40 per key per month.
  - **Keys** in the `ai-keys` table, encrypted by the API with the cell's KMS key (encryption context `userId` and `provider`).
    - Only the key API may encrypt, and only the key-check worker (and later the LLM workers) may decrypt.
  - **Routes:**
    - `PUT /me/ai-keys/{provider}` (`apiKey`, `modelId`, `consent: true`) and `GET /me/ai-keys` (provider, last 4 characters, model, status, when checked);
    - `POST /me/ai-keys/{provider}/check` and `DELETE /me/ai-keys/{provider}`;
    - audit entries never contain the key.
  - **Checked asynchronously:** saving or re-checking a key sets `status: checking`. The table stream starts the key-check worker, which decrypts the key and makes one call of at most 1 output token. The status becomes `valid` or `invalid` (with a reason).
  - **At most 5 key checks per user per day,** counted exactly in `usage`, so nobody can use the app to test stolen keys.
  - **A dev-only `stub` provider** for integration tests: a key ending in `-valid` passes, anything else fails, and no call leaves AWS. The real providers are unit-tested with fake clients.
  - **AI settings:** `GET/PUT /me/ai-settings` (`defaultSource`: `platform` or a provider with a saved key). `POST /me/crawls` takes an optional `aiSource`, stored on the crawl for T08d; an own key must be saved and not invalid. Deleting the default key resets the default to `platform`.
  - Account deletion removes `ai-keys`. Update `data-model.md`, `code-map.md`, and the account-deletion runbook.
- **T08b3: allowance and usage.**
  - The platform allowance (1 run per week, 4 per month), counted exactly in `usage` in the transaction that starts a run. Its limits live in SSM next to the crawl limits.
  - Token usage in `usage`: per month, key source, provider, model, and task. Also recorded on each run.
  - `GET /me/ai-usage`.
  - CloudWatch metrics per task, model, and prompt version, without user IDs: schema failures, grounding rejections, partial results, timeouts, tokens, latency, score spread. A dashboard and alarms.
- Out:
  - Google and Bedrock API keys (later).
  - Costs in the usage response ([#47](https://github.com/jobdeputy/jobdeputy/issues/47)).
  - Model fine-tuning (it needs provisioned throughput).
  - Hosted LLM observability (residency).
  - How well prompts and models work on live data: research in [T08e](t08e-live-effectiveness.md).

## Research

Strands 1.19, tested on 2026-09-29 with a stub model (a subclass of `Model` that returns scripted replies):

- **`limits.turns: 3`** allows at most 3 model calls. Invalid output (a wrong type, or an extra field under `.strict()`) goes back to the model as an error, and the model tries again. After 3 invalid replies, the result has `stopReason: 'limitTurns'` and no output.
- **A reply with text only:** Strands forces the schema tool once, then throws `StructuredOutputError` after 2 calls. `runTask` catches it.
- **Token limits are checked between calls, not during one:** a 320-token cap stopped at 350. So each call also gets a `maxTokens` limit, which makes the worst case 3 × `maxTokens` output tokens per task call.
- **`cancelSignal`** reaches the Bedrock, OpenAI, and Anthropic clients. A model that ignores it runs to the end, so the Lambda timeout is the last backstop.
- **Bundle size:** Strands with the Bedrock, Anthropic, and OpenAI providers is 1.76 MB minified (470 KB gzipped).
- **Eval harness:** we build our own, because it must use `runTask` (the real schema-tool path). promptfoo adds a large dependency tree and sends telemetry by default.

## Decision

See [0009](../decisions/0009-llm-architecture-and-own-keys.md). The split into three PRs, the shared KMS key, the harness, and the nightly email were agreed with the maintainer on 2026-09-29.

## Done when

- [x] T08b1: a test with a stub model that never finishes shows the loop stops at 3 and returns the best result.
- [x] T08b1: a fixed worst-case number of calls and tokens per task call, stated in the PR.
- [x] T08b1: the eval runs through `runTask`, compares against a baseline, and fails on a regression.
- [x] T08b1: Nightly runs one real-model check and emails the result every night.
- [x] T08b2: keys are never returned, logged, or audited. IAM is proven with `simulate-principal-policy`: only the key routes encrypt, and only the LLM workers decrypt.
- [ ] T08b3: the allowance holds under concurrent runs (exact caps).
- [ ] T08b3: usage shows each model separately; metrics, a dashboard, and alarms are in place.
- [ ] Integration uses the stub model.
