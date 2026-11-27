import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSION_DEV_IDS } from '@jobdeputy/shared/extension';
import { EXTENSION_DEV_KEY } from '@jobdeputy/shared/extension-key';
import { type BrowserContext, chromium } from '@playwright/test';

/** The built Chrome extension (`pnpm build`). */
export const BUILT = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));

/** An unpacked extension's ID: Chrome derives it from the folder's real (resolved) path. */
export function unpackedId(path: string): string {
  const hex = createHash('sha256').update(realpathSync(path)).digest('hex').slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join('');
}

/**
 * Chromium with only this extension loaded, in a profile of its own; `close` ends it and deletes
 * the profile. Tests the build in `.output` (`pnpm test:e2e` builds first; CI tests the build it
 * zips).
 */
export async function withExtension(): Promise<{
  context: BrowserContext;
  id: string;
  close: () => Promise<void>;
}> {
  if (!existsSync(BUILT)) throw new Error(`No built extension at ${BUILT}: run \`pnpm build\``);
  const built = realpathSync(BUILT);
  const profile = mkdtempSync(join(tmpdir(), 'jd-ext-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${built}`, `--load-extension=${built}`],
  });
  const close = async () => {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  };
  // A dev build carries the public key that fixes its ID (#54); a store build is unpacked by path.
  const { key } = JSON.parse(readFileSync(join(built, 'manifest.json'), 'utf8')) as {
    key?: string;
  };
  const id = key === EXTENSION_DEV_KEY ? (EXTENSION_DEV_IDS[0] ?? '') : unpackedId(built);
  return { context, id, close };
}
