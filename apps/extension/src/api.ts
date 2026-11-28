import { type Auth, AuthError } from './auth/session.ts';
import type { Settings } from './settings.ts';

/**
 * #54: reads from the API with the signed-in person's own token (decision 0020), in the service
 * worker only. The manifest's host permission for the API's origin lets these calls skip CORS.
 */
export type ApiResult<T> =
  | { ok: true; body: T }
  | { ok: false; reason: 'signed-out' | 'offline' | 'failed' };

/** An HTTP answer: its status and its JSON body (null when it has none). */
export interface Answer {
  status: number;
  body: unknown;
}

export function createApi(deps: { settings: Settings; auth: Auth; fetch: typeof fetch }) {
  async function call(token: string, path: string, body?: unknown): Promise<Response | null> {
    try {
      return await deps.fetch(`${deps.settings.apiUrl}${path}`, {
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { method: 'PUT', body: JSON.stringify(body) }),
      });
    } catch {
      return null;
    }
  }

  /** The answer to a call, a refused token renewed once (then signed out), or why there's none. */
  async function send(path: string, body?: unknown): Promise<Response | ApiResult<never>> {
    let refused: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await tokenOr(refused);
      if (typeof token !== 'string') return token;
      const res = await call(token, path, body);
      if (!res) return { ok: false, reason: 'offline' };
      if (res.status !== 401) return res;
      refused = token;
    }
    await deps.auth.signedOutByApi();
    return { ok: false, reason: 'signed-out' };
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
      const res = await send(path);
      if (!('status' in res)) return res;
      if (!res.ok) return { ok: false, reason: 'failed' };
      try {
        return { ok: true, body: (await res.json()) as T };
      } catch {
        return { ok: false, reason: 'failed' };
      }
    },
    /**
     * #54 PR D: GET (no body) or PUT a JSON body (the extension's one write, decision 0020). Any
     * answer but 401 comes back with its status and body (a problem's `code` says why).
     */
    async answer(path: string, body?: unknown): Promise<ApiResult<Answer>> {
      const res = await send(path, body);
      if (!('status' in res)) return res;
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        // No body, or not JSON: the status says enough.
      }
      return { ok: true, body: { status: res.status, body: parsed } };
    },
  };
}

export type Api = ReturnType<typeof createApi>;
