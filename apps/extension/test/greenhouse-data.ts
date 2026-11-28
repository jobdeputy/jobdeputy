import type { FillData } from '../src/fill/data.ts';

/** A person's fill data for the Greenhouse tests: synthetic. */
export function fillData(overrides: Partial<FillData> = {}): FillData {
  return {
    person: {
      firstName: 'Sam',
      lastName: 'Example',
      preferredName: 'Sammy',
      email: 'sam@example.com',
      phone: { countryCode: '+1', number: '555 0100' },
      location: { city: 'Austin', region: 'TX', country: 'US' },
      links: { linkedin: 'https://www.linkedin.com/in/sam', github: 'https://github.com/sam' },
    },
    applicant: {
      workAuthorization: [{ country: 'US', authorized: true, needsSponsorship: false }],
      workSetups: ['remote'],
      willingToRelocate: false,
      over18: true,
      heardAbout: 'linkedin',
      pronouns: 'they/them',
      noticePeriodDays: 14,
      earliestStartDate: '2027-01-04',
      expectedSalary: { min: 150000, max: 180000, currency: 'USD', period: 'year' },
    },
    voluntary: {
      gender: 'decline',
      hispanicLatino: 'no',
      race: 'asian',
      veteran: 'not_protected',
      disability: 'decline',
    },
    resume: {
      name: 'Sam Example – Acme.pdf',
      type: 'application/pdf',
      base64: btoa('%PDF-1.7 resume'),
      from: 'tailored',
    },
    coverLetter: null,
    unread: [],
    ...overrides,
  };
}
