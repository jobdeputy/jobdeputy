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
- Out: ranking for application materials (later).

## Done when

- [ ] Relevance is tested with synthetic profiles and jobs and a stub model, including edge cases.
- [ ] Each stored job shows why it matched.
- [ ] A fixed worst-case number of calls per crawl, stated in the PR.
