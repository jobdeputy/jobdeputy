import { AccountRepository, documentClient, PingRepository } from '@jobdeputy/db';
import {
  callerFromEvent,
  createLogger,
  createPingJobRequest,
  type HttpResponse,
  json,
  parseJsonBody,
  pingJobId,
  problem,
  validationProblem,
} from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import { refuseWritesWhileDeleting } from './account-guard.js';

const logger = createLogger('api');

export interface Deps {
  repo: Pick<PingRepository, 'create' | 'get'>;
  stage: string;
  isBeingDeleted: (userId: string) => Promise<boolean>;
}

function defaultDeps(): Deps {
  const tableName = process.env.PING_TABLE_NAME;
  const usersTable = process.env.USERS_TABLE_NAME;
  if (!tableName || !usersTable)
    throw new Error('PING_TABLE_NAME and USERS_TABLE_NAME must be set');
  const client = documentClient();
  const account = new AccountRepository(client, usersTable);
  return {
    repo: new PingRepository(client, tableName),
    stage: process.env.STAGE ?? 'dev',
    isBeingDeleted: (userId) => account.isBeingDeleted(userId),
  };
}

/**
 * POST /ping-jobs and GET /ping-jobs/{id}. API Gateway's JWT authorizer has
 * already verified the token; the owner is always the token's `sub`.
 */
export async function route(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  deps: Deps,
): Promise<HttpResponse> {
  const requestId = event.requestContext.requestId;
  const caller = callerFromEvent(event);
  if (!caller) return problem(401, 'Unauthorized', { requestId });
  const blocked = await refuseWritesWhileDeleting(
    event.routeKey,
    caller.userId,
    deps.isBeingDeleted,
    requestId,
  );
  if (blocked) return blocked;
  switch (event.routeKey) {
    case 'POST /ping-jobs': {
      const body = parseJsonBody(event.body, event.isBase64Encoded);
      if (body === undefined) return problem(400, 'Body must be valid JSON', { requestId });
      const parsed = createPingJobRequest.safeParse(body);
      if (!parsed.success) return validationProblem(parsed.error, requestId);
      if (parsed.data.fail && deps.stage !== 'dev') {
        return problem(400, 'Invalid request', {
          detail: '`fail` is only allowed in dev.',
          requestId,
        });
      }
      const job = await deps.repo.create({
        userId: caller.userId,
        ...(parsed.data.fail ? { fail: true } : {}),
      });
      logger.info('Ping job queued', { jobId: job.id });
      return json(202, { id: job.id, status: job.status });
    }
    case 'GET /ping-jobs/{id}': {
      const id = pingJobId.safeParse(event.pathParameters?.id);
      if (!id.success) return validationProblem(id.error, requestId);
      const job = await deps.repo.get(id.data);
      // Someone else's job looks exactly like a missing one: no existence leak.
      if (!job || job.userId !== caller.userId) return problem(404, 'Not found', { requestId });
      const {
        id: jobId,
        status,
        attempts,
        sideEffectCount,
        deliveries,
        error,
        createdAt,
        updatedAt,
      } = job;
      return json(200, {
        id: jobId,
        status,
        attempts,
        sideEffectCount,
        deliveries,
        ...(error ? { error } : {}),
        createdAt,
        updatedAt,
      });
    }
    default:
      return problem(404, 'Not found', { requestId });
  }
}

let deps: Deps | undefined;

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
