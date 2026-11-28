import type { Settings } from '../settings.ts';

/**
 * #54 PR C: a résumé or cover letter for the filler to attach, fetched by the service worker from
 * its 5-minute download link, and handed to the page as base64 (messages carry JSON only).
 */
export interface FileData {
  name: string;
  type: string;
  base64: string;
}

/** Above any file the app makes or accepts (résumés are capped well below this). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** The file's type from its name: only the formats the app keeps. */
export function fileType(name: string): string | null {
  return TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  // In chunks: spreading a whole file into one call overflows the stack.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

export function createFiles(deps: { settings: Settings; fetch: typeof fetch }) {
  return {
    /** The file at a download link, or null: not on the documents' origin, too big, or failed. */
    async read(link: unknown, name: string): Promise<FileData | null> {
      const type = fileType(name);
      const origin = deps.settings.filesOrigin;
      if (!type || !origin || typeof link !== 'string') return null;
      let url: URL;
      try {
        url = new URL(link);
      } catch {
        return null;
      }
      // Only the host the manifest asks for, so a link can never send the browser elsewhere.
      if (url.origin !== origin) return null;
      try {
        const res = await deps.fetch(url.href, { credentials: 'omit' });
        if (!res.ok) return null;
        const declared = Number(res.headers.get('content-length'));
        if (declared > MAX_FILE_BYTES) return null;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) return null;
        return { name, type, base64: base64(bytes) };
      } catch {
        return null;
      }
    },
  };
}

export type Files = ReturnType<typeof createFiles>;
