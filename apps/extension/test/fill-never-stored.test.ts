import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
/** Every file that handles fill data: the worker's reads, the filler, the form's page script. */
const FILL_CODE = ['src/fill', 'src/greenhouse', 'entrypoints/greenhouse.content'].flatMap((dir) =>
  readdirSync(join(ROOT, dir)).map((file) => join(dir, file)),
);

describe('fill data is never stored (#54 PR C, decisions 0019 and 0020)', () => {
  it('no code that handles it can reach extension storage, cookies or the page’s storage', () => {
    expect(FILL_CODE.length).toBeGreaterThan(5);
    for (const file of FILL_CODE) {
      const code = readFileSync(join(ROOT, file), 'utf8');
      expect(code, file).not.toMatch(
        /\bstorage\b|localStorage|sessionStorage|indexedDB|document\.cookie/,
      );
    }
  });
});
