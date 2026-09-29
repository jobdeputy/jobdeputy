import { describe, expect, it } from 'vitest';
import {
  type Board,
  boardFromHtml,
  boardFromUrl,
  boardKey,
  FEED_PAGE_SIZE,
  feedRequest,
} from '../src/jobs/boards.js';

const board = (url: string) => boardFromUrl(new URL(url));

describe('boardFromUrl', () => {
  it.each<[string, Board]>([
    ['https://boards.greenhouse.io/acme', { ats: 'greenhouse', slug: 'acme' }],
    ['https://job-boards.greenhouse.io/acme?utm_source=x', { ats: 'greenhouse', slug: 'acme' }],
    [
      'https://job-boards.greenhouse.io/acme/jobs/4001001',
      { ats: 'greenhouse', slug: 'acme', job: '4001001' },
    ],
    [
      'https://boards.greenhouse.io/embed/job_board?for=acme&b=https%3A%2F%2Facme.example',
      { ats: 'greenhouse', slug: 'acme' },
    ],
    [
      'https://boards.greenhouse.io/embed/job_app?for=acme&token=4001001',
      { ats: 'greenhouse', slug: 'acme', job: '4001001' },
    ],
    ['https://boards-api.greenhouse.io/v1/boards/acme/jobs', { ats: 'greenhouse', slug: 'acme' }],
    ['https://jobs.lever.co/acme', { ats: 'lever', slug: 'acme', eu: false }],
    [
      'https://jobs.lever.co/acme/6ed76ce8-4156-4b60-b120-403538bd0001/apply',
      { ats: 'lever', slug: 'acme', eu: false, job: '6ed76ce8-4156-4b60-b120-403538bd0001' },
    ],
    ['https://jobs.eu.lever.co/acme', { ats: 'lever', slug: 'acme', eu: true }],
    ['https://api.lever.co/v0/postings/acme?mode=json', { ats: 'lever', slug: 'acme', eu: false }],
    ['https://jobs.ashbyhq.com/acme', { ats: 'ashby', slug: 'acme' }],
    [
      'https://jobs.ashbyhq.com/acme/34413f8d-26bf-4bbc-8ade-eb309a0e0001/application',
      { ats: 'ashby', slug: 'acme', job: '34413f8d-26bf-4bbc-8ade-eb309a0e0001' },
    ],
    ['https://api.ashbyhq.com/posting-api/job-board/acme', { ats: 'ashby', slug: 'acme' }],
    [
      'https://acme.wd5.myworkdayjobs.com/External',
      { ats: 'workday', host: 'acme.wd5.myworkdayjobs.com', tenant: 'acme', site: 'External' },
    ],
    [
      'https://acme.wd5.myworkdayjobs.com/en-US/External/details?q=x',
      { ats: 'workday', host: 'acme.wd5.myworkdayjobs.com', tenant: 'acme', site: 'External' },
    ],
    [
      'https://acme.wd5.myworkdayjobs.com/External/job/IN-Bengaluru/Firmware-Engineer_JR2000002',
      {
        ats: 'workday',
        host: 'acme.wd5.myworkdayjobs.com',
        tenant: 'acme',
        site: 'External',
        job: 'IN-Bengaluru/Firmware-Engineer_JR2000002',
      },
    ],
    [
      'https://wd3.myworkdaysite.com/en-US/recruiting/acme/External',
      { ats: 'workday', host: 'wd3.myworkdaysite.com', tenant: 'acme', site: 'External' },
    ],
  ])('%s', (url, expected) => {
    expect(board(url)).toEqual(expected);
  });

  it.each([
    'https://acme.example/careers',
    'https://boards.greenhouse.io/',
    'https://boards.greenhouse.io/embed/job_board',
    'https://boards.greenhouse.io/embed/job_board?for=../../x',
    'https://jobs.lever.co/',
    'https://jobs.lever.co/%2e%2e',
    'https://jobs.ashbyhq.com/a%2Fb',
    'https://acme.wd5.myworkdayjobs.com/',
    'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs',
    'https://evil.example/jobs.lever.co/acme',
    'https://jobs.lever.co.evil.example/acme',
    'https://wd3.myworkdaysite.com/recruiting/acme',
  ])('%s is not a board', (url) => {
    expect(board(url)).toBeUndefined();
  });

  it('a link to one posting ignores extra path segments it does not know', () => {
    expect(board('https://jobs.lever.co/acme/not-a-uuid')).toEqual({
      ats: 'lever',
      slug: 'acme',
      eu: false,
    });
    expect(board('https://job-boards.greenhouse.io/acme/jobs/abc')).toEqual({
      ats: 'greenhouse',
      slug: 'acme',
    });
  });
});

describe('boardKey', () => {
  it('names the board, not the posting', () => {
    expect(boardKey({ ats: 'greenhouse', slug: 'acme', job: '1' })).toBe('greenhouse:acme');
    expect(boardKey({ ats: 'lever', slug: 'acme', eu: true })).toBe('lever:eu:acme');
    expect(
      boardKey({ ats: 'workday', host: 'acme.wd5.myworkdayjobs.com', tenant: 'acme', site: 'Ext' }),
    ).toBe('workday:acme.wd5.myworkdayjobs.com/ext');
  });

  it('is the same whatever the case, so jobs are not saved twice', () => {
    expect(boardKey({ ats: 'greenhouse', slug: 'Acme' })).toBe(
      boardKey({ ats: 'greenhouse', slug: 'acme' }),
    );
  });
});

describe('boardFromHtml', () => {
  it('finds an embedded board (entities decoded)', () => {
    const html =
      '<div id="grnhse_app"></div><script src="https://boards.greenhouse.io/embed/job_board/js?for=acme&amp;b=x"></script>';
    expect(boardFromHtml(html)).toEqual({ ats: 'greenhouse', slug: 'acme' });
  });

  it('reads links to postings as their board', () => {
    const html = `<a href="https://jobs.lever.co/acme/6ed76ce8-4156-4b60-b120-403538bd0001">A</a>
      <a href="https://jobs.lever.co/acme/6ed76ce8-4156-4b60-b120-403538bd0002">B</a>`;
    expect(boardFromHtml(html)).toEqual({ ats: 'lever', slug: 'acme', eu: false });
  });

  it('gives up when a page names two boards', () => {
    const html =
      '<a href="https://jobs.lever.co/acme">A</a><a href="https://jobs.ashbyhq.com/other">B</a>';
    expect(boardFromHtml(html)).toBeUndefined();
  });

  it('ignores lookalike hosts and pages without boards', () => {
    expect(
      boardFromHtml('<a href="https://greenhouse.io.evil.example/acme">x</a>'),
    ).toBeUndefined();
    expect(boardFromHtml('<p>No jobs here</p>')).toBeUndefined();
  });

  it('stays fast on a hostile page', () => {
    const html = `${'https://a.greenhouse.io/'.repeat(50_000)}${'x'.repeat(1_000_000)}`;
    const started = performance.now();
    boardFromHtml(html);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe('feedRequest', () => {
  it('builds each board list request', () => {
    expect(feedRequest({ ats: 'greenhouse', slug: 'acme' })).toEqual({
      url: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs',
    });
    expect(feedRequest({ ats: 'lever', slug: 'acme', eu: true }, 50)).toEqual({
      url: `https://api.eu.lever.co/v0/postings/acme?mode=json&limit=${FEED_PAGE_SIZE.lever}&skip=50`,
    });
    expect(feedRequest({ ats: 'ashby', slug: 'acme' })).toEqual({
      url: 'https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true',
    });
    expect(
      feedRequest(
        { ats: 'workday', host: 'acme.wd5.myworkdayjobs.com', tenant: 'acme', site: 'External' },
        40,
      ),
    ).toEqual({
      url: 'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs',
      json: { appliedFacets: {}, limit: FEED_PAGE_SIZE.workday, offset: 40, searchText: '' },
    });
  });

  it('builds each single-posting request', () => {
    expect(feedRequest({ ats: 'greenhouse', slug: 'acme', job: '4001001' }).url).toBe(
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs/4001001',
    );
    expect(feedRequest({ ats: 'lever', slug: 'acme', eu: false, job: 'abc' }).url).toBe(
      'https://api.lever.co/v0/postings/acme/abc?mode=json',
    );
    expect(feedRequest({ ats: 'ashby', slug: 'acme', job: 'abc' }).url).toBe(
      'https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true',
    );
    expect(
      feedRequest({
        ats: 'workday',
        host: 'acme.wd5.myworkdayjobs.com',
        tenant: 'acme',
        site: 'External',
        job: 'IN-Bengaluru/Firmware-Engineer_JR2000002',
      }),
    ).toEqual({
      url: 'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/job/IN-Bengaluru/Firmware-Engineer_JR2000002',
    });
  });

  it('every request stays on the board host it was built for', () => {
    // Slugs are validated, and encoded again here: a request can never leave the board's host.
    const url = new URL(feedRequest({ ats: 'lever', slug: 'a.b-c_d', eu: false }).url);
    expect(url.hostname).toBe('api.lever.co');
    expect(url.pathname).toBe('/v0/postings/a.b-c_d');
  });
});
