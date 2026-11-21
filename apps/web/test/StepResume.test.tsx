import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StepResume, sizeText } from '../src/components/setup/step-resume.tsx';
import { ApiError } from '../src/lib/api/client.ts';
import { checkFile, type Document, type StartedUpload } from '../src/lib/api/documents.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { ApiContext } from '../src/lib/api/index.ts';
import { createFakeAuth } from '../src/lib/auth/fake.ts';
import { renderApp } from './render-app.tsx';

afterEach(cleanup);

type FakeApi = ReturnType<typeof createFakeApi>;

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
        <StepResume onDone={onDone} onBack={onBack} onMood={onMood} />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: /Skip for now|Continue/ });
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

describe('Set it up, step 3: résumé', () => {
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
    expect(screen.getByText('I’ll tailor from this one.')).toBeTruthy();
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
    expect(onMood).toHaveBeenLastCalledWith('working');
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
    expect(onMood).toHaveBeenLastCalledWith('working');
    // Leaving mid-upload is Cancel's job: the footer waits.
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await item().findByRole('button', { name: 'Cancel Alex_Morgan_Resume.pdf' }));
    const choose = await screen.findByRole('button', { name: 'Choose a file' });
    expect(document.activeElement).toBe(choose);
    await waitFor(() =>
      expect(statusText()).toContain('Upload of Alex_Morgan_Resume.pdf cancelled.'),
    );
    await waitFor(async () => expect(await documents(api)).toEqual([]));
    expect(onMood).toHaveBeenLastCalledWith('idle');
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
    expect(onMood).toHaveBeenLastCalledWith('idle');
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeTruthy();
    fireEvent.click(item().getByRole('button', { name: 'Remove malware.pdf' }));
    const choose = await screen.findByRole('button', { name: 'Choose a file' });
    expect(document.activeElement).toBe(choose);
    expect(alertText()).toBe('');
    await waitFor(() => expect(statusText()).toContain('malware.pdf removed.'));
    expect(await documents(api)).toEqual([]);
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
    fireEvent.click(item().getByRole('button', { name: 'Remove Resume 9.pdf' }));
    await screen.findByRole('button', { name: 'Choose a file' });
    await upload(api, pdf('Elsewhere.pdf'));
    pick(pdf());
    await waitFor(() =>
      expect(alertText()).toContain('You can keep up to 10 résumés. Remove one to add another.'),
    );
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
    // The next check (every 2 s) finds it gone.
    expect(
      await screen.findByRole('button', { name: 'Choose a file' }, { timeout: 4000 }),
    ).toBeTruthy();
  });

  it('says when the résumés could not be read, and tries again', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    vi.spyOn(api, 'request').mockRejectedValueOnce(new ApiError('server', { status: 500 }));
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queries}>
        <ApiContext.Provider value={api}>
          <StepResume onDone={vi.fn()} onBack={vi.fn()} onMood={vi.fn()} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Skip for now' })).toBeTruthy();
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
