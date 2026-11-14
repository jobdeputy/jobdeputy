import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';

afterEach(cleanup);

describe('App (landing page)', () => {
  it('states the promise in the page heading', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'You set it up. Your deputy applies.' }),
    ).toBeTruthy();
  });

  it('opens the sign-up drawer from either "Get started free" button', () => {
    render(<App />);
    for (const button of screen.getAllByRole('button', { name: 'Get started free' })) {
      fireEvent.click(button);
      expect(screen.getByRole('dialog', { name: 'Set up your search desk.' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  });

  it('opens the sign-in drawer from either "Sign in" button', () => {
    render(<App />);
    for (const button of screen.getAllByRole('button', { name: 'Sign in' })) {
      fireEvent.click(button);
      expect(screen.getByRole('dialog', { name: 'Welcome back.' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  });

  it('returns focus to the button that opened the drawer, even if the click did not focus it', async () => {
    render(<App />);
    // The hero's button, not the header's: Radix alone would not know which one opened it. No
    // focus() first: Safari and Firefox do not focus a button on click.
    const heroSignIn = screen.getAllByRole('button', { name: 'Sign in' }).at(-1);
    if (!heroSignIn) throw new Error('No "Sign in" button.');
    fireEvent.click(heroSignIn);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    // Radix moves focus after the dialog unmounts, on the next task.
    await waitFor(() => expect(document.activeElement).toBe(heroSignIn));
  });

  it('tells assistive technology which dialog the buttons open, and whether it is open', () => {
    render(<App />);
    const [headerSignIn] = screen.getAllByRole('button', { name: 'Sign in' });
    if (!headerSignIn) throw new Error('No "Sign in" button.');
    expect(headerSignIn.getAttribute('aria-haspopup')).toBe('dialog');
    expect(headerSignIn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(headerSignIn);
    const dialog = screen.getByRole('dialog', { name: 'Welcome back.' });
    expect(headerSignIn.getAttribute('aria-expanded')).toBe('true');
    expect(headerSignIn.getAttribute('aria-controls')).toBe(dialog.id);
  });
});
