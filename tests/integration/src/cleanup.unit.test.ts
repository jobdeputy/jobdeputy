import { describe, expect, it, vi } from 'vitest';
import { cleanUpTestUser, OrphanedDataError } from './cleanup.js';

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
    await expect(
      cleanUpTestUser({ deleteViaApi: async () => 500, adminDelete }),
    ).rejects.toBeInstanceOf(OrphanedDataError);
    expect(adminDelete).toHaveBeenCalledTimes(1);
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
