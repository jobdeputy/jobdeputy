# T07c: Paging, crawl limits, and closed jobs

- **Status:** planned
- **Depends on:** T07b ([decision](t07-job-extraction-storage.md#decision), [0008](../decisions/0008-job-extraction.md))

## Goal

One crawl reads a whole board within fixed limits, and jobs that disappear from a board are marked closed.

## Scope

- In:
  - Following a feed's next page (Lever, Workday) within one crawl, reusing the fetcher and its robots.txt memory.
  - Limits per crawl: at most 10 requests after the first, 500 jobs, 1 second between requests to one host; the crawl worker's time limit goes from 60 to 180 seconds, with 150 seconds for the crawl.
  - A crawl that hits a limit is `succeeded` with `partial: true` and the reason.
  - `closedAt` for jobs of the same source that a complete crawl no longer lists; a partial crawl never closes a job; a job seen again is reopened.
  - Retries: a failure on a later page keeps what the earlier pages found and ends the crawl as partial (no whole-crawl retry that would fetch everything again).
- Out: fetching descriptions (T08).

## Done when

- [ ] Paging stops at each limit, and the crawl says which (unit).
- [ ] A job missing from a complete crawl is closed; a partial crawl closes nothing (unit and integration).
- [ ] The 1-second gap per host is tested without real waiting (an injected clock).
