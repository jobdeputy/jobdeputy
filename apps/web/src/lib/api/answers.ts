import { useQuery } from '@tanstack/react-query';
import { ApiError, useApi } from './index.ts';
import type { Profile } from './profile.ts';

/**
 * #53 (decision 0019): the answers application forms ask for (`GET /me/applicant`), and the
 * voluntary self-identification answers (`GET /me/voluntary`, every one `decline` until saved).
 * Each is one saved item with its own version, read and replaced whole, like the profile.
 */
export type SavedAnswers = Profile;

export const APPLICANT_KEY = ['applicant'] as const;
export const VOLUNTARY_KEY = ['voluntary'] as const;

const retry = (failures: number, error: unknown) =>
  failures < 1 && error instanceof ApiError && error.kind === 'offline';

export function useApplicant() {
  const api = useApi();
  return useQuery({
    queryKey: APPLICANT_KEY,
    queryFn: () => api.request<SavedAnswers>('GET', '/me/applicant'),
    retry,
  });
}

export function useVoluntary() {
  const api = useApi();
  return useQuery({
    queryKey: VOLUNTARY_KEY,
    queryFn: () => api.request<SavedAnswers>('GET', '/me/voluntary'),
    retry,
  });
}
