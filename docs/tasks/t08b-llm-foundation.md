# T08b: LLM foundation, own keys, and token usage

- **Status:** in-progress (T08b1)
- **Depends on:** T08a ([0009](../decisions/0009-llm-architecture-and-own-keys.md))
- **Branch / PR:** T08b1 `t08b1-llm-package` (#53)
- **Files:** `packages/llm/src/`, `packages/llm/eval/`, `infra/lib/cicd-stack.ts`, `.github/workflows/nightly.yml`

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
    - prompts are versioned (`relevance@v1`), and every result stores the prompt version and model;
    - the eval harness moves from [#49](https://github.com/jobdeputy/jobdeputy/issues/49) into `packages/llm/eval`, with a golden-set format and a saved baseline;
    - a PR that changes a prompt, schema, or model runs the eval against the baseline, posts the comparison on the PR, and fails on a regression.
    - The golden set itself (100–200 real, anonymised, labelled jobs and about 20 real careers pages) grows with real crawls in T08d and T07d.
  - **Nightly real-model check:** one real call to the platform model (with an injection case). The dev CI role may invoke only that model. Nightly emails the result (pass or fail, tokens, time) every night, not only on failure.
- **T08b2: own keys.**
  - The OpenAI and Anthropic providers in `resolveModel` (client retries off).
  - OpenAI and Anthropic keys in the `ai-keys` table, encrypted with the cell's KMS key (encryption context `userId` and `provider`).
  - Routes to save, check, delete, and list keys (last 4 characters and status only). Audit entries never contain the key.
  - Consent to send job data to the provider.
  - AI settings: the default model source (platform or a key), and a choice per run.
  - The shared dev cell creates the KMS key and publishes its ARN in SSM. Per-PR stacks read that ARN and never create a key.
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
- [ ] T08b2: keys are never returned, logged, or audited. IAM is proven with `simulate-principal-policy`: only the key routes encrypt, and only the LLM workers decrypt.
- [ ] T08b3: the allowance holds under concurrent runs (exact caps).
- [ ] T08b3: usage shows each model separately; metrics, a dashboard, and alarms are in place.
- [ ] Integration uses the stub model.
