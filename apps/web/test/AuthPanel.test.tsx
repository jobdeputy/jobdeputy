import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthPanel } from '../src/components/auth/auth-panel.tsx';
import { Sheet, SheetContent } from '../src/components/ui/sheet.tsx';
import { createFakeAuth } from '../src/lib/auth/fake.ts';
import {
  type Auth,
  AuthContext,
  AuthError,
  type AuthErrorKind,
  type SignInMode,
} from '../src/lib/auth/index.ts';

afterEach(cleanup);

/** The panel inside an open drawer (its titles need the dialog), with a fake that only records. */
function renderPanel(start: SignInMode, auth?: Auth, failed?: AuthErrorKind) {
  const go = vi.fn();
  const used = auth ?? createFakeAuth({ delay: 0, go });
  render(
    <AuthContext.Provider value={used}>
      <Sheet open>
        <SheetContent>
          <AuthPanel start={start} {...(failed ? { failed } : {})} />
        </SheetContent>
      </Sheet>
    </AuthContext.Provider>,
  );
  return { go };
}

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
/** The alert region is always there (empty until needed): wait for its words. */
const expectAlert = (words: string) =>
  waitFor(() => expect(screen.getByRole('alert').textContent).toBe(words));

describe('AuthPanel', () => {
  it('leaves for the secure sign-in page, saying what happens there', async () => {
    const { go } = renderPanel('sign-in');
    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
    expect(screen.getByText(/secure sign-in page/)).toBeTruthy();
    expect(screen.getByText(/signs in the browser extension too/)).toBeTruthy();
    press('Continue to sign in');
    await waitFor(() => expect(go).toHaveBeenCalledWith('/auth/callback?code=fake&state=sign-in'));
  });

  it('leaves for the create-account form from the sign-up drawer', async () => {
    const { go } = renderPanel('sign-up');
    expect(screen.getByRole('heading', { name: 'Set up your search desk.' })).toBeTruthy();
    press('Continue to create account');
    await waitFor(() => expect(go).toHaveBeenCalledWith('/auth/callback?code=fake&state=sign-up'));
  });

  it('switches between signing in and creating an account', () => {
    renderPanel('sign-in');
    press('New here? Create an account');
    expect(screen.getByRole('heading', { name: 'Set up your search desk.' })).toBeTruthy();
    press('Have an account? Sign in');
    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
  });

  it('stays pending until the page has gone, and the links wait too', async () => {
    const signIn = vi.fn(() => new Promise<void>(() => {}));
    renderPanel('sign-in', { ...createFakeAuth({ delay: 0 }), signIn });
    press('Continue to sign in');
    press('Continue to sign in');
    expect(signIn).toHaveBeenCalledTimes(1);
    const link = screen.getByRole('button', { name: 'New here? Create an account' });
    expect(link.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(link);
    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
  });

  it('is ready again when the browser brings the page back from its cache', async () => {
    const signIn = vi.fn(() => new Promise<void>(() => {}));
    renderPanel('sign-in', { ...createFakeAuth({ delay: 0 }), signIn });
    press('Continue to sign in');
    press('Continue to sign in');
    expect(signIn).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });
    press('Continue to sign in');
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['offline', 'Can’t reach JobDeputy. Check your connection and try again.'],
    ['not-set-up', 'Sign-in isn’t available here yet.'],
  ] as const)('says why it could not leave (%s), and reads it out', async (kind, words) => {
    const signIn = vi.fn(async () => {
      throw new AuthError(kind);
    });
    renderPanel('sign-in', { ...createFakeAuth({ delay: 0 }), signIn });
    press('Continue to sign in');
    await expectAlert(words);
    expect(screen.getByRole('button', { name: 'Continue to sign in' })).toBeTruthy();
  });

  it('says a sign-in that came back unfinished did not finish, until the next try', async () => {
    const { go } = renderPanel('sign-in', undefined, 'sign-in-failed');
    await expectAlert('Sign-in didn’t finish. Try again.');
    press('Continue to sign in');
    await expectAlert('');
    await waitFor(() => expect(go).toHaveBeenCalled());
  });
});
