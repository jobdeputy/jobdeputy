import { describe, expect, it } from 'vitest';
import type { ListRow } from '../src/lists/parse.js';
import { boardUrl, pickCompanies } from '../src/lists/pick-companies.js';
import type { FilterProfile, FilterRole } from '../src/relevance/code-filter.js';

const role = (title: string, priority = 50): FilterRole => ({
  roleId: title,
  title,
  altTitles: [],
  seniority: [],
  exclude: [],
  priority,
});
const PROFILE: FilterProfile = { roles: [role('Software Engineer')], skills: [] };
const row = (company: string, link: string, over: Partial<ListRow> = {}): ListRow => ({
  company,
  title: 'Software Engineer',
  locations: ['San Francisco, CA'],
  links: [link],
  ...over,
});
const GH = (slug: string, job = '1') => `https://job-boards.greenhouse.io/${slug}/jobs/${job}`;

describe('pickCompanies (#50)', () => {
  it("ranks companies by their matching roles and crawls each one's whole board", () => {
    const picked = pickCompanies(
      [
        row('Beta', GH('beta')),
        row('Acme', GH('acme', '1')),
        row('Acme', GH('acme', '2')),
        row('Acme', GH('acme', '3'), { title: 'Office Manager' }),
      ],
      PROFILE,
      20,
    );
    expect(picked).toEqual({
      rows: 4,
      matched: 3,
      companiesMatched: 2,
      skipped: 0,
      companies: [
        {
          name: 'Acme',
          url: 'https://job-boards.greenhouse.io/acme',
          boardKey: 'greenhouse:acme',
          matches: 2,
        },
        {
          name: 'Beta',
          url: 'https://job-boards.greenhouse.io/beta',
          boardKey: 'greenhouse:beta',
          matches: 1,
        },
      ],
    });
  });

  it("breaks ties by the best role's priority, then the newest role, then the name", () => {
    const profile: FilterProfile = {
      roles: [role('Software Engineer', 40), role('Data Engineer', 90)],
      skills: [],
    };
    const picked = pickCompanies(
      [
        row('Zed', GH('zed'), { postedAt: 10 }),
        row('Old', GH('old'), { postedAt: 1 }),
        row('Yon', GH('yon'), { postedAt: 10 }),
        row('Data', GH('data'), { title: 'Data Engineer', postedAt: 1 }),
      ],
      profile,
      20,
    );
    expect(picked.companies.map((c) => c.name)).toEqual(['Data', 'Yon', 'Zed', 'Old']);
  });

  it('counts only roles in the US, or with places it cannot tell', () => {
    const picked = pickCompanies(
      [
        row('Canada', GH('canada'), { locations: ['Toronto, ON'] }),
        row('RemoteCa', GH('remoteca'), { locations: ['Remote in Canada'] }),
        row('RemoteUs', GH('remoteus'), { locations: ['Remote in USA'] }),
        row('Mixed', GH('mixed'), { locations: ['London, UK', 'Austin, TX'] }),
        row('Anywhere', GH('anywhere'), { locations: [] }),
        row('Vague', GH('vague'), { locations: ['Remote'] }),
      ],
      PROFILE,
      20,
    );
    expect(picked.companies.map((c) => c.name).sort()).toEqual([
      'Anywhere',
      'Mixed',
      'RemoteUs',
      'Vague',
    ]);
  });

  it('skips and counts companies whose site we cannot read; the cap counts readable ones only', () => {
    const picked = pickCompanies(
      [
        row('Big', 'https://careers.big.example/jobs/1'),
        row('Big', 'https://careers.big.example/jobs/2'),
        row('Big', 'https://careers.big.example/jobs/3'),
        row('Acme', GH('acme')),
        row('Acme', GH('acme', '2')),
        row('Beta', GH('beta')),
        row('Gamma', GH('gamma')),
      ],
      PROFILE,
      2,
    );
    expect(picked.companies.map((c) => c.name)).toEqual(['Acme', 'Beta']);
    // Big ranked above the cut; Gamma is below it and not counted.
    expect(picked.skipped).toBe(1);
  });

  it("uses the board most of a company's matching roles link to, and crawls a board once", () => {
    const picked = pickCompanies(
      [
        row('Acme', 'https://jobs.lever.co/acme/0a654eeb-ff73-4b76-839e-172219e789e4'),
        row('Acme', 'https://jobs.ashbyhq.com/acme/1d0e7d9e-9f6a-4c8e-8a7b-111111111111'),
        row('Acme', 'https://jobs.ashbyhq.com/acme'),
        row('Acme Inc', 'https://jobs.ashbyhq.com/acme'),
      ],
      PROFILE,
      20,
    );
    expect(picked.companies).toEqual([
      { name: 'Acme', url: 'https://jobs.ashbyhq.com/acme', boardKey: 'ashby:acme', matches: 3 },
    ]);
  });

  it("takes the first board among a row's links, and ignores links we never crawl", () => {
    const picked = pickCompanies(
      [
        row('Acme', 'http://10.0.0.1/jobs', {
          links: ['https://www.linkedin.com/jobs/1', 'not a url', GH('acme'), GH('other')],
        }),
      ],
      PROFILE,
      20,
    );
    expect(picked.companies[0]?.url).toBe('https://job-boards.greenhouse.io/acme');
  });

  it("treats the test site's links as company sites when given its host (dev stacks)", () => {
    const host = 'abc.execute-api.us-east-1.amazonaws.com';
    const site = `https://${host}/test-site/jobs-second`;
    const picked = pickCompanies([row('Example', site)], PROFILE, 20, { testHost: host });
    expect(picked.companies).toEqual([
      { name: 'Example', url: site, boardKey: `test:${site}`, matches: 1 },
    ]);
    expect(pickCompanies([row('Example', site)], PROFILE, 20).skipped).toBe(1);
  });
});

describe('boardUrl (#50)', () => {
  it("is the board's own page for every board we read", () => {
    expect(boardUrl({ ats: 'greenhouse', slug: 'acme' })).toBe(
      'https://job-boards.greenhouse.io/acme',
    );
    expect(boardUrl({ ats: 'lever', slug: 'acme', eu: true })).toBe(
      'https://jobs.eu.lever.co/acme',
    );
    expect(boardUrl({ ats: 'lever', slug: 'acme', eu: false })).toBe('https://jobs.lever.co/acme');
    expect(boardUrl({ ats: 'ashby', slug: 'acme' })).toBe('https://jobs.ashbyhq.com/acme');
    expect(
      boardUrl({
        ats: 'workday',
        host: 'acme.wd5.myworkdayjobs.com',
        tenant: 'acme',
        site: 'External',
      }),
    ).toBe('https://acme.wd5.myworkdayjobs.com/External');
    expect(
      boardUrl({ ats: 'workday', host: 'wd3.myworkdaysite.com', tenant: 'acme', site: 'Careers' }),
    ).toBe('https://wd3.myworkdaysite.com/recruiting/acme/Careers');
  });
});
