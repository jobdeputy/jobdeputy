import { EXTENSION_DEV_KEY } from '@jobdeputy/shared/extension-key';
import { GREENHOUSE_MATCHES } from './fill/posting.ts';
import type { Settings } from './settings.ts';

/**
 * #54 (decision 0020): the extension's manifest, kept here so a test can hold it to least
 * privilege. It asks only for what a shipped feature uses. Sign-in (PR B) needs `identity`
 * (managed login in a window of its own) and `storage` (the session, `storage.session` only), and
 * the API's own origin, set when it's built. Managed login answers the extension's origin itself
 * (CORS), so it needs no host. The Greenhouse filler (PR C) adds the documents' download origin
 * (set when it's built, like the API's) and `job-boards.greenhouse.io`. Every later
 * job site is an optional host, asked for when first needed; its content script is registered at
 * runtime once granted, never listed in the manifest (a host a static content script matches is
 * granted at install).
 */
export const PERMISSIONS: readonly string[] = ['identity', 'storage'];

/** The permissions a build asks for: sign-in's only when it can sign in. */
export function permissions(settings: Settings | null): string[] {
  return settings ? [...PERMISSIONS] : [];
}
export const OPTIONAL_PERMISSIONS: readonly string[] = [];
export const OPTIONAL_HOST_PERMISSIONS: readonly string[] = [];

/**
 * The hosts granted at install: the Greenhouse forms (PR C); and, when the build can sign in,
 * the API's origin and the origin of the documents' download links, which answer only the web
 * app's origin (CORS).
 */
export function hostPermissions(settings: Settings | null): string[] {
  if (!settings) return [...GREENHOUSE_MATCHES];
  return [
    `${new URL(settings.apiUrl).origin}/*`,
    `${settings.filesOrigin}/*`,
    ...GREENHOUSE_MATCHES,
  ];
}

/**
 * The manifest for a build. `key` fixes the extension's ID (and so its sign-in return address)
 * for unpacked builds; a store build leaves it out, as the store gives the item its own ID.
 */
export function manifestFor(settings: Settings | null, { store = false } = {}) {
  return {
    name: 'JobDeputy',
    description: 'Fills job applications with your saved answers. You review and submit.',
    ...(store ? {} : { key: EXTENSION_DEV_KEY }),
    permissions: permissions(settings),
    host_permissions: hostPermissions(settings),
    optional_permissions: [...OPTIONAL_PERMISSIONS],
    optional_host_permissions: [...OPTIONAL_HOST_PERMISSIONS],
    action: { default_title: 'JobDeputy' },
  };
}
