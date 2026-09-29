# T07b: Jobs table and storage

- **Status:** planned
- **Depends on:** T07a ([decision](t07-job-extraction-storage.md#decision), [0008](../decisions/0008-job-extraction.md))

## Goal

A successful crawl stores the jobs it found, once each, and the user can list them.

## Scope

- In:
  - The `jobs` table (`userId`, `jobId`), added to account deletion and the no-orphans checks.
  - The crawl worker reads jobs after the fetch, per the order in [0008](../decisions/0008-job-extraction.md): a board link goes straight to the board's feed (first page only here); otherwise the page, then a board it redirected to or embeds.
  - Saving: create or update by `jobId` (`firstSeenAt`, `lastSeenAt`, `firstCrawlId`, `lastCrawlId`, `sourceIds`, `contentHash`); the user's own fields (`status`, `starred`, `notes`) are never overwritten.
  - On the crawl: `stats` (`jobsFound`, `jobsNew`, `jobsUpdated`) and `extraction {outcome (jobs, no_readable_jobs, or unreadable_feed), method?, board?}`. On the source: `kind`, `ats`, `stats`.
  - `GET /me/jobs` (newest first, paged) and `GET /me/jobs/{jobId}`.
  - Audit: one `crawl.succeeded` entry with the counts (not one entry per job).
  - Dev test site: pages with schema.org jobs, and one with none.
  - `docs/data-model.md` updated with the 0008 amendments.
- Out: paging, per-crawl limits, and `closedAt` (T07c); relevance (T08).

## Done when

- [ ] Crawling the same page twice leaves one item per job, with `lastSeenAt` and `lastCrawlId` moved (integration).
- [ ] The user's own fields survive a re-crawl (unit).
- [ ] A page with nothing readable succeeds with 0 jobs and `no_readable_jobs` (integration).
- [ ] Account deletion erases the user's jobs (integration).
