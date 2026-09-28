# 0006: Data model (tables, keys, companies, and limits)

- **Status:** Proposed (under discussion in T04)
- **Date:** 2026-09-27
- **Task:** t04

## Context

Table names and primary keys are hard to change once real data exists; changing them means copying every item to a new table. So the whole product is designed up front: Phase 1 (profile, sources, crawls, jobs, relevance, materials), Phase 2 (applications), and the cross-phase features (BYOT credentials, usage limits, audit trail). Tables are built only when their task starts. This record fixes the shape so that later tasks do not have to migrate data.

Constraints: DynamoDB on-demand ([0003](0003-serverless-aws-stack.md)), one set of tables per Region cell with no cross-Region data ([0004](0004-regional-cells-and-data-residency.md)), and $0 when idle ([0005](0005-pre-launch-cost-guardrails.md)).

### What is permanent and what is not

| Permanent (a migration to change) | Free to change later |
|---|---|
| Table names, partition keys, sort keys | Attributes on items (schemaless) |
| Local secondary indexes, so **we do not use any** | Global secondary indexes (can be added or removed at any time) |
| | Streams, time-to-live, backups, and capacity mode |

## Design principles

1. **One table per category of data.** Each table has one purpose, and each Lambda is granted only the tables it needs.
2. **Two kinds of data:**
   - **User data** is keyed by `userId` first. It stays in the user's home Region, and deleting or exporting an account means "everything under this `userId`".
   - **Shared job-market data** (companies and job postings) is public information, not user data. It is shared by users in the same Region and never copied to another Region.
3. **`userId` is the Cognito `sub`**, never the email address, which can change.
4. **Time-sortable IDs** (ULID) for anything listed by time: crawls, applications, and events. Sorting by the key needs no index.
5. **Every item has** `type`, `createdAt`, `updatedAt` (ISO-8601 UTC), and `schemaVersion` so that items can be migrated lazily.
6. **Large content goes to S3** in the same Region (résumé files, page snapshots, generated documents, proof screenshots). Items hold the S3 key.
7. **Streams exist only where a write starts background work.**

## Tables

All tables are per cell and on-demand. The name is prefixed with the stack, for example `jobdeputy-dev-iad-users`.

### User data (partition key `userId`)

| Table | Sort key | Holds | Stream | Built in |
|---|---|---|---|---|
| `users` | `sk` | Profile, target roles, résumés, company rules | No | T05 |
| `sources` | `sourceId` | Pages the user saved (Meta careers, AWS jobs, an aggregator) | No | T06 |
| `crawls` | `crawlId` (ULID) | One crawl run of a source: status, stats, errors, LLM usage | **Yes** → crawl worker | T06 |
| `jobs` | `postingId` | The user's view of a posting: relevance, matched role, status, limit state | No | T07, T08 |
| `materials` | `materialId` | Tailored résumés and cover letters (files in S3) | Later | Future |
| `applications` | `applicationId` (ULID) | Phase 2 applications with a status timeline and proof | Later | Phase 2 |
| `usage` | `period` (for example `2026-10`) | Monthly counters: crawls, LLM calls, and tokens (for quotas and premium) | No | T06 |
| `events` | `eventId` (ULID) | Audit trail: what happened, when, and by whom (user or automation). Expires after 1 year. | No | T06 |
| `credentials` | `provider` | BYOT keys, encrypted. A separate table so only the AI caller can read it. | No | Future |

The `users` table holds several item kinds, because they are all small settings that the settings page loads together:

| `sk` | Item |
|---|---|
| `PROFILE` | Name, contact, location, work authorization, links, preferences (remote, locations, minimum salary) |
| `ROLE#<roleId>` | A target role: title, alternative titles, seniority, locations, must-have and excluded keywords, linked résumé, active flag. There can be several. |
| `RESUME#<resumeId>` | Uploaded résumé: S3 key, file name, parsed skills and experience, default flag. There can be several. |
| `COMPANY_RULE#<companyId>` | A per-company rule (see below). `COMPANY_RULE#*` is the default for companies the user did not list. |

### Shared job-market data (per cell, not user data)

| Table | Keys | Holds | Built in |
|---|---|---|---|
| `companies` | `companyId` | Canonical company: display name, domains, parent company, ATS boards, `verified` flag | T07 |
| `company-aliases` | `alias` | A normalized name or domain → `companyId` (for example `aws` → `amazon`) | T07 |
| `postings` | `postingId` | One job posting, extracted once and reused by every user who crawls it | T07 |

A **posting** holds the company (raw name and `companyId`), title, locations, remote type, employment type, seniority, salary (minimum, maximum, currency, period), the description text (trimmed; a snapshot of the full page goes to S3 with a 30-day lifecycle), the apply URL, the ATS and external ID, the posted date, first seen and last seen, closed date, content hash, and how it was extracted (parser or LLM, with version).

### Infrastructure tables

| Table | Holds | Built in |
|---|---|---|
| `ping-jobs` | T04 test items, expired after 7 days | T04 |
| `idempotency` | Duplicate-delivery protection records, expired after 1 hour | T04 |

## Why postings are shared and jobs are per user

If 100 users in India save the Amazon careers page, extracting it 100 times wastes 100 times the crawl time and LLM tokens (including users' own BYOT tokens). Instead:

- A **posting** is public data, extracted once per Region and deduplicated.
- A **job** is one user's relationship to a posting: their relevance score, matched role, status, and notes. It is keyed `userId` + `postingId`, so a user can never have the same posting twice.

Users never see each other's sources, jobs, or activity. Only the public posting is shared, and only within one Region.

**Posting identity (deduplication):** `postingId` is a hash of the best available key:

1. The ATS and its job ID (for example `greenhouse:stripe:12345`).
2. Otherwise, the canonical apply URL (lowercased host, tracking parameters removed).
3. Otherwise, company + title + location + source.

So the same job reached from the Meta page and from an aggregator becomes one posting. A **content hash** detects edits, and it also flags likely reposts (same company, title, and description under a new ID) so that a user is warned before applying twice.

## Companies: turning page text into a company

A single source can hold one company (amazon.jobs) or many (an aggregator or a LinkedIn search). So the company is resolved **per posting**, not per source.

Resolution, cheapest first. Each step runs only if the previous one found nothing.

1. **Source hint.** If a source is single-company (a known careers domain or an ATS board such as `boards.greenhouse.io/stripe`), the company is detected when the source is saved, and the user confirms it ("This page is for: Amazon ✓"). Postings from it default to that company.
2. **Structured data.** Many pages include `JobPosting.hiringOrganization` (JSON-LD) or come from an ATS API that names the company. No LLM is needed.
3. **LLM extraction.** For unstructured pages, the extraction call that already reads the page also returns each posting's company name. There is **no separate LLM call**, and it stays within the [0002](0002-llm-loop-and-token-budget.md) limits.
4. **Resolve the name to a `companyId`.** Normalize it (lowercase; remove legal suffixes such as Inc, LLC, Ltd, Pvt Ltd, GmbH, and plc; remove `.com` and punctuation), then look it up in `company-aliases`, then by the apply URL's domain. If there is no match, create a new company with `verified = false`.
5. **Unresolved** (no company found at all): the job is marked "company needs review" in the UI. It is **never auto-applied** in Phase 2 and does not count against a limit until the user picks a company.

**Where aliases come from:**

- A **curated alias list in the repository**, reviewed through PRs and loaded into every cell. For example: AWS, Amazon Web Services, and Amazon.com Services LLC → `amazon`; Facebook and Meta Platforms → `meta`; Whole Foods Market → its own company with parent `amazon`.
- **Not from users or the LLM directly**, because shared data must not be changed by one user's input (abuse) or by a model guess (wrong merges).
- A user who wants two companies counted together adds both to one of their own rules (below). That affects only them.

## Company rules and limit tracking

A rule lives in the user's `users` table as `COMPANY_RULE#<companyId>`:

| Field | Meaning |
|---|---|
| `mode` | `limit` (cap applications), `block` (never show or apply; for example the current employer), or `prefer` (rank higher) |
| `maxApplications` | For example Amazon 10, Google 3 |
| `period` | `lifetime` or `month` |
| `includeSubsidiaries` | Count companies whose parent is this company (for example Whole Foods → Amazon) |
| `extraCompanyIds` | The user's own grouping (for example also count `twitch`) |
| `used`, `reserved`, `periodKey` | Counters, updated atomically (below) |

The default rule `COMPANY_RULE#*` applies to companies the user did not list (for example "at most 5", or unlimited).

**Tracking (Phase 2, applications):**

1. **Reserve.** When an application is queued, one transaction creates the application (on the condition that none exists for this posting, so there is no double apply) **and** increments `reserved` on every matching rule, on the condition that `used + reserved < maxApplications`. If the limit is reached, the whole transaction fails, and nothing is queued.
2. **Commit.** When the application is submitted, `reserved` moves to `used`.
3. **Release.** If it fails or the user cancels before submitting, `reserved` is decremented.
4. **Manual.** "I already applied" (outside JobDeputy) also counts toward `used`.
5. **Monthly period.** If `periodKey` is not the current month, the same write resets the counters to the new month.

This is exact even when two applications run at the same time, and it needs no separate counter table.

**Phase 1 (showing jobs):** there are no counters. After scoring, each company's jobs are ranked for the user, and the top jobs up to the remaining limit are marked `withinLimit`. The rest are still stored but are shown collapsed as "over company limit". Changing a limit only re-ranks; nothing is lost.

## Other cases covered

| Case | Handling |
|---|---|
| Several target roles | Each job stores a score per role and its best-matching role. Changing roles triggers an async re-score of the user's jobs. |
| Several résumés | Each role can link a résumé; one is the default. |
| Same posting from two sources | One posting (deduplication). The user's job records both source IDs. |
| Posting closes | `lastSeenAt` stops updating. After a crawl of its source no longer finds it, it gets `closedAt`, and the job shows "closed". |
| Posting edited | The content hash changes. The posting is updated, and the job is re-scored. |
| Salary in INR, GBP, or USD | Stored with its currency and period, never converted in storage. |
| Account deletion or data export | Query every user table by `userId`, plus the S3 prefix `users/<userId>/`. Shared postings hold no user data. |
| Cost control per user | The `usage` table caps crawls and LLM tokens per month (platform tokens for premium users; tracked for BYOT). |
| Traceability (Phase 2) | Every automated step writes an `events` item. Screenshots and proof go to S3. |
| Listing jobs by status or score | Query the user's jobs and filter in the Lambda (hundreds of items). Add a global secondary index later if needed; that needs no migration. |

## Consequences

- There are about 13 tables at the end of Phase 2; all cost $0 when idle.
- Company resolution quality depends on the curated alias list, which grows through PRs.
- Shared postings mean that the extraction code must never write user data into a posting.
- T04 builds only `ping-jobs` and `idempotency`, plus a reusable "table + stream + Pipe + queue + worker" construct that `crawls` reuses in T06.
