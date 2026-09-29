import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { AccountRepository, DELETION_SK, documentClient, type UserTable } from '@jobdeputy/db';
import { createLogger, TEST_USERS_GROUP } from '@jobdeputy/shared';
import type { Context } from 'aws-lambda';

const logger = createLogger('test-data-reaper');

/** Logins created by the integration tests' createTestUser(). */
export const TEST_LOGIN = /^it-[0-9a-f-]{36}@example\.com$/;
export const TEST_LOGIN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Safety cap: a surprising number means something else is wrong; stop and alert via logs. */
export const MAX_REQUESTS_PER_RUN = 200;

export interface Login {
  userId: string;
  username: string;
  email?: string;
  createdAt: Date;
}

export interface ReaperDeps {
  /** Only members of the integration-tests group: real accounts are never even listed. */
  listTestLogins: () => Promise<Login[]>;
  /** Whether a login with this user ID (Cognito sub) still exists. */
  loginExists: (userId: string) => Promise<boolean>;
  /** Every userId with data, and the userIds that already have a deletion request. */
  scanDataOwners: () => Promise<{ owners: Set<string>; marked: Set<string> }>;
  requestDeletion: (userId: string, username: string) => Promise<void>;
  now: () => Date;
}

export interface ReaperResult {
  staleTestLogins: number;
  orphanedAccounts: number;
}

/**
 * Leftovers mean something leaked (a test run died, or a login was deleted by hand).
 * Deletion is already requested when this is thrown; the error makes the reaper's
 * alarm email the maintainers (docs/runbooks/alarms.md).
 */
export class LeftoversFoundError extends Error {
  override name = 'LeftoversFoundError';
}

/**
 * Dev stacks only (T13). Requests deletion (T12) for test logins older than a day, and
 * for data whose login no longer exists. It never deletes anything itself.
 */
export async function reap(deps: ReaperDeps): Promise<ReaperResult> {
  const now = deps.now().getTime();
  // Both conditions: in the test group AND a test address (defence in depth).
  const staleTest = (await deps.listTestLogins()).filter(
    (l) =>
      l.email !== undefined &&
      TEST_LOGIN.test(l.email) &&
      now - l.createdAt.getTime() > TEST_LOGIN_MAX_AGE_MS,
  );

  const { owners, marked } = await deps.scanDataOwners();
  const orphaned: string[] = [];
  for (const id of owners) {
    if (!marked.has(id) && !(await deps.loginExists(id))) orphaned.push(id);
  }

  const requests = [
    ...staleTest.map((l) => ({ userId: l.userId, username: l.username })),
    // With no login left, the username only matters for sign-out, which then finds nobody.
    ...orphaned.map((id) => ({ userId: id, username: id })),
  ];
  if (requests.length > MAX_REQUESTS_PER_RUN) {
    throw new Error(
      `Refusing ${requests.length} deletion requests in one run (cap ${MAX_REQUESTS_PER_RUN})`,
    );
  }
  for (const r of requests) await deps.requestDeletion(r.userId, r.username);

  const result = { staleTestLogins: staleTest.length, orphanedAccounts: orphaned.length };
  logger.info('Reaper finished', { ...result });
  if (requests.length > 0) {
    throw new LeftoversFoundError(
      `Requested deletion of ${result.staleTestLogins} stale test login(s) and ${result.orphanedAccounts} orphaned account(s).`,
    );
  }
  return result;
}

/** Every member of the test group, page by page (Cognito returns at most 60 at a time). */
export async function listTestLogins(
  cognito: Pick<CognitoIdentityProviderClient, 'send'>,
  userPoolId: string,
): Promise<Login[]> {
  const logins: Login[] = [];
  let token: string | undefined;
  do {
    const page = await cognito.send(
      new ListUsersInGroupCommand({
        UserPoolId: userPoolId,
        GroupName: TEST_USERS_GROUP,
        ...(token ? { NextToken: token } : {}),
      }),
    );
    for (const u of page.Users ?? []) {
      const login = toLogin(u);
      if (login) logins.push(login);
    }
    token = page.NextToken;
  } while (token);
  return logins;
}

function toLogin(u: UserType): Login | undefined {
  const attr = (name: string) => u.Attributes?.find((a) => a.Name === name)?.Value;
  const sub = attr('sub');
  if (!sub || !u.Username || !u.UserCreateDate) return undefined;
  const email = attr('email');
  return {
    userId: sub,
    username: u.Username,
    ...(email ? { email } : {}),
    createdAt: u.UserCreateDate,
  };
}

function defaultDeps(): ReaperDeps {
  const { USERS_TABLE_NAME, USER_TABLES, USER_POOL_ID } = process.env;
  if (!USERS_TABLE_NAME || !USER_TABLES || !USER_POOL_ID)
    throw new Error('Reaper environment is incomplete');
  const tables = JSON.parse(USER_TABLES) as UserTable[];
  const client = documentClient();
  const cognito = new CognitoIdentityProviderClient({});
  const account = new AccountRepository(client, USERS_TABLE_NAME);
  return {
    now: () => new Date(),
    listTestLogins: () => listTestLogins(cognito, USER_POOL_ID),
    loginExists: async (userId) => {
      const page = await cognito.send(
        new ListUsersCommand({ UserPoolId: USER_POOL_ID, Filter: `sub = "${userId}"`, Limit: 1 }),
      );
      return (page.Users ?? []).length > 0;
    },
    scanDataOwners: async () => {
      const owners = new Set<string>();
      const marked = new Set<string>();
      for (const table of tables) {
        let startKey: Record<string, unknown> | undefined;
        do {
          const page = await client.send(
            new ScanCommand({
              TableName: table.name,
              ProjectionExpression: '#pk, #sk',
              ExpressionAttributeNames: { '#pk': 'userId', '#sk': table.sortKey },
              ...(startKey ? { ExclusiveStartKey: startKey } : {}),
            }),
          );
          for (const item of page.Items ?? []) {
            const id = String(item.userId);
            if (item[table.sortKey] === DELETION_SK) marked.add(id);
            else owners.add(id);
          }
          startKey = page.LastEvaluatedKey;
        } while (startKey);
      }
      return { owners, marked };
    },
    requestDeletion: async (userId, username) => {
      await account.requestDeletion(userId, username);
    },
  };
}

let deps: ReaperDeps | undefined;

export async function handler(_event: unknown, context: Context): Promise<ReaperResult> {
  logger.addContext(context);
  deps ??= defaultDeps();
  return reap(deps);
}
