import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { CreateRoleInput, SearchInput } from '@jobdeputy/shared';
import { ulid } from 'ulid';
import { type AuditWrite, auditPut } from './audit-repository.js';
import { cancelledAt } from './client.js';
import { ConcurrentUpdateError, transactWrite } from './transact.js';
import {
  countDown,
  countUp,
  getUsageCounter,
  ROLES_SK,
  repairUsageCounter,
} from './usage-counters.js';
import { getItem, putVersioned, type Versioned } from './versioned.js';

/** `preferences` → `SEARCH` and `ROLE#<roleId>` (docs/data-model.md). */
export type SearchFields = Omit<SearchInput, 'version'>;
export type Search = Versioned<SearchFields>;
export type RoleFields = CreateRoleInput & { roleId: string };
export type Role = Versioned<RoleFields>;

export class RoleLimitError extends Error {
  override name = 'RoleLimitError';
}

const ROLE_PREFIX = 'ROLE#';

export class PreferencesRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly now: () => Date = () => new Date(),
    /** `usage`: the role counter. Needed only to create and delete roles. */
    private readonly usageTable?: string,
  ) {}

  private usage(): string {
    if (!this.usageTable) throw new Error('PreferencesRepository needs the usage table for roles');
    return this.usageTable;
  }

  getSearch(userId: string): Promise<Search | undefined> {
    return getItem<SearchFields>(this.client, this.tableName, userId, 'SEARCH');
  }

  saveSearch(
    userId: string,
    fields: SearchFields,
    expectedVersion: number,
    audit: AuditWrite,
  ): Promise<Search> {
    return putVersioned(
      this.client,
      this.tableName,
      { userId, sk: 'SEARCH', type: 'search' },
      fields,
      expectedVersion,
      this.now(),
      audit,
    );
  }

  async listRoles(userId: string): Promise<Role[]> {
    const res = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'userId = :u AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':u': userId, ':p': ROLE_PREFIX },
        ConsistentRead: true,
      }),
    );
    return (res.Items ?? []) as Role[];
  }

  getRole(userId: string, roleId: string): Promise<Role | undefined> {
    return getItem<RoleFields>(this.client, this.tableName, userId, `${ROLE_PREFIX}${roleId}`);
  }

  /**
   * Creates a role, counted in the same transaction, only while fewer than `maxRoles`
   * exist: exact even when several creates arrive at once. A counter that disagrees
   * with the roles that exist is corrected once, then the create is retried.
   */
  async createRole(
    userId: string,
    fields: CreateRoleInput,
    maxRoles: number,
    audit: (roleId: string) => AuditWrite,
  ): Promise<Role> {
    const usage = this.usage();
    for (let round = 0; round < 2; round += 1) {
      if ((await this.listRoles(userId)).length >= maxRoles) {
        throw new RoleLimitError(`At most ${maxRoles} roles`);
      }
      const roleId = ulid();
      const now = this.now();
      try {
        return await putVersioned(
          this.client,
          this.tableName,
          { userId, sk: `${ROLE_PREFIX}${roleId}`, type: 'role' },
          { ...fields, roleId },
          0,
          now,
          audit(roleId),
          [countUp(usage, userId, ROLES_SK, maxRoles, now.toISOString())],
        );
      } catch (error) {
        if (!cancelledAt(error, 2)) throw error;
        const seen = await getUsageCounter(this.client, usage, userId, ROLES_SK);
        const actual = (await this.listRoles(userId)).length;
        if (actual >= maxRoles) throw new RoleLimitError(`At most ${maxRoles} roles`);
        await repairUsageCounter(
          this.client,
          usage,
          userId,
          ROLES_SK,
          seen,
          { itemCount: actual },
          now.toISOString(),
        );
      }
    }
    throw new ConcurrentUpdateError('Roles were changed at the same moment');
  }

  /** Undefined if the role does not exist (for this user). */
  async updateRole(
    userId: string,
    roleId: string,
    fields: CreateRoleInput,
    expectedVersion: number,
    audit: AuditWrite,
  ): Promise<Role | undefined> {
    if (!(await this.getRole(userId, roleId))) return undefined;
    return putVersioned(
      this.client,
      this.tableName,
      { userId, sk: `${ROLE_PREFIX}${roleId}`, type: 'role' },
      { ...fields, roleId },
      expectedVersion,
      this.now(),
      audit,
    );
  }

  /** False if the role did not exist (for this user). Audited in the same transaction. */
  async deleteRole(userId: string, roleId: string, audit: AuditWrite): Promise<boolean> {
    try {
      await transactWrite(this.client, {
        TransactItems: [
          {
            Delete: {
              TableName: this.tableName,
              Key: { userId, sk: `${ROLE_PREFIX}${roleId}` },
              ConditionExpression: 'attribute_exists(userId)',
            },
          },
          auditPut(audit, userId, this.now()),
          countDown(this.usage(), userId, ROLES_SK, this.now().toISOString()),
        ],
      });
      return true;
    } catch (error) {
      if (cancelledAt(error, 0)) return false;
      throw error;
    }
  }
}
