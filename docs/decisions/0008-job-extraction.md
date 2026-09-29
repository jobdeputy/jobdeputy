# 0008: Job extraction: job-board feeds and schema.org first, LLM later

- **Status:** Accepted
- **Date:** 2026-09-29
- **Task:** t07
- **Amends:** [0006](0006-data-model.md) (`companies` and `company-aliases` deferred; `jobs` location and description details)

## Context

T07 turns a crawled page into jobs. [0007](0007-crawler.md) set the direction: code first, LLM last. This record decides which sources the code reads, how much one crawl may fetch, and what is deferred. The research, including checks against live sites on 2026-09-29, is in [T07](../tasks/t07-job-extraction-storage.md#research).

## Options considered

1. **Job-board data feeds and schema.org only; an LLM later as its own task.** Exact, cheap, testable. Pages with jobs in plain HTML only give 0 jobs for now.
2. **Also an LLM fallback now.** Reads any page, but needs a model provider: BYOT is not built, and a platform model is a new paid service that must also stay in the user's Region ([0004](0004-regional-cells-and-data-residency.md), [0005](0005-pre-launch-cost-guardrails.md)).
3. **Generic HTML heuristics** (guess job lists from page structure). Brittle, and wrong guesses become jobs in the user's list.

## Decision

- **Option 1.** Sources, in order:
  1. A link into a known job board is read from the board's public feed without fetching the page: **Greenhouse**, **Lever**, **Ashby**, and **Workday**. A link to one posting reads only that posting.
  2. Otherwise the page is fetched. If it redirected into a board, that board is read.
  3. Otherwise the page's schema.org `JobPosting` data.
  4. Otherwise the one board the page embeds or links to (a page naming several boards is not guessed).
  5. Otherwise the crawl succeeds with 0 jobs and the note `no_readable_jobs`.
- **SmartRecruiters is not supported:** its robots.txt forbids its API to every bot except LinkedIn's. Its postings are read only if a page carries schema.org data.
- **Descriptions only when the listing has them** (Lever, Ashby, schema.org, and single postings). Greenhouse and Workday lists have none: T08 fetches them for relevant jobs only, which also avoids Greenhouse feeds over 5 MB (it has no paging).
- **Per crawl** (T07c): at most 10 requests after the first page, 500 jobs, and 1 second between requests to the same host. The crawl worker's time limit goes to 180 seconds, with 150 seconds for the crawl. Hitting a limit ends the crawl as `succeeded` but **partial**, with the reason.
- **Closed jobs:** a job missing from a complete (not partial) crawl of the same source gets `closedAt`. A partial crawl never closes a job. T08 also closes a job whose own page is gone when it fetches the description.
- **Deduplication:** `jobId` is a hash of the board and its posting ID; otherwise the posting's link (normalized, tracking parameters dropped); otherwise company, title, and first location (only when one link lists several postings). Re-crawls update the same item.
- **Extraction runs in the crawl worker**, straight after the fetch: parsing takes milliseconds, so a separate queue adds nothing. An LLM step will have its own queue and worker ([#41](https://github.com/jobdeputy/jobdeputy/issues/41)); crawls that end with `no_readable_jobs` keep their page for 30 days, so it can pick them up without changes to the crawl worker.
- **Amendments to 0006:**
  - `companies` and `company-aliases` are built with the first feature that needs a resolved company, such as company rules ([#40](https://github.com/jobdeputy/jobdeputy/issues/40)). Until then each job stores the company name as found and a `companyKey` (`greenhouse:acme`, `workday:<host>/<site>`, or `site:<domain>`).
  - `jobs.locations` items are `{text, city?, region?, country?}`: `text` is always what the site wrote; the parts are kept only when the site gives them, and `country` only as an ISO code.
  - `jobs.description` is plain text of at most 32,000 characters (`descriptionTruncated` when cut). It is absent until known.

## Why

- Job-board feeds are complete, structured, and small, and most careers pages in this slice run on one of these four boards. schema.org data is published for search engines, so it is reliable where present.
- An LLM without a provider, a cost approval, and a residency check would be built on assumptions. A separate task keeps the crawl worker simple and the costs visible.
- Fetching every description would mean hundreds of requests per crawl. Most jobs are filtered out by title and place, so fetching only relevant ones is faster, cheaper, and more polite.

## Consequences

- Pages with jobs only in plain HTML give 0 jobs until [#41](https://github.com/jobdeputy/jobdeputy/issues/41). The note makes this visible and countable.
- Many jobs have no description until T08 fetches it; relevance must work from the title, place, and type first.
- Company rules and the "one page with many companies" review wait for [#40](https://github.com/jobdeputy/jobdeputy/issues/40).
- Each board reader depends on an undocumented or lightly documented public format. A changed format fails the whole feed (`FeedFormatError`), which T07b records on the crawl instead of storing half-read jobs.
