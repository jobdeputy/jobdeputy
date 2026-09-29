# 0007: Crawler: plain fetch, SSRF-safe, polite, and limited

- **Status:** Accepted
- **Date:** 2026-09-28
- **Task:** t06
- **Amends:** [0006](0006-data-model.md) (`sourceId` format; `events` renamed `audit` and built in T06)

## Context

T06 lets a user submit a URL that a worker fetches from inside AWS. That raises four questions: how pages are fetched, how the fetch is kept from reaching internal addresses (SSRF), how polite we are to the sites, and how much one user can crawl. The research is in [T06](../tasks/t06-async-crawl-pipeline.md).

## Options considered

1. **Plain HTTP fetch** in a Lambda: cheap, small attack surface, easy to test. Pages built only by JavaScript arrive empty.
2. **Plain fetch plus a headless browser fallback** (`@sparticuz/chromium`): renders JavaScript pages, but needs a 2 GB Lambda, 10–30 s per page, runs the site's code, and each page's many sub-requests all need SSRF blocking inside the browser.
3. **Always a headless browser:** option 2's costs on every crawl.
4. **A third-party scraping service:** a new paid vendor, and page content leaves our cell ([0004](0004-regional-cells-and-data-residency.md)).

## Decision

- **Plain fetch** (option 1). A page that needs JavaScript fails as `needs_browser`. A browser is added later, as its own task, if how often that happens justifies it.
- **SSRF-safe by construction:** only `http`/`https` on ports 80/443, no credentials in URLs, no IP literals; the address actually connected to must be public unicast (checked inside the connection, so DNS rebinding cannot swap it); every redirect (at most 5) is checked again; no `https` → `http` downgrade. The worker Lambda is not in a VPC.
- **Limits per fetch:** 5 s to connect, 20 s in total, 5 MB after decompression, text-like content types only.
- **Polite:** robots.txt is respected for every crawl, including user-submitted URLs; an honest user agent (`JobDeputyBot`); no browser impersonation, no bot-challenge solving, no proxies. Sites that block us fail as `blocked`.
- **No logins:** we never send cookies or credentials. A page that asks for a login (401, a redirect to a sign-in page, or a password field) fails as `login_required`; sites that always need one (LinkedIn) are refused when submitted. Crawling pages behind a login is a later decision.
- **Per-user daily limit:** an admin default and maximum per stage in SSM Parameter Store (changeable without a deploy, read live with at most 5 minutes of caching), and an optional lower-or-equal limit chosen by the user. Users can see their limit, the maximum, and today's use.
- **Code first, LLM last** for reading jobs (T07): known job-board data feeds, then embedded schema.org `JobPosting` data, then an LLM on the cleaned text, capped per [0002](0002-llm-loop-and-token-budget.md).

**Amendments to 0006:**

- `sourceId` is a hash of the source's normalized URL, not a ULID. The key is still (`userId`, `sourceId`), so each user has their own copy, and saving the same page twice is impossible.
- The `events` table is renamed **`audit`** (key `userId`, `auditId` ULID) and is built in T06, before any reader needs it: it is the user's audit history. Entries are written in the same transaction as the action they record, are never changed, and are erased only with the account (the user's own data). Operator and AWS-level actions are audited by CloudTrail ([#21](https://github.com/jobdeputy/jobdeputy/issues/21)).

## Why

- Most careers pages this slice targets serve their jobs as public data feeds or server-rendered HTML, so a browser would cost more than it adds, and would be much harder to keep away from internal addresses.
- Fetching a URL a user chose is the classic SSRF risk; in Lambda even loopback matters (the Runtime API listens on `127.0.0.1`). Checking the connected address is the only check that rebinding cannot defeat.
- Respecting robots.txt and never evading blocks is the safe position for a public, open-source project, and stays correct when scheduled crawls arrive.

## Consequences

- Some JavaScript-only sites fail until a browser task exists; the failure is visible and counted.
- Some sites block AWS addresses or unknown bots; those fail as `blocked` and are not retried.
- Every write path that should be audited now also writes an `audit` item, which each feature's tests check.
