# T08e: Research how well prompts and models work on live data

- **Status:** planned (research only)
- **Depends on:** T08b
- **Branch / PR:** —

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

To do.

## Decision

To do: agreed with the maintainer after the research.

## Done when

- [ ] The findings and a recommended set of signals, with costs, are presented to the maintainer.
- [ ] The agreed build work is written up as tasks or issues.
