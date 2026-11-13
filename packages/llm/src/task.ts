import type { Message, ModelStreamEvent, StreamOptions } from '@strands-agents/sdk';
import { Agent, Model, StructuredOutputError } from '@strands-agents/sdk';
import type { z } from 'zod';
import type { KeySource, ModelSource } from './models.js';
import { DATA_RULES } from './prompt.js';

/** Decision 0002: at most 3 model calls per task call, whatever the other limits say. */
export const MAX_TURNS = 3;

/** Upper bounds a task's own limits must stay within. */
export const LIMIT_BOUNDS = { maxTokens: 4_000, totalTokens: 60_000, timeoutMs: 120_000 } as const;

export interface TaskLimits {
  /** Output tokens per model call (the provider stops there). */
  maxTokens: number;
  /** Input plus output tokens across the task call; checked between calls. */
  totalTokens: number;
  /** Wall-clock limit for the whole task call. */
  timeoutMs: number;
}

/** A task is a versioned prompt, a strict zod schema, and its limits (decision 0009). */
export interface Task<I, O> {
  readonly name: string;
  readonly version: number;
  readonly system: string;
  readonly schema: z.ZodType<O>;
  readonly limits: TaskLimits;
  /** Builds the user message. Untrusted text must go through dataBlock(). */
  prompt(input: I): string;
}

const TASK_NAME = /^[a-z][a-z0-9-]{0,31}$/;

export function defineTask<I, O>(task: Task<I, O>): Task<I, O> {
  if (!TASK_NAME.test(task.name)) throw new Error(`invalid task name: ${task.name}`);
  if (!Number.isInteger(task.version) || task.version < 1)
    throw new Error(`invalid version: ${task.version}`);
  for (const key of Object.keys(LIMIT_BOUNDS) as (keyof TaskLimits)[]) {
    const value = task.limits[key];
    if (!Number.isInteger(value) || value < 1 || value > LIMIT_BOUNDS[key]) {
      throw new Error(`${task.name}: limit ${key}=${value} outside 1..${LIMIT_BOUNDS[key]}`);
    }
  }
  return task;
}

/** `relevance@v1`: stored with every result, so results can be compared per prompt version. */
export function promptVersion(task: Task<unknown, unknown>): string {
  return `${task.name}@v${task.version}`;
}

export type PartialReason =
  | 'turn-limit'
  | 'token-limit'
  | 'timeout'
  | 'cancelled'
  | 'no-structured-output';

export interface TaskUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

interface ResultBase {
  task: string;
  promptVersion: string;
  keySource: KeySource;
  provider: string;
  modelId: string;
  usage: TaskUsage;
  /** Replies that were not valid output (prompt-injection rule 7 counts these). */
  rejectedOutputs: number;
  durationMs: number;
}

export type TaskResult<O> =
  | (ResultBase & { status: 'ok'; output: O })
  | (ResultBase & { status: 'partial'; reason: PartialReason });

/** Counts every model call and its tokens, whatever way the call ends. */
class MeteredModel extends Model {
  readonly usage: TaskUsage = { calls: 0, inputTokens: 0, outputTokens: 0 };

  constructor(private readonly inner: Model) {
    super();
  }

  override get modelId(): string | undefined {
    return this.inner.modelId;
  }

  updateConfig(config: never): void {
    this.inner.updateConfig(config);
  }

  getConfig() {
    return this.inner.getConfig();
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    this.usage.calls += 1;
    for await (const event of this.inner.stream(messages, options)) {
      if (event.type === 'modelMetadataEvent' && event.usage) {
        this.usage.inputTokens += event.usage.inputTokens ?? 0;
        this.usage.outputTokens += event.usage.outputTokens ?? 0;
      }
      yield event;
    }
  }
}

const PARTIAL_REASONS: Record<string, PartialReason> = {
  limitTurns: 'turn-limit',
  limitTotalTokens: 'token-limit',
  limitOutputTokens: 'token-limit',
};

/**
 * Runs one task call with fixed limits (decision 0002):
 * - at most MAX_TURNS model calls; invalid output goes back to the model while turns remain;
 * - at most maxTokens output per call, totalTokens across the call, and timeoutMs;
 * - the only tool is the schema tool (prompt-injection rule 2), and no retries: the queue owns
 *   them, and the caller stores the result so a retried message never repeats a finished call.
 * At a limit it returns `partial` with the reason; there is no output to keep, since only valid
 * output is ever returned. Provider errors (throttling, access) are thrown for the queue.
 */
export async function runTask<I, O>(
  task: Task<I, O>,
  input: I,
  source: ModelSource,
  options: { signal?: AbortSignal } = {},
): Promise<TaskResult<O>> {
  const started = Date.now();
  const model = new MeteredModel(source.create({ maxTokens: task.limits.maxTokens }));
  const timeout = AbortSignal.timeout(task.limits.timeoutMs);
  const cancelSignal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  const agent = new Agent({
    model,
    systemPrompt: `${task.system}\n\n${DATA_RULES}`,
    tools: [],
    structuredOutputSchema: task.schema,
    retryStrategy: null,
    printer: false,
  });

  const base = (): ResultBase => ({
    task: task.name,
    promptVersion: promptVersion(task),
    keySource: source.keySource,
    provider: source.provider,
    modelId: source.modelId,
    usage: { ...model.usage },
    rejectedOutputs: 0,
    durationMs: Date.now() - started,
  });
  const partial = (reason: PartialReason): TaskResult<O> => {
    const result = base();
    return { ...result, rejectedOutputs: result.usage.calls, status: 'partial', reason };
  };

  try {
    const result = await agent.invoke(task.prompt(input), {
      cancelSignal,
      limits: {
        turns: MAX_TURNS,
        outputTokens: MAX_TURNS * task.limits.maxTokens,
        totalTokens: task.limits.totalTokens,
      },
    });
    const parsed =
      result.structuredOutput === undefined
        ? undefined
        : task.schema.safeParse(result.structuredOutput);
    if (parsed?.success) {
      const ok = base();
      return { ...ok, rejectedOutputs: ok.usage.calls - 1, status: 'ok', output: parsed.data };
    }
    if (cancelSignal.aborted) return partial(timeout.aborted ? 'timeout' : 'cancelled');
    return partial(PARTIAL_REASONS[result.stopReason] ?? 'no-structured-output');
  } catch (error) {
    if (cancelSignal.aborted) return partial(timeout.aborted ? 'timeout' : 'cancelled');
    if (error instanceof StructuredOutputError) return partial('no-structured-output');
    throw error;
  }
}
