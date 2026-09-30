// Prompt-injection rule 4 (decision 0010): model output is checked against what we sent.

/**
 * Keeps only results for the given IDs, each once.
 * Returns the kept results and how many were dropped.
 */
export function groundResults<T extends { id: string }>(
  ids: readonly string[],
  results: readonly T[],
) {
  const wanted = new Set(ids);
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const result of results) {
    if (wanted.has(result.id) && !seen.has(result.id)) {
      seen.add(result.id);
      kept.push(result);
    }
  }
  return {
    kept,
    dropped: results.length - kept.length,
    missing: ids.filter((id) => !seen.has(id)),
  };
}
