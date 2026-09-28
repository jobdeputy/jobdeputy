/**
 * The signed-in caller, taken only from the JWT claims that API Gateway has
 * already verified. Never read a user ID from the request body or URL.
 */
export interface Caller {
  /** Cognito `sub`: the stable user ID used as the key for all user data (0006). */
  userId: string;
  /** Cognito username (for pools with email sign-in, a generated ID). */
  username: string;
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
  return { userId, username };
}
