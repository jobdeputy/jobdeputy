import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

const brandDirectory = resolve(import.meta.dirname, '../../brand');
const prototypeFiles = readdirSync(brandDirectory)
  .filter((name) => name.endsWith('-preview.html') || name === 'preview.html')
  .sort();

function sourceFor(file: string): string {
  return readFileSync(resolve(brandDirectory, file), 'utf8');
}

function idsIn(source: string): Set<string> {
  return new Set([...source.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1] ?? ''));
}

describe('prototype document integrity', () => {
  it.each(prototypeFiles)('%s has unique IDs and resolvable ARIA references', (file) => {
    const source = sourceFor(file);
    const written = [...source.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1] ?? '');
    // An id built at run time in a script's template (one containing "${") is not a document id,
    // so it is left out of the uniqueness check (the rendered audit checks those; round 6, the
    // orchestrator's decision on A3's request 5). It still resolves a reference written the same
    // way.
    const ids = written.filter((id) => !id.includes('${'));
    expect(new Set(ids).size, `${file} contains a duplicate ID`).toBe(ids.length);

    const availableIds = new Set(written);
    for (const match of source.matchAll(
      /\saria-(?:controls|describedby|labelledby)=["']([^"']+)["']/g,
    )) {
      for (const reference of (match[1] ?? '').split(/\s+/).filter(Boolean)) {
        expect(
          availableIds.has(reference),
          `${file} has an unresolved ARIA reference: ${reference}`,
        ).toBe(true);
      }
    }
  });

  // The shared scripts every internal page loads parse as classic scripts.
  it.each(
    readdirSync(brandDirectory)
      .filter((name) => name.endsWith('.js'))
      .sort(),
  )('%s parses as a classic script', (file) => {
    expect(() => new Script(sourceFor(file), { filename: file })).not.toThrow();
  });

  it.each(prototypeFiles)('%s has parseable inline JavaScript', (file) => {
    const source = sourceFor(file);
    const scripts = [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const [index, match] of scripts.entries()) {
      expect(
        () => new Script(match[1] ?? '', { filename: `${file}:inline-${index + 1}` }),
      ).not.toThrow();
    }
  });

  it.each(prototypeFiles)('%s has valid local links, fragments, and image assets', (file) => {
    const source = sourceFor(file);
    const currentIds = idsIn(source);
    for (const match of source.matchAll(/\s(?:href|src)=["']([^"']+)["']/g)) {
      const target = match[1] ?? '';
      if (
        !target ||
        /^(?:https?:|mailto:|tel:|data:|blob:|javascript:)/i.test(target) ||
        target.startsWith('//')
      ) {
        continue;
      }

      const [pathWithQuery = '', fragment = ''] = target.split('#', 2);
      const path = pathWithQuery.split('?', 1)[0] ?? '';
      if (!path) {
        if (fragment) {
          expect(currentIds.has(fragment), `${file} has an unresolved fragment: #${fragment}`).toBe(
            true,
          );
        }
        continue;
      }

      const resolvedPath = resolve(dirname(resolve(brandDirectory, file)), path);
      expect(existsSync(resolvedPath), `${file} points to a missing local file: ${target}`).toBe(
        true,
      );
      if (fragment && resolvedPath.endsWith('.html')) {
        expect(
          idsIn(readFileSync(resolvedPath, 'utf8')).has(fragment),
          `${file} points to a missing fragment: ${target}`,
        ).toBe(true);
      }
    }
  });
});
