# T02: Tech stack and async backbone decision

- **Status:** awaiting-alignment
- **Depends on:** T01
- **Branch / PR:** `t02-stack-and-async-backbone`

## Goal

An agreed stack for the API, worker, database, job queue, UI, and hosting, recorded as a decision.

## Scope

- In: language and framework, database, queue or worker mechanism, UI framework, local development approach, hosting direction, monorepo layout.
- Out: crawler design (T06), relevance approach (T08), and concrete hosting setup (T03).

## Research

Library versions and maintenance were checked on 2026-09-27 on npm and PyPI. Every candidate below was updated within the last few weeks and uses a license compatible with AGPL-3.0 (MIT, Apache-2.0, or BSD).

### 1. Language

| Option | Strengths | Weaknesses |
|---|---|---|
| **TypeScript everywhere** | One language for UI, API, worker, and shared schemas, so types flow from the database to the UI. Playwright and Crawlee (a crawling framework) are TypeScript-first. Strong official AI SDKs. Easier for agents: one toolchain and one test runner. | Fewer mature HTML extraction and PDF libraries than Python. |
| Python backend and TypeScript UI | Best scraping and extraction ecosystem (Scrapy, trafilatura, extruct, pypdf). FastAPI is excellent. | Two languages, two toolchains, and API types duplicated between backend and UI. More setup for contributors and agents. `extruct` has not been released since 2024. |

**Recommendation: TypeScript everywhere.** The UI must be TypeScript anyway, and one language keeps the repo simpler for contributors and agents. The extraction gaps are small: Playwright or Crawlee handle crawling, and schema.org `JobPosting` data is plain JSON-LD that can be parsed directly. If T07 finds a real gap, a single Python extraction worker can be added behind the queue later without changing anything else.

### 2. Async backbone (job queue)

Required: submit a URL and get a job ID immediately, run workers separately, retry with backoff, timeouts, dead-lettering, clear final states, and retries that are safe to repeat and don't multiply LLM calls (decision 0002).

| Option | Strengths | Weaknesses |
|---|---|---|
| **Postgres-backed queue (pg-boss)** | No extra service; the queue lives in the same database. A crawl request row and its job can be created in the same transaction, so a request is never lost or double-queued. Built-in retries, backoff, expiry timeouts, dead-letter queues, singleton jobs, and scheduling. Very active (v12, updated 2026-09-26). | Lower throughput than Redis, but far above what this project needs for a long time. |
| Postgres-backed queue (graphile-worker) | Very fast, low latency, good design. | Fewer built-in features (dead-letter, per-queue policies); pre-1.0 version. |
| Redis and BullMQ | Mature, high throughput, good dashboards. | A second stateful service to run and host. The job and the database row can drift apart without extra outbox code. |
| Managed cloud queue (for example, SQS) | Fully managed, scales without limits. | Tied to one cloud, awkward to run locally, and harder for open-source contributors. |

**Recommendation: pg-boss on PostgreSQL.** One database is simpler to run, host, and back up, and transactional enqueue removes a whole class of bugs. Queue code goes behind a small interface, so moving to BullMQ or SQS later only changes that module.

### 3. Database

**PostgreSQL**, with no realistic alternative for this project. It gives relational data for profiles, crawl requests, and jobs, `jsonb` for raw extracted data, full-text search, and `pgvector` later if T08 uses embeddings. It also hosts the queue.

Data access: **Drizzle ORM** (recommended) is SQL-like, lightweight, has type-safe queries, and generates SQL migrations that can be reviewed. The alternative, Prisma, is heavier, uses its own schema language, and needs a code generation step.

### 4. API and worker

- **API: Fastify** (recommended). It is mature, fast, has first-class schema validation, and a large plugin ecosystem. The alternative, Hono, is lighter and runs at the edge, which we don't need.
- **Worker:** a separate Node process that shares code with the API and runs pg-boss handlers. The API and worker scale independently, and a worker crash never takes the API down.
- **Shared validation:** Zod schemas in a shared package, used by the API, worker, and UI.

### 5. UI

**React with Vite and TanStack Query** (recommended). It is a plain single-page app that talks to the API, simple to host as static files, and TanStack Query handles polling job status. The alternative, Next.js, adds server rendering and routing conventions we don't need for a logged-in app, and it blurs the line between the API and UI.

### 6. Repository layout

A pnpm workspace monorepo:

```text
apps/
  api/        Fastify HTTP API
  worker/     pg-boss job handlers (crawl, extract, relevance)
  web/        React and Vite UI
packages/
  shared/     Zod schemas, types, constants
  db/         Drizzle schema, migrations, database client
  queue/      small queue interface wrapping pg-boss
```

Testing uses **Vitest** for unit and integration tests and **Playwright** for end-to-end tests later. Node 22 LTS.

### 7. Local development and hosting direction

- **Local:** Docker Compose runs only PostgreSQL, and the apps run with `pnpm dev`. Docker is not yet installed on the maintainer's machine; T03 chooses between Docker Desktop, OrbStack, and Colima.
- **Hosting:** any container host with managed PostgreSQL (for example Fly.io, Render, Railway, or AWS). Each app ships as a container image, so there is no lock-in. T03 picks the first target.

## Open questions for alignment

1. Is TypeScript everywhere acceptable?
2. Is a Postgres-only queue (pg-boss) acceptable, instead of adding Redis?
3. Is it fine to defer the exact hosting provider to T03?

## Decision

Pending alignment.

## Done when

- [ ] A decision record is accepted.
- [ ] The repository layout (`apps/`, `packages/`, `infra/` or similar) is agreed.
- [ ] `CLAUDE.md` is updated with the stack.
