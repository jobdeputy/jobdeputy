import { useQuery } from '@tanstack/react-query';
import { ApiError, useApi } from './index.ts';

/** The signed-in person's profile as the API keeps it (packages/shared/src/profile.ts). */
export type Profile = Record<string, unknown> & { version: number };

/**
 * The signed-in person's profile: null until they have saved one (the API's 404), which is how
 * the app knows to start the guided set-up. A failed read is retried once when it was the
 * connection, then shown.
 */
export function useProfile() {
  const api = useApi();
  return useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      try {
        return await api.request<Profile>('GET', '/me/profile');
      } catch (error) {
        if (error instanceof ApiError && error.kind === 'not-found') return null;
        throw error;
      }
    },
    retry: (failures, error) =>
      failures < 1 && error instanceof ApiError && error.kind === 'offline',
  });
}
