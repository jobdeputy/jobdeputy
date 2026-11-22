import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plan, reconcile, StepRoles } from '../src/components/setup/step-roles.tsx';
import { ApiError } from '../src/lib/api/client.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { ApiContext } from '../src/lib/api/index.ts';
import type { Role } from '../src/lib/api/roles.ts';
import { createFakeAuth } from '../src/lib/auth/fake.ts';
import { renderApp } from './render-app.tsx';

afterEach(cleanup);

type FakeApi = ReturnType<typeof createFakeApi>;

/** Step 2 on its own, over a fake API holding these roles already. */
async function renderStep(titles: string[] = [], api: FakeApi = createFakeApi({ delay: 0 })) {
  for (const title of titles) await api.request('POST', '/me/roles', { title });
  const onSaved = vi.fn();
  const onBack = vi.fn();
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queries}>
      <ApiContext.Provider value={api}>
        <StepRoles onSaved={onSaved} onBack={onBack} />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
  await screen.findByLabelText('Job title');
  return { api, onSaved, onBack, queries, view };
}

async function savedTitles(api: FakeApi) {
  return (await api.request<{ roles: Role[] }>('GET', '/me/roles')).roles.map((role) => role.title);
}

function type(title: string) {
  fireEvent.change(screen.getByLabelText('Job title'), { target: { value: title } });
}

function add(title: string) {
  type(title);
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
}

function chip(title: string) {
  return screen.getByRole('checkbox', { name: title }) as HTMLInputElement;
}

function continueOn() {
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

/** What the status lines say (the step's own, and the loading region's). */
function statusText(): string {
  return screen
    .getAllByRole('status')
    .map((status) => status.textContent)
    .join('');
}

function alertText(): string {
  return screen
    .getAllByRole('alert')
    .map((alert) => alert.textContent)
    .join(' ');
}

describe('Set it up, step 2: target roles', () => {
  it('comes after step 1, saves the titles chosen, and moves on to step 3', async () => {
    const auth = createFakeAuth({ delay: 0 });
    await auth.signUp('new@example.com', 'a long enough password');
    await auth.confirmSignUp('new@example.com', 'a long enough password', '123456');
    const api = createFakeApi({ delay: 0 });
    await renderApp(auth, {}, api);
    fireEvent.click(await screen.findByRole('button', { name: 'Let’s start' }));
    await screen.findByRole('heading', { level: 1, name: 'First, what should I call you?' });
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Morgan' } });
    continueOn();
    const title = await screen.findByRole('heading', {
      level: 1,
      name: 'What roles should I look for?',
    });
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(title));
    await screen.findByLabelText('Job title');
    fireEvent.click(chip('Backend engineer'));
    add('Staff engineer');
    continueOn();
    expect(await screen.findByRole('heading', { level: 1, name: 'Add your résumé.' })).toBeTruthy();
    expect(await savedTitles(api)).toEqual(['Backend engineer', 'Staff engineer']);
  });

  it('goes back from step 2 to step 1, its answers still there', async () => {
    const auth = createFakeAuth({ delay: 0 });
    await auth.signUp('new@example.com', 'a long enough password');
    await auth.confirmSignUp('new@example.com', 'a long enough password', '123456');
    await renderApp(auth);
    fireEvent.click(await screen.findByRole('button', { name: 'Let’s start' }));
    await screen.findByLabelText('First name');
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Morgan' } });
    continueOn();
    await screen.findByLabelText('Job title');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { level: 1, name: 'First, what should I call you?' });
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Alex');
  });

  it('adds a typed title as a chosen chip at the front, tidied, and says so', async () => {
    await renderStep();
    add('  Staff   engineer ');
    expect(chip('Staff engineer').checked).toBe(true);
    const chips = screen.getAllByRole('checkbox').map((box) => (box as HTMLInputElement).value);
    expect(chips[0]).toBe('Staff engineer');
    expect((screen.getByLabelText('Job title') as HTMLInputElement).value).toBe('');
    // The field keeps focus, for the next title.
    expect(document.activeElement).toBe(screen.getByLabelText('Job title'));
    await waitFor(() => expect(statusText()).toBe('Added Staff engineer. 1 of 10 roles.'));
    expect(screen.getByText('· 1 of 10 added')).toBeTruthy();
  });

  it('adds with Enter, and checks the chip a typed title already has', async () => {
    await renderStep();
    type('backend engineer');
    fireEvent.keyDown(screen.getByLabelText('Job title'), { key: 'Enter' });
    expect(chip('Backend engineer').checked).toBe(true);
    expect(screen.queryByRole('checkbox', { name: 'backend engineer' })).toBeNull();
  });

  it('says why a title can’t be added, beside the field', async () => {
    await renderStep();
    add('   ');
    expect(screen.getByText('Type a job title first, or pick one below.')).toBeTruthy();
    expect(screen.getByLabelText('Job title').getAttribute('aria-invalid')).toBe('true');
    // Typing clears it.
    type('S');
    expect(screen.queryByText('Type a job title first, or pick one below.')).toBeNull();
    add('Software Engineer');
    add('software engineer');
    expect(screen.getByText('Software engineer is already on your list.')).toBeTruthy();
    add('x'.repeat(121));
    expect(screen.getByText('Use at most 120 characters.')).toBeTruthy();
  });

  it('says in the status line why Enter added nothing (focus stays, so it isn’t read)', async () => {
    await renderStep(['Data engineer']);
    type('data engineer');
    fireEvent.keyDown(screen.getByLabelText('Job title'), { key: 'Enter' });
    await waitFor(() => expect(statusText()).toBe('Data engineer is already on your list.'));
  });

  it('stops at 10, from the field and from a chip', async () => {
    await renderStep(Array.from({ length: 10 }, (_, n) => `Role ${n + 1}`));
    add('Role 11');
    expect(screen.getByText('You can add up to 10 roles. Remove one to add another.')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Role 11' })).toBeNull();
    fireEvent.click(chip('Backend engineer'));
    expect(chip('Backend engineer').checked).toBe(false);
    await waitFor(() =>
      expect(statusText()).toBe('You can add up to 10 roles. Remove one to add another.'),
    );
  });

  it('asks for at least one role', async () => {
    const { api, onSaved } = await renderStep();
    const request = vi.spyOn(api, 'request');
    continueOn();
    expect(screen.getByText('Add at least one role, or pick a suggestion.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Job title'));
    expect(onSaved).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('saves a title typed but not added yet', async () => {
    const { api, onSaved } = await renderStep();
    type('Staff engineer');
    continueOn();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(await savedTitles(api)).toEqual(['Staff engineer']);
  });

  it('shows saved roles chosen, removes the ones dropped first, then adds', async () => {
    const { api, onSaved } = await renderStep(['Data engineer', 'Backend engineer']);
    expect(chip('Data engineer').checked).toBe(true);
    expect(chip('Backend engineer').checked).toBe(true);
    // A saved title of the person's own is a chip at the front; a pick stays where it was.
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).value).toBe('Data engineer');
    const request = vi.spyOn(api, 'request');
    fireEvent.click(chip('Data engineer'));
    fireEvent.click(chip('Platform engineer'));
    continueOn();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(request.mock.calls.map(([method, path]) => `${method} ${path}`)).toEqual([
      // What is saved is read first, then changed.
      'GET /me/roles',
      expect.stringMatching(/^DELETE \/me\/roles\/\w{26}$/),
      'POST /me/roles',
    ]);
    expect(await savedTitles(api)).toEqual(['Backend engineer', 'Platform engineer']);
  });

  it('takes a role already removed elsewhere as removed', async () => {
    const { api, onSaved } = await renderStep(['Data engineer']);
    const [data] = (await api.request<{ roles: Role[] }>('GET', '/me/roles')).roles;
    await api.request('DELETE', `/me/roles/${data?.roleId}`);
    fireEvent.click(chip('Data engineer'));
    fireEvent.click(chip('Backend engineer'));
    continueOn();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(await savedTitles(api)).toEqual(['Backend engineer']);
  });

  it('unticks a saved title whose case differs from its chip', async () => {
    const { api, onSaved } = await renderStep(['backend engineer']);
    expect(chip('Backend engineer').checked).toBe(true);
    fireEvent.click(chip('Backend engineer'));
    expect(chip('Backend engineer').checked).toBe(false);
    fireEvent.click(chip('Platform engineer'));
    continueOn();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(await savedTitles(api)).toEqual(['Platform engineer']);
  });

  it('saves on, past a typed title already chosen (its reason gone too)', async () => {
    const { api, onSaved } = await renderStep();
    fireEvent.click(chip('Backend engineer'));
    type('backend engineer');
    fireEvent.keyDown(screen.getByLabelText('Job title'), { key: 'Enter' });
    expect(screen.getByText('Backend engineer is already on your list.')).toBeTruthy();
    continueOn();
    expect(screen.queryByText('Backend engineer is already on your list.')).toBeNull();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(await savedTitles(api)).toEqual(['Backend engineer']);
  });

  it('keeps the count in sight while a reason shows', async () => {
    await renderStep(Array.from({ length: 10 }, (_, n) => `Role ${n + 1}`));
    add('Role 11');
    expect(screen.getByText('You can add up to 10 roles. Remove one to add another.')).toBeTruthy();
    expect(screen.getByText('· 10 of 10 added')).toBeTruthy();
  });

  it('drops a reason about to be said once typing starts', async () => {
    await renderStep(['Data engineer']);
    vi.useFakeTimers();
    try {
      type('data engineer');
      fireEvent.keyDown(screen.getByLabelText('Job title'), { key: 'Enter' });
      type('data engineers');
      // Past the beat the reason would have been said on.
      act(() => vi.advanceTimersByTime(1000));
      expect(statusText()).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes a lost answer that went through as its own, not as a change elsewhere', async () => {
    const { api, onSaved } = await renderStep();
    const request = api.request.bind(api);
    let posts = 0;
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method !== 'POST') return request(method, path, body);
      posts += 1;
      if (posts === 2) {
        await request(method, path, body);
        throw new ApiError('unsure');
      }
      return request(method, path, body);
    });
    fireEvent.click(chip('Backend engineer'));
    fireEvent.click(chip('Platform engineer'));
    fireEvent.click(chip('Engineering manager'));
    continueOn();
    await waitFor(() => expect(alertText()).toContain('We couldn’t tell whether that saved.'));
    // The one whose answer was lost did save; dropping it now removes it, unasked about.
    fireEvent.click(chip('Platform engineer'));
    continueOn();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(alertText()).not.toContain('changed somewhere else');
    expect(await savedTitles(api)).toEqual(['Backend engineer', 'Engineering manager']);
  });

  it.each([
    ['its answer was lost', new ApiError('unsure')],
    ['the server failed after saving', new ApiError('server', { status: 503 })],
  ])('never sends a title twice when %s', async (_, failure) => {
    const { api, onSaved } = await renderStep();
    const request = api.request.bind(api);
    const spy = vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      const answer = await request(method, path, body);
      if (method === 'POST') throw failure;
      return answer;
    });
    fireEvent.click(chip('Backend engineer'));
    continueOn();
    await waitFor(() => expect(alertText()).toContain('We couldn’t tell whether that saved.'));
    spy.mockClear();
    spy.mockImplementation(request);
    continueOn();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // Read, found saved: nothing sent again.
    expect(spy.mock.calls.map(([method]) => method)).toEqual(['GET']);
    expect(await savedTitles(api)).toEqual(['Backend engineer']);
  });

  it('counts roles, not titles, against the limit (two saved may share one)', async () => {
    const titles = Array.from({ length: 9 }, (_, n) => `Role ${n + 1}`);
    await renderStep([...titles, 'role 1']);
    // Nine chips, ten roles: the count says what the limit counts.
    expect(screen.getByText('· 10 of 10 added')).toBeTruthy();
    fireEvent.click(chip('Backend engineer'));
    expect(chip('Backend engineer').checked).toBe(false);
    expect(screen.getByText('You can add up to 10 roles. Remove one to add another.')).toBeTruthy();
  });

  it('won’t re-check a title past the limit when it names more than one saved role', async () => {
    const titles = Array.from({ length: 8 }, (_, n) => `Role ${n + 1}`);
    await renderStep([...titles, 'role 1']);
    fireEvent.click(chip('Role 1'));
    fireEvent.click(chip('Backend engineer'));
    fireEvent.click(chip('Platform engineer'));
    expect(screen.getByText('· 9 of 10 added')).toBeTruthy();
    // Role 1 is two saved roles: checked again, it would make 11.
    fireEvent.click(chip('Role 1'));
    expect(chip('Role 1').checked).toBe(false);
    expect(screen.getByText('· 9 of 10 added')).toBeTruthy();
    expect(screen.getByText('You can add up to 10 roles. Remove one to add another.')).toBeTruthy();
  });

  it('adds nothing on the Enter that ends composing', async () => {
    await renderStep();
    type('ソフト');
    fireEvent.keyDown(screen.getByLabelText('Job title'), { key: 'Enter', keyCode: 229 });
    expect(screen.queryByRole('checkbox', { name: 'ソフト' })).toBeNull();
    expect((screen.getByLabelText('Job title') as HTMLInputElement).value).toBe('ソフト');
  });

  it('says a full list under the list, leaving the title field alone', async () => {
    await renderStep(Array.from({ length: 10 }, (_, n) => `Role ${n + 1}`));
    fireEvent.click(chip('Backend engineer'));
    const reason = screen.getByText('You can add up to 10 roles. Remove one to add another.');
    expect(screen.getByLabelText('Job title').getAttribute('aria-invalid')).toBeNull();
    expect(
      screen.getByRole('group', { name: /Roles to look for/ }).getAttribute('aria-describedby'),
    ).toBe(reason.id);
    fireEvent.click(chip('Role 1'));
    expect(screen.queryByText('You can add up to 10 roles. Remove one to add another.')).toBeNull();
  });

  it('names a title the API refuses, so it can be changed', async () => {
    const { api } = await renderStep();
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation((method, path, body) =>
      method === 'POST'
        ? Promise.reject(
            new ApiError('invalid', {
              status: 400,
              fieldErrors: [{ path: 'title', message: 'x' }],
            }),
          )
        : request(method, path, body),
    );
    fireEvent.click(chip('Backend engineer'));
    continueOn();
    await waitFor(() =>
      expect(alertText()).toContain(
        '“Backend engineer” can’t be saved as it is. Change it or remove it.',
      ),
    );
  });

  it('moves on, sending and reading nothing, when nothing changed (offline too)', async () => {
    const { api, onSaved } = await renderStep(['Data engineer']);
    const request = vi.spyOn(api, 'request').mockRejectedValue(new ApiError('offline'));
    continueOn();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(request).not.toHaveBeenCalled();
  });

  it('takes a server failure that saved as its own, not as a change elsewhere', async () => {
    const { api, onSaved } = await renderStep();
    const request = api.request.bind(api);
    const spy = vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      const answer = await request(method, path, body);
      if (method === 'POST' && (body as { title: string }).title === 'Platform engineer')
        throw new ApiError('server', { status: 504 });
      return answer;
    });
    fireEvent.click(chip('Backend engineer'));
    fireEvent.click(chip('Platform engineer'));
    continueOn();
    await waitFor(() =>
      expect(alertText()).toContain('We couldn’t tell whether that saved. Try again in a moment.'),
    );
    spy.mockImplementation(request);
    // It did save; dropping it now removes it, unasked about.
    fireEvent.click(chip('Platform engineer'));
    continueOn();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(alertText()).not.toContain('changed somewhere else');
    expect(await savedTitles(api)).toEqual(['Backend engineer']);
  });

  it('keeps what saved when a save stops part-way, and saves only the rest next time', async () => {
    const { api, onSaved } = await renderStep();
    const request = api.request.bind(api);
    let posts = 0;
    const spy = vi.spyOn(api, 'request').mockImplementation((method, path, body) => {
      if (method === 'POST' && ++posts === 2) return Promise.reject(new ApiError('server'));
      return request(method, path, body);
    });
    fireEvent.click(chip('Backend engineer'));
    fireEvent.click(chip('Platform engineer'));
    continueOn();
    await waitFor(() =>
      expect(alertText()).toContain('We couldn’t tell whether that saved. Try again in a moment.'),
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(await savedTitles(api)).toEqual(['Backend engineer']);
    spy.mockClear();
    continueOn();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(spy.mock.calls.filter(([method]) => method === 'POST')).toEqual([
      ['POST', '/me/roles', { title: 'Platform engineer' }],
    ]);
  });

  it('does not take its own earlier save for a change made elsewhere', async () => {
    const { api, onSaved } = await renderStep();
    const request = api.request.bind(api);
    let posts = 0;
    vi.spyOn(api, 'request').mockImplementation((method, path, body) => {
      if (method === 'POST' && ++posts === 2) return Promise.reject(new ApiError('server'));
      return request(method, path, body);
    });
    fireEvent.click(chip('Backend engineer'));
    fireEvent.click(chip('Platform engineer'));
    continueOn();
    await waitFor(() => expect(alertText()).toContain('Try again in a moment.'));
    // The saved one dropped after all: it is removed, not brought back as another device's.
    fireEvent.click(chip('Backend engineer'));
    continueOn();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(await savedTitles(api)).toEqual(['Platform engineer']);
  });

  it('says it cannot tell when the answer was lost', async () => {
    const { api, onSaved } = await renderStep();
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation((method, path, body) =>
      method === 'POST' ? Promise.reject(new ApiError('unsure')) : request(method, path, body),
    );
    fireEvent.click(chip('Backend engineer'));
    continueOn();
    await waitFor(() =>
      expect(alertText()).toContain(
        'We couldn’t tell whether that saved. Check your connection, then try again.',
      ),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('shows roles added elsewhere meanwhile, chosen, before saving over them', async () => {
    const { api, onSaved } = await renderStep(['Data engineer']);
    // Another device adds one after this step opened (read when Continue is pressed).
    await api.request('POST', '/me/roles', { title: 'Mobile engineer' });
    fireEvent.click(chip('Backend engineer'));
    const request = vi.spyOn(api, 'request');
    continueOn();
    await waitFor(() => expect(alertText()).toContain('Your roles changed somewhere else.'));
    expect(chip('Mobile engineer').checked).toBe(true);
    expect(request.mock.calls.map(([method]) => method)).toEqual(['GET']);
    continueOn();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(await savedTitles(api)).toEqual([
      'Data engineer',
      'Mobile engineer',
      'Backend engineer',
    ]);
  });

  it('takes in roles removed and added elsewhere, then asks for room', async () => {
    const { api, onSaved } = await renderStep(['Data engineer', 'Mobile engineer']);
    // Another device removes one, and adds nine.
    const [, mobile] = (await api.request<{ roles: Role[] }>('GET', '/me/roles')).roles;
    await api.request('DELETE', `/me/roles/${mobile?.roleId}`);
    for (let n = 1; n <= 9; n += 1) await api.request('POST', '/me/roles', { title: `Role ${n}` });
    fireEvent.click(chip('Backend engineer'));
    continueOn();
    await waitFor(() =>
      expect(alertText()).toContain(
        'Your roles changed somewhere else. They show here now: check them, then continue.',
      ),
    );
    expect(chip('Mobile engineer').checked).toBe(false);
    expect(chip('Role 9').checked).toBe(true);
    expect(chip('Backend engineer').checked).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    // Eleven now: said at once, one must go before saving.
    expect(
      // The visible line (the status line may say it too, once its beat has run).
      screen.getByText('Up to 10 roles fit, and 11 are chosen. Remove 1 to continue.', {
        ignore: '[role=status]',
      }),
    ).toBeTruthy();
    fireEvent.click(chip('Role 9'));
    expect(screen.queryByText(/Up to 10 roles fit/)).toBeNull();
    continueOn();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(await savedTitles(api)).toHaveLength(10);
    expect(await savedTitles(api)).not.toContain('Role 9');
  });

  it('shows the roles that filled the list elsewhere when the API finds it full', async () => {
    const { api } = await renderStep();
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method !== 'POST') return request(method, path, body);
      await request('POST', '/me/roles', { title: 'Added elsewhere' });
      throw new ApiError('invalid', { status: 422 });
    });
    fireEvent.click(chip('Backend engineer'));
    continueOn();
    await waitFor(() => expect(alertText()).toContain('changed somewhere else'));
    expect(chip('Added elsewhere').checked).toBe(true);
    expect(chip('Backend engineer').checked).toBe(true);
  });

  it('says at once when roles taken in from elsewhere fill the list past the limit', async () => {
    const titles = Array.from({ length: 8 }, (_, n) => `Role ${n + 1}`);
    const { api } = await renderStep(titles);
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method !== 'POST') return request(method, path, body);
      await request('POST', '/me/roles', { title: 'Elsewhere 1' });
      await request('POST', '/me/roles', { title: 'Elsewhere 2' });
      throw new ApiError('invalid', { status: 422 });
    });
    fireEvent.click(chip('Backend engineer'));
    fireEvent.click(chip('Platform engineer'));
    continueOn();
    await waitFor(() => expect(alertText()).toContain('changed somewhere else'));
    expect(
      screen.getByText('Up to 10 roles fit, and 12 are chosen. Remove 2 to continue.'),
    ).toBeTruthy();
    await waitFor(() => expect(statusText()).toContain('Remove 2 to continue.'));
    // Typing one more: a reason about the list, under it once, not on the title field.
    type('Data engineer');
    fireEvent.keyDown(screen.getByLabelText('Job title'), { key: 'Enter' });
    expect(screen.getAllByText(/Up to 10 roles fit/)).toHaveLength(1);
    expect(screen.getByLabelText('Job title').getAttribute('aria-invalid')).not.toBe('true');
    // Checking one more refuses with the same reason (not 'remove one').
    fireEvent.click(chip('Product engineer'));
    expect(chip('Product engineer').checked).toBe(false);
    expect(screen.queryByText(/Remove one to add another/)).toBeNull();
    // Continue stops before sending anything, the reason still in place, and says it.
    const calls = vi.mocked(api.request).mock.calls.length;
    continueOn();
    await waitFor(() => expect(statusText()).toContain('Remove 2 to continue.'));
    expect(vi.mocked(api.request).mock.calls.length).toBe(calls);
    expect(
      screen.getByText('Up to 10 roles fit, and 12 are chosen. Remove 2 to continue.', {
        ignore: '[role=status]',
      }),
    ).toBeTruthy();
    // One removed, still too many: the reason stays, with what is left.
    fireEvent.click(chip('Elsewhere 1'));
    expect(
      // The visible line (the status line may say it too, once its beat has run).
      screen.getByText('Up to 10 roles fit, and 11 are chosen. Remove 1 to continue.', {
        ignore: '[role=status]',
      }),
    ).toBeTruthy();
    await waitFor(() => expect(statusText()).toContain('Remove 1 to continue.'));
    // Fitting again: the reason is gone, and no longer said.
    fireEvent.click(chip('Elsewhere 2'));
    expect(screen.queryByText(/Up to 10 roles fit/)).toBeNull();
    expect(statusText()).toBe('');
  });

  it('says the session ended when the read after a full list finds it so', async () => {
    const { api } = await renderStep();
    const request = api.request.bind(api);
    let reads = 0;
    vi.spyOn(api, 'request').mockImplementation((method, path, body) => {
      if (method === 'POST') return Promise.reject(new ApiError('invalid', { status: 422 }));
      // The read before saving works; the one after the refusal finds the session ended.
      reads += 1;
      if (reads > 1) return Promise.reject(new ApiError('signed-out', { status: 401 }));
      return request(method, path, body);
    });
    fireEvent.click(chip('Backend engineer'));
    continueOn();
    await waitFor(() =>
      expect(alertText()).toContain('Your session has ended. Sign in again to continue.'),
    );
  });

  it('won’t move on, unchanged, while more are saved than fit', async () => {
    const api = createFakeApi({ delay: 0 });
    for (let n = 1; n <= 10; n += 1) await api.request('POST', '/me/roles', { title: `Role ${n}` });
    const request = api.request.bind(api);
    // An eleventh, saved past the limit elsewhere (a race the API lost).
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      const answer = await request(method, path, body);
      if (method !== 'GET') return answer;
      const { roles } = answer as { roles: Role[] };
      return { roles: [...roles, { ...roles[0], roleId: 'extra', title: 'Role 11' }] };
    });
    const { onSaved } = await renderStep([], api);
    continueOn();
    await waitFor(() => expect(statusText()).toContain('Remove 1 to continue.'));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('stops saying the list is full once there is room again', async () => {
    const titles = Array.from({ length: 10 }, (_, n) => `Role ${n + 1}`);
    await renderStep(titles);
    fireEvent.click(chip('Backend engineer'));
    await waitFor(() => expect(statusText()).toContain('Remove one to add another.'));
    fireEvent.click(chip('Role 1'));
    expect(statusText()).toBe('');
    expect(screen.queryByText(/Remove one to add another/)).toBeNull();
  });

  it('stops saying a full list, given beside the title, once a chip makes room', async () => {
    const titles = Array.from({ length: 10 }, (_, n) => `Role ${n + 1}`);
    await renderStep(titles);
    type('Data engineer');
    fireEvent.keyDown(screen.getByLabelText('Job title'), { key: 'Enter' });
    await waitFor(() => expect(statusText()).toContain('Remove one to add another.'));
    fireEvent.click(chip('Role 1'));
    expect(statusText()).toBe('');
    expect(screen.queryByText(/Remove one to add another/)).toBeNull();
  });

  it('gives a full list’s reason once, wherever it was last asked', async () => {
    const titles = Array.from({ length: 10 }, (_, n) => `Role ${n + 1}`);
    await renderStep(titles);
    fireEvent.click(chip('Backend engineer'));
    add('Data engineer');
    expect(
      screen.getAllByText('You can add up to 10 roles. Remove one to add another.', {
        ignore: '[role=status]',
      }),
    ).toHaveLength(1);
  });

  it('asks to try again when the API finds the list full but it fits', async () => {
    const { api } = await renderStep();
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation((method, path, body) =>
      method === 'POST'
        ? Promise.reject(new ApiError('invalid', { status: 422 }))
        : request(method, path, body),
    );
    fireEvent.click(chip('Backend engineer'));
    continueOn();
    // One role fits: nothing to remove, only to try again.
    await waitFor(() => expect(alertText()).toContain('Try again in a moment.'));
    expect(screen.queryByText(/Remove one to add another/)).toBeNull();
  });

  it('says how long to wait, or that the session ended', async () => {
    const { api } = await renderStep();
    const spy = vi
      .spyOn(api, 'request')
      .mockRejectedValue(new ApiError('too-many', { status: 429, retryAfterSeconds: 30 }));
    fireEvent.click(chip('Backend engineer'));
    continueOn();
    await waitFor(() =>
      expect(alertText()).toContain('Too many saves for now. Try again in 30 seconds.'),
    );
    spy.mockRejectedValue(new ApiError('signed-out', { status: 401 }));
    continueOn();
    await waitFor(() =>
      expect(alertText()).toContain('Your session has ended. Sign in again to continue.'),
    );
  });

  it('locks the list while saving', async () => {
    const { api } = await renderStep();
    let answer: () => void = () => {};
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation((method, path, body) =>
      method === 'POST'
        ? new Promise((resolve) => {
            answer = () =>
              resolve({ roleId: 'x'.repeat(26), title: 'Backend engineer', version: 1 } as never);
          })
        : request(method, path, body),
    );
    fireEvent.click(chip('Backend engineer'));
    continueOn();
    expect((screen.getByLabelText('Job title') as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(chip('Platform engineer'));
    expect(chip('Platform engineer').checked).toBe(false);
    await act(async () => answer());
  });

  it('touches nothing once the step is gone (signed out mid-save)', async () => {
    const { api, queries, view } = await renderStep();
    let answer: () => void = () => {};
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation((method, path, body) =>
      method === 'POST'
        ? new Promise((resolve) => {
            answer = () =>
              resolve({ roleId: 'x'.repeat(26), title: 'Backend engineer', version: 1 } as never);
          })
        : request(method, path, body),
    );
    fireEvent.click(chip('Backend engineer'));
    continueOn();
    // Sent (after the read): the step goes while its answer is on its way.
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith('POST', '/me/roles', expect.anything()),
    );
    view.unmount();
    queries.clear();
    await act(async () => answer());
    expect(queries.getQueryData(['roles'])).toBeUndefined();
  });

  it('says when the roles could not be read, and tries again', async () => {
    const api = createFakeApi({ delay: 0 });
    const request = api.request.bind(api);
    const spy = vi.spyOn(api, 'request').mockRejectedValueOnce(new ApiError('server'));
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queries}>
        <ApiContext.Provider value={api}>
          <StepRoles onSaved={() => {}} onBack={() => {}} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    expect(
      (await screen.findByRole('alert')).textContent?.startsWith('Your roles didn’t load.'),
    ).toBe(true);
    spy.mockImplementation(request);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Job title')).toBeTruthy();
  });

  it('says the session ended (no Try again) when that is why the roles could not be read', async () => {
    const api = createFakeApi({ delay: 0 });
    vi.spyOn(api, 'request').mockRejectedValue(new ApiError('signed-out', { status: 401 }));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ApiContext.Provider value={api}>
          <StepRoles onSaved={() => {}} onBack={() => {}} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Your session has ended. Sign in again to continue.',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('plan', () => {
  const role = (title: string, roleId = title) => ({ roleId, title, version: 1 });
  it('removes the roles no longer chosen and adds the new titles, case aside', () => {
    expect(plan([role('A'), role('b')], ['B', 'c'])).toEqual({ remove: [role('A')], add: ['c'] });
    expect(plan([], [])).toEqual({ remove: [], add: [] });
  });
});

describe('reconcile', () => {
  it('sees nothing changed elsewhere when the saved roles are what this step made', () => {
    // Saved as chosen; nothing saved yet; or part-way (a lost answer that went through).
    expect(reconcile(['A'], ['A', 'B'], ['A', 'B'])).toEqual({
      titles: ['A', 'B'],
      changed: false,
    });
    expect(reconcile(['A'], ['B'], ['A'])).toEqual({ titles: ['B'], changed: false });
    expect(reconcile(['A'], ['B'], ['B'])).toEqual({ titles: ['B'], changed: false });
  });

  it('takes in roles added or removed elsewhere, keeping the person’s choices', () => {
    expect(reconcile(['A'], ['A', 'B'], ['A', 'C'])).toEqual({
      titles: ['A', 'B', 'C'],
      changed: true,
    });
    expect(reconcile(['A', 'B'], ['A', 'B', 'D'], ['b'])).toEqual({
      titles: ['B', 'D'],
      changed: true,
    });
    // A role removed here and elsewhere is no change.
    expect(reconcile(['A', 'B'], ['B'], ['B'])).toEqual({ titles: ['B'], changed: false });
  });
});
