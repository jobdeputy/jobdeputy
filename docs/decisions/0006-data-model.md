# 0006: Data model (tables, keys, and schemas)

- **Status:** Accepted
- **Date:** 2026-09-28
- **Task:** t04

## Context

Table names and primary keys are hard to change once real data exists; changing them means copying every item to a new table. So the storage shape is designed now for the whole product:

- Phase 1: profile, sources, crawls, jobs, relevance, tailored materials.
- Phase 2: automated applications. These need much more per-user information: application form details, work history, screening answers, site logins, and a full trace of each application.
- Cross-phase: BYOT credentials, usage, and the audit trail.

Tables are built only when their task starts. How data is produced (crawling, LLM tools, scoring, form filling) is decided in those tasks. This record decides only **how it is stored**.

Constraints: DynamoDB on-demand ([0003](0003-serverless-aws-stack.md)), one set of tables per Region cell with no cross-Region data ([0004](0004-regional-cells-and-data-residency.md)), and $0 when idle ([0005](0005-pre-launch-cost-guardrails.md)).

### What is permanent and what is not

| Permanent (a migration to change) | Free to change later |
|---|---|
| Table names, partition keys, sort keys | Attributes on items (schemaless); the attribute lists below can grow |
| Local secondary indexes, so **we do not use any** | Global secondary indexes (can be added or removed at any time) |
| | Streams, time-to-live, backups, and capacity mode |

## Design principles

1. **One table per category of data.** Each table has one purpose, and each Lambda is granted only the tables it needs.
2. **User data is keyed by `userId` first** (the Cognito `sub`, never the email). It stays in the user's home Region. Deleting or exporting an account means "every item under this `userId` in every user table, plus the S3 prefix `users/<userId>/`".
3. **Configuration and counters are separate.** What the user set lives in `preferences`; what the system counted lives in `usage`.
4. **Secrets and sensitive personal data live only in `vault`:** AI keys, site passwords, date of birth, and equal-opportunity answers. `vault` is a normal DynamoDB table, but the values are also encrypted by the application, and only the Lambdas that need them may decrypt. Nothing for `vault` is collected before it is built (Phase 2 or BYOT).
5. **Never stored:** government ID numbers (SSN, Aadhaar, PAN, National Insurance number, passport number) and bank or card details. A form that asks for them stops and asks the user to finish it by hand. Date of birth **is** stored, because forms (especially in India) ask for it, but only in `vault`.
6. **Time-sortable IDs** (ULID) for anything listed by time. Other IDs are ULIDs too, except where noted (`jobId`, `answerId`).
7. **Every item has** `type`, `createdAt`, `updatedAt` (ISO-8601 UTC), and `schemaVersion`, so items can be migrated lazily.
8. **Large content goes to S3** in the same Region. Items hold the S3 key.
9. **Streams exist only where a write starts background work** (`crawls`, `applications`, and the T04 `ping-jobs`).

## Tables at a glance

15 tables per cell. All are on-demand and cost $0 when idle. Names are prefixed with the stack, for example `jobdeputy-dev-iad-users`.

| # | Table | Keys | Category | Stream | Built in |
|---|---|---|---|---|---|
| 1 | `users` | `userId`, `sk` | Who the user is: profile, application details, work history, education | No | T05 |
| 2 | `preferences` | `userId`, `sk` | What the user wants: search settings, target roles, company rules, apply settings | No | T05 |
| 3 | `documents` | `userId`, `documentId` | Résumés, cover letters, and other files (uploaded or generated) | No | T05 |
| 4 | `sources` | `userId`, `sourceId` | Pages the user saved | No | T06 |
| 5 | `crawls` | `userId`, `crawlId` | Each crawl run | **Yes** | T06 |
| 6 | `usage` | `userId`, `sk` | Counters: company limits, daily and monthly usage | No | T06 |
| 7 | `events` | `userId`, `eventId` | Audit trail | No | T06 |
| 8 | `jobs` | `userId`, `jobId` | Jobs found for the user, with relevance and status | No | T07, T08 |
| 9 | `companies` | `companyId` | Shared company list (public, per cell) | No | T07 |
| 10 | `company-aliases` | `alias` | Name or domain → company | No | T07 |
| 11 | `answers` | `userId`, `answerId` | Reusable answers to screening questions | No | Phase 2 |
| 12 | `applications` | `userId`, `sk` | Applications and every step taken | **Yes** | Phase 2 |
| 13 | `vault` | `userId`, `sk` | Encrypted secrets: AI keys, site logins, sensitive answers | No | Future |
| 14 | `ping-jobs` | `id` | T04 test items (expire after 7 days) | **Yes** | T04 |
| 15 | `idempotency` | `id` | Duplicate-delivery protection (expires after 1 hour) | No | T04 |

## Schemas

Every table's attributes and the S3 layout are documented in the living reference, [docs/data-model.md](../data-model.md), which also sets the rules for changing them.

## Cases covered

| Case | Handling |
|---|---|
| Several target roles and résumés | Each role can link a résumé. Each job stores a score per role. Changing roles triggers an async re-score. |
| One page with many companies | The company is resolved per job (`companyId` plus the raw name). If it cannot be resolved, the job is flagged for review and not counted. |
| Same job from two sources, or re-crawled | Stored once (deterministic `jobId`); `sourceIds` records both sources. |
| Job closes or is edited | `closedAt` is set, or the `contentHash` changes and the job is re-scored. |
| Workday-style site accounts | A login created during an application is saved in `vault`, and later applications to that site reuse it. |
| Recurring screening questions | Answered from `answers`. New questions are suggested by the LLM and used only once approved, unless the user's settings allow otherwise. |
| Questions asking for government IDs or bank details | The form is never auto-filled; the application moves to `needs_input`. |
| Duplicate company entries | They are merged with `mergedInto`, so no references break. |
| Traceability | Every application step is an item with an optional screenshot, and every notable action is an `events` item. |
| Listing jobs by status, score, or company | The user's jobs are queried and filtered in the Lambda (hundreds of items). A global secondary index can be added later without a migration. |

## Future (not built now)

- **Shared postings:** a per-Region `postings` table so that a page saved by many users is extracted once. `jobId` is already the posting's hash, so jobs can be linked to it without new IDs.
- **Counting applications** (`countsOn = applied`), with reserve, commit, and release on the same counters.

## Consequences

- Until shared postings exist, job data is duplicated per user. That is fine at this scale.
- T04 builds only `ping-jobs` and `idempotency`, plus a reusable "table + stream + Pipe + queue + worker" construct that `crawls` (T06) and `applications` (Phase 2) reuse.
