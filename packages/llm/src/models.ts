import { PLATFORM_MODEL_ID } from '@jobdeputy/shared';
import type { Model } from '@strands-agents/sdk';
import { BedrockModel } from '@strands-agents/sdk/models/bedrock';

export { PLATFORM_MODEL_ID };

/** Cell Regions (decision 0004): the platform model is always called in the user's Region. */
export const CELL_REGIONS = ['us-east-1', 'ap-south-1', 'eu-west-2'] as const;
export type CellRegion = (typeof CELL_REGIONS)[number];

export type KeySource = 'platform' | 'own';

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

export type ModelChoice = { source: 'platform'; region: string };

/** The model for a run (decision 0009). T08b2 adds the user's own OpenAI and Anthropic keys. */
export function resolveModel(choice: ModelChoice): ModelSource {
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
