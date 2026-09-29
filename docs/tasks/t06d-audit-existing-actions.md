# T06d: Audit for existing actions

- **Status:** done
- **Depends on:** T06b (the `audit` table)
- **Branch / PR:** `t06d-audit-existing-actions`, [#32](https://github.com/jobdeputy/jobdeputy/pull/32) (merged)

## Goal

Every action on user data shipped before T06 also writes an audit entry, so the audit history is complete.

## Scope

- In: `profile.saved`, `search.saved`, `role.created`, `role.updated`, `role.deleted`, `document.upload_started`, `document.ready`, `document.rejected`, `document.failed`, `document.renamed`, `document.default_changed`, and `document.deleted`. Each is written in the same transaction as the action, with a short summary and IDs only (never personal details or file contents).
- Out: new features. Account deletion writes no entry: it erases the audit history with everything else.

## Research

See the [T06 decision](t06-async-crawl-pipeline.md#decision), item 5.

## Decision

Agreed on 2026-09-28 as part of T06.

## Findings while building

- **`document.upload_started`, not `document.uploaded`:** the entry is written when the upload link is issued; the file arrives later (and is then `document.ready`, `rejected`, or `failed`).
- **One mechanism for every write:** `putVersioned` and the document repository's update take the audit entry as a required argument and send it in the same `TransactWriteItems` as the change, so a new write path cannot forget it (it would not compile). Internal steps pass none on purpose.
- **Transactions return no attributes:** a document change reads its result back (consistently) instead of `ReturnValues`.
- **Found on real DynamoDB:** inside a transaction, an empty `ExpressionAttributeNames` map is rejected (renaming a document answered 500 on the personal stack). It is now sent only when it has entries, with a regression test.
- **No personal details in the history:** summaries hold IDs and, for target roles, the role title; never file names, profile fields, or file contents (checked by the integration test).

## Done when

- [x] Each listed action writes exactly one audit entry (unit tests), and a failed action writes none (a stale save, a missing role, a duplicate scan event: unit tests; a stale profile save: integration test).
- [x] Integration tests read the entries through `GET /me/audit`: the full sequence from profile to deleted résumé, with user and system actors; 24/24 on the personal stack; nothing left afterwards (only the expiring `DELETION` records of deleted test accounts).
- [x] Least privilege: each function that changes user data may only add audit entries (`PutItem`); only the audit API may read them (infra tests).
