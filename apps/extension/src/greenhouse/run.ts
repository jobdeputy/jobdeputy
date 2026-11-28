import type { FillData, Unread } from '../fill/data.ts';
import type { ContentRequest, FillDataResponse } from '../messages.ts';
import { fillForm, markStyle, type Report } from './fill.ts';

/**
 * #54 PR C: one fill, as the panel asks for it: the answers from the service worker (the page
 * never sees a token), the form filled, and only a summary kept. The answers themselves, self-ID
 * included, live in this function's memory for the fill and are never stored (0019, 0020).
 */
export type Outcome =
  | {
      ok: true;
      report: Report;
      /** Which résumé was attached, if any. */
      resume: NonNullable<FillData['resume']>['from'] | null;
      coverLetter: boolean;
      unread: Unread[];
    }
  | { ok: false; reason: 'signed-out' | 'offline' | 'failed' };

export async function runFill(
  form: HTMLElement,
  send: (request: ContentRequest) => Promise<unknown>,
): Promise<Outcome> {
  let answer: FillDataResponse;
  try {
    answer = (await send({ type: 'fill-data' })) as FillDataResponse;
  } catch {
    return { ok: false, reason: 'failed' };
  }
  if (!answer) return { ok: false, reason: 'failed' };
  if (!answer.ok) return { ok: false, reason: answer.reason };
  const data = answer.body;
  markStyle(form.ownerDocument);
  const report = await fillForm(form, data);
  return {
    ok: true,
    report,
    resume: data.resume?.from ?? null,
    coverLetter: data.coverLetter !== null,
    unread: data.unread,
  };
}
