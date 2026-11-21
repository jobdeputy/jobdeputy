import { useQuery } from '@tanstack/react-query';
import { type ApiClient, ApiError, useApi } from './index.ts';

/**
 * A target role as the API returns it (packages/shared/src/profile.ts, plus what the server adds:
 * roleId, version, createdAt, updatedAt). The set-up uses only its title; the rest (other titles,
 * seniority, words to look for or skip) is edited on the Profile page.
 */
export type Role = Record<string, unknown> & { roleId: string; title: string; version: number };

/**
 * The signed-in person's target roles, oldest first (as the API lists them). A failed read is
 * retried once when it was the connection, then shown.
 */
export function useRoles() {
  const api = useApi();
  return useQuery({
    ...rolesQuery(api),
    retry: (failures, error) =>
      failures < 1 && error instanceof ApiError && error.kind === 'offline',
  });
}

/** The roles' query: its key and its read (also for reading them again on demand). */
export function rolesQuery(api: ApiClient) {
  return {
    queryKey: ['roles'],
    queryFn: async () => (await api.request<{ roles: Role[] }>('GET', '/me/roles')).roles,
  };
}
