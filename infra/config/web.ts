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
  /**
   * #111: the site's cell also serves managed login at `signInDomainName` (decision 0021). Set it
   * only once the site's own address resolves (its web stack is deployed): Cognito refuses a custom
   * domain whose parent has no record, so a stage's first deploy (or a rebuild) passes
   * `-c signInDomain=off`.
   */
  readonly signInDomain?: boolean;
}

/**
 * #111 (decision 0021): managed login's own address for the site's cell, in the site's zone, so
 * the web app and the extension sign in on one page and share its session.
 */
export function signInDomainName(site: WebSite): string {
  return `auth.${site.domain}`;
}

export const WEB_SITES: Partial<Record<StageName, WebSite>> = {
  dev: { domain: 'dev.jobdeputy.com', signInDomain: true },
};

/** The built web app (`pnpm --filter @jobdeputy/web build`), relative to the repo root. */
export const WEB_DIST_DIR = 'apps/web/dist';
