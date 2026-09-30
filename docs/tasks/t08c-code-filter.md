# T08c: Code filter, per-company limit, and expiry

- **Status:** in-review
- **Depends on:** T07 ([T08 direction](t08-relevance-filter.md#agreed-direction-2026-09-29-before-research))
- **Branch / PR:** `t08c-code-filter`

## Goal

Every crawled job is marked `candidate` or `not_relevant` for free, at most 10 per company are shown, and useless jobs expire.

## Scope

- In:
  - A code filter in the crawl: title against the target roles, place, workplace, and job type.
  - The per-company limit: default and maximum 10 set by the admin, the user's own limit up to it, like the crawl limits; the rest `over_limit`. Includes [#40](https://github.com/jobdeputy/jobdeputy/issues/40) as far as the limit needs it.
  - DynamoDB time to live, 7 days (configurable), as in the [T08 table](t08-relevance-filter.md).
- Out: LLM scoring ([T08d](t08d-llm-relevance.md)).

## Decision (agreed with the maintainer, 2026-09-30)

1. **The code filter is lenient:** what a job does not say (no place, level, workplace, or type) never drops it; the LLM (T08d) judges candidates. A job is dropped only on evidence:
   - **Title:** every main word of a role's title (or one of its other titles) is in the job title, after normalizing case, accents, abbreviations, and word forms (`Sr.` = senior, `dev` = developer = engineer, `back-end` = backend). Level words are ignored for the match.
   - **Level:** read from the job title (intern, junior, senior, staff, lead, principal, manager, head, director, chief); dropped only if found and not one the role (else the search settings) wants. Words of the role's own title never count ("Product Manager" is not a manager level).
   - **Place:** one of the role's places (else the search places): same country, and same city if given. A remote job needs only the country. Countries are also read from text (names, `Remote - US`, US state and Canadian province codes).
   - **Workplace, job type:** only when the job states them. **Salary:** dropped only if its top is below the minimum in the same currency (per year).
   - **Excluded words** (search and role): title only; the description is the LLM's job ("no Java needed").
   - **Must-have skills:** not checked by code (descriptions are often missing); the LLM checks them.
2. **No active roles:** the profile's headline (its first part) is matched as a title, and a profile skill in the title also counts. With no headline, skills only add a reason (`skill_in_title`) and nothing is dropped for lacking one; with nothing at all, every job is `candidate` with `no_target_roles`. The search settings still apply. Matching the résumé itself is the LLM's job (T08d).
3. **Per-company limit is a snapshot**, not a count over time: at most N shown per `companyKey` right now, ranked again on every crawl (role priority, then newest; T08d: by score). Kept in `usage` `COMPANY#<companyKey>`, replaced at the version read (exact with two crawls at once). Admin `companyJobsDefault`/`companyJobsMax` (10/10) in the crawl-limits parameter; the user's `companyJobsLimit` in `PUT /me/crawl-settings`. [#40](https://github.com/jobdeputy/jobdeputy/issues/40)'s tables stay deferred: the limit needs only `companyKey`.
4. **Expiry:** DynamoDB time to live on `jobs`, `jobExpiryDays` (default 7) in the crawl-limits parameter. Set when a job is hidden (`not_relevant`, `over_limit`), kept from when it was first hidden; set when a job closes untouched; removed when shown again; never for a job the user acted on.
5. **Re-filtering** happens on each crawl, for every job it reads. Re-filtering stored jobs right after a role or search change is a follow-up ([#57](https://github.com/jobdeputy/jobdeputy/issues/57)).
6. **`GET /me/jobs`** lists shown jobs by default, `view=all` lists hidden ones too; each job has `fit {state, roleIds, reasons, limitState}`, `hidden`, and `expiresAt`.

## Done when

- [x] The filter is tested with synthetic profiles and jobs, including edge cases (`apps/worker/test/relevance-code-filter.test.ts`).
- [x] Each job shows why it was kept or dropped (`fit.reasons`, `GET /me/jobs?view=all`).
