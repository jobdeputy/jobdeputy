import { type ApiClient, ApiError } from './client.ts';

/**
 * An in-memory stand-in for the cell's API, for the test build only (`--mode e2e`), as
 * `auth/fake.ts` stands in for Cognito. It answers the routes the screens use so far, with the
 * same refusals the API sends, and keeps each account's data apart (by whoever `user` says is
 * signed in); anything else is not found. It forgets everything on reload.
 */
export function createFakeApi({
  delay = 200,
  user = async () => 'someone@example.com',
}: {
  delay?: number;
  /** Who is signed in; nobody is refused as the API would (401). */
  user?: () => Promise<string | null>;
} = {}): ApiClient {
  const profiles = new Map<string, Record<string, unknown>>();
  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const me = await user();
      if (!me) throw new ApiError('signed-out', { status: 401 });
      const profile = profiles.get(me);
      if (path === '/me/profile' && method === 'GET') {
        if (!profile) throw new ApiError('not-found', { status: 404 });
        return profile as T;
      }
      if (path === '/me/profile' && method === 'PUT') {
        const version = typeof profile?.version === 'number' ? profile.version + 1 : 1;
        const saved = { ...(body as Record<string, unknown>), version };
        profiles.set(me, saved);
        return saved as T;
      }
      throw new ApiError('not-found', { status: 404 });
    },
  };
}
