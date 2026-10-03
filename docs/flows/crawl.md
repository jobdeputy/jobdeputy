# Flow: from a submitted link to stored jobs (T06, T07)

What happens when a user submits a careers-page URL: which part runs, where each piece of information is stored, and how the parts connect. Everything runs inside one Region's cell ([0004](../decisions/0004-regional-cells-and-data-residency.md)).

- **Tasks:** [T06](../tasks/t06-async-crawl-pipeline.md) (crawl pipeline: [T06a](../tasks/t06a-safe-fetcher.md) fetcher, [T06b](../tasks/t06b-crawl-pipeline.md) pipeline, [T06c](../tasks/t06c-crawl-limits.md) limits), [T07](../tasks/t07-job-extraction-storage.md) (extraction: [T07a](../tasks/t07a-job-readers.md) readers, [T07b](../tasks/t07b-jobs-storage.md) storage, [T07c](../tasks/t07c-paging-and-closed-jobs.md) paging and closed jobs). What happens next: [relevance flow](relevance.md).
- **Visual version** (maintainer only, private link): <https://claude.ai/artifact/M8sKArJVsE8GBSZVbS6b5s>
- **Keep it true:** a PR that changes this flow updates this file, like [data-model.md](../data-model.md).

## The big picture

The API never does the slow work. It records the request and answers at once. The `crawls` table's stream, an EventBridge Pipe, and an SQS queue hand the crawl to the crawl worker. The user polls the API for the result.

```mermaid
flowchart LR
  U([User]) -->|POST /me/crawls| API[Crawls API Lambda]
  API -->|one transaction| T1[(sources)]
  API --> T2[(crawls<br/>status: queued)]
  API --> T3[(usage<br/>DAY#, ACTIVE)]
  API --> T4[(audit)]
  T2 -->|stream: new queued crawl| P[EventBridge Pipe]
  P --> Q[[crawls queue<br/>SQS + dead-letter queue]]
  Q --> W[Crawl worker Lambda]
  W -->|safe fetcher| WEB((Careers site<br/>or job board))
  W -->|fetched page| S3[(S3 bucket<br/>derived/.../page)]
  W -->|each job| J[(jobs)]
  W -->|finish| T2
  W --> T1
  W --> T3
  W --> T4
  T2 -.->|T08: succeeded AI crawl| R[Relevance Pipe, AI scoring]
  U -->|GET /me/crawls/id<br/>GET /me/jobs| API2[Crawls and Jobs API]
  API2 --> T2
  API2 --> J
```

## 1. The user submits a link

`POST /me/crawls` (`apps/api/src/crawls.ts`) checks everything it can without touching the web, then writes everything in one DynamoDB transaction: all of it is saved, or none.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant API as Crawls API
  participant SSM as Crawl limits (SSM)
  participant DB as DynamoDB
  User->>API: POST /me/crawls { url, aiSource? }
  API->>API: Validate URL (http/https, no credentials,<br/>no private addresses, no LinkedIn)
  API->>DB: Is the account being deleted? (users DELETION)
  API->>SSM: Admin limits (daily, max active), cached 5 min
  API->>DB: Read the source (sourceId = hash of the normalized URL)
  alt the source already has an active crawl
    API->>DB: Stale (finished or stuck)? End it and free its slot
  end
  API->>DB: TransactWriteItems
  Note over DB: sources: set activeCrawlId (only if none)<br/>crawls: new item, status = queued<br/>usage DAY#date: crawls + 1 (below the daily limit)<br/>usage ACTIVE: add crawlId (below max active)<br/>usage AIWEEK# and MONTH# (free platform AI run only)<br/>audit: crawl.requested
  alt a condition fails
    API-->>User: 429 (a limit) or 409 (crawl already running, or try again)
  else all written
    API-->>User: 202 Accepted { crawlId, status: queued }
  end
```

The source's ID is a hash of the normalized URL, so one user cannot save the same page twice; the `activeCrawlId` condition stops two crawls of one page at once, even when two requests arrive together.

## 2. From the table to the worker

Nothing calls the worker directly. If the API failed right after its write, the crawl still runs: the record is in the table.

```mermaid
sequenceDiagram
  participant C as crawls table
  participant S as DynamoDB stream
  participant P as EventBridge Pipe
  participant Q as crawls queue (SQS)
  participant W as Crawl worker
  C->>S: INSERT (NEW_IMAGE)
  S->>P: record
  P->>P: filter: INSERT with status = queued
  P->>Q: { userId, crawlId }
  Q->>W: message (3 receives, then the dead-letter queue)
```

## 3. The crawl worker

`apps/worker/src/crawl-worker.ts`. One message is one crawl; every stage has a deadline inside the Lambda's time limit.

```mermaid
sequenceDiagram
  autonumber
  participant Q as crawls queue
  participant W as Crawl worker
  participant F as Safe fetcher
  participant Site as Site or job board
  participant S3 as S3 bucket
  participant DB as DynamoDB
  Q->>W: { userId, crawlId }
  W->>DB: Account being deleted? Crawl still queued or running?
  W->>DB: Claim the attempt (status = running, attempts + 1)
  W->>F: readJobs(url)
  F->>Site: robots.txt, then the page or the board's feed
  Site-->>F: HTML or JSON (at most 5 MB, 20 s)
  F-->>W: page, extracted jobs, board, complete or partial
  W->>S3: Store the fetched page (expires after 30 days)
  W->>DB: Load roles, search settings, profile, limits
  W->>W: T08c keyword filter, rank each company's candidates
  opt the board's list has no descriptions (T08d3)
    W->>F: Read the top candidates' postings (at most 50, 1 s apart)
  end
  W->>DB: Save each job (UpdateItem, idempotent)
  W->>DB: Mark jobs pushed over the company limit
  alt the crawl read the whole list
    W->>DB: Close jobs this page no longer lists
  end
  W->>DB: Finish: crawl succeeded with stats, source updated,<br/>ACTIVE slot freed, audit crawl.succeeded
```

### How a link is read (T07a)

`readJobs` (`apps/worker/src/jobs/crawl-jobs.ts`) tries the cheapest, most reliable source first ([0008](../decisions/0008-job-extraction.md)).

```mermaid
flowchart TD
  A[Submitted URL] --> B{A job-board link?<br/>Greenhouse, Lever, Ashby, Workday}
  B -->|yes| F[Read the board's JSON feed<br/>following pages: Lever, Workday]
  B -->|no| C[Fetch the page]
  C --> D{What is on the page?}
  D -->|redirected to a board| F
  D -->|schema.org JobPosting data| G[Read jobs from schema.org]
  D -->|embeds exactly one board| F
  D -->|nothing readable| H{Built by JavaScript?}
  H -->|yes| X[Fail: needs_browser]
  H -->|no| N[Succeeded with 0 jobs: no_readable_jobs<br/>later: LLM extraction, T07d]
  F --> J[Normalize each job]
  G --> J
```

### The safe fetcher (T06a)

- **Public addresses only:** checked when the connection opens, after DNS, so a hostname cannot point the crawler at internal addresses (SSRF).
- **Polite:** obeys robots.txt, waits 1 s between requests to one host, identifies itself as `JobDeputyBot`.
- **Bounded:** 5 s to connect, 20 s and 5 MB per page, 5 redirects, at most 10 extra requests within 150 s.
- **Clear failures:** login pages, JavaScript-only pages, 403 or 429 (blocked), and 404 or 410 (gone) each become a reason on the crawl.

### How a job is stored (T07b)

Every job becomes the same shape in `jobs`. Its `jobId` is a hash of the best posting key available, so a job is stored once per user and a re-crawl updates it:

1. `ats:<companyKey>:<externalId>`: the board's own posting ID (survives title or link changes);
2. otherwise `url:<jobUrl>`, the normalized link;
3. otherwise `text:<companyKey>|<title>|<first place>`, when one link lists several jobs.

A re-crawl sets what it read and never removes a field it did not read: a board's list often carries less than the posting itself.

### When jobs close (T07c)

The source remembers which jobs it listed (`listedJobIds`). After a **complete** crawl, a job the page no longer lists loses that source; with no source left it gets `closedAt`. A **partial** crawl (limits, or a later page that failed) never closes anything. A job listed again is reopened.

## 4. The user sees the result

```mermaid
sequenceDiagram
  actor User
  participant API as Crawls and Jobs API
  participant DB as DynamoDB
  User->>API: GET /me/crawls/{crawlId}
  API->>DB: GetItem crawls (consistent)
  API-->>User: queued, running, succeeded, or failed,<br/>stats (found, new, updated, closed, relevant), reason
  User->>API: GET /me/jobs (shown) or ?view=all
  API->>DB: Query jobs by userId (paged)
  API-->>User: jobs with title, company, places, fit, and why
```

## When things go wrong

| What happened | What the worker does | The crawl ends as |
|---|---|---|
| Blocked, page gone, login wall, robots.txt says no | No retry: these are answers from the web | `failed` with that reason |
| Site unreachable or 5xx | Retries after 30 s, then 120 s (or the site's Retry-After, at most 120 s) | `succeeded`, or `failed` after 3 attempts |
| Our own error (a bug, an AWS outage, the time limit) | Retries; the 3rd attempt ends the crawl, then dead-letters the message | `failed` (`internal`); the queue health check emails |
| A board's feed changed format | Logged as an error; no retry | `failed` |
| A crawl limit (500 jobs, 10 extra requests, 150 s) | Saves what it read; closes nothing | `succeeded`, partial |
| The same message delivered twice | The claim checks the status; saving a job is idempotent | unchanged |

## Where everything is stored

Every table is keyed by `userId` first. Details: [data-model.md](../data-model.md).

| Store | Key | What it holds | Written by |
|---|---|---|---|
| `sources` | `userId`, `sourceId` | Each saved page: URL, normalized URL, kind, board, `activeCrawlId`, jobs it listed last time | API (submit), worker (finish) |
| `crawls` | `userId`, `crawlId` | Each run: status, attempts, AI source, result, stats, reason, candidates for AI. Kept 180 days. | API (`queued`), worker |
| `jobs` | `userId`, `jobId` | The posting, where and when it was found, `closedAt`, the filter verdict and score, the user's own fields | Crawl worker; relevance worker (T08) |
| `usage` | `userId`, `sk` | `DAY#` crawls today, `ACTIVE` running crawls, `MONTH#` totals, `COMPANY#` shown jobs per company | API (counts), worker (frees the slot) |
| `audit` | `userId`, `auditId` | `crawl.requested`, `crawl.succeeded`, `crawl.failed`. Kept 1 year. | API and worker, in the same transaction as the change |
| S3 | `derived/users/<userId>/crawls/<crawlId>/page` | The fetched page. Deleted after 30 days. | Crawl worker |
| SSM | `/jobdeputy/<stack>/crawl-limits` | Admin limits: crawls per day, active crawls, jobs per company, expiry | Admin; read by API and worker |

## Limits

| Scope | Limit |
|---|---|
| Per user (T06c) | 20 crawls a day by default (admin max 50); 1 crawl at a time; 1 crawl per page at a time |
| Per crawl (T07c) | 500 jobs saved; 10 extra requests; 150 s budget; 1 s gap per host |
| Per request (T06a) | 5 s to connect; 20 s and 5 MB per page; 5 redirects |
| Retries | 3 attempts; waits of 30 s and 120 s; then the dead-letter queue |
