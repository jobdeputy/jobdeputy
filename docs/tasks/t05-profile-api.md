# T05: Sign-up, sign-in, and profile API

- **Status:** planned
- **Depends on:** T04

## Goal

Built in this order, as separate PRs:

1. **Auth and registration first:** a user signs up and signs in with Cognito, choosing their home Region at signup. The API switches from IAM authorization (T04) to the Cognito JWT authorizer.
2. **Profile:** the user creates and updates a profile with basic details, résumés, and target roles, stored in the `users`, `preferences`, and `documents` tables ([data model](../data-model.md)).

## Scope

- In: Cognito sign-up and sign-in with the user's home Region chosen at signup ([0004](../decisions/0004-regional-cells-and-data-residency.md)), profile CRUD, résumé upload to S3 through presigned URLs, résumé text extraction, target roles, and validation.
- Out: AI-based résumé understanding (later, with BYOT).

## Research

Carry-over from T04 (least privilege): once routes use the Cognito JWT authorizer, integration tests should call them as a test user, and the CI role's `execute-api:Invoke` (account-wide, because API IDs are generated at deploy time) should be removed or reduced to the IAM-only routes that remain.


To do. Storage is decided (S3 with presigned URLs, [0003](../decisions/0003-serverless-aws-stack.md)). Research how login finds the user's Region without a global directory, safe upload limits and file types, malware and content risks of uploaded files, and a PDF/DOCX text extraction approach inside Lambda.

## Decision

Pending.

## Done when

- [ ] Profile endpoints are tested, including invalid input and oversized or unsupported files.
- [ ] Users can access only their own profile.
