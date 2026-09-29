# T08: Relevance filter

- **Status:** planned
- **Depends on:** T05, T07

## Goal

Only jobs relevant to the user's target roles and profile are stored as relevant, each with a short reason.

## Scope

- In: relevance rules or model, explanation text, thresholds.
- Out: full ranking and scoring for application materials (later).

## Carried over from T07

- **Descriptions for relevant jobs only** ([0008](../decisions/0008-job-extraction.md)): Greenhouse and Workday lists have no descriptions. After a job passes the first filter (title, place, type), fetch its posting through the board's single-posting endpoint (`feedRequest` with `job`, from T07a) and update the same `jobId`.
- **A job can close before its description is fetched:** a posting that answers 404 or 410 (or a board posting that is gone) sets `closedAt` instead of failing.
- Relevance must work from the title, place, and type first, because many jobs have no description until then.

## Research

To do. Compare keyword and rule matching, embeddings, and an LLM with the user's own credentials (BYOT). Consider cost, explainability, and behaviour when the user has no key.

## Decision

Pending.

## Done when

- [ ] Relevance is tested with synthetic profiles and jobs, including edge cases.
- [ ] Each stored job shows why it matched.
- [ ] Any LLM use follows [0002](../decisions/0002-llm-loop-and-token-budget.md): at most 3 iterations, best result returned, calls per job capped.
