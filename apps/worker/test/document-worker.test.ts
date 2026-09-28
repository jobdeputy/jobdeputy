import type { Document } from '@jobdeputy/db';
import { documentKeys } from '@jobdeputy/shared';
import { makeDocx, makePdf } from '@jobdeputy/test-fixtures';
import type { SQSRecord } from 'aws-lambda';
import { strToU8 } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import {
  type DocumentDeps,
  handleScanResult,
  MESSAGES,
  processRecord,
} from '../src/document-worker.js';
import { extractDocumentText } from '../src/extract.js';

const USER = '14e85498-1111-2222-3333-444455556666';
const DOC = '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2D';
const KEY = `users/${USER}/documents/${DOC}/original`;
const TEXT_KEY = documentKeys(USER, DOC).text;

function scan(status: string, over: { key?: string; eTag?: string } = {}) {
  return {
    'detail-type': 'GuardDuty Malware Protection Object Scan Result',
    detail: {
      scanStatus: 'COMPLETED',
      s3ObjectDetails: { bucketName: 'b', objectKey: over.key ?? KEY, eTag: over.eTag ?? 'e1' },
      scanResultDetails: { scanResultStatus: status },
    },
  };
}

/** In-memory storage and a repository with the real transition rules. */
function world(
  file: Uint8Array | undefined,
  format: Document['format'] = 'pdf',
  initial?: Partial<Document>,
) {
  const objects = new Map<string, { bytes: Uint8Array | string; eTag: string }>();
  if (file) objects.set(KEY, { bytes: file, eTag: 'e1' });
  let doc: Partial<Document> | undefined = {
    userId: USER,
    documentId: DOC,
    status: 'pending',
    format,
    ...initial,
  };
  const deps: DocumentDeps = {
    remainingMs: () => 60_000,
    extract: extractDocumentText,
    storage: {
      get: async (key, eTag) => {
        const o = objects.get(key);
        return o && o.eTag === eTag && typeof o.bytes !== 'string' ? o.bytes : undefined;
      },
      putText: async (key, text) => {
        objects.set(key, { bytes: text, eTag: 't' });
      },
      delete: vi.fn(async (keys: string[]) => {
        for (const k of keys) objects.delete(k);
      }),
    },
    repo: {
      get: async () => (doc ? (structuredClone(doc) as Document) : undefined),
      startProcessing: async (_u, _d, eTag, size) => {
        if (!doc || !(doc.status === 'pending' || doc.eTag !== eTag)) return undefined;
        doc = { ...doc, status: 'processing', eTag, sizeBytes: size };
        return doc as Document;
      },
      markReady: async (_u, _d, eTag, parsed) => {
        if (!doc || doc.eTag !== eTag) return undefined;
        doc = { ...doc, status: 'ready', parsed };
        return doc as Document;
      },
      markFailed: async (_u, _d, reason, eTag) => {
        if (!doc || (eTag && doc.eTag !== eTag)) return undefined;
        doc = { ...doc, status: 'failed', error: reason };
        return doc as Document;
      },
      markRejected: async (_u, _d, reason) => {
        if (!doc) return undefined;
        doc = { ...doc, status: 'rejected', error: reason };
        return doc as Document;
      },
    },
  };
  return { deps, objects, doc: () => doc, remove: () => (doc = undefined) };
}

describe('document worker', () => {
  it('stores the text outside the scanned prefix, so it is never scanned again', () => {
    expect(KEY.startsWith('users/')).toBe(true);
    expect(TEXT_KEY).toBe(`derived/users/${USER}/documents/${DOC}/text.txt`);
    expect(TEXT_KEY.startsWith('users/')).toBe(false);
  });

  it('extracts a clean PDF and stores its text', async () => {
    const w = world(makePdf([['Ada Lovelace', 'Engineer']]));
    await expect(handleScanResult(scan('NO_THREATS_FOUND'), w.deps)).resolves.toBe('ready');
    expect(w.doc()).toMatchObject({
      status: 'ready',
      eTag: 'e1',
      parsed: { pageCount: 1, noText: false },
    });
    expect(String(w.objects.get(TEXT_KEY)?.bytes)).toContain('Ada Lovelace');
  });

  it('extracts a clean DOCX', async () => {
    const w = world(makeDocx(['TypeScript']), 'docx');
    await expect(handleScanResult(scan('NO_THREATS_FOUND'), w.deps)).resolves.toBe('ready');
    expect(String(w.objects.get(TEXT_KEY)?.bytes)).toContain('TypeScript');
  });

  it('deletes infected files and rejects the document, even if it was ready', async () => {
    const w = world(makePdf([['x']]), 'pdf', { status: 'ready', eTag: 'old' });
    await expect(handleScanResult(scan('THREATS_FOUND'), w.deps)).resolves.toBe('rejected');
    expect(w.doc()).toMatchObject({ status: 'rejected', error: MESSAGES.threat });
    expect(w.objects.size).toBe(0);
  });

  it.each([
    ['UNSUPPORTED', MESSAGES.unscannable],
    ['ACCESS_DENIED', MESSAGES.unscannable],
    ['FAILED', MESSAGES.scanFailed],
  ])('never keeps a file whose scan result is %s', async (status, message) => {
    const w = world(makePdf([['x']]));
    await expect(handleScanResult(scan(status), w.deps)).resolves.toBe('failed');
    expect(w.doc()).toMatchObject({ status: 'failed', error: message });
    expect(w.objects.size).toBe(0);
  });

  it('fails a file whose content does not match its type, and deletes it', async () => {
    const w = world(strToU8('not a pdf'));
    await expect(handleScanResult(scan('NO_THREATS_FOUND'), w.deps)).resolves.toBe('failed');
    expect(w.doc()?.error).toContain('not a valid PDF');
    expect(w.objects.has(KEY)).toBe(false);
  });

  it('skips duplicate scan events for the same file', async () => {
    const w = world(makePdf([['x']]));
    await handleScanResult(scan('NO_THREATS_FOUND'), w.deps);
    await expect(handleScanResult(scan('NO_THREATS_FOUND'), w.deps)).resolves.toBe('duplicate');
  });

  it('reprocesses a re-upload (new ETag) of a ready document', async () => {
    const w = world(makeDocx(['Second version']), 'docx', { status: 'ready', eTag: 'old' });
    await expect(handleScanResult(scan('NO_THREATS_FOUND'), w.deps)).resolves.toBe('ready');
    expect(w.doc()?.eTag).toBe('e1');
  });

  it('ignores events for a file that changed since the scan', async () => {
    const w = world(makePdf([['x']]));
    await expect(
      handleScanResult(scan('NO_THREATS_FOUND', { eTag: 'stale' }), w.deps),
    ).resolves.toBe('stale');
    expect(w.doc()?.status).toBe('pending');
  });

  it('removes files that have no document', async () => {
    const w = world(makePdf([['x']]));
    w.remove();
    await expect(handleScanResult(scan('NO_THREATS_FOUND'), w.deps)).resolves.toBe('orphan');
    expect(w.objects.size).toBe(0);
  });

  it.each([
    'users/x/documents/y/text.txt',
    `derived/users/${USER}/documents/${DOC}/text.txt`,
    'malware-protection-resource-validation-object',
    `users/${USER}/documents/${DOC}/text.txt`,
    `users/../documents/${DOC}/original`,
  ])('ignores other objects: %s', async (key) => {
    const w = world(makePdf([['x']]));
    await expect(handleScanResult(scan('THREATS_FOUND', { key }), w.deps)).resolves.toBe('ignored');
    expect(w.objects.size).toBe(1);
  });

  it('retries transient errors and marks the document failed on the last attempt', async () => {
    const w = world(makePdf([['x']]));
    w.deps.storage.get = vi.fn(async () => {
      throw new Error('S3 unavailable');
    });
    const record = (n: number) =>
      ({
        body: JSON.stringify(scan('NO_THREATS_FOUND')),
        attributes: { ApproximateReceiveCount: String(n) },
      }) as unknown as SQSRecord;
    await expect(processRecord(record(1), w.deps)).rejects.toThrow('S3 unavailable');
    expect(w.doc()?.status).toBe('pending');
    await expect(processRecord(record(3), w.deps)).rejects.toThrow('S3 unavailable');
    expect(w.doc()).toMatchObject({ status: 'failed', error: MESSAGES.processing });
  });

  it('rejects malformed messages', async () => {
    const w = world(undefined);
    await expect(handleScanResult({ hello: 1 }, w.deps)).rejects.toThrow('Malformed');
  });
});
