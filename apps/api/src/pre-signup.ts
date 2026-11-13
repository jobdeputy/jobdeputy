import { createLogger, isReservedEmailDomain } from '@jobdeputy/shared';
import type { PreSignUpTriggerEvent } from 'aws-lambda';

const logger = createLogger('pre-signup');

export const REJECTED_MESSAGE = 'Sign-up with this email domain is not allowed.';

/**
 * Cognito pre-sign-up trigger (T13), in every stage. Reserved test domains
 * (example.com, *.test, …) can never become real accounts: self sign-up and future
 * social sign-in are always refused, and admin-created users (integration tests)
 * are allowed only where ALLOW_TEST_USERS is "true" (dev pools).
 */
export async function handler(event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> {
  const email = event.request.userAttributes.email ?? '';
  if (!isReservedEmailDomain(email)) return event;

  const adminCreated = event.triggerSource === 'PreSignUp_AdminCreateUser';
  if (adminCreated && process.env.ALLOW_TEST_USERS === 'true') return event;

  logger.warn('Refused a sign-up with a reserved email domain', {
    triggerSource: event.triggerSource,
  });
  throw new Error(REJECTED_MESSAGE);
}
