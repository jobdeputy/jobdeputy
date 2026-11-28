import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeAuth } from '../src/lib/auth/fake.ts';
import { AuthError } from '../src/lib/auth/index.ts';
import { renderApp } from './render-app.tsx';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  sessionStorage.clear();
});

/** The app opened on the return address managed login sends people back to (#111). */
function returning(search: string) {
  window.history.replaceState(null, '', `/auth/callback${search}`);
}

describe('back from the secure sign-in page (#111)', () => {
  it('finishes the sign-in, signs the person in, and leaves the return address', async () => {
    returning('?code=fake&state=sign-up');
    const storage = new Map<string, string>([['jobdeputy.fake-auth.pending', 'sign-up']]);
    const auth = createFakeAuth({
      delay: 0,
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => void storage.set(key, value),
        removeItem: (key) => void storage.delete(key),
      },
    });
    await renderApp(auth);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hi, I’m your deputy.' }),
    ).toBeTruthy();
    expect(screen.getByText('new@example.com')).toBeTruthy();
    // Replaced, not pushed: Back never offers the one-time code again.
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('');
  });

  it('opens the sign-in drawer saying the sign-in did not finish', async () => {
    returning('?error=access_denied');
    await renderApp(createFakeAuth({ delay: 0 }), {}, undefined, { waitForPage: false });
    const drawer = await screen.findByRole('dialog');
    expect(drawer.textContent).toContain('Welcome back.');
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Sign-in didn’t finish. Try again.'),
    );
    expect(window.location.pathname).toBe('/');
  });

  it('reopens the drawer as it was left: creating an account, when that was cancelled', async () => {
    sessionStorage.setItem('jobdeputy.sign-in-mode', 'sign-up');
    returning('?error=access_denied');
    await renderApp(createFakeAuth({ delay: 0 }), {}, undefined, { waitForPage: false });
    const drawer = await screen.findByRole('dialog');
    expect(drawer.textContent).toContain('Set up your search desk.');
    expect(screen.getByRole('button', { name: 'Continue to create account' })).toBeTruthy();
  });

  it('says so when the sign-in could not be finished for a connection problem', async () => {
    returning('?code=abc&state=s');
    const auth = {
      ...createFakeAuth({ delay: 0 }),
      finishSignIn: vi.fn(async () => {
        throw new AuthError('offline');
      }),
    };
    await renderApp(auth, {}, undefined, { waitForPage: false });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Can’t reach JobDeputy. Check your connection and try again.',
      ),
    );
  });

  it('never finishes a sign-in anywhere but the return address', async () => {
    const auth = { ...createFakeAuth({ delay: 0 }), finishSignIn: vi.fn() };
    await renderApp(auth);
    expect(auth.finishSignIn).not.toHaveBeenCalled();
  });
});
