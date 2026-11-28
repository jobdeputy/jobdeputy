import type { Api, ApiResult } from './api.ts';

/**
 * #54: what the deputy can fill in for this person, read from the API when the popup opens: how
 * many of the details forms ask for are saved (#49 profile), a résumé to attach, and how many of
 * the application answers are saved (#53). Each incomplete one links to where it's added in the
 * web app.
 */
export interface Count {
  answered: number;
  total: number;
}

export interface Readiness {
  details: Count;
  resume: boolean;
  answers: Count;
}

/**
 * The résumé the filler attaches when a company has no tailored one: the default, once ready.
 * The popup's "résumé ready" uses the same rule, so it never promises a file the filler lacks.
 */
export function isAttachable(doc: { status?: unknown; isDefault?: unknown } | null): boolean {
  return doc?.isDefault === true && doc.status === 'ready';
}

type Body = Record<string, unknown> | null | undefined;
const has = (value: unknown) =>
  Array.isArray(value)
    ? value.length > 0
    : typeof value === 'string'
      ? value.trim() !== ''
      : value !== undefined && value !== null;
const linksOf = (profile: Body) => (profile?.links ?? {}) as Record<string, unknown>;

/** The details application forms ask for, from the profile. */
const DETAILS: ((profile: Body) => unknown)[] = [
  (p) => p?.firstName,
  (p) => p?.lastName,
  (p) => p?.email,
  (p) => p?.phone,
  (p) => p?.location,
  (p) => linksOf(p).linkedin,
];

/** The application answers (#53), each one a form may ask. */
const ANSWERS = [
  'workAuthorization',
  'noticePeriodDays',
  'earliestStartDate',
  'expectedSalary',
  'willingToRelocate',
  'workSetups',
  'over18',
  'securityClearance',
  'pronouns',
  'heardAbout',
] as const;

function count(checks: (() => unknown)[]): Count {
  return { answered: checks.filter((check) => has(check())).length, total: checks.length };
}

export async function readReadiness(api: Api): Promise<ApiResult<Readiness>> {
  const [profile, documents, applicant] = await Promise.all([
    api.get<Body>('/me/profile'),
    api.get<{ documents?: unknown }>('/me/documents'),
    api.get<Body>('/me/applicant'),
  ]);
  // Signed out wins (the session is gone, whatever else failed), then the first other failure.
  const failed = [profile, documents, applicant].filter((result) => !result.ok);
  const reasons = failed.map((result) => (result.ok ? null : result.reason));
  if (reasons.includes('signed-out')) return { ok: false, reason: 'signed-out' };
  if (!profile.ok) return profile;
  if (!documents.ok) return documents;
  if (!applicant.ok) return applicant;
  // Read defensively: an unexpected shape counts as not there, never as a crash.
  const docs = Array.isArray(documents.body?.documents) ? documents.body.documents : [];
  const answers = applicant.body ?? {};
  return {
    ok: true,
    body: {
      details: count(DETAILS.map((detail) => () => detail(profile.body))),
      resume: docs.some(isAttachable),
      answers: count(ANSWERS.map((key) => () => answers[key])),
    },
  };
}
