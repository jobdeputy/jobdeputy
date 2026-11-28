import { EXTENSION_STAGE_CHANGE } from '@jobdeputy/shared/extension';
import type { Api } from './api.ts';
import { jobIdFor, type Posting } from './fill/posting.ts';

/**
 * #54 PR D (decision 0020): recording an application from Greenhouse's confirmation page. The
 * panel asks "Mark as applied?" only for a job in the person's JobDeputy list at stage New
 * (`GET /me/jobs/{jobId}`); one click sends the extension's one write, `new` → `applied`. The job
 * is the confirmed posting's, from the tab's address, never from the page.
 */
export type Application =
  /** In the list at stage New: ask. */
  | { state: 'ask'; title: string; companyName?: string }
  /** Marked as applied now. */
  | { state: 'saved' }
  /** Already past New in JobDeputy (marked there, or here before): nothing to record. */
  | { state: 'moved-on' }
  /** Not in the person's JobDeputy list: nothing to record. */
  | { state: 'not-listed' }
  /** JobDeputy holds applications to this company until then (the company limit). */
  | { state: 'cooling-down'; until?: string }
  | { state: 'signed-out' | 'offline' | 'failed' }
  /** A build without sign-in settings: nothing can be recorded, so the panel shows nothing. */
  | { state: 'unconfigured' };

interface JobSeen {
  status?: unknown;
  title?: unknown;
  companyName?: unknown;
}

export async function readApplication(api: Api, posting: Posting): Promise<Application> {
  const jobId = await jobIdFor(posting);
  const res = await api.answer(`/me/jobs/${jobId}`);
  if (!res.ok) return { state: res.reason };
  const { status, body } = res.body;
  if (status === 404) return { state: 'not-listed' };
  if (status !== 200 || typeof body !== 'object' || body === null) return { state: 'failed' };
  const job = body as JobSeen;
  if (job.status !== EXTENSION_STAGE_CHANGE.from) return { state: 'moved-on' };
  if (typeof job.title !== 'string') return { state: 'failed' };
  return {
    state: 'ask',
    title: job.title,
    ...(typeof job.companyName === 'string' && job.companyName !== ''
      ? { companyName: job.companyName }
      : {}),
  };
}

export async function recordApplication(api: Api, posting: Posting): Promise<Application> {
  const jobId = await jobIdFor(posting);
  const res = await api.answer(`/me/jobs/${jobId}/stage`, { ...EXTENSION_STAGE_CHANGE });
  if (!res.ok) return { state: res.reason };
  const { status, body } = res.body;
  if (status === 200) return { state: 'saved' };
  if (status === 404) return { state: 'not-listed' };
  const problem = (typeof body === 'object' && body !== null ? body : {}) as {
    code?: unknown;
    until?: unknown;
  };
  if (status === 409 && problem.code === 'cooling-down') {
    return {
      state: 'cooling-down',
      ...(typeof problem.until === 'string' ? { until: problem.until } : {}),
    };
  }
  // Moved meanwhile (another tab, the web app): its stage is no longer New.
  if (status === 409 && problem.code === 'stage-changed') return { state: 'moved-on' };
  return { state: 'failed' };
}
