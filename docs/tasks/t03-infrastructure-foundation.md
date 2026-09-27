# T03: Infrastructure foundation

- **Status:** planned
- **Depends on:** T02

## Goal

Any contributor can start the whole system locally with one command, and CI runs tests on every PR.

## Scope

- In: local services (database, queue), environment configuration (`.env.example`), secrets handling, CI test job, first deploy target.
- Out: application features.

## Research

To do. Docker is not currently installed on the maintainer's machine; decide on Docker Desktop, OrbStack, Colima, or a hosted development database.

## Decision

Pending.

## Done when

- [ ] One command starts the local environment.
- [ ] CI runs lint and tests.
- [ ] Setup is documented in `README.md` and `CLAUDE.md`.
- [ ] A Claude Code cloud environment setup script installs the same tools, so cloud sessions can run the tests. It is documented in `CONTRIBUTING.md`.
