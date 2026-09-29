# T07d: LLM extraction

- **Status:** planned
- **Depends on:** T07b, AI credentials (BYOT) or an approved platform model
- **Issue:** [#41](https://github.com/jobdeputy/jobdeputy/issues/41)

## Goal

Pages with jobs only in plain HTML (no board feed, no schema.org data) are read by an LLM, within the limits of [0002](../decisions/0002-llm-loop-and-token-budget.md).

## Scope

- In (to be confirmed by its own research and decision):
  - Which model, who pays (BYOT or platform), and how it stays in the user's Region ([0004](../decisions/0004-regional-cells-and-data-residency.md)); a platform model needs the maintainer's cost approval ([0005](../decisions/0005-pre-launch-cost-guardrails.md)).
  - Its own queue and worker, fed by crawls that end with `extraction.outcome = no_readable_jobs` (their pages are kept for 30 days). The crawl worker does not change.
  - Page text is cleaned and cut to a stated size; the model's output is validated against the job schema, and page text is never followed as instructions (prompt injection).
  - The same save path and deduplication as T07b, with `extraction.method = llm`.
  - Calls and tokens counted on the crawl (`llm`) and in `usage` (`MONTH#…`).
- Out: generating application materials.

## Done when

- [ ] A decision record is accepted, and costs are approved.
- [ ] A test with a stub model that never finishes shows the loop stops at 3 and returns the best result.
- [ ] A fixed worst-case number of calls per crawl, stated in the PR.
