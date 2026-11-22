import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompanyList } from '../src/components/jobs/company-list.tsx';
import { ApiError } from '../src/lib/api/client.ts';
import { type Company, companyName, fitOf, type JobSummary } from '../src/lib/api/companies.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { ApiContext } from '../src/lib/api/index.ts';

afterEach(cleanup);

type FakeApi = ReturnType<typeof createFakeApi>;

function renderList(api: FakeApi) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queries}>
      <ApiContext.Provider value={api}>
        <CompanyList version="v1" />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
  return queries;
}

/** Crawls `url` on the fake to the end (its stages take no time). */
async function crawled(api: FakeApi, url: string) {
  await api.request('POST', '/me/crawls', { url });
}

const cards = () =>
  within(screen.getByRole('list', { name: 'Your companies' })).getAllByRole('article');

function describeCard(card: HTMLElement): string[] {
  const name = within(card).getByRole('heading', { level: 3 }).textContent;
  const rows = within(card)
    .getAllByRole('listitem')
    .map((row) => row.textContent ?? '');
  return [String(name), ...rows];
}

describe('Your companies (#49 PR C)', () => {
  it('says there are none yet before any link is read', async () => {
    renderList(createFakeApi({ delay: 0, crawlMs: 0 }));
    expect(await screen.findByText('No matches yet')).toBeTruthy();
    expect(
      screen.getByText('Paste a careers page above. The best roles at each company land here.'),
    ).toBeTruthy();
  });

  it('lists each company with its best jobs ranked, their fit, where, and a link to each posting', async () => {
    const api = createFakeApi({ delay: 0, crawlMs: 0 });
    await crawled(api, 'https://boards.greenhouse.io/acme');
    await crawled(api, 'https://jobs.lever.co/globex-labs/');
    renderList(api);
    await screen.findByRole('list', { name: 'Your companies' });
    expect(cards().map(describeCard)).toEqual([
      [
        'Globex labs',
        'Senior Backend EngineerStrong fitNew York, NY · Hybrid',
        'Platform Engineer, Developer ExperienceGood fitRemote, United States · Remote',
        'Staff Software Engineer, PaymentsStretchSan Francisco, CA · On-site',
      ],
      [
        'Acme',
        'Senior Backend EngineerStrong fitNew York, NY · Hybrid',
        'Platform Engineer, Developer ExperienceGood fitRemote, United States · Remote',
        'Staff Software Engineer, PaymentsStretchSan Francisco, CA · On-site',
      ],
    ]);
    const first = cards()[1] as HTMLElement;
    expect(within(first).getByText('Its best 3 roles')).toBeTruthy();
    // A job's title opens it beside the list (the preview), not the posting.
    const open = within(first).getByRole('button', { name: 'Senior Backend Engineer' });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    expect(open.getAttribute('aria-controls')).toBe('job-preview');
  });

  it('says a job is not scored yet when the AI has not scored it', async () => {
    const api = createFakeApi({ delay: 0, crawlMs: 0 });
    await crawled(api, 'https://no-ai.example.com/careers');
    renderList(api);
    await screen.findByRole('list', { name: 'Your companies' });
    expect(screen.getAllByText('Not scored yet')).toHaveLength(3);
  });

  it('says when the list could not be read, and reads it again', async () => {
    const api = createFakeApi({ delay: 0, crawlMs: 0 });
    const request = api.request.bind(api);
    const spy = vi.spyOn(api, 'request').mockRejectedValueOnce(new ApiError('server'));
    renderList(api);
    expect(await screen.findByText('Your matches didn’t load.')).toBeTruthy();
    spy.mockImplementation(request);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No matches yet')).toBeTruthy();
  });

  it('reads more companies on request, without listing one twice', async () => {
    const company = (key: string): Company => ({
      companyKey: key,
      companyName: key.toUpperCase(),
      jobs: [
        {
          jobId: key.padEnd(32, '0'),
          title: `Job at ${key}`,
          companyKey: key,
          locations: [],
          jobUrl: `https://${key}.example.com/1`,
          firstSeenAt: '2026-11-21T00:00:00.000Z',
        },
      ],
    });
    const request = vi.fn(async (_method: string, path: string) =>
      path.includes('cursor=next%2B1')
        ? // A crawl moved B across the cursor meanwhile: it comes again, and is shown once.
          { companies: [company('b'), company('c')] }
        : { companies: [company('a'), company('b')], nextCursor: 'next+1' },
    );
    const api = { request, upload: vi.fn() } as unknown as FakeApi;
    renderList(api);
    await screen.findByRole('list', { name: 'Your companies' });
    expect(cards().map((card) => within(card).getByRole('heading').textContent)).toEqual([
      'A',
      'B',
    ]);
    expect(request).toHaveBeenCalledWith('GET', '/me/companies?limit=10');
    fireEvent.click(screen.getByRole('button', { name: 'More companies' }));
    await waitFor(() =>
      expect(cards().map((card) => within(card).getByRole('heading').textContent)).toEqual([
        'A',
        'B',
        'C',
      ]),
    );
    expect(request).toHaveBeenCalledWith('GET', '/me/companies?limit=10&cursor=next%2B1');
    expect(screen.queryByRole('button', { name: 'More companies' })).toBeNull();
  });

  it('says when more companies did not load, and keeps the ones shown', async () => {
    const page1 = { companies: [{ companyKey: 'a', companyName: 'A', jobs: [] }], nextCursor: 'n' };
    const request = vi
      .fn()
      .mockResolvedValueOnce(page1)
      .mockRejectedValueOnce(new ApiError('server', { status: 500 }))
      .mockResolvedValueOnce({ companies: [{ companyKey: 'b', companyName: 'B', jobs: [] }] });
    renderList({ request, upload: vi.fn() } as unknown as FakeApi);
    await screen.findByRole('list', { name: 'Your companies' });
    fireEvent.click(screen.getByRole('button', { name: 'More companies' }));
    expect(
      await screen.findByText('More companies didn’t load. Press More companies to try again.'),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'A' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More companies' }));
    expect(await screen.findByRole('heading', { name: 'B' })).toBeTruthy();
    expect(
      screen.queryByText('More companies didn’t load. Press More companies to try again.'),
    ).toBeNull();
    // The focus went on to the first new company, not lost with the button.
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'B' }));
  });
});

describe('fit and names', () => {
  const scored = (score?: number): Pick<JobSummary, 'relevance'> =>
    score === undefined ? {} : { relevance: { score, reasons: [] } };

  it('reads the fit from the score: Strong 70+, Good 50–69, Stretch below', () => {
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
});
