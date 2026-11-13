/**
 * Text helpers for job data (T07a). Everything read from a site is untrusted: HTML is
 * turned into plain text here and never stored or served as HTML. Linear scans only,
 * so a hostile page cannot make them slow.
 */

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  rupee: '₹',
};

function codePoint(value: number): string {
  const valid =
    Number.isInteger(value) &&
    value > 0 &&
    value <= 0x10ffff &&
    !(value >= 0xd800 && value <= 0xdfff);
  return valid ? String.fromCodePoint(value) : '�';
}

/** Decodes HTML character references once (`&amp;lt;` becomes `&lt;`, not `<`). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (match, ref: string) => {
    if (ref[0] === '#') {
      const hex = ref[1] === 'x' || ref[1] === 'X';
      return codePoint(Number.parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    return NAMED[ref.toLowerCase()] ?? match;
  });
}

/** Elements whose content is never text a reader sees. */
const HIDDEN = /^<(script|style|noscript|template|svg|head|iframe|object)\b/;
/** Elements that separate paragraphs, and those that only start a new line. */
const PARAGRAPH =
  /^<\/?(p|div|ul|ol|h[1-6]|table|section|article|header|footer|blockquote|pre|hr)\b/;
const LINE = /^<(br|tr|dd|dt)\b/;
/** Formatting inside a line: removed without a space, so `<b>up</b>.` reads `up.`. */
const INLINE = /^<\/?(a|b|i|u|em|strong|span|small|mark|sub|sup|code|abbr|font)\b/;

/** Lowercases ASCII only, so every index still points at the same character. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

/**
 * Plain text from HTML, keeping paragraphs and list items as lines. Unclosed comments
 * or hidden elements end the text rather than being searched for again.
 */
export function htmlToText(html: string): string {
  const lower = asciiLower(html);
  const parts: string[] = [];
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf('<', i);
    if (open === -1) {
      parts.push(html.slice(i));
      break;
    }
    parts.push(html.slice(i, open));
    if (lower.startsWith('<!--', open)) {
      const close = html.indexOf('-->', open + 4);
      if (close === -1) break;
      i = close + 3;
      continue;
    }
    const head = lower.slice(open, open + 12);
    const hidden = HIDDEN.exec(head);
    let close = open;
    if (hidden !== null) {
      close = lower.indexOf(`</${hidden[1]}`, open);
      if (close === -1) break;
    }
    const end = html.indexOf('>', close);
    if (end === -1) break;
    if (/^<li\b/.test(head)) parts.push('\n- ');
    else if (PARAGRAPH.test(head)) parts.push('\n\n');
    else if (LINE.test(head)) parts.push('\n');
    else if (!INLINE.test(head) && !head.startsWith('</li')) parts.push(' ');
    i = end + 1;
  }
  return tidy(decodeEntities(parts.join('')));
}

/** Collapses spaces within lines and blank lines between them. */
export function tidy(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[\s ]+/g, ' ').trim())
      // An empty list item leaves a lone "-".
      .filter((line) => line !== '-')
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** One line of text: no tags, no line breaks, at most `max` characters. */
export function oneLine(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = decodeEntities(String(value))
    .replace(/<[^>]{0,500}>/g, ' ')
    .replace(/[\s ]+/g, ' ')
    .trim();
  if (text.length === 0) return undefined;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Cuts long text at a line or word break, never mid-character. */
export function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let cut = text.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
  if (lastBreak > max * 0.8) cut = cut.slice(0, lastBreak);
  // Never leave half of a surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}…`, truncated: true };
}
