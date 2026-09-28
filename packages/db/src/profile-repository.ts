import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { ProfileInput } from '@jobdeputy/shared';
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

  save(userId: string, fields: ProfileFields, expectedVersion: number): Promise<Profile> {
    return putVersioned(
      this.client,
      this.tableName,
      { userId, sk: 'PROFILE', type: 'profile' },
      fields,
      expectedVersion,
      this.now(),
    );
  }
}
