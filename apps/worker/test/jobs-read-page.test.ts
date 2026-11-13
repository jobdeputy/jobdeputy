import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boardForUrl, readPage } from '../src/jobs/read-page.js';

const NOW = new Date('2026-09-29T12:00:00Z');
const schemaOrgPage = readFileSync(
  new URL('./fixtures/jobs/schema-org-page.html', import.meta.url),
  'utf8',
);
const html = (text: string, url = 'https://acme.example/careers') => ({
  url,
  contentType: 'text/html',
  text,
});

describe('boardForUrl', () => {
  it('knows board links before anything is fetched', () => {
    expect(boardForUrl('https://jobs.lever.co/acme')).toEqual({
      ats: 'lever',
      slug: 'acme',
      eu: false,
    });
    expect(boardForUrl('https://acme.example/careers')).toBeUndefined();
    expect(boardForUrl('not a url')).toBeUndefined();
  });
});

describe('readPage', () => {
  it('a page that redirected into a board is read from the board', () => {
    expect(readPage(html('<p>x</p>', 'https://job-boards.greenhouse.io/acme'), NOW)).toEqual({
      kind: 'board',
      board: { ats: 'greenhouse', slug: 'acme' },
    });
  });

  it('schema.org jobs come before an embedded board link', () => {
    const page = `${schemaOrgPage}<a href="https://jobs.lever.co/acme">All jobs</a>`;
    const reading = readPage(html(page), NOW);
    expect(reading.kind).toBe('jobs');
    if (reading.kind === 'jobs') expect(reading.jobs).toHaveLength(2);
  });

  it('a careers page embedding one board is read from that board', () => {
    const page =
      '<div id="grnhse_app"></div><script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>';
    expect(readPage(html(page), NOW)).toEqual({
      kind: 'board',
      board: { ats: 'greenhouse', slug: 'acme' },
    });
  });

  it('nothing readable: none (an LLM may read it later, #41)', () => {
    expect(readPage(html('<ul><li>Engineer, Pune</li></ul>'), NOW)).toEqual({ kind: 'none' });
    expect(
      readPage(
        { url: 'https://acme.example/jobs.json', contentType: 'application/json', text: '[]' },
        NOW,
      ),
    ).toEqual({ kind: 'none' });
  });
});
