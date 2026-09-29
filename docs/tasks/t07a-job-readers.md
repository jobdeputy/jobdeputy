# T07a: Job readers

- **Status:** in-review
- **Depends on:** T07 ([decision](t07-job-extraction-storage.md#decision), [0008](../decisions/0008-job-extraction.md))
- **Branch / PR:** `t07a-job-extraction`

## Goal

A tested library that turns a submitted link or a fetched page into normalized jobs, or says what to read next. Not wired to the worker yet (T07b does that), so this PR changes nothing that is deployed.

## Scope

- In (`apps/worker/src/jobs/`):
  - `boards.ts`: which job board a link points into (Greenhouse, Lever, Ashby, Workday; one posting or the whole board), the one board a careers page embeds, and the request for each board's feed or posting.
  - `feeds.ts`: readers for each board's list and single posting, with paging information (Lever and Workday).
  - `schema-org.ts`: schema.org `JobPosting` data in a page (including `@graph` and item lists; expired postings left out).
  - `job.ts`: the normalized job, field checks and limits, `jobId` (deduplication), and `contentHash`.
  - `text.ts`: HTML to plain text, entities, and length limits.
  - `read-page.ts`: the order of sources from [0008](../decisions/0008-job-extraction.md).
- Out: fetching, storage, the API, and the worker (T07b); walking pages and per-crawl limits (T07c).

## Findings while building

- **Every reader was checked against the live feeds** on 2026-09-29 (Stripe on Greenhouse, Palantir on Lever, Ramp on Ashby, NVIDIA on Workday): 710, 50 (plus a next page), 155, and 20 (plus a next page, total 2,000) jobs, none skipped. Only synthetic fixtures are committed.
- **One posting, not the whole board:** a link to a single posting reads only that posting. Greenhouse, Lever, and Workday have an endpoint for one posting (with its description), which T08 will reuse; Ashby's feed is filtered.
- **Board names are compared in lowercase** (`Acme` and `acme` are one board), so the same jobs are not saved twice.
- **Workday's job ID is the same in the list and in the posting** (the requisition ID that ends the path), so fetching a description later updates the same job.
- **"UK" is not an ISO country code** (it is GB): known aliases are checked before accepting any two letters.
- **Greenhouse escapes its HTML once more** (`&lt;p&gt;`); it is unescaped once before tags are read, so an escaped `<script>` is still dropped.
- **Everything read is untrusted:** fields are type-checked, links must pass the same rules as crawl URLs (no `javascript:`, private addresses, credentials, or LinkedIn), HTML becomes plain text, and every field has a length limit. A feed in an unexpected shape fails as a whole (`FeedFormatError`) rather than yielding half-read jobs. Scans are linear, and hostile inputs are tested for speed.

## Done when

- [x] Each board's list and single posting, and schema.org pages, are read from synthetic fixtures with the real formats (unit, 107 tests).
- [x] The same posting gets the same `jobId` from a list, a single posting, a changed title, or tracking parameters; the same ID on another board does not.
- [x] Unsafe links, markup, wrong types, and oversized fields are dropped or bounded (unit).
- [x] No LLM calls.
- [x] Docs, decision 0008, task status, and the board updated.
