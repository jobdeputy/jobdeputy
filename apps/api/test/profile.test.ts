import { RoleLimitError, VersionConflictError } from '@jobdeputy/db';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { type ProfileDeps, route } from '../src/profile.js';

const ROLE_ID = '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2D';
const stored = { userId: 'user-a', sk: 'PROFILE', type: 'profile', schemaVersion: 1, version: 1 };

function event(
  routeKey: string,
  extra: Record<string, unknown> = {},
  sub: string | null = 'user-a',
) {
  return {
    routeKey,
    requestContext: {
      requestId: 'req-1',
      ...(sub ? { authorizer: { jwt: { claims: { sub, username: `${sub}-name` } } } } : {}),
    },
    isBase64Encoded: false,
    ...extra,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function deps() {
  const d = {
    cell: 'iad',
    isBeingDeleted: vi.fn(async () => false),
    emailOf: vi.fn(async () => 'a@example.com'),
    profiles: {
      get: vi.fn(async () => undefined as unknown),
      save: vi.fn(async (_u: string, f: object, v: number) => ({
        ...stored,
        ...f,
        version: v + 1,
      })),
    },
    preferences: {
      getSearch: vi.fn(async () => undefined as unknown),
      saveSearch: vi.fn(async (_u: string, f: object, v: number) => ({
        ...stored,
        ...f,
        version: v + 1,
      })),
      listRoles: vi.fn(async () => [] as unknown[]),
      createRole: vi.fn(async (_u: string, f: object) => ({ ...stored, ...f, roleId: ROLE_ID })),
      updateRole: vi.fn(async (_u: string, id: string, f: object, v: number) => ({
        ...stored,
        ...f,
        roleId: id,
        version: v + 1,
      })),
      deleteRole: vi.fn(async () => true),
    },
  };
  return d as typeof d & ProfileDeps;
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

describe('profile', () => {
  it('returns an empty profile with the Cognito email before the first save', async () => {
    const res = await route(event('GET /me/profile'), deps());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      version: 0,
      email: 'a@example.com',
      homeCell: 'iad',
    });
  });

  it('saves for the token user, with server-set email and home cell, and hides storage keys', async () => {
    const d = deps();
    const res = await route(
      event('PUT /me/profile', json({ version: 0, firstName: 'Ada', lastName: 'L' })),
      d,
    );
    expect(res.statusCode).toBe(200);
    expect(d.profiles.save).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({ firstName: 'Ada', email: 'a@example.com', homeCell: 'iad' }),
      0,
    );
    const body = JSON.parse(res.body);
    expect(body.version).toBe(1);
    for (const k of ['userId', 'sk', 'type', 'schemaVersion']) expect(body).not.toHaveProperty(k);
  });

  it('returns 409 on a version conflict', async () => {
    const d = deps();
    d.profiles.save.mockRejectedValueOnce(new VersionConflictError(3));
    const res = await route(
      event('PUT /me/profile', json({ version: 1, firstName: 'A', lastName: 'B' })),
      d,
    );
    expect(res.statusCode).toBe(409);
  });

  it.each([
    ['malformed JSON', { body: '{' }],
    [
      'a user ID in the body',
      json({ version: 0, firstName: 'A', lastName: 'B', userId: 'user-b' }),
    ],
    [
      'a home cell in the body',
      json({ version: 0, firstName: 'A', lastName: 'B', homeCell: 'bom' }),
    ],
  ])('rejects %s without saving', async (_, extra) => {
    const d = deps();
    const res = await route(event('PUT /me/profile', extra), d);
    expect(res.statusCode).toBe(400);
    expect(d.profiles.save).not.toHaveBeenCalled();
  });
});

describe('search settings', () => {
  it('returns defaults, then saves with the version', async () => {
    const d = deps();
    const empty = JSON.parse((await route(event('GET /me/preferences/search'), d)).body);
    expect(empty).toMatchObject({ version: 0, workplace: [] });
    const res = await route(
      event('PUT /me/preferences/search', json({ version: 0, workplace: ['remote'] })),
      d,
    );
    expect(res.statusCode).toBe(200);
    expect(d.preferences.saveSearch).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({ workplace: ['remote'] }),
      0,
    );
  });
});

describe('roles', () => {
  it('creates a role for the token user (201)', async () => {
    const d = deps();
    const res = await route(event('POST /me/roles', json({ title: 'Backend Engineer' })), d);
    expect(res.statusCode).toBe(201);
    expect(d.preferences.createRole).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({ title: 'Backend Engineer' }),
      10,
    );
  });

  it('returns 422 past the role limit', async () => {
    const d = deps();
    d.preferences.createRole.mockRejectedValueOnce(new RoleLimitError('x'));
    expect((await route(event('POST /me/roles', json({ title: 'X' })), d)).statusCode).toBe(422);
  });

  it('lists roles without storage keys', async () => {
    const d = deps();
    d.preferences.listRoles.mockResolvedValueOnce([
      { ...stored, sk: `ROLE#${ROLE_ID}`, roleId: ROLE_ID, title: 'X' },
    ]);
    const body = JSON.parse((await route(event('GET /me/roles'), d)).body);
    expect(body.roles).toEqual([{ version: 1, roleId: ROLE_ID, title: 'X' }]);
  });

  it('updates and deletes by role ID, returning 404 when missing', async () => {
    const d = deps();
    const path = { pathParameters: { roleId: ROLE_ID } };
    const upd = await route(
      event('PUT /me/roles/{roleId}', { ...path, ...json({ title: 'Y', version: 1 }) }),
      d,
    );
    expect(upd.statusCode).toBe(200);
    expect((await route(event('DELETE /me/roles/{roleId}', path), d)).statusCode).toBe(204);

    d.preferences.updateRole.mockResolvedValueOnce(undefined as never);
    d.preferences.deleteRole.mockResolvedValueOnce(false);
    expect(
      (
        await route(
          event('PUT /me/roles/{roleId}', { ...path, ...json({ title: 'Y', version: 1 }) }),
          d,
        )
      ).statusCode,
    ).toBe(404);
    expect((await route(event('DELETE /me/roles/{roleId}', path), d)).statusCode).toBe(404);
  });

  it('rejects invalid role IDs before touching storage', async () => {
    const d = deps();
    const res = await route(
      event('DELETE /me/roles/{roleId}', { pathParameters: { roleId: '../x' } }),
      d,
    );
    expect(res.statusCode).toBe(400);
    expect(d.preferences.deleteRole).not.toHaveBeenCalled();
  });
});

describe('account deletion (T12)', () => {
  it.each(['PUT /me/profile', 'PUT /me/preferences/search', 'POST /me/roles'])(
    '%s is refused while the account is being deleted',
    async (routeKey) => {
      const d = deps();
      d.isBeingDeleted.mockResolvedValue(true);
      const res = await route(
        event(routeKey, json({ version: 0, firstName: 'A', lastName: 'B', title: 'X' })),
        d,
      );
      expect(res.statusCode).toBe(410);
      expect(d.profiles.save).not.toHaveBeenCalled();
      expect(d.preferences.createRole).not.toHaveBeenCalled();
    },
  );

  it('does not check on reads', async () => {
    const d = deps();
    await route(event('GET /me/profile'), d);
    expect(d.isBeingDeleted).not.toHaveBeenCalled();
  });
});

describe('auth', () => {
  it.each(['GET /me/profile', 'PUT /me/profile', 'GET /me/roles', 'POST /me/roles'])(
    '%s rejects requests without verified claims',
    async (routeKey) => {
      const d = deps();
      expect((await route(event(routeKey, json({}), null), d)).statusCode).toBe(401);
      expect(d.profiles.save).not.toHaveBeenCalled();
      expect(d.preferences.createRole).not.toHaveBeenCalled();
    },
  );
});
