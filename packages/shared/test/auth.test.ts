import { describe, expect, it } from 'vitest';
import { callerFromEvent } from '../src/index.js';

const withClaims = (claims?: Record<string, unknown>) => ({
  requestContext: { authorizer: { jwt: { ...(claims ? { claims } : {}) } } },
});

describe('callerFromEvent', () => {
  it('reads the user from verified access-token claims', () => {
    expect(callerFromEvent(withClaims({ sub: 'u-1', username: 'name-1' }))).toEqual({
      userId: 'u-1',
      username: 'name-1',
    });
  });

  it('accepts the ID-token username claim', () => {
    expect(callerFromEvent(withClaims({ sub: 'u-1', 'cognito:username': 'n' }))?.username).toBe(
      'n',
    );
  });

  it.each([
    ['no authorizer', { requestContext: {} }],
    ['no claims', withClaims()],
    ['empty sub', withClaims({ sub: '', username: 'x' })],
    ['non-string sub', withClaims({ sub: 1, username: 'x' })],
    ['no username', withClaims({ sub: 'u-1' })],
  ])('returns undefined with %s', (_, event) => {
    expect(callerFromEvent(event)).toBeUndefined();
  });
});
