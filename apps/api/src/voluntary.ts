import { DecryptCommand, EncryptCommand, type KMSClient } from '@aws-sdk/client-kms';
import type { AuditWrite, VoluntaryRepository } from '@jobdeputy/db';
import {
  DECLINED_VOLUNTARY,
  type VoluntaryAnswers,
  voluntaryAnswers,
  voluntaryEncryptionContext,
} from '@jobdeputy/shared';

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
      const answers = voluntaryAnswers.parse(JSON.parse(new TextDecoder().decode(res.Plaintext)));
      return { version: item.version, ...answers };
    },
    async save(userId, answers, expectedVersion, audit) {
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
