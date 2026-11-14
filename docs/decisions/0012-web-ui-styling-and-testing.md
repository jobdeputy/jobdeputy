# 0012: Web UI styling (Tailwind + shadcn/ui) and browser testing (Playwright)

- **Status:** Accepted
- **Date:** 2026-11-13
- **Task:** #14

## Context

The round 7 prototype's landing page is one hand-written HTML file of about 7,800 lines with 58 media queries. The real app must work on every device class without hand-tuned breakpoints per page, and it needs automated proof of that, on real browser engines.

## Options considered

1. **Tailwind CSS v4 + shadcn/ui (Radix):** utility classes with mobile-first breakpoints, and the theme is our own tokens. shadcn copies accessible components (dialog, drawer, select) into the repo, so we own and restyle them.
2. **MUI, Mantine, or Chakra:** complete component kits, but each brings its own look. Matching the approved prototype means overriding it everywhere.
3. **Bootstrap:** the same overriding problem, and a dated look.

For tests:

1. **Playwright:** runs real Chromium, Firefox, and WebKit (Safari's engine), has built-in phone and tablet profiles, waits for elements automatically, and runs tests in parallel for free.
2. **Cypress:** WebKit support is experimental, and parallel runs need its paid cloud.

## Decision

- **Styling:** Tailwind CSS v4 through `@tailwindcss/vite`, with components from shadcn/ui on Radix (`apps/web/components.json`). Pages use Tailwind classes. Hand-written CSS is limited to `src/styles/` (tokens, base styles, and later keyframes Tailwind cannot express).
- **Tokens:** the prototype's values sit in Tailwind's `@theme` (`src/styles/tokens.css`), and Tailwind's default palette is switched off, so only brand colours exist. shadcn's role names (`primary`, `muted`, `ring`, …) point at the brand tokens. Values are unchanged from round 7. Variable names gain Tailwind's namespace (`--ink` → `--color-ink`, `--shadow` → `--shadow-panel`); the prototype's `--muted` text colour is `muted-foreground`, because shadcn uses `muted` for a background.
- **Focus ring:** one ring for every control, 2px solid `green` with a 3px offset (the `ring` role). The prototype mixed this with a 3px `green-line` ring, which is about 1.5:1 against paper and fails WCAG's 3:1 for focus indicators.
- **Breakpoints:** Tailwind's defaults (`sm` 640, `md` 768, `lg` 1024, `xl` 1280), mobile first. The prototype's own breakpoints (540, 720, 880, 1050) are not copied.
- **Tests:** Vitest + Testing Library for component behaviour (`apps/web/test/`). Playwright for the built app in real browsers (`apps/web/e2e/`) on seven devices: desktop Chrome, Firefox, and Safari; iPad; iPhone; Pixel; and a 320px-wide phone. Shared checks: no sideways scroll, and no WCAG 2.2 A/AA violations that axe finds.
- **Translation-ready, not translated:** the launch is English and US-only. Every UI string lives in `src/copy/en.ts`, and components read it through `@/copy/index.ts` (`Copy` fixes the keys, not the words). Use logical spacing (`ps-`/`pe-`/`ms-`/`me-`, `start-`/`end-`) instead of left and right, `Intl` for dates and numbers, and whole sentences per entry. Adding a language later means adding a file with the same keys and an i18n library, with no component rewrites.

## Why

The prototype is a custom design, so a kit with its own look would fight it; Tailwind's theme *is* our tokens. shadcn gives keyboard and screen-reader behaviour we would otherwise build by hand. Playwright is the only option that tests Safari's engine properly, which matters because iPhone users only have WebKit.

## Consequences

- Off-brand colours cannot be used by accident; a new colour needs a token, and token changes need approval (CLAUDE.md).
- **Screenshot proof on every UI PR:** CI screenshots each screen in `e2e/screenshots.spec.ts` on all seven devices and posts them as one PR comment. The images live on the `ui-screenshots` branch, rewritten as a single commit that keeps only open PRs, so it stays small; the URLs carry the commit, so a browser never shows stale shots.
- Automatic screenshot *comparison* (failing on visual change) is not set up yet. Font rendering differs between macOS and Linux, so baselines must come from CI's Linux browsers; it arrives with the landing page (#14, part B).
- Every UI change gets a senior UI review against the prototype before handover (spacing, tokens, breakpoints, accessibility), and any inconsistencies are fixed in the same PR.
