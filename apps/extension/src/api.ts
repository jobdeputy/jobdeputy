import { type Auth, AuthError } from './auth/session.ts';
import type { Settings } from './settings.ts';

/**
 * #54: reads from the API with the signed-in person's own token (decision 0020), in the service
 * worker only. The manifest's host permission for the API's origin lets these calls skip CORS.
 */
export type ApiResult<T> =
  | { ok: true; body: T }
  | { ok: false; reason: 'signed-out' | 'offline' | 'failed' };

export function createApi(deps: { settings: Settings; auth: Auth; fetch: typeof fetch }) {
  async function call(token: string, path: string): Promise<Response | null> {
    try {
      return await deps.fetch(`${deps.settings.apiUrl}${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      return null;
    }
  }

  async function tokenOr(refused?: string): Promise<string | ApiResult<never>> {
    try {
      const token = await deps.auth.accessToken(refused === undefined ? {} : { refused });
      return token ?? { ok: false, reason: 'signed-out' };
    } catch (error) {
      return { ok: false, reason: error instanceof AuthError ? error.kind : 'failed' };
    }
  }

  return {
    /** GET a path that starts with `/`; a refused token is renewed once, then means signed out. */
    async get<T>(path: string): Promise<ApiResult<T>> {
      let refused: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const token = await tokenOr(refused);
        if (typeof token !== 'string') return token;
        const res = await call(token, path);
        if (!res) return { ok: false, reason: 'offline' };
        if (res.status === 401) {
          refused = token;
          continue;
        }
        if (!res.ok) return { ok: false, reason: 'failed' };
        try {
          return { ok: true, body: (await res.json()) as T };
        } catch {
          return { ok: false, reason: 'failed' };
        }
      }
      await deps.auth.signedOutByApi();
      return { ok: false, reason: 'signed-out' };
    },
  };
}

export type Api = ReturnType<typeof createApi>;
