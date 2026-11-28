import { createHash } from 'node:crypto';
import { greenhouseFormUrl } from '@jobdeputy/shared/extension';
import { atsJobKey, jobIdOf } from '@jobdeputy/shared/job-id';
import { describe, expect, it } from 'vitest';
import { greenhouseConfirmation, greenhousePosting, jobIdFor } from '../src/fill/posting.ts';

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

describe('greenhouseConfirmation (#54 PR D)', () => {
  it("reads the posting a board's confirmation page confirms", () => {
    expect(
      greenhouseConfirmation('https://job-boards.greenhouse.io/Acme/jobs/4001001/confirmation'),
    ).toEqual({ companyKey: 'greenhouse:acme', postingId: '4001001' });
    expect(
      greenhouseConfirmation(
        'https://job-boards.greenhouse.io/acme/jobs/4001001/confirmation?x=1#top',
      ),
    ).toEqual({ companyKey: 'greenhouse:acme', postingId: '4001001' });
  });

  it.each([
    'https://job-boards.greenhouse.io/acme/jobs/4001001',
    'https://job-boards.greenhouse.io/acme/jobs/4001001/confirmation/x',
    'https://job-boards.greenhouse.io/acme/jobs/abc/confirmation',
    'https://job-boards.greenhouse.io/acme/notjobs/4001001/confirmation',
    'https://evil.example/acme/jobs/4001001/confirmation',
    'http://job-boards.greenhouse.io/acme/jobs/4001001/confirmation',
    'https://job-boards.greenhouse.io/embed/job_app/x/confirmation',
    'not a url',
  ])('is not one: %s', (address) => {
    expect(greenhouseConfirmation(address)).toBeNull();
  });
});

it("takes the web app's form address for Auto apply as the same job the crawl made (#54 PR D3)", async () => {
  const url = greenhouseFormUrl('greenhouse:acme', '4001001');
  const posting = greenhousePosting(url ?? '');
  expect(posting).toEqual({ companyKey: 'greenhouse:acme', postingId: '4001001' });
  expect(await jobIdFor(posting ?? { companyKey: '', postingId: '' })).toBe(
    await jobIdOf(atsJobKey('greenhouse:acme', '4001001')),
  );
});
