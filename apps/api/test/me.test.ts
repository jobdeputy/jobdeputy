import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { type MeDeps, route } from '../src/me.js';

const NOW = new Date('2026-09-28T12:00:00.000Z');
const nowSeconds = NOW.getTime() / 1000;

function event(routeKey: string, claims?: Record<string, unknown>, body?: unknown) {
  return {
    routeKey,
    requestContext: { requestId: 'req-1', ...(claims ? { authorizer: { jwt: { claims } } } : {}) },
    isBase64Encoded: false,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const claims = (authAgoSeconds = 60) => ({
  sub: 'user-a',
  username: 'name-a',
  auth_time: String(nowSeconds - authAgoSeconds),
});

function deps(email: string | null = 'a@example.com', deleting = false) {
  const d = {
    cell: 'iad',
    now: () => NOW,
    emailOf: vi.fn(async () => email ?? undefined),
    account: {
      isBeingDeleted: vi.fn(async () => deleting),
      requestDeletion: vi.fn(async () => ({ requestedAt: NOW.toISOString() }) as never),
    },
  };
  return d as typeof d & MeDeps;
}

describe('GET /me', () => {
  it('returns the caller from the token, their email, and home cell', async () => {
    const d = deps();
    const res = await route(event('GET /me', claims()), d);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      userId: 'user-a',
      email: 'a@example.com',
      homeCell: 'iad',
    });
    expect(d.emailOf).toHaveBeenCalledWith('name-a');
  });

  it('returns 410 while the account is being deleted, or once the login is gone', async () => {
    expect((await route(event('GET /me', claims()), deps('a@example.com', true))).statusCode).toBe(
      410,
    );
    expect((await route(event('GET /me', claims()), deps(null))).statusCode).toBe(410);
  });

  it('rejects requests without verified claims', async () => {
    const d = deps();
    expect((await route(event('GET /me'), d)).statusCode).toBe(401);
    expect(d.emailOf).not.toHaveBeenCalled();
  });
});

describe('DELETE /me', () => {
  const confirm = { confirm: 'delete my account' };

  it('accepts a confirmed request after a recent sign-in and tells the user what happens', async () => {
    const d = deps();
    const res = await route(event('DELETE /me', claims(60), confirm), d);
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ status: 'deleting', requestedAt: NOW.toISOString() });
    expect(body.message).toContain('permanent');
    expect(body.message).toContain('15 minutes');
    expect(d.account.requestDeletion).toHaveBeenCalledWith('user-a', 'name-a');
  });

  it.each([
    ['no body', undefined],
    ['the wrong phrase', { confirm: 'yes' }],
    ['extra fields', { ...{ confirm: 'delete my account' }, userId: 'user-b' }],
  ])('requires the typed confirmation (%s)', async (_, body) => {
    const d = deps();
    const res = await route(event('DELETE /me', claims(), body), d);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('confirmation-required');
    expect(d.account.requestDeletion).not.toHaveBeenCalled();
  });

  it.each([
    ['16 minutes ago', claims(16 * 60)],
    ['a missing auth_time', { sub: 'user-a', username: 'name-a' }],
  ])('asks to sign in again after a sign-in %s, changing nothing', async (_, c) => {
    const d = deps();
    const res = await route(event('DELETE /me', c, confirm), d);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('reauthentication-required');
    expect(d.account.requestDeletion).not.toHaveBeenCalled();
  });

  it('accepts a sign-in exactly 15 minutes ago', async () => {
    expect((await route(event('DELETE /me', claims(15 * 60), confirm), deps())).statusCode).toBe(
      202,
    );
  });
});
