import { describe, expect, it, vi } from 'vitest';
import { CLEANUP_RETRY, cleanUpTestUser, OrphanedDataError } from './cleanup.js';

const instant = { sleep: async () => {}, random: () => 0.5 };

describe('cleanUpTestUser', () => {
  it('deletes through DELETE /me', async () => {
    const adminDelete = vi.fn(async () => true);
    await expect(cleanUpTestUser({ deleteViaApi: async () => 202, adminDelete })).resolves.toBe(
      'deleted',
    );
    expect(adminDelete).not.toHaveBeenCalled();
  });

  it('accepts a user that is already gone (for example deleted by the deletion test)', async () => {
    const steps = {
      deleteViaApi: async () => {
        throw new Error('NotAuthorizedException');
      },
      adminDelete: async () => false,
    };
    await expect(cleanUpTestUser(steps)).resolves.toBe('already-gone');
  });

  it('removes the login but fails loudly when DELETE /me fails', async () => {
    const adminDelete = vi.fn(async () => true);
    const deleteViaApi = vi.fn(async () => 500);
    await expect(cleanUpTestUser({ deleteViaApi, adminDelete }, instant)).rejects.toBeInstanceOf(
      OrphanedDataError,
    );
    // Retried first (a server error may be temporary), then the fallback.
    expect(deleteViaApi).toHaveBeenCalledTimes(CLEANUP_RETRY.maxAttempts);
    expect(adminDelete).toHaveBeenCalledTimes(1);
  });

  it('waits out the dev API throttle (429) instead of orphaning data (seen in a Nightly run)', async () => {
    const sleep = vi.fn(async () => {});
    const answers = [429, 429, 202];
    const deleteViaApi = vi.fn(async () => answers.shift() as number);
    const adminDelete = vi.fn(async () => true);
    await expect(
      cleanUpTestUser({ deleteViaApi, adminDelete }, { sleep, random: () => 0.5 }),
    ).resolves.toBe('deleted');
    expect(deleteViaApi).toHaveBeenCalledTimes(3);
    expect(adminDelete).not.toHaveBeenCalled();
    // Growing, jittered waits.
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([500, 1000]);
  });

  it('does not retry an answer that will not change (for example 400)', async () => {
    const deleteViaApi = vi.fn(async () => 400);
    await expect(
      cleanUpTestUser({ deleteViaApi, adminDelete: async () => true }, instant),
    ).rejects.toBeInstanceOf(OrphanedDataError);
    expect(deleteViaApi).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when sign-in fails for a user that still existed', async () => {
    const steps = {
      deleteViaApi: async () => {
        throw new Error('boom');
      },
      adminDelete: async () => true,
    };
    await expect(cleanUpTestUser(steps)).rejects.toThrow('sign-in failed');
  });
});
