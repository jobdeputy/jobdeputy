# 0009: LLM architecture: Strands agents, the user's own keys, and token usage

- **Status:** Accepted
- **Date:** 2026-09-29
- **Task:** t08
- **Amends:** [0005](0005-pre-launch-cost-guardrails.md) (a KMS key per cell; Bedrock calls to one pinned model, decided in [T08a](../tasks/t08a-ai-model.md)), [0006](0006-data-model.md) (`ai-keys` table; AI usage counters replace `MONTH#` `llmCalls`, `inputTokens`, `outputTokens`)

## Context

T08 (relevance), T07d (LLM extraction), and later tailoring and applications all call LLMs. Before building the first one, we need one way of calling models that:

- follows [0002](0002-llm-loop-and-token-budget.md) (at most 3 iterations, capped tokens and calls, best result returned);
- lets users bring their own keys (BYOT) from the start;
- keeps the platform's own model in the user's Region ([0004](0004-regional-cells-and-data-residency.md)) and its cost bounded ([0005](0005-pre-launch-cost-guardrails.md));
- records every token used, per user and per model, and shows it to the user.

Which platform model to use is a separate decision ([T08a](../tasks/t08a-ai-model.md)).

## Options considered

1. **Strands Agents TypeScript SDK** (`@strands-agents/sdk`, Apache-2.0, Node 22 or later, zod 4). It has model providers for Bedrock, OpenAI, Anthropic, Google, and the Vercel AI SDK, each taking its own key or client. Each call can take `limits` (`turns`, `outputTokens`, `totalTokens`), a `cancelSignal` (timeout), a zod `structuredOutputSchema`, and a `retryStrategy`, and `agent.metrics` reports turns and tokens. It also supports tools and multi-agent work for phase 2 (applications).
2. **Each provider's own SDK behind our own interface.** Fewer dependencies, but we would rebuild limits, structured output, and tool loops, once per provider.
3. **Vercel AI SDK.** A good provider layer, but it has no agent features, and the maintainer chose Strands.

## Decision

**Option 1, Strands.** The key points:

1. **One package, `packages/llm`, is the only code that imports Strands.**
   - `resolveModel(run)` returns a Strands model for the run: the platform model on Bedrock in the user's Region, or the user's own provider, model, and key.
   - `runTask(task, input, run)` runs an agent with fixed limits: `turns` at most 3, output and total token caps, a timeout, and the task's zod schema. At a limit, it returns the best result so far marked `partial` with a reason. Strands' own retries are off (`retryStrategy: null`); the queue owns retries, and a retried message never repeats a finished call ([0002](0002-llm-loop-and-token-budget.md) rule 3).
   - A task is a prompt, a zod schema, and its limits: `relevance` (T08), `extraction` (T07d), and later `tailoring`. Page text inside a prompt is data only, never instructions.
   - Each task has its own queue and worker, so a slow or failing model never breaks crawling.
2. **Users bring their own keys.** OpenAI and Anthropic first; Google and Bedrock API keys later.
   - A user saves one key per provider, picks the model for it, and chooses a default: the platform model or one of their keys. Each run (for example, a crawl) can use a different choice.
   - When a key is saved, one small test call checks it. The key is never returned or logged; the API shows only its last 4 characters and whether it works.
   - A key the provider rejects (401 or 403) is marked `invalid`, and the run stops with that reason. It never falls back to the platform model silently.
   - With their own key, the user's job data goes to that provider, outside our Region. The app says so and asks for consent when the key is saved ([0004](0004-regional-cells-and-data-residency.md)).
   - A key is used only for runs the user started ([0002](0002-llm-loop-and-token-budget.md) rule 5).
3. **Keys are stored encrypted in DynamoDB** (table `ai-keys`, one item per user and provider), encrypted with the cell's KMS key using `userId` and `provider` as the encryption context. Only the key routes may encrypt, and only the LLM workers may decrypt. The table is a user table, so deleting the account deletes the keys. Cost: about $1 per month per KMS key, plus $0.03 per 10,000 requests.
4. **Platform model allowance:** a user may start at most **1 platform AI run per week and 4 per month** (ISO weeks and calendar months, UTC).
   - An AI run is all the LLM work of one crawl, over its whole life cycle (reading jobs, scoring, fetching descriptions), end to end. Each task call still has its own call and token caps ([0002](0002-llm-loop-and-token-budget.md)).
   - **Amended by T08b3 (2026-09-30):** the run is counted when the user submits a crawl with the platform model, in `usage`, in the crawl request transaction, with exact caps like the crawl limits. A crawl that fails before its AI work gives the run back.
   - With the allowance used up, a crawl with the platform model is refused (429 `platform-ai-limit-reached`, with when the next free run is available). The user can crawl with their own key, or with `aiSource: none` (the free keyword filter only). Previously this said the run would continue with the code filter only; the maintainer chose to refuse it up front instead, so it is clear before the crawl.
   - Runs with the user's own key do not count against it.
   - The limits live in SSM next to the crawl limits. Premium quotas are decided later ([#47](https://github.com/jobdeputy/jobdeputy/issues/47)).
5. **All token use is recorded, for every user and every run:**
   - per month, per key source (platform or own), provider, and model: calls, input tokens, output tokens, and runs, with the same broken down per task;
   - on each run (for example, the crawl): the model, calls, and tokens;
   - `GET /me/ai-usage?month=` returns these per model, so a user with several models sees each separately, plus the platform runs left this week and month. The first version shows tokens, not costs.
   - Platform-wide totals are CloudWatch metrics by task, provider, model, and key source, without user IDs ([0004](0004-regional-cells-and-data-residency.md): aggregated, non-personal).

## Why

- Strands already enforces most of [0002](0002-llm-loop-and-token-budget.md) and supports several providers, so BYOT is a model choice, not new code for each provider.
- One package makes the limits and usage tracking impossible to skip.
- A KMS key per cell ties each stored key to its user and gives exact least-privilege access: only the key routes can encrypt and only the LLM workers can decrypt.
- A small platform allowance lets users without a key try the product while keeping platform cost predictable.

## Consequences

- New dependency: `@strands-agents/sdk`. Only the needed providers are bundled. Pinned and updated like other dependencies.
- The cost guardrails need two exceptions, made by the maintainer in the management account: `kms:CreateKey`, and `bedrock:InvokeModel` for the one pinned model ([T08a](../tasks/t08a-ai-model.md)). A KMS key costs $1 per month and waits 7 to 30 days before deletion, so per-PR stacks must not create one each ([T08b](../tasks/t08b-llm-foundation.md) decides how they share one).
- Integration tests on every PR use a stub model and never call a paid model. Nightly runs one check against the real platform model.
- Costs are shown later, once the prices per model are kept up to date.
- The data model gains `ai-keys` and the AI usage items; [data-model.md](../data-model.md) is updated when they are built.
