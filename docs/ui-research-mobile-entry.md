# Mobile entry and onboarding: research note

Date: 2026-10-03. Written for round 2 of the signed-in redesign ([ui-app-redesign.md](ui-app-redesign.md#round-2-the-owners-review-october-3-2026)),
before the entry pages and onboarding were rebuilt for phones. The recommendations below are what
those pages now follow.

Finding F1: on a phone the story fills the first screen and the form starts below the fold
(in round 1 at 390x844 the story card ended at 516px of 844, and the first input started at
810px). F2: two experiences, first time (setup) and returning (straight to the
Dashboard).

## What the sources say (short)

- **The first screen gets most of the attention.** In NN/g's 2018 eyetracking study people spent
  about 57% of viewing time above the fold, and more than 65% of that in the top half of the
  viewport: "Keep major CTAs above the fold." [S1]
- **Sign-in on phones: the keyboard hides things.** web.dev: "mobile keyboards may cover your
  form or, worse, partially obstruct the Sign in button", and the fix is "displaying only the
  email (or phone) and password inputs and Sign in button at the top of your sign-in page. Put
  other content underneath." [S2]
- **The keyboard no longer resizes the layout.** Since Chrome 108 on Android, like Safari on
  iOS, the on-screen keyboard resizes only the visual viewport; viewport units stay stable and
  `position: fixed` elements "remain in place and can be obscured by the OSK".
  `interactive-widget=resizes-content` restores the old behaviour, but only in Chromium. [S3]
  `svh`, `lvh`, and `dvh` ignore the keyboard ("not considered part of the UA UI"). [S4] The
  VirtualKeyboard API (`navigator.virtualKeyboard`, `env(keyboard-inset-*)`) is Chromium only.
  [S5] The portable signal is `window.visualViewport` (`height`, `offsetTop`, and its `resize` and
  `scroll` events): the OSK "can shrink the visual viewport without affecting the layout
  viewport". [S6]
- **Mascots and motion: brief, meaningful, never in the way.** NN/g: animation helps when it
  explains a change where the person is already looking; "Animations that are repeatedly
  encountered are roadblocks to content"; "Employ animations sparingly and only when they add
  meaning". [S7] WCAG 2.2.2: motion that starts automatically, lasts more than five seconds, and
  runs beside other content needs a pause; one control that pauses everything is best. [S8]
  Duolingo's onboarding starts "After a friendly welcome from Duolingo's mascot", with animations,
  a progress bar, and sign-up prompts "at logical moments". [S9, S10]
- **Onboarding: short, relevant, skippable, and interactive.** Apple HIG: "design a flow that's
  fast, fun, and optional"; "Postpone nonessential setup flows or customization steps"; "Teach
  through interactivity". [S11] NN/g: content customization "can create a relevant experience",
  but "If you can't explain why gathering that data is beneficial at launch, this information
  should be gathered later"; avoid deck-of-cards tours. [S12] Tutorials "are quickly forgotten";
  prefer help in context. [S13] Headspace asks "just two or three questions, each with a small
  set of options" with a top-of-screen progress indicator; "2-5 choices seem to be the sweet
  spot". [S14] Wizards: one step per page, show the steps and the current one, offer Back. [S15]
- **Accounts.** Apple HIG: "Explain the benefits of creating an account and how to sign up ...
  Display this message in your sign-in view." [S16] Google: returning users are recognised by
  an account that "has approved your website before"; the personalized button "reminds them that
  Sign In With Google has been used before" and "helps to prevent unnecessary duplicate account
  creation". [S17, S18] After sign-out, auto sign-in must stop, "Otherwise, the user is
  automatically signed in again, which leads to a dead-loop UX". [S19] Brand rules: "Continue
  with Google" is an approved label, the standard colour G on white, and the Google button "at
  least as prominently as other third party sign-in options". [S20]
- **Form hygiene.** Labels above inputs, `type="email"`, `autocomplete="username"` on sign-in
  email, `current-password` and `new-password`, a Show password toggle with `type="button"`, no
  double entry. [S2, S21] Turn off autocorrect and autocapitalisation for email (testers deleted
  the capital letters when it stayed on). [S22, S23]
- **Sticky bars and focus.** WCAG 2.4.11: a focused control must not be entirely hidden by
  author content such as "sticky footers, sticky headers"; scroll padding (C43) is the
  sufficient technique. [S24] On iPhone, pad bottom bars with `env(safe-area-inset-bottom)`,
  with a `max()` minimum because the inset can be 0. [S25]

## Recommendations for JobDeputy, ranked

### 1. On phones the form owns the first viewport; the story becomes a compact band (entry pages)

At 720px and narrower, every entry route shows the story as one short band above the form: the
animated panda (whole figure, smaller), its current line, the duty pill, and the story controls.
The story copy (eyebrow, chapter title, body) moves into the expanded story. Targets, measured
with `getBoundingClientRect`: at 390×844, 375×667, and 360×740 the form eyebrow, the h1, and the
first input are fully visible; on Sign in at 390×844 the Sign in button is too. Phones use the
same tighter form rhythm as short split layouts (control spacing only: 4 to 13px), never smaller
type or targets. Why: S1, S2. Desktop and the locked split stay as they are.

### 2. Collapse while typing: focus first, `visualViewport` second (entry pages; onboarding text steps)

When a text field takes focus on a phone, the band shrinks to a slim sticky strip under the
header: the panda's head (so "Paws up, eyes covered" still shows) and its line if it fits. It
returns when focus leaves the form. Drive it from `focusin` and `focusout`, not from keyboard
detection, because the keyboard no longer resizes the layout on iOS or Chrome 108+ and the
VirtualKeyboard API is Chromium only (S3, S5). Use `visualViewport` `resize` only to keep the
focused field inside the visible area below the sticky strip (S6). Do not set
`interactive-widget=resizes-content` (Chromium only, and it changes viewport units). Treat a tap
on a form button (Show, Change) as staying in the form, so the strip does not bounce. No
transition under reduced motion.

### 3. The story stays one tap away, Pause stays, nothing has sound (entry pages)

The band keeps Previous, Pause or Play, and Next; stepping a chapter (or "Watch the story")
expands the full story with its title and body, and "Hide the story" folds it again. The story
still pauses whenever a field has focus. Reduced motion never autoplays. Why: S7 (motion that
helps), S8 (pause for motion over five seconds), S13 (pull, not push).

### 4. Two doors, two destinations (entry pages, Dashboard, setup)

- Create account offers Continue with Google above the email form, with the same divider and
  button as Sign in, at the same prominence (S20). Create by email or Google leads to setup.
- Sign in recognises a returning account: Google goes straight to the Dashboard with a one-line
  "Signed in with Google as <alex.morgan@example.com>" note. "Use another account" is the honest
  new-account branch and leads to setup (S17, S18: recognising the account prevents duplicates).
- When this browser signed in before, Sign in shows a compact "Continue as Alex" card above the
  form, with the email and "Not you?", which forgets the account (S19: leaving or forgetting
  must stop the shortcut).
- The Google step is a small JobDeputy dialog, never a copy of Google's interface, marked
  "Prototype · no Google request is made".

### 5. Onboarding on phones: progress, a small deputy, the question, the options, a sticky Continue (onboarding)

A budget that fits 390×844 without scrolling (header 64px): step progress about 34px ("Step 2 of
8" and the bars, S14, S15); the deputy row about 110px (A2's phone scene: an 89px panda beside
the bubble, duty below); the question (h1 at 40.95px, at most two lines) and one "why I ask"
line of 14 words or fewer; the options as choice cards of 52 to 64px with 8px gaps; then the
action bar. Keep 2 to 5 options per question where the data allows (S14). The deputy row is the
only drawn panda and carries the deputy's voice; its motion is one-time per step (S7).

### 6. Make the sticky action bar honest about the keyboard, the home indicator, and focus (onboarding)

- `position: sticky; bottom: 0` (not `fixed`), padding
  `0 13px max(13px, env(safe-area-inset-bottom))` (S25). Without `viewport-fit=cover` the inset is
  0 and the minimum holds.
- `html { scroll-padding-bottom: <bar height + 13px>; }` (keep `scroll-padding-top: 89px`) so
  tabbing never hides a control under the bar (S24).
- While a text input on the step has focus (target roles, location, the first source address),
  the bar leaves sticky positioning and sits in the flow after the field, because a sticky or
  fixed bar ends up behind the keyboard or over the field (S3). Enter continues the step.
- Back and Continue are 52px; Continue stays `aria-disabled` until the step is answered (existing
  rule); Skip only on optional steps.

### 7. Ask only what changes the first search, and say why (onboarding)

One question per screen, each with a single "why" line (S12). Prefill what is already known
(email and Region from the account, the AI choice default), and say once that every answer can
change later (S11: postpone nonessential setup). The re-run from Help (`?rerun=1`) prefills from
the store and returns to where the person came from.

### 8. The welcome reflects the door, and arrival plays once (onboarding, Dashboard)

`?via=google` shows "Signed up with Google", `?via=email` the email door, `?rerun=1` "Update
your setup". The deputy's arrive wave plays once per session and the opening loader never plays
after sign-in (S7: repeated animation becomes a roadblock; S11: do not present a tutorial
again).

### 9. Form hygiene on every entry field (entry pages, onboarding)

Labels above fields, `type="email"` with `inputmode="email"`, `autocapitalize="off"`, and
`spellcheck="false"` on email; `autocomplete="username"` on the email of Sign in and Create,
`current-password` and `new-password` on passwords; Show password stays a `type="button"`; no
"confirm email" field (S2, S21, S22, S23). Onboarding text inputs get the matching `type`,
`inputmode` (`url` for the source address), and `enterkeyhint` (`next` or `go`).

### 10. Verify on short and tall phones, with the keyboard simulated (entry pages, onboarding)

Measure the first viewport at 390×844, 375×667, 360×740, and 320×568 with
`getBoundingClientRect`, and simulate the keyboard (focus a field, then shrink the viewport by
about 336px, the iPhone portrait keyboard) to check that the focused field, the strip or bar, and
the next action stay visible (S2: behaviour differs between phones; S24).

## Sources actually read (2026-10-03)

- S1. NN/g, "Scrolling and Attention": <https://www.nngroup.com/articles/scrolling-and-attention/>
- S2. web.dev, "Sign-in form best practices": <https://web.dev/articles/sign-in-form-best-practices>
- S3. Chrome for Developers, "Prepare for viewport resize behavior changes coming to Chrome on
  Android": <https://developer.chrome.com/blog/viewport-resize-behavior>
- S4. web.dev, "The large, small, and dynamic viewport units": <https://web.dev/blog/viewport-units>
- S5. Chrome for Developers, "VirtualKeyboard API":
  <https://developer.chrome.com/docs/web-platform/virtual-keyboard>
- S6. MDN, "Visual Viewport API": <https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API>
- S7. NN/g, "Animation for Attention and Comprehension":
  <https://www.nngroup.com/articles/animation-usability/>
- S8. W3C, "Understanding SC 2.2.2 Pause, Stop, Hide":
  <https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html>
- S9. Appcues GoodUX, "Duolingo's user onboarding":
  <https://goodux.appcues.com/blog/duolingo-user-onboarding>
- S10. UserGuiding, "Duolingo onboarding UX": <https://userguiding.com/blog/duolingo-onboarding-ux>
- S11. Apple HIG, "Onboarding" (read through the page's JSON source):
  <https://developer.apple.com/design/human-interface-guidelines/onboarding>
- S12. NN/g, "Mobile-App Onboarding: An Analysis of Components and Techniques":
  <https://www.nngroup.com/articles/mobile-app-onboarding/>
- S13. NN/g, "Onboarding Tutorials vs. Contextual Help":
  <https://www.nngroup.com/articles/onboarding-tutorials/>
- S14. Appcues, "User onboarding UI and UX patterns" (Headspace, Duolingo examples):
  <https://www.appcues.com/blog/user-onboarding-ui-ux-patterns>
- S15. NN/g, "Wizards: Definition and Design Recommendations": <https://www.nngroup.com/articles/wizards/>
- S16. Apple HIG, "Managing accounts" (read through the page's JSON source):
  <https://developer.apple.com/design/human-interface-guidelines/managing-accounts>
- S17. Google Identity, "Understand the One Tap user experience" (features and journeys):
  <https://developers.google.com/identity/gsi/web/guides/features>
- S18. Google Identity, "Personalized button":
  <https://developers.google.com/identity/gsi/web/guides/personalized-button>
- S19. Google Identity, "Automatic sign-in and sign-out":
  <https://developers.google.com/identity/gsi/web/guides/automatic-sign-in-sign-out>
- S20. Google Identity, "Sign in with Google branding guidelines":
  <https://developers.google.com/identity/branding-guidelines>
- S21. web.dev, "Sign-up form best practices": <https://web.dev/articles/sign-up-form-best-practices>
- S22. Baymard, "Mobile touch keyboards": <https://baymard.com/blog/mobile-touch-keyboards>
- S23. NN/g, "A Checklist for Designing Mobile Input Fields":
  <https://www.nngroup.com/articles/mobile-input-checklist/>
- S24. W3C, "Understanding SC 2.4.11 Focus Not Obscured (Minimum)":
  <https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html>
- S25. WebKit, "Designing Websites for iPhone X": <https://webkit.org/blog/7929/designing-websites-for-iphone-x/>
- Also read for context: NN/g, "Login Walls Stop Users in Their Tracks":
  <https://www.nngroup.com/articles/login-walls/> ; NN/g, "Progress Indicators Make a Slow System
  Less Insufferable": <https://www.nngroup.com/articles/progress-indicators/> ; Smashing Magazine,
  "Best Practices For Mobile Form Design":
  <https://www.smashingmagazine.com/2018/08/best-practices-for-mobile-form-design/>

## Tried and not used (so they are not cited)

- Material Design onboarding (<https://m2.material.io/design/communication/onboarding.html>): the
  page renders no text without script.
- Apple HIG HTML pages: no text without script; the JSON sources above were read instead.
- Airbnb and Notion: no readable page about their sign-up flow was found (the Airbnb URL tried was
  the Terms of Service; the Notion help URL returned 404). Their patterns are not claimed here.
- Headspace's own teardown pages returned 404; Headspace is cited only through S14.
- The UserOnboard Duolingo teardown is an image carousel with no readable captions.
