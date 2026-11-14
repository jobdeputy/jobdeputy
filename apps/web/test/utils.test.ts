import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cn } from '../src/lib/utils.ts';

const tokens = readFileSync(join(import.meta.dirname, '../src/styles/tokens.css'), 'utf8');

/** The names a scale gets in tokens.css, for example `--shadow-control` → `control`. */
function names(scale: string) {
  return [...tokens.matchAll(new RegExp(`--${scale}-([a-z-]+):`, 'g'))].map((m) => m[1]);
}

describe('cn', () => {
  // tailwind-merge only knows our custom names if utils.ts lists them; this catches a token added
  // to tokens.css without its name in utils.ts.
  it.each(names('shadow'))('lets shadow-none replace shadow-%s', (name) => {
    expect(cn(`shadow-${name}`, 'shadow-none')).toBe('shadow-none');
  });

  it.each(names('ease'))('lets ease-linear replace ease-%s', (name) => {
    expect(cn(`ease-${name}`, 'ease-linear')).toBe('ease-linear');
  });

  it('finds the theme scales it checks', () => {
    expect(names('shadow')).toEqual(['panel', 'control']);
    expect(names('ease')).toEqual(['settle', 'spring']);
  });

  it('keeps classes from different groups', () => {
    expect(cn('font-display', 'font-semibold', 'text-muted-foreground', 'text-sm')).toBe(
      'font-display font-semibold text-muted-foreground text-sm',
    );
  });
});
