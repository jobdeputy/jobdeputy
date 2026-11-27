import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, chromium } from '@playwright/test';

/** The built Chrome extension (`pnpm build`). */
export const BUILT = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));

/** An unpacked extension's ID: Chrome derives it from the folder's real (resolved) path. */
export function unpackedId(path: string): string {
  const hex = createHash('sha256').update(realpathSync(path)).digest('hex').slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join('');
}

/** Chromium with only this extension loaded, in a profile of its own. */
export async function withExtension(): Promise<{ context: BrowserContext; id: string }> {
  if (!existsSync(BUILT)) throw new Error(`No built extension at ${BUILT}: run \`pnpm build\``);
  const built = realpathSync(BUILT);
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'jd-ext-')), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${built}`, `--load-extension=${built}`],
  });
  return { context, id: unpackedId(built) };
}
