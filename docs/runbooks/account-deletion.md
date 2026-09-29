# Runbook: deleting an account

Accounts are deleted **only** in one of these two ways, so no data is ever left without its account ([T12](../tasks/t12-account-deletion.md), [T13](../tasks/t13-no-orphaned-data.md)):

1. **The user:** `DELETE /me` (the UI's "Delete my account"), with the typed confirmation and a sign-in within the last 15 minutes.
2. **An operator** (for example a support request, or cleaning up test data): write a deletion request.

   ```sh
   scripts/request-account-deletion.sh <stack-name> <user-id> [aws-profile]
   ```

   `<user-id>` is the Cognito `sub`. The script writes the same `DELETION` record as `DELETE /me`. From then on the user's writes are refused, the deletion worker removes the login, every table item, and every file, and a final sweep follows 15 minutes later.

**Never delete a user in the Cognito console.** That removes only the login and leaves all of the user's data behind.

## Safety nets

- **Tests:** test users are deleted through `DELETE /me`. If that fails, the test still removes the login but fails the run, so the problem is noticed.
- **Dev stacks only:** a daily reaper (04:30 UTC) requests deletion of test logins (`it-…@example.com`) older than a day, and of any data whose login no longer exists. It only writes deletion requests; the normal pipeline does the deleting. It refuses to act on more than 200 accounts in one run.

## Checking that an account is gone

```sh
aws dynamodb query --table-name <stack>-users --key-condition-expression "userId = :u" \
  --expression-attribute-values '{":u":{"S":"<user-id>"}}' --profile <profile>
```

Only the `DELETION` record should remain, and it expires about 2 hours after the request. Repeat the query for the other user tables (see [docs/data-model.md](../data-model.md)); S3 prefixes `users/<user-id>/` and `derived/users/<user-id>/` should be empty.
