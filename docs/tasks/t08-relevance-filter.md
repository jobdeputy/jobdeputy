# T08: Relevance filter

- **Status:** in-progress (split into T08a–T08d)
- **Depends on:** T05, T07

## Goal

Only jobs relevant to the user's target roles and profile are stored as relevant, each with a short reason.

## Scope

- In: relevance rules or model, explanation text, thresholds.
- Out: full ranking and scoring for application materials (later).

## Agreed direction (2026-09-29, before research)

Discussed with the maintainer during T07; research confirms or refines it, then the decision is recorded.

1. **Store all, then filter** (not filter before storing), so changing target roles re-scores stored jobs instead of re-crawling:
   - **In the crawl, a free code filter** (title against target roles, place, workplace, job type) marks each job `candidate` or `not_relevant`.
   - **An LLM scores the candidates in its own step** (own queue and worker, so a slow or failing model never breaks crawling), within [0002](../decisions/0002-llm-loop-and-token-budget.md): at most 3 iterations, a fixed number of calls per crawl. The maintainer prefers an LLM for relevance.
2. **Per-company limit:** at most **10** jobs per company shown (admin default and maximum, the user's own limit up to it, like the crawl limits). The best-scoring are kept (`limitState` `counted`); the rest are `over_limit`. "Company" is the job board until the shared company list exists ([#40](https://github.com/jobdeputy/jobdeputy/issues/40), which moves into T08).
3. **Nothing useless is kept** (DynamoDB time to live: free and automatic; 7 days, configurable). See the table below.
4. **First step of T08: the AI-provider decision**, shared with T07d ([#41](https://github.com/jobdeputy/jobdeputy/issues/41)) and later tailoring. Agreed as [0009](../decisions/0009-llm-architecture-and-own-keys.md) (Strands, the user's own keys, the platform allowance, token usage); the platform model is [T08a](t08a-ai-model.md).

What is kept and what is deleted:

| Job | Kept | Deleted |
|---|---|---|
| `not_relevant` | never shown | 7 days after it is marked (a later crawl may add it again; never shown) |
| `over_limit` | not shown | 7 days after it is marked (re-ranked on the next crawl) |
| Relevant and open | shown | kept while open |
| Relevant, closed, never acted on | — | 7 days after it closes |
| Dismissed by the user | a small record without the description, so it does not come back as new | 7 days after it closes |
| Shortlisted, starred, applying, applied | the user's history | only when archived by the user, or with the account |

Cost at this scale: storage about $0.25 per GB-month (1,000 jobs ≈ 2 MB); writes about $0.001 per crawl of 500 jobs; expiry deletes are free; $0 when idle.

## Carried over from T07

- **Descriptions for relevant jobs only** ([0008](../decisions/0008-job-extraction.md)): Greenhouse and Workday lists have no descriptions. After a job passes the first filter (title, place, type), fetch its posting through the board's single-posting endpoint (`feedRequest` with `job`, from T07a) and update the same `jobId`.
- **A job can close before its description is fetched:** a posting that answers 404 or 410 (or a board posting that is gone) sets `closedAt` instead of failing.
- Relevance must work from the title, place, and type first, because many jobs have no description until then.

## Sub-tasks

| ID | Task | Depends on |
|---|---|---|
| [T08a](t08a-ai-model.md) | Platform AI model (decision 0010, guardrail exceptions) | T08 |
| [T08b](t08b-llm-foundation.md) | LLM foundation on Strands, own keys, token usage | T08a |
| [T08c](t08c-code-filter.md) | Code filter, per-company limit, expiry | T07 |
| [T08d](t08d-llm-relevance.md) | LLM relevance scoring | T08b, T08c |

## Research

- Keyword and rule matching: free and explainable, used first (T08c).
- Embeddings: cannot explain a match, and the code filter plus an LLM covers the need; not used.
- An LLM through Strands, with the platform model or the user's own key: [0009](../decisions/0009-llm-architecture-and-own-keys.md). Model findings are in [T08a](t08a-ai-model.md#research).

## Decision

Agreed with the maintainer on 2026-09-29: [0009](../decisions/0009-llm-architecture-and-own-keys.md). Users without a key get 1 platform AI run per week and 4 per month; premium quotas later ([#47](https://github.com/jobdeputy/jobdeputy/issues/47)). All token use is tracked and shown to the user per model.

## Done when

- [ ] Relevance is tested with synthetic profiles and jobs, including edge cases.
- [ ] Each stored job shows why it matched.
- [ ] Any LLM use follows [0002](../decisions/0002-llm-loop-and-token-budget.md): at most 3 iterations, best result returned, calls per job capped.
