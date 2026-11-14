/**
 * Prints one stage's setup facts as JSON for the stage scripts (06, 07), so they read the
 * same config the CDK app does instead of repeating it:
 *   { "stage", "cells": [{ "cell", "region", "accountVar", "profile" }], "webDomain" }
 * Usage: pnpm exec tsx bootstrap/stage-info.ts <stage>
 */
import { CELLS } from '../config/cells.js';
import { accountEnvVar, isStageName, STAGES } from '../config/stages.js';
import { WEB_SITES } from '../config/web.js';

const stage = process.argv[2];
if (!isStageName(stage)) {
  console.error(`Unknown stage "${stage ?? ''}". Use one of: ${Object.keys(STAGES).join(', ')}.`);
  process.exit(1);
}

console.log(
  JSON.stringify({
    stage,
    cells: STAGES[stage].cells.map((cell) => ({
      cell,
      region: CELLS[cell].region,
      accountVar: accountEnvVar(stage, cell),
      // AWS CLI profile convention: one per workload account (see bootstrap/README.md).
      profile: `jobdeputy-${stage}-${cell}`,
    })),
    webDomain: WEB_SITES[stage]?.domain ?? null,
  }),
);
