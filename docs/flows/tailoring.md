# Flow: a tailored résumé for a company (#51)

One click on **Tailor** for a company makes one version of the user's résumé for that company's top shown jobs (at most 3, and never more than the user's jobs per company), with an ATS match score per job. The model rewrites only the summary, the skills list, and the bullets; code keeps it honest and computes the score. Decision: [0015](../decisions/0015-ats-match-score-and-tailored-resumes.md). Before this: [relevance flow](relevance.md) (which jobs a company shows).

- **Task:** [#51](https://github.com/jobdeputy/jobdeputy/issues/51) (M3 of the apply flow). The web screens come in PR C, cover letters in PR D.
- **Keep it true:** a PR that changes this flow updates this file, like [data-model.md](../data-model.md).

## The big picture

```mermaid
flowchart LR
  U([User]) -->|POST /me/tailorings<br/>companyKey| API[Tailoring API]
  API -->|default résumé, company's<br/>top 3 shown jobs| R[(documents, usage<br/>COMPANY#, jobs)]
  API -->|one transaction: version queued,<br/>free run, company lock, audit| D[(documents<br/>origin generated)]
  D -->|stream INSERT<br/>Pipe: generated, queued| Q[[tailoring queue]]
  Q --> W[Tailoring worker]
  W -->|1. structure once per file| S3[(S3 derived/<br/>structured-eTag.json)]
  W -->|2. keywords once per description| J[(jobs<br/>keywords)]
  W -->|3. tailor: a draft, at most 2 repairs| M[Bedrock Ministral 3 14B<br/>or the user's key]
  W -->|4. render| F[(S3 derived/<br/>resume.json, .pdf, .docx)]
  W -->|ready or failed, scores| D
  W -->|match, materials| J
  W -->|tokens| AI[(usage AI#)]
  U -->|GET /me/tailorings/id| API2[Tailoring API] -->|résumé to preview,<br/>5-minute download links| F
```

## Asking for a version

```mermaid
sequenceDiagram
  actor U as User
  participant A as Tailoring API
  participant DB as DynamoDB
  U->>A: POST /me/tailorings {companyKey, aiSource?}
  A->>DB: AI setting (preferences), key status (ai-keys)
  Note over A: aiSource none → 422 model_needed
  A->>DB: uploaded documents (Query)
  Note over A: no ready default with text → 422 no_resume
  A->>DB: usage COMPANY#companyKey (shown jobs), jobs (BatchGet)
  Note over A: ranked, open and shown, top 3 (or the user's jobs per company); none → 422 no_jobs
  A->>DB: TransactWrite: version queued + audit + MONTH# tailoringRunIds (platform, < 10) + TAILOR# lock
  alt month full
    A-->>U: 429 tailoring_allowance (retry-after: next month)
  else a run for this company in progress
    A-->>U: 409 tailoring_busy
  else
    A-->>U: 202 {tailoring: queued}
  end
```

## The run, inside the worker

```mermaid
sequenceDiagram
  participant Q as Queue
  participant W as Tailoring worker
  participant DB as DynamoDB
  participant S3
  participant M as Model
  Q->>W: {userId, documentId}
  W->>DB: claim (queued/processing → processing, attempts + 1)
  Note over W: ended → skip · asked over 60 min ago → failed stopped · a kept draft → render it (no model call) · 5 calls used → failed stopped
  W->>DB: base résumé, jobs, key (KMS for an own key), profile
  alt no cached structure for this file (ETag) and prompt
    W->>S3: text.txt
    W->>M: structure-resume (first 10,000 characters)
    W->>DB: store the call (tokens) before anything else
    Note over W: grounded in the text; no entries left → failed resume_unreadable
    W->>S3: structured-<eTag>.json
    W->>DB: documents.structured (only for this ETag)
  end
  alt a job without cached keywords for its description
    W->>M: job-keywords (the missing jobs, one call)
    W->>DB: store the call; jobs.keywords
  end
  loop at most 3 tailoring calls
    W->>M: tailor-resume (draft, then repairs naming what failed)
    W->>DB: store the call
    Note over W: honesty checks and scores in code; stop when nothing is left to fix
  end
  alt no draft came back
    W->>DB: failed model_unavailable
  else only dishonest drafts
    W->>DB: failed no_honest_draft
  else
    W->>DB: the kept draft, its scores and company (tailoring.drafted; once per run)
    W->>S3: resume.json, resume.pdf, resume.docx
    W->>DB: jobs.match, jobs.materials (idempotent, before the end)
    W->>DB: ready (scores, ok or partial) + lock freed + audit
    W->>DB: versions past 10 for the company deleted (and their files)
  end
```

- **Calls:** at most 5 task calls a run (structure 1, keywords 1, tailoring 3), counted on the version (`tailoring.calls`) across retries. Each call is stored with its tokens before the next starts; a duplicate delivery cannot store one twice (the count's condition).
- **Retries:** an error goes back to the queue, which tries again 1, then 2 minutes later (not after its visibility timeout). Finished calls are cached (structure, keywords, the kept draft) or counted, and tailoring ends with its best honest draft rather than throwing after its first call, so a retry never repeats a finished call. The last attempt ends the run `failed` whatever went wrong, so it never stays in progress; a rejected own key fails it at once (`key_rejected`).
- **The free allowance:** 10 platform runs a month, counted when asked; given back when no model call was made (no résumé, no jobs, no key). Own-key runs are not counted.
- A structured copy made for a résumé replaced or deleted meanwhile is deleted (only that file version's copy).
- Another delivery of the same message never ends a run: when it loses the race to store a call, its message is kept for a retry (which then finds the run moved on or ended); a second draft is refused, and that delivery stops.
- The jobs are linked before the version ends (a failure there is retried); once it is ready, pruning old versions is best effort (logged).
- A new structured copy, once recorded, deletes the copy of the earlier upload.

## What a version's state can be

| `status` | Meaning | Shown as |
|---|---|---|
| `queued` | Asked for; the worker has not started | in progress |
| `processing` | The worker is running it (or waiting to try again) | in progress (after 60 minutes: failed, `stopped`) |
| `ready` | Files made; `result` `ok` (every job at 80%) or `partial` | the score per job, preview, downloads |
| `failed` | `error`: `no_resume`, `resume_unreadable`, `no_jobs`, `key_missing`, `key_invalid`, `key_rejected`, `model_unavailable`, `no_honest_draft`, or `stopped` | the message (`TAILORING_ERRORS`) |

## Where everything is stored

| What | Where |
|---|---|
| A version | `documents` item, `origin: generated` (never listed, counted, or the default with uploads) |
| A base résumé's structured copy | `documents.structured` on the upload, JSON at `derived/users/<userId>/documents/<id>/structured-<eTag>.json` |
| A version's files | `derived/users/<userId>/documents/<id>/resume.{json,pdf,docx}` |
| A job's keywords and score | `jobs.keywords`, `jobs.match`, `jobs.materials` |
| The free runs, the company lock | `usage` `MONTH#` `tailoringRunIds`, `TAILOR#<companyKey>` |
| Tokens | `usage` `AI#<month>#…` (`structure-resume`, `job-keywords`, `tailor-resume`) |

Account deletion erases all of it (the `documents`, `jobs`, and `usage` tables, and the `derived/users/<userId>/` prefix). Deleting an uploaded résumé deletes its structured copy; versions made from it stay until their company's limit.

## Numbers

| | |
|---|---|
| Jobs per version | 3 (the company's top shown; fewer when the user shows fewer per company) |
| Task calls per run | at most 5 |
| Résumé text sent to structure | 10,000 characters |
| Versions kept per company | 10 |
| Platform runs (own-key runs are not counted) | 10 a month, premium 100 (#74); the admin sets both (`platformTailoringsPerMonth`, [runbook](../runbooks/crawl-limits.md)) |
| Worker timeout | 12 minutes; retries after 1 and 2 minutes; a run is stale after 60 |
| Match threshold | 80% (below: `partial`, still usable) |
