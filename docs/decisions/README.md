# Decision records

Short records of choices that shape the project. Agents and contributors treat accepted decisions as settled. To change one, add a new record that supersedes it.

| # | Decision | Status |
|---|---|---|
| [0001](0001-agentic-workspace-and-workflow.md) | Agentic workspace, task workflow, and branching | Accepted |
| [0002](0002-llm-loop-and-token-budget.md) | LLM and agent loop limits (max 3) and token budget | Accepted |
| [0003](0003-serverless-aws-stack.md) | Serverless AWS stack, async backbone, and CI/CD | Accepted |
| [0004](0004-regional-cells-and-data-residency.md) | Regional cells and data residency (US, India, UK) | Superseded by 0017 |
| [0005](0005-pre-launch-cost-guardrails.md) | Pre-launch cost guardrails ($20 hard stop) | Accepted (amended by 0009, 0010) |
| [0006](0006-data-model.md) | Data model: tables, keys, and schemas | Accepted (amended by 0007, 0008, 0009, 0015, 0016, 0018) |
| [0007](0007-crawler.md) | Crawler: plain fetch, SSRF-safe, polite, and limited | Accepted |
| [0008](0008-job-extraction.md) | Job extraction: job-board feeds and schema.org first, LLM later | Accepted |
| [0009](0009-llm-architecture-and-own-keys.md) | LLM architecture: Strands agents, the user's own keys, and token usage | Accepted (amended by 0015, 0018) |
| [0010](0010-platform-ai-model.md) | Platform AI model (Ministral 3 14B) and prompt-injection rules | Accepted |
| [0011](0011-web-hosting.md) | Web app hosting: dev.jobdeputy.com on S3 and CloudFront, with a delegated zone | Accepted |
| [0012](0012-web-ui-styling-and-testing.md) | Web UI: Tailwind + shadcn/ui, Playwright on seven devices, translation-ready copy | Accepted |
| [0013](0013-apply-flow-rules.md) | Apply flow: one résumé per company, an 80% match score, a per-company cooldown, and the user submits | Accepted (amended by 0015) |
| [0014](0014-browser-extension-in-monorepo.md) | The browser extension lives in the monorepo (`apps/extension`) | Accepted |
| [0015](0015-ats-match-score-and-tailored-resumes.md) | ATS match score (LLM keywords, code score), honesty checks, and tailored résumés in `documents` | Accepted |
| [0016](0016-applications-are-job-stages.md) | Applications are job stages: one jobs table, a sparse `applied` index | Accepted (amended by 0018) |
| [0017](0017-one-prod-region-for-all-countries.md) | One prod Region (`us-east-1`) serves every country, for now; cells added only on a trigger | Accepted |
| [0018](0018-shared-job-catalog-and-matching.md) | A shared job catalog: scheduled visits, duplicates, job age, matching, free and premium, tailoring on demand | Accepted (design) |

## Template

Copy [_template.md](_template.md) to `NNNN-short-title.md`.
