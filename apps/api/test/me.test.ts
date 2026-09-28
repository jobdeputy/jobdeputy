import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { type MeDeps, route } from '../src/me.js';

function event(claims?: Record<string, unknown>) {
  return {
    routeKey: 'GET /me',
    requestContext: { requestId: 'req-1', ...(claims ? { authorizer: { jwt: { claims } } } : {}) },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function deps(
  email: string | null = 'a@example.com',
): MeDeps & { emailOf: ReturnType<typeof vi.fn> } {
  return { cell: 'iad', emailOf: vi.fn(async () => email ?? undefined) };
}

describe('GET /me', () => {
  it('returns the caller from the token, their email, and home cell', async () => {
    const d = deps();
    const res = await route(event({ sub: 'user-a', username: 'name-a' }), d);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      userId: 'user-a',
      email: 'a@example.com',
      homeCell: 'iad',
    });
    expect(d.emailOf).toHaveBeenCalledWith('name-a');
  });

  it('omits the email when Cognito has none', async () => {
    const res = await route(event({ sub: 'user-a', username: 'name-a' }), deps(null));
    expect(JSON.parse(res.body)).toEqual({ userId: 'user-a', homeCell: 'iad' });
  });

  it('rejects requests without verified claims', async () => {
    const d = deps();
    const res = await route(event(), d);
    expect(res.statusCode).toBe(401);
    expect(d.emailOf).not.toHaveBeenCalled();
  });
});
