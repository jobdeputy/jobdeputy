import { describe, expect, it } from 'vitest';
import { type Copy, copy } from '../src/copy/index.ts';

/** Every leaf of the copy tree, as "path: text". */
function leaves(node: object, path = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${path}${key}: ${value}`] : leaves(value, `${path}${key}.`),
  );
}

describe('copy', () => {
  it('has no empty text', () => {
    for (const leaf of leaves(copy)) {
      expect(leaf).toMatch(/: \S/);
    }
  });

  it('accepts another language with the same keys and different words', () => {
    // A compile-time check as much as a runtime one: typecheck fails if Copy pins English text.
    const shell: Copy['shell'] = {
      productName: 'JobDeputy',
      tagline: 'Tu compañero de búsqueda de empleo.',
      taglineShort: 'Tu compañero de búsqueda de empleo',
    };
    const titleLines: Copy['landing']['titleLines'] = [
      'Tú lo configuras.',
      'Tu asistente postula.',
    ];
    expect(leaves(shell).length).toBe(leaves(copy.shell).length);
    expect(titleLines.length).toBe(copy.landing.titleLines.length);
  });
});
