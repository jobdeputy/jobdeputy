import {
  type AiSource,
  aiProvider,
  type HttpResponse,
  nextUtcMonthStart,
  problem,
} from '@jobdeputy/shared';
import type { TailoringDeps } from './tailoring.js';

// #51: what asking for a tailored résumé and a cover letter share: the AI source a run uses,
// the default résumé, and the refusal when the month's free runs (shared by both) are used up.

/** The AI source a run uses, or the problem to answer. Writing needs a model. */
export async function sourceFor(
  userId: string,
  asked: AiSource | undefined,
  deps: Pick<TailoringDeps, 'keys' | 'allowTestProvider'>,
  requestId: string,
  what: string,
): Promise<AiSource | HttpResponse> {
  const source = asked ?? (await deps.keys.getSettings(userId))?.defaultSource ?? 'platform';
  if (source === 'none') {
    return problem(422, 'An AI model is needed', {
      detail: `${what} with an AI model. Choose the free one, or a key you saved.`,
      code: 'model_needed',
      requestId,
    });
  }
  const provider = aiProvider(source, deps.allowTestProvider);
  if (source !== 'platform') {
    const key = provider ? await deps.keys.get(userId, provider) : undefined;
    if (!key || key.status === 'invalid') {
      return problem(422, 'Validation failed', {
        errors: [
          { path: 'aiSource', message: 'Use platform or a provider you saved a working key for' },
        ],
        requestId,
      });
    }
  }
  return source;
}

/** The default résumé, when it can be written from: ready, with text. */
export async function defaultResume(userId: string, deps: Pick<TailoringDeps, 'documents'>) {
  return (await deps.documents.list(userId)).find(
    (d) => d.isDefault && d.status === 'ready' && d.parsed && !d.parsed.noText,
  );
}

/** 429: the month's free runs (résumés and cover letters together) are used up. */
export function allowanceProblem(perMonth: number, now: Date, requestId: string): HttpResponse {
  const next = nextUtcMonthStart(now);
  const res = problem(429, 'Tailoring allowance used up', {
    code: 'tailoring_allowance',
    detail: `You've used your free tailored résumés and cover letters (${perMonth} a month). The next one is available at ${next.toISOString()}. Until then, use your own key.`,
    requestId,
  });
  const seconds = Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
  return { ...res, headers: { ...res.headers, 'retry-after': String(seconds) } };
}
