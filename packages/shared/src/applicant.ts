import { z } from 'zod';
import { countryCode, expectedVersion } from './profile.js';

/**
 * #53 (decision 0019): the answers application forms ask for, kept so the extension (#54) can
 * fill them. Anything absent is unanswered: the extension leaves it blank and points it out,
 * and never guesses. Links are not here: they stay in the profile (`links`).
 *
 * Two items in `users` (docs/data-model.md):
 * - `APPLICANT`: the everyday answers below, stored as they are.
 * - `VOLUNTARY`: the US voluntary self-identification answers, opt-in, encrypted with the
 *   cell's KMS key; only the profile API can decrypt them, and they never reach an AI model.
 */

export const WORK_SETUPS = ['remote', 'hybrid', 'onsite'] as const;
export type WorkSetup = (typeof WORK_SETUPS)[number];

export const SECURITY_CLEARANCES = [
  'none',
  'public_trust',
  'confidential',
  'secret',
  'top_secret',
  'ts_sci',
] as const;

/** "How did you hear about us?": one default the user picks for every form. */
export const HEARD_ABOUT = [
  'company_website',
  'job_board',
  'linkedin',
  'referral',
  'recruiter',
  'social_media',
  'other',
] as const;

/** Countries the answers may cover; US only at launch (decision 0017), more later. */
export const MAX_WORK_AUTHORIZATIONS = 5;

/** The salary range a form may ask for. Current salary is never stored (decision 0019). */
export const salaryRange = z
  .strictObject({
    min: z.number().int().nonnegative().max(100_000_000),
    max: z.number().int().nonnegative().max(100_000_000).optional(),
    /** ISO 4217, for example "USD". Never converted. */
    currency: z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code'),
    period: z.enum(['year', 'hour']),
  })
  .refine((s) => s.max === undefined || s.max >= s.min, {
    message: 'The top of the range must not be below the bottom',
    path: ['max'],
  });

export const applicantInput = z.strictObject({
  version: expectedVersion,
  workAuthorization: z
    .array(
      z.strictObject({
        country: countryCode,
        /** Legally allowed to work in this country. */
        authorized: z.boolean(),
        /** Needs visa sponsorship now or in the future. */
        needsSponsorship: z.boolean(),
      }),
    )
    .max(MAX_WORK_AUTHORIZATIONS)
    .refine((list) => new Set(list.map((w) => w.country)).size === list.length, {
      message: 'Each country at most once',
    })
    .default([]),
  noticePeriodDays: z.number().int().min(0).max(365).optional(),
  /** yyyy-mm-dd */
  earliestStartDate: z.iso.date().optional(),
  expectedSalary: salaryRange.optional(),
  willingToRelocate: z.boolean().optional(),
  workSetups: z
    .array(z.enum(WORK_SETUPS))
    .max(WORK_SETUPS.length)
    .refine((list) => new Set(list).size === list.length, { message: 'Each setup at most once' })
    .default([]),
  over18: z.boolean().optional(),
  securityClearance: z.enum(SECURITY_CLEARANCES).optional(),
  pronouns: z.string().trim().min(1).max(40).optional(),
  heardAbout: z.enum(HEARD_ABOUT).optional(),
});
export type ApplicantInput = z.infer<typeof applicantInput>;
export type ApplicantAnswers = Omit<ApplicantInput, 'version'>;

/** The answer every voluntary question starts at, and the one forms get unless the user changes it. */
export const DECLINE = 'decline';

/** US voluntary self-identification (EEO-1 / OFCCP forms). Every answer can be `decline`. */
export const GENDERS = ['female', 'male', 'non_binary', DECLINE] as const;
export const HISPANIC_LATINO = ['yes', 'no', DECLINE] as const;
export const RACES = [
  'american_indian_alaska_native',
  'asian',
  'black_african_american',
  'native_hawaiian_pacific_islander',
  'white',
  'two_or_more',
  DECLINE,
] as const;
export const VETERAN_STATUSES = ['protected', 'not_protected', DECLINE] as const;
export const DISABILITY_STATUSES = ['yes', 'no', DECLINE] as const;

export const voluntaryAnswers = z.strictObject({
  gender: z.enum(GENDERS),
  hispanicLatino: z.enum(HISPANIC_LATINO),
  race: z.enum(RACES),
  veteran: z.enum(VETERAN_STATUSES),
  disability: z.enum(DISABILITY_STATUSES),
});
export type VoluntaryAnswers = z.infer<typeof voluntaryAnswers>;

export const voluntaryInput = voluntaryAnswers.extend({ version: expectedVersion });
export type VoluntaryInput = z.infer<typeof voluntaryInput>;

/** What `GET /me/voluntary` returns before the user saves anything: every answer declined. */
export const DECLINED_VOLUNTARY: VoluntaryAnswers = {
  gender: DECLINE,
  hispanicLatino: DECLINE,
  race: DECLINE,
  veteran: DECLINE,
  disability: DECLINE,
};

/**
 * KMS encryption context for `VOLUNTARY` answers. The IAM grant requires exactly these keys
 * with this purpose, so a principal allowed AI keys (context `userId` + `provider`) can't
 * decrypt these, and the profile API can't decrypt AI keys.
 */
export const VOLUNTARY_KMS_PURPOSE = 'voluntary-self-id';
export function voluntaryEncryptionContext(userId: string): Record<string, string> {
  return { userId, purpose: VOLUNTARY_KMS_PURPOSE };
}
