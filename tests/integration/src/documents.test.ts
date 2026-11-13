import { makeDocx, makeEicar, makePdf } from '@jobdeputy/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  callApi,
  createTestUser,
  stackOutputs,
  type TestUser,
  uploadDocument,
  waitFor,
  waitForMalwareScanning,
} from './stack.js';

/**
 * Deployed wiring of T05c: presigned uploads that S3 enforces, GuardDuty scanning,
 * EventBridge → queue → worker extraction, downloads, and user isolation.
 * File-format and limit permutations are unit-tested. See docs/testing.md.
 */
const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Scan plus extraction; a new stack's first scan can be slow. */
const PROCESS_TIMEOUT_MS = 300_000;

let api: string;
let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  const outputs = await stackOutputs();
  api = outputs.ApiUrl ?? '';
  await waitForMalwareScanning(outputs);
  [alice, bob] = await Promise.all([createTestUser(outputs), createTestUser(outputs)]);
}, 360_000);

afterAll(async () => {
  await Promise.allSettled([alice?.delete(), bob?.delete()]);
});

const upload = (
  user: TestUser,
  fileName: string,
  contentType: string,
  bytes: Uint8Array,
  formType = contentType,
) => uploadDocument(api, user, fileName, contentType, bytes, formType);

async function finalState(user: TestUser, documentId: string) {
  return waitFor(
    async () => {
      const res = await callApi(api, 'GET', `me/documents/${documentId}`, user.accessToken);
      return ['ready', 'rejected', 'failed'].includes(res.body.status) ? res.body : undefined;
    },
    { timeoutMs: PROCESS_TIMEOUT_MS, intervalMs: 3_000 },
  );
}

describe.concurrent('résumés (deployed)', () => {
  it('uploads a PDF, extracts its text, downloads it, and keeps it private', async () => {
    const pdf = makePdf([['JobDeputy integration test', 'Ada Lovelace, Engineer']]);
    const { documentId, s3Status } = await upload(alice, 'Integration CV.pdf', PDF, pdf);
    expect(s3Status).toBe(204);

    const doc = await finalState(alice, documentId);
    expect(doc).toMatchObject({
      status: 'ready',
      format: 'pdf',
      text: { pageCount: 1, noText: false },
    });
    expect(doc.text.charCount).toBeGreaterThan(10);

    const download = await fetch(doc.downloadUrl);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(pdf);

    // Bob can neither see, change, nor delete Alice's document.
    expect((await callApi(api, 'GET', `me/documents/${documentId}`, bob.accessToken)).status).toBe(
      404,
    );
    expect(
      (await callApi(api, 'DELETE', `me/documents/${documentId}`, bob.accessToken)).status,
    ).toBe(404);
    const bobs = await callApi(api, 'GET', 'me/documents', bob.accessToken);
    expect(bobs.body.documents.map((d: { documentId: string }) => d.documentId)).not.toContain(
      documentId,
    );

    expect(
      (await callApi(api, 'DELETE', `me/documents/${documentId}`, alice.accessToken)).status,
    ).toBe(204);
    expect(
      (await callApi(api, 'GET', `me/documents/${documentId}`, alice.accessToken)).status,
    ).toBe(404);
  });

  it('extracts text from a DOCX', async () => {
    const { documentId, s3Status } = await upload(
      bob,
      'Integration CV.docx',
      DOCX,
      makeDocx(['TypeScript and AWS']),
    );
    expect(s3Status).toBe(204);
    const doc = await finalState(bob, documentId);
    expect(doc).toMatchObject({ status: 'ready', format: 'docx' });
    await callApi(api, 'DELETE', `me/documents/${documentId}`, bob.accessToken);
  });

  it('fails a file whose content is not what it claims to be', async () => {
    const fake = new TextEncoder().encode('This is plain text pretending to be a PDF.');
    const { documentId } = await upload(alice, 'fake.pdf', PDF, fake);
    const doc = await finalState(alice, documentId);
    expect(doc).toMatchObject({ status: 'failed' });
    expect(doc.error).toContain('not a valid PDF');
    expect(doc.downloadUrl).toBeUndefined();
  });

  it('rejects malware (the EICAR test file) and never offers it for download', async () => {
    const { documentId, s3Status } = await upload(bob, 'eicar.pdf', PDF, makeEicar());
    expect(s3Status).toBe(204);
    const doc = await finalState(bob, documentId);
    expect(doc).toMatchObject({ status: 'rejected' });
    expect(doc.error).toContain('malware');
    expect(doc.downloadUrl).toBeUndefined();
  });

  it('lets S3 refuse oversized files and the wrong content type', async () => {
    const tooBig = new Uint8Array(5 * 1024 * 1024 + 1);
    expect((await upload(alice, 'big.pdf', PDF, tooBig)).s3Status).toBe(400);
    const wrongType = await upload(alice, 'page.pdf', PDF, makePdf([['x']]), 'text/html');
    expect(wrongType.s3Status).toBe(403);
  });
});
