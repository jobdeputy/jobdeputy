/**
 * robots.txt rules per RFC 9309 (0007: respected for every crawl, including URLs a
 * user submits). A site's robots.txt is untrusted input, so matching uses a linear
 * wildcard matcher, never a regular expression built from the file.
 */

/** The product token sites write in `User-agent:` lines to address us. */
export const ROBOTS_TOKEN = 'jobdeputybot';

/** RFC 9309 §2.5: crawlers must parse at least 500 KiB; anything after it is ignored. */
export const MAX_ROBOTS_BYTES = 500 * 1024;

const MAX_RULES = 10_000;

interface Rule {
  allow: boolean;
  path: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
}

/** Percent-encodes characters outside printable ASCII, as the URL we compare with is. */
function encodePath(path: string): string {
  return path.replace(/[^\x21-\x7e]/g, (c) => encodeURIComponent(c));
}

/** The token part of a `User-agent:` value (`JobDeputyBot/1.0` → `jobdeputybot`). */
function agentToken(value: string): string {
  return (/^[a-z_-]+|^\*/i.exec(value)?.[0] ?? '').toLowerCase();
}

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | undefined;
  let collectingAgents = false;
  let ruleCount = 0;

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === 'user-agent') {
      if (current === undefined || !collectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(agentToken(value));
      collectingAgents = true;
    } else if ((key === 'allow' || key === 'disallow') && current !== undefined) {
      collectingAgents = false;
      // An empty `Disallow:` allows everything, which is the default anyway.
      if (value !== '' && ruleCount < MAX_RULES) {
        current.rules.push({ allow: key === 'allow', path: encodePath(value) });
        ruleCount += 1;
      }
    }
    // Other lines (Sitemap, Crawl-delay, unknown) are ignored and do not end a group.
  }
  return groups;
}

/**
 * RFC 9309 §2.2.3: `*` matches any sequence and a trailing `$` anchors the end;
 * otherwise a rule matches any path it is a prefix of. Greedy with backtracking to the
 * last `*`: O(pattern × path) at worst.
 */
export function ruleMatches(rulePath: string, path: string): boolean {
  const anchored = rulePath.endsWith('$');
  const pattern = anchored ? rulePath.slice(0, -1) : `${rulePath}*`;
  let p = 0;
  let s = 0;
  let star = -1;
  let mark = 0;
  while (s < path.length) {
    if (p < pattern.length && pattern[p] !== '*' && pattern[p] === path[s]) {
      p += 1;
      s += 1;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p;
      mark = s;
      p += 1;
    } else if (star !== -1) {
      p = star + 1;
      mark += 1;
      s = mark;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '*') p += 1;
  return p === pattern.length;
}

/**
 * Whether `url` may be fetched. Our own groups win over `*` (groups naming the same
 * agent are merged); the longest matching rule wins, and `allow` wins a tie. No
 * matching group or rule means allowed.
 */
export function robotsAllows(robotsTxt: string, url: URL, token = ROBOTS_TOKEN): boolean {
  if (url.pathname === '/robots.txt') return true;
  const groups = parseRobots(robotsTxt);
  const ours = groups.filter((g) => g.agents.includes(token));
  const applicable = ours.length > 0 ? ours : groups.filter((g) => g.agents.includes('*'));
  const path = encodePath(url.pathname + url.search);

  let best: Rule | undefined;
  for (const rule of applicable.flatMap((g) => g.rules)) {
    if (!ruleMatches(rule.path, path)) continue;
    const longer = best === undefined || rule.path.length > best.path.length;
    const tieToAllow = best !== undefined && rule.path.length === best.path.length && rule.allow;
    if (longer || tieToAllow) best = rule;
  }
  return best?.allow ?? true;
}
