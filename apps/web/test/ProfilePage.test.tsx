import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppNav } from '../src/components/app-shell.tsx';
import { ProfilePage } from '../src/components/profile/profile-page.tsx';
import { createFakeApi } from '../src/lib/api/fake.ts';
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
  const heading = screen.getByRole('heading', { level: 3, name: group });
  const list = heading.nextElementSibling;
  if (list?.tagName !== 'DL') throw new Error(`No facts under ${group}`);
  return Array.from(list.querySelectorAll('dt')).map(
    (dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`,
  );
}

describe('ProfilePage', () => {
  it('shows what is saved in the prototype’s groups, and Not added for the rest', () => {
    render(<ProfilePage profile={saved} />);
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

describe('the signed-in app’s pages', () => {
  it('opens the Profile page at /profile once the set-up is done, whatever the path was', async () => {
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
      await screen.findByRole('heading', { level: 1, name: 'What your deputy knows about you.' }),
    ).toBeTruthy();
    expect(window.location.pathname).toBe('/profile');
    expect(document.title).toBe('Profile · JobDeputy');
    // The page list is a landmark of its own, beside the page's main content, not inside it.
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(screen.getByRole('main').contains(nav)).toBe(false);
    // Later (Back to an entry from before), the address is left alone: Profile still shows.
    act(() => navigate('/nowhere'));
    expect(window.location.pathname).toBe('/nowhere');
    expect(
      screen.getByRole('heading', { level: 1, name: 'What your deputy knows about you.' }),
    ).toBeTruthy();
    // Signing out goes back to the landing page's address, and its title.
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { level: 1, name: 'You set it up. Your deputy applies.' });
    expect(window.location.pathname).toBe('/');
    expect(document.title).toBe('JobDeputy');
  });
});
