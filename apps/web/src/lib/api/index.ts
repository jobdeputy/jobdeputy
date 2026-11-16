import { createContext, useContext, useMemo } from 'react';
import { type Auth, useAuth } from '../auth/index.ts';
import { readConfig } from '../config.ts';
import { type ApiClient, createApiClient } from './client.ts';
import { createFakeApi } from './fake.ts';

export {
  type ApiClient,
  ApiError,
  type ApiErrorKind,
  type ApiMethod,
  DEFAULT_RETRY_AFTER_SECONDS,
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
 * The test build's in-memory API (`--mode e2e`; the production build leaves it out): one per
 * sign-in, shared by every screen that uses it, keyed by whoever that sign-in says is signed in.
 */
const testBuildApis = new WeakMap<Auth, ApiClient>();
function testBuildApi(auth: Auth): ApiClient | null {
  if (import.meta.env.MODE !== 'e2e') return null;
  let api = testBuildApis.get(auth);
  if (!api) {
    api = createFakeApi({ user: () => auth.currentUser() });
    testBuildApis.set(auth, api);
  }
  return api;
}

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
      testBuildApi(auth) ??
      createApiClient({ apiUrl: readApiUrl, accessToken: () => auth.accessToken() }),
    [provided, auth],
  );
}
