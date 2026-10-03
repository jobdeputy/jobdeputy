import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export interface AppFunctionProps {
  /** Path from the repo root, for example `apps/api/src/ping-jobs.ts`. */
  readonly entry: string;
  readonly timeout: Duration;
  readonly memorySize?: number;
  readonly environment?: Record<string, string>;
  readonly removalPolicy: RemovalPolicy;
}

/** Node 22 on ARM64, bundled with esbuild, logs kept 14 days (decision 0005). */
export class AppFunction extends Construct {
  readonly fn: NodejsFunction;
  readonly logGroup: LogGroup;

  constructor(scope: Construct, id: string, props: AppFunctionProps) {
    super(scope, id);
    this.logGroup = new LogGroup(this, 'Logs', {
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy: props.removalPolicy,
    });
    this.fn = new NodejsFunction(this, 'Fn', {
      entry: join(REPO_ROOT, props.entry),
      projectRoot: REPO_ROOT,
      depsLockFilePath: join(REPO_ROOT, 'pnpm-lock.yaml'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: props.memorySize ?? 256,
      timeout: props.timeout,
      logGroup: this.logGroup,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        POWERTOOLS_LOG_LEVEL: 'INFO',
        ...props.environment,
      },
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        sourceMap: true,
        minify: true,
        // The AWS SDK v3 ships with the Lambda runtime.
        externalModules: ['@aws-sdk/*'],
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });
  }
}
