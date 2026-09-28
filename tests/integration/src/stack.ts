import { Sha256 } from '@aws-crypto/sha256-js';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';

/**
 * Finds the stack under test by name:
 * JD_STACK, or jobdeputy-dev-<JD_OWNER>-iad for a personal stack.
 * Credentials come from the normal AWS chain (for example AWS_PROFILE=jobdeputy-dev-iad).
 */
export function stackName(): string {
  if (process.env.JD_STACK) return process.env.JD_STACK;
  if (process.env.JD_OWNER) return `jobdeputy-dev-${process.env.JD_OWNER}-iad`;
  throw new Error('Set JD_STACK or JD_OWNER to choose the stack under test.');
}

export const region = process.env.AWS_REGION ?? 'us-east-1';
const credentials = fromNodeProviderChain();

export async function stackOutputs(): Promise<Record<string, string>> {
  const cfn = new CloudFormationClient({ region, credentials });
  const res = await cfn.send(new DescribeStacksCommand({ StackName: stackName() }));
  const outputs = res.Stacks?.[0]?.Outputs ?? [];
  return Object.fromEntries(outputs.map((o) => [o.OutputKey ?? '', o.OutputValue ?? '']));
}

export interface ApiResponse {
  status: number;
  contentType: string | null;
  // biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary JSON responses.
  body: any;
}

/** Calls the API, signed with SigV4 unless `unsigned` is set. */
export async function callApi(
  baseUrl: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  options: { unsigned?: boolean } = {},
): Promise<ApiResponse> {
  const url = new URL(path, baseUrl);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers: Record<string, string> = { host: url.host };
  if (payload) headers['content-type'] = 'application/json';
  let finalHeaders = headers;
  if (!options.unsigned) {
    const signer = new SignatureV4({ service: 'execute-api', region, credentials, sha256: Sha256 });
    const signed = await signer.sign(
      new HttpRequest({
        method,
        protocol: url.protocol,
        hostname: url.hostname,
        path: url.pathname,
        headers,
        ...(payload ? { body: payload } : {}),
      }),
    );
    finalHeaders = signed.headers as Record<string, string>;
  }
  const res = await fetch(url, {
    method,
    headers: finalHeaders,
    ...(payload ? { body: payload } : {}),
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
