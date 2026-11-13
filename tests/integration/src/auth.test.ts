import { randomBytes, randomUUID } from 'node:crypto';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callApi, createTestUser, region, stackOutputs, type TestUser } from './stack.js';

/**
 * Deployed auth wiring (T05): only what API Gateway and Cognito enforce.
 * Claim parsing and validation are covered by unit tests. See docs/testing.md.
 */
let api: string;
let webClientId: string;
let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  const outputs = await stackOutputs();
  api = outputs.ApiUrl ?? '';
  webClientId = outputs.WebClientId ?? '';
  expect(api).toMatch(/^https:\/\//);
  [alice, bob] = await Promise.all([createTestUser(outputs), createTestUser(outputs)]);
});

afterAll(async () => {
  await Promise.allSettled([alice?.delete(), bob?.delete()]);
});

describe('auth (deployed)', () => {
  it('rejects requests without a token', async () => {
    expect((await callApi(api, 'GET', 'me', undefined)).status).toBe(401);
  });

  it('rejects a forged token', async () => {
    const forged = `${alice.accessToken.split('.').slice(0, 2).join('.')}.invalidsignature`;
    expect((await callApi(api, 'GET', 'me', forged)).status).toBe(401);
  });

  it('returns the signed-in user and their home Region', async () => {
    const res = await callApi(api, 'GET', 'me', alice.accessToken);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: alice.email, homeCell: 'iad' });
    expect(res.body.userId).toMatch(/^[0-9a-f-]{36}$/);

    const other = await callApi(api, 'GET', 'me', bob.accessToken);
    expect(other.body.userId).not.toBe(res.body.userId);
  });

  it("does not let one user read another user's data", async () => {
    const created = await callApi(api, 'POST', 'ping-jobs', alice.accessToken, {});
    expect(created.status).toBe(202);
    const asBob = await callApi(api, 'GET', `ping-jobs/${created.body.id}`, bob.accessToken);
    expect(asBob.status).toBe(404);
    const asAlice = await callApi(api, 'GET', `ping-jobs/${created.body.id}`, alice.accessToken);
    expect(asAlice.status).toBe(200);
  });

  it('refuses a real sign-up with a reserved test domain (T13)', async () => {
    // A public sign-up, exactly as the web app would do it: no AWS credentials.
    const email = `it-${randomUUID()}@example.com`;
    const signUp = new CognitoIdentityProviderClient({ region }).send(
      new SignUpCommand({
        ClientId: webClientId,
        Username: email,
        Password: `${randomBytes(18).toString('base64url')}-Aa1`,
        UserAttributes: [{ Name: 'email', Value: email }],
      }),
    );
    await expect(signUp).rejects.toThrow('not allowed');
  });
});
