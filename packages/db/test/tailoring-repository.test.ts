import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import {
  type GeneratedDocument,
  runLock,
  TailoringAllowanceError,
  TailoringBusyError,
  TailoringConflictError,
  TailoringRepository,
} from '../src/index.js';

const NOW = new Date('2026-11-22T06:00:00.000Z');
const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
// A ULID made in October 2026: a free run given back goes to that month.
const DOC = '01M4YDQK00AAAAAAAAAAAAAAAA';
const TABLES = { documents: 'documents', usage: 'usage', audit: 'audit', jobs: 'jobs' };
const AUDIT = {
  table: 'audit',
  entry: {
    auditId: 'a1',
    name: 'tailoring.requested',
    entity: { type: 'document', id: DOC },
    actor: 'user' as const,
    summary: 's',
  },
};

const named = (name: string, extra: object = {}) =>
  Object.assign(new Error(name), { name, ...extra });
const cancelled = (...codes: string[]) =>
  named('TransactionCanceledException', { CancellationReasons: codes.map((Code) => ({ Code })) });
const conditionFailed = () => named('ConditionalCheckFailedException');

// biome-ignore lint/suspicious/noExplicitAny: commands are inspected as plain objects.
type Cmd = { input: any; constructor: { name: string } };
function setup(handler: (cmd: Cmd) => unknown = () => ({})) {
  const send = vi.fn(async (cmd: Cmd) => handler(cmd));
  const repo = new TailoringRepository(
    { send } as unknown as DynamoDBDocumentClient,
    TABLES,
    () => NOW,
  );
  return { repo, send };
}

const ask = {
  userId: USER,
  documentId: DOC,
  kind: 'resume' as const,
  title: 'Résumé for Acme',
  companyKey: 'greenhouse:acme',
  companyName: 'Acme',
  jobIds: ['j1'],
  baseDocumentId: 'BASE',
  aiSource: 'platform' as const,
  platformRun: true,
};
const LIMITS = { perMonth: 10, staleMs: 20 * 60_000 };

describe('TailoringRepository.request', () => {
  it('puts the queued version, its audit entry, the free run, and the company lock in one transaction', async () => {
    const { repo, send } = setup();
    const doc = await repo.request(ask, AUDIT, LIMITS);
    expect(doc).toMatchObject({
      origin: 'generated',
      status: 'queued',
      tailoring: { calls: 0, attempts: 0 },
    });
    const items = send.mock.calls[0]?.[0].input.TransactItems;
    expect(items).toHaveLength(4);
    expect(items[0].Put).toMatchObject({
      TableName: 'documents',
      ConditionExpression: 'attribute_not_exists(userId)',
    });
    expect(items[2].Update).toMatchObject({
      Key: { userId: USER, sk: 'MONTH#2026-11' },
      ConditionExpression:
        'attribute_not_exists(tailoringRunIds) OR size(tailoringRunIds) < :perMonth',
    });
    expect(items[2].Update.ExpressionAttributeValues[':id']).toEqual(new Set([DOC]));
    expect(items[3].Update).toMatchObject({
      Key: { userId: USER, sk: 'TAILOR#greenhouse:acme' },
      ConditionExpression: 'attribute_not_exists(activeId) OR activeSince < :stale',
    });
    expect(items[3].Update.ExpressionAttributeValues[':stale']).toBe('2026-11-22T05:40:00.000Z');
  });

  it('does not count a run on the user’s own key', async () => {
    const { repo, send } = setup();
    await repo.request({ ...ask, aiSource: 'openai', platformRun: false }, AUDIT, LIMITS);
    const month = send.mock.calls[0]?.[0].input.TransactItems[2].Update;
    expect(month.ConditionExpression).toBeUndefined();
    expect(month.UpdateExpression).not.toContain('tailoringRunIds');
  });

  it('locks a cover letter per job, so it runs beside its company’s résumé', async () => {
    const { repo, send } = setup();
    const doc = await repo.request(
      { ...ask, kind: 'cover_letter', jobIds: ['j9'], resumeDocumentId: 'R1' },
      AUDIT,
      LIMITS,
    );
    expect(doc).toMatchObject({ kind: 'cover_letter', resumeDocumentId: 'R1', status: 'queued' });
    const items = send.mock.calls[0]?.[0].input.TransactItems;
    expect(items[3].Update.Key).toEqual({ userId: USER, sk: 'LETTER#j9' });
    // The same free runs as tailoring.
    expect(items[2].Update.UpdateExpression).toContain('ADD tailoringRunIds :id');
    expect(runLock({ kind: 'resume', companyKey: 'c', jobIds: ['j9'] })).toBe('TAILOR#c');
  });

  it('ends a letter ready without scores', async () => {
    const { repo, send } = setup();
    await repo.finish({
      userId: USER,
      documentId: DOC,
      lock: 'LETTER#j9',
      outcome: { status: 'ready', s3Key: 'l.pdf', sizeBytes: 3, fileName: 'Sam.pdf' },
      audit: AUDIT,
    });
    const [doc, lock] = send.mock.calls[0]?.[0]?.input.TransactItems ?? [];
    expect(doc.Update.UpdateExpression).not.toContain('scores');
    expect(doc.Update.ExpressionAttributeNames).toEqual({ '#status': 'status' });
    expect(lock.Update.Key).toEqual({ userId: USER, sk: 'LETTER#j9' });
  });

  it('maps a full month to TailoringAllowanceError and a held lock to TailoringBusyError', async () => {
    const full = setup(() => {
      throw cancelled('None', 'None', 'ConditionalCheckFailed', 'None');
    });
    await expect(full.repo.request(ask, AUDIT, LIMITS)).rejects.toBeInstanceOf(
      TailoringAllowanceError,
    );
    const busy = setup((cmd) => {
      if (cmd.constructor.name === 'GetCommand') return { Item: { activeId: 'OTHER' } };
      throw cancelled('None', 'None', 'None', 'ConditionalCheckFailed');
    });
    await expect(busy.repo.request(ask, AUDIT, LIMITS)).rejects.toMatchObject({
      name: 'TailoringBusyError',
      activeId: 'OTHER',
    });
    expect(TailoringBusyError).toBeDefined();
  });
});

describe('TailoringRepository runs', () => {
  it('claims a queued or processing version once more; an ended one is undefined', async () => {
    const ok = setup(() => ({ Attributes: { documentId: DOC } }));
    expect(await ok.repo.claim(USER, DOC)).toEqual({ documentId: DOC });
    expect(ok.send.mock.calls[0]?.[0].input.ConditionExpression).toBe(
      'origin = :generated AND #status IN (:queued, :processing)',
    );
    const ended = setup(() => {
      throw conditionFailed();
    });
    expect(await ended.repo.claim(USER, DOC)).toBeUndefined();
  });

  it('stores a call only at the expected count, with its tokens', async () => {
    const { repo, send } = setup();
    const generation = {
      keySource: 'platform' as const,
      provider: 'bedrock',
      model: 'm',
      calls: 1,
      inputTokens: 5,
      outputTokens: 2,
    };
    const usage = {
      keySource: 'platform' as const,
      provider: 'bedrock',
      modelId: 'm',
      task: 'tailor-resume',
      calls: 1,
      inputTokens: 5,
      outputTokens: 2,
      runs: 1,
    };
    await repo.saveCall({ userId: USER, documentId: DOC, callsBefore: 2, generation, usage });
    const [doc, ai] = send.mock.calls[0]?.[0]?.input.TransactItems ?? [];
    expect(doc.Update.ConditionExpression).toBe(
      '#status = :processing AND tailoring.calls = :before',
    );
    expect(doc.Update.ExpressionAttributeValues).toMatchObject({ ':calls': 3, ':before': 2 });
    expect(ai.Update.Key.sk).toMatch(/^AI#2026-11#platform#bedrock#m$/);
    const conflict = setup(() => {
      throw cancelled('ConditionalCheckFailed', 'None');
    });
    await expect(
      conflict.repo.saveCall({ userId: USER, documentId: DOC, callsBefore: 0, generation, usage }),
    ).rejects.toBeInstanceOf(TailoringConflictError);
  });

  it('ends a run ready with its files and scores, freeing the lock', async () => {
    const { repo, send } = setup();
    const ended = await repo.finish({
      userId: USER,
      documentId: DOC,
      lock: 'TAILOR#greenhouse:acme',
      outcome: {
        status: 'ready',
        s3Key: 'k.pdf',
        sizeBytes: 9,
        fileName: 'Sam – Acme.pdf',
        tailoring: { result: 'ok', scores: [], promptVersion: 'tailor-resume@v1', scoreVersion: 1 },
      },
      audit: AUDIT,
    });
    expect(ended).toBe(true);
    const [doc, lock] = send.mock.calls[0]?.[0]?.input.TransactItems ?? [];
    expect(doc.Update.ExpressionAttributeValues).toMatchObject({
      ':status': 'ready',
      ':fileName': 'Sam – Acme.pdf',
    });
    expect(lock.Update).toMatchObject({
      Key: { sk: 'TAILOR#greenhouse:acme' },
      ConditionExpression: 'activeId = :id',
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('gives a failed run’s free run back to the month it was asked in', async () => {
    const { repo, send } = setup();
    await repo.finish({
      userId: USER,
      documentId: DOC,
      lock: 'TAILOR#greenhouse:acme',
      outcome: { status: 'failed', error: 'no_jobs', giveBack: true },
      audit: AUDIT,
    });
    const back = send.mock.calls[1]?.[0].input;
    expect(back.Key).toEqual({ userId: USER, sk: 'MONTH#2026-10' });
    expect(back.UpdateExpression).toContain('DELETE tailoringRunIds :id');
    // Never creates (or touches) a month item the run was not counted in.
    expect(back.ConditionExpression).toBe('contains(tailoringRunIds, :one)');
    const notCounted = setup((cmd) => {
      if (cmd.constructor.name === 'UpdateCommand') throw conditionFailed();
      return {};
    });
    await expect(
      notCounted.repo.finish({
        userId: USER,
        documentId: DOC,
        lock: 'TAILOR#greenhouse:acme',
        outcome: { status: 'failed', error: 'no_jobs', giveBack: true },
        audit: AUDIT,
      }),
    ).resolves.toBe(true);
  });

  it('keeps a draft only while the run is processing', async () => {
    const { repo, send } = setup();
    const resume = {
      contact: { name: 'Sam', links: [] },
      skills: [],
      experience: [],
      education: [],
      certifications: [],
      projects: [],
    };
    await repo.saveDraft(
      USER,
      DOC,
      {
        result: 'partial',
        scores: [],
        coverage: 0.9,
        promptVersion: 'tailor-resume@v1',
        scoreVersion: 1,
      },
      resume,
      'Acme',
    );
    const input = send.mock.calls[0]?.[0].input;
    // Once per run: a duplicate delivery's later draft is refused.
    expect(input.ConditionExpression).toBe(
      '#status = :processing AND attribute_not_exists(tailoring.drafted)',
    );
    expect(input.ExpressionAttributeValues[':resume']).toEqual(resume);
    expect(input.UpdateExpression).toContain('companyName = if_not_exists(companyName, :company)');
    expect(input.UpdateExpression).toContain('tailoring.drafted = :true');
    expect(input.UpdateExpression).toContain('tailoring.coverage = :coverage');
    const ended = setup(() => {
      throw conditionFailed();
    });
    expect(
      await ended.repo.saveDraft(
        USER,
        DOC,
        { result: 'ok', scores: [], promptVersion: 'p', scoreVersion: 1 },
        resume,
        'Acme',
      ),
    ).toBe(false);
  });

  it('ends a run whose lock a newer run took over, leaving that lock alone; false once ended', async () => {
    let call = 0;
    const takenOver = setup(() => {
      call += 1;
      if (call === 1) throw cancelled('None', 'ConditionalCheckFailed', 'None');
      return {};
    });
    const input = {
      userId: USER,
      documentId: DOC,
      lock: 'TAILOR#greenhouse:acme',
      outcome: { status: 'failed' as const, error: 'stopped' as const, giveBack: false },
      audit: AUDIT,
    };
    expect(await takenOver.repo.finish(input)).toBe(true);
    expect(takenOver.send.mock.calls[1]?.[0].input.TransactItems).toHaveLength(2);
    const ended = setup(() => {
      throw cancelled('ConditionalCheckFailed', 'None', 'None');
    });
    expect(await ended.repo.finish(input)).toBe(false);
  });
});

describe('TailoringRepository lists and jobs', () => {
  it('lists generated versions of a company, every page, newest first', async () => {
    let page = 0;
    const { repo, send } = setup(() => {
      page += 1;
      return page === 1
        ? { Items: [{ documentId: '01A' }], LastEvaluatedKey: { k: 1 } }
        : { Items: [{ documentId: '01C' }] };
    });
    const versions = await repo.list(USER, 'greenhouse:acme');
    expect(versions.map((v: Pick<GeneratedDocument, 'documentId'>) => v.documentId)).toEqual([
      '01C',
      '01A',
    ]);
    const input = send.mock.calls[0]?.[0].input;
    // Résumés only: a company's letters are never listed, counted, or pruned with them.
    expect(input.FilterExpression).toBe(
      'origin = :generated AND #kind = :kind AND companyKey = :company',
    );
    expect(input.ExpressionAttributeValues[':kind']).toBe('resume');
  });

  it('lists a job’s cover letters only', async () => {
    const { repo, send } = setup(() => ({ Items: [{ documentId: '01A' }, { documentId: '01B' }] }));
    const letters = await repo.listLetters(USER, 'j1');
    expect(letters.map((v) => v.documentId)).toEqual(['01B', '01A']);
    const input = send.mock.calls[0]?.[0].input;
    expect(input.FilterExpression).toBe(
      'origin = :generated AND #kind = :kind AND contains(jobIds, :job)',
    );
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':kind': 'cover_letter',
      ':job': 'j1',
    });
  });

  it('links a job to its letter without touching its résumé link (and the other way)', async () => {
    // The job has no materials map yet: the first write makes it.
    const fresh = setup();
    await fresh.repo.saveCoverLetter(USER, 'j1', DOC);
    const made = fresh.send.mock.calls[0]?.[0].input;
    expect(made.ConditionExpression).toBe(
      'attribute_exists(userId) AND attribute_not_exists(materials)',
    );
    expect(made.ExpressionAttributeValues[':materials']).toEqual({ coverLetterDocumentId: DOC });
    expect(fresh.send).toHaveBeenCalledTimes(1);
    // It has one: only the field is set.
    let call = 0;
    const has = setup(() => {
      call += 1;
      if (call === 1) throw conditionFailed();
      return {};
    });
    await has.repo.saveMatches(
      USER,
      DOC,
      [{ jobId: 'j1', base: 50, tailored: 70, missingProven: [], missingUnproven: [] }],
      1,
    );
    const field = has.send.mock.calls[1]?.[0].input;
    expect(field.UpdateExpression).toBe(
      'SET #match = :match, materials.#field = :id, updatedAt = :now',
    );
    expect(field.ConditionExpression).toBe('attribute_exists(materials)');
    expect(field.ExpressionAttributeNames).toEqual({
      '#match': 'match',
      '#field': 'resumeDocumentId',
    });
    expect(field.ExpressionAttributeValues[':id']).toBe(DOC);
  });

  it('keeps a letter’s draft once, while the run is processing', async () => {
    const draft = {
      contact: { name: 'Sam', links: [] },
      company: 'Acme',
      jobTitle: 'Engineer',
      paragraphs: ['One.'],
      from: 'base' as const,
      promptVersion: 'cover-letter@v1',
    };
    const { repo, send } = setup();
    expect(await repo.saveLetterDraft(USER, DOC, draft)).toBe(true);
    const input = send.mock.calls[0]?.[0].input;
    expect(input.ConditionExpression).toBe(
      '#status = :processing AND attribute_not_exists(tailoring.drafted)',
    );
    expect(input.ExpressionAttributeValues[':letter']).toEqual({
      contact: draft.contact,
      company: 'Acme',
      jobTitle: 'Engineer',
      paragraphs: ['One.'],
      from: 'base',
    });
    const second = setup(() => {
      throw conditionFailed();
    });
    expect(await second.repo.saveLetterDraft(USER, DOC, draft)).toBe(false);
  });

  it('caches keywords and matches only on jobs that still exist', async () => {
    const { repo, send } = setup(() => {
      throw conditionFailed();
    });
    await repo.saveKeywords(USER, 'j1', {
      descriptionHash: 'h',
      promptVersion: 'job-keywords@v1',
      terms: [],
    });
    await repo.saveMatches(
      USER,
      DOC,
      [{ jobId: 'j1', base: 50, tailored: 70, missingProven: [], missingUnproven: ['AWS'] }],
      1,
    );
    // Keywords 1; the match tried with a new materials map, then inside the existing one.
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[1]?.[0].input.ExpressionAttributeValues[':match']).toMatchObject({
      resumeDocumentId: DOC,
      score: 70,
      base: 50,
      missing: ['AWS'],
      version: 1,
    });
  });

  it('deletes versions 25 at a time, retrying unprocessed ones', async () => {
    let first = true;
    const { repo, send } = setup((cmd) => {
      const items = cmd.input.RequestItems.documents;
      if (first) {
        first = false;
        return { UnprocessedItems: { documents: items.slice(0, 1) } };
      }
      return {};
    });
    await repo.deleteVersions(
      USER,
      Array.from({ length: 30 }, (_, i) => `D${i}`),
    );
    expect(send.mock.calls.map((c) => c[0].input.RequestItems.documents.length)).toEqual([
      25, 1, 5,
    ]);
  });
});
