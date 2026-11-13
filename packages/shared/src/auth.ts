/**
 * The signed-in caller, taken only from the JWT claims that API Gateway has
 * already verified. Never read a user ID from the request body or URL.
 */
export interface Caller {
  /** Cognito `sub`: the stable user ID used as the key for all user data (0006). */
  userId: string;
  /** Cognito username (for pools with email sign-in, a generated ID). */
  username: string;
  /** When the user last actually signed in (seconds since epoch); refreshing a session keeps it. */
  authTime?: number;
}

interface EventWithClaims {
  requestContext: { authorizer?: { jwt?: { claims?: Record<string, unknown> } } };
}

export function callerFromEvent(event: EventWithClaims): Caller | undefined {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  const userId = claims?.sub;
  const username = claims?.username ?? claims?.['cognito:username'];
  if (typeof userId !== 'string' || userId === '' || typeof username !== 'string') {
    return undefined;
  }
  // HTTP API passes claims as strings.
  const authTime = Number(claims?.auth_time);
  return { userId, username, ...(Number.isFinite(authTime) && authTime > 0 ? { authTime } : {}) };
}

/** T12: deleting an account needs a typed confirmation and a recent real sign-in. */
export const DELETE_CONFIRMATION = 'delete my account';
export const REAUTH_WINDOW_SECONDS = 15 * 60;

export const ACCOUNT_DELETION_NOTICE =
  'Your account is being deleted. This is permanent. You are signed out on all devices now, your profile, roles, and résumés are deleted immediately, and a final check runs within 15 minutes.';

/** The message returned for any change attempted while an account is being deleted. */
export const ACCOUNT_DELETED_DETAIL =
  'This account is being deleted, so it can no longer be changed.';

/**
 * Reserved for documentation and testing (RFC 2606 and RFC 6761): nobody can own
 * these, so no real person can use them. Test users live here (T13).
 */
const RESERVED_DOMAIN = /(^|\.)(example\.(com|net|org)|test|example|invalid|localhost)$/i;

export function isReservedEmailDomain(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@').pop() ?? '';
  return RESERVED_DOMAIN.test(domain);
}

/** The Cognito group every integration-test user belongs to (dev pools only). */
export const TEST_USERS_GROUP = 'integration-tests';
