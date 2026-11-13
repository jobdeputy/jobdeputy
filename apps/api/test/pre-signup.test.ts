import { isReservedEmailDomain } from '@jobdeputy/shared';
import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { afterEach, describe, expect, it } from 'vitest';
import { handler } from '../src/pre-signup.js';

const event = (email: string, triggerSource: string) =>
  ({
    triggerSource,
    request: { userAttributes: { email } },
    response: {},
  }) as unknown as PreSignUpTriggerEvent;

afterEach(() => {
  delete process.env.ALLOW_TEST_USERS;
});

describe('pre-sign-up trigger', () => {
  it('lets real addresses sign up', async () => {
    for (const email of [
      'ada@gmail.com',
      'ada@company.co.uk',
      'ada@example.co',
      'ada@notexample.com',
    ]) {
      await expect(handler(event(email, 'PreSignUp_SignUp'))).resolves.toBeDefined();
    }
  });

  it.each([
    'it-123@example.com',
    'x@EXAMPLE.org',
    'x@mail.example.net',
    'x@foo.test',
    'x@a.invalid',
    'x@localhost',
  ])('refuses self sign-up with %s, in every stage', async (email) => {
    process.env.ALLOW_TEST_USERS = 'true';
    await expect(handler(event(email, 'PreSignUp_SignUp'))).rejects.toThrow('not allowed');
    await expect(handler(event(email, 'PreSignUp_ExternalProvider'))).rejects.toThrow(
      'not allowed',
    );
  });

  it('allows admin-created test users only where test users are allowed (dev)', async () => {
    await expect(handler(event('it-1@example.com', 'PreSignUp_AdminCreateUser'))).rejects.toThrow(
      'not allowed',
    );
    process.env.ALLOW_TEST_USERS = 'true';
    await expect(
      handler(event('it-1@example.com', 'PreSignUp_AdminCreateUser')),
    ).resolves.toBeDefined();
  });

  it('matches only reserved domains, not look-alikes', () => {
    expect(isReservedEmailDomain('a@example.com')).toBe(true);
    expect(isReservedEmailDomain('a@examples.com')).toBe(false);
    expect(isReservedEmailDomain('a@example.com.evil.org')).toBe(false);
    expect(isReservedEmailDomain('a@testing.io')).toBe(false);
  });
});
