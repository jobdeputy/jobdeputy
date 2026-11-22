/**
 * #50: list runs. A list (a GitHub repository of open roles, such as SimplifyJobs
 * New-Grad-Positions) is used only to find companies; each company's own board is then
 * crawled. Decision: the comment of 2026-11-22 on issue #50.
 */

/** Where a list is read from. `test` exists on dev stacks only (the integration tests' own list). */
export type ListSource =
  | { kind: 'github'; owner: string; repo: string }
  | { kind: 'test'; url: string };

/** Lists a day (`crawlLimitsConfig.listsPerDay`) and companies per list (`listCompanies`) are admin settings. */
export const DEFAULT_LISTS_PER_DAY = 2;
export const DEFAULT_LIST_COMPANIES = 20;
/** Company crawls one list keeps queued or running at the same time. */
export const LIST_CONCURRENCY = 3;

const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;
/** github.com paths that are not repositories. */
const RESERVED_OWNERS = new Set([
  'about',
  'apps',
  'collections',
  'enterprise',
  'explore',
  'features',
  'login',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'organizations',
  'pricing',
  'search',
  'settings',
  'sponsors',
  'topics',
  'trending',
  'users',
]);

/**
 * The GitHub repository a link points at: `github.com/<owner>/<repo>`, with or without a
 * path inside it (`/tree/dev`, `/blob/dev/README.md`). Undefined for anything else. Pure, so
 * the API and the web app (#50 PR B) recognise a list link the same way.
 */
export function githubListFromUrl(url: URL): Extract<ListSource, { kind: 'github' }> | undefined {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host !== 'github.com' && host !== 'www.github.com') return undefined;
  const [owner, rawRepo] = url.pathname.split('/').filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/, '');
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) return undefined;
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return undefined;
  return { kind: 'github', owner, repo };
}

/** One canonical link per list, so `/tree/dev` and the bare repository are one source. */
export function listUrl(source: ListSource): string {
  return source.kind === 'github'
    ? `https://github.com/${source.owner}/${source.repo}`.toLowerCase()
    : source.url;
}

export function dailyListLimitMessage(used: number, limit: number): string {
  return `You've used ${used} of ${limit} list runs today. Resets at 00:00 UTC.`;
}
