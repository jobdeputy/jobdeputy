import type { StageName } from './stages.js';

/**
 * Where each stage's web app is served (decision 0011). The zone for `domain` lives in
 * the stage's own account and is delegated once from the jobdeputy.com zone in the
 * management account (infra/bootstrap/05-delegate-web-zone.sh).
 *
 * Prod has no entry yet: its address is decided at launch.
 */
export interface WebSite {
  readonly domain: string;
}

export const WEB_SITES: Partial<Record<StageName, WebSite>> = {
  dev: { domain: 'dev.jobdeputy.com' },
};

/** The built web app (`pnpm --filter @jobdeputy/web build`), relative to the repo root. */
export const WEB_DIST_DIR = 'apps/web/dist';
