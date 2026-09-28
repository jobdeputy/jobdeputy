import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { PutCommand, type UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { PingRepository } from '../src/index.js';

function fakeClient(send: (cmd: unknown) => unknown) {
  return { send: vi.fn(async (cmd: unknown) => send(cmd)) } as unknown as DynamoDBDocumentClient & {
    send: ReturnType<typeof vi.fn>;
  };
}

const NOW = new Date('2026-09-28T00:00:00.000Z');

describe('PingRepository', () => {
  it('creates a queued job that expires after 7 days, never overwriting', async () => {
    const client = fakeClient(() => ({}));
    const job = await new PingRepository(client, 'T', () => NOW).create({ userId: 'u-1' });
    expect(job).toMatchObject({
      status: 'queued',
      attempts: 0,
      sideEffectCount: 0,
      type: 'ping',
      userId: 'u-1',
    });
    expect(job.ttl).toBe(NOW.getTime() / 1000 + 7 * 86400);
    const cmd = client.send.mock.calls[0]?.[0] as PutCommand;
    expect(cmd).toBeInstanceOf(PutCommand);
    expect(cmd.input.ConditionExpression).toBe('attribute_not_exists(id)');
  });

  it('returns undefined when a status change is not allowed', async () => {
    const client = fakeClient(() => {
      const e = new Error('no');
      e.name = 'ConditionalCheckFailedException';
      throw e;
    });
    await expect(
      new PingRepository(client, 'T').completeWithSideEffect('x'),
    ).resolves.toBeUndefined();
  });

  it('rethrows other DynamoDB errors', async () => {
    const client = fakeClient(() => {
      throw new Error('throttled');
    });
    await expect(new PingRepository(client, 'T').markRunning('x')).rejects.toThrow('throttled');
  });

  it('only completes a running job, and applies the side effect in the same write', async () => {
    const client = fakeClient(() => ({ Attributes: { id: 'x', status: 'succeeded' } }));
    await new PingRepository(client, 'T').completeWithSideEffect('x');
    const cmd = client.send.mock.calls[0]?.[0] as UpdateCommand;
    expect(cmd.input.UpdateExpression).toContain('sideEffectCount = sideEffectCount + :one');
    expect(cmd.input.ConditionExpression).toBe('attribute_exists(id) AND #status = :running');
  });

  it('counts deliveries without failing for missing jobs', async () => {
    const client = fakeClient(() => {
      const e = new Error('no');
      e.name = 'ConditionalCheckFailedException';
      throw e;
    });
    await expect(new PingRepository(client, 'T').recordDelivery('x')).resolves.toBeUndefined();
    const cmd = client.send.mock.calls[0]?.[0] as UpdateCommand;
    expect(cmd.input.UpdateExpression).toContain('ADD deliveries :one');
    expect(cmd.input.ExpressionAttributeNames).toBeUndefined();
  });

  it('truncates long error reasons', async () => {
    const client = fakeClient(() => ({ Attributes: {} }));
    await new PingRepository(client, 'T').markFailed('x', 'e'.repeat(2000));
    const cmd = client.send.mock.calls[0]?.[0] as UpdateCommand;
    expect(String(cmd.input.ExpressionAttributeValues?.[':error']).length).toBe(500);
  });
});
