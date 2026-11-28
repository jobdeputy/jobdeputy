import type { Api, ApiResult } from './api.ts';

/**
 * #54: what the deputy can fill in for this person, read from the API when the popup opens: their
 * details (#49 profile), a résumé to attach, and their application answers (#53). Each missing
 * one links to where it's added in the web app.
 */
export interface Readiness {
  details: boolean;
  resume: boolean;
  answers: boolean;
}

interface Profile {
  version: number;
  firstName?: string;
  lastName?: string;
  email?: string;
}
interface Documents {
  documents: { status: string; isDefault?: boolean }[];
}

/**
 * The résumé the filler attaches when a company has no tailored one: the default, once ready.
 * The popup's "résumé ready" uses the same rule, so it never promises a file the filler lacks.
 */
export function isAttachable(doc: { status?: unknown; isDefault?: unknown } | null): boolean {
  return doc?.isDefault === true && doc.status === 'ready';
}
interface Applicant {
  version: number;
}

export async function readReadiness(api: Api): Promise<ApiResult<Readiness>> {
  const [profile, documents, applicant] = await Promise.all([
    api.get<Profile>('/me/profile'),
    api.get<Documents>('/me/documents'),
    api.get<Applicant>('/me/applicant'),
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
  return {
    ok: true,
    body: {
      details: Boolean(profile.body?.firstName && profile.body.lastName && profile.body.email),
      resume: docs.some(isAttachable),
      answers: Number(applicant.body?.version) > 0,
    },
  };
}
