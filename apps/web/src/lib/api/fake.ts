import { type ApiClient, ApiError } from './client.ts';

/**
 * An in-memory stand-in for the cell's API, for the test build only (`--mode e2e`), as
 * `auth/fake.ts` stands in for Cognito. It answers the routes the screens use so far, with the
 * same refusals the API sends; anything else is not found. It forgets everything on reload.
 */
export function createFakeApi({ delay = 200 }: { delay?: number } = {}): ApiClient {
  let profile: Record<string, unknown> | null = null;
  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (path === '/me/profile' && method === 'GET') {
        if (!profile) throw new ApiError('not-found', { status: 404 });
        return profile as T;
      }
      if (path === '/me/profile' && method === 'PUT') {
        const version = typeof profile?.version === 'number' ? profile.version + 1 : 1;
        profile = { ...(body as Record<string, unknown>), version };
        return profile as T;
      }
      throw new ApiError('not-found', { status: 404 });
    },
  };
}
