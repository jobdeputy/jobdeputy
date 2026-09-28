# T05: Sign-up, sign-in, and profile API

- **Status:** awaiting-alignment
- **Branch / PR:** part 1 `t05-auth`, [#14](https://github.com/jobdeputy/jobdeputy/pull/14) (merged); part 2 `t05-profile`
- **Depends on:** T04

## Goal

Built in this order, as separate PRs:

1. **Auth and registration first:** a user signs up and signs in with Cognito, choosing their home Region at signup. The API switches from IAM authorization (T04) to the Cognito JWT authorizer.
2. **Profile:** the user creates and updates a profile with basic details, résumés, and target roles, stored in the `users`, `preferences`, and `documents` tables ([data model](../data-model.md)).

## Scope

- In: Cognito sign-up and sign-in with the user's home Region chosen at signup ([0004](../decisions/0004-regional-cells-and-data-residency.md)), profile CRUD, résumé upload to S3 through presigned URLs, résumé text extraction, target roles, and validation.
- Out: AI-based résumé understanding (later, with BYOT).

## Research

Part 1 (auth and registration) is below. [Part 2](#part-2-research-profile-roles-and-résumés) (profile, roles, and résumés) follows it.

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

### Part 2 research: profile, roles, and résumés

Tables and fields are fixed by [docs/data-model.md](../data-model.md). This decides the API, uploads, safety, and text extraction. Every route is under `/me` and keyed on the token's `userId`, so a user can only ever reach their own data.

#### 1. What the current slice stores

| Item | Now | Later |
|---|---|---|
| `users` → `PROFILE` | Name, phone, location, links, headline, summary, years of experience, skills, languages, timezone. `email` is copied from Cognito and is read-only here. `homeCell` is set by the server. | — |
| `preferences` → `SEARCH` and `ROLE#<id>` | Search settings and target roles (**at most 10**). | Company rules with the relevance filter (T08); apply settings in Phase 2. |
| `documents` | Uploaded résumés (**at most 10**), one of them the default. | Cover letters and generated documents. |
| `APPLICANT`, `EXPERIENCE#`, `EDUCATION#`, `CERTIFICATION#` | Not yet. | Phase 2 (application forms). |

#### 2. API

| Route | Behaviour |
|---|---|
| `GET /me/profile`, `PUT /me/profile` | Returns an empty profile until the first save. `PUT` replaces the editable fields and uses a `version` number: if two tabs save at once, the second gets `409 Conflict` instead of silently overwriting. |
| `GET /me/preferences/search`, `PUT` | The same pattern. |
| `GET /me/roles`, `POST /me/roles`, `PUT /me/roles/{roleId}`, `DELETE /me/roles/{roleId}` | CRUD. `POST` is rejected past 10 roles. |
| `POST /me/documents` | Starts an upload. Returns a `documentId` and a **presigned POST** (below). The item is created with `status = uploading`. |
| `GET /me/documents`, `GET /me/documents/{id}` | Status (`uploading → scanning → processing → ready`, or `rejected` / `failed` with a reason) and a short-lived download link. |
| `PUT /me/documents/{id}` | Rename, or make it the default. |
| `DELETE /me/documents/{id}` | Deletes the item and its S3 objects. |

All input is validated with Zod: strict objects, length limits on every string, list size limits, and URL checks on links.

#### 3. Uploading résumés

- **Presigned POST, not PUT.** Only a POST policy can make S3 itself enforce the rules: the exact key, a **5 MB** limit (`content-length-range`), the content type, and a 5-minute expiry. The browser uploads straight to S3, so no file passes through Lambda.
- **Allowed types: PDF and DOCX only.** No `.doc`, images, or others.
- **The content type is never trusted.** The worker checks the file's real signature: PDF starts with `%PDF-`; DOCX is a ZIP that contains `word/document.xml`.
- **Bucket:** one per cell (0004), all public access blocked, S3-managed encryption (free), HTTPS only. Keys are `users/<userId>/documents/<documentId>/…`, so deleting an account removes one prefix. Unfinished uploads are cleaned up after 1 day.
- **Downloads:** presigned GET links, valid for 5 minutes, sent as an attachment (never shown inline). Only the owner can get them.

#### 4. Malware and malicious files

Résumés come from users. Today only the owner downloads their own file, but in Phase 2 we would send the file to job sites, and our parser reads every file.

| Option | Assessment |
|---|---|
| **GuardDuty Malware Protection for S3 (recommended)** | Fully managed and can run on its own without the rest of GuardDuty. It scans every new object in the bucket and tags it with the result. **Pay per use, $0 idle.** Free tier: 1,000 objects and 1 GB per month. After that, $0.215 per 1,000 objects plus $0.09 per GB ([pricing](https://aws.amazon.com/guardduty/pricing/), checked 2026-09-28). A 5 MB résumé costs about $0.0007 to scan. It is in all three launch Regions. |
| ClamAV in a Lambda container | Free to run, but virus definitions must be updated constantly, the image is large (stored in ECR, a small idle cost), and we would maintain it ourselves. |
| No scanning; limits only | Cheapest, but we would pass unscanned files to job sites in Phase 2. |

**Flow:** upload → GuardDuty scan → the result arrives through EventBridge.

- Clean files are queued for text extraction.
- Infected files are **deleted**, and the document becomes `rejected` with the reason "failed malware scan".

The parser also has its own limits, because a clean scan does not rule out every harmful file:

- at most 5 MB and 20 pages;
- decompressed DOCX size checked before reading, against zip bombs;
- a 60-second timeout;
- pdf.js with script evaluation turned off (a past pdf.js vulnerability);
- the worker has no access to other users' data.

#### 5. Text extraction (asynchronous)

The text of the résumé is extracted in a worker, the same way as T04: S3 → scan → queue with dead-letter queue (3 attempts) → worker.

| Library | For | Notes |
|---|---|---|
| **`unpdf`** 1.8.1 (MIT) | PDF | A serverless build of Mozilla's pdf.js, maintained (updated 2026-08). |
| **`mammoth`** 1.13.0 (BSD-2) | DOCX | Plain-text extraction; maintained (updated 2026-09). |

- The text is saved to S3 as `users/<userId>/documents/<documentId>/text.txt` (at most 200 KB). The item records the page and character counts.
- **Scanned-image PDFs** have no text layer. They end as `ready` with a "no text found; upload a text-based PDF or DOCX" warning. OCR (for example AWS Textract, which is paid per page) could be added later.
- Understanding the résumé (skills, experience) needs AI and comes later with BYOT ([0002](../decisions/0002-llm-loop-and-token-budget.md)). Nothing here calls an LLM.

#### 6. Delivery: two PRs

1. **2a:** profile, search settings, and roles (the `users` and `preferences` tables). Small, and no files.
2. **2b:** résumé upload, scanning, and extraction (the `documents` table, bucket, GuardDuty, and worker).

Each PR carries its own unit and integration tests. Integration tests upload small synthetic PDF and DOCX files (never real résumés) and check that a fake PDF is rejected, an oversized upload is refused by S3, and another user cannot read or download the document.

#### Open questions (part 2)

1. **Two PRs** (2a profile and roles, then 2b résumés)?
2. **Now vs later:** profile, search settings, and roles now; application details, work history, and education in Phase 2?
3. **Limits:** PDF and DOCX only, 5 MB, 20 pages, at most 10 résumés and 10 roles?
4. **GuardDuty malware scanning** (pay per use: free for 1,000 files a month, then about $0.0007 per résumé; $0 idle)? It is a new paid-per-use service, so it needs your OK under 0005.
5. **Scanned PDFs** end as "ready, no text found" for now, with OCR later?

## Decision

Part 1, agreed with the maintainer on 2026-09-28 (all five recommendations):

1. One Cognito user pool per cell on the **Essentials** plan.
2. **Email is the only sign-in and required attribute** in Cognito (permanent). Everything else lives in our tables.
3. The home Region is the cell that handles the signup. The UI uses a **Region picker plus a per-Region address** (T09 and launch). There is no global directory.
4. **SES for production email** is a release blocker ([#13](https://github.com/jobdeputy/jobdeputy/issues/13)).
5. **Every route uses the JWT authorizer**, including ping. CI loses `execute-api:Invoke` and gains only four Cognito admin calls for test users.

## Done when

Part 1 (auth):

- [x] Each cell has a Cognito pool; `GET /me` returns the caller's `userId`, email, and `homeCell`.
- [x] Every API route requires a valid token; no token, invalid tokens, and another user's data are rejected (integration tests).
- [x] CI no longer has `execute-api:Invoke`; its Cognito permissions are the four admin calls only.

Part 2 (profile):

- [ ] Profile endpoints are tested, including invalid input and oversized or unsupported files.
- [ ] Users can access only their own profile.
