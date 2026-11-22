# Current slice: from a link to a submitted application

## Goal

A user gives a link, sees the best jobs at each company, gets one tailored résumé per company with an ATS match score, applies (by hand, or with a browser extension that fills the form), and keeps a history of every application. The user always clicks **Submit** themselves.

The rules are agreed in [0013](decisions/0013-apply-flow-rules.md); the extension's home is [0014](decisions/0014-browser-extension-in-monorepo.md).

## Already built (the slice before this one)

- Profile backend: basic details, target roles, résumés (upload, malware scan, default résumé). Profile and Résumés pages in the web app (#33, parked while this slice runs; its search preferences come later).
- A link → asynchronous crawl → jobs extracted from job-board feeds and schema.org → a code relevance filter and an LLM fit score → at most N jobs shown per company (T08c, `companyJobsDefault`, now 10) → stored in the `jobs` table.
- The platform AI model and the user's own keys ([0009](decisions/0009-llm-architecture-and-own-keys.md), [0010](decisions/0010-platform-ai-model.md)).

## User flow

1. The user pastes a link: one company's careers page, or a list of many companies.
2. A crawl runs in the background (as today). The user sees jobs **grouped by company**, at most **3 per company**, ranked within the company.
3. For a company, JobDeputy writes **one tailored résumé** covering its top jobs, plus a cover letter where a job accepts one. The user previews it in the app.
4. Each job gets an **ATS match score**. At 80% or more it is ready; below 80% the user sees a warning, the missing keywords, and **Re-tailor**, and may still apply.
5. The user applies: opens the job and applies by hand, or lets the **extension** fill the form on the job's site, reviews it, and clicks Submit.
6. The application is recorded with the exact résumé version used. After 3 applications to one company in 30 days, that company **cools down**: its new jobs still show, marked `Cooling down until <date>`, with Apply turned off.

## Milestones

Each milestone is one GitHub issue, run as research → align → implement, in small PRs.

| # | Milestone | Decides in its own issue |
|---|---|---|
| 0 | This scope and the decision records (#47) | — |
| 1 | Link → top jobs UI: grouped by company, 3 per company (default changes from 10), ranked within the company | The jobs page from the prototype (`jobs-preview.html`); the ranking signal shown |
| 2 | Lists of many companies: GitHub lists and public job boards | Which sources for the US launch; each source's terms and robots rules; Naukri waits for the India cell and a terms and anti-bot check |
| 3 | Tailored résumé (+ cover letter) and the ATS match score | How the score is computed; the résumé's output format (PDF, DOCX) and template; where versions are stored (new tables need a decision record, [0006](decisions/0006-data-model.md)); the re-tailor loop within [0002](decisions/0002-llm-loop-and-token-budget.md)'s cap |
| 4 | Applications: table, manual apply, tracker, cooldown | The `applications` data model; the statuses the user can set (`applications-preview.html`) |
| 5 | Application answers: a profile section for the questions forms ask (work authorisation, sponsorship, notice period, links, demographic questions the user may decline) | Which answers are stored, and which are never guessed |
| 6 | Chrome extension: sign-in, read the API, autofill Greenhouse first, then more ATSs, record the application | How the extension signs in; its permissions; which ATSs follow Greenhouse; store publishing |
| 7 | Other browsers (Edge, Firefox, Safari) | Order and packaging |

## In scope

- The flow above, for the US cell first (the launch is US-only).
- Storing every tailored résumé and cover letter, linked to its company and jobs, in the user's home Region ([0004](decisions/0004-regional-cells-and-data-residency.md)).
- AI work through the platform model or the user's own key, every loop capped at 3 iterations ([0002](decisions/0002-llm-loop-and-token-budget.md)).

## Not in scope yet

- Submitting an application without the user's click, on any site.
- LinkedIn-specific discovery or Easy Apply.
- Signing in to job sites, solving CAPTCHAs, or creating ATS accounts for the user.
- Automatic role lookup (re-running searches; a later premium option).
- Changing the 80% threshold, the per-company limit, or the 30-day cooldown in the UI (the values are configuration now; settings come later).
- Mobile apps.
