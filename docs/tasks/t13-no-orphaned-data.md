# T13: No orphaned user data

- **Status:** in-review
- **Depends on:** T12
- **Branch / PR:** `t13-no-orphaned-data`

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
- [ ] Proven on the personal stack: an orphaned account and an old test login are found by the reaper and fully erased by the deletion pipeline.
- [x] The runbook documents how to delete an account safely, including by an operator.
- [ ] Alarms for API 5xx and the reaper, and the alarm runbook; proven by a reaper alarm on real AWS. (Runbook done; the reaper's error on leftovers is proven on the personal stack. The alarm exists only on the shared stack, so it is proven after merge.)
- [ ] Nightly integration run with a failure email. (Proven after merge: GitHub can only schedule or manually start workflows from `main`.)
- [x] Reserved domains refused at sign-up (integration test), and the reaper limited to the test group (unit tests).
