# T07: Job extraction, normalization, and storage

- **Status:** in-progress
- **Depends on:** T06

## Goal

Jobs found on a crawled page are extracted into one normalized schema and stored without duplicates.

## Scope

- In: job schema (title, company, location, description, apply URL, source, posted date when available), extraction strategy, deduplication, link to the crawl request.
- Out: relevance filtering (T08).

## Subtasks

Each ships as its own PR that can be tested on its own.

| ID | What | Status |
|---|---|---|
| [T07a](t07a-job-readers.md) | Job readers: board detection, the four board feeds, schema.org, one normalized job. Pure code, nothing deployed. | done |
| [T07b](t07b-jobs-storage.md) | `jobs` table, saving without duplicates, links to sources and crawls, `GET /me/jobs`, audit, test-site pages | in-review |
| [T07c](t07c-paging-and-closed-jobs.md) | Paging within one crawl, per-crawl limits and `partial`, `closedAt` | planned |
| [T07d](t07d-llm-extraction.md) | LLM extraction for pages without structured data ([#41](https://github.com/jobdeputy/jobdeputy/issues/41)) | planned (own decision first) |

## Research

Done on 2026-09-29, including checks against live sites.

### 1. Where jobs can be read from

| Source | Public data | robots.txt (for us) | Descriptions in the list? | Size and paging |
|---|---|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/<board>/jobs`; one posting at `…/jobs/<id>` | allowed (only `/embed/` is disallowed, and we never fetch it) | only with `content=true` | 710 jobs: 35 KB without descriptions; 5.5 MB (Stripe) and 9.6 MB (Databricks) with them, over our 5 MB limit. No paging. |
| Lever | `api.lever.co/v0/postings/<board>`; one posting at `…/<id>`; EU at `api.eu.lever.co` | allowed, `Crawl-delay: 1` | yes | 6 MB for a large board; pages with `limit`/`skip` (about 1.9 MB per 100) |
| Ashby | `api.ashbyhq.com/posting-api/job-board/<board>` | robots.txt answers 401, which RFC 9309 treats as "allow all" | yes, with salary | 280 KB for 155 jobs; no paging, no single-posting endpoint |
| Workday | `POST <tenant>.wdN.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs`; one posting at `GET …/job/<path>` | allowed per tenant (the career site is allowed; `/wday/` is not disallowed) | no | 20 per page; the total comes on the first page only |
| SmartRecruiters | `api.smartrecruiters.com` | **disallowed** for every bot except LinkedIn's | — | not usable |
| Any site | schema.org `JobPosting` (JSON-LD), published for search engines | the site's | yes | Workday posting pages carry it; Greenhouse, Lever, and SmartRecruiters list pages do not |

### 2. Options for pages without structured data

- **LLM extraction:** reads anything, but needs a provider. BYOT is not built; a platform model (for example Bedrock) is a new paid service and must run in the user's Region (cross-Region inference would move page content out of it). Needs its own decision under [0002](../decisions/0002-llm-loop-and-token-budget.md).
- **HTML heuristics:** brittle, and wrong guesses become jobs in the user's list.

### 3. Descriptions

Greenhouse and Workday lists have no descriptions. Fetching each would mean hundreds of requests per crawl (at 1 per second per host). Most jobs are ruled out by title and place, so fetching descriptions only for relevant jobs in T08 is faster, cheaper, and more polite.

## Decision

Agreed with the maintainer on 2026-09-29; recorded in [0008](../decisions/0008-job-extraction.md):

1. **Code only now**: board feeds, then schema.org. A page with nothing readable succeeds with 0 jobs and the note `no_readable_jobs`. LLM extraction is a separate task with its own decision ([T07d](t07d-llm-extraction.md), [#41](https://github.com/jobdeputy/jobdeputy/issues/41)).
2. **Descriptions when the listing has them**; otherwise T08 fetches them for relevant jobs only.
3. **Per crawl**: at most 10 more requests, 500 jobs, 1 second between requests to one host, a 180-second worker; past a limit the crawl is `succeeded` but `partial`.
4. **Closed jobs**: `closedAt` when a complete crawl no longer lists a job. The maintainer noted a job can also close between the crawl and the description fetch: T08 closes a job whose own page or posting is gone (404 or 410) when it fetches the description.
5. **`companies` tables deferred** to the first feature that needs them, tracked in [#40](https://github.com/jobdeputy/jobdeputy/issues/40).
6. **Extraction runs in the crawl worker.** The LLM step gets its own queue and worker, and is designed in its own task.
7. **Subtasks** as listed above.

## Done when

- [ ] Extraction is tested against saved synthetic or permitted fixture pages.
- [ ] Re-crawling the same page does not create duplicates.
- [ ] Any LLM extraction follows [0002](../decisions/0002-llm-loop-and-token-budget.md): at most 3 iterations, best result returned, calls per job capped (T07d).
