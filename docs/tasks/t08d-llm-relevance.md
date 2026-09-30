# T08d: LLM relevance scoring

- **Status:** planned
- **Depends on:** T08b, T08c
- **Branch / PR:** —

## Goal

Candidate jobs get a score and a short reason from an LLM, in their own queue and worker.

## Scope

- In:
  - The `relevance` task in `packages/llm`, and a relevance queue and worker fed by crawls with candidates.
  - Descriptions fetched for candidates only through the board's single-posting endpoint; a posting that answers 404 or 410 closes the job ([T08 carried over](t08-relevance-filter.md#carried-over-from-t07)).
  - The per-company limit re-ranked by score.
  - The run uses the user's choice (platform or their own key) and counts against the allowance ([0009](../decisions/0009-llm-architecture-and-own-keys.md)).
  - The prompt-injection rules of [0010](../decisions/0010-platform-ai-model.md): exactly the given job IDs back, once each, and injection cases in the tests.
  - **Alarms:** after T08b2, shared dev uses all 10 free CloudWatch alarms. Before adding the relevance queue, merge alarms (for example one metric-math alarm over every dead-letter queue), so no new alarm costs money ([0005](../decisions/0005-pre-launch-cost-guardrails.md)).
  - **Use T08b3's parts:** `aiUsageUpdate` in the transaction that stores each result (so a retry never counts twice, `runs: 1` on the run's first call), `recordTaskMetrics` after each task call (with `groundingRejections` and `scoreSpread`), `llmMetricsEnvironment(stage)` on the worker, and the crawl's `llm {keySource, provider, model, calls, inputTokens, outputTokens}`. A platform run was already counted at submit (`crawls.aiRun`).
  - A crawl's `aiSource` (T08b2) picks the model. If its key is missing or invalid, the AI work stops with that reason; it never falls back to the platform model silently.
- Out: ranking for application materials (later).

## Done when

- [ ] Relevance is tested with synthetic profiles and jobs and a stub model, including edge cases.
- [ ] Each stored job shows why it matched.
- [ ] A fixed worst-case number of calls per crawl, stated in the PR.
