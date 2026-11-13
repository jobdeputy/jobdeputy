# Current slice: URL to stored relevant jobs

## Goal

A user can create a profile, submit a job-listing URL, and later see the relevant jobs that an asynchronous crawl found on that page.

## User flow

1. The user creates a profile with basic details, a résumé, and target roles.
2. The user submits a URL, such as a company careers page.
3. The system accepts the request right away and returns a crawl job ID. It does not make the user wait for the crawl.
4. A background worker crawls the URL, extracts jobs, and normalizes them.
5. Jobs relevant to the user's target roles and profile are stored.
6. The user sees the crawl status (queued, running, succeeded, failed) and the stored jobs.

## In scope

- Profile: basic details, résumé upload, target roles.
- Asynchronous crawl requests: queue, worker, status, retries, failure reasons.
- Job extraction, normalization, deduplication, and storage.
- A relevance filter against target roles and profile.
- A UI for the flow above.
- Infrastructure, CI, and the agentic workspace needed to build it.

## Not in scope yet

- LinkedIn-specific integration.
- Ranking beyond the relevance filter.
- Tailored résumé and cover-letter generation.
- BYOT credential management UI (added when the first AI feature needs it).
- Phase 2 application automation.

## Build order

Workspace → stack decision → infrastructure → backend → crawl pipeline → UI → end-to-end hardening. See the [task board](tasks/README.md).
