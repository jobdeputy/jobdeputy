# 0021: The web app and the extension sign in on one managed login page, at `auth.<site>`

- **Status:** Accepted
- **Date:** 2026-11-28
- **Task:** #111

## Context

The web app signs in with its own form (Amplify, secure remote password, in the drawer). The extension signs in through Cognito managed login with its own client ([0020](0020-browser-extension-sign-in-and-permissions.md)). People sign in twice, with two passwords typed in two places. Managed login is served on the pool's Cognito prefix domain (`jobdeputy-<stack ID part>.auth.us-east-1.amazoncognito.com`), an address people don't know as ours.

## Options considered

1. **Both on managed login (chosen).** The web app moves to managed login too (code + PKCE through Amplify's `signInWithRedirect`). Managed login keeps a session cookie on its own address, so whoever signed in on one client is signed in for the other in one click, or silently for the extension (`launchWebAuthFlow` with `interactive: false`). Each client still gets its own tokens. Cost: the page uses AWS's layout, so it can't match the drawer exactly.
2. **The web app hands its tokens to the extension** (`externally_connectable`). No new page, but the extension would hold full-power tokens: every API route, plus Cognito user admin such as `DeleteUser`. A leak from the extension becomes a leak of everything.
3. **Keep two sign-ins.** No work, but two passwords to type and two forms to keep in step.

For the address: the prefix domain (free, no setup), or a **custom domain in the site's zone** (chosen): an ACM certificate, alias records (IPv4 and IPv6) and the pool's custom domain.

## Decision

- Both clients sign in through managed login (option 1). **Tokens never pass between them:** the extension's client may ask only for `openid email` (0020: its tokens reach only `EXTENSION_API_ROUTES`); the web client asks for `openid email aws.cognito.signin.user.admin` (`WEB_SCOPES`), the scope every other route needs. Each signs out on its own.
- **The web client** (`infra/lib/constructs/auth.ts`) gains authorization code only (Amplify sends PKCE), callback `<site>/auth/callback` and sign-out back to `<site>/`. Dev stacks also allow `http://localhost:5173` (Vite's dev server); prod never does. Prod's web client gets these once prod has a site (`infra/config/web.ts`). Since the web app moved (#111 PR B) it has no direct sign-in of its own: only managed login's code, then refresh (sessions made before keep refreshing).
- **The address:** the site's cell serves managed login at **`auth.<site>`** (`auth.dev.jobdeputy.com` today) as well as on its prefix domain, which stays for personal and PR stacks and for extension builds made before. The site's zone stack is made before the cells so the cell can check the certificate and add the record there. The cell's `AuthDomain` output (the extension's build) and the site's `config.json` (`authDomain`) name it; the site's CSP lets it call it (token and revoke).
- **Look:** both clients use the same managed login branding (`login-branding.ts`): the web app's colours and mark, light only.

## Why

One page and one session give one sign-in without widening what the extension can do. Our own address on that page is what people should see before typing a password.

## Consequences

- Cognito serves a custom domain through CloudFront, so its certificate must be in us-east-1 (the site's cell is), and the parent name must already resolve: the site's own alias record (the web stack). So the custom domain is opt-in per site (`signInDomain` in `infra/config/web.ts`, on for dev), and a stage's first deploy (or a rebuild) leaves it out with `cdk deploy --all -c signInDomain=off`; the next deploy, once the web stack has made the site's record, adds it. The cell reads the zone's ID from SSM, not a stack export, so the domain can also be turned off later. Prod gets `auth.<prod site>` when its address is chosen at launch.
- A custom domain takes several minutes to create, and changing it replaces the pool's domain and record.
- Managed login's session lasts about an hour; after that, either client asks for the password again.
- Sign-up, email confirmation and forgotten passwords move to managed login with PR B, so their words are AWS's, not ours.
