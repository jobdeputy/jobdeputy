import {
  EXTENSION_DEV_IDS,
  extensionOrigin,
  extensionRedirectUrl,
} from '@jobdeputy/shared/extension';
import { beforeAll, describe, expect, it } from 'vitest';
import { PREFIX_SIGN_IN_URL, region, signInUrlPattern, stackOutputs } from './stack.js';

/**
 * The extension's sign-in wiring (#54, decision 0020), as deployed on a dev stack (which trusts
 * the dev ID): managed login on this stack's
 * domain lets the extension client start a code + PKCE sign-in only back to the extension. The
 * full sign-in (a browser on the managed login page) is checked by hand on a personal stack.
 */
let domain: string;
let clientId: string;
let poolId: string;
// Only stacks that trust an extension ID (dev today) have its client and these outputs.
const outputs = await stackOutputs();

/** Where `/oauth2/authorize` sends the browser, without following it. */
async function authorize(params: Record<string, string>): Promise<URL> {
  const query = new URLSearchParams({ client_id: clientId, scope: 'openid email', ...params });
  const res = await fetch(`${domain}/oauth2/authorize?${query}`, { redirect: 'manual' });
  expect(res.status).toBe(302);
  return new URL(res.headers.get('location') ?? '', domain);
}

const pkce = {
  response_type: 'code',
  code_challenge: 'x'.repeat(43),
  code_challenge_method: 'S256',
};

describe.skipIf(!outputs.ExtensionClientId)('extension sign-in (deployed, #54)', () => {
  beforeAll(async () => {
    domain = outputs.AuthDomain ?? '';
    clientId = outputs.ExtensionClientId ?? '';
    poolId = outputs.UserPoolId ?? '';
    // The site's cell serves it at auth.<site> (#111); other stacks on their prefix domain.
    expect(domain).toMatch(signInUrlPattern(outputs));
    expect(clientId).not.toBe('');
  });

  it("serves managed login on this stack's own domain", async () => {
    const res = await fetch(
      `https://cognito-idp.${region}.amazonaws.com/${poolId}/.well-known/openid-configuration`,
    );
    const config = (await res.json()) as { authorization_endpoint: string };
    // With a custom domain too (#111), discovery may name either of the pool's two.
    const endpoint = new URL(config.authorization_endpoint);
    expect(endpoint.pathname).toBe('/oauth2/authorize');
    if (endpoint.origin !== domain) expect(endpoint.origin).toMatch(PREFIX_SIGN_IN_URL);
  });

  it('starts a code sign-in that returns to the extension', async () => {
    for (const id of EXTENSION_DEV_IDS) {
      const next = await authorize({ ...pkce, redirect_uri: extensionRedirectUrl(id) });
      expect(next.pathname).toBe('/login');
    }
  });

  it('"Use a different account" (/logout) reaches sign-in with the PKCE challenge kept', async () => {
    const query = new URLSearchParams({
      client_id: clientId,
      scope: 'openid email',
      ...pkce,
      state: 'different-account',
      redirect_uri: extensionRedirectUrl(EXTENSION_DEV_IDS[0] ?? ''),
    });
    const res = await fetch(`${domain}/logout?${query}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const next = new URL(res.headers.get('location') ?? '', domain);
    expect(next.pathname).toBe('/login');
    expect(next.searchParams.get('code_challenge')).toBe(pkce.code_challenge);
    expect(next.searchParams.get('code_challenge_method')).toBe('S256');
    expect(next.searchParams.get('state')).toBe('different-account');
  });

  it('refuses any other return address, and tokens straight in the URL', async () => {
    const elsewhere = await authorize({ ...pkce, redirect_uri: 'https://example.com/' });
    expect(elsewhere.searchParams.get('error')).toBe('redirect_mismatch');

    const redirect = extensionRedirectUrl(EXTENSION_DEV_IDS[0] ?? '');
    const implicit = await authorize({ response_type: 'token', redirect_uri: redirect });
    // Cognito says so on the return address (in the fragment today); either part is accepted.
    const error =
      implicit.searchParams.get('error') ??
      new URLSearchParams(implicit.hash.slice(1)).get('error');
    expect(['invalid_request', 'unauthorized_client', 'unsupported_response_type']).toContain(
      error,
    );
  });

  it("lets the extension's own pages exchange a code for tokens (CORS)", async () => {
    const origin = extensionOrigin(EXTENSION_DEV_IDS[0] ?? '');
    const res = await fetch(`${domain}/oauth2/token`, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
  });
});
