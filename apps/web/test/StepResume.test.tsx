import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StepResume, sizeText } from '../src/components/setup/step-resume.tsx';
import { ApiError } from '../src/lib/api/client.ts';
import {
  checkFile,
  type Document,
  nextCheck,
  type StartedUpload,
  startingDocument,
} from '../src/lib/api/documents.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { ApiContext } from '../src/lib/api/index.ts';
import { createFakeAuth } from '../src/lib/auth/fake.ts';
import { renderApp } from './render-app.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type FakeApi = ReturnType<typeof createFakeApi>;

/** How often the step asks about a résumé being checked, here (2 s in the app). */
const CHECK_EVERY = 50;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function pdf(name = 'Alex_Morgan_Resume.pdf', size = 184_320): File {
  const file = new File(['%PDF'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

/** Puts a file in the step's picker, as choosing it in the browser's dialog does. */
function pick(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('No file picker on screen');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

/** Step 3 on its own, over a fake API holding these résumés already. */
async function renderStep(
  api: FakeApi = createFakeApi({ delay: 0, checkMs: 0 }),
  files: File[] = [],
) {
  for (const file of files) await upload(api, file);
  const onDone = vi.fn();
  const onBack = vi.fn();
  const onMood = vi.fn();
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queries}>
      <ApiContext.Provider value={api}>
        <StepResume checkEvery={CHECK_EVERY} onDone={onDone} onBack={onBack} onMood={onMood} />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
  // The form, once the résumés are read: the way to add one, or the one held.
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Choose a file' }) ??
        screen.queryByRole('list', { name: 'Your résumé' }),
    ).toBeTruthy(),
  );
  return { api, onDone, onBack, onMood, queries, view };
}

/** A résumé uploaded straight through the fake API, as an earlier visit would have. */
async function upload(api: FakeApi, file: File) {
  const started = await api.request<StartedUpload>('POST', '/me/documents', {
    fileName: file.name,
    contentType: 'application/pdf',
  });
  await api.upload(started.upload, file);
}

async function documents(api: FakeApi) {
  return (await api.request<{ documents: Document[] }>('GET', '/me/documents')).documents;
}

function statusText(): string {
  return screen
    .getAllByRole('status')
    .map((status) => status.textContent)
    .join(' ');
}

function alertText(): string {
  return screen
    .getAllByRole('alert')
    .map((alert) => alert.textContent)
    .join(' ');
}

function item() {
  return within(screen.getByRole('list', { name: 'Your résumé' }));
}

// Generous: some tests wait on the step's checks (on a 50 ms beat here).
describe('Set it up, step 3: résumé', { timeout: 30_000 }, () => {
  it('comes after step 2, uploads a résumé, and ends the set-up', async () => {
    const auth = createFakeAuth({ delay: 0 });
    await auth.signUp('new@example.com', 'a long enough password');
    await auth.confirmSignUp('new@example.com', 'a long enough password', '123456');
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    await renderApp(auth, {}, api);
    fireEvent.click(await screen.findByRole('button', { name: 'Let’s start' }));
    await screen.findByRole('heading', { level: 1, name: 'First, what should I call you?' });
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Morgan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByLabelText('Job title');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Backend engineer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const title = await screen.findByRole('heading', { level: 1, name: 'Add your résumé.' });
    expect(screen.getByRole('banner').textContent).toContain('Step 3 of 3');
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(screen.getByText('I check every file first.')).toBeTruthy();
    await screen.findByRole('button', { name: 'Choose a file' });
    pick(pdf());
    await waitFor(() => expect(item().getByText('Ready')).toBeTruthy());
    // Pleased with it, beside the step.
    expect(await screen.findByText('I’ll tailor from this one.')).toBeTruthy();
    expect(item().getByText('PDF · 180 kB')).toBeTruthy();
    await waitFor(() => expect(statusText()).toContain('Alex_Morgan_Resume.pdf is ready.'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'You’re in.' })).toBeTruthy();
    expect((await documents(api)).map((each) => each.status)).toEqual(['ready']);
  });

  it('can be skipped, and goes back to step 2', async () => {
    const { onDone, onBack } = await renderStep();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onDone).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('shows each stage while the server checks the file, and the deputy at work', async () => {
    const { onMood } = await renderStep(createFakeApi({ delay: 0, checkMs: 60_000 }));
    pick(pdf());
    await waitFor(() =>
      expect(item().getByText('Checking it for malware · step 2 of 3')).toBeTruthy(),
    );
    await waitFor(() => expect(onMood).toHaveBeenLastCalledWith('working'));
    await waitFor(() =>
      expect(statusText()).toContain(
        'Alex_Morgan_Resume.pdf is uploaded. Checking it for malware.',
      ),
    );
    // The server carries on: the person may move on.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(item().getByRole('button', { name: 'Remove Alex_Morgan_Resume.pdf' })).toBeTruthy();
  });

  it('shows the upload’s progress, and Cancel stops it and forgets the file', async () => {
    const api = createFakeApi({ delay: 30, checkMs: 0 });
    const { onMood } = await renderStep(api);
    pick(pdf());
    const progress = await screen.findByRole('progressbar', { name: 'Uploading résumé' });
    expect(progress).toBeTruthy();
    expect(item().getByText('Uploading · step 1 of 3')).toBeTruthy();
    await waitFor(() => expect(onMood).toHaveBeenLastCalledWith('working'));
    // Leaving mid-upload is Cancel's job: the footer waits.
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await item().findByRole('button', { name: 'Cancel Alex_Morgan_Resume.pdf' }));
    const choose = await screen.findByRole('button', { name: 'Choose a file' });
    expect(document.activeElement).toBe(choose);
    await waitFor(() =>
      expect(statusText()).toContain('Upload of Alex_Morgan_Resume.pdf cancelled.'),
    );
    await waitFor(async () => expect(await documents(api)).toEqual([]));
    await waitFor(() => expect(onMood).toHaveBeenLastCalledWith('idle'));
  });

  it.each([
    [pdf('notes.txt'), 'notes.txt isn’t a PDF or DOCX file.'],
    [pdf('big.pdf', 5 * 1024 * 1024 + 1), 'big.pdf is larger than 5 MB.'],
    [pdf('empty.pdf', 0), 'empty.pdf is empty.'],
    [pdf('my"cv.pdf'), 'Rename my"cv.pdf to a plain file name'],
  ])('refuses a file before sending anything (%#)', async (file, reason) => {
    const { api } = await renderStep();
    const request = vi.spyOn(api, 'request');
    pick(file);
    await waitFor(() => expect(alertText()).toContain(reason));
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeTruthy();
  });

  it('says why the server could not use a file, and Remove starts over', async () => {
    const { api, onMood } = await renderStep();
    pick(pdf('malware.pdf'));
    await waitFor(() =>
      expect(alertText()).toContain('This file failed the malware scan and was deleted.'),
    );
    expect(item().getByText('Couldn’t be used')).toBeTruthy();
    await waitFor(() => expect(onMood).toHaveBeenLastCalledWith('idle'));
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeTruthy();
    fireEvent.click(item().getByRole('button', { name: 'Remove malware.pdf' }));
    const choose = await screen.findByRole('button', { name: 'Choose a file' });
    expect(document.activeElement).toBe(choose);
    expect(alertText()).toBe('');
    await waitFor(() => expect(statusText()).toContain('malware.pdf removed.'));
    expect(await documents(api)).toEqual([]);
  });

  it('offers its way on only with the form, already right (no Skip turning into Continue)', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    await upload(api, pdf('Earlier.pdf'));
    const slow = createFakeApi({ delay: 0, checkMs: 0 });
    // The same résumé, read slowly enough for the loading skeleton to show and hold.
    vi.spyOn(slow, 'request').mockImplementation(async (method, path, body) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return api.request(method, path, body);
    });
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queries}>
        <ApiContext.Provider value={slow}>
          <StepResume checkEvery={CHECK_EVERY} onDone={vi.fn()} onBack={vi.fn()} onMood={vi.fn()} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    const first = await screen.findByRole(
      'button',
      { name: /Continue|Skip for now/ },
      {
        timeout: 15_000,
      },
    );
    expect(first.textContent).toBe('Continue');
    expect(screen.getByRole('list', { name: 'Your résumé' })).toBeTruthy();
  });

  it('opens on the résumé already added, ready to continue', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    const { onDone } = await renderStep(api, [pdf('Earlier.pdf')]);
    expect(item().getByRole('listitem').textContent).toContain('Earlier.pdf');
    expect(item().getByText('Ready')).toBeTruthy();
    // Not news: it was ready before the step opened.
    expect(statusText()).not.toContain('is ready');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('says when the upload did not get through, and forgets the started résumé', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    vi.spyOn(api, 'upload').mockRejectedValueOnce(new ApiError('offline'));
    await renderStep(api);
    pick(pdf());
    await waitFor(() =>
      expect(alertText()).toContain(
        'The upload didn’t finish. Check your connection, then try again.',
      ),
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose a file' }));
    await waitFor(async () => expect(await documents(api)).toEqual([]));
  });

  it('says when the form refused the file', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    vi.spyOn(api, 'upload').mockRejectedValueOnce(new ApiError('invalid', { status: 403 }));
    await renderStep(api);
    pick(pdf());
    await waitFor(() => expect(alertText()).toContain('The upload was refused. Try again.'));
  });

  it('says when the résumés are at their limit', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    const files = Array.from({ length: 10 }, (_, n) => pdf(`Resume ${n}.pdf`));
    await renderStep(api, files);
    fireEvent.click(item().getByRole('button', { name: 'Remove Resume 0.pdf' }));
    await screen.findByRole('button', { name: 'Choose a file' });
    await upload(api, pdf('Elsewhere.pdf'));
    pick(pdf());
    await waitFor(() => expect(alertText()).toContain('You’ve reached the limit of 10 résumés.'));
  });

  it('keeps the résumé when removing it fails, and says so', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    await renderStep(api, [pdf('Earlier.pdf')]);
    vi.spyOn(api, 'request').mockRejectedValueOnce(new ApiError('unsure'));
    fireEvent.click(item().getByRole('button', { name: 'Remove Earlier.pdf' }));
    await waitFor(() =>
      expect(alertText()).toContain('That didn’t remove. Check your connection, then try again.'),
    );
    expect(item().getByRole('listitem').textContent).toContain('Earlier.pdf');
  });

  it('takes a résumé already removed elsewhere as removed', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    await renderStep(api, [pdf('Earlier.pdf')]);
    const [only] = await documents(api);
    await api.request('DELETE', `/me/documents/${only?.documentId}`);
    fireEvent.click(item().getByRole('button', { name: 'Remove Earlier.pdf' }));
    await screen.findByRole('button', { name: 'Choose a file' });
    expect(alertText()).toBe('');
  });

  it('starts over when the résumé it follows is removed elsewhere', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 60_000 });
    await renderStep(api);
    pick(pdf());
    await item().findByText('Checking it for malware · step 2 of 3');
    const [only] = await documents(api);
    await api.request('DELETE', `/me/documents/${only?.documentId}`);
    item().getByRole('button', { name: 'Remove Alex_Morgan_Resume.pdf' }).focus();
    // The next check finds it gone; focus moves to the way to add one.
    const choose = await screen.findByRole(
      'button',
      { name: 'Choose a file' },
      { timeout: 15_000 },
    );
    await waitFor(() => expect(document.activeElement).toBe(choose));
    await waitFor(() => expect(statusText()).toContain('Alex_Morgan_Resume.pdf removed.'));
  });

  it('leaves out a résumé still waiting from an earlier visit (it can’t tell if its file came)', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    await api.request('POST', '/me/documents', {
      fileName: 'Closed.pdf',
      contentType: 'application/pdf',
    });
    await renderStep(api);
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeTruthy();
  });

  it('clears an earlier failure once the résumé turns out to be gone', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 60_000 });
    await renderStep(api);
    pick(pdf());
    await item().findByText('Checking it for malware · step 2 of 3');
    // The removal goes through, but its answer is lost.
    const real = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      const answer = await real(method, path, body);
      if (method === 'DELETE') throw new ApiError('unsure');
      return answer;
    });
    fireEvent.click(item().getByRole('button', { name: 'Remove Alex_Morgan_Resume.pdf' }));
    await waitFor(() => expect(alertText()).toContain('That didn’t remove.'));
    // The next check finds it gone: one story, not two.
    await screen.findByRole('button', { name: 'Choose a file' }, { timeout: 15_000 });
    expect(alertText()).toBe('');
  });

  it('opens again on its own upload still being checked, over an older ready one', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    const { queries, view } = await renderStep(api, [pdf('First.pdf'), pdf('Second.pdf')]);
    fireEvent.click(item().getByRole('button', { name: 'Remove First.pdf' }));
    await screen.findByRole('button', { name: 'Choose a file' });
    pick(pdf('still-checking.pdf'));
    await item().findByText('Checking it for malware · step 2 of 3');
    view.unmount();
    // Closed for real: what it kept is let go before it opens again (as Back, then Continue).
    await waitFor(() =>
      expect(
        queries.getQueryCache().find({ queryKey: ['documents'], exact: true }),
      ).toBeUndefined(),
    );
    const reads = vi.spyOn(api, 'request');
    render(
      <QueryClientProvider client={queries}>
        <ApiContext.Provider value={api}>
          <StepResume checkEvery={CHECK_EVERY} onDone={vi.fn()} onBack={vi.fn()} onMood={vi.fn()} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    await screen.findByRole('list', { name: 'Your résumé' });
    expect(reads).toHaveBeenCalledWith('GET', '/me/documents');
    expect(await item().findByText('Checking it for malware · step 2 of 3')).toBeTruthy();
    expect(item().getByRole('listitem').textContent).toContain('still-checking.pdf');
  });

  it('opens again on a résumé that got ready meanwhile, without saying it again', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 150 });
    const { queries, view } = await renderStep(api);
    pick(pdf());
    await item().findByText('Checking it for malware · step 2 of 3');
    view.unmount();
    // Ready on the server while the step was closed.
    await waitFor(async () => expect((await documents(api))[0]?.status).toBe('ready'));
    const mood = vi.fn();
    render(
      <QueryClientProvider client={queries}>
        <ApiContext.Provider value={api}>
          <StepResume checkEvery={CHECK_EVERY} onDone={vi.fn()} onBack={vi.fn()} onMood={mood} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    // Ready from the first frame (an old copy saying it was being checked would then say it got
    // ready, as news).
    const row = await screen.findByRole('list', { name: 'Your résumé' });
    expect(within(row).getByText('Ready')).toBeTruthy();
    expect(within(row).queryByText(/Checking/)).toBeNull();
    // Never at work on it again on the way (which would also say it got ready, as news).
    await waitFor(() => expect(mood).toHaveBeenLastCalledWith('ready'));
    expect(mood).not.toHaveBeenCalledWith('working');
  });

  it('opens again without a résumé removed elsewhere meanwhile', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    const { queries, view } = await renderStep(api, [pdf('Earlier.pdf')]);
    view.unmount();
    // Closed for real: what it kept is let go before it opens again (as Back, then Continue).
    await waitFor(() =>
      expect(
        queries.getQueryCache().find({ queryKey: ['documents'], exact: true }),
      ).toBeUndefined(),
    );
    const reads = vi.spyOn(api, 'request');
    const [only] = await documents(api);
    await api.request('DELETE', `/me/documents/${only?.documentId}`);
    render(
      <QueryClientProvider client={queries}>
        <ApiContext.Provider value={api}>
          <StepResume checkEvery={CHECK_EVERY} onDone={vi.fn()} onBack={vi.fn()} onMood={vi.fn()} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('button', { name: 'Choose a file' })).toBeTruthy();
    expect(reads).toHaveBeenCalledWith('GET', '/me/documents');
  });

  it('opens again on its own upload still being checked (Back, then Continue on step 2)', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 60_000 });
    const { queries, view } = await renderStep(api);
    pick(pdf());
    await item().findByText('Checking it for malware · step 2 of 3');
    view.unmount();
    // Closed for real: what it kept is let go before it opens again (as Back, then Continue).
    await waitFor(() =>
      expect(
        queries.getQueryCache().find({ queryKey: ['documents'], exact: true }),
      ).toBeUndefined(),
    );
    const reads = vi.spyOn(api, 'request');
    render(
      <QueryClientProvider client={queries}>
        <ApiContext.Provider value={api}>
          <StepResume checkEvery={CHECK_EVERY} onDone={vi.fn()} onBack={vi.fn()} onMood={vi.fn()} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    await screen.findByRole('list', { name: 'Your résumé' });
    expect(reads).toHaveBeenCalledWith('GET', '/me/documents');
    expect(await item().findByText('Checking it for malware · step 2 of 3')).toBeTruthy();
  });

  it('opens again on what the checks last learned, not the upload’s first state', async () => {
    // Two ready ones already (the first is the default); it is removed, and a new one added.
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    const { queries, view } = await renderStep(api, [pdf('First.pdf'), pdf('Second.pdf')]);
    fireEvent.click(item().getByRole('button', { name: 'Remove First.pdf' }));
    await screen.findByRole('button', { name: 'Choose a file' });
    pick(pdf());
    await item().findByText('Ready');
    expect(item().getByRole('listitem').textContent).toContain('Alex_Morgan_Resume.pdf');
    view.unmount();
    // Closed for real: what it kept is let go before it opens again (as Back, then Continue).
    await waitFor(() =>
      expect(
        queries.getQueryCache().find({ queryKey: ['documents'], exact: true }),
      ).toBeUndefined(),
    );
    const reads = vi.spyOn(api, 'request');
    render(
      <QueryClientProvider client={queries}>
        <ApiContext.Provider value={api}>
          <StepResume checkEvery={CHECK_EVERY} onDone={vi.fn()} onBack={vi.fn()} onMood={vi.fn()} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    await screen.findByRole('list', { name: 'Your résumé' });
    expect(reads).toHaveBeenCalledWith('GET', '/me/documents');
    // Read afresh: the new one, ready (not the older ready one).
    expect(await item().findByText('Ready')).toBeTruthy();
    expect(item().getByRole('listitem').textContent).toContain('Alex_Morgan_Resume.pdf');
    // As the API does: with the default gone, the new one is the default.
    const defaults = (await documents(api)).filter((each) => each.isDefault);
    expect(defaults.map((each) => each.fileName)).toEqual(['Alex_Morgan_Resume.pdf']);
  });

  it('lets the zone take a dragged file', async () => {
    await renderStep();
    const transfer = { types: ['Files'], dropEffect: 'copy', files: [] };
    const over = new Event('dragover', { cancelable: true, bubbles: true });
    Object.defineProperty(over, 'dataTransfer', { value: transfer });
    screen.getByText('Drop your résumé here').dispatchEvent(over);
    expect(transfer.dropEffect).toBe('copy');
  });

  it('stops following a résumé once the session has ended, and says so', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 60_000 });
    const { queries } = await renderStep(api);
    pick(pdf());
    await item().findByText('Checking it for malware · step 2 of 3');
    vi.spyOn(api, 'request').mockRejectedValue(new ApiError('signed-out'));
    await waitFor(() => expect(alertText()).toContain('Your session has ended.'), {
      timeout: 15_000,
    });
    // No way on (Sign out is in the header), and focus is on why.
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(document.activeElement?.textContent).toContain('Your session has ended.');
    // Not asked again: the followed résumé's next check is off.
    const followed = queries
      .getQueryCache()
      .findAll({ queryKey: ['documents'] })
      .find((query) => query.queryKey.length === 2);
    const interval = followed?.observers[0]?.options.refetchInterval;
    expect(typeof interval === 'function' && followed ? interval(followed) : interval).toBe(false);
  });

  it('keeps a file dropped beside the zone from leaving the app', async () => {
    await renderStep();
    const drop = new Event('drop', { cancelable: true, bubbles: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'] } });
    document.body.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    // Dragged over, it shows as not allowed rather than seeming to be taken.
    const over = new Event('dragover', { cancelable: true, bubbles: true });
    const transfer = { types: ['Files'], dropEffect: 'copy' };
    Object.defineProperty(over, 'dataTransfer', { value: transfer });
    document.body.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(transfer.dropEffect).toBe('none');
  });

  it('stops saying something that no longer holds when a pick is refused', async () => {
    await renderStep(createFakeApi({ delay: 0, checkMs: 0 }), [pdf('Earlier.pdf')]);
    fireEvent.click(item().getByRole('button', { name: 'Remove Earlier.pdf' }));
    await waitFor(() => expect(statusText()).toContain('Earlier.pdf removed.'));
    pick(pdf('notes.txt'));
    await waitFor(() => expect(alertText()).toContain('notes.txt isn’t a PDF or DOCX file.'));
    expect(statusText()).not.toContain('removed');
  });

  it('says when the résumés could not be read, and tries again', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    vi.spyOn(api, 'request').mockRejectedValueOnce(new ApiError('server', { status: 500 }));
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queries}>
        <ApiContext.Provider value={api}>
          <StepResume checkEvery={CHECK_EVERY} onDone={vi.fn()} onBack={vi.fn()} onMood={vi.fn()} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    const retry = await screen.findByRole('button', { name: 'Try again' });
    // Optional: it can be skipped, or left, even when its résumés can't be read (for now).
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    fireEvent.click(retry);
    expect(await screen.findByRole('button', { name: 'Choose a file' })).toBeTruthy();
  });
});

describe('Set it up, step 3, once the session has ended', () => {
  it('offers no way on: Sign out (in the header) is the way out', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    vi.spyOn(api, 'request').mockRejectedValue(new ApiError('signed-out'));
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queries}>
        <ApiContext.Provider value={api}>
          <StepResume checkEvery={CHECK_EVERY} onDone={vi.fn()} onBack={vi.fn()} onMood={vi.fn()} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(alertText()).toContain('Your session has ended.'));
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
});

describe('nextCheck', () => {
  const checking = { status: 'pending' } as Document;
  const ready = { status: 'ready' } as Document;

  it('asks again while the server is still checking, and stops once it is done', () => {
    expect(nextCheck({ data: checking, error: null }, 50)).toBe(50);
    expect(nextCheck({ data: { status: 'processing' } as Document, error: null }, 50)).toBe(50);
    expect(nextCheck({ data: ready, error: null }, 50)).toBe(false);
    expect(nextCheck({ data: undefined, error: null }, 50)).toBe(false);
  });

  it('keeps asking after a passing failure, not after one asking again can’t help', () => {
    expect(nextCheck({ data: checking, error: new ApiError('server') }, 50)).toBe(50);
    expect(nextCheck({ data: checking, error: new ApiError('offline') }, 50)).toBe(50);
    for (const kind of ['signed-out', 'forbidden', 'not-found'] as const) {
      expect(nextCheck({ data: checking, error: new ApiError(kind) }, 50)).toBe(false);
    }
  });
});

describe('startingDocument', () => {
  const doc = (documentId: string, status: Document['status'], isDefault = false) =>
    ({ documentId, status, isDefault }) as Document;

  it('prefers a ready résumé (the default first), then one being read, then the newest', () => {
    const ready = doc('ready', 'ready');
    const chosen = doc('default', 'ready', true);
    const reading = doc('reading', 'processing');
    const rejected = doc('rejected', 'rejected');
    expect(startingDocument([rejected, reading, ready, chosen])).toBe(chosen);
    expect(startingDocument([rejected, reading, ready])).toBe(ready);
    expect(startingDocument([rejected, reading])).toBe(reading);
    expect(startingDocument([rejected])).toBe(rejected);
    expect(startingDocument([])).toBeNull();
  });

  it('leaves out one still pending unless its file was sent from this page', () => {
    expect(startingDocument([doc('pending', 'pending')], new Set())).toBeNull();
    const mine = doc('mine', 'pending');
    expect(startingDocument([mine], new Set(['mine']))).toBe(mine);
    // What was just sent from here comes first, even over a ready default.
    const chosen = doc('default', 'ready', true);
    expect(startingDocument([mine, chosen], new Set(['mine']))).toBe(mine);
    // Unless the server couldn't use it: a ready one is still there to continue with.
    const refused = doc('refused', 'rejected');
    expect(startingDocument([refused, chosen], new Set(['refused']))).toBe(chosen);
    const failed = doc('failed', 'failed');
    expect(startingDocument([doc('pending', 'pending'), failed], new Set())).toBe(failed);
  });
});

describe('checkFile', () => {
  it('takes a PDF or DOCX by its extension, whatever the browser guessed', () => {
    expect(checkFile({ name: 'Résumé.PDF', size: 10, type: '' })).toEqual({
      ok: true,
      input: { fileName: 'Résumé.PDF', contentType: 'application/pdf' },
    });
    expect(checkFile({ name: 'cv.docx', size: 10, type: 'application/octet-stream' })).toEqual({
      ok: true,
      input: { fileName: 'cv.docx', contentType: DOCX },
    });
  });

  it('refuses other types, empty and oversized files, and names the API refuses', () => {
    expect(checkFile({ name: 'cv.doc', size: 10, type: '' })).toEqual({
      ok: false,
      reason: 'type',
    });
    expect(checkFile({ name: 'cv.pdf', size: 0, type: '' })).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(checkFile({ name: 'cv.pdf', size: 5 * 1024 * 1024, type: '' }).ok).toBe(true);
    expect(checkFile({ name: 'cv.pdf', size: 5 * 1024 * 1024 + 1, type: '' })).toEqual({
      ok: false,
      reason: 'size',
    });
    expect(checkFile({ name: 'a"b.pdf', size: 10, type: '' })).toEqual({
      ok: false,
      reason: 'name',
    });
  });
});

describe('sizeText', () => {
  it('reads kilobytes under 1 MB and megabytes from there', () => {
    expect(sizeText(1)).toBe('1 kB');
    expect(sizeText(184_320)).toBe('180 kB');
    expect(sizeText(1024 * 1024)).toBe('1 MB');
    expect(sizeText(2.4 * 1024 * 1024)).toBe('2.4 MB');
  });
});
