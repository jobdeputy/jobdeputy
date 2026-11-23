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
| `<stack>-users` | `userId` (S) | `sk` (S) | `NEW_IMAGE` → Pipe (only `DELETION` inserts) → queue | `ttl` (`DELETION` items only) | prod only | dev: deleted; prod: kept | T05b, stream T12 |
| `<stack>-preferences` | `userId` (S) | `sk` (S) | — | — | prod only | dev: deleted; prod: kept | T05b |
| `<stack>-documents` | `userId` (S) | `documentId` (S) | `NEW_IMAGE` → Pipe (only generated `queued` inserts; sends `userId` and `documentId`) → queue (#51) | `ttl` (pending uploads only) | prod only | dev: deleted; prod: kept | T05c, stream #51 |
| `<stack>-sources` | `userId` (S) | `sourceId` (S) | — | — | prod only | dev: deleted; prod: kept | T06b |
| `<stack>-crawls` | `userId` (S) | `crawlId` (S) | `NEW_IMAGE` → Pipe (only `queued` inserts; sends `userId` and `crawlId`) → queue | `ttl` (180 days) | prod only | dev: deleted; prod: kept | T06b |
| `<stack>-audit` | `userId` (S) | `auditId` (S) | — | `ttl` (1 year) | prod only | dev: deleted; prod: kept | T06b |
| `<stack>-usage` | `userId` (S) | `sk` (S) | — | `ttl` (`DAY#` items only: 7 days) | prod only | dev: deleted; prod: kept | T06c |
| `<stack>-jobs` | `userId` (S) | `jobId` (S) | — | `ttl` (T08c: hidden jobs, and closed ones the user never acted on) | prod only | dev: deleted; prod: kept | T07b, `ttl` T08c |
| `<stack>-ai-keys` | `userId` (S) | `provider` (S) | `NEW_IMAGE` → Pipe (inserts and updates with `status = checking`; sends `userId` and `provider`) → queue | — | prod only | dev: deleted; prod: kept | T08b2 |
| `<stack>-ping-jobs` | `id` (S) | — | `NEW_IMAGE` → Pipe → queue | `ttl` (1 day) | — | **dev stacks only** (deleted with the stack) | T04 |
| `<stack>-idempotency` | `id` (S) | — | — | `expiration` | — | **dev stacks only** (used by the ping worker only) | T04 |

### Access patterns

Every user-table call is keyed by the caller's `userId` from the token; no request can name another user.

Every `TransactWriteItems` goes through `transactWrite` (`packages/db/src/transact.ts`): a transaction cancelled only by `TransactionConflict` (another write to the same item at the same moment) is retried with jitter, at most 4 attempts in all, then answered with 409 "try again"; a failed condition is never retried.

| Table | Operation | Key | Used by |
|---|---|---|---|
| `users` | `GetItem` (consistent) | `userId`, `sk = PROFILE` | `GET` and `PUT /me/profile` |
| `users` + `audit` | `TransactWriteItems`: `PutItem` with `attribute_not_exists(userId)` or `version = :expected`, `PutItem` audit entry | `userId`, `sk = PROFILE` | `PUT /me/profile` |
| `users` | `PutItem` with `attribute_not_exists(userId)` | `userId`, `sk = DELETION` | `DELETE /me` (T12) |
| `users` | `GetItem` | `userId`, `sk = DELETION` | every write route: refused with 410 while it exists; `GET /me` |
| every user table | `Query` (keys only) + `BatchWriteItem` deletes, paged | `userId` | deletion worker: erases everything but the `DELETION` item |
| `preferences` (+ `audit`) | `GetItem` / conditional `PutItem` with its audit entry (one transaction) | `userId`, `sk = SEARCH` | `/me/preferences/search` |
| `preferences` | `Query` `begins_with(sk, "ROLE#")` (consistent) | `userId` | `GET /me/roles`; role count before `POST` |
| `preferences` (+ `audit`, `usage`) | `GetItem` / conditional `PutItem` with its audit entry (one transaction); a create also counts `usage` `ROLES` with `itemCount < :max` | `userId`, `sk = ROLE#<roleId>` | `POST`, `PUT /me/roles/{roleId}` |
| `preferences` + `audit` + `usage` | `TransactWriteItems`: `DeleteItem` with `attribute_exists(userId)`, `PutItem` audit entry, `UpdateItem` `ROLES` (count down) | `userId`, `sk = ROLE#<roleId>` | `DELETE /me/roles/{roleId}` |
| `documents` | `Query` (consistent) | `userId` | `GET /me/documents`; count before upload; clearing the old default |
| `documents` + `audit` + `usage` | `Query` (consistent); `TransactWriteItems`: `PutItem` with `attribute_not_exists(userId)`, `PutItem` audit entry, `UpdateItem` `DOCUMENTS` (`itemCount < :max`, and for a first document `attribute_not_exists(defaultDocumentId)`) | `userId`, `documentId` | `POST /me/documents` (status `pending`) |
| `documents` + `audit` | `GetItem`; `TransactWriteItems` of the conditional `UpdateItem` (rename; the default switch's updates) or `DeleteItem` (`isDefault = :was`), with the audit entry; then a consistent `GetItem` of the result. Deleting the default also reads the marker, then the list (`Query`, consistent), and in the same transaction makes the newest `ready` document the default (`UpdateItem`, `#status = :ready`) and moves the marker (`defaultDocumentId = :seen`); a failed condition is read again, at most 3 times | `userId`, `documentId` | `GET`, `PUT`, `DELETE /me/documents/{documentId}` |
| `documents` (+ `audit`) | `GetItem`; `TransactWriteItems` of an `UpdateItem` conditioned on `status` or `eTag` (with an audit entry for `ready`, `rejected`, `failed`) | `userId`, `documentId` (parsed from the S3 key) | document worker |
| `sources` + `crawls` + `audit` + `usage` | `TransactWriteItems`: `UpdateItem` source with `attribute_not_exists(activeCrawlId)` (or `= :replacing`), `PutItem` crawl (`queued`), `PutItem` audit entry, `UpdateItem` `DAY#<date>` with `attribute_not_exists(crawls) OR crawls < :limit`, `UpdateItem` `MONTH#<month>`, `UpdateItem` `ACTIVE` (`ADD crawlIds`) with `attribute_not_exists(crawlIds) OR size(crawlIds) < :maxActive` | `userId`, `sourceId` / `crawlId` / `auditId` / `sk` | `POST /me/crawls` (a failed source condition means the page already has an active crawl, which is returned and not counted; a failed day condition means the daily limit is reached: 429) |
| `sources` + `crawls` + `audit` + `usage` (platform model) | The crawl request transaction above, plus: `MONTH#<month>` `ADD platformRunIds :crawlId` with `attribute_not_exists(platformRunIds) OR size(platformRunIds) < :perMonth`, and `UpdateItem` `AIWEEK#<week>` `ADD platformRunIds` with `size(platformRunIds) < :perWeek`. Either failing is 429 `platform-ai-limit-reached`. Ending a crawl as `failed` also `DELETE`s its ID from both (idempotent). | `userId`, `sk` | `POST /me/crawls` with `aiSource` `platform` (T08b3); crawl worker and stale crawls |
| `sources` + `crawls` + `audit` + `usage` (list run, #50) | The crawl request transaction above, with the source's `kind = list`, and `DAY#<date>` also `lists + 1` with `(attribute_not_exists(lists) OR lists < :lists)` | `userId`, `sourceId` / `crawlId` / `auditId` / `sk` | `POST /me/crawls` with a list link (a failed day condition is 429: `daily-list-limit-reached` when the day's lists are used) |
| `usage` | `GetItem` (consistent) `AIWEEK#<week>`, `MONTH#<month>`; `Query` `begins_with(sk, "AI#<month>#")` | `userId` | `GET /me/ai-usage`; the 429 message |
| `usage` | `GetItem` (consistent) | `userId`, `sk = DAY#<today>` / `ACTIVE` | `GET /me/crawl-settings`; the 429 messages; freeing stale slots |
| `usage` | `UpdateItem` `DELETE crawlIds` (idempotent) | `userId`, `sk = ACTIVE` | `POST /me/crawls` freeing slots of finished or gone crawls; in the crawl-ending transaction (worker, stale crawls) |
| `preferences` + `audit` | `GetItem`, then `TransactWriteItems`: `PutItem` with `attribute_not_exists(userId)` or `version = :expected`, `PutItem` audit entry | `userId`, `sk = CRAWL_SETTINGS` | `GET` and `PUT /me/crawl-settings` |
| `sources` | `GetItem` (consistent) | `userId`, `sourceId` | `POST /me/crawls`: find the active crawl |
| `crawls` | `GetItem` (consistent) | `userId`, `crawlId` | `GET /me/crawls/{crawlId}`; `POST /me/crawls` (active crawl) |
| `crawls` | `Query`, newest first, `Limit` (+50), `ExclusiveStartKey`, `FilterExpression attribute_not_exists(parentCrawlId)`; read on (at most 5 queries) until the page is full | `userId` | `GET /me/crawls` (paged; #50: a list run's company crawls left out) |
| `crawls` | `UpdateItem` `SET list, result, queuedCount = 0` with `#status = running AND attribute_not_exists(#list)` | `userId`, `crawlId` | crawl worker (#50): a list run records its choice once |
| `crawls` + `sources` + `audit` | `TransactWriteItems`: `UpdateItem` list run (`queuedCount + 1`, `list_append childIds`, `ADD runningIds`) with `#status = running AND queuedCount = :read AND size(runningIds) < 3`, `PutItem` company crawl (`queued`), `UpdateItem` source with `attribute_not_exists(activeCrawlId)` (or `= :replacing`), `PutItem` audit entry | `userId`, `crawlId` / `sourceId` / `auditId` | crawl worker (#50): queue a list's next company (a failed list condition: read again; a failed source condition: the board is busy) |
| `crawls` | `UpdateItem` `queuedCount + 1`, `list.busy + 1` (or `list.skipped + 1`) with `#status = running AND queuedCount = :read` | `userId`, `crawlId` | crawl worker (#50): pass over a busy board (or one we would never crawl) |
| `crawls` | `UpdateItem` with `#status IN (queued, running)` | `userId`, `crawlId` | crawl worker: claim an attempt; note a retriable error (`= running`) |
| `crawls` + `audit` | `TransactWriteItems`: `UpdateItem` crawl with `#status IN (queued, running)` → `succeeded`/`failed`, `PutItem` audit entry (#50: a company crawl also `DELETE runningIds`, `ADD childrenEnded` on its list run, unconditionally) | `userId`, `crawlId` / `auditId` | crawl worker; `POST /me/crawls` ending a stale crawl |
| `sources` | `UpdateItem` with `activeCrawlId = :crawlId` (`REMOVE activeCrawlId`; after a success also `kind`, `ats`, `stats`) | `userId`, `sourceId` | crawl worker, after a crawl ends |
| `jobs` | `UpdateItem` per job, no condition (idempotent): posting fields `SET`; first-seen and the user's own fields `if_not_exists`; `ADD sourceIds`; `REMOVE closedAt`; T08c: `SET filter`, `SET` or `REMOVE limitState`, and `ttl = if_not_exists(ttl, :expires)` for a hidden job or `REMOVE ttl` for a shown one (a job the user acted on gets its `ttl` removed again, with `#status <> new`); `ReturnValues: UPDATED_OLD` to count new and changed jobs. At most 10 at a time, 500 per crawl. | `userId`, `jobId` | crawl worker (T07b) |
| `sources` | `GetItem` | `userId`, `sourceId` | crawl worker (T07c): which jobs the page listed before |
| `jobs` | `BatchGetItem` of up to 50 jobs, projecting `jobId, descriptionHash` | `userId`, `jobId` | crawl worker (T08d3), for candidates that already have a description |
| `jobs` | `UpdateItem` `SET closedAt` with `attribute_exists(userId) AND attribute_not_exists(closedAt)`, returning the new item; then `ttl = if_not_exists(ttl, :expires)` with `closedAt = :now AND #status = new`. At most 10 at a time. | `userId`, `jobId` | crawl worker (T08d3), for candidates whose posting answered 404 or 410 |
| `jobs` | `UpdateItem` `DELETE sourceIds :source` with `attribute_exists(userId)`, returning the new item; if no source is left, `UpdateItem` `SET closedAt` with `attribute_not_exists(sourceIds) AND attribute_not_exists(closedAt)`, and (T08c) `ttl = if_not_exists(ttl, :expires)` when its `status` is `new`. At most 10 at a time. | `userId`, `jobId` | crawl worker (T07c), for jobs a complete crawl no longer lists |
| `jobs` | `UpdateItem` `SET limitState = over_limit, ttl = if_not_exists(ttl, :expires)` with `attribute_exists(userId) AND #status = new`; if that fails, the same without `ttl` with `attribute_exists(userId)` | `userId`, `jobId` | crawl worker (T08c): jobs another page listed, pushed out of their company's shown list |
| `usage` | `GetItem` (consistent), then `PutItem` with `attribute_not_exists(userId)` or `version = :expected` (read again on conflict, at most 4 times) | `userId`, `sk = COMPANY#<companyKey>` | crawl worker (T08c): rank a company's jobs |
| `usage` | `UpdateItem` `REMOVE shown.<jobId>… SET version = version + 1` with `attribute_exists(shown)` | `userId`, `sk = COMPANY#<companyKey>` | crawl worker (T08c): free the places of jobs it closed |
| `crawls` | `UpdateItem` `SET relevance` (with `leaseUntil`) with `attribute_not_exists(relevance) AND #status = succeeded` | `userId`, `crawlId` | relevance worker (T08d): start a run |
| `crawls` | `UpdateItem` `SET relevance.leaseUntil` with `relevance.#status = running AND (relevance.leaseUntil < :now OR (attribute_not_exists(relevance.leaseUntil) AND relevance.startedAt < :startedBefore))` | `userId`, `crawlId` | relevance worker: a retry takes over a run whose lease passed (or, from before leases, older than one); a duplicate delivery meanwhile skips. Its calls and its end then add `AND relevance.leaseId = :lease` (fencing; `begin` and `claim` set a new random `leaseId`) |
| `crawls`, `usage`, `jobs` | `TransactWriteItems`: the crawl's `relevance.calls`, `relevance.sent`, and `llm` with `relevance.status = running AND relevance.calls = :before`; the `AI#` token item (`runs` 1 on the run's first call); `SET relevance` on each scored job with `attribute_exists(userId)` (jobs gone meanwhile are left out and the rest written again) | `userId`, `crawlId` / `sk` / `jobId` | relevance worker (T08d): store one task call |
| `jobs` | `BatchGetItem` (consistent, 100 keys at a time; unprocessed keys read again) | `userId`, `jobId` | relevance worker (T08d): the crawl's candidates |
| `jobs` | `UpdateItem`: a low score `SET filter.state = not_relevant, filter.reasons`, `REMOVE limitState`; others `SET limitState` (`counted`: `REMOVE ttl`); hidden ones `ttl = if_not_exists(ttl, :expires)` with `#status = new`, else the same without `ttl` | `userId`, `jobId` | relevance worker (T08d): apply the scores |
| `crawls`, `audit` | `TransactWriteItems`: `SET relevance.status, finishedAt, stats, reason?` with `relevance.status = running`; the `crawl.scored` audit entry | `userId`, `crawlId` | relevance worker (T08d): end a run |
| `preferences`, `users` | `Query` `ROLE#`; `GetItem` `SEARCH`, `CRAWL_SETTINGS`; `GetItem` `PROFILE` | `userId` | crawl worker (T08c): what the code filter needs, once per crawl |
| `jobs` | `Query`, key order, `Limit`, `ExclusiveStartKey`; T08c: by default a `FilterExpression` leaves out `filter.state = not_relevant` and `limitState = over_limit` (a page can be short, even empty, and still have a next one) | `userId` | `GET /me/jobs` (paged; `view=all` lists every job) |
| `jobs` | `GetItem` | `userId`, `jobId` | `GET /me/jobs/{jobId}` |
| `usage` | `Query` `begins_with(sk, COMPANY#)`, every page, projection `sk, shown`; ranked in memory (best job first, the worker's `compareRank`) | `userId` | `GET /me/companies` (#49; cursor = the last company's best job) |
| `jobs` | `BatchGetItem` (consistent: read right after a crawl ends; projection of the summary fields only, every name aliased: no description) of the page's shown jobs; hidden or closed ones are left out, and a page left short reads the next companies (at most 3 reads) | `userId`, `jobId` | `GET /me/companies` (#49) |
| `preferences` | `GetItem` `CRAWL_SETTINGS` (with the admin's `crawl-limits` parameter) | `userId`, `sk` | `GET /me/companies` (#49): each company capped at the user's jobs per company now |
| `documents` + `audit` + `usage` | `TransactWriteItems`: `PutItem` generated version (`queued`) with `attribute_not_exists(userId)`; `PutItem` audit entry; `UpdateItem` `MONTH#<month>` (`ADD tailoringRunIds :id` with `attribute_not_exists(tailoringRunIds) OR size(tailoringRunIds) < :perMonth`, platform runs only); `UpdateItem` `TAILOR#<companyKey>` `SET activeId, activeSince` with `attribute_not_exists(activeId) OR activeSince < :stale` | `userId`, `documentId` / `sk` | `POST /me/tailorings` (#51) |
| `documents` | `Query` (consistent), every page, `FilterExpression origin = :generated (AND companyKey = :company)`, newest first in memory | `userId` | `GET /me/tailorings` (#51); the worker keeping 10 versions per company |
| `documents` | `Query` with `FilterExpression attribute_not_exists(origin) OR origin <> :generated`; `GetItem` (a generated item reads as absent) | `userId` (/ `documentId`) | every uploaded-document path: generated versions are never listed, counted, or made the default (#51) |
| `documents` | `UpdateItem` claim (`#status = processing`, `tailoring.attempts + 1`) with `origin = :generated AND #status IN (queued, processing)`; `TransactWriteItems`: `tailoring.calls`, `generation` with `#status = processing AND tailoring.calls = :before`, and the `AI#` token item; `TransactWriteItems` end (`ready` with `s3Key`, `fileName`, `sizeBytes`, `tailoring.result`, `scores`; or `failed` with `error`) with `#status IN (queued, processing)`, `REMOVE activeId` on `TAILOR#` with `activeId = :id` (left out when a newer run took the lock), audit entry; `UpdateItem` `DELETE tailoringRunIds` with `contains(tailoringRunIds, :id)` (a platform run that made no model call); `BatchWriteItem` deletes of versions past 10 | `userId`, `documentId` | tailoring worker (#51) |
| `documents` | `UpdateItem` `SET tailoring.drafted, draftResume, result, scores…, companyName = if_not_exists(…)` with `#status = :processing AND attribute_not_exists(tailoring.drafted)` | `userId`, `documentId` | tailoring worker (#51): the kept draft, once per run, before rendering |
| `documents` | `UpdateItem` `SET structured` with `#status = :ready AND eTag = :eTag` | `userId`, `documentId` (the base résumé) | tailoring worker (#51): the structured copy of the file it was made from |
| `jobs` | `UpdateItem` `SET keywords` / `SET match, materials` with `attribute_exists(userId)` | `userId`, `jobId` | tailoring worker (#51) |
| `audit` | `Query`, newest first, `Limit`, `ExclusiveStartKey` | `userId` | `GET /me/audit` (paged) |
| `ai-keys` + `audit` + `usage` | `TransactWriteItems`: `UpdateItem` key (`status = checking`, new `checkId`; a re-check with `attribute_exists(userId)`), `PutItem` audit entry, `UpdateItem` `DAY#<date>` with `attribute_not_exists(keyChecks) OR keyChecks < :max` | `userId`, `provider` | `PUT /me/ai-keys/{provider}`, `POST /me/ai-keys/{provider}/check` (T08b2; a failed day condition is 429) |
| `ai-keys` + `audit` + `preferences` | `GetItem` `AI_SETTINGS`; `TransactWriteItems`: `DeleteItem` with `attribute_exists(userId)`, `PutItem` audit entry, and either `UpdateItem` `AI_SETTINGS` back to `platform` with `version = :seen` (it was this key) or `ConditionCheck` `defaultSource <> :provider`; read again at most 3 times | `userId`, `provider` | `DELETE /me/ai-keys/{provider}` |
| `ai-keys` | `Query` (consistent; the API drops `ciphertext`) / `GetItem` | `userId` (/ `provider`) | `GET /me/ai-keys`; `POST /me/crawls` (status of a chosen key); key-check worker |
| `ai-keys` + `audit` | `TransactWriteItems`: `UpdateItem` result with `checkId = :checkId AND #status = checking`, `PutItem` audit entry (`ai_key.checked`) | `userId`, `provider` | key-check worker |
| `preferences` + `audit` (+ `ai-keys`) | `GetItem`, then `TransactWriteItems`: `PutItem` with `attribute_not_exists(userId)` or `version = :expected`, `PutItem` audit entry, and for a provider `ConditionCheck` the key with `attribute_exists(userId) AND #status <> invalid` | `userId`, `sk = AI_SETTINGS` | `GET` and `PUT /me/ai-settings` |
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
| `DELETION` | The account-deletion request (T12): `username` (Cognito), `status` (`queued` → `deleting` → `done`), `requestedAt`, `ttl` (2 hours after the request). No personal details. While it exists, every write from this user is refused; it outlives any access token, then expires. |

Work history and education are prefilled from the parsed résumé, and the user edits them. Application forms (for example Workday's employment history) are filled from these items.

## 2. `preferences`: what the user wants

| `sk` | Attributes |
|---|---|
| `SEARCH` | `version`, `locations L<{city?, region?, country}>`, `workplace L` (`onsite`, `hybrid`, `remote`), `employmentTypes L` (`full_time`, `contract`, …), `minSalary?` (money), `seniority L`, `excludeKeywords L` |
| `ROLE#<roleId>` | `roleId` (ULID), `version`, `title`, `altTitles L`, `seniority L`, `locations? L` (overrides `SEARCH`), `mustHave L`, `exclude L`, `resumeDocumentId?`, `priority N`, `active B` |
| `COMPANY_RULE#<companyId>` | Later (with the shared company list, [#40](https://github.com/jobdeputy/jobdeputy-archive/issues/40)): per-company rules, `mode` (`limit`, `block`, or `prefer`), `maxJobs N`, `extraCompanyIds L`, `note?`. The one limit for every company is in `CRAWL_SETTINGS` (T08c). |
| `AI_SETTINGS` | T08b2: `version`, `defaultSource` (`platform`, `none` (T08b3), `openai`, or `anthropic`; `stub` in dev stacks). A provider needs a saved key that is not `invalid`; deleting that key sets it back to `platform`. |
| `CRAWL_SETTINGS` | T06c: `version`, `dailyLimit?` (the user's own daily crawl limit, 1 to the admin maximum; absent = the admin default). The limit applied is `min(dailyLimit ?? default, maximum)`, so an admin lowering the maximum always wins. T08c: `companyJobsLimit?` (jobs shown per company, 1 to the admin's `companyJobsMax`; absent = `companyJobsDefault`), applied the same way. |
| `APPLY_SETTINGS` | `mode` (`off`, `review_each`, or `auto_within_rules`; default `review_each`; `auto_within_rules` arrives in Phase 2), `dailyMax N`, `alwaysReview L` (for example `cover_letter`, `custom_questions`), `quietHours? {start, end, timezone}`, `notify {email B}` |

## 3. `documents`: files

Key: `userId`, `documentId` (ULID).

`kind` (`resume` now; `cover_letter`, `transcript`, `portfolio`, or `other` later), `origin` (`uploaded` now; `generated` later), `title`, `fileName`, `mimeType`, `format` (`pdf` or `docx`), `s3Key`, `status`, `isDefault B` (at most one per user), `version N` (user edits only: title and default), `eTag?` (S3 ETag of the file processed), `sizeBytes?`, `error?` (shown to the user), `ttl?` (only while `pending`: 1 day).

`status`: `pending` (upload link issued, waiting for the file and its malware scan) → `processing` → `ready`, or `rejected` (failed the malware scan; the file is deleted) or `failed` (unusable file, scan not possible, or processing error; the file is deleted). A re-upload with a new ETag goes back through `processing`.

- For uploaded résumés: `parsed? {textS3Key, pageCount?, charCount, noText B, truncated B}`. `noText` means the file has no text layer (for example a scanned image PDF). Structured fields (`skills`, `experienceIds`) come with AI later.
- For uploaded résumés (#51): `structured? {s3Key, eTag, promptVersion, coverage, rejections, createdAt}`: the résumé as structured data (`structure-resume`), made on the first Tailor click and kept for the file with that `eTag`; the JSON is in S3 at `…/<documentId>/structured-<eTag>.json` (`structuredKey`).
- For generated documents (#51, decision 0015: tailored résumés, one per company and Tailor click): `origin: generated`, `kind: resume`, `status` `queued` → `processing` → `ready` or `failed`, `title`, `companyKey`, `companyName?`, `jobIds L` (the company's top shown jobs, at most 3, best first), `baseDocumentId`, `aiSource`, `platformRun B` (counted in the free tailoring allowance), `tailoring {calls N (task calls, at most 5 across retries), attempts N, startedAt?, finishedAt?, drafted? B and draftResume? (the kept draft, its scores, and the company's name, stored once per run: a retry only renders it), result? (ok or partial), scores? L<{jobId, base, tailored, missingProven L, missingUnproven L}>, coverage?, promptVersion?, scoreVersion?}`, `generation? {keySource, provider, model, calls, inputTokens, outputTokens}`, `error?` (`TAILORING_ERRORS`). When ready: `s3Key` (the PDF), `fileName` ("Name – Company.pdf"), `sizeBytes`. Not counted in `DOCUMENTS`, never the default, never in `GET /me/documents`; the last 10 ended versions per company are kept.

## 4. `sources`: pages the user saved

Key: `userId`, `sourceId` (the first 32 hex characters of SHA-256 of `normalizedUrl`, [0007](decisions/0007-crawler.md): the same page cannot be saved twice by one user).

`url` (as submitted), `normalizedUrl` (lowercase host, no fragment or tracking parameters), `label?`, `kind` (`ats_board` once a crawl read it as a job board, T07b; `list` for a list of roles such as a GitHub repository, #50, its `normalizedUrl` then `https://github.com/<owner>/<repo>` in lowercase; otherwise `unknown`; `company_careers`, `aggregator`, and `linkedin_search` later), `ats?` (`greenhouse`, `lever`, `ashby`, or `workday`; set by the crawl worker, T07b), `companyHint?` (`companyId`, for single-company pages), `companyConfirmed B`, `active B`, `schedule {type}` (`manual` now; `daily` later), `lastCrawlId?`, `lastCrawledAt?`, `activeCrawlId?` (T06b: set while a crawl of this page is queued or running, so a second submit returns it; replaced if that crawl is finished, missing, or older than 15 minutes), `stats? {lastFound}` (T07b: jobs read by the last successful crawl; `totalJobs` later), `listedJobIds? SS` (T07c: the jobs this page lists as far as its crawls know: exactly what the last complete crawl read, plus what later partial crawls added; newest first, at most 2,000; absent when it lists none).

## 5. `crawls`: crawl runs (stream → crawl worker)

Key: `userId`, `crawlId` (ULID).

`sourceId`, `url` (the normalized URL at crawl time), `trigger` (`user`, `list` (#50: a company crawl a list run queued), `schedule`, or `redrive`), `kind?` (#50: `list` for a list run), `listSource? {kind: github, owner, repo} | {kind: test, url}` (#50: where a list run reads its list; `test` on dev stacks only; never shown by the API), `list? {rows, matched, companiesMatched, companies L of {name, url, matches}, skipped, busy?}` (#50: set once when the list is read: open roles, roles that passed the keyword filter in the US, companies with a match, the companies chosen best first (at most the admin's `listCompanies`), companies above the cut whose site we cannot read yet (a board link we would refuse to crawl counts as unreadable), chosen companies passed over because their board had a crawl in progress), `queuedCount? N` (#50: chosen companies handed on so far, in order), `runningIds? SS` (#50: company crawls queued or running, at most 3; removed by each one's `finish`), `childIds? L` (#50: every company crawl queued, in order), `childrenEnded? N` (#50; a list run's `updatedAt` also moves when one of its company crawls starts an attempt, so a quiet list is a stopped one), `parentCrawlId?` (#50: on a company crawl, its list run), `listShare? N` (#50: on a company crawl, the candidates it keeps and reads descriptions for), `aiSource?` (T08b2: where the crawl's AI work gets its model: `platform`, `none` (T08b3: keyword filter only), or a provider; the user's choice for this crawl, else their default at the time), `aiRun? {week, month}` (T08b3: the free platform run this crawl used, and where it was counted; a failed crawl gives it back), `status` (`queued`, `running`, `succeeded`, `failed`, or `cancelled`), `attempts N`, `startedAt?`, `finishedAt?`, `result? {finalUrl, httpStatus, contentType, bytes, s3Key}` (T06b: the fetched page; `s3Key` is never shown by the API), `stats? {jobsFound, jobsNew, jobsUpdated, pagesFetched, jobsClosed, jobsRelevant, jobsOverLimit, descriptions? {fetched, gone, failed, skipped}, companies? {succeeded, failed}}` (T07b, T07c, T08c; #50: a list run's totals are its company crawls' added up, and `companies` counts them; `pagesFetched` counts requests, not robots.txt, nor postings read for descriptions; `jobsRelevant` the candidates, `jobsOverLimit` those hidden by the per-company limit; T08d3 `descriptions`: postings read for top candidates without one, `gone` closed by a 404 or 410, `skipped` not tried in time), `extraction? {outcome, method?, board?, skipped N, partial? {reason}}` (`outcome` `read` or `no_readable_jobs`; `method` `ats_feed` or `schema_org`; `board` for example `greenhouse:acme`; `reason` `max_jobs`, `max_pages`, `time_budget`, or `page_failed`) (T07b; only on `succeeded`), `error? {code, message}` (`code` from `CRAWL_ERRORS` in `packages/shared`), `lastError? {code, message}` (T06b: the latest retriable failure while a retry is pending), `candidates? L` (T08d: the job IDs the LLM scores, shown ones first, at most the admin's `relevanceMaxJobs`; only crawls with an AI source; never shown by the API. #50: a company crawl keeps its `listShare`, and its list run takes each company's first, then each one's second, and so on), `relevance? {status (running, done, or failed), startedAt, finishedAt?, calls N (task calls stored; at most 6 per crawl), sent L (job IDs already sent: a retried message never sends them again), leaseUntil? and leaseId? (until when, and which delivery (random), holds the run: a duplicate meanwhile skips, a retry after it takes over; its calls and its end name the leaseId), reason? (`RELEVANCE_ERRORS` in `packages/shared`), stats? {candidates, scored, reused, unscored, hidden, overLimit}}` (T08d; its own writes carry `relevance`, which keeps the relevance Pipe from starting again), `llm? {keySource, provider, model, calls, inputTokens, outputTokens}` (T08d: what the crawl's AI work used), `ttl` (180 days).

## 6. `usage`: counters

| `sk` | Attributes |
|---|---|
| `COMPANY#<companyKey>` | T08c: `companyKey`, `shown M<jobId, {p N, t?, s?}>` (the company's shown jobs, at most the user's per-company limit; `p` the matched role's priority, `t` `postedAt`, T08d `s` the LLM's score, to rank them again: scored jobs first, by score), `version N` (each crawl replaces the item only at the version it read). No `ttl`: shown jobs are kept while open; a closed job frees its place. |
| `AIWEEK#<yyyy-Www>` | T08b3: `platformRunIds SS` (the crawls that used a free platform AI run this ISO week; at most `platformRunsPerWeek`), `ttl` (8 weeks). |
| `AI#<yyyy-mm>#<keySource>#<provider>#<modelId>` | T08b3: token use in a month for one model: `keySource` (`platform` or `own`), `provider`, `modelId`, `month`, `calls N`, `inputTokens N`, `outputTokens N`, `runs N`, and per task `task_<task>_calls`, `task_<task>_inputTokens`, `task_<task>_outputTokens` (`-` in a task name becomes `_`). Written in the same transaction as the task's result (T08d). |
| `DAY#<yyyy-mm-dd>` | `crawls N` (T06c), `lists N` (#50: list runs, also counted in `crawls`; at most the admin's `listsPerDay`), `keyChecks N` (T08b2: key saves and re-checks, at most 5), `applications N`, `ttl` (7 days). Enforces daily caps. Days are UTC. |
| `MONTH#<yyyy-mm>` | `crawls N` (T06c), `platformRunIds SS` (T08b3: crawls that used a free platform AI run this month; at most `platformRunsPerMonth`), `tailoringRunIds SS` (#51: tailored versions on the free platform model this month; at most 10; given back when no model call was made), `applications N`. Token use moved to the `AI#` items. |
| `TAILOR#<companyKey>` | #51: `companyKey`, `activeId?` and `activeSince?`: the company's tailoring run in progress (one at a time; taken over after 60 minutes). |
| `ROLES` | `itemCount N`: the user's target roles. Counted in the same transaction as each create (only while fewer than 10) and delete; corrected once if it ever disagrees with the roles that exist. |
| `DOCUMENTS` | `itemCount N`, `defaultDocumentId?`: counted like `ROLES` (cap 10). A first upload becomes the default only if it claims `defaultDocumentId` in its transaction; a default switch requires the marker it read; deleting the default hands it to the newest `ready` document in the same transaction (#33), or frees it when none is ready. Pending uploads expire without running code, so a count or marker that disagrees with the documents that exist is corrected once, then the create retried. |
| `ACTIVE` | `crawlIds SS`: the user's queued or running crawls. Added in the crawl request transaction (only while fewer than the admin's `maxActive`), removed in the transaction that ends the crawl; a submit that finds the set full first frees IDs of crawls that are finished, gone, or stale. |

**How the per-company limit works (T08c):** "company" is the job's `companyKey` until the shared company list exists ([#40](https://github.com/jobdeputy/jobdeputy-archive/issues/40)). It is a snapshot, not a count over time: after the code filter, each crawl ranks the company's candidates it read together with the shown jobs other pages listed (by role priority, then the newest posting; T08d ranks by score). The best, up to the limit, are `counted`; the rest `over_limit` (hidden and kept 7 days, ranked again on the next crawl). Jobs the crawl read and dropped leave the list; closed jobs free their places. The replace is conditional on `version`, so two crawls at once stay exact.

## 7. `audit`: audit history (renamed from `events`, [0007](decisions/0007-crawler.md))

Key: `userId`, `auditId` (ULID, so entries are ordered by time). Written in the same transaction as the action it records; never changed; erased only with the account.

`name`: every change to the user's data (T06d), written in the same transaction as the change; a failed change writes none:

- by the user: `profile.saved`, `search.saved`, `role.created`, `role.updated`, `role.deleted`, `document.upload_started`, `document.renamed`, `document.default_changed`, `document.deleted`, `crawl.requested`, `crawl_limit.changed`;
- by the system: `document.ready`, `document.rejected`, `document.failed`, `crawl.succeeded`, `crawl.failed`;
- not recorded: account deletion (it erases the history too) and internal steps (a document starting processing, a crawl attempt starting).

Other attributes: `entity {type, id}`, `actor` (`user` or `system`), `summary` (short, for example `Crawl failed: jobs.example.com (blocked)`), `detail? M` (IDs, codes, and sizes only), `ttl` (1 year).

`name` (for example `crawl.started`, `job.found`, `rule.changed`, `application.submitted`), `entity {type, id}`, `actor` (`user`, `system`, or `automation`), `summary`, `detail? M` (never secrets or sensitive answers), `ttl` (1 year).

## 8. `jobs`: jobs found for the user

Key: `userId`, `jobId`. One shape for every job, whatever it was read from (a job-board feed, schema.org data, or later an LLM); each source's own format is converted into these fields ([0008](decisions/0008-job-extraction.md)).

`jobId` is the first 32 hex characters of SHA-256 of `dedupeKey`, the best available posting key:

1. `ats:<companyKey>:<externalId>`: the job board and its posting ID (the title or link can change; the job is the same);
2. otherwise `url:<jobUrl>` (normalized, tracking parameters dropped);
3. otherwise `text:<companyKey>|<title>|<first location>` (lowercase), only when one link lists several jobs.

So the same job is stored once per user, and a re-crawl updates it.

**A re-crawl sets what it read and never removes a posting field it did not read**: a board's list can carry less than the posting itself (no description, "3 Locations"), so a missing field is not evidence it went away. **Required** means every saved job has it: a listing without a title or a usable link is skipped and counted, never saved. **Optional** attributes are absent (not `null`) until known. Later tasks only add attributes; they never change a required one.

### Posting: read from the site (built in T07b)

| Attribute | Type | Required | Notes |
|---|---|---|---|
| `dedupeKey` | S | yes | See above |
| `title` | S | yes | Plain text, at most 300 characters |
| `jobUrl` | S | yes | The posting's page; `http(s)` only, passing the crawl URL rules (no private addresses, credentials, or LinkedIn) |
| `companyKey` | S | yes | Who is hiring, until the shared company list exists ([#40](https://github.com/jobdeputy/jobdeputy-archive/issues/40)): `greenhouse:acme`, `lever:acme`, `ashby:acme`, `workday:<host>/<site>`, or `site:<domain>`. Lowercase. |
| `locations` | L | yes, may be empty | `{text, city?, region?, country?}`: `text` as the site wrote it; the parts only when the site gives them; `country` only as an ISO 3166 alpha-2 code. At most 20. Empty when the list only says "3 Locations". |
| `contentHash` | S | yes | Hash of what the user reads except the description (title, company, places, workplace, type, salary, apply link); a change, or a new `descriptionHash`, means re-score |
| `companyName` | S | no | As the site wrote it, at most 200 characters. Lever, Ashby, and Workday lists do not give it; the app then shows the board. |
| `companyId` | S | no | Resolved from `companyKey` once `companies` exists ([#40](https://github.com/jobdeputy/jobdeputy-archive/issues/40)) |
| `applyUrl` | S | no | Only when it differs from `jobUrl`; same rules |
| `ats` | S | no | `greenhouse`, `lever`, `ashby`, or `workday`; absent for a company's own site |
| `externalId` | S | no | The board's posting ID (Workday: the requisition ID) |
| `workplace` | S | no | `onsite`, `hybrid`, or `remote` |
| `employmentType` | S | no | `full_time`, `part_time`, `contract`, `internship`, or `temporary` |
| `salary` | M | no | A range, unlike the single-amount money convention: `{min?, max?, currency, period}`, at least one amount; `currency` ISO 4217; `period` `year`, `month`, `week`, `day`, or `hour`. Never converted. |
| `description` | S | no | Plain text (never HTML), at most 32,000 characters. Absent when the list has none (Greenhouse, Workday): fetched later for relevant jobs only (T08). |
| `descriptionTruncated` | B | no | Set with the description: `true` when it was cut |
| `descriptionHash` | S | no | Hash of the description, set with it. Kept apart from `contentHash` because a board's list has no description: re-crawling it must not look like a change to a job whose description was fetched later. |
| `postedAt` | S | no | ISO 8601; absent when unknown or implausible (Workday's "30+ days ago") |

### Discovery: where and when it was found (T07b, T07c)

| Attribute | Type | Required | Notes |
|---|---|---|---|
| `sourceIds` | SS | yes, until closed | The saved pages that currently list it (a string set, so saving again adds nothing). A complete crawl of a page that no longer lists it removes that page; absent once no page lists it. |
| `firstCrawlId`, `lastCrawlId` | S | yes | |
| `firstSeenAt`, `lastSeenAt` | S | yes | |
| `extraction` | M | yes | `{method, version}`: `ats_feed` or `schema_org` now; `llm` later ([T07d](https://github.com/jobdeputy/jobdeputy-archive/issues/41)) |
| `closedAt` | S | no | Set when no saved page lists it any more (T07c: after complete crawls, never partial ones), or (T08d3) its posting answered 404 or 410 when its description was read, though its board still lists it; removed when a crawl lists it again |

### Fit for the user (T08 and later)

Designed with the LLM work; the shapes below are the layout, not final.

| Attribute | Type | Required | Notes |
|---|---|---|---|
| `relevance` | M | no | T08d, the LLM's score: `{score N, bestRoleId?, reasons L, model, promptVersion, inputsHash, scoredAt}`. `score` 0–100; `bestRoleId` one of the user's roles; at most 3 short `reasons` (from `relevance@v2`, never one that quotes a short ID such as `r1`: those are dropped, #62); `promptVersion` for example `relevance@v2`; `inputsHash` over `contentHash`, `descriptionHash`, the profile the model saw, and the prompt version (a re-crawl scores the job again only when it changes). A score below the admin's `relevanceMinScore` (default 30) sets `filter.state` to `not_relevant` and adds the reason `llm_low_score`; the others rank the company's shown jobs by score. |
| `match` | M | no | #51 (decision 0015): the tailored résumé made for it, against the job (the "ATS score", computed in code): `{resumeDocumentId, score N or null, base N or null (the base résumé's), missing L, version N (`MATCH_SCORE_VERSION`), scoredAt}` |
| `keywords` | M | no | #51: the job's keywords, cached: `{descriptionHash, promptVersion, terms L<{term, kind, required}>}`; asked again when the description or prompt changes |
| `materials` | M | no | Documents made for this job: `{resumeDocumentId?, coverLetterDocumentId?}` (#51 sets `resumeDocumentId`). The files are `documents` items (`origin: generated`, `baseDocumentId`, `jobIds`), so they are listed, versioned, and deleted with the account like any document. |
| `filter` | M | no | T08c, the free code filter: `{state (candidate or not_relevant), roleIds L (roles it matched), reasons L, priority N (the best matching role's), version N}`. Reasons: `title_match`, `headline_match`, `skill_in_title`, `no_target_roles` (kept); `title_no_match`, `seniority`, `place`, `workplace`, `employment_type`, `salary_below`, `excluded_word:<word>` (dropped); T08d `llm_low_score` (dropped by the LLM's score, after the crawl). Set on every crawl that reads the job. |
| `limitState` | S | no | T08c, candidates only: `counted` (shown, within the company's limit) or `over_limit` (hidden). Absent for `not_relevant` jobs. |
| `ttl` | N | no | T08c, epoch seconds: set when a job is hidden (`not_relevant` or `over_limit`; kept from when it was first hidden), or closes with `status` `new`; removed when it is shown again. Never set for a job the user acted on. Expiry days: the admin's `jobExpiryDays` (default 7). |
| `companyNeedsReview` | B | no | With the shared company list: set when the company cannot be resolved |

### The user's own fields (T07b)

A re-crawl updates only the posting and discovery groups; it never overwrites these.

| Attribute | Type | Required | Notes |
|---|---|---|---|
| `status` | S | yes | `new` (on first save), `shortlisted`, `dismissed`, `applying`, `applied`, or `archived` |
| `starred` | B | yes | `false` on first save |
| `notes` | S | no | The user's own text |
| `applicationId` | S | no | Phase 2 |

### Example (abridged)

```jsonc
{
  "userId": "…", "jobId": "bead180324ab962b9b6f84408d10f120",
  "type": "job", "schemaVersion": 1, "createdAt": "2026-09-30T10:00:00Z", "updatedAt": "2026-09-30T10:00:00Z",
  "dedupeKey": "ats:greenhouse:acme:4001001",
  "title": "Backend Engineer", "companyName": "Acme Robotics", "companyKey": "greenhouse:acme",
  "locations": [{ "text": "Dublin" }],
  "jobUrl": "https://job-boards.greenhouse.io/acme/jobs/4001001",
  "ats": "greenhouse", "externalId": "4001001", "postedAt": "2026-09-03T17:30:34.000Z",
  "contentHash": "…",
  "sourceIds": ["…"], "firstCrawlId": "01K…", "lastCrawlId": "01K…",
  "firstSeenAt": "2026-09-30T10:00:00Z", "lastSeenAt": "2026-09-30T10:00:00Z",
  "extraction": { "method": "ats_feed", "version": 1 },
  "status": "new", "starred": false
}
```

## 9. `companies`: shared company list (public, per cell)

Deferred to the first feature that needs a resolved company, such as company rules ([0008](decisions/0008-job-extraction.md), [#40](https://github.com/jobdeputy/jobdeputy-archive/issues/40)). Until then jobs carry `companyKey`.

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

Key: `userId`, `sk`. Values are encrypted in the application before they are written. The encryption design (KMS, which needs a cost exception under [0005](decisions/0005-pre-launch-cost-guardrails.md)) is decided when this table is built.

| `sk` | Attributes |
|---|---|
| `SITE_LOGIN#<domain>` | `username`, `ciphertext` (password), `createdBy` (`user` or `automation`, for example a Workday account created while applying), `lastLoginAt?` |
| `SENSITIVE` | `ciphertext` of `dateOfBirth` and the voluntary equal-opportunity answers (gender, ethnicity, veteran status, disability). Equal-opportunity answers default to "decline to answer". |

## 16. `ai-keys`: the user's own AI keys (T08b2, [0009](decisions/0009-llm-architecture-and-own-keys.md))

Key: `userId`, `provider` (`openai`, `anthropic`; `stub` in dev stacks only, for integration tests). Replaces the planned `vault` `AI_KEY#<provider>` item.

`ciphertext B` (the key encrypted with the cell's KMS key from the keys stack, encryption context `{userId, provider}`; only the key API encrypts, only the key-check worker and later the LLM workers decrypt; never returned or logged), `last4`, `modelId`, `status` (`checking`, `valid`, or `invalid`), `reason?` (why `invalid`: `rejected`, `model-not-found`, `no-credit`, `model-refused`, or `check-failed`), `checkId` (the current check; a result is recorded only for it), `consentAt` (the user agreed to send job data to the provider when saving), `checkedAt?`.

Audit entries: `ai_key.saved`, `ai_key.check_requested`, `ai_key.checked` (system), `ai_key.deleted`, `ai_settings.changed`. None holds the key or its last 4 characters.

## 14–15. Infrastructure

- `ping-jobs` (key `id`): `userId` (owner; only the owner can read it), `status`, `attempts`, `sideEffectCount`, `deliveries` (every queue delivery, including duplicates), `fail?` (dev-only test flag), `error?`, `ttl` (1 day). **Dev stacks only** (T04 test scaffolding): it holds a user ID outside the user tables, so account deletion does not reach it; in dev only test users exist, and items expire after a day.
- `idempotency` (key `id`): Powertools' own schema, with `expiration` as its time-to-live.

## S3 layout (one bucket per cell)

```text
users/<userId>/documents/<documentId>/original             the uploaded file (PDF or DOCX, at most 5 MB)
derived/users/<userId>/documents/<documentId>/text.txt     its extracted text (at most 200,000 characters)
derived/users/<userId>/documents/<documentId>/structured-<eTag>.json   #51: an uploaded résumé as structured data (one per file version)
derived/users/<userId>/documents/<documentId>/resume.{json,pdf,docx}   #51: a tailored version: the résumé and its two files
derived/users/<userId>/crawls/<crawlId>/page             the fetched page (at most 5 MB; expires after 30 days)
users/<userId>/applications/<applicationId>/...    screenshots and confirmations
users/<userId>/snapshots/<jobId>/...               page snapshots (deleted after 30 days)
```

Everything under `users/<userId>/` and `derived/users/<userId>/` goes with account deletion or export.

- **`users/`** holds what users upload. GuardDuty scans every new object there and tags it `GuardDutyMalwareScanStatus`; the API can only read an `original` tagged `NO_THREATS_FOUND` (bucket policy).
- **`derived/users/`** holds files we produce: text extracted from clean uploads, and pages the crawl worker fetched (T06b). It is not scanned, so each upload is scanned exactly once; fetched pages are never served to a browser. Only workers can write there (the crawl worker only to `…/crawls/*/page`).
- Fetched pages carry the tag `retention=crawl-page`; a lifecycle rule deletes them after 30 days.
- The prefixes and key format are defined once, in `packages/shared` (`documentKeys`, `crawlKeys`, `tailoringKeys`, `structuredKey`). The bucket is private, S3-encrypted, HTTPS-only, and never replicated.

## Change log

| Date | Change | PR |
|---|---|---|
| 2026-09-28 | Initial schema for all 15 tables ([0006](decisions/0006-data-model.md)) | T04 |
| 2026-09-28 | `ping-jobs`: add `deliveries`, so tests wait on a counted delivery instead of sleeping | T04 |
| 2026-09-28 | `ping-jobs`: add `userId` (owner from the token); other users get 404 | T05 |
| 2026-09-28 | `users` `PROFILE`, `preferences` `SEARCH` and `ROLE#`: add `version`; `ROLE#` also stores `roleId`. `users` and `preferences` tables built. | T05b |
| 2026-09-28 | Documented the physical schema (keys, settings, access patterns, examples) of built tables; an infra test checks it lists every deployed table | T05b |
| 2026-09-28 | `users`: `DELETION` item, stream (filtered to `DELETION` inserts), and `ttl`; account deletion erases every table keyed by `userId` and both S3 prefixes (an infra test enforces coverage) | T12 |
| 2026-09-28 | Extracted text moved to `derived/users/…/text.txt`, outside the scanned prefix: one malware scan per upload instead of two | T05c |
| 2026-09-28 | `documents` table and file bucket built: statuses `pending`/`processing`/`ready`/`rejected`/`failed`, `format`, `eTag`, `error`, `ttl`, and `parsed` fields; S3 `original` and `text.txt` | T05c |
| 2026-09-28 | `events` renamed `audit` (key `auditId`); `sourceId` is a hash of the normalized URL ([0007](decisions/0007-crawler.md)); design only, tables not built yet | T06 |
| 2026-09-28 | `sources`, `crawls` (stream), and `audit` tables built; `sources.activeCrawlId`, `crawls.result` and `lastError`; `audit` crawl entries; S3 `derived/users/…/crawls/<crawlId>/page` (30-day expiry by tag) | T06b |
| 2026-09-28 | `usage` table built (`DAY#` and `MONTH#` `crawls`, counted in the crawl request transaction); `preferences` `CRAWL_SETTINGS` (`dailyLimit`); audit `crawl_limit.changed` | T06c |
| 2026-09-28 | `audit`: entries for every change to the profile, search settings, roles, and résumés (T05 actions), each in the same transaction as the change | T06d |
| 2026-09-29 | `usage` `ACTIVE` item (`crawlIds`): a per-user limit on crawls in progress at once; every transaction retries conflicts | fix after T06d |
| 2026-09-29 | `usage` `ROLES` and `DOCUMENTS` counters (exact caps under concurrent creates; one default document) | fix after T06d |
| 2026-09-29 | `ping-jobs` and `idempotency`: dev stacks only; `ping-jobs` items expire after 1 day (were 7), because they hold a user ID that account deletion does not reach | deep check |
| 2026-09-29 | `jobs` layout: required and optional attributes, `dedupeKey` rules, `companyKey`, `locations` items `{text, city?, region?, country?}`, `salary` as a range, `description` as plain text (32,000 characters), `descriptionTruncated`; groups for relevance, résumé match, and generated materials; `companies` deferred ([0008](decisions/0008-job-extraction.md)); design only, table not built yet | docs |
| 2026-09-29 | `jobs` table built (T07b): `sourceIds` is a string set; `descriptionHash` added and `contentHash` no longer covers the description; `descriptionTruncated` set with every description; a re-crawl never removes a posting field. `crawls`: `stats {jobsFound, jobsNew, jobsUpdated}` and `extraction`. `sources`: `kind` `ats_board`, `ats`, `stats {lastFound}`. | T07b |
| 2026-09-29 | T07c: `crawls.stats` gains `pagesFetched` and `jobsClosed`; `extraction.partial.reason` gains `max_pages`, `time_budget`, `page_failed`; `sources.listedJobIds`; `jobs.sourceIds` means the pages that currently list the job, and is absent once it is closed | T07c |
| 2026-09-30 | `ai-keys` table (the user's own keys, encrypted with the cell's KMS key from its keys stack; replaces `vault` `AI_KEY#`); `preferences` `AI_SETTINGS`; `usage` `DAY#` `keyChecks`; `crawls.aiSource` | T08b2 |
| 2026-09-30 | T08b3: `usage` `AIWEEK#` and `MONTH#` `platformRunIds` (free platform AI runs, counted at submit, given back on failure); `usage` `AI#<month>#…` token items replace `MONTH#` `llmCalls`, `inputTokens`, `outputTokens`; `crawls.aiRun`; `aiSource` and `defaultSource` `none` | T08b3 |
| 2026-09-30 | `jobs`: `filter`, `limitState`, and `ttl` (time to live on); `usage` `COMPANY#<companyKey>` (shown jobs per company, replacing the windowed counter design); `preferences` `CRAWL_SETTINGS` `companyJobsLimit`; `crawls.stats` `jobsRelevant`, `jobsOverLimit` | T08c |
| 2026-10-01 | `jobs.relevance` built (`score`, `bestRoleId`, `reasons`, `model`, `promptVersion`, `inputsHash`, `scoredAt`; replaces the `byRole`/`method` design); `filter.reasons` `llm_low_score`; `crawls.candidates`, `relevance`, and `llm` (replaces the T07d `llm` design); `usage` `COMPANY#` `shown` entries gain `s`; audit `crawl.scored` | T08d2 |
| 2026-10-01 | `crawls.stats.descriptions`; `jobs.closedAt` also set when a candidate's posting is gone; the crawl worker batch-reads `jobs` (`jobId`, `descriptionHash`) | T08d3 |
| 2026-10-01 | `jobs.relevance` from `relevance@v2`: `reasons` never quote a short ID | #62 |
| 2026-11-21 | No new fields: `GET /me/companies` reads `usage` `COMPANY#` items and batch-reads `jobs`; the admin default for jobs shown per company is 3 (was 10) | #49 |
| 2026-11-21 | `documents`: deleting the default hands `isDefault` (and `usage` `DOCUMENTS.defaultDocumentId`) to the newest `ready` document in the same transaction, instead of freeing it | #33 6b1 |
| 2026-11-22 | List runs: `crawls.kind`, `listSource`, `list`, `queuedCount`, `runningIds`, `childIds`, `childrenEnded`, `parentCrawlId`, `listShare`; `trigger` `list`; `stats.companies`; `sources.kind` `list`; `usage` `DAY#` `lists`. Company crawls are `crawls` items too; `GET /me/crawls` leaves them out | #50 |
| 2026-11-22 | `documents`: stream (only generated `queued` inserts → the tailoring worker); generated versions (`origin: generated`, `companyKey`, `jobIds`, `baseDocumentId`, `aiSource`, `platformRun`, `tailoring`, `generation`, `fileName`), never listed or counted with uploads; uploads' `structured`. `jobs`: `keywords`, `match` (built), `materials.resumeDocumentId`. `usage`: `MONTH#` `tailoringRunIds`, `TAILOR#<companyKey>` lock. S3: `structured-<eTag>.json`, `resume.{json,pdf,docx}` | #51 |
| 2026-11-22 | `crawls.relevance.leaseUntil`, `leaseId`: one delivery scores a crawl at a time (a duplicate delivery had ended a run early, counting its scores as reused) | fix after #71 |
