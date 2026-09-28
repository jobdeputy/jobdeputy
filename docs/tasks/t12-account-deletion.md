# T12: Delete my account

- **Status:** awaiting-alignment
- **Depends on:** T05
- **Issue:** [#17](https://github.com/jobdeputy/jobdeputy/issues/17)
- **Branch / PR:** `t12-account-deletion`

## Goal

A user can delete their account, and **all** their data goes: every item under their `userId` in every user table, every file under their S3 prefixes, and their Cognito user (right to erasure under UK GDPR and India's DPDP Act). Integration tests clean up with it, so dev stacks stop collecting orphaned test data.

## Scope

- In: `DELETE /me`, an asynchronous deletion worker, a guard that no future user table can be forgotten, and test clean-up.
- Out: data export (`GET /me/export`, later with the UI), and deleting shared data (companies), which holds no user data.

## Research

### 1. What must be deleted today

| Where | How it is found | Delete with |
|---|---|---|
| `users`, `preferences`, `documents` tables | `Query` by `userId` (partition key) | `BatchWriteItem` deletes, 25 at a time |
| S3 `users/<userId>/` and `derived/users/<userId>/` | `ListObjectsV2` by prefix | `DeleteObjects`, 1,000 at a time |
| Cognito user | username from the token | `AdminDeleteUser` |
| `ping-jobs` (test scaffolding) | not keyed by user | expires by itself within 7 days (ttl); not worth an index |

Later tables (`sources`, `crawls`, `jobs`, `usage`, `events`, and so on) are all keyed by `userId` first ([0006](../decisions/0006-data-model.md)), so the same "query and delete" loop covers them.

**No table can be forgotten:** the stack passes the worker the list of every table whose partition key is `userId`. An infra test fails if any such table is missing from that list or from the worker's permissions, the same way the schema-documentation test works.

### 2. Why asynchronous

A user can have thousands of items and files later (jobs, crawls, events). That does not fit in a 10-second API call. So `DELETE /me` returns `202 Accepted`, and a worker does the deletion using the T04 pattern:

| Option | Assessment |
|---|---|
| **A `DELETION` item in `users`, with a stream on `users` and a Pipe filter for it (recommended)** | Reuses `AsyncPipeline` unchanged. No new table, so no new decision record. The stream fires for every profile save, but the filter drops those at no cost. |
| A new `account-deletions` table with a stream | Clean separation, but a new table needs a new decision record ([0006](../decisions/0006-data-model.md) rule 3) for one item per user. |
| The API sends to SQS directly | Breaks the agreed rule "never send to SQS from the API" ([0003](../decisions/0003-serverless-aws-stack.md)): if the send fails after the write, the request is lost. |

### 3. Tokens that outlive the account

API Gateway checks a token's signature and expiry, not whether the user still exists. An access token stays valid for up to **1 hour** after deletion, so a stolen or open session could still write new data for a short time.

- **Immediately:** sign the user out everywhere (`AdminUserGlobalSignOut`, which revokes refresh tokens), delete the Cognito user (no new sign-ins), and delete all data.
- **Final sweeps:** the worker re-runs the data deletion 15, 30, 45, 60, and 75 minutes later (SQS delay, at most 15 minutes per hop), so anything written by a still-valid token is removed. Each sweep costs fractions of a cent.
- Rejected: shorter token lifetimes (worse for every user, every hour), and checking "is this account being deleted?" on every request (a database read on every call).

### 4. Protecting against accidents and theft

- The request body must be `{ "confirm": "delete my account" }`. The UI shows this as a typed confirmation (T09).
- **Recent sign-in required:** the token's `auth_time` must be within the last 15 minutes, otherwise `403` with "sign in again". A token taken from an old session cannot delete the account.
- After it is accepted, repeating the request returns `202` again (idempotent). The worker can be re-run safely, because deleting what is already gone is not an error.

### 5. Tests

- **Integration:** a user with a profile, a role, and an uploaded résumé calls `DELETE /me`. Then, with the old (still unexpired) token, the profile is empty and the lists are empty, the résumé download is gone, and signing in again fails.
- **Test clean-up:** `createTestUser().delete()` calls `DELETE /me` instead of only deleting the Cognito user. It falls back to the admin delete if the API call fails, so a broken deletion can never leave a test user behind.
- **Unit:** paging (more than 25 items, more than 1,000 files), partial failures and retries, sweep scheduling, the confirmation and recent-sign-in checks, and the "every user table is covered" guard.

### 6. Least privilege and cost

- **Worker:**
  - `Query` and `BatchWriteItem` only on user tables;
  - `ListBucket` limited to the user prefixes and `DeleteObject` on them;
  - `AdminUserGlobalSignOut` and `AdminDeleteUser` on its own pool;
  - `SendMessage` to its own queue (for the sweeps).
- **API:** `PutItem` of the `DELETION` item only. CI roles need nothing new.
- **Cost:** $0 idle. A deletion is a handful of requests, plus 5 delayed sweeps.

### Open questions

1. A **`DELETION` item and a stream on `users`** (reusing the T04 pipeline, no new table)?
2. **Final sweeps for 75 minutes** to catch writes from still-valid tokens?
3. **Typed confirmation plus sign-in within the last 15 minutes** before deletion?
4. **Data export** left for later (with the UI)?

## Decision

Pending.

## Done when

- [ ] `DELETE /me` removes every user-table item, every file under the user's prefixes, and the Cognito user; proven by an integration test.
- [ ] An infra test fails if any table keyed by `userId` is not covered by the deletion worker.
- [ ] Integration tests clean up with `DELETE /me`; dev stacks keep no test records.
- [ ] Confirmation and recent sign-in are enforced (unit tests).
