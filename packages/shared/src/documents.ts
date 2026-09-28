import { z } from 'zod';

/** T05c: résumé uploads. Item shape: docs/data-model.md (`documents`). */
export const MAX_DOCUMENTS = 10;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_URL_SECONDS = 300;
export const DOWNLOAD_URL_SECONDS = 300;

export const DOCUMENT_TYPES = {
  'application/pdf': { format: 'pdf', extension: '.pdf' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    format: 'docx',
    extension: '.docx',
  },
} as const;
export type DocumentContentType = keyof typeof DOCUMENT_TYPES;
export type DocumentFormat = (typeof DOCUMENT_TYPES)[DocumentContentType]['format'];

/**
 * pending → processing → ready, or rejected (failed the malware scan) or failed
 * (the file could not be used). A re-upload before expiry goes back through processing.
 */
export type DocumentStatus = 'pending' | 'processing' | 'ready' | 'rejected' | 'failed';

/** ULIDs, as for roles (docs/data-model.md). */
export const ulidId = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Invalid ID');
export const documentId = ulidId;

const fileName = z
  .string()
  .trim()
  .min(5)
  .max(200)
  // No paths, control characters, or quotes (the name is used in a download header).
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point.
  .regex(/^[^/\\\u0000-\u001f"]+$/, 'Use a plain file name');

export const createDocumentInput = z
  .strictObject({
    fileName,
    contentType: z.enum(
      Object.keys(DOCUMENT_TYPES) as [DocumentContentType, ...DocumentContentType[]],
    ),
  })
  .refine((v) => v.fileName.toLowerCase().endsWith(DOCUMENT_TYPES[v.contentType].extension), {
    message: 'The file extension does not match the file type',
    path: ['fileName'],
  });
export type CreateDocumentInput = z.infer<typeof createDocumentInput>;

export const updateDocumentInput = z
  .strictObject({
    version: z.number().int().min(1),
    title: z.string().trim().min(1).max(200).optional(),
    /** Only `true`: a default is replaced by choosing another one. */
    isDefault: z.literal(true).optional(),
  })
  .refine((v) => v.title !== undefined || v.isDefault !== undefined, {
    message: 'Nothing to update',
  });
export type UpdateDocumentInput = z.infer<typeof updateDocumentInput>;
