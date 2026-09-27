# T01: Agentic workspace and GitHub repository

- **Status:** done
- **Depends on:** none
- **Branch / PR:** `t01-agentic-workspace`

## Goal

A public-ready GitHub repository that an AI agent can work in productively from the first session, with a clear task, decision, and PR workflow.

## Scope

- In: repository, `CLAUDE.md` and `AGENTS.md`, docs structure, task board, decision records, Claude Code project settings and skills, PR template, CI (docs lint and secret scanning), open-source files, branch protection.
- Out: application code and stack choice (T02).

## Research

- Claude Code loads `CLAUDE.md` automatically, so it should stay short and link to detail in `docs/`. `AGENTS.md` is the cross-tool convention; it points to `CLAUDE.md`.
- Project skills in `.claude/skills/<name>/SKILL.md` encode repeatable workflows (research, implement, prepare a PR).
- `.claude/settings.json` is shared with the team and pre-approves safe read-only commands. `.claude/settings.local.json` is personal and git-ignored.
- Open-source readiness means a license, `SECURITY.md`, `CONTRIBUTING.md`, secret scanning, and no personal data in history.
- The GitHub free plan enforces branch protection only on public repositories.

## Decision

Agreed 2026-09-27. See [0001](../decisions/0001-agentic-workspace-and-workflow.md). Private repository first, public-ready, with the switch to public planned for the same day. License: AGPL-3.0, chosen 2026-09-27.

## Done when

- [x] Repository created, with `main` pushed.
- [x] `CLAUDE.md`, `AGENTS.md`, docs, task board, and decision records in place.
- [x] `.claude/` settings and skills in place.
- [x] PR template covering changes, testing and proof, error cases, and security.
- [x] CI runs Markdown lint and secret scanning.
- [x] Repository moved to the `jobdeputy` GitHub organization, with the Claude GitHub App installed.
- [x] Cloud-session workflow documented in `CONTRIBUTING.md`.
- [x] License chosen and added (AGPL-3.0).
- [x] Repository made public and `main` protected, done right after merge.
