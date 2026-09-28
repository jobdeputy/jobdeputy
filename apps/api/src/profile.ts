import {
  AccountRepository,
  documentClient,
  PreferencesRepository,
  ProfileRepository,
  RoleLimitError,
  VersionConflictError,
} from '@jobdeputy/db';
import {
  callerFromEvent,
  createLogger,
  createRoleInput,
  type HttpResponse,
  json,
  MAX_ROLES,
  parseJsonBody,
  problem,
  profileInput,
  roleId as roleIdSchema,
  searchInput,
  updateRoleInput,
  validationProblem,
} from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import type { z } from 'zod';
import { refuseWritesWhileDeleting } from './account-guard.js';
import { cognitoEmailLookup } from './cognito.js';

const logger = createLogger('api-profile');

export interface ProfileDeps {
  cell: string;
  profiles: Pick<ProfileRepository, 'get' | 'save'>;
  preferences: Pick<
    PreferencesRepository,
    'getSearch' | 'saveSearch' | 'listRoles' | 'createRole' | 'updateRole' | 'deleteRole'
  >;
  emailOf: (username: string) => Promise<string | undefined>;
  isBeingDeleted: (userId: string) => Promise<boolean>;
}

function defaultDeps(): ProfileDeps {
  const { USERS_TABLE_NAME, PREFERENCES_TABLE_NAME, USER_POOL_ID, CELL } = process.env;
  if (!USERS_TABLE_NAME || !PREFERENCES_TABLE_NAME || !USER_POOL_ID || !CELL) {
    throw new Error('USERS_TABLE_NAME, PREFERENCES_TABLE_NAME, USER_POOL_ID, and CELL must be set');
  }
  const client = documentClient();
  const account = new AccountRepository(client, USERS_TABLE_NAME);
  return {
    isBeingDeleted: (userId) => account.isBeingDeleted(userId),
    cell: CELL,
    profiles: new ProfileRepository(client, USERS_TABLE_NAME),
    preferences: new PreferencesRepository(client, PREFERENCES_TABLE_NAME),
    emailOf: cognitoEmailLookup(USER_POOL_ID),
  };
}

/** Strips storage-only keys; `version` stays so the client can send it back. */
function view<T extends { userId: string; sk: string; type: string; schemaVersion: number }>(
  item: T,
): Omit<T, 'userId' | 'sk' | 'type' | 'schemaVersion'> {
  const { userId: _u, sk: _s, type: _t, schemaVersion: _v, ...rest } = item;
  return rest;
}

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

/**
 * The caller's own profile, search settings, and target roles (T05b).
 * The user is always the token's `sub`; there is no way to name another user.
 */
export async function route(event: Event, deps: ProfileDeps): Promise<HttpResponse> {
  const requestId = event.requestContext.requestId;
  const caller = callerFromEvent(event);
  if (!caller) return problem(401, 'Unauthorized', { requestId });
  const { userId } = caller;
  const blocked = await refuseWritesWhileDeleting(
    event.routeKey,
    userId,
    deps.isBeingDeleted,
    requestId,
  );
  if (blocked) return blocked;

  function body<S extends z.ZodType>(
    schema: S,
  ): { ok: true; data: z.infer<S> } | { ok: false; res: HttpResponse } {
    const raw = parseJsonBody(event.body, event.isBase64Encoded);
    if (raw === undefined)
      return { ok: false, res: problem(400, 'Body must be valid JSON', { requestId }) };
    const parsed = schema.safeParse(raw);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, res: validationProblem(parsed.error, requestId) };
  }

  try {
    switch (event.routeKey) {
      case 'GET /me/profile': {
        const profile = await deps.profiles.get(userId);
        if (profile) return json(200, view(profile));
        const email = await deps.emailOf(caller.username);
        return json(200, {
          version: 0,
          ...(email ? { email } : {}),
          homeCell: deps.cell,
          skills: [],
          languages: [],
          links: { other: [] },
        });
      }
      case 'PUT /me/profile': {
        const input = body(profileInput);
        if (!input.ok) return input.res;
        const { version, ...fields } = input.data;
        const email = await deps.emailOf(caller.username);
        const saved = await deps.profiles.save(
          userId,
          { ...fields, ...(email ? { email } : {}), homeCell: deps.cell },
          version,
        );
        return json(200, view(saved));
      }
      case 'GET /me/preferences/search': {
        const search = await deps.preferences.getSearch(userId);
        return json(
          200,
          search
            ? view(search)
            : {
                version: 0,
                locations: [],
                workplace: [],
                employmentTypes: [],
                seniority: [],
                excludeKeywords: [],
              },
        );
      }
      case 'PUT /me/preferences/search': {
        const input = body(searchInput);
        if (!input.ok) return input.res;
        const { version, ...fields } = input.data;
        return json(200, view(await deps.preferences.saveSearch(userId, fields, version)));
      }
      case 'GET /me/roles': {
        const roles = await deps.preferences.listRoles(userId);
        return json(200, { roles: roles.map((r) => view(r)) });
      }
      case 'POST /me/roles': {
        const input = body(createRoleInput);
        if (!input.ok) return input.res;
        return json(201, view(await deps.preferences.createRole(userId, input.data, MAX_ROLES)));
      }
      case 'PUT /me/roles/{roleId}':
      case 'DELETE /me/roles/{roleId}': {
        const id = roleIdSchema.safeParse(event.pathParameters?.roleId);
        if (!id.success) return validationProblem(id.error, requestId);
        if (event.routeKey.startsWith('DELETE')) {
          const deleted = await deps.preferences.deleteRole(userId, id.data);
          return deleted
            ? { statusCode: 204, headers: {}, body: '' }
            : problem(404, 'Not found', { requestId });
        }
        const input = body(updateRoleInput);
        if (!input.ok) return input.res;
        const { version, ...fields } = input.data;
        const updated = await deps.preferences.updateRole(userId, id.data, fields, version);
        return updated ? json(200, view(updated)) : problem(404, 'Not found', { requestId });
      }
      default:
        return problem(404, 'Not found', { requestId });
    }
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return problem(409, 'Conflict', {
        detail: 'This was changed elsewhere. Reload, then save again.',
        requestId,
      });
    }
    if (error instanceof RoleLimitError) {
      return problem(422, 'Role limit reached', {
        detail: `You can have at most ${MAX_ROLES} target roles.`,
        requestId,
      });
    }
    throw error;
  }
}

let deps: ProfileDeps | undefined;

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
