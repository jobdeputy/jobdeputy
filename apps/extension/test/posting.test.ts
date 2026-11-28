import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { greenhousePosting, jobIdFor } from '../src/fill/posting.ts';

describe('greenhousePosting (#54 PR C)', () => {
  it('reads the board and posting from a form or an embedded form', () => {
    expect(
      greenhousePosting('https://job-boards.greenhouse.io/Acme/jobs/4001001?gh_src=x'),
    ).toEqual({ companyKey: 'greenhouse:acme', postingId: '4001001' });
    expect(
      greenhousePosting('https://job-boards.greenhouse.io/embed/job_app?for=acme&token=4001001'),
    ).toEqual({ companyKey: 'greenhouse:acme', postingId: '4001001' });
  });

  it('is null anywhere else', () => {
    for (const address of [
      undefined,
      '',
      'not a url',
      'http://job-boards.greenhouse.io/acme/jobs/1',
      'https://job-boards.greenhouse.io:8443/acme/jobs/1',
      'https://boards.greenhouse.io/acme/jobs/1',
      'https://job-boards.greenhouse.io.evil.test/acme/jobs/1',
      'https://evil.test/acme/jobs/1',
      'https://job-boards.greenhouse.io/acme',
      'https://job-boards.greenhouse.io/acme/jobs',
      'https://job-boards.greenhouse.io/acme/jobs/12a',
      'https://job-boards.greenhouse.io/acme/jobs/1/extra',
      'https://job-boards.greenhouse.io/-acme/jobs/1',
      'https://job-boards.greenhouse.io/embed/job_app?for=acme',
      'https://job-boards.greenhouse.io/embed/job_board?for=acme&token=1',
      `https://job-boards.greenhouse.io/acme/jobs/${'1'.repeat(21)}`,
    ]) {
      expect(greenhousePosting(address), String(address)).toBeNull();
    }
  });

  it("works out the job's ID as the crawl does (0006)", async () => {
    const posting = { companyKey: 'greenhouse:acme', postingId: '4001001' };
    const crawl = createHash('sha256').update('ats:greenhouse:acme:4001001').digest('hex');
    expect(await jobIdFor(posting)).toBe(crawl.slice(0, 32));
  });
});
