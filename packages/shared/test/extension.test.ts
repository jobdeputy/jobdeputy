import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EXTENSION_DEV_IDS,
  extensionOrigin,
  extensionRedirectUrl,
  greenhouseFormUrl,
} from '../src/extension.js';
import { EXTENSION_DEV_KEY } from '../src/extension-key.js';

/** Chrome's rule: the first 32 hex digits of the key's SHA-256, each digit 0–f written as a–p. */
function idFromKey(key: string): string {
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join('');
}

describe('extension identity (#54, decision 0020)', () => {
  it('derives the dev ID from the committed public key', () => {
    expect(EXTENSION_DEV_IDS).toEqual([idFromKey(EXTENSION_DEV_KEY)]);
  });

  it('commits only a public key (an RSA SubjectPublicKeyInfo, never a private key)', () => {
    const pem = readFileSync(new URL('../src/extension-dev-key.pub', import.meta.url), 'utf8');
    expect(pem.trim().startsWith('-----BEGIN PUBLIC KEY-----')).toBe(true);
    expect(pem).not.toMatch(/PRIVATE/);
    const der = Buffer.from(EXTENSION_DEV_KEY, 'base64');
    // SubjectPublicKeyInfo for rsaEncryption carries this OID; a private key would be far longer.
    expect(der.includes(Buffer.from('2a864886f70d010101', 'hex'))).toBe(true);
    expect(der.length).toBeLessThan(600);
  });

  it('builds the callback and origin Chrome uses for an ID', () => {
    expect(extensionRedirectUrl('abc')).toBe('https://abc.chromiumapp.org/');
    expect(extensionOrigin('abc')).toBe('chrome-extension://abc');
  });
});

describe('greenhouseFormUrl (#54 PR D)', () => {
  it("builds a Greenhouse job's own form on the board's host", () => {
    expect(greenhouseFormUrl('greenhouse:acme', '4001001')).toBe(
      'https://job-boards.greenhouse.io/acme/jobs/4001001',
    );
  });

  it.each([
    ['lever:acme', '1'],
    ['greenhouse:acme', undefined],
    ['greenhouse:acme', 'abc'],
    ['greenhouse:', '1'],
    ['greenhouse:ac/me', '1'],
    ['greenhouse:acme', `1${'0'.repeat(20)}`],
  ])('none for %s %s', (companyKey, externalId) => {
    expect(greenhouseFormUrl(companyKey, externalId)).toBeNull();
  });
});
