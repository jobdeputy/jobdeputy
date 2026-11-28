// #54: writes the extension's build settings (apps/extension/.env.local, git-ignored) from a dev
// stack's outputs, so `pnpm --filter @jobdeputy/extension build` signs in to that stack.
//   node scripts/extension-config.mjs jobdeputy-dev-nava-iad [--profile jobdeputy-dev-iad] [--site https://dev.jobdeputy.com]
// Only dev stacks trust the dev build's ID (packages/shared/src/extension.ts).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [stack, ...rest] = process.argv.slice(2);
const option = (name) => {
  const at = rest.indexOf(name);
  return at >= 0 ? rest[at + 1] : undefined;
};
if (!stack || !/^jobdeputy-dev-[a-z0-9-]+$/.test(stack)) {
  console.error(
    'Usage: node scripts/extension-config.mjs jobdeputy-dev-<owner>-iad [--profile p] [--site url]',
  );
  process.exit(1);
}
const profile = option('--profile') ?? 'jobdeputy-dev-iad';
const outputs = JSON.parse(
  execFileSync(
    'aws',
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      stack,
      '--profile',
      profile,
      '--region',
      'us-east-1',
      '--query',
      'Stacks[0].Outputs',
      '--output',
      'json',
    ],
    { encoding: 'utf8' },
  ),
);
const output = (key) => outputs.find((o) => o.OutputKey === key)?.OutputValue;
const values = {
  WXT_API_URL: output('ApiUrl')?.replace(/\/+$/, ''),
  WXT_AUTH_DOMAIN: output('AuthDomain'),
  WXT_CLIENT_ID: output('ExtensionClientId'),
  WXT_SITE_URL: option('--site'),
};
const missing = ['WXT_API_URL', 'WXT_AUTH_DOMAIN', 'WXT_CLIENT_ID'].filter((key) => !values[key]);
if (missing.length > 0) {
  console.error(`${stack} has no ${missing.join(', ')} output: deploy it with #54 PR B first`);
  process.exit(1);
}
const file = new URL('../apps/extension/.env.local', import.meta.url);
writeFileSync(
  file,
  `${Object.entries(values)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`,
);
console.log(`Wrote ${file.pathname} for ${stack}`);
