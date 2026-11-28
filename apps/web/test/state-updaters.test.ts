import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../src');

/** Every source file under src/, as [path, text]. */
function sources(): [string, string][] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => [file, readFileSync(join(SRC, file), 'utf8')]);
}

describe('state updaters (#94)', () => {
  it('never read an event inside a setState updater', () => {
    // React may run an updater after it has put a controlled input back to its last rendered
    // value, so `setX((current) => … event.target.value …)` can save '' and lose the keystroke
    // (AuthPanel lost the emailed code this way on a loaded runner). Read the value first.
    const lazy = /set[A-Z]\w*\(\s*\(?\w*\)?\s*=>[^;]*?\b(?:event|e)\.target\b/;
    const offenders = sources()
      .filter(([, text]) => lazy.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
