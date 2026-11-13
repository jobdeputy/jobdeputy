import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createLogger } from '@jobdeputy/shared';
import type { Context } from 'aws-lambda';
import { z } from 'zod';

/**
 * T08d1: one scheduled check of every worker queue, instead of one CloudWatch alarm per
 * queue (a metric-math alarm is billed per metric, so merging alarms saves nothing).
 * Every 5 minutes it reads each queue's waiting and dead-letter counts (free SQS
 * attributes) and emails the alarm topic only when a queue's health changes.
 *
 * Problems:
 * - **Dead letters:** the dead-letter queue is not empty (work failed after all retries).
 * - **Backlog:** messages have been waiting, without a break, longer than the queue's
 *   slowest normal path (the worker is stuck, throttled, or not running). The age of the
 *   oldest message is only a CloudWatch metric, and reading metrics costs money, so the
 *   check remembers since when messages have been waiting.
 */

const logger = createLogger('queue-health');

export const watchedQueue = z.strictObject({
  /** Short name used in emails, for example `crawls`. */
  name: z.string().min(1).max(60),
  queueUrl: z.url(),
  deadLetterUrl: z.url(),
  /** No backlog check when absent. */
  backlogAfterSeconds: z.number().int().positive().optional(),
});
export type WatchedQueue = z.infer<typeof watchedQueue>;

export interface Observation {
  name: string;
  /** Messages waiting to be received (not in flight, not delayed). */
  waiting: number;
  deadLetters: number;
  backlogAfterSeconds?: number | undefined;
}

const queueState = z.object({
  /** Dead letters reported in the last email that said so; 0 or absent when healthy. */
  deadLetters: z.number().int().nonnegative().optional(),
  /** Since when messages have been waiting without a break. */
  waitingSince: z.string().optional(),
  /** A backlog has been reported and is not over yet. */
  backlog: z.boolean().optional(),
});
export const healthState = z.record(z.string(), queueState);
export type HealthState = z.infer<typeof healthState>;

export interface Assessment {
  next: HealthState;
  /** One line per change, for the email. Empty: nothing to send. */
  changes: string[];
  /** Queues with a problem now (after this check). */
  problems: number;
}

const RUNBOOK = 'See docs/runbooks/alarms.md.';

/** Compares this check with the last one. Pure: the handler does the reads and writes. */
export function assess(previous: HealthState, observations: Observation[], now: Date): Assessment {
  const next: HealthState = {};
  const changes: string[] = [];
  let problems = 0;
  for (const o of observations) {
    const before = previous[o.name] ?? {};
    const state: HealthState[string] = {};

    const dead = o.deadLetters > 0;
    const wasDead = (before.deadLetters ?? 0) > 0;
    if (dead && !wasDead) {
      changes.push(
        `${o.name}: ${o.deadLetters} message(s) in the dead-letter queue (work failed after all retries). ${RUNBOOK}`,
      );
    } else if (!dead && wasDead) {
      changes.push(`${o.name}: the dead-letter queue is empty again.`);
    }
    if (dead) state.deadLetters = wasDead ? (before.deadLetters as number) : o.deadLetters;

    if (o.waiting > 0) {
      const since = before.waitingSince ?? now.toISOString();
      state.waitingSince = since;
      const waitedSeconds = (now.getTime() - Date.parse(since)) / 1000;
      const late = o.backlogAfterSeconds !== undefined && waitedSeconds >= o.backlogAfterSeconds;
      if (late && !before.backlog) {
        changes.push(
          `${o.name}: messages have been waiting for over ${Math.round((o.backlogAfterSeconds as number) / 60)} minutes (worker stuck, throttled, or not running). ${RUNBOOK}`,
        );
      }
      if (late) state.backlog = true;
    }
    if (before.backlog && !state.backlog) changes.push(`${o.name}: the backlog has cleared.`);

    if (state.deadLetters !== undefined || state.backlog) problems += 1;
    if (Object.keys(state).length > 0) next[o.name] = state;
  }
  return { next, changes, problems };
}

/** A stored state that is missing or unreadable starts over (at worst, one repeated email). */
export function parseState(raw: string | undefined): HealthState {
  try {
    const parsed = healthState.safeParse(JSON.parse(raw ?? '{}'));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export interface QueueHealthDeps {
  queues: WatchedQueue[];
  stackName: string;
  counts: (queueUrl: string) => Promise<number>;
  readState: () => Promise<string | undefined>;
  writeState: (value: string) => Promise<void>;
  publish: (subject: string, message: string) => Promise<void>;
  now: () => Date;
}

export async function checkQueues(deps: QueueHealthDeps): Promise<Assessment> {
  const observations = await Promise.all(
    deps.queues.map(async (q) => {
      const [waiting, deadLetters] = await Promise.all([
        deps.counts(q.queueUrl),
        deps.counts(q.deadLetterUrl),
      ]);
      return { name: q.name, waiting, deadLetters, backlogAfterSeconds: q.backlogAfterSeconds };
    }),
  );
  const raw = await deps.readState();
  const previous = parseState(raw);
  const result = assess(previous, observations, deps.now());
  if (result.changes.length > 0) {
    const subject =
      result.problems > 0
        ? `[${deps.stackName}] Queue health: ${result.problems} queue(s) need attention`
        : `[${deps.stackName}] Queue health: all queues back to normal`;
    // Email first: if saving the state then fails, the next check sends it again (a
    // repeated email is better than a missed one).
    await deps.publish(subject, result.changes.join('\n'));
  }
  const value = JSON.stringify(result.next);
  if (value !== JSON.stringify(previous) || raw === undefined) await deps.writeState(value);
  logger.info('Queues checked', {
    queues: observations.length,
    problems: result.problems,
    changes: result.changes.length,
  });
  return result;
}

let deps: QueueHealthDeps | undefined;

function defaultDeps(): QueueHealthDeps {
  const { WATCHED_QUEUES, ALARM_TOPIC_ARN, STATE_PARAMETER, STACK_NAME } = process.env;
  if (!WATCHED_QUEUES || !ALARM_TOPIC_ARN || !STATE_PARAMETER || !STACK_NAME) {
    throw new Error('WATCHED_QUEUES, ALARM_TOPIC_ARN, STATE_PARAMETER, and STACK_NAME must be set');
  }
  const queues = z.array(watchedQueue).parse(JSON.parse(WATCHED_QUEUES));
  const sqs = new SQSClient({});
  const ssm = new SSMClient({});
  const sns = new SNSClient({});
  return {
    queues,
    stackName: STACK_NAME,
    counts: async (queueUrl) => {
      const res = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages'],
        }),
      );
      return Number(res.Attributes?.ApproximateNumberOfMessages ?? 0);
    },
    readState: async () => {
      try {
        const res = await ssm.send(new GetParameterCommand({ Name: STATE_PARAMETER }));
        return res.Parameter?.Value;
      } catch (error) {
        if ((error as Error).name === 'ParameterNotFound') return undefined;
        throw error;
      }
    },
    writeState: async (value) => {
      await ssm.send(
        new PutParameterCommand({ Name: STATE_PARAMETER, Value: value, Overwrite: true }),
      );
    },
    publish: async (subject, message) => {
      await sns.send(
        new PublishCommand({
          TopicArn: ALARM_TOPIC_ARN,
          Subject: subject.slice(0, 100),
          Message: message,
        }),
      );
    },
    now: () => new Date(),
  };
}

/** Scheduled every 5 minutes (shared stacks only). A failure fails the run: its alarm fires. */
export async function handler(_event: unknown, context: Context): Promise<void> {
  logger.addContext(context);
  deps ??= defaultDeps();
  await checkQueues(deps);
}
