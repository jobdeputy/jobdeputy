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
  it('starts a new account (no profile yet: version 0) on the guided set-up', async () => {
    await renderApp(await signedIn());
    const title = await screen.findByRole('heading', { level: 1, name: 'Hi, I’m your deputy.' });
    expect(document.activeElement).toBe(title);
    expect(screen.getByText('new@example.com')).toBeTruthy();
    expect(screen.getByText('United States (US)')).toBeTruthy();
    // The step bar sits in the header, with Sign out.
    expect(screen.getByRole('banner').textContent).toContain('3 short steps');
    fireEvent.click(screen.getByRole('button', { name: 'Let’s start' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'First, what should I call you?' }),
    ).toBeTruthy();
    expect(screen.getByRole('banner').textContent).toContain('Step 1 of 3');
  });

  it('takes someone with a profile straight to their page', async () => {
    const api = createFakeApi({ delay: 0 });
    await api.request('PUT', '/me/profile', { version: 0, firstName: 'Alex', lastName: 'Morgan' });
    await renderApp(await signedIn(), {}, api);
    expect(await screen.findByRole('heading', { level: 1, name: 'You’re in.' })).toBeTruthy();
  });

  it('says when the profile could not be read, and tries again', async () => {
    const api = createFakeApi({ delay: 0 });
    const read = vi
      .spyOn(api, 'request')
      .mockRejectedValueOnce(new ApiError('server', { status: 500 }));
    await renderApp(await signedIn(), {}, api);
    // The section takes focus, named by its title and its reason.
    const failed = await screen.findByRole('region', {
      name: /^Your search desk didn’t open\. Check your connection, then try again\./,
    });
    expect(document.activeElement).toBe(failed);
    // Never a trap: Sign out is in the header.
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

  it('keeps Sign out within reach while the profile is still loading', async () => {
    const api = createFakeApi({ delay: 0 });
    vi.spyOn(api, 'request').mockReturnValue(new Promise(() => {}));
    await renderApp(await signedIn(), {}, api, { waitForPage: false });
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy();
    // After the shared 300 ms, the wait is read out.
    await waitFor(() =>
      expect(
        screen.getAllByRole('status').some((s) => s.textContent === 'Opening your search desk'),
      ).toBe(true),
    );
  });

  it('saves step 1, You, and moves on (the set-up stays, though a profile now exists)', async () => {
    const api = createFakeApi({ delay: 0 });
    const save = vi.spyOn(api, 'request');
    await renderApp(await signedIn(), {}, api);
    fireEvent.click(await screen.findByRole('button', { name: 'Let’s start' }));
    await screen.findByRole('heading', { level: 1, name: 'First, what should I call you?' });
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: ' Alex ' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Morgan' } });
    fireEvent.change(screen.getByLabelText('City (optional)'), { target: { value: 'Austin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'You’re in.' })).toBeTruthy();
    expect(save).toHaveBeenCalledWith(
      'PUT',
      '/me/profile',
      expect.objectContaining({
        version: 0,
        firstName: 'Alex',
        lastName: 'Morgan',
        location: { city: 'Austin', country: 'US' },
      }),
    );
  });

  it('marks what is missing beside it, and starts at the first', async () => {
    const api = createFakeApi({ delay: 0 });
    const save = vi.spyOn(api, 'request');
    await renderApp(await signedIn(), {}, api);
    fireEvent.click(await screen.findByRole('button', { name: 'Let’s start' }));
    await screen.findByRole('heading', { level: 1, name: 'First, what should I call you?' });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'x'.repeat(101) } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Enter your first name.')).toBeTruthy();
    expect(screen.getByText('Use at most 100 characters.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('First name'));
    expect(save.mock.calls.filter(([method]) => method === 'PUT')).toHaveLength(0);
  });

  it('shows the API’s refusals beside their fields, and says when it changed elsewhere', async () => {
    const api = createFakeApi({ delay: 0 });
    await renderApp(await signedIn(), {}, api);
    fireEvent.click(await screen.findByRole('button', { name: 'Let’s start' }));
    await screen.findByRole('heading', { level: 1, name: 'First, what should I call you?' });
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Morgan' } });
    const request = api.request.bind(api);
    const put = vi.spyOn(api, 'request').mockImplementation((method, path, body) =>
      method === 'PUT'
        ? Promise.reject(
            new ApiError('invalid', {
              status: 400,
              fieldErrors: [{ path: 'location.city', message: 'Not a city we know.' }],
            }),
          )
        : request(method, path, body),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Not a city we know.')).toBeTruthy();
    put.mockImplementation((method, path, body) =>
      method === 'PUT'
        ? Promise.reject(new ApiError('conflict', { status: 409 }))
        : request(method, path, body),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('alert')
          .some(
            (alert) =>
              alert.textContent ===
              'Your profile changed somewhere else. Check it here, then continue.',
          ),
      ).toBe(true),
    );
  });

  it('goes back from step 1 to the welcome', async () => {
    await renderApp(await signedIn());
    fireEvent.click(await screen.findByRole('button', { name: 'Let’s start' }));
    await screen.findByRole('heading', { level: 1, name: 'First, what should I call you?' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hi, I’m your deputy.' }),
    ).toBeTruthy();
  });
});
