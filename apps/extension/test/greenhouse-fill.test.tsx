import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { choose } from '../src/greenhouse/dom.ts';
import { fillForm, LEFT_MARK, markLeft, scan } from '../src/greenhouse/fill.ts';
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
    const fields = scan(savedForm()).map(({ key, label, kind, required }) => ({
      id: key,
      label,
      kind,
      required,
    }));
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

describe('fields only the person answers (#54 PR C round 1)', () => {
  it('lists required checkboxes, radio groups and dates left empty, and never touches them', async () => {
    document.body.innerHTML = `<form id="application-form">
      <div class="field-wrapper"><label for="first_name">First Name</label>
        <input id="first_name" type="text" aria-required="true"></div>
      <fieldset aria-required="true"><legend>Do you agree to the privacy notice?</legend>
        <label><input type="radio" name="consent" value="yes"> Yes</label>
        <label><input type="radio" name="consent" value="no"> No</label></fieldset>
      <div class="field-wrapper"><label><input type="checkbox" name="attest" required>
        I confirm this is true</label></div>
      <div class="field-wrapper"><label for="start">Start</label><input id="start" type="date"></div>
    </form>`;
    const form = document.getElementById('application-form') as HTMLElement;
    const report = await fillForm(form, fillData(), { waitMs: 20 });
    expect(report.filled).toEqual(['First Name']);
    expect(report.left).toEqual([
      { id: 'name:consent', label: 'Do you agree to the privacy notice?', required: true },
      { id: 'name:attest', label: 'I confirm this is true', required: true },
      { id: 'start', label: 'Start', required: false },
    ]);
    expect(form.querySelectorAll(`[${LEFT_MARK}]`)).toHaveLength(2);
    expect((form.querySelector('[name="attest"]') as HTMLInputElement).checked).toBe(false);
  });

  it('names a lone checkbox by its own label, and cleans an aria-label', async () => {
    document.body.innerHTML = `<form id="application-form">
      <fieldset><legend>Privacy</legend>
        <div class="field-wrapper"><label><input type="checkbox" name="gdpr" required>
          I consent to processing</label></div>
        <div class="field-wrapper"><label><input type="checkbox" name="retain" required>
          Keep my data for future roles</label></div></fieldset>
      <div class="field-wrapper"><input id="mobile" type="tel" aria-label="Mobile  *" aria-required="true"></div>
    </form>`;
    const form = document.getElementById('application-form') as HTMLElement;
    const report = await fillForm(form, fillData({ person: { links: {} } }), { waitMs: 20 });
    expect(report.left.map((field) => field.label)).toEqual([
      'I consent to processing',
      'Keep my data for future roles',
      'Mobile',
    ]);
  });

  it('counts a "select all that apply" group as one question, answered once any box is ticked', async () => {
    document.body.innerHTML = `<form id="application-form">
      <fieldset aria-required="true"><legend>Where could you work from?</legend>
        <label><input type="checkbox" name="offices" value="ny"> New York</label>
        <label><input type="checkbox" name="offices" value="remote"> Remote</label>
        <label><input type="checkbox" name="offices" value="london"> London</label></fieldset>
    </form>`;
    const form = document.getElementById('application-form') as HTMLElement;
    const empty = await fillForm(form, fillData(), { waitMs: 20 });
    expect(empty.left).toEqual([
      { id: 'name:offices', label: 'Where could you work from?', required: true },
    ]);
    (form.querySelector('[value="remote"]') as HTMLInputElement).checked = true;
    expect((await fillForm(form, fillData(), { waitMs: 20 })).left).toEqual([]);
  });

  it('keeps an outline while its field is still empty (a search typed, a box ticked and unticked)', async () => {
    document.body.innerHTML = `<form id="application-form"><div class="field-wrapper">
      <label for="why">Why Acme?</label><input id="why" type="text" aria-required="true"></div></form>`;
    const form = document.getElementById('application-form') as HTMLElement;
    markLeft(form, '#f36b3f');
    await fillForm(form, fillData(), { waitMs: 20 });
    const why = document.getElementById('why') as HTMLInputElement;
    why.dispatchEvent(new Event('input', { bubbles: true }));
    expect(form.querySelector('.field-wrapper')?.hasAttribute(LEFT_MARK)).toBe(true);
  });

  it('drops an outline once the person answers that field', async () => {
    document.body.innerHTML = `<form id="application-form"><div class="field-wrapper">
      <label for="why">Why Acme?</label><input id="why" type="text" aria-required="true"></div></form>`;
    const form = document.getElementById('application-form') as HTMLElement;
    markLeft(form, '#f36b3f');
    await fillForm(form, fillData(), { waitMs: 20 });
    const wrapper = form.querySelector('.field-wrapper') as HTMLElement;
    expect(wrapper.hasAttribute(LEFT_MARK)).toBe(true);
    const why = document.getElementById('why') as HTMLInputElement;
    why.value = 'Because';
    why.dispatchEvent(new Event('input', { bubbles: true }));
    // Checked once the page has drawn (a frame later).
    await waitFor(() => expect(wrapper.hasAttribute(LEFT_MARK)).toBe(false));
    expect(document.getElementById('jobdeputy-left-style')?.textContent).toContain('#f36b3f');
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
    // Several-answer questions are the person's: one empty is left, one answered is kept as is.
    expect(report.left).toEqual([
      { id: 'question_4', label: 'Have you previously worked at Acme?', required: true },
      { id: 'question_5', label: 'Why Acme?', required: true },
      // A rule would answer it (LinkedIn), but it takes several answers: never filled.
      {
        id: 'question_6',
        label: 'How did you hear about us? Choose all that apply.',
        required: true,
      },
    ]);
    expect(screen.getByText('Spanish')).toBeTruthy();
    expect(screen.queryByText('English')).toBeNull();
    // The React state took the typed values (the native setter), not only the DOM.
    expect((document.getElementById('first_name') as HTMLInputElement).value).toBe('Sam');

    // The person picks a choice left for them: its outline goes once the page has drawn it,
    // though a pick fires no input event.
    markLeft(form, '#f36b3f');
    const worked = document.getElementById('question_4') as HTMLInputElement;
    const outlined = () => worked.closest('.field-wrapper')?.hasAttribute(LEFT_MARK);
    expect(outlined()).toBe(true);
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    await choose(worked, (options) => options.indexOf('No'));
    globalThis.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    await waitFor(() => expect(outlined()).toBe(false));
  });
});
