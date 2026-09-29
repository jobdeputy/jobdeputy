import { type AuditEntry, AuditRepository, documentClient } from '@jobdeputy/db';
import {
  callerFromEvent,
  createLogger,
  type HttpResponse,
  json,
  pageQuery,
  problem,
  validationProblem,
} from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';

const logger = createLogger('api-audit');

export interface AuditDeps {
  repo: Pick<AuditRepository, 'list'>;
}

function defaultDeps(): AuditDeps {
  const { AUDIT_TABLE_NAME } = process.env;
  if (!AUDIT_TABLE_NAME) throw new Error('AUDIT_TABLE_NAME must be set');
  return { repo: new AuditRepository(documentClient(), AUDIT_TABLE_NAME) };
}

function view(e: AuditEntry) {
  return {
    auditId: e.auditId,
    name: e.name,
    entity: e.entity,
    actor: e.actor,
    summary: e.summary,
    ...(e.detail ? { detail: e.detail } : {}),
    at: e.createdAt,
  };
}

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

/** The caller's audit history, newest first (0007). Read-only: entries are never changed. */
export async function route(event: Event, deps: AuditDeps): Promise<HttpResponse> {
  const requestId = event.requestContext.requestId;
  const caller = callerFromEvent(event);
  if (!caller) return problem(401, 'Unauthorized', { requestId });
  if (event.routeKey !== 'GET /me/audit') return problem(404, 'Not found', { requestId });

  const query = pageQuery.safeParse(event.queryStringParameters ?? {});
  if (!query.success) return validationProblem(query.error, requestId);
  const page = await deps.repo.list(caller.userId, query.data.limit, query.data.cursor);
  return json(200, {
    entries: page.items.map(view),
    ...(page.next !== undefined ? { nextCursor: page.next } : {}),
  });
}

let deps: AuditDeps | undefined;

export async function handler(event: Event, context: Context): Promise<HttpResponse> {
  logger.addContext(context);
  try {
    deps ??= defaultDeps();
    return await route(event, deps);
  } catch (error) {
    logger.error('Unhandled error', { error: error as Error });
    return problem(500, 'Internal error', { requestId: event.requestContext.requestId });
  }
}
