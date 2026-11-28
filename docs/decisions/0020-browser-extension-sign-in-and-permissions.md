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
4. **API access: CORS from the extension's origin instead of a host permission** (no install warning for our API). Not possible: API Gateway HTTP APIs refuse a `chrome-extension://` CORS origin ("Invalid format for origin", PR B1). Managed login's token endpoint does answer the extension's origin, so it needs no host permission.
5. **Build: WXT (chosen)** (Vite-based, MV3, builds for Firefox and Safari too, for #55) or plain Vite with a hand-written manifest (fewer dependencies, more glue).

## Decision

- Sign-in as option 1. **Both tokens live only in `chrome.storage.session`**, which by default only the extension's own pages and its service worker can read; never `storage.local`, which content scripts running inside employers' pages could read. Content scripts never see a token: they ask the service worker for the answers they fill. Closing the browser ends the session; signing in again is usually one click, as managed login remembers the person. Sign-out clears both.
- **Least privilege:** the manifest (`apps/extension/src/manifest.ts`) asks only for what a shipped feature uses: `storage` and `identity` with sign-in, the API's origin, then `https://job-boards.greenhouse.io/*` and the documents' download origin (the stack's `DocumentsOrigin`, set when it's built: the presigned links answer only the web app's origin) with the Greenhouse filler (#54 PR C2 and C3; the Greenhouse host is its content script's match, so every build asks for it). Greenhouse's older `boards.greenhouse.io` job and embed links now redirect to `job-boards.greenhouse.io` (checked 2026-11-27), and forms embedded on company sites load from it in a frame, so that one host covers them. Boards on Greenhouse's EU host (`job-boards.eu.greenhouse.io`) are out of scope for the US launch: an optional host if they are needed. Never `<all_urls>`, `tabs`, `history`, `cookies` or `webRequest`. Each later job site (Lever, then Ashby, then Workday) is an optional host permission, asked for when first needed. Optional permissions are held to the same rules. A static content script may match only hosts granted at install; scripts for optional hosts are registered at runtime once granted. A content script may also run in frames (`all_frames`, PR C3), only on the hosts it matches: a company site embeds Greenhouse's form in a frame. Its panel's styles are built into its script, so the extension exposes no file to pages (no `web_accessible_resources`). The worker takes the posting from Chrome's address for the sender, never from the message: the tab's in the top frame (the forms' host permission lets it read that; it follows the board's in-page navigation), the frame's own in an embed. A unit test holds the lists; CI checks the built manifest against them.
- It reads only through the API with the user's own token. It never submits and never guesses (0019); it records an application only after the user confirms on the employer's confirmation page.
- Built with WXT, styled with the web app's tokens and Tailwind; its words live in `apps/extension/src/copy.ts` (the web app's stay in `apps/web/src/copy/en.ts`), and both fill templates with the shared `fill`. A Chrome Web Store listing (unlisted first) needs a privacy policy page, added in #54 before the listing.

## Why

The standard OAuth flow keeps the web app's tokens in the web app and gives the extension its own revocable client. Asking only for the boards it fills keeps its reach, and its store review, small.

## Consequences

- PR B adds the Cognito domain, `ExtensionClient`, and managed-login branding; the extension ID must be fixed before its callback URL is registered. Done in PR B: one managed login domain per stack (`jobdeputy-` and the first part of the stack's ID: a stack name may hold a word Cognito refuses, such as `aws`, and prefixes are global), the client allows only the code flow back to `https://<id>.chromiumapp.org/` and refresh, and the dev ID comes from a public key committed in `packages/shared/src/extension.ts` (no private key is kept). As that key is public, anyone can load an unpacked extension with the dev ID, so **only dev stacks trust it**; prod trusts only the store item's ID (which no one else can take), and has no extension sign-in until that item exists. Sign-out clears the tokens; the signed-out popup then offers *Continue as* the last person or *Use a different account*, which goes through managed login's `/logout` back to sign-in (no sign-out address registered). The API host the extension asks for is the stack's own, set when the extension is built.
- PR C: the extension's tokens reach only reads (`EXTENSION_API_ROUTES`, all `GET`; a test holds that), now also the voluntary answers, documents, tailorings and cover letters. The voluntary answers are decrypted by the profile API for the user's own client as for the web app (0019); the extension uses them while it fills and never stores them. Recording an application (PR D) adds `PUT /me/jobs/{jobId}/stage`, its one write.
- Every new job site is a manifest change, its test, and a store update.
- Firefox and Safari (#55) reuse the WXT build; their sign-in redirect differs and is decided there.
