import { RoleLimitError, VersionConflictError } from '@jobdeputy/db';
import { DECLINED_VOLUNTARY } from '@jobdeputy/shared';
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
    audit: vi.fn((name: string, entity: { type: string; id: string }, summary: string) => ({
      table: 'Audit',
      entry: { auditId: 'A', name, entity, actor: 'user' as const, summary },
    })),
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
    applicants: {
      get: vi.fn(async () => undefined as unknown),
      save: vi.fn(async (_u: string, f: object, v: number) => ({
        ...stored,
        sk: 'APPLICANT',
        type: 'applicant',
        ...f,
        version: v + 1,
      })),
    },
    voluntary: {
      get: vi.fn(async () => ({ version: 0, ...DECLINED_VOLUNTARY })),
      save: vi.fn(async (_u: string, a: object, v: number) => ({ ...a, version: v + 1 })),
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
      {
        table: 'Audit',
        entry: expect.objectContaining({ name: 'profile.saved', summary: 'Profile saved' }),
      },
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

describe('POST /me/profile/skills (#51 PR C, "I have this")', () => {
  const saved = {
    ...stored,
    version: 4,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    firstName: 'Ada',
    lastName: 'L',
    email: 'a@example.com',
    homeCell: 'iad',
    skills: ['TypeScript'],
    languages: [],
    links: { other: [] },
  };
  const add = (skill: unknown) => event('POST /me/profile/skills', json({ skill }));

  it('adds the skill at the version it read, keeping the rest, and audits it', async () => {
    const d = deps();
    d.profiles.get.mockResolvedValue(saved);
    const res = await route(add('  Terraform '), d);
    expect(res.statusCode).toBe(200);
    expect(d.profiles.save).toHaveBeenCalledWith(
      'user-a',
      {
        firstName: 'Ada',
        lastName: 'L',
        email: 'a@example.com',
        homeCell: 'iad',
        skills: ['TypeScript', 'Terraform'],
        languages: [],
        links: { other: [] },
      },
      4,
      {
        table: 'Audit',
        entry: expect.objectContaining({
          name: 'profile.skillAdded',
          summary: 'Skill added: Terraform',
        }),
      },
    );
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ version: 5, skills: ['TypeScript', 'Terraform'] });
    for (const k of ['userId', 'sk', 'type', 'schemaVersion']) expect(body).not.toHaveProperty(k);
  });

  it('changes nothing for a skill already there, in any case', async () => {
    const d = deps();
    d.profiles.get.mockResolvedValue(saved);
    const res = await route(add('typescript'), d);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ version: 4, skills: ['TypeScript'] });
    expect(d.profiles.save).not.toHaveBeenCalled();
  });

  it('reads again when another save lands first, up to 3 tries, then answers 409', async () => {
    const d = deps();
    d.profiles.get.mockResolvedValue(saved);
    d.profiles.save
      .mockRejectedValueOnce(new VersionConflictError(-1))
      .mockRejectedValueOnce(new VersionConflictError(-1));
    expect((await route(add('Go'), d)).statusCode).toBe(200);
    expect(d.profiles.get).toHaveBeenCalledTimes(3);

    const busy = deps();
    busy.profiles.get.mockResolvedValue(saved);
    busy.profiles.save.mockRejectedValue(new VersionConflictError(-1));
    expect((await route(add('Go'), busy)).statusCode).toBe(409);
    expect(busy.profiles.save).toHaveBeenCalledTimes(3);
  });

  it('answers 409 profile-needed before the first profile save', async () => {
    const d = deps();
    const res = await route(add('Go'), d);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'profile-needed' });
    expect(d.profiles.save).not.toHaveBeenCalled();
  });

  it('answers 422 skills-full at 100 skills', async () => {
    const d = deps();
    d.profiles.get.mockResolvedValue({
      ...saved,
      skills: Array.from({ length: 100 }, (_, i) => `S${i}`),
    });
    const res = await route(add('Go'), d);
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'skills-full' });
    expect(d.profiles.save).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty skill', json({ skill: '  ' })],
    ['a skill over 60 characters', json({ skill: 'x'.repeat(61) })],
    ['another field', json({ skill: 'Go', version: 1 })],
  ])('rejects %s without reading or saving', async (_, extra) => {
    const d = deps();
    const res = await route(event('POST /me/profile/skills', extra), d);
    expect(res.statusCode).toBe(400);
    expect(d.profiles.get).not.toHaveBeenCalled();
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
      { table: 'Audit', entry: expect.objectContaining({ name: 'search.saved' }) },
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
      expect.any(Function),
    );
    // The entry names the new role (its ID is only known inside the repository).
    const call = vi.mocked(d.preferences.createRole).mock.calls[0] as unknown[];
    const auditFor = call[3] as (id: string) => unknown;
    expect(auditFor('R1')).toMatchObject({
      entry: {
        name: 'role.created',
        entity: { type: 'role', id: 'R1' },
        summary: 'Target role added: Backend Engineer',
      },
    });
  });

  it('audits role updates and removals with the role ID', async () => {
    const d = deps();
    const id = { pathParameters: { roleId: ROLE_ID } };
    await route(
      event('PUT /me/roles/{roleId}', {
        ...id,
        body: JSON.stringify({ version: 1, title: 'Staff Engineer' }),
      }),
      d,
    );
    await route(event('DELETE /me/roles/{roleId}', id), d);
    const update = (vi.mocked(d.preferences.updateRole).mock.calls[0] as unknown[])[4];
    const remove = (vi.mocked(d.preferences.deleteRole).mock.calls[0] as unknown[])[2];
    expect(update).toMatchObject({
      entry: {
        name: 'role.updated',
        entity: { type: 'role', id: ROLE_ID },
        summary: 'Target role updated: Staff Engineer',
      },
    });
    expect(remove).toMatchObject({
      entry: {
        name: 'role.deleted',
        entity: { type: 'role', id: ROLE_ID },
        summary: 'Target role removed',
      },
    });
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

describe('application answers (#53)', () => {
  const answers = {
    workAuthorization: [{ country: 'US', authorized: true, needsSponsorship: true }],
    noticePeriodDays: 14,
    earliestStartDate: '2027-01-04',
    expectedSalary: { min: 150000, max: 180000, currency: 'USD', period: 'year' },
    willingToRelocate: false,
    workSetups: ['remote', 'hybrid'],
    over18: true,
    securityClearance: 'none',
    pronouns: 'she/her',
    heardAbout: 'company_website',
  };

  it('GET returns nothing answered (version 0) before the first save', async () => {
    const res = await route(event('GET /me/applicant'), deps());
    expect(JSON.parse(res.body)).toEqual({ version: 0, workAuthorization: [], workSetups: [] });
  });

  it('GET returns the saved answers without storage keys', async () => {
    const d = deps();
    d.applicants.get.mockResolvedValue({
      ...stored,
      sk: 'APPLICANT',
      type: 'applicant',
      ...answers,
    });
    const body = JSON.parse((await route(event('GET /me/applicant'), d)).body);
    expect(body).toEqual({ version: 1, ...answers });
  });

  it('PUT saves at the version read and audits without the values', async () => {
    const d = deps();
    const res = await route(event('PUT /me/applicant', json({ version: 0, ...answers })), d);
    expect(res.statusCode).toBe(200);
    expect(d.applicants.save).toHaveBeenCalledWith('user-a', answers, 0, expect.anything());
    expect(d.audit).toHaveBeenCalledWith(
      'applicant.saved',
      { type: 'applicant', id: 'APPLICANT' },
      'Application answers saved',
      { version: 1 },
    );
    expect(JSON.parse(res.body)).toMatchObject({ version: 1, noticePeriodDays: 14 });
  });

  it('PUT accepts nothing answered (every field optional)', async () => {
    const d = deps();
    const res = await route(event('PUT /me/applicant', json({ version: 2 })), d);
    expect(res.statusCode).toBe(200);
    expect(d.applicants.save).toHaveBeenCalledWith(
      'user-a',
      { workAuthorization: [], workSetups: [] },
      2,
      expect.anything(),
    );
  });

  it.each([
    ['current salary (never stored)', { currentSalary: { min: 1 } }],
    ['an unknown field', { visaType: 'H-1B' }],
    [
      'a country twice',
      { workAuthorization: [answers.workAuthorization[0], answers.workAuthorization[0]] },
    ],
    [
      'a range upside down',
      { expectedSalary: { min: 2, max: 1, currency: 'USD', period: 'year' } },
    ],
    ['a setup twice', { workSetups: ['remote', 'remote'] }],
    ['a bad date', { earliestStartDate: '2027-13-01' }],
    ['a notice over a year', { noticePeriodDays: 366 }],
    ['an unknown clearance', { securityClearance: 'cosmic' }],
  ])('PUT rejects %s', async (_name, extra) => {
    const d = deps();
    const res = await route(event('PUT /me/applicant', json({ version: 0, ...extra })), d);
    expect(res.statusCode).toBe(400);
    expect(d.applicants.save).not.toHaveBeenCalled();
  });

  it('PUT says 409 when another save landed first', async () => {
    const d = deps();
    d.applicants.save.mockRejectedValue(new VersionConflictError(3));
    const res = await route(event('PUT /me/applicant', json({ version: 1 })), d);
    expect(res.statusCode).toBe(409);
  });
});

describe('voluntary self-identification (#53)', () => {
  const chosen = {
    gender: 'female',
    hispanicLatino: 'no',
    race: 'asian',
    veteran: 'not_protected',
    disability: 'decline',
  };

  it('GET returns what the store returns (every answer declined at first)', async () => {
    const body = JSON.parse((await route(event('GET /me/voluntary'), deps())).body);
    expect(body).toEqual({ version: 0, ...DECLINED_VOLUNTARY });
  });

  it('PUT saves and audits only that it was saved, never the answers', async () => {
    const d = deps();
    const res = await route(event('PUT /me/voluntary', json({ version: 0, ...chosen })), d);
    expect(res.statusCode).toBe(200);
    expect(d.voluntary.save).toHaveBeenCalledWith('user-a', chosen, 0, expect.anything());
    expect(d.audit).toHaveBeenCalledWith(
      'voluntary.saved',
      { type: 'voluntary', id: 'VOLUNTARY' },
      'Voluntary self-identification saved',
      { version: 1 },
    );
    expect(JSON.stringify(d.audit.mock.calls)).not.toMatch(/female|asian|not_protected/);
    expect(JSON.parse(res.body)).toEqual({ version: 1, ...chosen });
  });

  it.each([
    ['a missing answer', { ...chosen, race: undefined }],
    ['an unknown answer', { ...chosen, gender: 'other' }],
    ['an extra field', { ...chosen, religion: 'decline' }],
  ])('PUT rejects %s', async (_name, answers) => {
    const d = deps();
    const res = await route(event('PUT /me/voluntary', json({ version: 0, ...answers })), d);
    expect(res.statusCode).toBe(400);
    expect(d.voluntary.save).not.toHaveBeenCalled();
  });

  it('PUT says 409 when another save landed first', async () => {
    const d = deps();
    d.voluntary.save.mockRejectedValue(new VersionConflictError(2));
    const res = await route(event('PUT /me/voluntary', json({ version: 1, ...chosen })), d);
    expect(res.statusCode).toBe(409);
  });
});

describe('account deletion (T12)', () => {
  it.each([
    'PUT /me/profile',
    'PUT /me/applicant',
    'PUT /me/voluntary',
    'POST /me/profile/skills',
    'PUT /me/preferences/search',
    'POST /me/roles',
  ])('%s is refused while the account is being deleted', async (routeKey) => {
    const d = deps();
    d.isBeingDeleted.mockResolvedValue(true);
    const res = await route(
      event(routeKey, json({ version: 0, firstName: 'A', lastName: 'B', title: 'X' })),
      d,
    );
    expect(res.statusCode).toBe(410);
    expect(d.profiles.save).not.toHaveBeenCalled();
    expect(d.applicants.save).not.toHaveBeenCalled();
    expect(d.voluntary.save).not.toHaveBeenCalled();
    expect(d.preferences.createRole).not.toHaveBeenCalled();
  });

  it('does not check on reads', async () => {
    const d = deps();
    await route(event('GET /me/profile'), d);
    expect(d.isBeingDeleted).not.toHaveBeenCalled();
  });
});

describe('auth', () => {
  it.each([
    'GET /me/profile',
    'PUT /me/profile',
    'POST /me/profile/skills',
    'GET /me/roles',
    'POST /me/roles',
    'GET /me/applicant',
    'PUT /me/applicant',
    'GET /me/voluntary',
    'PUT /me/voluntary',
  ])('%s rejects requests without verified claims', async (routeKey) => {
    const d = deps();
    expect((await route(event(routeKey, json({}), null), d)).statusCode).toBe(401);
    expect(d.voluntary.get).not.toHaveBeenCalled();
    expect(d.applicants.get).not.toHaveBeenCalled();
    expect(d.profiles.save).not.toHaveBeenCalled();
    expect(d.preferences.createRole).not.toHaveBeenCalled();
  });
});
