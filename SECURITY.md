# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through GitHub: **Security → Report a vulnerability** on this repository. Include steps to reproduce, the impact, and any suggested fix. We aim to acknowledge reports within 3 business days.

## Scope

We are especially interested in:

- exposure or misuse of user-supplied credentials (BYOT API keys);
- access to another user's profile, résumé, or jobs;
- server-side request forgery (SSRF) or internal-network access through the URL crawler;
- injection, including prompt injection from crawled pages that leads to unsafe actions.

## Supported versions

The project is pre-release. Only the latest `main` is supported.
