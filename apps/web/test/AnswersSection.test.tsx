import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { createFakeAuth } from '../src/lib/auth/fake.ts';
import { renderApp } from './render-app.tsx';

// #53: the Profile page's Application answers, against the in-memory API (its schemas are the
// API's own, so a body the API would refuse is refused here too).

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

type Api = ReturnType<typeof createFakeApi>;

/** The app on the Profile page with a saved profile, and `answers` saved first if given. */
async function onProfile(answers?: Record<string, unknown>, voluntary?: Record<string, unknown>) {
  const auth = createFakeAuth({ delay: 0 });
  await auth.signUp('alex@example.com', 'a long enough password');
  await auth.confirmSignUp('alex@example.com', 'a long enough password', '123456');
  const api = createFakeApi({ delay: 0 });
  await api.request('PUT', '/me/profile', { version: 0, firstName: 'Alex', lastName: 'Morgan' });
  if (answers) await api.request('PUT', '/me/applicant', { version: 0, ...answers });
  if (voluntary) await api.request('PUT', '/me/voluntary', { version: 0, ...voluntary });
  window.history.replaceState(null, '', '/profile');
  await renderApp(auth, {}, api);
  await screen.findByRole('heading', { level: 2, name: 'Application answers' });
  return api;
}

function groupOf(group: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 3, name: group });
  return heading.parentElement?.parentElement as HTMLElement;
}

/** A group's facts as "label: value" lines, once they have loaded. */
async function facts(group: string): Promise<string[]> {
  const list = await waitFor(() => {
    const found = groupOf(group).querySelector('dl');
    if (!found) throw new Error(`No facts under ${group}`);
    return found;
  });
  return Array.from(list.querySelectorAll('dt')).map(
    (dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`,
  );
}

async function edit(group: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: `Edit ${group}` }));
  return screen.getByRole('form', { name: group });
}
const choose = (form: HTMLElement, label: string, value: string) =>
  fireEvent.change(within(form).getByLabelText(label), { target: { value } });
const save = (form: HTMLElement) =>
  fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
const applicant = (api: Api) => api.request<Record<string, unknown>>('GET', '/me/applicant');

describe('Application answers (#53)', () => {
  it('shows every group unanswered at first, and the voluntary answers as not shared', async () => {
    await onProfile();
    expect(await facts('Work authorization')).toEqual([
      'Allowed to work in the US: Not answered',
      'Needs visa sponsorship: Not answered',
    ]);
    expect(await facts('Pay')).toEqual(['Expected pay: Not answered']);
    const voluntary = groupOf('Voluntary self-identification');
    expect(
      await within(voluntary).findByText('Not shared: forms get “I don’t wish to answer”.'),
    ).toBeTruthy();
    expect(screen.getByText(/never answers these for you/)).toBeTruthy();
  });

  it('saves work authorization for the US, and goes back to the facts with Saved', async () => {
    const api = await onProfile();
    const form = await edit('Work authorization');
    expect(document.activeElement).toBe(
      within(form).getByLabelText('Can you legally work in the United States?'),
    );
    choose(form, 'Can you legally work in the United States?', 'yes');
    choose(form, 'Will you need visa sponsorship, now or in the future?', 'no');
    save(form);
    await waitFor(async () =>
      expect(await facts('Work authorization')).toEqual([
        'Allowed to work in the US: Yes',
        'Needs visa sponsorship: No',
      ]),
    );
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Edit Work authorization' }),
    );
    expect(await screen.findByText('Work authorization saved.')).toBeTruthy();
    expect((await applicant(api)).workAuthorization).toEqual([
      { country: 'US', authorized: true, needsSponsorship: false },
    ]);
  });

  it('asks for both work questions, or neither, beside the unanswered one', async () => {
    await onProfile();
    const form = await edit('Work authorization');
    choose(form, 'Can you legally work in the United States?', 'yes');
    save(form);
    const sponsorship = within(form).getByLabelText(
      'Will you need visa sponsorship, now or in the future?',
    );
    await waitFor(() => expect(document.activeElement).toBe(sponsorship));
    expect(sponsorship.getAttribute('aria-invalid')).toBe('true');
    expect(within(form).getByText('Answer both questions, or neither.')).toBeTruthy();
  });

  it('saves a pay range typed with $ and commas, and keeps the other answers unchanged', async () => {
    const api = await onProfile({ noticePeriodDays: 14, workSetups: ['remote'] });
    const form = await edit('Pay');
    choose(form, 'Expected pay, from (USD)', '$150,000');
    choose(form, 'Up to (USD)', '180,000');
    save(form);
    await waitFor(async () =>
      expect(await facts('Pay')).toEqual(['Expected pay: $150,000–$180,000 a year']),
    );
    expect(await applicant(api)).toMatchObject({
      expectedSalary: { min: 150000, max: 180000, currency: 'USD', period: 'year' },
      noticePeriodDays: 14,
      workSetups: ['remote'],
    });
  });

  it('refuses a range upside down beside its top, and a top without a bottom', async () => {
    await onProfile();
    const form = await edit('Pay');
    choose(form, 'Expected pay, from (USD)', '200000');
    choose(form, 'Up to (USD)', '100000');
    save(form);
    expect(
      await within(form).findByText('Use a whole number, at least where the range starts.'),
    ).toBeTruthy();
    choose(form, 'Expected pay, from (USD)', '');
    save(form);
    expect(
      await within(form).findByText('Enter where the range starts, or clear it.'),
    ).toBeTruthy();
  });

  it('clears the pay when both amounts are emptied', async () => {
    const api = await onProfile({
      expectedSalary: { min: 100000, currency: 'USD', period: 'year' },
    });
    const form = await edit('Pay');
    choose(form, 'Expected pay, from (USD)', '');
    save(form);
    await waitFor(async () => expect(await facts('Pay')).toEqual(['Expected pay: Not answered']));
    expect('expectedSalary' in (await applicant(api))).toBe(false);
  });

  it('saves notice and start date, and refuses a notice over a year', async () => {
    const api = await onProfile();
    const form = await edit('Availability');
    choose(form, 'Notice period, in days', '400');
    save(form);
    expect(await within(form).findByText('Use whole days, from 0 to 365.')).toBeTruthy();
    choose(form, 'Notice period, in days', '14');
    choose(form, 'Earliest start date', '2027-01-04');
    save(form);
    await waitFor(async () =>
      expect(await facts('Availability')).toEqual([
        'Notice period: 14 days',
        'Earliest start date: Jan 4, 2027',
      ]),
    );
    expect(await applicant(api)).toMatchObject({
      noticePeriodDays: 14,
      earliestStartDate: '2027-01-04',
    });
  });

  it('picks work setups as checkboxes, in their own order', async () => {
    const api = await onProfile();
    const form = await edit('Work setup');
    fireEvent.click(within(form).getByLabelText('On-site'));
    fireEvent.click(within(form).getByLabelText('Remote'));
    choose(form, 'Willing to relocate?', 'no');
    save(form);
    await waitFor(async () =>
      expect(await facts('Work setup')).toEqual([
        'Open to: Remote, On-site',
        'Willing to relocate: No',
      ]),
    );
    expect((await applicant(api)).workSetups).toEqual(['remote', 'onsite']);
  });

  it('saves the other questions, and an emptied choice is left out', async () => {
    const api = await onProfile({ securityClearance: 'secret' });
    const form = await edit('Other questions');
    choose(form, 'Are you 18 or older?', 'yes');
    choose(form, 'Security clearance', '');
    choose(form, 'Pronouns', 'they/them');
    choose(form, 'How did you hear about us?', 'company_website');
    save(form);
    await waitFor(async () =>
      expect(await facts('Other questions')).toEqual([
        '18 or older: Yes',
        'Security clearance: Not answered',
        'Pronouns: they/them',
        'How you heard about the job: Company website',
      ]),
    );
    const now = await applicant(api);
    expect(now).toMatchObject({
      over18: true,
      pronouns: 'they/them',
      heardAbout: 'company_website',
    });
    expect('securityClearance' in now).toBe(false);
  });

  it('opens the voluntary questions at “I don’t wish to answer”, and saves a choice', async () => {
    const api = await onProfile();
    const form = await edit('Voluntary self-identification');
    for (const label of [
      'Gender',
      'Are you Hispanic or Latino?',
      'Race',
      'Veteran status',
      'Disability',
    ]) {
      expect((within(form).getByLabelText(label) as HTMLSelectElement).value).toBe('decline');
    }
    choose(form, 'Race', 'asian');
    save(form);
    await waitFor(async () =>
      expect(await facts('Voluntary self-identification')).toEqual([
        'Gender: I don’t wish to answer',
        'Hispanic or Latino: I don’t wish to answer',
        'Race: Asian',
        'Veteran status: I don’t wish to answer',
        'Disability: I don’t wish to answer',
      ]),
    );
    expect(await api.request('GET', '/me/voluntary')).toMatchObject({ version: 1, race: 'asian' });
  });

  it('shows the saved answers another tab changed, rather than overwriting them', async () => {
    const api = await onProfile({ over18: true });
    const form = await edit('Other questions');
    // Saved elsewhere meanwhile: this form's version is out of date.
    await api.request('PUT', '/me/applicant', { version: 1, over18: false });
    choose(form, 'Pronouns', 'he/him');
    save(form);
    expect(
      await within(form).findByText(
        'Your answers changed somewhere else. They show here now: check them, then save.',
      ),
    ).toBeTruthy();
    expect((within(form).getByLabelText('Are you 18 or older?') as HTMLSelectElement).value).toBe(
      'no',
    );
  });
});
