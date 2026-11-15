import { createContext, useContext, useMemo } from 'react';
import { appAuth, useAuth } from '../auth/index.ts';
import { readConfig } from '../config.ts';
import { type ApiClient, createApiClient } from './client.ts';
import { createFakeApi } from './fake.ts';

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

/** The test build's in-memory API (`--mode e2e`; the production build leaves it out). */
const testBuildApi =
  import.meta.env.MODE === 'e2e' ? createFakeApi({ user: () => appAuth.currentUser() }) : null;

/**
 * The API client for the screens: the cell's API, with the token of whoever `AuthContext` says is
 * signed in (so a test's own sign-in is the one used), or the in-memory fake in the test build. A
 * tree may provide its own client instead through `ApiContext` (the unit tests do).
 */
export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const provided = useContext(ApiContext);
  const auth = useAuth();
  return useMemo(
    () =>
      provided ??
      testBuildApi ??
      createApiClient({ apiUrl: readApiUrl, accessToken: () => auth.accessToken() }),
    [provided, auth],
  );
}
