# T06b: Crawl pipeline

- **Status:** done
- **Depends on:** T06a
- **Branch / PR:** `t06b-crawl-pipeline`, [#30](https://github.com/jobdeputy/jobdeputy/pull/30) (merged)

## Goal

`POST /me/crawls {url}` returns a crawl ID at once; a worker fetches the page with the T06a fetcher; the crawl ends `succeeded` (page stored) or `failed` with a reason; every step is in the user's audit history.

## Scope

- In:
  - Tables `sources` (`sourceId` = URL hash), `crawls` (stream → Pipe → queue → worker, filtered to `queued` inserts), and `audit`; all added to account deletion.
  - `POST /me/crawls`, `GET /me/crawls`, `GET /me/crawls/{crawlId}`, `GET /me/audit`.
  - Crawl worker: `queued → running → succeeded | failed`, retries with backoff only for retriable failures, last attempt writes `failed`, stops if the account is being deleted.
  - The fetched body at `derived/users/<userId>/crawls/<crawlId>/page`, deleted after 30 days (lifecycle rule).
  - A duplicate submit returns the crawl already queued or running.
  - Audit entries: `crawl.requested`, `crawl.succeeded`, `crawl.failed`, each in the same transaction as the state change.
  - A dev-only test site: unauthenticated routes on the dev API that serve fixed pages (a job list, a redirect to `169.254.169.254`, a sign-in form, a JavaScript shell, a blocked page, a page that is down), so integration tests never depend on someone else's site. Not deployed to prod (infra test).
  - DLQ alarm on shared stacks; data model, physical schema, and runbook updated.
- Out: daily limits (T06c), audit for older actions (T06d), extraction (T07).

## Research

See [T06 research](t06-async-crawl-pipeline.md#research), sections 6–9.

## Decision

Agreed on 2026-09-28 as part of T06.

## Findings while building

Found by running on real AWS (the personal stack) before opening the PR; each now has a regression test:

- **`result` is a DynamoDB reserved word:** the first deployed success write was rejected. A mocked client cannot tell, so a unit test now checks every expression the repository sends for reserved words used without a placeholder (it fails with the bug, passes with the fix).
- **Lambda's system DNS lookup reports a non-existent domain as `EBUSY`**, which is ambiguous, so `.invalid` domains were retried. The fetcher now asks DNS directly (Node's c-ares resolver, IPv4 only: a Lambda outside a VPC has no IPv6 route). It answers `ENOTFOUND` for a missing name and skips the local hosts file.
- **A name that does not exist is final:** `ENOTFOUND` (and a name without an IPv4 address) ends the crawl at once as `unreachable`; temporary DNS failures, timeouts, and refused or dropped connections are still retried. This refines the T06 research table, which retried every DNS failure.
- **Crawl failures are not dead-lettered:** blocked, down, or missing sites end as `failed` with a reason. Only our own failures (a bug, S3 or DynamoDB errors) reach the DLQ and its alarm, after the crawl is marked `failed` (`internal`).
- **A page's active crawl cannot get stuck:** if an active crawl is finished, missing, or older than 15 minutes, the next submit replaces it (ending a stale one as `failed`, `internal`).

## Done when

- [x] Integration (personal stack, then the PR stack), against the dev-only test site: a job page succeeds and is stored; a redirect to `169.254.169.254` fails `blocked_address`; a sign-in form fails `login_required`; a shell fails `needs_browser`; a blocked page fails `blocked`; a missing page fails `not_found`; `127.0.0.1` and `169.254.169.254` are refused at submit (`blocked_address`); a `.invalid` domain fails `unreachable` on the first attempt; a duplicate submit returns the same crawl; a site that is down is retried; another user gets 404 and empty lists; audit entries exist for each step; account deletion erases the new tables and pages.
- [x] Proof on the personal stack: the stored page (`text/html; charset=utf-8`, 783 bytes, the same size the crawl reports) carries the `retention=crawl-page` tag; the lifecycle rule is active; after the test accounts were deleted, 0 crawl pages, 0 sources, 0 crawls, 0 audit entries, and an empty dead-letter queue remained.
- [x] Unit: state transitions are conditional (a duplicate delivery changes nothing), retry and backoff (30 s, 120 s, longer `Retry-After` wins), last-attempt failure, our own failures dead-lettered, no work for an account being deleted.
- [x] Infra: new tables in the deletion list (the existing coverage test), a DLQ alarm, least-privilege grants per function (tested), the test site only in dev and the only route without a token (tested).
