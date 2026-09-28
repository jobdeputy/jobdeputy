import { App, type AppProps } from 'aws-cdk-lib';
import { CELLS } from '../config/cells.js';
import { accountEnvVar, isStageName, STAGES, type StageName } from '../config/stages.js';
import { CellStack } from './cell-stack.js';

export interface BuildAppOptions {
  readonly stage: StageName;
  /** Personal dev stack owner; only allowed with the dev stage. */
  readonly owner?: string;
  /** Source of account IDs and JD_ALERT_EMAIL; defaults to process.env. */
  readonly env?: Record<string, string | undefined>;
  readonly appProps?: AppProps;
  /** Existing app to add stacks to (the CLI entry point passes its own). */
  readonly app?: App;
}

const OWNER_PATTERN = /^[a-z][a-z0-9-]{1,15}$/;

export function buildApp(options: BuildAppOptions): App {
  const { stage, owner } = options;
  const env = options.env ?? process.env;

  if (owner !== undefined) {
    if (stage !== 'dev') throw new Error('Personal stacks are only allowed in the dev stage.');
    if (!OWNER_PATTERN.test(owner)) {
      throw new Error(`Invalid owner "${owner}": use lowercase letters, digits, and dashes.`);
    }
  }

  const app = options.app ?? new App(options.appProps);
  for (const cell of STAGES[stage].cells) {
    const account = env[accountEnvVar(stage, cell)];
    const id = owner ? `jobdeputy-${stage}-${owner}-${cell}` : `jobdeputy-${stage}-${cell}`;
    new CellStack(app, id, {
      stage,
      cell,
      ...(owner ? { owner } : {}),
      ...(env.JD_ALERT_EMAIL ? { alertEmail: env.JD_ALERT_EMAIL } : {}),
      env: { region: CELLS[cell].region, ...(account ? { account } : {}) },
      // Decision 0004: never share values across Regions.
      crossRegionReferences: false,
    });
  }
  return app;
}

export function stageFromContext(value: unknown): StageName {
  const stage = value ?? 'dev';
  if (!isStageName(stage)) throw new Error(`Unknown stage "${String(stage)}". Use dev or prod.`);
  return stage;
}
