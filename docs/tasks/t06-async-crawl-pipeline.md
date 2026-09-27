# T06: Asynchronous crawl request pipeline

- **Status:** planned
- **Depends on:** T04, T05

## Goal

A user submits a URL and immediately gets a crawl job ID. A worker crawls the page, and the job ends in a clear state.

## Scope

- In: `POST` crawl request, job states (queued, running, succeeded, failed), status endpoint, retries with backoff, timeouts, idempotency, URL validation, and SSRF protection.
- Out: extraction details (T07) and relevance (T08).

## Research

To do. **Crawler architecture is decided here:** static HTTP fetch or a headless browser, respecting robots.txt and rate limits, pages rendered with JavaScript, pagination, blocking or login walls, and safe URL handling (private IP ranges, redirects).

## Decision

Pending.

## Done when

- [ ] Submitting a URL returns a job ID without waiting for the crawl.
- [ ] Failures (unreachable, timeout, blocked, invalid URL, internal IP) end as `failed` with a reason, and each has a test.
