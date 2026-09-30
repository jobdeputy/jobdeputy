# T08b: LLM foundation, own keys, and token usage

- **Status:** planned
- **Depends on:** T08a ([0009](../decisions/0009-llm-architecture-and-own-keys.md))
- **Branch / PR:** —

## Goal

Every LLM feature calls models through one package that enforces [0002](../decisions/0002-llm-loop-and-token-budget.md), uses the platform model or the user's own key, and records every token.

## Scope

- In:
  - `packages/llm` on `@strands-agents/sdk`: `resolveModel` and `runTask`, fixed limits, zod output, best result marked `partial`, no Strands retries.
  - Own keys for OpenAI and Anthropic: the `ai-keys` table, the cell's KMS key (encryption context `userId` and `provider`), and routes to save, check, delete, and list keys (last 4 characters and status only), with audit entries that never contain the key. The consent to send job data to the provider.
  - AI settings: the default model source (platform or a key), and a choice per run.
  - The platform allowance (1 run per week, 4 per month), counted exactly in `usage` in the transaction that starts a run; limits in SSM next to the crawl limits.
  - Token usage: per month, key source, provider, model, and task in `usage`; on each run; `GET /me/ai-usage`; CloudWatch metrics without user IDs.
  - How per-PR stacks share one KMS key instead of creating one each.
  - The platform model `mistral.ministral-3-14b-instruct` through Converse without streaming ([0010](../decisions/0010-platform-ai-model.md)); the worker role may invoke only that model. The shared rules of 0010 (data delimiters, the schema tool as the only tool, strict schemas, the rejected-output metric).
  - Account deletion removes `ai-keys`; `data-model.md`, `code-map.md`, and the account-deletion runbook updated.
- Out: Google and Bedrock API keys (later); costs in the usage response ([#47](https://github.com/jobdeputy/jobdeputy/issues/47)).

## Research

To do: Strands details (bundle size in Lambda, how limits end a structured-output call, stub model for tests).

## Decision

See [0009](../decisions/0009-llm-architecture-and-own-keys.md).

## Done when

- [ ] A test with a stub model that never finishes shows the loop stops at 3 and returns the best result.
- [ ] A fixed worst-case number of calls per run, stated in the PR.
- [ ] Keys are never returned, logged, or audited; IAM proven with `simulate-principal-policy` (only the key routes encrypt, only the LLM workers decrypt).
- [ ] The allowance holds under concurrent runs (exact caps).
- [ ] Usage shows each model separately.
- [ ] Integration uses the stub model; Nightly runs one real-model check.
