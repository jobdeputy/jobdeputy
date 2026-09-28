import { z } from 'zod';

/** T04 test job that proves the async pipeline. See docs/data-model.md (ping-jobs). */
export const PING_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type PingStatus = (typeof PING_STATUSES)[number];

export const createPingJobRequest = z.strictObject({
  /** Forces the worker to fail every attempt. Accepted only in the dev stage. */
  fail: z.boolean().optional(),
});
export type CreatePingJobRequest = z.infer<typeof createPingJobRequest>;

export const pingJobId = z.uuid();

/** The only thing the Pipe puts on the queue: an ID, never the item. */
export const pingJobMessage = z.object({ id: pingJobId });
export type PingJobMessage = z.infer<typeof pingJobMessage>;
