# T08c: Code filter, per-company limit, and expiry

- **Status:** planned
- **Depends on:** T07 ([T08 direction](t08-relevance-filter.md#agreed-direction-2026-09-29-before-research))
- **Branch / PR:** —

## Goal

Every crawled job is marked `candidate` or `not_relevant` for free, at most 10 per company are shown, and useless jobs expire.

## Scope

- In:
  - A code filter in the crawl: title against the target roles, place, workplace, and job type.
  - The per-company limit: default and maximum 10 set by the admin, the user's own limit up to it, like the crawl limits; the rest `over_limit`. Includes [#40](https://github.com/jobdeputy/jobdeputy/issues/40) as far as the limit needs it.
  - DynamoDB time to live, 7 days (configurable), as in the [T08 table](t08-relevance-filter.md).
- Out: LLM scoring ([T08d](t08d-llm-relevance.md)).

## Done when

- [ ] The filter is tested with synthetic profiles and jobs, including edge cases.
- [ ] Each job shows why it was kept or dropped.
