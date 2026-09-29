import { describe, expect, it } from 'vitest';
import {
  PreferencesRepository,
  ProfileRepository,
  RoleLimitError,
  VersionConflictError,
} from '../src/index.js';
import { fakeTable } from './fake-ddb.js';

const NOW = new Date('2026-09-28T00:00:00.000Z');
let n = 0;
/** An audit write to the fake's `audit` table (T06d). */
const audit = (name: string) => ({
  table: 'audit',
  entry: {
    auditId: `01J8ZQ4Y3N5W6X7Y8Z9A0B1C${String(10 + (n++ % 90))}`,
    name,
    entity: { type: 'x', id: 'y' },
    actor: 'user' as const,
    summary: name,
  },
});
const LATER = new Date('2026-09-29T00:00:00.000Z');
const fields = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  skills: [],
  languages: [],
  links: { other: [] },
  homeCell: 'iad',
};
const role = {
  title: 'Backend Engineer',
  altTitles: [],
  seniority: [],
  mustHave: [],
  exclude: [],
  priority: 50,
  active: true,
};

describe('ProfileRepository', () => {
  it('creates at version 1, then updates with the right version, keeping createdAt', async () => {
    const t = fakeTable();
    let now = NOW;
    const repo = new ProfileRepository(t.client, 'users', () => now);
    const first = await repo.save('u1', fields, 0, audit('profile.saved'));
    expect(first).toMatchObject({ userId: 'u1', sk: 'PROFILE', type: 'profile', version: 1 });
    now = LATER;
    const second = await repo.save(
      'u1',
      { ...fields, firstName: 'Augusta' },
      1,
      audit('profile.saved'),
    );
    expect(second).toMatchObject({
      version: 2,
      firstName: 'Augusta',
      createdAt: NOW.toISOString(),
      updatedAt: LATER.toISOString(),
    });
  });

  it('rejects a stale save with the current version', async () => {
    const t = fakeTable();
    const repo = new ProfileRepository(t.client, 'users');
    await repo.save('u1', fields, 0, audit('profile.saved'));
    await repo.save('u1', fields, 1, audit('profile.saved'));
    await expect(repo.save('u1', fields, 1, audit('profile.saved'))).rejects.toMatchObject({
      name: 'VersionConflictError',
      currentVersion: 2,
    });
    await expect(repo.save('u1', fields, 0, audit('profile.saved'))).rejects.toBeInstanceOf(
      VersionConflictError,
    );
  });

  it('rejects a save that races with another between read and write', async () => {
    const t = fakeTable();
    const repo = new ProfileRepository(t.client, 'users');
    await repo.save('u1', fields, 0, audit('profile.saved'));
    t.hooks.beforePut = () => {
      const k = 'u1|PROFILE';
      const item = t.items.get(k) as Record<string, unknown>;
      t.items.set(k, { ...item, version: 2 });
    };
    await expect(repo.save('u1', fields, 1, audit('profile.saved'))).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    // Only the save that happened was recorded.
    expect(t.audit.map((e) => e.name)).toEqual(['profile.saved']);
  });

  it('keeps users apart', async () => {
    const t = fakeTable();
    const repo = new ProfileRepository(t.client, 'users');
    await repo.save('u1', fields, 0, audit('profile.saved'));
    expect(await repo.get('u2')).toBeUndefined();
  });
});

describe('PreferencesRepository', () => {
  it('saves search settings with versions', async () => {
    const t = fakeTable();
    const repo = new PreferencesRepository(t.client, 'prefs');
    const s = {
      locations: [],
      workplace: ['remote' as const],
      employmentTypes: [],
      seniority: [],
      excludeKeywords: [],
    };
    expect((await repo.saveSearch('u1', s, 0, audit('search.saved'))).version).toBe(1);
    await expect(repo.saveSearch('u1', s, 0, audit('search.saved'))).rejects.toBeInstanceOf(
      VersionConflictError,
    );
  });

  it('creates, lists, updates, and deletes roles', async () => {
    const t = fakeTable();
    const repo = new PreferencesRepository(t.client, 'prefs');
    const created = await repo.createRole('u1', role, 10, () => audit('role.created'));
    expect(created.roleId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(created.sk).toBe(`ROLE#${created.roleId}`);
    expect(await repo.listRoles('u1')).toHaveLength(1);

    const updated = await repo.updateRole(
      'u1',
      created.roleId,
      { ...role, title: 'Staff Engineer' },
      1,
      audit('role.updated'),
    );
    expect(updated).toMatchObject({ title: 'Staff Engineer', version: 2 });
    await expect(
      repo.updateRole('u1', created.roleId, role, 1, audit('role.updated')),
    ).rejects.toBeInstanceOf(VersionConflictError);

    expect(await repo.deleteRole('u1', created.roleId, audit('role.deleted'))).toBe(true);
    expect(await repo.deleteRole('u1', created.roleId, audit('role.deleted'))).toBe(false);
    expect(await repo.listRoles('u1')).toEqual([]);
    // One entry per change that happened; the failed update and delete recorded nothing.
    expect(t.audit.map((e) => e.name)).toEqual(['role.created', 'role.updated', 'role.deleted']);
    expect(t.audit.every((e) => e.userId === 'u1')).toBe(true);
  });

  it("never touches another user's role", async () => {
    const t = fakeTable();
    const repo = new PreferencesRepository(t.client, 'prefs');
    const created = await repo.createRole('u1', role, 10, () => audit('role.created'));
    expect(await repo.getRole('u2', created.roleId)).toBeUndefined();
    expect(
      await repo.updateRole('u2', created.roleId, role, 1, audit('role.updated')),
    ).toBeUndefined();
    expect(await repo.deleteRole('u2', created.roleId, audit('role.deleted'))).toBe(false);
    expect(await repo.listRoles('u2')).toEqual([]);
  });

  it('enforces the role limit', async () => {
    const t = fakeTable();
    const repo = new PreferencesRepository(t.client, 'prefs');
    for (let i = 0; i < 3; i++) await repo.createRole('u1', role, 3, () => audit('role.created'));
    await expect(
      repo.createRole('u1', role, 3, () => audit('role.created')),
    ).rejects.toBeInstanceOf(RoleLimitError);
  });
});
