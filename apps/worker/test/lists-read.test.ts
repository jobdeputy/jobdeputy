import { describe, expect, it, vi } from 'vitest';
import { FetchError, type FetchedPage } from '../src/fetch/fetcher.js';
import { LIST_FETCH_LIMITS, LISTINGS_PATH, readList } from '../src/lists/read-list.js';

const SOURCE = { kind: 'github' as const, owner: 'SimplifyJobs', repo: 'New-Grad-Positions' };
const RAW = 'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/HEAD/';

const page = (url: string, body: string): FetchedPage => ({
  url,
  status: 200,
  contentType: 'text/plain',
  charset: 'utf-8',
  body: new TextEncoder().encode(body),
  redirects: [],
});
const LISTINGS = JSON.stringify([
  { company_name: 'Acme', title: 'Engineer', url: 'https://jobs.lever.co/acme', locations: [] },
]);
const README =
  '| Company | Role |\n|---|---|\n| Acme | Engineer [Apply](https://jobs.lever.co/acme) |';

function site(files: Record<string, string>) {
  return vi.fn(async (url: string) => {
    const body = files[url];
    if (body === undefined) throw new FetchError('not_found', false);
    return page(url, body);
  });
}

describe('readList (#50)', () => {
  it('reads the Simplify listings file from the default branch when the list has one', async () => {
    const fetch = site({ [`${RAW}${LISTINGS_PATH}`]: LISTINGS });
    const reading = await readList(SOURCE, fetch);
    expect(reading.format).toBe('listings');
    expect(reading.rows.map((r) => r.company)).toEqual(['Acme']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the README when there is no listings file, or it is not that format', async () => {
    for (const listings of [undefined, '{"not":"a list"}', 'not json']) {
      const fetch = site({
        ...(listings !== undefined ? { [`${RAW}${LISTINGS_PATH}`]: listings } : {}),
        [`${RAW}README.md`]: README,
      });
      const reading = await readList(SOURCE, fetch);
      expect(reading.format).toBe('readme');
      expect(reading.rows).toHaveLength(1);
    }
  });

  it('fails with not_a_list when neither holds roles', async () => {
    for (const files of [{}, { [`${RAW}README.md`]: '# A library\n\nNo roles.' }]) {
      await expect(readList(SOURCE, site(files))).rejects.toMatchObject({
        code: 'not_a_list',
        retriable: false,
      });
    }
  });

  it("lets any other failure be the crawl's (retried or not, by the fetcher's rules)", async () => {
    const fetch = vi.fn(async () => {
      throw new FetchError('unreachable', true);
    });
    await expect(readList(SOURCE, fetch)).rejects.toMatchObject({ code: 'unreachable' });
  });

  it("reads the test site's list as a listings file (dev stacks)", async () => {
    const url = 'https://abc.execute-api.us-east-1.amazonaws.com/test-site/list-simplify';
    const reading = await readList({ kind: 'test', url }, site({ [url]: LISTINGS }));
    expect(reading.rows).toHaveLength(1);
    await expect(readList({ kind: 'test', url }, site({ [url]: '[]' }))).rejects.toMatchObject({
      code: 'not_a_list',
    });
  });

  it('allows a list file of up to 25 MB, read within 60 s', () => {
    expect(LIST_FETCH_LIMITS.maxBytes).toBe(25 * 1024 * 1024);
    expect(LIST_FETCH_LIMITS.totalTimeoutMs).toBe(60_000);
  });
});
