import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import {
  APPLIED_KEEP_DAYS,
  CompanyApplicationsRepository,
  type StageGuardCheck,
} from '../src/index.js';
import { fakeTable } from './fake-ddb.js';

const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const NOW = new Date('2026-10-10T12:00:00.000Z');
const ACME = 'greenhouse:acme';
const rule = { limit: 3, days: 30 };
const apply = { stage: 'applied', from: 'new' } as const;
const undo = { stage: 'new', from: 'applied' } as const;
const job = (jobId: string, companyKey = ACME) => ({ jobId, companyKey });
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const KEEP = APPLIED_KEEP_DAYS * 86_400_000;

function setup(current = rule) {
  const t = fakeTable();
  const repo = new CompanyApplicationsRepository(t.client, 'Usage');
  const guard = repo.guard(USER, async () => current);
  /** Writes the guard's item alone, as setStage's transaction would. */
  const write = async (checked: StageGuardCheck) => {
    if (!('item' in checked) || !checked.item) throw new Error('no item');
    await t.client.send(new TransactWriteCommand({ TransactItems: [checked.item] }));
  };
  const stored = () => t.items.get(`${USER}|APPLIED#${ACME}`);
  return { t, repo, guard, write, stored };
}

describe('CompanyApplicationsRepository (#52 PR E)', () => {
  it('counts each application, refusing the fourth in 30 days with when the first ages out', async () => {
    const { guard, write, stored, repo } = setup();
    for (const [i, at] of [daysAgo(20), daysAgo(10), daysAgo(1)].entries()) {
      await write(await guard.check(job(`j${i}`), apply, new Date(at)));
    }
    expect(stored()).toMatchObject({
      type: 'company_applied',
      companyKey: ACME,
      applied: { j0: daysAgo(20), j1: daysAgo(10), j2: daysAgo(1) },
      version: 3,
      // Gone once the newest application is past the longest window an admin can set.
      ttl: Math.floor((Date.parse(daysAgo(1)) + KEEP) / 1000),
    });
    expect(await guard.check(job('j3'), apply, NOW)).toEqual({
      refuse: {
        until: new Date(Date.parse(daysAgo(20)) + 30 * 86_400_000).toISOString(),
        limit: 3,
        days: 30,
      },
    });
    // Another company is not affected.
    expect(await guard.check(job('k1', 'lever:globex'), apply, NOW)).toHaveProperty('item');
    expect(await repo.list(USER)).toEqual(
      new Map([[ACME, [daysAgo(20), daysAgo(10), daysAgo(1)]]]),
    );
  });

  it('lets the user apply again once the oldest ages out; keeps it a year for a longer window', async () => {
    const { guard, write, stored } = setup();
    for (const [i, at] of [daysAgo(400), daysAgo(40), daysAgo(29), daysAgo(2)].entries()) {
      await write(await guard.check(job(`j${i}`), apply, new Date(at)));
    }
    // j1 was 40 days ago: 2 count, so a third is allowed. j0 (400 days) is dropped.
    await write(await guard.check(job('j4'), apply, NOW));
    expect(Object.keys(stored()?.applied as object).sort()).toEqual(['j1', 'j2', 'j3', 'j4']);
    // An admin raising the window to 60 days: j1 counts again.
    const wider = setup({ limit: 3, days: 60 });
    wider.t.items.set(
      `${USER}|APPLIED#${ACME}`,
      structuredClone(stored() as Record<string, unknown>),
    );
    expect(await wider.guard.check(job('j5'), apply, NOW)).toHaveProperty('refuse');
    // Now j2, j3, j4 count: refused, until exactly 30 days after j2, when it no longer counts.
    expect(await guard.check(job('j9'), apply, NOW)).toHaveProperty('refuse');
    const later = new Date(Date.parse(daysAgo(29)) + 30 * 86_400_000);
    expect(await guard.check(job('j9'), apply, later)).toHaveProperty('item');
  });

  it('an undone apply frees its place; an undo of one not counted writes nothing', async () => {
    const { guard, write, stored } = setup();
    for (const id of ['j0', 'j1', 'j2']) await write(await guard.check(job(id), apply, NOW));
    expect(await guard.check(job('j3'), apply, NOW)).toHaveProperty('refuse');
    await write(await guard.check(job('j1'), undo, NOW));
    expect(Object.keys(stored()?.applied as object).sort()).toEqual(['j0', 'j2']);
    expect(await guard.check(job('j3'), apply, NOW)).toHaveProperty('item');
    // Applied before the cooldown existed (no entry): nothing to take out.
    expect(await guard.check(job('old'), undo, NOW)).toEqual({});
  });

  it('an undo after a later stage (interviewing, then back to applied) still counts', async () => {
    const { guard, write, stored } = setup();
    for (const id of ['j0', 'j1', 'j2']) await write(await guard.check(job(id), apply, NOW));
    const moved = { ...job('j1'), appliedAt: daysAgo(3), stageAt: daysAgo(1) };
    expect(await guard.check(moved, undo, NOW)).toEqual({});
    expect(Object.keys(stored()?.applied as object)).toHaveLength(3);
    // Straight after its apply (stageAt = appliedAt), it is taken out.
    const straight = { ...job('j1'), appliedAt: daysAgo(1), stageAt: daysAgo(1) };
    await write(await guard.check(straight, undo, NOW));
    expect(Object.keys(stored()?.applied as object)).toHaveLength(2);
  });

  it('an item left empty expires at once (not at a 1970 time, which TTL never deletes)', async () => {
    const { guard, write, stored } = setup();
    await write(await guard.check(job('j0'), apply, NOW));
    await write(await guard.check(job('j0'), undo, NOW));
    expect(stored()).toMatchObject({ applied: {}, ttl: Math.floor(NOW.getTime() / 1000) });
  });

  it('later stages leave the count alone, without reading it', async () => {
    const { t, guard } = setup();
    const reads = { n: 0 };
    const send = t.client.send.bind(t.client);
    t.client.send = (async (cmd: unknown) => {
      if (cmd instanceof GetCommand) reads.n++;
      return send(cmd as never);
    }) as typeof t.client.send;
    for (const from of ['applied', 'interviewing', 'offer'] as const) {
      expect(await guard.check(job('j0'), { stage: 'withdrawn', from }, NOW)).toEqual({});
    }
    expect(reads.n).toBe(0);
  });

  it('two applies from the same read: only one is written (the other reads again)', async () => {
    const { t, guard, write } = setup();
    await write(await guard.check(job('j0'), apply, NOW));
    await write(await guard.check(job('j1'), apply, NOW));
    const a = await guard.check(job('j2'), apply, NOW);
    const b = await guard.check(job('j3'), apply, NOW);
    await write(a);
    await expect(write(b)).rejects.toMatchObject({
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    });
    // Read again, the fourth is refused.
    expect(await guard.check(job('j3'), apply, NOW)).toHaveProperty('refuse');
    // The first write also needs the item not to exist yet.
    const fresh = setup();
    const first = await fresh.guard.check(job('j0', 'x'), apply, NOW);
    const second = await fresh.guard.check(job('j1', 'x'), apply, NOW);
    await fresh.write(first);
    await expect(fresh.write(second)).rejects.toMatchObject({
      name: 'TransactionCanceledException',
    });
    expect(t.items.size).toBe(1);
  });

  it('reads the item strongly consistently', async () => {
    const { t, guard } = setup();
    const seen: unknown[] = [];
    const send = t.client.send.bind(t.client);
    t.client.send = (async (cmd: unknown) => {
      seen.push(cmd);
      return send(cmd as never);
    }) as typeof t.client.send;
    await guard.check(job('j0'), apply, NOW);
    expect((seen[0] as GetCommand).input).toMatchObject({
      ConsistentRead: true,
      Key: { userId: USER, sk: `APPLIED#${ACME}` },
    });
  });
});
