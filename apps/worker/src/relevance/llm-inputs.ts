import { createHash } from 'node:crypto';
import type { Job } from '@jobdeputy/db';
import type { RelevanceJob, RelevanceProfile } from '@jobdeputy/llm';
import { RELEVANCE_RESUME_CHARS } from '@jobdeputy/llm';
import type { FilterPlace, FilterProfile } from './code-filter.js';

/**
 * T08d: what the relevance task is sent. The model sees short IDs (`r1`, `j1`) only; these
 * maps turn them back into ours. Nothing here calls anything: the worker does.
 */

const place = (p: FilterPlace) => [p.city, p.region, p.country].filter(Boolean).join(', ');

export interface ModelProfile {
  profile: RelevanceProfile;
  /** Short role ID → roleId. */
  roleIds: Map<string, string>;
  /** Over everything the model is told about the user (part of each job's inputs hash). */
  hash: string;
}

/** The user as the model sees them: active roles, search settings, headline, skills, résumé. */
export function modelProfile(user: FilterProfile, resume?: string): ModelProfile {
  const roleIds = new Map<string, string>();
  const roles = user.roles.map((r, i) => {
    const id = `r${i + 1}`;
    roleIds.set(id, r.roleId);
    return {
      id,
      title: r.title,
      altTitles: r.altTitles,
      seniority: r.seniority,
      places: (r.locations ?? []).map(place),
      exclude: r.exclude,
      priority: r.priority,
    };
  });
  const s = user.search;
  const search = s
    ? [
        ...(s.locations.length > 0 ? [`places: ${s.locations.map(place).join('; ')}`] : []),
        ...(s.workplace.length > 0 ? [`workplace: ${s.workplace.join(', ')}`] : []),
        ...(s.employmentTypes.length > 0 ? [`job types: ${s.employmentTypes.join(', ')}`] : []),
        ...(s.minSalary
          ? [
              `minimum salary: ${s.minSalary.amount} ${s.minSalary.currency} per ${s.minSalary.period}`,
            ]
          : []),
        ...(s.seniority.length > 0 ? [`level: ${s.seniority.join(', ')}`] : []),
        ...(s.excludeKeywords.length > 0 ? [`not wanted: ${s.excludeKeywords.join(', ')}`] : []),
      ]
    : [];
  const profile: RelevanceProfile = {
    roles,
    search,
    ...(user.headline ? { headline: user.headline } : {}),
    skills: user.skills,
    ...(resume ? { resume: resume.slice(0, RELEVANCE_RESUME_CHARS) } : {}),
  };
  return { profile, roleIds, hash: sha(profile) };
}

/** One job as the model sees it, with the keyword filter's verdict as a hint. */
export function modelJob(job: Job, id: string, roleIds: Map<string, string>): RelevanceJob {
  const shortRole = new Map([...roleIds].map(([short, roleId]) => [roleId, short]));
  const matched = (job.filter?.roleIds ?? []).flatMap((r) => shortRole.get(r) ?? []);
  const reasons = (job.filter?.reasons ?? []).join(', ');
  const salary = job.salary
    ? `${[job.salary.min, job.salary.max].filter((n) => n !== undefined).join('-')} ${job.salary.currency} per ${job.salary.period}`
    : undefined;
  return {
    id,
    title: job.title,
    company: job.companyName,
    places: job.locations.map((l) => l.text),
    workplace: job.workplace,
    employmentType: job.employmentType,
    salary,
    description: job.description,
    hints:
      matched.length > 0
        ? [`matched ${matched.join(', ')} (${reasons})`]
        : reasons
          ? [reasons]
          : [],
  };
}

/**
 * What a score depends on: the job's content and description, the user, and the prompt
 * version. A re-crawl scores a job again only when this changes.
 */
export function inputsHash(job: Job, profileHash: string, promptVersion: string): string {
  return sha({
    c: job.contentHash,
    d: job.descriptionHash ?? null,
    p: profileHash,
    v: promptVersion,
  });
}

function sha(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}
