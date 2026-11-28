import type { FillData, Unread } from '../fill/data.ts';
import type { ContentRequest, FillDataResponse } from '../messages.ts';
import { fillForm, markLeft, type Report } from './fill.ts';

/**
 * #54 PR C: one fill, as the panel asks for it: the answers from the service worker (the page
 * never sees a token), the form filled, and only a summary kept. The answers themselves, self-ID
 * included, live in this function's memory for the fill and are never stored (0019, 0020).
 */
export type Outcome =
  | {
      ok: true;
      report: Report;
      /**
       * The résumé field: which résumé was attached; `kept` when the person's own file was
       * already there or the form asks for none; null when it's empty (nothing to attach).
       */
      resume: NonNullable<FillData['resume']>['from'] | 'kept' | null;
      /** Whether this job's cover letter was attached. */
      coverLetter: boolean;
      unread: Unread[];
    }
  | { ok: false; reason: 'signed-out' | 'offline' | 'failed' };

export async function runFill(
  form: HTMLElement,
  send: (request: ContentRequest) => Promise<unknown>,
  /** The `--color-orange` token, for the page's outline. */
  outline = '',
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
  markLeft(form, outline);
  const report = await fillForm(form, data);
  // Said from what happened on the form, not from what the worker sent.
  const resumeField = report.files.resume;
  return {
    ok: true,
    report,
    resume:
      resumeField === 'attached' && data.resume
        ? data.resume.from
        : resumeField === 'empty'
          ? null
          : 'kept',
    coverLetter: report.files.cover_letter === 'attached',
    unread: data.unread,
  };
}
