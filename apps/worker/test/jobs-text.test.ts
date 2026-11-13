import { describe, expect, it } from 'vitest';
import {
  contentHash,
  countryCode,
  descriptionHash,
  employmentTypeFrom,
  finalizeJob,
  finalizeJobs,
  isoDate,
  JOB_LIMITS,
  safeUrl,
  salaryFrom,
  workplaceFrom,
} from '../src/jobs/job.js';
import { decodeEntities, htmlToText, oneLine, truncate } from '../src/jobs/text.js';

const NOW = new Date('2026-09-29T12:00:00Z');
const context = {
  method: 'ats_feed' as const,
  companyKey: 'lever:acme',
  baseUrl: 'https://jobs.lever.co/acme',
};

describe('text', () => {
  it('decodes entities once, and replaces invalid code points', () => {
    expect(decodeEntities('a &amp;lt; b &#x41;&#66; &rsquo; &bogus; &#0; &#xD800;')).toBe(
      'a &lt; b AB ’ &bogus; � �',
    );
  });

  it('turns HTML into readable text without scripts, styles, or comments', () => {
    expect(
      htmlToText(
        '<h1>Role</h1><!-- hidden --><style>p{}</style><p>Build <a href="#">things</a>, fast.<br>Really.</p><script>x()</script><ol><li>One</li><li></li><li>Two</li></ol><table><tr><td>a</td><td>b</td></tr></table>',
      ),
    ).toBe('Role\n\nBuild things, fast.\nReally.\n\n- One\n- Two\n\na b');
  });

  it('an unclosed comment or script ends the text', () => {
    expect(htmlToText('<p>Kept</p><!-- open <p>lost</p>')).toBe('Kept');
    expect(htmlToText('<p>Kept</p><script>lost')).toBe('Kept');
  });

  it('stays fast on hostile HTML', () => {
    const started = performance.now();
    htmlToText(`${'<script>'.repeat(100_000)}${'<p'.repeat(100_000)}${'&amp;'.repeat(100_000)}`);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('oneLine strips tags and breaks, and cuts at a limit', () => {
    expect(oneLine('  <b>Senior</b>\n Engineer &amp; Lead ', 100)).toBe('Senior Engineer & Lead');
    expect(oneLine('x'.repeat(20), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(oneLine('   ', 10)).toBeUndefined();
    expect(oneLine(42, 10)).toBe('42');
    expect(oneLine({ a: 1 }, 10)).toBeUndefined();
  });

  it('truncate cuts at a break and never splits a character', () => {
    expect(truncate('short', 10)).toEqual({ text: 'short', truncated: false });
    expect(truncate('word '.repeat(10), 22)).toEqual({
      text: 'word word word word…',
      truncated: true,
    });
    expect(truncate(`${'a'.repeat(9)}😀`, 10).text).toBe(`${'a'.repeat(9)}…`);
  });
});

describe('field readers', () => {
  it.each([
    ['https://jobs.lever.co/acme/1?utm_source=x#top', 'https://jobs.lever.co/acme/1'],
    ['/acme/2', 'https://jobs.lever.co/acme/2'],
    ['javascript:alert(1)', undefined],
    ['http://127.0.0.1/admin', undefined],
    ['https://user:pass@acme.example/', undefined],
    ['https://www.linkedin.com/jobs/view/1', undefined],
    [`https://acme.example/${'a'.repeat(3000)}`, undefined],
    [7, undefined],
  ])('safeUrl(%s)', (value, expected) => {
    expect(safeUrl(value, 'https://jobs.lever.co/acme')).toBe(expected);
  });

  it.each([
    ['US', 'US'],
    ['usa', 'US'],
    ['United Kingdom', 'GB'],
    ['IND', 'IN'],
    ['Atlantis', undefined],
    [undefined, undefined],
  ])('countryCode(%s)', (value, expected) => {
    expect(countryCode(value)).toBe(expected);
  });

  it('isoDate accepts dates and epochs, and refuses implausible ones', () => {
    expect(isoDate('2026-09-10', NOW)).toBe('2026-09-10T00:00:00.000Z');
    expect(isoDate(1786469891368, NOW)).toBe('2026-08-11T17:38:11.368Z');
    expect(isoDate('1999-12-31', NOW)).toBeUndefined();
    expect(isoDate('2027-01-01', NOW)).toBeUndefined();
    expect(isoDate('yesterday', NOW)).toBeUndefined();
    expect(isoDate(null, NOW)).toBeUndefined();
  });

  it('maps workplace and employment wording', () => {
    expect(
      ['OnSite', 'on-site', 'Remote', 'TELECOMMUTE', 'Hybrid', 'unspecified', 5].map(workplaceFrom),
    ).toEqual(['onsite', 'onsite', 'remote', 'remote', 'hybrid', undefined, undefined]);
    expect(
      [
        'FULL_TIME',
        'PartTime',
        'Intern',
        'CONTRACTOR',
        'TEMPORARY',
        ['OTHER', 'Full-time'],
        'Volunteer',
      ].map(employmentTypeFrom),
    ).toEqual([
      'full_time',
      'part_time',
      'internship',
      'contract',
      'temporary',
      'full_time',
      undefined,
    ]);
  });

  it('reads a salary only with a currency and a plausible amount', () => {
    expect(salaryFrom('90,000', 120000, 'gbp', 'per-year-salary')).toEqual({
      min: 90000,
      max: 120000,
      currency: 'GBP',
      period: 'year',
    });
    expect(salaryFrom(50, 50, 'USD', 'HOUR')).toEqual({ min: 50, currency: 'USD', period: 'hour' });
    expect(salaryFrom(1, 2, 'dollars', 'year')).toBeUndefined();
    expect(salaryFrom(-1, 'x', 'USD', 'year')).toBeUndefined();
  });
});

describe('finalizeJob', () => {
  const raw = {
    ats: 'lever' as const,
    externalId: 'abc',
    title: 'Engineer',
    jobUrl: 'https://jobs.lever.co/acme/abc',
  };

  it('needs a title and a usable link', () => {
    expect(finalizeJob({ ...raw, title: ' ' }, context)).toBeUndefined();
    expect(finalizeJob({ ...raw, jobUrl: 'mailto:jobs@acme.example' }, context)).toBeUndefined();
    expect(finalizeJob(raw, context)?.title).toBe('Engineer');
  });

  it('bounds every field', () => {
    const job = finalizeJob(
      {
        ...raw,
        title: 't'.repeat(1000),
        companyName: 'c'.repeat(1000),
        descriptionText: 'word '.repeat(20_000),
        locations: Array.from({ length: 100 }, (_, i) => ({ text: `City ${i}` })),
      },
      context,
    );
    expect(job?.title.length).toBe(JOB_LIMITS.titleChars);
    expect(job?.companyName?.length).toBe(JOB_LIMITS.companyChars);
    expect(job?.description?.length).toBeLessThanOrEqual(JOB_LIMITS.descriptionChars + 1);
    expect(job?.descriptionTruncated).toBe(true);
    expect(job?.locations).toHaveLength(JOB_LIMITS.maxLocations);
  });

  it('drops duplicate places, and an apply link equal to the job link', () => {
    const job = finalizeJob(
      { ...raw, locations: [{ text: 'Pune' }, { text: 'Pune' }, {}], applyUrl: raw.jobUrl },
      context,
    );
    expect(job?.locations).toEqual([{ text: 'Pune' }]);
    expect(job).not.toHaveProperty('applyUrl');
  });

  it('keys by the board and its ID, so a changed link or title is the same job', () => {
    const a = finalizeJob(raw, context);
    const b = finalizeJob(
      { ...raw, title: 'Senior Engineer', jobUrl: 'https://jobs.lever.co/acme/abc?x=1' },
      context,
    );
    expect(a?.jobId).toBe(b?.jobId);
    // The same ID on another board is another job.
    expect(finalizeJob(raw, { ...context, companyKey: 'lever:other' })?.jobId).not.toBe(a?.jobId);
    // Without an ATS ID, the link is the key.
    const { ats: _ats, ...withoutAts } = raw;
    expect(finalizeJob(withoutAts, context)?.dedupeKey).toBe('url:https://jobs.lever.co/acme/abc');
  });

  it('finalizeJobs counts skipped jobs and keeps the first of duplicates', () => {
    const { jobs, skipped } = finalizeJobs(
      [raw, { ...raw, title: 'Later copy' }, { title: 'No link' }],
      context,
    );
    expect(jobs.map((j) => j.title)).toEqual(['Engineer']);
    expect(skipped).toBe(1);
  });

  it('contentHash changes with what the user reads, not with where it was found or the description', () => {
    const a = finalizeJob({ ...raw, descriptionText: 'Build.' }, context);
    const b = finalizeJob(raw, { ...context, method: 'schema_org' });
    const c = finalizeJob({ ...raw, title: 'Senior Engineer' }, context);
    if (!a || !b || !c) throw new Error('expected jobs');
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).not.toBe(contentHash(c));
    expect(descriptionHash('Build.')).not.toBe(descriptionHash('Build more.'));
  });
});
