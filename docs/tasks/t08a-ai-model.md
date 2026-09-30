# T08a: Platform AI model

- **Status:** planned
- **Depends on:** T08 ([0009](../decisions/0009-llm-architecture-and-own-keys.md))
- **Branch / PR:** —

## Goal

The platform model is chosen, runs in each user's Region, and has an approved cost. Decision 0010 records it.

## Scope

- In:
  - Compare models that run on Bedrock inside all three Regions, on relevance and extraction samples: quality, following the zod schema, speed, and price.
  - The guardrail exceptions in [0005](../decisions/0005-pre-launch-cost-guardrails.md): `bedrock:InvokeModel` on the one pinned model, and `kms:CreateKey` for [T08b](t08b-llm-foundation.md). The maintainer changes the policy in the management account.
  - Check whether the model needs a Marketplace subscription (the same policy denies `aws-marketplace:Subscribe`).
- Out: the user's own models (they pick those themselves; see [0009](../decisions/0009-llm-architecture-and-own-keys.md)).

## Research

First findings (2026-09-29, from `ListFoundationModels`, on-demand, in-Region):

- The cost policy `jd-cost-guardrails` denies `bedrock:*` in the Workloads accounts.
- No current Claude model runs inside us-east-1 or ap-south-1; there Claude is only reachable through `us.` or `global.` inference profiles, which send data to other Regions ([0004](../decisions/0004-regional-cells-and-data-residency.md)). eu-west-2 has Claude Sonnet 4.6 and Opus 4.6 in-Region.
- In all three Regions: gpt-oss-20b and gpt-oss-120b, Qwen3-32B, Ministral 3 (3B, 8B, 14B), Gemma 3, DeepSeek V3.2, and Titan Text Embeddings v2.
- Prices per million input / output tokens:

| Model | US | India | UK |
|---|---|---|---|
| gpt-oss-120b | $0.15 / $0.60 | $0.18 / $0.71 | $0.23 / $0.93 |
| gpt-oss-20b | $0.07 / $0.30 | $0.08 / $0.35 | $0.11 / $0.47 |
| Qwen3-32B | $0.15 / $0.60 | $0.18 / $0.71 | $0.23 / $0.93 |
| Ministral 3 14B | $0.20 / $0.20 | $0.24 / $0.24 | $0.31 / $0.31 |

- A first estimate: scoring 50 candidates in 5 calls costs about $0.015 at the UK price for gpt-oss-120b.

To do: test the candidates on samples, and estimate the monthly cost at the allowance (1 run per week, 4 per month per user).

## Decision

Pending (0010).

## Done when

- [ ] Decision 0010 is accepted, with the model ID, the price in each Region, and the monthly cost at the allowance.
- [ ] The guardrail exceptions are in place, and the guard tests in `infra/test/` allow exactly them.
- [ ] Docs and task status updated.
