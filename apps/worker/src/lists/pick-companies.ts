import { parseCrawlUrl } from '@jobdeputy/shared';
import { type Board, boardFromUrl, boardKey } from '../jobs/boards.js';
import { countryInText, type FilterProfile, filterJob } from '../relevance/code-filter.js';
import type { ListRow } from './parse.js';

/** The country a cell's list runs look for (US-only launch: the US cell). */
export const LIST_COUNTRY = 'US';

/** A company a list run will crawl. */
export interface PickedCompany {
  name: string;
  /** The board's own link (its list of jobs, not one posting). */
  url: string;
  boardKey: string;
  matches: number;
}

export interface Picked {
  rows: number;
  matched: number;
  companiesMatched: number;
  companies: PickedCompany[];
  /** Companies ranked above the cut that we cannot read yet (#64). */
  skipped: number;
}

/** The board's own page for a board: the link a person would give to crawl the whole board. */
export function boardUrl(board: Board): string {
  const name = encodeURIComponent;
  switch (board.ats) {
    case 'greenhouse':
      return `https://job-boards.greenhouse.io/${name(board.slug)}`;
    case 'lever':
      return `https://jobs${board.eu ? '.eu' : ''}.lever.co/${name(board.slug)}`;
    case 'ashby':
      return `https://jobs.ashbyhq.com/${name(board.slug)}`;
    case 'workday':
      return board.host.endsWith('.myworkdaysite.com')
        ? `https://${board.host}/recruiting/${name(board.tenant)}/${name(board.site)}`
        : `https://${board.host}/${name(board.site)}`;
  }
}

/** Where a company's jobs are crawled: its board's own link, and the board's identity. */
interface Site {
  key: string;
  url: string;
}

/**
 * The first board among a row's links. `testHost` (dev stacks' test list only): a link to the
 * test site is a company site of its own.
 */
function siteOf(row: ListRow, testHost: string | undefined): Site | undefined {
  for (const link of row.links) {
    const checked = parseCrawlUrl(link);
    if (!checked.ok) continue;
    if (testHost !== undefined && checked.url.hostname === testHost) {
      return { key: `test:${checked.normalizedUrl}`, url: checked.normalizedUrl };
    }
    const board = boardFromUrl(checked.url);
    if (board) {
      const { job: _job, ...whole } = board;
      return { key: boardKey(whole), url: boardUrl(whole) };
    }
  }
  return undefined;
}

/**
 * A row in this country, or one whose places say nothing we can place: lenient, like the
 * keyword filter ("Remote in Canada" is Canada; "Remote" alone could be anywhere).
 */
function inCountry(row: ListRow, country: string): boolean {
  if (row.locations.length === 0) return true;
  return row.locations.some((place) => {
    const code = countryInText(place.replace(/\bremote\s+in\s+/i, ''));
    return code === undefined || code === country;
  });
}

interface Tally {
  name: string;
  matches: number;
  priority: number;
  postedAt: number;
  sites: Map<string, { site: Site; count: number }>;
}

/**
 * #50: which companies a list run crawls. Every open role goes through the keyword filter
 * (T08c: the user's roles and search settings) and must be in `country`; companies are ranked
 * by how many of their roles match (then the best role's priority, the newest role, and the
 * name), and the first `max` whose board we can read are taken. A company's board is the one
 * most of its matching roles link to; companies we cannot read are skipped and counted.
 */
export function pickCompanies(
  rows: ListRow[],
  profile: FilterProfile,
  max: number,
  options: { country?: string; testHost?: string } = {},
): Picked {
  const country = options.country ?? LIST_COUNTRY;
  const byCompany = new Map<string, Tally>();
  let matched = 0;
  for (const row of rows) {
    if (!inCountry(row, country)) continue;
    const verdict = filterJob(
      { title: row.title, locations: row.locations.map((text) => ({ text })) },
      profile,
    );
    if (verdict.state !== 'candidate') continue;
    matched += 1;
    const key = row.company.toLowerCase();
    const tally = byCompany.get(key) ?? {
      name: row.company,
      matches: 0,
      priority: 0,
      postedAt: 0,
      sites: new Map(),
    };
    tally.matches += 1;
    tally.priority = Math.max(tally.priority, verdict.priority);
    tally.postedAt = Math.max(tally.postedAt, row.postedAt ?? 0);
    const site = siteOf(row, options.testHost);
    if (site) {
      const seen = tally.sites.get(site.key);
      tally.sites.set(site.key, { site, count: (seen?.count ?? 0) + 1 });
    }
    byCompany.set(key, tally);
  }

  const ranked = [...byCompany.values()].sort(
    (a, b) =>
      b.matches - a.matches ||
      b.priority - a.priority ||
      b.postedAt - a.postedAt ||
      a.name.localeCompare(b.name),
  );
  const companies: PickedCompany[] = [];
  const taken = new Set<string>();
  let skipped = 0;
  for (const tally of ranked) {
    if (companies.length >= max) break;
    const best = [...tally.sites.values()].sort((a, b) => b.count - a.count)[0]?.site;
    if (!best) {
      skipped += 1;
      continue;
    }
    // Two names for one board (a renamed company) are one crawl.
    if (taken.has(best.key)) continue;
    taken.add(best.key);
    companies.push({ name: tally.name, url: best.url, boardKey: best.key, matches: tally.matches });
  }
  return { rows: rows.length, matched, companiesMatched: byCompany.size, companies, skipped };
}
