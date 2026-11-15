import { createContext, useContext, useMemo } from 'react';
import { useAuth } from '../auth/index.ts';
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
 * The API client for the screens: the cell's API, with the token of whoever `AuthContext` says is
 * signed in (so a test's own sign-in is the one used). A tree may provide its own client instead
 * through `ApiContext` (the unit tests do).
 */
export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const provided = useContext(ApiContext);
  const auth = useAuth();
  return useMemo(
    () =>
      provided ?? createApiClient({ apiUrl: readApiUrl, accessToken: () => auth.accessToken() }),
    [provided, auth],
  );
}
