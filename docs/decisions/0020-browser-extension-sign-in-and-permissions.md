# 0020: The browser extension signs in through Cognito managed login and asks only for the job sites it fills

- **Status:** Accepted
- **Date:** 2026-11-27
- **Task:** #54

## Context

The extension ([0014](0014-browser-extension-in-monorepo.md)) fills application forms with the user's profile, application answers ([0019](0019-application-answers-and-voluntary-self-id.md)), tailored résumé and cover letter, and the user submits ([0013](0013-apply-flow-rules.md)). It needs the user's API token, and it must run on employers' application pages. An extension that can read every page is a large target and a hard store review.

## Options considered

1. **Sign-in: its own Cognito managed login (chosen).** A new public `ExtensionClient` (authorization code + PKCE) and a Cognito domain; `chrome.identity.launchWebAuthFlow` opens the login page and returns to `https://<extension-id>.chromiumapp.org/`. Its own client: revocable and limited apart from the web app; works without the web app open. Costs one-time setup (domain, branding, a fixed extension ID). The pool is on Essentials, which includes managed login.
2. **Sign-in: tokens handed over by the web app** (`externally_connectable`). No Cognito change, but the web app's refresh token leaves its origin and the extension can't be revoked on its own.
3. **Sign-in: an email and password form in the extension.** A second password form to secure and keep in step.
4. **Build: WXT (chosen)** (Vite-based, MV3, builds for Firefox and Safari too, for #55) or plain Vite with a hand-written manifest (fewer dependencies, more glue).

## Decision

- Sign-in as option 1. **Both tokens live only in `chrome.storage.session`**, which by default only the extension's own pages and its service worker can read; never `storage.local`, which content scripts running inside employers' pages could read. Content scripts never see a token: they ask the service worker for the answers they fill. Closing the browser ends the session; signing in again is usually one click, as managed login remembers the person. Sign-out clears both.
- **Least privilege:** the manifest (`apps/extension/src/manifest.ts`) asks only for what a shipped feature uses: `storage` and `identity` with sign-in, the API's origin, then `https://boards.greenhouse.io/*` and `https://job-boards.greenhouse.io/*` with the Greenhouse filler (Greenhouse forms embedded on company sites load from those hosts). Never `<all_urls>`, `tabs`, `history`, `cookies` or `webRequest`. Each later job site (Lever, then Ashby, then Workday) is an optional host permission, asked for when first needed. Optional permissions are held to the same rules. A static content script may match only hosts granted at install; scripts for optional hosts are registered at runtime once granted. A unit test holds the lists; CI checks the built manifest against them.
- It reads only through the API with the user's own token. It never submits and never guesses (0019); it records an application only after the user confirms on the employer's confirmation page.
- Built with WXT, styled with the web app's tokens and Tailwind; its words live in `apps/extension/src/copy.ts` (the web app's stay in `apps/web/src/copy/en.ts`), and both fill templates with the shared `fill`. A Chrome Web Store listing (unlisted first) needs a privacy policy page, added in #54 before the listing.

## Why

The standard OAuth flow keeps the web app's tokens in the web app and gives the extension its own revocable client. Asking only for the boards it fills keeps its reach, and its store review, small.

## Consequences

- PR B adds the Cognito domain, `ExtensionClient`, and managed-login branding; the extension ID must be fixed before its callback URL is registered.
- Every new job site is a manifest change, its test, and a store update.
- Firefox and Safari (#55) reuse the WXT build; their sign-in redirect differs and is decided there.
