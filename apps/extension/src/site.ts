import type { Settings } from './settings.ts';

// Kept apart from manifest.ts, which reads the dev key from a file (Node only): the service
// worker checks senders against the same origins.

/**
 * Vite's dev server, where a personal stack's web app runs: the shared `LOCAL_WEB_ORIGIN` (a test
 * holds them equal). Written here, as `scripts/check-extension-manifest.mjs` loads this file in
 * plain Node, which can't follow the shared package's imports.
 */
export const LOCAL_WEB_ORIGIN = 'http://localhost:5173';
/**
 * #54 PR D (decision 0020): the only pages that may message the extension (`hello`, `auto-apply`):
 * the web app's origin, set when it's built, and in a dev build also Vite's dev server
 * (`LOCAL_WEB_ORIGIN`), where a personal stack's web app runs. None without sign-in settings
 * (nothing to answer). No other site can reach the worker, and it adds no permission warning.
 */
export function siteOrigins(settings: Settings | null, { store = false } = {}): string[] {
  if (!settings) return [];
  const origins = settings.siteUrl ? [new URL(settings.siteUrl).origin] : [];
  if (!store && !origins.includes(LOCAL_WEB_ORIGIN)) origins.push(LOCAL_WEB_ORIGIN);
  return origins;
}
