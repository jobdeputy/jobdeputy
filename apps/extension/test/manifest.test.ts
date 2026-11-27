import { describe, expect, it } from 'vitest';
import {
  HOST_PERMISSIONS,
  manifest,
  OPTIONAL_HOST_PERMISSIONS,
  PERMISSIONS,
} from '../src/manifest.ts';

/**
 * Least privilege (decision 0020): the extension asks only for what a shipped feature uses.
 * Each later PR widens these lists on purpose, in this test too.
 */
const ALLOWED_PERMISSIONS: readonly string[] = [];
const ALLOWED_HOSTS: readonly string[] = [];
/** Never: these reach every site, every tab, or the user's browsing. */
const FORBIDDEN = [
  '<all_urls>',
  'tabs',
  'history',
  'cookies',
  'webRequest',
  'webRequestBlocking',
  'debugger',
  'management',
  'downloads',
  'clipboardRead',
];

describe('manifest (#54, decision 0020)', () => {
  it('asks only for the permissions and hosts a shipped feature uses', () => {
    expect([...PERMISSIONS].sort()).toEqual([...ALLOWED_PERMISSIONS].sort());
    expect([...HOST_PERMISSIONS].sort()).toEqual([...ALLOWED_HOSTS].sort());
    expect(manifest.permissions).toEqual([...PERMISSIONS]);
    expect(manifest.host_permissions).toEqual([...HOST_PERMISSIONS]);
  });

  it('never asks for broad access', () => {
    const asked = [...PERMISSIONS, ...HOST_PERMISSIONS, ...OPTIONAL_HOST_PERMISSIONS];
    for (const forbidden of FORBIDDEN) expect(asked).not.toContain(forbidden);
    // No wildcard host or scheme: every host is one site over https.
    for (const host of [...HOST_PERMISSIONS, ...OPTIONAL_HOST_PERMISSIONS]) {
      expect(host).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]+\/\*$/);
    }
  });
});
