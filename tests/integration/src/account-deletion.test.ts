import { makePdf } from '@jobdeputy/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  callApi,
  createTestUser,
  stackOutputs,
  type TestUser,
  uploadDocument,
  waitFor,
  waitForMalwareScanning,
} from './stack.js';

/**
 * Deployed wiring of T12 (crawls and the audit history since T06b, jobs since T07b): DELETE /me → DELETION item → stream → Pipe → queue → worker,
 * which erases every table and file and the login. Confirmation, re-authentication,
 * and paging rules are unit-tested. See docs/testing.md.
 */
let api: string;
let testSite: string;
let user: TestUser;

beforeAll(async () => {
  const outputs = await stackOutputs();
  api = outputs.ApiUrl ?? '';
  testSite = outputs.TestSiteUrl ?? '';
  await waitForMalwareScanning(outputs);
  user = await createTestUser(outputs);
}, 360_000);

afterAll(async () => {
  await user?.delete();
});

describe('delete my account (deployed)', () => {
  it('erases the profile, roles, résumés, crawls, jobs, AI keys, and audit history, blocks further changes, and removes the login', async () => {
    const token = user.accessToken;
    await callApi(api, 'PUT', 'me/profile', token, {
      version: 0,
      firstName: 'Delete',
      lastName: 'Me',
    });
    await callApi(api, 'POST', 'me/roles', token, { title: 'Backend Engineer' });
    const { documentId } = await uploadDocument(
      api,
      user,
      'cv.pdf',
      'application/pdf',
      makePdf([['Delete me']]),
    );
    const crawl = await callApi(api, 'POST', 'me/crawls', token, {
      url: new URL('test-site/jobs-schema-org', testSite).href,
    });
    expect(crawl.status).toBe(202);
    await waitFor(
      async () => {
        const [doc, crawled] = await Promise.all([
          callApi(api, 'GET', `me/documents/${documentId}`, token),
          callApi(api, 'GET', `me/crawls/${crawl.body.crawlId}`, token),
        ]);
        return doc.body.status === 'ready' && crawled.body.status === 'succeeded'
          ? true
          : undefined;
      },
      { timeoutMs: 300_000, intervalMs: 3_000 },
    );

    // Something to erase in the jobs table.
    expect((await callApi(api, 'GET', 'me/jobs?view=all', token)).body.jobs).toHaveLength(2);
    // And in ai-keys (T08b2; the dev-only stub provider makes no outside call).
    const key = await callApi(api, 'PUT', 'me/ai-keys/stub', token, {
      apiKey: `stub-deletion-${'x'.repeat(10)}-valid`,
      modelId: 'stub-model',
      consent: true,
    });
    expect(key.status).toBe(202);

    const res = await callApi(api, 'DELETE', 'me', await user.signIn(), {
      confirm: 'delete my account',
    });
    expect(res.status).toBe(202);
    expect(res.body.message).toContain('permanent');

    // Blocked at once, even with a still-valid token.
    const blocked = await callApi(api, 'POST', 'me/roles', token, { title: 'Sneaky' });
    expect(blocked.status).toBe(410);

    // The worker finishes in the background: the login and all data are gone.
    await waitFor(
      async () => {
        const [profile, roles, docs, crawls, audit, jobs, aiKeys] = await Promise.all([
          callApi(api, 'GET', 'me/profile', token),
          callApi(api, 'GET', 'me/roles', token),
          callApi(api, 'GET', 'me/documents', token),
          callApi(api, 'GET', 'me/crawls', token),
          callApi(api, 'GET', 'me/audit', token),
          // Hidden jobs too (T08c): every job must be gone.
          callApi(api, 'GET', 'me/jobs?view=all', token),
          callApi(api, 'GET', 'me/ai-keys', token),
        ]);
        const erased =
          profile.body.version === 0 &&
          roles.body.roles?.length === 0 &&
          docs.body.documents?.length === 0 &&
          crawls.body.crawls?.length === 0 &&
          audit.body.entries?.length === 0 &&
          jobs.body.jobs?.length === 0 &&
          aiKeys.body.keys?.length === 0;
        return erased ? true : undefined;
      },
      { timeoutMs: 120_000, intervalMs: 3_000 },
    );
    expect((await callApi(api, 'GET', 'me', token)).status).toBe(410);
    await expect(user.signIn()).rejects.toThrow();
  });
});
