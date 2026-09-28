import { randomBytes, randomUUID } from 'node:crypto';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { GetMalwareProtectionPlanCommand, GuardDutyClient } from '@aws-sdk/client-guardduty';

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
  /** Signs in again (a fresh auth_time), for example before deleting the account. */
  signIn: () => Promise<string>;
  /**
   * Deletes the account through `DELETE /me`, so all its data goes (T12). Falls back
   * to deleting the Cognito user directly, so a broken deletion never leaves a user behind.
   */
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
  const adminDelete = async () => {
    await cognito
      .send(new AdminDeleteUserCommand({ UserPoolId, Username: email }))
      .catch((error: Error) => {
        if (error.name !== 'UserNotFoundException') throw error;
      });
  };
  const signIn = async () => {
    const auth = await cognito.send(
      new AdminInitiateAuthCommand({
        UserPoolId,
        ClientId,
        AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: email, PASSWORD: password },
      }),
    );
    const token = auth.AuthenticationResult?.AccessToken;
    if (!token) throw new Error('Sign-in returned no access token');
    return token;
  };
  const deleteAccount = async () => {
    try {
      const res = await callApi(outputs.ApiUrl ?? '', 'DELETE', 'me', await signIn(), {
        confirm: 'delete my account',
      });
      if (res.status === 202) return;
    } catch {
      // Already deleted, or the API is unavailable: fall through.
    }
    await adminDelete();
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
    return { email, accessToken: await signIn(), signIn, delete: deleteAccount };
  } catch (error) {
    await adminDelete();
    throw error;
  }
}

/** Files uploaded before a new stack's GuardDuty plan is ACTIVE are never scanned. */
export async function waitForMalwareScanning(outputs: Record<string, string>): Promise<void> {
  const guardduty = new GuardDutyClient({ region });
  await waitFor(
    async () => {
      const plan = await guardduty.send(
        new GetMalwareProtectionPlanCommand({
          MalwareProtectionPlanId: outputs.MalwareProtectionPlanId,
        }),
      );
      return plan.Status === 'ACTIVE' ? true : undefined;
    },
    { timeoutMs: 300_000, intervalMs: 5_000 },
  );
}

/** Starts a résumé upload and posts the file with the presigned form. */
export async function uploadDocument(
  api: string,
  user: TestUser,
  fileName: string,
  contentType: string,
  bytes: Uint8Array,
  formType = contentType,
): Promise<{ documentId: string; s3Status: number }> {
  const started = await callApi(api, 'POST', 'me/documents', user.accessToken, {
    fileName,
    contentType,
  });
  if (started.status !== 201) throw new Error(`Upload start failed: ${started.status}`);
  const form = new FormData();
  for (const [k, v] of Object.entries(started.body.upload.fields as Record<string, string>)) {
    form.append(k, k === 'Content-Type' ? formType : v);
  }
  form.append('file', new Blob([bytes], { type: formType }), fileName);
  const s3 = await fetch(started.body.upload.url, { method: 'POST', body: form });
  return { documentId: started.body.document.documentId as string, s3Status: s3.status };
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
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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
