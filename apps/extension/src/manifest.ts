/**
 * #54 (decision 0020): the extension's manifest, kept here so a test can hold it to least
 * privilege. It asks only for what a shipped feature uses: this shell asks for nothing. Sign-in
 * (PR B) adds `identity`, `storage` and the API's origin; the Greenhouse filler (PR C) adds the
 * Greenhouse boards. Every later job site is an optional host, asked for when first needed; its
 * content script is registered at runtime once granted, never listed in the manifest (a host a
 * static content script matches is granted at install).
 */
export const PERMISSIONS: readonly string[] = [];
export const HOST_PERMISSIONS: readonly string[] = [];
export const OPTIONAL_PERMISSIONS: readonly string[] = [];
export const OPTIONAL_HOST_PERMISSIONS: readonly string[] = [];

export const manifest = {
  name: 'JobDeputy',
  description: 'Fills job applications with your saved answers. You review and submit.',
  permissions: [...PERMISSIONS],
  host_permissions: [...HOST_PERMISSIONS],
  optional_permissions: [...OPTIONAL_PERMISSIONS],
  optional_host_permissions: [...OPTIONAL_HOST_PERMISSIONS],
  action: { default_title: 'JobDeputy' },
};
