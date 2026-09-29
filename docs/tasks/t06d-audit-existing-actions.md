# T06d: Audit for existing actions

- **Status:** planned
- **Depends on:** T06b (the `audit` table)
- **Branch / PR:** —

## Goal

Every action on user data shipped before T06 also writes an audit entry, so the audit history is complete.

## Scope

- In: `profile.saved`, `search.saved`, `role.created`, `role.updated`, `role.deleted`, `document.uploaded`, `document.ready`, `document.rejected`, `document.failed`, `document.renamed`, `document.default_changed`, and `document.deleted`. Each is written in the same transaction as the action, with a short summary and IDs only (never personal details or file contents).
- Out: new features. Account deletion writes no entry: it erases the audit history with everything else.

## Research

See the [T06 decision](t06-async-crawl-pipeline.md#decision), item 5.

## Decision

Agreed on 2026-09-28 as part of T06.

## Done when

- [ ] Each listed action writes exactly one audit entry (unit tests), and a failed action writes none.
- [ ] Integration tests read the entries through `GET /me/audit`.
