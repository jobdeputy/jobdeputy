import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../lib/constructs/node-function.js';

/**
 * docs/code-map.md is where agents look first (CLAUDE.md), so every source file must be
 * in it: by file name, by name in backticks (`queue-worker`), or through a pattern such
 * as `shared/src/*.ts`.
 */
const ROOTS = ['apps', 'packages', 'infra/lib', 'infra/bin', 'tests/integration/src'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'test', 'dist', 'cdk.out', 'eval'].includes(entry.name)) return [];
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

describe('docs/code-map.md', () => {
  const map = readFileSync(join(REPO_ROOT, 'docs', 'code-map.md'), 'utf8');
  const patterns = [...map.matchAll(/`([^`]*\*[^`]*)`/g)].map(
    (m) =>
      new RegExp(
        `${(m[1] as string).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`,
      ),
  );
  const listed = (path: string) => {
    const name = basename(path);
    return (
      map.includes(name) ||
      map.includes(`\`${name.replace(/\.tsx?$/, '')}\``) ||
      patterns.some((p) => p.test(path))
    );
  };

  it('lists every source file', () => {
    const files = ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root))).map((f) =>
      relative(REPO_ROOT, f),
    );
    expect(files.length).toBeGreaterThan(50);
    expect(
      files
        .filter((f) => /(^|\/)src\//.test(f) || f.startsWith('infra/'))
        .filter((f) => !listed(f)),
    ).toEqual([]);
  });
});
