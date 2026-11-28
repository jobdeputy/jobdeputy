import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Panel } from '../src/greenhouse/panel.tsx';
import { type Outcome, runFill } from '../src/greenhouse/run.ts';
import { fillData } from './greenhouse-data.ts';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const filled: Outcome = {
  ok: true,
  report: {
    filled: ['First Name', 'Last Name', 'Email'],
    left: [
      { id: 'question_4', label: 'Have you previously worked at Acme?', required: true },
      { id: 'cover_letter', label: 'Cover Letter', required: false },
    ],
  },
  resume: 'tailored',
  coverLetter: false,
  unread: ['voluntary'],
};

describe('the panel on a Greenhouse form (#54 PR C)', () => {
  it('fills on request, then says what it did and lists what is left, required first', async () => {
    const fillForm = vi.fn(async () => filled);
    const goTo = vi.fn();
    render(<Panel fillForm={fillForm} goTo={goTo} />);
    expect(screen.getByRole('heading', { name: 'JobDeputy' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fill this application' }));
    expect(await screen.findByText('Filled 3 fields.')).toBeTruthy();
    expect(screen.getByText('Attached your résumé tailored for this company.')).toBeTruthy();
    expect(screen.getByText(/Couldn’t read all your self-ID answers/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Left for you (1)' })).toBeTruthy();
    expect(screen.getByText('1 optional field is empty.')).toBeTruthy();
    expect(screen.getByText('Check every answer, then click Submit yourself.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Have you previously worked at Acme?' }));
    expect(goTo).toHaveBeenCalledWith('question_4');
    // Filling again is a quieter action once it has run.
    fireEvent.click(screen.getByRole('button', { name: 'Fill again' }));
    await waitFor(() => expect(fillForm).toHaveBeenCalledTimes(2));
  });

  it('says why it could not fill: signed out, offline, or failed', async () => {
    for (const [reason, words] of [
      ['signed-out', /Sign in from the JobDeputy button in your toolbar/],
      ['offline', /Check your connection/],
      ['failed', /Couldn’t get your answers/],
    ] as const) {
      render(<Panel fillForm={async () => ({ ok: false, reason })} goTo={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'Fill this application' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(words);
      cleanup();
    }
  });

  it('says when no résumé was attached, and hides to a small button', async () => {
    render(
      <Panel fillForm={async () => ({ ...filled, resume: null, unread: [] })} goTo={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fill this application' }));
    expect(await screen.findByText(/No résumé attached/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide JobDeputy' }));
    expect(screen.queryByRole('heading', { name: 'JobDeputy' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'JobDeputy' }));
    expect(screen.getByRole('heading', { name: 'JobDeputy' })).toBeTruthy();
  });
});

describe('runFill (#54 PR C)', () => {
  function form() {
    document.body.innerHTML = `<form id="application-form"><div class="field-wrapper">
      <label id="first_name-label" for="first_name">First Name</label>
      <input id="first_name" type="text" aria-required="true"></div></form>`;
    return document.getElementById('application-form') as HTMLElement;
  }

  it('fills from the worker’s answers and keeps only a summary, never the answers', async () => {
    const send = vi.fn(async () => ({ ok: true, body: fillData() }));
    const outcome = await runFill(form(), send);
    expect(send).toHaveBeenCalledWith({ type: 'fill-data' });
    expect(outcome).toEqual({
      ok: true,
      report: { filled: ['First Name'], left: [] },
      resume: 'tailored',
      coverLetter: false,
      unread: [],
    });
    // Nothing of the self-ID or other answers is kept in what the panel shows.
    const kept = JSON.stringify(outcome);
    for (const answer of ['asian', 'not_protected', 'sam@example.com', 'linkedin']) {
      expect(kept).not.toContain(answer);
    }
  });

  it('passes on why the worker could not answer, and fails safe when it says nothing', async () => {
    expect(await runFill(form(), async () => ({ ok: false, reason: 'signed-out' }))).toEqual({
      ok: false,
      reason: 'signed-out',
    });
    expect(await runFill(form(), async () => null)).toEqual({ ok: false, reason: 'failed' });
    expect(await runFill(form(), () => Promise.reject(new Error('gone')))).toEqual({
      ok: false,
      reason: 'failed',
    });
  });
});
