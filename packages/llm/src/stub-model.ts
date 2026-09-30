import type { Message, ModelStreamEvent, StreamOptions } from '@strands-agents/sdk';
import { Model } from '@strands-agents/sdk';
import type { ModelSource } from './models.js';

/** Strands' name for the schema tool that structured output asks the model to call. */
export const SCHEMA_TOOL = 'strands_structured_output';

/** One scripted reply: a call to a tool (the schema tool by default), plain text, or a hang. */
export type StubReply =
  | { tool: unknown; name?: string; tokens?: { input: number; output: number } }
  | { text: string; tokens?: { input: number; output: number } }
  | { hangMs: number };

export type StubScript = (call: number, messages: Message[]) => StubReply;

/**
 * A scripted model for unit and integration tests: never calls a provider and costs nothing.
 * `calls` and `maxTokensSeen` let tests check what runTask asked for.
 */
export class StubModel extends Model {
  calls = 0;
  private config: { modelId: string; maxTokens?: number } = { modelId: 'stub' };

  constructor(private readonly script: StubScript) {
    super();
  }

  updateConfig(config: { modelId: string; maxTokens?: number }): void {
    Object.assign(this.config, config);
  }

  getConfig() {
    return this.config;
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    const reply = this.script(this.calls++, messages);
    if ('hangMs' in reply) {
      await new Promise<void>((resolve) => {
        if (options?.cancelSignal?.aborted) return resolve();
        const timer = setTimeout(resolve, reply.hangMs);
        options?.cancelSignal?.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (options?.cancelSignal?.aborted) throw new Error('aborted');
      return;
    }
    const tokens = reply.tokens ?? { input: 100, output: 50 };
    yield { type: 'modelMessageStartEvent', role: 'assistant' };
    if ('text' in reply) {
      yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: reply.text } };
      yield { type: 'modelContentBlockStopEvent' };
    } else {
      const toolUseId = `stub-${this.calls}`;
      yield {
        type: 'modelContentBlockStartEvent',
        start: { type: 'toolUseStart', name: reply.name ?? SCHEMA_TOOL, toolUseId },
      };
      yield {
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'toolUseInputDelta', input: JSON.stringify(reply.tool) },
      };
      yield { type: 'modelContentBlockStopEvent' };
    }
    yield { type: 'modelMessageStopEvent', stopReason: 'text' in reply ? 'endTurn' : 'toolUse' };
    yield {
      type: 'modelMetadataEvent',
      usage: {
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        totalTokens: tokens.input + tokens.output,
      },
      metrics: { latencyMs: 1 },
    };
  }
}

/** A ModelSource backed by one StubModel, shared by every task call of the run. */
export function stubSource(
  script: StubScript,
): ModelSource & { model: StubModel; maxTokensSeen: number[] } {
  const model = new StubModel(script);
  const maxTokensSeen: number[] = [];
  return {
    keySource: 'platform',
    provider: 'stub',
    modelId: 'stub',
    model,
    maxTokensSeen,
    create: ({ maxTokens }) => {
      maxTokensSeen.push(maxTokens);
      return model;
    },
  };
}
