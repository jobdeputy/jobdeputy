import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompanyList } from '../src/components/jobs/company-list.tsx';
import { ApiError } from '../src/lib/api/client.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { ApiContext } from '../src/lib/api/index.ts';

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

/** The list after one finished crawl of Acme's board (its three jobs). */
async function renderList(api: FakeApi = createFakeApi({ delay: 0, crawlMs: 0 })) {
  await api.request('POST', '/me/crawls', { url: 'https://boards.greenhouse.io/acme' });
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queries}>
      <ApiContext.Provider value={api}>
        <CompanyList version="v1" />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
  await screen.findByRole('article', { name: 'Acme' });
  return api;
}

const openJob = (title: string) => fireEvent.click(screen.getByRole('button', { name: title }));
const preview = () => within(screen.getByRole('region', { name: 'Senior Backend Engineer' }));

describe('a job’s preview (#49 PR D)', () => {
  it('opens beside the list on a wide screen: the job, its fit and score, why, and the posting', async () => {
    screenWide(true);
    await renderList();
    openJob('Senior Backend Engineer');
    const pane = preview();
    // Its title takes the focus, so the change is read out.
    expect(document.activeElement).toBe(
      pane.getByRole('heading', { level: 2, name: 'Senior Backend Engineer' }),
    );
    expect(pane.getByText('Acme · New York, NY · Hybrid')).toBeTruthy();
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
    // The list stays, the open job marked.
    const row = screen.getByRole('button', { name: 'Senior Backend Engineer' });
    expect(row.getAttribute('aria-expanded')).toBe('true');
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
    // The list waits behind it (hidden, so it is neither seen nor read).
    expect(screen.queryByRole('article', { name: 'Acme' })).toBeNull();
    fireEvent.click(preview().getByRole('button', { name: /Back to your companies/ }));
    expect(await screen.findByRole('article', { name: 'Acme' })).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Senior Backend Engineer' }),
      ),
    );
  });

  it('says when the board shared no text, and when the AI gave no reasons', async () => {
    screenWide(true);
    const api = createFakeApi({ delay: 0, crawlMs: 0 });
    await api.request('POST', '/me/crawls', { url: 'https://no-ai.example.com/careers' });
    await renderList(api);
    const careers = await screen.findByRole('article', { name: 'Careers' });
    fireEvent.click(
      within(careers).getByRole('button', { name: 'Staff Software Engineer, Payments' }),
    );
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

  it('closes again when the open job’s title is pressed (the title toggles)', async () => {
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
      const answer = (await request(method, path, body)) as {
        companies?: { jobs: Record<string, unknown>[] }[];
      };
      if (String(path).startsWith('/me/companies')) {
        for (const company of answer.companies ?? []) company.jobs.forEach(change);
      }
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
    const api = createFakeApi({ delay: 0, crawlMs: 0 });
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      const answer = (await request(method, path, body)) as {
        companies?: { jobs: Record<string, unknown>[] }[];
      };
      if (String(path).startsWith('/me/companies')) {
        for (const company of answer.companies ?? []) {
          for (const job of company.jobs) job.postedAt = '2026-11-03T00:00:00.000Z';
        }
      }
      return answer as never;
    });
    await renderList(api);
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

  it('shows another job when its title is pressed, its title taking the focus', async () => {
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
