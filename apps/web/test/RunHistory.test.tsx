import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunHistory } from '../src/components/jobs/run-history.tsx';
import { ApiError } from '../src/lib/api/client.ts';
import { type Crawl, nextRunsCheck } from '../src/lib/api/crawls.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { ApiContext } from '../src/lib/api/index.ts';

afterEach(cleanup);

type FakeApi = ReturnType<typeof createFakeApi>;

function renderHistory(api: FakeApi, latest: Crawl | null | undefined, checkEvery?: number) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (crawl: Crawl | null | undefined) => (
    <QueryClientProvider client={queries}>
      <ApiContext.Provider value={api}>
        <RunHistory latest={crawl} {...(checkEvery ? { checkEvery } : {})} />
      </ApiContext.Provider>
    </QueryClientProvider>
  );
  const { rerender } = render(view(latest));
  return {
    follow: (crawl: Crawl | null) => rerender(view(crawl)),
    /** Until no read is on its way (an observable fact, never a fixed wait). */
    settled: () => waitFor(() => expect(queries.isFetching()).toBe(0)),
  };
}

const give = (api: FakeApi, url: string) =>
  api.request<Crawl>('POST', '/me/crawls', { url: `https://${url}` });

/** Each run's row as its cells' text. */
function rows(): string[][] {
  const table = screen.getByRole('table', { name: 'Your searches' });
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent ?? ''),
    );
}

const reads = (request: { mock: { calls: unknown[][] } }) =>
  request.mock.calls.filter(([, path]) => String(path).startsWith('/me/crawls?')).length;

describe('Search’s run history (#52)', () => {
  it('says there are none yet before the first link', async () => {
    renderHistory(createFakeApi({ delay: 0, crawlMs: 0 }), null);
    expect(await screen.findByText('No searches yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More searches' })).toBeNull();
  });

  it('lists each link given, newest first, with how it went', async () => {
    const api = createFakeApi({ delay: 0, crawlMs: 0 });
    await give(api, 'boards.greenhouse.io/acme');
    await give(api, 'unreachable.example.com/careers');
    await give(api, 'still-crawling.example.com/careers');
    renderHistory(api, null);
    await screen.findByRole('table', { name: 'Your searches' });
    const [working, failed, done] = rows();
    expect(working?.slice(2)).toEqual(['Reading', '—Not known', '—Not known']);
    expect(failed?.slice(2)).toEqual(['Failed', '—Not known', '—Not known']);
    expect(done?.[0]).toBe('boards.greenhouse.ioCareers page (opens in a new tab)');
    expect(done?.slice(2)).toEqual(['Done', '1', '12']);
    // Its link opens the page given, in a new tab.
    const link = screen.getByRole('link', { name: /^boards\.greenhouse\.io/ });
    expect(link.getAttribute('href')).toBe('https://boards.greenhouse.io/acme');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('pages with More searches, the focus on the first new run', async () => {
    const api = createFakeApi({ delay: 0, crawlMs: 0 });
    for (let i = 0; i < 23; i += 1) await give(api, `careers${i}.example.com`);
    renderHistory(api, null);
    await screen.findByRole('table', { name: 'Your searches' });
    expect(rows()).toHaveLength(20);
    expect(rows()[0]?.[0]).toMatch(/^careers22\.example\.com/);
    fireEvent.click(screen.getByRole('button', { name: 'More searches' }));
    await waitFor(() => expect(rows()).toHaveLength(23));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('link', { name: /^careers2\.example\.com/ }),
      ),
    );
    expect(screen.queryByRole('button', { name: 'More searches' })).toBeNull();
  });

  it('says when More searches fails, and keeps the runs shown', async () => {
    const api = createFakeApi({ delay: 0, crawlMs: 0 });
    for (let i = 0; i < 21; i += 1) await give(api, `careers${i}.example.com`);
    renderHistory(api, null);
    await screen.findByRole('table', { name: 'Your searches' });
    vi.spyOn(api, 'request').mockRejectedValueOnce(new ApiError('server', { status: 500 }));
    fireEvent.click(screen.getByRole('button', { name: 'More searches' }));
    expect(
      await screen.findByText('More searches didn’t load. Press More searches to try again.'),
    ).toBeTruthy();
    expect(rows()).toHaveLength(20);
  });

  it('keeps the newest row up with the run followed, reading again only for a new run', async () => {
    const api = createFakeApi({ delay: 0, crawlMs: 0 });
    const request = vi.spyOn(api, 'request');
    const first = await give(api, 'boards.greenhouse.io/acme');
    // The tab knows the newest run only after the history's first read: still one read.
    const { follow, settled } = renderHistory(api, undefined);
    await screen.findByRole('table', { name: 'Your searches' });
    follow(first);
    await settled();
    expect(reads(request)).toBe(1);
    // The run followed moves on: its row shows it, with no read.
    const { stats: _done, ...reading } = first;
    follow({ ...reading, status: 'running' });
    expect(rows()[0]?.[2]).toBe('Reading');
    await settled();
    expect(reads(request)).toBe(1);
    // A new link: its row shows at once, first, and the history is read again.
    const next = await give(api, 'still-crawling.example.com/careers');
    follow(next);
    expect(rows()).toHaveLength(2);
    expect(rows()[0]?.[0]).toMatch(/^still-crawling/);
    await waitFor(() => expect(reads(request)).toBe(2));
    await settled();
    expect(rows()).toHaveLength(2);
  });

  it('reads the history again while an older run in it is at work', async () => {
    // Its stages move on only when the test moves the fake's clock: no race with the real one.
    let t = Date.now();
    const api = createFakeApi({ delay: 0, crawlMs: 60_000, now: () => t });
    await give(api, 'boards.greenhouse.io/acme');
    renderHistory(api, null, 10);
    await screen.findByRole('table', { name: 'Your searches' });
    expect(rows()[0]?.[2]).toBe('Waiting');
    // It moves on with no new link given.
    t += 5 * 60_000;
    expect(await screen.findByText('Done')).toBeTruthy();
  });

  it('moves the focus to the heading when More searches brings nothing', async () => {
    const api = createFakeApi({ delay: 0, crawlMs: 0 });
    for (let i = 0; i < 21; i += 1) await give(api, `careers${i}.example.com`);
    const { settled } = renderHistory(api, null);
    await screen.findByRole('table', { name: 'Your searches' });
    // A page may come back with no runs and still say there may be more (the API stops after
    // so many reads); then none came.
    vi.spyOn(api, 'request')
      .mockResolvedValueOnce({ crawls: [], nextCursor: 'x' })
      .mockResolvedValueOnce({ crawls: [] });
    const first = screen.getByRole('button', { name: 'More searches' });
    // Not when the button is still there (it keeps the focus).
    first.focus();
    fireEvent.click(first);
    await waitFor(() => expect(api.request).toHaveBeenCalledTimes(1));
    await settled();
    expect(document.activeElement).toBe(first);
    fireEvent.click(first);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 2, name: 'Your searches' }),
      ),
    );
    expect(rows()).toHaveLength(20);
  });

  it('says when the runs could not be read, and tries again', async () => {
    const api = createFakeApi({ delay: 0, crawlMs: 0 });
    vi.spyOn(api, 'request').mockRejectedValueOnce(new ApiError('server', { status: 500 }));
    renderHistory(api, null);
    expect(await screen.findByText('Your searches didn’t load.', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No searches yet')).toBeTruthy();
  });
});

describe('nextRunsCheck (#52)', () => {
  const at = (crawlId: string, status: Crawl['status']): Crawl => ({
    crawlId,
    url: 'https://example.com',
    status,
    createdAt: new Date().toISOString(),
  });
  it('asks again only while a run other than the one followed is at work', () => {
    const pages = [{ crawls: [at('new', 'running'), at('old', 'succeeded')] }];
    expect(nextRunsCheck(pages, 'new', 15_000)).toBe(false);
    expect(nextRunsCheck(pages, undefined, 15_000)).toBe(15_000);
    expect(nextRunsCheck([{ crawls: [at('new', 'running'), at('old', 'queued')] }], 'new', 9)).toBe(
      9,
    );
    expect(nextRunsCheck(undefined, undefined, 9)).toBe(false);
  });
});
