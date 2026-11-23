import type { CrawlSettingsRepository } from '@jobdeputy/db';
import { type CrawlLimitsConfig, createLogger, effectiveCompanyJobsLimit } from '@jobdeputy/shared';

const logger = createLogger('api-company-jobs-limit');

/**
 * The jobs shown per company for a user now (#49): their own choice within the admin's
 * maximum. If their setting can't be read, the admin's default applies (as the admin limits
 * fall back to the built-in ones), rather than failing the request. Shared by the jobs and
 * tailoring APIs (#51), so a résumé is tailored for exactly the jobs the user sees.
 */
export function companyJobsLimit(deps: {
  limits: () => Promise<CrawlLimitsConfig>;
  settings: Pick<CrawlSettingsRepository, 'get'>;
}) {
  return async (userId: string): Promise<number> => {
    const [config, settings] = await Promise.all([
      deps.limits(),
      deps.settings.get(userId).catch((error: unknown) => {
        logger.warn('Could not read the crawl settings; using the default', {
          error: error as Error,
        });
        return undefined;
      }),
    ]);
    return effectiveCompanyJobsLimit(config, settings?.companyJobsLimit);
  };
}
