/**
 * The app's calls to its cell's API (#33): each carries the signed-in person's access token, and
 * every failure comes back as an `ApiError` with a plain `kind` the screens can act on. Reads are
 * given up on after 20 s (asking again is harmless); writes wait for their real answer, as the
 * sign-in calls do, since one given up on could still succeed.
 */

/** What went wrong, in the screens' terms. */
export type ApiErrorKind =
  /** No answer, or no network: try again. */
  | 'offline'
  /** The site has no API configured (local dev, the test build without its fake). */
  | 'not-set-up'
  /** Nobody is signed in, or the session has run out: sign in again. */
  | 'signed-out'
  /** Not allowed (for example an account being deleted). */
  | 'forbidden'
  | 'not-found'
  /** Changed meanwhile (another tab, another device), or a write that collided: reload, retry. */
  | 'conflict'
  /** The request was refused as invalid; `fieldErrors` says where. */
  | 'invalid'
  /** Too many requests for now; `retryAfterSeconds` says how long to wait. */
  | 'too-many'
  /** The API failed. */
  | 'server';

/** One field the API refused, by its path in the request body (for example `contact.email`). */
export interface FieldError {
  readonly path: string;
  readonly message: string;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  /** The API's stable reason, when it gave one (for example `try-again`). */
  readonly code: string | undefined;
  readonly fieldErrors: readonly FieldError[];
  /** On `too-many`: how long to wait before asking again. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    kind: ApiErrorKind,
    details: {
      status?: number;
      code?: string;
      message?: string;
      fieldErrors?: readonly FieldError[];
      retryAfterSeconds?: number;
      cause?: unknown;
    } = {},
  ) {
    super(details.message ?? kind, { cause: details.cause });
    this.name = 'ApiError';
    this.kind = kind;
    this.status = details.status;
    this.code = details.code;
    this.fieldErrors = details.fieldErrors ?? [];
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

/** How long a read may take before it counts as `offline`. */
export const READ_LIMIT_MS = 20_000;

/**
 * Used when a 429 does not say how long to wait: API Gateway's own throttle sends no
 * Retry-After, only the API's handlers do.
 */
export const DEFAULT_RETRY_AFTER_SECONDS = 5;

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface ApiClient {
  /** Calls the API; resolves with its JSON body (undefined for an empty one), or throws `ApiError`. */
  request<T = unknown>(method: ApiMethod, path: `/${string}`, body?: unknown): Promise<T>;
}

export function createApiClient(deps: {
  /** The cell's API address (no trailing slash), or null where the site has none. */
  apiUrl: () => Promise<string | null>;
  /** The signed-in person's access token, or null. */
  accessToken: () => Promise<string | null>;
}): ApiClient {
  return {
    async request<T>(method: ApiMethod, path: `/${string}`, body?: unknown): Promise<T> {
      const [apiUrl, token] = await Promise.all([deps.apiUrl(), deps.accessToken()]);
      if (!apiUrl) throw new ApiError('not-set-up');
      if (!token) throw new ApiError('signed-out');
      let response: Response;
      try {
        response = await fetch(`${apiUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          ...(method === 'GET' ? { signal: AbortSignal.timeout(READ_LIMIT_MS) } : {}),
        });
      } catch (error) {
        throw new ApiError('offline', { cause: error });
      }
      const text = await response.text().catch(() => '');
      if (response.ok) return (text ? parseJson(text) : undefined) as T;
      throw failure(response, text);
    },
  };
}

/** The API's refusal (a problem+json body) as an `ApiError`. */
function failure(response: Response, text: string): ApiError {
  const problem = (parseJson(text) ?? {}) as {
    title?: unknown;
    detail?: unknown;
    code?: unknown;
    errors?: unknown;
  };
  const code = typeof problem.code === 'string' ? problem.code : undefined;
  const message =
    typeof problem.detail === 'string'
      ? problem.detail
      : typeof problem.title === 'string'
        ? problem.title
        : undefined;
  const details = {
    status: response.status,
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
  };
  switch (response.status) {
    case 400:
      return new ApiError('invalid', { ...details, fieldErrors: fieldErrors(problem.errors) });
    case 401:
      return new ApiError('signed-out', details);
    case 403:
      return new ApiError('forbidden', details);
    case 404:
      return new ApiError('not-found', details);
    case 409:
    case 412:
      return new ApiError('conflict', details);
    case 429:
      return new ApiError('too-many', {
        ...details,
        retryAfterSeconds: retryAfter(response.headers.get('retry-after')),
      });
    default:
      return new ApiError(response.status >= 500 ? 'server' : 'invalid', details);
  }
}

function fieldErrors(errors: unknown): FieldError[] {
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((error) =>
    typeof error?.path === 'string' && typeof error?.message === 'string'
      ? [{ path: error.path, message: error.message }]
      : [],
  );
}

/** Retry-After in seconds (a number of seconds, or an HTTP date), else the default wait. */
function retryAfter(header: string | null): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
