# T05: Profile API (details, résumé, target roles)

- **Status:** planned
- **Depends on:** T04

## Goal

A user can create and update a profile with basic details, a résumé, and target roles.

## Scope

- In: Cognito sign-up and sign-in with the user's home Region chosen at signup ([0004](../decisions/0004-regional-cells-and-data-residency.md)), profile CRUD, résumé upload to S3 through presigned URLs, résumé text extraction, target roles, and validation.
- Out: AI-based résumé understanding (later, with BYOT).

## Research

To do. Storage is decided (S3 with presigned URLs, [0003](../decisions/0003-serverless-aws-stack.md)). Research how login finds the user's Region without a global directory, safe upload limits and file types, malware and content risks of uploaded files, and a PDF/DOCX text extraction approach inside Lambda.

## Decision

Pending.

## Done when

- [ ] Profile endpoints are tested, including invalid input and oversized or unsupported files.
- [ ] Users can access only their own profile.
