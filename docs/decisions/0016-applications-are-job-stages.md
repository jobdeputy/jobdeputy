# 0016: Applications are job stages: one jobs table, a sparse `applied` index

- **Status:** Accepted
- **Date:** 2026-11-25
- **Task:** #52

## Context

The app gets three tabs ([#52, Locked](https://github.com/jobdeputy/jobdeputy/issues/52)): **Search** (Find jobs and its runs), **Matches** (jobs not applied to yet) and **Applications** (jobs applied to, with a stage the user sets). A job is in one tab at a time. The data model ([0006](0006-data-model.md)) planned a separate `applications` table for Phase 2, and `jobs.status` already had values nobody wrote. Applying by hand (the user's own click, then "Did you apply?") needs somewhere to record it now.

## Options considered

1. **An `applications` table now.** A job and its application are two items; moving a job between tabs means writing both and keeping them in step, and Matches has to subtract one table from the other.
2. **The stage on the job (`jobs.status`).** One item; a job moves stage in place, so it can never be in two tabs. Listing Applications without reading every job needs an index.

For listing: a `Query` with a filter on `status` reads every job, hidden ones included (they can be hundreds a crawl); a sparse GSI on `appliedAt` holds only applied jobs. Matches is bounded already (at most the user's jobs per company, from the `usage` `COMPANY#` items), so it needs no index.

## Decision

- `jobs.status` is the job's **stage**: `new` → `applied` → `interviewing` → `offer` or `rejected`; `withdrawn`. Back to `new` undoes an apply (only from `applied`: a later stage is history). The unused values are dropped.
- `appliedAt` (kept through later stages), `stageAt`, and `appliedResumeId` (the tailored résumé the job had then).
- A **sparse GSI `applied`** (`userId`, `appliedAt`), projecting only the list fields (`JOB_SUMMARY_FIELDS`, shared by the table and the repository). `GET /me/applications` pages it newest first, 50 at a time.
- `GET /me/matches` returns every shown `new` job seen in the last 30 days, best first, at most 500, so the browser can sort any column over all of them. A job applied to leaves a gap: its company's next job does not take its place.
- `PUT /me/jobs/{jobId}/stage` names the stage the user saw (`from`): a job changed elsewhere meanwhile is refused (409), never overwritten. Each change has its audit entry, in the same transaction.
- The `applications` table stays for Phase 2 (the extension's runs and their steps); it will point at the job.

## Why

One item per job makes "a job is in one tab at a time" true by construction. The sparse index keeps Applications' cost to the jobs applied to, however many jobs crawls hide.

## Consequences

- The index is eventually consistent: a job marked applied a moment ago can be missing from Applications for a moment; the web app updates its own lists at once.
- Every write to `jobs` also writes the index when `appliedAt` is set or changes (few writes: only the user's own).
- The cooldown (3 applications per company in a rolling 30 days, [0013](0013-apply-flow-rules.md)) counts `appliedAt` per company; it comes in its own change.
