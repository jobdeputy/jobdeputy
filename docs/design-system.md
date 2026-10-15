# JobDeputy design system

This document is the visual and interaction source of truth for JobDeputy. It applies to every web
screen, loading state, illustration, and product message. The system combines a calm editorial
appearance with a human-interface principle: JobDeputy behaves like a respectful deputy working
with a person, not like an autonomous machine operating around them.

The approved cross-page composition is locked in `docs/ui-foundation.md`. Every new page MUST use
that foundation together with this design system. A conflicting requirement requires explicit user
approval before either reference is changed.

## Product expression

Every screen MUST reinforce these four promises:

1. **Discover:** search the job sources the person chooses.
2. **Personalize:** use their résumé, target roles, skills, and preferences to find relevant work.
3. **Protect:** keep credentials user-controlled and personal data in its home Region.
4. **Ask:** prepare and organize work, but wait for informed approval before consequential action.

Copy MUST keep the person in control. Prefer “You choose; JobDeputy searches” over autonomous or
magical claims such as “AI handles everything.”

The entry story describes the product at launch, which happens only after both phases in
[problem-statement.md](problem-statement.md) ship. It MAY therefore describe ranking, tailored
materials, and approved application submission. Automatic role lookup is an optional feature the
person turns on: copy MUST present it as their choice, never as default behavior, and MUST NOT
mention pricing or plans.

## Visual tokens

Agents MUST reuse these tokens. A new color, typeface, radius, shadow, or motion curve requires an
update to this document in the same change.

Every token is a CSS custom property with the same name (for example `--ink`). Every brand page
declares the identical canonical `:root` block listed in [Component contract](#component-contract);
`tests/prototype/ui-consistency.test.ts` fails when a page drifts from it.

### Color

| Token | Value | Required use |
|---|---|---|
| `ink` | `#1b1a18` | Primary text, primary buttons, footer surface, panda black |
| `ink-soft` | `#2d2b27` | Hovered dark controls, neutral pill and tag text |
| `muted` | `#706d66` | Body copy, helper text, metadata, and secondary labels |
| `quiet` | `#98948b` | Non-text decoration only: separators, disabled borders, idle icons |
| `paper` | `#faf8f3` | Main warm canvas |
| `paper-deep` | `#f0ece3` | Secondary canvas, neutral pill and tag backgrounds |
| `surface` | `rgba(255, 255, 255, 0.82)` | Cards, inputs, secondary and compact controls |
| `surface-strong` | `rgba(255, 255, 255, 0.92)` | Menus, popovers, and inset control highlights |
| `header-surface` | `rgba(250, 248, 243, 0.82)` | Sticky header background |
| `line` | `rgba(27, 26, 24, 0.12)` | Borders and separators |
| `line-soft` | `rgba(27, 26, 24, 0.08)` | Header rule and task-surface borders |
| `line-strong` | `rgba(27, 26, 24, 0.24)` | Hovered borders |
| `green` | `#2f9e77` | Brand accent fills, rules, focus rings, icons, progress, selected borders |
| `green-soft` | `#ccebdc` | Green fields and selected backgrounds |
| `green-wash` | `rgba(204, 235, 220, 0.55)` | Success pill and selected-choice backgrounds |
| `green-line` | `rgba(47, 158, 119, 0.36)` | Selected-choice borders |
| `green-ink` | `#23795b` | Green text: story eyebrow, section labels, success pills |
| `orange` | `#f36b3f` | Human attention and a single warm secondary accent |
| `orange-soft` | `#ffd5c6` | Large organic background fields |
| `danger-ink` | `#9c4028` | Session exit and destructive text actions |
| `blue` | `#526fe5` | Informational illustrations only |
| `blue-soft` | `#d9def8` | Large organic background fields |
| `on-ink-muted` | `rgba(255, 255, 255, 0.68)` | Supporting copy on the ink footer |

Color MUST be semantic. Green MUST NOT be used for decoration when it could be confused with a
success state, because users need a reliable status language. Orange and blue SHOULD stay in
illustrations and ambient fields rather than form controls.

Text and interactive controls MUST meet WCAG AA contrast. Visible text MUST use only `ink`,
`ink-soft`, `muted`, `white`, `on-ink-muted`, `green-ink`, or `danger-ink`. `green` measures about
3.2:1 and `quiet` about 2.9:1 on paper, so neither may color text. `muted` needs a background at
least as light as `paper`; on `paper-deep` use `ink-soft`. Field errors use `ink` text beside an
orange icon or rule rather than colored text. UI chrome (headers, surfaces, controls, pills,
panels, menus, footer) MUST use these tokens instead of one-off `rgba()` values.

Non-text indicators need 3:1 against their actual background (WCAG 1.4.11). Story chapter bars use
`muted` for the track and `green-ink` for the current chapter (a `6px` bar over a `3px` track), and
the track stays clear of the panda art and the duty pill.

#### Data colours (round 5)

Charts, rings, bars, keys, and fit or stage dots use their own palette, declared once in
`brand/app-components.css` (`:where(html)`), never the brand tokens above. Pages write no colour:
they keep `data-tone` on legends, keys, bars, and tone labels, and set `data-meter-kind` on ring
meters. Tips and tours name colours with `JobDeputyComponents.palette` words, never retyped.

| Property | Value | Used for |
|---|---|---|
| `--viz-green` | `#457152` | `data-tone="green"`: Strong fit, Interviewing and Offer, on your résumé; a ring's left part with no kind |
| `--viz-blue` | `#4785bd` | `data-tone="blue"`: Good fit, Applied |
| `--viz-orange` | `#c46b2d` | `data-tone="orange"`: Approval, needs you |
| `--viz-ink` | `#464543` | `data-tone="ink"`: Tailoring ("charcoal") |
| `--viz-quiet` | `#838280` | `data-tone="quiet"`: Stretch, Shortlisted, not on your résumé ("grey") |
| `--viz-teal` | `#22837c` | Deputy Assist's left (`data-meter-kind="assist"`) |
| `--viz-indigo` | `#4d4e96` | The Runs ring's left (`data-meter-kind="watch"`, the night; Keep watch's left until round 6, part 2) |
| `--viz-gold` | `#a8782a` | A ring's bonus part (a friend's first search) |
| `--viz-wine` | `#642e54` | A ring's bought part (credits or runs bought in Purchases, the Shop until round 6) |
| `--viz-used` | `#838280` stripes | A ring's used part: a quiet hatched grey |
| `--viz-track` | `var(--paper-deep)` | Every track the parts sit on |
| `data-tone="other"` (round 6) | `--viz-quiet` stripes, a `1px` quiet edge | **Other**: the parts beyond a chart's top N, together (2px stripes 3px apart at 45 degrees, so it reads as a group and never as Workday's plain grey). On legend and key items, swatches, tone labels, horizontal bars, stacked bar and usage segments, chart parts, and the donut (an SVG hatch). `JobDeputyStore.sourceTone(id)` and `aiMonthUsage().models[].tone` return `'other'` past the top 5, so pages pass it straight through. Forced colours: a CanvasText hatch on Canvas |

**Source colours (round 6).** One colour key per source for every chart (Dashboard, Job matches,
Searches), from `JobDeputyStore.sourceColours()`: the five sources with the most found roles take
the palette blue, charcoal, green, grey, and orange by their catalog position (or the next free
one), and every other source is Other. On the usual sample the five are round 5's colours (Google
blue, Microsoft charcoal, Stripe green, Workday grey, Amazon orange).

Every fill measures at least 3:1 on the card, on paper, and on the deep track. Within each chart
family (fit, stage, source, keywords, each ring, the usage series) the parts stay at least 9 apart
(CIEDE2000) in normal vision and in protanopia, deuteranopia, and tritanopia simulations; orange
and gold, and blue and teal, never share a chart. The check is
`node /tmp/jd-r5/A2/palette-check.mjs --markdown` during round 5; the gallery's Data colours
section shows the swatches, their measured contrast, and the three simulations. Forced colours keep
the parts apart (used hatched, left Highlight, bonus LinkText, bought CanvasText). Buttons, links,
pills, focus rings, and status keep the brand tokens.

### Typography

Only two font stacks exist. `--font-display` is `"Iowan Old Style", "Palatino Linotype", Palatino,
"Book Antiqua", Georgia, serif`. `--font-text` is `-apple-system, BlinkMacSystemFont, "SF Pro
Text", "Helvetica Neue", Arial, sans-serif`. Every `font-family` declaration MUST be
`var(--font-display)`, `var(--font-text)`, or `inherit`, and form controls MUST inherit the page
font. The document body is `16px`.

| Role | Family | Size | Weight and treatment |
|---|---|---|---|
| Story display | Display | `clamp(48px, 4.5vw, 72px)` | 500, `-0.055em`, line-height `0.98`, `text-wrap: balance` |
| Story body | Text | `clamp(17px, 1.6vw, 21px)`; `16px` at mobile | 400, `-0.02em`, line-height `1.5` |
| Story eyebrow | Text | `13px`; `12px` at mobile | 750, `0.12em`, uppercase, `green-ink` |
| Page heading (`h1`) | Display | `clamp(40px, 4vw, 52px)`; `clamp(35px, 10.5vw, 42px)` at mobile | 500, `-0.05em`, line-height `1` |
| Page eyebrow | Text | `12px` | 750, `0.12em`, uppercase, `ink`, `13px × 3px` green leading rule |
| Intro | Text | `15px` | 400, `-0.01em`, line-height `1.5`, `muted` |
| Section heading (`h2`) | Display | `clamp(28px, 2.6vw, 34px)` | 500, `-0.04em`, line-height `1.05` |
| Section label | Text | `12px` | 750, `0.12em`, uppercase, `green-ink` |
| Item title (and `h3`) | Text | `15px` | 700, line-height `1.35`, `ink` |
| Body | Text | `15px` (up to `17px` for long-form reading) | 400, line-height `1.5` |
| Field label | Text | `13px` | 680, `0.01em`, `ink` |
| Controls | Text | `15px` standard, `14px` compact | 680; typed values 400 |
| Navigation links | Text | `13px` | 620 for footer and menu links; 680 for text links and the back action |
| Helper and metadata | Text | `12px` | 400 (600 for emphasis), line-height `1.4`, `muted` |
| Status pills and tags | Text | `12px` | 650 for status pills, 400 for tags |
| Stat figure | Display | `28px` | 500, `-0.04em`, line-height `1.05`; stat rows, stage counts, ring figures, and allowance and usage totals |
| Wordmark | Text | `19px`; `18px` at mobile | `Job` 620 + `Deputy` 720, `-0.05em`, line-height `1` |
| Wordmark tagline | Text | `8.5px` | 680, `0.075em`, uppercase, `muted` |

Visible text that is not inside an `aria-hidden` illustration MUST NOT be smaller than `12px`. The
only exception is the wordmark tagline, which is part of the brand lockup, sized to the wordmark,
excluded from the accessible name, and hidden on narrow screens. "Mobile" means the `≤720px`
breakpoint.

Agents MUST use the serif stack for human narrative and major headings, and the sans stack for
controls and operational information. Agents MUST NOT introduce a web-font download because it
adds cost, latency, and privacy surface before the UI task explicitly approves one.

### Space, proportion, and shape

- Primary desktop compositions SHOULD use a `1.618fr / 1fr` split.
- Major spacing (page, surface, and section padding and gaps of `16px` or more) MUST come from
  `21`, `34`, `55`, or `89` pixels. Control-internal spacing MAY use `4` to `13` pixels.
- Internal pages use one shell: `width: min(1280px, calc(100% - 42px))` with
  `padding: 34px 0 55px`, narrowing to `width: min(100% - 26px, 1280px)` at mobile. The footer
  content (`.footer-inner`) uses exactly the same widths, so both edges align at every viewport.
  Signed-in pages place that shell in the main column of the app frame, and the footer repeats the
  frame's two columns, so the edges still align beside the sidebar (see [App shell](#app-shell)).
- Every page sets `html { min-width: 320px; scroll-padding-top: 89px; }` so anchor targets and
  keyboard focus clear the sticky header. Internal pages get it from `brand/app-chrome.css` and MUST
  NOT add their own header `scroll-margin-top`.
- Standard controls are `52px` high. Compact controls (row actions, toolbars, in-field toggles,
  header actions) are `44px` high. Nothing interactive is smaller than `44px`.
- Radii: compact controls `11px`; feedback panels and inline info boxes `13px`; inputs, selects,
  and the Region summary `14px`; buttons `15px`; secondary surfaces and every surface at mobile
  `22px`; task surfaces `34px`; pills and chips `999px`; avatars `50%`.
- Pill controls MUST use a fully rounded radius and MUST be reserved for compact choices or status.
- Shadows MUST be soft and low contrast. They SHOULD describe elevation, not create glow. Surfaces
  and menus use `--shadow` (`0 21px 55px rgba(55, 48, 36, 0.07)`); primary actions use
  `--shadow-control` (`0 10px 21px rgba(27, 26, 24, 0.15)`).
- Story and panda illustration art (everything inside the `aria-hidden` stage and scene props) keeps
  its own approved geometry, sizes, colors, and timeline and is exempt from these UI rules.
  Third-party provider marks, such as the Google icon on `Continue with Google`, keep their owner's
  brand colors.

## Motion

Motion MUST communicate state, attention, or relationship. It MUST NOT exist only to make a screen
look busy.

Use these curves:

- Standard settle: `--ease-settle`, `cubic-bezier(0.22, 1, 0.36, 1)`.
- Friendly spring: `--ease-spring`, `cubic-bezier(0.34, 1.56, 0.64, 1)`.
- Small UI feedback: standard CSS `ease` between `180ms` and `250ms`.

Preferred durations come from the golden-ratio family: `180ms`, `380ms`, `618ms`, `987ms`, and
`1.618s`. Ambient loops SHOULD use `5.236s` or longer.

One-time narrative motion MAY combine `1.618s` and `987ms` into a `2.605s` sequence when several
dependent beats must remain understandable. It MUST settle into a useful final state and MUST NOT
loop.

Every animated component MUST provide a `prefers-reduced-motion: reduce` state that removes
non-essential transforms and looping motion while preserving content and status. The reset MUST win
the cascade: use a universal rule with `!important`, or `animation: none` on every looping
selector, so that no loop or long transition keeps running.

Pausing the story MUST stop every story and ambient animation on the page. A finished story MUST
hold a still final pose; it MUST NOT leave a loop running. The entry story's ambient background
fields are static. The four entry routes (Sign in, Create account, Forgot password, Set a new
password) share one story panel block and one timeline, so they animate identically at every size.
A saved Pause motion opens the story still with Play story (on chapter 3 until round 6; since round
7 on step 1, Set it up; Play plays it on that page without changing the saved choice), and a story
that was playing plays on after the tab is hidden and shown again.

On signed-in pages the deputy companion follows the same rules: its work loops run only while work
is in progress, and at rest it blinks and makes one small idle gesture every `13s` to `21s`. Its
Pause motion control stops every animation on the page, not only the deputy's, on every page until
the person plays it again: `deputy.js` sets `html[data-motion]` to `paused` (also under reduced
motion) or `on`, and `app-chrome.css` resets animations, transitions, and their delays under
`html[data-motion="paused"]` exactly as the reduced-motion block does. Run data (stages, counters)
keeps updating while motion is paused; only motion stops (see
[Deputy companion](#deputy-companion-signed-in-pages)).

A running search shows how long it has been going, counting up ("Queued for 8 s", "Running for 1
min 12 s", then "Finished in 1 min 40 s"), never a countdown of time left (round 4). The ticking
time is never a live region: stage changes and the finish are announced once, politely.

## Brand identity

The canonical JobDeputy identity is the smiling panda perched on the large `JD` monogram, holding
the selected job card in its right paw, with its bamboo standing on the monogram beside it. Every
product surface MUST derive its logo treatment from this identity.

- `brand/jobdeputy-animated.svg` is the full storytelling lockup. Use it for initial bootstrap,
  onboarding, and dedicated brand presentations where the complete animation remains legible.
- `brand/jobdeputy-mark.svg` is the compact static mark for persistent headers, navigation, and
  other constrained placements. Pair it with the `JobDeputy` wordmark when horizontal space allows.
- Persistent navigation MUST NOT repeatedly animate the full search story. Use the compact static
  mark so branding remains recognizable without competing with the active task.
- Teams MUST NOT substitute a generic letter tile, unrelated panda icon, or newly drawn `JD`
  monogram when an approved asset fits.
- Cropping or resizing MUST preserve the panda, the recognizable `JD` silhouette, and adequate
  clear space. If those details become illegible, use the wordmark alone rather than distorting the
  mark.

### Panda drawing

The story panda, the deputy companion, the logo lockup, and the compact mark share one head drawing
(viewBox `0 0 420 420`): the "Polished" character with soft plush ears, chosen by the product owner
on October 2, 2026, smiling since round 6 (October 5, 2026: smile option A, an open smile with a
small tongue).

- **Proportions:** the head (ears included) is 53% of the figure height. The face is 200 × 172 and
  1.25 times the torso width. The eye-whites are 13.6% of the face width, centred 52% of the way down
  the face, and 43% of the face width apart. The ears are 33% of the face width; half of each ear
  shows, rising 8.7 units above the crown.
- **The smile (round 6, G1).** Every panda smiles, in every state, size, story chapter, logo, and
  loader frame: an open smile (a filled curve whose corners turn up, a short line from the nose, and
  a small `orange-soft` tongue), the lower lids lifted (an `ink` crescent at the foot of each
  eye-white, so the eyes smile too), the cheeks lifted beside it, and a second, smaller catchlight in
  each eye. Moments of joy (`success`, `found`, `celebrate`, `arrive`, and the reactions that say
  thank you) open the smile wider with happy closed eyes. The calm states (`error`, and
  `protect-password` on the entry stage) keep a gentle closed smile, never a frown. The cast sheet
  keeps the two smiles the owner did not choose (B, a wide closed smile; C, a soft smile with a
  happy squint) under "Smile options (for the owner)"; nothing else draws them.
- **Shapes and tokens:**

  | Part | Geometry | Token |
  |---|---|---|
  | Face | Rounded egg 200 × 172 with a chin crescent | `paper` with a 2-unit `line-strong` edge; crescent `paper-deep` |
  | Ears | Circles r33.2 at (210 ± 71, 96.5), with an inner disc and a soft sheen | `ink`; disc and sheen `ink-soft` |
  | Patches | 28 × 33 at (210 ± 44, 163), tilted ±16° | `ink` |
  | Eyes | Eye-whites 13.6 × 14.4 at (210 ± 43, 162); pupils r7.2 with an r3.1 catchlight and an r1.3 second catchlight; a lower lid 17.5 × 8.8 at y 179.6 inside the eye-white | `paper`, `paper-deep`; pupils `ink`, catchlights `paper`; lower lid `ink` |
  | Cheeks | 14.5 × 8.6 at (210 ± 68.5, 199) | `orange-soft` |
  | Nose and mouth | Nose with a shine; the open smile (`mouth-idle`), the wide smile (`mouth-happy`), and the gentle closed smile (`mouth-concern`) | `ink`, `paper`; tongue `orange-soft` |
  | Torso, belly, limbs | Ellipses | `ink-soft` torso; `paper-deep` and `paper` belly; `ink` arms, paws, and feet |
  | Bamboo | Stalk, nodes, and leaves, at 72% of its round 5 size (shoulder height), leaning on the ledge or the ground beside the panda (its foot at (48, 386), tilted 13°), behind him on the viewer's left and below every reach of the left paw | `green`, `green-ink`, `green-soft` |
  | Tools | Every tool sits inside `arm-right`, drawn around the paw grip (281, 326): magnifier, pencil, key, help card, job card, report card, best card, fan of cards, approval card, clipboard, alarm clock, Region shield, pen, envelope, check badge, card and copy, archive box, bin, hourglass, pointer, the tour pointer, and the test card | `blue`, `blue-soft`, `orange`, `orange-soft`, `green`, `green-soft`, `green-ink`, `paper-deep`, `ink`, `ink-soft`, `quiet`, `paper`, `line-strong` |

  Every paint is a canonical token at full or reduced opacity. The ear sheen is the only gradient.
- **The hand rule (round 6, R6-1).** Sides are named as the viewer sees the drawing: "right paw"
  is the one on the viewer's right (the panda's own left). The **right paw** (`arm-right`) holds
  the tool of the moment in every state, moment, reaction, story chapter, and size. The **left
  paw** (`arm-left`) is free: it rests, waves, points, gestures, cheers, or helps cover the eyes in
  `protect-password`; it never holds a tool or food. The **bamboo is never held**: it leans on the
  ledge (the dock and the scenes) or on the ground (the entry stage) beside the panda, a little
  behind him on the viewer's left, in its own group (`bamboo-lean`) drawn before the body. `deputy.js` keeps the
  rule as data (`JobDeputyDeputy.tools`, a tool for every state and reaction), and
  `tests/prototype/deputy.test.ts` checks it in the drawing, the poses, the entry layer, and the cast
  sheet.
- **Logo:** the same head at `scale(0.36)` with the eyes enlarged 1.2 times and the smile enlarged
  1.2 times (1.3 times in the compact mark). At `62px` and below the compact mark uses `ink`
  eye-whites and larger catchlights. The selected job card sits in the right paw; the left paw rests
  on the monogram; the bamboo stands on the `D`'s top bar beside the panda (its foot at (276, 104),
  tilted 8° toward him), as in the animated lockup's settled pose.
- **Rig:** pivots at the shoulders (162.7, 261.16) and (257.3, 261.16), the paw grips (141, 330)
  and (281, 326), the head (210, 158), the body base (210, 391), and the bamboo's foot (48, 386).
  Tools live inside `arm-right`; nothing lives inside `arm-left` but the arm and the paw.
- **Companion:** `brand/deputy.js` renders the same drawing for the signed-in deputy, with gradient
  and clip ids namespaced per instance. The entry stage's drawing (`login-preview.html` and
  `access-preview.html`) is built from it, with only the tools the story uses, so the two never
  drift; `tests/prototype/deputy.test.ts` checks the shared head, body, left arm, bamboo, and right
  arm tools against the entry layer.

## Opening loader

The application opening sequence MUST use `brand/jobdeputy-animated.svg`.

- The loader MUST appear only during initial application/authentication bootstrap.
- The loader MUST NOT appear for ordinary client-side navigation because repeated branding delays
  make the app feel slower.
- The implementation MUST have a failure-safe maximum; a logo animation must never trap a user on
  a loading screen.
- When bootstrap is already ready, the loader SHOULD reveal the page after the `2.605s` search
  story settles. A slower bootstrap MUST hold the completed pose rather than replay the story.
- Reduced-motion users MUST receive a near-immediate static mark, and so MUST a person who saved
  Pause motion (`localStorage['jobdeputy.deputyMotion']`): the loader then requests
  `jobdeputy-animated.svg#settled` and uses the reduced-motion timing.
- Screen readers MUST receive one visually hidden status, set once to “Loading JobDeputy…” and
  once to “JobDeputy is ready.” at reveal. The visible percentage MUST NOT be a live region, and the
  logo image is decorative (`alt=""`).
- The page MUST be revealed within `4.5s` of navigation, including the exit; a failure-safe exit
  is shortened to fit. Focus is not moved at reveal.
- The loader SVG is requested once per load. The track and status appear with the wordmark, not
  before the mark draws. Finishing fills to 100% over `380ms`, then the loader fades over `618ms`
  and is removed only after the fade ends.
- Every page that opens with the loader carries identical OpeningLoader styles, markup, and script
  between `OpeningLoader … start` and `end` markers; `tests/prototype/loader-parity.test.ts`
  compares them. Sign in, account access (Create account, Forgot password, Set a new password),
  and the Dashboard open a visit with it; every link between entry routes, and from public Help,
  carries `?skipLoader`, so moving between them never replays it.
- Hosts MAY request `jobdeputy-animated.svg#settled`, the settled final pose without animation,
  under reduced motion, because not every browser passes the preference into an image.
- The panda MUST visibly scan job cards, discard weaker options, and hold the selected card in the
  final pose so the loading story communicates search, filtering, and return without explanatory
  copy. The scan is a magnifier in the right paw, carried over each card (left, the kept one, right,
  and back); the magnifier is put away as the right paw takes the selected card, which it holds in
  the settled pose. The bamboo stands on the monogram beside the panda from the moment he arrives,
  and is never held.
- The underline beneath `JOBDEPUTY` MUST be the only visible progress indicator. Its fill MUST be
  controlled by the host loading component, increase monotonically, and match the accessible
  progress value. The SVG MUST NOT run a second independent progress animation underneath it.

## Panda teammate

The panda is JobDeputy's relational interface. It MUST react to meaningful events and MUST NOT
replace labels, error text, or status messages.

The page root exposes the current state as `data-panda-state`, one value at a time. Supporting root
classes are `is-arriving`, `story-is-frozen` (Pause), `is-password-visible`, and `is-blinking`.
Sign-in and account access carry one byte-identical panda layer (styles, script, and drawing)
between `Panda teammate … start` and `end` markers; `tests/prototype/auth-consistency.test.ts`
compares them.

| State | Required behavior | Meaning |
|---|---|---|
| `arrive` | One `1.35s` spring wave of the **left** paw, from and back to the resting arm, after the page is revealed, while the right paw holds a job card; the story starts after it | A teammate has joined |
| `story` | The story plays: slow breathing (`5.236s`), an occasional `180ms` blink, the chapter's pose, its tool in the right paw, and its props; the eyes follow a nearby pointer | Motion explains product purpose |
| `idle` | Still: paused, stepped by hand, or finished. A stepped chapter's one-time motion plays to its end; Pause holds it where it is; nothing loops; the chapter's tool stays in the right paw | Present without demanding attention |
| `notice` | Head and eyes turn toward the focused field; the magnifier waits in the right paw | Acknowledges the person's context |
| `protect-password` | Both paws cover the eyes, the right paw still holding the key, its shaft out beside the head; a gentle smile; with the password shown they stay and the head turns aside | Privacy is visible, not merely claimed |
| `explain-region` | Looks toward the Region control and points the pointer in the right paw at it (beside the form on a split layout, down at it when stacked) | Data-residency choice matters |
| `pending` | Lifts slightly and looks up, an hourglass in the right paw; the duty status shows a `987ms` spinner | Work is under way |
| `success` | One `618ms` spring bounce from the pending lift, holding up the key in the right paw; it settles before any hand-off | Confirms completion without confetti |
| `error` | Small reassuring tilt, a gentle smile, and the help card held out in the right paw; no shaking, no frown, no blame | Offers recovery calmly |
| `protect-data` | Guards a shield bearing the home-Region code (Profile) | Personal data stays inside its boundary |
| `hold-key` | Holds the key close, with one glint (AI & credits) | Credentials remain owned by the person |

- In every interaction state (`notice` through `error`), the chapter props (the floating cards and
  bubbles) leave and the capability label dims to `0.42` opacity, identically on every entry route;
  the right paw keeps a tool (the state's own). The props return with the story.
- Each story chapter holds its tool in the right paw while the left paw gestures toward the
  chapter's props: Who's your deputy?, a help card; Still looking?, the magnifier; It's me, your
  panda deputy., the report card; What can I do for you?, the pointer; Search, the magnifier;
  Filter, the best job card; Rank, the pointer (the left paw points up at the ranked cards); You
  choose, a fan of job cards; Tailor, the pencil; Apply, the approval card; Keep watch, the alarm
  clock (its hand turns once). **Round 7 (G1):** those eleven chapters are retired; the story is
  three steps, Set it up (the pencil), It finds (the magnifier), and It applies (the approval card)
  (see [Shared patterns (round 7)](#shared-patterns-round-7)).
- Chapter changes ease from the current pose over `618ms` with `--ease-settle`. A chapter's one-time
  motion starts after `640ms` and starts and ends at that pose. Props that leave stay hidden. Manual
  steps stop the story timer, not the animations.
- `setPandaLook` clamps the pupils to x ±5 and y ±3 viewBox units, inside the eye-whites.
- Paws touch the face or cover an eye only in `protect-password`; a waving or cheering paw stays
  clear of the face.

Panda speech MUST be first person, concise, and useful. It SHOULD clarify what JobDeputy is doing,
why input is needed, or what remains under the person's control. It MUST NOT claim emotions,
consciousness, or certainty the system does not have.

- Every story chapter shows one speech line of at most six words, at every width. Narrow screens
  MAY use a smaller bubble but MUST NOT hide it.
- A chapter MUST stay on screen for at least `max(3.4s, 1s + 240ms × visible words)`, counting the
  title, body, and speech and rounding to `100ms`, so that people can read it before it advances.
- Sign-in and account access declare byte-identical `stories`, `pandaLines`, and `regionCopy`
  objects, so the same event says the same thing on every entry route. A test enforces it.

### Deputy companion (signed-in pages)

Every signed-in page shows the deputy at work, so the person can see that their deputy is with
them. The companion never replaces a label, status text, or feedback; its duty line and speech are
plain visible text, and pages announce their own events.

- **Host.** The `DeputyDock` block sits in the sidebar's deputy slot on every internal page,
  between `DeputyDock: start` and `end` markers. It is identical on every page apart from
  `data-deputy-page`, `data-deputy-state`, and the speech and duty text
  (`tests/prototype/ui-consistency.test.ts`). Pages without the sidebar (onboarding) use a
  `.deputy-scene` host instead. `brand/deputy-preview.html` is the cast sheet of every state and
  size.
- **Sizes.**

  | Size | Where | Shape |
  |---|---|---|
  | Dock | Sidebar, `min-width: 1101px` | A `22px` card the width of the sidebar content (`207px`); the panda stands about `140px` tall on a soft ledge; speech in display italic `15px`; duty pill; Activity and Pause motion actions |
  | Compact dock | Sidebar, `max-height: 820px` | The bust and props behind the ledge, about `96px`, with one speech line |
  | Rail medallion | `721px` to `1100px` | A `55px` face over a `12px` duty label, with the tool badge (a `26px` paper disc on the face's lower edge showing the right paw's tool at its grip); speech and Pause motion move into the Activity panel |
  | Chip | `max-width: 720px`, in the app bar | A `44px` pill: a `34px` face with a `19px` tool badge and the duty text; the whole chip opens Activity |
  | Scene | Onboarding and the cast sheet | Art up to about `320px` tall with a speech bubble like the entry stage |
  | Phone scene | The scene at `max-width: 720px` | A row about `90px` tall: an `89px` tile (an `84px` panda inside it, so the props and the leaning bamboo stay clear of its rounded corners) beside the speech bubble (its tail points at the panda), with the duty line and a `44px` Pause motion under the bubble, so the setup question starts high on the screen. Under `340px` of scene width Pause motion shows "Pause" or "Play" beside its icon (" motion" stays in its accessible name, as in the dock); under `290px` it takes its own line |

- **Work states.** Each page rests in the state that names its work. The tool is in the right paw.

  | State | Page | Pose (right paw) | Duty | Speech |
  |---|---|---|---|---|
  | `report` | Dashboard | Holds a report card up beside the head | Reporting in | Here’s what I found. |
  | `search` | Searches (and any running search) | Sweeps the magnifier; repeats every `5.236s` only while a search runs | Searching | Checking your sources now. |
  | `filter` | Job matches (setting a role aside) | Keeps the best card in the paw and sets the weaker one aside on the ledge | Filtering | I set weak fits aside. |
  | `rank` | Job matches | The pointer shows three cards beside the panda; the best rises with a green rule | Ranking | Best fits are on top. |
  | `choose` | A decision that is the person's | Holds a fan of cards toward the person | Waiting on you | Your call on these. |
  | `track` | Applications | Holds a clipboard; three ticks appear one by one | Keeping track | I log every step. |
  | `tailor` | Résumés and the materials editor | Writes on a page with the pencil; repeats only while drafting | Tailoring | Drafting for this role. |
  | `approve` | Materials awaiting approval | Holds an approval card and waits; never presses | Awaiting approval | Nothing sends without you. |
  | `fill` | The autofill preview | Writes with a blue pen beside a standing form; three rows fill and gain green ticks; repeats every `5.236s` only while filling | Filling forms | I fill. You check. |
  | `invite` | Invite friends | Lifts an envelope; a green ticket with the AI credits sparkle slides out of the pocket | Inviting friends | Bring a friend along. |
  | `test` | Settings, Prompts (round 6) | Holds a test card whose three checks tick in turn; repeats every `5.236s` only while a prompt test runs | Checking prompts (Testing prompts while a test runs) | I test before I switch. |
  | `watch` | Keep watch (planned) | Holds an alarm clock up beside the head and looks at it; its hand turns | Keeping watch | I only watch if asked. |
  | `protect-data` | Profile and Settings, Account | Guards the Region shield | Guarding your data | Your data stays in the US. |
  | `hold-key` | AI & credits and Settings, Connections | Holds the key close | Holding your key | Your key stays yours. |
  | `idle` | Help and Purchases | Holds a help card at the side, still | Ready | Here when you need me. |

  Moments show over the page state, each with its tool: `arrive` (once per browser session: the
  left paw waves while the right paw holds a job card, then the page state), `notice` (the
  magnifier), `pending` (an hourglass and a `987ms` duty spinner, only while work is pending),
  `success` (the key held up; one `618ms` bounce, back to the page state after `1.618s`), and
  `error` (the help card and a gentle smile).

  A state's duty may change while its work runs (`test`: "Testing prompts"); `set(state, {
  working: true })` shows it.

  While the deputy is paused for the User Agreement (`agreements().paused`), every duty it shows
  (page states, moments, and reactions) reads "Paused until you sign", the resting line is "I wait
  until you sign.", and the duty dot becomes the pause mark. It follows the store, so signing
  brings back each page's own words at once. The cast sheet and public Help never pause.
- **Motion.** A new page starts on the previous page's pose and settles over `618ms`, so the
  deputy moves with the person between pages. One-time motion lasts at most `2.605s`; only
  `search`, `tailor`, `fill`, `test`, and `pending` loop, and only while the page flags work in
  progress. Blinks come every `5.236s` to `8.472s`. At rest the deputy also makes one idle gesture
  every `13s` to `21s` (the first `13s` to `17s` after a page shows): a glance, a tilt, a nod, an
  ear twitch, a sway of the leaning bamboo, or a lift of the held prop, chosen per state, larger
  on the rail and the chip, never during a loop, a moment, or a reaction, and never while paused,
  reduced, or in a hidden tab. The companion never follows the pointer on signed-in pages, and on
  the Dashboard its first motion waits for the opening loader.
- **Reactions.** `JobDeputyDeputy.react(name, { speech, duty, ms })` answers the person's action
  once: its motion ends by `1.605s`, the pose and line hold for `2.605s`, then the page state
  returns without replaying its own motion; paused or reduced, the pose and line change at once.
  Pages call it after the action succeeds and never also flash `success` for it.

  | Reaction | Pose (right paw) | Duty | Used for |
  |---|---|---|---|
  | `added` | Holds up the Applications clipboard; ticks draw | Added | Add to Applications, Add a role |
  | `dismissed` | Keeps the best card; the weaker card goes onto the ledge | Set aside | Not for me |
  | `saved` | A green check badge pops; a nod | Saved | Any saved change |
  | `sent` | The letter flies out of the envelope; the envelope stays in the paw | Sent | Feedback, invites, support requests (with an honest line: nothing leaves the browser) |
  | `copied` | A copy slides out from behind the card | Copied | Copy link |
  | `archived` | A card drops into the archive box | Archived | Archive a source |
  | `deleted` | The card drops into the bin in the paw | Deleted | Delete, after its confirmation |
  | `started` | One magnifier sweep | Starting | Run again, Retry, Add a source |
  | `found` | The best card held high; a hop | Found roles | A live run finishing with new roles |
  | `approved` | The approval card's check stamps | Approved | Approve materials |
  | `submitted` | The pen beside the form; the form's ticks pop in turn | Submitted | Submit in the autofill preview |
  | `celebrate` | The selected job card held high; the left paw raised in a cheer, above the bamboo and clear of the face; two hops | Well done | Setup finished, a tour finished, an offer |
  | `signed` (round 7) | The pen raised nib up in the right paw, the left paw cheering, happy eyes, two hops | Signed | The signing moment ("Signed. Thank you."), on a moment host (`data-deputy-moment`) |
  | `error` | The error state: the help card, a gentle smile, one slow tilt | Needs attention | Any action that fails |

- **Guide (round 6, G6 and R6-2): the deputy gives the tour.** `JobDeputyDeputy.guide(host, {
  point, speech })` draws the tour panda in `host` (the tour card's slot): the same smiling deputy,
  small, in a square `paper-deep` tile (`88px`, or `--deputy-guide-size` from `72px` to `96px`),
  its right paw holding the tour pointer (a bold stick with a green tip) aimed `left`, `right`,
  `up`, or `down` at the step's target, the left paw free, the eyes and a small head turn following
  it; the bamboo stays behind at the dock. `update({ point, speech })` eases the pose to the next
  direction over `618ms` with `--ease-settle` (at once under Pause motion or reduced motion);
  `speech`, when the card has a `[data-deputy-guide-speech]` element, is written there as plain
  text. While a guide is active every live deputy **steps out** (`data-deputy-away`): the dock, the
  compact dock, the rail medallion, the chip, and a scene show only the ledge and the leaning bamboo
  (the rail and the chip show the bamboo in the face's circle), with the duty "Showing you around"
  and the line "I’m in the tour card.", so one panda per viewport holds; work meanwhile is
  remembered and shows after release. `release({ finished: true })` brings him back with one
  `celebrate`; `release()` brings him back quietly. Only one guide is active at a time. The older
  `hold('guide')` and `release()` still hold the dock's own `guide` pose (the pointer raised toward
  the page; "Showing you around", "Let me show you around.") for callers that use them. The
  cast sheet shows the four directions and the dock stepped out at every size.
- **Background notices (round 6, UAT M-19).** A notice that something finished or needs you in the
  background (a prompt test, an apply job waiting for answers) stays with the deputy until you open
  Activity, where it is listed: the duty reads "Needs you", "Job stopped", or "Done" (for `13s`)
  beside an attention mark (a filled orange beacon; `danger-ink` for a stopped job; Highlight in
  forced colours). The deputy picks up every notice `JobDeputyStore.addNotice` records, and
  `JobDeputyDeputy.notice({ id, kind, text, href })` shows one directly. On phones the app bar's
  chip carries it and nothing floats over the page; wider screens also show the background toast
  (see [Component contract](#component-contract)).
- **Pause motion and reduced motion.** The dock's `Pause motion` button flips to `Play motion`
  with a bars or triangle icon (the accessible name matches; no `aria-pressed`), announces `Deputy
  motion paused.` or `Deputy motion on.` once through the dock's visually hidden channel, and
  persists in `localStorage['jobdeputy.deputyMotion']` across pages and tabs. While paused the
  duty reads `Motion paused` beside a two-bar pause mark at every size (borders, so it survives
  forced colours). Pause stops every animation on the page through `html[data-motion]` (see
  [Motion](#motion)), and Play restarts a live work loop without replaying finished one-time
  motion. Under reduced motion poses change instantly, nothing loops, the spinner becomes a still
  dot with `Working…`, and the button is hidden because nothing moves.
- **One panda per viewport.** A page with the dock never draws a second panda; while a tour's
  deputy is in the tour card, the dock steps out. Empty states use prop-only illustrations
  (`data-deputy-prop`: clipboard, page, cards, shield, key, magnifier, form, envelope).
- **Forced colours.** The drawing keeps its own colours (`forced-color-adjust: none` on
  `.deputy-art` and `.deputy-prop-art`), like an image, so the panda never vanishes into a dark
  system canvas. Its speech and duty follow the system colours.
- **Activity.** The dock's `Activity` panel is opaque (`white`, the shadow, and a line border) and
  lists Now, Needs you, and Done recently, marked as sample data. `deputy.js` renders the three
  lists from `JobDeputyStore.activity()` and updates them in place on every store change and live
  tick, so focus in the panel survives. The panel also holds Pause motion and Show me around
  (`[data-tour-open]`, shown only when the page has a tour). Round 7 (SE1): every dock's panel ends
  with **See all activity** (`a.deputy-activity-all`, `44px`), which opens Settings, Activity with
  `return=`, except on Activity itself.
- **API.** `window.JobDeputyDeputy` (`brand/deputy.js`): `set(state, { duty, speech, working })`,
  `flash(state, { ms })`, `react(name, options)`, `hold(state, options)`, `release()`,
  `guide(host, { point, speech })` (round 6), `guiding`, `tools` (round 6, the hand rule),
  `notice({ id, kind, text, href })` (round 6, background notices),
  `pageState`, `paused`, `reduced`, `held`, `pause()`, `play()`, and `renderProp(element, name)`.
  Unknown states, reactions, and directions warn once and change nothing. Custom speech keeps the
  six-word, first-person rule.

SVG base geometry and animated motion MUST use separate nested groups. Rotation that defines the
shape of a paw, ear, or prop stays on the child shape; state transitions target its wrapper group.
Agents MUST NOT animate a CSS `transform` on an SVG element that already has a geometry-defining
`transform` attribute because CSS replaces that transform and breaks the pose.

## Forms and consent

- Every input MUST have a persistent visible label.
- Placeholder text MUST be an example, never the only label.
- Focus MUST use the green border and a low-opacity green ring.
- Errors MUST be placed next to the field and summarized when submission fails.
- Consequential actions MUST state what will happen before the person confirms.
- Region selection MUST explain that accounts are looked up only in the selected home Region. The
  explanation is visible text beside the control, never panda speech alone.
- The automatic Region suggestion uses only the browser time zone. Any other time zone selects
  United States labelled `Default Region (change if needed)`, and the panda says it is a default.
- Authentication errors MUST NOT reveal whether an email address is registered.
- The password toggle shows `Show` or `Hide` with the matching accessible name (`Show password`,
  `Hide password`), carries no `aria-pressed`, keeps focus, and announces `Password shown.` or
  `Password hidden.` once through the StatusAnnouncement channel.

## Product footer

Internal screens use one calm footer pattern with practical navigation, home-Region/data-location
context, and direct Privacy, Security, Accessibility, and Help labels. Entry screens may use the
same visual treatment with signed-in destinations removed.

- Signed-in pages use the dark ink footer treatment to clearly close the application surface. White
  primary links and muted supporting copy MUST retain accessible contrast, and the footer contents
  align with the page's main content shell.
- Footer copy MUST explain a destination, data boundary, or account action; it MUST NOT rely on a
  vague product slogan.
- Links remain `44px` high, use the existing text/focus treatments, wrap on tablet, and stack on
  mobile.
- The footer MUST NOT become a second dashboard, contain task feedback, or repeat the panda merely
  as decoration.

Authenticated headers use one shared avatar account menu. It shows the user's identity and tier,
then routes to Profile, Settings, AI & credits, Purchases, Invite friends, and Help & support, with
Show me around, Send feedback, and Sign out (round 6). Session exit belongs here rather than among
footer navigation.

Signed-in pages navigate through the sidebar (see [App shell](#app-shell)). Page-level Back
navigation is only for child routes, which are the materials editor and the public Help page. It
belongs immediately before the account menu in the sticky header, so it stays available on long
pages. Use labels that name the destination, such as `← Applications` or `← Résumés`. On narrow
screens, supporting brand and account text collapses before this action is hidden.

Search history and jobs lists place filters before results and pagination after the entire result
surface. A highlighted job row means “open in preview”; a checkbox means “include in bulk action.”
These states MUST NOT share one control.

A select-all or select-visible checkbox belongs directly above the rows in the list column it
controls. Its helper copy states whether it affects the current page, filtered set, or all records.

Own-key model selection uses a provider-scoped allowlist: the recommended, tested model first and
marked Recommended, then the provider's other current models behind a cost disclaimer and a
confirmation. Change model keeps the saved key. Free-form model IDs are not accepted. The
production API and UI must consume and enforce the same shared allowlist.

Material generation uses a bounded pending state. Tailored résumé/CV and cover-letter review
actions remain hidden until ready, then open the shared material workspace with the selected job
context. Editing, saving, copying, downloading, and printing never imply application submission.
`Approve materials` asks for confirmation and states what approval means. At launch, it lets the
deputy submit the application; in the prototype nothing is sent. Approval can be undone until the
role is marked applied. The local prototype clearly identifies disconnected generation and
persistence behavior.

## Sample data and honesty

Launch features without a backend contract (ranking and fit reasons, application tracking,
materials approval, credits and usage history, onboarding answers) use sample data from
`brand/sample-store.js`. That one store keeps the signed-in pages in step: a role added on
Job matches appears in Applications, and an approval updates the Dashboard, the nav count, and the
deputy's Activity. Round 2 adds the profile's career, application answers, apply settings,
feedback notes, invites, and the catalog behind the flow ribbon's counts. The data lives in this browser's `localStorage`, and Help offers
`Reset sample data`.

- Every surface that shows sample data carries the shared `.sample-note`
  (`Sample data · not connected`), or the materials editor's `Local prototype` note.
- Nothing in the prototype applies for a role or contacts an employer. Copy that describes launch
  behavior says so, and says that the prototype sends nothing.
- **Prices (round 5) are shown, and honest.** AI credits cost the Amazon Bedrock on-demand rate
  for the person's home Region plus the margin (10%, a placeholder), always computed from
  `JobDeputyStore.PRICING`, `models()`, and `shopItems()`, never typed into a page. Every price
  carries `Sample prices · nothing is charged`, tax is added at checkout, and AWS's source and
  checked date are one click away. The prototype's checkout adds the purchase to the sample world
  and charges nothing. Keep watch is always the person's choice.
- **What we sell (round 5, renamed in round 6, part 2):** AI credits for platform AI (shown as
  tokens on the account's model, "339,100 tokens on Ministral 3 14B"; money only where money is the
  point), runs, and bundles of both that discount the runs only. Support JobDeputy stays an
  interest only (once or monthly; no amount is ever shown or asked for), with planned supporter
  benefits. AI runs are retired.
- **Names:** **Deputy Assist** is your deputy's AI work, paid for with **AI credits** (or your own
  key); **Keep watch** is the nightly schedule that searches your watched sources. Every search is
  counted in **runs** (round 6, part 2). The unit always sits next to a count.
  `JobDeputyStore.TERMS` holds the words (`TERMS.runs`; the old `nightlyRuns` reads "runs").
- **Runs (round 6, part 2, N3):** one allowance for every search run. Every run uses one run,
  whoever starts it: you (a search, Run again, Retry, a new source's first run, setup's first
  search) or Keep watch at night, one for each source it checks. Copy says "runs", never "nightly
  runs": "Every search uses one run, whoever starts it. Keep watch uses one a source each night."
  The month has 10 free runs (refreshing on the 1st), plus runs you bought or got in a bundle;
  every run is kept in a ledger, so deleting a source never gives one back and a stopped run still
  used its run. The allowance names who used it ("2 started by you, 2 by Keep watch") and how long
  it lasts. With none left, every way to start a run is off with the reason in text and Get more
  runs ("No runs are left this month. Get more runs, or wait for Sun, Nov 1."), and Keep watch
  skips its check and says so. Purchases is the allowance's home; the Dashboard and Searches show
  its ring.
- **One AI setting (round 4):** one choice runs every search, Keep watch check, and draft, with one
  model (your key's chosen model, or the account's one platform model on credits). There is no
  choice per source or per task; a page states the setting once, with Change. A token limit on
  your own key (an amount for a day, a week, or a month, in UTC) pauses AI work or falls back to
  platform credits when it is reached.
- **Consent before capability (round 5):** anything that acts on another site, reads email, spends
  money, or imports data says what it does and never does before the first time, and is covered by
  the signed User Agreement; a capability new in an unsigned version asks for the signature in
  place and comes back. While a version is overdue the deputy's work pauses, but signing in,
  reading, export, deletion, Help, and signing never do, and disabled controls say why in text.
- **Prompts (round 5):** every prompt edit runs `JobDeputyPromptGuard.check` as you type and on
  save; a blocked prompt cannot be saved, and nothing saves without the checker. Model output and
  email text are always shown as text, never as HTML. Site passwords stay masked until Show.
- **Two named measures (round 6):** a prompt's quality is never "keep rate". **Kept by you** is
  real use: "Of what this prompt produced in real use, the share you kept.", with what "kept" means
  for that prompt (it was "Agreement with you" until round 6, part 2 renamed it, because
  "agreement" also meant the User Agreement on the same screens; the store field stays
  `agreement`). **Test score** is the evaluation: "A version replayed on your last 40 decisions:
  how often it agreed with what you decided, and the guardrail checks.", a whole percent of the 40
  agreed with. Every place names both the same way, defines them once per page, names each
  figure's window ("84% of 19 runs so far"), and labels the figures as sample data until runs are
  recorded per version. The Dashboard shows Test scores only; Kept by you stays on Prompts and
  Searches. A saved edit is a draft, tested before any run uses it.
- **Applying (round 6):** the system default is Review, then auto-apply: your deputy reviews its
  own materials, you approve each one in one step, and it applies in the background within your
  rules (daily limit, quiet hours, only without new answers, the agreement signed). Auto approve is
  off until you turn it on, and Reset to the system default is one action. Background applying is
  Planned for launch (Phase 2): nothing is sent in the prototype, and every place that applies says
  so ("Applied · sample: nothing was sent").
- **The Large account demo (round 6):** `?demo=large` on any page, or Help, Demos, See a large
  account, switches the store to a separate, deterministic large world (124 sources across 118
  companies, 1,008 found roles, 52 keywords, 30 watched sources, 7 models, 46 applications, 95
  drafts across 58 companies, 14 What's new items, and 25 To-do items), saved in its own key so the
  usual world is never touched; `?demo=usual` or Back to the usual sample returns it exactly. Every
  page MUST render both worlds sanely, with every figure from the store.
- Every number a signed-in page shows comes from the store's one sample world (round 3), carries
  `data-metric="<key>"`, and equals `JobDeputyStore.metricText(key)`. A figure appears once per page
  (the flow ribbon and nav badges aside); the orchestrator's probe fails a mismatch or a repeat.

## Feedback and alerts

Use the locked `FeedbackPanel`, `FieldFeedback`, and `StatusAnnouncement` responsibilities from
`docs/ui-foundation.md`; do not invent page-specific banners or route unrelated messages into a
generic status line.

- A feedback panel uses the warm surface, `13px` radius, existing line token, a `24px` semantic icon
  circle, and a restrained `3px` leading rule.
- Notice and static-information panels remain neutral. Warning, validation, and operation-error
  panels use orange. Success panels use green. Text and iconography MUST state the meaning without
  relying on color.
- Place feedback at the narrowest useful scope: field, initiating control, section, form, then page.
- Dynamic visible panels SHOULD be separate from permanent visually hidden polite and assertive
  announcement channels. Avoid stacking a focused alert, a live region, and button status for the
  same event.
- Contextual notices keep focus on their trigger. Submission validation and operation-error
  summaries receive focus when that is the clearest single announcement.
- Titles name the outcome; descriptions give one safe recovery step. Do not expose raw exceptions,
  provider internals, authentication architecture, or whether an account exists.
- Use motion only for existing subtle surface and control feedback. Feedback panels MUST NOT shake,
  pulse, glow, loop, or depend on animation to be noticed.
- **Work done in the background (round 6)** is said one way: a line in the deputy's Activity
  (`JobDeputyStore.addNotice`, once per id) and, when it helps, one quiet toast from
  `JobDeputyComponents.notice()` (see [Component contract](#component-contract)). A prompt test
  and background applying use it; the person never has to watch, and the copy says so ("You can
  leave. I'll tell you when it's done."). The toast never covers a control and never takes focus by
  itself.

## Shared patterns (round 6)

The owner's fifth review added rules that every page follows. The exact markup and APIs are in
[Component contract](#component-contract).

- **One tour button place (R6-3).** Every internal page has **Take the tour** in the shared page
  intro: at `721px` and wider at the right end of the title row, top aligned with the `h1`, `34px`
  from the copy; at `720px` and below on its own row under the lede, at the start, `21px` below it.
  Pages never position or restyle the intro or the button; `tests/prototype/tour-placement.test.ts`
  reads every page's styles, and the rendered probe measures the button at seven sizes (within
  `1px` of the `h1`'s top and the intro's end, or of the `h1`'s start and below the lede).
- **The deputy gives the tour (R6-2).** Tour titles are the deputy's speech, first person, at most
  six words ("I keep your sources here."); bodies are first person. The card hosts the tour panda
  (see [Deputy companion](#deputy-companion-signed-in-pages)).
- **Settings (R6-6).** The primary navigation is Dashboard, Searches, Job matches, Applications,
  Résumés, Profile, Settings, and Help. Settings holds five tabs, each its own page under one tab
  strip (byte-identical apart from `aria-current`): Account, Connections, Prompts, AI & credits, and
  Purchases (seven since round 7, with Usage after AI & credits and Activity last). Profile holds
  only what applications use. A section that moves keeps every old link working: the old page
  forwards the anchor with `location.replace` before it draws.
- **Growing lists (R6-4).** A list whose length depends on the person's data never renders one
  chip, label, bar, or legend item per value without a cap. Charts show the top N by value plus one
  **Other** part that sums the rest (donuts and stacked bars 5, keyword bars 6), always hatched
  (`data-tone="other"`). Lists show a sensible first page plus **See all N** (a searchable,
  sortable drawer of every item with its count and link). Filters over dynamic values are the
  **searchable multi-select**, with at most 3 chips plus "+N more". `topWithOther` and `seeAll`
  come from the store and the components with one sort rule (value, then label). The Large account
  demo must look intentional on every page.
- **Stacked by source and by model.** Roles found per search (New roles per search until round 6,
  part 3) stacks each bar by source in the
  source colours (the bar's total on top, each part named in its tip and in Show the numbers, a key
  under the chart); AI in October stacks tokens by day by model (October to date, a model key, the
  month's total, and a charcoal diamond on a day that fell back to platform credits). Both take the
  top 5 plus Other.
- **Optional is calm (P2).** The optional need marker is the green wash with a hollow green-ink
  ring and `ink` text; required stays `danger-ink` on `orange-soft` with a filled "!". The shapes
  differ, so colour is never the only signal.
- **What's new says where it goes (R6-5).** Every item's link is a **guide** ("Read the guide", an
  article in Help at `trust-preview.html?guide=<id>#guides` with what changed, why it matters, the
  steps, and Try it) or a **page** ("Open Prompts", "Open Purchases"), from the item's
  `link.kind`. Public Help lists only the guides marked public.
- **Prompts: one control, two measures (S1).** Wherever a prompt shows (Settings, Prompts,
  Searches, the Prompt drawer), the same control from `app-panels.js` shows its Version dropdown,
  one chip for the chosen version's state, Kept by you and Test score, a test as it happens, the
  last result in words, and the actions for the chosen version. Round 6, part 2: the Dashboard's
  **Prompt tests** (under the tiles) shows each tested prompt's Test score trend from
  `promptTests()` with the version in use, any trial, this month's tests, pass rate, and
  rollbacks, and one line for the untested prompts, never Kept by you; Prompts leads with the same
  stats, larger. Round 6, part 3: the counts cover the last 30 days, said "Last 30 days", from
  `promptTests().window`; each tested prompt is one compact row (the Dashboard's `row` trend, the
  Prompts page's `medium` one), and each card draws one key and one Show the numbers. **Round 7
  (R10-5):** outside Settings, Prompts the control gives way to the read-only prompt summary, and
  the Dashboard's Prompt tests became Prompts, every prompt as a summary row.
- **Applying: one step, then the background (A1 to A4).** Applications leads with **Ready for
  you**: each role waiting for approval with its fit, the review score and the checks that need a
  look, the materials as page thumbnails, and **Approve and apply** (primary, no confirmation),
  Preview, and Edit; Approve all that passed confirms once with the list. The same actions sit at
  the top of the role panel and of Materials. After approval the role's card shows the background
  job (the step, the time counting up, Watch it, Stop), **Needs you** with the questions inline
  when it waits for an answer, and the result. Gmail's watch is a status line at the top of the
  board ("Last sync 30 minutes ago · this week: 10 emails read, 0 cards moved" since round 6,
  part 3). Planned for launch
  (Phase 2); nothing is sent. **Round 7 (R10-4):** Ready for you gave way to one board: the
  Approval lane's card holds the review score and Approve and apply, Needs you filters the board,
  and Approve all that passed went.
- **Each fact has one home (round 6, part 2, N6).** The home holds the whole fact and its
  controls; the Dashboard shows a snapshot (and Searches shows the Runs ring, because runs are
  spent there), and other pages show one line or a link, never a second copy of the block. A figure appears once per page (R3-4), the same fact is not restated across
  pages without a reason (a decision waits on it there, or it is the Dashboard's glance), each
  count names its window ("this week", "in the last sync", "of 19 runs"; R9-5 dropped "so far"),
  and every time
  that ages counts up in one style ("30 minutes ago"). When a fact moves, its old anchors forward.
  One Sample data note serves a page or a group of cards; a card gets its own only where it
  differs ("Sample prices · nothing is charged").

**Each fact's home (round 6, part 2).** From the placement review (J1, findings P-1 to P-26):

| Fact | Home | Elsewhere |
|---|---|---|
| Runs (the allowance) | Purchases (`#nightly`) | The ring on the Dashboard and on Searches, where runs are spent |
| Keep watch (watched sources, schedule, Searches a day) | Searches (`#keep-watch`) | The next check on the Dashboard's tile; one line on Profile |
| Your key's token limit, AI credits, the AI setting | AI & credits (`#limit`, `#credits`, `#ai`) | One AI line on the Dashboard and on Searches (Searches' ring only under 20% left or paused); one credits line on Purchases; the account menu's line |
| The platform model and its rates | AI & credits (`#model`) | A Change model link on Purchases |
| How prices are made | Purchases (`#prices`) | A link from AI & credits' rates |
| Prompt versions, tests, trials, rollback rules | Settings, Prompts | The Dashboard's Prompt tests (Test scores only); Searches' compact rows |
| The User Agreement (pending version, copies) | Settings, Account (`#agreements`) | The Dashboard's To-do; one line where work waits (Applications, Autofill, Connections); Help's short card |
| The Gmail connection and its scopes | Settings, Connections (`#gmail`) | The autofill account step |
| What Gmail did (emails, moves) | Applications (the strip and `#email`) | The Dashboard's Gmail sync gist |
| A role waiting for approval | Applications (`#ready`) | The To-do, the nav count, Materials' top bar, the autofill notice |
| How your deputy applies | Applications (`#how-you-apply`) | Ready for you's line, What's new, a Help guide |

## Shared patterns (round 6, part 3)

End-to-end testing found defects that no single page owned; the orchestrator decided one rule for
each (R9-1 to R9-12, listed in
[ui-app-redesign.md, part 3](ui-app-redesign.md#the-shared-rules-r9-1-to-r9-12)), and these are the
ones that change how a component or a page behaves. The markup and APIs are in
[Component contract](#component-contract).

- **The Runs ring counts every run you can still use (R9-1).** Free plus bought, this month: the
  centre is `runs.left` over "of `runs.all` left" (`runs.all` is free plus bought; the usual sample
  still reads "6 of 10 left", the large demo "125 of 190 left"). The ring has two parts, used and
  left, because runs you bought are among the ones left; the key's Left and Used rows give their
  numbers ("6 left", "4 used"); and once anything was bought one quiet line says the split ("10
  free + 30 bought"). The Dashboard, Searches, and Purchases rings, the Get more runs dialog ("125
  of 190 runs left this month: 10 free, 180 bought."), and Help say the same figure. Each figure
  keeps its `data-metric`.
- **A link to something missing says so (R9-2).** A `?run=`, `?job=`, `?source=`, `?prompt=`, or
  `?stage=` that names nothing shows one calm notice in the page's own notice style over the
  page's default view; it never falls back silently. The words say what came back ("That role isn’t in your matches, so here are your
  roles.", "That run isn’t in your history" with "Your sources are below.", "That stage isn’t on
  your board." with "Showing every role instead.", "That prompt isn’t one of your deputy’s, so here
  are all your prompts.") and never send you to the page you are on. A link that names something
  real lands on it, and an old id lands on what it became (`?run=r10` opens the run it folded into).
- **Live updates never replace controls (R9-3).** A part that updates while you look (a live run, a
  counting clock, a store tick) changes text and attributes in place: Searches' source cards are
  changed in place, keyed by their ids and `data-focus` and `data-action`, and a press holds the
  next store redraw until it is released (or for 1 second), so a click is never lost to a redraw;
  Applications draws the role panel and the lanes again only when the job itself changed, keeping
  what you typed and ticked. Where a control must be drawn again, it carries a stable
  `data-focus-key` and focus returns to the control with that key (a drawer's opener drawn again
  while the drawer was open, the email draft's text); a caret is restored only on a control that
  has one.
- **An empty value reads a word (R9-4),** never a dash of any kind: "None yet" (an empty Follow-up),
  "Not yet" (a readiness ring before its checks), "Not answered" (setup's review), "Counting" (a
  figure still being counted), and "After you sign" (a follow-up that waits on a signature).
- **Kept by you names its window one way (R9-5):** "84% of 19 runs", with "(version 2)" only where
  more than one version is on screen ("84% of 19 runs (version 2) · in use 79% of 57 runs"), and
  never "so far".
- **One home Region (R9-6):** `JobDeputyStore.homeRegion()` returns the Region of the account's
  latest signed agreement record, else the United States (`{ code: 'US', name: 'United States',
  short: 'US' }`). Setup (which reads the address's `region=` before signing), the deputy's shield
  and its "Your data stays in" line, the footer's "\<Region> home Region" line, Settings, Account,
  and Profile's postal code check all read it; each feature-detects it, and public Help keeps the
  static United States.
- **Did not pass is not a rollback (R9-8).** A version that fails its test has the lifecycle
  `failed`, says **Did not pass** (its own group in the version menu and the danger pill), leads
  with Edit as a new version, and never runs; the version before stays in use. Only a version on
  trial or in use is ever **rolled back**, by the rollback rules or by you, so the Rollbacks figure,
  `JobDeputyStore.rollbacks()`, and every prompt's rollback history count the same things.
- **One fail rule, one reason (R9-9).** A version fails its test if its Test score is below the
  minimum, or more than the allowed drop (5 points by default) below the Test score of the version
  in use; exactly 5 points below passes. A test compares Test scores only (a trial is judged on
  Kept by you), and the system default has no Test score, so against it only the minimum applies.
  It is said in those words everywhere (the rules' summary, the field help, the drawer, and Help),
  and the reason names the rule it broke with the chart's own figures: "78%, 2 points below your
  80% minimum" or "83%, 7 points below version 1’s Test score (90%), more than the 5 you allow". A
  failed test's note names what was in use when it ran ("System default stayed in use then.").
- **Cards in a band never stretch (R9-11).** The cards of a Dashboard row align at the top and end
  at their own heights; no column or list spreads its rows to fill a neighbour's height. Opening
  Show the numbers grows only its own card, and its table spans that card's width.

## Shared patterns (round 7)

The owner's sixth review added rules R10-1 to R10-10 (listed in
[ui-app-redesign.md, round 7](ui-app-redesign.md#the-shared-rules-r10-1-to-r10-10)). These are the
patterns that changed or are new. The APIs live in `brand/app-components.js` and
`brand/app-panels.js`, the markup in the gallery (`brand/components-preview.html`, from Skeleton and
boot to Switch), and the rows in [Component contract](#component-contract).

- **Boot without flicker (R10-1, R10-10).** A page paints once, after its first render, and nothing
  it shows is drawn twice:
  1. **The render hold.** In `<head>` after the stylesheets, `<link rel="expect" href="#first-view"
     blocking="render" />`; as the last thing in `<body>`, after the page's inline script, `<span
     id="first-view" hidden></span>`. Chrome paints only after every shared script and the page's
     first render ran, the prompt summaries included (`app-panels.js` draws the hosts in the markup
     as it runs). Every signed-in page, the agreement, setup, and Invite friends carry it. The dock,
     the flow ribbon's counts, the footer's Region, and the nav badge are drawn as the shared
     scripts run (`JobDeputyComponents.storeReady()`, which `deputy.js` calls), so the first frame
     never shows an empty dock or the other sample's figures.
  2. **`data-skeleton`** (`block`, the default, `lines`, `rows`, `cards`, or `chart`) on each region
     the script redraws after that. Until `html[data-boot="ready"]` the region keeps its box at least
     `--skeleton-min` tall (the page sets its final height at each width), hides its content
     (`visibility`, so its shifts never count and it leaves the accessibility tree), carries
     `aria-busy="true"`, and shows a calm `1.618s` shimmer of placeholders (still under reduced
     motion and Pause motion; a GrayText outline on Canvas in forced colours). For a later load the
     JS form is `JobDeputyComponents.skeleton.show(host, { kind, rows, height, label })` and
     `skeleton.hide(host)`; its label is said once if it still shows after `1s`.
  3. **`boot.ready()`** at the end of the first render reveals every held region in one frame and
     fires one `jobdeputy:boot` event (`detail: { ms, failsafe }`); `boot.whenReady(run)` runs after
     it, and `boot.state` is `hold` or `ready`. A page without `data-skeleton` regions is ready at
     once. Failsafes: the components reveal after `2.5s` with a console warning naming the page,
     and the CSS after `5.236s` without any script. A hold past `400ms` has the deputy say
     "Gathering your numbers." (duty Gathering) until the reveal.
  4. **Split work.** `boot.split(steps, { budget: 40 })` runs the first step at once and each later
     one after a yield once `40ms` are used; `boot.chunks(items, render, { first: 24, budget: 40
     })` renders the first items at once and the rest between yields; `boot.yield()` is one yield
     (`scheduler.yield` where it exists).
  5. **Live parts change in place.** `JobDeputyComponents.morph(target, fresh)` keeps the elements
     whose shape is unchanged and sets only what differs, so focus stays. A store change says what it
     touched (`change.areas`, and `change.progress` for a work tick that saves nothing), so a page
     skips a redraw that would change nothing it shows, and a form with unsaved edits is never
     drawn again.
  6. **Budgets,** every page, usual and large, at `1440`, `1024`, `768`, `390`, and `320`: layout
     shift at most `0.02` after the first paint, no task over `200ms`, and the first view within
     `1s` on this machine. The audit measures the first two (`perf.budgets`).
- **The prompt summary (R10-5).** One component, the only way a page outside Prompts shows a
  prompt: `[data-prompt-summary="<task id>"]` with `data-prompt-size="row"` (the default) or
  `"card"`, drawn by `app-panels.js`, read only. Every size has the same parts: the **name**; the
  version in use with its pill, and a second pill for a newer version testing, on trial, that did
  not pass, or rolled back; the **Test score trend** across its versions, with its scores in words for screen
  readers; the window, **Last 30 days**; **Kept by you** over the window ("79% of 52 runs"; its tip
  names both windows: "Last 30 days, every version: 82% of 34 runs. Version 3, in use since Oct 2:
  88% of 2 runs."); **Tokens**, with a bar of its share of every prompt's tokens ("14% of all
  prompts’ tokens"); and **Ran on**, a small stacked bar (every model in its tip) with the top two
  models in words ("gpt-5-mini 87%, Ministral 3 14B 13%", then "+N"). Every usage figure comes from
  one window, the combinations of `usage({ range: '30d' })`, so a row agrees with Usage's table for
  that range; with no runs in it the three cells read "No runs", and no percentage shows without
  its runs. **One window, one link:** the name is the summary's only link and only Tab stop (a
  `44px` target with a chevron, "open in Prompts" for screen readers, and
  `data-focus-key="prompt-summary-open-<id>"`, so Back returns focus to it) to
  `prompts-preview.html?prompt=<id>&return=<this page>`; there is no separate Open in Prompts, and
  on the Prompts page the name is plain words. A group (`[data-prompt-summaries]`) is a table of
  prompts: the column names once at its top (Last 30 days over the usage columns), the trend key and
  Show the numbers once at its end, and every row on the same tracks from `880px` of row width; a
  lone card has its own window line and key. A row narrower than `560px` folds to one line ("77%
  kept · 51,337 tokens · gpt-5-mini 87%") with a Details button. Figures carry `data-metric`
  (`prompts.<id>.kept.30d`, `.runs.30d`, `.tokens.30d`) only while the store's words match. On a
  store tick it morphs in place. A page that names the window once, or has its own Details, sets
  `data-prompt-window="off"` or `data-prompt-fold="off"`. Pages never restyle `.prompt-summary*`.
  It shows on the Dashboard (eight rows), Searches (two cards), Job matches' Why it fits,
  Applications' two drawers, Résumés' readiness, Materials, and the Prompts page (eight rows, each
  with that page's Details).
- **Return to where you were (R10-3).** A link to a fact's home carries `data-return-link`
  (`place.href(url)` in script); pressed, the components add `return=` (this page with its query
  and anchor) and save the place in `sessionStorage` (`jobdeputy.place.<page file>`): the scroll,
  the address, the open dialogs and disclosures in `main`, the focused control's key, and what the
  page's `place.remember()` returns. A home puts `data-page-back` on its `section.page-intro`; with a
  valid `return=` the components put **Back to \<page>** (`a.page-back`, `13px`/680 `ink` with a
  `green-line` underline, a `44px` target that reaches over the eyebrow's line, so nothing moves) at
  the start of the eyebrow line, and the same words as a second skip link after Skip to content.
  Back goes to the saved address; there, within 30 minutes, the scroll, a dialog's own scroll, and
  the page's `place.restore()` come back, and focus returns to the control you left from (its
  `data-focus-key` or id), scrolled into view, else to the `h1`. `return=` is accepted only as a page
  of this prototype in the same folder, and names come from the nav (Dashboard, Searches, and so
  on). The homes with Back: Account, Connections, Prompts, Usage, Purchases, Activity, Applications,
  and Résumés. Materials and Autofill, a role's two full-screen editors, keep their header Back pill
  (any `a[data-page-back-link]` marks the return too, and `place.markReturn(href)` does it from
  script). The sample email's Back reads the same place.
- **Pagination keeps your place (R10-6).** `JobDeputyComponents.pagination(host, options)` keeps
  every round 5 call as it was and opts in per list: `noun` (the range in words, "13 to 24 of 40
  roles", in place of "Page 2 of 4"), `top` (a compact pager over the list: the range, Previous,
  and Next, shown only with more than one page), `sizes: [12, 24, 48]` with `onSize` (a native Per
  page select at the bottom; a new size keeps the first item you were reading on the page you land
  on), `list` and `heading` (after a change the list's top and the top pager come into view under
  the sticky header, only when they are above it, then focus moves to the heading, `tabindex="-1"`,
  and the change is said once: "Page 2 of 4. Roles 13 to 24 of 40."), and `address` (`?page=` and
  `?size=` through `history.replaceState`, renamed with `param` and `sizeParam`; read back with
  `pagination.fromAddress()`). Both pagers share one state; the page numbers drop first in a narrow
  list, never Previous, Next, or the range; the bottom pager with Per page keeps two rows; and a
  live list's pager morphs in place, so focus stays on Next. Replace, not push: Back leaves the
  page instead of stepping through its pages. The research (GOV.UK, Carbon, Material, Atlassian,
  Nielsen Norman Group on paging against infinite scroll, and WAI-ARIA's `aria-current` with WCAG
  2.4.3) chose these.
- **The live filter bar (R10-7).** `JobDeputyComponents.filterBar(host, { label, search, facets,
  sort, range, noun, onChange })` is one compact row: the search (a `52px` field, debounced
  `250ms`, starting at `200px` and growing to `360px`), each facet as a menu button in the
  multi-select style with its options and counts inside ("Fit: Any fit"; `kind: 'choice'` is one
  of, `kind: 'multi'` the shared multi-select; a `primary: true` choice of at most four options
  keeps chips), the sort as the same menu ("Order: Best fit first"), an optional time range, and
  Clear while anything is set. Every change applies at once, never through an Apply button. The
  result line at the row's end is **quiet while nothing narrows the list** ("42 of 3,120 entries"
  otherwise, said once, politely, `500ms` after the last change; `setResult(null)` blanks it). The
  state is in the address (each part's `param`; a page number is dropped, so a filter change goes
  to page 1) and read back on load. At `720px` and narrower the facets **fold** behind one `44px`
  Filters button ("Filters · 2" while two are set), the search beside it. `setCounts()` takes the
  store's facet counts; `setOptions(name, options)` updates a multi facet in place (focus, an open
  menu, and the order kept); `range.default` is the preset Clear returns to, never a fixed end;
  `compact: true` shows only a facet's value, its name kept for screen readers.
- **The time range picker (D10).** `JobDeputyComponents.timeRange(host, { value, param, presets,
  earliest, onChange })`: a `44px` button with the range in words opens a popover with the presets
  as a radio group (Last hour, Last 3 hours, Last 12 hours, Last day, Last 3 days, Last 7 days, Last
  14 days, Last 30 days, and This month by default; Last 90 days, Last 12 months, and All time where
  a page adds them) and Custom, with From and To as native date and time fields checked as you
  change them. A custom range names its years when it spans two or is not this year ("Oct 12, 2025
  to Oct 2, 2026"). It resolves against the sample clock in your home Region's time, takes the
  store's step for the span (`5m` up to 3 hours, an hour up to 3 days, else a day), and keeps
  itself in the address (`?range=1w`, or `?range=<from>..<to>`). Choosing Custom with the arrow
  keys never moves focus into From. Activity offers every preset; Receipts offer Last 7 days, Last
  30 days, This month, Last 90 days, Last 12 months, and All time, and start on All time.
- **Usage charts and the permutations table (D9, D10).** `usageChart(host, { usage })` draws the
  buckets of `JobDeputyStore.usage()` at the range's step as bars stacked by the group (top 5 plus
  one Other, folded once), labels times alone at an hour or 5-minute step ("06:00", the date at
  midnight, at most eight), draws a dated setting change as a charcoal line and a fallback as the
  diamond, each named in the key, and never reads "0, 1, 1" on its axis; `usageChart(host, {
  ledger })` draws `runsLedger()` buckets in runs. Two days that share a letter both keep their
  labels. `permutationsTable(host, { rows, caption, sort, pageSize })` is every key x model x task
  of a range as one table (Key, Model, Task, Calls, Tokens, Cost, Kept by you, and a Total),
  sorted by header buttons (`aria-sort`) and paged past `pageSize` (24), with `top`, `sizes`, and
  `address` as on lists (Usage opts in to all three: 12 a page to start, `?combos=` and
  `?combosSize=`). Cost on your own keys is an estimate at the provider's list price and says
  so; the Total gives enough decimals to be exact ("$0.245"), and Kept by you totals are exact sums
  of kept over decided. It stays a real table down to a `550px` column (scrolling sideways with
  the Key column held and the far edge faded) and becomes compact rows below.
- **The tokens ring and the runway line (D10).** `allowanceRings(host, { kinds: ['runs',
  'tokens'], size, metrics })` draws the shared ring meters from the store: **Runs** in R9-1's
  words, and **Tokens** for the payer in use, its caption naming the limit's period ("Of 250,000 a
  month on your OpenAI key"; "a day" for a daily limit) or the AI credits left on platform credits.
  `runwayLine(host, { uses, counts })` writes `runway().text` ("At your settings your 4 runs last
  through Sat, Oct 3; your OpenAI key’s tokens through Tue, Oct 13."), adds what uses runs each day
  with `uses`, and leaves the run count out with `counts: false` where the rings show it. Both follow
  the store. The Dashboard's Runs and tokens, Usage's `#runway`, and Purchases' balances use them.
- **The switch (D8).** `label.switch` holds a native `input[type="checkbox"][role="switch"]`, a
  `span.switch-track`, and a `span.switch-label`, with an optional `p.switch-hint` the input
  describes, which says the cost before you turn it on ("Uses 1 run each morning, at 08:00."). A
  `44px` row with a `44px` by `26px` track: off, a `paper-deep` track with a `muted` edge (4.8:1) and
  an `ink-soft` thumb; on, a `green-soft` track with a `green` edge and the `green-ink` thumb at the
  end; the green focus ring; no motion; in forced colours a CanvasText edge and a filled thumb. The
  daily email (the Dashboard and Account) and Your rules' morning tailoring use it.
- **The entry story: three steps (G1).** Sign in and Create account share one story panel, byte for
  byte: the eyebrow "Agentic job applications", the brand line "You set it up. Your deputy applies."
  (a `p.story-title`, not the page's `h1`), the lede, and three chapters, one per step: **Set it
  up** ("Your roles, résumé, and rules.", the pencil and a setup card, "Tell me what you want.",
  duty Setting up), **It finds** ("Roles that fit, from sites you choose.", the magnifier, "I search
  where you choose.", Finding roles), and **It applies** ("Tailored, and sent once you approve.",
  the approval card, "I apply once you approve.", Applying). The strip under the stage,
  `ol.story-strip` of three `button.story-strip-step` (each a Tab stop with its number, name, tool,
  and line; `aria-current="step"` on the current one), replaces the eleven chapter bars. Each
  chapter lasts 4.1, 4.4, and 4.1 seconds (the reading-time rule in [Panda
  teammate](#panda-teammate)); the story plays once and holds on step 3 with Replay story; a saved
  Pause motion holds it still on step 1 with Play story, and reduced motion keeps the control as
  Advance story. On phones the `134px` band shows the brand line beside the panda, with the eyebrow
  above it from `360px` wide, and the strip shows only in the full story; on tablets in one column
  (`721px` to `880px`) the story is compact, the brand line beside the deputy and the three steps
  under both, so the form starts in the first view. No "world's first" claim appears anywhere.
- **The signing moment (G3, R10-8).** The sign card is one sentence
  (`JobDeputyAgreementText.sentence()`), **Sign and continue** (primary) with **Not now**
  (secondary), and the facts read only. Pressing it signs through `JobDeputyStore.sign()` and plays
  the moment in the card's place, at the card's height, so nothing under it moves: the name writes
  on the signature line, a seal stamps with a check, the deputy cheers with the pen in its right
  paw (`react('signed')` on a moment host, `data-deputy-moment`, which never greets and keeps out of
  page-wide calls), and "Signed. Taking you to \<where you go next>." shows. The moment is scrolled
  into view first. With a mouse or touch, focus goes to that line, so a screen reader says "Signed"
  first, and the page goes on by itself `2s` later (about `1.2s` of motion, then time to hear it).
  Signed with the keyboard, focus goes to the way on ("Continue to setup", "Back to \<page>"),
  described by "Signed. Continue when you’re ready.", and the page waits for it (WCAG 2.2.1). The
  way on is a link from the first frame; reduced motion and Pause motion show the signed state at
  once.
- **Touch emulation in the audit.** `scripts/ui-audit.mjs` runs every width under `1024px` as a
  touch device (`Emulation.setDeviceMetricsOverride` with `mobile: true`, and
  `Emulation.setTouchEmulationEnabled`), so `hover: none` and `pointer: coarse` match and a page
  wider than the screen widens the layout viewport as it does on a phone; `--touch=off` runs every
  width with a mouse and `--touch=all` every width with touch. Desktop-pointer runs had missed the
  Dashboard's Applications key widening the page to `807px` on touch screens.
- **Settings has seven tabs:** Account, Connections, Prompts, AI & credits, **Usage**, Purchases, and
  **Activity**. Where the seven don't fit, the strip is one row that scrolls sideways, the edge with
  more tabs past it fades, the current tab is brought into view, and the strip never widens its
  column.
- **Take the tour on phones:** where the intro starts with an eyebrow, Take the tour sits compact
  (`13px`, at least `44px` tall) at the end of the eyebrow's line, so the first item starts higher.
- **One home for buying:** off Purchases, `[data-topup-open]` and `openTopup(kind)` go to
  `shop-preview.html#buy` (runs) or `#credits` with `return=`; the checkout dialog is Purchases' own
  step ("Buy runs", "Buy AI credits"), and each pack says how long it lasts at your settings
  ("Lasts through Tue, Oct 13 at your settings").

**Each fact's home (round 7).** The round 6 table still holds, with these changes:

| Fact | Home | Elsewhere |
|---|---|---|
| A prompt's versions, tests, edits, and models | Settings, Prompts (`?prompt=<id>&return=`); the prompt drawer is its editor only | The prompt summary, everywhere else |
| Usage over time, by key, model, task, and prompt | Settings, Usage (`usage-preview.html`, `#runway`) | The Dashboard's Usage card and Runs and tokens tile; one line on AI & credits |
| Buying runs, credits, and bundles | Purchases (`#buy`, `#credits`) | Get more runs and Buy credits link there |
| Every action, by who | Settings, Activity (`activity-preview.html`) | The deputy's Activity panel, with See all activity; the Dashboard's week line |
| The Gmail scan's schedule and history | Settings, Connections (`#conn-gmail-scan`) | The Dashboard's Gmail card; Applications' Gmail line and Sync from Gmail |
| The daily email, and the email after each application | Settings, Account (`#emails`) | The Dashboard's switch; one line in Your rules |
| A role that needs you | Applications (the board, `?show=need`; `#ready` forwards there) | The Dashboard's "N need you", the nav badge, the To-do |
| How your deputy applies | Applications' Your rules drawer (`#how-you-apply`) | One line and a link |
| The page setting | Résumés' Templates (`#page-setting`) | Materials shows it read only, with Change in Résumés |

## Component contract

These values make the same component render identically on every page. The rendered audit in
[docs/ui-consistency-audit.md](ui-consistency-audit.md) checks them by computed style.

Internal pages are Dashboard, Searches, Job matches, Applications and its autofill preview, Résumés,
Materials, Profile, the Settings pages (Account, Connections, Prompts, AI & credits, Usage,
Purchases, and Activity; Usage and Activity since round 7), Help, and Invite friends. Each links
three shared stylesheets, in this order, before its own `<style>`:

- `brand/app-chrome.css`: the shell and chrome;
- `brand/app-components.css`: the shared components below;
- `brand/deputy.css`: the deputy companion.

Before its inline script, each page loads `app-shell.js`, `app-components.js`, `prompt-guard.js`,
`agreement-text.js`, `sample-store.js`, `deputy.js`, `feedback.js`, and `app-panels.js`. A page's own styles MUST NOT redeclare a selector from `app-chrome.css` or
`app-components.css`; a test fails if one does. Page-specific layout uses page-prefixed classes such
as `.dash-*` or `.apps-*`.

The shared chrome uses these breakpoints:

- `max-width: 1100px`: the sidebar rail;
- `min-width: 1101px and max-height: 820px`: the short desktop;
- `max-width: 720px`: mobile, where the app bar replaces the sidebar;
- `max-width: 520px`: the compact header, where brand and account text collapse before the Back
  action.

Components size themselves with container queries. Entry routes keep their locked story-shell CSS
inline and match the same values. `brand/components-preview.html` shows every component in every
state.

The canonical `:root` block, verbatim on every brand page:

```css
:root {
  color-scheme: light;
  --ink: #1b1a18;
  --ink-soft: #2d2b27;
  --muted: #706d66;
  --quiet: #98948b;
  --paper: #faf8f3;
  --paper-deep: #f0ece3;
  --surface: rgba(255, 255, 255, 0.82);
  --surface-strong: rgba(255, 255, 255, 0.92);
  --header-surface: rgba(250, 248, 243, 0.82);
  --line: rgba(27, 26, 24, 0.12);
  --line-soft: rgba(27, 26, 24, 0.08);
  --line-strong: rgba(27, 26, 24, 0.24);
  --green: #2f9e77;
  --green-soft: #ccebdc;
  --green-wash: rgba(204, 235, 220, 0.55);
  --green-line: rgba(47, 158, 119, 0.36);
  --green-ink: #23795b;
  --orange: #f36b3f;
  --orange-soft: #ffd5c6;
  --danger-ink: #9c4028;
  --blue: #526fe5;
  --blue-soft: #d9def8;
  --on-ink-muted: rgba(255, 255, 255, 0.68);
  --shadow: 0 21px 55px rgba(55, 48, 36, 0.07);
  --shadow-control: 0 10px 21px rgba(27, 26, 24, 0.15);
  --ease-settle: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --font-display: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
  --font-text: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
  font-family: var(--font-text);
  font-synthesis: none;
}
```

| Component | Contract |
|---|---|
| Header | Sticky; `72px` minimum height (`64px` at mobile); padding `0 clamp(21px, 4vw, 55px)`; `header-surface` background; `1px` `line-soft` bottom rule. The page's `scroll-padding-top: 89px` keeps focused controls clear of it |
| App frame | `div.app-frame`: a grid of `var(--app-sidebar-width)` and `minmax(0, 1fr)`. The sidebar is `233px`, `89px` in the rail, and `0` at mobile or when the sidebar is hidden. `main.app-main` holds the `.page-shell`, and the footer after the frame repeats the two columns. See [App shell](#app-shell) |
| Sidebar | `div.app-sidebar`, not a landmark, holding `nav.app-nav` and the deputy slot (`.app-sidebar-deputy`, pushed to the bottom). Sticky at `top: 72px`, `calc(100dvh - 72px)` high, scrolling inside when taller. Padding `21px 12px 21px 13px` (a `207px` content box beside the `1px` `line-soft` end rule), `header-surface` background, `21px` gap |
| Nav link | `a.app-nav-link`, at least `48px` high (`44px` on the short desktop; `64px` stacked in the rail). Padding `0 13px`, `13px` gap, `11px` radius, a `1px` transparent border, a `20px` line icon, and a `14px`/650 `ink-soft` label (`12px` in the rail, where since round 6, part 3 it takes the link's whole width with `-0.02em` letter spacing, so at the usual text spacing every label, current or not, is one line; T5-1). Hover uses `surface` with a `line` border. Current (`aria-current="page"`, or `"true"` for a child route) uses `surface`, a `line` border, a real `3px` `green` leading border, and an `ink` 700 label; in forced colours the leading border takes `Highlight` |
| Nav count | `.app-nav-count`: a `12px`/650 pill, at least `24px` wide. Neutral is `ink-soft` on `paper-deep`; attention is `ink` on `orange-soft`, with its meaning in visually hidden text (`1 needs you`). Applications counts drafts waiting for approval and hides at zero. Round 7: it counts `apps.needYou`, the roles that need you (an approval, an apply job waiting for you, an email move waiting for your signature, an offer), the same figure as the Dashboard's "N need you" and Applications' Needs you; 3 on the usual sample (`3<span class="sr-only"> need you</span>`), drawn as `sample-store.js` runs |
| App bar and Menu | At `max-width: 720px` the sidebar becomes a static bar under the header: `.app-menu` with a `44px` Menu button (`Menu · {page}` while it fits, otherwise `Menu`, with the page in the accessible name) and the deputy chip. `brand/app-shell.js` makes the list a disclosure (`aria-expanded`). Escape closes it and returns focus, and so does following a link; crossing the breakpoint resets it. Without script the list stays open |
| Deputy dock | `aside.deputy-dock` in the sidebar slot; sizes, states, and motion are in [Deputy companion](#deputy-companion-signed-in-pages). Activity uses the account-menu popover treatment (`surface-strong`, `15px` radius, `--shadow`) beside the sidebar, or full width under the app bar at mobile |
| Wordmark lockup | `jobdeputy-mark.svg` at `62px` wide; markup `<span>Job</span><span>Deputy</span>`; tagline `Your search partner` |
| Entry header link | `13px`, weight 400, `muted`, with a green `→` drawn by `::after` as `content: "→" / ""` so it stays out of the accessible name |
| Phone story band | On entry routes at `720px` and narrower the story is a `134px` band under the header: the animated panda at the left (every pose and reaction kept), its line beside the head, the duty status top right, and the story controls bottom right; the story copy stays in the accessibility tree only. While a form field has focus the band folds into a `64px` strip (the head and its line) held under the header, with `scroll-padding-top: 144px`, and returns when focus leaves the form; no transition in reduced motion. Previous, Next, or Advance opens the full story, and Hide the story folds it again. The form heading and first field sit in the first viewport at `390x844`, `375x667`, and `360x740` |
| Google account chooser | A small JobDeputy dialog (never a copy of Google's interface) opened by Continue with Google on Sign in and Create account: "Choose an account to continue to JobDeputy", Alex Morgan, and "Use another account", with "Prototype · no Google request is made". A bottom sheet on phones. From Sign in a returning account goes to the Dashboard; from Create account, or with another account, to setup |
| One-tap card | On Sign in, when the browser signed in before (`localStorage['jobdeputy.lastAccount']`; `?returning=1` forces it): the avatar, "Continue as Alex", the email, and "Not you?" (which forgets it). One tap opens the Dashboard |
| Story stage | A size container shared by every entry route. A top band holds the capability label on the left (hidden at `350px` and below) and the duty status on the right. A bottom band holds the story controls inside the card padding, then the chapter bars; on phones the bars run full width under the controls. The art stands `4px` above the bottom band and shrinks so the head and a three-line speech bubble fit between the bands. The speech tail points beside the ear when the stage is at least `480px` wide (`640px` stacked) and above the head otherwise. The story copy is as tall as its longest chapter, so chapters never move the stage. Art box: `--art-x: 58.5cqw` on desktop, `--art-feet: 0.061`, `--art-crown: 0.849`, `--head-crown-y: 0.88`, and `--head-ear-x: 0.255`. A phone stage under `340px` wide scales the props to `0.78` so the speech bubble never covers them |
| Back action | `44px` pill, padding `0 13px`, `1px` `line`, `surface`, `13px`/680 `ink`, never wraps |
| Header actions | `HeaderActions: start` and `end` markers inside `.header-actions`, before a child route's Back action and the account menu, byte-identical on every internal page: `button.header-action.header-feedback[data-feedback-open]` (a speech-bubble icon, "Feedback") and `a.header-action.header-invite` to Invite friends (a gift icon). Icon and label at `1101px` and wider; `44px` icon buttons with the label as the accessible name at `1100px` and narrower. Invite leaves the header at `359px` and narrower, and beside a Back action at `720px` and narrower (it stays in the account menu). The Invite page marks its own link `aria-current="page"` with a green ring |
| Feedback drawer | `brand/feedback.js` renders one `dialog.drawer.feedback-drawer` for every `[data-feedback-open]` (optional `data-feedback-topic` and `data-feedback-context`; script form `JobDeputyFeedback.open()`). Five line faces with text labels as a radio group, each tinted by its rating (Frustrated and Not great `danger-ink`, Okay `blue`, Good and Love it `green-ink`, each on a white disc at `3:1` or better), single-choice topic chips, an optional `1,000`-character note with a counter, "Include this page" (on) and "You can email me" (off), then Send and Cancel. Send needs a face or a note (FieldFeedback otherwise), saves through `JobDeputyStore.addFeedback`, and shows a thank-you state with the prototype note; the deputy listens while it is open and thanks the person after. A bottom sheet at `720px` and narrower (at most `89svh`, safe-area padding) |
| Account chip | `44px` pill, `1px` `line`, `surface`, `34px` avatar, name `13px`/700, tier `12px` `muted`; the menu is opaque `white` with a `15px` radius, `--shadow`, and a `1px` `line` border (no blur, so nothing reads through it), above every sticky layer; at `720px` and narrower it is a full-width sheet under the header over a scrim that closes it. `app-shell.js` closes it on Escape (focus returns to the chip), an outside click, or focus leaving. Rows at `13px`/620, `48px` high: Profile, Settings (Account), AI & credits, Purchases, Invite friends, Help & support, Show me around (`[data-tour-open]`, only when the page has a tour), Send feedback (a button that opens the Feedback drawer), and Sign out in `danger-ink` (round 6). The menu is byte-identical on every internal page and marks no row current (the nav and the tab strip say where you are). The free-access line reads the store's allowance |
| Editorial intro | Page eyebrow, then `h1`, then intro, using the roles above |
| Page intro (round 6) | `section.page-intro[aria-labelledby=<the h1>]` > `div.page-intro-copy` (an optional `p.eyebrow`, the `h1`, the lede `p.intro-copy`, then anything else of the page's) + `div.page-intro-actions` holding only `button.secondary-action.page-tour[data-tour-open]` (Take the tour, shipped `hidden`; the tour engine shows it). `app-chrome.css` places it: from `721px` a grid of the copy and the actions, the actions at the right end, `34px` from the copy, top aligned with the `h1` (they start below an eyebrow's line and its `13px` margin); at `720px` and below the actions on their own row, `21px` under the lede, at the start. An actions box whose button stays hidden takes no room. Page CSS never positions or restyles these classes (`tour-placement.test.ts`). On the Settings pages the eyebrow reads Settings. Round 7: on phones, where the intro starts with an eyebrow, Take the tour sits compact (`13px`, at least `44px`) at the end of the eyebrow's line; a home's `section.page-intro[data-page-back]` gets Back to \<page> at the start of the eyebrow line (see [Shared patterns (round 7)](#shared-patterns-round-7)) |
| Settings tabs (round 6) | `nav.settings-tabs[aria-label="Settings"] > ul.settings-tabs-list > li > a.settings-tab` between `SettingsTabs: start` and `end` markers, directly under the page intro of the five Settings pages, byte-identical apart from `aria-current="page"` on the current tab. Links, one page each (not ARIA tabs): Account, Connections, Prompts, AI & credits, Purchases. Tabs are `44px`, `14px`/650 `muted` with a transparent `3px` bottom border; the current tab takes `surface`, a `line` border, a `green` bottom border, and an `ink` 700 label; in forced colours its border takes `Highlight`. The strip wraps on narrow screens over a `1px` `line` rule. Round 7: seven tabs (Account, Connections, Prompts, AI & credits, Usage, Purchases, Activity) on the seven Settings pages, in one row at every width: where they don't fit it scrolls sideways, the edge with more tabs fades, the current tab is brought into view, and the strip never widens its column |
| Task surface | Radius `34px` (`22px` at mobile), `1px` `line-soft`, `surface`, `--shadow` plus an inset `surface-strong` highlight, padding `34px` (`21px` at mobile) |
| Primary action | `52px`, padding `0 21px`, radius `15px`, `ink` background, white `15px`/680, a `1px` transparent border (the visible boundary in forced colors), `--shadow-control`, never wraps; hover `ink-soft` with a `1px` lift |
| Secondary action | `52px`, radius `15px`, `1px` `line`, `surface`, `ink` `15px`/680, never wraps; hover white with `line-strong` |
| Compact action | `44px`, padding `0 13px`, radius `11px`, `1px` `line`, `surface`, `14px`/680, never wraps |
| Disabled actions | Secondary and compact: transparent fill, `line-soft` border, `muted` text. Primary: `paper-deep` fill with `ink-soft` text. No shadow or lift |
| Form field | Label, then control, then helper. Text inputs, selects, and textareas are at least `52px`, radius `14px`, `1px` `line`, `surface`, `15px`, inline padding `15px`. Focus uses the green border and a `0 0 0 4px` `green-wash` ring |
| Status pill | `12px`/650, `28px` minimum height, padding `0 11px`, `999px`. Success is `green-ink` on `green-wash`; neutral is `ink-soft` on `paper-deep`. A `1px` transparent outline inset by `1px` becomes the boundary in forced colors without changing the size |
| Tag | `12px`/400, `ink-soft` on `paper-deep`, `999px`, with the same forced-colors outline as the status pill |
| Choice chip | `44px`, `14px`/650, `999px`, unselected on `surface` with a `line` border. Selected uses the one selected style (below) with a check drawn as `content: "✓" / ""` so it stays out of the accessible name. Round 6, part 3 (T1-7): at most its card's width (`max-width: 100%`) with `8px 13px` padding, so a long answer of your own wraps between words (and breaks a word longer than the chip) inside its card; one line still measures `44px` |
| One selected style | Every choice control (choice cards, chips with inputs, quick picks, segmented options, thumbs, and the feedback faces) looks chosen the same way: a `green-soft` fill, a real `2px` `green` border (padding gives back the extra pixel, so nothing moves), an `ink` 700 label, and a `green-ink` ✓ where there is room. Focus stays a separate ring; in forced colours the border takes `Highlight`. Secondary text inside a selected control turns `ink-soft`, because `muted` falls below AA on `green-soft`. The one exception is a chosen feedback face, whose card follows its rating so a low rating never reads as "good": ratings 1 and 2 take an `orange-soft` fill with a `2px` `danger-ink` border and check, rating 3 a `blue-soft` fill with a `2px` `blue` border and an `ink` check, and ratings 4 and 5 the shared green |
| Choice card | `fieldset.choice-cards > label.choice-card`: a native radio or checkbox card at least `52px` high. It has a control on the left, a `15px`/650 label, optional `12px` `muted` metadata, and an optional `24px` line icon on the right. Selected cards use the one selected style; the current default gets a neutral status pill. Onboarding, AI & credits, and Profile use it |
| Feedback panel | `surface` background on every variant, `1px` `line`, radius `13px`, padding `13px`, and a `3px` leading rule: `quiet` for notice and static information, `orange` for warning, validation, and operation error, `green` for success. A `24px` icon circle (`paper-deep`, `orange-soft`, or `green-soft` with `green-ink`); title `13px`/700; message `12px` `muted`; action `.feedback-panel-action` as a compact action. Markup on every page: `.feedback-panel[data-kind]` > `.feedback-panel-icon` + `.feedback-panel-copy` (`.feedback-panel-title`, `.feedback-panel-message`) + optional action with `.has-action` |
| Section header | Eyebrow, `h2`, then copy at the full panel width. A section status pill shares the eyebrow row and wraps below it. A trailing control (the Profile photo) sits beside the copy only while the panel's content box is wider than `560px` (a container query); otherwise it stacks below |
| Section links | `.section-links`: a wrapping row of compact actions linking to the sections of a long page (Help: Privacy, Security, Accessibility, Help), `8px` apart, `21px` above the first section. It replaces the retired in-page side rail, so no page carries a second rail beside the app sidebar. Profile's section list is the one exception: a sticky `178px` list on the right of its sections at `1101px` and wider (never beside the app sidebar), which becomes a sideways tab row below that width |
| Footer | `ink` surface, no top border, padding `34px 0`, `.footer-inner` as wide as the page shell, and an `ink-soft` divider between rows. Brand `13px`/700 white with `12px` `on-ink-muted` copy. Links are `13px`/620 white and `44px` high. Every internal page shows the same links (round 6): Dashboard, Searches, Job matches, Applications, Résumés, Profile, Settings, AI & credits, Purchases, Invite friends, then Privacy, Security, Accessibility, Help. Links sit in groups (Dashboard, Searches, Job matches; Applications, Résumés, Profile; Settings, AI & credits; Purchases, Invite friends; Privacy, Security; Accessibility, Help) that wrap as units `21px` apart, so no row ends with one orphaned link. The footer starts after the sidebar column (`margin-inline-start: var(--app-sidebar-width)`), so the fixed sidebar runs beside it and its content edges match the page shell; labels narrower than `44px` keep a `44px` target through a centred `::before`. The Region line is `12px`; since round 6, part 3 (R9-6) `app-components.js` writes its Region from `JobDeputyStore.homeRegion()` on every page and after every store change ("United Kingdom home Region"), and the markup's United States stands without the store and on public Help |
| Skip link | `44px`, padding `0 13px`, radius `11px`, `ink`, white `13px`/680 |
| Favicon | `<link rel="icon" href="./jobdeputy-mark.svg" type="image/svg+xml" />` on every page |
| Stat row | `dl.stat-row > div.stat`: stats inside a surface, divided by `1px` `line` rules rather than drawn as separate cards. Stat figure in display `28px`, label `12px`/650 `muted`, meta `12px` `muted`. `.is-attention` adds an orange beacon before the label, and `.is-pending` mutes a figure still being counted, which reads a word ("Counting"), never a dash (round 6, part 3, R9-4) |
| Meter | `div.meter[role="meter"]` with value, minimum, maximum, and `aria-valuetext`, always beside visible text. An `8px` `paper-deep` track with a `1px` `line` inset and a `green-ink` fill (`--value`). `.is-stepped` divides it into `--steps` segments |
| Ring | `div.ring[role="meter"]`: an `89px` SVG circle with an `8px` `paper-deep` track and a `green-ink` arc with round caps; display `28px` figure and `12px` label. Profile strength and résumé readiness use it. `.is-small` is `55px` and `.is-tiny` `34px`; the tiny ring hides its figure from sight, so it always sits beside words that say the same thing |
| Flow ribbon | `nav.flow-ribbon[aria-label="How roles move"]` between `FlowRibbon` markers, under the intro of Searches, Job matches, and Applications: three linked steps (Searches · sources, Job matches · found, Applications · tracked) with the AppNav icons and CSS arrows (empty alt text). The current step looks like the current nav link (a real `3px` `green` leading border, `ink` 700) and, since round 6, part 2, shows its name only (its count is hidden, because the page shows its own count right below; CSS only, so the markup is unchanged). `app-components.js` fills `[data-flow-count]` from `JobDeputyStore.flowCounts()` after every change. On phones three equal columns, label over count, `52px` tall |
| KPI tile | `ul.kpi-grid > li > a.kpi` (or `div.kpi`): `21px` padding, `22px` radius, `1px` `line`, `surface`; a `13px`/650 label, a display `34px` value (`.is-hero` up to `55px`; `28px` at `360px` and narrower), `13px` `muted` meta with an optional trend glyph, and an optional visual (sparkline, tiny ring, or stacked bar). One link per tile, ending in a visually hidden destination; hover lifts, focus is the green ring. `.is-attention` adds the orange beacon and words that say why; `.is-pending` mutes a value still being counted, which reads a word ("Counting"), never a dash (R9-4). The grid auto-fits `178px` columns, `21px` apart, two columns at `720px` and narrower |
| Sparkline | `span.sparkline[data-values]`: the script draws an `aria-hidden` `2px` line (`green-ink`, or `blue`) with a dot on the last point and no axes; the host carries a visually hidden summary |
| Horizontal bars | `ol.hbar > li > a.hbar-row` (or `div.hbar-row`): a `13px`/650 label, the value, and a `13px` `paper-deep` track whose fill is sized by `--hbar` (0 to 1), `green-ink` by default or `data-tone`. The whole row is the `44px` link. The pipeline, sources, and fit use it |
| Stacked bar | `div.stack-bar` (`aria-hidden`): a `13px` pill of segments sized by `--share` with `2px` gaps, paired with a `ul.chart-legend` whose items are the links. Segments are pointer-only links (`tabindex="-1"`) |
| Stacked bar chart (round 6) | `JobDeputyComponents.stackedBars(host, { title, bars, series, unit, cap, otherLabel, keyLabel, barLabel, caption, labelledBy, keyCounts, empty })`, fed straight from `JobDeputyStore.newRolesSeries()`: `figure.bar-chart.is-stacked`, each bar a stack of parts (`a.bar-chart-part`, pointer only, when the part has `href`) with the bar's total on top (its `data-metric`), a key of the series (top `cap` by total in their tones, the rest and any `other` part as one hatched Other; `keyCounts: false` names colours only), and Show the numbers repeating each part's link (the keyboard path): since round 6, part 2, one row per bar, with `barLabel` ("Search"), `partsLabel` ("Parts": "Google 2, Microsoft 1" in one cell, each part a link when it links), and the unit as the total's heading. Every date shows while each fits the room from one bar to the next; only where they don't are they thinned, counted back from the last. `bars[].sublabel` (for example "Keep watch" on a run of several sources) is a second muted line under the date and joins the bar's row in the table; since round 6, part 3 (T1-4) a date and its sublabel are thinned as one (no sublabel under a missing date), two dates that read the same keep their times, and where a time does not fit the repeated date goes. `caption: false` or `labelledBy` uses the card's own heading |
| Donut | `.donut` (in a `figure.chart`) with a `144px` `.donut-ring` and centre total; `app-components.js` draws the segments from the `ol.chart-legend` (`data-value`, `data-tone`) with `2px` gaps. Segments open their link with a pointer; the legend links are the keyboard and screen-reader path. In forced colours segments become outlined shapes |
| Chart frame | `figure.chart`: a `figcaption.chart-title` and an optional `.chart-action` link on one row, the chart below, and `.chart-empty` (a prop-only illustration and one line) when there is no data. Every chart shows its values as text and carries the sample note |
| Chart tones | `data-tone`: `green`, `blue`, `orange`, `ink` (charcoal), `quiet` (grey), plus `teal`, `indigo`, `gold`, `wine`, each drawn from its `--viz-*` data colour (see Data colours), never a brand token, and (round 6) `other`, the hatched Other. Text never takes a tone. Fills grow once (`618ms`) on first render, never in reduced motion or after Pause motion; nothing loops |
| Thumbs | `fieldset.thumbs`: a legend ("Was this match right?") and two `44px` `label.thumbs-option` radios (Yes, No) with line thumb icons. No reveals optional reason chips and a Tell us more button that opens Feedback with the context. A bubbling `jobdeputy:thumbs` event carries the answer |
| Quick picks | `fieldset.quick-picks > label.quick-pick`: a `52px` radio tile (a company mark, a name, and a host line) at least `233px` wide. `JobDeputyComponents.matchQuickPick(fieldset, address)` selects the pick a typed address matches, or clears them all. Onboarding's first source and the Searches omnibox use them |
| Stage track | `nav.stage-track > ol > li > a.stage` (or `button.stage`): `surface`, `1px` `line-soft`, `22px` radius. Equal stages at least `89px` wide, each a display `28px` count over a `12px`/750 uppercase name. Separators are `1px` `line` with a `content: "›" / ""` chevron. The selected stage uses `green-wash`, an inset `green-line`, a `green-ink` name, and `aria-current="true"`. It wraps to four columns below `760px` of its container and two below `495px`. Stage labels come from `JobDeputyStore.STAGES` |
| Checklist | `ol.checklist`: a `24px` status circle (done is a `green-ink` ✓ on `green-soft`; to do is a `2px` `line-strong` ring; optional is dashed), a `15px`/700 title, `12px` `muted` metadata with the state in words, and one trailing compact action. The header shows `n of N done` and a stepped meter |
| Data table | A real `table.data-table` with explicit table roles, inside a labelled, focusable `section.data-table-wrap`. The header row is `paper-deep` with `ink-soft` `12px`/750 uppercase; rows are at least `52px`, with `14px` `ink` cells, `13px` padding, and `1px` `line` rules; hover is `surface-strong`. Sort buttons set `aria-sort`, and checkbox-selected rows get a `3px` `green` leading border. Rows stack under `695px` of container width, with labels from `data-label`; wider tables scroll inside the region |
| Board | `section.board` (labelled, `tabindex="0"`) of lanes at least `260px` wide that scroll horizontally only inside the board. A lane header shows a `13px`/700 title and a count pill. A `board-card` is `surface` with a `1px` `line` border and `22px` radius: a title link that opens details, the company with a `.company-mark`, tags, the next step, and a labelled `Move to` native select (`52px`). There is no drag and drop |
| Drawer | Native `dialog.drawer` opened with `showModal()` from `[data-drawer-open]`, and closed by `[data-drawer-close]`, Escape, or a backdrop click; focus returns to the opener. It is `min(480px, 100vw - 26px)` wide and full height, with `34px` padding (`21px` at mobile), `paper`, a `34px 0 0 34px` radius (`22px` at mobile), `--shadow`, and a `line-strong` backdrop. The header holds an eyebrow, a section-heading `h2`, and Close. It has its own visually hidden status channel. Its scroll padding (the header's and the footer's height plus `13px`) keeps a focused control clear of them; since round 6, part 3 (T5-5) it counts a part only while that part sticks and is measured again as focus moves, and on a screen `640px` tall or less (a phone with its keyboard up) the header scrolls with the content while a field in the drawer has focus. Focus returns to the opener even when the page drew it again while the drawer was open: the control with the opener's `data-focus-key` (else its id) outside the drawer (R9-3, T5-4) |
| Segmented | `fieldset.segmented` of native radios: a `44px` `paper-deep` pill with `4px` padding. The selected option uses the one selected style without the check |
| Tabs | `div.tabs[role="tablist"][data-tabs]` of `role="tab"` buttons: `44px`, `14px`/650, `11px` radius. Selected is `surface`, `1px` `line`, `ink` 700, with a `3px` `green` bottom border. `app-components.js` runs the ARIA tabs pattern: arrow keys, Home and End, automatic activation, and a roving `tabindex`. A panel becomes a tab stop only while nothing inside it can take focus. `.tabs.is-even` keeps a short set with counts on one row at `720px` and narrower: equal columns, `64px` tabs, `13px` labels, the count under the label |
| Timeline | `ol.timeline`: a `1px` `line` spine with `12px` dots: done `green-ink`, current ring, attention `orange`, upcoming `line-strong` ring. Each item has its state in words, a `12px` time, a `14px`/680 title, and `12px` detail |
| Empty state | `.empty-state`: a prop-only deputy illustration (`data-deputy-prop`) or a `55px` icon circle, a `15px`/700 title, `15px` `muted` copy, and actions. It never draws a second panda |
| Upload zone | `.upload-zone`: a dashed `1.5px` `line-strong` border, `22px` radius, `surface`, and `34px` padding. A visible button opens a hidden native file input. Drag-over uses `green-wash` with a `green-line` border. Files list their honest state: Uploading, Checking the file, Reading text, Ready, or Failed with recovery |
| Toolbar | `form.toolbar`: `paper-deep`, `22px` radius, `13px` padding and gap, labelled `52px` fields and compact actions; it wraps |
| Sample note | `p.sample-note`: `12px` `muted` with a `16px` information circle, reading `Sample data · not connected` |
| Company mark | `span.company-mark`: a `34px` tile with an `11px` radius and `12px`/700 `ink-soft` initials on `paper-deep`. It is `aria-hidden` and always sits beside the company name. It is for third parties only, never the JobDeputy identity |
| Step progress | `.step-progress`: a `12px`/650 `Step n of N` label over steps that mirror the story chapter bars (a `3px` `muted` track, done and current filled `6px` `green-ink`) |
| Bar chart | `figure.bar-chart`: a caption with a legend (input `green-ink`, output `ink-soft`), an `aria-hidden` plot with five ticks, and a `details` holding the same numbers as a table |
| Prompt drawer (round 5) | `brand/app-panels.js` renders one drawer for every `[data-prompt-open="<task id>"]` (the eight tasks: `read`, `rank`, `tailor`, `letter`, `answer`, `check`, `mail`, `reply`), `JobDeputyPanels.openPrompt(id)`, or `?prompt=<task id>` (round 6, part 3, T4-4: also `?prompt=score-fit` and any prompt's visible name as a slug, such as `score-fit-and-give-reasons`, in any case; a `?prompt=` that names no prompt opens nothing and shows one notice under the page's intro, `.page-link-notice`, R9-2). Round 6 puts acting first: **Versions and tests** (the prompt control, full view, below), then **Your instructions**, with the guardrail checks of `brand/prompt-guard.js` updating as you type (debounced, announced once when the result changes) and Save off, with its reason beside it, while a check blocks or the checks aren't loaded; Save keeps a new **draft** and starts its test at once (Edit as a new version lands here with that version's text); then the **System prompt**, read only ("JobDeputy system prompt, version 2026.10.1", the locked rules, how your instructions and the data blocks fit in, and the full prompt in a closed disclosure); **How it runs** (where, when, the model once from the one AI setting, the limits); and **Stats** with the same two measures. A bottom sheet on phones. Its styles live in `app-chrome.css`. Round 7 (R10-3): the drawer is the Prompts page's editor only; on every other page `[data-prompt-open]`, `openPrompt()`, and `?prompt=` save your place and go to `prompts-preview.html?prompt=<id>&return=<this page>` (`&edit=<version id>` or `&compare=1` when asked), and on Prompts they fire a cancelable `jobdeputy:prompt-open` so the page opens the row in place. Edit as a new version opens it as the editor alone ("Edit as a new version", "New version of \<name>", no Versions and tests block) |
| Prompt control (round 6) | `app-panels.js` renders every `[data-prompt-control="<task id>"]` host on load, any host added later, and again on every store change; pages write no script. `data-prompt-view`: `full` (Settings, Prompts' detail and the drawer), `compact` (Searches: the version menu with its chip, Kept by you, the one next step, the small Test score trend, See the prompt, and "Every other action, Compare, and the stats are in See the prompt."), or `row` (one line: the version menu with its chip, Kept by you, the one next step, and Details for the page's panel named by `data-prompt-details`; `data-prompt-next="primary"` makes the step a primary action); `data-prompt-parts="detail"`, `data-prompt-stats="on" \| "folded"`, `data-prompt-meanings`, `data-prompt-metric`, `data-prompt-note`, `data-prompt-see`, and `data-prompt-heading` shape it. It shows a native `select.prompt-control-select` labelled Version (round 6, part 2: the versions by name only, in groups by state: In use first, then Testing, Trying on N% of runs, Draft, Did not pass (round 6, part 3, R9-8), Rolled back, Retired), one chip for the chosen version's state, an In use line in the full view only, **Kept by you** (each figure with its window: "84% of 19 runs", with "(version 2)" where more than one version shows; round 6, part 3, R9-5) and **Test score** with their one-line meanings, a running test ("Replaying decision 23 of 40" with a bar from that count, the time counting up, each check ticking, "You can leave. I'll tell you when it's done."), the last result in words (which measure, by how much, what stays in use) with Rollback rules, and the actions from the store's `lineup[].actions` in one order: Use this version, Test it, Compare with the one in use, Edit as a new version, Roll back, then See the prompt; a disabled action says why beside it. **Roll back asks first** (round 6, part 2) in every view that offers it: "Roll back to the system default? Version 2's trial ends." (the button's own words since part 3) with Roll back and Cancel, focus on Cancel, Escape cancelling without closing a drawer, and (part 3) focus back to the Roll back button that asked after Cancel or Escape, and to the version menu only after a finished roll back. Round 6, part 3: a version that did not pass (lifecycle `failed`) takes the danger pill and leads with Edit as a new version; its result names what was in use when it ran ("System default stayed in use then."); and a row's Details (`data-prompt-parts="detail"`) leaves out the next step the row above already shows. While a test runs, its count follows the store once a second in every control, wherever it started. The Kept by you figure carries `data-metric="prompts.<id>.agreement"` only for the version in use. No live region inside it; a finished test is said by the background notice. Buttons and pills never wrap their own words; under `360px` the three long actions take short names. Its CSS ships with the file (`style#jd-prompt-control`, canonical tokens). Round 7: only Settings, Prompts (inside each row's Details) and the drawer draw it; every other page shows the prompt summary. With no runs it shows no Kept by you ("No runs"), and every figure says its runs |
| Buy dialog and checkout | The same file's dialog for `[data-topup-open="credits" \| "nightly"]` (round 4's `"ai"` opens credits) or `JobDeputyPanels.openTopup(kind)`: the three packs of the kind with tokens or runs and the store's price, and See everything in Purchases (round 6; the eyebrow and its messages say Purchases too); `JobDeputyPanels.checkout(itemId)`, `[data-checkout]`, or `?checkout=<item>` opens the sample checkout (the item, what it adds, the price, tax at checkout, the agreement gate when needed, Add to my sample account, "Nothing is charged"), which calls `buy()` and celebrates. Round 6, part 3 (R9-1, T1-R3): the runs dialog leads with the ring's figure ("125 of 190 runs left this month: 10 free, 180 bought. They last through Tue, Oct 6."), and when the purchase leaves no opener (the page drew it again), focus goes to the page's own Get more runs or Buy for that kind. Round 7 (R10-3): the dialog is Purchases' own step ("Buy runs", "Buy AI credits"); on other pages `[data-topup-open]` and `openTopup(kind)` go to `shop-preview.html#buy` or `#credits` with `return=`, and each pack says how long it lasts at your settings ("Lasts through Tue, Oct 13 at your settings"), never nights |
| Tooltip | One shared `div.tooltip#jd-tooltip[role="tooltip"]` for every `[data-tip]` (and `data-tip-title`): on hover with a mouse or pen and on focus, held while hovered, hidden by Escape, inside the viewport and clear of the fixed chrome, never over its trigger; a focusable trigger gets `aria-describedby` while it shows. Pointer-only segments borrow their key item's tip. Touch shows no tooltip; the chart key carries the meanings there. No fade when paused or reduced |
| Chart key | `ul.chart-key`: a swatch, the name, the count, and a one-line meaning per colour, each item a link like a legend. In tiles `chart-key is-compact is-inline` hides the meanings on fine hover pointers and shows them on touch, so a chart never carries two copies of a count |
| Split tile | `li.is-split > div.kpi.kpi-split`: a label, the main value as a link, one supporting line, a `stack-bar` of linked segments, and a compact chart key; every part carries its tip. It spans two columns where the grid has two; a top row orders split, single, split, single so it packs at three, four, and six columns; `li.is-wide` takes the full row on phones. The Dashboard's Applications ring tile puts its key in one column beside the ring when four tiles share a row (its stages share the spare height, so the tile has no empty band) and in two columns when two share a row |
| Allowance meter | `div.allowance`: a label, a bar of used (a quiet hatched grey), left (`--viz-left`: teal for Deputy Assist, indigo for runs, green with no kind), bonus (gold), and bought (wine) parts in the order they are spent, a key with every number in words, an optional "Lasts through" note, and an optional action (Buy credits, or Get more runs since round 6, part 2); `.is-attention` adds the orange beacon. `JobDeputyComponents.allowance.set(meter, counts)` |
| Ring meter (rounds 4 and 5) | `div.allowance.is-ring[data-meter-kind="assist" \| "watch"]` with `div.allowance-ring` (`.is-compact` `88px`, else `120px`): the allowance meter as a ring from the same parts and `allowance.set` values, clockwise from the top: used (hatched grey), left (teal for Deputy Assist, indigo for runs), bonus (gold), bought (wine), `2px` gaps. The centre holds the main figure and its unit (runs: "6" over "of 10 left" on the usual sample since round 6, part 2; since part 3, R9-1, the runs ring has two parts, used and left, its centre is `runs.left` over "of `runs.all` left" (free plus bought: "125 of 190 left" on the large demo), its key's Left and Used rows give their numbers ("6 left", "4 used"), and once anything was bought one quiet line gives the split, "10 free + 30 bought"; AI credits: the tokens left over "tokens left", `.is-long` for big figures; a token limit: the percent used); the key names the centre's part first, by name only, and gives every other count, so no figure repeats. A token limit's centre is a percent, so its key gives both figures ("49,810 used", "200,190 tokens left") and one line names the limit and the reset ("Of your 250,000-token limit · resets Sun, Nov 1") on every page. The meter explains its own marks (attention dot, reached mark); segments carry tips; one `618ms` sweep on first render, none when paused or reduced; forced colours keep the parts distinct. Every allowance shown as a block is a ring. Round 6, part 2: a ring shows only at its fact's home and as a snapshot (the Runs ring on Purchases, the Dashboard, and Searches; the token limit's ring on AI & credits, and on Searches only under 20% left or paused); elsewhere an allowance is one line. Round 7 (D10): `allowanceRings()` draws the runs ring beside a **tokens ring** for the payer in use (the Dashboard's Runs and tokens, Usage, Purchases), its caption naming the limit's period |
| Donut tile (round 4) | `div.donut.is-tile` inside a split tile: an `88px` donut drawn from the tile's `ul.chart-key`, a linked centre (`a.donut-total`, the total and its unit), and pointer-only segments (`tabindex="-1"`) that open their filter and borrow their key item's tip; the key items stay the keyboard path |
| Run tracker (round 5) | `div.run-tracker[data-state="queued" \| "live" \| "complete" \| "stopped"]` and `JobDeputyComponents.runTracker(host, runId?, { channel, watchHref, metrics, store, compact, quiet })`: the source and its state pill, the four stages as a stepper, each with its own real counter from `run().stages` ("5 of 9 pages read", "18 roles read", "35 roles scored · 1 new"), the time counting up from real seconds ("Running for 1 min 12 s"), and "Finished in 1 min 40 s · 44 checked · 2 new". **No progress bar**: nobody knows in advance how long a run takes. `compact` is one row for a tile. Stage changes and the finish are announced once; the ticking time is never a live region; the current step pulses only while live, never when paused or reduced |
| Live pill and live table | `span.live-pill.is-live`: a dot that pulses only while a run is live (still when paused or reduced). `table.live-table` with explicit table roles: each row one stretched link, new rows highlighted once by `flagNew` (not when still), and rows that become cards under `560px` of width |
| Need markers | `span.need-pill[data-need="required" \| "optional"]` (Required: `danger-ink` on `orange-soft` with a filled `danger-ink` "!"; Optional, round 6: `ink` on the green wash with a hollow `green-ink` ring, from `--need-optional-fill`, `--need-optional-line`, and `--need-optional-mark` in `app-components.css`: ink on the wash 15.9:1, the ring 4.9:1, a CanvasText ring in forced colours), the `need-add` button variant with its word, and `p.need-summary` ("2 required, 9 optional to add", or "Everything applications need is here"). Never on voluntary self-identification |
| List toolbar | `search.list-toolbar[data-list-toolbar]`: a search field (case and accent blind), filter chips with live counts in the one selected style, and a sort select, with the result in words, an empty state, and one polite announcement |
| Score trend (round 6, part 2) | `JobDeputyComponents.scoreTrend(host, { title, points, minimum, size, caption, labelledBy, empty })`: `figure.score-trend`, how a prompt's Test score moved across its versions. A point per version in order (`points: [{ id, label, short, score, result: 'passed' \| 'failed' \| 'testing', inUse, trial, date, note, href }]`) joined by a line, the `minimum` (the rollback rules' minimum, 80% by default) as a dashed line, and each point's shape and words saying how its test went: a filled `green-ink` circle for Passed, a hollow `danger-ink` diamond for Did not pass, a dashed circle for Testing now (a point with no score yet is Testing); an ink ring marks the version in use and a dashed ring the one on trial. The score sits upright over each point and the version under it, both thinned only where they do not fit (measured, counted back from the newest); a key names every shape shown, and Show the numbers has a row per version (Version, Test score, Result). `size`: `compact` (a `300px` column: Searches' rows and the drawer, and the Dashboard's Prompt tests until part 3) or `large` (the Prompts page until part 3). Forced colours: passed Highlight, failed and testing Canvas with a CanvasText edge, the line CanvasText, the minimum GrayText. Drawn still, so reduced and paused motion show the same chart. Until round 6, part 3 the scores over the points carried no `data-metric`. **Round 6, part 3:** two more sizes and a card's key and table. `size: 'row'` (the Dashboard's Prompt tests rows: about `48px` tall on an `18px` plot, `34px` a version and `76px` at least, only the latest score labelled) and `size: 'medium'` (the Prompts page's rows: a `56px` plot, about `100px` in all, `104px` a version and `240px` at least, capped by its column, every score labelled where it fits); both leave out their own key and table (`key` and `numbers` default off), and the card draws them once with `scoreTrend.key(host, { title, results, inUse, trial, minimum })` and `scoreTrend.numbers(host, { title, rows: [{ prompt, href, version, date, score, result, state }] })` (a row a test: Prompt, Version with its state under it, Date, Test score, Result), each drawn again only when it changes. A point takes `reason` (a failed point's tip gives the rule it broke, R9-9) and `metric` (its score's `data-metric`; the Dashboard's rows give it, the Prompts page's do not). A score under the minimum draws at least `5px` under the dashed line at every size (T6-R4). The Testing now mark is a dotted ring with a dot, apart from a trial's dashed ring |
| Chart table, Show the numbers (round 6, part 2) | Every chart's numbers (`details.bar-chart-data > section.data-table-wrap > table.data-table`: `stackedBars`, `usageChart`, `scoreTrend`, and the static bar chart) are a **compact table in any card width**: the wrap is a container of its own (`chart-table`), so the list tables' stacked-row rule (under `695px`) never reaches it. Cells are `8px 13px` (`8px` under a `420px` card, where the headings wrap between words), `13px` text with tabular figures, number columns at the end, and the row names (`tbody th`, sentence case, `ink`) held at the start while a wide table scrolls sideways inside its labelled region. Links take the shared link look (`ink`, a `green-line` underline, a `44px` target); the summary underlines on hover, keeps the pointer, and has its focus ring. **Round 6, part 3:** in a narrow card (the `chart-table` container at `419px` or less) the Total column is no longer pinned, so it scrolls into view at the end like any column (T5-6), and the pinned row names wrap between their words (`min-width: 6em`, at most `45cqi`), so every column can be read whole at some scroll position (T5-R1); a hovered row is one shade, the sticky row name and total taking the hover shade over the wrap's paper (T1-18); a card's table spans its card (R9-11) |
| Multi-select filter (round 6) | `JobDeputyComponents.multiSelect(host, { name, label, anyLabel, singular, plural, searchLabel, options: [{ value, label, count, tone }], selected, countLabel, maxChips, selectedWord, onChange })`, the WAI-ARIA disclosure for every filter over dynamic values: `div.multi-select` > a `44px` pill `button.multi-select-trigger` ("Company: Any", or how many: "Company: 3 selected"; a `2px` green edge while something is chosen) + a non-modal `div.multi-select-popover[role="group"]` (a labelled search box, the result line, a checkbox list with each option's count and optional swatch, selected first, then by count, then by name, sorted as it opens and still while open; a scroll region past about eight rows; Clear and Done) + `ul.multi-select-chips` (at most `maxChips`, default 3, removable chips that shrink with an ellipsis to their column, then "+N more"; `maxChips: 0` names the first two on the button instead). Escape, Done, a click outside, or Tab past the end closes it and returns focus to the button; each change fires one bubbling `change` event (`{ name, values }`) and is said once ("3 companies selected."). Returns `values`, `isOpen`, `set()`, `setOptions()`, `open()`, `close()`, and `destroy()`. Round 6, part 3: the search box empties when the popover closes (Escape, Done, a click outside, `close()`) and with Clear, and the whole list is drawn again, so no typed words stay behind unseen (T2-9); "+N more" carries only its visible words and one `aria-label` ("+1 more: show all 4 selected", T2-13) |
| See all (round 6) | `button.chart-action.see-all-open` ("See all 124 sources", the link form's look) and `JobDeputyComponents.seeAll.open({ title, eyebrow, noun, countLabel, searchLabel, sorts, items, key, note }, opener)`: one reused `dialog.drawer.see-all-drawer` with the search box first (it takes focus), the sort beside it, the result line ("Showing 7 of 124 sources", said once, politely, after typing stops), and `ol.see-all-list` of every item with its count, link, and optional swatch. `count: null` draws no count column (`meta` is the row's second line); `sorts: []` keeps the given order. Counts carry no `data-metric` (the page's own figure keeps it). Items come from `JobDeputyStore.seeAll(kind)` (`sources`, `keywords`, `companies`, `models`) or the page's list; focus returns to the opener. Round 6, part 3 (T1-17): with only one sort the sort control is hidden (`.see-all-sort[hidden]` wins over its grid display), so no select offers a single option |
| Paper | `div.paper-stack[data-template][data-page-limit]`: true-scale US letter pages (`816` by `1056` page pixels, `aria-hidden` pictures with the text offered beside them) rendered from Markdown by `paper.render()` in the Classic, Modern, or Compact template, a page count ("1 of 1 page", or "Runs to 2 pages"), and print CSS that prints exactly the pages shown |
| Document preview | One shared modal (`JobDeputyComponents.preview.open()`): a Pages and Text tablist above one labelled scroll region (Text shows the document's own headings, lists, and paragraphs at a `68ch` measure), page thumbnails and Page n of m with Pages, and **Download** (round 5): a menu of PDF (made in the browser: PDF 1.4, Letter, standard Helvetica, headings, paragraphs, bullets, page breaks, named for the document) and Markdown, through `JobDeputyComponents.download(document, 'pdf' \| 'md')` and `downloadMenu(host, document, options)`. The page behind holds still while it is open; focus returns to the opener, in view |
| Pagination (rounds 4 and 5) | `nav[aria-label="Pages"]` after the list: Previous, numbered pages (`aria-current="page"`, gaps beyond seven pages), and Next, each `44px`, unavailable ends kept in place, and "Page n of m" as text, never a repeat of a count. Eight items a page to `720px`, ten to `1279px`, twelve from `1280px`; a change is announced once. Shared as `JobDeputyComponents.pagination(host, { total, pageSize, page, onChange, label, href, channel })` (Searches, and Résumés' drafts in round 6); Job matches keeps its own copy of the same look. Round 7 (R10-6): every paged list uses the shared one (Job matches too), 12 a page by default at every width, with the opt-ins `noun`, `top`, `sizes`, `list`, `heading`, and `address` (see [Shared patterns (round 7)](#shared-patterns-round-7)); it morphs in place |
| Usage chart (round 5) | `JobDeputyComponents.usageChart(host, { series, groups, title, measure, unit, period, empty })` from `aiUsageSeries()` or `aiUsageMonths()`: a title, a key with each group's total, an `aria-hidden` stacked plot in the data colours (`palette.series`), a tip per segment, and Show the numbers as a table of the same values; drawn still, so reduced and paused motion show the same chart. Round 6 adds the daily chart by model from `aiMonthUsage()`: `cap` (top 5 plus a hatched Other), `columns` (the whole month, days still to come left empty), `marks` (a charcoal diamond over a day that fell back to platform credits, a key item, and a Note column), `totalLabel` and `totalMetric` (the month's total), `caption: false` or `labelledBy`, and groups that link (`href`) or say where their figure is instead (`instead: 'in Deputy Assist'`, no number and no metric). Part 2: the table's first column is named from the data (`Month`, `Task` for undated rows, else `Day`; `rowLabel` sets it), the fallback mark's key reads "1 day" or "3 days", and names under undated bars wrap between words or thin, counted back from the last. Round 7 (D9, D10): `usageChart(host, { usage })` takes any range of `JobDeputyStore.usage()` and `{ ledger }` the runs ledger (see [Shared patterns (round 7)](#shared-patterns-round-7)) |
| Form scan (round 5) | `JobDeputyComponents.formScan(host, fields, { site, title, stepMs, channel, onStage })`: a schematic of an employer's form whose fields are found one by one, matched (From Profile, From your résumé, From your answers, or Missing), filled, then waiting for your review, the stage in words and announced once; the final state at once under reduced or paused motion |
| Secret field (round 5) | `JobDeputyComponents.secretField(host, { label, reveal, onReveal, channel })`: twelve dots whatever the length, Show (which reads Hide while the value shows; its name changes, so it carries no `aria-pressed`) and Copy, which copies without showing; every Show and Copy calls `reveal()`, so the page logs it in the vault log |
| Pause banner (round 5) | `JobDeputyComponents.agreementBanner(host)`, mounted by `app-shell.js` at the top of every signed-in page's `.page-shell`: while `agreements().paused`, the warning FeedbackPanel "Your deputy is paused until you sign the updated agreement" with Review and sign (`agreement-preview.html?mode=update&return=<this page>`) |
| Tour | `[data-tour-step="n"]` with `data-tour-title` and `data-tour-text` on visible targets (named tours on a `[data-tour]` wrapper): a dimmed page with the target ringed below the fixed chrome, and a labelled modal card with the title, the text, "Step 2 of 6", Back, Next, Done, and Skip the tour (a bottom sheet on phones, the panda at its start). Started by `[data-tour-open]` (the account menu, the deputy's panel, a page's Take the tour), `?tour=1`, or after setup; never on a plain load. The deputy gives the tour: the card hosts the tour panda through `JobDeputyDeputy.guide()` (see [Deputy companion](#deputy-companion-signed-in-pages)), its pointer aimed at the target, while the dock's panda steps out; `markTourSeen` records it. Round 6: the card starts with `span.tour-card-guide` (`aria-hidden`, the guide's slot) and carries `data-guide` and `data-point`; the title is the deputy's speech line in a bubble whose tail points at him. The direction comes from where the target's visible part sits against the card (in its column, up or down; in its row, left or right; off to a corner, the wider gap; a target off to the left that is not level with the card is up or down), recomputed when a step comes to rest and on scroll or resize; `data-tour-point` on a step forces it. A `deputy.js` without `guide` keeps the round 5 card and the dock's guide pose |
| Background notice (round 6) | `JobDeputyComponents.notice({ id, text, detail, kind: 'done' \| 'needs-you' \| 'stopped', href, action, toast, record })`: records the notice in the deputy's Activity through `JobDeputyStore.addNotice` (once per id; a finished prompt test uses `prompt-test-<prompt>-<version>`) and, with `toast`, shows one `div.bg-toast[data-kind]`: a `3px` leading rule and a mark (a `green-ink` check for done, a `danger-ink` "!" on `orange-soft` for needs you and stopped), the words, one action, and a `44px` Dismiss. One at a time. It takes the first corner of the content (bottom right, top right under the chrome, bottom left, top left) where it covers no control, or folds into a `44px` pill ("Your deputy needs you", "Done in the background", "A job stopped") that opens the whole notice; it moves on scroll, resize, and focus moves, never takes focus by itself, stays while pointed at or focused, and leaves after `21s` otherwise; Escape dismisses it. Said once through the shared status channel; it rises `13px` once, never under reduced or paused motion. Round 6, part 2 (UAT M-19): at `720px` and narrower, while the deputy chip is in the app bar, `notice()` hands the notice to `JobDeputyDeputy.notice()` instead (the chip reads "Needs you" with the attention dot) and builds no toast |

### App shell

Signed-in pages share one frame, so the person always knows where they are and the deputy is
always beside them.

```text
header.app-header                (locked header: identity, optional Back, account menu)
div.app-frame
  div.app-sidebar                AppNav (eight sections) and the DeputyDock at the bottom
  main.app-main > .page-shell    editorial intro, then bounded task surfaces
footer.site-footer               starts after the sidebar column
```

The chrome never scrolls away. From `721px` up the sidebar and the `89px` rail are
`position: fixed` under the `72px` header for the whole page, footer included, with the frame's
first column as the spacer. At `720px` and narrower the `64px` header and a `55px` app bar (the
Menu button and the deputy chip; `position: sticky; top: 64px`, `data-sticky-top`) stay at the top
as one `119px` unit, and the open Menu is an opaque overlay under the bar that scrolls inside itself
behind a scrim, closes on Escape, an outside tap, focus leaving, or a choice, and never moves the
page. `html` keeps `scroll-padding-top` at `144px` on phones and `89px` wider, so anchors and
focused fields are never hidden; page scripts read that value instead of hard-coding an offset.

The sidebar lists Dashboard, Searches, Job matches, Applications, Résumés, Profile, Settings, and
Help (round 6: Settings, with a gear icon, replaces AI & credits), each with a `20px` line icon
(`24` viewBox, `1.75` stroke, `currentColor`). The AppNav block sits between `AppNav: start` and
`end` markers and is byte-identical on every internal page apart from `aria-current`. Child routes
mark their parent section `aria-current="true"` (Materials marks Résumés; the autofill preview
marks Applications). Settings opens Account, which marks it `aria-current="page"`; Connections,
Prompts, AI & credits, Usage, Purchases, and Activity mark it `aria-current="true"`, and their
Menu button reads `Menu · Settings`. Under the page intro the seven Settings pages share the
Settings tabs strip,
which says which tab is open. Invite friends has no nav item, so the rail still fits a
`768px`-tall viewport: the header, the account menu, and the footer link to it, and its header
link is the current place. Onboarding uses the entry header with no sidebar, account menu, or
footer.

## Responsive behavior

- Desktop MAY use the golden-ratio split with storytelling beside the task.
- Tablet SHOULD preserve the two-column layout only while the form remains at least `390px` wide.
- Mobile MUST stack story before form and keep all controls at least `44px` high.
- Signed-in pages show the full sidebar at `1101px` and wider, the `89px` rail from `721px` to
  `1100px`, and the app bar with the Menu disclosure and the deputy chip at `720px` and narrower;
  all three stay in view while the page scrolls (see [App shell](#app-shell)).
  Wide content (the board, wide tables) scrolls only inside its own labelled region.
- Decorative scene cards MAY scale down or disappear on narrow screens, but the panda speech and
  product promise MUST remain understandable.
- Text MUST wrap naturally; agents MUST NOT reduce body text below `15px` to force a layout to fit.

## Source references

- `docs/ui-foundation.md`: locked composition and continuity contract for every product page.
- `brand/jobdeputy-animated.svg`: canonical animated logo and opening-loader asset.
- `brand/jobdeputy-mark.svg`: canonical compact panda-on-JD mark for persistent product chrome.
- `brand/app-chrome.css` and `brand/app-shell.js`: the shared shell, sidebar, rail, and app bar.
- `brand/app-components.css`, `brand/app-components.js`, and `brand/components-preview.html`: the
  shared components and their gallery.
- `brand/deputy.css`, `brand/deputy.js`, and `brand/deputy-preview.html`: the deputy companion and
  its cast sheet.
- `brand/sample-store.js`: the shared sample data for the signed-in prototype pages.
- `brand/login-preview.html`: reference implementation for tokens, typography, loader, panda states,
  form styling, and responsive behavior.
- `brand/preview.html`: reference for the standalone identity and golden-ratio presentation.
- `brand/README.md`: short usage notes.

The brand files are prototypes until `apps/web` is implemented. Production components SHOULD
extract the same tokens and behavior into reusable CSS and React components rather than copying an
entire prototype file.
