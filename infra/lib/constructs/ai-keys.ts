import { Duration, type RemovalPolicy } from 'aws-cdk-lib';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import type { CellId } from '../../config/cells.js';
import type { StageName } from '../../config/stages.js';
import { aiKeysKeyParameter } from '../keys-stack.js';
import { AsyncPipeline } from './async-pipeline.js';
import { AppFunction } from './node-function.js';

export interface AiKeysProps {
  readonly namePrefix: string;
  readonly stage: StageName;
  readonly cell: CellId;
  /** The `ai-keys` user table (with a NEW_IMAGE stream), created with the other user tables. */
  readonly table: Table;
  readonly usageTable: Table;
  readonly preferencesTable: Table;
  readonly auditTable: Table;
  readonly usersTable: Table;
  readonly removalPolicy: RemovalPolicy;
  readonly maxReceives: number;
  readonly alarmTopic?: ITopic | undefined;
}

/** KMS may only be used with both parts of the encryption context: this user and provider. */
export const ENCRYPTION_CONTEXT_KEYS = ['userId', 'provider'];

/**
 * T08b2 (decision 0009): the user's own AI keys.
 * - `AiApi`: `/me/ai-keys` and `/me/ai-settings`; the only function that may encrypt.
 * - ai-keys (status `checking`) → stream → Pipe → queue → `KeyCheckWorker`, the only
 *   function (until the T08d workers) that may decrypt.
 * The KMS key comes from the cell's keys stack (its ARN in SSM), shared by personal and
 * PR stacks in dev.
 */
export class AiKeys extends Construct {
  readonly api: AppFunction;
  readonly worker: AppFunction;
  readonly keyArn: string;
  /** For other functions that read the table (the crawls API checks a chosen key). */
  readonly env: Record<string, string>;

  constructor(scope: Construct, id: string, props: AiKeysProps) {
    super(scope, id);
    this.keyArn = StringParameter.valueForStringParameter(
      this,
      aiKeysKeyParameter(props.stage, props.cell),
    );
    this.env = {
      AI_KEYS_TABLE_NAME: props.table.tableName,
      // Dev stacks only: the pretend `stub` provider for integration tests.
      ALLOW_TEST_AI_PROVIDER: props.stage === 'dev' ? 'true' : 'false',
    };
    const tablesEnv = {
      ...this.env,
      USAGE_TABLE_NAME: props.usageTable.tableName,
      PREFERENCES_TABLE_NAME: props.preferencesTable.tableName,
      AUDIT_TABLE_NAME: props.auditTable.tableName,
      USERS_TABLE_NAME: props.usersTable.tableName,
    };

    this.api = new AppFunction(this, 'AiApi', {
      entry: 'apps/api/src/ai.ts',
      timeout: Duration.seconds(10),
      removalPolicy: props.removalPolicy,
      environment: { ...tablesEnv, AI_KEYS_KMS_KEY_ARN: this.keyArn },
    });
    // Save and re-check (UpdateItem), delete, list; a default needs a usable key (ConditionCheckItem).
    props.table.grant(
      this.api.fn,
      'dynamodb:GetItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
      'dynamodb:ConditionCheckItem',
    );
    // The daily check counter, counted in the same transaction.
    props.usageTable.grant(this.api.fn, 'dynamodb:UpdateItem', 'dynamodb:GetItem');
    // AI_SETTINGS: saved with its version; reset (or checked) when its key is deleted.
    props.preferencesTable.grant(
      this.api.fn,
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:ConditionCheckItem',
    );
    props.auditTable.grant(this.api.fn, 'dynamodb:PutItem');
    props.usersTable.grant(this.api.fn, 'dynamodb:GetItem');
    this.api.fn.addToRolePolicy(this.kmsStatement('kms:Encrypt'));

    this.worker = new AppFunction(this, 'KeyCheckWorker', {
      entry: 'apps/worker/src/key-check-worker.ts',
      timeout: Duration.seconds(30),
      removalPolicy: props.removalPolicy,
      environment: tablesEnv,
    });
    props.table.grant(this.worker.fn, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    props.auditTable.grant(this.worker.fn, 'dynamodb:PutItem');
    props.usersTable.grant(this.worker.fn, 'dynamodb:GetItem');
    this.worker.fn.addToRolePolicy(this.kmsStatement('kms:Decrypt'));

    new AsyncPipeline(this, 'KeyCheckPipeline', {
      table: props.table,
      idAttribute: 'provider',
      messageKeys: ['userId', 'provider'],
      startWhen: { eventNames: ['INSERT', 'MODIFY'], status: 'checking' },
      worker: this.worker.fn,
      workerTimeout: Duration.seconds(30),
      maxReceives: props.maxReceives,
      maxConcurrency: 2,
      // The dead-letter alarm only: the 10 free alarms are all used (0005). A stuck check
      // stays visible to the user as `checking`, and they can check again.
      alarmTopic: props.alarmTopic,
      queueName: `${props.namePrefix}-key-checks`,
    });
  }

  /** One KMS action on the cell's key, only with the user and provider as encryption context. */
  private kmsStatement(action: 'kms:Encrypt' | 'kms:Decrypt'): PolicyStatement {
    return new PolicyStatement({
      actions: [action],
      resources: [this.keyArn],
      conditions: {
        'ForAllValues:StringEquals': { 'kms:EncryptionContextKeys': ENCRYPTION_CONTEXT_KEYS },
        Null: {
          'kms:EncryptionContext:userId': 'false',
          'kms:EncryptionContext:provider': 'false',
        },
      },
    });
  }
}
