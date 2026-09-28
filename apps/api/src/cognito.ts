import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

/** Looks up a user's verified email in this cell's pool (access tokens do not carry it). */
export function cognitoEmailLookup(
  userPoolId: string,
): (username: string) => Promise<string | undefined> {
  const cognito = new CognitoIdentityProviderClient({});
  return async (username) => {
    const res = await cognito.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }),
    );
    return res.UserAttributes?.find((a) => a.Name === 'email')?.Value;
  };
}
