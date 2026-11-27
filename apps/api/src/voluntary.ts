import { DecryptCommand, EncryptCommand, type KMSClient } from '@aws-sdk/client-kms';
import { type AuditWrite, VersionConflictError, type VoluntaryRepository } from '@jobdeputy/db';
import {
  createLogger,
  DECLINED_VOLUNTARY,
  type VoluntaryAnswers,
  voluntaryAnswers,
  voluntaryEncryptionContext,
} from '@jobdeputy/shared';

const logger = createLogger('api-voluntary');

/** The voluntary answers as the user sees them, with the version a save must send back. */
export interface VoluntaryView extends VoluntaryAnswers {
  version: number;
}

/**
 * #53 (decision 0019): the voluntary self-identification answers, encrypted with the cell's KMS
 * key before they are stored and decrypted only here. The encryption context ties each
 * ciphertext to its user and to this purpose; the IAM grant requires that context, so no
 * other function can decrypt them. The answers are never logged or audited.
 */
export interface VoluntaryStore {
  /** Every answer `decline` (version 0) until the user saves. */
  get(userId: string): Promise<VoluntaryView>;
  save(
    userId: string,
    answers: VoluntaryAnswers,
    expectedVersion: number,
    audit: AuditWrite,
  ): Promise<VoluntaryView>;
}

export function kmsVoluntaryStore(
  repo: Pick<VoluntaryRepository, 'get' | 'save'>,
  kms: Pick<KMSClient, 'send'>,
  keyArn: string,
): VoluntaryStore {
  return {
    async get(userId) {
      const item = await repo.get(userId);
      if (!item) return { version: 0, ...DECLINED_VOLUNTARY };
      const res = await kms.send(
        new DecryptCommand({
          KeyId: keyArn,
          CiphertextBlob: item.ciphertext,
          EncryptionContext: voluntaryEncryptionContext(userId),
        }),
      );
      if (!res.Plaintext) throw new Error('KMS returned no plaintext');
      return { version: item.version, ...readable(parsed(res.Plaintext)) };
    },
    async save(userId, answers, expectedVersion, audit) {
      // A stale save is refused before KMS is asked (the write checks again).
      const current = (await repo.get(userId))?.version ?? 0;
      if (current !== expectedVersion) throw new VersionConflictError(current);
      const res = await kms.send(
        new EncryptCommand({
          KeyId: keyArn,
          Plaintext: new TextEncoder().encode(JSON.stringify(voluntaryAnswers.parse(answers))),
          EncryptionContext: voluntaryEncryptionContext(userId),
        }),
      );
      if (!res.CiphertextBlob) throw new Error('KMS returned no ciphertext');
      const saved = await repo.save(userId, res.CiphertextBlob, expectedVersion, audit);
      return { version: saved.version, ...answers };
    },
  };
}

/**
 * The decrypted JSON, or `undefined` when it isn't JSON. Never throws: a parse error quotes
 * its input, and the answers must never reach a log (decision 0019).
 */
function parsed(plaintext: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    logger.warn('Stored voluntary answers are unreadable; reading them as decline');
    return undefined;
  }
}

/**
 * Stored answers as today's schema allows: one no longer allowed (a value renamed or dropped
 * since it was saved), or all of them when unreadable, reads as `decline`, so the user still gets a version to save over
 * instead of an error.
 */
function readable(stored: unknown): VoluntaryAnswers {
  const fields = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<
    string,
    unknown
  >;
  const answers = { ...DECLINED_VOLUNTARY };
  for (const key of Object.keys(answers) as (keyof VoluntaryAnswers)[]) {
    const ok = voluntaryAnswers.shape[key].safeParse(fields[key]);
    if (ok.success) (answers as Record<string, string>)[key] = ok.data;
  }
  return answers;
}
