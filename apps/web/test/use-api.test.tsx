import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/lib/api/client.ts';
import { ApiContext, useApi } from '../src/lib/api/index.ts';
import { createFakeAuth } from '../src/lib/auth/fake.ts';
import { AuthContext } from '../src/lib/auth/index.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useApi', () => {
  it('calls with the token of whoever the screen’s sign-in says is signed in', async () => {
    const auth = createFakeAuth({ delay: 0, signedInAs: 'a@example.com' });
    const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
      url === '/config.json'
        ? new Response(
            JSON.stringify({
              userPoolId: 'pool',
              userPoolClientId: 'client',
              apiUrl: 'https://api.example',
            }),
          )
        : new Response('{}'),
    );
    vi.stubGlobal('fetch', fetch);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
    );
    const { result } = renderHook(() => useApi(), { wrapper });
    await result.current.request('GET', '/me');
    const call = fetch.mock.calls.find(([url]) => url === 'https://api.example/me');
    expect(call?.[1]?.headers).toMatchObject({
      authorization: 'Bearer fake-token:a@example.com',
    });
  });

  it('uses a client the tree provides instead', () => {
    const provided = createApiClient({ apiUrl: async () => null, accessToken: async () => null });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApiContext.Provider value={provided}>{children}</ApiContext.Provider>
    );
    expect(renderHook(() => useApi(), { wrapper }).result.current).toBe(provided);
  });
});
