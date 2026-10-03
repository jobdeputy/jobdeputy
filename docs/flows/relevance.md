# Flow: which jobs the user sees, and why (T08)

A crawl can find hundreds of jobs. T08 decides which few a person sees, each with a score and short reasons, in two layers: a free keyword filter on every job, then an AI model that scores the best candidates.

- **Tasks:** [T08](../tasks/t08-relevance-filter.md): [T08a](../tasks/t08a-ai-model.md) model, [T08b](../tasks/t08b-llm-foundation.md) LLM foundation, own keys, usage, [T08c](../tasks/t08c-code-filter.md) keyword filter, company limit, expiry, [T08d](../tasks/t08d-llm-relevance.md) AI scoring, [T08e](../tasks/t08e-live-effectiveness.md) live quality. What comes before: [crawl flow](crawl.md).
- **Visual version** (maintainer only, private link): <https://claude.ai/artifact/VYgD3aAFUeBMutL9gKkujZ>
- **Keep it true:** a PR that changes this flow updates this file, like [data-model.md](../data-model.md).

## The two layers

| | Layer 1: keyword filter | Layer 2: AI score |
|---|---|---|
| Runs in | the crawl worker, on every crawl (T08c) | the relevance worker, after AI crawls only (T08d) |
| Costs | nothing | model tokens (platform allowance or the user's key) |
| Looks at | title, place, workplace, type, salary against the target roles and search settings | the profile and résumé excerpt next to up to 50 candidates |
| Gives | `candidate` or `not_relevant`, with reasons | a score 0–100, the best role, up to 3 reasons |
| Hides | only on evidence (lenient: what a list does not say never counts against a job) | a score below 30 |

On top of both, each company shows at most **10 jobs** (the user can change it), and hidden jobs expire after **7 days**.

## The big picture

```mermaid
flowchart LR
  U([User]) -->|POST /me/crawls<br/>aiSource: platform, own key, or none| API[Crawls API]
  API -->|platform: count the free run| USG[(usage<br/>AIWEEK#, MONTH#)]
  API --> CR[(crawls<br/>queued)]
  CR --> CW[Crawl worker<br/>T06/T07]
  CW -->|Layer 1: keyword filter<br/>and company limit| J[(jobs<br/>filter, limitState, ttl)]
  CW --> CO[(usage<br/>COMPANY#)]
  CW -->|succeeded with candidates| CR2[(crawls<br/>candidates)]
  CR2 -->|stream MODIFY<br/>Pipe filter| RQ[[relevance queue]]
  RQ --> RW[Relevance worker<br/>T08d]
  RW -->|platform| BR[Bedrock<br/>Ministral 3 14B<br/>same Region]
  RW -->|own key| KMS[KMS decrypt] --> PR[OpenAI or Anthropic]
  RW -->|Layer 2: score, hide, re-rank| J
  RW --> CO
  RW -->|tokens| AI[(usage<br/>AI# per month and model)]
  RW -->|one log line per call| LOG[Logs and metrics<br/>daily LLM report]
  U -->|GET /me/jobs| JAPI[Jobs API] --> J
```

## Before the crawl: choosing the AI

Every crawl carries an `aiSource`: the user's choice for that crawl, or their default (`/me/ai-settings`).

| `aiSource` | Meaning | Checked at submit |
|---|---|---|
| `platform` | Our model: Ministral 3 14B on Amazon Bedrock, in the user's Region ([0010](../decisions/0010-platform-ai-model.md)). Free within an allowance. | 1 run a week, 4 a month, counted in the crawl's transaction (`usage` `AIWEEK#`, `MONTH#`); `429` when used up. |
| `openai`, `anthropic` | The user's own key (T08b2, [0009](../decisions/0009-llm-architecture-and-own-keys.md)), encrypted with the cell's KMS key and bound to that user and provider. The profile and résumé text go to that provider; the consent text says so. | The key exists and is not marked invalid (keys are checked in the background when saved; at most 5 checks a day). |
| `none` | Keyword filter only; no model call. | Nothing. |

## Layer 1, inside the crawl worker (T08c)

Runs between reading the jobs and saving them (`apps/worker/src/relevance/`).

```mermaid
flowchart TD
  A[Jobs read from the board] --> B[Load the user's roles,<br/>search settings, profile, limits]
  B --> C{Keyword filter<br/>per job}
  C -->|title matches a role,<br/>or the headline, or a skill| K[candidate<br/>title_match, headline_match, skill_in_title]
  C -->|no roles set yet| K2[candidate<br/>no_target_roles]
  C -->|evidence against it:<br/>title, seniority, place, workplace,<br/>type, salary, excluded word| N[not_relevant<br/>hidden, expires in 7 days]
  K --> R[Rank each company's candidates:<br/>AI score if known, role priority, date]
  K2 --> R
  R --> T{Within the company limit?<br/>default 10}
  T -->|yes| S[limitState: counted<br/>shown]
  T -->|no| O[limitState: over_limit<br/>hidden, expires in 7 days]
  S --> D[Read missing descriptions<br/>for the top 50, T08d3]
  O --> D
  N --> D
  D --> SV[(Save to jobs)]
  SV --> F[Finish the crawl with candidates:<br/>the top 50 ranked, if aiSource is not none]
```

The company limit is a snapshot in `usage` `COMPANY#<companyKey>`: the jobs shown for that company and their rank. A crawl replaces it only if nobody changed it since it was read (a version check), so two crawls cannot both take the same places. A job that closes frees its place.

## Layer 2, the AI scoring run (T08d)

### How the run starts

When the crawl worker marks a crawl `succeeded`, the crawls stream emits a `MODIFY`. A second EventBridge Pipe passes it to the relevance queue only when:

- the status is `succeeded`;
- `aiSource` is not `none`;
- the crawl found at least one relevant job (`jobsRelevant` > 0);
- the crawl has no `relevance` run yet. The worker's first write adds one, so its own writes never start another run.

### What the worker does

```mermaid
sequenceDiagram
  autonumber
  participant Q as relevance queue
  participant W as Relevance worker
  participant DB as DynamoDB
  participant K as KMS
  participant M as Model
  Q->>W: { userId, crawlId }
  W->>DB: Crawl finished over 30 min ago with no run? Skip (stream replay)
  W->>DB: Start the run: crawl.relevance = running (only if absent)
  W->>DB: Load the candidates (BatchGet), keep those still candidate and open
  W->>DB: Load roles, profile, the start of the default résumé
  W->>W: inputsHash per job (job, profile, prompt version)
  Note over W: An unchanged hash reuses the stored score: no model call
  alt platform
    W->>M: Bedrock in this Region
  else own key
    W->>DB: Read the encrypted key (ai-keys)
    W->>K: Decrypt (only with this userId and provider)
    W->>M: OpenAI or Anthropic
  end
  loop batches of 10 jobs, at most 6 task calls
    W->>M: relevance@v2 prompt, jobs j1..j10, roles r1..
    M-->>W: results: id, score, bestRoleId, reasons
    W->>W: Grounding checks: only the IDs sent, once each,<br/>known roles, no reason quoting an ID
    W->>DB: One transaction: crawl progress, AI# tokens, scores
    W->>W: One metrics log line (no user ID, no text)
  end
  opt jobs the model left out
    W->>M: One follow-up call with just those jobs
  end
  W->>DB: Apply: below 30 is not_relevant (llm_low_score),<br/>the rest re-ranked by score within the company limit
  W->>DB: End the run: status, stats, audit crawl.scored
```

Each task call is its own transaction: the crawl stores `relevance.calls` and `relevance.sent` with the scores and the tokens, so a retried message never sends a job twice, never counts tokens twice, and never goes past 6 task calls.

## What a job's state can be

```mermaid
stateDiagram-v2
  [*] --> not_relevant: keyword filter finds evidence against it
  [*] --> candidate: keyword filter keeps it
  candidate --> counted: within the company limit
  candidate --> over_limit: the company has 10 better jobs
  counted --> hidden_low_score: AI score below 30
  counted --> counted: AI score 30 or more, re-ranked
  counted --> over_limit: pushed out by higher scores
  over_limit --> counted: a place frees up
  not_relevant --> expired: 7 days, user never acted
  over_limit --> expired: 7 days
  hidden_low_score --> expired: 7 days
  counted --> closed: the board no longer lists it
  closed --> expired: 7 days, user never acted
  expired --> [*]: DynamoDB TTL deletes it
```

`GET /me/jobs` shows **counted** jobs by default; `?view=all` shows everything. A job the user acted on never expires.

## Safety rules around the model

| Rule | How it is enforced |
|---|---|
| Bounded cost | At most 50 jobs, 6 task calls, and 18 model calls per crawl, across retries. Each call has an output token cap and a 60 s timeout. A job sends its first 1,500 description characters; the résumé its first ~6,000 ([0002](../decisions/0002-llm-loop-and-token-budget.md)). |
| Prompt injection | Job text is untrusted. Code accepts only the job IDs sent, once each, and only the user's real roles. Injection cases are in the eval ([0010](../decisions/0010-platform-ai-model.md)). |
| No silent fallback | A missing or invalid own key ends the run (`key_missing`, `key_invalid`); a key the provider rejects ends it at once (`key_rejected`). It never switches to the platform model. |
| Provider outage | The queue retries; the last attempt ends the run (`model_unavailable`). Unscored jobs keep their keyword verdict. |
| Data residency | The platform model runs in the user's Region. Own keys send data to that provider, with consent. |
| Readable reasons (#62) | Reasons name roles by title; a reason quoting an internal ID such as `r1` is dropped and counted. |
| Quality gate | Every prompt, schema, or model change runs the eval against a saved baseline; a regression fails the PR. |

## Where everything is stored

Details: [data-model.md](../data-model.md).

| Store | Item or field | What it holds |
|---|---|---|
| `jobs` | `filter` | Keyword verdict, matched roles, reasons, role priority |
| `jobs` | `relevance` | AI score, best role, reasons, model, prompt version, inputs hash, when |
| `jobs` | `limitState`, `ttl` | `counted` or `over_limit`; when a hidden job expires |
| `crawls` | `candidates`, `relevance`, `llm` | The top 50 to score; the run's status, calls, jobs sent, stats; tokens used |
| `usage` | `COMPANY#<company>` | Each company's shown jobs and rank (versioned) |
| `usage` | `AIWEEK#`, `MONTH#` | Crawls that used a free platform run |
| `usage` | `AI#<month>#<source>#<provider>#<model>` | Calls and tokens per month and model (`GET /me/ai-usage`) |
| `ai-keys` | `userId`, `provider` | The encrypted own key and its check status |
| `preferences` | `ROLE#`, `SEARCH`, `AI_SETTINGS` | Target roles, search settings, default AI source |
| SSM | `crawl-limits` | Admin settings: company limit, expiry days, free runs, jobs to score, low-score cut-off |

## How we know it keeps working

- **Every task call** writes one log line: calls, tokens, latency, rejected outputs, grounding rejections, score spread, jobs sent, low scores. Never a user ID or text.
- **Metrics and alarms** (T08b3): totals and per task; alarms on 10 or more rejected outputs, or 5 or more timeouts, in an hour.
- **Queue health check** (T08d1): every 5 minutes; emails when the relevance queue backs up or has dead letters.
- **Daily LLM report** (T08e1, [#65](https://github.com/jobdeputy/jobdeputy/issues/65)): per prompt version and model against limits; emails only when one is crossed.
- **Next** (T08e2, [#66](https://github.com/jobdeputy/jobdeputy/issues/66)): a sample rescored by a second model, a shadow prompt, and gradual rollout of prompt or model changes.

## Numbers

| What | Value |
|---|---|
| Jobs shown per company | 10 (admin and user settings) |
| Hidden below score | 30 |
| Hidden jobs expire after | 7 days |
| Jobs scored per crawl | at most 50, 10 per call |
| Calls per crawl | at most 6 task calls, 18 model calls |
| Free platform runs | 1 a week, 4 a month |
