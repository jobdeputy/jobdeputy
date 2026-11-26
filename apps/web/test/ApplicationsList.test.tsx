import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationsPage } from '../src/components/jobs/applications-page.tsx';
import { ApiError } from '../src/lib/api/client.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { ApiContext } from '../src/lib/api/index.ts';
import type { Matches } from '../src/lib/api/jobs.ts';

/** A link pressed here never navigates (happy-dom would open the employer's real page). */
function stayHere(event: MouseEvent) {
  if ((event.target as Element | null)?.closest?.('a')) event.preventDefault();
}

beforeEach(() => {
  document.addEventListener('click', stayHere, true);
});

afterEach(() => {
  document.removeEventListener('click', stayHere, true);
  cleanup();
  vi.restoreAllMocks();
});

type FakeApi = ReturnType<typeof createFakeApi>;

const BACKEND = 'Senior Backend Engineer';
const STAFF = 'Staff Software Engineer, Payments';
const PLATFORM = 'Platform Engineer, Developer Experience';

/** Acme's three jobs read, and `applied` (by title) marked applied, in that order. */
async function setUp(applied: string[], clock = { now: Date.parse('2026-11-25T15:00:00Z') }) {
  const api = createFakeApi({ delay: 0, crawlMs: 0, now: () => clock.now });
  await api.request('POST', '/me/crawls', { url: 'https://boards.greenhouse.io/acme' });
  const { jobs } = await api.request<Matches>('GET', '/me/matches');
  const byTitle = new Map(jobs.map((job) => [job.title, job]));
  for (const title of applied) {
    clock.now += 60_000;
    await api.request('PUT', `/me/jobs/${byTitle.get(title)?.jobId}/stage`, {
      stage: 'applied',
      from: 'new',
    });
  }
  return { api, byTitle };
}

function renderPage(api: FakeApi, pageSize?: number) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queries}>
      <ApiContext.Provider value={api}>
        <ApplicationsPage pageSize={pageSize} />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
  return queries;
}

const said = () => document.getElementById('applications-said')?.textContent;
const failure = () => document.getElementById('applications-failure')?.textContent;
const table = () => within(screen.getByRole('table', { name: 'Your applications' }));
const stageOf = (title: string) =>
  screen.getByRole('combobox', { name: `Stage for ${title} at Acme` }) as HTMLSelectElement;
const choose = (title: string, stage: string) =>
  fireEvent.change(stageOf(title), { target: { value: stage } });
const rowTitles = () =>
  table()
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getByRole('link')
        .textContent?.replace(/ \(opens.*$/, ''),
    );

describe('Applications (#52 PR D)', () => {
  it('points to Matches when nothing is applied to yet', async () => {
    const { api } = await setUp([]);
    renderPage(api);
    expect(await screen.findByText('No applications yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to Matches' }).getAttribute('href')).toBe(
      '/matches',
    );
  });

  it('lists the jobs applied to, newest first: the posting, company, day applied, and stage', async () => {
    const { api } = await setUp([BACKEND, PLATFORM]);
    renderPage(api);
    await screen.findByRole('link', { name: /^Senior Backend Engineer/ });
    expect(rowTitles()).toEqual([PLATFORM, BACKEND]);
    const link = table().getByRole('link', { name: `${BACKEND} (opens in a new tab)` });
    expect(link.getAttribute('href')).toBe('https://boards.greenhouse.io/acme/jobs/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    const row = within(link.closest('tr') as HTMLElement);
    expect(row.getByText('Acme')).toBeTruthy();
    expect(row.getByText('Nov 25, 2026').getAttribute('dateTime')).toBe('2026-11-25T15:01:00.000Z');
    expect(stageOf(BACKEND).value).toBe('applied');
    expect([...stageOf(BACKEND).options].map((option) => option.text)).toEqual([
      'Applied',
      'Interviewing',
      'Offer',
      'Rejected',
      'Withdrawn',
    ]);
    // The server's order: no header sorts a page.
    expect(table().queryAllByRole('button')).toEqual([]);
  });

  it('saves a stage chosen, says so, and keeps the row in its place', async () => {
    const { api } = await setUp([BACKEND, PLATFORM]);
    const put = vi.spyOn(api, 'request');
    renderPage(api);
    await screen.findByRole('link', { name: /^Senior Backend Engineer/ });
    stageOf(BACKEND).focus();
    choose(BACKEND, 'interviewing');
    // The choice shows while it saves.
    expect(stageOf(BACKEND).value).toBe('interviewing');
    await waitFor(() => expect(said()).toBe('Senior Backend Engineer at Acme: Interviewing.'));
    expect(put).toHaveBeenCalledWith('PUT', expect.stringMatching(/\/stage$/), {
      stage: 'interviewing',
      from: 'applied',
    });
    expect(stageOf(BACKEND).value).toBe('interviewing');
    expect(document.activeElement).toBe(stageOf(BACKEND));
    expect(rowTitles()).toEqual([PLATFORM, BACKEND]);
    // The next change starts from the stage saved.
    choose(BACKEND, 'offer');
    await waitFor(() => expect(said()).toBe('Senior Backend Engineer at Acme: Offer.'));
    expect(put).toHaveBeenLastCalledWith('PUT', expect.stringMatching(/\/stage$/), {
      stage: 'offer',
      from: 'interviewing',
    });
  });

  it('saves choices made while one saves after it, only the newest (arrow keys on a closed select)', async () => {
    const { api } = await setUp([BACKEND]);
    const request = api.request.bind(api);
    let release = () => {};
    const spy = vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method === 'PUT') await new Promise<void>((done) => (release = done));
      return request(method, path, body);
    });
    const puts = () => spy.mock.calls.filter(([method]) => method === 'PUT').map((call) => call[2]);
    renderPage(api);
    await screen.findByRole('link', { name: /^Senior Backend Engineer/ });
    // Down, down, down: each step is a change.
    choose(BACKEND, 'interviewing');
    choose(BACKEND, 'offer');
    choose(BACKEND, 'rejected');
    // The newest shows; only the first is on its way.
    expect(stageOf(BACKEND).value).toBe('rejected');
    expect(puts()).toEqual([{ stage: 'interviewing', from: 'applied' }]);
    release();
    // Then the newest, from the stage just saved.
    await waitFor(() =>
      expect(puts()).toEqual([
        { stage: 'interviewing', from: 'applied' },
        { stage: 'rejected', from: 'interviewing' },
      ]),
    );
    release();
    await waitFor(() => expect(said()).toBe('Senior Backend Engineer at Acme: Rejected.'));
    expect(stageOf(BACKEND).value).toBe('rejected');
    expect(puts()).toHaveLength(2);
  });

  it('says when a stage didn’t save, and shows the stage as it was', async () => {
    const { api } = await setUp([BACKEND]);
    const request = api.request.bind(api);
    const spy = vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method === 'PUT') throw new ApiError('offline');
      return request(method, path, body);
    });
    renderPage(api);
    await screen.findByRole('link', { name: /^Senior Backend Engineer/ });
    choose(BACKEND, 'offer');
    await waitFor(() =>
      expect(failure()).toBe(
        'You’re offline, so the stage for Senior Backend Engineer at Acme didn’t save. Try again once you’re back online.',
      ),
    );
    expect(stageOf(BACKEND).value).toBe('applied');
    spy.mockImplementation(async (method, path, body) => {
      if (method === 'PUT') throw new ApiError('server', { status: 500 });
      return request(method, path, body);
    });
    choose(BACKEND, 'offer');
    await waitFor(() =>
      expect(failure()).toBe(
        'The stage for Senior Backend Engineer at Acme didn’t save. Try again.',
      ),
    );
    // Tried again, it saves, and the failure goes.
    spy.mockImplementation(request);
    choose(BACKEND, 'offer');
    await waitFor(() => expect(stageOf(BACKEND).value).toBe('offer'));
    await waitFor(() => expect(failure()).toBe(''));
  });

  it('shows a job changed elsewhere as it is now, never overwriting it', async () => {
    const { api, byTitle } = await setUp([BACKEND, PLATFORM]);
    renderPage(api);
    await screen.findByRole('link', { name: /^Senior Backend Engineer/ });
    // Another tab moved it on meanwhile.
    await api.request('PUT', `/me/jobs/${byTitle.get(BACKEND)?.jobId}/stage`, {
      stage: 'rejected',
      from: 'applied',
    });
    choose(BACKEND, 'interviewing');
    await waitFor(() =>
      expect(failure()).toBe(
        'Senior Backend Engineer at Acme was changed elsewhere. It shows as it is now.',
      ),
    );
    await waitFor(() => expect(stageOf(BACKEND).value).toBe('rejected'));
  });

  it('never lets a read that was on its way undo a stage saved here', async () => {
    const { api } = await setUp([BACKEND]);
    const request = api.request.bind(api);
    const queries = renderPage(api);
    await screen.findByRole('link', { name: /^Senior Backend Engineer/ });
    // A read of the list starts before the save, and ends after it with the list as it was.
    const before = await request('GET', '/me/applications?limit=50');
    let release = () => {};
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method === 'GET') {
        await new Promise<void>((done) => (release = done));
        return before;
      }
      return request(method, path, body);
    });
    const reading = queries.refetchQueries();
    choose(BACKEND, 'offer');
    await waitFor(() => expect(said()).toBe('Senior Backend Engineer at Acme: Offer.'));
    release();
    await reading;
    expect(stageOf(BACKEND).value).toBe('offer');
  });

  it('says a choice again even in the same words as the last one', async () => {
    const { api } = await setUp([BACKEND]);
    const request = api.request.bind(api);
    renderPage(api);
    await screen.findByRole('link', { name: /^Senior Backend Engineer/ });
    choose(BACKEND, 'offer');
    await waitFor(() => expect(said()).toBe('Senior Backend Engineer at Acme: Offer.'));
    // What the status line holds from here on.
    const line = document.getElementById('applications-said') as HTMLElement;
    const seen: (string | null)[] = [];
    const watch = new MutationObserver(() => seen.push(line.textContent));
    watch.observe(line, { childList: true, characterData: true, subtree: true });
    // Up and back down again while the first step saves: it ends on the same words.
    let release = () => {};
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method === 'PUT') await new Promise<void>((done) => (release = done));
      return request(method, path, body);
    });
    choose(BACKEND, 'interviewing');
    choose(BACKEND, 'offer');
    // Each save let through as it comes (two: interviewing, then offer); the line empties, then
    // says the same words again, so they are read out.
    await waitFor(() => {
      release();
      expect(seen).toEqual(['', 'Senior Backend Engineer at Acme: Offer.']);
    });
    watch.disconnect();
  });

  it('shows a stage saved here on coming back to the tab, before the list is read again', async () => {
    const { api } = await setUp([BACKEND]);
    const queries = renderPage(api);
    await screen.findByRole('link', { name: /^Senior Backend Engineer/ });
    choose(BACKEND, 'offer');
    await waitFor(() => expect(said()).toBe('Senior Backend Engineer at Acme: Offer.'));
    cleanup();
    // Back on the tab: its read again is held; the cached list already has the stage saved.
    vi.spyOn(api, 'request').mockImplementation(() => new Promise(() => {}));
    render(
      <QueryClientProvider client={queries}>
        <ApiContext.Provider value={api}>
          <ApplicationsPage />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    expect(stageOf(BACKEND).value).toBe('offer');
  });

  it('reads the list again after a change found elsewhere, even with More applications on its way', async () => {
    const { api, byTitle } = await setUp([BACKEND, PLATFORM]);
    const request = api.request.bind(api);
    let releaseMore = () => {};
    const spy = vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (String(path).includes('cursor=')) {
        await new Promise<void>((done) => (releaseMore = done));
      }
      return request(method, path, body);
    });
    renderPage(api, 1);
    await screen.findByRole('link', { name: /^Platform Engineer/ });
    fireEvent.click(screen.getByRole('button', { name: 'More applications' }));
    // Another tab moves Platform on meanwhile; this one then tries to.
    await request('PUT', `/me/jobs/${byTitle.get(PLATFORM)?.jobId}/stage`, {
      stage: 'withdrawn',
      from: 'applied',
    });
    const reads = () => spy.mock.calls.filter(([method]) => method === 'GET').length;
    choose(PLATFORM, 'interviewing');
    await waitFor(() =>
      expect(failure()).toBe(
        'Platform Engineer, Developer Experience at Acme was changed elsewhere. It shows as it is now.',
      ),
    );
    const before = reads();
    // The next page comes; then the list is read again, as it is now.
    await waitFor(() => {
      releaseMore();
      expect(reads()).toBeGreaterThan(before);
    });
    await waitFor(() => {
      releaseMore();
      expect(stageOf(PLATFORM).value).toBe('withdrawn');
    });
  });

  it('hands the focus to the heading when a job read again has left (undone elsewhere)', async () => {
    const { api, byTitle } = await setUp([BACKEND, PLATFORM]);
    renderPage(api);
    await screen.findByRole('link', { name: /^Senior Backend Engineer/ });
    await api.request('PUT', `/me/jobs/${byTitle.get(BACKEND)?.jobId}/stage`, {
      stage: 'new',
      from: 'applied',
    });
    stageOf(BACKEND).focus();
    choose(BACKEND, 'interviewing');
    await waitFor(() => expect(rowTitles()).toEqual([PLATFORM]));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 2, name: 'Your applications' }),
      ),
    );
  });

  it('reads more a page at a time, moving the focus to the first new job', async () => {
    const { api } = await setUp([BACKEND, PLATFORM, STAFF]);
    renderPage(api, 2);
    await screen.findByRole('link', { name: /^Platform Engineer/ });
    expect(rowTitles()).toEqual([STAFF, PLATFORM]);
    const more = screen.getByRole('button', { name: 'More applications' });
    more.focus();
    fireEvent.click(more);
    await waitFor(() => expect(rowTitles()).toEqual([STAFF, PLATFORM, BACKEND]));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        table().getByRole('link', { name: `${BACKEND} (opens in a new tab)` }),
      ),
    );
    expect(screen.queryByRole('button', { name: 'More applications' })).toBeNull();
  });

  it('says when more didn’t load', async () => {
    const { api } = await setUp([BACKEND, PLATFORM, STAFF]);
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (String(path).includes('cursor=')) throw new ApiError('server', { status: 500 });
      return request(method, path, body);
    });
    renderPage(api, 2);
    fireEvent.click(await screen.findByRole('button', { name: 'More applications' }));
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('alert')
          .some(
            (alert) =>
              alert.textContent ===
              'More applications didn’t load. Press More applications to try again.',
          ),
      ).toBe(true),
    );
    expect(rowTitles()).toEqual([STAFF, PLATFORM]);
  });
});
