import { type ApiClient, ApiError } from './client.ts';

/**
 * An in-memory stand-in for the cell's API, for the test build only (`--mode e2e`), as
 * `auth/fake.ts` stands in for Cognito. It answers the routes the screens use so far as the API
 * does (apps/api/src/profile.ts): no profile yet is the defaults at version 0, not a 404; a saved
 * one carries what the server adds (email, homeCell, createdAt, updatedAt); a save with a stale
 * version is a conflict. It keeps each account's data apart (by whoever `user` says is signed in);
 * anything else is not found. It forgets everything on reload.
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
      const saved = profiles.get(me);
      if (path === '/me/profile' && method === 'GET') {
        return (saved ?? {
          version: 0,
          email: me,
          homeCell: 'iad',
          skills: [],
          languages: [],
          links: { other: [] },
        }) as T;
      }
      if (path === '/me/profile' && method === 'PUT') {
        const { version, ...fields } = body as Record<string, unknown> & { version: number };
        const current = typeof saved?.version === 'number' ? saved.version : 0;
        if (version !== current) throw new ApiError('conflict', { status: 409, code: 'conflict' });
        const now = new Date().toISOString();
        const next = {
          ...fields,
          version: current + 1,
          email: me,
          homeCell: 'iad',
          createdAt: (saved?.createdAt as string | undefined) ?? now,
          updatedAt: now,
        };
        profiles.set(me, next);
        return next as T;
      }
      throw new ApiError('not-found', { status: 404 });
    },
  };
}
