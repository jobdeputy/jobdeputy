import { describe, expect, it } from 'vitest';
import {
  hasPasswordField,
  isLoginUrl,
  looksLikeJavaScriptShell,
  SHELL_MAX_HTML_CHARS,
  visibleText,
} from '../src/fetch/detect.js';

describe('isLoginUrl', () => {
  it.each([
    'https://example.com/login',
    'https://example.com/Login?next=/jobs',
    'https://example.com/users/sign_in',
    'https://example.com/sign-in',
    'https://example.com/signin.html',
    'https://example.com/auth/realms/x',
    'https://example.com/oauth2/authorize',
    'https://example.com/sso',
    'https://accounts.google.com/o/oauth2/auth',
    'https://login.microsoftonline.com/common',
    'https://acme.okta.com/app',
  ])('%s is a sign-in page', (url) => {
    expect(isLoginUrl(new URL(url))).toBe(true);
  });

  it.each([
    'https://example.com/careers',
    'https://example.com/jobs/authoring-engineer',
    'https://example.com/blog/login-tips',
    'https://example.com/careers?source=login',
    'https://okta.com.example.org/jobs',
  ])('%s is not', (url) => {
    expect(isLoginUrl(new URL(url))).toBe(false);
  });
});

describe('hasPasswordField', () => {
  it.each([
    '<form><input type="password" name="p"></form>',
    "<INPUT TYPE='PASSWORD'>",
    '<input name="p" type=password autocomplete="current-password">',
    '<input\n  class="x"\n  type = "password"\n/>',
  ])('finds %s', (html) => {
    expect(hasPasswordField(html)).toBe(true);
  });

  it.each([
    '<input type="text" name="q">',
    '<p>Forgot your password?</p>',
    '<input type="passwordless">',
    '<a href="/login">Candidate login</a>',
  ])('ignores %s', (html) => {
    expect(hasPasswordField(html)).toBe(false);
  });

  it('stays fast on many unclosed inputs', () => {
    const html = '<input '.repeat(200_000);
    const started = performance.now();
    expect(hasPasswordField(html)).toBe(false);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe('visibleText', () => {
  it('drops scripts, styles, comments, head, and tags', () => {
    const html =
      '<html><head><title>T</title><style>p{}</style></head><body><!-- c --><h1>Jobs</h1><script>var x = "<p>no</p>";</script><p>Engineer&nbsp;— Pune</p></body></html>';
    expect(visibleText(html)).toBe('Jobs Engineer — Pune');
  });

  it('handles upper-case tags and non-ASCII text without shifting', () => {
    expect(visibleText('<SCRIPT>x</SCRIPT><P>İstanbul Ünal</P>')).toBe('İstanbul Ünal');
  });

  it('stays fast on unclosed comments and scripts', () => {
    for (const piece of ['<!--', '<script>', '<', '<style']) {
      const html = `ok ${piece.repeat(100_000)}`;
      const started = performance.now();
      expect(visibleText(html)).toBe('ok');
      expect(performance.now() - started).toBeLessThan(2_000);
    }
  });
});

describe('looksLikeJavaScriptShell', () => {
  const shell =
    '<!doctype html><html><head><script src="/app.js"></script></head><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript></body></html>';

  it('recognizes an empty single-page-app shell', () => {
    expect(looksLikeJavaScriptShell(shell)).toBe(true);
  });

  it('does not flag a page with real content', () => {
    const jobs = Array.from(
      { length: 20 },
      (_, i) => `<li>Software Engineer ${i}, Pune, Full time</li>`,
    ).join('');
    expect(
      looksLikeJavaScriptShell(
        `<html><body><ul>${jobs}</ul><script src="/a.js"></script></body></html>`,
      ),
    ).toBe(false);
  });

  it.each([
    ['a Vue mount', '<html><body><div id="app"></div><script src="/v.js"></script></body></html>'],
    [
      'a Next.js mount',
      "<html><body><div id='__next'></div><script src=/n.js></script></body></html>",
    ],
    [
      'an Angular root',
      '<html><body><app-root></app-root><script src="main.js"></script></body></html>',
    ],
    ['an unquoted id', '<html><body><div id=root></div><script src=/r.js></script></body></html>'],
    [
      'only a noscript note',
      '<html><body><noscript>Please turn on JavaScript.</noscript><div></div><script src=/x.js></script></body></html>',
    ],
  ])('recognizes %s', (_, html) => {
    expect(looksLikeJavaScriptShell(html)).toBe(true);
  });

  it('does not flag a short page that happens to load a script (example.com)', () => {
    const html =
      '<!doctype html><html lang=en><head><title>Example Domain</title><style>body{}</style></head><body><p>This domain is for use in documentation examples without needing permission.</p><a href=https://iana.org/help/example-domains>Learn more</a><script src=/s.js></script></body></html>';
    expect(looksLikeJavaScriptShell(html)).toBe(false);
  });

  it('stays fast on many unclosed noscript tags', () => {
    const html = `<script></script><body>${'<noscript'.repeat(50_000)}`;
    const started = performance.now();
    expect(looksLikeJavaScriptShell(html)).toBe(false);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('does not flag a short page without scripts (nothing to render)', () => {
    expect(looksLikeJavaScriptShell('<html><body>No openings</body></html>')).toBe(false);
  });

  it.each([
    '<script type="application/ld+json">{"@type":"JobPosting"}</script>',
    '<script id="__NEXT_DATA__" type="application/json">{}</script>',
    '<script>window.__NUXT__={}</script>',
    '<script>window.__INITIAL_STATE__={}</script>',
  ])('does not flag a shell that embeds data (%s)', (data) => {
    expect(
      looksLikeJavaScriptShell(shell.replace('<div id="root">', `${data}<div id="root">`)),
    ).toBe(false);
  });

  it('leaves large pages to extraction', () => {
    const big = `${shell}<script>${'x'.repeat(SHELL_MAX_HTML_CHARS)}</script>`;
    expect(looksLikeJavaScriptShell(big)).toBe(false);
  });
});
