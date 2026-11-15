import { AuthError } from './auth/types.ts';

/**
 * The deployed app's config (/config.json, written by the web stack from the site's cell): the
 * Cognito pool and client people sign in to, and the cell's API (#14, #33).
 */
export interface Config {
  readonly userPoolId: string;
  readonly userPoolClientId: string;
  /** The cell's API, without a trailing slash (its paths start with one). */
  readonly apiUrl?: string;
}

const CONFIG_URL = '/config.json';

/**
 * The deployed app's config, or null where there is none: a 404, or the app's own page, which the
 * site sends for any unknown path (CloudFront, Vite). Anything else that is not the config is a
 * connection problem (`offline`): a server or rate-limit error, or a page from wifi that asks you
 * to sign in to it first.
 */
export async function readConfig(): Promise<Config | null> {
  const response = await fetch(CONFIG_URL, {
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new AuthError('offline');
  const body = await response.text();
  const config = parseJson(body) as Partial<Record<keyof Config, unknown>> | null;
  if (typeof config?.userPoolId === 'string' && typeof config.userPoolClientId === 'string') {
    return {
      userPoolId: config.userPoolId,
      userPoolClientId: config.userPoolClientId,
      ...(typeof config.apiUrl === 'string' ? { apiUrl: config.apiUrl } : {}),
    };
  }
  // The deploy writes the config whole, so anything else is not ours: the app's own page means
  // there is none here; another answer came from something on the way.
  if (body.includes(APP_PAGE_MARK)) return null;
  throw new AuthError('offline');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Only the app's own page (index.html) has the boot loader. */
const APP_PAGE_MARK = 'id="boot-loader"';
