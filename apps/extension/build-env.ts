import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * #54: the variables a production Chrome build of the extension sees, read the way WXT reads
 * them: its `.env*` files in its order (later wins), then the process's own variables, which WXT
 * never overrides. (WXT also expands `${VAR}` inside values; our settings never use that.) The
 * browser tests and `scripts/check-extension-manifest.mjs` use it to know the
 * settings the build was made with.
 */
const FILES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local',
  '.env.chrome',
  '.env.chrome.local',
  '.env.production.chrome',
  '.env.production.chrome.local',
];

export function buildEnv(): Record<string, string | undefined> {
  const fromFiles = FILES.map((name) => new URL(name, import.meta.url))
    .filter((file) => existsSync(file))
    .map((file) => parseEnv(readFileSync(file, 'utf8')));
  return Object.assign({}, ...fromFiles, process.env);
}
