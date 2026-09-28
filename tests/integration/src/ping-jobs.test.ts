import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { beforeAll, describe, expect, it } from 'vitest';
import { callApi, region, stackOutputs, waitFor } from './stack.js';

/**
 * End-to-end checks of the T04 async pipeline against a deployed stack.
 * Tests marked "full" need queue access (JD_FULL=1, admin profile); CI runs the rest.
 */
const full = process.env.JD_FULL === '1';
let api: string;
let outputs: Record<string, string>;

beforeAll(async () => {
  outputs = await stackOutputs();
  api = outputs.ApiUrl ?? '';
  expect(api).toMatch(/^https:\/\//);
});

async function finalStatus(id: string, timeoutMs: number) {
  return waitFor(
    async () => {
      const res = await callApi(api, 'GET', `ping-jobs/${id}`);
      expect(res.status).toBe(200);
      return ['succeeded', 'failed'].includes(res.body.status) ? res.body : undefined;
    },
    { timeoutMs },
  );
}

describe('ping jobs', () => {
  it('rejects unsigned requests', async () => {
    const res = await callApi(api, 'POST', 'ping-jobs', {}, { unsigned: true });
    expect(res.status).toBe(403);
  });

  it('rejects invalid input with a problem response', async () => {
    const res = await callApi(api, 'POST', 'ping-jobs', { fail: 'yes' });
    expect(res.status).toBe(400);
    expect(res.contentType).toContain('application/problem+json');
  });

  it('returns 404 for an unknown job', async () => {
    const res = await callApi(api, 'GET', 'ping-jobs/0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(res.status).toBe(404);
  });

  it('queues a job, returns immediately, and the worker marks it succeeded', async () => {
    const created = await callApi(api, 'POST', 'ping-jobs', {});
    expect(created.status).toBe(202);
    expect(created.body.status).toBe('queued');
    const job = await finalStatus(created.body.id, 60_000);
    expect(job).toMatchObject({ status: 'succeeded', attempts: 1, sideEffectCount: 1 });
  });

  it('fails a forced failure after 3 attempts with the reason', async () => {
    const created = await callApi(api, 'POST', 'ping-jobs', { fail: true });
    expect(created.status).toBe(202);
    const job = await finalStatus(created.body.id, 150_000);
    expect(job).toMatchObject({ status: 'failed', attempts: 3 });
    expect(job.error).toContain('Forced failure');

    if (!full) return;
    // The message then lands in the dead-letter queue.
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
      { timeoutMs: 60_000, intervalMs: 1_000 },
    );
    expect(JSON.parse(found.Body ?? '{}')).toEqual({ id: created.body.id });
  });

  it.runIf(full)('does not repeat side effects on a duplicate delivery', async () => {
    const created = await callApi(api, 'POST', 'ping-jobs', {});
    const first = await finalStatus(created.body.id, 60_000);
    expect(first.sideEffectCount).toBe(1);

    const sqs = new SQSClient({ region });
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: outputs.PingQueueUrl,
        MessageBody: JSON.stringify({ id: created.body.id }),
      }),
    );
    await new Promise((r) => setTimeout(r, 15_000));
    const after = await callApi(api, 'GET', `ping-jobs/${created.body.id}`);
    expect(after.body).toMatchObject({ status: 'succeeded', sideEffectCount: 1, attempts: 1 });
  });
});
