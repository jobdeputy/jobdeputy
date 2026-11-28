import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '../src/api.ts';
import type { Request, Status } from '../src/messages.ts';
import { Popup, type Send } from '../src/popup.tsx';
import type { Readiness } from '../src/readiness.ts';

afterEach(cleanup);

/** A service worker in memory: answers by request type; `status` may change between asks. */
function worker(answers: {
  status: Status | (() => Status);
  'sign-in'?: string | (() => string);
  'sign-in-wait'?: string | (() => string);
  readiness?: ApiResult<Readiness> | (() => ApiResult<Readiness>);
}) {
  const sent: Request[] = [];
  const send = vi.fn(async (request: Request) => {
    sent.push(request);
    const answer = answers[request.type as keyof typeof answers] ?? null;
    return typeof answer === 'function' ? answer() : answer;
  }) as unknown as Send;
  return { send, sent };
}

const signedOut: Status = { state: 'signed-out', signingIn: false };
const ready: ApiResult<Readiness> = {
  ok: true,
  body: {
    details: { answered: 6, total: 6, ready: true },
    resume: false,
    answers: { answered: 3, total: 10, ready: false },
  },
};

describe('Popup (#54)', () => {
  it('says what the extension is for, and its version', async () => {
    const { send } = worker({ status: signedOut });
    render(<Popup version="0.1.0" send={send} />);
    expect(screen.getByRole('heading', { level: 1, name: 'JobDeputy' })).toBeTruthy();
    expect(screen.getByText(/You review and click Submit/)).toBeTruthy();
    expect(screen.getByText('Version 0.1.0')).toBeTruthy();
    await screen.findByRole('button', { name: 'Sign in' });
  });

  it('says a build without sign-in settings cannot sign in', async () => {
    const { send } = worker({ status: { state: 'unconfigured' } });
    render(<Popup version="0.1.0" send={send} />);
    await screen.findByText(/built without its sign-in settings/);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('signs in through the service worker, and says why it did not finish', async () => {
    const { send, sent } = worker({ status: signedOut, 'sign-in': 'cancelled' });
    render(<Popup version="0.1.0" send={send} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Sign-in was closed before it finished.',
    );
    expect(sent).toContainEqual({ type: 'sign-in', different: false });
  });

  it('shows a sign-in at work, without a second button to start another', async () => {
    const { send } = worker({ status: { ...signedOut, signingIn: true, lastEmail: 'a@b.co' } });
    render(<Popup version="0.1.0" send={send} />);
    const button = (await screen.findByRole('button', {
      name: 'Signing in…',
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Finish signing in in the window that opened.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use a different account' })).toBeNull();
  });

  it('opened while a sign-in is at work, waits for it and shows who signed in', async () => {
    let status: Status = { ...signedOut, signingIn: true };
    const { send, sent } = worker({
      status: () => status,
      // The worker finishes the sign-in it was already doing.
      'sign-in-wait': () => {
        status = { state: 'signed-in', email: 'ada@example.com', signingIn: false };
        return 'signed-in';
      },
      readiness: ready,
    });
    render(<Popup version="0.1.0" send={send} />);
    await screen.findByText('Signed in as ada@example.com');
    // It waits for that sign-in; it never starts one (which could open a window).
    expect(sent).toContainEqual({ type: 'sign-in-wait' });
    expect(sent.some((r) => r.type === 'sign-in')).toBe(false);
  });

  it('says so when the extension itself fails, and never sticks on checking', async () => {
    const broken = vi.fn(async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    }) as unknown as Send;
    render(<Popup version="0.1.0" send={broken} />);
    await screen.findByText(/Something went wrong in the extension/);

    cleanup();
    const { send } = worker({ status: { state: 'signed-in', signingIn: false } });
    // The worker answers readiness with null (its handler failed).
    render(<Popup version="0.1.0" send={send} />);
    await screen.findByText('Couldn’t read your details.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('says a sign-in failed when the worker gives no answer', async () => {
    const { send } = worker({ status: signedOut });
    render(<Popup version="0.1.0" send={send} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    await screen.findByText('Sign-in didn’t work. Try again.');
  });

  it('says when a sign-in was interrupted (Chrome stopped the worker during it)', async () => {
    const { send } = worker({ status: { ...signedOut, interrupted: true } });
    render(<Popup version="0.1.0" send={send} />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Sign-in was interrupted before it finished. Sign in again.',
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('offers to continue as the person who signed out, or to use a different account', async () => {
    const { send, sent } = worker({
      status: { ...signedOut, lastEmail: 'ada@example.com' },
      'sign-in': 'offline',
    });
    render(<Popup version="0.1.0" send={send} />);
    await screen.findByRole('button', { name: 'Continue as ada@example.com' });
    fireEvent.click(screen.getByRole('button', { name: 'Use a different account' }));
    await screen.findByText(/Couldn’t reach the sign-in page/);
    expect(sent).toContainEqual({ type: 'sign-in', different: true });
  });

  it('says who is signed in and what the deputy can fill in, linking to what is missing', async () => {
    const { send } = worker({
      status: { state: 'signed-in', email: 'ada@example.com', signingIn: false },
      readiness: ready,
    });
    render(<Popup version="0.1.0" send={send} siteUrl="https://dev.jobdeputy.com" />);
    await screen.findByText('Signed in as ada@example.com');
    const list = await screen.findByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      '✓Your details: Ready, 6 of 6 saved6 of 6 saved',
      'A résumé to attach: Not added yetAdd in JobDeputy',
      'Application answers: Not added yet, 3 of 10 saved3 of 10 savedAdd in JobDeputy',
    ]);
    const links = within(list).getAllByRole('link', { name: 'Add in JobDeputy' });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://dev.jobdeputy.com/resumes',
      'https://dev.jobdeputy.com/profile',
    ]);
    for (const link of links) expect(link.getAttribute('target')).toBe('_blank');
  });

  it('ticks a section once its essentials are saved, and its count leads to the rest', async () => {
    const { send } = worker({
      status: { state: 'signed-in', signingIn: false },
      readiness: {
        ok: true,
        body: {
          details: { answered: 4, total: 6, ready: true },
          resume: true,
          answers: { answered: 7, total: 10, ready: true },
        },
      },
    });
    render(<Popup version="0.1.0" send={send} siteUrl="https://dev.jobdeputy.com" />);
    const answers = await screen.findByRole('link', {
      name: '7 of 10 saved: add the rest in JobDeputy',
    });
    expect(answers.getAttribute('href')).toBe('https://dev.jobdeputy.com/profile');
    expect(
      screen.getByRole('link', { name: '4 of 6 saved: add the rest in JobDeputy' }),
    ).toBeTruthy();
    // Screen readers hear that both are ready, with their counts.
    expect(screen.getByText('Ready, 7 of 10 saved')).toBeTruthy();
    // Nothing missing that every form asks: no "Add in JobDeputy".
    expect(screen.queryByRole('link', { name: 'Add in JobDeputy' })).toBeNull();
  });

  it('says what is missing without links when the build has no site', async () => {
    const { send } = worker({
      status: { state: 'signed-in', signingIn: false },
      readiness: ready,
    });
    render(<Popup version="0.1.0" send={send} />);
    await screen.findByText('Signed in');
    await screen.findByRole('list');
    expect(screen.queryByRole('link')).toBeNull();
    // The résumé says it's missing (shown, and said to screen readers with its label); the
    // counted ones say how many are saved.
    expect(screen.getAllByText('Not added yet')).toHaveLength(2);
    expect(screen.getByText('3 of 10 saved')).toBeTruthy();
  });

  it('says when the details could not be read, and reads them again on Try again', async () => {
    let result: ApiResult<Readiness> = { ok: false, reason: 'offline' };
    const { send, sent } = worker({
      status: { state: 'signed-in', signingIn: false },
      readiness: () => result,
    });
    render(<Popup version="0.1.0" send={send} />);
    await screen.findByText('Couldn’t reach JobDeputy. Check your connection.');
    result = ready;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('list');
    expect(sent.filter((r) => r.type === 'readiness')).toHaveLength(2);
  });

  it('goes back to sign-in when the API signed the person out', async () => {
    let status: Status = { state: 'signed-in', signingIn: false };
    const { send } = worker({
      status: () => status,
      readiness: () => {
        status = signedOut;
        return { ok: false, reason: 'signed-out' };
      },
    });
    render(<Popup version="0.1.0" send={send} />);
    await screen.findByRole('button', { name: 'Sign in' });
  });

  it('signs out', async () => {
    let status: Status = { state: 'signed-in', email: 'ada@example.com', signingIn: false };
    const { send, sent } = worker({
      status: () => status,
      readiness: ready,
    });
    render(<Popup version="0.1.0" send={send} />);
    const signOut = await screen.findByRole('button', { name: 'Sign out' });
    // What the worker says once signed out (status is only read again after the click).
    status = { ...signedOut, lastEmail: 'ada@example.com' };
    fireEvent.click(signOut);
    await waitFor(() => expect(sent).toContainEqual({ type: 'sign-out' }));
    await screen.findByRole('button', { name: 'Continue as ada@example.com' });
  });
});
