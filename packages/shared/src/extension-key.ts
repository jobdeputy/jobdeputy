import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #54 (decision 0020): the extension's dev public key, as the manifest's `key` wants it (base64
 * of the DER `SubjectPublicKeyInfo`), read from the PEM file beside this one (`.pub`: the repo ignores `*.pem`, which guards private keys). Node only
 * (the manifest build, tests): the extension's own pages never need it.
 */
export const EXTENSION_DEV_KEY = readFileSync(
  // A path, not a URL object: test environments such as happy-dom replace the URL class.
  join(dirname(fileURLToPath(import.meta.url)), 'extension-dev-key.pub'),
  'utf8',
)
  .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '')
  .replace(/\s+/g, '');
