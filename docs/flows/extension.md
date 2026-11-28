# Flow: the extension signs in and reads what it fills (#54)

The browser extension signs in through Cognito **managed login** with its own app client (authorization code + PKCE), and only its service worker holds the tokens. Decision: [0020](../decisions/0020-browser-extension-sign-in-and-permissions.md). After this: the Greenhouse filler (#54 PR C).

- **Task:** [#54](https://github.com/jobdeputy/jobdeputy/issues/54). Managed login, the client and its branding: PR B1. The extension's sign-in and reads: PR B2.
- **Keep it true:** a PR that changes this flow updates this file.

## Signing in

```mermaid
sequenceDiagram
  participant P as Popup
  participant W as Service worker
  participant L as Managed login<br/>(jobdeputy-<stack ID part>.auth…)
  participant S as storage.session
  P->>W: sign-in (a message; only the extension's own pages are answered)
  Note over P: Chrome closes the popup when the sign-in window takes focus:<br/>the worker carries on
  W->>L: launchWebAuthFlow /oauth2/authorize<br/>(code, PKCE S256, state, scope openid email)<br/>or /logout with the same parameters: "Use a different account"
  L-->>W: https://<extension ID>.chromiumapp.org/?code&state (only Chrome opens it, for this extension)
  W->>L: POST /oauth2/token (code + verifier; managed login answers the extension's origin)
  L-->>W: access (1 h), ID, refresh (30 days) tokens
  W->>S: session {accessToken, refreshToken, expiresAt, email}
  Note over S: only the extension's pages and worker can read it;<br/>gone when the browser closes
```

- A second Sign in while the window is open waits for the first. A popup opened while a sign-in is at work waits for it (`sign-in-wait`), never starting another.
- If Chrome stops the service worker while managed login waits (a long sign-up, say), the one-time PKCE values go with it: a mark in `storage.session` lets the next popup say the sign-in was interrupted.
- Known limit: "Continue as" is remembered only until the browser closes, while managed login remembers the person for its own session (about an hour). Signing in within that time after a restart goes straight to the last person; signing out then offers "Use a different account".
- **Sign out** forgets the tokens at once and revokes the refresh token (`/oauth2/revoke`, best effort). Managed login still remembers the person, so the popup then offers **Continue as {email}** (one click) or **Use a different account** (`/logout`, then the sign-in form).

## Reading what it fills

```mermaid
sequenceDiagram
  participant P as Popup
  participant W as Service worker
  participant L as Managed login
  participant A as API (JWT authorizer)
  P->>W: readiness
  W->>W: access token; refreshed when it has under a minute left<br/>(callers at once share one refresh)
  opt refresh
    W->>L: POST /oauth2/token (refresh_token)
    Note over W: invalid_grant: signed out (the person remembered for "Continue as")
  end
  W->>A: GET /me/profile, /me/documents, /me/applicant (Bearer, the API's host permission: no CORS)
  Note over A: extension tokens reach only EXTENSION_API_ROUTES;<br/>every other route asks for the web scope (403)
  A-->>W: 200, or 401: refresh once and try again; 401 again: signed out
  W-->>P: details, a ready résumé, answers saved (each: ready or not yet)
```

## Where it is stored

| What | Where | For how long |
|---|---|---|
| Access, ID, refresh tokens; email | `chrome.storage.session` (`session`) | until sign-out, a refused refresh, or the browser closes |
| The last person's email after sign-out | `chrome.storage.session` (`lastEmail`) | until the next sign-in or the browser closes |
| A sign-in at work | `chrome.storage.session` (`signInPending`) | until it ends, or the next popup after Chrome stopped the worker |
| The build's settings (API, managed login, client, site) | built in (`WXT_*`, `scripts/extension-config.mjs`) | the build |

Nothing new is stored on the server.

## Try it on your stack

1. Deploy your personal stack (it trusts the dev ID), then `node scripts/extension-config.mjs jobdeputy-dev-<you>-iad` (add `--site https://dev.jobdeputy.com` for the popup's links).
2. `pnpm --filter @jobdeputy/extension build`, then load `apps/extension/.output/chrome-mv3` unpacked in Chrome (`chrome://extensions`, Developer mode). The manifest's `key` gives it the dev ID, so managed login returns to it.
