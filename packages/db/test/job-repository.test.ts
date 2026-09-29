import type { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { type JobPosting, JobRepository, SAVE_CONCURRENCY } from '../src/index.js';

const NOW = new Date('2026-09-29T12:00:00.000Z');
const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const CONTEXT = { sourceId: 'S1', crawlId: '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2D' };

function posting(over: Partial<JobPosting> = {}): JobPosting {
  return {
    jobId: 'a'.repeat(32),
    dedupeKey: 'ats:greenhouse:acme:1',
    title: 'Backend Engineer',
    jobUrl: 'https://job-boards.greenhouse.io/acme/jobs/1',
    companyKey: 'greenhouse:acme',
    locations: [{ text: 'Dublin' }],
    contentHash: 'h1',
    ats: 'greenhouse',
    externalId: '1',
    extraction: { method: 'ats_feed', version: 1 },
    ...over,
  };
}

function client(handler: (cmd: unknown) => unknown = () => ({})) {
  const send = vi.fn(async (cmd: unknown) => handler(cmd));
  return { c: { send } as unknown as DynamoDBDocumentClient, send };
}

/** The update as DynamoDB would read it: placeholders replaced by names and values. */
function readable(cmd: UpdateCommand) {
  const {
    UpdateExpression = '',
    ExpressionAttributeNames = {},
    ExpressionAttributeValues = {},
  } = cmd.input;
  const byName = Object.fromEntries(
    [...UpdateExpression.matchAll(/(#\w+) = (if_not_exists\(#\w+, (:\w+)\)|(:\w+))/g)].map((m) => [
      ExpressionAttributeNames[m[1] as string],
      {
        value: ExpressionAttributeValues[(m[3] ?? m[4]) as string],
        onlyIfMissing: m[3] !== undefined,
      },
    ]),
  );
  return { expression: UpdateExpression, byName, names: ExpressionAttributeNames };
}

/** The first command sent (fails the test if there was none). */
function firstSent<T>(send: { mock: { calls: unknown[][] } }): T {
  const call = send.mock.calls[0];
  if (!call) throw new Error('Nothing was sent');
  return call[0] as T;
}

const repo = (c: DynamoDBDocumentClient) => new JobRepository(c, 'Jobs', () => NOW);

describe('JobRepository.save', () => {
  it('writes the posting, and first-seen and user fields only if missing', async () => {
    const { c, send } = client();
    await repo(c).save(USER, [posting({ description: 'Build.', descriptionHash: 'd1' })], CONTEXT);
    const cmd = firstSent<UpdateCommand>(send);
    expect(cmd.input.Key).toEqual({ userId: USER, jobId: 'a'.repeat(32) });
    const { byName, expression } = readable(cmd);
    for (const [field, value] of Object.entries({
      type: 'job',
      title: 'Backend Engineer',
      contentHash: 'h1',
      description: 'Build.',
      descriptionHash: 'd1',
      lastCrawlId: CONTEXT.crawlId,
      lastSeenAt: NOW.toISOString(),
    })) {
      expect(byName[field], field).toEqual({ value, onlyIfMissing: false });
    }
    // The user's own fields and first sightings: set once, never overwritten by a re-crawl.
    for (const [field, value] of Object.entries({
      status: 'new',
      starred: false,
      firstCrawlId: CONTEXT.crawlId,
      firstSeenAt: NOW.toISOString(),
      createdAt: NOW.toISOString(),
    })) {
      expect(byName[field], field).toEqual({ value, onlyIfMissing: true });
    }
    expect(byName).not.toHaveProperty('notes');
    expect(expression).toContain('ADD #sourceIds :source');
    expect(cmd.input.ExpressionAttributeValues?.[':source']).toEqual(new Set(['S1']));
    // Seen again: reopened.
    expect(expression).toContain('REMOVE #closedAt');
    expect(cmd.input.ReturnValues).toBe('UPDATED_OLD');
  });

  it('never removes or blanks a field this crawl did not read', async () => {
    const { c, send } = client();
    await repo(c).save(USER, [posting({ locations: [] })], CONTEXT);
    const { byName, expression } = readable(firstSent<UpdateCommand>(send));
    for (const field of ['description', 'descriptionHash', 'companyName', 'salary', 'postedAt']) {
      expect(byName, field).not.toHaveProperty(field);
    }
    expect(expression).not.toMatch(/REMOVE .*(description|salary)/);
    // No places in this list ("3 Locations"): keep the ones read before.
    expect(byName.locations).toEqual({ value: [], onlyIfMissing: true });
  });

  it('uses placeholders for every attribute name (several are reserved words)', async () => {
    const { c, send } = client();
    await repo(c).save(USER, [posting()], CONTEXT);
    const expression = firstSent<UpdateCommand>(send).input.UpdateExpression ?? '';
    const bare = expression
      .replace(/if_not_exists\(/g, '(')
      .replace(/\b(SET|ADD|REMOVE)\b/g, '')
      .match(/(^|[\s,(])[a-zA-Z]\w*/g);
    expect(bare).toBeNull();
  });

  it('counts created, updated, and unchanged jobs', async () => {
    const olds: (Record<string, unknown> | undefined)[] = [
      undefined, // new
      { type: 'job', contentHash: 'old' }, // changed
      { type: 'job', contentHash: 'h1' }, // same
      { type: 'job', contentHash: 'h1', descriptionHash: 'old' }, // description changed
      { type: 'job', contentHash: 'h1', descriptionHash: 'd1' }, // same description
    ];
    let call = 0;
    const { c } = client(() => ({ Attributes: olds[call++] }));
    const jobs = [
      posting({ jobId: '1' }),
      posting({ jobId: '2' }),
      posting({ jobId: '3' }),
      posting({ jobId: '4', description: 'x', descriptionHash: 'd1' }),
      posting({ jobId: '5', description: 'x', descriptionHash: 'd1' }),
    ];
    expect(await repo(c).save(USER, jobs, CONTEXT)).toEqual({ found: 5, created: 1, updated: 2 });
  });

  it(`writes at most ${SAVE_CONCURRENCY} at a time, and every job once`, async () => {
    let inFlight = 0;
    let most = 0;
    const seen: string[] = [];
    const { c } = client(async (cmd) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      seen.push((cmd as UpdateCommand).input.Key?.jobId as string);
      await Promise.resolve();
      inFlight -= 1;
      return {};
    });
    const jobs = Array.from({ length: 45 }, (_, i) => posting({ jobId: String(i) }));
    await repo(c).save(USER, jobs, CONTEXT);
    expect(most).toBe(SAVE_CONCURRENCY);
    expect(seen.sort()).toEqual(jobs.map((j) => j.jobId).sort());
  });

  it('nothing to save sends nothing', async () => {
    const { c, send } = client();
    expect(await repo(c).save(USER, [], CONTEXT)).toEqual({ found: 0, created: 0, updated: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('a failed write fails the save (the crawl retries; saving again is safe)', async () => {
    const { c } = client(() => {
      throw new Error('ProvisionedThroughputExceededException');
    });
    await expect(repo(c).save(USER, [posting()], CONTEXT)).rejects.toThrow();
  });
});

describe('JobRepository reads', () => {
  it('gets one job by its key', async () => {
    const { c, send } = client(() => ({ Item: { jobId: 'j1' } }));
    expect(await repo(c).get(USER, 'j1')).toEqual({ jobId: 'j1' });
    expect(firstSent<GetCommand>(send).input.Key).toEqual({
      userId: USER,
      jobId: 'j1',
    });
    expect(firstSent(send)).toBeInstanceOf(GetCommand);
  });

  it('lists one page and continues after a key', async () => {
    const { c, send } = client(() => ({
      Items: [{ jobId: 'j1' }],
      LastEvaluatedKey: { userId: USER, jobId: 'j1' },
    }));
    expect(await repo(c).list(USER, 20, 'j0')).toEqual({ items: [{ jobId: 'j1' }], next: 'j1' });
    const cmd = firstSent<QueryCommand>(send);
    expect(cmd).toBeInstanceOf(QueryCommand);
    expect(cmd.input).toMatchObject({
      Limit: 20,
      ExclusiveStartKey: { userId: USER, jobId: 'j0' },
      ExpressionAttributeValues: { ':u': USER },
    });
  });
});
