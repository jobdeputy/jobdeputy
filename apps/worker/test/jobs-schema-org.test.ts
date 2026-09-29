import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hashId } from '../src/jobs/job.js';
import {
  findJobPostings,
  jobsFromSchemaOrg,
  jsonLdBlocks,
  SCHEMA_ORG_LIMITS,
} from '../src/jobs/schema-org.js';

const NOW = new Date('2026-09-29T12:00:00Z');
const PAGE = 'https://www.acme.example/careers?utm_source=newsletter';
const html = readFileSync(new URL('./fixtures/jobs/schema-org-page.html', import.meta.url), 'utf8');

describe('jobsFromSchemaOrg', () => {
  it('reads every JobPosting in the page, skipping broken blocks and expired postings', () => {
    const { jobs, skipped, expired } = jobsFromSchemaOrg(html, PAGE, NOW);
    expect(skipped).toBe(0);
    expect(expired).toBe(1);
    expect(jobs).toEqual([
      {
        dedupeKey: 'url:https://www.acme.example/careers/sre',
        jobId: hashId('url:https://www.acme.example/careers/sre'),
        companyKey: 'site:acme.example',
        companyName: 'Acme',
        externalId: 'SRE-1',
        title: 'Site Reliability Engineer',
        locations: [
          { text: 'Manchester, England, GB', city: 'Manchester', region: 'England', country: 'GB' },
          { text: 'Leeds, UK', city: 'Leeds', country: 'GB' },
        ],
        employmentType: 'full_time',
        salary: { min: 70000, max: 85000, currency: 'GBP', period: 'year' },
        description: 'Keep Acme up.\n\nOn call 1 week in 6.',
        jobUrl: 'https://www.acme.example/careers/sre',
        postedAt: '2026-09-10T00:00:00.000Z',
        method: 'schema_org',
      },
      expect.objectContaining({
        title: 'Remote Writer',
        companyName: 'Acme',
        workplace: 'remote',
        employmentType: 'contract',
        description: 'Write docs.',
      }),
    ]);
  });

  it('a posting without its own link gets the page, and several such are told apart by title', () => {
    const block = (title: string) => ({
      '@type': 'JobPosting',
      title,
      jobLocation: { address: 'Pune' },
    });
    const page = `<script type="application/ld+json">${JSON.stringify([block('A'), block('B')])}</script>`;
    const { jobs } = jobsFromSchemaOrg(page, 'https://acme.example/jobs', NOW);
    expect(jobs.map((j) => [j.title, j.jobUrl, j.dedupeKey])).toEqual([
      ['A', 'https://acme.example/jobs', 'text:site:acme.example|a|pune'],
      ['B', 'https://acme.example/jobs', 'text:site:acme.example|b|pune'],
    ]);
  });

  it('one posting on its own page keeps the link as its key', () => {
    const page = `<script type="application/ld+json">{"@type":"JobPosting","title":"Solo"}</script>`;
    const { jobs } = jobsFromSchemaOrg(page, 'https://acme.example/jobs/solo', NOW);
    expect(jobs[0]?.dedupeKey).toBe('url:https://acme.example/jobs/solo');
  });

  it('never keeps an unsafe link or markup', () => {
    const page = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      title: '<img src=x onerror=alert(1)>Engineer',
      description: '<script>steal()</script><p>Real text</p>',
      url: 'javascript:alert(1)',
      // Sites escape `</` inside JSON-LD, or the script tag would end there.
    }).replaceAll('</', '<\\/')}</script>`;
    const { jobs, skipped } = jobsFromSchemaOrg(page, 'https://acme.example/jobs', NOW);
    // The unsafe link cannot be the job's link: the page's own is used.
    expect(jobs[0]).toMatchObject({
      title: 'Engineer',
      description: 'Real text',
      jobUrl: 'https://acme.example/jobs',
    });
    expect(skipped).toBe(0);
  });

  it('finds postings in item lists', () => {
    const list = {
      '@type': 'ItemList',
      itemListElement: [
        { '@type': 'ListItem', item: { '@type': 'JobPosting', title: 'Listed', url: '/a' } },
      ],
    };
    const page = `<script type="application/ld+json">${JSON.stringify(list)}</script>`;
    expect(jobsFromSchemaOrg(page, 'https://acme.example/', NOW).jobs.map((j) => j.title)).toEqual([
      'Listed',
    ]);
  });
});

describe('limits', () => {
  it('reads at most the block limit, from script tags with any attribute order or case', () => {
    const tag = '<SCRIPT data-x="1" TYPE=\'application/ld+json\'>{}</script>';
    expect(jsonLdBlocks(tag.repeat(SCHEMA_ORG_LIMITS.maxBlocks + 10))).toHaveLength(
      SCHEMA_ORG_LIMITS.maxBlocks,
    );
    expect(
      jsonLdBlocks('<script>{"a":1}</script><script type="text/javascript">x</script>'),
    ).toEqual([]);
  });

  it('stops walking deeply nested or huge data', () => {
    let deep: unknown = { '@type': 'JobPosting', title: 'Deep' };
    for (let i = 0; i < 20; i++) deep = { '@graph': [deep] };
    expect(findJobPostings([deep])).toEqual([]);

    const many = Array.from({ length: SCHEMA_ORG_LIMITS.maxNodes + 100 }, (_, i) => ({
      '@type': 'JobPosting',
      title: `${i}`,
    }));
    expect(findJobPostings([many]).length).toBe(SCHEMA_ORG_LIMITS.maxNodes);
  });

  it('an unclosed script ends the scan', () => {
    expect(jsonLdBlocks('<script type="application/ld+json">{"@type":"JobPosting"')).toEqual([]);
  });
});
