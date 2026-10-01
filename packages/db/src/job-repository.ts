import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { BatchGetCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { isConditionFailure } from './client.js';

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
  /** T08c: what the code filter and the company limit decided in this crawl. */
  fit?: JobFit;
}

/** T08c: the code filter's verdict, and why (docs/data-model.md §8). */
export interface JobFilterResult {
  state: 'candidate' | 'not_relevant';
  roleIds: string[];
  reasons: string[];
  priority: number;
  version: number;
}

export type LimitState = 'counted' | 'over_limit';

export interface JobFit {
  filter: JobFilterResult;
  /** Candidates only: shown within the company's limit, or not. */
  limitState?: LimitState;
}

/**
 * T08d: the LLM's score for the job and what it was scored on (docs/data-model.md §8). A
 * re-crawl scores the job again only when `inputsHash` changes.
 */
export interface JobRelevance {
  /** 0–100. */
  score: number;
  /** One of the user's roles, when one fits. */
  bestRoleId?: string;
  /** At most 3 short reasons, from the model. */
  reasons: string[];
  model: string;
  promptVersion: string;
  /** Over the job's content and description hashes, the profile, and the prompt version. */
  inputsHash: string;
  scoredAt: string;
}

/** T08d: what a scoring run decided for one job. */
export interface RelevanceDecision {
  jobId: string;
  /** Scored too low: the filter's verdict becomes `not_relevant` with these reasons. */
  hide?: { reasons: string[] };
  /** Otherwise: shown within its company's limit, or not. */
  limitState?: LimitState;
}

/** Hidden jobs expire (T08c): the filter dropped them, or the company limit did. */
export const isHidden = (fit: JobFit) =>
  fit.filter.state === 'not_relevant' || fit.limitState === 'over_limit';

export type JobStatus = 'new' | 'shortlisted' | 'dismissed' | 'applying' | 'applied' | 'archived';

export interface Job extends JobPosting {
  userId: string;
  type: 'job';
  /** Saved pages that currently list it; absent once none does (then `closedAt` is set). */
  sourceIds?: Set<string>;
  firstCrawlId: string;
  lastCrawlId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  closedAt?: string;
  filter?: JobFilterResult;
  limitState?: LimitState;
  /** T08d: the LLM's score, when it has scored the job. */
  relevance?: JobRelevance;
  /** Epoch seconds: DynamoDB deletes the job after this (T08c, hidden or closed and untouched). */
  ttl?: number;
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
  /** T08c: epoch seconds a job hidden now is deleted at (kept if it was already hidden). */
  expiresAt?: number;
}

/** A job a crawl closed, so its company's shown list can free its place. */
export interface ClosedJob {
  jobId: string;
  companyKey: string;
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
/** DynamoDB's limit of keys per BatchGetItem. */
const BATCH_GET_MAX = 100;
const BATCH_GET_ATTEMPTS = 4;

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

    // Seen again: open (T07c closes jobs a complete crawl no longer lists).
    const remove = ['#closedAt'];
    const { fit } = job;
    const hides = fit !== undefined && isHidden(fit) && context.expiresAt !== undefined;
    if (fit) {
      bind('filter', fit.filter);
      if (fit.limitState) bind('limitState', fit.limitState);
      else {
        names['#limitState'] = 'limitState';
        remove.push('#limitState');
      }
      // Hidden: expires 7 days after it was first hidden, not after every crawl. Shown: kept.
      if (hides) bind('ttl', context.expiresAt, true);
      else if (!isHidden(fit)) {
        names['#ttl'] = 'ttl';
        remove.push('#ttl');
      }
    }

    names['#sourceIds'] = 'sourceIds';
    names['#closedAt'] = 'closedAt';
    values[':source'] = new Set([context.sourceId]);

    const res = await this.client.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { userId, jobId: job.jobId },
        UpdateExpression: `SET ${set.join(', ')} ADD #sourceIds :source REMOVE ${remove.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'UPDATED_OLD',
      }),
    );
    // `type` is set on every save: no old value means the item did not exist.
    const old = res.Attributes;
    // A job the user acted on is their history: never expired by the filter (T09 sets status).
    if (hides && old?.status !== undefined && old.status !== 'new') {
      await this.client
        .send(
          new UpdateCommand({
            TableName: this.table,
            Key: { userId, jobId: job.jobId },
            UpdateExpression: 'REMOVE #ttl',
            ConditionExpression: 'attribute_exists(userId) AND #status <> :new',
            ExpressionAttributeNames: { '#ttl': 'ttl', '#status': 'status' },
            ExpressionAttributeValues: { ':new': 'new' },
          }),
        )
        .catch((error) => {
          if (!isConditionFailure(error)) throw error;
        });
    }
    if (old?.type === undefined) return 'created';
    const changed =
      old.contentHash !== job.contentHash ||
      (job.descriptionHash !== undefined && old.descriptionHash !== job.descriptionHash);
    return changed ? 'updated' : 'unchanged';
  }

  /**
   * T07c: jobs this source listed before and a complete crawl of it no longer lists. The
   * source is removed from each job's `sourceIds`; a job no saved page lists any more is
   * closed (`closedAt`). Safe to repeat, and to race a crawl of another source that lists
   * the job again: closing requires `sourceIds` to still be empty. T08c: a closed job the
   * user never acted on (`status` `new`) expires at `expiresAt`. Returns the jobs closed.
   */
  async closeMissing(
    userId: string,
    sourceId: string,
    jobIds: string[],
    expiresAt?: number,
  ): Promise<ClosedJob[]> {
    const now = this.now().toISOString();
    const closed: ClosedJob[] = [];
    let next = 0;
    const lane = async () => {
      while (next < jobIds.length) {
        const jobId = jobIds[next++] as string;
        const job = await this.dropSource(userId, sourceId, jobId, now, expiresAt);
        if (job) closed.push(job);
      }
    };
    await Promise.all(Array.from({ length: Math.min(SAVE_CONCURRENCY, jobIds.length) }, lane));
    return closed;
  }

  /** Returns the job when this closed it, or nothing when it was not closed now. */
  private async dropSource(
    userId: string,
    sourceId: string,
    jobId: string,
    now: string,
    expiresAt?: number,
  ): Promise<ClosedJob | undefined> {
    try {
      const res = await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { userId, jobId },
          // An empty set is removed, so `sourceIds` is gone when no source lists the job.
          UpdateExpression: 'DELETE #sourceIds :source SET updatedAt = :now',
          ConditionExpression: 'attribute_exists(userId)',
          ExpressionAttributeNames: { '#sourceIds': 'sourceIds' },
          ExpressionAttributeValues: { ':source': new Set([sourceId]), ':now': now },
          ReturnValues: 'ALL_NEW',
        }),
      );
      const job = res.Attributes;
      if (job?.sourceIds !== undefined || job?.closedAt !== undefined) return undefined;
      // Untouched by the user: expires (kept sooner if it was already hidden). Else kept.
      const expires = expiresAt !== undefined && job?.status === 'new';
      await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { userId, jobId },
          UpdateExpression: `SET #closedAt = :now, updatedAt = :now${expires ? ', #ttl = if_not_exists(#ttl, :ttl)' : ''}`,
          ConditionExpression:
            'attribute_not_exists(#sourceIds) AND attribute_not_exists(#closedAt)',
          ExpressionAttributeNames: {
            '#sourceIds': 'sourceIds',
            '#closedAt': 'closedAt',
            ...(expires ? { '#ttl': 'ttl' } : {}),
          },
          ExpressionAttributeValues: { ':now': now, ...(expires ? { ':ttl': expiresAt } : {}) },
        }),
      );
      return { jobId, companyKey: String(job?.companyKey ?? '') };
    } catch (error) {
      // The job is gone, was listed again meanwhile, or is already closed.
      if (isConditionFailure(error)) return undefined;
      throw error;
    }
  }

  /**
   * T08d3: jobs whose posting answered 404 or 410 while its board still lists it. Closed
   * like a job no page lists (a later crawl that lists it opens it again); untouched by
   * the user (`status` `new`), it expires at `expiresAt`. Returns the jobs closed now.
   */
  async closeGone(userId: string, jobIds: string[], expiresAt: number): Promise<ClosedJob[]> {
    const now = this.now().toISOString();
    const closed: ClosedJob[] = [];
    await this.eachJob(jobIds, async (jobId) => {
      try {
        const res = await this.client.send(
          new UpdateCommand({
            TableName: this.table,
            Key: { userId, jobId },
            UpdateExpression: 'SET #closedAt = :now, updatedAt = :now',
            ConditionExpression: 'attribute_exists(userId) AND attribute_not_exists(#closedAt)',
            ExpressionAttributeNames: { '#closedAt': 'closedAt' },
            ExpressionAttributeValues: { ':now': now },
            ReturnValues: 'ALL_NEW',
          }),
        );
        const job = res.Attributes;
        closed.push({ jobId, companyKey: String(job?.companyKey ?? '') });
        if (job?.status !== 'new') return;
        await this.client.send(
          new UpdateCommand({
            TableName: this.table,
            Key: { userId, jobId },
            UpdateExpression: 'SET #ttl = if_not_exists(#ttl, :ttl)',
            // Not when it was opened again or acted on meanwhile.
            ConditionExpression: '#closedAt = :now AND #status = :new',
            ExpressionAttributeNames: {
              '#ttl': 'ttl',
              '#closedAt': 'closedAt',
              '#status': 'status',
            },
            ExpressionAttributeValues: { ':ttl': expiresAt, ':now': now, ':new': 'new' },
          }),
        );
      } catch (error) {
        // Deleted, already closed, or changed meanwhile.
        if (!isConditionFailure(error)) throw error;
      }
    });
    return closed;
  }

  /**
   * T08c: jobs another crawl pushed out of their company's shown list. Hidden, so they
   * expire at `expiresAt` unless the user acted on them. Missing jobs are skipped.
   */
  async markOverLimit(userId: string, jobIds: string[], expiresAt: number): Promise<void> {
    await this.eachJob(jobIds, (jobId) =>
      this.hideOrShow(userId, jobId, { set: { limitState: 'over_limit' } }, expiresAt),
    );
  }

  /**
   * T08d: applies a scoring run's decisions. A job scored too low gets the filter's
   * `not_relevant` verdict; the others their place in the company's limit. Hidden jobs
   * expire at `expiresAt` unless the user acted on them (T08c's rule); shown ones never
   * expire. Missing jobs are skipped; repeating is harmless.
   */
  async applyRelevance(
    userId: string,
    decisions: RelevanceDecision[],
    expiresAt: number,
  ): Promise<void> {
    const byId = new Map(decisions.map((d) => [d.jobId, d]));
    await this.eachJob([...byId.keys()], (jobId) => {
      const d = byId.get(jobId) as RelevanceDecision;
      if (d.hide) {
        return this.hideOrShow(
          userId,
          jobId,
          {
            set: { 'filter.state': 'not_relevant', 'filter.reasons': d.hide.reasons },
            remove: ['limitState'],
          },
          expiresAt,
        );
      }
      if (d.limitState === 'over_limit') {
        return this.hideOrShow(userId, jobId, { set: { limitState: 'over_limit' } }, expiresAt);
      }
      return this.hideOrShow(userId, jobId, {
        set: { limitState: 'counted' },
        remove: ['ttl'],
      });
    });
  }

  /** Runs `write` for each job, SAVE_CONCURRENCY at a time. */
  private async eachJob(jobIds: string[], write: (jobId: string) => Promise<void>) {
    let next = 0;
    const lane = async () => {
      while (next < jobIds.length) await write(jobIds[next++] as string);
    };
    await Promise.all(Array.from({ length: Math.min(SAVE_CONCURRENCY, jobIds.length) }, lane));
  }

  /**
   * Sets (and removes) fields on an existing job. With `expiresAt` the job is hidden: it
   * expires then if the user never acted on it (`status` `new`), else it is kept. Missing
   * jobs are skipped. Paths like `filter.state` set one field of a map.
   */
  private async hideOrShow(
    userId: string,
    jobId: string,
    change: { set: Record<string, unknown>; remove?: string[] },
    expiresAt?: number,
  ): Promise<void> {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = { ':now': this.now().toISOString() };
    const path = (field: string) =>
      field
        .split('.')
        .map((part) => {
          names[`#${part}`] = part;
          return `#${part}`;
        })
        .join('.');
    const sets = Object.entries(change.set).map(([field, value], i) => {
      values[`:v${i}`] = value;
      return `${path(field)} = :v${i}`;
    });
    sets.push('updatedAt = :now');
    const removes = (change.remove ?? []).map(path);
    for (const expires of expiresAt === undefined ? [false] : [true, false]) {
      try {
        await this.client.send(
          new UpdateCommand({
            TableName: this.table,
            Key: { userId, jobId },
            UpdateExpression: `SET ${[...sets, ...(expires ? [`${path('ttl')} = if_not_exists(#ttl, :ttl)`] : [])].join(', ')}${removes.length > 0 ? ` REMOVE ${removes.join(', ')}` : ''}`,
            ConditionExpression: expires
              ? `attribute_exists(userId) AND ${path('status')} = :new`
              : 'attribute_exists(userId)',
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: {
              ...values,
              ...(expires ? { ':ttl': expiresAt, ':new': 'new' } : {}),
            },
          }),
        );
        return;
      } catch (error) {
        // Not `new` (the user acted on it): change it without an expiry. Gone: skip.
        if (!isConditionFailure(error)) throw error;
      }
    }
  }

  /** T08d: the given jobs (missing ones left out), read consistently. */
  async getMany(userId: string, jobIds: string[]): Promise<Job[]> {
    return (await this.batchGet(userId, jobIds, { ConsistentRead: true })) as unknown as Job[];
  }

  /** T08d3: which of these jobs already have a description (missing jobs have none). */
  async withDescription(userId: string, jobIds: string[]): Promise<Set<string>> {
    const found = await this.batchGet(userId, jobIds, {
      ProjectionExpression: 'jobId, descriptionHash',
    });
    return new Set(
      found.filter((j) => j.descriptionHash !== undefined).map((j) => String(j.jobId)),
    );
  }

  private async batchGet(
    userId: string,
    jobIds: string[],
    options: { ConsistentRead?: boolean; ProjectionExpression?: string },
  ): Promise<Record<string, unknown>[]> {
    const found: Record<string, unknown>[] = [];
    for (let i = 0; i < jobIds.length; i += BATCH_GET_MAX) {
      let keys: Record<string, unknown>[] = jobIds
        .slice(i, i + BATCH_GET_MAX)
        .map((jobId) => ({ userId, jobId }));
      for (let attempt = 1; keys.length > 0; attempt++) {
        if (attempt > BATCH_GET_ATTEMPTS) throw new Error('jobs not read after retries');
        const res = await this.client.send(
          new BatchGetCommand({ RequestItems: { [this.table]: { Keys: keys, ...options } } }),
        );
        found.push(...(res.Responses?.[this.table] ?? []));
        // Throttled reads come back unprocessed: wait a little and read them again.
        keys = res.UnprocessedKeys?.[this.table]?.Keys ?? [];
        if (keys.length > 0) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      }
    }
    return found;
  }

  async get(userId: string, jobId: string): Promise<Job | undefined> {
    const res = await this.client.send(
      new GetCommand({ TableName: this.table, Key: { userId, jobId } }),
    );
    return res.Item as Job | undefined;
  }

  /**
   * One page of the user's jobs, in key order (stable, not by time: `jobId` is a hash).
   * `shown` (T08c) leaves out jobs the filter or the company limit hid; then a page can
   * hold fewer than `limit` jobs (even none) and still have a next one. Sorting comes
   * with the interface (T09).
   */
  async list(
    userId: string,
    limit: number,
    after?: string,
    view: 'shown' | 'all' = 'all',
  ): Promise<{ items: Job[]; next?: string }> {
    const shown = view === 'shown';
    const res = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'userId = :u',
        ...(shown
          ? {
              FilterExpression:
                '(attribute_not_exists(#filter.#state) OR #filter.#state <> :dropped) AND (attribute_not_exists(#limitState) OR #limitState <> :over)',
              ExpressionAttributeNames: {
                '#filter': 'filter',
                '#state': 'state',
                '#limitState': 'limitState',
              },
            }
          : {}),
        ExpressionAttributeValues: {
          ':u': userId,
          ...(shown ? { ':dropped': 'not_relevant', ':over': 'over_limit' } : {}),
        },
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
