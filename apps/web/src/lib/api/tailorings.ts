import { MATCH_THRESHOLD } from '@jobdeputy/shared/match-score';
import { useQuery } from '@tanstack/react-query';
import { type ApiClient, ApiError, isFinal, useApi } from './index.ts';
import type { Profile } from './profile.ts';

/**
 * #51 (decision 0015): tailored résumés, one version a run for a company's top shown jobs
 * (apps/api/src/tailoring.ts `tailoringView`; docs/flows/tailoring.md).
 */

/** One job's ATS match: the base résumé's score and the tailored one's (null: nothing to count). */
export interface JobScore {
  jobId: string;
  base: number | null;
  tailored: number | null;
  /** Keywords the résumé backs, that the draft could not fit in. */
  missingProven: string[];
  /** Keywords the résumé doesn't show: added only when the user says they have them. */
  missingUnproven: string[];
}

export type TailoringStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface Tailoring {
  documentId: string;
  companyKey: string;
  companyName?: string;
  /** The company's top shown jobs when it was asked for (at most 3), best first. */
  jobIds: string[];
  status: TailoringStatus;
  /** Failed: why, and what to say (`TAILORING_ERRORS`). */
  error?: string;
  message?: string;
  /** Ready: `ok` when every job reaches 80%, else `partial` (still usable). */
  result?: 'ok' | 'partial';
  scores?: JobScore[];
  /** The share of the résumé's text its structured copy covers (0–1). */
  coverage?: number;
  fileName?: string;
  createdAt: string;
  finishedAt?: string;
}

/** `GET /me/tailorings?companyKey=`: the company's versions, newest first, and the free runs. */
export interface Tailorings {
  tailorings: Tailoring[];
  allowance: { used: number; perMonth: number; nextAt: string };
}

/** `GET /me/tailorings/{id}` of a ready version: its files, behind 5-minute links. */
export interface TailoringFiles extends Tailoring {
  downloads?: { pdf: string; docx: string };
}

/** The ATS match a version must reach for each job (decision 0015). */
export const READY_SCORE = MATCH_THRESHOLD;

/** How often a run at work is asked about (runs take a minute or two). */
export const TAILORING_CHECK_MS = 5000;

export function isTailoring(t: Pick<Tailoring, 'status'> | undefined): boolean {
  return t?.status === 'queued' || t?.status === 'processing';
}

export const tailoringsKey = (companyKey: string) => ['tailorings', companyKey] as const;

/**
 * A company's versions, asked about again every 5 s while its newest one is at work. A failed
 * read while polling keeps the last answer and is asked again on the next beat, unless asking
 * again can't help (signed out, account closed).
 */
export function useTailorings(companyKey: string, checkEvery = TAILORING_CHECK_MS) {
  const api = useApi();
  return useQuery({
    queryKey: tailoringsKey(companyKey),
    queryFn: () =>
      api.request<Tailorings>(
        'GET',
        `/me/tailorings?${new URLSearchParams({ companyKey }).toString()}`,
      ),
    refetchOnWindowFocus: false,
    refetchInterval: ({ state }) =>
      !isFinal(state.error) && isTailoring(state.data?.tailorings[0]) ? checkEvery : false,
    retry: (failures, error) =>
      failures < 1 && error instanceof ApiError && error.kind === 'offline',
  });
}

/** `POST /me/tailorings`: one run for the company (202, queued), with the user's AI setting. */
export function requestTailoring(api: ApiClient, companyKey: string) {
  return api.request<{ tailoring: Tailoring }>('POST', '/me/tailorings', { companyKey });
}

/** A ready version's files, read when a download is asked for (the links last 5 minutes). */
export function tailoringFiles(api: ApiClient, documentId: string) {
  return api.request<TailoringFiles>('GET', `/me/tailorings/${documentId}`);
}

/** `POST /me/profile/skills` ("I have this"): the profile with the skill added. */
export function addSkill(api: ApiClient, skill: string) {
  return api.request<Profile>('POST', '/me/profile/skills', { skill });
}
