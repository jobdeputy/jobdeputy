# T08e: Research how well prompts and models work on live data

- **Status:** done (research; build in [#65](https://github.com/jobdeputy/jobdeputy/issues/65), [#66](https://github.com/jobdeputy/jobdeputy/issues/66))
- **Depends on:** T08b
- **Branch / PR:** `t08e-research` ([#67](https://github.com/jobdeputy/jobdeputy/pull/67)); T08e1 `t08e1-llm-report`

## Goal

We know how to measure, on real runs, whether our prompts and models give good results, and what to do when they don't. The research findings go to the maintainer, and we agree what to build before anything is built.

## Scope

- In: research and a proposal. Questions to answer:
  - **Signals.**
    - Which signals show quality on live runs, and what each one costs.
    - Candidates agreed so far:
      1. health per run: schema failures, grounding rejections, partial results, timeouts, tokens, latency, score spread;
      2. what users do with each scored job (open, save, apply, dismiss), which gives the hit rate on top scores, false alarms, and misses, per model and prompt version (T09);
      3. 👍/👎 on a score, and "not a job" (T09);
      4. a daily 2% sample scored again by a second in-Region model (for example gpt-oss-120b), and how often the two agree;
      5. extraction compared with the feed or schema.org when both exist.
  - **Residency and privacy.** What we can measure while keeping user data aggregated and non-personal ([0004](../decisions/0004-regional-cells-and-data-residency.md)), with no hosted LLM observability.
  - **Thresholds.** When a signal counts as a regression, and which alarms to set.
  - **Rollout.** Canary rollout of a prompt or model change (for example to 10% of runs), and how to compare the two versions.
  - **Feedback loop.** How live findings feed the golden set and the eval baseline of T08b.
  - **Costs.** The cost of each option at 1,000 users.
- Out: building anything. That comes as follow-up tasks once the findings are agreed.

## Research

- **Live data so far (shared dev, 14 days to 2026-10-01):** 3 relevance calls on the platform model (`relevance@v1`), all valid: about 750 input and 130 output tokens per call, 1.2 s median. Too few to set limits from, so the limits below are start values, tuned with real runs.
- **Metric cost:** CloudWatch bills each metric name for each combination of dimension values (about $0.30 a month each, list price). Each task call records 9 measures, and own keys allow any model, so the split by model, prompt version, and key source (T08b3's prod detail) has no bound. At 1,000 users: about 100 metrics per cell, about $80 a month for three cells, against about $40 for the model. As totals and per task: about 27 per cell, about $15 a month. Every field is already in the log line, which Logs Insights reads for cents.
- **Signals:**

  | Signal | Shows | Cost at 1,000 users | Verdict |
  |---|---|---|---|
  | Health per run (T08b3), plus the share hidden by a low score | broken or partial runs, a model too harsh or too lenient | about $0 | keep; add the share |
  | User actions on scored jobs (open, save, apply, dismiss) | hit rate of top scores, false alarms, misses | about $0 | T09: one log line per action, no user ID |
  | 👍/👎 on a score, "not a job" | a direct verdict | about $0 | T09, as above |
  | A second in-Region model rescores a sample | agreement without needing users | about $1.30 a month at 2% | yes, platform runs only |
  | Extraction against the feed or schema.org | extraction accuracy | about $0 | with T07d ([#41](https://github.com/jobdeputy/jobdeputy/issues/41)) |

- **Residency and privacy ([0004](../decisions/0004-regional-cells-and-data-residency.md)):** every signal is a count or a comparison in the cell's own logs, without user or job IDs, and no hosted LLM observability. Profiles are personal and never leave the cell, so they never go into the repo's golden set; job postings are public.
- **Few users:** a percentage of a small number gives almost no runs, so each sample is an admin setting, at 100% on shared dev (cents).

## Decision (agreed with the maintainer, 2026-10-01)

1. **Metrics as totals ([#65](https://github.com/jobdeputy/jobdeputy/issues/65)):** CloudWatch metrics only as totals and per task, in every stage; the split by model, prompt version, and key source is read from the log lines. Own-key models are logged as `own:<provider>`. Log retention stays 14 days; nothing is kept longer (accepted: no comparison older than 14 days, and a problem limited to one model or version shows within a day, while the hourly alarms on totals still catch a broad failure).
2. **Daily LLM report ([#65](https://github.com/jobdeputy/jobdeputy/issues/65)):** one scheduled Lambda per cell reads the last day's log lines per task, prompt version, and model, and emails only when a limit is crossed. Groups with fewer than 20 task calls are skipped. No new paid alarm; the 2 hourly alarms stay. Start limits:

   | Measure | A problem when |
   |---|---|
   | Rejected outputs | above 5% of model calls |
   | Partial results | above 5% |
   | Timeouts | above 1% |
   | Grounding rejections | above 2% of jobs |
   | Latency p95 | above 2× the eval baseline |
   | Median score spread | below 20 |
   | Share hidden by a low score | outside 10–80% |
   | Agreement with the second model | below 80% on the side of the hide threshold |

3. **Rescoring sample and rollout ([#66](https://github.com/jobdeputy/jobdeputy/issues/66)):** one mechanism, "rescore a sample with another model or prompt and log how they compare", on platform runs only, never counted against the user's allowance:

   | Admin setting | What | Shared dev | Launch |
   |---|---|---|---|
   | `llmSecondModelSample` | runs also scored by `openai.gpt-oss-120b-1:0`, always on | 100% | 2% |
   | `llmShadowSample` | runs also scored by a new prompt or model under test; its scores are not kept | 100% | 5% |
   | `llmCanaryUsers` | users who get the new version, by a stable hash of the user, for a week; then 50%, then everyone | 100% | 10% |

   A canary is promoted when the limits hold and, after T09, user actions are no worse. The cost guardrails allow gpt-oss-120b for this (amends [0010](../decisions/0010-platform-ai-model.md); agreed).
4. **User signals (T09):** an action on a scored job, 👍/👎, and "not a job" each write one log line (action, score range, prompt version, model; no user ID), read weekly.
5. **Golden set:** a crossed limit, a 👎, or a disagreement in the sample is reviewed by the maintainer inside the cell; the case added to the eval is the real public job (names and contact details removed) with a made-up profile that repeats the problem, and the baseline is recorded again. #62 was found this way.
6. **Costs at 1,000 users, three cells:** metrics about $15 a month, second-model sample about $1.30, shadow sample about $0.30 while a test runs, report Lambda and log queries in the free tier or cents.

## T08e1 notes (built 2026-10-01)

- **Metric count per cell:** 9 measures × (1 total + 1 per task) = **18 metrics** with relevance as the only live task (about $5.40 a month at list price); each new task adds 9. `LLM_METRICS_DETAIL` is gone.
- **Log-only fields:** `Jobs` (jobs sent in the call) and `LowScoreJobs` (scored below `relevanceMinScore`) are in the line, not metrics: the daily report reads them, and they need no hourly alarm. Making either a metric is a one-line change in `metrics.ts`.
- **Revisit metrics** about a month after launch (agreed 2026-10-01): if trends per model or prompt version over months are wanted, add that split as metrics in prod only. Until then the line keeps it for 14 days.
- **The report:** `LlmMonitoringReport`, daily at 03:30 UTC, shared stacks only. LLM workers register with `LlmMonitoring.watch` (its log group goes to the report and a dashboard table). Latency is judged against the eval baseline's median for the same prompt version and model (baselines read at synth), platform model only; another provider's speed is not ours to fix. The `stub` model is never judged. One more alarm on its own errors: shared dev has 6 of the 10 free alarms.
- **Blind-report guard:** jobs scored (the worker's "Scoring ended" lines) with no LLM lines at all is emailed too, so a changed line or query cannot hide problems.
- **Agreement with the second model** is added with T08e2 ([#66](https://github.com/jobdeputy/jobdeputy/issues/66)).
- **Permissions:** `logs:StartQuery` on the registered log groups only; `logs:GetQueryResults` has no resource type in IAM, so it is `*` (it reads only results of queries already started); `sns:Publish` on the alarm topic.

## Done when

- [x] The findings and a recommended set of signals, with costs, are presented to the maintainer.
- [x] The agreed build work is written up as tasks or issues.
