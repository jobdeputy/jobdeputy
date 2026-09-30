# Runbook: changing the daily crawl limits

Each user may start a limited number of crawls per day (UTC), and have a limited number **in progress at once** (`maxActive`, admin level only). Two levels decide the daily number ([0007](../decisions/0007-crawler.md), [T06c](../tasks/t06c-crawl-limits.md)):

- **Admin, per cell:**
  - a default (for users who never chose a limit) and a maximum;
  - kept in SSM Parameter Store as `/jobdeputy/<stack>/crawl-limits`, for example `/jobdeputy/jobdeputy-dev-iad/crawl-limits`.
- **User:**
  - their own limit, up to the maximum (`PUT /me/crawl-settings`).
  - The limit applied is `min(own limit or default, maximum)`, so lowering the maximum always wins.

Users see all of it in `GET /me/crawl-settings`: the limit that applies, the default, the maximum, today's use, and the reset time.

## Change the limits (no deploy)

```sh
aws ssm put-parameter --overwrite \
  --name /jobdeputy/jobdeputy-dev-iad/crawl-limits \
  --value '{"dailyDefault":20,"dailyMax":50,"maxActive":1,"platformRunsPerWeek":1,"platformRunsPerMonth":4}' \
  --profile jobdeputy-dev-iad
```

- **Rules:** the daily values are whole numbers from 1 to 1000, and the default can't be above the maximum. `maxActive` is 1 to 20 (default 1 if left out; raise it when users need to submit several pages at once). Past it, a submit gets 429 `too-many-active-crawls` with `Retry-After: 30`.
  - An invalid value is ignored: the API uses the built-in defaults (20 and 50) and logs an error (`Invalid crawl limits setting`).
- **When it takes effect:** within 5 minutes (the API's cache). Nothing needs restarting.
- **Check it:** sign in and call `GET /me/crawl-settings`. `defaultLimit` and `maxAllowed` show the new values.

- **Free platform AI runs** (T08b3, [0009](../decisions/0009-llm-architecture-and-own-keys.md)): `platformRunsPerWeek` (0 to 100, default 1) and `platformRunsPerMonth` (0 to 400, default 4) per user. A run is one crawl's AI work with the platform model, counted when it is submitted (ISO weeks from Monday 00:00 UTC; calendar months). Past either, a platform crawl gets 429 `platform-ai-limit-reached`; the user can use their own key or `aiSource: none`. If left out, the defaults apply. Set 0 to stop free AI runs (for example if the platform model costs too much).

## Notes

- The value in `infra/lib/cell-stack.ts` is only the initial one. CloudFormation leaves the parameter alone on later deploys, unless that value in the code changes; then the deploy resets it. To change the limits permanently for every new cell, change the code as well.
- Crawls already started today still count. A lower limit takes effect from the next submit, so a user who has already passed it simply can't start more today.
- Limits for one specific user, set by an admin, are not supported yet (they need an admin screen).
- **Dev:** the integration tests start about 10 crawls with one test user, so keep the dev daily default at 10 or more. Otherwise the Nightly run fails with 429. The tests read `maxActive` and submit in batches, so any value works for it.
