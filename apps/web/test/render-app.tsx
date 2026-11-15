import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { App } from '../src/App.tsx';
import type { ApiClient } from '../src/lib/api/client.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { ApiContext } from '../src/lib/api/index.ts';
import { createFakeAuth } from '../src/lib/auth/fake.ts';
import { type Auth, AuthContext } from '../src/lib/auth/index.ts';

/**
 * Renders the app with in-memory authentication and API (no Cognito, no network) and waits until
 * it has checked the session and shown its first page. Each render gets its own query cache.
 */
export async function renderApp(
  auth: Auth = createFakeAuth(),
  options: Parameters<typeof render>[1] = {},
  api: ApiClient = createFakeApi({ delay: 0 }),
  { waitForPage = true }: { waitForPage?: boolean } = {},
) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queries}>
      <AuthContext.Provider value={auth}>
        <ApiContext.Provider value={api}>
          <App />
        </ApiContext.Provider>
      </AuthContext.Provider>
    </QueryClientProvider>,
    options,
  );
  if (waitForPage) await screen.findByRole('heading', { level: 1 });
  return Object.assign(view, { queries });
}
