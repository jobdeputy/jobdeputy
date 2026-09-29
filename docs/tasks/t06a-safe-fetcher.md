# T06a: Safe fetcher

- **Status:** done
- **Depends on:** T06 ([decision](t06-async-crawl-pipeline.md#decision), [0007](../decisions/0007-crawler.md))
- **Branch / PR:** `t06a-safe-fetcher`, [#29](https://github.com/jobdeputy/jobdeputy/pull/29) (merged)

## Goal

A tested library that fetches one URL safely, politely, and within limits, and reports every outcome as either a result or a classified failure. Not wired to any Lambda yet (T06b does that), so this PR changes nothing that is deployed.

## Scope

- In:
  - `packages/shared`: URL validation and normalization (pure, no network), shared by the API (`POST` in T06b) and the worker. Refuses LinkedIn and other sites that always need a login.
  - `apps/worker/src/fetch/`: the SSRF-safe client (`undici` with a connect-time address check through `ipaddr.js`), manual redirects, limits, robots.txt, login-wall and JavaScript-shell detection, and the failure classification (retry or not, and the `error.code`).
  - `GET`, and a small JSON `POST` for job-board data feeds (Workday), both through the same checks.
- Out: tables, API, worker wiring, S3 (T06b); pagination and extraction (T07).

## Research

See [T06 research](t06-async-crawl-pipeline.md#research), sections 2–4.

## Decision

Agreed on 2026-09-28 as part of T06.

## Findings while building

- **`robots-parser` dropped:** its types do not work as an ES module and it has not changed since 2023. Our parser is ~100 lines, follows RFC 9309, and matches without regular expressions built from the file (a hostile robots.txt cannot make it slow).
- **`undici` 7.30** (maintained, released 2026-09-25), not 8: undici 8 needs Node 22.19 or later. Move to 8 with Node 24 ([#23](https://github.com/jobdeputy/jobdeputy/issues/23)).
- **Page checks are linear-time:** the visible-text, password-field, and shell checks scan each position a bounded number of times, so hostile pages cannot slow the worker (tested).
- **Smoke test against real sites** (local, with the real safe dispatcher): a Greenhouse data feed (140 KB JSON), a Lever board (980 KB HTML), `http://github.com` upgraded to `https`, LinkedIn refused (`login_required`), `.invalid` unreachable (retriable), Google search refused by its robots.txt (`blocked_by_robots`).
- **A short page with a script is not a shell:** the first version flagged `example.com` as `needs_browser`. A shell now also needs a mount point (`id="root"`, `__next`, `<app-root>`, …) or a "please enable JavaScript" note.
- **Integration tests will not use `example.com`:** its page says not to rely on it for testing. T06b adds a dev-only test site on our own API instead.

## Done when

- [x] URL rules unit-tested: schemes, ports, credentials, IP literals in every encoding, length, punycode, normalization, refused login-only sites.
- [x] Address check unit-tested for every private, loopback, link-local, metadata, CGNAT, IPv6 ULA and IPv4-mapped range; a resolver that answers public then private (rebinding) is refused at connect.
- [x] Redirects: at most 5, each re-checked, `https` → `http` refused (local test server).
- [x] Limits: connect timeout, total timeout, 5 MB after decompression (a gzip bomb is stopped), content types (local test server).
- [x] robots.txt: allow, disallow, 4xx = allowed, 5xx or timeout = disallowed, size limit.
- [x] `login_required` (401, sign-in redirect, password field) and `needs_browser` detection.
- [x] Every failure maps to one `error.code` and a retry decision (table test).
- [x] No new paid services; `pnpm verify` and `pnpm audit` clean.
