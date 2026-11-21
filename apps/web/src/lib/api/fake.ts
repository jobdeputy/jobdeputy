import { createRoleInput, MAX_ROLES, profileInput } from '@jobdeputy/shared/profile';
import { type ApiClient, ApiError } from './client.ts';

/**
 * An in-memory stand-in for the cell's API, for the test build only (`--mode e2e`), as
 * `auth/fake.ts` stands in for Cognito. It answers the routes the screens use so far as the API
 * does (apps/api/src/profile.ts): no profile yet is the defaults at version 0, not a 404; a saved
 * one carries what the server adds (email, homeCell, createdAt, updatedAt); a save with a stale
 * version is a conflict, and a save the API's (strict) schema refuses is refused. Target roles
 * list oldest first, stop at the API's limit (422), and a role already gone is not found. It keeps
 * each account's data apart (by whoever `user` says is signed in); anything else is not found. It
 * forgets everything on reload.
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
  const roles = new Map<string, Record<string, unknown>[]>();
  let lastRole = 0;
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
        // The API's own (strict) schema: a field it does not take is refused, as there.
        const checked = profileInput.safeParse(body);
        if (!checked.success) throw refused(checked.error.issues);
        const { version, ...fields } = checked.data;
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
      const mine = roles.get(me) ?? [];
      if (path === '/me/roles' && method === 'GET') return { roles: mine } as T;
      if (path === '/me/roles' && method === 'POST') {
        const checked = createRoleInput.safeParse(body);
        if (!checked.success) throw refused(checked.error.issues);
        if (mine.length >= MAX_ROLES) throw new ApiError('invalid', { status: 422 });
        const now = new Date().toISOString();
        lastRole += 1;
        // A ULID's shape (26 Crockford characters), counting up so the list stays oldest first.
        const roleId = String(lastRole).padStart(26, '0');
        const role = { ...checked.data, roleId, version: 1, createdAt: now, updatedAt: now };
        roles.set(me, [...mine, role]);
        return role as T;
      }
      const roleId = /^\/me\/roles\/([^/]+)$/.exec(path)?.[1];
      if (roleId && method === 'DELETE' && mine.some((role) => role.roleId === roleId)) {
        roles.set(
          me,
          mine.filter((role) => role.roleId !== roleId),
        );
        return undefined as T;
      }
      throw new ApiError('not-found', { status: 404 });
    },
  };
}

/** A body the API's schema refuses: a 400 naming each wrong field. */
function refused(issues: { path: PropertyKey[]; message: string }[]): ApiError {
  return new ApiError('invalid', {
    status: 400,
    fieldErrors: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  });
}
