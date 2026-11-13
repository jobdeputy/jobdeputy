import { createHash } from 'node:crypto';
import { parseCrawlUrl } from '@jobdeputy/shared';
import { decodeEntities, htmlToText, oneLine, tidy, truncate } from './text.js';

/**
 * One normalized job, whatever it was read from (T07a, decision 0008). Parsers produce
 * `RawJob`s; `finalizeJob` validates and bounds them, and gives each its dedupe key.
 */

/** Job boards whose public data feeds we read. */
export const ATS = ['greenhouse', 'lever', 'ashby', 'workday'] as const;
export type Ats = (typeof ATS)[number];

export type ExtractionMethod = 'ats_feed' | 'schema_org';

export const JOB_LIMITS = {
  titleChars: 300,
  companyChars: 200,
  locationChars: 200,
  maxLocations: 20,
  /** Longer descriptions are cut (and marked); the full text stays on the site. */
  descriptionChars: 32_000,
  urlChars: 2048,
  externalIdChars: 200,
} as const;

export type Workplace = 'onsite' | 'hybrid' | 'remote';
export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'internship' | 'temporary';
export type SalaryPeriod = 'year' | 'month' | 'week' | 'day' | 'hour';

export interface JobLocation {
  /** As the site wrote it. */
  text: string;
  city?: string;
  region?: string;
  /** ISO 3166-1 alpha-2, only when the site gave a code we recognize. */
  country?: string;
}

export interface Salary {
  min?: number;
  max?: number;
  /** ISO 4217. */
  currency: string;
  period: SalaryPeriod;
}

export interface RawLocation {
  text?: unknown;
  city?: unknown;
  region?: unknown;
  country?: unknown;
}

/** What a parser read, before checks. Strings may still hold HTML or be too long. */
export interface RawJob {
  ats?: Ats;
  externalId?: unknown;
  companyName?: unknown;
  title?: unknown;
  locations?: RawLocation[] | undefined;
  workplace?: Workplace;
  employmentType?: EmploymentType;
  salary?: Salary;
  /** HTML (converted to text) or plain text. */
  descriptionHtml?: unknown;
  descriptionText?: unknown;
  jobUrl?: unknown;
  applyUrl?: unknown;
  postedAt?: string | undefined;
  /** Several jobs share this link (one page listing them all): it cannot tell them apart. */
  sharedUrl?: boolean;
}

export interface ExtractedJob {
  /** What identifies the posting; `jobId` is its hash. */
  dedupeKey: string;
  jobId: string;
  /** Who posts it, as far as we know without the shared company list (issue #40). */
  companyKey: string;
  companyName?: string;
  ats?: Ats;
  externalId?: string;
  title: string;
  locations: JobLocation[];
  workplace?: Workplace;
  employmentType?: EmploymentType;
  salary?: Salary;
  /** Plain text. Absent when the listing has none: fetched later, for relevant jobs only (T08). */
  description?: string;
  descriptionTruncated?: boolean;
  jobUrl: string;
  applyUrl?: string;
  /** ISO 8601. */
  postedAt?: string;
  method: ExtractionMethod;
}

export interface JobContext {
  method: ExtractionMethod;
  /** `greenhouse:acme`, `workday:acme.wd5.myworkdayjobs.com/External`, or `site:acme.com`. */
  companyKey: string;
  /** Relative job links are resolved against this. */
  baseUrl: string;
}

export const hashId = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 32);

/** An absolute http(s) link that passes the crawl URL rules, tracking parameters dropped. */
export function safeUrl(value: unknown, base: string): string | undefined {
  if (typeof value !== 'string' || value.length > JOB_LIMITS.urlChars) return undefined;
  let absolute: string;
  try {
    absolute = new URL(value.trim(), base).href;
  } catch {
    return undefined;
  }
  const parsed = parseCrawlUrl(absolute);
  return parsed.ok ? parsed.normalizedUrl : undefined;
}

/** Codes seen in feeds that are not alpha-2; anything else unrecognized is left as text only. */
const COUNTRY_ALIASES: Record<string, string> = {
  USA: 'US',
  'UNITED STATES': 'US',
  'UNITED STATES OF AMERICA': 'US',
  UK: 'GB',
  GBR: 'GB',
  'UNITED KINGDOM': 'GB',
  'GREAT BRITAIN': 'GB',
  IND: 'IN',
  INDIA: 'IN',
  CAN: 'CA',
  CANADA: 'CA',
  DEU: 'DE',
  GERMANY: 'DE',
  IRL: 'IE',
  IRELAND: 'IE',
  AUS: 'AU',
  AUSTRALIA: 'AU',
  SGP: 'SG',
  SINGAPORE: 'SG',
  FRA: 'FR',
  FRANCE: 'FR',
  NLD: 'NL',
  NETHERLANDS: 'NL',
};

export function countryCode(value: unknown): string | undefined {
  const text = oneLine(value, 60)?.toUpperCase();
  if (text === undefined) return undefined;
  // Aliases first: "UK" looks like a code but is not ISO 3166 (it is GB).
  return COUNTRY_ALIASES[text] ?? (/^[A-Z]{2}$/.test(text) ? text : undefined);
}

/** `postedAt` as ISO 8601, or nothing when it is missing, unreadable, or implausible. */
export function isoDate(value: unknown, now: Date): string | undefined {
  let date: Date;
  if (typeof value === 'number') date = new Date(value);
  else if (typeof value === 'string' && value.length <= 40) date = new Date(value.trim());
  else return undefined;
  const time = date.getTime();
  if (Number.isNaN(time)) return undefined;
  if (time < Date.UTC(2000, 0, 1) || time > now.getTime() + 86_400_000) return undefined;
  return date.toISOString();
}

const WORKPLACE: [RegExp, Workplace][] = [
  [/hybrid/i, 'hybrid'],
  [/remote|telecommute|work from home/i, 'remote'],
  [/on-?site|in[- ]office|office/i, 'onsite'],
];

export function workplaceFrom(value: unknown): Workplace | undefined {
  if (typeof value !== 'string') return undefined;
  return WORKPLACE.find(([pattern]) => pattern.test(value))?.[1];
}

const EMPLOYMENT: [RegExp, EmploymentType][] = [
  [/intern/i, 'internship'],
  [/part[-_ ]?time/i, 'part_time'],
  [/full[-_ ]?time|permanent|regular/i, 'full_time'],
  [/contract|freelance/i, 'contract'],
  [/temp|seasonal|fixed[-_ ]?term/i, 'temporary'],
];

export function employmentTypeFrom(value: unknown): EmploymentType | undefined {
  const values = Array.isArray(value) ? value : [value];
  for (const v of values.slice(0, 10)) {
    if (typeof v !== 'string') continue;
    const found = EMPLOYMENT.find(([pattern]) => pattern.test(v))?.[1];
    if (found) return found;
  }
  return undefined;
}

const PERIODS: [RegExp, SalaryPeriod][] = [
  [/hour/i, 'hour'],
  [/day|daily/i, 'day'],
  [/week/i, 'week'],
  [/month/i, 'month'],
  [/year|annual|annum/i, 'year'],
];

/** A salary only when it names a currency and at least one plausible amount. */
export function salaryFrom(
  min: unknown,
  max: unknown,
  currency: unknown,
  period: unknown,
): Salary | undefined {
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(code)) return undefined;
  const amount = (v: unknown) => {
    const n = typeof v === 'string' ? Number(v.replace(/[, ]/g, '')) : v;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1e12 ? n : undefined;
  };
  const low = amount(min);
  const high = amount(max);
  if (low === undefined && high === undefined) return undefined;
  const unit =
    typeof period === 'string'
      ? (PERIODS.find(([pattern]) => pattern.test(period))?.[1] ?? 'year')
      : 'year';
  return {
    ...(low !== undefined ? { min: low } : {}),
    ...(high !== undefined && high !== low ? { max: high } : {}),
    currency: code,
    period: unit,
  };
}

function location(raw: RawLocation): JobLocation | undefined {
  const city = oneLine(raw.city, 100);
  const region = oneLine(raw.region, 100);
  const country = countryCode(raw.country);
  const text =
    oneLine(raw.text, JOB_LIMITS.locationChars) ??
    oneLine(
      [city, region, oneLine(raw.country, 60)].filter(Boolean).join(', '),
      JOB_LIMITS.locationChars,
    );
  if (text === undefined) return undefined;
  return {
    text,
    ...(city ? { city } : {}),
    ...(region ? { region } : {}),
    ...(country ? { country } : {}),
  };
}

/** Some sites escape their HTML once more (`&lt;p&gt;`, Greenhouse); undo that before reading tags. */
function unescapeMarkup(html: string): string {
  return !html.includes('<') && /&lt;[a-z/]/i.test(html) ? decodeEntities(html) : html;
}

/**
 * Checks and bounds one job. `undefined` when it has no title or no usable link: a job
 * the user cannot open is not worth keeping.
 */
export function finalizeJob(raw: RawJob, context: JobContext): ExtractedJob | undefined {
  const title = oneLine(raw.title, JOB_LIMITS.titleChars);
  const jobUrl = safeUrl(raw.jobUrl, context.baseUrl);
  if (title === undefined || jobUrl === undefined) return undefined;

  const applyUrl = safeUrl(raw.applyUrl, context.baseUrl);
  const externalId = oneLine(raw.externalId, JOB_LIMITS.externalIdChars);
  const companyName = oneLine(raw.companyName, JOB_LIMITS.companyChars);
  const seen = new Set<string>();
  const locations = (raw.locations ?? [])
    .slice(0, JOB_LIMITS.maxLocations * 2)
    .map(location)
    .filter((l): l is JobLocation => {
      if (l === undefined || seen.has(l.text)) return false;
      seen.add(l.text);
      return true;
    })
    .slice(0, JOB_LIMITS.maxLocations);

  const fullText =
    typeof raw.descriptionText === 'string'
      ? tidy(raw.descriptionText)
      : typeof raw.descriptionHtml === 'string'
        ? htmlToText(unescapeMarkup(raw.descriptionHtml))
        : '';
  const description = fullText ? truncate(fullText, JOB_LIMITS.descriptionChars) : undefined;

  // 0006: the ATS and its job ID; otherwise the posting's link; otherwise company, title,
  // and location (only when one link lists several jobs).
  const dedupeKey =
    raw.ats && externalId
      ? `ats:${context.companyKey}:${externalId}`
      : raw.sharedUrl
        ? `text:${context.companyKey}|${title}|${locations[0]?.text ?? ''}`.toLowerCase()
        : `url:${jobUrl}`;

  return {
    dedupeKey,
    jobId: hashId(dedupeKey),
    companyKey: context.companyKey,
    ...(companyName ? { companyName } : {}),
    ...(raw.ats ? { ats: raw.ats } : {}),
    ...(externalId ? { externalId } : {}),
    title,
    locations,
    ...(raw.workplace ? { workplace: raw.workplace } : {}),
    ...(raw.employmentType ? { employmentType: raw.employmentType } : {}),
    ...(raw.salary ? { salary: raw.salary } : {}),
    ...(description ? { description: description.text } : {}),
    ...(description?.truncated ? { descriptionTruncated: true } : {}),
    jobUrl,
    ...(applyUrl && applyUrl !== jobUrl ? { applyUrl } : {}),
    ...(raw.postedAt ? { postedAt: raw.postedAt } : {}),
    method: context.method,
  };
}

/**
 * Finalizes a list: invalid jobs are counted as skipped, and a job listed twice (same
 * key) is kept once, so one crawl never writes the same job twice.
 */
export function finalizeJobs(
  raws: RawJob[],
  context: JobContext,
): { jobs: ExtractedJob[]; skipped: number } {
  const byId = new Map<string, ExtractedJob>();
  let skipped = 0;
  for (const raw of raws) {
    const job = finalizeJob(raw, context);
    if (job === undefined) skipped += 1;
    else if (!byId.has(job.jobId)) byId.set(job.jobId, job);
  }
  return { jobs: [...byId.values()], skipped };
}

/**
 * Changes when what the user reads changes (a change means re-score). The description
 * has its own hash: a board's list has none, and must not look like a change to a job
 * whose description was fetched later (T08).
 */
export function contentHash(job: ExtractedJob): string {
  const content = [
    job.title,
    job.companyName ?? '',
    job.locations.map((l) => l.text).join('|'),
    job.workplace ?? '',
    job.employmentType ?? '',
    job.salary ? JSON.stringify(job.salary) : '',
    job.applyUrl ?? '',
  ].join('\n');
  return createHash('sha256').update(content).digest('hex').slice(0, 32);
}

export function descriptionHash(description: string): string {
  return createHash('sha256').update(description).digest('hex').slice(0, 32);
}
