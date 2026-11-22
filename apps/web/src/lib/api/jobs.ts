import { useQuery } from '@tanstack/react-query';
import type { JobSummary } from './companies.ts';
import { ApiError, useApi } from './index.ts';

/**
 * One job in full (`GET /me/jobs/{jobId}`, apps/api/src/jobs.ts `jobView`): the summary, and the
 * posting's own description as plain text (rendered as text, never as markup), cut at 32,000
 * characters (`descriptionTruncated`). Absent when the board shared none.
 */
export interface Job extends JobSummary {
  description?: string;
  descriptionTruncated?: boolean;
}

/** The job open in the preview, read when it opens (its description is long, so lists leave it out). */
export function useJob(jobId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ['jobs', jobId],
    queryFn: () => api.request<Job>('GET', `/me/jobs/${jobId}`),
    enabled: jobId !== null,
    // A posting doesn't change while it is looked at: going back to a job doesn't read it again.
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: (failures, error) =>
      failures < 1 && error instanceof ApiError && error.kind === 'offline',
  });
}
