# T06: Asynchronous crawl request pipeline

- **Status:** in-progress (split into T06a–T06d)
- **Depends on:** T04, T05

## Goal

A user submits a URL and immediately gets a crawl job ID. A worker crawls the page, and the job ends in a clear state.

## Scope

- In: `POST` crawl request, job states (queued, running, succeeded, failed), status endpoint, retries with backoff, timeouts, idempotency, URL validation, and SSRF protection.
- Out: extraction details (T07) and relevance (T08).

## Research

Research done on 2026-09-28. Accepted constraints: 0003 (Lambda, stream → Pipe → SQS → worker), 0004 (the fetch runs in the user's home Region), 0005 ($0 idle: **no NAT gateway and no always-on browser fleet**), 0006 (`sources`, `crawls`, and `usage` are built in T06).

### 1. How the page is fetched

| Option | What it is | For | Against |
|---|---|---|---|
| **A. Plain HTTP fetch** in a Lambda (Node `undici`) | One GET, bytes stored | Cheapest (~256 MB, seconds); small attack surface; SSRF can be enforced at the socket; easy to test | Pages built by JavaScript arrive as an empty shell |
| B. A plus a headless browser fallback (`@sparticuz/chromium` 153, MIT, in Lambda) | Browser only when A gets a JS shell | Renders SPA careers pages | 1.5–2 GB Lambda, 10–30 s per page; each page loads dozens of sub-requests, each one needing SSRF blocking inside Chromium (DNS is resolved by the browser, so rebinding is harder to stop); ~60 MB package, Chromium updates to track |
| C. Always headless browser | Every page rendered | Handles everything a browser can | All of B's costs on every crawl |
| D. Third-party scraping API (Firecrawl, ScrapingBee, …) | Someone else fetches | No browser to run | Monthly or paid-per-call service; page content leaves our cell (0004); new vendor |

**Why A is enough to start:** the pages this slice targets are mostly careers pages on applicant-tracking systems (ATS). Most of the JavaScript-heavy ones (Greenhouse, Lever, Ashby, SmartRecruiters, Workday) also serve the same jobs as **public JSON** or server-rendered HTML with schema.org `JobPosting` data. Reading those is extraction (T07). When A gets a shell with no content, the crawl fails with the reason `needs_browser` instead of pretending it worked. We count how often that happens, and add B later as its own task if the numbers justify it.

### 2. SSRF protection (the main security risk)

A crawl fetches a URL the user chose, from inside AWS. Things an attacker could aim at:

- Private and link-local addresses: `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (cloud metadata), `100.64/10`, IPv6 ULA and link-local, and IPv4-mapped IPv6 forms of all of these.
- **Loopback matters in Lambda:** the Lambda Runtime API listens on `127.0.0.1:9001`. A crawl that reached it could read or answer other invocations.
- Tricks: DNS names that resolve to private IPs, **DNS rebinding** (public on the check, private on the connect), redirects to private addresses, IP literals in odd forms (`0x7f.1`, `2130706433`, `[::ffff:127.0.0.1]`), and `user:pass@` URLs.

The approach:

1. **Validate the URL** at `POST` and again in the worker: `http` or `https` only; ports 80 and 443 only; no credentials in the URL; at most 2,048 characters; host must be a DNS name (IP literals refused); parsed with the WHATWG `URL` parser (which also normalizes odd IP forms and punycode).
2. **Check the IP that is actually connected to, not a separate lookup:** an `undici` `Agent` with a custom `connect.lookup` that resolves the name, rejects the connection if **any** returned address is not public unicast (`ipaddr.js`, MIT, `range() === 'unicast'`), and connects only to the checked address. This defeats rebinding because there is no second lookup.
3. **Redirects handled by hand** (`redirect: 'manual'`): at most 5, each hop re-validated (steps 1 and 2); an `https` → `http` downgrade is refused.
4. The Lambda is **not in a VPC**, so there is no route to our own private resources anyway. Step 2 still matters for loopback and link-local.
5. Unit tests cover every range, the IP-literal encodings, a rebinding resolver (public then private), and redirects to private hosts. The integration test proves a real `127.0.0.1` / `169.254.169.254` URL ends as `failed` with `blocked_address`.

Checked libraries: `request-filtering-agent` (MIT, maintained) only covers `http.Agent`, not `fetch`/`undici`; `ssrf-req-filter` is inactive since 2024. The approach above is ~80 lines of our own code on `undici` plus `ipaddr.js`, which is easier to review than a wrapper.

### 3. Limits (per fetch)

| Limit | Value | Why |
|---|---|---|
| Connect timeout | 5 s | Unreachable hosts fail fast |
| Whole fetch (headers + body) | 20 s | Careers pages load in well under that |
| Body size | 5 MB **after decompression**, counted while streaming and aborted when exceeded | Stops decompression bombs and huge pages |
| Content types | `text/html`, `application/xhtml+xml`, `application/json`, `application/ld+json`, `text/plain` | Everything else (PDF, images, video) fails `unsupported_content` |
| Redirects | 5 | See above |
| Worker Lambda | 256 MB, 60 s timeout, queue `maxConcurrency` 2 | Fits the account's 10-concurrency limit, like the other workers |

### 4. robots.txt and politeness

- robots.txt ([RFC 9309](https://www.rfc-editor.org/rfc/rfc9309)) is aimed at automated crawlers. A fetch the user asked for is closer to a browser visit (Google's user-triggered fetchers ignore it). Scheduled crawls (later) are clearly automated.
- **Recommendation: respect robots.txt from day one**, for user-triggered crawls too. It is the safe position for a public, open-source project, and keeps behaviour the same when schedules arrive. A disallowed page fails with `blocked_by_robots`. robots.txt itself is fetched through the same SSRF-safe client (limit 500 KB; a 4xx means "allowed", a 5xx or timeout means "disallowed" per RFC 9309). Parser: `robots-parser` (MIT, stable but untouched since 2023) or ~60 lines of our own; to be decided at implementation by test coverage.
- An honest user agent: `JobDeputyBot/<version> (+https://jobdeputy.com/bot)`. No browser impersonation, no attempts to pass bot challenges, no proxies. Sites that block us (403, 429, Cloudflare challenge headers such as `cf-mitigated`) fail with `blocked`, shown to the user.
- One page plus robots.txt per crawl, 2 crawls at a time for the whole cell: well within politeness norms. **Pagination** (following "next page") needs page parsing, so it moves to T07, which reuses this fetcher inside the same crawl and the same limits (and a 1-second gap between requests to one host).

### 5. Abuse and cost limits (per user)

- API throttling already exists (dev 5 requests/s, prod 50).
- **Daily crawl cap** in `usage` (`DAY#<date>`, 0006): `POST` increments it with a conditional write, and refuses with 429 `daily-limit-reached` when full. Proposed: 20 per user per day. Also a monthly counter (`MONTH#`), which later holds LLM usage.
- **Duplicate submits:** if the same page (same normalized URL) already has a crawl `queued` or `running`, `POST` returns that crawl (200) instead of starting another. No `Idempotency-Key` header is needed.

### 6. Pipeline, states, retries

Same pattern as documents and deletion (`AsyncPipeline` + `addQueueWorker`):

```text
POST /me/crawls {url}
  → validate → source upserted → crawl item {status: queued} (and the day counter), one transaction
  → crawls stream (INSERT, status queued) → Pipe → SQS (3 receives, DLQ, alarm) → crawl worker
worker: queued → running (conditional; attempts + 1)
  → robots.txt → fetch (limits above) → page saved to S3 → succeeded {finalUrl, httpStatus, contentType, bytes}
  → or failed {error: {code, message}}
```

| Failure | Retried? | `error.code` |
|---|---|---|
| Invalid URL (at POST) | no, 400 | (validation problem) |
| Private/loopback address, bad redirect | no | `blocked_address` |
| robots.txt disallows | no | `blocked_by_robots` |
| 403, 429, or bot challenge | no (retrying makes blocking worse) | `blocked` |
| 404, 410, other 4xx | no | `not_found` / `http_error` |
| Wrong content type, too large | no | `unsupported_content` / `too_large` |
| JS shell with no content | no | `needs_browser` |
| DNS failure | a name that does not exist: no (refined in T06b); a temporary DNS failure: yes | `unreachable` |
| Timeout, connection reset, 5xx | yes | `timeout` / `unreachable` / `http_error` |
| A bug in our worker | yes | `internal` (after the last attempt; DLQ alarm if it crashes every time) |

- **Backoff:** a retriable failure sets the message's visibility to 30 s and then 120 s (`ChangeMessageVisibility`), honouring `Retry-After` up to 120 s. The last attempt writes `failed` itself and makes the message visible at once (same as T04), so the DLQ holds only crashes.
- **Idempotency:** the `queued → running` and `running → succeeded/failed` writes are conditional, so a duplicate delivery does nothing. The S3 key is fixed per crawl, so a repeat overwrites the same object.
- **Account deletion:** the worker stops if a `DELETION` item exists, and T12's final sweep (15 min, longer than the 60 s worker) removes anything written in between. The new tables join `userTables` (an infra test enforces it).

### 7. What is stored

| Where | What |
|---|---|
| `sources` (userId, sourceId) | The page the user saved. **Proposed change to 0006's note:** `sourceId` = a hash of the normalized URL (like `jobId`), not a ULID, so "same page again" is a `GetItem` and cannot create duplicates. Attributes as in the data model; `kind` and `ats` stay `unknown` until T07. |
| `crawls` (userId, crawlId ULID) | As in the data model, plus `result? {finalUrl, httpStatus, contentType, bytes, s3Key}`. Stream on, filtered to inserts with `status = queued`. `ttl` 180 days. |
| `usage` (userId, sk) | `DAY#<yyyy-mm-dd>` (`crawls`, ttl 7 days) and `MONTH#<yyyy-mm>` (`crawls`) |
| S3 | `derived/users/<userId>/crawls/<crawlId>/page` (the fetched body) with a lifecycle rule deleting it after 30 days. `derived/` because we fetched it, the user did not upload it, so GuardDuty (which charges per object) does not scan it; it is never served to a browser. Already covered by account deletion. |

`events` (0006 says T06) holds nothing useful yet: the crawl item is the record of the crawl. **Proposal:** build `events` when the first feature reads it (the UI activity list or Phase 2), with a doc note.

### 8. API

| Route | Result |
|---|---|
| `POST /me/crawls` `{url}` | 202 `{crawlId, sourceId, status: "queued"}` (or 200 with the existing crawl if one is already queued or running; 410 while the account is being deleted; 429 when the daily cap is used) |
| `GET /me/crawls/{crawlId}` | The crawl's status, error, and result summary (404 for another user's crawl) |
| `GET /me/crawls` | The user's crawls, newest first (paged) |

Source management (rename, remove, list) is left for T09, when the UI needs it.

### 9. Tests

- Unit: URL validation and normalization, the IP filter (every range and encoding), rebinding, redirect hops, size/time limits (local test server), robots.txt rules, the retry classification table, conditional state transitions.
- Integration (per-PR stack): a real public page succeeds and the S3 object exists; `http://127.0.0.1/` and `http://169.254.169.254/` fail `blocked_address`; a non-existent domain ends `failed`; a duplicate submit returns the same crawl; another user gets 404; account deletion erases the new tables. Test targets must be stable and permit bots. `.invalid` (RFC 6761, never resolves) gives a DNS failure. For pages, a **dev-only test site served by our own API** (public, deterministic, and able to simulate redirects, login walls, shells, slow and large pages), found in T06a: example.com's own page says not to rely on it for testing.

### Cost

Per crawl: one ~5 s Lambda at 256 MB, a few DynamoDB writes, one S3 object kept 30 days. Effectively $0 in the free tier; nothing runs while idle. No new paid services.

### Questions for the maintainer

1. **Plain fetch now, headless browser later (option A)?** JS-only pages fail clearly as `needs_browser` until then.
2. **Respect robots.txt** for user-submitted URLs too?
3. **Daily cap of 20 crawls per user**, and returning the existing crawl for a duplicate submit?
4. **`sourceId` as a hash of the normalized URL** (a small change to 0006's ID note, keys unchanged)?
5. **Build `events` later**, when something reads it?
6. **LinkedIn URLs:** refuse at `POST` for now with a clear message (LinkedIn forbids automated access, and LinkedIn discovery is a separate future task)?

## Decision

Agreed with the maintainer on 2026-09-28, recorded in [0007](../decisions/0007-crawler.md):

1. **Plain fetch now**; JavaScript-only pages fail as `needs_browser`; a browser is added later if the numbers justify it. The fetcher also supports job-board data feeds (a small JSON `POST` for Workday), so T07 reuses it unchanged. Pagination and "code first, LLM last" extraction are T07.
2. **robots.txt respected** for every crawl.
3. **Daily crawl limit per user**, configurable at two levels: an admin default and maximum per stage in SSM Parameter Store (live, no deploy), and the user's own limit up to that maximum. Users can see their limit, the maximum, today's use, and the reset time. A duplicate submit returns the crawl already queued or running.
4. **`sourceId` = hash of the normalized URL** (already per user through the `userId` key).
5. **`events` renamed `audit` and built now**, as the user's audit history: every user and system action on user data, written in the same transaction as the action.
6. **No logins:** anything that asks for one fails as `login_required`; LinkedIn is refused at submit. Pages behind a login are a later decision.

**Shipped as separate PRs**, each tested on its own and leaving `main` working:

| Subtask | What ships |
|---|---|
| [T06a](t06a-safe-fetcher.md) | The safe fetcher library (unit-tested, not wired up) |
| [T06b](t06b-crawl-pipeline.md) | Crawl API, `sources`, `crawls`, and `audit` tables, crawl worker, S3 page storage, crawl audit entries |
| [T06c](t06c-crawl-limits.md) | `usage` table, daily limit (admin and user levels), `GET` and `PUT /me/crawl-settings` |
| [T06d](t06d-audit-existing-actions.md) | Audit entries for the actions shipped before T06 (profile, search settings, roles, résumés) |

## Done when

- [ ] Submitting a URL returns a job ID without waiting for the crawl (T06b).
- [ ] Failures (unreachable, timeout, blocked, invalid URL, internal IP) end as `failed` with a reason, and each has a test (T06a, T06b).
- [ ] T06a–T06d done.
