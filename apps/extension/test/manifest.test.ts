import { LOCAL_WEB_ORIGIN as SHARED_LOCAL_WEB_ORIGIN } from '@jobdeputy/shared/auth';
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
import { LOCAL_WEB_ORIGIN, siteOrigins } from '../src/site.ts';

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
    // PR C: the Greenhouse application forms, where the filler's content script runs.
    'https://job-boards.greenhouse.io/*',
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

  it('asks only for the forms its content script is on when the build has no sign-in settings', () => {
    expect(manifestFor(null).host_permissions).toEqual(['https://job-boards.greenhouse.io/*']);
    expect(manifestFor(null, { store: true }).permissions).toEqual([]);
    expect(hostPermissions(null)).toEqual(['https://job-boards.greenhouse.io/*']);
  });

  it('asks for the API origin only, never a path beyond it or another host', () => {
    expect(hostPermissions({ ...SETTINGS, apiUrl: 'https://api.example.com/v1' })).toEqual([
      'https://api.example.com/*',
      'https://jobdeputy-dev-iad-documentsbucket.s3.us-east-1.amazonaws.com/*',
      'https://job-boards.greenhouse.io/*',
    ]);
  });

  it('names a dev build so, and the store build plainly', () => {
    expect(manifest.name).toBe('JobDeputy Dev');
    expect(manifest.action.default_title).toBe('JobDeputy Dev');
    const store = manifestFor(SETTINGS, { store: true });
    expect([store.name, store.action.default_title]).toEqual(['JobDeputy', 'JobDeputy']);
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

describe('who may message the extension (#54 PR D, decision 0020)', () => {
  const SITE = { ...SETTINGS, siteUrl: 'https://app.jobdeputy.test/x' };

  it("lets only the web app's origin in a store build, and Vite's dev server too in a dev one", () => {
    expect(manifestFor(SITE, { store: true }).externally_connectable).toEqual({
      matches: ['https://app.jobdeputy.test/*'],
    });
    expect(manifestFor(SITE).externally_connectable).toEqual({
      matches: ['https://app.jobdeputy.test/*', 'http://localhost:5173/*'],
    });
    // A personal stack has no site: its web app runs on Vite's dev server.
    expect(siteOrigins(SETTINGS)).toEqual(['http://localhost:5173']);
    expect(manifestFor(SETTINGS, { store: true })).not.toHaveProperty('externally_connectable');
  });

  it("names Vite's dev server as the web app does", () => {
    expect(LOCAL_WEB_ORIGIN).toBe(SHARED_LOCAL_WEB_ORIGIN);
  });

  it('lets no page in without sign-in settings (nothing to answer)', () => {
    expect(manifestFor(null)).not.toHaveProperty('externally_connectable');
    expect(siteOrigins(null)).toEqual([]);
  });

  it('never lets every site in, nor another extension', () => {
    for (const settings of [SITE, SETTINGS]) {
      const matches = manifestFor(settings).externally_connectable?.matches ?? [];
      for (const match of matches) expect(match).toMatch(/^https?:\/\/[a-z0-9.-]+(:\d+)?\/\*$/);
      expect(manifestFor(settings).externally_connectable).not.toHaveProperty('ids');
    }
  });
});
