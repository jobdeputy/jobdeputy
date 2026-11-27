import type { CoverLetter as LetterContent } from '@jobdeputy/shared/cover-letter';
import { useQuery } from '@tanstack/react-query';
import { type ApiClient, ApiError, isFinal, useApi } from './index.ts';
import { TAILORING_CHECK_MS, type TailoringStatus } from './tailorings.ts';

/**
 * #51 PR D (decision 0015): cover letters on demand, one job at a time
 * (apps/api/src/cover-letters.ts `coverLetterView`; docs/flows/tailoring.md).
 */
export interface CoverLetter {
  documentId: string;
  jobId: string;
  companyKey: string;
  companyName?: string;
  status: TailoringStatus;
  /** Failed: why, and what to say (`COVER_LETTER_ERRORS`). */
  error?: string;
  message?: string;
  /** Ready: written from the company's tailored résumé, or from the base résumé. */
  from?: 'tailored' | 'base';
  fileName?: string;
  createdAt: string;
  finishedAt?: string;
}

/** `GET /me/cover-letters?jobId=`: the job's letters, newest first, and the shared free runs. */
export interface CoverLetters {
  coverLetters: CoverLetter[];
  allowance: { used: number; perMonth: number; nextAt: string };
}

/** `GET /me/cover-letters/{id}` of a ready letter: its content, its text, 5-minute links. */
export interface CoverLetterFiles extends CoverLetter {
  letter?: LetterContent;
  /** The letter as plain text, for Copy (no contact header). */
  text?: string;
  downloads?: { pdf: string; docx: string };
}

export function isWriting(v: Pick<CoverLetter, 'status'> | undefined): boolean {
  return v?.status === 'queued' || v?.status === 'processing';
}

/** Every job's letter lists (a tailoring run counts against the same free runs). */
export const coverLetterListsKey = ['cover-letters', 'list'] as const;
export const coverLettersKey = (jobId: string) => ['cover-letters', 'list', jobId] as const;
/** A ready letter's content never changes: read once, kept while the page is open. */
export const coverLetterFilesKey = (documentId: string) =>
  ['cover-letters', 'letter', documentId] as const;

/**
 * A job's letters, asked about again every 5 s while its newest one is at work. A failed read
 * while polling keeps the last answer and is asked again on the next beat, unless asking again
 * can't help (signed out, account closed).
 */
export function useCoverLetters(jobId: string, checkEvery = TAILORING_CHECK_MS) {
  const api = useApi();
  return useQuery({
    queryKey: coverLettersKey(jobId),
    queryFn: () =>
      api.request<CoverLetters>(
        'GET',
        `/me/cover-letters?${new URLSearchParams({ jobId }).toString()}`,
      ),
    refetchOnWindowFocus: false,
    refetchInterval: ({ state }) =>
      !isFinal(state.error) && isWriting(state.data?.coverLetters[0]) ? checkEvery : false,
    retry: (failures, error) =>
      failures < 1 && error instanceof ApiError && error.kind === 'offline',
  });
}

/** A ready letter's content and text (for the preview and Copy), read once. */
export function useCoverLetterFiles(documentId: string) {
  const api = useApi();
  return useQuery({
    queryKey: coverLetterFilesKey(documentId),
    queryFn: () => coverLetterFiles(api, documentId),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: (failures, error) =>
      failures < 1 && error instanceof ApiError && error.kind === 'offline',
  });
}

/** `POST /me/cover-letters`: one letter for the job (202, queued), with the user's AI setting. */
export function requestCoverLetter(api: ApiClient, jobId: string) {
  return api.request<{ coverLetter: CoverLetter }>('POST', '/me/cover-letters', { jobId });
}

/** A ready letter's files, read when a download is asked for (the links last 5 minutes). */
export function coverLetterFiles(api: ApiClient, documentId: string) {
  return api.request<CoverLetterFiles>('GET', `/me/cover-letters/${documentId}`);
}
