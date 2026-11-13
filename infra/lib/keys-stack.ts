import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { Key } from 'aws-cdk-lib/aws-kms';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { CellId } from '../config/cells.js';
import type { StageName } from '../config/stages.js';

/**
 * T08b2 (decision 0009): the KMS key that encrypts users' own AI keys, one per cell.
 *
 * It lives in its own stack, apart from the cell stack, and is kept when the stack is
 * deleted: deleting or replacing a cell stack must never make stored keys unreadable.
 * Personal and per-PR stacks use the shared dev key (never one each: a key costs $1 a
 * month and waits at least 7 days before deletion).
 */
export interface KeysStackProps extends StackProps {
  readonly stage: StageName;
  readonly cell: CellId;
}

/** Where a cell's key ARN is published; cell stacks read it at deploy time. */
export function aiKeysKeyParameter(stage: StageName, cell: CellId): string {
  return `/jobdeputy/${stage}-${cell}/ai-keys-kms-key-arn`;
}

export class KeysStack extends Stack {
  readonly key: Key;

  constructor(scope: Construct, id: string, props: KeysStackProps) {
    super(scope, id, props);
    this.key = new Key(this, 'AiKeysKey', {
      alias: `alias/jobdeputy-${props.stage}-${props.cell}-ai-keys`,
      description: 'Encrypts users’ own AI keys (ai-keys table). Decision 0009.',
      enableKeyRotation: true,
      // The key policy only delegates to IAM: the cell stack grants encrypt to the key API
      // and decrypt to the LLM workers, each with the encryption context required.
      removalPolicy: RemovalPolicy.RETAIN,
      pendingWindow: Duration.days(30),
    });
    new StringParameter(this, 'AiKeysKeyArn', {
      parameterName: aiKeysKeyParameter(props.stage, props.cell),
      description: 'ARN of the KMS key for users’ own AI keys (read by the cell stacks).',
      stringValue: this.key.keyArn,
    });
  }
}
