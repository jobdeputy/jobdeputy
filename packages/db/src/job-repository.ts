import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

/**
 * `jobs` (docs/data-model.md §8, decision 0008): jobs found for the user. Keys: `userId`,
 * `jobId` (a hash of the posting's dedupe key), so a posting is stored once per user and
 * every re-crawl updates the same item.
 */

export interface JobLocation {
  text: string;
  city?: string;
  region?: string;
  country?: string;
}

/** What one crawl read about one posting (the posting group of the item). */
export interface JobPosting {
  jobId: string;
  dedupeKey: string;
  title: string;
  jobUrl: string;
  companyKey: string;
  locations: JobLocation[];
  /** Over what the crawl read, except the description (see `descriptionHash`). */
  contentHash: string;
  companyName?: string;
  applyUrl?: string;
  ats?: string;
  externalId?: string;
  workplace?: string;
  employmentType?: string;
  salary?: { min?: number; max?: number; currency: string; period: string };
  description?: string;
  descriptionTruncated?: boolean;
  /** Set with the description: a list without descriptions leaves both as they were. */
  descriptionHash?: string;
  postedAt?: string;
  extraction: { method: string; version: number };
}

export type JobStatus = 'new' | 'shortlisted' | 'dismissed' | 'applying' | 'applied' | 'archived';

export interface Job extends JobPosting {
  userId: string;
  type: 'job';
  sourceIds: Set<string>;
  firstCrawlId: string;
  lastCrawlId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  closedAt?: string;
  status: JobStatus;
  starred: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
}

/**
 * Optional posting fields a re-crawl sets when it read them and otherwise leaves alone:
 * a board's list can carry less than the posting itself (T08 fills in descriptions,
 * Workday places), so a missing field is not evidence it went away.
 */
const OPTIONAL_POSTING = [
  'companyName',
  'applyUrl',
  'ats',
  'externalId',
  'workplace',
  'employmentType',
  'salary',
  'description',
  'descriptionTruncated',
  'descriptionHash',
  'postedAt',
] as const;

export interface SaveContext {
  sourceId: string;
  crawlId: string;
}

export interface SaveStats {
  /** Jobs the crawl read (after duplicates within it were removed). */
  found: number;
  /** Not stored before. */
  created: number;
  /** Stored before, and what the user reads changed. */
  updated: number;
}

/** Writes at the same time while saving one crawl's jobs: fast, and gentle on the table. */
export const SAVE_CONCURRENCY = 10;

export class JobRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Creates or updates each job, one idempotent update per job (a retried crawl writes
   * the same values again). Never overwrites the user's own fields (`status`,
   * `starred`, `notes`), and never removes a field this crawl did not read.
   */
  async save(userId: string, jobs: JobPosting[], context: SaveContext): Promise<SaveStats> {
    const stats: SaveStats = { found: jobs.length, created: 0, updated: 0 };
    const now = this.now().toISOString();
    let next = 0;
    const lane = async () => {
      while (next < jobs.length) {
        const job = jobs[next++] as JobPosting;
        const outcome = await this.saveOne(userId, job, context, now);
        if (outcome === 'created') stats.created += 1;
        else if (outcome === 'updated') stats.updated += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(SAVE_CONCURRENCY, jobs.length) }, lane));
    return stats;
  }

  private async saveOne(
    userId: string,
    job: JobPosting,
    context: SaveContext,
    now: string,
  ): Promise<'created' | 'updated' | 'unchanged'> {
    // Every attribute name goes through a placeholder: several are reserved words
    // (`status`, `type`, `name`, …), and a mocked client cannot tell.
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const set: string[] = [];
    const bind = (attribute: string, value: unknown, onlyIfMissing = false) => {
      const i = set.length;
      names[`#a${i}`] = attribute;
      values[`:v${i}`] = value;
      set.push(onlyIfMissing ? `#a${i} = if_not_exists(#a${i}, :v${i})` : `#a${i} = :v${i}`);
    };

    bind('type', 'job');
    bind('dedupeKey', job.dedupeKey);
    bind('title', job.title);
    bind('jobUrl', job.jobUrl);
    bind('companyKey', job.companyKey);
    bind('contentHash', job.contentHash);
    bind('extraction', job.extraction);
    // Required, but a list may name no places ("3 Locations"): keep ones read before.
    bind('locations', job.locations, job.locations.length === 0);
    for (const field of OPTIONAL_POSTING) {
      if (job[field] !== undefined) bind(field, job[field]);
    }
    bind('lastCrawlId', context.crawlId);
    bind('lastSeenAt', now);
    bind('updatedAt', now);
    bind('schemaVersion', 1);
    bind('firstCrawlId', context.crawlId, true);
    bind('firstSeenAt', now, true);
    bind('createdAt', now, true);
    bind('status', 'new', true);
    bind('starred', false, true);

    names['#sourceIds'] = 'sourceIds';
    names['#closedAt'] = 'closedAt';
    values[':source'] = new Set([context.sourceId]);

    const res = await this.client.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { userId, jobId: job.jobId },
        // Seen again: open (T07c closes jobs a complete crawl no longer lists).
        UpdateExpression: `SET ${set.join(', ')} ADD #sourceIds :source REMOVE #closedAt`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'UPDATED_OLD',
      }),
    );
    // `type` is set on every save: no old value means the item did not exist.
    const old = res.Attributes;
    if (old?.type === undefined) return 'created';
    const changed =
      old.contentHash !== job.contentHash ||
      (job.descriptionHash !== undefined && old.descriptionHash !== job.descriptionHash);
    return changed ? 'updated' : 'unchanged';
  }

  async get(userId: string, jobId: string): Promise<Job | undefined> {
    const res = await this.client.send(
      new GetCommand({ TableName: this.table, Key: { userId, jobId } }),
    );
    return res.Item as Job | undefined;
  }

  /**
   * One page of the user's jobs, in key order (stable, not by time: `jobId` is a hash).
   * Sorting and filtering by relevance come with T08 and the interface (T09).
   */
  async list(
    userId: string,
    limit: number,
    after?: string,
  ): Promise<{ items: Job[]; next?: string }> {
    const res = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'userId = :u',
        ExpressionAttributeValues: { ':u': userId },
        Limit: limit,
        ...(after !== undefined ? { ExclusiveStartKey: { userId, jobId: after } } : {}),
      }),
    );
    const last = res.LastEvaluatedKey?.jobId;
    return {
      items: (res.Items ?? []) as Job[],
      ...(typeof last === 'string' ? { next: last } : {}),
    };
  }
}
