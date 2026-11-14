import { describe, expect, it } from 'vitest';
import { type Copy, copy, fill } from '../src/copy/index.ts';

/** The leaves of a copy tree that are pinned to one exact text instead of any string. */
type PinnedText<T> = T extends string
  ? string extends T
    ? never
    : T
  : T extends readonly (infer Item)[]
    ? PinnedText<Item>
    : { [K in keyof T]: PinnedText<T[K]> }[keyof T];

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
    // Compile-time checks: typecheck fails if Copy pins any English text, anywhere in the tree.
    const noPinnedText: [PinnedText<Copy>] extends [never] ? true : false = true;
    const shell: Copy['shell'] = {
      wordmark: ['Job', 'Deputy'],
      tagline: 'Tu compañero de búsqueda de empleo',
    };
    expect(noPinnedText).toBe(true);
    expect(leaves(shell).length).toBe(leaves(copy.shell).length);
  });
});

describe('fill', () => {
  it('puts values into their slots, in the order the template sets', () => {
    expect(fill('{label}, {percent}', { label: 'Uploading', percent: '50%' })).toBe(
      'Uploading, 50%',
    );
    expect(fill('{percent} : {label}', { label: 'Envoi', percent: '50 %' })).toBe('50 % : Envoi');
  });

  it('leaves a slot with no value as written', () => {
    expect(fill('{label}, {percent}', { label: 'Uploading' })).toBe('Uploading, {percent}');
    expect(fill('{constructor}', {})).toBe('{constructor}');
  });
});
