/**
 * The pinned platform model (decision 0010), called in the user's Region. The cost guardrails
 * (infra/bootstrap/policies/cost-guardrails.json) and every IAM grant allow only this one.
 */
export const PLATFORM_MODEL_ID = 'mistral.ministral-3-14b-instruct';

/** The foundation-model ARN of the platform model in a Region. */
export function platformModelArn(region: string): string {
  return `arn:aws:bedrock:${region}::foundation-model/${PLATFORM_MODEL_ID}`;
}
