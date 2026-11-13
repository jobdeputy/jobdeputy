import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callApi, createTestUser, region, stackOutputs, type TestUser, waitFor } from './stack.js';

/**
 * Only what unit tests cannot prove: the deployed wiring of the T04 pipeline
 * (stream → Pipe → queue → worker, retries, dead-letter queue, duplicates).
 * Auth is covered in auth.test.ts.
 * Validation and error-mapping cases live in the unit tests. See docs/testing.md.
 *
 * Timeouts are generous on purpose: a freshly created Pipe can take minutes to
 * start. Tests wait for observable facts (status, delivery count), never a fixed sleep.
 */
const full = process.env.JD_FULL === '1';
const SUCCESS_TIMEOUT_MS = 180_000;
const FAILURE_TIMEOUT_MS = 300_000;
const QUEUE_TIMEOUT_MS = 120_000;

let api: string;
let outputs: Record<string, string>;
let user: TestUser;

beforeAll(async () => {
  outputs = await stackOutputs();
  api = outputs.ApiUrl ?? '';
  expect(api).toMatch(/^https:\/\//);
  user = await createTestUser(outputs);
});

afterAll(async () => {
  await user?.delete();
});

async function getJob(id: string) {
  const res = await callApi(api, 'GET', `ping-jobs/${id}`, user.accessToken);
  expect(res.status).toBe(200);
  return res.body;
}

async function waitForJob(
  id: string,
  done: (job: { status: string; deliveries: number }) => boolean,
  timeoutMs: number,
) {
  return waitFor(
    async () => {
      const job = await getJob(id);
      return done(job) ? job : undefined;
    },
    { timeoutMs },
  );
}

const isFinal = (job: { status: string }) => ['succeeded', 'failed'].includes(job.status);

describe('ping jobs (deployed pipeline)', () => {
  it('accepts a job immediately and the worker marks it succeeded', async () => {
    const created = await callApi(api, 'POST', 'ping-jobs', user.accessToken, {});
    expect(created.status).toBe(202);
    expect(created.body.status).toBe('queued');
    const job = await waitForJob(created.body.id, isFinal, SUCCESS_TIMEOUT_MS);
    expect(job).toMatchObject({ status: 'succeeded', attempts: 1, sideEffectCount: 1 });
  });

  it('fails a forced failure after 3 attempts, then dead-letters it', async () => {
    const created = await callApi(api, 'POST', 'ping-jobs', user.accessToken, { fail: true });
    expect(created.status).toBe(202);
    const job = await waitForJob(created.body.id, isFinal, FAILURE_TIMEOUT_MS);
    expect(job).toMatchObject({ status: 'failed', attempts: 3 });
    expect(job.error).toContain('Forced failure');

    if (!full) return;
    const sqs = new SQSClient({ region });
    const dlq = outputs.PingDeadLetterQueueUrl;
    const found = await waitFor(
      async () => {
        const res = await sqs.send(
          new ReceiveMessageCommand({ QueueUrl: dlq, MaxNumberOfMessages: 10, WaitTimeSeconds: 5 }),
        );
        const hit = res.Messages?.find((m) => m.Body?.includes(created.body.id));
        if (hit) {
          await sqs.send(
            new DeleteMessageCommand({ QueueUrl: dlq, ReceiptHandle: hit.ReceiptHandle }),
          );
        }
        return hit;
      },
      { timeoutMs: QUEUE_TIMEOUT_MS, intervalMs: 1_000 },
    );
    expect(JSON.parse(found.Body ?? '{}')).toEqual({ id: created.body.id });
  });

  it.runIf(full)('does not repeat side effects on a duplicate delivery', async () => {
    const created = await callApi(api, 'POST', 'ping-jobs', user.accessToken, {});
    const first = await waitForJob(created.body.id, isFinal, SUCCESS_TIMEOUT_MS);
    expect(first).toMatchObject({ status: 'succeeded', sideEffectCount: 1, deliveries: 1 });

    await new SQSClient({ region }).send(
      new SendMessageCommand({
        QueueUrl: outputs.PingQueueUrl,
        MessageBody: JSON.stringify({ id: created.body.id }),
      }),
    );
    // Wait until the worker has actually received the duplicate, then check nothing repeated.
    const after = await waitForJob(created.body.id, (j) => j.deliveries >= 2, QUEUE_TIMEOUT_MS);
    expect(after).toMatchObject({ status: 'succeeded', sideEffectCount: 1, attempts: 1 });
  });
});
