import { describe, expect, it } from 'vitest';
import {
  crawlLimitsConfig,
  DEFAULT_CRAWL_LIMITS,
  dailyListLimitMessage,
  githubListFromUrl,
  listUrl,
} from '../src/index.js';

const list = (url: string) => githubListFromUrl(new URL(url));

describe('githubListFromUrl (#50)', () => {
  it('reads a repository link, with or without a path inside it', () => {
    const expected = { kind: 'github', owner: 'SimplifyJobs', repo: 'New-Grad-Positions' };
    expect(list('https://github.com/SimplifyJobs/New-Grad-Positions')).toEqual(expected);
    expect(list('https://github.com/SimplifyJobs/New-Grad-Positions/')).toEqual(expected);
    expect(list('https://www.github.com/SimplifyJobs/New-Grad-Positions/tree/dev')).toEqual(
      expected,
    );
    expect(list('https://github.com/SimplifyJobs/New-Grad-Positions/blob/dev/README.md')).toEqual(
      expected,
    );
    expect(list('https://github.com/SimplifyJobs/New-Grad-Positions.git')).toEqual(expected);
    expect(list('https://GITHUB.com/a/b?tab=readme#top')).toEqual({
      kind: 'github',
      owner: 'a',
      repo: 'b',
    });
  });

  it('is nothing for other links, owners alone, or GitHub pages that are not repositories', () => {
    for (const url of [
      'https://github.com/SimplifyJobs',
      'https://github.com/',
      'https://github.com/topics/jobs',
      'https://github.com/orgs/acme/repos',
      'https://github.com/settings/profile',
      'https://gist.github.com/a/b',
      'https://raw.githubusercontent.com/a/b/HEAD/README.md',
      'https://notgithub.com/a/b',
      'https://github.com.evil.example/a/b',
      'https://github.com/-a/b',
      'https://github.com/a/.hidden',
      'https://job-boards.greenhouse.io/acme',
    ]) {
      expect(list(url), url).toBeUndefined();
    }
  });

  it('gives one link per repository, however it was written', () => {
    expect(listUrl({ kind: 'github', owner: 'SimplifyJobs', repo: 'New-Grad-Positions' })).toBe(
      'https://github.com/simplifyjobs/new-grad-positions',
    );
    expect(listUrl({ kind: 'test', url: 'https://x.example/test-site/list-a' })).toBe(
      'https://x.example/test-site/list-a',
    );
  });
});

describe('list limits (#50)', () => {
  it('defaults to 2 lists a day and 20 companies a list, also when the admin setting predates them', () => {
    expect(DEFAULT_CRAWL_LIMITS).toMatchObject({ listsPerDay: 2, listCompanies: 20 });
    const { listsPerDay: _l, listCompanies: _c, ...older } = DEFAULT_CRAWL_LIMITS;
    expect(crawlLimitsConfig.parse(older)).toMatchObject({ listsPerDay: 2, listCompanies: 20 });
    expect(crawlLimitsConfig.safeParse({ ...older, listCompanies: 51 }).success).toBe(false);
    expect(crawlLimitsConfig.safeParse({ ...older, listsPerDay: 0 }).success).toBe(true);
  });

  it("says how many of the day's lists are used", () => {
    expect(dailyListLimitMessage(2, 2)).toBe(
      "You've used 2 of 2 list runs today. Resets at 00:00 UTC.",
    );
  });
});
