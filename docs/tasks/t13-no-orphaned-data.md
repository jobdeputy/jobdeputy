# T13: No orphaned user data

- **Status:** done
- **Depends on:** T12
- **Branch / PR:** `t13-no-orphaned-data`, [#20](https://github.com/jobdeputy/jobdeputy/pull/20) (merged)

## Goal

User data can never be left behind without its account. Before T12, test runs left orphaned records in the shared dev stack (cleaned on 2026-09-28 with T12's deletion requests). T12 made normal test runs clean up; this task closes the remaining gaps.

## Research

Found during the sanity check after T12. Every way data could still outlive its account:

| Gap | When | Fix |
|---|---|---|
| Test clean-up fallback | `DELETE /me` fails in a test's clean-up; the test deletes only the login, and the data is orphaned silently | Still delete the login, then **fail the run loudly**. A user that is already gone (for example deleted by the deletion test) is not an error. |
| A run that dies midway | A cancelled CI run or a killed local run never reaches clean-up (PR stacks are unaffected: they are deleted whole) | A **daily dev-only reaper** (below) |
| Manual deletion in the console | Someone deletes a Cognito user by hand | Runbook rule: accounts are deleted only through `DELETE /me` or a deletion request ([runbook](../runbooks/account-deletion.md)) |

**Reaper (dev stacks only), once a day:**

- Test logins (`it-…@example.com`, created by `createTestUser`) older than 24 hours → a deletion request.
- Data whose login no longer exists and that has no deletion request → a deletion request.
- The normal deletion pipeline (T12) then erases everything. The reaper itself deletes nothing.
- Not deployed to prod: finding orphans reads whole tables (costly at scale), and the other two fixes prevent orphans there. An infra test enforces "dev only".

## Decision

Agreed with the maintainer on 2026-09-28: all three fixes, before T06. Extended during review ("play safe"):

- **Notification:** an alarm on API server errors (5xx), and an alarm on the reaper, which reports found leftovers as an error so the maintainers are emailed. Shared stacks only (within the 10 free alarms). A runbook says what to do for every alarm ([alarms.md](../runbooks/alarms.md)).
- **Checks that do not depend on code changes:** a nightly full integration run against the shared dev stack; a failure emails the alert list. The runbook covers GitHub's 60-day schedule rule.
- **Test users cannot be confused with real users:**
  - A pre-sign-up trigger in **every** stage refuses reserved test domains (`example.com`, `*.test`, …) for self sign-up and social sign-in; admin-created test users are allowed only in dev.
  - Test users also join the Cognito group `integration-tests`. The reaper only ever lists that group, and needs both the group and the test address.

## Done when

- [x] A failed `DELETE /me` in test clean-up fails the run (unit-tested helper behaviour).
- [x] The reaper requests deletion for old test logins and for orphaned data, and nothing else (unit tests), and exists only in dev stacks (infra test).
- [x] Proven on the personal stack: a real orphan (login deleted, data left behind) was found by the reaper and fully erased by the deletion pipeline; the first run also erased 7 older pre-T12 orphans, and after a full test run the reaper finds 0. (The "test login older than a day" path is unit-tested; a login cannot be aged on demand.)
- [x] The runbook documents how to delete an account safely, including by an operator.
- [x] Alarms for API 5xx and the reaper, and the alarm runbook; proven on 2026-09-29 after merge: a probe orphan on the shared dev stack made the reaper alarm fire, and the maintainer received the email.
- [x] Nightly integration run with a failure email; proven on 2026-09-29 after merge: a manual Nightly run passed 17/17, and the deploy role may publish only to the shared alert topic (IAM policy simulator).
- [x] Reserved domains refused at sign-up (integration test), and the reaper limited to the test group (unit tests).
