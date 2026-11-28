import type { Api, ApiResult } from './api.ts';
import { APPLICANT_KEYS, applicant, documents, isAttachable, person } from './fill/data.ts';

/** How many of a section's questions are saved, and whether the section is ready. */
export interface Count {
  answered: number;
  total: number;
  /** What nearly every form asks is saved: the section is ticked. */
  ready: boolean;
}

export interface Readiness {
  details: Count;
  resume: boolean;
  answers: Count;
}

const has = (value: unknown) =>
  Array.isArray(value)
    ? value.length > 0
    : typeof value === 'string'
      ? value.trim() !== ''
      : value !== undefined && value !== null;

/**
 * #54: what the deputy can fill in for this person, read from the API when the popup opens: how
 * many of the details forms ask for are saved (#49 profile), a résumé to attach, and how many of
 * the application answers are saved (#53). Each is read the way the filler reads it, so the
 * popup never calls saved what the filler would drop. A section is ready once what nearly every
 * form asks is there; the rest is counted, never demanded (some are optional, like pronouns).
 */
export async function readReadiness(api: Api): Promise<ApiResult<Readiness>> {
  const [profile, docList, answers] = await Promise.all([
    api.get<unknown>('/me/profile'),
    api.get<unknown>('/me/documents'),
    api.get<unknown>('/me/applicant'),
  ]);
  // Signed out wins (the session is gone, whatever else failed), then the first other failure.
  const failed = [profile, docList, answers].filter((result) => !result.ok);
  const reasons = failed.map((result) => (result.ok ? null : result.reason));
  if (reasons.includes('signed-out')) return { ok: false, reason: 'signed-out' };
  if (!profile.ok) return profile;
  if (!docList.ok) return docList;
  if (!answers.ok) return answers;
  // Read as the filler reads them: an odd answer counts as not there, never as a crash. A
  // profile it can't read at all, it won't fill from: said as a failed read here too.
  const me = person.safeParse(profile.body ?? {});
  if (!me.success) return { ok: false, reason: 'failed' };
  const details = me.data;
  const detailFields = [
    details.firstName,
    details.lastName,
    details.email,
    details.phone,
    details.location,
    details.links.linkedin,
  ];
  const saved = applicant.safeParse(answers.body ?? {});
  const values: Record<string, unknown> =
    saved.success && saved.data.version > 0 ? saved.data.values : {};
  const docs = documents.safeParse(docList.body);
  return {
    ok: true,
    body: {
      details: {
        answered: detailFields.filter(has).length,
        total: detailFields.length,
        // Every form asks for these three.
        ready: [details.firstName, details.lastName, details.email].every(has),
      },
      resume: docs.success && docs.data.documents.some(isAttachable),
      answers: {
        answered: APPLICANT_KEYS.filter((key) => has(values[key])).length,
        total: APPLICANT_KEYS.length,
        // US forms nearly all ask whether you may work in the US: the answer the filler gives.
        ready:
          Array.isArray(values.workAuthorization) &&
          values.workAuthorization.some(
            (entry) => (entry as { country?: unknown }).country === 'US',
          ),
      },
    },
  };
}
