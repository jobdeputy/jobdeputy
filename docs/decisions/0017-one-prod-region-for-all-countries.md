# 0017: One prod Region serves every country (for now)

- **Status:** Accepted
- **Date:** 2026-11-26
- **Task:** long-run job discovery discussion (supersedes [0004](0004-regional-cells-and-data-residency.md))

## Context

[0004](0004-regional-cells-and-data-residency.md) planned one self-contained prod cell per country: `iad` (US), `bom` (India) and `lhr` (UK). Each user would have a fixed home Region, and no data would cross Regions. That decision was "legal and trust hygiene", taken to avoid migrating users later. It was not taken because a law required it.

The plan to keep scheduled, shared job data (a job catalog that every user reads) raised the question again: one catalog per country, or one catalog for every country? That depends on how many prod Regions we run. So we checked whether US, UK or Indian law requires a job-search app's user data (profile, résumés, jobs) to stay in the user's country. As of 2026-11-26, none does:

| Country | Residency required? | Notes |
|---|---|---|
| US | No | No federal residency law. State privacy laws (CCPA and others) regulate use, not location. |
| UK | No | UK GDPR allows transfers abroad. The UK–US data bridge (since October 2023) covers certified US providers, AWS among them. The Data (Use and Access) Act 2025, whose transfer provisions apply from February 2026, eased the transfer test ("not materially lower" protection). The risk: the bridge depends on the EU–US Data Privacy Framework, which faces court challenges. If it falls, the fallback is contract safeguards (the IDTA or the UK Addendum), not moving data. |
| India | No (today) | The DPDP Act 2023 and its Rules (notified 2025-11-13) use a negative list: transfers abroad are allowed unless the government restricts a country. No country is listed, and the transfer rules are expected to apply from about May 2027. Stricter rules apply only to Significant Data Fiduciaries and to sectors such as payments (RBI) and health. |

This is our reading, not legal advice. It is checked with a lawyer before UK or Indian users are let in.

## Options considered

1. **Keep 0004: three prod cells.** Each country's data stays in that country. But every deploy, alarm, budget, account and security setup is done three times. Login needs a Region picker. Shared data (such as a job catalog) has to be built once per cell. And no law asks for any of this today.
2. **One prod Region (`us-east-1`) for every country.** One deployment to run and watch, and one shared job catalog. The costs: India and the UK see about 100–250 ms more latency per request, and if a law or customer later demands residency, existing users have to be migrated.

## Decision

1. **Prod runs in one Region, `us-east-1` (`jobdeputy-prod-iad`), and serves US, UK and Indian users.** Dev stays in `us-east-1`, as before. `jobdeputy-prod-bom` and `jobdeputy-prod-lhr` are not created at launch.
2. **The cell code stays.** The CDK cell loop, Region guards and per-cell tests are kept, so adding `bom` or `lhr` later is configuration plus a user migration, not a redesign. The no-cross-Region rules from 0004 still apply between any cells that exist: no global tables, no cross-Region replication, references or backup copies.
3. **Each user has a `country`** (chosen at signup, changeable). It drives job filters and which privacy notice applies. It is not a Region: every user's data lives in `us-east-1`.
4. **Shared job data is one store with a country field**, not one store per country (the job catalog's own design comes in its own decision).
5. **We add a Region only on a trigger:**
   - India restricts transfers to the US, or JobDeputy becomes a Significant Data Fiduciary;
   - a business customer (an employer, a university) requires residency;
   - the UK–US data bridge falls and contract safeguards are not enough;
   - scale, or latency complaints, in a country.

   Adding one needs a new decision, plus an export, move and delete tool for existing users of that country.
6. **Before UK or Indian users are let in:**
   - a privacy notice that says data is stored in the US;
   - for the UK: a UK representative (UK GDPR Article 27) while JobDeputy has no UK office;
   - for India: the DPDP consent notice and a grievance contact;
   - a breach-notification process that meets all three countries' deadlines;
   - premium payments from India go through a payment provider that handles RBI's payment-data localization;
   - a lawyer's review of the above.
7. Unchanged from 0004: global AWS services hold no user data (CloudFront serves static assets only), and a user's own AI key sends their data to their chosen provider, as disclosed.

## Why

No law in our three launch countries requires residency today. Running three prod cells would multiply operations work for a solo-run project and split every piece of shared data three ways, to meet a requirement that does not exist yet. Keeping the cell code makes the decision cheap to reverse.

## Consequences

- One deploy, one set of alarms and one budget for prod. Login needs no Region picker, because every account lives in `us-east-1`.
- Users in India and the UK see higher latency. Static assets come from CloudFront edges; crawls, scoring and tailoring run in the background, so most waits do not change.
- If we later add a Region, moving existing users there is real work. The triggers above say when.
- Docs, tests and copy that say "home Region" still hold (the home Region is `us-east-1` for everyone) and are updated as they are next touched. The prod cells defined in infra (`bom`, `lhr`) and the guardrail script stay until prod is created, when only `prod-iad` is deployed.
- Revisit when any trigger in Decision 5 fires, and before India's DPDP transfer rules take effect (about May 2027).
