import { LOCAL_WEB_ORIGIN, WEB_SCOPES, WEB_SIGN_IN_CALLBACK_PATH } from '@jobdeputy/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { signInUrlPattern, stackOutputs } from './stack.js';

/**
 * The web app's managed login wiring (#111, decision 0021), as deployed on a dev stack: its client
 * starts a code + PKCE sign-in on the stack's managed login address, only back to the web app's
 * own callback (the site's where the stack has one, and Vite's dev server on dev stacks). The
 * shared dev cell serves it at auth.<site>: checked by Deploy dev, which runs this suite there.
 * The full sign-in (a browser on the page) is checked by hand.
 */
const outputs = await stackOutputs();
let domain: string;

/** Where `/oauth2/authorize` sends the browser for the web client, without following it. */
async function authorize(params: Record<string, string>): Promise<URL> {
  const query = new URLSearchParams({
    client_id: outputs.WebClientId ?? '',
    scope: WEB_SCOPES.join(' '),
    ...params,
  });
  const res = await fetch(`${domain}/oauth2/authorize?${query}`, { redirect: 'manual' });
  expect(res.status).toBe(302);
  return new URL(res.headers.get('location') ?? '', domain);
}

const pkce = {
  response_type: 'code',
  code_challenge: 'y'.repeat(43),
  code_challenge_method: 'S256',
};

/** The web app's return addresses on this stack. */
const callbacks = [...(outputs.SiteOrigin ? [outputs.SiteOrigin] : []), LOCAL_WEB_ORIGIN].map(
  (origin) => origin + WEB_SIGN_IN_CALLBACK_PATH,
);

describe.skipIf(!outputs.AuthDomain)('web sign-in through managed login (deployed, #111)', () => {
  beforeAll(() => {
    domain = outputs.AuthDomain ?? '';
    expect(domain).toMatch(signInUrlPattern(outputs));
  });

  it("serves managed login's page on the stack's sign-in address", async () => {
    const next = await authorize({ ...pkce, redirect_uri: callbacks[0] ?? '' });
    expect(next.origin).toBe(domain);
    expect(next.pathname).toBe('/login');
    const page = await fetch(next, { redirect: 'manual' });
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
  });

  it("starts a code sign-in back to each of the web app's callbacks", async () => {
    for (const redirect of callbacks) {
      const next = await authorize({ ...pkce, redirect_uri: redirect });
      expect(next.pathname).toBe('/login');
      expect(next.searchParams.get('redirect_uri')).toBe(redirect);
    }
  });

  it('refuses any other return address, and tokens straight in the URL', async () => {
    const elsewhere = await authorize({
      ...pkce,
      redirect_uri: 'https://example.com/auth/callback',
    });
    expect(elsewhere.searchParams.get('error')).toBe('redirect_mismatch');

    const implicit = await authorize({ response_type: 'token', redirect_uri: callbacks[0] ?? '' });
    const error =
      implicit.searchParams.get('error') ??
      new URLSearchParams(implicit.hash.slice(1)).get('error');
    expect(['invalid_request', 'unauthorized_client', 'unsupported_response_type']).toContain(
      error,
    );
  });

  it('signs out back to the web app only', async () => {
    const query = new URLSearchParams({
      client_id: outputs.WebClientId ?? '',
      logout_uri: `${LOCAL_WEB_ORIGIN}/`,
    });
    const res = await fetch(`${domain}/logout?${query}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${LOCAL_WEB_ORIGIN}/`);
  });
});
