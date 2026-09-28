import { type Document, VersionConflictError } from '@jobdeputy/db';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { type DocumentsDeps, route } from '../src/documents.js';

const ID = '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2D';
const PDF = 'application/pdf';

function event(
  routeKey: string,
  extra: Record<string, unknown> = {},
  sub: string | null = 'user-a',
) {
  return {
    routeKey,
    requestContext: {
      requestId: 'req-1',
      ...(sub ? { authorizer: { jwt: { claims: { sub, username: `${sub}-n` } } } } : {}),
    },
    isBase64Encoded: false,
    ...extra,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const doc = (over: Partial<Document> = {}): Document => ({
  userId: 'user-a',
  documentId: ID,
  type: 'document',
  kind: 'resume',
  origin: 'uploaded',
  title: 'cv',
  fileName: 'cv.pdf',
  mimeType: PDF,
  format: 'pdf',
  s3Key: `users/user-a/documents/${ID}/original`,
  status: 'ready',
  isDefault: true,
  version: 1,
  eTag: '"e"',
  parsed: { textS3Key: 'k', pageCount: 1, charCount: 10, noText: false, truncated: false },
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
  schemaVersion: 1,
  ...over,
});

function deps() {
  const d = {
    newId: () => ID,
    isBeingDeleted: vi.fn(async () => false),
    presignUpload: vi.fn(async () => ({
      url: 'https://bucket.s3.amazonaws.com/',
      fields: { key: 'k' },
    })),
    presignDownload: vi.fn(async () => 'https://download'),
    deleteFiles: vi.fn(async () => undefined),
    repo: {
      list: vi.fn(async () => [] as Document[]),
      get: vi.fn(async () => doc() as Document | undefined),
      create: vi.fn(async (f: Partial<Document>) => doc({ ...f, status: 'pending' })),
      rename: vi.fn(async () => doc({ title: 'New', version: 2 }) as Document | undefined),
      setDefault: vi.fn(async () => doc({ version: 3 }) as Document | undefined),
      delete: vi.fn(async () => doc() as Document | undefined),
    },
  };
  return d as typeof d & DocumentsDeps;
}

const body = (b: unknown) => ({ body: JSON.stringify(b) });
const path = { pathParameters: { documentId: ID } };

describe('POST /me/documents', () => {
  it('creates a pending document under the caller and returns a presigned upload', async () => {
    const d = deps();
    const res = await route(
      event('POST /me/documents', body({ fileName: 'Ada CV.pdf', contentType: PDF })),
      d,
    );
    expect(res.statusCode).toBe(201);
    expect(d.repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-a',
        s3Key: `users/user-a/documents/${ID}/original`,
        title: 'Ada CV',
        format: 'pdf',
        isDefault: true,
      }),
    );
    expect(d.presignUpload).toHaveBeenCalledWith(`users/user-a/documents/${ID}/original`, PDF);
    const out = JSON.parse(res.body);
    expect(out.document).toMatchObject({ documentId: ID, status: 'pending' });
    expect(out.upload).toMatchObject({ maxBytes: 5 * 1024 * 1024, expiresInSeconds: 300 });
    expect(JSON.stringify(out)).not.toContain('s3Key');
  });

  it('is not the default when one already exists', async () => {
    const d = deps();
    d.repo.list.mockResolvedValueOnce([doc({ documentId: 'OTHER', isDefault: true })]);
    await route(event('POST /me/documents', body({ fileName: 'b.pdf', contentType: PDF })), d);
    expect(d.repo.create).toHaveBeenCalledWith(expect.objectContaining({ isDefault: false }));
  });

  it('refuses an 11th document', async () => {
    const d = deps();
    d.repo.list.mockResolvedValueOnce(Array.from({ length: 10 }, () => doc()));
    const res = await route(
      event('POST /me/documents', body({ fileName: 'b.pdf', contentType: PDF })),
      d,
    );
    expect(res.statusCode).toBe(422);
    expect(d.repo.create).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', { body: '{' }],
    ['an image', body({ fileName: 'a.png', contentType: 'image/png' })],
    ['a mismatched extension', body({ fileName: 'a.docx', contentType: PDF })],
  ])('rejects %s', async (_, extra) => {
    const d = deps();
    expect((await route(event('POST /me/documents', extra), d)).statusCode).toBe(400);
    expect(d.presignUpload).not.toHaveBeenCalled();
  });
});

describe('reading documents', () => {
  it('gives a download link only for ready documents', async () => {
    const d = deps();
    const ready = JSON.parse((await route(event('GET /me/documents/{documentId}', path), d)).body);
    expect(ready.downloadUrl).toBe('https://download');
    expect(ready.text).toEqual({ pageCount: 1, charCount: 10, noText: false, truncated: false });

    for (const status of ['pending', 'processing', 'rejected', 'failed'] as const) {
      d.repo.get.mockResolvedValueOnce(doc({ status }));
      const other = JSON.parse(
        (await route(event('GET /me/documents/{documentId}', path), d)).body,
      );
      expect(other.downloadUrl).toBeUndefined();
    }
  });

  it("returns 404 for another user's or a missing document", async () => {
    const d = deps();
    d.repo.get.mockResolvedValueOnce(undefined);
    expect(
      (await route(event('GET /me/documents/{documentId}', path, 'user-b'), d)).statusCode,
    ).toBe(404);
    expect(d.repo.get).toHaveBeenCalledWith('user-b', ID);
  });

  it('lists newest first without internal fields', async () => {
    const d = deps();
    d.repo.list.mockResolvedValueOnce([
      doc({ documentId: 'A', createdAt: '2026-01-01T00:00:00Z' }),
      doc({ documentId: 'B', createdAt: '2026-02-01T00:00:00Z' }),
    ]);
    const out = JSON.parse((await route(event('GET /me/documents'), d)).body);
    expect(out.documents.map((x: { documentId: string }) => x.documentId)).toEqual(['B', 'A']);
    for (const k of ['userId', 's3Key', 'eTag', 'ttl', 'schemaVersion']) {
      expect(out.documents[0]).not.toHaveProperty(k);
    }
  });

  it('rejects invalid IDs before touching storage', async () => {
    const d = deps();
    const res = await route(
      event('GET /me/documents/{documentId}', { pathParameters: { documentId: '../x' } }),
      d,
    );
    expect(res.statusCode).toBe(400);
    expect(d.repo.get).not.toHaveBeenCalled();
  });
});

describe('account deletion (T12)', () => {
  it('refuses uploads, changes, and deletes while the account is being deleted', async () => {
    const d = deps();
    d.isBeingDeleted.mockResolvedValue(true);
    const upload = await route(
      event('POST /me/documents', body({ fileName: 'a.pdf', contentType: PDF })),
      d,
    );
    expect(upload.statusCode).toBe(410);
    expect(d.presignUpload).not.toHaveBeenCalled();
    expect((await route(event('DELETE /me/documents/{documentId}', path), d)).statusCode).toBe(410);
  });
});

describe('changing documents', () => {
  it('renames and makes default using the version chain', async () => {
    const d = deps();
    const res = await route(
      event('PUT /me/documents/{documentId}', {
        ...path,
        ...body({ version: 1, title: 'New', isDefault: true }),
      }),
      d,
    );
    expect(res.statusCode).toBe(200);
    expect(d.repo.rename).toHaveBeenCalledWith('user-a', ID, 'New', 1);
    expect(d.repo.setDefault).toHaveBeenCalledWith('user-a', ID, 2);
  });

  it('returns 409 on a conflict', async () => {
    const d = deps();
    d.repo.rename.mockRejectedValueOnce(new VersionConflictError(5));
    const res = await route(
      event('PUT /me/documents/{documentId}', { ...path, ...body({ version: 1, title: 'x' }) }),
      d,
    );
    expect(res.statusCode).toBe(409);
  });

  it('deletes the item and both files', async () => {
    const d = deps();
    expect((await route(event('DELETE /me/documents/{documentId}', path), d)).statusCode).toBe(204);
    expect(d.deleteFiles).toHaveBeenCalledWith([
      `users/user-a/documents/${ID}/original`,
      `derived/users/user-a/documents/${ID}/text.txt`,
    ]);
    d.repo.delete.mockResolvedValueOnce(undefined);
    expect((await route(event('DELETE /me/documents/{documentId}', path), d)).statusCode).toBe(404);
  });

  it('rejects requests without verified claims', async () => {
    const d = deps();
    expect((await route(event('GET /me/documents', {}, null), d)).statusCode).toBe(401);
    expect(d.repo.list).not.toHaveBeenCalled();
  });
});
