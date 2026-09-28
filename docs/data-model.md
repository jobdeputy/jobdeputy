# Data model

The living reference for every DynamoDB table and S3 path. The decisions behind it (why these tables, keys, and rules) are in [0006](decisions/0006-data-model.md).

## Rules for changing the schema

1. **Any PR that adds, renames, or removes an attribute or item kind updates this file in the same PR** and adds a line to the [change log](#change-log). The PR template asks for it.
2. **Adding** an optional attribute is always allowed. **Renaming or removing** one, or changing its meaning, bumps that item's `schemaVersion`, and the code must still read the old version (items are migrated lazily when they are next written).
3. **New tables, new keys, or key changes** need a new decision record, because keys are permanent.
4. The code's source of truth is the Zod schemas in `packages/db`. This file and those schemas must agree; reviewers check both.
5. Never add attributes that 0006 forbids (government ID numbers, bank or card details), and never put secrets or sensitive answers outside `vault`.

## Conventions

- Types: `S` string, `N` number, `B` boolean, `L` list, `M` map. `?` means optional.
- Dates are ISO-8601 UTC. Months are `yyyy-mm`.
- Money is always `{ amount, currency, period }` (for example `{ 4500000, "INR", "year" }`) and is never converted in storage.
- Every item also has `type`, `createdAt`, `updatedAt`, and `schemaVersion`.
- Table names are prefixed with the stack, for example `jobdeputy-dev-iad-users`.

## 1. `users`: who the user is

| `sk` | Attributes |
|---|---|
| `PROFILE` | `firstName`, `lastName`, `preferredName?`, `email`, `phone? {countryCode, number}`, `location {city, region, country, postalCode?}`, `address? {line1, line2?, city, region, postalCode, country}`, `headline?`, `summary?`, `yearsExperience?`, `skills L<S>`, `languages L<{name, level}>`, `links {linkedin?, github?, portfolio?, website?, other L}`, `homeCell` (`iad`, `bom`, or `lhr`), `timezone` |
| `APPLICANT` | Details that application forms ask for: `workAuthorization L<{country, status, visaType?, expiresOn?}>` (status: `citizen`, `permanent_resident`, `visa`, or `none`), `needsSponsorship M<country, B>`, `noticePeriodDays?`, `earliestStartDate?`, `currentCompensation?` (money), `expectedCompensation?` (money), `willingToRelocate B`, `relocationCountries L`, `maxTravelPercent?`, `securityClearance?`, `over18 B`, `formerEmployers L<companyId>` |
| `EXPERIENCE#<id>` | `company`, `companyId?`, `title`, `employmentType?`, `location?`, `startDate` (yyyy-mm), `endDate?` (absent while current), `description?`, `highlights L`, `skills L` |
| `EDUCATION#<id>` | `school`, `degree`, `field?`, `startDate?`, `endDate?`, `grade?`, `highlights L` |
| `CERTIFICATION#<id>` | `name`, `issuer`, `issuedOn?`, `expiresOn?`, `credentialUrl?` |

Work history and education are prefilled from the parsed résumé, and the user edits them. Application forms (for example Workday's employment history) are filled from these items.

## 2. `preferences`: what the user wants

| `sk` | Attributes |
|---|---|
| `SEARCH` | `locations L<{city?, region?, country}>`, `workplace L` (`onsite`, `hybrid`, `remote`), `employmentTypes L` (`full_time`, `contract`, …), `minSalary?` (money), `seniority L`, `excludeKeywords L` |
| `ROLE#<roleId>` | `title`, `altTitles L`, `seniority L`, `locations? L` (overrides `SEARCH`), `mustHave L`, `exclude L`, `resumeDocumentId?`, `priority N`, `active B` |
| `COMPANY_RULE#<companyId>` | `mode` (`limit`, `block`, or `prefer`), `maxJobs N`, `windowDays N` (default 30), `countsOn` (`found` now; `applied` later), `extraCompanyIds L`, `note?`. The sort key `COMPANY_RULE#*` is the user's default for companies they did not list. |
| `APPLY_SETTINGS` | `mode` (`off`, `review_each`, or `auto_within_rules`; default `review_each`; `auto_within_rules` arrives in Phase 2), `dailyMax N`, `alwaysReview L` (for example `cover_letter`, `custom_questions`), `quietHours? {start, end, timezone}`, `notify {email B}` |

## 3. `documents`: files

Key: `userId`, `documentId`.

`kind` (`resume`, `cover_letter`, `transcript`, `portfolio`, or `other`), `origin` (`uploaded` or `generated`), `title`, `fileName`, `mimeType`, `sizeBytes`, `s3Key`, `sha256`, `status` (`processing`, `ready`, or `failed`), `isDefault B`, `version N`.

- For uploaded résumés: `parsed? {textS3Key, skills L, experienceIds L}`.
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
users/<userId>/documents/<documentId>/<file>       résumés, cover letters, other files
users/<userId>/applications/<applicationId>/...    screenshots and confirmations
users/<userId>/snapshots/<jobId>/...               page snapshots (deleted after 30 days)
```

Everything under `users/<userId>/` goes with account deletion or export.

## Change log

| Date | Change | PR |
|---|---|---|
| 2026-09-28 | Initial schema for all 15 tables ([0006](decisions/0006-data-model.md)) | T04 |
| 2026-09-28 | `ping-jobs`: add `deliveries`, so tests wait on a counted delivery instead of sleeping | T04 |
| 2026-09-28 | `ping-jobs`: add `userId` (owner from the token); other users get 404 | T05 |
