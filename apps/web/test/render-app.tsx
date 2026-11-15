import { render, screen } from '@testing-library/react';
import { App } from '../src/App.tsx';
import { createFakeAuth } from '../src/lib/auth/fake.ts';
import { type Auth, AuthContext } from '../src/lib/auth/index.ts';

/**
 * Renders the app with in-memory authentication (no Cognito, no network) and waits until it has
 * checked the session and shown its first page.
 */
export async function renderApp(
  auth: Auth = createFakeAuth(),
  options: Parameters<typeof render>[1] = {},
) {
  const view = render(
    <AuthContext.Provider value={auth}>
      <App />
    </AuthContext.Provider>,
    options,
  );
  await screen.findByRole('heading', { level: 1 });
  return view;
}
