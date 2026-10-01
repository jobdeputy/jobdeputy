import { describe, expect, it } from 'vitest';
import {
  countryInText,
  type FilterJob,
  type FilterProfile,
  type FilterRole,
  type FilterSearch,
  filterJob,
  tokens,
} from '../src/relevance/code-filter.js';

/** Synthetic profiles and jobs only (never real people or postings). */
const role = (over: Partial<FilterRole> = {}): FilterRole => ({
  roleId: 'R1',
  title: 'Backend Engineer',
  altTitles: [],
  seniority: [],
  exclude: [],
  priority: 50,
  ...over,
});
const search = (over: Partial<FilterSearch> = {}): FilterSearch => ({
  locations: [],
  workplace: [],
  employmentTypes: [],
  seniority: [],
  excludeKeywords: [],
  ...over,
});
const profile = (over: Partial<FilterProfile> = {}): FilterProfile => ({
  roles: [role()],
  skills: [],
  ...over,
});
const job = (title: string, over: Partial<FilterJob> = {}): FilterJob => ({
  title,
  locations: [],
  ...over,
});
const verdict = (j: FilterJob, p: FilterProfile) => {
  const f = filterJob(j, p);
  return [f.state, ...f.reasons].join(' ');
};

describe('tokens', () => {
  it('normalizes case, accents, punctuation, abbreviations, and word forms', () => {
    expect(tokens('Sr. Software Dev (Back-End)')).toEqual([
      'senior',
      'software',
      'engineer',
      'back',
      'end',
    ]);
    expect(tokens('Développeur Full-Stack')).toEqual(['developpeur', 'full', 'stack']);
    expect(tokens('Frontend Engineering Lead')).toEqual(['front', 'end', 'engineer', 'lead']);
    expect(tokens('C++ / C# / .NET / Node.js developer')).toEqual([
      'c++',
      'c#',
      'net',
      'node.js',
      'engineer',
    ]);
    expect(tokens('ML Engineer')).toEqual(['machine', 'learning', 'engineer']);
  });
});

describe('code filter: titles', () => {
  it.each([
    ['Backend Engineer', 'candidate title_match'],
    ['Senior Backend Engineer', 'candidate title_match'],
    ['Sr. Back-End Developer', 'candidate title_match'],
    ['Backend Software Engineer II', 'candidate title_match'],
    ['Software Engineer, Backend (Payments)', 'candidate title_match'],
    ['BACKEND ENGINEER', 'candidate title_match'],
    ['Frontend Engineer', 'not_relevant title_no_match'],
    ['Engineer', 'not_relevant title_no_match'],
    ['Backend', 'not_relevant title_no_match'],
    ['Account Executive', 'not_relevant title_no_match'],
  ])('%s → %s', (title, expected) => {
    expect(verdict(job(title), profile())).toBe(expected);
  });

  it('matches any of the role titles, and names every matching role', () => {
    const p = profile({
      roles: [
        role({
          roleId: 'R1',
          title: 'Data Engineer',
          altTitles: ['Analytics Engineer'],
          priority: 30,
        }),
        role({ roleId: 'R2', title: 'Machine Learning Engineer', priority: 80 }),
        role({ roleId: 'R3', title: 'Data Scientist' }),
      ],
    });
    expect(filterJob(job('Senior Analytics Engineer'), p)).toMatchObject({
      state: 'candidate',
      roleIds: ['R1'],
      priority: 30,
    });
    expect(filterJob(job('ML Data Engineer'), p)).toMatchObject({
      state: 'candidate',
      roleIds: ['R1', 'R2'],
      priority: 80,
    });
  });

  it('a role title of only level words still has to match', () => {
    expect(verdict(job('Senior Designer'), profile({ roles: [role({ title: 'Senior' })] }))).toBe(
      'candidate title_match',
    );
    expect(verdict(job('Designer'), profile({ roles: [role({ title: 'Senior' })] }))).toBe(
      'not_relevant title_no_match',
    );
  });
});

describe('code filter: level', () => {
  const p = (seniority: FilterRole['seniority'], title = 'Backend Engineer') =>
    profile({ roles: [role({ seniority, title })] });

  it.each([
    ['Senior Backend Engineer', ['senior'], 'candidate title_match'],
    ['Backend Engineer', ['senior'], 'candidate title_match'],
    ['Junior Backend Engineer', ['senior'], 'not_relevant seniority'],
    ['Backend Engineering Intern', ['senior', 'lead'], 'not_relevant seniority'],
    ['Staff Backend Engineer', ['lead'], 'candidate title_match'],
    ['Principal Backend Engineer', ['mid', 'senior'], 'not_relevant seniority'],
    ['Head of Backend Engineering', ['director'], 'candidate title_match'],
    ['Backend Engineer', [], 'candidate title_match'],
  ] as const)('%s with %j → %s', (title, levels, expected) => {
    expect(verdict(job(title), p([...levels]))).toBe(expected);
  });

  it('a word of the role title is not a level ("Product Manager" is not a manager level)', () => {
    expect(verdict(job('Senior Product Manager'), p(['senior'], 'Product Manager'))).toBe(
      'candidate title_match',
    );
    expect(verdict(job('Product Manager'), p(['senior'], 'Product Manager'))).toBe(
      'candidate title_match',
    );
  });

  it("uses the search settings' levels when the role has none", () => {
    const withSearch = profile({ search: search({ seniority: ['junior'] }) });
    expect(verdict(job('Senior Backend Engineer'), withSearch)).toBe('not_relevant seniority');
  });
});

describe('code filter: places', () => {
  const pune = { city: 'Pune', country: 'IN' };
  const at = (...locations: FilterJob['locations']) => job('Backend Engineer', { locations });
  const p = (places: FilterRole['locations'] = [pune]) =>
    profile({ roles: [role({ locations: places })] });

  it.each([
    ['same city', at({ text: 'Pune, IN', city: 'Pune', country: 'IN' }), 'candidate title_match'],
    ['city in text only', at({ text: 'Pune, Maharashtra' }), 'candidate title_match'],
    [
      'other city, same country',
      at({ text: 'Bengaluru, IN', city: 'Bengaluru', country: 'IN' }),
      'not_relevant place',
    ],
    ['other country', at({ text: 'Berlin, Germany' }), 'not_relevant place'],
    ['US state code', at({ text: 'Austin, TX' }), 'not_relevant place'],
    ['unknown place', at({ text: 'Bengaluru' }), 'candidate title_match'],
    ['no place given', at(), 'candidate title_match'],
    [
      'one of several places',
      at({ text: 'London, UK' }, { text: 'Pune, India' }),
      'candidate title_match',
    ],
    ['remote in the country', at({ text: 'Remote - India' }), 'candidate title_match'],
    ['remote elsewhere', at({ text: 'Remote - US' }), 'not_relevant place'],
    ['remote anywhere', at({ text: 'Remote' }), 'candidate title_match'],
  ])('%s', (_name, j, expected) => {
    expect(verdict(j, p())).toBe(expected);
  });

  it('a country-only place fits any city there', () => {
    expect(verdict(at({ text: 'Hyderabad, IN', country: 'IN' }), p([{ country: 'IN' }]))).toBe(
      'candidate title_match',
    );
  });

  it("uses the search settings' places when the role has none; none at all means anywhere", () => {
    const withSearch = profile({ search: search({ locations: [{ country: 'GB' }] }) });
    expect(verdict(at({ text: 'Pune, India' }), withSearch)).toBe('not_relevant place');
    expect(verdict(at({ text: 'Pune, India' }), profile())).toBe('candidate title_match');
  });
});

describe('countryInText', () => {
  it.each([
    ['Berlin, Germany', 'DE'],
    ['London, United Kingdom', 'GB'],
    ['Remote - US', 'US'],
    ['Remote (UK)', 'GB'],
    ['San Francisco, CA', 'US'],
    ['Toronto, ON', 'CA'],
    ['Mumbai, Maharashtra, India', 'IN'],
    ['Bengaluru', undefined],
    ['Work in person', undefined],
  ])('%s → %s', (text, code) => {
    expect(countryInText(text)).toBe(code);
  });
});

describe('code filter: search settings', () => {
  it('drops a stated workplace or job type the user does not want; unstated ones pass', () => {
    const p = profile({
      search: search({ workplace: ['remote'], employmentTypes: ['full_time'] }),
    });
    expect(verdict(job('Backend Engineer', { workplace: 'onsite' }), p)).toBe(
      'not_relevant workplace',
    );
    expect(verdict(job('Backend Engineer', { employmentType: 'contract' }), p)).toBe(
      'not_relevant employment_type',
    );
    expect(
      verdict(job('Backend Engineer', { workplace: 'remote', employmentType: 'full_time' }), p),
    ).toBe('candidate title_match');
    expect(verdict(job('Backend Engineer'), p)).toBe('candidate title_match');
  });

  it('drops a salary whose top is below the minimum, in the same currency, per year', () => {
    const p = profile({
      search: search({ minSalary: { amount: 100_000, currency: 'USD', period: 'year' } }),
    });
    const paid = (
      min: number | undefined,
      max: number | undefined,
      currency = 'USD',
      period = 'year',
    ) =>
      job('Backend Engineer', {
        salary: {
          ...(min !== undefined ? { min } : {}),
          ...(max !== undefined ? { max } : {}),
          currency,
          period,
        },
      });
    expect(verdict(paid(80_000, 95_000), p)).toBe('not_relevant salary_below');
    expect(verdict(paid(80_000, 120_000), p)).toBe('candidate title_match');
    expect(verdict(paid(90_000, undefined), p)).toBe('not_relevant salary_below');
    expect(verdict(paid(40, 45, 'USD', 'hour'), p)).toBe('not_relevant salary_below');
    expect(verdict(paid(50, 60, 'USD', 'hour'), p)).toBe('candidate title_match');
    expect(verdict(paid(9_000, 10_000, 'USD', 'month'), p)).toBe('candidate title_match');
    // Another currency: not compared (no exchange rates), so kept.
    expect(verdict(paid(10, 20, 'INR'), p)).toBe('candidate title_match');
    expect(verdict(paid(undefined, undefined), p)).toBe('candidate title_match');
  });

  it('excluded words and phrases drop a job by its title only, and say which', () => {
    const p = profile({
      search: search({ excludeKeywords: ['PHP', 'Sales Engineer'] }),
      roles: [role({ exclude: ['crypto'] })],
    });
    expect(verdict(job('Backend Engineer (PHP)'), p)).toBe('not_relevant excluded_word:php');
    expect(verdict(job('Backend Engineer, Crypto'), p)).toBe('not_relevant excluded_word:crypto');
    expect(verdict(job('Backend Engineer, Sales'), p)).toBe('candidate title_match');
    expect(verdict(job('Backend Engineer (PHPUnit tooling)'), p)).toBe('candidate title_match');
  });

  it('reports every reason at once', () => {
    const p = profile({
      search: search({ workplace: ['remote'], excludeKeywords: ['php'] }),
      roles: [role({ locations: [{ country: 'IN' }], seniority: ['senior'] })],
    });
    expect(
      filterJob(
        job('Junior Backend Engineer PHP', {
          workplace: 'onsite',
          locations: [{ text: 'Paris, France' }],
        }),
        p,
      ).reasons,
    ).toEqual(['excluded_word:php', 'workplace', 'seniority', 'place']);
  });

  it('a role excluded word only applies to that role', () => {
    const p = profile({
      roles: [
        role({ roleId: 'R1', exclude: ['payments'] }),
        role({ roleId: 'R2', title: 'Software Engineer' }),
      ],
    });
    expect(filterJob(job('Backend Software Engineer, Payments'), p)).toMatchObject({
      state: 'candidate',
      roleIds: ['R2'],
    });
  });
});

describe('code filter: no active roles', () => {
  it('matches the headline as a title (its first part)', () => {
    const p = profile({ roles: [], headline: 'Backend engineer | Kafka, AWS' });
    expect(verdict(job('Senior Backend Engineer'), p)).toBe('candidate headline_match');
    expect(verdict(job('Office Manager'), p)).toBe('not_relevant title_no_match');
    expect(
      verdict(
        job('Backend Engineer'),
        profile({ roles: [], headline: 'Backend engineer at Acme' }),
      ),
    ).toBe('candidate headline_match');
  });

  it('with a headline, a skill in the title also counts', () => {
    const p = profile({ roles: [], headline: 'Backend Engineer', skills: ['Kafka'] });
    expect(verdict(job('Kafka Platform Specialist'), p)).toBe('candidate skill_in_title');
  });

  it('with skills only, a skill in the title is noted and nothing is dropped for lacking one', () => {
    const p = profile({ roles: [], skills: ['React', 'Go'] });
    expect(verdict(job('React Native Developer'), p)).toBe('candidate skill_in_title');
    expect(verdict(job('Office Manager'), p)).toBe('candidate no_target_roles');
  });

  it('with nothing at all, keeps everything, but the search settings still apply', () => {
    const p = profile({
      roles: [],
      search: search({ excludeKeywords: ['php'], locations: [{ country: 'IN' }] }),
    });
    expect(verdict(job('Anything'), p)).toBe('candidate no_target_roles');
    expect(verdict(job('PHP Developer'), p)).toBe('not_relevant excluded_word:php');
    expect(verdict(job('Anything', { locations: [{ text: 'Berlin, Germany' }] }), p)).toBe(
      'not_relevant place',
    );
  });

  it('an empty or odd title never throws', () => {
    expect(verdict(job(''), profile())).toBe('not_relevant title_no_match');
    expect(verdict(job('!!! ---'), profile())).toBe('not_relevant title_no_match');
    expect(verdict(job('x'.repeat(300)), profile({ roles: [] }))).toBe('candidate no_target_roles');
  });
});
