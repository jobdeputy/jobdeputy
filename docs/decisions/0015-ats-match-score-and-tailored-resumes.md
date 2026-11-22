# 0015: ATS match score and tailored résumés

- **Status:** Accepted
- **Date:** 2026-11-22
- **Task:** #51
- **Amends:** [0006](0006-data-model.md) (generated résumés are `documents` items, and `documents` gets a stream), [0009](0009-llm-architecture-and-own-keys.md) (a separate platform allowance for tailoring), [0013](0013-apply-flow-rules.md) (how the score is computed)

## Context

[0013](0013-apply-flow-rules.md) fixed one tailored résumé per company and an 80% match score per job, but left open how the score is computed and where versions are stored. The score must mean the same whichever model tailored the résumé, and tailoring must never make up experience. Research and options: the *Research* comment on #51.

## Options considered

1. **Score by the LLM** (it grades the résumé, 0–100): simple, but opaque, different per model and per run, and the model that tailored the résumé would grade its own work.
2. **Score by code alone** (a dictionary or TF-IDF): free and the same every time, but noisy, and it cannot tell required skills from preferred ones.
3. **Hybrid**: the LLM lists each job's keywords once, and code keeps only those in the posting and computes the score.
4. **Embedding similarity**: catches meaning, but ATSs do not work that way, and it needs a second Bedrock model.

For storage: reuse `documents` (designed for generated files), or a new `tailorings` table.

## Decision

**The score (hybrid, option 3).** `packages/shared/src/match-score.ts`:

- The `job-keywords` task lists a job's keywords: the term as the posting writes it, its kind (hard skill, title, certification, education, soft skill), and whether it is required. All of a company's jobs (at most 3) go in one call, with one output field per job (`j1`, `j2`, `j3`). With a list of results, Ministral 3 14B answered only the first job.
- Code keeps only keywords the posting contains (`groundKeywords`), once each, at most 30 per job. The result is cached per job by its description hash.
- **Code computes the score**: weighted coverage of the keywords in the résumé's text. Hard skill 3 when required, 2 when preferred; title 2; certification or education 2, only when required (otherwise not counted); soft skill 0.5. Terms match as whole phrases after normalising: lower case, no accents, plurals folded, and a short alias list (JS = JavaScript, K8s = Kubernetes, AWS = Amazon Web Services, BSc = Bachelor's, and others). A phrase never matches across lines, list items, or sentences (a full stop before a capital, unless it ends an abbreviation such as "Sr."), and names that are also common words count only as written for the technology ("Go" or "golang", not "go-live"; "REST", not "the rest").
- The threshold stays **80%** (Jobscan suggests 75%). We show the base résumé's score and the tailored score side by side.

**Honesty, checked in code** (`packages/llm/src/resume-checks.ts`). Tailoring rewrites only the summary, the skills list, and the bullets, and refers to the base résumé's entries by ID. Code puts them back into the base, so employers, titles, dates, schools, and degrees cannot change. A draft is refused when:

- it names an entry the résumé does not have, or names one twice;
- it has a number that neither the base résumé nor a confirmed skill has (no invented metrics, years, or sizes; digits inside names such as K8s or EC2 are not numbers);
- it has a link, email address, or domain that neither the base résumé nor a confirmed skill has (job text may plant them);
- it lists a skill, or uses a job keyword (other than a soft skill), that neither what the résumé says the person did (its skills, titles, bullets, degrees, and certifications; not employers, schools, places, or dates) nor the user's confirmed skills (profile skills, **"I have this"**) show. A term several jobs list is checked as its strictest kind;
- an entry's bullets name a hard skill or certification that the entry never mentioned (confirmed skills go in the skills list);
- a keyword appears more than 4 times, or more than 2 times above the base résumé's count when the base already has 4 or more.

Claims are judged only in the text the model wrote, not in base fields it cannot change. Model text is turned into plain text first (no Markdown or bullet marks). A refused draft is never stored.

**The run (decision [0002](0002-llm-loop-and-token-budget.md)).** It starts only on a **Tailor** or **Re-tailor** click, and makes at most **5 task calls**:

1. Structure the base résumé: 1 call, cached per base document. The model copies the first 10,000 characters of the résumé's text into fields (about 2.5 dense pages; more would not fit its 4,000 output tokens), and code keeps only what the text contains (`groundStructured`) and records how much of the text the copy covers, so a résumé the model cut short can be flagged.
2. Job keywords: 1 call, cached per job.
3. Tailoring: at most 3 iterations. Iteration 1 is a draft. Each repair names the failed checks (including those of earlier drafts, so a fixed one does not come back) and the jobs below 80% that still miss keywords the user has shown to be true. The run ends early on a cancelled or timed-out call, on a second call in a row without valid output, and on a provider error after the first call (it ends with its best honest draft, or none; only an error on the first call goes to the queue, so a retry never repeats finished calls). The run stops when nothing is left to fix, and keeps the best draft that passed every check (highest lowest-job score, then the mean). The run is `ok` when every job reaches 80%, `partial` when kept below 80%, and `failed` when no draft passed.

A cover letter is a separate run, on demand per job: 1 call plus at most 2 repairs.

**Files and preview.** The structured résumé (`packages/shared/src/resume.ts`) is rendered in the worker at generation time with one ATS-safe template, as **PDF (`pdfmake`, the default download) and DOCX (`docx`)**. The in-app preview is HTML rendered from the same JSON.

**Storage (amends [0006](0006-data-model.md)).** Reuse **`documents`**: a version is an item with `kind` `resume` or `cover_letter`, `origin: generated`, `companyKey`, `jobIds`, `baseDocumentId`, and `generation`. Its files go under `derived/users/<userId>/documents/<documentId>/`. A **stream on `documents`** (the Pipe passes only generated `queued` items) starts the work. The last **10 versions per company** are kept, and generated documents do not count toward the 10-upload cap. Jobs get `match` (the score of the version they point to) and `materials`. The exact attributes go in `docs/data-model.md` with the PR that builds them.

**Allowance (amends [0009](0009-llm-architecture-and-own-keys.md)).** There is a separate platform **tailoring allowance of 10 runs a month**; the crawl allowance stays as it is. Runs with the user's own key are not capped, and are still started only by the user. The consent text for saving a key now says the whole résumé goes to the user's provider.

**Model.** Ministral 3 14B stays the platform model for both tasks. Eval results on 2026-11-22 in us-east-1 (6 synthetic companies, 2 runs each; `pnpm --filter @jobdeputy/llm eval`):

| Task | Valid output | Result | Planted text resisted | Median time |
|---|---|---|---|---|
| `job-keywords@v1` | 12/12 | 126/136 labelled keywords found | 2/2 | 4.1 s |
| `tailor-resume@v1` | 18/18 calls, 1.5 calls per run | 12/12 runs kept an honest draft; 20/20 jobs have every keyword the person has shown to be true | 2/2 | 3.9 s |
| `structure-resume@v1` (PR B) | 8/8, all on the first try | 113/116 entries, bullets, and skills copied word for word (the 12-job case counts its jobs only); every miss is that case's 11th or 12th job, where the model sometimes stops early | 2/2 | 6.1 s |

The mean score rose from 59 (base) to 66 (tailored). The honest ceiling (every proven keyword present) averages 66 on these cases, so tailoring reaches the best a truthful résumé can. The eval's `--model` option compares another Bedrock model against these baselines. `gpt-oss-120b` was not run: the cost guardrails deny every model but the platform one, and Ministral passed.

## Why

Code scoring makes 80% mean the same for every model and every run, and keeps the model from grading its own work. The LLM is used only where code is weak: reading a posting for its skills, and rewriting text. Referring to entries by ID, and checking numbers, links, and keywords against evidence, makes honesty a property of the code, not of the prompt. Reusing `documents` keeps account deletion, grants, and the S3 layout as they are.

## Consequences

- Many jobs cannot reach 80% honestly: in the eval, 4 of 20 jobs did, because postings ask for skills the person has not shown. The UI must say why the score is low, list the missing keywords with **"I have this"** and "Add only if true", and still let the user apply ([0013](0013-apply-flow-rules.md)).
- Titles count: a job title the person never held stays missing, which is honest but lowers the score.
- The alias list and weights are code. Changing them changes scores, so stored scores keep the version that computed them (from the PR that stores them).
- A future model change re-runs both evals. Tailoring is judged by its runs (runs with no honest draft, labels, the mean tailored score within 5 points of the baseline), not by single calls, since a run repairs a call that gave no valid output.
- Revisit: the repeat cap, if users find résumés repetitive; a per-entry evidence check for confirmed skills, if users want them in bullets.
