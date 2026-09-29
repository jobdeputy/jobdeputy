import { describe, expect, it, vi } from 'vitest';
import {
  LeftoversFoundError,
  type Login,
  MAX_REQUESTS_PER_RUN,
  type ReaperDeps,
  reap,
} from '../src/test-data-reaper.js';

const NOW = new Date('2026-09-29T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const testEmail = (n: number) => `it-${id(n)}@example.com`;

/** `testLogins`: members of the integration-tests group. `live`: every login that exists. */
function deps(testLogins: Login[], owners: string[], marked: string[] = [], live: string[] = []) {
  const alive = new Set([...live, ...testLogins.map((l) => l.userId)]);
  const d = {
    now: () => NOW,
    listTestLogins: vi.fn(async () => testLogins),
    loginExists: vi.fn(async (id: string) => alive.has(id)),
    scanDataOwners: vi.fn(async () => ({ owners: new Set(owners), marked: new Set(marked) })),
    requestDeletion: vi.fn(async () => undefined),
  };
  return d as typeof d & ReaperDeps;
}

describe('test-data reaper', () => {
  it('finds nothing to do on a clean stack', async () => {
    const d = deps(
      [{ userId: id(2), username: 'u2', email: testEmail(2), createdAt: hoursAgo(2) }],
      [id(9)],
      [],
      [id(9)],
    );
    await expect(reap(d)).resolves.toEqual({ staleTestLogins: 0, orphanedAccounts: 0 });
    expect(d.requestDeletion).not.toHaveBeenCalled();
  });

  it('requests deletion of old test logins, then reports it so the alarm fires', async () => {
    const d = deps(
      [
        { userId: id(1), username: 'u1', email: testEmail(1), createdAt: hoursAgo(25) },
        { userId: id(2), username: 'u2', email: testEmail(2), createdAt: hoursAgo(2) },
      ],
      [],
    );
    await expect(reap(d)).rejects.toBeInstanceOf(LeftoversFoundError);
    expect(d.requestDeletion).toHaveBeenCalledWith(id(1), 'u1');
    expect(d.requestDeletion).toHaveBeenCalledTimes(1);
  });

  it('needs both the test group and a test address: a group member with a real address is left alone', async () => {
    const d = deps(
      [{ userId: id(3), username: 'u3', email: 'real@company.com', createdAt: hoursAgo(1000) }],
      [],
    );
    await expect(reap(d)).resolves.toEqual({ staleTestLogins: 0, orphanedAccounts: 0 });
  });

  it('never even lists real logins: a real user with data and a login is never touched', async () => {
    const d = deps([], [id(4)], [], [id(4)]);
    await expect(reap(d)).resolves.toEqual({ staleTestLogins: 0, orphanedAccounts: 0 });
    expect(d.requestDeletion).not.toHaveBeenCalled();
  });

  it('requests deletion of data whose login is gone, unless a request already exists', async () => {
    const d = deps([], [id(6), id(7), id(8)], [id(8)], [id(6)]);
    await expect(reap(d)).rejects.toThrow('1 orphaned account');
    expect(d.requestDeletion).toHaveBeenCalledWith(id(7), id(7));
    expect(d.requestDeletion).toHaveBeenCalledTimes(1);
  });

  it('refuses an unexpectedly large run instead of deleting en masse', async () => {
    const orphans = Array.from({ length: MAX_REQUESTS_PER_RUN + 1 }, (_, i) => id(100 + i));
    const d = deps([], orphans);
    await expect(reap(d)).rejects.toThrow('Refusing');
    expect(d.requestDeletion).not.toHaveBeenCalled();
  });
});
