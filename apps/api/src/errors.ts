import { ConcurrentUpdateError } from '@jobdeputy/db';
import { type HttpResponse, problem } from '@jobdeputy/shared';

/**
 * A write that still collided with another one after its retries (see `transactWrite`):
 * nothing was saved, and trying again will work. 409, never 500.
 */
export function concurrentUpdateProblem(
  error: unknown,
  requestId: string,
): HttpResponse | undefined {
  if (!(error instanceof ConcurrentUpdateError)) return undefined;
  return problem(409, 'Try again', {
    detail:
      'Another change was being saved at the same moment. Nothing was changed; please try again.',
    code: 'try-again',
    requestId,
  });
}
