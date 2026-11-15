import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveBody } from '../src/components/setup/step-you.tsx';
import { ApiError } from '../src/lib/api/client.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import type { Profile } from '../src/lib/api/profile.ts';
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

  it('shows the API’s refusals beside their fields, in its own words', async () => {
    const api = createFakeApi({ delay: 0 });
    await toStepYou(api);
    fill('Alex', 'Morgan');
    refuseSaves(
      api,
      new ApiError('invalid', {
        status: 400,
        fieldErrors: [{ path: 'location.city', message: 'raw server words' }],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Check the city.')).toBeTruthy();
    expect(screen.queryByText('raw server words')).toBeNull();
  });

  it('shows what is saved now when the profile changed elsewhere', async () => {
    const api = createFakeApi({ delay: 0 });
    await toStepYou(api);
    // Saved meanwhile in another tab.
    await api.request('PUT', '/me/profile', { version: 0, firstName: 'Robert', lastName: 'Lee' });
    fill('Bob', 'Lee');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(alertText()).toContain('Your profile changed somewhere else.'));
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Robert');
  });

  it('moves on when a save whose answer was lost did go through', async () => {
    const api = createFakeApi({ delay: 0 });
    await toStepYou(api);
    fill('Alex', 'Morgan');
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method !== 'PUT') return request(method, path, body);
      await request(method, path, body);
      throw new ApiError('unsure');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'You’re in.' })).toBeTruthy();
  });

  it('says how long to wait, or that the account can no longer change', async () => {
    const api = createFakeApi({ delay: 0 });
    await toStepYou(api);
    fill('Alex', 'Morgan');
    refuseSaves(api, new ApiError('too-many', { status: 429, retryAfterSeconds: 30 }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(alertText()).toContain('Too many saves for now. Try again in 30 seconds.'),
    );
    refuseSaves(api, new ApiError('forbidden', { status: 410, code: 'account-deleted' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(alertText()).toContain('This account can’t be changed any more.'));
  });

  it('sends back only what a save may carry, keeping the saved region', async () => {
    const api = createFakeApi({ delay: 0 });
    await api.request('PUT', '/me/profile', {
      version: 0,
      firstName: 'Alex',
      lastName: 'Morgan',
      skills: ['TypeScript'],
      location: { city: 'Austin', region: 'TX', country: 'US' },
    });
    const saved = await api.request<Profile>('GET', '/me/profile');
    // What the server adds is on the saved profile…
    expect(saved).toMatchObject({ email: expect.any(String), homeCell: 'iad' });
    const body = saveBody(saved, { firstName: 'Alexandra', lastName: 'Morgan', city: 'Dallas' });
    // …but not in what goes back, which keeps the rest (skills, the region).
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('createdAt');
    expect(body).toMatchObject({
      version: 1,
      firstName: 'Alexandra',
      skills: ['TypeScript'],
      location: { city: 'Dallas', region: 'TX', country: 'US' },
    });
    // The API's strict schema refuses the server's own fields sent back, and takes the body.
    await expect(api.request('PUT', '/me/profile', { ...saved, version: 1 })).rejects.toMatchObject(
      { kind: 'invalid' },
    );
    await expect(api.request('PUT', '/me/profile', body)).resolves.toMatchObject({ version: 2 });
    // A city cleared is gone; the rest of the place stays.
    expect(saveBody(saved, { firstName: 'A', lastName: 'M', city: ' ' }).location).toEqual({
      region: 'TX',
      country: 'US',
    });
  });

  it('saves under React’s development check (StrictMode mounts twice)', async () => {
    const api = createFakeApi({ delay: 0 });
    await renderApp(await signedIn(), { wrapper: StrictMode }, api);
    fireEvent.click(await screen.findByRole('button', { name: 'Let’s start' }));
    await screen.findByRole('heading', { level: 1, name: 'First, what should I call you?' });
    fill('Alex', 'Morgan');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'You’re in.' })).toBeTruthy();
  });

  it('keeps what was typed when a save only collided (try again)', async () => {
    const api = createFakeApi({ delay: 0 });
    await toStepYou(api);
    fill('Alex', 'Morgan');
    refuseSaves(api, new ApiError('conflict', { status: 409, code: 'try-again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(alertText()).toContain('That didn’t save. Try again in a moment.'));
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Alex');
  });

  it('does not move on when what is saved after a lost answer is not what was sent', async () => {
    const api = createFakeApi({ delay: 0 });
    await toStepYou(api);
    fill('Alex', 'Morgan');
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method !== 'PUT') return request(method, path, body);
      // Another device saved something else meanwhile; this save's answer was lost.
      await request('PUT', '/me/profile', { version: 0, firstName: 'Robert', lastName: 'Lee' });
      throw new ApiError('unsure');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(alertText()).toContain('That didn’t save.'));
    expect(
      screen.getByRole('heading', { level: 1, name: 'First, what should I call you?' }),
    ).toBeTruthy();
  });

  it('moves focus to a field the API refused, and says when it refused another', async () => {
    const api = createFakeApi({ delay: 0 });
    await toStepYou(api);
    fill('Alex', 'Morgan');
    refuseSaves(
      api,
      new ApiError('invalid', {
        status: 400,
        fieldErrors: [
          { path: 'lastName', message: 'raw' },
          { path: 'links.github', message: 'raw' },
        ],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Check your last name.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Last name'));
    expect(alertText()).toContain('Part of your saved profile no longer fits the rules');
  });

  it('says a wait in words', async () => {
    const api = createFakeApi({ delay: 0 });
    await toStepYou(api);
    fill('Alex', 'Morgan');
    refuseSaves(api, new ApiError('too-many', { status: 429, retryAfterSeconds: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(alertText()).toContain('Try again in 1 second.'));
    refuseSaves(api, new ApiError('too-many', { status: 429, retryAfterSeconds: 90 }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(alertText()).toContain('Try again in 2 minutes.'));
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

/** Signs a new account in and opens step 1, You. */
async function toStepYou(api: ReturnType<typeof createFakeApi>) {
  await renderApp(await signedIn(), {}, api);
  fireEvent.click(await screen.findByRole('button', { name: 'Let’s start' }));
  await screen.findByRole('heading', { level: 1, name: 'First, what should I call you?' });
}

function fill(first: string, last: string) {
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: first } });
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: last } });
}

/** Every save refused with `error`; reads still answered. */
function refuseSaves(api: ReturnType<typeof createFakeApi>, error: ApiError) {
  const request = api.request.bind(api);
  vi.spyOn(api, 'request').mockImplementation((method, path, body) =>
    method === 'PUT' ? Promise.reject(error) : request(method, path, body),
  );
}

function alertText(): string {
  return screen
    .getAllByRole('alert')
    .map((alert) => alert.textContent)
    .join(' ');
}
