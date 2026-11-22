import { decodeEntities, htmlToText } from '../jobs/text.js';

/**
 * #50: one open role in a list, as the list states it. Used only to choose companies: the
 * jobs saved come from each company's own board, never from the list.
 */
export interface ListRow {
  company: string;
  title: string;
  locations: string[];
  /** Every link in the row, the application link first where the list names one. */
  links: string[];
  /** Seconds since 1970, when the list gives it. */
  postedAt?: number;
}

/** Rows read from one list, at most. Simplify New-Grad held 18,505 (3,132 open) in 2026-11. */
export const MAX_LIST_ROWS = 50_000;
const MAX_TEXT = 300;
const MAX_LOCATIONS = 20;
const MAX_LINKS = 5;

const text = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '';

/**
 * The Simplify format (`.github/scripts/listings.json`, also used by lists forked from it): an
 * array of roles with `company_name`, `title`, `locations`, `url`, `date_posted`, and `active`
 * and `is_visible` flags. Closed or hidden roles are left out. Undefined when it is not that
 * format at all.
 */
export function parseListings(json: unknown): ListRow[] | undefined {
  if (!Array.isArray(json)) return undefined;
  const rows: ListRow[] = [];
  let recognised = false;
  for (const item of json.slice(0, MAX_LIST_ROWS)) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const company = text(r.company_name);
    const title = text(r.title);
    const url = text(r.url);
    if (!company || !title) continue;
    recognised = true;
    if (r.active === false || r.is_visible === false || !url) continue;
    const locations = Array.isArray(r.locations)
      ? r.locations.map(text).filter(Boolean).slice(0, MAX_LOCATIONS)
      : [];
    rows.push({
      company,
      title,
      locations,
      links: [url],
      ...(typeof r.date_posted === 'number' && Number.isFinite(r.date_posted)
        ? { postedAt: r.date_posted }
        : {}),
    });
  }
  return recognised ? rows : undefined;
}

type Column = 'company' | 'title' | 'location';

/** A header names a column we need: Company; Role, Position, or Job Title; Location. */
function columnOf(header: string): Column | undefined {
  const h = header.toLowerCase();
  if (/\bcompany\b/.test(h)) return 'company';
  if (/\b(role|position|title|job)\b/.test(h)) return 'title';
  if (/\blocations?\b/.test(h)) return 'location';
  return undefined;
}

const HREF = /href\s*=\s*"(https?:\/\/[^"\s]{1,2000})"/gi;
const MD_LINK = /\]\((https?:\/\/[^)\s]{1,2000})\)/g;

function linksIn(cell: string): string[] {
  const found = [...cell.matchAll(HREF), ...cell.matchAll(MD_LINK)].map((m) =>
    decodeEntities(m[1] as string),
  );
  return found;
}

/** A cell as plain text: tags, Markdown links and emphasis removed. */
function cellText(cell: string): string {
  const html = cell
    .replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/gi, '')
    .replace(/<\/br\s*>/gi, '<br>')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__/g, '');
  return htmlToText(html);
}

/** Turns header and row cells into rows; the company `↳` (or empty) repeats the one above. */
function rowsFrom(table: { header: string[]; rows: string[][] }, into: ListRow[]): void {
  const columns = new Map<Column, number>();
  table.header.forEach((h, i) => {
    const column = columnOf(cellText(h));
    if (column && !columns.has(column)) columns.set(column, i);
  });
  const companyAt = columns.get('company');
  const titleAt = columns.get('title');
  if (companyAt === undefined || titleAt === undefined) return;
  const locationAt = columns.get('location');
  let company = '';
  for (const cells of table.rows) {
    if (into.length >= MAX_LIST_ROWS) return;
    // Lists decorate names ("🔥 Palantir"); `↳` (or nothing) repeats the company above.
    const named = text(cellText(cells[companyAt] ?? '')).replace(/^[^\p{L}\p{N}]+/u, '');
    if (named) company = named;
    const raw = cells.join(' ');
    // Lists mark closed roles with a lock.
    if (raw.includes('🔒')) continue;
    const title = text(cellText(cells[titleAt] ?? ''));
    if (!company || !title) continue;
    // The application link is usually in a later column than the company's own site.
    const links = cells
      .map((cell, i) => ({ i, links: linksIn(cell) }))
      .filter((c) => c.i !== companyAt)
      .flatMap((c) => c.links);
    const all = [...links, ...linksIn(cells[companyAt] ?? '')];
    if (all.length === 0) continue;
    const locations =
      locationAt === undefined
        ? []
        : cellText(cells[locationAt] ?? '')
            .split('\n')
            .map(text)
            .filter(Boolean)
            .slice(0, MAX_LOCATIONS);
    into.push({ company, title, locations, links: [...new Set(all)].slice(0, MAX_LINKS) });
  }
}

const TABLE = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
const ROW = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL = /<(t[hd])\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;

function htmlTables(readme: string, into: ListRow[]): void {
  for (const table of readme.matchAll(TABLE)) {
    let header: string[] | undefined;
    const rows: string[][] = [];
    for (const row of (table[1] as string).matchAll(ROW)) {
      const cells = [...(row[1] as string).matchAll(CELL)];
      if (header === undefined && cells.some((c) => c[1]?.toLowerCase() === 'th')) {
        header = cells.map((c) => c[2] as string);
      } else if (header !== undefined) {
        rows.push(cells.map((c) => c[2] as string));
      }
    }
    if (header) rowsFrom({ header, rows }, into);
  }
}

/** Splits a Markdown table line into cells (`| a | b |`). */
function pipeCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

const SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function markdownTables(readme: string, into: ListRow[]): void {
  const lines = readme.split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const line = lines[i] as string;
    if (!line.trim().startsWith('|') || !SEPARATOR.test((lines[i + 1] as string).trim())) continue;
    const header = pipeCells(line);
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length && (lines[j] as string).trim().startsWith('|'); j += 1) {
      rows.push(pipeCells(lines[j] as string));
    }
    rowsFrom({ header, rows }, into);
    i = j - 1;
  }
}

/**
 * A README's tables of roles (HTML or Markdown), read by their headers: a Company column and a
 * Role, Position, or Title column are needed; Location is used when there is one. Every link in
 * a row is kept, so the company's board can be found from its application link.
 */
export function parseReadme(readme: string): ListRow[] {
  const rows: ListRow[] = [];
  htmlTables(readme, rows);
  markdownTables(readme, rows);
  return rows;
}
