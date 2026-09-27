# 0001: Agentic workspace, task workflow, and branching

- **Status:** Accepted
- **Date:** 2026-09-27
- **Task:** t01

## Context

The project is built mainly with AI coding agents working alongside a human, and it will be open source from the start. Agents need consistent context in every session, and work needs to stay reviewable.

## Options considered

1. **Design everything upfront, then build.** An earlier attempt produced a very large design package before any code existed. It was hard to act on and hard for agents to load.
2. **Lean, task-by-task workflow, with context kept in the repo.** Design each part when its task starts.

## Decision

- Option 2. Every task runs **research → align with the human → implement**.
- `CLAUDE.md` is the short entry point for agents. `AGENTS.md` points other tools to it.
- Tasks are Markdown files in `docs/tasks/`, with the board in `docs/tasks/README.md`.
- Architectural choices are recorded in `docs/decisions/`.
- Branch per task (`tNN-slug`), PR into a protected `main`, squash merge.
- Every PR explains what changed, how it was tested with proof, the error cases, and a security review.
- Long-running work is asynchronous (job queue and workers).
- The repository is public-ready: no secrets, synthetic test data only, secret scanning in CI.

## Why

Small, well-documented steps keep agents on track, and the human stays in control of each decision. Markdown tasks live next to the code, so agents can read and update them directly.

## Consequences

- Architecture emerges task by task. Earlier decisions may be superseded when a later task learns more.
- Status must be kept current in the PR that does the work.
