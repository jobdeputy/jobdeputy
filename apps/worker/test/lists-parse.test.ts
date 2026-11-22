import { describe, expect, it } from 'vitest';
import { MAX_LIST_ROWS, parseListings, parseReadme } from '../src/lists/parse.js';

/** Synthetic rows in the Simplify `listings.json` shape. */
const role = (over: Record<string, unknown> = {}) => ({
  source: 'Simplify',
  company_name: 'Acme',
  title: 'Software Engineer',
  locations: ['San Francisco, CA'],
  url: 'https://job-boards.greenhouse.io/acme/jobs/123?utm_source=Simplify',
  active: true,
  is_visible: true,
  date_posted: 1795000000,
  ...over,
});

describe('parseListings (#50)', () => {
  it('reads open, visible roles with their places, link, and date', () => {
    expect(
      parseListings([
        role(),
        role({ title: 'Closed role', active: false }),
        role({ title: 'Hidden role', is_visible: false }),
      ]),
    ).toEqual([
      {
        company: 'Acme',
        title: 'Software Engineer',
        locations: ['San Francisco, CA'],
        links: ['https://job-boards.greenhouse.io/acme/jobs/123?utm_source=Simplify'],
        postedAt: 1795000000,
      },
    ]);
  });

  it('skips malformed rows, keeps rows without places, and trims long text', () => {
    const rows = parseListings([
      null,
      7,
      role({ company_name: '' }),
      role({ url: 42 }),
      role({ locations: 'Remote', title: `  ${'x'.repeat(400)}  `, date_posted: 'soon' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.locations).toEqual([]);
    expect(rows?.[0]?.title).toHaveLength(300);
    expect(rows?.[0]?.postedAt).toBeUndefined();
  });

  it('is undefined for anything that is not the format', () => {
    expect(parseListings({ roles: [] })).toBeUndefined();
    expect(parseListings([{ name: 'x' }])).toBeUndefined();
    expect(parseListings(undefined)).toBeUndefined();
    // All closed is still the format: a list with nothing open.
    expect(parseListings([role({ active: false })])).toEqual([]);
  });

  it('reads at most MAX_LIST_ROWS rows', () => {
    const many = Array.from({ length: MAX_LIST_ROWS + 5 }, () => role());
    expect(parseListings(many)).toHaveLength(MAX_LIST_ROWS);
  });
});

describe('parseReadme (#50)', () => {
  it('reads HTML tables by their headers, with ↳ repeating the company and locked rows left out', () => {
    const readme = `
# New grad roles
<table>
<thead><tr><th>Company</th><th>Role</th><th>Location</th><th>Application</th><th>Age</th></tr></thead>
<tbody>
<tr>
<td><strong><a href="https://simplify.jobs/c/Acme">Acme</a></strong></td>
<td>Software Engineer</td>
<td><details><summary><strong>2 locations</strong></summary>New York, NY</br>Austin, TX</details></td>
<td><div align="center"><a href="https://job-boards.greenhouse.io/acme/jobs/123"><img src="x.png" alt="Apply"></a></div></td>
<td>1d</td>
</tr>
<tr><td>↳</td><td>Data Engineer</td><td>Remote in USA</td><td><a href="https://jobs.lever.co/acme/0a654eeb-ff73-4b76-839e-172219e789e4">Apply</a></td><td>2d</td></tr>
<tr><td>Closed &amp; Co</td><td>Engineer</td><td>Denver, CO</td><td><a href="https://job-boards.greenhouse.io/closed">🔒</a></td><td>9d</td></tr>
</tbody>
</table>`;
    expect(parseReadme(readme)).toEqual([
      {
        company: 'Acme',
        title: 'Software Engineer',
        locations: ['New York, NY', 'Austin, TX'],
        links: ['https://job-boards.greenhouse.io/acme/jobs/123', 'https://simplify.jobs/c/Acme'],
      },
      {
        company: 'Acme',
        title: 'Data Engineer',
        locations: ['Remote in USA'],
        links: ['https://jobs.lever.co/acme/0a654eeb-ff73-4b76-839e-172219e789e4'],
      },
    ]);
  });

  it('reads Markdown tables, whatever the role column is called', () => {
    const readme = [
      '| Company | Job Title | Location | Work Model | Date Posted |',
      '| ----- | --------- |  --------- | ---- | ------- |',
      '| 🔥 **[Esri](https://www.esri.com)** | **[Software Development Engineer I](https://jobs.ashbyhq.com/esri/1d0e7d9e-9f6a-4c8e-8a7b-111111111111)** | St. Louis, MO | On Site | Nov 22 |',
      '',
      '| Company | Position | Location | Posting |',
      '|---|:---:|---|---|',
      '| <a href="https://www.nvidia.com"><strong>NVIDIA</strong></a> | AI Intern | Santa Clara, CA | <a href="https://nvidia.wd5.myworkdayjobs.com/en-US/External/job/X_JR1"><img src="a.png" alt="Apply"/></a> |',
    ].join('\n');
    expect(parseReadme(readme)).toEqual([
      {
        company: 'Esri',
        title: 'Software Development Engineer I',
        locations: ['St. Louis, MO'],
        links: [
          'https://jobs.ashbyhq.com/esri/1d0e7d9e-9f6a-4c8e-8a7b-111111111111',
          'https://www.esri.com',
        ],
      },
      {
        company: 'NVIDIA',
        title: 'AI Intern',
        locations: ['Santa Clara, CA'],
        links: [
          'https://nvidia.wd5.myworkdayjobs.com/en-US/External/job/X_JR1',
          'https://www.nvidia.com',
        ],
      },
    ]);
  });

  it('ignores tables without a company and a role column, and rows without links', () => {
    const readme = [
      '| Name | Link |',
      '|---|---|',
      '| Acme | [x](https://job-boards.greenhouse.io/acme) |',
      '',
      '| Company | Role |',
      '|---|---|',
      '| Acme | Engineer |',
    ].join('\n');
    expect(parseReadme(readme)).toEqual([]);
    expect(parseReadme('# Just a project\n\nNo roles here.')).toEqual([]);
  });
});
