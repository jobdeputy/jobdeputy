import { AccountRepository, documentClient } from '@jobdeputy/db';
import {
  ACCOUNT_DELETED_DETAIL,
  ACCOUNT_DELETION_NOTICE,
  callerFromEvent,
  createLogger,
  DELETE_CONFIRMATION,
  type HttpResponse,
  json,
  parseJsonBody,
  problem,
  REAUTH_WINDOW_SECONDS,
} from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import { z } from 'zod';
import { cognitoEmailLookup } from './cognito.js';

const logger = createLogger('api-me');

export interface MeDeps {
  /** The cell this API runs in; the cell that handled signup is the user's home Region (T05). */
  cell: string;
  /** Looks up the verified email; undefined if the login no longer exists. */
  emailOf: (username: string) => Promise<string | undefined>;
  account: Pick<AccountRepository, 'requestDeletion' | 'isBeingDeleted'>;
  now: () => Date;
}

function defaultDeps(): MeDeps {
  const { USER_POOL_ID, CELL, USERS_TABLE_NAME } = process.env;
  if (!USER_POOL_ID || !CELL || !USERS_TABLE_NAME) {
    throw new Error('USER_POOL_ID, CELL, and USERS_TABLE_NAME must be set');
  }
  return {
    cell: CELL,
    emailOf: cognitoEmailLookup(USER_POOL_ID),
    account: new AccountRepository(documentClient(), USERS_TABLE_NAME),
    now: () => new Date(),
  };
}

const deleteBody = z.strictObject({ confirm: z.literal(DELETE_CONFIRMATION) });

/** GET /me: who the caller is. DELETE /me: delete the account and all its data (T12). */
export async function route(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  deps: MeDeps,
): Promise<HttpResponse> {
  const requestId = event.requestContext.requestId;
  const caller = callerFromEvent(event);
  if (!caller) return problem(401, 'Unauthorized', { requestId });
  const gone = () =>
    problem(410, 'Account deleted', {
      detail: ACCOUNT_DELETED_DETAIL,
      code: 'account-deleted',
      requestId,
    });

  if (event.routeKey === 'DELETE /me') {
    const body = deleteBody.safeParse(parseJsonBody(event.body, event.isBase64Encoded));
    if (!body.success) {
      return problem(400, 'Confirmation required', {
        detail: `Send { "confirm": "${DELETE_CONFIRMATION}" } to delete your account.`,
        code: 'confirmation-required',
        requestId,
      });
    }
    const signedInSecondsAgo =
      caller.authTime === undefined
        ? Number.POSITIVE_INFINITY
        : deps.now().getTime() / 1000 - caller.authTime;
    if (signedInSecondsAgo > REAUTH_WINDOW_SECONDS) {
      // Nothing changes. The UI asks for the password (and MFA code), then retries.
      return problem(403, 'Sign in again', {
        detail: 'For your security, please sign in again to delete your account.',
        code: 'reauthentication-required',
        requestId,
      });
    }
    const request = await deps.account.requestDeletion(caller.userId, caller.username);
    logger.info('Account deletion requested', { userId: caller.userId });
    return json(202, {
      status: 'deleting',
      requestedAt: request.requestedAt,
      message: ACCOUNT_DELETION_NOTICE,
    });
  }

  if (await deps.account.isBeingDeleted(caller.userId)) return gone();
  const email = await deps.emailOf(caller.username);
  if (email === undefined) return gone();
  return json(200, { userId: caller.userId, email, homeCell: deps.cell });
}

let deps: MeDeps | undefined;

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  context: Context,
): Promise<HttpResponse> {
  logger.addContext(context);
  try {
    deps ??= defaultDeps();
    return await route(event, deps);
  } catch (error) {
    logger.error('Unhandled error', { error: error as Error });
    return problem(500, 'Internal error', { requestId: event.requestContext.requestId });
  }
}
