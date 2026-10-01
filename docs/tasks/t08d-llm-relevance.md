# T08d: LLM relevance scoring

- **Status:** done (T08d1, T08d2, T08d3)
- **Depends on:** T08b, T08c
- **Branch / PR:** T08d1 `t08d1-queue-health` ([#59](https://github.com/jobdeputy/jobdeputy/pull/59)); T08d2 `t08d2-relevance-scoring` ([#60](https://github.com/jobdeputy/jobdeputy/pull/60)); T08d3 `t08d3-descriptions`

## Goal

Candidate jobs get a score and a short reason from an LLM, in their own queue and worker.

## Scope

- In:
  - The `relevance` task in `packages/llm`, and a relevance queue and worker fed by crawls with candidates.
  - Descriptions fetched for candidates only through the board's single-posting endpoint; a posting that answers 404 or 410 closes the job ([T08 carried over](t08-relevance-filter.md#carried-over-from-t07)).
  - The per-company limit re-ranked by score: T08c's `applyCompanyLimit` with the score as the rank, through the same `usage` `COMPANY#` item (replace at the version read), then `limitState` and `ttl` on each job as T08c sets them.
  - Candidates only (`filter.state = candidate`); T08c's `filter.roleIds` and `reasons` go into the prompt as hints, never as the answer.
  - The run uses the user's choice (platform or their own key) and counts against the allowance ([0009](../decisions/0009-llm-architecture-and-own-keys.md)).
  - The prompt-injection rules of [0010](../decisions/0010-platform-ai-model.md): exactly the given job IDs back, once each, and injection cases in the tests.
  - **Alarms:** after T08b2, shared dev uses all 10 free CloudWatch alarms (12 with T08b3's two paid LLM alarms). A new queue must not add a paid alarm ([0005](../decisions/0005-pre-launch-cost-guardrails.md)); see the decision below (T08d1).
  - **Use T08b3's parts:** `aiUsageUpdate` in the transaction that stores each result (so a retry never counts twice, `runs: 1` on the run's first call), `recordTaskMetrics` after each task call (with `groundingRejections` and `scoreSpread`), `llmMetricsEnvironment(stage)` on the worker, and the crawl's `llm {keySource, provider, model, calls, inputTokens, outputTokens}`. A platform run was already counted at submit (`crawls.aiRun`).
  - A crawl's `aiSource` (T08b2) picks the model. If its key is missing or invalid, the AI work stops with that reason; it never falls back to the platform model silently.
- Out: ranking for application materials (later).

## Decision (agreed with the maintainer, 2026-10-01)

1. **Three PRs:**
   - **T08d1, queue health check:** merging alarms with metric math does not save money: a metric-math alarm is billed per metric in its expression, a Metrics Insights alarm per metric it reads (never in the free tier), and a composite alarm costs $0.50 a month ([CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/), checked 2026-10-01). Instead, one scheduled Lambda (every 5 minutes, free tier) reads every worker queue's waiting and dead-letter counts (free SQS attributes) and emails the alarm topic when a queue's health changes. It replaces the 8 queue alarms (dev: 12 alarms → 5, all free), new queues add nothing, and its own errors keep one alarm. A backlog is "messages waiting without a break past the queue's limit": the age of the oldest message is only a CloudWatch metric, and reading it costs money.
   - **T08d2, scoring:** the relevance queue and worker, the `relevance` task, ranking by score, usage.
   - **T08d3, descriptions:** fetched for candidates only through the board's single-posting endpoint; 404 or 410 closes the job.
2. **How a run starts:** a second Pipe on the crawls stream passes crawls that end `succeeded` with `aiSource` not `none` and `jobsRelevant > 0`. No new table; one run is one crawl (the allowance counted at submit).
3. **Fixed worst case per crawl:** at most **50 candidates** (admin setting; shown ones first), in batches of **10 jobs per task call**. Each job: title, company, places, type, and the first 1,500 characters of its description. Updated in T08d2: the eval showed the platform model sometimes stops early in a batch (after a job carrying an injection attempt, it skipped the jobs before it too), so jobs left out are sent once more in **one follow-up call**: at most **6 task calls × 3 turns = 18 model calls** (was 5 and 15). The crawl stores its call count, so retries never go past 6.
4. **Profile sent to the model:** roles, search settings, headline, skills, and the first ~6,000 characters of the default résumé's text. With the user's own key the résumé goes to that provider, so the consent text shown when the key is saved must say so.
5. **Skip unchanged jobs:** each score is stored with a hash of its inputs (job `contentHash` and `descriptionHash`, the profile and roles, and the prompt version); a re-crawl scores only jobs whose hash changed.
6. **Output:** `relevance {score 0–100, bestRoleId?, reasons (at most 3 short ones), model, promptVersion, inputsHash, scoredAt}`. Code checks exactly the given job IDs come back, once each, and that `bestRoleId` is one of the user's roles ([0010](../decisions/0010-platform-ai-model.md)).
7. **The score decides:** the per-company ranking uses it, and a score **below 30** (admin setting) hides the job as `not_relevant` (reason `llm_low_score`), expiring like other hidden jobs. Jobs not scored (over the cap, or the run failed) keep their T08c verdict.

## T08d2 notes (found while building)

- **How a run starts and stays single:** the crawl worker writes the ranked `candidates` with the finished crawl; the relevance Pipe passes `MODIFY` events of succeeded crawls with an AI source, `jobsRelevant` > 0, and no `relevance` yet. The worker's first write adds `relevance`, so its own writes never start another run.
- **Stream replay:** a new Pipe reads the crawls stream from its start (24 hours). The worker skips crawls that finished more than 30 minutes ago without a run, so the first deploy does not score old crawls.
- **One transaction per task call:** the crawl's progress (`calls`, `sent`, `llm`), the `AI#` tokens, and the scores. A retried message never sends a job again and never counts tokens twice; a provider error is retried by the queue, and the last attempt ends the run (`model_unavailable`). An own key the provider rejects ends it at once (`key_rejected`).
- **A re-crawl and stored scores:** each crawl runs the keyword filter first, so a job hidden by a low score is briefly shown again until the scoring run reapplies its stored score (seconds; no model call while its inputs are unchanged). A crawl with `aiSource` `none` shows the keyword verdict only.
- **Ranking:** scored jobs rank before unscored ones (by score), then by role priority and date (`compareRank`).
- **Integration tests never call a model:** the dev-only `stub` provider answers relevance by a fixed rule (`relevance-stub.ts`), and the account-deletion test crawls with `none`, since Nightly runs the suite on shared dev.
- **Eval:** `relevance@v1` cases are the smoke eval's synthetic people and jobs with roles, search settings, and résumé text; the eval runs them through `scoreRelevance` like the worker. Baseline on the platform model: 22/22 labels, 4/4 injections resisted, every output valid on the first try.
- **Consent:** saving an own key now says the profile and résumé text go to the provider too.

## T08d3 notes (agreed 2026-10-01)

- **Where:** the crawl worker, which already fetches with the address checks, robots.txt, and the host gap. The relevance worker, which holds users' keys, stays off the open web, and crawls without AI get descriptions too.
- **Which jobs:** the top `relevanceMaxJobs` candidates (the same ones a scoring run takes) whose list entry has no description and whose stored job has none (one `BatchGetItem` projecting `descriptionHash`). Greenhouse by `externalId`; Workday by the path in the job's link; Lever and Ashby lists already carry descriptions.
- **Limits (`DESCRIPTION_LIMITS`):** at most 50 postings, one host gap (1 s) apart, while 30 s of the Lambda's time stays for saving and finishing. What is not read waits for the next crawl; nothing here fails the crawl or makes it partial.
- **Answers:** a description is saved with the job (its `descriptionHash` changes the job's relevance inputs); 404 or 410 closes the job after the save, frees its place in the company's shown list, and leaves it out of `candidates`; a 403 or 429 stops the reading; other failures leave the job without a description. Counted in `stats.descriptions`.
- **Known limits:** a board that still lists a gone posting opens the job again on the next crawl, which reads it and closes it again (one request). A description is not read again when it changes, the keyword filter does not re-run on it, and the Workday posting's fuller places stay unused.
- **Tests:** unit tests only. Boards are recognised by their real hosts, so a deployed test would call Greenhouse or Workday itself.

## Done when

- [x] Relevance is tested with synthetic profiles and jobs and a stub model, including edge cases (T08d2).
- [x] Each stored job shows why it matched (`relevance.reasons`, `GET /me/jobs`; T08d2).
- [x] A fixed worst-case number of calls per crawl, stated in the PR (6 task calls, 18 model calls; T08d2).
- [x] T08d1: every worker queue is watched by the queue health check, and shared dev stays within the 10 free alarms.
- [x] T08d3: candidates without a description get one from their posting, within fixed limits; a gone posting closes the job.
