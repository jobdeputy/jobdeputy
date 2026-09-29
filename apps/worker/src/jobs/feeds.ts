import { type Board, boardKey, FEED_PAGE_SIZE } from './boards.js';
import {
  type ExtractedJob,
  employmentTypeFrom,
  finalizeJobs,
  isoDate,
  type RawJob,
  salaryFrom,
  workplaceFrom,
} from './job.js';
import { htmlToText, tidy } from './text.js';

/**
 * Readers for job-board data feeds (T07a). Feeds are untrusted JSON: every field is
 * checked for its type before use, and a feed that is not the expected shape fails as
 * a whole (the site changed its format), rather than yielding half-read jobs.
 */

/** The feed is not what this reader expects. Not retried: the same answer comes back. */
export class FeedFormatError extends Error {
  override name = 'FeedFormatError';
}

export interface FeedPage {
  jobs: ExtractedJob[];
  /** Listings without a title or a usable link. */
  skipped: number;
  /** Where the next page starts, when the feed has more. */
  nextOffset?: number;
  /** The board's total, when the feed says. */
  total?: number;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new FeedFormatError('The feed is not valid JSON');
  }
}

function greenhouseJob(job: Json, now: Date): RawJob {
  return {
    ats: 'greenhouse',
    externalId: job.id,
    companyName: job.company_name,
    title: job.title,
    locations: isObject(job.location) ? [{ text: job.location.name }] : [],
    // Only a single posting carries `content` (escaped HTML).
    ...(typeof job.content === 'string' ? { descriptionHtml: job.content } : {}),
    jobUrl: job.absolute_url,
    postedAt: isoDate(job.first_published, now) ?? isoDate(job.updated_at, now),
  };
}

function greenhouse(data: unknown, now: Date, single: boolean): RawJob[] {
  if (single) {
    if (!isObject(data) || data.id === undefined) throw new FeedFormatError('No posting');
    return [greenhouseJob(data, now)];
  }
  if (!isObject(data) || !Array.isArray(data.jobs)) throw new FeedFormatError('No jobs list');
  return data.jobs.filter(isObject).map((job) => greenhouseJob(job, now));
}

/** Lever splits a posting into an opening, lists (responsibilities, requirements), and a closing. */
function leverDescription(job: Json): string | undefined {
  const parts = [str(job.descriptionPlain)];
  for (const item of list(job.lists).filter(isObject).slice(0, 20)) {
    const content = str(item.content);
    parts.push(
      [str(item.text), content ? htmlToText(content) : undefined].filter(Boolean).join('\n'),
    );
  }
  parts.push(str(job.additionalPlain));
  const text = tidy(parts.filter(Boolean).join('\n\n'));
  return text || undefined;
}

function lever(data: unknown, now: Date, single: boolean): RawJob[] {
  if (single) {
    if (!isObject(data) || data.id === undefined) throw new FeedFormatError('No posting');
    data = [data];
  }
  if (!Array.isArray(data)) throw new FeedFormatError('No postings list');
  return data.filter(isObject).map((job) => {
    const categories = isObject(job.categories) ? job.categories : {};
    const all = list(categories.allLocations).filter((l) => typeof l === 'string');
    const names = all.length > 0 ? all : [categories.location];
    const range = isObject(job.salaryRange) ? job.salaryRange : {};
    const salary = salaryFrom(range.min, range.max, range.currency, range.interval);
    const workplace = workplaceFrom(job.workplaceType);
    const employmentType = employmentTypeFrom(categories.commitment);
    const description = leverDescription(job);
    return {
      ats: 'lever',
      externalId: job.id,
      title: job.text,
      // The country code only applies when there is one location.
      locations: names.map((text) => ({
        text,
        ...(names.length === 1 ? { country: job.country } : {}),
      })),
      ...(workplace ? { workplace } : {}),
      ...(employmentType ? { employmentType } : {}),
      ...(salary ? { salary } : {}),
      ...(description ? { descriptionText: description } : {}),
      jobUrl: job.hostedUrl,
      applyUrl: job.applyUrl,
      postedAt: isoDate(job.createdAt, now),
    } satisfies RawJob;
  });
}

function ashbyLocation(text: unknown, address: unknown) {
  const postal = isObject(address) && isObject(address.postalAddress) ? address.postalAddress : {};
  return {
    text,
    city: postal.addressLocality,
    region: postal.addressRegion,
    country: postal.addressCountry,
  };
}

function ashbySalary(compensation: unknown) {
  if (!isObject(compensation)) return undefined;
  const salary = list(compensation.summaryComponents)
    .filter(isObject)
    .find((c) => c.compensationType === 'Salary');
  return salary
    ? salaryFrom(salary.minValue, salary.maxValue, salary.currencyCode, salary.interval)
    : undefined;
}

function ashby(data: unknown, now: Date, job?: string): RawJob[] {
  if (!isObject(data) || !Array.isArray(data.jobs)) throw new FeedFormatError('No jobs list');
  return data.jobs
    .filter(isObject)
    .filter((posting) => posting.isListed !== false && (job === undefined || posting.id === job))
    .map((job) => {
      const workplace =
        workplaceFrom(job.workplaceType) ?? (job.isRemote === true ? 'remote' : undefined);
      const employmentType = employmentTypeFrom(job.employmentType);
      const salary = ashbySalary(job.compensation);
      return {
        ats: 'ashby',
        externalId: job.id,
        title: job.title,
        locations: [
          ashbyLocation(job.location, job.address),
          ...list(job.secondaryLocations)
            .filter(isObject)
            .map((l) => ashbyLocation(l.location, l.address)),
        ],
        ...(workplace ? { workplace } : {}),
        ...(employmentType ? { employmentType } : {}),
        ...(salary ? { salary } : {}),
        ...(typeof job.descriptionPlain === 'string'
          ? { descriptionText: job.descriptionPlain }
          : { descriptionHtml: job.descriptionHtml }),
        jobUrl: job.jobUrl,
        applyUrl: job.applyUrl,
        postedAt: isoDate(job.publishedAt, now),
      } satisfies RawJob;
    });
}

/** Workday shows only relative dates: "Posted Today", "Posted 3 Days Ago", "Posted 30+ Days Ago". */
export function workdayPostedAt(value: unknown, now: Date): string | undefined {
  if (typeof value !== 'string') return undefined;
  const day = (ago: number) =>
    new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ago),
    ).toISOString();
  if (/posted today/i.test(value)) return day(0);
  if (/posted yesterday/i.test(value)) return day(1);
  const days = /posted (\d{1,2}) days ago/i.exec(value);
  // "30+ Days Ago" has no date to give.
  return days ? day(Number(days[1])) : undefined;
}

function workday(data: unknown, board: Extract<Board, { ats: 'workday' }>, now: Date): RawJob[] {
  if (!isObject(data) || !Array.isArray(data.jobPostings)) {
    throw new FeedFormatError('No jobPostings list');
  }
  return data.jobPostings.filter(isObject).map((job) => {
    const path = str(job.externalPath);
    const locations = str(job.locationsText);
    return {
      ats: 'workday',
      // The requisition ID ends the path (`…/Senior-Engineer_JR2022268`); the title part can change.
      externalId: path?.split('_').pop(),
      title: job.title,
      // "3 Locations" is a count, not a place: the posting itself lists them.
      locations: locations && !/^\d+ locations$/i.test(locations) ? [{ text: locations }] : [],
      jobUrl: path?.startsWith('/') ? `https://${board.host}/${board.site}${path}` : undefined,
      postedAt: workdayPostedAt(job.postedOn, now),
    } satisfies RawJob;
  });
}

/** One Workday posting, with its description (`GET …/job/<path>`). */
function workdayPosting(
  data: unknown,
  board: Extract<Board, { ats: 'workday' }>,
  now: Date,
): RawJob[] {
  const info = isObject(data) && isObject(data.jobPostingInfo) ? data.jobPostingInfo : undefined;
  if (info === undefined) throw new FeedFormatError('No jobPostingInfo');
  const organization =
    isObject(data) && isObject(data.hiringOrganization) ? data.hiringOrganization : {};
  const employmentType = employmentTypeFrom(info.timeType);
  const workplace = workplaceFrom(info.remoteType);
  const locations = [info.location, ...list(info.additionalLocations)].filter(
    (l) => typeof l === 'string',
  );
  return [
    {
      ats: 'workday',
      externalId: info.jobReqId,
      companyName: organization.name,
      title: info.title,
      locations: locations.map((text) => ({ text })),
      ...(workplace ? { workplace } : {}),
      ...(employmentType ? { employmentType } : {}),
      descriptionHtml: info.jobDescription,
      jobUrl:
        info.externalUrl ??
        (board.job ? `https://${board.host}/${board.site}/job/${board.job}` : undefined),
      postedAt: isoDate(info.startDate, now) ?? workdayPostedAt(info.postedOn, now),
    },
  ];
}

/** Reads one page of a board's feed, or one posting. `offset` is the one the request was made with. */
export function parseFeed(board: Board, body: string, offset: number, now: Date): FeedPage {
  const data = parseJson(body);
  const context = {
    method: 'ats_feed' as const,
    companyKey: boardKey(board),
    baseUrl: feedBase(board),
  };
  switch (board.ats) {
    case 'greenhouse':
      return finalizeJobs(greenhouse(data, now, board.job !== undefined), context);
    case 'ashby':
      return finalizeJobs(ashby(data, now, board.job), context);
    case 'lever': {
      const raws = lever(data, now, board.job !== undefined);
      const page = finalizeJobs(raws, context);
      return board.job === undefined && raws.length === FEED_PAGE_SIZE.lever
        ? { ...page, nextOffset: offset + raws.length }
        : page;
    }
    case 'workday': {
      if (board.job) return finalizeJobs(workdayPosting(data, board, now), context);
      const raws = workday(data, board, now);
      const page = finalizeJobs(raws, context);
      // Workday gives the total on the first page only (later pages say 0).
      const total =
        isObject(data) && typeof data.total === 'number' && data.total > 0 ? data.total : undefined;
      const more =
        raws.length === FEED_PAGE_SIZE.workday &&
        (total === undefined || offset + raws.length < total);
      return {
        ...page,
        ...(total !== undefined ? { total } : {}),
        ...(more ? { nextOffset: offset + raws.length } : {}),
      };
    }
  }
}

/** Relative links in a feed are resolved against the board's public site. */
function feedBase(board: Board): string {
  switch (board.ats) {
    case 'greenhouse':
      return `https://job-boards.greenhouse.io/${board.slug}`;
    case 'lever':
      return `https://jobs${board.eu ? '.eu' : ''}.lever.co/${board.slug}`;
    case 'ashby':
      return `https://jobs.ashbyhq.com/${board.slug}`;
    case 'workday':
      return `https://${board.host}/${board.site}`;
  }
}
