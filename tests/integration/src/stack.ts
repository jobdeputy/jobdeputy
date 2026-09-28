import { randomBytes, randomUUID } from 'node:crypto';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

/**
 * Finds the stack under test by name:
 * JD_STACK, or jobdeputy-dev-<JD_OWNER>-iad for a personal stack.
 * AWS credentials come from the normal chain (for example AWS_PROFILE=jobdeputy-dev-iad).
 */
export function stackName(): string {
  if (process.env.JD_STACK) return process.env.JD_STACK;
  if (process.env.JD_OWNER) return `jobdeputy-dev-${process.env.JD_OWNER}-iad`;
  throw new Error('Set JD_STACK or JD_OWNER to choose the stack under test.');
}

export const region = process.env.AWS_REGION ?? 'us-east-1';

export async function stackOutputs(): Promise<Record<string, string>> {
  const cfn = new CloudFormationClient({ region });
  const res = await cfn.send(new DescribeStacksCommand({ StackName: stackName() }));
  const outputs = res.Stacks?.[0]?.Outputs ?? [];
  return Object.fromEntries(outputs.map((o) => [o.OutputKey ?? '', o.OutputValue ?? '']));
}

export interface TestUser {
  email: string;
  accessToken: string;
  delete: () => Promise<void>;
}

/**
 * A throwaway, already-confirmed user (no email is sent), signed in through the
 * IAM-only admin flow of the dev `integration-tests` client. Always call delete().
 */
export async function createTestUser(outputs: Record<string, string>): Promise<TestUser> {
  const cognito = new CognitoIdentityProviderClient({ region });
  const UserPoolId = outputs.UserPoolId;
  const ClientId = outputs.TestsClientId;
  if (!UserPoolId || !ClientId) throw new Error('Stack has no UserPoolId or TestsClientId output');
  const email = `it-${randomUUID()}@example.com`;
  const password = `${randomBytes(18).toString('base64url')}-Aa1`;
  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId,
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
    }),
  );
  const remove = async () => {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId, Username: email }));
  };
  try {
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId,
        Username: email,
        Password: password,
        Permanent: true,
      }),
    );
    const auth = await cognito.send(
      new AdminInitiateAuthCommand({
        UserPoolId,
        ClientId,
        AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: email, PASSWORD: password },
      }),
    );
    const accessToken = auth.AuthenticationResult?.AccessToken;
    if (!accessToken) throw new Error('Sign-in returned no access token');
    return { email, accessToken, delete: remove };
  } catch (error) {
    await remove();
    throw error;
  }
}

export interface ApiResponse {
  status: number;
  contentType: string | null;
  // biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary JSON responses.
  body: any;
}

/** Calls the API with a bearer token (or none). */
export async function callApi(
  baseUrl: string,
  method: 'GET' | 'POST',
  path: string,
  token: string | undefined,
  body?: unknown,
): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { status: res.status, contentType: res.headers.get('content-type'), body: parsed };
}

export async function waitFor<T>(
  check: () => Promise<T | undefined>,
  { timeoutMs, intervalMs = 2_000 }: { timeoutMs: number; intervalMs?: number },
): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs} ms`);
}
