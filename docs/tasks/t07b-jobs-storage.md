# T07b: Jobs table and storage

- **Status:** in-review
- **Depends on:** T07a ([decision](t07-job-extraction-storage.md#decision), [0008](../decisions/0008-job-extraction.md))
- **Branch / PR:** `t07b-jobs-storage`

## Goal

A successful crawl stores the jobs it found, once each, and the user can list them.

## Scope

- In:
  - The `jobs` table (`userId`, `jobId`), in account deletion, the test-data reaper, and the no-orphans check (through `userTables`), and in the runbook's one-command check.
  - The crawl worker reads jobs after the fetch, in the order from [0008](../decisions/0008-job-extraction.md): a board link goes straight to the board's feed (first page only); otherwise the page, then a board it redirected to, its schema.org data, or the one board it embeds.
  - Saving: one idempotent update per job (`firstSeenAt`, `lastSeenAt`, `firstCrawlId`, `lastCrawlId`, `sourceIds`, `contentHash`, `descriptionHash`). The user's own fields (`status`, `starred`, `notes`) are never overwritten, and a re-crawl never removes a posting field it did not read.
  - On the crawl: `stats {jobsFound, jobsNew, jobsUpdated}` and `extraction {outcome, method?, board?, skipped, partial?}`. On the source: `kind`, `ats`, `stats {lastFound}`.
  - At most 500 jobs saved per crawl (`partial: {reason: max_jobs}` past it). The crawl worker's time limit is 180 seconds (was 60), because a crawl can now make two requests (the page, then its board's feed).
  - A board feed in an unknown format fails the crawl as `unreadable_feed` (not retried; logged as an error).
  - `GET /me/jobs` (paged, without descriptions) and `GET /me/jobs/{jobId}` (in full). Read-only: the user's own changes come with the interface (T09).
  - Audit: the `crawl.succeeded` entry carries `jobsFound` and `jobsNew` (not one entry per job).
  - Dev test site: `jobs-schema-org`, a page with two postings in schema.org data.
  - `docs/data-model.md` updated.
- Out: paging within a crawl and `closedAt` (T07c); relevance (T08); changing a job's status (T09).

## Findings while building

- **A description must not count as a change on every re-crawl.** A board's list has no descriptions, but the same job may have one fetched later (T08). So `contentHash` covers everything but the description, which has its own `descriptionHash`, set only with it; a re-crawl never removes a field it did not read.
- **Listing order:** `jobId` is a hash, so `GET /me/jobs` pages in key order (stable, not by time). Sorting by relevance or date needs T08's scores, and is designed with the interface (T09), for example as a global secondary index (addable later without a migration, [0006](../decisions/0006-data-model.md)).
- **A script-built careers page that embeds a board is now read**, not failed as `needs_browser`: the shell check runs only when nothing else on the page is readable.
- **Every attribute name in the job update goes through a placeholder**, and a test proves no bare name remains (`status`, `type`, and others are reserved words, which a mocked client cannot catch).

## Done when

- [x] Crawling the same page twice leaves one item per job, with `lastSeenAt` and `lastCrawlId` moved and `firstCrawlId` kept (integration).
- [x] The user's own fields survive a re-crawl: they are only ever set if missing (unit).
- [x] A page with nothing readable succeeds with 0 jobs and `no_readable_jobs` (unit and integration).
- [x] Account deletion erases the user's jobs (integration).
- [x] Each user sees only their own jobs (integration); the jobs API can only read the jobs table, and the worker can only update it (infra tests).
- [x] No LLM calls.
