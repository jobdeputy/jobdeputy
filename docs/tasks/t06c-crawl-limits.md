# T06c: Crawl limits

- **Status:** in-review
- **Depends on:** T06b
- **Branch / PR:** `t06c-crawl-limits`

## Goal

Each user has a daily crawl limit, set at two levels, and can see it.

## Scope

- In:
  - `usage` table (`DAY#<date>` with a 7-day expiry, `MONTH#<month>`), added to account deletion.
  - Admin level: default and maximum per stage in SSM Parameter Store (standard parameters, free), read live with at most 5 minutes of caching.
  - User level: `preferences` `CRAWL_SETTINGS` (`dailyLimit`, up to the admin maximum).
  - `POST /me/crawls` counts in the same transaction and refuses with 429 `daily-limit-reached` ("You've used 20 of 20 crawls today. Resets at 00:00 UTC.").
  - `GET` and `PUT /me/crawl-settings`: `{dailyLimit, customLimit, defaultLimit, maxAllowed, usedToday, resetsAt, version}`.
  - Audit entry `crawl_limit.changed`.
- Out: per-user limits set by an admin (needs an admin screen); resetting at the user's local midnight.

## Research

See [T06 research](t06-async-crawl-pipeline.md#research), section 5, and the [decision](t06-async-crawl-pipeline.md#decision).

## Decision

Agreed on 2026-09-28 as part of T06.

## Findings while building

- **A handled route that was never deployed:** the first deploy answered `GET /me/crawl-settings` with 404, because the handler had the route but API Gateway did not. The route list test lists what *should* exist, so it could not notice. A new infra test reads every route key the API code handles and fails if one is not deployed (proven: it fails without the route).
- **A duplicate submit is not counted:** the active-crawl condition is checked before the limit, so returning the running crawl never uses up the day.
- **An admin lowering the maximum always wins:** the limit applied is `min(own limit or default, maximum)`, even for a user who chose more earlier.
- **Bad admin settings fail safe:** an invalid or unreadable parameter falls back to the built-in 20 and 50 and logs an error ([runbook](../runbooks/crawl-limits.md)).

## Done when

- [x] The limit is enforced exactly, including two submits at the same moment: the day counter's condition is part of the crawl request transaction (unit), and a third submit past a limit of 2 is refused with 429 and the agreed message (integration).
- [x] A user cannot set a limit above the admin maximum (422, unit and integration); changing the parameter takes effect without a deploy (proven on the personal stack: `{"dailyDefault":3,"dailyMax":4}` showed in `GET /me/crawl-settings`, then restored; the 5-minute cache is unit-tested).
- [x] Integration tests for the 429 and the settings routes (409 on a stale version, reset to the default, audit entries); 23/23 on the personal stack; nothing left afterwards (0 items in `usage`, `preferences`, `sources`, `crawls`, `audit`).
