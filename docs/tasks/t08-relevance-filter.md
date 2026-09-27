# T08: Relevance filter

- **Status:** planned
- **Depends on:** T05, T07

## Goal

Only jobs relevant to the user's target roles and profile are stored as relevant, each with a short reason.

## Scope

- In: relevance rules or model, explanation text, thresholds.
- Out: full ranking and scoring for application materials (later).

## Research

To do. Compare keyword and rule matching, embeddings, and an LLM with the user's own credentials (BYOT). Consider cost, explainability, and behaviour when the user has no key.

## Decision

Pending.

## Done when

- [ ] Relevance is tested with synthetic profiles and jobs, including edge cases.
- [ ] Each stored job shows why it matched.
