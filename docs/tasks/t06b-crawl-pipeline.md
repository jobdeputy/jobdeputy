# T06b: Crawl pipeline

- **Status:** planned
- **Depends on:** T06a
- **Branch / PR:** —

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
  - A dev-only test site: unauthenticated routes on the dev API that serve fixed pages (a job list, a redirect to `169.254.169.254`, a sign-in form, a JavaScript shell, a slow page), so integration tests never depend on someone else's site. Not deployed to prod (infra test).
  - DLQ alarm on shared stacks; data model, physical schema, and runbook updated.
- Out: daily limits (T06c), audit for older actions (T06d), extraction (T07).

## Research

See [T06 research](t06-async-crawl-pipeline.md#research), sections 6–9.

## Decision

Agreed on 2026-09-28 as part of T06.

## Done when

- [ ] Integration (PR stack), against the dev-only test site: a job page succeeds and is stored; a redirect to `169.254.169.254` fails `blocked_address`; a sign-in form fails `login_required`; a shell fails `needs_browser`; `127.0.0.1` and `169.254.169.254` fail `blocked_address`; a `.invalid` domain fails `unreachable`; a duplicate submit returns the same crawl; another user gets 404; audit entries exist for each step; account deletion erases the new tables and pages.
- [ ] Unit: state transitions are conditional (a duplicate delivery changes nothing), retry and backoff, last-attempt failure.
- [ ] Infra: new tables in the deletion list, alarms, least-privilege grants.
