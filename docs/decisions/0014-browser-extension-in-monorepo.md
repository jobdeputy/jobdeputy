# 0014: The browser extension lives in the monorepo (`apps/extension`)

- **Status:** Accepted
- **Date:** 2026-11-21
- **Task:** #47

## Context

The apply flow ([0013](0013-apply-flow-rules.md)) needs a browser extension that reads the user's tailored résumé and answers from the API, fills job application forms, and records the application. It shares API types with the web app and the API.

## Options considered

1. **`apps/extension` in this monorepo:** shares `packages/shared` (Zod schemas and types) directly, so an API change and its extension change land in one PR. Needs its own CI and release so web and backend PRs are not slowed.
2. **A separate repository:** its own release rhythm, but the shared types must be published as a package and kept in step across two repos.

## Decision

- The extension is `apps/extension` in this monorepo, using `packages/shared` for API types.
- It gets its own **path-scoped CI workflow** (runs only when the extension or `packages/shared` changes) and its own **release workflow** for the browser stores.
- Chrome first (milestone 6); other browsers in milestone 7.

## Why

One PR per change across the API and the extension, and no published package to keep in step. Path-scoped CI keeps other PRs as fast as today.

## Consequences

- `pnpm verify` includes the extension's lint, typecheck, and tests.
- Store credentials live only in the release workflow's GitHub environment, never in the repo.
- The extension's sign-in, permissions, and the sites it may run on are decided in milestone 6, with least privilege: it asks only for the job sites it fills.
