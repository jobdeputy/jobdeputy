import { z } from 'zod';

/**
 * Input schemas for the profile, search settings, and target roles (T05b).
 * Item shapes are documented in docs/data-model.md (`users`, `preferences`).
 * Every string and list is bounded, and unknown fields are rejected.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max).default([]);

/** ISO 3166-1 alpha-2, for example "US", "IN", "GB". */
export const countryCode = z.string().regex(/^[A-Z]{2}$/, 'Use a two-letter country code');

const httpsUrl = z.url({ protocol: /^https$/, hostname: z.regexes.domain }).max(500);

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const place = z.strictObject({
  city: text(100).optional(),
  region: text(100).optional(),
  country: countryCode,
});

export const money = z.strictObject({
  amount: z.number().nonnegative().max(1e12),
  /** ISO 4217, for example "USD", "INR", "GBP". Never converted in storage. */
  currency: z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code'),
  period: z.enum(['year', 'month', 'hour']),
});

export const SENIORITY = [
  'intern',
  'junior',
  'mid',
  'senior',
  'lead',
  'principal',
  'manager',
  'director',
  'executive',
] as const;

/** The version the client last read; 0 for a first save. A mismatch is a 409 conflict. */
const expectedVersion = z.number().int().nonnegative();

export const profileInput = z.strictObject({
  version: expectedVersion,
  firstName: text(100),
  lastName: text(100),
  preferredName: text(100).optional(),
  phone: z
    .strictObject({
      countryCode: z.string().regex(/^\+[1-9]\d{0,3}$/, 'Use a code like +1, +44, or +91'),
      number: z.string().regex(/^[0-9][0-9 ()-]{3,19}$/, 'Use digits, spaces, dashes, or brackets'),
    })
    .optional(),
  location: z
    .strictObject({
      city: text(100).optional(),
      region: text(100).optional(),
      country: countryCode,
      postalCode: text(20).optional(),
    })
    .optional(),
  headline: text(200).optional(),
  summary: text(5000).optional(),
  yearsExperience: z.number().int().min(0).max(70).optional(),
  skills: list(text(60), 100),
  languages: list(
    z.strictObject({
      name: text(60),
      level: z.enum(['basic', 'conversational', 'professional', 'native']),
    }),
    20,
  ),
  links: z
    .strictObject({
      linkedin: httpsUrl.optional(),
      github: httpsUrl.optional(),
      portfolio: httpsUrl.optional(),
      website: httpsUrl.optional(),
      other: list(httpsUrl, 10),
    })
    .default({ other: [] }),
  timezone: z.string().max(64).refine(isTimeZone, 'Unknown time zone').optional(),
});
export type ProfileInput = z.infer<typeof profileInput>;

export const searchInput = z.strictObject({
  version: expectedVersion,
  locations: list(place, 20),
  workplace: list(z.enum(['onsite', 'hybrid', 'remote']), 3),
  employmentTypes: list(
    z.enum(['full_time', 'part_time', 'contract', 'internship', 'temporary']),
    5,
  ),
  minSalary: money.optional(),
  seniority: list(z.enum(SENIORITY), SENIORITY.length),
  excludeKeywords: list(text(60), 50),
});
export type SearchInput = z.infer<typeof searchInput>;

export const MAX_ROLES = 10;

const roleFields = {
  title: text(120),
  altTitles: list(text(120), 10),
  seniority: list(z.enum(SENIORITY), SENIORITY.length),
  /** Overrides the search settings' locations for this role. */
  locations: z.array(place).max(20).optional(),
  mustHave: list(text(60), 30),
  exclude: list(text(60), 30),
  priority: z.number().int().min(1).max(100).default(50),
  active: z.boolean().default(true),
};

export const createRoleInput = z.strictObject(roleFields);
export type CreateRoleInput = z.infer<typeof createRoleInput>;

export const updateRoleInput = z.strictObject({ ...roleFields, version: expectedVersion.min(1) });
export type UpdateRoleInput = z.infer<typeof updateRoleInput>;

/** Role IDs are ULIDs (docs/data-model.md). */
export const roleId = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Invalid role ID');
