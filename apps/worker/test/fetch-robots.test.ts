import { describe, expect, it } from 'vitest';
import { parseRobots, robotsAllows, ruleMatches } from '../src/fetch/robots.js';

const allows = (robots: string, url: string) => robotsAllows(robots, new URL(url));

describe('ruleMatches (RFC 9309 §2.2.3)', () => {
  it.each([
    ['/', '/anything', true],
    ['/jobs', '/jobs', true],
    ['/jobs', '/jobs/123', true],
    ['/jobs', '/jobsearch', true],
    ['/jobs/', '/jobs', false],
    ['/jobs$', '/jobs', true],
    ['/jobs$', '/jobs/1', false],
    ['/*.pdf$', '/files/cv.pdf', true],
    ['/*.pdf$', '/files/cv.pdf?x=1', false],
    ['/*/apply', '/jobs/1/apply', true],
    ['/*/apply', '/apply', false],
    ['*', '/x', true],
    ['/a*b*c', '/aXXbYYc', true],
    ['/a*b*c', '/aXXcYYb', false],
    ['/search?q=', '/search?q=engineer', true],
  ])('%s matches %s: %s', (rule, path, expected) => {
    expect(ruleMatches(rule, path)).toBe(expected);
  });

  it('stays fast on a hostile pattern', () => {
    const rule = `/${'*a'.repeat(200)}$`;
    const path = `/${'a'.repeat(20_000)}b`;
    const started = performance.now();
    expect(ruleMatches(rule, path)).toBe(false);
    // Generous bound: a backtracking regex would take far longer than this.
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe('robotsAllows', () => {
  it('allows everything for an empty or missing file', () => {
    expect(allows('', 'https://example.com/jobs')).toBe(true);
  });

  it('uses * rules when nothing names us', () => {
    const robots = 'User-agent: *\nDisallow: /private\n';
    expect(allows(robots, 'https://example.com/private/x')).toBe(false);
    expect(allows(robots, 'https://example.com/jobs')).toBe(true);
  });

  it('uses our own group instead of *, case-insensitively and ignoring versions', () => {
    const robots = [
      'User-agent: *',
      'Disallow: /',
      '',
      'User-agent: JobDeputyBot/1.0',
      'Disallow: /admin',
    ].join('\n');
    expect(allows(robots, 'https://example.com/jobs')).toBe(true);
    expect(allows(robots, 'https://example.com/admin')).toBe(false);
  });

  it('merges several groups that name us', () => {
    const robots =
      'User-agent: jobdeputybot\nDisallow: /a\n\nUser-agent: JOBDEPUTYBOT\nDisallow: /b\n';
    expect(allows(robots, 'https://example.com/a')).toBe(false);
    expect(allows(robots, 'https://example.com/b')).toBe(false);
    expect(allows(robots, 'https://example.com/c')).toBe(true);
  });

  it('applies a group listing several agents to each of them', () => {
    const robots = 'User-agent: Googlebot\nUser-agent: JobDeputyBot\nDisallow: /jobs\n';
    expect(allows(robots, 'https://example.com/jobs')).toBe(false);
  });

  it('does not treat another bot as us', () => {
    const robots = 'User-agent: JobDeputyBotX\nDisallow: /\n';
    expect(allows(robots, 'https://example.com/jobs')).toBe(true);
  });

  it('refuses everything with Disallow: /', () => {
    expect(allows('User-agent: *\nDisallow: /', 'https://example.com/')).toBe(false);
  });

  it('treats an empty Disallow as allowing everything', () => {
    expect(allows('User-agent: *\nDisallow:\n', 'https://example.com/jobs')).toBe(true);
  });

  it('lets the longest rule win, and allow win a tie', () => {
    const robots =
      'User-agent: *\nDisallow: /careers\nAllow: /careers/jobs\nDisallow: /same\nAllow: /same\n';
    expect(allows(robots, 'https://example.com/careers/jobs/1')).toBe(true);
    expect(allows(robots, 'https://example.com/careers/about')).toBe(false);
    expect(allows(robots, 'https://example.com/same')).toBe(true);
  });

  it('matches against the path and query', () => {
    const robots = 'User-agent: *\nDisallow: /*?page=\n';
    expect(allows(robots, 'https://example.com/jobs?page=2')).toBe(false);
    expect(allows(robots, 'https://example.com/jobs')).toBe(true);
  });

  it('matches percent-encoded paths against unencoded rules', () => {
    const robots = 'User-agent: *\nDisallow: /café\n';
    expect(allows(robots, 'https://example.com/café/jobs')).toBe(false);
  });

  it('always allows robots.txt itself', () => {
    expect(allows('User-agent: *\nDisallow: /', 'https://example.com/robots.txt')).toBe(true);
  });

  it('ignores comments, other fields, odd spacing, and CRLF', () => {
    const robots =
      '# hello\r\nUSER-AGENT : * # all\r\nCrawl-delay: 10\r\nSitemap: https://example.com/s.xml\r\n  disallow :  /x  # no\r\n';
    expect(allows(robots, 'https://example.com/x')).toBe(false);
    expect(allows(robots, 'https://example.com/y')).toBe(true);
  });

  it('ignores rules before any User-agent line', () => {
    expect(allows('Disallow: /\n', 'https://example.com/jobs')).toBe(true);
  });

  it('starts a new group only when a User-agent follows rules', () => {
    const groups = parseRobots(
      'User-agent: a\nUser-agent: b\nDisallow: /x\nUser-agent: c\nDisallow: /y\n',
    );
    expect(groups.map((g) => g.agents)).toEqual([['a', 'b'], ['c']]);
  });
});
