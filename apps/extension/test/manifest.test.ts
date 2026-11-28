import { EXTENSION_DEV_IDS } from '@jobdeputy/shared/extension';
import { EXTENSION_DEV_KEY } from '@jobdeputy/shared/extension-key';
import { describe, expect, it } from 'vitest';
import {
  hostPermissions,
  manifestFor,
  OPTIONAL_HOST_PERMISSIONS,
  OPTIONAL_PERMISSIONS,
  PERMISSIONS,
} from '../src/manifest.ts';
import type { Settings } from '../src/settings.ts';

const SETTINGS: Settings = {
  apiUrl: 'https://abc123.execute-api.us-east-1.amazonaws.com',
  authDomain: 'https://jobdeputy-dev-iad.auth.us-east-1.amazoncognito.com',
  clientId: '37qq0qiq6rckk23cg85qi6m4bs',
  filesOrigin: 'https://jobdeputy-dev-iad-documentsbucket.s3.us-east-1.amazonaws.com',
};

/**
 * Least privilege (decision 0020): the extension asks only for what a shipped feature uses.
 * Each later PR widens these lists on purpose, in this test too.
 */
const ALLOWED = {
  // Sign-in (PR B): managed login in its own window, the session in storage.session.
  permissions: ['identity', 'storage'],
  // The API's own origin only: managed login answers the extension's origin itself (CORS).
  // PR C: the documents' download origin (the résumé and letter the filler attaches).
  host_permissions: [
    'https://abc123.execute-api.us-east-1.amazonaws.com/*',
    'https://jobdeputy-dev-iad-documentsbucket.s3.us-east-1.amazonaws.com/*',
  ],
  optional_permissions: [] as string[],
  optional_host_permissions: [] as string[],
};
/** Never, granted or optional: these reach every site, every tab, or the user's browsing. */
const FORBIDDEN = [
  '<all_urls>',
  'tabs',
  'history',
  'cookies',
  'webRequest',
  'webRequestBlocking',
  'declarativeNetRequest',
  'debugger',
  'management',
  'downloads',
  'clipboardRead',
];

describe('manifest (#54, decision 0020)', () => {
  const manifest = manifestFor(SETTINGS);

  it('asks only for the permissions and hosts a shipped feature uses, granted or optional', () => {
    const asked = {
      permissions: manifest.permissions,
      host_permissions: manifest.host_permissions,
      optional_permissions: manifest.optional_permissions,
      optional_host_permissions: manifest.optional_host_permissions,
    };
    for (const [key, list] of Object.entries(asked)) {
      expect([...list].sort(), key).toEqual([...ALLOWED[key as keyof typeof ALLOWED]].sort());
    }
    expect(manifest.permissions).toEqual([...PERMISSIONS]);
    expect(manifest.optional_permissions).toEqual([...OPTIONAL_PERMISSIONS]);
    expect(manifest.optional_host_permissions).toEqual([...OPTIONAL_HOST_PERMISSIONS]);
  });

  it('asks for nothing at all when the build has no sign-in settings', () => {
    expect(manifestFor(null).host_permissions).toEqual([]);
    expect(manifestFor(null, { store: true }).permissions).toEqual([]);
    expect(hostPermissions(null)).toEqual([]);
  });

  it('asks for the API origin only, never a path beyond it or another host', () => {
    expect(hostPermissions({ ...SETTINGS, apiUrl: 'https://api.example.com/v1' })).toEqual([
      'https://api.example.com/*',
      'https://jobdeputy-dev-iad-documentsbucket.s3.us-east-1.amazonaws.com/*',
    ]);
  });

  it('fixes the dev ID with the public key, and leaves the key out of a store build', () => {
    expect(manifest.key).toBe(EXTENSION_DEV_KEY);
    expect(EXTENSION_DEV_IDS).toHaveLength(1);
    expect('key' in manifestFor(SETTINGS, { store: true })).toBe(false);
  });

  it('never asks for broad access', () => {
    const hosts = [...manifest.host_permissions, ...OPTIONAL_HOST_PERMISSIONS];
    const asked = [...PERMISSIONS, ...OPTIONAL_PERMISSIONS, ...hosts];
    for (const forbidden of FORBIDDEN) expect(asked).not.toContain(forbidden);
    // No wildcard host or scheme: every host is one site over https.
    for (const host of hosts) {
      expect(host).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]+\/\*$/);
    }
  });
});
