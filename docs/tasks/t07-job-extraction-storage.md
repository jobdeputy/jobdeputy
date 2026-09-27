# T07: Job extraction, normalization, and storage

- **Status:** planned
- **Depends on:** T06

## Goal

Jobs found on a crawled page are extracted into one normalized schema and stored without duplicates.

## Scope

- In: job schema (title, company, location, description, apply URL, source, posted date when available), extraction strategy, deduplication, link to the crawl request.
- Out: relevance filtering (T08).

## Research

To do. Compare structured data (schema.org `JobPosting`), known applicant-tracking-system patterns, generic HTML heuristics, and LLM extraction with BYOT.

## Decision

Pending.

## Done when

- [ ] Extraction is tested against saved synthetic or permitted fixture pages.
- [ ] Re-crawling the same page does not create duplicates.
- [ ] Any LLM extraction follows [0002](../decisions/0002-llm-loop-and-token-budget.md): at most 3 iterations, best result returned, calls per job capped.
