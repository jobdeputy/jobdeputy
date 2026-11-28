import { type DecryptCommand, EncryptCommand } from '@aws-sdk/client-kms';
import { VersionConflictError } from '@jobdeputy/db';
import { DECLINED_VOLUNTARY } from '@jobdeputy/shared';
import { describe, expect, it, vi } from 'vitest';
import { kmsVoluntaryStore } from '../src/voluntary.js';

const KEY = 'arn:aws:kms:us-east-1:111111111111:key/k';
const answers = {
  gender: 'male',
  hispanicLatino: 'yes',
  race: 'two_or_more',
  veteran: 'protected',
  disability: 'no',
} as const;
const audit = { table: 'audit', entry: {} } as never;

/** A pretend KMS: "encrypts" by tagging the bytes with the context it was given. */
function fakeKms() {
  const send = vi.fn(async (cmd: EncryptCommand | DecryptCommand) => {
    if (cmd instanceof EncryptCommand) {
      const ctx = JSON.stringify(cmd.input.EncryptionContext);
      return {
        CiphertextBlob: new TextEncoder().encode(
          `${ctx}|${new TextDecoder().decode(cmd.input.Plaintext)}`,
        ),
      };
    }
    const [ctx, plain] = new TextDecoder().decode(cmd.input.CiphertextBlob).split('|');
    if (ctx !== JSON.stringify(cmd.input.EncryptionContext)) throw new Error('InvalidCiphertext');
    return { Plaintext: new TextEncoder().encode(plain) };
  });
  return { send };
}

function repo() {
  const items = new Map<string, { version: number; ciphertext: Uint8Array }>();
  return {
    items,
    get: vi.fn(async (u: string) => items.get(u) as never),
    save: vi.fn(async (u: string, ciphertext: Uint8Array, v: number) => {
      items.set(u, { version: v + 1, ciphertext });
      return { version: v + 1, ciphertext } as never;
    }),
  };
}

describe('kmsVoluntaryStore (#53)', () => {
  it('returns every answer declined at version 0 before any save, without calling KMS', async () => {
    const kms = fakeKms();
    const store = kmsVoluntaryStore(repo(), kms as never, KEY);
    expect(await store.get('u1')).toEqual({ version: 0, ...DECLINED_VOLUNTARY });
    expect(kms.send).not.toHaveBeenCalled();
  });

  it('stores only ciphertext made with the user + purpose context, and reads it back', async () => {
    const kms = fakeKms();
    const r = repo();
    const store = kmsVoluntaryStore(r, kms as never, KEY);
    expect(await store.save('u1', answers, 0, audit)).toEqual({ version: 1, ...answers });
    const enc = kms.send.mock.calls[0]?.[0] as EncryptCommand;
    expect(enc.input).toMatchObject({
      KeyId: KEY,
      EncryptionContext: { userId: 'u1', purpose: 'voluntary-self-id' },
    });
    expect(r.save).toHaveBeenCalledWith('u1', expect.any(Uint8Array), 0, audit);
    expect(await store.get('u1')).toEqual({ version: 1, ...answers });
    const dec = kms.send.mock.calls[1]?.[0] as DecryptCommand;
    expect(dec.input).toMatchObject({
      KeyId: KEY,
      EncryptionContext: { userId: 'u1', purpose: 'voluntary-self-id' },
    });
  });

  it("can't read another user's ciphertext (the context names the user)", async () => {
    const kms = fakeKms();
    const r = repo();
    const store = kmsVoluntaryStore(r, kms as never, KEY);
    await store.save('u1', answers, 0, audit);
    r.items.set('u2', r.items.get('u1') as never);
    await expect(store.get('u2')).rejects.toThrow('InvalidCiphertext');
  });

  it('reads an answer no longer in the schema as decline, keeping the version', async () => {
    const kms = fakeKms();
    const r = repo();
    const store = kmsVoluntaryStore(r, kms as never, KEY);
    await store.save('u1', answers, 0, audit);
    const enc = kms.send.mock.calls[0]?.[0] as EncryptCommand;
    const old = JSON.stringify({ ...answers, gender: 'retired_value', extra: 'x' });
    r.items.set('u1', {
      version: 1,
      ciphertext: new TextEncoder().encode(`${JSON.stringify(enc.input.EncryptionContext)}|${old}`),
    });
    // Said, so the extension leaves that question empty instead of answering decline (#54).
    expect(await store.get('u1')).toEqual({
      version: 1,
      ...answers,
      gender: 'decline',
      unreadable: ['gender'],
    });
  });

  it('reads unreadable stored answers as decline, never throwing their text', async () => {
    const kms = fakeKms();
    const r = repo();
    const store = kmsVoluntaryStore(r, kms as never, KEY);
    const ctx = JSON.stringify({ userId: 'u1', purpose: 'voluntary-self-id' });
    r.items.set('u1', {
      version: 3,
      ciphertext: new TextEncoder().encode(`${ctx}|{"gender":"female","race":"as`),
    });
    expect(await store.get('u1')).toEqual({
      version: 3,
      ...DECLINED_VOLUNTARY,
      unreadable: ['gender', 'hispanicLatino', 'race', 'veteran', 'disability'],
    });
  });

  it.each([
    ['InvalidCiphertextException', true],
    ['IncorrectKeyException', true],
    ['ThrottlingException', false],
  ])(
    'a KMS %s on read: declined (keeping the version) = %s, else thrown',
    async (name, declined) => {
      const kms = fakeKms();
      const r = repo();
      const store = kmsVoluntaryStore(r, kms as never, KEY);
      await store.save('u1', answers, 0, audit);
      kms.send.mockRejectedValueOnce(Object.assign(new Error('kms'), { name }));
      if (declined) {
        expect(await store.get('u1')).toEqual({
          version: 1,
          ...DECLINED_VOLUNTARY,
          unreadable: ['gender', 'hispanicLatino', 'race', 'veteran', 'disability'],
        });
      } else await expect(store.get('u1')).rejects.toThrow('kms');
    },
  );

  it('refuses a stale save before asking KMS', async () => {
    const kms = fakeKms();
    const store = kmsVoluntaryStore(repo(), kms as never, KEY);
    await store.save('u1', answers, 0, audit);
    kms.send.mockClear();
    await expect(store.save('u1', answers, 0, audit)).rejects.toBeInstanceOf(VersionConflictError);
    expect(kms.send).not.toHaveBeenCalled();
  });

  it('refuses to encrypt answers outside the schema', async () => {
    const kms = fakeKms();
    const store = kmsVoluntaryStore(repo(), kms as never, KEY);
    await expect(
      store.save('u1', { ...answers, gender: 'x' } as never, 0, audit),
    ).rejects.toThrow();
    expect(kms.send).not.toHaveBeenCalled();
  });
});
