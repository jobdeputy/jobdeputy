# Runbook: alarms and what to do

Alarm emails go to the addresses in the `JD_ALERT_EMAIL` secret (GitHub `dev` environment). Alarms exist on the shared stacks (`jobdeputy-dev-iad`, and the prod cells at launch). Personal and PR stacks have none (nobody is subscribed there).

AWS profile for all commands below: `--profile jobdeputy-dev-iad` (dev) or the prod account's profile.

## Dead-letter queue not empty

`…PingPipelineDeadLetterAlarm…`, `…DocumentsDeadLetterAlarm…`, `…DeletionPipelineDeadLetterAlarm…`, `…CrawlPipelineDeadLetterAlarm…`

**Meaning:** a job failed 3 times and was parked in the dead-letter queue (DLQ). Nothing is lost; the message waits there for 14 days.

1. **Read the parked message** (it holds only IDs, never user data):

   ```sh
   aws sqs receive-message --queue-url <queue-url>-dlq --max-number-of-messages 1 --visibility-timeout 30
   ```

2. **Find the error** in the worker's logs (CloudWatch Logs, log group of `PingWorker`, `DocumentsWorker`, `DeletionWorker`, or `CrawlWorker`), around the time of the alarm. Search for `"level":"ERROR"` or the ID from the message.
3. **Fix the cause** (a bug: fix it in a PR; a temporary AWS problem: nothing to fix).
4. **Retry:** in the SQS console, open the DLQ and choose **Start DLQ redrive** (back to the source queue). Workers are safe to repeat.

**Priority by queue:**

| Queue | What is at stake | Priority |
|---|---|---|
| `account-deletions` | A user's data may not be fully erased: a legal obligation (right to erasure) | **Same day.** Fix, redrive, then verify with [account-deletion.md](account-deletion.md#checking-that-an-account-is-gone). |
| `document-scans` | A résumé is stuck or failed; the user sees "failed, upload again" | Within a day |
| `crawls` | Our own failure (a bug, S3 or DynamoDB errors) 3 times in a row. Sites that block us, time out, or are down never reach the DLQ: those crawls end as `failed` with a reason. The crawl already shows `failed` (`internal`), so the user can submit again. | Within a day. After a fix, submit again rather than redrive: a redriven message finds the crawl finished and does nothing. |
| `ping-jobs` | Test scaffolding only | Whenever convenient; usually from a forced-failure test |

## Queue backed up

`…CrawlPipelineBacklogAlarm…`, `…DocumentsBacklogAlarm…`, `…DeletionPipelineBacklogAlarm…`

**Meaning:** a message has waited longer than that queue's slowest normal path (crawls 15 minutes, documents 30, account deletions 60). The worker is stuck, throttled, or failing slowly; users see crawls stuck in `queued`, résumés stuck in `pending`, or, for deletions, data not yet erased.

1. **Is the worker running?** Check its Lambda metrics: `Throttles` (the account's concurrency limit, #35), `Errors`, and `Duration` near the timeout.
2. **Throttled:** raise the account's concurrency limit, or find what else is using it (a burst of API calls, another stack's tests).
3. **Errors:** read the worker's logs, as for a dead-letter alarm above. Messages that keep failing will reach the DLQ.
4. **Account deletions: same day.** When the queue drains, check each affected account with [account-deletion.md](account-deletion.md#checking-that-an-account-is-gone).

All queue alarms exist in shared stacks only: personal and PR stacks have no subscribers.

**Not alarmed on purpose:** the sign-up check (`PreSignUp`) refuses reserved test domains by throwing an error (Cognito requires this), so its error count includes every refusal, including the Nightly test's. It is 10 lines of pure logic, unit-tested and exercised nightly; alarming only on unexpected errors would need a paid custom metric.

## API server errors (5xx)

`…ApiServerErrorAlarm…`

**Meaning:** at least one API request failed with a server error in the last 5 minutes. Users may be affected.

1. Find the failing Lambda: search the API functions' logs (`MeApi`, `ProfileApi`, `DocumentsApi`, `CrawlsApi`, `AuditApi`, `PingApi`) for `Unhandled error`. Each entry has the request ID and the error.
   - **No `Unhandled error` anywhere?** The 5xx came from API Gateway itself: check the Lambda `Throttles` metric (the account's concurrency limit) and API Gateway's own limits.
   - The dev test site's deliberate errors (its "site that is down" page answers 503) never trigger this alarm: the test site is a separate API that no alarm watches (fixed on 2026-09-29, after it caused false alarms on every merge).
2. **Right after a deploy?** Revert the last PR (a new PR with `git revert`), which deploys the previous version, then investigate.
3. **Not after a deploy?** Check the AWS Health Dashboard for the Region and the throttling limits (API Gateway, DynamoDB, Cognito).
4. Add a test that reproduces the error, with the fix, in the same PR.

## Test-data reaper failed or found leftovers (dev only)

`…TestDataReaperAlarm…`

**Meaning:** either the daily reaper broke, or it **found leftover data and already requested its deletion**. Leftovers mean something leaked.

1. Read the reaper's log for the run (log group of `TestDataReaper`):
   - `LeftoversFoundError: Requested deletion of X stale test login(s) and Y orphaned account(s)`: **cleaned up already**. Find out why:
     - **Stale test logins:** a test run died before its clean-up. Check GitHub Actions for cancelled or timed-out Integration, Deploy dev, or Nightly runs around the users' creation time.
     - **Orphaned accounts:** a login was deleted without its data, most likely by hand in the Cognito console. That is against the rule in [account-deletion.md](account-deletion.md).
   - Any other error: the reaper itself is broken. Fix it in a PR. Nothing is lost; the next day's run catches up.
2. The alarm returns to OK after a clean run (the next day, or invoke the reaper by hand to confirm).

## Nightly integration failed

Nightly emails its result every night, scheduled for 02:23 UTC (off the hour; GitHub may still start it late). The email says **"JobDeputy nightly PASSED (dev-iad)"** when everything passed. Otherwise the subject is **"JobDeputy nightly: integration FAILED, model check PASSED (dev-iad)"**, with FAILED or DID NOT RUN for each part. The email has a link to the run.

- **DID NOT RUN:** the tests were cancelled or never started, usually because two deploys queued while Nightly waited (it never overlaps a deploy of the same stack). Re-run it (step 4). If it happens often, look at what deploys at that hour.

1. Open the run link. Read which test failed and why.
2. **Something changed without a code change** (AWS behaviour, an expired setting, a quota): fix it and add a test that would have caught it.
3. **The test itself is flaky:** that is a bug ([testing.md](../testing.md#rules-against-flaky-tests)). Fix it or remove it in the next PR; never just re-run until it passes.
4. Re-run the workflow (Actions → Nightly → Run workflow) to confirm.

## Nightly model check failed

The email shows the eval table: calls, valid output, labels, injections resisted, and tokens, with the saved baseline. The check makes one real call per case to the platform model ([0010](../decisions/0010-platform-ai-model.md)) through `packages/llm`.

- **An injection succeeded, or accuracy fell below the baseline:** the model or its behaviour changed with no code change. Run the eval locally 2 or 3 times (`AWS_PROFILE=jobdeputy-dev-iad pnpm --filter @jobdeputy/llm eval --runs 3`). If it repeats, open an issue and check the model on its provider page ([#49](https://github.com/jobdeputy/jobdeputy/issues/49) looks for replacements). Never update the baseline to make it pass.
- **Did not finish, or `AccessDenied`:** the IAM grant or the cost guardrail no longer allows the pinned model, or Bedrock is down in the Region. Check `bedrock:InvokeModel` for `jobdeputy-github-deploy` (`infra/lib/cicd-stack.ts`) and the `jd-cost-guardrails` SCP.
- **Throttled:** Bedrock quotas in dev. Re-run; if it repeats, check the Bedrock service quotas.

**GitHub's 60-day rule:** GitHub disables scheduled workflows (Nightly, and the daily Integration cleanup) after 60 days with no commits. It emails the repository admins first. To re-enable: Actions → the workflow → **Enable workflow**. The AWS alarms and the dev reaper run in AWS and are not affected.

## Budget alerts ($5, $10, $15) and the $20 block

**Meaning:** organization-wide spending reached the amount ([0005](../decisions/0005-pre-launch-cost-guardrails.md)). At $20, a deny-all policy (`budget-stop`) is attached to the Workloads OU automatically: deploys and running services stop.

1. Find what costs money: Billing → Cost Explorer, grouped by service and account.
2. Stop the cause (delete the resource or stack) and fix it in a PR.
3. **To lift the $20 block** (management account, after the cause is fixed):

   ```sh
   aws organizations detach-policy --policy-id <budget-stop-policy-id> --target-id <workloads-ou-id> --profile jobdeputy-mgmt
   ```

   The IDs are in `infra/bootstrap/` outputs and the maintainer's notes (not in this public repository).
