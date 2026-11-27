import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { ApplicantAnswers, ProfileInput } from '@jobdeputy/shared';
import type { AuditWrite } from './audit-repository.js';
import { getItem, putVersioned, type Versioned } from './versioned.js';

/** `users` → `PROFILE` (docs/data-model.md). `email` and `homeCell` are set by the server. */
export type ProfileFields = Omit<ProfileInput, 'version'> & { email?: string; homeCell: string };
export type Profile = Versioned<ProfileFields>;

export class ProfileRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(userId: string): Promise<Profile | undefined> {
    return getItem<ProfileFields>(this.client, this.tableName, userId, 'PROFILE');
  }

  save(
    userId: string,
    fields: ProfileFields,
    expectedVersion: number,
    audit: AuditWrite,
  ): Promise<Profile> {
    return putVersioned(
      this.client,
      this.tableName,
      { userId, sk: 'PROFILE', type: 'profile' },
      fields,
      expectedVersion,
      this.now(),
      audit,
    );
  }
}

/** `users` → `APPLICANT` (#53, decision 0019): the everyday answers application forms ask for. */
export type ApplicantFields = ApplicantAnswers;
export type Applicant = Versioned<ApplicantFields>;

export class ApplicantRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(userId: string): Promise<Applicant | undefined> {
    return getItem<ApplicantFields>(this.client, this.tableName, userId, 'APPLICANT');
  }

  save(
    userId: string,
    fields: ApplicantFields,
    expectedVersion: number,
    audit: AuditWrite,
  ): Promise<Applicant> {
    return putVersioned(
      this.client,
      this.tableName,
      { userId, sk: 'APPLICANT', type: 'applicant' },
      fields,
      expectedVersion,
      this.now(),
      audit,
    );
  }
}

/**
 * `users` → `VOLUNTARY` (#53, decision 0019): the voluntary self-identification answers, only
 * as `ciphertext` (KMS, encryption context `voluntaryEncryptionContext(userId)`). This
 * repository never sees them in the clear; the profile API encrypts and decrypts.
 */
export interface VoluntaryFields {
  ciphertext: Uint8Array;
}
export type Voluntary = Versioned<VoluntaryFields>;

export class VoluntaryRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(userId: string): Promise<Voluntary | undefined> {
    return getItem<VoluntaryFields>(this.client, this.tableName, userId, 'VOLUNTARY');
  }

  save(
    userId: string,
    ciphertext: Uint8Array,
    expectedVersion: number,
    audit: AuditWrite,
  ): Promise<Voluntary> {
    return putVersioned(
      this.client,
      this.tableName,
      { userId, sk: 'VOLUNTARY', type: 'voluntary' },
      { ciphertext },
      expectedVersion,
      this.now(),
      audit,
    );
  }
}
