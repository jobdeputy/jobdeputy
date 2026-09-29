import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Board } from '../src/jobs/boards.js';
import { FeedFormatError, parseFeed, workdayPostedAt } from '../src/jobs/feeds.js';
import { hashId } from '../src/jobs/job.js';

const NOW = new Date('2026-09-29T12:00:00Z');
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/jobs/${name}`, import.meta.url), 'utf8');

const greenhouse: Board = { ats: 'greenhouse', slug: 'acme' };
const lever: Board = { ats: 'lever', slug: 'acme', eu: false };
const ashby: Board = { ats: 'ashby', slug: 'acme' };
const workday: Board = {
  ats: 'workday',
  host: 'acme.wd5.myworkdayjobs.com',
  tenant: 'acme',
  site: 'External',
};

describe('Greenhouse', () => {
  it('reads the list: no descriptions, bad links and titles skipped, tracking dropped', () => {
    const page = parseFeed(greenhouse, fixture('greenhouse-list.json'), 0, NOW);
    expect(page.skipped).toBe(2);
    expect(page.nextOffset).toBeUndefined();
    expect(page.jobs).toEqual([
      {
        dedupeKey: 'ats:greenhouse:acme:4001001',
        jobId: hashId('ats:greenhouse:acme:4001001'),
        companyKey: 'greenhouse:acme',
        companyName: 'Acme Robotics',
        ats: 'greenhouse',
        externalId: '4001001',
        title: 'Backend Engineer',
        locations: [{ text: 'Dublin' }],
        jobUrl: 'https://job-boards.greenhouse.io/acme/jobs/4001001',
        postedAt: '2026-09-03T17:30:34.000Z',
        method: 'ats_feed',
      },
      expect.objectContaining({
        title: 'Data & ML Engineer',
        jobUrl: 'https://acme.example/careers?gh_jid=4001002',
        // No first_published: the last update stands in.
        postedAt: '2026-09-20T14:00:00.000Z',
      }),
    ]);
    expect(page.jobs[1]).not.toHaveProperty('description');
  });

  it('reads one posting with its escaped description as plain text', () => {
    const page = parseFeed(
      { ...greenhouse, job: '4001001' },
      fixture('greenhouse-job.json'),
      0,
      NOW,
    );
    expect(page.jobs).toHaveLength(1);
    expect(page.jobs[0]?.jobId).toBe(hashId('ats:greenhouse:acme:4001001'));
    expect(page.jobs[0]?.description).toBe(
      'Who we are\n\nAcme builds robots & tools.\n\n- Go\n- AWS',
    );
  });
});

describe('Lever', () => {
  it('reads postings with descriptions, lists, salary, and places', () => {
    const page = parseFeed(lever, fixture('lever-page.json'), 0, NOW);
    expect(page.skipped).toBe(0);
    // Fewer than a full page: the last one.
    expect(page.nextOffset).toBeUndefined();
    const [platform, intern] = page.jobs;
    expect(platform).toMatchObject({
      ats: 'lever',
      externalId: '6ed76ce8-4156-4b60-b120-403538bd0001',
      companyKey: 'lever:acme',
      title: 'Platform Engineer',
      // Two places: the single country code is not attached to either.
      locations: [{ text: 'London, United Kingdom' }, { text: 'Remote, United Kingdom' }],
      workplace: 'hybrid',
      employmentType: 'full_time',
      salary: { min: 90000, max: 120000, currency: 'GBP', period: 'year' },
      jobUrl: 'https://jobs.lever.co/acme/6ed76ce8-4156-4b60-b120-403538bd0001',
      applyUrl: 'https://jobs.lever.co/acme/6ed76ce8-4156-4b60-b120-403538bd0001/apply',
      postedAt: '2026-08-11T17:38:11.368Z',
    });
    expect(platform?.description).toBe(
      "Acme builds robots.\n\nYou will run our platform.\n\nWhat you'll do\n- Own the build system\n- Keep it fast\n\nWe welcome everyone.",
    );
    expect(intern).toMatchObject({
      locations: [{ text: 'Bengaluru', country: 'IN' }],
      workplace: 'onsite',
      employmentType: 'internship',
    });
  });

  it('asks for the next page after a full one', () => {
    const one = JSON.parse(fixture('lever-page.json'))[0];
    const full = Array.from({ length: 50 }, (_, i) => ({
      ...one,
      id: `6ed76ce8-4156-4b60-b120-${String(i).padStart(12, '0')}`,
      hostedUrl: `https://jobs.lever.co/acme/${i}`,
    }));
    const page = parseFeed(lever, JSON.stringify(full), 100, NOW);
    expect(page.jobs).toHaveLength(50);
    expect(page.nextOffset).toBe(150);
  });

  it('reads one posting, and never pages from it', () => {
    const one = JSON.parse(fixture('lever-page.json'))[0];
    const page = parseFeed({ ...lever, job: one.id }, JSON.stringify(one), 0, NOW);
    expect(page.jobs.map((j) => j.externalId)).toEqual([one.id]);
    expect(page.nextOffset).toBeUndefined();
  });
});

describe('Ashby', () => {
  it('reads listed jobs with structured places and salary; unlisted ones are left out', () => {
    const page = parseFeed(ashby, fixture('ashby-board.json'), 0, NOW);
    expect(page.jobs.map((j) => j.title)).toEqual([
      'Security Engineer, Cloud',
      'Contract Designer',
    ]);
    expect(page.jobs[0]).toMatchObject({
      locations: [
        { text: 'New York, NY (HQ)', city: 'New York', region: 'NY', country: 'US' },
        { text: 'Remote (Canada)', country: 'CA' },
      ],
      workplace: 'hybrid',
      employmentType: 'full_time',
      salary: { min: 211400, max: 290600, currency: 'USD', period: 'year' },
      description: 'ABOUT ACME\n\nAcme is building robots.',
      applyUrl: 'https://jobs.ashbyhq.com/acme/34413f8d-26bf-4bbc-8ade-eb309a0e0001/application',
    });
    expect(page.jobs[1]).toMatchObject({
      workplace: 'remote',
      employmentType: 'contract',
      description: 'Design things.',
    });
  });

  it('keeps only the posting a link pointed at', () => {
    const job = '34413f8d-26bf-4bbc-8ade-eb309a0e0003';
    const page = parseFeed({ ...ashby, job }, fixture('ashby-board.json'), 0, NOW);
    expect(page.jobs.map((j) => j.externalId)).toEqual([job]);
  });
});

describe('Workday', () => {
  it('reads the list: requisition IDs, relative dates, place counts dropped', () => {
    const page = parseFeed(workday, fixture('workday-list.json'), 0, NOW);
    expect(page.total).toBe(3);
    expect(page.nextOffset).toBeUndefined();
    expect(page.jobs.map((j) => [j.externalId, j.locations, j.postedAt])).toEqual([
      ['JR2000001', [{ text: 'US, CA, Santa Clara' }], '2026-09-29T00:00:00.000Z'],
      ['JR2000002', [], '2026-09-26T00:00:00.000Z'],
      ['JR2000003', [{ text: 'UK, Reading' }], undefined],
    ]);
    expect(page.jobs[0]?.jobUrl).toBe(
      'https://acme.wd5.myworkdayjobs.com/External/job/US-CA-Santa-Clara/Senior-EDA-Engineer_JR2000001',
    );
  });

  it('pages until the total, which only the first page gives', () => {
    const posting = JSON.parse(fixture('workday-list.json')).jobPostings[0];
    const postings = Array.from({ length: 20 }, (_, i) => ({
      ...posting,
      externalPath: `/job/X/Role_JR${i}`,
    }));
    expect(
      parseFeed(workday, JSON.stringify({ total: 45, jobPostings: postings }), 0, NOW).nextOffset,
    ).toBe(20);
    expect(
      parseFeed(workday, JSON.stringify({ total: 0, jobPostings: postings }), 20, NOW).nextOffset,
    ).toBe(40);
    expect(
      parseFeed(workday, JSON.stringify({ total: 40, jobPostings: postings }), 20, NOW).nextOffset,
    ).toBeUndefined();
  });

  it('one posting has the same job ID as in the list, plus its description', () => {
    const list = parseFeed(workday, fixture('workday-list.json'), 0, NOW);
    const one = parseFeed(
      { ...workday, job: 'IN-Bengaluru/Firmware-Engineer_JR2000002' },
      fixture('workday-job.json'),
      0,
      NOW,
    );
    expect(one.jobs[0]?.jobId).toBe(list.jobs[1]?.jobId);
    expect(one.jobs[0]).toMatchObject({
      companyName: 'Acme India',
      locations: [{ text: 'IN, Bengaluru' }, { text: 'IN, Hyderabad' }, { text: 'IN, Pune' }],
      employmentType: 'full_time',
      description: 'Acme builds chips.\n\n- C\n- Rust',
      postedAt: '2026-09-26T00:00:00.000Z',
    });
  });

  it.each([
    ['Posted Today', '2026-09-29T00:00:00.000Z'],
    ['Posted Yesterday', '2026-09-28T00:00:00.000Z'],
    ['Posted 7 Days Ago', '2026-09-22T00:00:00.000Z'],
    ['Posted 30+ Days Ago', undefined],
    ['soon', undefined],
    [42, undefined],
  ])('workdayPostedAt(%s)', (value, expected) => {
    expect(workdayPostedAt(value, NOW)).toBe(expected);
  });
});

describe('a feed that changed shape', () => {
  it.each<[Board, string]>([
    [greenhouse, '{"postings": []}'],
    [{ ...greenhouse, job: '1' }, '{"jobs": []}'],
    [lever, '{"data": []}'],
    [ashby, '[]'],
    [workday, '{"jobs": []}'],
    [{ ...workday, job: 'a/b_1' }, '{"jobPostings": []}'],
    [greenhouse, '<html>not json</html>'],
  ])('%j fails as a whole', (b, body) => {
    expect(() => parseFeed(b, body, 0, NOW)).toThrow(FeedFormatError);
  });

  it('wrong field types are skipped, not trusted', () => {
    const body = JSON.stringify({
      jobs: [
        { id: { $gt: 1 }, title: ['x'], absolute_url: 5 },
        {
          id: 7,
          title: 'Real',
          absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/7',
          location: 'Dublin',
        },
        'not an object',
      ],
    });
    const page = parseFeed(greenhouse, body, 0, NOW);
    expect(page.jobs.map((j) => [j.title, j.locations])).toEqual([['Real', []]]);
    expect(page.skipped).toBe(1);
  });

  it('the same posting listed twice is kept once', () => {
    const job = {
      id: 7,
      title: 'Real',
      absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/7',
    };
    const page = parseFeed(greenhouse, JSON.stringify({ jobs: [job, job] }), 0, NOW);
    expect(page.jobs).toHaveLength(1);
  });
});
