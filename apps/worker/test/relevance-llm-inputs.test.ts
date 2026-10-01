import type { Job } from '@jobdeputy/db';
import { describe, expect, it } from 'vitest';
import type { FilterProfile } from '../src/relevance/code-filter.js';
import { inputsHash, modelJob, modelProfile } from '../src/relevance/llm-inputs.js';

const user: FilterProfile = {
  roles: [
    {
      roleId: 'role-a',
      title: 'Backend Engineer',
      altTitles: ['Platform Engineer'],
      seniority: ['senior'],
      locations: [{ city: 'Leeds', country: 'GB' }],
      exclude: ['php'],
      priority: 80,
    },
    { roleId: 'role-b', title: 'SRE', altTitles: [], seniority: [], exclude: [], priority: 40 },
  ],
  search: {
    locations: [{ country: 'GB' }],
    workplace: ['remote'],
    employmentTypes: [],
    minSalary: { amount: 60000, currency: 'GBP', period: 'year' },
    seniority: [],
    excludeKeywords: ['gambling'],
  },
  headline: 'Backend developer',
  skills: ['TypeScript'],
};

const job = {
  jobId: 'job-1',
  title: 'Senior Backend Engineer',
  companyName: 'Acme',
  locations: [{ text: 'Leeds, UK' }],
  salary: { min: 70000, max: 80000, currency: 'GBP', period: 'year' },
  contentHash: 'c1',
  descriptionHash: 'd1',
  filter: {
    state: 'candidate',
    roleIds: ['role-a'],
    reasons: ['title_match'],
    priority: 80,
    version: 1,
  },
} as unknown as Job;

describe('modelProfile', () => {
  it('gives roles short IDs and writes search settings as plain lines', () => {
    const { profile, roleIds } = modelProfile(user, 'r'.repeat(7_000));
    expect(profile.roles.map((r) => [r.id, r.title, r.places])).toEqual([
      ['r1', 'Backend Engineer', ['Leeds, GB']],
      ['r2', 'SRE', []],
    ]);
    expect([...roleIds]).toEqual([
      ['r1', 'role-a'],
      ['r2', 'role-b'],
    ]);
    expect(profile.search).toEqual([
      'places: GB',
      'workplace: remote',
      'minimum salary: 60000 GBP per year',
      'not wanted: gambling',
    ]);
    expect(profile.resume).toHaveLength(6_000);
  });

  it('without search settings or a résumé, sends neither', () => {
    const { profile } = modelProfile({ roles: [], skills: [] });
    expect(profile).toEqual({ roles: [], search: [], skills: [] });
  });
});

describe('modelJob', () => {
  it("passes the filter's verdict as a hint, with the short role ID", () => {
    const { roleIds } = modelProfile(user);
    expect(modelJob(job, 'j1', roleIds)).toMatchObject({
      id: 'j1',
      company: 'Acme',
      places: ['Leeds, UK'],
      salary: '70000-80000 GBP per year',
      hints: ['matched r1 (title_match)'],
    });
  });
});

describe('inputsHash', () => {
  it('changes with the job, its description, the profile, or the prompt version only', () => {
    const base = modelProfile(user, 'cv').hash;
    const hash = inputsHash(job, base, 'relevance@v1');
    expect(inputsHash(job, base, 'relevance@v1')).toBe(hash);
    expect(inputsHash({ ...job, contentHash: 'c2' }, base, 'relevance@v1')).not.toBe(hash);
    expect(inputsHash({ ...job, descriptionHash: 'd2' }, base, 'relevance@v1')).not.toBe(hash);
    expect(inputsHash(job, modelProfile(user, 'new cv').hash, 'relevance@v1')).not.toBe(hash);
    expect(inputsHash(job, base, 'relevance@v2')).not.toBe(hash);
    // What the user does with the job is not an input.
    expect(inputsHash({ ...job, status: 'shortlisted', starred: true }, base, 'relevance@v1')).toBe(
      hash,
    );
  });
});
