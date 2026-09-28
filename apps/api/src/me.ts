import { callerFromEvent, createLogger, type HttpResponse, json, problem } from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import { cognitoEmailLookup } from './cognito.js';

const logger = createLogger('api-me');

export interface MeDeps {
  /** The cell this API runs in; the cell that handled signup is the user's home Region (T05). */
  cell: string;
  /** Looks up the verified email; access tokens do not carry it. */
  emailOf: (username: string) => Promise<string | undefined>;
}

function defaultDeps(): MeDeps {
  const userPoolId = process.env.USER_POOL_ID;
  const cell = process.env.CELL;
  if (!userPoolId || !cell) throw new Error('USER_POOL_ID and CELL must be set');
  return { cell, emailOf: cognitoEmailLookup(userPoolId) };
}

/** GET /me: who the signed-in caller is, and their home Region. */
export async function route(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  deps: MeDeps,
): Promise<HttpResponse> {
  const requestId = event.requestContext.requestId;
  const caller = callerFromEvent(event);
  if (!caller) return problem(401, 'Unauthorized', { requestId });
  const email = await deps.emailOf(caller.username);
  return json(200, { userId: caller.userId, ...(email ? { email } : {}), homeCell: deps.cell });
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
