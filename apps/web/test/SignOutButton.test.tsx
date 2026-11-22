import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignOutButton } from '../src/components/auth/sign-out-button.tsx';
import { createFakeAuth } from '../src/lib/auth/fake.ts';
import { AuthContext, AuthError } from '../src/lib/auth/index.ts';

afterEach(cleanup);

function renderSignOut(signOut?: () => Promise<void>) {
  const auth = createFakeAuth({ delay: 0 });
  if (signOut) vi.spyOn(auth, 'signOut').mockImplementation(signOut);
  const onSignedOut = vi.fn();
  render(
    <AuthContext.Provider value={auth}>
      <SignOutButton onSignedOut={onSignedOut} />
    </AuthContext.Provider>,
  );
  return { onSignedOut };
}

describe('SignOutButton', () => {
  it('signs out, keeping focus while it works', async () => {
    const { onSignedOut } = renderSignOut();
    const button = screen.getByRole('button', { name: 'Sign out' });
    button.focus();
    fireEvent.click(button);
    expect(document.activeElement).toBe(button);
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
  });

  it('stays signed in, and says why, when signing out fails', async () => {
    const { onSignedOut } = renderSignOut(async () => {
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
