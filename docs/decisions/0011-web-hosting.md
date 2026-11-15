# 0011: Web app hosting on our domain

- **Status:** Accepted
- **Date:** 2026-11-13
- **Task:** none (agreed with the maintainer in the session that moved to the new repository)

## Context

`apps/web` (React, Vite, and TanStack Query, [0003](0003-serverless-aws-stack.md)) needs a home on the domain we own, `jobdeputy.com`. Its Route 53 zone is in the management account, while each stage's workloads run in their own accounts ([0005](0005-pre-launch-cost-guardrails.md)). Prod is parked, and its address is decided at launch.

## Options considered

1. **A delegated zone per stage:** `dev.jobdeputy.com` gets its own zone in the dev account, delegated once by NS records in the parent zone. CDK then owns the certificate check and the site record. Cost: $0.50 a month per zone, which is an idle cost.
2. **Records in the parent zone:** no new zone, so $0 extra. But the certificate check and the site record live in the management account, outside CDK, and are added by hand each time.

## Decision

Option 1, for dev only for now:

- **Address and DNS:** the dev app is served at `https://dev.jobdeputy.com`. Its zone lives in the dev account (stack `jobdeputy-dev-web-dns`), is kept if the stack is deleted, and is delegated from `jobdeputy.com` by `infra/bootstrap/05-delegate-web-zone.sh`.
- **Hosting:** stack `jobdeputy-dev-web` (us-east-1) is a private S3 bucket that CloudFront reads through Origin Access Control. It has an ACM certificate, A and AAAA alias records, price class 100, TLS 1.2 or later, and HTTP/2 and HTTP/3. Unknown paths serve `index.html`, the single-page-app routing.
- **Security headers:** a same-origin Content-Security-Policy, HSTS for one year, `X-Frame-Options: DENY`, and `nosniff`.
- **Releases:** each deploy of `main` uploads the built app (`apps/web/dist`) and invalidates `/*`. The app must be built before any synth, so `bin/app.ts` refuses to synthesize without it.
- **Access:** the site is open to anyone with the link. User data stays behind Cognito sign-in.
- **What gets no web stack:** personal and PR stacks, and prod until launch.

## Why

The maintainer chose the delegated zone so that DNS and certificates live in code with the rest of the stage, at $0.50 a month. That is the one approved exception to "nothing that costs money while idle" ([0005](0005-pre-launch-cost-guardrails.md)). Everything else bills per use and sits within CloudFront's always-free tier (1 TB and 10 million requests a month). The certificate is free, and one `/*` invalidation per deploy uses 1 of the 1,000 free paths a month.

## Consequences

- **First setup:** run `infra/bootstrap/07-stage-web.sh <stage>`, which deploys the zone and delegates it, before the web stack is first deployed. Otherwise its certificate waits for DNS that does not resolve.
- **If the zone is ever re-created:** it gets new name servers, so the script must run again. This is why the zone is kept.
- **CloudFront is global:** under [0004](0004-regional-cells-and-data-residency.md) it serves static app files only, and must never cache API responses or user data.
- **Later:** the CSP's `connect-src` gains the API origin in the task that first calls it. Cognito's (the US cell's Region) was added with sign-in (#14), along with the site's `/config.json`: the US cell's user pool and web client IDs, which the app reads before it signs anyone in. Prod's address (apex or `app.`) and one zone per prod account are decided at launch.
