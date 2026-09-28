export class DeadlineError extends Error {
  override name = 'DeadlineError';
}

/**
 * Rejects when `ms` elapses so the worker can record a failure before Lambda
 * kills it, instead of leaving the job stuck in `running`.
 */
export async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError(`Stopped after ${ms} ms (time limit)`)), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
