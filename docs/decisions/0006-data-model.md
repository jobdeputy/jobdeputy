# 0006: Data model (tables, keys, companies, and limits)

- **Status:** Proposed (under discussion in T04)
- **Date:** 2026-09-27
- **Task:** t04

## Context

Table names and primary keys are hard to change once real data exists; changing them means copying every item to a new table. So the storage shape is designed up front for the whole product: Phase 1 (profile, sources, crawls, jobs, relevance, materials), Phase 2 (applications), and the cross-phase features (BYOT credentials, usage, audit trail). Tables are built only when their task starts. How the data is produced (crawling, LLM tools, scoring) is decided in those tasks; this record decides only **how it is stored**.

Constraints: DynamoDB on-demand ([0003](0003-serverless-aws-stack.md)), one set of tables per Region cell with no cross-Region data ([0004](0004-regional-cells-and-data-residency.md)), and $0 when idle ([0005](0005-pre-launch-cost-guardrails.md)).

### What is permanent and what is not

| Permanent (a migration to change) | Free to change later |
|---|---|
| Table names, partition keys, sort keys | Attributes on items (schemaless) |
| Local secondary indexes, so **we do not use any** | Global secondary indexes (can be added or removed at any time) |
| | Streams, time-to-live, backups, and capacity mode |

## Design principles

1. **One table per category of data.** Each table has one purpose, and each Lambda is granted only the tables it needs.
2. **User data is keyed by `userId` first.** It stays in the user's home Region, and deleting or exporting an account means "everything under this `userId`".
3. **`userId` is the Cognito `sub`**, never the email address, which can change.
4. **Configuration and counters are separate.** What the user set (rules) lives in `users`. What the system counted lives in `usage`. So the counting logic can change without touching the user's settings.
5. **Time-sortable IDs** (ULID) for anything listed by time: crawls, applications, and events.
6. **Every item has** `type`, `createdAt`, `updatedAt` (ISO-8601 UTC), and `schemaVersion` so that items can be migrated lazily.
7. **Large content goes to S3** in the same Region (résumé files, page snapshots, generated documents, proof screenshots). Items hold the S3 key.
8. **Streams exist only where a write starts background work.**

## Tables

All tables are per cell and on-demand. The name is prefixed with the stack, for example `jobdeputy-dev-iad-users`.

### User data (partition key `userId`)

| Table | Sort key | Holds | Stream | Built in |
|---|---|---|---|---|
| `users` | `sk` | Profile, target roles, résumés, company rules (all user settings) | No | T05 |
| `sources` | `sourceId` | Pages the user saved (Meta careers, AWS jobs, an aggregator) | No | T06 |
| `crawls` | `crawlId` (ULID) | One crawl run of a source: status, stats, errors, LLM usage | **Yes** → crawl worker | T06 |
| `jobs` | `jobId` | Jobs found for this user: the full posting plus relevance, matched role, and status | No | T07, T08 |
| `usage` | `sk` | Counters: jobs found per company per window, and monthly crawl and LLM usage | No | T06 |
| `events` | `eventId` (ULID) | Audit trail: what happened, when, and by whom (user or automation). Expires after 1 year. | No | T06 |
| `materials` | `materialId` | Tailored résumés and cover letters (files in S3) | Later | Future |
| `applications` | `applicationId` (ULID) | Phase 2 applications with a status timeline and proof | Later | Phase 2 |
| `credentials` | `provider` | BYOT keys, encrypted. A separate table so only the AI caller can read it. | No | Future |

**`users` items:**

| `sk` | Item |
|---|---|
| `PROFILE` | Name, contact, location, work authorization, links, preferences (remote, locations, minimum salary) |
| `ROLE#<roleId>` | A target role: title, alternative titles, seniority, locations, must-have and excluded keywords, linked résumé, active flag. There can be several. |
| `RESUME#<resumeId>` | Uploaded résumé: S3 key, file name, parsed skills and experience, default flag. There can be several. |
| `COMPANY_RULE#<companyId>` | A per-company rule, configured by each user (see below). `COMPANY_RULE#*` is the user's default for companies they did not list. |

**`usage` items:**

| `sk` | Item |
|---|---|
| `COMPANY#<companyId>` | Jobs counted for this company in the current window: `count`, `windowStart` |
| `MONTH#<yyyy-mm>` | Crawls run, LLM calls, input and output tokens |

**`jobs` items** hold everything about the posting: company (raw name and `companyId`), title, locations, remote type, employment type, seniority, salary (minimum, maximum, currency, period), the description text (trimmed; a snapshot of the full page goes to S3 with a 30-day lifecycle), the apply URL, the ATS and external ID, the posted date, and first seen, last seen, and closed dates. They also hold the user's part: source IDs and crawl IDs where it was found, score per role, best-matching role, status (`new`, `shortlisted`, `dismissed`, and later `applied`), `limitState` (`counted` or `over_limit`), and a content hash.

**Job identity (deduplication):** `jobId` is a hash of the best available key:

1. The ATS and its job ID (for example `greenhouse:stripe:12345`).
2. Otherwise, the canonical apply URL (lowercased host, tracking parameters removed).
3. Otherwise, company + title + location.

So the same job reached from the Meta page and from an aggregator is stored once for the user, and a re-crawl updates the existing job instead of adding a copy. Because the ID depends only on the posting, the future shared postings table (below) can use the same ID.

### Company data (per cell, not user data)

Company names are public facts, not user data, so one company list serves every user in a Region, and it never leaves that Region. It is written **live** by the pipeline, for example by LLM tools such as "find company" and "create company or alias" (designed in T07). Every write records where it came from.

| Table | Key | Holds |
|---|---|---|
| `companies` | `companyId` | Display name, domains, parent company (if known), ATS boards, `createdBy` (`parser`, `llm`, or `curated`), `verified` |
| `company-aliases` | `alias` (normalized name or domain) | → `companyId`, `createdBy`, `confidence` (for example `aws` → `amazon`) |

### Infrastructure tables

| Table | Holds | Built in |
|---|---|---|
| `ping-jobs` | T04 test items, expired after 7 days | T04 |
| `idempotency` | Duplicate-delivery protection records, expired after 1 hour | T04 |

## Companies: turning page text into a company

A single source can hold one company (amazon.jobs) or many (an aggregator or a LinkedIn search). So the company is resolved **per job**, not per source. The job stores both the raw name from the page and the resolved `companyId`. A job whose company cannot be resolved gets `companyId = null`; it is marked "company needs review" and does not count toward any limit until the company is resolved. The resolution steps and the LLM tools are designed in T07.

## Company rules and limit tracking

Each user configures their own rules. Another user's rules, counters, and jobs are never visible.

**Rule (configuration), in `users` as `COMPANY_RULE#<companyId>`:**

| Field | Meaning | Default |
|---|---|---|
| `mode` | `limit`, `block` (never keep; for example the current employer), or `prefer` (rank higher) | `limit` |
| `maxJobs` | For example Amazon 10, Google 3 | from the user's default rule |
| `windowDays` | The counting window, configurable per rule | 30 |
| `countsOn` | What is counted: `found` now; `applied` later | `found` |
| `extraCompanyIds` | The user's own grouping (for example also count `twitch` under this rule) | none |

**Counter (state), in `usage` as `COMPANY#<companyId>`:** `count` and `windowStart`.

**How a found job is counted:**

1. The job's company and, **if known**, its parent company are looked up. For example, a Whole Foods job counts toward Amazon only if the company data records Amazon as its parent. If the parent is not known, it counts only toward Whole Foods.
2. For each matching rule, a single conditional write increments the counter only while the window is current and `count < maxJobs`. If `windowStart` is older than `windowDays`, the same write starts a new window at 1. This is exact even when two crawls run at the same time.
3. If the job fits, it is stored with `limitState = counted`. If the limit is full, it is stored with `limitState = over_limit` and hidden by default. Raising the limit can bring it back without crawling again.
4. Within one crawl, jobs are admitted best-score first, so the kept jobs are the most relevant ones.

**Changing what is counted later** (for example applications in Phase 2) means setting `countsOn = applied` and counting at application time instead. The rule and counter items keep their shape, so no migration is needed.

## Other cases covered

| Case | Handling |
|---|---|
| Several target roles | Each job stores a score per role and its best-matching role. Changing roles triggers an async re-score of the user's jobs. |
| Several résumés | Each role can link a résumé; one is the default. |
| Same job from two sources | Stored once (deterministic `jobId`). The job records both source IDs. |
| Job closes | `lastSeenAt` stops updating. When a crawl of its source no longer finds it, it gets `closedAt`, and the UI shows "closed". |
| Job edited | The content hash changes. The job is updated and re-scored. |
| Salary in INR, GBP, or USD | Stored with its currency and period, never converted in storage. |
| Account deletion or data export | Query every user table by `userId`, plus the S3 prefix `users/<userId>/`. |
| Cost control per user | `usage` `MONTH#` counters cap crawls and LLM tokens per month. |
| Traceability (Phase 2) | Every automated step writes an `events` item. Screenshots and proof go to S3. |
| Listing jobs by status, score, or company | Query the user's jobs and filter in the Lambda (hundreds of items). Add a global secondary index later if needed; that needs no migration. |

## Future (not built now)

- **Shared postings.** A per-Region `postings` table so that a page saved by many users is extracted once. Jobs would then reference a posting. Because `jobId` is already the posting's hash, existing jobs can be copied into it without changing their IDs.
- **Counting applications** (`countsOn = applied`) in Phase 2, with a reserve, commit, and release step on the same counters.

## Consequences

- There are about 13 tables at the end of Phase 2; all cost $0 when idle.
- Job data is duplicated per user until shared postings exist. That is fine at this scale.
- T04 builds only `ping-jobs` and `idempotency`, plus a reusable "table + stream + Pipe + queue + worker" construct that `crawls` reuses in T06.
