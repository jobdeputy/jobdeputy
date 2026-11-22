import { DecryptCommand, type KMSClient } from '@aws-sdk/client-kms';
import type { AiKeyRepository } from '@jobdeputy/db';
import { type ModelSource, resolveModel } from '@jobdeputy/llm';
import { type AiSource, aiProvider } from '@jobdeputy/shared';

/** Why an AI source has no model now (shown to the user by the caller). */
export type ModelProblem = 'key_missing' | 'key_invalid';

export interface ModelLoaderDeps {
  keys: Pick<AiKeyRepository, 'get'>;
  kms: Pick<KMSClient, 'send'>;
  region: string;
  /** Dev stacks only: the pretend `stub` provider (T08b2). */
  allowTestProvider: boolean;
  /** The stub provider's model for this worker's tasks (dev stacks only, no outside call). */
  stub: (modelId: string) => ModelSource;
}

/**
 * The model for a run's AI source (T08d, #51): the platform model in this Region, or the
 * user's own key, decrypted only with this user and provider as its KMS context.
 */
export function modelLoader(deps: ModelLoaderDeps) {
  return async (userId: string, source: AiSource): Promise<ModelSource | ModelProblem> => {
    if (source === 'platform') return resolveModel({ source: 'platform', region: deps.region });
    const provider = aiProvider(source, deps.allowTestProvider);
    if (!provider) return 'key_missing';
    const key = await deps.keys.get(userId, provider);
    if (!key) return 'key_missing';
    if (key.status !== 'valid') return 'key_invalid';
    if (provider === 'stub') return deps.stub(key.modelId);
    // KMS refuses unless the context matches the one used to encrypt: this user, this provider.
    const res = await deps.kms.send(
      new DecryptCommand({
        CiphertextBlob: key.ciphertext,
        EncryptionContext: { userId, provider },
      }),
    );
    if (!res.Plaintext) throw new Error('KMS returned no plaintext');
    const apiKey = new TextDecoder().decode(res.Plaintext);
    return resolveModel({ source: 'own', provider, modelId: key.modelId, apiKey });
  };
}
