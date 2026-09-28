# T05: Sign-up, sign-in, and profile API

- **Status:** awaiting-alignment
- **Branch / PR:** `t05-auth` (part 1)
- **Depends on:** T04

## Goal

Built in this order, as separate PRs:

1. **Auth and registration first:** a user signs up and signs in with Cognito, choosing their home Region at signup. The API switches from IAM authorization (T04) to the Cognito JWT authorizer.
2. **Profile:** the user creates and updates a profile with basic details, résumés, and target roles, stored in the `users`, `preferences`, and `documents` tables ([data model](../data-model.md)).

## Scope

- In: Cognito sign-up and sign-in with the user's home Region chosen at signup ([0004](../decisions/0004-regional-cells-and-data-residency.md)), profile CRUD, résumé upload to S3 through presigned URLs, résumé text extraction, target roles, and validation.
- Out: AI-based résumé understanding (later, with BYOT).

## Research

This round covers **part 1 (auth and registration)**. Part 2 (profile, résumé upload, and text extraction) is researched when part 1 is merged, so the topics listed for it (upload limits, file risks, PDF/DOCX extraction) stay open.

### 1. One Cognito user pool per cell

Decided by [0004](../decisions/0004-regional-cells-and-data-residency.md): each cell (`iad` now; `bom` and `lhr` at launch) has its own pool, so accounts and logins never leave their Region. The user's `userId` is the pool's `sub` ([0006](../decisions/0006-data-model.md)).

**Feature plan** ([pricing](https://aws.amazon.com/cognito/pricing/), checked 2026-09-28):

| Plan | Price | Includes | Assessment |
|---|---|---|---|
| Lite | 10,000 monthly active users free (permanently), then $0.0055 each | Password sign-in, MFA, managed login page | Enough today, but no passwordless or passkeys later. |
| **Essentials (recommended)** | 10,000 free (permanently), then $0.015 each | Lite, plus email one-time codes, passwordless, and passkeys | $0 now. Keeps modern sign-in options open without a migration. |
| Plus | $0.02 each, **no free tier** | Essentials, plus threat protection | Costs money from the first user; revisit at launch. |

### 2. Pool settings (some are permanent)

Cognito's sign-in attributes and required attributes **cannot be changed after the pool exists**, so they are chosen carefully:

| Setting | Recommendation | Why |
|---|---|---|
| Sign-in | **Email only**, case-insensitive | One identifier; `Alice@x.com` and `alice@x.com` are the same account. |
| Required attributes | **Email only**. Name and everything else live in our `users` table. | Our table can change and is in the data model. Cognito's schema cannot. |
| Self sign-up | On, with an email verification code | The account exists only after the email is proven. |
| Password | At least 12 characters, no forced symbol rules (current NIST guidance) | Length matters most. |
| MFA | Optional, authenticator app (TOTP) only | **No SMS**: it costs money per message and is weaker. |
| Account recovery | Email only | Same reason. |
| User-existence errors | Hidden | Login and reset do not reveal whether an email is registered. |
| Tokens | Access and ID 1 hour, refresh 30 days | Common defaults. |
| Deletion | Pool kept (retain policy and deletion protection) in prod; destroyed with dev stacks | Deleting a prod pool would delete every account. |

**Email sending:** Cognito's built-in email is free but limited to **50 emails per day** per account. That is fine for dev. Prod needs Amazon SES in each Region, with a verified domain (jobdeputy.com) and SES production access. **This is a launch task.** I propose adding it as a release blocker.

### 3. Home Region at signup, and finding it at login (no global directory)

The backend needs nothing special: **the cell that handles the signup is the home Region**. Whoever signs up through the India API is an India user, and their data never leaves `bom`. The Region choice is therefore a UI and routing concern:

| Option | Assessment |
|---|---|
| **Region picker plus a Region per address (recommended)** | Before signup, the user picks "United States / India / United Kingdom", and the UI talks to that Region's pool and API. At launch each Region gets its own address (for example `us.`, `in.`, and `uk.jobdeputy.com`). The browser remembers the choice. At login, a user on a new device picks their Region again; "Account not found? Your data may be in another Region" links to the other two. |
| A global email → Region directory | Forbidden by 0004 (a central store of user data). |
| A global directory of email hashes | A hashed email is still personal data (pseudonymous) under UK GDPR and India's DPDP Act. Same problem. |
| Try all three Regions at login | Sends the email and password to Regions that do not hold the account, and helps attackers discover accounts. |

For T05 this means: every cell exposes its own auth endpoints, and the API records `homeCell` from the cell it runs in. The picker screen and addresses are built in T09 and at launch.

### 4. API authorization

- User routes use the HTTP API **JWT authorizer**: the issuer is the cell's pool, and the audience is the web app client. Invalid or expired tokens are rejected by API Gateway before any Lambda runs, which costs nothing.
- **`userId` always comes from the token's `sub`**, never from the request body or URL. Every repository call is keyed on it, which enforces "users can only access their own data".
- A new `GET /me` route returns the caller's `userId`, email, and `homeCell`. It proves auth end to end and is the entry point for the profile in part 2.
- **The ping routes move to the JWT authorizer as well**, so every route works the same way.

### 5. Integration tests with real users (and least privilege)

Self sign-up needs a code from an inbox, which tests cannot read. So each test run:

1. Creates a unique throwaway user with the admin API (`AdminCreateUser` plus `AdminSetUserPassword`, confirmed, no email sent).
2. Signs in with `ADMIN_USER_PASSWORD_AUTH`, which works only for AWS principals with IAM access, never from a browser.
3. Calls the API with the token, and also checks that no token, an invalid token, and **another user's data** are rejected.
4. Deletes the user.

**CI permissions:**

- Remove `execute-api:Invoke` (the T04 carry-over). Nothing uses IAM auth any more.
- Add only `cognito-idp:AdminCreateUser`, `AdminSetUserPassword`, `AdminInitiateAuth`, and `AdminDeleteUser`. Pool IDs are generated at deploy, so they cannot be named, but CI runs only in the dev account, which holds only test users.

The public web client allows only secure sign-in (SRP) and refresh. The admin sign-in flow is enabled on a separate `tests` app client.

### 6. Abuse and cost

- Sign-up is free, and API Gateway throttling (5 per second, burst 10) and Cognito's own limits apply.
- Bots creating accounts: the email verification limits damage. A pre-sign-up check (for example, blocking disposable email domains) or WAF (costs money) is considered in T10 or at launch.
- **Cost: $0** (Essentials free tier, built-in email, no SMS).

### 7. Not in part 1

- The sign-up and sign-in screens, and the choice between Cognito's managed login page and our own screens: T09 (UI).
- Social sign-in (for example Google): later. It needs OAuth app credentials.
- Profile data, résumé upload and extraction: part 2.

### Open questions

1. Cognito **Essentials** plan ($0 up to 10,000 active users; keeps passwordless and passkeys possible)?
2. **Only email** required in Cognito, and everything else in our tables? This one is permanent.
3. The **Region picker plus a per-Region address** approach for finding a user's Region?
4. **SES for production email** added as a release blocker?
5. **Ping routes move to the JWT authorizer**, and CI swaps `execute-api:Invoke` for the four Cognito admin permissions?

## Decision

Pending.

## Done when

Part 1 (auth):

- [ ] Each cell has a Cognito pool; `GET /me` returns the caller's `userId`, email, and `homeCell`.
- [ ] Every API route requires a valid token; no token, invalid tokens, and another user's data are rejected (integration tests).
- [ ] CI no longer has `execute-api:Invoke`; its Cognito permissions are the four admin calls only.

Part 2 (profile):

- [ ] Profile endpoints are tested, including invalid input and oversized or unsupported files.
- [ ] Users can access only their own profile.
