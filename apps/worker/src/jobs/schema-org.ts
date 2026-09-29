import {
  type ExtractedJob,
  employmentTypeFrom,
  finalizeJobs,
  isoDate,
  type RawJob,
  type RawLocation,
  safeUrl,
  salaryFrom,
} from './job.js';

/**
 * schema.org `JobPosting` data embedded in a page (T07a): the format search engines ask
 * sites to publish for their job listings, so many careers pages and ATS job pages
 * carry it (Workday's do). Bounded: a page cannot make us parse or walk without end.
 */
export const SCHEMA_ORG_LIMITS = {
  maxBlocks: 50,
  maxBlockChars: 1024 * 1024,
  /** Objects visited across all blocks. */
  maxNodes: 5000,
  maxDepth: 6,
} as const;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** Lowercases ASCII only, so every index still points at the same character. */
const asciiLower = (text: string) => text.replace(/[A-Z]+/g, (m) => m.toLowerCase());

/** The contents of each `<script type="application/ld+json">`. A linear scan. */
export function jsonLdBlocks(html: string): string[] {
  const lower = asciiLower(html);
  const blocks: string[] = [];
  let at = lower.indexOf('<script');
  while (at !== -1 && blocks.length < SCHEMA_ORG_LIMITS.maxBlocks) {
    const tagEnd = lower.indexOf('>', at);
    if (tagEnd === -1) break;
    const close = lower.indexOf('</script', tagEnd);
    if (close === -1) break;
    if (/type\s*=\s*["']?application\/ld\+json/.test(lower.slice(at, Math.min(tagEnd, at + 500)))) {
      const content = html.slice(tagEnd + 1, close);
      if (content.length <= SCHEMA_ORG_LIMITS.maxBlockChars) blocks.push(content.trim());
    }
    at = lower.indexOf('<script', close + 8);
  }
  return blocks;
}

function isJobPosting(node: Json): boolean {
  const type = node['@type'];
  return Array.isArray(type) ? type.includes('JobPosting') : type === 'JobPosting';
}

/** Every `JobPosting` in the parsed blocks, including inside `@graph` and item lists. */
export function findJobPostings(values: unknown[]): Json[] {
  const found: Json[] = [];
  let visited = 0;
  const visit = (value: unknown, depth: number) => {
    if (depth > SCHEMA_ORG_LIMITS.maxDepth || visited >= SCHEMA_ORG_LIMITS.maxNodes) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!isObject(value)) return;
    visited += 1;
    if (isJobPosting(value)) {
      found.push(value);
      return;
    }
    visit(value['@graph'], depth + 1);
    visit(value.itemListElement, depth + 1);
    visit(value.item, depth + 1);
  };
  for (const value of values) visit(value, 0);
  return found;
}

function place(value: unknown): RawLocation[] {
  const places = (Array.isArray(value) ? value : [value]).filter(isObject).slice(0, 40);
  return places.flatMap((p): RawLocation[] => {
    const address = p.address;
    if (typeof address === 'string') return [{ text: address }];
    if (!isObject(address)) return typeof p.name === 'string' ? [{ text: p.name }] : [];
    const country = address.addressCountry;
    return [
      {
        city: address.addressLocality,
        region: address.addressRegion,
        country: isObject(country) ? country.name : country,
      },
    ];
  });
}

function salary(value: unknown) {
  if (!isObject(value)) return undefined;
  const amount = value.value;
  if (isObject(amount)) {
    return salaryFrom(
      amount.minValue ?? amount.value,
      amount.maxValue,
      value.currency,
      amount.unitText,
    );
  }
  return salaryFrom(amount, undefined, value.currency, value.unitText);
}

function toRawJob(node: Json, now: Date): RawJob | undefined {
  // An expired posting is no longer open.
  const validThrough = typeof node.validThrough === 'string' ? Date.parse(node.validThrough) : NaN;
  if (validThrough < now.getTime()) return undefined;
  const organization = first(node.hiringOrganization);
  const identifier = first(node.identifier);
  const remote = [node.jobLocationType].flat().includes('TELECOMMUTE');
  const employmentType = employmentTypeFrom(node.employmentType);
  const pay = salary(first(node.baseSalary));
  return {
    externalId: isObject(identifier) ? identifier.value : identifier,
    companyName: isObject(organization) ? organization.name : organization,
    title: node.title ?? node.name,
    locations: place(node.jobLocation),
    ...(remote ? { workplace: 'remote' as const } : {}),
    ...(employmentType ? { employmentType } : {}),
    ...(pay ? { salary: pay } : {}),
    descriptionHtml: node.description,
    jobUrl: node.url,
    postedAt: isoDate(node.datePosted, now),
  };
}

export interface SchemaOrgResult {
  jobs: ExtractedJob[];
  skipped: number;
  /** Expired by their own `validThrough`. */
  expired: number;
}

/** Jobs a page describes with schema.org `JobPosting` data. */
export function jobsFromSchemaOrg(html: string, pageUrl: string, now: Date): SchemaOrgResult {
  const values: unknown[] = [];
  for (const block of jsonLdBlocks(html)) {
    try {
      values.push(JSON.parse(block));
    } catch {
      // A broken block is skipped; others on the page may be fine.
    }
  }
  const postings = findJobPostings(values);
  const raws: RawJob[] = [];
  let expired = 0;
  for (const posting of postings) {
    const raw = toRawJob(posting, now);
    if (raw === undefined) expired += 1;
    // No link, or an unusable one: the page itself is where the posting is.
    else raws.push({ ...raw, jobUrl: safeUrl(raw.jobUrl, pageUrl) ?? pageUrl });
  }
  // Several postings with one link (usually the page's own) cannot be told apart by it.
  const urlCounts = new Map<unknown, number>();
  for (const raw of raws) urlCounts.set(raw.jobUrl, (urlCounts.get(raw.jobUrl) ?? 0) + 1);
  const marked = raws.map((raw) =>
    (urlCounts.get(raw.jobUrl) ?? 0) > 1 ? { ...raw, sharedUrl: true } : raw,
  );
  const host = new URL(pageUrl).hostname.replace(/^www\./, '');
  const { jobs, skipped } = finalizeJobs(marked, {
    method: 'schema_org',
    companyKey: `site:${host}`,
    baseUrl: pageUrl,
  });
  return { jobs, skipped, expired };
}
