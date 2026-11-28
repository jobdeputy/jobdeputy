import { describe, expect, it } from 'vitest';
import { WEB_SCOPE } from '../src/extension.js';
import { callerFromEvent, groupsFromClaim, scopesFromClaim } from '../src/index.js';

const withClaims = (claims?: Record<string, unknown>) => ({
  requestContext: { authorizer: { jwt: { ...(claims ? { claims } : {}) } } },
});

describe('callerFromEvent', () => {
  it('reads the user from verified access-token claims', () => {
    expect(callerFromEvent(withClaims({ sub: 'u-1', username: 'name-1' }))).toStrictEqual({
      userId: 'u-1',
      username: 'name-1',
      tier: 'free',
      webScope: false,
    });
  });

  it('reads auth_time (sent as a string by HTTP API) and ignores bad values', () => {
    expect(
      callerFromEvent(withClaims({ sub: 'u', username: 'n', auth_time: '1790000000' }))?.authTime,
    ).toBe(1790000000);
    expect(
      callerFromEvent(withClaims({ sub: 'u', username: 'n', auth_time: 'x' })),
    ).not.toHaveProperty('authTime');
    expect(callerFromEvent(withClaims({ sub: 'u', username: 'n' }))).not.toHaveProperty('authTime');
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

describe('the tier (#74)', () => {
  const tierOf = (groups: unknown) =>
    callerFromEvent(withClaims({ sub: 'u', username: 'n', 'cognito:groups': groups }))?.tier;

  it.each([
    ['HTTP API’s one string', '[premium]', 'premium'],
    ['several groups in one string', '[integration-tests premium]', 'premium'],
    ['an array (a REST API)', ['integration-tests', 'premium'], 'premium'],
    ['no groups claim', undefined, 'free'],
    ['other groups only', '[integration-tests]', 'free'],
    ['a name that only contains premium', '[premium-trial not-premium]', 'free'],
    ['an empty list', '[]', 'free'],
    ['not a string or array', 7, 'free'],
  ])('reads %s', (_, groups, tier) => {
    expect(tierOf(groups)).toBe(tier);
  });

  it('reads each group of a claim', () => {
    expect(groupsFromClaim('[a b  c]')).toEqual(['a', 'b', 'c']);
    expect(groupsFromClaim(['a', 1, 'b'])).toEqual(['a', 'b']);
    expect(groupsFromClaim('["premium","integration-tests"]')).toEqual([
      'premium',
      'integration-tests',
    ]);
    expect(groupsFromClaim('')).toEqual([]);
  });
});

describe('the web scope (#54 PR D, decision 0020)', () => {
  const webScopeOf = (scope: unknown) =>
    callerFromEvent(withClaims({ sub: 'u', username: 'n', scope }))?.webScope;

  it.each([
    ['a direct sign-in (the tests)', WEB_SCOPE, true],
    ["the web app's managed login", `openid email ${WEB_SCOPE}`, true],
    ["the extension's managed login", 'openid email', false],
    ['no scope claim', undefined, false],
    ['a scope that only contains it', `${WEB_SCOPE}.extra x${WEB_SCOPE}`, false],
    ['not a string', [WEB_SCOPE], false],
  ])('reads %s', (_, scope, webScope) => {
    expect(webScopeOf(scope)).toBe(webScope);
  });

  it('splits on spaces only, dropping empty parts', () => {
    expect(scopesFromClaim(' openid  email ')).toEqual(['openid', 'email']);
    expect(scopesFromClaim(7)).toEqual([]);
  });
});
