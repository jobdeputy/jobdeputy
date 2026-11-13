import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

/**
 * Looks up a user's verified email in this cell's pool (access tokens do not carry it).
 * Undefined once the login is gone, for example after account deletion (T12): a token
 * can outlive its user by up to an hour, and that must not turn reads into errors.
 */
export function cognitoEmailLookup(
  userPoolId: string,
  cognito: Pick<CognitoIdentityProviderClient, 'send'> = new CognitoIdentityProviderClient({}),
): (username: string) => Promise<string | undefined> {
  return async (username) => {
    try {
      const res = await cognito.send(
        new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }),
      );
      return res.UserAttributes?.find((a) => a.Name === 'email')?.Value;
    } catch (error) {
      if ((error as Error).name === 'UserNotFoundException') return undefined;
      throw error;
    }
  };
}
