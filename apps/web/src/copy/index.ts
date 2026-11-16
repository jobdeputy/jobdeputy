import { type Copy, en } from './en.ts';

export type { Copy };

/**
 * The copy the UI shows. English only for now (US launch); a second language adds a sibling of
 * en.ts typed as `Copy` and picks it here, so no component changes.
 */
export const copy: Copy = en;

/**
 * One `V` per entry of the copy list `T`, with the same length, for data paired with copy (such as
 * each step's icon). Generic, so tuples stay tuples. The length check itself comes from `Copy`:
 * `Widen` (en.ts) keeps every list a fixed-length tuple, so a language with a different count fails
 * to compile. Over a plain array, OnePer would accept any length.
 */
export type OnePer<T, V> = { readonly [K in keyof T]: V };

/**
 * Fills a copy template's `{name}` slots, such as `fill(copy.loading.progressMilestone, { label,
 * percent })`. Templates keep a whole sentence in one entry, so each language orders its own words.
 * A slot with no value stays as written, so a missing value shows up instead of vanishing.
 */
export function fill(template: string, values: Record<string, string>): string {
  // A Map, so a slot such as {constructor} cannot find a property every object inherits.
  const byName = new Map(Object.entries(values));
  return template.replace(/\{(\w+)\}/g, (slot, name: string) => byName.get(name) ?? slot);
}

/**
 * The form of a counted phrase for `count`, by the copy's own language rules (one, few, many…),
 * filled with `{count}`: `plural(copy.setUp.errors.units.seconds, 30)` is "30 seconds". A form
 * the language does not list falls back to `other`.
 */
export function plural(
  forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string },
  count: number,
): string {
  const form = new Intl.PluralRules(copy.locale).select(count);
  return fill(forms[form] ?? forms.other, { count: String(count) });
}
