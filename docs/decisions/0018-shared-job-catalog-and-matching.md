# 0018: A shared job catalog, scheduled visits, and matching

- **Status:** Accepted (design; it is built in its own milestone)
- **Date:** 2026-11-26
- **Task:** long-run job discovery discussion (milestone issue to follow)
- **Amends:** [0006](0006-data-model.md) (new tables `companies` and `catalog-jobs`; the `jobs` table keeps the user's own state), [0009](0009-llm-architecture-and-own-keys.md) (AI choices by tier), [0016](0016-applications-are-job-stages.md) (Matches' 30-day window counts from when a job was first seen)
- **Builds on:** [0017](0017-one-prod-region-for-all-countries.md) (one prod Region, so one catalog)

## Context

Today every job is found because a user pasted a link (or a list), and it is stored **per user**: every table is keyed by `userId` first ([crawl flow](../flows/crawl.md)). So:

- a user waits minutes for a crawl, even when another user crawled the same company an hour earlier;
- 50 users who follow one company crawl it 50 times and store its jobs 50 times;
- users only see companies they already know, and nothing tells them a new job just appeared.

Timing matters to job seekers. About 39–41% of applications arrive in a posting's first 48 hours and 54–56% in its first 4 days (St. Louis Fed and Chicago Booth, about 66–80 million applications). Filling a role takes about 40–60 days (50–75 for tech), so a 15-day-old job is usually still open, but its shortlist is forming.

## Options considered

1. **Keep "users bring links".** Simple, and costs nothing while idle. But it is slow for the user, crawls the same company again for every user, finds nothing new by itself, and cannot send alerts.
2. **A shared catalog, visited on a schedule, matched to each user.** Results come at once, each company is crawled once for everyone, new companies are discovered, and alerts become possible. The catalog needs a company list and a scheduler, and it costs a little even with no users (under $1 a month of storage at launch scale).
3. **One catalog per country.** It would follow [0004](0004-regional-cells-and-data-residency.md), but [0017](0017-one-prod-region-for-all-countries.md) replaced that with one prod Region. Job postings are public, not personal data.

We chose 2, with one global catalog. User links stay: they add companies to the catalog.

## Decision

### 1. One shared catalog

- **One global catalog** in the prod Region. Every job carries its countries, so one store serves every country.
- **Only public boards on supported hiring systems** go in. Any other link a user pastes (a referral page, a link with tracking tokens, a page we cannot read as a board) stays private to that user, in today's per-user flow.
- **No user IDs in the catalog.** Who added a company stays in that user's `sources` item. The catalog holds no personal data, so account deletion does not touch it.

| Store | Key | Holds |
|---|---|---|
| `companies` | `companyKey` (the board's identity, as `boardKey` builds it today, e.g. `greenhouse:stripe`) | Name, board type, board ID, board URL; status (`ok`, `failing`, `removed`); `lastFullCrawlAt`; `nextVisitAt`; failure count; open job count; the company it belongs to, when one company has several boards |
| `catalog-jobs` | `companyKey`, `jobId` | A small summary (about 1 KB): title, team, job and apply URLs, `locations` (`country`, `city`), `countries`, remote type (`onsite`, `hybrid`, `remote`) and `remoteCountries`, `postedAt` when the board gives a trustworthy one, `firstSeenAt`, `contentHash`, `closedAt`, `expiresAt`, and the job it reposts (section 4) |
| S3 `catalog/descriptions/<companyKey>/<jobId>` | | The full description as cleaned text (about 5–15 KB), read only when a user opens the job or the AI scores it |
| S3 `catalog/archive/` | | Summaries of expired jobs, for statistics such as how long jobs stay open |
| `jobs` (per user, existing) | `userId`, `jobId` | The user's own state: stage, score, verdict, and a small copy (title, company, location, URL) taken when the job enters their Matches, so Applications still shows it after the catalog job expires |

`jobId` keeps today's rule (`ats:<companyKey>:<postingId>` first), so existing jobs keep their IDs.

### 2. What a visit writes

A visit to one company:

1. Reads the board, then reads the company's open jobs from `catalog-jobs` (one query).
2. Writes only what changed:
   - a **new** job gets its summary, its description, and `firstSeenAt`;
   - a job **listed again with the same `contentHash` is not written**;
   - a job whose content changed is rewritten;
   - a closed job that is listed again is reopened.
3. After a **complete** visit, an open job the board no longer lists gets `closedAt`, and `expiresAt` 14 days later. A partial visit (a limit was hit, a page failed) closes nothing, as today ([T07c](../flows/crawl.md)).
4. Updates the company: `lastFullCrawlAt` is the "last seen" time of all its open jobs, so open jobs are never rewritten just to say they are still there.

**Why:** DynamoDB bills a write by the size of the whole item. Touching all 200,000 jobs on every visit, descriptions included, would cost about $37 a month at one visit a day ($0.625 per million write units) and about $150 at four. Writing only new, changed, and closed jobs costs cents.

**Expiry:** DynamoDB's time to live deletes a job at `expiresAt`. The deletion goes to the archive in S3, and the description is removed. A company that has failed, or has been gone, for 30 days has all its jobs closed.

### 3. Sources and visits

- **Boards:** the four we read today: Greenhouse, Lever, Ashby, and Workday. SmartRecruiters stays out, because its `robots.txt` forbids its API to us ([`boards.ts`](../../apps/worker/src/jobs/boards.ts)). LinkedIn and Indeed are never read: their terms forbid it.
- **Where companies come from:** the boards users paste, and the GitHub lists ([#50](https://github.com/jobdeputy/jobdeputy/issues/50)). A list only names companies. We read each company's own board.
- **Size:** start with about 500 companies (the top of the lists, plus every board a user pastes), and grow as users add more and as cost allows.
- **Countries:** keep every job a board lists, tagged with its countries. Users see jobs in their own country and remote jobs open to it. When the UK and India open, their jobs are already in the catalog.
- **When we visit:**

  | Day | Visits (US Eastern) | Why |
  |---|---|---|
  | Monday–Friday | about 3 PM and about 2 AM | Jobs are posted mostly between 8 AM and 6 PM on weekdays, peaking at 11 AM and again at 3–5 PM local time. 3 PM ET catches the morning peak on both coasts the same day, and 2 AM catches the rest. |
  | Saturday, Sunday | about 2 AM | Only about 9% of jobs are posted at weekends. |

  This timing data is from 2015–2017 and from one hiring system (SmartRecruiters). Lever and Ashby give each job's exact posting time, so after a month we chart our own and move the visit times to match.
- **A user pastes a board that is already in the catalog:** they see the catalog at once if we visited it in the last 12 hours. Otherwise we visit now, and the board joins the schedule.
- **Unhealthy boards:**
  - a board that fails 7 visits in a row is marked `failing` and visited weekly;
  - after 30 days it is `removed`, and its jobs close;
  - a board with no open jobs for 60 days is visited weekly.
- **Politeness:** the crawler's rules ([0007](0007-crawler.md)) apply: at most 3 visits at once, never two at once to the same host, and each board's own limits.

### 4. Duplicates

| Case | Handling |
|---|---|
| The same job on the next visit | The same `jobId` (the board's own posting ID), so the same item. Nothing is written unless it changed. |
| The same board pasted by many users, or named by a list | One `companies` item, visited once for everyone. |
| One company with several boards (for example Workday for corporate jobs and Greenhouse for engineering jobs) | Both boards point at one company. It shows once, and the jobs-per-company limit ([0013](0013-apply-flow-rules.md)) counts both. |
| A repost: closed, then posted again with a new ID | The same company, cleaned title, location, and a matching description within 60 days means the same job. The new item points at the old one and keeps its `firstSeenAt`, so it is not "New" again, and it is tagged "Reposted". A job the user already applied to is never shown again as a new match. |
| One role in several locations, posted separately with the same text | Separate items in the catalog. The user sees one row with "N locations". |

### 5. Job age

| Age (from `postedAt`, or else `firstSeenAt`) | Shown as |
|---|---|
| 0–3 days | "New" at the top; included in alerts |
| 4–14 days | normal |
| 15–30 days | lower, tagged "Older" |
| over 30 days, or closed | hidden |

After a few months we measure how long jobs really stay open (`firstSeenAt` to `closedAt`) and tune these numbers.

### 6. Matching

After each visit, and for one user:

1. **Filter** (free): the user's country, or remote jobs open to it; first seen in the last 30 days and still open; not already in their Matches or Applications; not at a company in its cooldown ([0013](0013-apply-flow-rules.md)). This leaves about 20,000 jobs in the US.
2. **Quick rank** (free, no AI): titles and skills against the user's target roles and résumé. Word matching at launch, as today. Meaning matching (embeddings, about $3 a month for every new job) comes later, if word matching misses jobs.
3. **AI fit score** on the best ~50: Strong, Good, or Stretch, and why it fits. This is today's relevance run.
4. **Show:** Matches, best fit first, with the age tags above.

Steps 1 and 2 need no search service. After each visit we write **one compressed snapshot per country** to S3 (every open job's summary; about 1.5 MB for 20,000 US jobs). Matching loads it and filters in memory in under a second. A hosted search service such as OpenSearch costs about $350 a month even when idle, which [0005](0005-pre-launch-cost-guardrails.md) does not allow.

### 7. Free and premium

| | Free | Premium ([#74](https://github.com/jobdeputy/jobdeputy/issues/74)) |
|---|---|---|
| Jobs | The same shared catalog | The same shared catalog |
| Matching | When the user clicks **Find matches**, a limited number of times a day | Automatic after each visit, **incremental** (only jobs new since the last run) |
| AI | Their own key: they choose the provider, the model, and the effort level where the model has one. Without a key: steps 1–2 only, and jobs show "Not scored yet" (today's keyword-only fallback) | A default platform model and effort. Automatic runs have their own budget of **at most 30 new jobs scored a day**, separate from the manual allowance. Past the limits, their own key |
| Alerts | None | One email a day, about 8 AM in the user's time zone, only when there are new Strong or Good matches |

- **Own keys and automatic runs:** an automatic run uses the user's own key only if the user opted in ("keep matching with my key"). [0009](0009-llm-architecture-and-own-keys.md) does not let a user's key spend tokens in the background unless they asked for it.
- **Profile changes:** when the résumé or target roles change, old scores are marked "Profile changed". They are scored again when the user clicks, or on the next automatic run within its budget. We never score everything again without asking.

### 8. Tailoring stays on demand

This is unchanged from [0013](0013-apply-flow-rules.md) and [0015](0015-ats-match-score-and-tailored-resumes.md), and restated here because the catalog makes tailoring everything tempting:

- A résumé is tailored only when the user asks: **Tailor résumé** in the job pane, or offered (and skippable) when they choose **Manual apply**.
- One tailored résumé per company. A cover letter only on request.
- The job pane shows the match's fit before tailoring, so the user can judge whether it is worth a run.
- With automatic applying ([#54](https://github.com/jobdeputy/jobdeputy/issues/54)), tailoring happens just before each approved application. A match nobody applies to is never tailored.

## Why

- Every user reads one catalog, so each company is crawled once, results come at once, and new jobs can be found and announced.
- Because a write is billed by item size, storing "still listed" on the company and writing only changes keeps storage and writes under $1 a month at launch scale (5,000 companies, 200,000 open jobs).
- The visit times follow the evidence that most jobs are posted on weekday mornings and afternoons, and that the first days decide most applications.
- Matching from a snapshot keeps it fast without paying for an idle search service. Incremental premium runs keep automatic AI scoring small.
- Premium buys speed and automation, not different data. The free tier gets the same fresh jobs.

## Consequences

- **New stores.** `companies`, `catalog-jobs`, and the S3 descriptions and archive. They are not keyed by `userId`, so they are not on the account deletion list. [data-model.md](../data-model.md) and the flows are updated when this is built.
- **A migration.** Today's per-user `jobs` items hold the posting itself. The posting moves into the catalog, and each user keeps only their own state and the small copy.
- **New infrastructure.** A scheduled planner (EventBridge Scheduler) that queues due companies; the existing crawl worker writes to the catalog; a snapshot writer after each visit; a matching worker; and the alert email.
- **Matches' window** moves from "last seen in 30 days" ([0016](0016-applications-are-job-stages.md)) to "first seen in 30 days and still open".
- **Revisit:**
  - the visit times, from our own posting-time data, after a month;
  - the age thresholds, from measured job lifetimes;
  - word against meaning matching, from match quality;
  - premium visits more often than twice a day, if alerts need it.

## Still open

- **A small free trial on the platform model.** Should free users get a few AI-scored runs before they need their own key? Most new users have no key, and a hard wall at signup may lose them.
