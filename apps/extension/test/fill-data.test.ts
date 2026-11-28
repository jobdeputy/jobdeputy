import { EXTENSION_API_ROUTES } from '@jobdeputy/shared/extension';
import { describe, expect, it, vi } from 'vitest';
import type { Api, ApiResult } from '../src/api.ts';
import { readFillData } from '../src/fill/data.ts';
import type { Files } from '../src/fill/files.ts';
import { jobIdFor } from '../src/fill/posting.ts';

const posting = { companyKey: 'greenhouse:acme', postingId: '4001001' };
const JOB = await jobIdFor(posting);
const ok = <T>(body: T): ApiResult<T> => ({ ok: true, body });

const PROFILE = {
  version: 2,
  firstName: 'Sam',
  lastName: 'Example',
  email: 'sam@example.com',
  phone: { countryCode: '+1', number: '555 0100' },
  location: { city: 'Austin', region: 'TX', country: 'US' },
  links: { linkedin: 'https://www.linkedin.com/in/sam', other: [] },
  skills: ['TypeScript'],
  summary: 'Never handed to a page',
};
const APPLICANT = {
  version: 1,
  workAuthorization: [{ country: 'US', authorized: true, needsSponsorship: false }],
  workSetups: ['remote'],
  over18: true,
  updatedAt: '2026-11-27T00:00:00Z',
};
const VOLUNTARY = {
  version: 1,
  gender: 'decline',
  hispanicLatino: 'no',
  race: 'asian',
  veteran: 'not_protected',
  disability: 'decline',
};
const version = (documentId: string, createdAt: string, status = 'ready') => ({
  documentId,
  status,
  createdAt,
  fileName: `${documentId}.pdf`,
});

/** The API's answers by path; anything else fails. */
function routes(overrides: Record<string, ApiResult<unknown>> = {}) {
  const answers: Record<string, ApiResult<unknown>> = {
    '/me/profile': ok(PROFILE),
    '/me/applicant': ok(APPLICANT),
    '/me/voluntary': ok(VOLUNTARY),
    '/me/tailorings?companyKey=greenhouse%3Aacme': ok({
      tailorings: [
        version('t-old', '2026-11-01T00:00:00Z'),
        version('t-new', '2026-11-20T00:00:00Z'),
        version('t-running', '2026-11-25T00:00:00Z', 'processing'),
      ],
    }),
    '/me/tailorings/t-new': ok({ downloads: { pdf: 'https://files.test/t-new', docx: 'x' } }),
    [`/me/cover-letters?jobId=${JOB}`]: ok({
      coverLetters: [version('l-1', '2026-11-21T00:00:00Z')],
    }),
    '/me/cover-letters/l-1': ok({ downloads: { pdf: 'https://files.test/l-1' } }),
    '/me/documents': ok({
      documents: [
        { documentId: 'd-other', status: 'ready', isDefault: false, fileName: 'old.pdf' },
        { documentId: 'd-default', status: 'ready', isDefault: true, fileName: 'Sam CV.docx' },
      ],
    }),
    '/me/documents/d-default': ok({ downloadUrl: 'https://files.test/d-default' }),
    ...overrides,
  };
  const get = vi.fn(
    async (path: string) => answers[path] ?? ({ ok: false, reason: 'failed' } as const),
  );
  return { api: { get } as unknown as Api, get };
}

function fakeFiles(fail: string[] = []) {
  const read = vi.fn(async (link: unknown, name: string) =>
    fail.includes(String(link)) ? null : { name, type: 'application/pdf', base64: String(link) },
  );
  return { files: { read } as unknown as Files, read };
}

describe('readFillData (#54 PR C)', () => {
  it("hands over the person's details, answers, the tailored résumé and this job's letter", async () => {
    const { api } = routes();
    const result = await readFillData(api, fakeFiles().files, posting);
    expect(result).toEqual({
      ok: true,
      body: {
        person: {
          firstName: 'Sam',
          lastName: 'Example',
          email: 'sam@example.com',
          phone: { countryCode: '+1', number: '555 0100' },
          location: { city: 'Austin', region: 'TX', country: 'US' },
          links: { linkedin: 'https://www.linkedin.com/in/sam' },
        },
        applicant: {
          workAuthorization: [{ country: 'US', authorized: true, needsSponsorship: false }],
          workSetups: ['remote'],
          over18: true,
        },
        voluntary: {
          gender: 'decline',
          hispanicLatino: 'no',
          race: 'asian',
          veteran: 'not_protected',
          disability: 'decline',
        },
        resume: {
          name: 't-new.pdf',
          type: 'application/pdf',
          base64: 'https://files.test/t-new',
          from: 'tailored',
        },
        coverLetter: { name: 'l-1.pdf', type: 'application/pdf', base64: 'https://files.test/l-1' },
        unread: [],
      },
    });
  });

  it('attaches the default résumé when the company has no ready tailored one', async () => {
    const { api } = routes({
      '/me/tailorings?companyKey=greenhouse%3Aacme': ok({
        tailorings: [version('t', '2026-11-25T00:00:00Z', 'failed')],
      }),
    });
    const result = await readFillData(api, fakeFiles().files, posting);
    expect(result.ok && result.body.resume).toEqual({
      name: 'Sam CV.docx',
      type: 'application/pdf',
      base64: 'https://files.test/d-default',
      from: 'default',
    });
  });

  it('attaches nothing when the tailored résumé could not be read (never the default instead)', async () => {
    const { api } = routes();
    const result = await readFillData(api, fakeFiles(['https://files.test/t-new']).files, posting);
    expect(result.ok && result.body.resume).toBeNull();
    expect(result.ok && result.body.unread).toEqual(['resume']);
  });

  it('leaves out answers never saved: no application answers, no self-ID, no letter', async () => {
    const { api } = routes({
      '/me/applicant': ok({ version: 0, workAuthorization: [], workSetups: [] }),
      '/me/voluntary': ok({ ...VOLUNTARY, version: 0 }),
      [`/me/cover-letters?jobId=${JOB}`]: ok({ coverLetters: [] }),
      '/me/tailorings?companyKey=greenhouse%3Aacme': ok({ tailorings: [] }),
      '/me/documents': ok({ documents: [] }),
    });
    const result = await readFillData(api, fakeFiles().files, posting);
    expect(result.ok && result.body).toMatchObject({
      applicant: null,
      voluntary: null,
      resume: null,
      coverLetter: null,
      unread: [],
    });
  });

  it('still fills the rest when a part fails or has an odd shape, and says which', async () => {
    const { api } = routes({
      '/me/applicant': { ok: false, reason: 'offline' },
      '/me/voluntary': ok({ version: 1, gender: 'robot' }),
      [`/me/cover-letters?jobId=${JOB}`]: ok({ letters: 'nope' }),
    });
    const result = await readFillData(api, fakeFiles().files, posting);
    expect(result.ok && result.body.unread).toEqual(['answers', 'voluntary', 'cover-letter']);
    expect(result.ok && result.body.resume?.from).toBe('tailored');
  });

  it('fails without the profile, and says signed out when any read was', async () => {
    const noProfile = routes({ '/me/profile': { ok: false, reason: 'failed' } });
    expect(await readFillData(noProfile.api, fakeFiles().files, posting)).toEqual({
      ok: false,
      reason: 'failed',
    });
    const signedOut = routes({ '/me/voluntary': { ok: false, reason: 'signed-out' } });
    expect(await readFillData(signedOut.api, fakeFiles().files, posting)).toEqual({
      ok: false,
      reason: 'signed-out',
    });
  });

  it('calls only routes the API lets extension tokens reach (EXTENSION_API_ROUTES)', async () => {
    const { api, get } = routes();
    await readFillData(api, fakeFiles().files, posting);
    const called = get.mock.calls.map(([path]) =>
      `GET ${path.split('?')[0]}`.replace(
        /^(GET \/me\/(?:documents|tailorings|cover-letters))\/[^/]+$/,
        '$1/{documentId}',
      ),
    );
    expect(called.length).toBeGreaterThan(0);
    for (const route of called) expect(EXTENSION_API_ROUTES).toContain(route);
  });
});
