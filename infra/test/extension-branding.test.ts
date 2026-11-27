import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  brandingSvg,
  EXTENSION_BRANDING_SETTINGS,
  squareSvg,
} from '../lib/constructs/extension-branding.js';
import { REPO_ROOT } from '../lib/constructs/node-function.js';

const tokens = readFileSync(join(REPO_ROOT, 'apps/web/src/styles/tokens.css'), 'utf8');
const mark = readFileSync(join(REPO_ROOT, 'apps/web/public/jobdeputy-mark.svg'), 'utf8');

/** `RRGGBBAA` colours anywhere in the settings. */
function colours(value: unknown): string[] {
  if (typeof value === 'string') return /^[0-9a-f]{8}$/.test(value) ? [value] : [];
  if (value && typeof value === 'object') return Object.values(value).flatMap(colours);
  return [];
}

describe('managed login branding (#54)', () => {
  it("uses only the web app's colours (tokens.css), solid or as ink at an opacity", () => {
    const solid = new Set(
      [...tokens.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/g)].map(([, hex = '']) =>
        hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex,
      ),
    );
    for (const colour of new Set(colours(EXTENSION_BRANDING_SETTINGS))) {
      const [rgb, alpha] = [colour.slice(0, 6), colour.slice(6)];
      if (alpha === 'ff') {
        // dangerWash is the one tint: danger ink on white at about 8%.
        if (colour !== 'fdf0ebff') expect(solid, colour).toContain(rgb);
      } else {
        expect(rgb, colour).toBe('1b1a18');
        const opacity = (Number.parseInt(alpha, 16) / 255).toFixed(2);
        expect(tokens, colour).toContain(`rgba(27, 26, 24, ${opacity})`);
      }
    }
  });

  it('is light only, like the web app', () => {
    expect(EXTENSION_BRANDING_SETTINGS.categories.global.colorSchemeMode).toBe('LIGHT');
    expect(JSON.stringify(EXTENSION_BRANDING_SETTINGS)).not.toContain('darkMode');
  });

  it('drops only what managed login refuses from the mark', () => {
    const clean = brandingSvg(mark);
    expect(clean).not.toMatch(/<svg\b[^>]*\b(?:role|aria-[a-z]+)=/);
    expect(clean).not.toMatch(/feDropShadow|<filter|\sfilter=|\sdata-[a-z-]+=/);
    // The artwork stays: the same shapes, title, and viewBox.
    expect(clean.match(/<(?:path|circle|ellipse|rect)\b/g)?.length).toBe(
      mark.match(/<(?:path|circle|ellipse|rect)\b/g)?.length,
    );
    expect(clean).toContain('<title id="mark-title">JobDeputy</title>');
    expect(clean).toContain('viewBox="70 15 400 290"');
  });

  it('squares the favicon around the art', () => {
    expect(squareSvg('<svg viewBox="70 15 400 290">')).toBe('<svg viewBox="70 -40 400 400">');
    expect(squareSvg('<svg viewBox="0 0 10 20">')).toBe('<svg viewBox="-5 0 20 20">');
    expect(squareSvg('<svg viewBox=" 0,0, 20 10">')).toBe('<svg viewBox="0 -5 20 20">');
    expect(() => squareSvg('<svg width="10">')).toThrow(/viewBox/);
  });
});
