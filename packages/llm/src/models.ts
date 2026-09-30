import { PLATFORM_MODEL_ID } from '@jobdeputy/shared';
import type { Model } from '@strands-agents/sdk';
import { AnthropicModel } from '@strands-agents/sdk/models/anthropic';
import { BedrockModel } from '@strands-agents/sdk/models/bedrock';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';

export { PLATFORM_MODEL_ID };

/** Cell Regions (decision 0004): the platform model is always called in the user's Region. */
export const CELL_REGIONS = ['us-east-1', 'ap-south-1', 'eu-west-2'] as const;
export type CellRegion = (typeof CELL_REGIONS)[number];

export type KeySource = 'platform' | 'own';

/** Providers with a real model behind a user's key (the dev-only `stub` has none). */
export type OwnKeyProvider = 'openai' | 'anthropic';

/**
 * A model for one run: labels for usage tracking, and a factory that builds a fresh Strands
 * model per task call with that call's output cap.
 */
export interface ModelSource {
  readonly keySource: KeySource;
  readonly provider: string;
  readonly modelId: string;
  create(options: { maxTokens: number }): Model;
}

export type ModelChoice =
  | { source: 'platform'; region: string }
  | { source: 'own'; provider: OwnKeyProvider; modelId: string; apiKey: string };

/** A backstop per HTTP request to a provider; each task call also has its own timeout. */
export const PROVIDER_REQUEST_TIMEOUT_MS = 60_000;

/** The model for a run (decision 0009): the platform model, or the user's own key. */
export function resolveModel(choice: ModelChoice): ModelSource {
  if (choice.source === 'own') return ownModel(choice);
  const region = choice.region;
  if (!CELL_REGIONS.includes(region as CellRegion)) throw new Error(`not a cell Region: ${region}`);
  return {
    keySource: 'platform',
    provider: 'bedrock',
    modelId: PLATFORM_MODEL_ID,
    create: ({ maxTokens }) =>
      new BedrockModel({
        region,
        modelId: PLATFORM_MODEL_ID,
        // Converse without streaming needs only bedrock:InvokeModel (decision 0010).
        stream: false,
        temperature: 0,
        maxTokens,
        // The queue owns retries (decision 0002 rule 3), so the AWS SDK must not retry.
        clientConfig: { maxAttempts: 1 },
      }),
  };
}

/**
 * The user's own key. The provider clients must not retry either (the queue owns retries),
 * and the key is passed only to the client, never logged.
 */
function ownModel(choice: Extract<ModelChoice, { source: 'own' }>): ModelSource {
  const { provider, modelId, apiKey } = choice;
  const clientConfig = { maxRetries: 0, timeout: PROVIDER_REQUEST_TIMEOUT_MS };
  const create = ({ maxTokens }: { maxTokens: number }): Model => {
    switch (provider) {
      case 'openai':
        return new OpenAIModel({ api: 'chat', modelId, apiKey, maxTokens, clientConfig });
      case 'anthropic':
        return new AnthropicModel({ modelId, apiKey, maxTokens, clientConfig });
      default:
        throw new Error(`unknown provider: ${String(provider)}`);
    }
  };
  return { keySource: 'own', provider, modelId, create };
}
