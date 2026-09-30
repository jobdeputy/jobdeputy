import { z } from 'zod';

/**
 * The pinned platform model (decision 0010), called in the user's Region. The cost guardrails
 * (infra/bootstrap/policies/cost-guardrails.json) and every IAM grant allow only this one.
 */
export const PLATFORM_MODEL_ID = 'mistral.ministral-3-14b-instruct';

/** The foundation-model ARN of the platform model in a Region. */
export function platformModelArn(region: string): string {
  return `arn:aws:bedrock:${region}::foundation-model/${PLATFORM_MODEL_ID}`;
}

// T08b2 (decision 0009): the user's own keys.

/** Providers a user can bring a key for. Google and Bedrock API keys come later. */
export const AI_PROVIDERS = ['openai', 'anthropic'] as const;
/**
 * Dev stacks only (never prod): a pretend provider for integration tests. It makes no call:
 * a key ending in `-valid` passes, any other key fails.
 */
export const TEST_AI_PROVIDER = 'stub';
export type AiProvider = (typeof AI_PROVIDERS)[number] | typeof TEST_AI_PROVIDER;

/** Where an AI run's model comes from: the platform model or one of the user's keys. */
export type AiSource = 'platform' | AiProvider;

export const AI_KEY_STATUSES = ['checking', 'valid', 'invalid'] as const;
export type AiKeyStatus = (typeof AI_KEY_STATUSES)[number];

/** Why a key is `invalid`, as shown to the user. */
export const AI_KEY_ERRORS = {
  rejected: 'The provider rejected this key. Check it, or create a new one.',
  'model-not-found': 'This key cannot use that model, or the model name is wrong.',
  'no-credit': 'This key has no credit or quota left with the provider.',
  'model-refused': 'The provider refused a test request with this model.',
  'check-failed': 'We could not reach the provider to check this key. Check it again later.',
} as const;
export type AiKeyError = keyof typeof AI_KEY_ERRORS;

/** At most this many key checks (saves and re-checks) per user per UTC day. */
export const KEY_CHECKS_PER_DAY = 5;

const KEY_PREFIX: Record<AiProvider, string> = {
  openai: 'sk-',
  anthropic: 'sk-ant-',
  stub: 'stub-',
};

/** The provider in a path, when it is one this stack accepts. */
export function aiProvider(value: unknown, allowTestProvider: boolean): AiProvider | undefined {
  if ((AI_PROVIDERS as readonly unknown[]).includes(value)) return value as AiProvider;
  return allowTestProvider && value === TEST_AI_PROVIDER ? TEST_AI_PROVIDER : undefined;
}

export const modelId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/, 'Use the model name as the provider writes it');

/** `PUT /me/ai-keys/{provider}`: the key is only accepted with the user's consent. */
export function saveAiKeyInput(provider: AiProvider) {
  return z.strictObject({
    apiKey: z
      .string()
      .min(20)
      .max(300)
      .regex(/^[A-Za-z0-9_-]+$/, 'A key has only letters, digits, - and _')
      .refine((key) => key.startsWith(KEY_PREFIX[provider]), {
        message: `A ${provider} key starts with ${KEY_PREFIX[provider]}`,
      }),
    modelId,
    consent: z.literal(true, {
      error: 'Consent is required: job data is sent to the provider, outside our Region',
    }),
  });
}

export const aiSource = (allowTestProvider: boolean) =>
  z.string().refine((value) => value === 'platform' || aiProvider(value, allowTestProvider), {
    message: `Use platform or one of: ${AI_PROVIDERS.join(', ')}`,
  }) as unknown as z.ZodType<AiSource>;

/** `PUT /me/ai-settings`. */
export const updateAiSettingsInput = (allowTestProvider: boolean) =>
  z.strictObject({
    defaultSource: aiSource(allowTestProvider),
    version: z.number().int().min(0),
  });
