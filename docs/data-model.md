# Data model

The living reference for every DynamoDB table and S3 path. The decisions behind it (why these tables, keys, and rules) are in [0006](decisions/0006-data-model.md).

## Rules for changing the schema

1. **Any PR that adds, renames, or removes an attribute or item kind updates this file in the same PR** and adds a line to the [change log](#change-log). The PR template asks for it.
2. **Adding** an optional attribute is always allowed. **Renaming or removing** one, or changing its meaning, bumps that item's `schemaVersion`, and the code must still read the old version (items are migrated lazily when they are next written).
3. **New tables, new keys, or key changes** need a new decision record, because keys are permanent.
4. The code's source of truth is the Zod input schemas in `packages/shared` and the item types in `packages/db`. This file and the code must agree; reviewers check both, and an infra test fails if a deployed table is missing from the [physical schema](#physical-schema-built-tables) below.
5. Never add attributes that 0006 forbids (government ID numbers, bank or card details), and never put secrets or sensitive answers outside `vault`.

## Conventions

- Types: `S` string, `N` number, `B` boolean, `L` list, `M` map. `?` means optional.
- Dates are ISO-8601 UTC. Months are `yyyy-mm`.
- Money is always `{ amount, currency, period }` (for example `{ 4500000, "INR", "year" }`) and is never converted in storage.
- Every item also has `type`, `createdAt`, `updatedAt`, and `schemaVersion`.
- Table names are prefixed with the stack, for example `jobdeputy-dev-iad-users`.

## Physical schema (built tables)

What is deployed today, per cell. Every table is DynamoDB on-demand (`PAY_PER_REQUEST`), encrypted at rest with the AWS-owned key, has no secondary indexes, and never replicates to another Region ([0004](decisions/0004-regional-cells-and-data-residency.md)). Tables described in the sections below but not listed here are designed, not created yet.

| Table | Partition key | Sort key | Stream | Time to live | Backups (PITR) | On stack deletion | Built in |
|---|---|---|---|---|---|---|---|
| `<stack>-users` | `userId` (S) | `sk` (S) | — | — | prod only | dev: deleted; prod: kept | T05b |
| `<stack>-preferences` | `userId` (S) | `sk` (S) | — | — | prod only | dev: deleted; prod: kept | T05b |
| `<stack>-documents` | `userId` (S) | `documentId` (S) | — | `ttl` (pending uploads only) | prod only | dev: deleted; prod: kept | T05c |
| `<stack>-ping-jobs` | `id` (S) | — | `NEW_IMAGE` → Pipe → queue | `ttl` | — | dev: deleted; prod: kept | T04 |
| `<stack>-idempotency` | `id` (S) | — | — | `expiration` | — | dev: deleted; prod: kept | T04 |

### Access patterns

Every user-table call is keyed by the caller's `userId` from the token; no request can name another user.

| Table | Operation | Key | Used by |
|---|---|---|---|
| `users` | `GetItem` (consistent) | `userId`, `sk = PROFILE` | `GET` and `PUT /me/profile` |
| `users` | `PutItem` with `attribute_not_exists(userId)` or `version = :expected` | `userId`, `sk = PROFILE` | `PUT /me/profile` |
| `preferences` | `GetItem` / conditional `PutItem` | `userId`, `sk = SEARCH` | `/me/preferences/search` |
| `preferences` | `Query` `begins_with(sk, "ROLE#")` (consistent) | `userId` | `GET /me/roles`; role count before `POST` |
| `preferences` | `GetItem` / conditional `PutItem` | `userId`, `sk = ROLE#<roleId>` | `POST`, `PUT /me/roles/{roleId}` |
| `preferences` | `DeleteItem` with `attribute_exists(userId)` | `userId`, `sk = ROLE#<roleId>` | `DELETE /me/roles/{roleId}` |
| `documents` | `Query` (consistent) | `userId` | `GET /me/documents`; count before upload; clearing the old default |
| `documents` | `PutItem` with `attribute_not_exists(userId)` | `userId`, `documentId` | `POST /me/documents` (status `pending`) |
| `documents` | `GetItem` / conditional `UpdateItem` / `TransactWriteItems` (default switch) / `DeleteItem` | `userId`, `documentId` | `GET`, `PUT`, `DELETE /me/documents/{documentId}` |
| `documents` | `GetItem` / `UpdateItem` conditioned on `status` or `eTag` | `userId`, `documentId` (parsed from the S3 key) | document worker |
| `ping-jobs` | `PutItem` / `GetItem` / conditional `UpdateItem` | `id` | ping API and worker |
| `idempotency` | Powertools reads and writes | `id` | ping worker |

### Example items

Synthetic data. `version`, `createdAt`, `updatedAt`, and `schemaVersion` are on every item.

```json
{
  "userId": "14e85498-0000-0000-0000-000000000000",
  "sk": "PROFILE",
  "type": "profile",
  "version": 1,
  "firstName": "Ada",
  "lastName": "Lovelace",
  "email": "ada@example.com",
  "homeCell": "iad",
  "skills": ["TypeScript"],
  "languages": [],
  "links": { "other": [] },
  "createdAt": "2026-09-28T20:00:00.000Z",
  "updatedAt": "2026-09-28T20:00:00.000Z",
  "schemaVersion": 1
}
```

```json
{
  "userId": "14e85498-0000-0000-0000-000000000000",
  "sk": "ROLE#01J8ZQ4Y3N5W6X7Y8Z9A0B1C2D",
  "type": "role",
  "roleId": "01J8ZQ4Y3N5W6X7Y8Z9A0B1C2D",
  "version": 2,
  "title": "Staff Engineer",
  "altTitles": [],
  "seniority": ["senior"],
  "mustHave": [],
  "exclude": [],
  "priority": 50,
  "active": true,
  "createdAt": "2026-09-28T20:00:00.000Z",
  "updatedAt": "2026-09-28T20:05:00.000Z",
  "schemaVersion": 1
}
```

## 1. `users`: who the user is

| `sk` | Attributes |
|---|---|
| `PROFILE` | `version` (optimistic concurrency: a save must send the version it read), `firstName`, `lastName`, `preferredName?`, `email`, `phone? {countryCode, number}`, `location {city, region, country, postalCode?}`, `address? {line1, line2?, city, region, postalCode, country}` (accepted from product Phase 2), `headline?`, `summary?`, `yearsExperience?`, `skills L<S>`, `languages L<{name, level}>`, `links {linkedin?, github?, portfolio?, website?, other L}`, `homeCell` (`iad`, `bom`, or `lhr`), `timezone` |
| `APPLICANT` | Details that application forms ask for: `workAuthorization L<{country, status, visaType?, expiresOn?}>` (status: `citizen`, `permanent_resident`, `visa`, or `none`), `needsSponsorship M<country, B>`, `noticePeriodDays?`, `earliestStartDate?`, `currentCompensation?` (money), `expectedCompensation?` (money), `willingToRelocate B`, `relocationCountries L`, `maxTravelPercent?`, `securityClearance?`, `over18 B`, `formerEmployers L<companyId>` |
| `EXPERIENCE#<id>` | `company`, `companyId?`, `title`, `employmentType?`, `location?`, `startDate` (yyyy-mm), `endDate?` (absent while current), `description?`, `highlights L`, `skills L` |
| `EDUCATION#<id>` | `school`, `degree`, `field?`, `startDate?`, `endDate?`, `grade?`, `highlights L` |
| `CERTIFICATION#<id>` | `name`, `issuer`, `issuedOn?`, `expiresOn?`, `credentialUrl?` |

Work history and education are prefilled from the parsed résumé, and the user edits them. Application forms (for example Workday's employment history) are filled from these items.

## 2. `preferences`: what the user wants

| `sk` | Attributes |
|---|---|
| `SEARCH` | `version`, `locations L<{city?, region?, country}>`, `workplace L` (`onsite`, `hybrid`, `remote`), `employmentTypes L` (`full_time`, `contract`, …), `minSalary?` (money), `seniority L`, `excludeKeywords L` |
| `ROLE#<roleId>` | `roleId` (ULID), `version`, `title`, `altTitles L`, `seniority L`, `locations? L` (overrides `SEARCH`), `mustHave L`, `exclude L`, `resumeDocumentId?`, `priority N`, `active B` |
| `COMPANY_RULE#<companyId>` | `mode` (`limit`, `block`, or `prefer`), `maxJobs N`, `windowDays N` (default 30), `countsOn` (`found` now; `applied` later), `extraCompanyIds L`, `note?`. The sort key `COMPANY_RULE#*` is the user's default for companies they did not list. |
| `APPLY_SETTINGS` | `mode` (`off`, `review_each`, or `auto_within_rules`; default `review_each`; `auto_within_rules` arrives in Phase 2), `dailyMax N`, `alwaysReview L` (for example `cover_letter`, `custom_questions`), `quietHours? {start, end, timezone}`, `notify {email B}` |

## 3. `documents`: files

Key: `userId`, `documentId` (ULID).

`kind` (`resume` now; `cover_letter`, `transcript`, `portfolio`, or `other` later), `origin` (`uploaded` now; `generated` later), `title`, `fileName`, `mimeType`, `format` (`pdf` or `docx`), `s3Key`, `status`, `isDefault B` (at most one per user), `version N` (user edits only: title and default), `eTag?` (S3 ETag of the file processed), `sizeBytes?`, `error?` (shown to the user), `ttl?` (only while `pending`: 1 day).

`status`: `pending` (upload link issued, waiting for the file and its malware scan) → `processing` → `ready`, or `rejected` (failed the malware scan; the file is deleted) or `failed` (unusable file, scan not possible, or processing error; the file is deleted). A re-upload with a new ETag goes back through `processing`.

- For uploaded résumés: `parsed? {textS3Key, pageCount?, charCount, noText B, truncated B}`. `noText` means the file has no text layer (for example a scanned image PDF). Structured fields (`skills`, `experienceIds`) come with AI later.
- For generated documents: `baseDocumentId`, `jobId`, `roleId?`, `generation {provider, model, promptVersion, inputTokens, outputTokens}`.

## 4. `sources`: pages the user saved

Key: `userId`, `sourceId`.

`url`, `normalizedUrl`, `label?`, `kind` (`company_careers`, `ats_board`, `aggregator`, `linkedin_search`, or `unknown`), `ats?` (`greenhouse`, `lever`, `workday`, `ashby`, …), `companyHint?` (`companyId`, for single-company pages), `companyConfirmed B`, `active B`, `schedule {type}` (`manual` now; `daily` later), `lastCrawlId?`, `lastCrawledAt?`, `stats {lastFound, totalJobs}`.

## 5. `crawls`: crawl runs (stream → crawl worker)

Key: `userId`, `crawlId` (ULID).

`sourceId`, `url` (a copy at crawl time), `trigger` (`user`, `schedule`, or `redrive`), `status` (`queued`, `running`, `succeeded`, `failed`, or `cancelled`), `attempts N`, `startedAt?`, `finishedAt?`, `stats {pagesFetched, jobsFound, jobsNew, jobsUpdated, jobsRelevant, jobsOverLimit, jobsClosed}`, `error? {code, message}`, `llm {provider (byot or platform), model, calls, inputTokens, outputTokens}`, `ttl` (180 days).

## 6. `usage`: counters

| `sk` | Attributes |
|---|---|
| `COMPANY#<companyId>` | `count N`, `windowStart`, `windowDays N`, `countsOn` |
| `DAY#<yyyy-mm-dd>` | `crawls N`, `applications N`, `ttl` (7 days). Enforces daily caps. |
| `MONTH#<yyyy-mm>` | `crawls N`, `llmCalls N`, `inputTokens N`, `outputTokens N`, `applications N` |

**How a found job is counted against a company rule:** the job's company and, if known, its parent company are looked up. For each matching rule, one conditional write increments `count` only while the window is current and `count < maxJobs`. If the window has expired, the same write starts a new window at 1. This stays exact even when two crawls run at once. A job that fits gets `limitState = counted`. Otherwise it gets `over_limit` and is hidden but kept. Within one crawl, the best-scoring jobs are admitted first. Counting applications later only changes `countsOn`.

## 7. `events`: audit trail

Key: `userId`, `eventId` (ULID, so events are ordered by time).

`name` (for example `crawl.started`, `job.found`, `rule.changed`, `application.submitted`), `entity {type, id}`, `actor` (`user`, `system`, or `automation`), `summary`, `detail? M` (never secrets or sensitive answers), `ttl` (1 year).

## 8. `jobs`: jobs found for the user

Key: `userId`, `jobId`. `jobId` is a hash of the best available posting key: the ATS and its job ID; otherwise the canonical apply URL; otherwise company + title + location. So the same job is stored once per user, and a re-crawl updates it.

| Group | Attributes |
|---|---|
| Posting | `dedupeKey`, `companyId?`, `companyName` (raw), `title`, `locations L<{city?, region?, country?}>`, `workplace?`, `employmentType?`, `seniority?`, `salary?` (`{min, max, currency, period}`), `description` (up to 32 KB), `descriptionS3Key?`, `jobUrl`, `applyUrl`, `ats?`, `externalId?`, `postedAt?`, `contentHash` |
| Discovery | `sourceIds L`, `firstCrawlId`, `lastCrawlId`, `firstSeenAt`, `lastSeenAt`, `closedAt?`, `extraction {method (parser or llm), version}` |
| Relevance | `scores M<roleId, N>`, `bestRoleId?`, `score N`, `reasons L` (short), `scoredAt`, `scoringVersion` |
| User | `status` (`new`, `shortlisted`, `dismissed`, `applying`, `applied`, or `archived`), `limitState` (`counted`, `over_limit`, or `uncounted`), `companyNeedsReview B`, `starred B`, `notes?`, `applicationId?` |

## 9. `companies`: shared company list (public, per cell)

Key: `companyId` (a slug, for example `amazon`).

`name`, `normalizedName`, `domains L`, `parentCompanyId?`, `atsBoards L<{ats, slug}>`, `careersUrl?`, `createdBy` (`parser`, `llm`, or `curated`), `confidence N`, `verified B`, `mergedInto?` (set when a duplicate is merged later, so old references still resolve).

## 10. `company-aliases`

Key: `alias` (a normalized name, domain, or ATS board, for example `aws`, `amazon.jobs`, or `greenhouse:stripe`).

`companyId`, `kind` (`name`, `domain`, or `ats_board`), `createdBy`, `confidence N`.

## 11. `answers`: reusable screening answers (Phase 2)

Key: `userId`, `answerId` (a hash of the normalized question, so the same question is stored once).

`question`, `category` (`work_authorization`, `compensation`, `availability`, `experience`, `motivation`, or `custom`), `answerType` (`text`, `yes_no`, `choice`, `number`, or `date`), `answer`, `options? L`, `scope` (`global`, or a `companyId`), `source` (`user` or `llm_suggested`), `approved B` (LLM suggestions are used only after the user approves them), `useCount N`, `lastUsedAt?`.

Sensitive questions (gender, ethnicity, veteran status, disability) are never stored here; see `vault`.

## 12. `applications`: Phase 2 (stream → apply worker)

Key: `userId`, `sk`. One application and its steps share a prefix, so `begins_with(sk, "<applicationId>")` returns the application with its full trace.

| `sk` | Attributes |
|---|---|
| `<applicationId>` | `jobId`, `companyId?`, `status` (`draft`, `awaiting_review`, `queued`, `in_progress`, `needs_input`, `submitted`, `failed`, `cancelled`, or `withdrawn`), `mode` (`manual`, `assisted`, or `auto`), `approvedAt?`, `documents {resumeId, coverLetterId?}`, `answers L<{question, answerId?, source}>` (references, not sensitive values), `siteLoginRef?` (a `vault` key), `attempts N`, `submittedAt?`, `confirmation? {reference?, screenshotS3Key?}`, `error? {code, message}`, `outcome?` (`no_response`, `rejected`, `interview`, or `offer`; set by the user), `outcomeAt?` |
| `<applicationId>#STEP#<ulid>` | `action` (`open`, `login`, `fill`, `upload`, `answer`, `review`, or `submit`), `status`, `detail`, `screenshotS3Key?`, `llm? {calls, inputTokens, outputTokens}` |

## 13. `vault`: encrypted secrets (Future)

Key: `userId`, `sk`. Values are encrypted in the application before they are written. The encryption design (KMS, which needs a cost exception under [0005](0005-pre-launch-cost-guardrails.md)) is decided when this table is built.

| `sk` | Attributes |
|---|---|
| `AI_KEY#<provider>` | `ciphertext`, `last4`, `status`, `lastUsedAt?` |
| `SITE_LOGIN#<domain>` | `username`, `ciphertext` (password), `createdBy` (`user` or `automation`, for example a Workday account created while applying), `lastLoginAt?` |
| `SENSITIVE` | `ciphertext` of `dateOfBirth` and the voluntary equal-opportunity answers (gender, ethnicity, veteran status, disability). Equal-opportunity answers default to "decline to answer". |

## 14–15. Infrastructure

- `ping-jobs` (key `id`): `userId` (owner; only the owner can read it), `status`, `attempts`, `sideEffectCount`, `deliveries` (every queue delivery, including duplicates), `fail?` (dev-only test flag), `error?`, `ttl` (7 days).
- `idempotency` (key `id`): Powertools' own schema, with `expiration` as its time-to-live.

## S3 layout (one bucket per cell)

```text
users/<userId>/documents/<documentId>/original             the uploaded file (PDF or DOCX, at most 5 MB)
derived/users/<userId>/documents/<documentId>/text.txt     its extracted text (at most 200,000 characters)
users/<userId>/applications/<applicationId>/...    screenshots and confirmations
users/<userId>/snapshots/<jobId>/...               page snapshots (deleted after 30 days)
```

Everything under `users/<userId>/` and `derived/users/<userId>/` goes with account deletion or export.

- **`users/`** holds what users upload. GuardDuty scans every new object there and tags it `GuardDutyMalwareScanStatus`; the API can only read an `original` tagged `NO_THREATS_FOUND` (bucket policy).
- **`derived/users/`** holds files we produce from clean uploads (for example extracted text). It is not scanned, so each upload is scanned exactly once. Only the worker can write there.
- The prefixes and key format are defined once, in `packages/shared` (`documentKeys`). The bucket is private, S3-encrypted, HTTPS-only, and never replicated.

## Change log

| Date | Change | PR |
|---|---|---|
| 2026-09-28 | Initial schema for all 15 tables ([0006](decisions/0006-data-model.md)) | T04 |
| 2026-09-28 | `ping-jobs`: add `deliveries`, so tests wait on a counted delivery instead of sleeping | T04 |
| 2026-09-28 | `ping-jobs`: add `userId` (owner from the token); other users get 404 | T05 |
| 2026-09-28 | `users` `PROFILE`, `preferences` `SEARCH` and `ROLE#`: add `version`; `ROLE#` also stores `roleId`. `users` and `preferences` tables built. | T05b |
| 2026-09-28 | Documented the physical schema (keys, settings, access patterns, examples) of built tables; an infra test checks it lists every deployed table | T05b |
| 2026-09-28 | Extracted text moved to `derived/users/…/text.txt`, outside the scanned prefix: one malware scan per upload instead of two | T05c |
| 2026-09-28 | `documents` table and file bucket built: statuses `pending`/`processing`/`ready`/`rejected`/`failed`, `format`, `eTag`, `error`, `ttl`, and `parsed` fields; S3 `original` and `text.txt` | T05c |
