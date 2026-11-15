import { createContext, useContext } from 'react';
import { amplifyAuth } from './amplify.ts';
import { createFakeAuth } from './fake.ts';
import type { Auth } from './types.ts';

export { type Auth, AuthError, type AuthErrorKind } from './types.ts';

/**
 * The app's authentication: Cognito through Amplify, or the in-memory fake in the test build only
 * (`--mode e2e`; the production build leaves the fake out). Screens read it through `useAuth`, so
 * unit tests can provide their own.
 */
export const appAuth: Auth = import.meta.env.MODE === 'e2e' ? createFakeAuth() : amplifyAuth;

export const AuthContext = createContext<Auth>(appAuth);

export function useAuth(): Auth {
  return useContext(AuthContext);
}
