import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchesList } from '../src/components/jobs/matches-list.tsx';
import { ApiError } from '../src/lib/api/client.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { ApiContext } from '../src/lib/api/index.ts';
import { companyName, fitOf } from '../src/lib/api/jobs.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type FakeApi = ReturnType<typeof createFakeApi>;

/** A screen as wide as `wide` says (Tailwind's xl: list and preview side by side). */
function screenWide(wide: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: wide && query === '(min-width: 80rem)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

/** Matches after one finished crawl of `url` (Acme's board: its three jobs). */
async function renderList(
  api: FakeApi = createFakeApi({ delay: 0, crawlMs: 0 }),
  url = 'https://boards.greenhouse.io/acme',
) {
  await api.request('POST', '/me/crawls', { url });
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queries}>
      <ApiContext.Provider value={api}>
        <MatchesList version="v1" />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Staff Software Engineer, Payments' });
  return api;
}

const openJob = (title: string) => fireEvent.click(screen.getByRole('button', { name: title }));
const preview = () => within(screen.getByRole('region', { name: 'Senior Backend Engineer' }));

describe('a job’s pane (#49 PR D, in Matches since #52 PR C)', () => {
  it('opens beside the list on a wide screen: the job, its fit and score, why, and the posting', async () => {
    screenWide(true);
    await renderList();
    openJob('Senior Backend Engineer');
    const pane = preview();
    // Its title takes the focus, so the change is read out.
    expect(document.activeElement).toBe(
      pane.getByRole('heading', { level: 2, name: 'Senior Backend Engineer' }),
    );
    expect(pane.getByText('Acme · New York, NY · Hybrid · Posted Nov 20, 2026')).toBeTruthy();
    expect(pane.getByText('Strong fit')).toBeTruthy();
    expect(pane.getByText('Scored 86 of 100 against your roles.')).toBeTruthy();
    expect(
      within(pane.getByRole('list'))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Matches your target role Backend engineer', 'Asks for TypeScript and AWS']);
    // The posting's text, read when the job opens, as text with its lines.
    expect(await pane.findByText(/Design and run TypeScript services on AWS/)).toBeTruthy();
    const link = pane.getByRole('link', { name: 'Open the posting (opens in a new tab)' });
    expect(link.getAttribute('href')).toBe('https://boards.greenhouse.io/acme/jobs/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    // The table stays, the open job's row marked.
    const row = screen.getByRole('button', { name: 'Senior Backend Engineer' });
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(row.closest('tr')?.hasAttribute('data-open')).toBe(true);
    // Close: the preview goes, and the focus goes back to its row.
    fireEvent.click(pane.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Senior Backend Engineer' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(row.getAttribute('aria-expanded')).toBe('false');
  });

  it('is a view of its own on a narrower screen, with a way back to the list', async () => {
    screenWide(false);
    await renderList();
    openJob('Senior Backend Engineer');
    // The table waits behind it (hidden, so it is neither seen nor read).
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(preview().getByRole('button', { name: /Back to Matches/ }));
    expect(await screen.findByRole('table', { name: 'Your matches' })).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Senior Backend Engineer' }),
      ),
    );
  });

  it('says when the board shared no text, and when the AI gave no reasons', async () => {
    screenWide(true);
    await renderList(undefined, 'https://no-ai.example.com/careers');
    openJob('Staff Software Engineer, Payments');
    const pane = within(screen.getByRole('region', { name: 'Staff Software Engineer, Payments' }));
    expect(
      await pane.findByText(
        'The job board didn’t share this posting’s text. Open it on their site.',
      ),
    ).toBeTruthy();
    expect(pane.getByText('Not scored yet')).toBeTruthy();
    expect(
      pane.getByText('Your deputy ranked this one by keywords only: it has no AI reasons yet.'),
    ).toBeTruthy();
  });

  it('says when the posting did not load, and reads it again', async () => {
    screenWide(true);
    const api = await renderList();
    const request = api.request.bind(api);
    const spy = vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (String(path).startsWith('/me/jobs/')) throw new ApiError('server', { status: 500 });
      return request(method, path, body);
    });
    openJob('Senior Backend Engineer');
    expect(await preview().findByText('The posting didn’t load.')).toBeTruthy();
    spy.mockImplementation(request);
    fireEvent.click(preview().getByRole('button', { name: 'Try again' }));
    expect(await preview().findByText(/Design and run TypeScript services on AWS/)).toBeTruthy();
  });

  it('closes again when the open job’s row is pressed (the row toggles)', async () => {
    screenWide(true);
    await renderList();
    openJob('Senior Backend Engineer');
    const row = screen.getByRole('button', { name: 'Senior Backend Engineer' });
    fireEvent.click(row);
    expect(screen.queryByRole('region', { name: 'Senior Backend Engineer' })).toBeNull();
    expect(row.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it('does not read a posting the board shared no text for', async () => {
    screenWide(true);
    const api = await renderList();
    const request = vi.spyOn(api, 'request');
    openJob('Staff Software Engineer, Payments');
    expect(
      screen.getByText('The job board didn’t share this posting’s text. Open it on their site.'),
    ).toBeTruthy();
    expect(request.mock.calls.filter(([, path]) => String(path).startsWith('/me/jobs/'))).toEqual(
      [],
    );
  });

  it('keeps the list’s copy of the job (read again when a crawl ends); the read adds the text', async () => {
    screenWide(true);
    const api = await renderList();
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      const answer = (await request(method, path, body)) as Record<string, unknown>;
      return (
        String(path).startsWith('/me/jobs/')
          ? { ...answer, relevance: { score: 12, reasons: ['An older score'] } }
          : answer
      ) as never;
    });
    openJob('Senior Backend Engineer');
    expect(await preview().findByText(/Design and run TypeScript services on AWS/)).toBeTruthy();
    expect(preview().getByText('Scored 86 of 100 against your roles.')).toBeTruthy();
    expect(preview().queryByText('An older score')).toBeNull();
  });

  /** A fake whose list says something else about every job. */
  function listWith(change: (job: Record<string, unknown>) => void) {
    const api = createFakeApi({ delay: 0, crawlMs: 0 });
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      const answer = (await request(method, path, body)) as { jobs?: Record<string, unknown>[] };
      if (path === '/me/matches') answer.jobs?.forEach(change);
      return answer as never;
    });
    return api;
  }

  it('reads a posting time where the reader is (8 pm in New York is that day there)', async () => {
    screenWide(true);
    // The tests run in New York (vite.config.ts): 01:00 UTC on the 4th is 8 pm on the 3rd.
    await renderList(
      listWith((job) => {
        job.postedAt = '2026-11-04T01:00:00.000Z';
      }),
    );
    openJob('Senior Backend Engineer');
    expect(preview().getByText('Acme · New York, NY · Hybrid · Posted Nov 3, 2026')).toBeTruthy();
  });

  it('says when the AI scored a job without giving its reasons', async () => {
    screenWide(true);
    await renderList(
      listWith((job) => {
        job.relevance = { score: 82, reasons: [] };
      }),
    );
    openJob('Senior Backend Engineer');
    expect(preview().getByText('The AI scored it without giving its reasons.')).toBeTruthy();
    expect(preview().queryByText(/by keywords only/)).toBeNull();
  });

  it('reads a date-only posting date as the day it was posted, wherever the reader is', async () => {
    screenWide(true);
    await renderList(
      listWith((job) => {
        job.postedAt = '2026-11-03T00:00:00.000Z';
      }),
    );
    openJob('Senior Backend Engineer');
    expect(preview().getByText('Acme · New York, NY · Hybrid · Posted Nov 3, 2026')).toBeTruthy();
  });

  it('says a job taken down since is gone, with nothing to try again', async () => {
    screenWide(true);
    const api = await renderList();
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (String(path).startsWith('/me/jobs/')) throw new ApiError('not-found', { status: 404 });
      return request(method, path, body);
    });
    openJob('Senior Backend Engineer');
    expect(await preview().findByText('This job isn’t on its board any more.')).toBeTruthy();
    expect(preview().queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows another job when its row is pressed, its title taking the focus', async () => {
    screenWide(true);
    await renderList();
    openJob('Senior Backend Engineer');
    openJob('Platform Engineer, Developer Experience');
    expect(screen.queryByRole('region', { name: 'Senior Backend Engineer' })).toBeNull();
    const pane = within(
      screen.getByRole('region', { name: 'Platform Engineer, Developer Experience' }),
    );
    expect(document.activeElement).toBe(pane.getByRole('heading', { level: 2 }));
    expect(pane.getByText('Good fit')).toBeTruthy();
  });
});

describe('Matches’ table (#52 PR C)', () => {
  /** The rows' cells, top to bottom, as text. */
  const rowTexts = () =>
    within(screen.getByRole('table', { name: 'Your matches' }))
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      );

  it('lists each job: title, company, where, fit and posted, best fit first', async () => {
    screenWide(true);
    await renderList();
    expect(rowTexts()).toEqual([
      ['Senior Backend Engineer', 'Acme', 'New York, NY · Hybrid', 'Strong fit', 'Nov 20, 2026'],
      [
        'Platform Engineer, Developer Experience',
        'Acme',
        'Remote, United States · Remote',
        'Good fit',
        'Nov 12, 2026',
      ],
      [
        'Staff Software Engineer, Payments',
        'Acme',
        'San Francisco, CA · On-site',
        'Stretch',
        'Not given',
      ],
    ]);
    const fit = screen.getByRole('columnheader', { name: /Fit/ });
    expect(fit.getAttribute('aria-sort')).toBe('descending');
  });

  it('sorts by when a job was posted, newest first, a job with no date last', async () => {
    screenWide(true);
    await renderList();
    fireEvent.click(screen.getByRole('button', { name: /^Posted/ }));
    expect(rowTexts().map((cells) => cells[4])).toEqual([
      'Nov 20, 2026',
      'Nov 12, 2026',
      'Not given',
    ]);
    fireEvent.click(screen.getByRole('button', { name: /^Posted/ }));
    expect(rowTexts().map((cells) => cells[4])).toEqual([
      'Nov 12, 2026',
      'Nov 20, 2026',
      'Not given',
    ]);
  });

  it('points to Search when there are no matches', async () => {
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queries}>
        <ApiContext.Provider value={createFakeApi({ delay: 0, crawlMs: 0 })}>
          <MatchesList version="v1" />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('No matches yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to Search' }).getAttribute('href')).toBe('/search');
  });

  it('says a job is not scored yet when the AI has not scored it', async () => {
    screenWide(true);
    await renderList(undefined, 'https://no-ai.example.com/careers');
    expect(screen.getAllByText('Not scored yet')).toHaveLength(3);
  });

  it('says when Matches could not be read, and reads it again', async () => {
    const api = createFakeApi({ delay: 0, crawlMs: 0 });
    const request = api.request.bind(api);
    const spy = vi.spyOn(api, 'request').mockRejectedValueOnce(new ApiError('server'));
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queries}>
        <ApiContext.Provider value={api}>
          <MatchesList version="v1" />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Your matches didn’t load.')).toBeTruthy();
    spy.mockImplementation(request);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No matches yet')).toBeTruthy();
  });

  it('reads the fit from the score: Strong 70+, Good 50–69, Stretch below', () => {
    const scored = (score?: number) =>
      score === undefined ? {} : { relevance: { score, reasons: [] } };
    expect([100, 70, 69, 50, 49, 30, 0].map((s) => fitOf(scored(s)))).toEqual([
      'strong',
      'strong',
      'good',
      'good',
      'stretch',
      'stretch',
      'stretch',
    ]);
    expect(fitOf(scored())).toBe('unscored');
  });

  it("names a company by its own name, else its board's slug", () => {
    expect(companyName({ companyKey: 'greenhouse:acme', companyName: 'Acme Inc.' })).toBe(
      'Acme Inc.',
    );
    expect(companyName({ companyKey: 'greenhouse:acme' })).toBe('acme');
  });

  it('says when it shows only the best of more matches than it can', async () => {
    screenWide(true);
    const api = createFakeApi({ delay: 0, crawlMs: 0 });
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      const answer = await request(method, path, body);
      return (
        path === '/me/matches' ? { ...(answer as object), truncated: true } : answer
      ) as never;
    });
    await renderList(api);
    expect(screen.getByText('Showing your best 3 matches.')).toBeTruthy();
  });
});

describe('applying from the job’s pane (#52 PR C)', () => {
  const stageCalls = (request: { mock: { calls: unknown[][] } }) =>
    request.mock.calls.filter(([method]) => method === 'PUT');

  it('opens the apply page, asks if you applied, and Not yet puts the question away', async () => {
    screenWide(true);
    await renderList();
    openJob('Senior Backend Engineer');
    const manual = preview().getByRole('link', { name: /^Manual apply/ });
    // The board's own application page, when it has one, in a new tab.
    expect(manual.getAttribute('href')).toBe('https://boards.greenhouse.io/acme/jobs/1/apply');
    expect(manual.getAttribute('target')).toBe('_blank');
    expect(manual.getAttribute('rel')).toBe('noopener noreferrer');
    expect(
      preview().queryByRole('group', { name: 'Did you apply on the employer site?' }),
    ).toBeNull();
    fireEvent.click(manual);
    const question = preview().getByRole('group', { name: 'Did you apply on the employer site?' });
    // The first thing met on coming back.
    expect(document.activeElement).toBe(question);
    fireEvent.click(within(question).getByRole('button', { name: 'Not yet' }));
    expect(preview().queryByRole('group')).toBeNull();
    expect(document.activeElement).toBe(manual);
  });

  it('opens the posting itself when the board has no apply page', async () => {
    screenWide(true);
    await renderList();
    openJob('Platform Engineer, Developer Experience');
    const pane = within(
      screen.getByRole('region', { name: 'Platform Engineer, Developer Experience' }),
    );
    expect(pane.getByRole('link', { name: /^Manual apply/ }).getAttribute('href')).toBe(
      'https://boards.greenhouse.io/acme/jobs/2',
    );
  });

  it('shows Auto apply as unavailable for now, saying why', async () => {
    screenWide(true);
    await renderList();
    openJob('Senior Backend Engineer');
    const auto = preview().getByRole('button', { name: /^Auto apply/ });
    expect(auto.getAttribute('aria-disabled')).toBe('true');
    expect(auto.textContent).toContain('Soon');
    const hint = document.getElementById(auto.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toMatch(/browser extension/);
  });

  it('I applied: marks it applied, it leaves Matches, and Undo brings it back', async () => {
    screenWide(true);
    const api = await renderList();
    const request = vi.spyOn(api, 'request');
    openJob('Senior Backend Engineer');
    fireEvent.click(preview().getByRole('link', { name: /^Manual apply/ }));
    fireEvent.click(preview().getByRole('button', { name: 'I applied' }));
    const said = await screen.findByText(
      'Marked as applied: Senior Backend Engineer at Acme. It left Matches.',
    );
    expect(stageCalls(request)).toEqual([
      ['PUT', '/me/jobs/00aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/stage', { stage: 'applied', from: 'new' }],
    ]);
    // Out of the table and the pane closed; the line saying so has the focus.
    expect(screen.queryByRole('region', { name: 'Senior Backend Engineer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Senior Backend Engineer' })).toBeNull();
    expect(document.activeElement).toBe(said);
    // Still out once the list is read again (the API has it applied).
    await waitFor(() =>
      expect(request.mock.calls.filter(([, path]) => path === '/me/matches').length).toBe(1),
    );
    expect(screen.queryByRole('button', { name: 'Senior Backend Engineer' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    const back = await screen.findByText('Senior Backend Engineer at Acme is back in Matches.');
    expect(stageCalls(request)[1]?.[2]).toEqual({ stage: 'new', from: 'applied' });
    expect(screen.getByRole('button', { name: 'Senior Backend Engineer' })).toBeTruthy();
    expect(document.activeElement).toBe(back);
  });

  it('takes the job out at once, before the list is read again', async () => {
    screenWide(true);
    const api = await renderList();
    const request = api.request.bind(api);
    // Once it is saved, the list's next read never answers.
    let saved = false;
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (saved && path === '/me/matches') return new Promise(() => {});
      const answer = await request(method, path, body);
      if (method === 'PUT') saved = true;
      return answer;
    });
    openJob('Senior Backend Engineer');
    fireEvent.click(preview().getByRole('link', { name: /^Manual apply/ }));
    fireEvent.click(preview().getByRole('button', { name: 'I applied' }));
    await screen.findByText(/^Marked as applied/);
    expect(screen.queryByRole('button', { name: 'Senior Backend Engineer' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Platform Engineer, Developer Experience' }),
    ).toBeTruthy();
  });

  it('says when it did not save, keeping the question to try again', async () => {
    screenWide(true);
    const api = await renderList();
    const request = api.request.bind(api);
    const spy = vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method === 'PUT') throw new ApiError('offline');
      return request(method, path, body);
    });
    openJob('Senior Backend Engineer');
    fireEvent.click(preview().getByRole('link', { name: /^Manual apply/ }));
    fireEvent.click(preview().getByRole('button', { name: 'I applied' }));
    await waitFor(() =>
      expect(preview().getByRole('alert').textContent).toBe(
        'You’re offline, so that didn’t save. Try again once you’re back online.',
      ),
    );
    spy.mockImplementation(async (method, path, body) => {
      if (method === 'PUT') throw new ApiError('server', { status: 500 });
      return request(method, path, body);
    });
    fireEvent.click(preview().getByRole('button', { name: 'I applied' }));
    await waitFor(() =>
      expect(preview().getByRole('alert').textContent).toBe('That didn’t save. Try again.'),
    );
    spy.mockImplementation(request);
    fireEvent.click(preview().getByRole('button', { name: 'I applied' }));
    expect(await screen.findByText(/^Marked as applied: Senior Backend Engineer/)).toBeTruthy();
  });

  it('closes, saying why, when the job was applied to elsewhere meanwhile', async () => {
    screenWide(true);
    const api = await renderList();
    openJob('Senior Backend Engineer');
    fireEvent.click(preview().getByRole('link', { name: /^Manual apply/ }));
    // Another tab marks it applied first: this one is refused (409), and the list is read again.
    await api.request('PUT', '/me/jobs/00aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/stage', {
      stage: 'applied',
      from: 'new',
    });
    fireEvent.click(preview().getByRole('button', { name: 'I applied' }));
    const said = await screen.findByText(
      'The job you had open is no longer in Matches: it was marked as applied elsewhere, or its posting closed.',
    );
    expect(screen.queryByRole('region', { name: 'Senior Backend Engineer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(document.activeElement).toBe(said);
  });

  it('says when Undo did not work, keeping it to try again', async () => {
    screenWide(true);
    const api = await renderList();
    openJob('Senior Backend Engineer');
    fireEvent.click(preview().getByRole('link', { name: /^Manual apply/ }));
    fireEvent.click(preview().getByRole('button', { name: 'I applied' }));
    await screen.findByText(/^Marked as applied/);
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method === 'PUT') throw new ApiError('server', { status: 500 });
      return request(method, path, body);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Couldn’t undo that. Try again.'),
    );
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });
});
