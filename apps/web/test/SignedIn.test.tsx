import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignedIn } from '../src/components/auth/signed-in.tsx';
import { createFakeAuth } from '../src/lib/auth/fake.ts';
import { AuthContext, AuthError } from '../src/lib/auth/index.ts';

afterEach(cleanup);

function renderPage(signOut?: () => Promise<void>) {
  const auth = createFakeAuth({ delay: 0 });
  if (signOut) vi.spyOn(auth, 'signOut').mockImplementation(signOut);
  const onSignedOut = vi.fn();
  render(
    <AuthContext.Provider value={auth}>
      <SignedIn email="a@example.com" onSignedOut={onSignedOut} />
    </AuthContext.Provider>,
  );
  return { onSignedOut };
}

describe('SignedIn', () => {
  it('says who is signed in, and focuses its title once', () => {
    renderPage(() => new Promise(() => {}));
    const title = screen.getByRole('heading', { level: 1, name: 'You’re in.' });
    expect(document.activeElement).toBe(title);
    expect(
      screen.getByText('Signed in as a@example.com. Your search desk is on its way.'),
    ).toBeTruthy();
    // Pressing Sign out re-renders the page; the focus stays on the button.
    const button = screen.getByRole('button', { name: 'Sign out' });
    button.focus();
    fireEvent.click(button);
    expect(document.activeElement).toBe(button);
  });

  it('signs out', async () => {
    const { onSignedOut } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
  });

  it('stays signed in, and says why, when signing out fails', async () => {
    const { onSignedOut } = renderPage(async () => {
      throw new AuthError('offline');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Can’t reach JobDeputy. Check your connection and try again.',
      ),
    );
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});
