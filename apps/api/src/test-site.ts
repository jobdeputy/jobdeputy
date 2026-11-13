import type { HttpResponse } from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

/**
 * Dev stacks only (T06b): fixed public pages the crawl integration tests fetch, so they
 * never depend on someone else's site. Holds no data and reads nothing. Its URL is the
 * stack's own API, which resolves to public addresses like any website.
 */

const html = (
  statusCode: number,
  body: string,
  headers: Record<string, string> = {},
): HttpResponse => ({
  statusCode,
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers },
  body,
});

const jobs = Array.from(
  { length: 5 },
  (_, i) =>
    `<li><a href="/test-site/jobs/${i + 1}">Software Engineer ${i + 1}</a> · Pune, India · Full time · Posted 2026-09-2${i}</li>`,
).join('\n');

/** Two postings described with schema.org data (T07b), as search engines ask sites to. */
const postings = JSON.stringify([
  {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: 'Backend Engineer',
    description:
      '<p>Build the APIs of Example Test Co.</p><ul><li>TypeScript</li><li>AWS</li></ul>',
    identifier: { '@type': 'PropertyValue', name: 'Example Test Co', value: 'BE-1' },
    datePosted: '2026-09-20',
    employmentType: 'FULL_TIME',
    hiringOrganization: { '@type': 'Organization', name: 'Example Test Co' },
    jobLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: 'Pune', addressCountry: 'IN' },
    },
    url: '/test-site/jobs-schema-org/backend-engineer',
  },
  {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: 'Data Engineer',
    description: 'Move data around. Synthetic posting for integration tests.',
    datePosted: '2026-09-22',
    jobLocationType: 'TELECOMMUTE',
    hiringOrganization: { '@type': 'Organization', name: 'Example Test Co' },
    url: '/test-site/jobs-schema-org/data-engineer',
  },
]).replaceAll('</', '<\\/');

export const PAGES: Record<string, () => HttpResponse> = {
  /** A careers page with schema.org job data: two jobs to read (T07b). */
  'jobs-schema-org': () =>
    html(
      200,
      `<!doctype html><html lang="en"><head><title>Careers at Example Test Co</title><script type="application/ld+json">${postings}</script></head><body><h1>Open roles</h1><p>Synthetic test page for JobDeputy's integration tests.</p></body></html>`,
    ),
  /** A normal careers page, with jobs only as plain HTML: nothing we can read yet (0008). */
  jobs: () =>
    html(
      200,
      `<!doctype html><html lang="en"><head><title>Careers at Example Test Co</title></head><body><h1>Open roles</h1><p>We are hiring engineers across India. Synthetic test page for JobDeputy's integration tests.</p><ul>\n${jobs}\n</ul></body></html>`,
    ),
  /** An SSRF attempt: a public page that redirects to the cloud metadata address. */
  'redirect-metadata': () => ({
    statusCode: 302,
    headers: { location: 'http://169.254.169.254/latest/meta-data/', 'cache-control': 'no-store' },
    body: '',
  }),
  /** A sign-in form. */
  login: () =>
    html(
      200,
      '<!doctype html><html><body><h1>Sign in</h1><form method="post"><input name="email" type="email"><input name="password" type="password"><button>Sign in</button></form></body></html>',
    ),
  /** A single-page-app shell with no content until JavaScript runs. */
  shell: () =>
    html(
      200,
      '<!doctype html><html><head><script src="/test-site/app.js"></script></head><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript></body></html>',
    ),
  /** The site refuses bots. */
  blocked: () => html(403, '<h1>Forbidden</h1>'),
  /** Temporarily down: a retriable failure, so the crawl stays active for minutes. */
  unavailable: () => html(503, '<h1>Try again later</h1>'),
};

export async function handler(event: APIGatewayProxyEventV2): Promise<HttpResponse> {
  if (process.env.STAGE !== 'dev') return html(404, 'Not found');
  const name = event.pathParameters?.page ?? '';
  // Own keys only: `constructor` and friends are not pages.
  return Object.hasOwn(PAGES, name)
    ? (PAGES[name] as () => HttpResponse)()
    : html(404, '<h1>Not found</h1>');
}
