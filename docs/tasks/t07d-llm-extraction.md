# T07d: LLM extraction

- **Status:** planned
- **Depends on:** T07b, T08b (`packages/llm`, [0009](../decisions/0009-llm-architecture-and-own-keys.md))
- **Issue:** [#41](https://github.com/jobdeputy/jobdeputy/issues/41)

## Goal

Pages with jobs only in plain HTML (no board feed, no schema.org data) are read by an LLM, within the limits of [0002](../decisions/0002-llm-loop-and-token-budget.md).

## Scope

- In (to be confirmed by its own research and decision):
  - The `extraction` task in `packages/llm` ([0009](../decisions/0009-llm-architecture-and-own-keys.md)): the platform model ([T08a](t08a-ai-model.md)) or the user's own key, counted in the platform allowance and token usage.
  - The prompt-injection rules of [0010](../decisions/0010-platform-ai-model.md), including the grounding check: a job is kept only if its URL is a link on the page and its title is in the page text.
  - Its own queue and worker, fed by crawls that end with `extraction.outcome = no_readable_jobs` (their pages are kept for 30 days). The crawl worker does not change.
  - Page text is cleaned and cut to a stated size; the model's output is validated against the job schema, and page text is never followed as instructions (prompt injection).
  - The same save path and deduplication as T07b, with `extraction.method = llm`.
- Out: generating application materials.

## Done when

- [ ] A decision record is accepted, and costs are approved.
- [ ] A test with a stub model that never finishes shows the loop stops at 3 and returns the best result.
- [ ] A fixed worst-case number of calls per crawl, stated in the PR.
