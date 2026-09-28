import { describe, expect, it } from 'vitest';
import { createDocumentInput, documentId, updateDocumentInput } from '../src/index.js';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('createDocumentInput', () => {
  it.each([
    ['resume.pdf', PDF],
    ['Ada Lovelace – CV 2026.PDF', PDF],
    ['resume.docx', DOCX],
  ])('accepts %s', (fileName, contentType) => {
    expect(createDocumentInput.safeParse({ fileName, contentType }).success).toBe(true);
  });

  it.each([
    ['a mismatched extension', { fileName: 'resume.docx', contentType: PDF }],
    ['a legacy .doc', { fileName: 'resume.doc', contentType: 'application/msword' }],
    ['an image', { fileName: 'resume.png', contentType: 'image/png' }],
    ['a path', { fileName: '../../etc/passwd.pdf', contentType: PDF }],
    ['a quote (header injection)', { fileName: 'a".pdf', contentType: PDF }],
    ['a newline', { fileName: 'a\nb.pdf', contentType: PDF }],
    ['a size field (S3 enforces size)', { fileName: 'a.pdf', contentType: PDF, sizeBytes: 1 }],
    ['a user ID', { fileName: 'a.pdf', contentType: PDF, userId: 'x' }],
  ])('rejects %s', (_, input) => {
    expect(createDocumentInput.safeParse(input).success).toBe(false);
  });
});

describe('updateDocumentInput', () => {
  it('accepts a rename or making it the default', () => {
    expect(updateDocumentInput.safeParse({ version: 1, title: 'Main CV' }).success).toBe(true);
    expect(updateDocumentInput.safeParse({ version: 2, isDefault: true }).success).toBe(true);
  });

  it.each([
    ['nothing to change', { version: 1 }],
    ['unsetting the default', { version: 1, isDefault: false }],
    ['no version', { title: 'x' }],
    ['changing the status', { version: 1, status: 'ready' }],
  ])('rejects %s', (_, input) => {
    expect(updateDocumentInput.safeParse(input).success).toBe(false);
  });

  it('validates document IDs', () => {
    expect(documentId.safeParse('01J8ZQ4Y3N5W6X7Y8Z9A0B1C2D').success).toBe(true);
    expect(documentId.safeParse('x/../y').success).toBe(false);
  });
});
