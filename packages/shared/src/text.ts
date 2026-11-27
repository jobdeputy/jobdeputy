/**
 * Text cut to at most `max` characters at a line or word break when there is one in its
 * last 20%, never leaving half of a surrogate pair (an emoji). Shared by the crawl's
 * `truncate` (T07b) and the structured résumé's limits (#51).
 */
export function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
  if (lastBreak > max * 0.8) cut = cut.slice(0, lastBreak);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return cut.trimEnd();
}

/**
 * Fills a copy template's `{name}` slots, such as `fill(copy.loading.progressMilestone, { label,
 * percent })`, for the web app and the extension. Templates keep a whole sentence in one entry, so
 * each language orders its own words. A slot with no value stays as written, so a missing value
 * shows up instead of vanishing.
 */
export function fill(template: string, values: Record<string, string>): string {
  // A Map, so a slot such as {constructor} cannot find a property every object inherits.
  const byName = new Map(Object.entries(values));
  return template.replace(/\{(\w+)\}/g, (slot, name: string) => byName.get(name) ?? slot);
}
