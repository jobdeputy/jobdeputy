import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthPanel } from '../src/components/auth/auth-panel.tsx';
import { Sheet, SheetContent } from '../src/components/ui/sheet.tsx';
import { createFakeAuth, FAKE_CODE } from '../src/lib/auth/fake.ts';
import { type Auth, AuthContext, AuthError } from '../src/lib/auth/index.ts';

afterEach(cleanup);
// A loaded runner can take over the default second for a whole flow; a passing test still ends
// as soon as its fact is true.
configure({ asyncUtilTimeout: 3000 });

/** The panel inside an open drawer (its titles need the dialog), with in-memory auth. */
function renderPanel(start: 'sign-in' | 'sign-up', auth: Auth = createFakeAuth({ delay: 0 })) {
  const onSignedIn = vi.fn();
  render(
    <AuthContext.Provider value={auth}>
      <Sheet open>
        <SheetContent>
          <AuthPanel start={start} onSignedIn={onSignedIn} />
        </SheetContent>
      </Sheet>
    </AuthContext.Provider>,
  );
  return { onSignedIn, auth };
}

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
/** The alert region is always there (empty until needed): wait for its words. */
const expectAlert = (words: string) =>
  waitFor(() => expect(screen.getByRole('alert').textContent).toBe(words));

describe('AuthPanel', () => {
  it('creates an account, confirms it with the emailed code, and signs the person in', async () => {
    const { onSignedIn } = renderPanel('sign-up');
    type('Email', 'new@example.com');
    type(/^Password/, 'a long enough password');
    submit('Create account');
    expect(await screen.findByRole('heading', { name: 'Enter your code.' })).toBeTruthy();
    expect(screen.getByText('We sent a 6-digit code to new@example.com.')).toBeTruthy();
    type('Code from your email', FAKE_CODE);
    submit('Confirm');
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith('new@example.com'));
  });

  it('checks the fields before calling the server, and focuses the first wrong one', async () => {
    const auth = createFakeAuth({ delay: 0 });
    const signUp = vi.spyOn(auth, 'signUp');
    renderPanel('sign-up', auth);
    type('Email', 'not-an-email');
    type(/^Password/, 'short');
    submit('Create account');
    const email = screen.getByLabelText('Email');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Enter an email like name@example.com.')).toBeTruthy();
    expect(screen.getByText('Use at least 12 characters.')).toBeTruthy();
    expect(document.activeElement).toBe(email);
    // The error is read with the field.
    expect(email.getAttribute('aria-describedby')).toContain(
      screen.getByText('Enter an email like name@example.com.').id,
    );
    expect(signUp).not.toHaveBeenCalled();
    // With the email right, the password is the first wrong field: it takes focus.
    type('Email', 'right@example.com');
    submit('Create account');
    expect(document.activeElement).toBe(screen.getByLabelText(/^Password/));
  });

  it('says an email already has an account, and reads it out', async () => {
    renderPanel('sign-up');
    type('Email', 'exists@example.com');
    type(/^Password/, 'a long enough password');
    submit('Create account');
    await expectAlert('An account already uses this email. Sign in instead.');
  });

  it('signs in, and refuses wrong details without saying which is wrong', async () => {
    const { onSignedIn } = renderPanel('sign-in');
    type('Email', 'exists@example.com');
    type(/^Password/, 'not the password');
    submit('Sign in');
    await expectAlert('That email and password don’t match an account.');
    type(/^Password/, 'correct horse battery');
    submit('Sign in');
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith('exists@example.com'));
  });

  it('sends an unconfirmed account to its code', async () => {
    const auth = createFakeAuth({ delay: 0 });
    await auth.signUp('later@example.com', 'a long enough password');
    renderPanel('sign-in', auth);
    type('Email', 'later@example.com');
    type(/^Password/, 'a long enough password');
    submit('Sign in');
    expect(await screen.findByRole('heading', { name: 'Enter your code.' })).toBeTruthy();
  });

  it('resets a forgotten password with a code, then asks to sign in with it', async () => {
    renderPanel('sign-in');
    type('Email', 'exists@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByRole('heading', { name: 'Forgot your password?' })).toBeTruthy();
    // The email typed so far comes along.
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('exists@example.com');
    submit('Send code');
    expect(await screen.findByRole('heading', { name: 'Set a new password.' })).toBeTruthy();
    type('Code from your email', FAKE_CODE);
    type(/^New password/, 'a brand new password');
    type('Confirm new password', 'a different password!');
    submit('Save password');
    expect(screen.getByText('The passwords don’t match.')).toBeTruthy();
    type('Confirm new password', 'a brand new password');
    submit('Save password');
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(
      'Your new password is ready. Sign in with it.',
    );
  });

  it('sends a new code on request, and says so', async () => {
    renderPanel('sign-up');
    type('Email', 'new@example.com');
    type(/^Password/, 'a long enough password');
    submit('Create account');
    await screen.findByRole('heading', { name: 'Enter your code.' });
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('A new code is on its way.'),
    );
  });

  it('turns any server refusal into plain words', async () => {
    const auth = createFakeAuth({ delay: 0 });
    vi.spyOn(auth, 'signIn').mockRejectedValue(new AuthError('offline'));
    renderPanel('sign-in', auth);
    type('Email', 'a@example.com');
    type(/^Password/, 'anything at all');
    submit('Sign in');
    await expectAlert('Can’t reach JobDeputy. Check your connection and try again.');
  });

  it('shows and hides a password', () => {
    renderPanel('sign-in');
    const password = screen.getByLabelText(/^Password/) as HTMLInputElement;
    expect(password.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password.type).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy();
  });

  it('sends someone whose code confirmed but who could not be signed in on to sign in', async () => {
    const auth = createFakeAuth({ delay: 0 });
    vi.spyOn(auth, 'confirmSignUp').mockRejectedValue(new AuthError('confirmed'));
    renderPanel('sign-up', auth);
    type('Email', 'new@example.com');
    type(/^Password/, 'a long enough password');
    submit('Create account');
    await screen.findByRole('heading', { name: 'Enter your code.' });
    type('Code from your email', FAKE_CODE);
    submit('Confirm');
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(
      'Your account is confirmed. Sign in to continue.',
    );
  });

  it('sends a fresh code when an unconfirmed account signs in', async () => {
    const auth = createFakeAuth({ delay: 0 });
    await auth.signUp('later@example.com', 'a long enough password');
    const resend = vi.spyOn(auth, 'resendSignUpCode');
    renderPanel('sign-in', auth);
    type('Email', 'later@example.com');
    type(/^Password/, 'a long enough password');
    submit('Sign in');
    await screen.findByRole('heading', { name: 'Enter your code.' });
    expect(resend).toHaveBeenCalledWith('later@example.com');
    // And there is a way back.
    expect(screen.getByRole('button', { name: 'Back to sign in' })).toBeTruthy();
  });

  it('keeps the step while a request runs, and says it is working', async () => {
    let finish = () => {};
    const auth = createFakeAuth({ delay: 0 });
    vi.spyOn(auth, 'signIn').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve('done');
        }),
    );
    renderPanel('sign-in', auth);
    type('Email', 'a@example.com');
    type(/^Password/, 'anything at all');
    submit('Sign in');
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
    // After the shared 300 ms, the wait is read out.
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Signing in…'));
    finish();
  });

  it('leaves a step’s message behind when moving to another step', async () => {
    renderPanel('sign-up');
    type('Email', 'new@example.com');
    type(/^Password/, 'a long enough password');
    submit('Create account');
    await screen.findByRole('heading', { name: 'Enter your code.' });
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('A new code is on its way.'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('still asks for the code when a fresh one cannot be sent, and says why', async () => {
    const auth = createFakeAuth({ delay: 0 });
    await auth.signUp('later@example.com', 'a long enough password');
    vi.spyOn(auth, 'resendSignUpCode').mockRejectedValue(new AuthError('too-many-tries'));
    renderPanel('sign-in', auth);
    type('Email', 'later@example.com');
    type(/^Password/, 'a long enough password');
    submit('Sign in');
    await screen.findByRole('heading', { name: 'Enter your code.' });
    await expectAlert('Too many tries. Wait a few minutes, then try again.');
    // No new code went out: the step says to use an earlier one.
    expect(
      screen.getByText(
        'Use the latest 6-digit code we sent to later@example.com, or send a new one.',
      ),
    ).toBeTruthy();
  });

  it('treats sending a new code as a request: the links wait for it', async () => {
    let finish = () => {};
    const auth = createFakeAuth({ delay: 0 });
    renderPanel('sign-up', auth);
    type('Email', 'new@example.com');
    type(/^Password/, 'a long enough password');
    submit('Create account');
    await screen.findByRole('heading', { name: 'Enter your code.' });
    vi.spyOn(auth, 'resendSignUpCode').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve();
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByRole('heading', { name: 'Enter your code.' })).toBeTruthy();
    // It says what it is doing, and the Confirm button does not claim to be checking.
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Sending a new code…'));
    // Shown, not only read out; the Confirm button waits too.
    expect(screen.getByRole('status').className).not.toContain('sr-only');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirm' }).getAttribute('aria-disabled')).toBe(
        'true',
      ),
    );
    finish();
  });
});
