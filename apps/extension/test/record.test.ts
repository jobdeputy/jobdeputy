import { EXTENSION_API_ROUTES } from '@jobdeputy/shared/extension';
import { atsJobKey, jobIdOf } from '@jobdeputy/shared/job-id';
import { describe, expect, it, vi } from 'vitest';
import { type Answer, type Api, type ApiResult, createApi } from '../src/api.ts';
import type { Auth } from '../src/auth/session.ts';
import { readApplication, recordApplication } from '../src/record.ts';

const POSTING = { companyKey: 'greenhouse:acme', postingId: '4001001' };

function fakeApi(result: ApiResult<Answer>) {
  const answer = vi.fn(async (_path: string, _body?: unknown) => result);
  return { api: { answer } as unknown as Api, answer };
}
const ok = (status: number, body: unknown = null): ApiResult<Answer> => ({
  ok: true,
  body: { status, body },
});

describe('the application on a confirmation page (#54 PR D)', () => {
  it("asks only for a job in the person's list at stage New, from the posting's own job", async () => {
    const jobId = await jobIdOf(atsJobKey('greenhouse:acme', '4001001'));
    const { api, answer } = fakeApi(
      ok(200, { jobId, title: 'Senior Engineer', companyName: 'Acme', status: 'new' }),
    );
    expect(await readApplication(api, POSTING)).toEqual({
      state: 'ask',
      title: 'Senior Engineer',
      companyName: 'Acme',
    });
    expect(answer).toHaveBeenCalledWith(`/me/jobs/${jobId}`);
    expect(
      await readApplication(fakeApi(ok(200, { title: 'X', status: 'new' })).api, POSTING),
    ).toEqual({ state: 'ask', title: 'X' });
  });

  it.each([
    ['past New', ok(200, { title: 'X', status: 'applied' }), 'moved-on'],
    ['not in the list', ok(404), 'not-listed'],
    ['an error', ok(500), 'failed'],
    ['no title', ok(200, { status: 'new' }), 'failed'],
    ['signed out', { ok: false, reason: 'signed-out' } as const, 'signed-out'],
    ['offline', { ok: false, reason: 'offline' } as const, 'offline'],
  ])('says nothing to ask when %s', async (_, result, state) => {
    expect((await readApplication(fakeApi(result).api, POSTING)).state).toBe(state);
  });

  it('records it with the one change the API takes from the extension', async () => {
    const jobId = await jobIdOf(atsJobKey('greenhouse:acme', '4001001'));
    const { api, answer } = fakeApi(ok(200, { status: 'applied' }));
    expect(await recordApplication(api, POSTING)).toEqual({ state: 'saved' });
    expect(answer).toHaveBeenCalledWith(`/me/jobs/${jobId}/stage`, {
      stage: 'applied',
      from: 'new',
    });
  });

  it.each([
    [
      'cooling down',
      ok(409, { code: 'cooling-down', until: '2026-12-20T10:00:00.000Z' }),
      { state: 'cooling-down', until: '2026-12-20T10:00:00.000Z' },
    ],
    ['cooling down, no date', ok(409, { code: 'cooling-down' }), { state: 'cooling-down' }],
    ['moved meanwhile', ok(409, { code: 'stage-changed' }), { state: 'moved-on' }],
    ['gone', ok(404), { state: 'not-listed' }],
    ['refused', ok(403, { code: 'extension-stage' }), { state: 'failed' }],
    ['busy', ok(409, { code: 'try-again' }), { state: 'failed' }],
    ['signed out', { ok: false, reason: 'signed-out' } as const, { state: 'signed-out' }],
  ])('says why when %s', async (_, result, expected) => {
    expect(await recordApplication(fakeApi(result).api, POSTING)).toEqual(expected);
  });
});

it('calls only routes the API lets extension tokens reach (EXTENSION_API_ROUTES)', async () => {
  const called: string[] = [];
  const auth = { accessToken: async () => 't', signedOutByApi: async () => {} } as unknown as Auth;
  const fetch = async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace(/^\/me\/jobs\/[0-9a-f]{32}/, '/me/jobs/{jobId}');
    called.push(`${init?.method ?? 'GET'} ${path}`);
    return new Response(JSON.stringify({ title: 'X', status: 'new' }), { status: 200 });
  };
  const api = createApi({
    settings: {
      apiUrl: 'https://api.jobdeputy.test',
      authDomain: 'https://auth.jobdeputy.test',
      clientId: 'e2etestclient0000000000000',
      filesOrigin: 'https://files.jobdeputy.test',
    },
    auth,
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  await readApplication(api, POSTING);
  await recordApplication(api, POSTING);
  expect(called).toEqual(['GET /me/jobs/{jobId}', 'PUT /me/jobs/{jobId}/stage']);
  for (const route of called) expect(EXTENSION_API_ROUTES).toContain(route);
});
