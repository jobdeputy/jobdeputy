import { randomUUID } from 'node:crypto';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { isConditionFailure } from './client.js';

/** Item shape: see docs/data-model.md, table `ping-jobs`. */
export interface PingJob {
  id: string;
  type: 'ping';
  /** Owner (Cognito `sub`). Only the owner can read the job. */
  userId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  attempts: number;
  sideEffectCount: number;
  /** Every queue delivery, including duplicates and skips. Lets tests wait on a fact, not a sleep. */
  deliveries: number;
  fail?: boolean;
  error?: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
  ttl: number;
}

/** Dev-only scaffolding holding a user ID outside the user tables: keep it briefly. */
const TTL_SECONDS = 24 * 60 * 60;
const MAX_ERROR_LENGTH = 500;

export class PingRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(options: { userId: string; fail?: boolean }): Promise<PingJob> {
    const at = this.now();
    const job: PingJob = {
      id: randomUUID(),
      type: 'ping',
      userId: options.userId,
      status: 'queued',
      attempts: 0,
      sideEffectCount: 0,
      deliveries: 0,
      ...(options.fail ? { fail: true } : {}),
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
      schemaVersion: 1,
      ttl: Math.floor(at.getTime() / 1000) + TTL_SECONDS,
    };
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: job,
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
    return job;
  }

  async get(id: string): Promise<PingJob | undefined> {
    const res = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { id }, ConsistentRead: true }),
    );
    return res.Item as PingJob | undefined;
  }

  /** Counts a delivery before any other check, so duplicates are visible too. */
  async recordDelivery(id: string): Promise<void> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { id },
          UpdateExpression: 'ADD deliveries :one SET updatedAt = :now',
          ConditionExpression: 'attribute_exists(id)',
          ExpressionAttributeValues: { ':one': 1, ':now': this.now().toISOString() },
        }),
      );
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
    }
  }

  /** queued|running → running, counting the attempt. Undefined if the job is already final or missing. */
  async markRunning(id: string): Promise<PingJob | undefined> {
    return this.update(
      id,
      'SET #status = :running, attempts = attempts + :one, updatedAt = :now',
      '#status IN (:queued, :running)',
      { ':running': 'running', ':queued': 'queued', ':one': 1 },
    );
  }

  /**
   * The ping's side effect and its completion in one conditional write, so a
   * duplicate delivery can never apply the side effect twice.
   */
  async completeWithSideEffect(id: string): Promise<PingJob | undefined> {
    return this.update(
      id,
      'SET #status = :succeeded, sideEffectCount = sideEffectCount + :one, updatedAt = :now REMOVE #error',
      '#status = :running',
      { ':succeeded': 'succeeded', ':running': 'running', ':one': 1 },
      { '#error': 'error' },
    );
  }

  /** Records why the latest attempt failed; the job stays running until retries run out. */
  async recordAttemptError(id: string, reason: string): Promise<PingJob | undefined> {
    return this.update(
      id,
      'SET #error = :error, updatedAt = :now',
      '#status = :running',
      {
        ':error': reason.slice(0, MAX_ERROR_LENGTH),
        ':running': 'running',
      },
      { '#error': 'error' },
    );
  }

  async markFailed(id: string, reason: string): Promise<PingJob | undefined> {
    return this.update(
      id,
      'SET #status = :failed, #error = :error, updatedAt = :now',
      '#status IN (:queued, :running)',
      {
        ':failed': 'failed',
        ':error': reason.slice(0, MAX_ERROR_LENGTH),
        ':queued': 'queued',
        ':running': 'running',
      },
      { '#error': 'error' },
    );
  }

  private async update(
    id: string,
    updateExpression: string,
    condition: string,
    values: Record<string, unknown>,
    names: Record<string, string> = {},
  ): Promise<PingJob | undefined> {
    try {
      const res = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { id },
          UpdateExpression: updateExpression,
          ConditionExpression: `attribute_exists(id) AND ${condition}`,
          ExpressionAttributeNames: { '#status': 'status', ...names },
          ExpressionAttributeValues: { ':now': this.now().toISOString(), ...values },
          ReturnValues: 'ALL_NEW',
        }),
      );
      return res.Attributes as PingJob;
    } catch (error) {
      if (isConditionFailure(error)) return undefined;
      throw error;
    }
  }
}
