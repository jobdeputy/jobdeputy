import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fillForm, LEFT_MARK, scan } from '../src/greenhouse/fill.ts';
import { fillData } from './greenhouse-data.ts';
import { GreenhouseForm } from './greenhouse-form.tsx';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const SAVED = readFileSync(join(import.meta.dirname, 'fixtures/greenhouse-form.html'), 'utf8');

describe('the real Greenhouse form, as served (#54 PR C)', () => {
  function savedForm(): HTMLFormElement {
    document.body.innerHTML = SAVED;
    return document.getElementById('application-form') as HTMLFormElement;
  }

  it('finds every field a person answers, with its label and whether it is required', () => {
    const fields = scan(savedForm()).map(({ question, required }) => ({ ...question, required }));
    expect(fields.slice(0, 8)).toEqual([
      { id: 'first_name', label: 'First Name', kind: 'text', required: true },
      { id: 'last_name', label: 'Last Name', kind: 'text', required: true },
      { id: 'email', label: 'Email', kind: 'text', required: true },
      { id: 'country', label: 'Country', kind: 'choice', required: false },
      { id: 'phone', label: 'Phone', kind: 'text', required: false },
      { id: 'resume', label: 'Resume/CV', kind: 'file', required: true },
      { id: 'cover_letter', label: 'Cover Letter', kind: 'file', required: false },
      { id: 'question_39226987002', label: 'LinkedIn Profile', kind: 'text', required: false },
    ]);
    const ids = fields.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['gender', 'hispanic_ethnicity', 'veteran_status']));
    // Greenhouse's hidden helpers for required choices are not questions.
    expect(fields.every((f) => f.id !== '' && f.label !== '')).toBe(true);
  });

  it('fills its text boxes and attaches the résumé, and outlines what it left', async () => {
    const form = savedForm();
    // Before the page's scripts run, its choices have no options: those are left, not guessed.
    const report = await fillForm(form, fillData(), { waitMs: 20 });
    expect(report.filled).toEqual([
      'First Name',
      'Last Name',
      'Email',
      'Phone',
      'Resume/CV',
      'LinkedIn Profile',
      "What's the name you'd prefer us to use throughout the interview process?",
    ]);
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('sam@example.com');
    const resume = document.getElementById('resume') as HTMLInputElement;
    expect(resume.files?.[0]?.name).toBe('Sam Example – Acme.pdf');
    expect(await resume.files?.[0]?.text()).toBe('%PDF-1.7 resume');
    const left = report.left.map((l) => l.id);
    expect(left).toEqual(expect.arrayContaining(['country', 'cover_letter', 'gender']));
    expect(left).not.toContain('email');
    const outlined = form.querySelectorAll(`[${LEFT_MARK}]`);
    expect(outlined.length).toBe(report.left.filter((field) => field.required).length);
    expect(outlined.length).toBeGreaterThan(0);
  });

  it('never changes what the person already typed', async () => {
    const form = savedForm();
    const email = document.getElementById('email') as HTMLInputElement;
    email.value = 'mine@example.com';
    const report = await fillForm(form, fillData(), { waitMs: 20 });
    expect(email.value).toBe('mine@example.com');
    expect(report.filled).not.toContain('Email');
  });
});

describe('a working form with Greenhouse’s choice widget (react-select)', () => {
  it('chooses answers, fills a question that appears after one, and leaves the rest', async () => {
    const onResume = vi.fn();
    render(<GreenhouseForm onResume={onResume} />);
    const form = document.getElementById('application-form') as HTMLFormElement;
    // As on the real page: React renders on its own schedule, not inside a test's act().
    const actEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    const report = await fillForm(form, fillData()).finally(() => {
      globalThis.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    });
    expect(report.filled).toEqual([
      'First Name',
      'Last Name',
      'Email',
      'Country',
      'Phone',
      'Resume/CV',
      'LinkedIn Profile',
      'Are you legally authorized to work in the United States?',
      'Will you now or in the future require sponsorship?',
      'Gender',
      'Are you Hispanic/Latino?',
      // Shown only once "No" was chosen just above: found on the next look.
      'Please identify your race',
    ]);
    expect(screen.getByText('United States +1')).toBeTruthy();
    expect(screen.getByText('Asian')).toBeTruthy();
    expect(onResume).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Sam Example – Acme.pdf' }),
    );
    expect(report.left).toEqual([
      { id: 'question_4', label: 'Have you previously worked at Acme?', required: true },
      { id: 'question_5', label: 'Why Acme?', required: true },
    ]);
    // The React state took the typed values (the native setter), not only the DOM.
    expect((document.getElementById('first_name') as HTMLInputElement).value).toBe('Sam');
  });
});
