# JobDeputy brand

The animated identity preserves the original idea—a `JD` monogram and a panda—while redrawing it
as a clean, scalable SVG.

## Canonical identity

The panda perched on the large `JD` monogram is JobDeputy's primary visual signature. Product
surfaces MUST use this identity instead of inventing a generic `JD` tile, unrelated panda mark, or
page-specific logo.

- Use `jobdeputy-animated.svg` for opening loaders, onboarding, and dedicated brand moments where
  the search-and-return story has enough space to remain legible.
- Use `jobdeputy-mark.svg` for persistent compact navigation and headers. It is the static final
  pose of the same panda-on-`JD` identity, cropped for small horizontal lockups.
- Pair the compact mark with the `JobDeputy` wordmark when space permits.
- Do not continuously replay the full logo animation in persistent navigation. Motion should mark
  arrival or explain work, not compete with the current task.
- Preserve the original proportions, black/paper panda treatment, bamboo green, selected-card
  detail, and warm editorial context across implementations.

## Run the prototype

The latest prototype on `main` is published at <https://jobdeputy.github.io/jobdeputy/> (sample
data only; [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)). To run it locally:

The prototype is static HTML, CSS, and JavaScript with no build step. Serve the repository root so
every page shares one origin (and one sample world in `localStorage`):

```sh
python3 -m http.server 8001 --bind 127.0.0.1
```

Then open <http://localhost:8001/brand/login-preview.html> (sign in) or
<http://localhost:8001/brand/home-preview.html?skipLoader> (the Dashboard). Every page and its
query parameters are listed in [`docs/prototype-map.md`](../docs/prototype-map.md). To run the
prototype tests: `pnpm install`, then `pnpm --filter @jobdeputy/prototype-tests test`.

Before changing any screen, read [`docs/ui-foundation.md`](../docs/ui-foundation.md),
[`docs/design-system.md`](../docs/design-system.md), and the UI SOP
[`agent-sops/build-jobdeputy-ui.sop.md`](../agent-sops/build-jobdeputy-ui.sop.md).

## Preview

Open `preview.html` in a browser. The preview includes controls to replay the search story and drive
the underline as loading progress.

Open `login-preview.html` for the humorphic login concept. Its panda behaves as a teammate: it
notices which field has focus, covers its eyes for passwords (including revealed passwords),
clarifies the home-Region choice, reacts calmly to validation and authentication errors, and
celebrates a completed prototype sign-in without sending credentials.
The form includes inline validation, a summarized error state, caps-lock feedback, an
interaction-locked pending state, and generic authentication recovery.
Provider, password-reset, account-creation, validation, and authentication outcomes use the shared
feedback-panel system. Contextual notices stay beside the control that caused them, expose a clear
recovery when one exists, and use separate screen-reader announcement channels instead of a loose
form-wide status message.
After the canonical animated JD mark, the panda first looks around for the deputy, realizes the
deputy is itself, and wonders what it can do. It then performs a capability story: searching chosen
sources, filtering weak matches, ranking the best fits, waiting for the person to choose, tailoring
a résumé and cover letter, and applying after explicit approval. The narration plays once and
settles into a quiet patrol loop for new roles. A pause control remains available, and every story
timer stops immediately when the form takes focus.

For deterministic visual review, add `?skipLoader&static` and optionally choose a story or panda
state. Story scenes are `who`, `looking`, `deputy`, `wonder`, `search`, `filter`, `rank`, `choose`,
`tailor`, `apply`, and `watch`; for example `?skipLoader&static&scene=wonder`. Interaction examples include
`?skipLoader&static&state=region`, `?skipLoader&static&state=password`,
`?skipLoader&static&state=loading`, and `?skipLoader&static&state=error`. Add `?simulateError` and
submit valid-looking values to exercise the generic authentication failure.

The signed-in pages share one app shell. A sidebar lists Dashboard, Searches, Jobs, Applications,
Résumés, Profile, AI & credits, and Help. It becomes an `89px` rail from `721px` to `1100px`, and a
phone app bar with a Menu disclosure at `720px` and narrower. The deputy companion sits at the
bottom of the sidebar on every page, in the pose that names the page's work (see
`docs/ui-app-redesign.md`). Open any of them straight from this folder:

- **`home-preview.html`**: the Dashboard. It shows the deputy's report, Needs you, the pipeline,
  setup, AI and credits, and recent activity. A fresh load plays the opening loader;
  `?skipLoader` skips it. `?state=new` shows the first-run view, and `?from=onboarding` shows the
  first search running.
- **`searches-preview.html`**: add a careers page or job board, then follow Recent searches grouped
  by source with their history and the Keep watch preview.
- **`jobs-preview.html`**: ranked roles with Why it fits, keywords on and off your résumé,
  materials, Shortlist, Tailor materials, and Not for me. Fit labels are sample data until the jobs
  API returns relevance fields.
- **`applications-preview.html`**: the tracker. It has seven stages, Board and List views, a
  details drawer, approval, Mark as applied, Close, and Add a role.
- **`documents-preview.html`**: Résumés. It holds the up-to-10 document library with honest upload
  states, how your default résumé reads to the deputy, and the tailored drafts.
- **`materials-preview.html`**: the editor. Each draft sits beside a live page preview, with Job
  match, Changes, local save and restore, copy, download, print, and Approve materials. It never
  sends anything to an employer.
- **`profile-preview.html`**: About you, Job preferences, and Account (locked home Region, sign-in
  methods, password change, and the deletion request).
- **`ai-preview.html`**: AI & credits. Choose what runs your next search, see the free platform
  runs and token usage, and manage provider keys with the tested-model picker.
- **`onboarding-preview.html`**: after a first sign-up, the deputy asks one question per screen.
  `Continue with Google` on the sign-in page opens it with `?via=google` (simulated; no Google
  request).
- **`trust-preview.html`**: the Help centre (topic search, popular questions, Privacy, Security,
  Accessibility, Help, the support request, and Reset sample data). `?public` is the variant opened
  from the entry pages.

The signed-in pages share `sample-store.js`, so actions carry across pages. Reset it from Help.
Two reference pages document the shared parts: `deputy-preview.html` shows every deputy state at
every size, and `components-preview.html` shows every shared component in every state.

Open `access-preview.html?mode=create`, `access-preview.html?mode=reset`, or
`access-preview.html?mode=set&token=prototype` for the account-entry extensions. They reuse the
sign-in page's complete locked left-side story, chapter timing, controls, and responsive anchors;
only the right task panel changes. The narrative runs from the deputy introduction through search,
filtering, ranking, user choice, tailoring, approval, and ongoing watch. The same panda pose
geometry handles password privacy, Region guidance, validation, pending work, and success. Account
creation asks only for email, password, and the permanent home-Region decision. Recovery request
asks only for email and account home Region; choosing and confirming a new password appears
exclusively in the separate verified-link state. Missing, expired, and already-used token examples
block the password form and route back to a fresh recovery request. Generic recovery copy never
reveals whether an account exists. All three remain explicit local prototypes.

Signed-in pages reuse the shared product footer for the eight sections, Region context, and help.
They also share one avatar account menu for identity, tier, settings, and session exit, and the
dark ink footer remains a clear ending to the application surface.

## Human-interface direction

The login concept treats motion as communication rather than decoration:

- **Discover:** search any user-provided job source and return promising roles.
- **Personalize:** use the person's résumé, target roles, skills, and preferences.
- **Protect:** keep credentials user-controlled and personal data in its home Region.
- **Ask:** prepare and organize work, but wait for informed approval before acting.

The normative tokens and interaction rules live in `docs/design-system.md`. Future UI agents follow
`agent-sops/build-jobdeputy-ui.sop.md`.

## Locked UI foundation

The approved login composition now defines the locked product foundation. Future pages MUST follow
`docs/ui-foundation.md` so identity, header behavior, editorial hierarchy, task surfaces, status
language, responsive behavior, and accessibility remain connected.

The connected route and state inventory is locked in `docs/prototype-map.md`.

Every preview page declares the identical canonical `:root` token block and renders shared chrome
(header, wordmark, editorial intro, actions, fields, pills, footer) to the component contract in
`docs/design-system.md`. `tests/prototype/ui-consistency.test.ts` and the rendered audit in
`docs/ui-consistency-audit.md` catch drift.

Page-specific work MAY add the controls and content its task requires. It MUST NOT redesign the
shared foundation without explicit approval and a synchronized update to the foundation, design
system, brand guidance, and UI SOP.

## Golden-ratio system

- The SVG canvas is `610 × 377`, consecutive Fibonacci numbers and a practical approximation of
  the golden ratio.
- Major dimensions and spacing use Fibonacci values: `13`, `21`, `34`, `55`, `89`, `144`, `233`,
  `377`, and `610`.
- The one-time loading story lasts `2.605s` (`1.618s + 0.987s`); secondary motion uses `618ms`.

## Use

The SVG has a transparent background and can be used directly in HTML:

```html
<img src="/brand/jobdeputy-animated.svg" alt="JobDeputy" />
```

For a compact product header:

```html
<a href="/" aria-label="JobDeputy home">
  <img src="/brand/jobdeputy-mark.svg" alt="" />
  <span>JobDeputy</span>
</a>
```

The search story runs once on load. Only the panda's subtle resting motion continues. The host page
owns the green progress fill so its visible length matches the accessible loading percentage; see
`preview.html` and `login-preview.html` for the wrapper pattern. Users who enable reduced motion
receive the completed static logo with no narrative motion.
