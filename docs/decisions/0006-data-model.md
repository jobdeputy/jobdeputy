# 0006: Data model (tables, keys, and schemas)

- **Status:** Proposed (under discussion in T04)
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
4. **Secrets and sensitive answers live only in `vault`**, encrypted, and are readable only by the Lambdas that need them.
5. **Never stored:** government ID numbers (SSN, Aadhaar, PAN, National Insurance number, passport number), bank or card details, and date of birth. A form that asks for them stops and asks the user to finish it by hand.
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

Types: `S` string, `N` number, `B` boolean, `L` list, `M` map. `?` means optional. Dates are ISO-8601 UTC. Money is always `{ amount, currency, period }` (for example `{ 4500000, "INR", "year" }`) and is never converted in storage.

### 1. `users`: who the user is

| `sk` | Attributes |
|---|---|
| `PROFILE` | `firstName`, `lastName`, `preferredName?`, `email`, `phone? {countryCode, number}`, `location {city, region, country, postalCode?}`, `address? {line1, line2?, city, region, postalCode, country}`, `headline?`, `summary?`, `yearsExperience?`, `skills L<S>`, `languages L<{name, level}>`, `links {linkedin?, github?, portfolio?, website?, other L}`, `homeCell` (`iad`, `bom`, or `lhr`), `timezone` |
| `APPLICANT` | Details that application forms ask for: `workAuthorization L<{country, status, visaType?, expiresOn?}>` (status: `citizen`, `permanent_resident`, `visa`, or `none`), `needsSponsorship M<country, B>`, `noticePeriodDays?`, `earliestStartDate?`, `currentCompensation?` (money), `expectedCompensation?` (money), `willingToRelocate B`, `relocationCountries L`, `maxTravelPercent?`, `securityClearance?`, `over18 B`, `formerEmployers L<companyId>` |
| `EXPERIENCE#<id>` | `company`, `companyId?`, `title`, `employmentType?`, `location?`, `startDate` (yyyy-mm), `endDate?` (absent while current), `description?`, `highlights L`, `skills L` |
| `EDUCATION#<id>` | `school`, `degree`, `field?`, `startDate?`, `endDate?`, `grade?`, `highlights L` |
| `CERTIFICATION#<id>` | `name`, `issuer`, `issuedOn?`, `expiresOn?`, `credentialUrl?` |

Work history and education are prefilled from the parsed résumé, and the user edits them. Application forms (for example Workday's employment history) are filled from these items.

### 2. `preferences`: what the user wants

| `sk` | Attributes |
|---|---|
| `SEARCH` | `locations L<{city?, region?, country}>`, `workplace L` (`onsite`, `hybrid`, `remote`), `employmentTypes L` (`full_time`, `contract`, …), `minSalary?` (money), `seniority L`, `excludeKeywords L` |
| `ROLE#<roleId>` | `title`, `altTitles L`, `seniority L`, `locations? L` (overrides `SEARCH`), `mustHave L`, `exclude L`, `resumeDocumentId?`, `priority N`, `active B` |
| `COMPANY_RULE#<companyId>` | `mode` (`limit`, `block`, or `prefer`), `maxJobs N`, `windowDays N` (default 30), `countsOn` (`found` now; `applied` later), `extraCompanyIds L`, `note?`. The sort key `COMPANY_RULE#*` is the user's default for companies they did not list. |
| `APPLY_SETTINGS` | `mode` (`off`, `review_each`, or `auto_within_rules`), `dailyMax N`, `alwaysReview L` (for example `cover_letter`, `custom_questions`), `quietHours? {start, end, timezone}`, `notify {email B}` |

### 3. `documents`: files

Key: `userId`, `documentId`.

`kind` (`resume`, `cover_letter`, `transcript`, `portfolio`, or `other`), `origin` (`uploaded` or `generated`), `title`, `fileName`, `mimeType`, `sizeBytes`, `s3Key`, `sha256`, `status` (`processing`, `ready`, or `failed`), `isDefault B`, `version N`.

- For uploaded résumés: `parsed? {textS3Key, skills L, experienceIds L}`.
- For generated documents: `baseDocumentId`, `jobId`, `roleId?`, `generation {provider, model, promptVersion, inputTokens, outputTokens}`.

### 4. `sources`: pages the user saved

Key: `userId`, `sourceId`.

`url`, `normalizedUrl`, `label?`, `kind` (`company_careers`, `ats_board`, `aggregator`, `linkedin_search`, or `unknown`), `ats?` (`greenhouse`, `lever`, `workday`, `ashby`, …), `companyHint?` (`companyId`, for single-company pages), `companyConfirmed B`, `active B`, `schedule {type}` (`manual` now; `daily` later), `lastCrawlId?`, `lastCrawledAt?`, `stats {lastFound, totalJobs}`.

### 5. `crawls`: crawl runs (stream → crawl worker)

Key: `userId`, `crawlId` (ULID).

`sourceId`, `url` (a copy at crawl time), `trigger` (`user`, `schedule`, or `redrive`), `status` (`queued`, `running`, `succeeded`, `failed`, or `cancelled`), `attempts N`, `startedAt?`, `finishedAt?`, `stats {pagesFetched, jobsFound, jobsNew, jobsUpdated, jobsRelevant, jobsOverLimit, jobsClosed}`, `error? {code, message}`, `llm {provider (byot or platform), model, calls, inputTokens, outputTokens}`, `ttl` (180 days).

### 6. `usage`: counters

| `sk` | Attributes |
|---|---|
| `COMPANY#<companyId>` | `count N`, `windowStart`, `windowDays N`, `countsOn` |
| `DAY#<yyyy-mm-dd>` | `crawls N`, `applications N`, `ttl` (7 days). Enforces daily caps. |
| `MONTH#<yyyy-mm>` | `crawls N`, `llmCalls N`, `inputTokens N`, `outputTokens N`, `applications N` |

**How a found job is counted against a company rule:** the job's company and, if known, its parent company are looked up. For each matching rule, one conditional write increments `count` only while the window is current and `count < maxJobs`. If the window has expired, the same write starts a new window at 1. This stays exact even when two crawls run at once. A job that fits gets `limitState = counted`. Otherwise it gets `over_limit` and is hidden but kept. Within one crawl, the best-scoring jobs are admitted first. Counting applications later only changes `countsOn`.

### 7. `events`: audit trail

Key: `userId`, `eventId` (ULID, so events are ordered by time).

`name` (for example `crawl.started`, `job.found`, `rule.changed`, `application.submitted`), `entity {type, id}`, `actor` (`user`, `system`, or `automation`), `summary`, `detail? M` (never secrets or sensitive answers), `ttl` (1 year).

### 8. `jobs`: jobs found for the user

Key: `userId`, `jobId`. `jobId` is a hash of the best available posting key: the ATS and its job ID; otherwise the canonical apply URL; otherwise company + title + location. So the same job is stored once per user, and a re-crawl updates it.

| Group | Attributes |
|---|---|
| Posting | `dedupeKey`, `companyId?`, `companyName` (raw), `title`, `locations L<{city?, region?, country?}>`, `workplace?`, `employmentType?`, `seniority?`, `salary?` (`{min, max, currency, period}`), `description` (up to 32 KB), `descriptionS3Key?`, `jobUrl`, `applyUrl`, `ats?`, `externalId?`, `postedAt?`, `contentHash` |
| Discovery | `sourceIds L`, `firstCrawlId`, `lastCrawlId`, `firstSeenAt`, `lastSeenAt`, `closedAt?`, `extraction {method (parser or llm), version}` |
| Relevance | `scores M<roleId, N>`, `bestRoleId?`, `score N`, `reasons L` (short), `scoredAt`, `scoringVersion` |
| User | `status` (`new`, `shortlisted`, `dismissed`, `applying`, `applied`, or `archived`), `limitState` (`counted`, `over_limit`, or `uncounted`), `companyNeedsReview B`, `starred B`, `notes?`, `applicationId?` |

### 9. `companies`: shared company list (public, per cell)

Key: `companyId` (a slug, for example `amazon`).

`name`, `normalizedName`, `domains L`, `parentCompanyId?`, `atsBoards L<{ats, slug}>`, `careersUrl?`, `createdBy` (`parser`, `llm`, or `curated`), `confidence N`, `verified B`, `mergedInto?` (set when a duplicate is merged later, so old references still resolve).

### 10. `company-aliases`

Key: `alias` (a normalized name, domain, or ATS board, for example `aws`, `amazon.jobs`, or `greenhouse:stripe`).

`companyId`, `kind` (`name`, `domain`, or `ats_board`), `createdBy`, `confidence N`.

### 11. `answers`: reusable screening answers (Phase 2)

Key: `userId`, `answerId` (a hash of the normalized question, so the same question is stored once).

`question`, `category` (`work_authorization`, `compensation`, `availability`, `experience`, `motivation`, or `custom`), `answerType` (`text`, `yes_no`, `choice`, `number`, or `date`), `answer`, `options? L`, `scope` (`global`, or a `companyId`), `source` (`user` or `llm_suggested`), `approved B` (LLM suggestions are used only after the user approves them), `useCount N`, `lastUsedAt?`.

Sensitive questions (gender, ethnicity, veteran status, disability) are never stored here; see `vault`.

### 12. `applications`: Phase 2 (stream → apply worker)

Key: `userId`, `sk`. One application and its steps share a prefix, so `begins_with(sk, "<applicationId>")` returns the application with its full trace.

| `sk` | Attributes |
|---|---|
| `<applicationId>` | `jobId`, `companyId?`, `status` (`draft`, `awaiting_review`, `queued`, `in_progress`, `needs_input`, `submitted`, `failed`, `cancelled`, or `withdrawn`), `mode` (`manual`, `assisted`, or `auto`), `approvedAt?`, `documents {resumeId, coverLetterId?}`, `answers L<{question, answerId?, source}>` (references, not sensitive values), `siteLoginRef?` (a `vault` key), `attempts N`, `submittedAt?`, `confirmation? {reference?, screenshotS3Key?}`, `error? {code, message}`, `outcome?` (`no_response`, `rejected`, `interview`, or `offer`; set by the user), `outcomeAt?` |
| `<applicationId>#STEP#<ulid>` | `action` (`open`, `login`, `fill`, `upload`, `answer`, `review`, or `submit`), `status`, `detail`, `screenshotS3Key?`, `llm? {calls, inputTokens, outputTokens}` |

### 13. `vault`: encrypted secrets (Future)

Key: `userId`, `sk`. Values are encrypted in the application before they are written. The encryption design (KMS, which needs a cost exception under [0005](0005-pre-launch-cost-guardrails.md)) is decided when this table is built.

| `sk` | Attributes |
|---|---|
| `AI_KEY#<provider>` | `ciphertext`, `last4`, `status`, `lastUsedAt?` |
| `SITE_LOGIN#<domain>` | `username`, `ciphertext` (password), `createdBy` (`user` or `automation`, for example a Workday account created while applying), `lastLoginAt?` |
| `SENSITIVE` | `ciphertext` of voluntary equal-opportunity answers (gender, ethnicity, veteran status, disability). The default is "decline to answer". |

### 14–15. Infrastructure

- `ping-jobs` (key `id`): `status`, `attempts`, `sideEffectCount`, `fail?` (dev-only test flag), `error?`, `ttl` (7 days).
- `idempotency` (key `id`): Powertools' own schema, with `expiration` as its time-to-live.

## S3 layout (one bucket per cell)

```text
users/<userId>/documents/<documentId>/<file>       résumés, cover letters, other files
users/<userId>/applications/<applicationId>/...    screenshots and confirmations
users/<userId>/snapshots/<jobId>/...               page snapshots (deleted after 30 days)
```

Everything under `users/<userId>/` goes with account deletion or export.

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
