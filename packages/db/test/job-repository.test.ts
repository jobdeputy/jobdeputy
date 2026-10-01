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
    expect(cmd.input).not.toHaveProperty('FilterExpression');
  });

  it('T08c: `shown` leaves out jobs the filter or the company limit hid', async () => {
    const { c, send } = client(() => ({ Items: [] }));
    await repo(c).list(USER, 20, undefined, 'shown');
    expect(firstSent<QueryCommand>(send).input).toMatchObject({
      FilterExpression:
        '(attribute_not_exists(#filter.#state) OR #filter.#state <> :dropped) AND (attribute_not_exists(#limitState) OR #limitState <> :over)',
      ExpressionAttributeNames: {
        '#filter': 'filter',
        '#state': 'state',
        '#limitState': 'limitState',
      },
      ExpressionAttributeValues: { ':u': USER, ':dropped': 'not_relevant', ':over': 'over_limit' },
    });
  });
});

describe('JobRepository.closeMissing (T07c)', () => {
  const named = (name: string) => Object.assign(new Error(name), { name });

  it('removes the source; closes a job no page lists any more', async () => {
    const { c, send } = client((cmd) => {
      const input = (cmd as UpdateCommand).input;
      // After removing the source: j1 has none left; j2 is still listed by another page.
      if (input.UpdateExpression?.startsWith('DELETE')) {
        return {
          Attributes:
            input.Key?.jobId === 'j1'
              ? { jobId: 'j1', companyKey: 'greenhouse:acme', status: 'new' }
              : { jobId: 'j2', sourceIds: new Set(['S2']) },
        };
      }
      return {};
    });
    expect(await repo(c).closeMissing(USER, 'S1', ['j1', 'j2'])).toEqual([
      { jobId: 'j1', companyKey: 'greenhouse:acme' },
    ]);
    const commands = send.mock.calls.map(([cmd]) => (cmd as UpdateCommand).input);
    const drops = commands.filter((i) => i.UpdateExpression?.startsWith('DELETE'));
    expect(drops.map((i) => i.Key?.jobId).sort()).toEqual(['j1', 'j2']);
    expect(drops[0]).toMatchObject({
      UpdateExpression: 'DELETE #sourceIds :source SET updatedAt = :now',
      ConditionExpression: 'attribute_exists(userId)',
      ExpressionAttributeValues: { ':source': new Set(['S1']) },
    });
    const closes = commands.filter((i) => i.UpdateExpression?.startsWith('SET #closedAt'));
    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({
      Key: { userId: USER, jobId: 'j1' },
      // Not if another page listed it again meanwhile, or it is already closed.
      ConditionExpression: 'attribute_not_exists(#sourceIds) AND attribute_not_exists(#closedAt)',
      ExpressionAttributeValues: { ':now': NOW.toISOString() },
    });
  });

  it('a job already closed, gone, or listed again meanwhile is not counted', async () => {
    let n = 0;
    const { c } = client((cmd) => {
      const input = (cmd as UpdateCommand).input;
      n += 1;
      if (input.Key?.jobId === 'gone') throw named('ConditionalCheckFailedException');
      if (input.UpdateExpression?.startsWith('DELETE')) {
        return { Attributes: input.Key?.jobId === 'closed' ? { closedAt: 'x' } : {} };
      }
      // The close of `raced`: another crawl added a source back first.
      throw named('ConditionalCheckFailedException');
    });
    expect(await repo(c).closeMissing(USER, 'S1', ['gone', 'closed', 'raced'])).toEqual([]);
    expect(n).toBe(4);
  });

  it('other failures are not hidden', async () => {
    const { c } = client(() => {
      throw new Error('InternalServerError');
    });
    await expect(repo(c).closeMissing(USER, 'S1', ['j1'])).rejects.toThrow('InternalServerError');
  });

  it('nothing to close sends nothing', async () => {
    const { c, send } = client();
    expect(await repo(c).closeMissing(USER, 'S1', [])).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('T08c: a closed job the user never acted on expires; one they acted on is kept', async () => {
    const { c, send } = client((cmd) => {
      const input = (cmd as UpdateCommand).input;
      if (input.UpdateExpression?.startsWith('DELETE')) {
        const status = input.Key?.jobId === 'untouched' ? 'new' : 'shortlisted';
        return { Attributes: { companyKey: 'greenhouse:acme', status } };
      }
      return {};
    });
    await repo(c).closeMissing(USER, 'S1', ['untouched', 'acted'], 1_800_000_000);
    const closes = send.mock.calls
      .map(([cmd]) => (cmd as UpdateCommand).input)
      .filter((i) => i.UpdateExpression?.startsWith('SET #closedAt'));
    const byJob = Object.fromEntries(closes.map((i) => [i.Key?.jobId, i]));
    expect(byJob.untouched).toMatchObject({
      // Kept sooner if it was already hidden.
      UpdateExpression: 'SET #closedAt = :now, updatedAt = :now, #ttl = if_not_exists(#ttl, :ttl)',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':ttl': 1_800_000_000 },
    });
    expect(byJob.acted?.UpdateExpression).toBe('SET #closedAt = :now, updatedAt = :now');
    expect(byJob.acted?.ExpressionAttributeNames).not.toHaveProperty('#ttl');
  });
});

describe('JobRepository.save: fit (T08c)', () => {
  const EXPIRES = 1_800_000_000;
  const filter = (state: 'candidate' | 'not_relevant') => ({
    state,
    roleIds: state === 'candidate' ? ['R1'] : [],
    reasons: [state === 'candidate' ? 'title_match' : 'title_no_match'],
    priority: 50,
    version: 1,
  });
  const saveOne = async (
    fit: NonNullable<JobPosting['fit']>,
    old: Record<string, unknown> = {},
  ) => {
    const { c, send } = client((cmd) =>
      (cmd as UpdateCommand).input.UpdateExpression?.startsWith('SET') ? { Attributes: old } : {},
    );
    await repo(c).save(USER, [posting({ fit })], { ...CONTEXT, expiresAt: EXPIRES });
    return { first: readable(firstSent<UpdateCommand>(send)), send };
  };

  it('a shown job stores the verdict and never expires', async () => {
    const { first } = await saveOne({ filter: filter('candidate'), limitState: 'counted' });
    expect(first.byName.filter?.value).toEqual(filter('candidate'));
    expect(first.byName.limitState?.value).toBe('counted');
    expect(first.byName).not.toHaveProperty('ttl');
    expect(first.expression).toMatch(/REMOVE #closedAt, #ttl$/);
  });

  it('a dropped job expires 7 days after it was first hidden (not after every crawl)', async () => {
    const { first } = await saveOne({ filter: filter('not_relevant') });
    expect(first.byName.ttl).toEqual({ value: EXPIRES, onlyIfMissing: true });
    // Not a candidate: not ranked for its company.
    expect(first.expression).toMatch(/REMOVE #closedAt, #limitState$/);
  });

  it('a job over its company limit is hidden and expires too', async () => {
    const { first } = await saveOne({ filter: filter('candidate'), limitState: 'over_limit' });
    expect(first.byName.limitState?.value).toBe('over_limit');
    expect(first.byName.ttl).toEqual({ value: EXPIRES, onlyIfMissing: true });
  });

  it('a hidden job the user acted on keeps no expiry (their history)', async () => {
    const { send } = await saveOne(
      { filter: filter('not_relevant') },
      { type: 'job', status: 'applied' },
    );
    expect(send).toHaveBeenCalledTimes(2);
    const fix = (send.mock.calls[1]?.[0] as UpdateCommand | undefined)?.input;
    expect(fix).toMatchObject({
      UpdateExpression: 'REMOVE #ttl',
      ConditionExpression: 'attribute_exists(userId) AND #status <> :new',
    });
  });

  it('an untouched hidden job needs no second write', async () => {
    const { send } = await saveOne(
      { filter: filter('not_relevant') },
      { type: 'job', status: 'new' },
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('JobRepository.markOverLimit (T08c)', () => {
  const named = (name: string) => Object.assign(new Error(name), { name });

  it('hides and expires untouched jobs; acted-on ones are hidden without expiry; gone ones skipped', async () => {
    const { c, send } = client((cmd) => {
      const input = (cmd as UpdateCommand).input;
      const withTtl = input.UpdateExpression?.includes('#ttl');
      if (input.Key?.jobId === 'acted' && withTtl) throw named('ConditionalCheckFailedException');
      if (input.Key?.jobId === 'gone') throw named('ConditionalCheckFailedException');
      return {};
    });
    await repo(c).markOverLimit(USER, ['untouched', 'acted', 'gone'], 1_800_000_000);
    const inputs = send.mock.calls.map(([cmd]) => (cmd as UpdateCommand).input);
    expect(inputs.filter((i) => i.Key?.jobId === 'untouched')).toEqual([
      expect.objectContaining({
        UpdateExpression:
          'SET #limitState = :v0, updatedAt = :now, #ttl = if_not_exists(#ttl, :ttl)',
        ConditionExpression: 'attribute_exists(userId) AND #status = :new',
        ExpressionAttributeValues: expect.objectContaining({ ':v0': 'over_limit' }),
      }),
    ]);
    expect(inputs.filter((i) => i.Key?.jobId === 'acted').map((i) => i.UpdateExpression)).toEqual([
      'SET #limitState = :v0, updatedAt = :now, #ttl = if_not_exists(#ttl, :ttl)',
      'SET #limitState = :v0, updatedAt = :now',
    ]);
    expect(inputs.filter((i) => i.Key?.jobId === 'gone')).toHaveLength(2);
  });

  it('other failures are not hidden', async () => {
    const { c } = client(() => {
      throw new Error('InternalServerError');
    });
    await expect(repo(c).markOverLimit(USER, ['j1'], 1)).rejects.toThrow('InternalServerError');
  });
});

describe('JobRepository.applyRelevance (T08d)', () => {
  it('hides low scores as not relevant, ranks the rest, and expires only hidden untouched jobs', async () => {
    const { c, send } = client();
    await repo(c).applyRelevance(
      USER,
      [
        { jobId: 'low', hide: { reasons: ['title_match', 'llm_low_score'] } },
        { jobId: 'shown', limitState: 'counted' },
        { jobId: 'over', limitState: 'over_limit' },
      ],
      1_800_000_000,
    );
    const byJob = new Map(
      send.mock.calls.map(([cmd]) => [
        (cmd as UpdateCommand).input.Key?.jobId,
        (cmd as UpdateCommand).input,
      ]),
    );
    expect(byJob.get('low')).toMatchObject({
      UpdateExpression:
        'SET #filter.#state = :v0, #filter.#reasons = :v1, updatedAt = :now, #ttl = if_not_exists(#ttl, :ttl) REMOVE #limitState',
      ConditionExpression: 'attribute_exists(userId) AND #status = :new',
      ExpressionAttributeValues: expect.objectContaining({
        ':v0': 'not_relevant',
        ':v1': ['title_match', 'llm_low_score'],
        ':ttl': 1_800_000_000,
      }),
    });
    expect(byJob.get('shown')).toMatchObject({
      UpdateExpression: 'SET #limitState = :v0, updatedAt = :now REMOVE #ttl',
      ConditionExpression: 'attribute_exists(userId)',
      ExpressionAttributeValues: expect.objectContaining({ ':v0': 'counted' }),
    });
    expect(byJob.get('over')?.UpdateExpression).toBe(
      'SET #limitState = :v0, updatedAt = :now, #ttl = if_not_exists(#ttl, :ttl)',
    );
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe('JobRepository.getMany (T08d)', () => {
  it('reads consistently in chunks of 100 and reads unprocessed keys again', async () => {
    let first = true;
    const { c, send } = client((cmd) => {
      const req = (
        cmd as { input: { RequestItems: Record<string, { Keys: { jobId: string }[] }> } }
      ).input.RequestItems.Jobs as { Keys: { jobId: string }[]; ConsistentRead: boolean };
      expect(req.ConsistentRead).toBe(true);
      const keys = req.Keys;
      if (first) {
        first = false;
        // Throttled: the last key comes back unprocessed.
        return {
          Responses: { Jobs: keys.slice(0, -1).map((k) => ({ jobId: k.jobId })) },
          UnprocessedKeys: { Jobs: { Keys: keys.slice(-1) } },
        };
      }
      // `missing` does not exist.
      return {
        Responses: {
          Jobs: keys.filter((k) => k.jobId !== 'missing').map((k) => ({ jobId: k.jobId })),
        },
      };
    });
    const ids = [...Array.from({ length: 101 }, (_, i) => `j${i}`), 'missing'];
    const jobs = await repo(c).getMany(USER, ids);
    expect(jobs.map((j) => j.jobId).sort()).toEqual(ids.filter((id) => id !== 'missing').sort());
    expect(send).toHaveBeenCalledTimes(3);
  });
});
