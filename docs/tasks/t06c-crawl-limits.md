# T06c: Crawl limits

- **Status:** planned
- **Depends on:** T06b
- **Branch / PR:** —

## Goal

Each user has a daily crawl limit, set at two levels, and can see it.

## Scope

- In:
  - `usage` table (`DAY#<date>` with a 7-day expiry, `MONTH#<month>`), added to account deletion.
  - Admin level: default and maximum per stage in SSM Parameter Store (standard parameters, free), read live with at most 5 minutes of caching.
  - User level: `preferences` `CRAWL_SETTINGS` (`dailyLimit`, up to the admin maximum).
  - `POST /me/crawls` counts in the same transaction and refuses with 429 `daily-limit-reached` ("You've used 20 of 20 crawls today. Resets at 00:00 UTC.").
  - `GET` and `PUT /me/crawl-settings`: `{dailyLimit, defaultLimit, maxAllowed, usedToday, resetsAt}`.
  - Audit entry `crawl_limit.changed`.
- Out: per-user limits set by an admin (needs an admin screen); resetting at the user's local midnight.

## Research

See [T06 research](t06-async-crawl-pipeline.md#research), section 5, and the [decision](t06-async-crawl-pipeline.md#decision).

## Decision

Agreed on 2026-09-28 as part of T06.

## Done when

- [ ] The limit is enforced exactly, including two submits at the same moment (conditional write).
- [ ] A user cannot set a limit above the admin maximum; changing the parameter takes effect without a deploy.
- [ ] Integration tests for the 429 and the settings routes.
