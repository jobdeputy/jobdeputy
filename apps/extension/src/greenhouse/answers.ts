import type { VoluntaryAnswers } from '@jobdeputy/shared/applicant';
import type { FillData } from '../fill/data.ts';
import type { FileData } from '../fill/files.ts';

/**
 * #54 PR C: which saved answer a Greenhouse question gets, from its field ID (the form's own
 * fields and the US self-ID questions) or its label (each company's own questions). Never a
 * guess (decision 0019): a question no rule names, or a choice whose options don't hold exactly
 * one match for the answer, is left for the person.
 */
export type Want =
  | { kind: 'text'; value: string }
  /** The option to choose: its index, or null when no option (or more than one) fits. */
  | { kind: 'choice'; pick: (options: string[]) => number | null }
  | { kind: 'file'; file: FileData };

export interface Question {
  /** The field's element ID: `first_name`, `gender`, `question_39226987002`, … */
  id: string;
  label: string;
  kind: 'text' | 'choice' | 'file';
}

const norm = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** The one option that matches, else null (none, or several: never a guess). */
function only(options: string[], matches: (option: string) => boolean): number | null {
  const found = options.flatMap((option, index) => (matches(norm(option)) ? [index] : []));
  return found.length === 1 ? (found[0] ?? null) : null;
}

const DECLINE =
  /decline|don'?t wish|do not wish|prefer not|not to (say|answer|disclose|self-identify)|choose not|rather not/;

/** Plain "Yes" or "No" (a trailing full stop allowed): never "Yes, with a Blue Card". */
const yesNo = (answer: boolean) => (options: string[]) =>
  only(options, (option) => option.replace(/\.$/, '') === (answer ? 'yes' : 'no'));

function choice(pick: (options: string[]) => number | null): Want {
  return { kind: 'choice', pick };
}

/** A yes/no answer as the question asks it: a choice, or the word in a text box. */
function yesNoWant(question: Question, answer: boolean | undefined): Want | null {
  if (answer === undefined) return null;
  return question.kind === 'choice'
    ? choice(yesNo(answer))
    : { kind: 'text', value: answer ? 'Yes' : 'No' };
}

function textWant(question: Question, value: string | undefined): Want | null {
  return question.kind === 'text' && value ? { kind: 'text', value } : null;
}

const countryName = (code: string) =>
  new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;

/**
 * Other names forms use for a place: short forms and unions. Only dotted or multi-letter forms:
 * a bare "us" is also the word "us" ("tell us"), so it never names a country.
 */
const ALIASES: Record<string, string[]> = {
  US: ['united states of america', 'usa', 'u.s.', 'u.s.a.'],
  GB: [
    'united kingdom of great britain and northern ireland',
    'uk',
    'u.k.',
    'great britain',
    'britain',
    'england',
    'scotland',
    'wales',
    'northern ireland',
  ],
  AE: ['uae', 'u.a.e.', 'emirates'],
  /** Not a country, but a question about it is never about the US. */
  EU: ['eu', 'e.u.', 'european union', 'europe', 'eea', 'schengen'],
};

/** Names forms use for a country, the official one first. */
function countryNames(code: string): string[] {
  return [...(code === 'EU' ? [] : [norm(countryName(code))]), ...(ALIASES[code] ?? [])];
}

/** Every place a question might name, by code: Intl's countries and the aliases above. */
let places: Map<string, string[]> | undefined;
function everyPlace(): Map<string, string[]> {
  if (!places) {
    places = new Map([['EU', countryNames('EU')]]);
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const a of letters) {
      for (const b of letters) {
        if (countryName(a + b) !== a + b) places.set(a + b, countryNames(a + b));
      }
    }
  }
  return places;
}

const mentions = (label: string, name: string) =>
  new RegExp(`(^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`).test(label);

/**
 * The work authorization a question is about: the one saved country it names; the US when it
 * names no place at all (the US-only launch, decision 0017); none otherwise (only places with
 * no saved answer, like the UK or the EU, or several saved ones).
 */
function authorizationFor(data: FillData, label: string) {
  const list = data.applicant?.workAuthorization ?? [];
  const named = [...everyPlace()]
    .filter(([, names]) => names.some((name) => mentions(label, name)))
    .map(([code]) => code);
  // A saved country the question names wins, even when another name matches too (a US state
  // called like a country: New Jersey, Georgia); two saved ones named is the person's call.
  const saved = list.filter((entry) => named.includes(entry.country));
  if (saved.length === 1) return saved[0];
  if (saved.length > 1 || named.length > 0) return undefined;
  return list.find((entry) => entry.country === 'US');
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function salaryText(data: FillData): string | undefined {
  const range = data.applicant?.expectedSalary;
  if (!range) return undefined;
  const per = range.period === 'year' ? 'per year' : 'per hour';
  const top = range.max !== undefined && range.max !== range.min;
  return `${money(range.min, range.currency)}${top ? `–${money(range.max ?? 0, range.currency)}` : ''} ${per}`;
}

function noticeText(days: number | undefined): string | undefined {
  if (days === undefined) return undefined;
  if (days === 0) return 'Immediately';
  if (days % 7 === 0) return `${days / 7} week${days === 7 ? '' : 's'}`;
  return `${days} day${days === 1 ? '' : 's'}`;
}

function dateText(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}

/** How each "how did you hear" answer is worded in forms. */
const HEARD: Record<string, RegExp> = {
  company_website: /company('s)? (web)?site|careers? (page|site)|our website/,
  job_board: /job board|indeed|glassdoor|ziprecruiter/,
  linkedin: /linkedin/,
  referral: /referr(al|ed)|employee/,
  recruiter: /recruiter/,
  social_media: /social media|twitter|facebook|instagram/,
  other: /^other\b/,
};

/** The self-ID answers as US forms word their options (EEO-1, VEVRAA, Section 503). */
const VOLUNTARY: {
  [K in keyof VoluntaryAnswers]: Record<VoluntaryAnswers[K], (option: string) => boolean>;
} = {
  gender: {
    female: (o) => /^(female|woman)\b/.test(o),
    male: (o) => /^(male|man)\b/.test(o),
    non_binary: (o) => /non[- ]?binary/.test(o),
    decline: (o) => DECLINE.test(o),
  },
  hispanicLatino: {
    yes: (o) => /^yes\b/.test(o),
    no: (o) => /^no\b/.test(o),
    decline: (o) => DECLINE.test(o),
  },
  race: {
    american_indian_alaska_native: (o) => /american indian|alaska native/.test(o),
    asian: (o) => /^asian\b/.test(o),
    black_african_american: (o) => /^black|african american/.test(o),
    native_hawaiian_pacific_islander: (o) => /hawaiian|pacific islander/.test(o),
    white: (o) => /^white\b/.test(o),
    two_or_more: (o) => /two or more/.test(o),
    decline: (o) => DECLINE.test(o),
  },
  veteran: {
    protected: (o) => /identify as (one or more|a protected)|^i am a (protected )?veteran/.test(o),
    not_protected: (o) => /not a protected veteran|^i am not a/.test(o),
    decline: (o) => DECLINE.test(o),
  },
  disability: {
    yes: (o) => /^yes\b/.test(o),
    no: (o) => /^no\b/.test(o),
    decline: (o) => DECLINE.test(o),
  },
};

/** Greenhouse's self-ID field IDs. */
const VOLUNTARY_IDS: Record<string, keyof VoluntaryAnswers> = {
  gender: 'gender',
  hispanic_ethnicity: 'hispanicLatino',
  race: 'race',
  veteran_status: 'veteran',
  disability_status: 'disability',
};

function voluntaryWant(data: FillData, key: keyof VoluntaryAnswers): Want | null {
  const answer = data.voluntary?.[key];
  if (answer === undefined) return null;
  const matches = (VOLUNTARY[key] as Record<string, (option: string) => boolean>)[answer];
  return matches ? choice((options) => only(options, matches)) : null;
}

/** The form's own fields, by ID. */
function byId(question: Question, data: FillData): Want | null | undefined {
  const { person } = data;
  switch (question.id) {
    case 'first_name':
      return textWant(question, person.firstName);
    case 'last_name':
      return textWant(question, person.lastName);
    case 'preferred_name':
      return textWant(question, person.preferredName);
    case 'email':
      return textWant(question, person.email);
    case 'phone':
      return textWant(
        question,
        person.phone ? `${person.phone.countryCode} ${person.phone.number}` : undefined,
      );
    case 'country': {
      // The phone's country (a choice beside the number): the person's country, as named, or
      // named with its calling code ("United States +1").
      const code = person.location?.country;
      if (!code) return null;
      const names = countryNames(code);
      return choice((options) =>
        only(options, (o) => names.some((name) => o === name || o.startsWith(`${name} +`))),
      );
    }
    case 'resume':
      return data.resume ? { kind: 'file', file: data.resume } : null;
    case 'cover_letter':
      return data.coverLetter ? { kind: 'file', file: data.coverLetter } : null;
  }
  const voluntary = VOLUNTARY_IDS[question.id];
  return voluntary ? voluntaryWant(data, voluntary) : undefined;
}

/** Asks whether the person may work ("are you authorized to work…"). */
const ASKS_AUTHORIZED = /(authori[sz]ed|eligible|permitted) to work|right to work/;
/** Names work authorization, maybe only as the goal ("…sponsorship to maintain work authorization"). */
const NAMES_AUTHORIZATION = /work authori[sz]ation/;
/** Asks whether sponsorship is needed. */
const ASKS_SPONSORSHIP = /sponsor/;
/** "…without sponsorship": asks about authorization with no sponsorship, not about sponsorship. */
const WITHOUT_SPONSORSHIP = /without[^?]{0,30}sponsor/;

/**
 * Work authorization and sponsorship, worded every way forms word them:
 * - "authorized … without sponsorship?": yes only when authorized and no sponsorship is needed;
 * - "authorized to work …, and will you need sponsorship?": two questions in one, left;
 * - "will you need sponsorship (to keep your work authorization)?": the sponsorship answer;
 * - "are you authorized to work / your work authorization?": the authorization answer.
 */
function authorizationWant(q: Question, d: FillData, label: string): Want | null {
  const auth = authorizationFor(d, label);
  if (!auth) return null;
  if (WITHOUT_SPONSORSHIP.test(label))
    return yesNoWant(q, auth.authorized && !auth.needsSponsorship);
  if (ASKS_SPONSORSHIP.test(label)) {
    return ASKS_AUTHORIZED.test(label) ? null : yesNoWant(q, auth.needsSponsorship);
  }
  return yesNoWant(q, auth.authorized);
}

/** Each company's own questions, by what their label asks. The first rule that names it wins. */
const RULES: { asks: RegExp; want: (q: Question, d: FillData, label: string) => Want | null }[] = [
  // First: a "how did you hear" question may name LinkedIn as an example, and isn't a link.
  {
    asks: /how did you (hear|find|learn)|where did you (hear|find|learn)|how you heard|referral source/,
    want: (q, d) => {
      const heard = d.applicant?.heardAbout;
      const matches = heard ? HEARD[heard] : undefined;
      return q.kind === 'choice' && matches
        ? choice((options) => only(options, (o) => matches.test(o)))
        : null;
    },
  },
  {
    asks: new RegExp(
      `${ASKS_AUTHORIZED.source}|${NAMES_AUTHORIZATION.source}|${ASKS_SPONSORSHIP.source}`,
    ),
    want: authorizationWant,
  },
  { asks: /linkedin/, want: (q, d) => textWant(q, d.person.links.linkedin) },
  { asks: /github/, want: (q, d) => textWant(q, d.person.links.github) },
  {
    asks: /portfolio/,
    want: (q, d) => textWant(q, d.person.links.portfolio ?? d.person.links.website),
  },
  {
    asks: /\bwebsite\b|personal (site|page)/,
    want: (q, d) => textWant(q, d.person.links.website ?? d.person.links.portfolio),
  },
  {
    asks: /preferred (first )?name|name you('d| would) (prefer|like)|prefer to be called/,
    want: (q, d) => textWant(q, d.person.preferredName),
  },
  { asks: /pronoun/, want: (q, d) => textWant(q, d.applicant?.pronouns) },
  { asks: /relocat/, want: (q, d) => yesNoWant(q, d.applicant?.willingToRelocate) },
  {
    asks: /\b18 years|at least 18|over (the age of )?18|age of 18|18 or older/,
    want: (q, d) => yesNoWant(q, d.applicant?.over18),
  },
  {
    asks: /(salary|compensation|pay) (expectation|requirement|range)|(expected|desired) (salary|compensation|pay)/,
    want: (q, d) => textWant(q, salaryText(d)),
  },
  { asks: /notice period/, want: (q, d) => textWant(q, noticeText(d.applicant?.noticePeriodDays)) },
  {
    asks: /(earliest|available|availability)[^?]{0,30}start|start date|when (can|could) you start/,
    want: (q, d) => textWant(q, dateText(d.applicant?.earliestStartDate)),
  },
];

/** What a question gets, or null to leave it for the person. */
export function answerFor(question: Question, data: FillData): Want | null {
  const known = byId(question, data);
  if (known !== undefined) return known;
  if (question.kind === 'file') return null;
  const label = norm(question.label);
  const rule = RULES.find(({ asks }) => asks.test(label));
  return rule ? rule.want(question, data, label) : null;
}
