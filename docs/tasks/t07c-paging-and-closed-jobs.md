# T07c: Paging, crawl limits, and closed jobs

- **Status:** done
- **Depends on:** T07b ([decision](t07-job-extraction-storage.md#decision), [0008](../decisions/0008-job-extraction.md))
- **Branch / PR:** `t07c-paging-closed-jobs`, [#45](https://github.com/jobdeputy/jobdeputy/pull/45) (merged)

## Goal

One crawl reads a whole board within fixed limits, and jobs that disappear from a board are marked closed.

## Scope

- In:
  - Following a feed's next page (Lever, Workday) within one crawl, through the same fetcher (SSRF checks, robots.txt, limits).
  - Limits per crawl (`CRAWL_LIMITS` in `apps/worker/src/jobs/crawl-jobs.ts`): at most 10 requests after the first, at least 1 second between requests to one host, and no request started that could not finish within 150 seconds of the first. (The 500-job limit and the 180-second worker came with T07b.)
  - A crawl that stops early is `succeeded` with `partial: {reason}`: `max_jobs`, `max_pages`, `time_budget`, or `page_failed` (a later page failed or changed format; what earlier pages read is kept, and the whole crawl is not fetched again).
  - Closing: each saved page remembers the jobs it lists (`listedJobIds`). A **complete** crawl removes the page from the `sourceIds` of jobs it no longer lists, and a job no saved page lists is closed (`closedAt`). A partial crawl, or a page with nothing readable, closes nothing. A job listed again is reopened.
  - `stats` gains `pagesFetched` and `jobsClosed`; the `crawl.succeeded` audit entry carries `jobsClosed`.
- Out: fetching descriptions, and closing a job whose own posting is gone (T08).

## Findings while building

- **Closing per page, not per job:** if a job is listed by two saved pages (a company's careers page and its board, for example), one of them dropping it does not close it. Only when no page lists it any more. Closing requires `sourceIds` to still be empty at that moment, so a crawl of another page listing the job again at the same time wins.
- **Where the "listed before" set lives:** on the source item (`listedJobIds`, at most 2,000 IDs, about 64 KB), rather than a query of every job of the user. A crawl reads it once. The first crawl after this change sets it; nothing is closed until then.
- **Large boards stay partial:** a board with more than 500 jobs (Stripe has 710) is always partial, so its jobs are never closed by a crawl. They still close when T08 finds a posting gone.
- **The time budget is checked before each request** against the longest a request can take (20 seconds), so a crawl never runs past 150 seconds. The gap and the budget are tested with a fake clock: no test waits.
- **The integration test seeds a job** the page "listed before" (the test site holds no state, so a page cannot drop a job between crawls). It runs with the queue-level tests (`JD_FULL=1`: every PR, merge, and nightly run). CI's test roles could not write to tables, so, as agreed with the maintainer, they may now `PutItem`/`UpdateItem` the `-jobs` and `-sources` tables of the tested dev and PR stacks only (`testDataWrites`, dev only; a test proves the prod role gets no table access). Deployed to `jobdeputy-cicd-dev-iad` on 2026-09-29.

## Done when

- [x] Paging stops at each limit, and the crawl says which (unit).
- [x] A job missing from a complete crawl is closed; a partial crawl closes nothing; a job another page still lists stays open (unit and integration).
- [x] The 1-second gap per host is tested without real waiting (an injected clock).
- [x] No LLM calls.
