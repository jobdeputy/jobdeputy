import { readFileSync } from 'node:fs';
import { platformModelArn } from '@jobdeputy/shared';
import { describe, expect, it } from 'vitest';

interface Statement {
  Sid: string;
  Effect: string;
  Action?: string | string[];
  NotAction?: string | string[];
  Resource?: string | string[];
  NotResource?: string | string[];
}

const policy = JSON.parse(
  readFileSync(new URL('../bootstrap/policies/cost-guardrails.json', import.meta.url), 'utf8'),
) as { Statement: Statement[] };
const bySid = (sid: string) => policy.Statement.find((s) => s.Sid === sid);

// Decision 0010: the pinned platform model, in the three cell Regions.
const platformModel = ['us-east-1', 'ap-south-1', 'eu-west-2'].map((r) => platformModelArn(r));

describe('cost guardrails SCP (decisions 0005, 0010)', () => {
  it('has only deny statements', () => {
    expect(policy.Statement.every((s) => s.Effect === 'Deny')).toBe(true);
  });

  it('denies all of Bedrock except the pinned platform model', () => {
    expect(bySid('DenyBedrockExceptPlatformModel')).toEqual({
      Sid: 'DenyBedrockExceptPlatformModel',
      Effect: 'Deny',
      Action: 'bedrock:*',
      NotResource: platformModel,
    });
  });

  it('allows only InvokeModel on the pinned platform model', () => {
    expect(bySid('OnlyInvokePlatformModel')).toEqual({
      Sid: 'OnlyInvokePlatformModel',
      Effect: 'Deny',
      NotAction: 'bedrock:InvokeModel',
      Resource: platformModel,
    });
  });

  it('allows exactly the 0009 and 0010 exceptions and keeps the rest denied', () => {
    const actions = bySid('DenyCostlyServicesUntilLaunch')?.Action as string[];
    expect(actions).not.toContain('kms:CreateKey');
    expect(actions.some((a) => a.startsWith('bedrock:'))).toBe(false);
    for (const a of [
      'aws-marketplace:Subscribe',
      'sagemaker:Create*',
      'ec2:RunInstances',
      'lambda:PutProvisionedConcurrencyConfig',
    ]) {
      expect(actions).toContain(a);
    }
  });
});
