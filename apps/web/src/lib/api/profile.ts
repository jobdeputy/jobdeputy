import { useQuery } from '@tanstack/react-query';
import { ApiError, useApi } from './index.ts';

/**
 * The signed-in person's profile as the API returns it (packages/shared/src/profile.ts, plus what
 * the server adds: email, homeCell, createdAt, updatedAt). Version 0 is none saved yet: the API
 * then answers with its defaults rather than a 404.
 */
export type Profile = Record<string, unknown> & { version: number };

/** Whether the person has saved a profile yet (the API's version 0 is none). */
export function hasProfile(profile: Profile): boolean {
  return profile.version > 0;
}

/**
 * The signed-in person's profile. A new account's is the API's defaults at version 0, which is
 * how the app knows to start the guided set-up. A failed read is retried once when it was the
 * connection, then shown.
 */
export function useProfile() {
  const api = useApi();
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => api.request<Profile>('GET', '/me/profile'),
    retry: (failures, error) =>
      failures < 1 && error instanceof ApiError && error.kind === 'offline',
  });
}
