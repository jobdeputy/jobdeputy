import { describe, expect, it, vi } from 'vitest';
import { createFiles, fileType, MAX_FILE_BYTES } from '../src/fill/files.ts';

const settings = {
  apiUrl: 'https://api.jobdeputy.test',
  authDomain: 'https://auth.jobdeputy.test',
  clientId: 'e2etestclient0000000000000',
  filesOrigin: 'https://files.jobdeputy.test',
};
const LINK = 'https://files.jobdeputy.test/u/1/resume.pdf?X-Amz-Signature=abc';

function files(response: () => Response | Promise<Response>, overrides = {}) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response());
  return {
    fetch,
    files: createFiles({
      settings: { ...settings, ...overrides },
      fetch: fetch as typeof globalThis.fetch,
    }),
  };
}

describe('files (#54 PR C)', () => {
  it('reads a file from the documents origin as base64, without cookies', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 0, 255]);
    const { files: f, fetch } = files(() => new Response(bytes));
    const file = await f.read(LINK, 'Sam – Acme.pdf');
    expect(file).toEqual({
      name: 'Sam – Acme.pdf',
      type: 'application/pdf',
      base64: Buffer.from(bytes).toString('base64'),
    });
    expect(fetch).toHaveBeenCalledWith(LINK, { credentials: 'omit', redirect: 'error' });
  });

  it('reads a file larger than one chunk intact', async () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    const { files: f } = files(() => new Response(bytes));
    const file = await f.read(LINK, 'cv.docx');
    expect(file?.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(Buffer.from(file?.base64 ?? '', 'base64')).toEqual(Buffer.from(bytes));
  });

  it('fetches nothing from any other origin, or without one, or for another format', async () => {
    const { files: f, fetch } = files(() => new Response('x'));
    expect(await f.read('https://evil.test/resume.pdf', 'a.pdf')).toBeNull();
    expect(await f.read('http://files.jobdeputy.test/a.pdf', 'a.pdf')).toBeNull();
    expect(await f.read('not a url', 'a.pdf')).toBeNull();
    expect(await f.read(42, 'a.pdf')).toBeNull();
    expect(await f.read(LINK, 'resume.exe')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is null when the download fails, is empty, or is too big', async () => {
    expect(
      await files(() => new Response('no', { status: 403 })).files.read(LINK, 'a.pdf'),
    ).toBeNull();
    expect(
      await files(() => Promise.reject(new TypeError('offline'))).files.read(LINK, 'a.pdf'),
    ).toBeNull();
    expect(await files(() => new Response(new Uint8Array())).files.read(LINK, 'a.pdf')).toBeNull();
    const big = new Response('x', { headers: { 'content-length': String(MAX_FILE_BYTES + 1) } });
    expect(await files(() => big).files.read(LINK, 'a.pdf')).toBeNull();
    const huge = new Response(new Uint8Array(MAX_FILE_BYTES + 1));
    expect(await files(() => huge).files.read(LINK, 'a.pdf')).toBeNull();
  });

  it('stops reading a body without a length once it passes the cap', async () => {
    let sent = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.length;
        controller.enqueue(chunk);
      },
    });
    expect(await files(() => new Response(endless)).files.read(LINK, 'a.pdf')).toBeNull();
    expect(sent).toBeLessThanOrEqual(MAX_FILE_BYTES + 3 * chunk.length);
  });

  it('knows only the formats the app keeps', () => {
    expect(fileType('A.PDF')).toBe('application/pdf');
    expect(fileType('noextension')).toBeNull();
    expect(fileType('a.txt')).toBeNull();
  });
});
