# 0013: Apply flow: one résumé per company, an 80% match score, a per-company cooldown, and the user submits

- **Status:** Accepted
- **Date:** 2026-11-21
- **Task:** #47
- **Amended by:** [0015](0015-ats-match-score-and-tailored-resumes.md) (the score is computed in code from LLM-listed keywords)

## Context

The next slice ([scope](../scope-current-slice.md)) takes a user from a link to submitted applications. Several product rules shape the data model, the AI work, and the extension, so they are fixed here before the milestones start. Phase 2 of the [problem statement](../problem-statement.md) asks that automation stays traceable and under the user's control.

## Options considered

1. **Tailored résumé per job or per company.** Per job fits each posting best, but triples the AI work and the versions to review. Per company covers its top 3 jobs, which usually ask for the same skills.
2. **Match score as a gate or a warning.** A hard gate below 80% stops people applying to jobs they still want. A warning keeps the choice with the user.
3. **Extension submits or user submits.** Auto-submitting saves one click but sends applications nobody reviewed, and many sites forbid automated submissions.
4. **Cooldown counts jobs shown or applications sent.** Counting applications matches what recruiters see; counting shown jobs would block companies the user never applied to.

## Decision

- **One tailored résumé per company**, covering its top jobs (at most 3 shown per company). A cover letter ("letter to the hiring manager") is written only when a job accepts one. The résumé is the main thing.
- **An ATS match score per job**, recommended threshold **80%**. Below it the app warns, lists the missing keywords, and offers **Re-tailor**; the user may still apply.
- **Every tailored résumé is stored** and linked to its company and jobs, with a preview in the app. An application keeps the exact version it used.
- **Per-company limit and cooldown:** 3 applications to one company in a **rolling 30 days**. During the cooldown the company's new jobs still show, marked `Cooling down until <date>`, with Apply turned off.
- **The extension fills, the user submits.** It fills every field it can, then stops; the user reviews and clicks Submit. It never submits on its own.
- **Lists of many companies** come from GitHub lists and public job boards. Each board's terms and robots rules are checked before it is added; India-only boards (such as Naukri) wait for the India cell.
- The threshold, the limit, and the cooldown are configuration values with these defaults; user settings for them come later.

## Why

Per company keeps AI cost and review effort low while matching how people apply. A warning instead of a gate leaves the decision with the user. A user-pressed Submit keeps every application reviewed and traceable, as Phase 2 requires, and stays within job sites' terms. Counting applications in a rolling window is what protects the user's standing with a company.

## Consequences

- New stored items: tailored résumé versions and applications. Their tables are designed in milestones 3 and 4, each with its own decision record ([0006](0006-data-model.md)), and added to account deletion.
- The jobs shown per company default changes from 10 to 3 (T08c's `companyJobsDefault`).
- Tailoring and scoring are LLM tasks under [0002](0002-llm-loop-and-token-budget.md): each Re-tailor is one user-started run, itself capped at 3 iterations.
- How the score is computed (an LLM, keywords, or both) is decided in milestone 3; the 80% threshold must mean the same thing whichever is chosen.
- Revisit per-job tailoring if users report that one résumé fits a company's jobs badly.
