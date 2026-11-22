import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResumesPage } from '../src/components/resumes/resumes-page.tsx';
import { ApiError } from '../src/lib/api/client.ts';
import type { Document, StartedUpload } from '../src/lib/api/documents.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { ApiContext } from '../src/lib/api/index.ts';
import { createFakeAuth } from '../src/lib/auth/fake.ts';
import { renderApp } from './render-app.tsx';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

type FakeApi = ReturnType<typeof createFakeApi>;

/** A résumé uploaded through the fake API (checked at once: `checkMs: 0`), oldest first. */
async function upload(api: FakeApi, fileName: string) {
  const started = await api.request<StartedUpload>('POST', '/me/documents', {
    fileName,
    contentType: 'application/pdf',
  });
  const file = new File(['%PDF'], fileName, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: 184_320 });
  await api.upload(started.upload, file);
  return started.document;
}

async function renderPage(names: string[] = ['First.pdf', 'Second.pdf']) {
  const api = createFakeApi({ delay: 0, checkMs: 0 });
  for (const name of names) await upload(api, name);
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queries}>
      <ApiContext.Provider value={api}>
        <ResumesPage />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
  if (names.length) await screen.findByRole('list', { name: 'Your résumés' });
  else await screen.findByText('No résumés yet');
  return Object.assign(api, { queries });
}

/** The rows' text (also while the sheet hides the page from assistive tech). */
const rows = () =>
  within(screen.getByRole('list', { name: 'Your résumés', hidden: true }))
    .getAllByRole('listitem', { hidden: true })
    .map((row) => row.textContent);

const statusText = () =>
  screen
    .getAllByRole('status')
    .map((status) => status.textContent)
    .join(' ');

async function documents(api: FakeApi) {
  return (await api.request<{ documents: Document[] }>('GET', '/me/documents')).documents;
}

describe('ResumesPage', () => {
  it('lists every résumé newest first, the default marked, and how many of 10 are used', async () => {
    await renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'The résumés your deputy tailors from.' }),
    ).toBeTruthy();
    expect(rows()).toEqual([
      'SecondPDF · 180 kBDelete Second',
      'FirstDefaultPDF · 180 kBDelete First',
    ]);
    expect(screen.getByText('2 of 10')).toBeTruthy();
  });

  it('says when there are none yet', async () => {
    await renderPage([]);
    expect(
      screen.getByText('Add a résumé so your deputy has something to tailor from.'),
    ).toBeTruthy();
    expect(screen.getByText('0 of 10')).toBeTruthy();
  });

  it('shows why one couldn’t be used, and that one started elsewhere isn’t ready yet', async () => {
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    await upload(api, 'malware.pdf');
    // Started, but its file never sent (another tab, closed).
    await api.request('POST', '/me/documents', {
      fileName: 'Elsewhere.pdf',
      contentType: 'application/pdf',
    });
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queries}>
        <ApiContext.Provider value={api}>
          <ResumesPage />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    await screen.findByRole('list', { name: 'Your résumés' });
    expect(rows()).toEqual([
      'ElsewhereNot ready yetDelete Elsewhere',
      'malwareDefaultCouldn’t be usedThis file failed the malware scan and was deleted.Delete malware',
    ]);
  });

  it('asks before deleting; Keep it deletes nothing and goes back to its Delete', async () => {
    const api = await renderPage();
    // Not focused first: Safari doesn't focus a clicked button.
    const remove = screen.getByRole('button', { name: 'Delete Second' });
    fireEvent.click(remove);
    const sheet = await screen.findByRole('alertdialog', { name: 'Delete Second?' });
    expect(sheet.textContent).toContain('The file is deleted for good. This can’t be undone.');
    // The safe answer has focus.
    expect(document.activeElement).toBe(within(sheet).getByRole('button', { name: 'Keep it' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Keep it' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect((await documents(api)).map((each) => each.title)).toEqual(['Second', 'First']);
    await waitFor(() => expect(document.activeElement).toBe(remove));
  });

  it('deletes the default, says which one is the default now, and moves focus to the library', async () => {
    const api = await renderPage(['First.pdf', 'Second.pdf', 'Third.pdf']);
    fireEvent.click(screen.getByRole('button', { name: 'Delete First' }));
    const sheet = await screen.findByRole('alertdialog', { name: 'Delete First?' });
    expect(sheet.textContent).toContain('Your newest ready résumé becomes your default.');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete résumé' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() =>
      expect(statusText()).toContain('First deleted. Third is your default now.'),
    );
    expect(rows()).toEqual([
      'ThirdDefaultPDF · 180 kBDelete Third',
      'SecondPDF · 180 kBDelete Second',
    ]);
    expect(screen.getByText('2 of 10')).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Library' })),
    );
    expect((await documents(api)).filter((each) => each.isDefault)).toHaveLength(1);
  });

  it('says only that it is deleted when it wasn’t the default, and when no default is left', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Second' }));
    let sheet = await screen.findByRole('alertdialog');
    expect(sheet.textContent).not.toContain('becomes your default');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete résumé' }));
    await waitFor(() => expect(statusText()).toContain('Second deleted.'));
    expect(statusText()).not.toContain('default');
    fireEvent.click(await screen.findByRole('button', { name: 'Delete First' }));
    sheet = await screen.findByRole('alertdialog');
    expect(sheet.textContent).not.toContain('default');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete résumé' }));
    await waitFor(() =>
      expect(statusText()).toContain('First deleted. You have no default résumé now.'),
    );
    expect(await screen.findByText('No résumés yet')).toBeTruthy();
  });

  it('keeps the question open and says why when the delete fails', async () => {
    const api = await renderPage();
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation((method, path, body) =>
      method === 'DELETE'
        ? Promise.reject(new ApiError('offline', { status: 0 }))
        : request(method, path, body),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete Second' }));
    const sheet = await screen.findByRole('alertdialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete résumé' }));
    expect(
      await within(sheet).findByText('That didn’t delete. Check your connection, then try again.'),
    ).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBe(sheet);
    expect(rows()).toHaveLength(2);
  });

  it('stays open while the delete is on its way (Escape and Keep it wait for it)', async () => {
    const api = await renderPage();
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation((method, path, body) =>
      method === 'DELETE' ? new Promise(() => undefined) : request(method, path, body),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete Second' }));
    const sheet = await screen.findByRole('alertdialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete résumé' }));
    fireEvent.keyDown(sheet, { key: 'Escape' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Keep it' }));
    await new Promise((done) => setTimeout(done, 50));
    expect(screen.getByRole('alertdialog')).toBe(sheet);
  });

  it('never lets a read that began before the delete bring the row back', async () => {
    const api = await renderPage(['First.pdf', 'Second.pdf', 'Third.pdf']);
    const before = await documents(api);
    const request = api.request.bind(api);
    let answer: (value: unknown) => void = () => undefined;
    let held = true;
    vi.spyOn(api, 'request').mockImplementation((method, path, body) => {
      if (method === 'GET' && path === '/me/documents' && held) {
        held = false;
        // The old list, answered only after the delete.
        return new Promise((done) => {
          answer = () => done({ documents: before });
        });
      }
      return request(method, path, body);
    });
    // A re-read on its way (as the 2 s beat starts one).
    void api.queries.refetchQueries({ queryKey: ['documents'] });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Third' }));
    const sheet = await screen.findByRole('alertdialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete résumé' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    answer(undefined);
    await waitFor(() => expect(statusText()).toContain('Third deleted.'));
    expect(rows().some((row) => row?.startsWith('Third'))).toBe(false);
  });

  it('treats one already gone as deleted', async () => {
    const api = await renderPage();
    const [second] = await documents(api);
    await api.request('DELETE', `/me/documents/${second?.documentId}`);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Second' }));
    const sheet = await screen.findByRole('alertdialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete résumé' }));
    await waitFor(() => expect(statusText()).toContain('Second deleted.'));
    expect(rows()).toEqual(['FirstDefaultPDF · 180 kBDelete First']);
  });
});

describe('the Résumés page in the app', () => {
  it('is in the sidebar, at its own address, named in the tab', async () => {
    const auth = createFakeAuth({ delay: 0 });
    await auth.signUp('new@example.com', 'a long enough password');
    await auth.confirmSignUp('new@example.com', 'a long enough password', '123456');
    const api = createFakeApi({ delay: 0, checkMs: 0 });
    await api.request('PUT', '/me/profile', { version: 0, firstName: 'Alex', lastName: 'Morgan' });
    await renderApp(auth, {}, api);
    await screen.findByRole('heading', { level: 1, name: 'What your deputy knows about you.' });
    const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
    expect(nav.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Résumés',
      'Profile',
    ]);
    fireEvent.click(nav.getByRole('link', { name: 'Résumés' }));
    const title = await screen.findByRole('heading', {
      level: 1,
      name: 'The résumés your deputy tailors from.',
    });
    expect(document.activeElement).toBe(title);
    expect(window.location.pathname).toBe('/resumes');
    expect(document.title).toBe('Résumés · JobDeputy');
    expect(nav.getByRole('link', { name: 'Résumés' }).getAttribute('aria-current')).toBe('page');
  });
});
