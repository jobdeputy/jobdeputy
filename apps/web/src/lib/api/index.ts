import { createContext, useContext } from 'react';
import { appAuth } from '../auth/index.ts';
import { readConfig } from '../config.ts';
import { type ApiClient, createApiClient } from './client.ts';

export {
  type ApiClient,
  ApiError,
  type ApiErrorKind,
  type ApiMethod,
  type FieldError,
} from './client.ts';

/** The cell's API address from /config.json, read once (and again after a failed read). */
let apiUrl: Promise<string | null> | undefined;
function readApiUrl(): Promise<string | null> {
  apiUrl ??= readConfig()
    .then((config) => config?.apiUrl ?? null)
    .catch((error: unknown) => {
      apiUrl = undefined;
      throw error;
    });
  return apiUrl;
}

/**
 * The app's API client: the cell's API, with the signed-in person's token. Screens read it
 * through `useApi`, so unit tests (and, later, the test build) can provide their own.
 */
export const appApi: ApiClient = createApiClient({
  apiUrl: () => readApiUrl().catch(() => null),
  accessToken: () => appAuth.accessToken(),
});

export const ApiContext = createContext<ApiClient>(appApi);

export function useApi(): ApiClient {
  return useContext(ApiContext);
}
