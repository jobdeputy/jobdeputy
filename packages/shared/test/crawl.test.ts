import { describe, expect, it } from 'vitest';
import { CRAWL_ERRORS, type CrawlErrorCode, MAX_URL_LENGTH, parseCrawlUrl } from '../src/index.js';

function codeOf(raw: string): CrawlErrorCode | 'ok' {
  const result = parseCrawlUrl(raw);
  return result.ok ? 'ok' : result.code;
}

describe('parseCrawlUrl', () => {
  it.each([
    ['https://boards.greenhouse.io/acme', 'https://boards.greenhouse.io/acme'],
    ['  https://example.com  ', 'https://example.com/'],
    ['HTTPS://Example.COM/Careers', 'https://example.com/Careers'],
    ['https://example.com./jobs', 'https://example.com/jobs'],
    ['https://example.com:443/jobs', 'https://example.com/jobs'],
    ['http://example.com:80/jobs', 'http://example.com/jobs'],
    ['https://example.com/jobs#team', 'https://example.com/jobs'],
    [
      'https://example.com/jobs?q=engineer&utm_source=x&gclid=1',
      'https://example.com/jobs?q=engineer',
    ],
    ['https://example.com/jobs?utm_medium=a&fbclid=b', 'https://example.com/jobs'],
    ['https://bücher.example/jobs', 'https://xn--bcher-kva.example/jobs'],
    [
      'https://acme.wd5.myworkdayjobs.com/en-US/careers',
      'https://acme.wd5.myworkdayjobs.com/en-US/careers',
    ],
  ])('accepts and normalizes %s', (raw, normalized) => {
    const result = parseCrawlUrl(raw);
    expect(result.ok && result.normalizedUrl).toBe(normalized);
  });

  it('keeps query parameters that select jobs', () => {
    const result = parseCrawlUrl('https://example.com/search?location=Pune&team=eng');
    expect(result.ok && result.normalizedUrl).toBe(
      'https://example.com/search?location=Pune&team=eng',
    );
  });

  it.each([
    ['empty', ''],
    ['not a URL', 'careers page'],
    ['a relative path', '/jobs'],
    ['file', 'file:///etc/passwd'],
    ['ftp', 'ftp://example.com/'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html,hi'],
    ['gopher (classic SSRF)', 'gopher://example.com:70/'],
    ['credentials', 'https://user:secret@example.com/'],
    ['a username only', 'https://user@example.com/'],
    ['a non-standard port', 'https://example.com:8443/'],
    ['port 22', 'http://example.com:22/'],
    ['an empty label', 'https://a..example.com/'],
    ['a too-long label', `https://${'a'.repeat(64)}.com/`],
    ['too long', `https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`],
  ])('refuses %s as invalid_url', (_, raw) => {
    expect(codeOf(raw)).toBe('invalid_url');
  });

  it.each([
    ['IPv4 loopback', 'http://127.0.0.1/'],
    ['short loopback', 'http://127.1/'],
    ['hex loopback', 'http://0x7f.0.0.1/'],
    ['mixed hex', 'http://0x7f.1/'],
    ['decimal loopback', 'http://2130706433/'],
    ['octal loopback', 'http://0177.0.0.1/'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['a public IP literal (names only)', 'http://8.8.8.8/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['IPv4-mapped IPv6', 'http://[::ffff:127.0.0.1]/'],
    ['IPv6 metadata', 'http://[fd00:ec2::254]/'],
    ['localhost', 'http://localhost/'],
    ['a localhost subdomain', 'http://app.localhost/'],
    ['a trailing-dot localhost', 'http://localhost./'],
    ['a single-label name', 'http://intranet-wiki/'],
    ['.internal (GCP metadata)', 'http://metadata.google.internal/'],
    ['.local', 'http://printer.local/'],
    ['.home.arpa', 'http://router.home.arpa/'],
  ])('refuses %s as blocked_address', (_, raw) => {
    expect(codeOf(raw)).toBe('blocked_address');
  });

  it.each([
    'https://www.linkedin.com/jobs/search?keywords=engineer',
    'https://linkedin.com/company/acme/jobs',
    'https://in.linkedin.com/jobs',
    'https://lnkd.in/abc',
  ])('refuses login-only site %s', (raw) => {
    expect(codeOf(raw)).toBe('login_required');
  });

  it('does not treat look-alike names as LinkedIn', () => {
    expect(codeOf('https://notlinkedin.com/jobs')).toBe('ok');
    expect(codeOf('https://linkedin.com.example.org/jobs')).toBe('ok');
  });

  it('returns the message shown to the user', () => {
    const result = parseCrawlUrl('http://127.0.0.1/');
    expect(result).toEqual({
      ok: false,
      code: 'blocked_address',
      message: CRAWL_ERRORS.blocked_address,
    });
  });
});
