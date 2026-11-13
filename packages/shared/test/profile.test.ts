import { describe, expect, it } from 'vitest';
import {
  createRoleInput,
  MAX_ROLES,
  profileInput,
  roleId,
  searchInput,
  updateRoleInput,
} from '../src/index.js';

const minimalProfile = { version: 0, firstName: 'Ada', lastName: 'Lovelace' };

describe('profileInput', () => {
  it('accepts a minimal profile and fills list defaults', () => {
    expect(profileInput.parse(minimalProfile)).toEqual({
      ...minimalProfile,
      skills: [],
      languages: [],
      links: { other: [] },
    });
  });

  it('accepts a full profile', () => {
    const full = {
      ...minimalProfile,
      preferredName: 'Ada',
      phone: { countryCode: '+44', number: '20 7946 0000' },
      location: { city: 'London', country: 'GB', postalCode: 'N1 9GU' },
      headline: 'Engineer',
      summary: 'Writes programs.',
      yearsExperience: 12,
      skills: ['TypeScript', 'AWS'],
      languages: [{ name: 'English', level: 'native' }],
      links: { linkedin: 'https://www.linkedin.com/in/ada', other: ['https://ada.dev'] },
      timezone: 'Europe/London',
    };
    expect(profileInput.parse(full)).toEqual(full);
  });

  it('trims text', () => {
    expect(profileInput.parse({ ...minimalProfile, firstName: '  Ada ' }).firstName).toBe('Ada');
  });

  it.each([
    ['missing version', { firstName: 'A', lastName: 'B' }],
    ['negative version', { ...minimalProfile, version: -1 }],
    ['empty first name', { ...minimalProfile, firstName: '   ' }],
    ['too long name', { ...minimalProfile, lastName: 'x'.repeat(101) }],
    ['unknown field', { ...minimalProfile, isAdmin: true }],
    ['userId in body', { ...minimalProfile, userId: 'someone-else' }],
    ['email in body (read-only)', { ...minimalProfile, email: 'x@example.com' }],
    ['bad country', { ...minimalProfile, location: { country: 'United Kingdom' } }],
    ['bad phone code', { ...minimalProfile, phone: { countryCode: '44', number: '123456' } }],
    ['letters in phone', { ...minimalProfile, phone: { countryCode: '+1', number: 'call me' } }],
    ['http link', { ...minimalProfile, links: { linkedin: 'http://linkedin.com/in/a' } }],
    ['javascript link', { ...minimalProfile, links: { website: 'javascript:alert(1)' } }],
    ['IP address link', { ...minimalProfile, links: { website: 'https://169.254.169.254/' } }],
    [
      'too many skills',
      { ...minimalProfile, skills: Array.from({ length: 101 }, (_, i) => `s${i}`) },
    ],
    ['bad language level', { ...minimalProfile, languages: [{ name: 'EN', level: 'fluent' }] }],
    ['unknown time zone', { ...minimalProfile, timezone: 'Mars/Olympus' }],
    ['years out of range', { ...minimalProfile, yearsExperience: 71 }],
    ['fractional years', { ...minimalProfile, yearsExperience: 2.5 }],
  ])('rejects %s', (_, input) => {
    expect(profileInput.safeParse(input).success).toBe(false);
  });
});

describe('searchInput', () => {
  it('accepts settings with salary in any currency', () => {
    const input = {
      version: 3,
      locations: [{ city: 'Bengaluru', country: 'IN' }],
      workplace: ['remote', 'hybrid'],
      employmentTypes: ['full_time'],
      minSalary: { amount: 4_500_000, currency: 'INR', period: 'year' },
      seniority: ['senior'],
      excludeKeywords: ['unpaid'],
    };
    expect(searchInput.parse(input)).toEqual(input);
  });

  it.each([
    ['bad workplace', { version: 0, workplace: ['office'] }],
    [
      'lowercase currency',
      { version: 0, minSalary: { amount: 1, currency: 'usd', period: 'year' } },
    ],
    ['negative salary', { version: 0, minSalary: { amount: -1, currency: 'USD', period: 'year' } }],
    [
      'too many locations',
      { version: 0, locations: Array.from({ length: 21 }, () => ({ country: 'US' })) },
    ],
  ])('rejects %s', (_, input) => {
    expect(searchInput.safeParse(input).success).toBe(false);
  });
});

describe('roles', () => {
  it('creates a role with defaults', () => {
    expect(createRoleInput.parse({ title: 'Backend Engineer' })).toEqual({
      title: 'Backend Engineer',
      altTitles: [],
      seniority: [],
      mustHave: [],
      exclude: [],
      priority: 50,
      active: true,
    });
  });

  it('requires the version on update, and not on create', () => {
    expect(updateRoleInput.safeParse({ title: 'X' }).success).toBe(false);
    expect(updateRoleInput.safeParse({ title: 'X', version: 0 }).success).toBe(false);
    expect(updateRoleInput.safeParse({ title: 'X', version: 1 }).success).toBe(true);
    expect(createRoleInput.safeParse({ title: 'X', version: 1 }).success).toBe(false);
  });

  it.each([
    ['empty title', { title: '' }],
    ['priority out of range', { title: 'X', priority: 101 }],
    ['bad seniority', { title: 'X', seniority: ['wizard'] }],
    [
      'too many alt titles',
      { title: 'X', altTitles: Array.from({ length: 11 }, (_, i) => `t${i}`) },
    ],
  ])('rejects %s', (_, input) => {
    expect(createRoleInput.safeParse(input).success).toBe(false);
  });

  it('caps roles at 10 and validates ULID role IDs', () => {
    expect(MAX_ROLES).toBe(10);
    expect(roleId.safeParse('01J8ZQ4Y3N5W6X7Y8Z9A0B1C2D').success).toBe(true);
    expect(roleId.safeParse('../../etc/passwd').success).toBe(false);
    expect(roleId.safeParse('01j8zq4y3n5w6x7y8z9a0b1c2d').success).toBe(false);
  });
});
