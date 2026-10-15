# Profile coverage: backend design → Profile UI

**Status:** written for the owner's round 2 review, 2026-10-03 (finding F9: "make sure we have all
the data that needs to be captured as part of our backend design"). It maps every backend field to
where `brand/profile-preview.html` captures it, and lists the gaps both ways. Nothing in the
backend or in `docs/data-model.md` was changed; section 9 lists recommendations for the owner.

Sources: `docs/data-model.md` (§1 users, §2 preferences, §11
answers, §12 applications.answers, §13 vault, change log to 2026-10-01),
`packages/shared/src/profile.ts` (`profileInput`, `searchInput`, `roleFields`, `money`, `place`,
`SENIORITY`), `packages/shared/src/crawl.ts` (`updateCrawlSettingsInput`), `apps/api/src/profile.ts`
and `me.ts`, and `docs/decisions/0006-data-model.md`. The page is `brand/profile-preview.html`;
every field below is listed once in its rules block (`GROUPS` and `COLLECTIONS`, each field with
the backend attribute it maps to), and `tests/prototype/profile.test.ts` fails if a key of
`profileInput`, `searchInput`, or the role fields, or a named APPLICANT, APPLY_SETTINGS, answers,
career, or company-rule attribute, has no field.

**Status** says where the backend stands today:

- **API**: an endpoint accepts it now (`PUT /me/profile`, `PUT /me/preferences/search`,
  `/me/roles`, `PUT /me/crawl-settings`, `PUT /me/ai-settings`, `DELETE /me`).
- **Read only**: set by the system and shown, never edited.
- **Phase 2**: designed in `docs/data-model.md`; arrives with automated applications (0006).
- **Planned**: designed for later (Future), or blocked on something not built yet.
- **None**: no backend field (UI-only, prototype).

**UI tag** is what the page shows. Sections carry their status in their title row (Career,
Application answers, and How your deputy applies say "Phase 2"); a field carries its own tag only
where it differs from its section ("Phase 2" on the street address in About you, "Planned" on the
résumé a role tailors from). Untagged means the API accepts it today. Every section also carries
"Sample data · not connected", because the prototype keeps everything in this browser.

**Store** is where the prototype saves it (`brand/sample-store.js`, through `update()`).

**Round 3 (2026-10-04).** The Profile's header card no longer has the 13-check "Profile strength"
ring or "N to add": it shows the shared need summary (`profile.missingRequired`,
`profile.missingOptional`) and red (required) or blue (optional) Add markers from
`JobDeputyStore.fieldStatus()`, and every field the store lists has a row `id="field-<key>"` (for
example `#field-profile.postalCode`). The "One of the 13 strength checks" notes below are kept as
history. Keep watch is now its own group (`#watch`) that sets each source's schedule with
`updateSource(id, { schedule })`, which answers G10 per source, as the backend stores it; the old
"How often your deputy looks" choice and `watch.requested` are gone from Profile (onboarding still
writes the flag for re-runs). City and Country, and Where you can work and Visa sponsorship, are
separate rows. Gmail (`#gmail`, read-only: one-time codes and status emails) and site accounts
(planned) sit under How your deputy applies.

## 1. `users` PROFILE (`PUT /me/profile`, `profileInput`)

| Backend attribute | UI: section → control | Status | UI tag | Store | Notes |
|---|---|---|---|---|---|
| `firstName` (required, ≤100) | About you → Name and headline → First name (text) | API | none | `profile.firstName` | Required, as the API requires |
| `lastName` (required, ≤100) | About you → Name and headline → Last name (text) | API | none | `profile.lastName` | **Fixed:** round 1 marked it optional, but `profileInput` requires it |
| `preferredName?` (≤100) | About you → Name and headline → Preferred name | API | none | `profile.preferredName` | Shown in the header card as "Goes by …" |
| `headline?` (≤200) | About you → Name and headline → Headline; header card | API | none | `profile.headline` | One of the 13 strength checks |
| `summary?` (≤5000) | About you → Name and headline → Summary (textarea) | API | none | `profile.summary` | Strength check |
| `yearsExperience?` (0 to 70) | About you → Name and headline → Years of experience | API | none | `profile.yearsExperience` | |
| `email` | About you → Contact (read only); Account → Sign-in | Read only | none | `profile.email` | The API takes it from Cognito on every save |
| `phone? {countryCode, number}` | About you → Contact → Phone (code + number) | API | none | `profile.phone` | Validated with the API's own patterns and messages |
| `location.city?` | About you → Contact → City | API | none | `profile.location` ("City, Region") | Prototype keeps one string for the other pages; see gap G4 |
| `location.region?` | About you → Contact → State or region | API | none | `profile.location` | |
| `location.country` (ISO alpha-2) | About you → Contact → Country (select) | API | none | `profile.country` | |
| `location.postalCode?` (≤20) | About you → Contact → Postal code | API | none | `profile.postalCode` | |
| `timezone?` (IANA) | About you → Contact → Time zone (select) | API | none | `profile.timezone` | Also the default for quiet hours |
| `address? {line1, line2?, …}` | About you → Contact → Street address, Apartment | Phase 2 | Phase 2 | `profile.address` | Accepted from Phase 2 and not in `profileInput`; the UI reuses city, region, postal code, and country (gap G5) |
| `links.linkedin?`, `github?`, `portfolio?`, `website?` (https, ≤500) | About you → Links → one field each | API | none | `profile.links.*` | https only, as the API's `httpsUrl` |
| `links.other` (≤10 https) | About you → Links → Other links (chips) | API | none | `profile.links.other` | |
| `skills` (≤100, each ≤60) | About you → Skills and languages → Skills (chips) | API | none | `profile.skills` | Limits enforced as in the API |
| `languages {name, level}` (≤20) | About you → Skills and languages → Languages (rows: name + level) | API | none | `profile.languages` | Levels: basic, conversational, professional, native |
| `homeCell` | Account → Home Region (locked); header card "US home Region" | Read only | none | none | Immutable; Region moves are a future workflow |
| `version` | Not shown | API | none | none | Optimistic concurrency; production sends the version it read |

## 2. `users` career items (prefilled from the default résumé; no endpoint yet)

| Backend attribute | UI: section → control | Status | UI tag | Store |
|---|---|---|---|---|
| `EXPERIENCE#` `title`, `company` | Career → Work history (timeline) → drawer: Job title, Company | Phase 2 | Phase 2 (section, drawer) | `career.experience[]` |
| `EXPERIENCE#` `employmentType?` | drawer: Employment type (select) | Phase 2 | Phase 2 | `career.experience[].employmentType` |
| `EXPERIENCE#` `location?` | drawer: Location | Phase 2 | Phase 2 | same |
| `EXPERIENCE#` `startDate` (yyyy-mm), `endDate?` | drawer: Started, Ended (month; empty means now) | Phase 2 | Phase 2 | same |
| `EXPERIENCE#` `description?` | drawer: Description (textarea) | Phase 2 | Phase 2 | same (a new key; the seed has none) |
| `EXPERIENCE#` `highlights L`, `skills L` | drawer: Highlights (one per line), Skills used (chips) | Phase 2 | Phase 2 | same |
| `EXPERIENCE#` `companyId?` | Not captured | Phase 2 | none | none (resolved by the system once `companies` exists, #40) |
| `EDUCATION#` `school`, `degree`, `field?`, `startDate?`, `endDate?`, `grade?`, `highlights L` | Career → Education → drawer (all seven) | Phase 2 | Phase 2 | `career.education[]` |
| `CERTIFICATION#` `name`, `issuer`, `issuedOn?`, `expiresOn?`, `credentialUrl?` | Career → Certifications → drawer (all five) | Phase 2 | Phase 2 | `career.certifications[]` |
| (none) "checked by you" | Career → "From Alex_Morgan_Resume.pdf" → Looks right | None | Phase 2 (section) | `career.checkedOn` (page-level key; UI-only, see G9) |

## 3. `preferences`

| Backend attribute | UI: section → control | Status | UI tag | Store | Notes |
|---|---|---|---|---|---|
| `SEARCH.workplace` | Job preferences → Where you’d work → Workplace (chips: remote, hybrid, on-site) | API | none | `profile.workStyles` | Any combination, at least one |
| `SEARCH.locations L<place>` (≤20) | Job preferences → Where you’d work → Places (chips) | API | none | `profile.locations` (strings) | Round 1 capped places at 10; now 20, as the API. Strings, not `{city, region, country}` (G4) |
| `SEARCH.employmentTypes` | Job preferences → Kind of role → Employment type (chips) | API | none | `preferences.employmentTypes` | None chosen means any type |
| `SEARCH.seniority` (`SENIORITY`) | Job preferences → Kind of role → Seniority (chips) | API | none | `preferences.seniority` | |
| `SEARCH.minSalary?` (money) | Job preferences → Kind of role → Minimum salary (amount, currency, per year/month/hour) | API | none | `preferences.minSalary` | Never converted; periods as the API's `money` |
| `SEARCH.excludeKeywords` (≤50, each ≤60) | Job preferences → Kind of role → Skip roles that mention (chips) | API | none | `preferences.excludeKeywords` | |
| `ROLE#.title` (≤120; ≤10 roles) | Job preferences → Target roles → drawer: Role | API | none | `profile.targetRoles` | Unique; at least one stays; renames move the details |
| `ROLE#.altTitles` (≤10) | drawer: Also search for (chips) | API | none | `preferences.roleDetails[title].altTitles` | |
| `ROLE#.seniority` | drawer: Seniority (chips) | API | none | `…seniority` | |
| `ROLE#.locations?` (≤20) | drawer: Places for this role (chips; empty uses your places) | API | none | `…locations` (a new key) | Was missing in round 1 |
| `ROLE#.mustHave`, `exclude` (≤30 each) | drawer: Must mention, Skip if it mentions (chips) | API | none | `…mustHave`, `…exclude` | |
| `ROLE#.priority` (1 to 100, default 50) | drawer: Priority (High, Normal, Low) | API | none | `…priority` (1 to 3) | Nothing reads it yet, so its direction is undefined (G6) |
| `ROLE#.active` | drawer: Search for this role (toggle); card shows Searching or Paused | API | none | `…active` | |
| `ROLE#.resumeDocumentId?` | drawer: Résumé to tailor from (select of the library) | Planned | Planned | `…resumeId` | In the data model but **not** in `roleFields`, so the API rejects it today (G1) |
| `COMPANY_RULE#<companyId>.mode` | Job preferences → Company rules → drawer: Rule (Prefer, Limit, Block) | Planned | Planned (group) | `preferences.companyRules[].mode` | Needs the shared company list (#40) |
| `COMPANY_RULE#.maxJobs`, `windowDays` (default 30) | drawer: Roles at most, Every how many days (shown for Limit) | Planned | Planned | `…maxJobs`, `…windowDays` | |
| `COMPANY_RULE#.countsOn` | Shown as text: "counted as found" | Planned | Planned | none | `applied` comes later; not a choice yet |
| `COMPANY_RULE#.extraCompanyIds` | drawer: Also count (chips of names) | Planned | Planned | `…extraCompanies` (a new key) | Names, not ids (G7) |
| `COMPANY_RULE#.note?` | drawer: Note | Planned | Planned | `…note` | |
| `COMPANY_RULE#*` (the default) | Company rules → "Every other company" → drawer: No limit or Limit | Planned | Planned | `preferences.defaultCompanyRule` (page-level) | "No limit" is no item (G8) |
| `CRAWL_SETTINGS.dailyLimit?` (1 to admin max; absent = default) | Job preferences → How often your deputy looks → Searches a day (empty = default 20, at most 50) | API | none | `crawlSettings.dailyLimit` (page-level section) | **No page captured it before** |
| `sources.schedule.type` (manual now; daily later) | Job preferences → How often your deputy looks → When I ask / Every day, with Keep watch | Planned (daily) | "Premium · planned for launch" | `watch.schedule` stays `manual`; `watch.requested = 'daily'` | Per source in the backend, per person in the UI (G10) |
| `AI_SETTINGS.defaultSource` | Account → Access and AI → Next search uses (read here; changed on AI & credits) | API | none | `localStorage['jobdeputy-ai-source']` | Owned by AI & credits |
| `APPLY_SETTINGS.mode` (`off`, `review_each` default, `auto_within_rules` Phase 2) | How your deputy applies → Mode (choice cards, saved on choice) | Phase 2 | Phase 2; "Planned for Phase 2" on Within your rules (disabled) | `applySettings.mode` | The store comment says `within_rules` (G11) |
| `APPLY_SETTINGS.dailyMax` | How your deputy applies → Limits and reviews → Applications a day, at most (1 to 20) | Phase 2 | Phase 2 | `applySettings.dailyMax` | No backend bound (G12) |
| `APPLY_SETTINGS.alwaysReview L` | Limits and reviews → Always ask me about (chips: cover letters, custom questions, pay questions, start date questions) | Phase 2 | Phase 2 | `applySettings.alwaysReview` | Values beyond the doc's two examples (G12) |
| `APPLY_SETTINGS.quietHours? {start, end, timezone}` | Quiet hours and email → Quiet from, Until, Time zone | Phase 2 | Phase 2 | `applySettings.quietHours` (now with `timezone`) | The seed lacked `timezone`; the page saves it |
| `APPLY_SETTINGS.notify {email B}` | Quiet hours and email → Email me when an application needs me | Phase 2 | Phase 2 | `applySettings.notifyEmail` | Flat key in the store (G11) |

## 4. `users` APPLICANT (Phase 2; used only on application forms)

| Backend attribute | UI: section → control | Status | UI tag | Store |
|---|---|---|---|---|
| `workAuthorization L<{country, status, visaType?, expiresOn?}>` | Application answers → Work eligibility → Where you can work (rows: country, status, visa type and expiry when on a visa) | Phase 2 | Phase 2 (section) | `applicant.workAuthorization` |
| `needsSponsorship M<country, B>` | Same rows → Needs visa sponsorship (per country) | Phase 2 | Phase 2 | `applicant.needsSponsorship` |
| `over18 B` | Work eligibility → Are you 18 or older? (Yes/No) | Phase 2 | Phase 2 | `applicant.over18` |
| `securityClearance?` | Work eligibility → Security clearance (empty if none) | Phase 2 | Phase 2 | `applicant.securityClearance` |
| `noticePeriodDays?` | Availability → Notice period, in days (0 to 365) | Phase 2 | Phase 2 | `applicant.noticePeriodDays` |
| `earliestStartDate?` | Availability → Earliest start date (today or later), help "Used only to answer application forms." | Phase 2 | Phase 2 | `applicant.earliestStartDate` |
| `currentCompensation?` (money) | Pay → Current pay (amount, currency, period) | Phase 2 | Phase 2 | `applicant.currentCompensation` |
| `expectedCompensation?` (money) | Pay → Expected pay; header card "Add expected pay" | Phase 2 | Phase 2 | `applicant.expectedCompensation` (also what the autofill preview's "Save to Profile" writes) |
| `willingToRelocate B`, `relocationCountries L` | Relocation and travel → Willing to relocate? (Yes/No), Countries you’d move to (chips) | Phase 2 | Phase 2 | `applicant.willingToRelocate`, `applicant.relocationCountries` |
| `maxTravelPercent?` | Relocation and travel → Travel (0, 10, 25, 50, 75, as much as needed) | Phase 2 | Phase 2 | `applicant.maxTravelPercent` |
| `formerEmployers L<companyId>` | Former employers → Companies you’ve worked for (chips of names) | Phase 2 | Phase 2 | `applicant.formerEmployers` (names, G7) |

## 5. `answers` (Phase 2) and `applications.answers`

| Backend attribute | UI: section → control | Status | UI tag | Store |
|---|---|---|---|---|
| `question` | Application answers → Saved answers → drawer: Question | Phase 2 | Phase 2 | `answers[].question` |
| `answerId` (hash of the normalized question) | Duplicate questions are refused ("You already have an answer for this question.") | Phase 2 | none | `answers[].id` (from the question) |
| `category` | drawer: Kind of question (work authorization, pay, availability, experience, motivation, other) | Phase 2 | Phase 2 | `answers[].category` |
| `answerType`, `options? L` | drawer: Answer type; Choices (for "one of a few choices") | Phase 2 | Phase 2 | `answers[].answerType`, `…options` |
| `answer` | drawer: Your answer (checked against the type: Yes or No, a number, a date, one of the choices) | Phase 2 | Phase 2 | `answers[].answer` |
| `scope` (`global` or a `companyId`) | drawer: Use it for (Every employer / One company + Company) | Phase 2 | Phase 2 | `answers[].scope` (a company name, G7) |
| `source` (`user`, `llm_suggested`), `approved B` | Card: "Suggested by your deputy · waiting for you" and Approve; "Approved" or "Approved suggestion" | Phase 2 | Phase 2 | `answers[].source`, `…approved` (an edit makes it yours: `user`, approved) |
| `useCount N`, `lastUsedAt?` | Card meta: "Used 3 times · last Oct 1, 2026" (shown, not edited) | Phase 2 | Phase 2 | `answers[].useCount`, `…lastUsedAt` (the seed has no `lastUsedAt`) |
| Sensitive questions never stored here | The drawer refuses gender, ethnicity, veteran, disability, and government ID or bank questions | Phase 2 | none | none |
| `applications.answers L<{question, answerId?, source}>` | Not on Profile: the autofill preview (B6) records which saved answer each form question used; Profile shows the reuse as Used N times | Phase 2 | none | B6's application records |

## 6. `vault` (Future; 0006 principle 4: nothing for the vault is collected before it is built)

| Backend attribute | UI: section → control | Status | UI tag | Store |
|---|---|---|---|---|
| `SENSITIVE` equal-opportunity answers (default "decline to answer") | Application answers → Voluntary self-identification (`#self-id`, round 3): gender (Woman, Man, Non-binary, Prefer to self-describe with its words, Prefer not to say), Hispanic or Latino, race (US EEO categories, several allowed), protected veteran status, and disability, each with "I don't wish to answer"; the purpose stated; never marked missing, counted, or nudged | Planned | Planned (this prototype keeps it in this browser) | `selfId` (`gender`, `genderSelfDescribe`, `ethnicity`, `race`, `veteran`, `disability`; `mode` 'decline' or 'saved') through `setSelfId` and `clearSelfId` |
| `SENSITIVE.dateOfBirth` | Sensitive answers → Date of birth: "Not collected · Planned · kept encrypted, only for forms that require it" | Planned | Planned | none |
| Never stored (0006 principle 5) | Sensitive answers → Never stored: government ID numbers and bank or card details | n/a | none | none |
| `SITE_LOGIN#<domain>` (`username`, `ciphertext`, `createdBy`, `lastLoginAt?`) | How your deputy applies → Site accounts: the accounts your deputy would create on employers' sites, password in your vault (empty state) | Planned | Planned | `siteLogins` (empty) |
| (no backend field yet) Gmail connection | How your deputy applies → Gmail (`#gmail`): the address, read-only access, what it reads (one-time codes from job sites, status emails from employers), what it never does, Disconnect, and Connect with a consent step | None (prototype) | Planned | `connections.gmail` through `connectGmail` and `disconnectGmail` |

## 7. Account

| Backend | UI | Status | UI tag |
|---|---|---|---|
| Cognito email and sign-in methods | Account → Sign-in: email (read only), Email and password (Primary), Google (Connected, prototype) | API (Cognito) | "Connected in this prototype. No Google request is made." |
| Password change (Cognito) | Account → Sign-in → Change password (inline form, sign-in rules) | Not connected in the prototype | "Nothing was changed" notice |
| `homeCell` | Account → Home Region, locked, with the shield | Read only | none |
| `DELETE /me` + `users.DELETION` (T12; confirm phrase; sign in again after 15 minutes) | Account → Your data → Request account deletion → drawer with what is erased and "delete my account" | API | "Prototype only: nothing is deleted and no request is sent." |
| Export (everything under `users/<userId>/`, data model S3 layout) | Account → Your data → Export → Download a copy (a notice) | Planned | Planned |

## 8. UI-only fields (no backend field)

| UI field | Where | Decision and recommendation |
|---|---|---|
| `profile.helpWith` (roles, tailoring, applying, tracking) | Onboarding step 1 only | Not shown on Profile (setup owns it; Help has "Run setup again"). Add `users.PROFILE.helpWith L` if the product keeps using it, otherwise drop it. |
| `profile.priorities` ("what matters most") | **Removed from Profile** | No backend field and nothing ranks on it, so asking would collect data the deputy cannot use. The page keeps old saves readable but never shows or writes it. If the owner wants it, propose `preferences.SEARCH.priorities L` (growth, balance, strengths, skills) together with relevance reasons that use it. |
| `profile.startTiming` | **Removed** (F4) | Jobs carry no start dates, so it never affected ranking. Forms use `APPLICANT.noticePeriodDays` and `earliestStartDate`, now in Application answers → Availability. |
| `watch.requested = 'daily'` | Job preferences → How often your deputy looks | A pre-launch interest flag for Keep watch. Propose a user-level default schedule (G10) and keep the request as a product signal, not user data. |
| `career.checkedOn` | Career → Looks right | Propose `confirmedAt` on career items, or `source: resume \| user` per item (G9). |
| `preferences.defaultCompanyRule` | Company rules → Every other company | Maps to `COMPANY_RULE#*` (G8). |
| `crawlSettings.dailyLimit` | How often your deputy looks → Searches a day | Maps to `CRAWL_SETTINGS.dailyLimit`; only the store section is new. |
| Profile photo | Header card → Change photo | Prototype only (shown on the page, never uploaded), as `docs/ui-foundation.md` requires. Propose `users.PROFILE.photo? {s3Key}` with a scanned upload like documents. |

## 9. Gaps found (both ways) and recommended backend additions

| # | Gap | Recommendation |
|---|---|---|
| G1 | `ROLE#.resumeDocumentId` is in the data model but not in `roleFields`, so `POST`/`PUT /me/roles` reject it (strict objects) | Add `resumeDocumentId: z.string().optional()` (a document the user owns) to `createRoleInput` and `updateRoleInput` |
| G2 | APPLICANT, career items, `answers`, and APPLY_SETTINGS have no input schemas or routes | Add Zod schemas with bounds (lists, string lengths) and `GET`/`PUT /me/applicant`, `/me/career/*`, `/me/answers`, `/me/apply-settings` before Phase 2 |
| G3 | Lists without bounds in the data model: `formerEmployers`, `relocationCountries`, `answers`, career items, `highlights` | The prototype uses 30 employers, 50 answers, 20 roles held, 10 schools, 20 certifications, 10 highlights; adopt or replace these in the schemas |
| G4 | `SEARCH.locations` and `PROFILE.location` are structured (`{city?, region?, country}`); the prototype keeps "City, Region" strings for the other pages | Production needs a place picker that returns structured places with an ISO country |
| G5 | `PROFILE.address` repeats city, region, postal code, and country | Decide whether the address may differ from `location`; the UI currently reuses `location` and asks only for line 1 and line 2 |
| G6 | `ROLE#.priority` is 1 to 100 (default 50) but nothing defines its direction | Document it (for example, a higher number ranks first) or store a rank; the UI offers High, Normal, Low |
| G7 | Company references are ids in the backend (`COMPANY_RULE#<companyId>`, `extraCompanyIds`, `formerEmployers`, `answers.scope`) but names in the UI | Resolve names through `companies` and `company-aliases` (#40) when saving, and keep the typed name for display |
| G8 | `COMPANY_RULE#*` lists the same modes as a company rule; "no limit" has no item | State that no `COMPANY_RULE#*` item means no limit, and allow only `limit` for it |
| G9 | Nothing records that the person checked the career prefilled from a résumé | Add `confirmedAt` (or `source`) to EXPERIENCE#, EDUCATION#, and CERTIFICATION# items |
| G10 | Schedule is per source (`sources.schedule.type`) but the person chooses once | Add a user default (for example `preferences.SEARCH.defaultSchedule` or `CRAWL_SETTINGS.defaultSchedule`) that new sources inherit |
| G11 | Naming between the store and the data model: `within_rules` vs `auto_within_rules`, `notifyEmail` vs `notify.email` | Done for the mode (the store says `auto_within_rules`). `notifyEmail` stays a flat sample key; production uses `notify.email` |
| G12 | `APPLY_SETTINGS.dailyMax` has no bound; `alwaysReview` has examples, not an enum | Bound `dailyMax` (the UI uses 1 to 20) and define `alwaysReview` values (the UI adds `compensation` and `availability`) |
| G13 | `answers.lastUsedAt` exists but the seed had none, so "last used" never showed in the sample | Done: the three approved answers carry `lastUsedAt` in the sample store |
| G14 | Self-identification "mode" (decline by default) is only a store key; the vault holds only ciphertext | Keep a non-sensitive `selfIdMode` (decline or saved) outside the ciphertext so forms know what to do without decrypting |
| G15 | Forms often ask for a pay range; `expectedCompensation` is one amount | Consider `{min?, max?}` like `jobs.salary`, or keep one amount and let forms show it as both ends |
| G16 | `CRAWL_SETTINGS.dailyLimit` had no UI anywhere | Now on Profile; the orchestrator may prefer Searches. The admin maximum (50) should come from `GET /me/crawl-settings` (`maxAllowed`) rather than a constant |

## 10. What the API accepts today versus what the page captures

- Accepted by the API and captured: every `profileInput` key; every `searchInput` key; every role
  field; `CRAWL_SETTINGS.dailyLimit`; `AI_SETTINGS.defaultSource` (on AI & credits); `DELETE /me`.
- Captured, waiting for Phase 2: APPLICANT (12 attributes), career items (3 kinds, 21 attributes),
  `answers` (10 attributes), APPLY_SETTINGS (5 attributes), `PROFILE.address`.
- Shown as planned, not collected: vault date of birth, SITE_LOGIN#; export; Within your rules;
  company rules; a role's résumé.
- Planned, but captured in this browser only (round 3): voluntary self-identification (decision
  0006 principle 4 still holds for production: the real form waits for the vault), the Gmail
  connection (no backend field yet), and each source's nightly schedule (Keep watch).
- System or read only: `email`, `homeCell`, `version`, `EXPERIENCE#.companyId`, `answers.answerId`,
  `useCount`, `lastUsedAt`.
