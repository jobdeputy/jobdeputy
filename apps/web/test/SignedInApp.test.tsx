import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/client.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { createFakeAuth } from '../src/lib/auth/fake.ts';
import { renderApp } from './render-app.tsx';

afterEach(cleanup);

/** A fake account already signed in. */
async function signedIn() {
  const auth = createFakeAuth({ delay: 0 });
  await auth.signUp('new@example.com', 'a long enough password');
  await auth.confirmSignUp('new@example.com', 'a long enough password', '123456');
  return auth;
}

describe('the signed-in app', () => {
  it('starts a new account (no profile yet) on the guided set-up', async () => {
    await renderApp(await signedIn());
    const title = await screen.findByRole('heading', { level: 1, name: 'Hi, I’m your deputy.' });
    expect(document.activeElement).toBe(title);
    expect(screen.getByText('new@example.com')).toBeTruthy();
    expect(screen.getByText('United States (US)')).toBeTruthy();
    expect(screen.getByText('3 short steps')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Let’s start' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'You’re in.' })).toBeTruthy();
  });

  it('takes someone with a profile straight to their page', async () => {
    const api = createFakeApi({ delay: 0 });
    await api.request('PUT', '/me/profile', { name: 'Alex' });
    await renderApp(await signedIn(), {}, api);
    expect(await screen.findByRole('heading', { level: 1, name: 'You’re in.' })).toBeTruthy();
  });

  it('says when the profile could not be read, and tries again', async () => {
    const api = createFakeApi({ delay: 0 });
    const read = vi
      .spyOn(api, 'request')
      .mockRejectedValueOnce(new ApiError('server', { status: 500 }));
    await renderApp(await signedIn(), {}, api);
    const title = await screen.findByRole('heading', {
      level: 1,
      name: 'Your search desk didn’t open.',
    });
    expect(document.activeElement).toBe(title);
    expect(
      screen
        .getAllByRole('alert')
        .some((alert) => alert.textContent?.startsWith('Check your connection')),
    ).toBe(true);
    // Never a trap: Sign out is right there.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hi, I’m your deputy.' }),
    ).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('signs out from the set-up, back to the landing page, forgetting what it loaded', async () => {
    const { queries } = await renderApp(await signedIn());
    await screen.findByRole('heading', { level: 1, name: 'Hi, I’m your deputy.' });
    expect(queries.getQueryCache().getAll().length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: 'You set it up. Your deputy applies.' }),
      ).toBeTruthy(),
    );
    // The next person in this tab starts clean.
    expect(queries.getQueryCache().getAll()).toEqual([]);
  });

  it('keeps the page when a later refresh of the profile fails', async () => {
    const api = createFakeApi({ delay: 0 });
    const { queries } = await renderApp(await signedIn(), {}, api);
    await screen.findByRole('heading', { level: 1, name: 'Hi, I’m your deputy.' });
    vi.spyOn(api, 'request').mockRejectedValue(new ApiError('offline'));
    await queries.refetchQueries({ queryKey: ['profile'] }).catch(() => {});
    await waitFor(() => expect(queries.getQueryState(['profile'])?.status).toBe('error'));
    expect(screen.getByRole('heading', { level: 1, name: 'Hi, I’m your deputy.' })).toBeTruthy();
  });
});
