import type { ZodError } from 'zod';

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function json(statusCode: number, body: unknown): HttpResponse {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * RFC 9457 problem details. `detail` must be safe to show to the caller:
 * internal errors are logged, never returned.
 */
export function problem(
  status: number,
  title: string,
  extra: { detail?: string; requestId?: string; errors?: unknown } = {},
): HttpResponse {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/problem+json' },
    body: JSON.stringify({ type: 'about:blank', title, status, ...extra }),
  };
}

export function validationProblem(error: ZodError, requestId?: string): HttpResponse {
  return problem(400, 'Invalid request', {
    errors: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    ...(requestId ? { requestId } : {}),
  });
}

/** Parses a JSON body; an empty body counts as `{}`. Returns undefined when malformed. */
export function parseJsonBody(body: string | undefined, isBase64Encoded = false): unknown {
  if (body === undefined || body === '') return {};
  const text = isBase64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
