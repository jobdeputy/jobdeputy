import { copy } from '@/copy/index.ts';
import type { Profile } from '@/lib/api/profile.ts';
import { COUNTRY, type FieldSpec, type SaveBody } from './profile-form.tsx';

/**
 * The profile's fields as the forms edit them (#33): how each reads from the saved profile, how
 * its problems are named, and helpers that put answers back (the API's shapes:
 * packages/shared/src/profile.ts). Empty optional answers are left out (the API refuses "").
 */

type Location = { city?: string; region?: string; postalCode?: string; country?: string };
type Phone = { countryCode?: string; number?: string };
type Links = Record<string, unknown> & { other?: string[] };

/** How many other web addresses a profile keeps (the API's `links.other`). */
export const MAX_OTHER_LINKS = 10;

/** The US calling code, which a phone number gets when none is typed (US-only launch). */
export const US_CALLING_CODE = '+1';

const str = (value: unknown) => (typeof value === 'string' ? value : '');

/** A text field at the top level of the profile. */
function top(key: string, invalid: string, missing?: string): FieldSpec {
  return {
    read: (profile) => str(profile[key]),
    paths: [key],
    invalid,
    ...(missing ? { missing } : {}),
  };
}

export const nameFields = {
  firstName: top(
    'firstName',
    copy.setUp.errors.firstNameInvalid,
    copy.setUp.errors.firstNameMissing,
  ),
  lastName: top('lastName', copy.setUp.errors.lastNameInvalid, copy.setUp.errors.lastNameMissing),
  preferredName: top('preferredName', copy.profilePage.errors.preferredNameInvalid),
  headline: top('headline', copy.profilePage.errors.headlineInvalid),
};

/** Sets a top-level optional answer, or leaves it out when empty. */
export function putText(body: SaveBody, key: string, answer: string) {
  if (answer) body[key] = answer;
  else delete body[key];
}

export function readCity(profile: Profile): string {
  return (profile.location as Location | undefined)?.city ?? '';
}

/** The city, in the location, which keeps its saved region and postal code (and the country). */
export function putCity(body: SaveBody, city: string) {
  const { city: _city, ...place } = (body.location as Location | undefined) ?? {};
  body.location = { ...place, country: place.country ?? COUNTRY, ...(city ? { city } : {}) };
}

export const phoneFields = {
  phoneCode: {
    read: (profile) => (profile.phone as Phone | undefined)?.countryCode ?? US_CALLING_CODE,
    paths: ['phone.countryCode'],
    invalid: copy.profilePage.errors.phoneCodeInvalid,
  },
  phoneNumber: {
    read: (profile) => (profile.phone as Phone | undefined)?.number ?? '',
    paths: ['phone.number', 'phone'],
    invalid: copy.profilePage.errors.phoneNumberInvalid,
  },
} satisfies Record<string, FieldSpec>;

/** The phone: a number with its calling code (+1 when none is typed), or none at all. */
export function putPhone(body: SaveBody, code: string, number: string) {
  if (number) body.phone = { countryCode: code || US_CALLING_CODE, number };
  else delete body.phone;
}

/**
 * A web address as it is saved: trimmed, with `https://` added when no scheme was typed
 * (`linkedin.com/in/alex`), so the API's https-only rule only refuses a typed `http://`.
 */
export function normUrl(typed: string): string {
  const value = typed.trim();
  return value && !/^[a-z][a-z\d+.-]*:/i.test(value) ? `https://${value}` : value;
}

/** Several web addresses, one per line, as they are saved (blank lines dropped). */
export function normUrls(typed: string): string {
  return typed.split('\n').map(normUrl).filter(Boolean).join('\n');
}

function readLinks(profile: Profile): Links {
  return (profile.links as Links | undefined) ?? {};
}

function link(key: 'linkedin' | 'github' | 'portfolio' | 'website'): FieldSpec {
  return {
    read: (profile) => str(readLinks(profile)[key]),
    norm: normUrl,
    paths: [`links.${key}`],
    invalid: copy.profilePage.errors.linkInvalid,
  };
}

export const linkFields = {
  linkedin: link('linkedin'),
  github: link('github'),
  portfolio: link('portfolio'),
  website: link('website'),
  other: {
    read: (profile) => (readLinks(profile).other ?? []).join('\n'),
    norm: normUrls,
    paths: ['links.other'],
    invalid: copy.profilePage.errors.otherLinksInvalid,
    tooMany: copy.profilePage.errors.otherLinksTooMany,
  },
} satisfies Record<string, FieldSpec>;

/** The links: each address, or none; the other addresses as a list (one per line typed). */
export function putLinks(body: SaveBody, answers: Record<keyof typeof linkFields, string>) {
  const links: Links = { ...readLinks(body as Profile) };
  for (const key of ['linkedin', 'github', 'portfolio', 'website'] as const) {
    if (answers[key]) links[key] = answers[key];
    else delete links[key];
  }
  links.other = answers.other ? answers.other.split('\n') : [];
  body.links = links;
}
