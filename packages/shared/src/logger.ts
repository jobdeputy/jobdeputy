import { Logger } from '@aws-lambda-powertools/logger';

/**
 * Structured JSON logger. The level comes from POWERTOOLS_LOG_LEVEL (INFO by
 * default, decision 0005). Never log request bodies, credentials, or personal data.
 */
export function createLogger(serviceName: string): Logger {
  return new Logger({ serviceName });
}
