import { documentClient, PingRepository } from '@jobdeputy/db';
import {
  createLogger,
  createPingJobRequest,
  type HttpResponse,
  json,
  parseJsonBody,
  pingJobId,
  problem,
  validationProblem,
} from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';

const logger = createLogger('api');

export interface Deps {
  repo: Pick<PingRepository, 'create' | 'get'>;
  stage: string;
}

function defaultDeps(): Deps {
  const tableName = process.env.PING_TABLE_NAME;
  if (!tableName) throw new Error('PING_TABLE_NAME is not set');
  return {
    repo: new PingRepository(documentClient(), tableName),
    stage: process.env.STAGE ?? 'dev',
  };
}

/** POST /ping-jobs and GET /ping-jobs/{id}. Auth is enforced by API Gateway (IAM until T05). */
export async function route(event: APIGatewayProxyEventV2, deps: Deps): Promise<HttpResponse> {
  const requestId = event.requestContext.requestId;
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
      const job = await deps.repo.create(parsed.data.fail ? { fail: true } : {});
      logger.info('Ping job queued', { jobId: job.id });
      return json(202, { id: job.id, status: job.status });
    }
    case 'GET /ping-jobs/{id}': {
      const id = pingJobId.safeParse(event.pathParameters?.id);
      if (!id.success) return validationProblem(id.error, requestId);
      const job = await deps.repo.get(id.data);
      if (!job) return problem(404, 'Not found', { requestId });
      const { id: jobId, status, attempts, sideEffectCount, error, createdAt, updatedAt } = job;
      return json(200, {
        id: jobId,
        status,
        attempts,
        sideEffectCount,
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
  event: APIGatewayProxyEventV2,
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
