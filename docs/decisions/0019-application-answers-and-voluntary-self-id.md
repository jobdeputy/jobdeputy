# 0019: Application answers in the profile; voluntary self-identification encrypted

- **Status:** Accepted
- **Date:** 2026-11-27
- **Task:** #53

## Context

The extension (#54) fills application forms; the user reviews and clicks Submit ([0013](0013-apply-flow-rules.md)). Beyond the profile, forms ask the same questions every time: may you work here, do you need sponsorship, notice period, salary, relocation, and, on US forms, the voluntary self-identification questions (gender, Hispanic/Latino, race, veteran status, disability). The data model planned an `APPLICANT` item but nothing for the demographic questions, which are sensitive. Nine functions can `GetItem` on `users`, and IAM can't limit `GetItem` by sort key, so a plain item there would be readable by the crawl worker, tailoring, and the rest.

## Options considered

1. **Demographic answers as a plain item in `users`:** simplest, but readable by every function that reads `users`.
2. **A separate table only the profile API can read:** least privilege by table, but a new table keyed by `userId` (deletion list, PITR, another decision) for five small answers.
3. **An item in `users`, encrypted with the cell's KMS key (chosen):** the pattern AI keys already use ([0009](0009-llm-architecture-and-own-keys.md)); other functions see only ciphertext. No new key ($0): the grant is limited by encryption context instead.

## Decision

- **`users` `APPLICANT`** (own version): work authorization per country (`authorized`, `needsSponsorship`; US only at launch, [0017](0017-one-prod-region-for-all-countries.md)), notice period, earliest start date, expected salary range, willing to relocate, work setups (remote, hybrid, on-site), over 18, security clearance, pronouns, and one default "How did you hear about us". Every answer is optional: absent means unanswered. Links stay in the profile.
- **Current salary is never stored.** Many US states ban asking for it.
- **Never guessed:** the extension leaves blank and points out legal attestations and signatures, consent to background checks, criminal history, "worked here before?", free-text questions (an AI draft may come in #54), and anything unanswered.
- **`users` `VOLUNTARY`**: the five US self-identification answers, opt-in, each `decline` ("I don't wish to answer") until the user changes it. Stored only as `ciphertext`, encrypted by the profile API with the cell's KMS key and encryption context `{userId, purpose: voluntary-self-id}`. The profile API's grant requires exactly those context keys and that purpose, so it can't decrypt AI keys (context `userId` + `provider`), and the functions allowed AI keys can't decrypt these. Never sent to AI, never logged; audit entries say only that they were saved. Account deletion erases both items with the rest of `users`.
- **API** (profile Lambda): `GET`/`PUT /me/applicant`, `GET`/`PUT /me/voluntary`; each save sends the version it read (409 on a stale one). What the extension may read is decided in #54.

## Why

Encryption gives the same isolation as a separate table without one, and reuses a key and a pattern we already test. Default `decline` means a user who never opens the section discloses nothing.

## Consequences

- The extension's read API (#54) must decrypt in a function granted the same narrow context, or ask the profile API.
- The KMS key's description still says "AI keys"; it is updated with the next keys-stack change.
- Other countries' questions (UK diversity monitoring, Indian forms) need their own answers later; the `VOLUNTARY` schema is US-only.
