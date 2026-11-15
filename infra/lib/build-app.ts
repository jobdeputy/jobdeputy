import { existsSync } from 'node:fs';
import {
  App,
  type AppProps,
  CliCredentialsStackSynthesizer,
  type IStackSynthesizer,
} from 'aws-cdk-lib';
import { CELLS } from '../config/cells.js';
import { accountEnvVar, isStageName, STAGES, type StageName } from '../config/stages.js';
import { WEB_SITES } from '../config/web.js';
import { CellStack } from './cell-stack.js';
import { KeysStack } from './keys-stack.js';
import { WebDnsStack } from './web-dns-stack.js';
import { WebStack } from './web-stack.js';

export interface BuildAppOptions {
  readonly stage: StageName;
  /** Personal dev stack owner; only allowed with the dev stage. */
  readonly owner?: string;
  /** Source of account IDs and JD_ALERT_EMAIL; defaults to process.env. */
  readonly env?: Record<string, string | undefined>;
  readonly appProps?: AppProps;
  /** Existing app to add stacks to (the CLI entry point passes its own). */
  readonly app?: App;
  /**
   * Deploy with the caller's own credentials instead of CDK's bootstrap roles.
   * Used for PR stacks, whose CI role may only touch `jobdeputy-dev-pr*` stacks
   * (T11). The caller passes the CDK execution role with `cdk deploy --role-arn`.
   */
  readonly cliCredentials?: boolean;
  /**
   * The built web app, uploaded by the stage's web stack (decision 0011). Must exist when
   * given; left out (unit tests) the web stack is built without uploading anything.
   */
  readonly webContentDir?: string;
}

const OWNER_PATTERN = /^[a-z][a-z0-9-]{1,15}$/;

export function buildApp(options: BuildAppOptions): App {
  const { stage, owner } = options;
  const env = options.env ?? process.env;

  if (options.cliCredentials && owner === undefined) {
    throw new Error('cliCredentials is only for personal or PR stacks (set an owner).');
  }
  if (owner !== undefined) {
    if (stage !== 'dev') throw new Error('Personal stacks are only allowed in the dev stage.');
    if (!OWNER_PATTERN.test(owner)) {
      throw new Error(`Invalid owner "${owner}": use lowercase letters, digits, and dashes.`);
    }
  }

  const app = options.app ?? new App(options.appProps);
  let usCell: CellStack | undefined;
  for (const cell of STAGES[stage].cells) {
    const account = env[accountEnvVar(stage, cell)];
    const id = owner ? `jobdeputy-${stage}-${owner}-${cell}` : `jobdeputy-${stage}-${cell}`;
    const stackEnv = { region: CELLS[cell].region, ...(account ? { account } : {}) };
    // T08b2: the cell's KMS key, in its own stack. Personal and PR stacks use the shared one.
    const keys = owner
      ? undefined
      : new KeysStack(app, `jobdeputy-${stage}-${cell}-keys`, {
          stage,
          cell,
          env: stackEnv,
          crossRegionReferences: false,
        });
    const cellStack: CellStack = new CellStack(app, id, {
      stage,
      cell,
      ...(owner ? { owner } : {}),
      alertEmails: parseAlertEmails(env.JD_ALERT_EMAIL),
      env: stackEnv,
      // Decision 0004: never share values across Regions.
      crossRegionReferences: false,
      ...(options.cliCredentials ? { synthesizer: cliSynthesizer() } : {}),
    });
    // The cell reads the key's ARN from SSM at deploy time, so the key must exist first.
    if (keys) cellStack.addDependency(keys);
    // The web app signs people in to the US cell (US-only launch; the site is in its account).
    if (cell === 'iad') usCell = cellStack;
  }
  if (!owner) addWebStacks(app, stage, env, options.webContentDir, usCell);
  return app;
}

/**
 * Decision 0011: the stage's web app, served by CloudFront from the US cell's account
 * (CloudFront's certificate must be in us-east-1). Shared stacks only: personal and PR
 * stacks have no web app.
 */
function addWebStacks(
  app: App,
  stage: StageName,
  env: Record<string, string | undefined>,
  contentDir: string | undefined,
  usCell: CellStack | undefined,
): void {
  const site = WEB_SITES[stage];
  if (!site) return;
  if (contentDir !== undefined && !existsSync(contentDir)) {
    throw new Error(
      `The web app is not built (${contentDir} is missing): run pnpm --filter @jobdeputy/web build.`,
    );
  }
  const account = env[accountEnvVar(stage, 'iad')];
  const stackEnv = { region: CELLS.iad.region, ...(account ? { account } : {}) };
  const dns = new WebDnsStack(app, `jobdeputy-${stage}-web-dns`, {
    domain: site.domain,
    env: stackEnv,
  });
  new WebStack(app, `jobdeputy-${stage}-web`, {
    domain: site.domain,
    zone: dns.zone,
    env: stackEnv,
    ...(contentDir !== undefined ? { contentDir } : {}),
    ...(usCell ? { signIn: usCell.webSignIn } : {}),
  });
}

// Cast: the class's optional getters do not satisfy exactOptionalPropertyTypes.
function cliSynthesizer(): IStackSynthesizer {
  return new CliCredentialsStackSynthesizer() as unknown as IStackSynthesizer;
}

export function stageFromContext(value: unknown): StageName {
  const stage = value ?? 'dev';
  if (!isStageName(stage)) throw new Error(`Unknown stage "${String(stage)}". Use dev or prod.`);
  return stage;
}

const EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
/** At most this many alarm recipients per cell (each must confirm by email). */
export const MAX_ALERT_EMAILS = 5;

/** Parses JD_ALERT_EMAIL: one address, or several separated by commas. */
export function parseAlertEmails(value: string | undefined): string[] {
  const emails = (value ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  const invalid = emails.filter((e) => !EMAIL_PATTERN.test(e));
  if (invalid.length > 0)
    throw new Error(`JD_ALERT_EMAIL has ${invalid.length} invalid address(es).`);
  if (emails.length > MAX_ALERT_EMAILS) {
    throw new Error(`JD_ALERT_EMAIL allows at most ${MAX_ALERT_EMAILS} addresses.`);
  }
  return [...new Set(emails)];
}
