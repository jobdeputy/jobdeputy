import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppNav } from '../src/components/app-shell.tsx';
import { normUrl } from '../src/components/profile/fields.ts';
import { ProfilePage } from '../src/components/profile/profile-page.tsx';
import { ApiError } from '../src/lib/api/client.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { ApiContext } from '../src/lib/api/index.ts';
import type { Profile } from '../src/lib/api/profile.ts';
import { createFakeAuth } from '../src/lib/auth/fake.ts';
import { navigate } from '../src/lib/router.ts';
import { renderApp } from './render-app.tsx';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

const saved: Profile = {
  version: 3,
  email: 'alex@example.com',
  firstName: 'Alex',
  lastName: 'Morgan',
  headline: 'Staff engineer',
  phone: { countryCode: '+1', number: '5125550100' },
  location: { city: 'Austin', country: 'US' },
  links: { linkedin: 'https://www.linkedin.com/in/alex', other: [] },
};

/** The facts of one group (under its heading), as "label: value" lines. */
function facts(group: string): string[] {
  const list = groupOf(group).querySelector('dl');
  if (!list) throw new Error(`No facts under ${group}`);
  return Array.from(list.querySelectorAll('dt')).map((dt) => {
    const value = dt.nextElementSibling as HTMLElement;
    // A list of values (other links) reads one per line.
    const lines = Array.from(value.children).map((line) => line.textContent);
    return `${dt.textContent}: ${lines.length ? lines.join(' | ') : value.textContent}`;
  });
}

/** A group on the page: its heading's head row's parent. */
function groupOf(group: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 3, name: group });
  return heading.parentElement?.parentElement as HTMLElement;
}

describe('ProfilePage', () => {
  it('shows what is saved in the prototype’s groups, and Not added for the rest', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApiContext.Provider value={createFakeApi({ delay: 0 })}>
          <ProfilePage profile={saved} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    const title = screen.getByRole('heading', {
      level: 1,
      name: 'What your deputy knows about you.',
    });
    expect(document.activeElement).toBe(title);
    expect(facts('Name and headline')).toEqual([
      'First name: Alex',
      'Last name: Morgan',
      'Preferred name: Not added',
      'Headline: Staff engineer',
    ]);
    expect(facts('Contact and location')).toEqual([
      'Email: alex@example.com',
      'Phone: +1 5125550100',
      'City: Austin',
      'Country: United States',
    ]);
    expect(facts('Links')).toEqual([
      'LinkedIn: https://www.linkedin.com/in/alex',
      'GitHub: Not added',
      'Portfolio: Not added',
      'Website: Not added',
      'Other links: Not added',
    ]);
  });
});

describe('AppNav', () => {
  it('marks the current page, and goes to a page without reloading', () => {
    window.history.replaceState(null, '', '/elsewhere');
    render(<AppNav path="/profile" />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const link = within(nav).getByRole('link', { name: 'Profile' });
    expect(link.getAttribute('aria-current')).toBe('page');
    fireEvent.click(link);
    expect(window.location.pathname).toBe('/profile');
  });

  it('leaves a click with a modifier (a new tab) to the browser', () => {
    window.history.replaceState(null, '', '/elsewhere');
    render(<AppNav path="/elsewhere" />);
    const link = screen.getByRole('link', { name: 'Profile' });
    expect(link.getAttribute('aria-current')).toBeNull();
    const event = fireEvent.click(link, { metaKey: true });
    // Not handled here (its default is not prevented): the browser opens it.
    expect(event).toBe(true);
  });
});

describe('the landing page’s address', () => {
  it('is / when a signed-in page’s address is opened while signed out', async () => {
    window.history.replaceState(null, '', '/profile');
    await renderApp(createFakeAuth({ delay: 0 }));
    expect(window.location.pathname).toBe('/');
  });
});

describe('the signed-in app’s pages', () => {
  it('opens Job matches at /jobs once the set-up is done, whatever the path was (#49)', async () => {
    const auth = createFakeAuth({ delay: 0 });
    await auth.signUp('new@example.com', 'a long enough password');
    await auth.confirmSignUp('new@example.com', 'a long enough password', '123456');
    const api = createFakeApi({ delay: 0 });
    await api.request('PUT', '/me/profile', { version: 0, firstName: 'Alex', lastName: 'Morgan' });
    window.history.replaceState(null, '', '/somewhere-old');
    // The landing page's title (index.html).
    document.title = 'JobDeputy';
    await renderApp(auth, {}, api);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'The best jobs at each company.' }),
    ).toBeTruthy();
    expect(window.location.pathname).toBe('/jobs');
    expect(document.title).toBe('Job matches · JobDeputy');
    // The page list is a landmark of its own, beside the page's main content, not inside it.
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(screen.getByRole('main').contains(nav)).toBe(false);
    // Later (Back to an entry from before), the address is left alone: Job matches still shows.
    act(() => navigate('/nowhere'));
    expect(window.location.pathname).toBe('/nowhere');
    expect(
      screen.getByRole('heading', { level: 1, name: 'The best jobs at each company.' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Job matches' }).getAttribute('aria-current')).toBe(
      'page',
    );
    // Signing out goes back to the landing page's address, and its title.
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { level: 1, name: 'You set it up. Your deputy applies.' });
    expect(window.location.pathname).toBe('/');
    expect(document.title).toBe('JobDeputy');
  });
});

describe('editing About you', () => {
  let queries: QueryClient;
  /** The app on the Profile page, for a person with `profile` saved; returns the fake API. */
  async function onProfile(profile: Record<string, unknown> = {}) {
    const auth = createFakeAuth({ delay: 0 });
    await auth.signUp('alex@example.com', 'a long enough password');
    await auth.confirmSignUp('alex@example.com', 'a long enough password', '123456');
    const api = createFakeApi({ delay: 0 });
    await api.request('PUT', '/me/profile', {
      version: 0,
      firstName: 'Alex',
      lastName: 'Morgan',
      ...profile,
    });
    window.history.replaceState(null, '', '/profile');
    ({ queries } = await renderApp(auth, {}, api));
    await screen.findByRole('heading', { level: 1, name: 'What your deputy knows about you.' });
    return api;
  }

  const saved = (api: ReturnType<typeof createFakeApi>) =>
    api.request<Profile>('GET', '/me/profile');

  function type(label: string, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }

  it('opens a group’s form at its first field, saves it, and goes back to the facts', async () => {
    const api = await onProfile({
      phone: { countryCode: '+1', number: '5125550100' },
      links: { github: 'https://github.com/alex', other: [] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name and headline' }));
    const form = screen.getByRole('form', { name: 'Name and headline' });
    expect(document.activeElement).toBe(within(form).getByLabelText('First name'));
    type('Preferred name', ' Al ');
    type('Headline', 'Staff engineer');
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(facts('Name and headline')).toContain('Preferred name: Al'));
    expect(facts('Name and headline')).toContain('Headline: Staff engineer');
    // Back on Edit, marked Saved, and said.
    const edit = screen.getByRole('button', { name: 'Edit Name and headline' });
    expect(document.activeElement).toBe(edit);
    expect(within(groupOf('Name and headline')).getByText('Saved')).toBeTruthy();
    expect(await screen.findByText('Name and headline saved.')).toBeTruthy();
    // The rest of the profile went along unchanged.
    const now = await saved(api);
    expect(now).toMatchObject({
      preferredName: 'Al',
      headline: 'Staff engineer',
      phone: { countryCode: '+1', number: '5125550100' },
      links: { github: 'https://github.com/alex' },
    });
  });

  it('drops what was typed on Cancel, and leaves an emptied optional field out', async () => {
    const api = await onProfile({ preferredName: 'Al' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name and headline' }));
    type('First name', 'Sam');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Edit Name and headline' }),
    );
    expect(facts('Name and headline')).toContain('First name: Alex');
    expect(within(groupOf('Name and headline')).queryByText('Saved')).toBeNull();
    // Opened again, it starts from what is saved.
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name and headline' }));
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Alex');
    type('Preferred name', '  ');
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(facts('Name and headline')).toContain('Preferred name: Not added'));
    expect('preferredName' in (await saved(api))).toBe(false);
  });

  it('says what is missing or wrong beside the field, and focuses it', async () => {
    await onProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name and headline' }));
    type('Last name', '');
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    const last = screen.getByLabelText('Last name');
    expect(document.activeElement).toBe(last);
    expect(last.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Enter your last name.')).toBeTruthy();
  });

  it('saves a phone with +1 when no code is typed, and removes it when the number is cleared', async () => {
    const api = await onProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Contact and location' }));
    // The sign-in email and the country show, locked.
    const form = screen.getByRole('form', { name: 'Contact and location' });
    expect(within(form).getByText(String((await saved(api)).email))).toBeTruthy();
    expect(within(form).getAllByText('Locked')).toHaveLength(2);
    type('Country code', '');
    type('Phone number', '512 555 0100');
    type('City', 'Austin');
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(facts('Contact and location')).toContain('Phone: +1 512 555 0100'));
    expect(await saved(api)).toMatchObject({
      phone: { countryCode: '+1', number: '512 555 0100' },
      location: { city: 'Austin', country: 'US' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Contact and location' }));
    type('Phone number', '');
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(facts('Contact and location')).toContain('Phone: Not added'));
    expect('phone' in (await saved(api))).toBe(false);
  });

  it('refuses a wrong calling code beside it, and asks for the number a code needs', async () => {
    await onProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Contact and location' }));
    type('Country code', '++44');
    type('Phone number', '20 7946 0000');
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Country code'));
    expect(screen.getByText('Use a code like +1, +44, or +91.')).toBeTruthy();
    // A code other than +1 with no number is not dropped unseen.
    type('Country code', '+44');
    type('Phone number', '');
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Phone number'));
    expect(screen.getByText('Enter the number, or clear the country code.')).toBeTruthy();
  });

  it('reads a calling code typed without its + as meant', async () => {
    const api = await onProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Contact and location' }));
    type('Country code', ' 44');
    type('Phone number', '20 7946 0000');
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(facts('Contact and location')).toContain('Phone: +44 20 7946 0000'));
    expect((await saved(api)).phone).toEqual({ countryCode: '+44', number: '20 7946 0000' });
  });

  it('shows what another tab saved, rather than overwriting it, when a refresh came meanwhile', async () => {
    const api = await onProfile({ headline: 'Engineer' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name and headline' }));
    type('Preferred name', 'Al');
    // Another tab saves a new headline; this one refreshes (the window regained focus, say).
    const other = await saved(api);
    await api.request('PUT', '/me/profile', {
      version: other.version,
      firstName: 'Alex',
      lastName: 'Morgan',
      headline: 'Staff engineer',
    });
    await act(() => queries.invalidateQueries({ queryKey: ['profile'] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        'Your profile changed somewhere else. It shows here now: check it, then save.',
      ),
    ).toBeTruthy();
    expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe('Staff engineer');
    // What was typed in a field nobody else changed stays.
    expect((screen.getByLabelText('Preferred name') as HTMLInputElement).value).toBe('Al');
    expect((await saved(api)).headline).toBe('Staff engineer');
    // Saved again, it keeps both.
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(facts('Name and headline')).toContain('Preferred name: Al'));
    expect(await saved(api)).toMatchObject({ preferredName: 'Al', headline: 'Staff engineer' });
  });

  it('takes in a phone changed elsewhere whole, never half from each', async () => {
    const api = await onProfile({ phone: { countryCode: '+1', number: '555 0100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Contact and location' }));
    type('Country code', '+44');
    type('Phone number', '20 7946 0000');
    // Another tab changes only the number; this one refreshes.
    const other = await saved(api);
    await api.request('PUT', '/me/profile', {
      version: other.version,
      firstName: 'Alex',
      lastName: 'Morgan',
      phone: { countryCode: '+1', number: '555 0199' },
    });
    await act(() => queries.invalidateQueries({ queryKey: ['profile'] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await screen.findByText(/changed somewhere else/);
    expect((screen.getByLabelText('Country code') as HTMLInputElement).value).toBe('+1');
    expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('555 0199');
  });

  it('takes a lost save that a refresh shows went through as saved', async () => {
    const api = await onProfile();
    const request = api.request.bind(api);
    let lose = true;
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      const answer = await request(method, path, body);
      // The answer is lost, and so is the check after it; later, the connection is back.
      if (lose && method === 'PUT') throw new ApiError('unsure', {});
      if (lose && method === 'GET') {
        lose = false;
        throw new ApiError('offline', {});
      }
      return answer as never;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name and headline' }));
    type('Headline', 'Staff engineer');
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        'We couldn’t tell whether that saved. Check your connection, then try again.',
      ),
    ).toBeTruthy();
    await act(() => queries.invalidateQueries({ queryKey: ['profile'] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(facts('Name and headline')).toContain('Headline: Staff engineer'));
    expect(screen.queryByText(/changed somewhere else/)).toBeNull();
  });

  it('removes a saved phone from elsewhere when only its number is cleared', async () => {
    const api = await onProfile({ phone: { countryCode: '+44', number: '20 7946 0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Contact and location' }));
    expect((screen.getByLabelText('Country code') as HTMLInputElement).value).toBe('+44');
    type('Phone number', '');
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(facts('Contact and location')).toContain('Phone: Not added'));
    expect('phone' in (await saved(api))).toBe(false);
  });

  it('knows a save whose answer was lost went through, the phone saved with its +1', async () => {
    const api = await onProfile();
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      const answer = await request(method, path, body);
      if (method === 'PUT') throw new ApiError('unsure', {});
      return answer as never;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Contact and location' }));
    type('Country code', '');
    type('Phone number', '512 555 0100');
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(facts('Contact and location')).toContain('Phone: +1 512 555 0100'));
    expect(screen.queryByText(/changed somewhere else/)).toBeNull();
  });

  it('adds https:// to an address typed without it, and keeps other links one per line', async () => {
    const api = await onProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Links' }));
    type('LinkedIn', 'linkedin.com/in/alex');
    type('Other links', 'alex.dev\n\n https://blog.alex.dev ');
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(facts('Links')).toContain('LinkedIn: https://linkedin.com/in/alex'));
    expect(facts('Links')).toContain('Other links: https://alex.dev | https://blog.alex.dev');
    expect((await saved(api)).links).toEqual({
      linkedin: 'https://linkedin.com/in/alex',
      other: ['https://alex.dev', 'https://blog.alex.dev'],
    });
  });

  it('refuses an http:// address, and more other links than fit', async () => {
    await onProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Links' }));
    type('GitHub', 'http://github.com/alex');
    type('Other links', Array.from({ length: 11 }, (_, i) => `site${i}.dev`).join('\n'));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(document.activeElement).toBe(screen.getByLabelText('GitHub'));
    expect(
      screen.getByText('Enter a web address, like linkedin.com/in/your-name (https only).'),
    ).toBeTruthy();
    expect(screen.getByText('Add at most 10 addresses.')).toBeTruthy();
  });
});

describe('normUrl', () => {
  it('adds https:// unless a scheme is typed, a host with a port included', () => {
    expect(normUrl(' example.com:8443/work ')).toBe('https://example.com:8443/work');
    expect(normUrl('localhost:3000')).toBe('https://localhost:3000');
    expect(normUrl('https://alex.dev')).toBe('https://alex.dev');
    expect(normUrl('http://alex.dev')).toBe('http://alex.dev');
    // A scheme mistyped is put right.
    expect(normUrl('https:/alex.dev')).toBe('https://alex.dev');
    expect(normUrl('HTTPS:alex.dev')).toBe('https://alex.dev');
    expect(normUrl('mailto:alex@example.com')).toBe('mailto:alex@example.com');
    expect(normUrl('  ')).toBe('');
  });
});

describe('Target roles on the Profile page', () => {
  async function onProfile(titles: readonly string[]) {
    const auth = createFakeAuth({ delay: 0 });
    await auth.signUp('alex@example.com', 'a long enough password');
    await auth.confirmSignUp('alex@example.com', 'a long enough password', '123456');
    const api = createFakeApi({ delay: 0 });
    await api.request('PUT', '/me/profile', { version: 0, firstName: 'Alex', lastName: 'Morgan' });
    for (const title of titles) await api.request('POST', '/me/roles', { title });
    window.history.replaceState(null, '', '/profile');
    await renderApp(auth, {}, api);
    await screen.findByRole('heading', { level: 1, name: 'What your deputy knows about you.' });
    return api;
  }

  const shownTitles = () =>
    within(screen.getByRole('list', { name: 'Target roles' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent);

  const savedTitles = async (api: ReturnType<typeof createFakeApi>) =>
    (await api.request<{ roles: { title: string }[] }>('GET', '/me/roles')).roles.map(
      (role) => role.title,
    );

  it('lists the saved titles under Job preferences, or says none are added', async () => {
    await onProfile(['Staff engineer', 'Platform engineer']);
    expect(screen.getByRole('region', { name: 'Job preferences' })).toBeTruthy();
    await waitFor(() => expect(shownTitles()).toEqual(['Staff engineer', 'Platform engineer']));
    cleanup();
    await onProfile([]);
    expect(
      await screen.findByText('None yet. Add the job titles your deputy should look for.'),
    ).toBeTruthy();
  });

  it('edits them with the set-up’s editor: Save adds and removes, then goes back', async () => {
    const api = await onProfile(['Staff engineer', 'Platform engineer']);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Target roles' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Job title'));
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Job title'), {
      target: { value: 'Engineering manager' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Platform engineer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(shownTitles()).toEqual(['Staff engineer', 'Engineering manager']));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit Target roles' }));
    expect(await screen.findByText('Target roles saved.')).toBeTruthy();
    expect(await savedTitles(api)).toEqual(['Staff engineer', 'Engineering manager']);
  });

  it('reads the roles again on Cancel after a save left in doubt, never claiming Saved', async () => {
    const api = await onProfile(['Role A', 'Role B', 'Role C']);
    const request = api.request.bind(api);
    let deletes = 0;
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      const answer = await request(method, path, body);
      // The second removal goes through, but its answer is a server error.
      if (method === 'DELETE' && ++deletes === 2) throw new ApiError('server', { status: 500 });
      return answer as never;
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Target roles' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Role A' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Role B' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await screen.findByText('We couldn’t tell whether that saved. Try again in a moment.');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(shownTitles()).toEqual(['Role C']));
    expect(within(groupOf('Target roles')).queryByText('Saved')).toBeNull();
  });

  it('drops the changes on Cancel', async () => {
    const api = await onProfile(['Staff engineer']);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Target roles' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Software engineer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit Target roles' }));
    expect(shownTitles()).toEqual(['Staff engineer']);
    expect(await savedTitles(api)).toEqual(['Staff engineer']);
    expect(within(groupOf('Target roles')).queryByText('Saved')).toBeNull();
  });
});
