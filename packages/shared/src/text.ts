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
