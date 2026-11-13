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
 * Deployed wiring of T06d: each action on the user's data (T05 profile, search, roles,
 * résumés) leaves one audit entry, written in the same transaction as the change.
 * Which entry each action writes, and that failed actions write none, is unit-tested.
 */
let api: string;
let user: TestUser;

beforeAll(async () => {
  const outputs = await stackOutputs();
  api = outputs.ApiUrl ?? '';
  await waitForMalwareScanning(outputs);
  user = await createTestUser(outputs);
}, 360_000);

afterAll(async () => {
  await user?.delete();
});

describe('audit history (deployed)', () => {
  it('records every change to the profile, search, roles, and résumés, and nothing for a failed one', async () => {
    const token = user.accessToken;
    const ok = (res: { status: number; body: unknown }, status: number) =>
      expect(res.status, JSON.stringify(res.body)).toBe(status);

    ok(
      await callApi(api, 'PUT', 'me/profile', token, {
        version: 0,
        firstName: 'Audit',
        lastName: 'Me',
      }),
      200,
    );
    // A stale save fails and must leave no entry.
    ok(
      await callApi(api, 'PUT', 'me/profile', token, {
        version: 0,
        firstName: 'Stale',
        lastName: 'Me',
      }),
      409,
    );
    ok(
      await callApi(api, 'PUT', 'me/preferences/search', token, {
        version: 0,
        locations: [],
        workplace: ['remote'],
        employmentTypes: [],
        seniority: [],
        excludeKeywords: [],
      }),
      200,
    );
    const role = await callApi(api, 'POST', 'me/roles', token, { title: 'Backend Engineer' });
    ok(role, 201);
    ok(
      await callApi(api, 'PUT', `me/roles/${role.body.roleId}`, token, {
        version: 1,
        title: 'Staff Engineer',
      }),
      200,
    );
    ok(await callApi(api, 'DELETE', `me/roles/${role.body.roleId}`, token), 204);

    const { documentId } = await uploadDocument(
      api,
      user,
      'cv.pdf',
      'application/pdf',
      makePdf([['Audit me']]),
    );
    await waitFor(
      async () => {
        const doc = await callApi(api, 'GET', `me/documents/${documentId}`, token);
        return doc.body.status === 'ready' ? true : undefined;
      },
      { timeoutMs: 300_000, intervalMs: 3_000 },
    );
    ok(
      await callApi(api, 'PUT', `me/documents/${documentId}`, token, {
        version: 1,
        title: 'Main CV',
      }),
      200,
    );
    ok(await callApi(api, 'DELETE', `me/documents/${documentId}`, token), 204);

    const audit = await callApi(api, 'GET', 'me/audit?limit=50', token);
    const entries = [...audit.body.entries].reverse(); // oldest first
    expect(entries.map((e: { name: string }) => e.name)).toEqual([
      'profile.saved',
      'search.saved',
      'role.created',
      'role.updated',
      'role.deleted',
      'document.upload_started',
      'document.ready',
      'document.renamed',
      'document.deleted',
    ]);
    const byName = Object.fromEntries(entries.map((e: { name: string }) => [e.name, e]));
    expect(byName['role.created']).toMatchObject({
      actor: 'user',
      entity: { type: 'role', id: role.body.roleId },
      summary: 'Target role added: Backend Engineer',
    });
    expect(byName['document.ready']).toMatchObject({
      actor: 'system',
      entity: { type: 'document', id: documentId },
    });
    // No file names or personal details in the history.
    expect(JSON.stringify(entries)).not.toMatch(/cv\.pdf|Audit|Main CV/);
  });
});
