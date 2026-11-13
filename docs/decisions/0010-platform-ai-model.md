# 0010: Platform AI model and prompt-injection rules

- **Status:** Accepted
- **Date:** 2026-09-29
- **Task:** t08a
- **Amends:** [0005](0005-pre-launch-cost-guardrails.md) (the cost guardrails allow `bedrock:InvokeModel` on the pinned model only, and `kms:CreateKey`)

## Context

[0009](0009-llm-architecture-and-own-keys.md) runs every LLM task through Strands, with either the platform model or the user's own key. The platform model must:

- run inside the user's Region (us-east-1, ap-south-1, eu-west-2; [0004](0004-regional-cells-and-data-residency.md));
- be the cheapest model that is good enough for relevance (T08) and extraction (T07d);
- work with Strands' structured output, which asks for the zod schema as a tool call and forces the tool if the model answers in plain text (many Bedrock models reject a forced tool choice);
- need no Marketplace subscription (the guardrails deny it).

Pages and job descriptions come from the web, so they can contain instructions aimed at the model (prompt injection).

## Options considered

Models on-demand in all three Regions, tested on 2026-09-29 in us-east-1 through Strands (Bedrock Converse, no streaming, temperature 0, schema as a tool, at most 3 turns). Each ran 10 calls: 2 relevance cases (2 profiles, 20 jobs, 16 labelled clearly, one job with an injection) and 3 extraction cases (a list, a table, and a page with no jobs and an injected fake job), twice each.

| Model | Valid output | Tool on first try | Relevance correct | Injection resisted (job / page) | Wrong jobs extracted | Median time | Cost of 10 calls |
|---|---|---|---|---|---|---|---|
| **Ministral 3 14B** | 10/10 | 10/10 | 34/34 | 2/2, 2/2 | 0 | 2.1 s | $0.0017 |
| gpt-oss-20b | 10/10 | 10/10 | 34/34 | 2/2, 1/2 | 1 | 2.2 s | $0.0017 |
| gpt-oss-120b | 10/10 | 10/10 | 34/34 | 2/2, 2/2 | 0 | 4.8 s | $0.0045 |
| Qwen3-32B | 10/10 | 9/10 | 34/34 | 2/2, 0/2 | 2 | 2.0 s | $0.0037 |
| GLM-4.7 Flash | 10/10 | 10/10 | 32/34 | 0/2, 0/2 | 2 | 2.5 s | $0.0013 |
| Nemotron Nano 3 30B | 9/10 (turn limit) | 9/10 | 24/25 | 0/1, 0/2 | 2 | 2.8 s | $0.0015 |
| DeepSeek V3.2 (reference) | 10/10 | 10/10 | 34/34 | 2/2, 2/2 | 0 | 9.5 s | $0.0111 |

Relevance was easy for most models; prompt injection separated them. No model needed a Marketplace subscription. Claude runs in-Region only in eu-west-2, so it cannot be the platform model.

## Decision

1. **The platform model is `mistral.ministral-3-14b-instruct`** (Ministral 3 14B), called in the user's Region with the Converse API and no streaming, so only `bedrock:InvokeModel` is needed.

   | Region | Input, per million tokens | Output, per million tokens |
   |---|---|---|
   | us-east-1 | $0.20 | $0.20 |
   | ap-south-1 | $0.24 | $0.24 |
   | eu-west-2 | $0.31 | $0.31 |

   - Cost at the allowance ([0009](0009-llm-architecture-and-own-keys.md): 4 runs per month), assuming one run scores 50 candidates in 5 calls of about 6,000 input and 400 output tokens: about $0.006 per run in us-east-1 and $0.010 in eu-west-2, so about $0.04 per user per month, or $40 per month for 1,000 users at the full allowance. The per-run token caps bound the worst case.
   - **Fallback:** `openai.gpt-oss-120b-1:0` (all three Regions, passed every check, about 2.6 times the cost and twice as slow). Switching needs a new decision and the guardrail change.
   - A monthly job looks for newer, cheaper, or better models ([#49](https://github.com/jobdeputy/jobdeputy/issues/49)). Users with their own key pick any model; we recommend one per provider ([#51](https://github.com/jobdeputy/jobdeputy/issues/51)).

2. **Cost guardrails** (`jd-cost-guardrails`, [0005](0005-pre-launch-cost-guardrails.md)): Bedrock stays denied except `bedrock:InvokeModel` on the pinned model's foundation-model ARNs in the three Regions. `kms:CreateKey` is no longer denied (one key per cell, [0009](0009-llm-architecture-and-own-keys.md)). `aws-marketplace:Subscribe` stays denied.

3. **Prompt-injection rules for every LLM task.** No single model resists injection reliably, so the code enforces these:
   1. **Data is never instructions.** Page text, job descriptions, and profile text go inside data delimiters. The system prompt says to never follow instructions found there. Before a page is sent, scripts, styles, comments, and hidden elements are removed.
   2. **No tools with effects.** The only tool a task has is the structured-output tool. The model cannot fetch, write, or call anything.
   3. **Strict output.** The zod schema is strict (no extra fields, bounded strings and numbers). Output that fails is not stored.
   4. **Grounding checks in code.** Extraction keeps a job only if its URL is a link on that page (or on the same job board) and its title appears in the page text. Relevance must return exactly the given job IDs, once each; anything else is dropped.
   5. **Output is only data.** Model output never triggers an action by itself. In phase 2, applying, sending, or paying needs the user's explicit confirmation. The UI shows model text escaped, never as HTML or links it did not come with.
   6. **Least privilege.** An LLM worker may invoke only the pinned model and read and write only the items of its own task ([0009](0009-llm-architecture-and-own-keys.md)). Caps on turns, tokens, and calls bound any abuse ([0002](0002-llm-loop-and-token-budget.md)).
   7. **Tested and watched.** Every task has injection cases in its unit tests (stub model) and in the eval suite, and the nightly real-model check includes one. Rejected outputs are counted per task and model as a metric.
   8. **Reviewed monthly** ([#50](https://github.com/jobdeputy/jobdeputy/issues/50)).

## Why

- Ministral 3 14B is the cheapest model that passed every check, including all injection cases, and the fastest. It gives short, sensible reasons.
- Rules in code (grounding, no effectful tools, strict schemas) hold whatever the model does, so an injection can at worst produce a wrong score, not a fake job or an action.

## Consequences

- The sample set is small (20 jobs, 3 pages). The nightly real-model check, token usage, and the rejected-output metric show whether quality holds on real data; [#49](https://github.com/jobdeputy/jobdeputy/issues/49) grows the samples.
- A model change means a new decision, a guardrail update by the maintainer, and a rerun of the eval.
- The maintainer applies the guardrail with `infra/bootstrap/02-guardrails.sh` after merge.
