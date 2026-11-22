import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveBody } from '../src/components/profile/profile-form.tsx';
import { StepYou, youSpec } from '../src/components/setup/step-you.tsx';
import { ApiError } from '../src/lib/api/client.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { ApiContext } from '../src/lib/api/index.ts';
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

  it('takes someone with a profile straight to Job matches (#49)', async () => {
    const api = createFakeApi({ delay: 0 });
    await api.request('PUT', '/me/profile', { version: 0, firstName: 'Alex', lastName: 'Morgan' });
    await renderApp(await signedIn(), {}, api);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'The best jobs at each company.' }),
    ).toBeTruthy();
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
    expect(
      await screen.findByRole('heading', { level: 1, name: 'What roles should I look for?' }),
    ).toBeTruthy();
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
    expect(
      await screen.findByRole('heading', { level: 1, name: 'What roles should I look for?' }),
    ).toBeTruthy();
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
    const body = saveBody(youSpec, saved, {
      firstName: 'Alexandra',
      lastName: 'Morgan',
      city: 'Dallas',
    });
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
    expect(saveBody(youSpec, saved, { firstName: 'A', lastName: 'M', city: ' ' }).location).toEqual(
      {
        region: 'TX',
        country: 'US',
      },
    );
  });

  it('saves under React’s development check (StrictMode mounts twice)', async () => {
    const api = createFakeApi({ delay: 0 });
    await renderApp(await signedIn(), { wrapper: StrictMode }, api);
    fireEvent.click(await screen.findByRole('button', { name: 'Let’s start' }));
    await screen.findByRole('heading', { level: 1, name: 'First, what should I call you?' });
    fill('Alex', 'Morgan');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'What roles should I look for?' }),
    ).toBeTruthy();
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

  it('shows what another device saved when a save’s answer was lost', async () => {
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
    // Changed elsewhere: what is saved now shows, nothing is overwritten unseen.
    await waitFor(() => expect(alertText()).toContain('Your profile changed somewhere else.'));
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Robert');
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
    // Focus must not land on a field still locked by the save (read-only, and on phones no keyboard).
    let lockedAtFocus: boolean | undefined;
    screen.getByLabelText('Last name').addEventListener('focus', (event) => {
      lockedAtFocus = (event.target as HTMLInputElement).readOnly;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Check your last name.')).toBeTruthy();
    const lastName = screen.getByLabelText('Last name');
    expect(document.activeElement).toBe(lastName);
    expect(lockedAtFocus).toBe(false);
    // Its reason was there when it took focus (tied to it), and the other refusal is said politely.
    expect(lastName.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .some((status) =>
            status.textContent?.includes('Part of your saved profile no longer fits the rules'),
          ),
      ).toBe(true),
    );
    expect(alertText()).not.toContain('Part of your saved profile');
    // Focus moved there (from the button), which reads its reason: it isn't said twice.
    expect(
      screen.getAllByRole('status').some((status) => status.textContent?.includes('Check your')),
    ).toBe(false);
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

  it('keeps what was typed when only other fields changed elsewhere meanwhile', async () => {
    const api = createFakeApi({ delay: 0 });
    await api.request('PUT', '/me/profile', { version: 0, firstName: 'Alex', lastName: 'Morgan' });
    const saved = await api.request<Profile>('GET', '/me/profile');
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method !== 'PUT') return request(method, path, body);
      // Another device saves skills (the names unchanged), and this save never arrives.
      await request('PUT', '/me/profile', {
        ...saveBody(youSpec, saved, valuesOfSaved()),
        skills: ['Go'],
      });
      throw new ApiError('unsure');
    });
    const onSaved = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApiContext.Provider value={api}>
          <StepYou profile={saved} onSaved={onSaved} onBack={() => {}} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    fill('Alexandra', 'Morgan');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(alertText()).toContain('That didn’t save. Check your connection, then try again.'),
    );
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Alexandra');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('says at once when a saved field this step doesn’t show is wrong too', async () => {
    const api = createFakeApi({ delay: 0 });
    // Saved before a rule changed: a headline now over the limit.
    const saved = { version: 1, firstName: 'Alex', lastName: 'Morgan', headline: 'x'.repeat(201) };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApiContext.Provider value={api}>
          <StepYou profile={saved} onSaved={() => {}} onBack={() => {}} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    fill('', 'Morgan');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Enter your first name.')).toBeTruthy();
    // Shown (not a live region of its own: the status line says it), and part of the form's
    // description, so it is there when the form is come back to.
    await waitFor(() =>
      expect(screen.getByRole('form').getAttribute('aria-describedby')).toBeTruthy(),
    );
    const noteId = screen.getByRole('form').getAttribute('aria-describedby') ?? '';
    const note = document.getElementById(noteId) as HTMLElement;
    expect(note.textContent).toMatch(/^Part of your saved profile no longer fits the rules/);
    expect(note.getAttribute('role')).toBeNull();
    // Fixing the visible field does not hide it: its cause is still there.
    fill('Alex', 'Morgan');
    expect(note.textContent).toMatch(/^Part of your saved profile/);
    // Pressed again: still shown, and said again in the status line (cleared, then said), so it
    // is read again.
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const saying = () =>
      screen
        .getAllByRole('status')
        .some((status) => status.textContent?.startsWith('Part of your saved profile'));
    expect(saying()).toBe(false);
    await waitFor(() => expect(saying()).toBe(true));
    expect(note.textContent).toMatch(/^Part of your saved profile/);
  });

  it('says a refused save did not save when what is saved can’t be read either', async () => {
    const api = createFakeApi({ delay: 0 });
    await toStepYou(api);
    fill('Alex', 'Morgan');
    vi.spyOn(api, 'request').mockImplementation(async (method) => {
      throw method === 'PUT' ? new ApiError('conflict', { status: 409 }) : new ApiError('offline');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(alertText()).toContain('That didn’t save. Check your connection, then try again.'),
    );
  });

  it('locks the fields while saving', async () => {
    const api = createFakeApi({ delay: 0 });
    await toStepYou(api);
    fill('Alex', 'Morgan');
    vi.spyOn(api, 'request').mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(screen.getByLabelText('First name').hasAttribute('readonly')).toBe(true),
    );
    // And it shows at once: the inputs dim (their labels and messages stay readable).
    expect(screen.getByLabelText('First name').closest('[class*="opacity-60"]')).toBeTruthy();
  });

  it('says something else was saved meanwhile when only other fields changed', async () => {
    const api = createFakeApi({ delay: 0 });
    await api.request('PUT', '/me/profile', { version: 0, firstName: 'Alex', lastName: 'Morgan' });
    const saved = await api.request<Profile>('GET', '/me/profile');
    // Another device saves skills (the names unchanged) before this save is sent.
    await api.request('PUT', '/me/profile', {
      ...saveBody(youSpec, saved, valuesOfSaved()),
      skills: ['Go'],
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApiContext.Provider value={api}>
          <StepYou profile={saved} onSaved={() => {}} onBack={() => {}} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    fill('Alexandra', 'Morgan');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(alertText()).toContain('Something else in your profile was saved meanwhile.'),
    );
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Alexandra');
  });

  it('does not claim a lost save went through when nothing new was saved', async () => {
    const api = createFakeApi({ delay: 0 });
    await api.request('PUT', '/me/profile', { version: 0, firstName: 'Alex', lastName: 'Morgan' });
    const saved = await api.request<Profile>('GET', '/me/profile');
    const request = api.request.bind(api);
    // The save never arrives; the saved answers already match what is sent.
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method === 'PUT') throw new ApiError('unsure');
      return request(method, path, body);
    });
    const onSaved = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApiContext.Provider value={api}>
          <StepYou profile={saved} onSaved={onSaved} onBack={() => {}} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(alertText()).toContain('That didn’t save. Check your connection, then try again.'),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('says a field’s reason in the status line when Enter was pressed in that field', async () => {
    const api = createFakeApi({ delay: 0 });
    await toStepYou(api);
    fill('', 'Morgan');
    const first = screen.getByLabelText('First name');
    first.focus();
    fireEvent.submit(first.closest('form') as HTMLFormElement);
    // Focus was already there, so its new description would not be read: the status line says it.
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .some((status) => status.textContent === 'Enter your first name.'),
      ).toBe(true),
    );
    // Typing clears what was said (and anything about to be).
    fill('A', 'Morgan');
    expect(
      screen
        .getAllByRole('status')
        .some((status) => status.textContent === 'Enter your first name.'),
    ).toBe(false);
  });

  it('says a reason once: typing cancels one about to be said, and said words clear', () => {
    vi.useFakeTimers();
    try {
      const api = createFakeApi({ delay: 0 });
      render(
        <QueryClientProvider client={new QueryClient()}>
          <ApiContext.Provider value={api}>
            <StepYou
              profile={{ version: 0, firstName: '', lastName: 'Morgan' }}
              onSaved={() => {}}
              onBack={() => {}}
            />
          </ApiContext.Provider>
        </QueryClientProvider>,
      );
      const said = () =>
        screen.getAllByRole('status').some((s) => s.textContent === 'Enter your first name.');
      const first = screen.getByLabelText('First name');
      first.focus();
      fireEvent.submit(first.closest('form') as HTMLFormElement);
      // Typing straight away: the reason, about to be said, is not.
      fireEvent.change(first, { target: { value: 'A' } });
      act(() => vi.advanceTimersByTime(200));
      expect(said()).toBe(false);
      // Said (Enter again with it empty), then gone from the status line a few seconds later.
      fireEvent.change(first, { target: { value: '' } });
      fireEvent.submit(first.closest('form') as HTMLFormElement);
      act(() => vi.advanceTimersByTime(200));
      expect(said()).toBe(true);
      act(() => vi.advanceTimersByTime(5000));
      expect(said()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows and says the hidden-field note even when typing starts at once', () => {
    vi.useFakeTimers();
    try {
      const api = createFakeApi({ delay: 0 });
      render(
        <QueryClientProvider client={new QueryClient()}>
          <ApiContext.Provider value={api}>
            <StepYou
              profile={{ version: 1, firstName: '', lastName: 'Morgan', headline: 'x'.repeat(201) }}
              onSaved={() => {}}
              onBack={() => {}}
            />
          </ApiContext.Provider>
        </QueryClientProvider>,
      );
      const first = screen.getByLabelText('First name');
      first.focus();
      fireEvent.submit(first.closest('form') as HTMLFormElement);
      fireEvent.change(first, { target: { value: 'A' } });
      act(() => vi.advanceTimersByTime(200));
      // Shown, and still said (a screen reader hears it nowhere else while in a field).
      expect(
        screen
          .getAllByText(/^Part of your saved profile no longer fits the rules/)
          .some((element) => element.getAttribute('role') === 'status'),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says it cannot tell when the answer and the check are both lost', async () => {
    const api = createFakeApi({ delay: 0 });
    await toStepYou(api);
    fill('Alex', 'Morgan');
    vi.spyOn(api, 'request').mockRejectedValue(new ApiError('unsure'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(alertText()).toContain('We couldn’t tell whether that saved.'));
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Alex');
  });

  it('moves on when a refused save turns out to hold these answers already', async () => {
    const api = createFakeApi({ delay: 0 });
    await toStepYou(api);
    fill('Alex', 'Morgan');
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method !== 'PUT') return request(method, path, body);
      // An earlier save of the same answers did go through (its answer was lost).
      await request('PUT', '/me/profile', {
        version: 0,
        firstName: 'Alex',
        lastName: 'Morgan',
        location: { country: 'US' },
      });
      throw new ApiError('conflict', { status: 409 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'What roles should I look for?' }),
    ).toBeTruthy();
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

/** Step 1's answers as a saved Alex Morgan profile has them. */
function valuesOfSaved() {
  return { firstName: 'Alex', lastName: 'Morgan', city: '' };
}
