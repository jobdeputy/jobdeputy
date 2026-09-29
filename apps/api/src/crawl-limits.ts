import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import {
  type CrawlLimitsConfig,
  crawlLimitsConfig,
  createLogger,
  DEFAULT_CRAWL_LIMITS,
} from '@jobdeputy/shared';

const logger = createLogger('crawl-limits');

/** An admin change takes effect within this long, without a deploy (0007). */
export const LIMITS_CACHE_MS = 5 * 60 * 1000;

/**
 * The admin's daily crawl limits (default and maximum), read from SSM Parameter Store
 * and cached. A missing or invalid setting falls back to the built-in defaults and is
 * logged as an error; a failed read is not cached, so the next request tries again.
 */
export function cachedCrawlLimits(
  read: () => Promise<string | undefined>,
  now: () => number = Date.now,
): () => Promise<CrawlLimitsConfig> {
  let cached: { value: CrawlLimitsConfig; at: number } | undefined;
  return async () => {
    if (cached && now() - cached.at < LIMITS_CACHE_MS) return cached.value;
    let raw: string | undefined;
    try {
      raw = await read();
    } catch (error) {
      logger.error('Could not read the crawl limits; using the defaults', {
        error: error as Error,
      });
      return DEFAULT_CRAWL_LIMITS;
    }
    let value = DEFAULT_CRAWL_LIMITS;
    try {
      const parsed = crawlLimitsConfig.safeParse(JSON.parse(raw ?? ''));
      if (parsed.success) value = parsed.data;
      else
        logger.error('Invalid crawl limits setting; using the defaults', {
          issues: parsed.error.issues,
        });
    } catch {
      logger.error('Crawl limits setting is not JSON; using the defaults');
    }
    cached = { value, at: now() };
    return value;
  };
}

export function ssmCrawlLimits(parameterName: string): () => Promise<CrawlLimitsConfig> {
  const ssm = new SSMClient({});
  return cachedCrawlLimits(async () => {
    const res = await ssm.send(new GetParameterCommand({ Name: parameterName }));
    return res.Parameter?.Value;
  });
}
