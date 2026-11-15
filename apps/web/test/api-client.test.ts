import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, DEFAULT_RETRY_AFTER_SECONDS } from '../src/lib/api/client.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const API = 'https://api.example';

function client(overrides: { apiUrl?: string | null; token?: string | null } = {}) {
  return createApiClient({
    apiUrl: async () => (overrides.apiUrl === undefined ? API : overrides.apiUrl),
    accessToken: async () => (overrides.token === undefined ? 'token-1' : overrides.token),
  });
}

/** The API answering once with this status, body and headers. */
function answer(status: number, body = '', headers: Record<string, string> = {}) {
  const fetch = vi.fn(async () => new Response(body || null, { status, headers }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => {
      throw new Error('expected a failure');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe('the API client', () => {
  it('calls the API with the token, sends JSON, and returns the JSON answer', async () => {
    const fetch = answer(200, '{"id":"r1"}');
    await expect(client().request('POST', '/me/roles', { title: 'Engineer' })).resolves.toEqual({
      id: 'r1',
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/me/roles');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      authorization: 'Bearer token-1',
      'content-type': 'application/json',
    });
    expect(init.body).toBe('{"title":"Engineer"}');
    // A write waits for its real answer: no time limit.
    expect(init.signal).toBeUndefined();
  });

  it('gives a read a time limit, and an empty answer is undefined', async () => {
    const fetch = answer(204);
    await expect(client().request('GET', '/me/roles')).resolves.toBeUndefined();
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ authorization: 'Bearer token-1' });
  });

  it('asks nothing without an API or a session', async () => {
    const fetch = answer(200);
    expect((await failure(client({ apiUrl: null }).request('GET', '/me'))).kind).toBe('not-set-up');
    expect((await failure(client({ token: null }).request('GET', '/me'))).kind).toBe('signed-out');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('calls a request that never got an answer offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect((await failure(client().request('GET', '/me'))).kind).toBe('offline');
  });

  it('turns the API’s refusals into kinds, with its reason and field errors', async () => {
    answer(
      400,
      JSON.stringify({
        title: 'Invalid request',
        status: 400,
        errors: [{ path: 'contact.email', message: 'Invalid email' }, { nonsense: true }],
      }),
    );
    const invalid = await failure(client().request('PUT', '/me/profile', {}));
    expect(invalid.kind).toBe('invalid');
    expect(invalid.fieldErrors).toEqual([{ path: 'contact.email', message: 'Invalid email' }]);
    expect(invalid.message).toBe('Invalid request');

    for (const [status, kind] of [
      [401, 'signed-out'],
      [403, 'forbidden'],
      [404, 'not-found'],
      [412, 'conflict'],
      [500, 'server'],
      [503, 'server'],
    ] as const) {
      answer(status);
      const error = await failure(client().request('GET', '/me'));
      expect([error.kind, error.status]).toEqual([kind, status]);
    }

    answer(
      409,
      JSON.stringify({
        title: 'Try again',
        detail: 'Another change was saved.',
        code: 'try-again',
      }),
    );
    const conflict = await failure(client().request('PUT', '/me/profile', {}));
    expect([conflict.kind, conflict.code, conflict.message]).toEqual([
      'conflict',
      'try-again',
      'Another change was saved.',
    ]);
  });

  it('says how long to wait after too many requests', async () => {
    answer(429, '', { 'retry-after': '12' });
    expect((await failure(client().request('POST', '/me/crawls', {}))).retryAfterSeconds).toBe(12);
    // API Gateway's own throttle says nothing: the default wait.
    answer(429);
    const throttled = await failure(client().request('GET', '/me'));
    expect([throttled.kind, throttled.retryAfterSeconds]).toEqual([
      'too-many',
      DEFAULT_RETRY_AFTER_SECONDS,
    ]);
  });
});
