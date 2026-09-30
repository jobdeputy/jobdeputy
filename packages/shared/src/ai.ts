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

/**
 * Where a crawl's AI work gets its model: the platform model (counted against the free
 * allowance), one of the user's keys, or `none` (the free keyword filter only).
 */
export type AiSource = 'platform' | 'none' | AiProvider;

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
  z
    .string()
    .refine(
      (value) => value === 'platform' || value === 'none' || aiProvider(value, allowTestProvider),
      { message: `Use platform, none, or one of: ${AI_PROVIDERS.join(', ')}` },
    ) as unknown as z.ZodType<AiSource>;

// T08b3 (0009): the free platform allowance counts ISO weeks (Monday 00:00 UTC) and calendar
// months, in UTC.

/** The ISO week of a moment, for example `2026-W40`. */
export function isoWeek(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday); // the Thursday of this week decides its year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The next Monday 00:00 UTC. */
export function nextIsoWeekStart(at: Date): Date {
  const weekday = at.getUTCDay() || 7;
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 8 - weekday));
}

/** The first day of the next month, 00:00 UTC. */
export function nextUtcMonthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}

/** When the next free platform run is available, given which limits are used up. */
export function nextPlatformRunAt(at: Date, weekUsedUp: boolean, monthUsedUp: boolean): Date {
  const week = nextIsoWeekStart(at);
  const month = nextUtcMonthStart(at);
  if (monthUsedUp && weekUsedUp) return week > month ? week : month;
  return monthUsedUp ? month : week;
}

/** `PUT /me/ai-settings`. */
export const updateAiSettingsInput = (allowTestProvider: boolean) =>
  z.strictObject({
    defaultSource: aiSource(allowTestProvider),
    version: z.number().int().min(0),
  });

/** T08b3: the CloudWatch namespace of LLM task metrics (written by packages/llm, read by infra). */
export const LLM_METRICS_NAMESPACE = 'JobDeputy/LLM';
