import { describe, expect, it } from 'vitest';
import {
  PreferencesRepository,
  ProfileRepository,
  RoleLimitError,
  VersionConflictError,
} from '../src/index.js';
import { fakeTable } from './fake-ddb.js';

const NOW = new Date('2026-09-28T00:00:00.000Z');
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
    const first = await repo.save('u1', fields, 0);
    expect(first).toMatchObject({ userId: 'u1', sk: 'PROFILE', type: 'profile', version: 1 });
    now = LATER;
    const second = await repo.save('u1', { ...fields, firstName: 'Augusta' }, 1);
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
    await repo.save('u1', fields, 0);
    await repo.save('u1', fields, 1);
    await expect(repo.save('u1', fields, 1)).rejects.toMatchObject({
      name: 'VersionConflictError',
      currentVersion: 2,
    });
    await expect(repo.save('u1', fields, 0)).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('rejects a save that races with another between read and write', async () => {
    const t = fakeTable();
    const repo = new ProfileRepository(t.client, 'users');
    await repo.save('u1', fields, 0);
    t.hooks.beforePut = () => {
      const k = 'u1|PROFILE';
      const item = t.items.get(k) as Record<string, unknown>;
      t.items.set(k, { ...item, version: 2 });
    };
    await expect(repo.save('u1', fields, 1)).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('keeps users apart', async () => {
    const t = fakeTable();
    const repo = new ProfileRepository(t.client, 'users');
    await repo.save('u1', fields, 0);
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
    expect((await repo.saveSearch('u1', s, 0)).version).toBe(1);
    await expect(repo.saveSearch('u1', s, 0)).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('creates, lists, updates, and deletes roles', async () => {
    const t = fakeTable();
    const repo = new PreferencesRepository(t.client, 'prefs');
    const created = await repo.createRole('u1', role, 10);
    expect(created.roleId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(created.sk).toBe(`ROLE#${created.roleId}`);
    expect(await repo.listRoles('u1')).toHaveLength(1);

    const updated = await repo.updateRole(
      'u1',
      created.roleId,
      { ...role, title: 'Staff Engineer' },
      1,
    );
    expect(updated).toMatchObject({ title: 'Staff Engineer', version: 2 });
    await expect(repo.updateRole('u1', created.roleId, role, 1)).rejects.toBeInstanceOf(
      VersionConflictError,
    );

    expect(await repo.deleteRole('u1', created.roleId)).toBe(true);
    expect(await repo.deleteRole('u1', created.roleId)).toBe(false);
    expect(await repo.listRoles('u1')).toEqual([]);
  });

  it("never touches another user's role", async () => {
    const t = fakeTable();
    const repo = new PreferencesRepository(t.client, 'prefs');
    const created = await repo.createRole('u1', role, 10);
    expect(await repo.getRole('u2', created.roleId)).toBeUndefined();
    expect(await repo.updateRole('u2', created.roleId, role, 1)).toBeUndefined();
    expect(await repo.deleteRole('u2', created.roleId)).toBe(false);
    expect(await repo.listRoles('u2')).toEqual([]);
  });

  it('enforces the role limit', async () => {
    const t = fakeTable();
    const repo = new PreferencesRepository(t.client, 'prefs');
    for (let i = 0; i < 3; i++) await repo.createRole('u1', role, 3);
    await expect(repo.createRole('u1', role, 3)).rejects.toBeInstanceOf(RoleLimitError);
  });
});
