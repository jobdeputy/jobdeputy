# T09: User interface for the slice

- **Status:** planned
- **Depends on:** T05, T06, T08

## Goal

A user can complete the flow in the browser: profile, submit a URL, watch the crawl status, and browse the stored jobs.

## Scope

- In: profile page, URL submission, crawl status with live or polled updates, job list and job detail, empty, loading, and error states, basic accessibility.
- Out: materials generation UI.

## Research

To do. Hosting is decided (S3 and CloudFront per [0003](../decisions/0003-serverless-aws-stack.md)), and the UI talks to the user's home-Region API ([0004](../decisions/0004-regional-cells-and-data-residency.md)). For status updates, compare polling (the default), the API Gateway WebSocket API, and AppSync subscriptions. API Gateway HTTP APIs do not support server-sent events.

## Decision

Pending.

## Done when

- [ ] The flow works end to end in the browser, with screenshots or a recording in the PR.
- [ ] Error states are visible and understandable.
